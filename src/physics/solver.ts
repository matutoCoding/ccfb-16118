// 叠石物理核心：落位吸附、穿插检测、支撑面/重心/抗倾覆校核
// 约定：世界坐标 y 向上，重力沿 -y；所有石头局部几何重心已居中在原点
import * as THREE from 'three';
import { Placement, StabilityResult, StoneDef } from '../core/types';
import { convexHull2D, footprintArea, pointInHull, polygonArea, Pt2, SampledMesh, sampleMeshSurface } from './meshSamples';

const CONTACT_BAND = 0.03;   // 接触判定竖向容差 3cm（点采样等效面粗糙度）
const PENETRATION_TOL = 0.02; // 允许的最大穿插 2cm
const MAX_PUSH_ITERS = 24;
const GRID_CELL = 0.5;       // 空间哈希 broadphase 网格 m

export interface RockBody {
  placement: Placement;
  def: StoneDef;
  sample: SampledMesh;
  localCentroid: THREE.Vector3;   // 局部重心（生成器已居中，近似原点，按网格再算）
  footprint: number;              // 局部 footprint 面积
  matrix: THREE.Matrix4;
  invMatrix: THREE.Matrix4;
  worldPoints: THREE.Vector3[];   // 缓存的世界采样点
}

export function createRockBody(def: StoneDef, geo: THREE.BufferGeometry, placement: Placement): RockBody {
  const sample = sampleMeshSurface(geo, def.seed);
  const q = new THREE.Quaternion(...placement.quaternion);
  const pos = new THREE.Vector3(...placement.position);
  const matrix = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  const worldPoints = sample.points.map(p => p.clone().applyMatrix4(matrix));
  return {
    placement, def, sample,
    localCentroid: new THREE.Vector3(0, 0, 0),
    footprint: footprintArea(sample.points),
    matrix,
    invMatrix: matrix.clone().invert(),
    worldPoints
  };
}

export function refreshBody(body: RockBody): void {
  const q = new THREE.Quaternion(...body.placement.quaternion);
  const pos = new THREE.Vector3(...body.placement.position);
  body.matrix.compose(pos, q, new THREE.Vector3(1, 1, 1));
  body.invMatrix.copy(body.matrix).invert();
  for (let i = 0; i < body.sample.points.length; i++) {
    body.worldPoints[i].copy(body.sample.points[i]).applyMatrix4(body.matrix);
  }
}

// ---------- broadphase 空间哈希 ----------
class Grid {
  map = new Map<string, number[]>();
  constructor(points: THREE.Vector3[][]) {
    for (let b = 0; b < points.length; b++) {
      for (const p of points[b]) {
        const key = `${Math.floor(p.x / GRID_CELL)},${Math.floor(p.y / GRID_CELL)},${Math.floor(p.z / GRID_CELL)}`;
        let arr = this.map.get(key);
        if (!arr) { arr = []; this.map.set(key, arr); }
        arr.push(b);
      }
    }
  }
  neighbors(p: THREE.Vector3): Set<number> {
    const out = new Set<number>();
    const cx = Math.floor(p.x / GRID_CELL), cy = Math.floor(p.y / GRID_CELL), cz = Math.floor(p.z / GRID_CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = this.map.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (arr) for (const b of arr) out.add(b);
    }
    return out;
  }
}

export interface SnapResult {
  position: [number, number, number];
  /** 最大残留穿插（米），> PENETRATION_TOL 表示放不下 */
  penetration: number;
  /** 首次接触的支撑石头 placementId（地面为 null） */
  supportIds: string[];
}

/**
 * 落位求解：从给定水平位置/姿态垂直下落，贴到最高接触面；
 * 接触后做小幅水平推出迭代消除穿插。地面 y=0。
 */
export function solveSnap(bodies: RockBody[], moving: RockBody,
                          xy: [number, number], quat: THREE.Quaternion): SnapResult {
  const q = quat.clone();
  let cx = xy[0], cz = xy[1];

  const composeAt = (y: number) => {
    moving.placement.position = [cx, y, cz];
    moving.placement.quaternion = [q.x, q.y, q.z, q.w];
    refreshBody(moving);
  };

  // ---- 第一步：垂直射线找最高支撑 ----
  const groundY = 0;
  let supportY = groundY;
  const supportHits = new Map<string, number>(); // placementId -> 最高接触 y
  const rayTargets: { body: RockBody; points: THREE.Vector3[] }[] = [];

  const findHighestSupport = () => {
    supportY = groundY;
    supportHits.clear();
    for (const b of bodies) {
      rayTargets.push({ body: b, points: b.worldPoints });
    }
    // 对移动石头每个朝下采样点，竖直向下找其它石头的最高表面
    for (const idx of moving.sample.underside) {
      const wp = moving.worldPoints[idx];
      let best = -Infinity, bestId: string | null = null;
      for (const target of rayTargets) {
        const tb = target.body;
        // 局部空间判断水平落在目标点附近（半径 8cm 的圆柱）
        const local = wp.clone().applyMatrix4(tb.invMatrix);
        for (const lp of tb.sample.points) {
          const dxy = Math.hypot(lp.x - local.x, lp.z - local.z);
          if (dxy < 0.08 && lp.y > local.y - 0.3 && lp.y <= local.y + 0.02) {
            const worldY = lp.clone().applyMatrix4(tb.matrix).y;
            if (worldY > best) { best = worldY; bestId = tb.placement.id; }
          }
        }
      }
      if (bestId !== null) {
        supportHits.set(bestId, Math.max(supportHits.get(bestId) ?? -Infinity, best));
        supportY = Math.max(supportY, best);
      }
    }
  };

  // 初始放到足够高再下落
  composeAt(5);
  findHighestSupport();

  // 把石头最低点移动到支撑面 supportY（地面兜底为 0）
  const dropToSupport = () => {
    let minY = Infinity;
    for (const p of moving.worldPoints) minY = Math.min(minY, p.y);
    composeAt(moving.placement.position[1] - (minY - supportY));
  };
  dropToSupport();

  // ---- 第二步：迭代推出穿插 ----
  let penetration = 0;
  for (let iter = 0; iter < MAX_PUSH_ITERS; iter++) {
    const grid = new Grid(bodies.map(b => b.worldPoints));
    let worst = 0;
    const push = new THREE.Vector3();
    for (let i = 0; i < moving.worldPoints.length; i++) {
      const p = moving.worldPoints[i];
      const nbr = grid.neighbors(p);
      for (const bi of nbr) {
        const tb = bodies[bi];
        const local = p.clone().applyMatrix4(tb.invMatrix);
        for (const lp of tb.sample.points) {
          const d = local.distanceTo(lp);
          if (d < 0.05 && d < PENETRATION_TOL * 2.5) {
            // 点在目标内部近似判定：最近点距离过小且在目标体包围范围
            const box = tb.def.size;
            const inside = Math.abs(local.x) < box[0] / 2 && Math.abs(local.y) < box[1] / 2 && Math.abs(local.z) < box[2] / 2;
            if (inside) {
              const depth = 0.05 - d;
              if (depth > worst) worst = depth;
              const dir = new THREE.Vector3(local.x - lp.x, (local.y - lp.y) * 0.4, local.z - lp.z);
              if (dir.lengthSq() < 1e-8) dir.set(local.x || 0.01, 0.2, local.z || 0.01);
              push.add(dir.normalize().multiplyScalar(depth));
            }
          }
        }
      }
    }
    penetration = worst;
    if (worst <= PENETRATION_TOL) break;
    cx += THREE.MathUtils.clamp(push.x, -0.05, 0.05);
    cz += THREE.MathUtils.clamp(push.z, -0.05, 0.05);
    // 重新贴附
    composeAt(moving.placement.position[1]);
    findHighestSupport();
    dropToSupport();
  }

  return {
    position: moving.placement.position,
    penetration,
    supportIds: [...supportHits.keys()]
  };
}

/** 最终穿插量复核（用于已布置场景校验） */
export function measurePenetration(bodies: RockBody[], moving: RockBody): number {
  let worst = 0;
  for (const tb of bodies) {
    if (tb.placement.id === moving.placement.id) continue;
    for (const wp of moving.worldPoints) {
      const local = wp.clone().applyMatrix4(tb.invMatrix);
      const box = tb.def.size;
      if (Math.abs(local.x) < box[0] / 2 && Math.abs(local.y) < box[1] / 2 && Math.abs(local.z) < box[2] / 2) {
        let dMin = Infinity;
        for (const lp of tb.sample.points) dMin = Math.min(dMin, local.distanceTo(lp));
        worst = Math.max(worst, Math.max(0, 0.05 - dMin));
      }
    }
  }
  return worst;
}

// ---------- 稳定校核 ----------

/** 找某石头当前的接触点（世界坐标），返回按支撑石头分组的点 */
export function findContacts(bodies: RockBody[], body: RockBody): { points: THREE.Vector3[]; area: number; supports: string[] } {
  const contactPts: THREE.Vector3[] = [];
  const supports = new Set<string>();
  let area = 0;

  // 先求该石头所有 underside 点的最低世界高度，地面接触用相对容差而非固定 3cm
  let lowestY = Infinity;
  for (const idx of body.sample.underside) {
    lowestY = Math.min(lowestY, body.worldPoints[idx].y);
  }
  const groundTol = Math.max(CONTACT_BAND, body.def.size[1] * 0.12); // 至少取高度 12% 作为底面带
  const onGround = lowestY <= 0.05;

  if (onGround) {
    // 地面石：瘦高/尖底石（如英石剑峰）朝下采样点极少，
    // 支撑面应取整体在水平面的投影凸包（实际砌筑的底面接触范围），而非仅几个尖点
    for (let i = 0; i < body.worldPoints.length; i++) {
      const wp = body.worldPoints[i];
      if (wp.y - lowestY <= groundTol) {
        contactPts.push(wp.clone());
        area += body.sample.areaWeight[i] ?? body.sample.totalArea / body.worldPoints.length;
      }
    }
    supports.add('ground');
  }

  for (const idx of body.sample.underside) {
    const wp = body.worldPoints[idx];
    if (onGround) continue; // 地面石已按投影凸包处理
    for (const tb of bodies) {
      if (tb.placement.id === body.placement.id) continue;
      const local = wp.clone().applyMatrix4(tb.invMatrix);
      let hit = false;
      for (const lp of tb.sample.points) {
        const dxy = Math.hypot(lp.x - local.x, lp.z - local.z);
        const dy = Math.abs(lp.y - local.y);
        if (dxy < 0.08 && dy < CONTACT_BAND && lp.y <= local.y + 0.01) { hit = true; break; }
      }
      if (hit) {
        contactPts.push(wp.clone());
        area += body.sample.areaWeight[idx];
        supports.add(tb.placement.id);
        break;
      }
    }
  }
  return { points: contactPts, area, supports: [...supports] };
}

/**
 * 抗倾覆系数：重力对支撑凸包每条边取 K = 稳定力矩 / 倾覆力矩。
 * K = d_稳 / d_倾（重力作用线到边的水平距离，重心在支撑侧为稳）。
 */
export function overturnFactor(hull: Pt2[], com: THREE.Vector3): { factor: number; edge: Pt2[] | null } {
  if (hull.length < 3) return { factor: 0, edge: null };
  let worst = Infinity;
  let worstEdge: Pt2[] | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    // 有向边 × 重心向量
    const cross = ex * (com.z - a[1]) - ez * (com.x - a[0]);
    // 重心到边的垂直距离（带符号）
    const d = cross / len;
    // 边到凸包最远点（重心对侧）的距离
    let far = 0;
    for (const p of hull) {
      const c2 = ex * (p[1] - a[1]) - ez * (p[0] - a[0]);
      far = Math.max(far, Math.abs(c2) / len);
    }
    const k = d >= 0 ? (far + d) / Math.max(far - d, 1e-6) : d / far; // d<0：重心已越边
    if (k < worst) { worst = k; worstEdge = [a, b]; }
  }
  return { factor: Number.isFinite(worst) ? worst : 0, edge: worstEdge };
}

export interface StabilityOptions {
  minContactRatio: number;
  safeOverturnFactor: number;
  isTopStone: boolean;
}

export function checkStability(bodies: RockBody[], body: RockBody, opts: StabilityOptions): StabilityResult {
  const com = body.localCentroid.clone().applyMatrix4(body.matrix);
  const contact = findContacts(bodies, body);
  const hullPts = contact.points.length >= 3
    ? convexHull2D(contact.points.map(p => [p.x, p.z] as Pt2))
    : contact.points.map(p => [p.x, p.z] as Pt2);
  const supportArea = polygonArea(hullPts);
  const contactRatio = contact.area / Math.max(body.footprint, 1e-6);
  const inside = pointInHull(hullPts, com.x, com.z);

  // 偏心距：重心到凸包内部最近距离
  let eccentricity = 0;
  if (!inside && hullPts.length >= 3) {
    eccentricity = Infinity;
    for (let i = 0; i < hullPts.length; i++) {
      const a = hullPts[i], b = hullPts[(i + 1) % hullPts.length];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const t = THREE.MathUtils.clamp(
        ((com.x - a[0]) * ex + (com.z - a[1]) * ez) / (ex * ex + ez * ez), 0, 1);
      const px = a[0] + ex * t, pz = a[1] + ez * t;
      eccentricity = Math.min(eccentricity, Math.hypot(com.x - px, com.z - pz));
    }
  }

  const { factor } = overturnFactor(hullPts, com);

  // 悬挑判定：footprint 超出支撑凸包的比例。
  // 地面石（直接落在地基上）底面由地基满承，不按悬挑处理；仅对石上石判定。
  const onGround = contact.supports.includes('ground') && contact.supports.length === 1;
  let outside = 0, total = 0;
  if (!onGround) {
    for (const wp of body.worldPoints) {
      total++;
      if (!pointInHull(hullPts, wp.x, wp.z)) outside++;
    }
  }
  const cantileverRatio = total ? outside / total : 0;
  const isCantilever = !onGround && cantileverRatio > 0.35;

  const warnings: string[] = [];
  let status: StabilityResult['status'] = 'ok';
  if (contact.points.length < 3) {
    status = 'danger';
    warnings.push('支撑点不足 3 个，无法形成稳定支撑面');
  } else if (!inside) {
    status = 'danger';
    warnings.push(`重心投影超出支撑面，偏心距 ${eccentricity.toFixed(3)}m，存在倾覆风险`);
  } else if (factor < opts.safeOverturnFactor) {
    status = 'danger';
    warnings.push(`抗倾覆系数 ${factor.toFixed(2)} 低于安全限值 ${opts.safeOverturnFactor}`);
  } else if (contactRatio < opts.minContactRatio) {
    status = 'warn';
    warnings.push(`接触面积比 ${(contactRatio * 100).toFixed(1)}% 偏小（限值 ${(opts.minContactRatio * 100).toFixed(0)}%），易应力集中`);
  }
  if (isCantilever) {
    if (status !== 'danger') status = 'warn';
    warnings.push(`悬挑比例 ${(cantileverRatio * 100).toFixed(0)}%：建议加设铁件（扁担石/扒钉）或 C20 砂浆垫层`);
  }
  if (opts.isTopStone) {
    if (factor < opts.safeOverturnFactor) {
      warnings.push(`压顶石抗倾覆不满足，需压脚或拉结（K=${factor.toFixed(2)}）`);
    } else {
      warnings.push(`压顶石抗倾覆安全系数 K=${factor.toFixed(2)}，满足 ≥${opts.safeOverturnFactor}`);
    }
  }

  return {
    stoneId: body.placement.stoneId,
    centerOfMass: [com.x, com.y, com.z],
    supportPolygon: hullPts.map(p => [p[0], 0, p[1]]),
    supportArea,
    contactArea: contact.area,
    contactRatio,
    insideSupport: inside,
    eccentricity,
    overturnFactor: factor,
    status,
    isCantilever,
    isCoping: opts.isTopStone,
    warnings
  };
}

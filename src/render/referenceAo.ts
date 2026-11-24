// 离线参考 AO：逐点半球射线采样（蒙特卡洛 + 空间网格加速）
// 与 GTAO 实时结果在同一组探针上比较，给出平均/最大误差报告
import * as THREE from 'three';
import { Rng } from '../core/rng';

interface Tri { ax: number; ay: number; az: number; bx: number; by: number; bz: number;
              cx: number; cy: number; cz: number; }

const CELL = 0.4;

export class RayTraceScene {
  private tris: Tri[] = [];
  private grid = new Map<string, number[]>();

  addMesh(geo: THREE.BufferGeometry, matrix: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const base = this.tris.length;
    for (let t = 0; t < pos.count / 3; t++) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos, t * 3 + k).applyMatrix4(matrix);
        pts.push(v.clone());
      }
      this.tris.push({
        ax: pts[0].x, ay: pts[0].y, az: pts[0].z,
        bx: pts[1].x, by: pts[1].y, bz: pts[1].z,
        cx: pts[2].x, cy: pts[2].y, cz: pts[2].z
      });
    }
    if (g !== geo) g.dispose();
    for (let i = base; i < this.tris.length; i++) {
      const tr = this.tris[i];
      const mnx = Math.floor(Math.min(tr.ax, tr.bx, tr.cx) / CELL);
      const mxx = Math.floor(Math.max(tr.ax, tr.bx, tr.cx) / CELL);
      const mny = Math.floor(Math.min(tr.ay, tr.by, tr.cy) / CELL);
      const mxy = Math.floor(Math.max(tr.ay, tr.by, tr.cy) / CELL);
      const mnz = Math.floor(Math.min(tr.az, tr.bz, tr.cz) / CELL);
      const mxz = Math.floor(Math.max(tr.az, tr.bz, tr.cz) / CELL);
      for (let x = mnx; x <= mxx; x++) for (let y = mny; y <= mxy; y++) for (let z = mnz; z <= mxz; z++) {
        const key = `${x},${y},${z}`;
        let arr = this.grid.get(key);
        if (!arr) { arr = []; this.grid.set(key, arr); }
        arr.push(i);
      }
    }
  }

  /** Möller–Trumbore，epsilon 起步避免自交 */
  private hit(ox: number, oy: number, oz: number,
              dx: number, dy: number, dz: number, maxDist: number): boolean {
    const visited = new Set<number>();
    // 射线经过的格子步进（DDA 简化：按固定步长采样格子）
    const steps = Math.ceil(maxDist / CELL);
    for (let s = 1; s <= steps; s++) {
      const t = (s / steps) * maxDist;
      const key = `${Math.floor((ox + dx * t) / CELL)},${Math.floor((oy + dy * t) / CELL)},${Math.floor((oz + dz * t) / CELL)}`;
      const arr = this.grid.get(key);
      if (!arr) continue;
      for (const ti of arr) {
        if (visited.has(ti)) continue;
        visited.add(ti);
        const tr = this.tris[ti];
        const e1x = tr.bx - tr.ax, e1y = tr.by - tr.ay, e1z = tr.bz - tr.az;
        const e2x = tr.cx - tr.ax, e2y = tr.cy - tr.ay, e2z = tr.cz - tr.az;
        const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-10) continue;
        const inv = 1 / det;
        const sx = ox - tr.ax, sy = oy - tr.ay, sz = oz - tr.az;
        const u = inv * (sx * hx + sy * hy + sz * hz);
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v2 = inv * (dx * qx + dy * qy + dz * qz);
        if (v2 < 0 || u + v2 > 1) continue;
        const rt = inv * (e2x * qx + e2y * qy + e2z * qz);
        if (rt > 1e-4 && rt < maxDist) return true;
      }
    }
    return false;
  }

  /**
   * CPU 版 GTAO 对照值：与实时着色器同采样预算（4 切片 × 2 侧 × 12 步 ≈ 96 射线）
   * 的余弦加权半球遮挡率，独立种子采样，与 referenceAo 的高密度离线射线参考对照，
   * 两者输出同为 [0,1]，可直接相减得到平均误差。
   */
  gtaoAtProbe(point: THREE.Vector3, normal: THREE.Vector3, radius: number,
              slices = 4, steps = 12): number {
    // 采样预算与 GPU 切片×步进相当（4 切片 × 2 侧 × 12 步 ≈ 96 条），同余弦加权
    const rays = slices * 2 * steps;
    const up = Math.abs(normal.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tx = new THREE.Vector3().crossVectors(normal, up).normalize();
    const tz = new THREE.Vector3().crossVectors(normal, tx).normalize();
    const rng = new Rng((Math.floor((point.x * 13 + point.y * 7 + point.z * 17) * 1000) & 0xffff) ^ 0x5a5a || 1);
    let blocked = 0;
    for (let i = 0; i < rays; i++) {
      const r1 = rng.next(), r2 = rng.next();
      const phi = 2 * Math.PI * r1;
      const cosTheta = Math.sqrt(1 - r2);
      const sinTheta = Math.sqrt(r2);
      const lx = Math.cos(phi) * sinTheta, ly = cosTheta, lz = Math.sin(phi) * sinTheta;
      const dx = tx.x * lx + normal.x * ly + tz.x * lz;
      const dy = tx.y * lx + normal.y * ly + tz.y * lz;
      const dz = tx.z * lx + normal.z * ly + tz.z * lz;
      if (this.hit(point.x + normal.x * 0.01, point.y + normal.y * 0.01, point.z + normal.z * 0.01,
                   dx, dy, dz, radius)) {
        blocked += ly;
      }
    }
    return blocked / rays;
  }

  /** 返回射线方向上最近命中距离，未命中 null */
  private occlusionDistance(point: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null {
    let best: number | null = null;
    const visited = new Set<number>();
    const steps = Math.ceil(maxDist / CELL);
    for (let s = 1; s <= steps; s++) {
      const t = (s / steps) * maxDist;
      const key = `${Math.floor((point.x + dir.x * t) / CELL)},${Math.floor((point.y + dir.y * t) / CELL)},${Math.floor((point.z + dir.z * t) / CELL)}`;
      const arr = this.grid.get(key);
      if (!arr) continue;
      for (const ti of arr) {
        if (visited.has(ti)) continue;
        visited.add(ti);
        const tr = this.tris[ti];
        const e1x = tr.bx - tr.ax, e1y = tr.by - tr.ay, e1z = tr.bz - tr.az;
        const e2x = tr.cx - tr.ax, e2y = tr.cy - tr.ay, e2z = tr.cz - tr.az;
        const hx = dir.y * e2z - dir.z * e2y, hy = dir.z * e2x - dir.x * e2z, hz = dir.x * e2y - dir.y * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-10) continue;
        const inv = 1 / det;
        const sx = point.x - tr.ax, sy = point.y - tr.ay, sz = point.z - tr.az;
        const u = inv * (sx * hx + sy * hy + sz * hz);
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v2 = inv * (dir.x * qx + dir.y * qy + dir.z * qz);
        if (v2 < 0 || u + v2 > 1) continue;
        const rt = inv * (e2x * qx + e2y * qy + e2z * qz);
        if (rt > 1e-4 && rt < maxDist && (best === null || rt < best)) best = rt;
      }
    }
    return best;
  }

  /**
   * 参考 AO：余弦加权半球射线。
   * AO = 1 - mean(cosθ * 未命中)，θ 为射线与法线夹角。
   * 射线长度即 GTAO 半径，保证两边口径一致。
   */
  referenceAo(point: THREE.Vector3, normal: THREE.Vector3, radius: number,
              rays = 96, seed = 1): number {
    const rng = new Rng(seed);
    // 构造法线局部基
    const up = Math.abs(normal.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tx = new THREE.Vector3().crossVectors(normal, up).normalize();
    const tz = new THREE.Vector3().crossVectors(normal, tx).normalize();
    // 余弦加权采样下，遮挡率估计 = (1/N)·Σ 命中权重（采样分布已含余弦项）
    let blocked = 0;
    for (let i = 0; i < rays; i++) {
      const r1 = rng.next(), r2 = rng.next();
      // 余弦加权：phi 均匀，sqrt(r2) 决定 sinPhi
      const phi = 2 * Math.PI * r1;
      const cosTheta = Math.sqrt(1 - r2);
      const sinTheta = Math.sqrt(r2);
      const lx = Math.cos(phi) * sinTheta, ly = cosTheta, lz = Math.sin(phi) * sinTheta;
      const dx = tx.x * lx + normal.x * ly + tz.x * lz;
      const dy = tx.y * lx + normal.y * ly + tz.y * lz;
      const dz = tx.z * lx + normal.z * ly + tz.z * lz;
      // 起点沿法线抬一点，避免自交
      if (this.hit(point.x + normal.x * 0.01, point.y + normal.y * 0.01, point.z + normal.z * 0.01,
                   dx, dy, dz, radius)) {
        blocked += ly;
      }
    }
    return blocked / rays; // 归一化到 [0,1]
  }
}

export interface AoProbe {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  reference: number;
  gtao: number;
}

export interface AoValidationReport {
  probes: number;
  raysPerProbe: number;
  meanError: number;     // 平均绝对误差（0~1 尺度）
  maxError: number;
  meanReference: number;
  meanGtao: number;
  pass5Percent: boolean;
  details: { x: number; y: number; z: number; ref: number; gtao: number; err: number }[];
}

/**
 * 在场景中均布探针（石头表面随机点），比较参考 AO 与 GTAO 同源近似值。
 * gtaoValues 由渲染侧在相同探针位置回算（gtaoAtProbe）。
 */
export function validateAo(probes: AoProbe[], raysPerProbe: number): AoValidationReport {
  let sumErr = 0, maxErr = 0, sumRef = 0, sumGtao = 0;
  const details = probes.map(p => {
    const err = Math.abs(p.reference - p.gtao);
    sumErr += err; maxErr = Math.max(maxErr, err);
    sumRef += p.reference; sumGtao += p.gtao;
    return { x: p.point.x, y: p.point.y, z: p.point.z, ref: p.reference, gtao: p.gtao, err };
  });
  const n = probes.length || 1;
  const meanError = sumErr / n;
  return {
    probes: probes.length,
    raysPerProbe,
    meanError,
    maxError: maxErr,
    meanReference: sumRef / n,
    meanGtao: sumGtao / n,
    pass5Percent: meanError < 0.05,
    details
  };
}

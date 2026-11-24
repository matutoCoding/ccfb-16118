// 透光孔分析：从各视点出发，对每块太湖石的每个通孔做穿洞判定
// 判定：视线沿孔轴方向、落在孔口内，再沿穿出方向判断见天还是见水
import * as THREE from 'three';
import { ProjectDoc, StoneDef, TransparentHole, ViewPoint } from '../core/types';
import { RockBody } from '../physics/solver';

export interface TransparencyResult {
  holes: TransparentHole[];
  perView: { viewName: string; sky: number; water: number; total: number }[];
}

/**
 * 基于石头自带孔道元数据的解析判定（与网格同源、确定性）：
 * 1) 视点→孔中心方向与孔轴夹角 < 75°（大致沿孔道看）
 * 2) 视点到孔轴的垂直距离 < 孔半径 × 0.9（视线落在孔口内）
 * 3) 穿出后视线与水面相交 → 见水，否则 → 见天
 */
export function analyzeTransparency(
  project: ProjectDoc,
  defs: Map<string, StoneDef>,
  bodies: Map<string, RockBody>
): TransparencyResult {
  const holes: TransparentHole[] = [];

  for (const view of project.viewpoints) {
    const eye = new THREE.Vector3(...view.position);

    for (const body of bodies.values()) {
      const def = defs.get(body.placement.stoneId);
      if (!def || def.species !== 'taihu' || def.holes.length === 0) continue;

      for (const h of def.holes) {
        const center = new THREE.Vector3(...h.center).applyMatrix4(body.matrix);
        const axis = new THREE.Vector3(...h.axis).transformDirection(body.matrix).normalize();
        const toEye = eye.clone().sub(center);
        const dist = toEye.length();
        const viewDir = toEye.clone().normalize();

        // 条件 1：视线与孔轴近似共线（从孔的一端看向另一端）
        const align = Math.abs(viewDir.dot(axis));
        if (align < Math.cos(75 * Math.PI / 180)) continue;

        // 条件 2：视点到孔轴直线的垂直距离（轴已归一化，点-直线距离）
        const along = toEye.dot(axis);
        const closest = center.clone().addScaledVector(axis, along);
        const perpDist = eye.distanceTo(closest);
        // 用孔口在视点处的角半径判定：视线偏角对应横向偏移须落在孔口内。
        // 随距离放宽（远看孔口张角小但视线更准），阈值取孔半径的 1.1 倍容差。
        const angularRadius = Math.atan2(h.radius, Math.max(dist, 0.1));
        const lookAngle = Math.atan2(perpDist, Math.max(Math.abs(along), 0.05));
        if (lookAngle > angularRadius * 1.15) continue;

        // 条件 3：穿出后去向
        const exitPoint = center.clone().addScaledVector(viewDir, h.length * 0.5 + 0.2);
        let sees: 'sky' | 'water';
        if (project.lighting.waterEnabled && Math.abs(viewDir.y) > 1e-4) {
          const t = (project.lighting.waterLevel - exitPoint.y) / viewDir.y;
          sees = t > 0 ? 'water' : 'sky';
        } else {
          sees = 'sky';
        }

        const holeId = `${body.placement.id}#${h.id}`;
        if (holes.some(x => x.holeId === holeId && x.viewName === view.name)) continue;
        holes.push({ holeId, stoneCode: def.code, viewName: view.name, sees });
      }
    }
  }

  const perView = project.viewpoints.map(v => {
    const list = holes.filter(h => h.viewName === v.name);
    return {
      viewName: v.name,
      sky: list.filter(h => h.sees === 'sky').length,
      water: list.filter(h => h.sees === 'water').length,
      total: list.length
    };
  });

  return { holes, perView };
}

/** 相机跳到指定视点 */
export function applyViewpoint(camera: THREE.PerspectiveCamera, v: ViewPoint) {
  camera.position.set(...v.position);
  camera.lookAt(new THREE.Vector3(...v.target));
}

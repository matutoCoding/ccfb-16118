// 网格表面确定性采样：用于接触检测、碰撞间距与面积估计
import * as THREE from 'three';
import { Rng } from '../core/rng';

export interface SampledMesh {
  points: THREE.Vector3[];       // 局部坐标表面点
  areaWeight: Float32Array;      // 每点代表的面积
  totalArea: number;
  underside: number[];           // 法向朝下（局部 y < -0.25）的点索引
  volume: number;
}

/** 按三角形面积加权采样，点数按面积自适应，封顶避免性能问题 */
export function sampleMeshSurface(geo: THREE.BufferGeometry, seed: number,
                                   targetDensity = 900): SampledMesh {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  const pos = nonIndexed.attributes.position as THREE.BufferAttribute;
  const nor = nonIndexed.attributes.normal as THREE.BufferAttribute;
  const triCount = pos.count / 3;

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const areas = new Float32Array(triCount);
  let totalArea = 0;
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    const ar = b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
    areas[t] = ar;
    totalArea += ar;
  }

  const points: THREE.Vector3[] = [];
  const weights: number[] = [];
  const underside: number[] = [];
  const rng = new Rng(seed ^ 0x9e3779b9);
  const perArea = Math.min(1400, Math.max(260, targetDensity)) / Math.max(totalArea, 1e-6);
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    n.fromBufferAttribute(nor, t * 3);
    ab.subVectors(b, a); ac.subVectors(c, a);
    const k = Math.max(1, Math.round(areas[t] * perArea));
    const w = areas[t] / k;
    for (let s = 0; s < k; s++) {
      // 重心坐标均匀采样
      let r1 = rng.next(), r2 = rng.next();
      if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
      p.copy(a).addScaledVector(ab, r1).addScaledVector(ac, r2);
      points.push(p.clone());
      weights.push(w);
      if (n.y < -0.25) underside.push(points.length - 1);
    }
  }
  if (nonIndexed !== geo) nonIndexed.dispose();
  return { points, areaWeight: Float32Array.from(weights), totalArea, underside, volume: 0 };
}

/** 网格投影到水平面的 footprint 面积（收缩凸包，m²） */
export function footprintArea(points: THREE.Vector3[]): number {
  const hull = convexHull2D(points.map(p => [p.x, p.z]));
  return polygonArea(hull);
}

export type Pt2 = [number, number];

/** Andrew 单调链二维凸包 */
export function convexHull2D(pts: Pt2[]): Pt2[] {
  if (pts.length <= 1) return pts.slice();
  const sorted = pts.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: Pt2, a: Pt2, b: Pt2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt2[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

export function polygonArea(hull: Pt2[]): number {
  let s = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) * 0.5;
}

/** 点是否在凸包内（含边界），按 x-z 平面 */
export function pointInHull(hull: Pt2[], x: number, z: number): boolean {
  if (hull.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const cr = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cr) < 1e-9) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// SDF 原语（局部单位空间，>0 内部 / <0 外部 的“体内距离”约定）
// 注意：统一用 f>0 表示内部，故返回 -d，d 为常规表面距离

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const dot3 = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 球：内部为正 */
export function sphereSdf(p: ArrayLike<number>, r: number): number {
  return r - Math.hypot(p[0], p[1], p[2]);
}

/**
 * 椭球（半轴 a,b,c）体内场（>0 内部 / =0 表面 / <0 外部）。
 * k0 为归一化椭球方程值，1−k0 在表面为 0、符号全域严格正确，
 * 是 CSG 与 Surface Nets 所需的全部性质（无需真实欧氏距离）。
 */
export function ellipsoidSdf(p: ArrayLike<number>, a: number, b: number, c: number): number {
  const nx = p[0] / a, ny = p[1] / b, nz = p[2] / c;
  const k0 = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (k0 < 1e-6) return 1; // 中心奇点
  return 1 - k0;
}

/** 无限长圆柱隧道（沿轴 axis，过点 center），内部为正；从主体中减去它即形成通孔 */
export function cylinderSdf(p: ArrayLike<number>, center: ArrayLike<number>,
                            axis: ArrayLike<number>, radius: number): number {
  const dx = p[0] - center[0], dy = p[1] - center[1], dz = p[2] - center[2];
  const ad = dx * axis[0] + dy * axis[1] + dz * axis[2];
  const px = dx - axis[0] * ad, py = dy - axis[1] * ad, pz = dz - axis[2] * ad;
  return radius - Math.hypot(px, py, pz);
}

/**
 * 有界隧道场：仅在孔半径内为正（挖孔），孔外平滑衰减到 0（绝不影响主体）。
 * 用 smoothstep 把作用域限制在 radius*1.15 以内，避免无界圆柱吃掉整石。
 */
export function boundedTunnel(p: ArrayLike<number>, center: ArrayLike<number>,
                              axis: ArrayLike<number>, radius: number): number {
  const dx = p[0] - center[0], dy = p[1] - center[1], dz = p[2] - center[2];
  const ad = dx * axis[0] + dy * axis[1] + dz * axis[2];
  const px = dx - axis[0] * ad, py = dy - axis[1] * ad, pz = dz - axis[2] * ad;
  const radial = Math.hypot(px, py, pz);
  const band = radius * 0.12;
  // radial < radius 内部为正（挖空），radius~radius+band 快速过渡到 0
  const t = clampFn((radius + band - radial) / band, 0, 1);
  const w = t * t * (3 - 2 * t);
  return (radius - radial) * w;
}

const clampFn = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/**
 * 光滑并集（体内距离版，约定 >0 内部）。
 * 常规 SDF（外部为正）用 smooth-min；本项目约定相反，故等价于 smooth-max：
 * 内部深处场值大的一方主导，绝不会因为另一个场在该点为负而把实体挖空。
 */
export function smoothUnion(d1: number, d2: number, k: number): number {
  // smooth-max（体内为正约定）。d1≫d2 时 h→0、结果→d1；d2≫d1 时 h→1、结果→d2
  const h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0, 1);
  return d1 + (d2 - d1) * h - k * h * (1 - h);
}

/**
 * 差集：主体 d1 减去 d2 占据的区域。
 * 体内距离约定（>0 内部）：主体内且在 d2 内部时应判为外部，
 * 故取 min(d1, -d2)——d2 内部为正 → -d2 为负 → 结果为负（被挖空）。
 */
export function subtract(d1: number, d2: number): number {
  return Math.min(d1, -d2);
}

/** 单位化向量 */
export function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

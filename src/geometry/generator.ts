// 程序化石料生成：
//  - 太湖石：椭球 SDF + 圆柱隧道（真通孔）+ fbm 溶蚀，Surface Nets 提面
//  - 黄石：二十面体 + 平面折叠变形（方折块面），flat shading
//  - 英石：拉长二十面体 + 脊状褶皱（皱感、尖棱），smooth shading
import * as THREE from 'three';
import { Rng, uuid } from '../core/rng';
import { HoleInfo, StoneDef, StoneSpecies } from '../core/types';
import { ValueNoise3D } from './noise';
import { extractSurfaceNets } from './surfaceNets';
import { boundedTunnel, ellipsoidSdf, norm3, smoothUnion, sphereSdf, subtract } from './sdf';

const GRID_N = 32; // Surface Nets 采样密度

interface Tunnel {
  center: [number, number, number];
  axis: [number, number, number];
  radius: number;
}
interface Blob { center: [number, number, number]; radius: number; }

/** 太湖石 SDF 场（单位空间，>0 内部） */
class TaihuField {
  private noise: ValueNoise3D;
  private blobs: Blob[] = [];
  private tunnels: Tunnel[] = [];
  private radii: [number, number, number];
  private noiseAmp: number;

  constructor(rng: Rng, noise: ValueNoise3D) {
    this.noise = noise;
    this.radii = [rng.range(0.78, 1.0), rng.range(0.7, 0.95), rng.range(0.78, 1.0)];
    this.noiseAmp = rng.range(0.08, 0.14);

    const blobCount = rng.int(1, 3);
    for (let i = 0; i < blobCount; i++) {
      const dir = rng.unitVector();
      const d = rng.range(0.25, 0.55);
      this.blobs.push({
        center: [dir[0] * d, dir[1] * d * 0.8, dir[2] * d],
        radius: rng.range(0.35, 0.55)
      });
    }

    // 通孔隧道：轴以水平为主、偶有竖直。半径控制在截面短轴的 12~22%，
    // 既保证穿透又不会因孔道过粗把主体临界场值整体翻转成外部
    const tunnelCount = rng.int(2, 5);
    const maxR = this.radii[1] * 0.22;
    for (let i = 0; i < tunnelCount; i++) {
      let axis: [number, number, number];
      const roll = rng.next();
      if (roll < 0.45) axis = norm3(1, rng.range(-0.15, 0.15), rng.range(-0.25, 0.25));
      else if (roll < 0.8) axis = norm3(rng.range(-0.25, 0.25), rng.range(-0.15, 0.15), 1);
      else axis = norm3(rng.range(-0.15, 0.15), 1, rng.range(-0.15, 0.15));
      const center: [number, number, number] = [
        rng.range(-0.18, 0.18), rng.range(-0.18, 0.18), rng.range(-0.18, 0.18)
      ];
      const radius = rng.range(0.1, Math.max(0.12, maxR));
      this.tunnels.push({ center, axis, radius });
    }
  }

  get tunnelData(): Tunnel[] { return this.tunnels; }
  get ellipsoidRadii(): [number, number, number] { return this.radii; }

  field(x: number, y: number, z: number): number {
    let d = ellipsoidSdf([x, y, z], this.radii[0], this.radii[1], this.radii[2]);
    for (const b of this.blobs) {
      d = smoothUnion(d, sphereSdf([x - b.center[0], y - b.center[1], z - b.center[2]], b.radius), 0.25);
    }
    // 溶蚀起伏
    const n = this.noise.fbm(x * 2.2 + 11.3, y * 2.2 + 5.7, z * 2.2 + 7.1, 4);
    d += (n - 0.5) * 2 * this.noiseAmp;
    // 减去有界隧道 → 穿透孔洞。boundedTunnel 在孔外严格归零，
    // 这里只在其为正（孔半径内）时做差集，主体表面形态不受过渡带侵蚀。
    for (const t of this.tunnels) {
      const tf = boundedTunnel([x, y, z], t.center, t.axis, t.radius);
      if (tf > 0) d = subtract(d, tf);
    }
    return d;
  }
}

/** 网格几何量：有向体积与重心（坐标数组，三角形） */
function meshVolumeAndCentroid(pos: Float32Array | number[]): { volume: number; centroid: THREE.Vector3 } {
  let vol = 0;
  const cx = [0, 0, 0];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 9) {
    a.set(pos[i], pos[i + 1], pos[i + 2]);
    b.set(pos[i + 3], pos[i + 4], pos[i + 5]);
    c.set(pos[i + 6], pos[i + 7], pos[i + 8]);
    const signed = a.dot(b.clone().cross(c)) / 6;
    vol += signed;
    const ix = (a.x + b.x + c.x) / 4, iy = (a.y + b.y + c.y) / 4, iz = (a.z + b.z + c.z) / 4;
    cx[0] += signed * ix; cx[1] += signed * iy; cx[2] += signed * iz;
  }
  const v = Math.abs(vol);
  return { volume: v, centroid: new THREE.Vector3(cx[0] / (vol || 1), cx[1] / (vol || 1), cx[2] / (vol || 1)) };
}

function buildTaihu(rng: Rng, size: [number, number, number]): { geo: THREE.BufferGeometry; holes: HoleInfo[]; volume: number } {
  const noise = new ValueNoise3D(rng);
  const field = new TaihuField(rng, noise);
  const extracted = extractSurfaceNets(field, GRID_N);

  // 单位空间 → 物理尺寸（半边长 1 → size/2）
  const sx = size[0] / 2, sy = size[1] / 2, sz = size[2] / 2;
  const pos = extracted.positions;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] *= sx; pos[i + 1] *= sy; pos[i + 2] *= sz;
  }
  const { volume, centroid } = meshVolumeAndCentroid(pos);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] -= centroid.x; pos[i + 1] -= centroid.y; pos[i + 2] -= centroid.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(extracted.normals, 3));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  // 孔道元数据：用椭球在轴向上的弦长估计孔长
  const holes: HoleInfo[] = field.tunnelData.map((t, i) => {
    const ax = t.axis;
    // 解 sum((o+ax*s)/r)^2=1
    const A = (ax[0] / field.ellipsoidRadii[0]) ** 2
            + (ax[1] / field.ellipsoidRadii[1]) ** 2
            + (ax[2] / field.ellipsoidRadii[2]) ** 2;
    const B = 2 * ((t.center[0] * ax[0]) / field.ellipsoidRadii[0] ** 2
                 + (t.center[1] * ax[1]) / field.ellipsoidRadii[1] ** 2
                 + (t.center[2] * ax[2]) / field.ellipsoidRadii[2] ** 2);
    const C = (t.center[0] / field.ellipsoidRadii[0]) ** 2
            + (t.center[1] / field.ellipsoidRadii[1]) ** 2
            + (t.center[2] / field.ellipsoidRadii[2]) ** 2 - 1;
    const disc = Math.max(0, B * B - 4 * A * C);
    const s = Math.sqrt(disc) / (2 * A);
    const lengthLocal = 2 * s;
    const worldAxis = norm3(ax[0] * sx, ax[1] * sy, ax[2] * sz);
    return {
      id: i,
      center: [t.center[0] * sx - centroid.x, t.center[1] * sy - centroid.y, t.center[2] * sz - centroid.z],
      axis: worldAxis,
      radius: t.radius * (sx + sy + sz) / 3,
      length: lengthLocal * Math.hypot(ax[0] * sx, ax[1] * sy, ax[2] * sz)
    };
  });

  return { geo, holes, volume };
}

/** 黄石/英石：二十面体变形（方折 / 脊皱） */
function buildIcosaStone(rng: Rng, species: StoneSpecies,
                         size: [number, number, number]): { geo: THREE.BufferGeometry; volume: number } {
  const detail = species === 'huangshi' ? 3 : 4;
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const noise = new ValueNoise3D(rng);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const fold = species === 'huangshi' ? 3.2 : 5.0; // 折面频率
  const amp = species === 'huangshi' ? rng.range(0.1, 0.16) : rng.range(0.12, 0.2);

  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let r: number;
    if (species === 'huangshi') {
      // 折面频率高的正弦折叠叠加值噪声，制造方折块面
      const n = noise.fbm(v.x * 2 + 3, v.y * 2 + 7, v.z * 2 + 1, 3);
      const planar = 0.06 * (Math.sin(v.x * fold * Math.PI) * Math.sin(v.y * fold * Math.PI)
                + Math.sin(v.z * fold * Math.PI) * Math.sin(v.x * fold * Math.PI));
      r = 1 + amp * (n - 0.5) * 2 + planar;
    } else {
      const ridge = noise.ridged(v.x * 3 + 2, v.y * 3 + 9, v.z * 3 + 5, 4);
      r = 1 + amp * (ridge - 0.4) + 0.05 * Math.sin(v.y * 9);
    }
    p.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }

  // 物理尺寸：黄石矮阔方折，英石瘦高
  const sx = size[0] / 2, sy = size[1] / 2, sz = size[2] / 2;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * sx, p.getY(i) * sy, p.getZ(i) * sz);
  }
  // 黄石转非索引 + 平面法线（棱角块面）；英石保留平滑法线
  if (species === 'huangshi') {
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    if (nonIndexed !== geo) geo.dispose();
    nonIndexed.computeVertexNormals();
    const np = nonIndexed.attributes.position as THREE.BufferAttribute;
    const { centroid } = meshVolumeAndCentroid(np.array as Float32Array);
    for (let i = 0; i < np.count; i++) np.setXYZ(i, np.getX(i) - centroid.x, np.getY(i) - centroid.y, np.getZ(i) - centroid.z);
    nonIndexed.computeBoundingBox();
    nonIndexed.computeBoundingSphere();
    const vol = computeGeoVolume(nonIndexed);
    return { geo: nonIndexed, volume: vol };
  } else {
    geo.computeVertexNormals();
    const { centroid } = meshVolumeAndCentroid(p.array as Float32Array);
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) - centroid.x, p.getY(i) - centroid.y, p.getZ(i) - centroid.z);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return { geo, volume: computeGeoVolume(geo) };
  }
}

function computeGeoVolume(geo: THREE.BufferGeometry): number {
  const np = geo.attributes.position as THREE.BufferAttribute;
  return meshVolumeAndCentroid(np.array as Float32Array).volume;
}

export interface GeneratedStone {
  def: StoneDef;
  geo: THREE.BufferGeometry;
}

const ORIGINS: Record<StoneSpecies, string[]> = {
  taihu: ['苏州西山', '宜兴张渚', '湖州长兴', '太湖洞庭山'],
  huangshi: ['常熟虞山', '苏州尧峰山', '镇江圖山', '常州孟河'],
  yingshi: ['广东英德', '英德望埠镇', '清远英山']
};
const YARDS = ['A区-01', 'A区-02', 'B区-03', 'B区-07', 'C区-11', 'C区-15', 'D区-04', 'D区-09'];

/** 生成单块石头（定义 + 网格） */
export function generateStone(species: StoneSpecies, index: number,
                               densityKnm3: number, seedInput?: number): GeneratedStone {
  const seed = seedInput ?? (1000 + index * 37 + species.length * 131);
  const rng = new Rng(seed);

  let size: [number, number, number];
  if (species === 'taihu') {
    size = [rng.range(0.9, 1.6), rng.range(0.8, 1.5), rng.range(0.9, 1.6)];
  } else if (species === 'huangshi') {
    size = [rng.range(1.0, 1.8), rng.range(0.6, 1.1), rng.range(0.9, 1.6)];
  } else {
    size = [rng.range(0.5, 0.9), rng.range(1.4, 2.4), rng.range(0.5, 0.9)];
  }

  let geo: THREE.BufferGeometry;
  let holes: HoleInfo[] = [];
  let volume: number;
  if (species === 'taihu') {
    const r = buildTaihu(rng, size);
    geo = r.geo; holes = r.holes; volume = r.volume;
  } else {
    const r = buildIcosaStone(rng, species, size);
    geo = r.geo; volume = r.volume;
  }

  const weight = volume * densityKnm3; // kN
  const prefix = species === 'taihu' ? 'TH' : species === 'huangshi' ? 'HS' : 'YS';
  const def: StoneDef = {
    id: uuid(),
    code: `${prefix}-${String(index).padStart(3, '0')}`,
    species,
    seed,
    resolution: species === 'taihu' ? GRID_N : (species === 'huangshi' ? 3 : 4),
    size,
    holes,
    volume,
    weight,
    massTon: weight / 9.81,
    origin: ORIGINS[species][rng.int(0, ORIGINS[species].length - 1)],
    yard: YARDS[rng.int(0, YARDS.length - 1)],
    createdAt: Date.now()
  };
  return { def, geo };
}

/** 按 StoneDef 确定性重建网格（不落库网格数据） */
export function buildGeometry(def: StoneDef): THREE.BufferGeometry {
  const rng = new Rng(def.seed);
  if (def.species === 'taihu') {
    return buildTaihu(rng, def.size).geo;
  }
  return buildIcosaStone(rng, def.species, def.size).geo;
}

/** 测试石料库：30 块（太湖 12 / 黄石 10 / 英石 8），太湖均带通孔 */
export function buildTestLibrary(density: Record<StoneSpecies, number>): GeneratedStone[] {
  const out: GeneratedStone[] = [];
  const plan: [StoneSpecies, number][] = [
    ['taihu', 12], ['huangshi', 10], ['yingshi', 8]
  ];
  let globalIdx = 1;
  for (const [species, count] of plan) {
    for (let i = 1; i <= count; i++) {
      out.push(generateStone(species, globalIdx++, density[species]));
    }
  }
  return out;
}

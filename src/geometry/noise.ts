// 种子化 3D 值噪声 / fbm / 脊状噪声，全部确定性可复算
import { Rng } from '../core/rng';

export class ValueNoise3D {
  private perm: Uint8Array;

  constructor(rng: Rng) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates 洗牌
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private hash3(ix: number, iy: number, iz: number): number {
    return this.perm[(this.perm[(this.perm[ix & 255] + iy) & 255] + iz) & 255] / 255;
  }

  private static smooth(t: number): number { return t * t * (3 - 2 * t); }

  /** 返回 [0,1] */
  noise(x: number, y: number, z: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const u = ValueNoise3D.smooth(fx), v = ValueNoise3D.smooth(fy), w = ValueNoise3D.smooth(fz);
    const h = this.hash3.bind(this);
    const c000 = h(ix, iy, iz),     c100 = h(ix + 1, iy, iz);
    const c010 = h(ix, iy + 1, iz), c110 = h(ix + 1, iy + 1, iz);
    const c001 = h(ix, iy, iz + 1), c101 = h(ix + 1, iy, iz + 1);
    const c011 = h(ix, iy + 1, iz + 1), c111 = h(ix + 1, iy + 1, iz + 1);
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  }

  /** 分形布朗运动，输出约 [0,1] */
  fbm(x: number, y: number, z: number, octaves = 4): number {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm;
  }

  /** 脊状噪声，输出 [0,1]，尖棱用（英石褶皱） */
  ridged(x: number, y: number, z: number, octaves = 4): number {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(2 * this.noise(x * freq, y * freq, z * freq) - 1);
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2.05;
    }
    return sum / norm;
  }
}

// 确定性伪随机（mulberry32）+ 种子字符串哈希，保证同 seed 网格可复算
// 注意：不允许在程序化生成中使用 Math.random，否则离线参考对不上

export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }

  next(): number {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }

  /** 单位球内均匀方向 */
  unitVector(): [number, number, number] {
    const z = this.range(-1, 1);
    const t = this.range(0, Math.PI * 2);
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * Math.cos(t), z, r * Math.sin(t)];
  }
}

export function uuid(): string {
  // 全局 crypto 随机，仅用于业务 id（不参与几何生成）
  return (crypto as Crypto).randomUUID();
}

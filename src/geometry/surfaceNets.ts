// Surface Nets 等值面提取：无需 MC 查找表，输出封闭流形网格
// 约定 field(p) > 0 为内部，field = 0 为表面，采样域为 [-1,1]^3

export interface ExtractedMesh {
  positions: Float32Array;   // 三角形顶点，非索引
  normals: Float32Array;
  /** 局部单位坐标下的有向体积（绕序正确时为正） */
  signedVolume: number;
}

interface Field3D {
  field(x: number, y: number, z: number): number;
}

export function extractSurfaceNets(field: Field3D, n: number): ExtractedMesh {
  const size = n + 1;
  const idx = (i: number, j: number, k: number) => i + size * (j + size * k);
  const values = new Float32Array(size * size * size);
  const step = 2 / n;

  for (let k = 0; k <= n; k++) {
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        values[idx(i, j, k)] = field.field(-1 + i * step, -1 + j * step, -1 + k * step);
      }
    }
  }

  // 每个跨界格子一个顶点（格心附近的边交点均值）
  const cellV = new Int32Array(n * n * n); // -1 = 无顶点，否则顶点序号+1
  cellV.fill(-1);
  const positions: number[] = [];

  const cellIdx = (i: number, j: number, k: number) => i + n * (j + n * k);
  const at = (i: number, j: number, k: number) => values[idx(i, j, k)];

  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v0 = at(i, j, k);
        // 快速排除：8 角同号
        const v1 = at(i + 1, j, k), v3 = at(i, j + 1, k), v4 = at(i, j, k + 1);
        const v2 = at(i + 1, j + 1, k), v5 = at(i + 1, j, k + 1);
        const v7 = at(i, j + 1, k + 1), v6 = at(i + 1, j + 1, k + 1);
        const min = Math.min(v0, v1, v2, v3, v4, v5, v6, v7);
        const max = Math.max(v0, v1, v2, v3, v4, v5, v6, v7);
        if (min >= 0 || max <= 0) continue;

        let sx = 0, sy = 0, sz = 0, cnt = 0;
        // 12 条边，跨界则线性插值取交点
        const corners: [number, number, number][] = [
          [i, j, k], [i + 1, j, k], [i + 1, j + 1, k], [i, j + 1, k],
          [i, j, k + 1], [i + 1, j, k + 1], [i + 1, j + 1, k + 1], [i, j + 1, k + 1]
        ];
        const edges: [number, number][] = [
          [0, 1], [1, 2], [2, 3], [3, 0],
          [4, 5], [5, 6], [6, 7], [7, 4],
          [0, 4], [1, 5], [2, 6], [3, 7]
        ];
        // 边交点累计
        for (const [a, b] of edges) {
          const [ai, aj, ak] = corners[a];
          const [bi, bj, bk] = corners[b];
          const fa = at(ai, aj, ak), fb = at(bi, bj, bk);
          if ((fa > 0) === (fb > 0)) continue;
          const t = fa / (fa - fb);
          sx += (ai + (bi - ai) * t) * step - 1;
          sy += (aj + (bj - aj) * t) * step - 1;
          sz += (ak + (bk - ak) * t) * step - 1;
          cnt++;
        }
        if (cnt === 0) continue;
        positions.push(sx / cnt, sy / cnt, sz / cnt);
        cellV[cellIdx(i, j, k)] = positions.length / 3 - 1;
      }
    }
  }

  // 沿三条正方向轴边连接四邻格，输出四边形（拆两个三角形）
  // 约定 field>0 内部。四边形先按固定环绕生成，再按边端点符号决定是否翻转，保证朝外。
  const tris: number[] = [];
  const v = (i: number, j: number, k: number) =>
    (i >= 0 && j >= 0 && k >= 0 && i < n && j < n && k < n) ? cellV[cellIdx(i, j, k)] : -1;

  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (!flip) tris.push(a, b, c, a, c, d);
    else tris.push(a, d, c, a, c, b);
  };

  // x 方向格边：邻格在 (y,z) 的 (j-1/j)×(k-1/k)
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const f0 = at(i, j, k);
        if (f0 === at(i + 1, j, k)) continue;
        const flip = f0 < 0; // 内部在 +x 侧则翻转
        quad(v(i, j, k - 1), v(i, j, k), v(i, j - 1, k), v(i, j - 1, k - 1), flip);
      }
    }
  }
  // y 方向格边：邻格在 (x,z) 的 (i-1/i)×(k-1/k)
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const f0 = at(i, j, k);
        if (f0 === at(i, j + 1, k)) continue;
        const flip = f0 < 0;
        quad(v(i - 1, j, k - 1), v(i - 1, j, k), v(i, j, k), v(i, j, k - 1), flip);
      }
    }
  }
  // z 方向格边：邻格在 (x,y) 的 (i-1/i)×(j-1/j)
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const f0 = at(i, j, k);
        if (f0 === at(i, j, k + 1)) continue;
        const flip = f0 < 0;
        quad(v(i - 1, j - 1, k), v(i, j - 1, k), v(i, j, k), v(i - 1, j, k), flip);
      }
    }
  }

  // 展开为非索引顶点
  const outPos = new Float32Array(tris.length * 3);
  for (let t = 0; t < tris.length; t++) {
    const vi = tris[t] * 3;
    outPos[t * 3] = positions[vi];
    outPos[t * 3 + 1] = positions[vi + 1];
    outPos[t * 3 + 2] = positions[vi + 2];
  }

  // 法线：SDF 中心差分梯度
  const normals = new Float32Array(outPos.length);
  const e = step * 0.6;
  for (let t = 0; t < outPos.length; t += 3) {
    const x = outPos[t], y = outPos[t + 1], z = outPos[t + 2];
    let gx = field.field(x + e, y, z) - field.field(x - e, y, z);
    let gy = field.field(x, y + e, z) - field.field(x, y - e, z);
    let gz = field.field(x, y, z + e) - field.field(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    gx /= l; gy /= l; gz /= l;
    normals[t] = gx; normals[t + 1] = gy; normals[t + 2] = gz;
  }

  // 有向体积（散度定理），并按符号统一朝外绕序
  let signedVolume = 0;
  for (let t = 0; t < outPos.length; t += 9) {
    const ax = outPos[t], ay = outPos[t + 1], az = outPos[t + 2];
    const bx = outPos[t + 3], by = outPos[t + 4], bz = outPos[t + 5];
    const cx = outPos[t + 6], cy = outPos[t + 7], cz = outPos[t + 8];
    signedVolume += (ax * (by * cz - bz * cy)
                   - ay * (bx * cz - bz * cx)
                   + az * (bx * cy - by * cx)) / 6;
  }
  if (signedVolume < 0) {
    // 翻转绕序与法线
    for (let t = 0; t < outPos.length; t += 9) {
      for (let q = 0; q < 3; q++) {
        const a = t + q * 3, b = t + (2 - q) * 3;
        for (let c = 0; c < 3; c++) {
          const tp = outPos[a + c]; outPos[a + c] = outPos[b + c]; outPos[b + c] = tp;
          const tn = normals[a + c]; normals[a + c] = normals[b + c]; normals[b + c] = tn;
        }
      }
    }
    signedVolume = -signedVolume;
  }

  return { positions: outPos, normals, signedVolume };
}

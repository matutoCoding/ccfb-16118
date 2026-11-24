// 全局类型定义

export type StoneSpecies = 'taihu' | 'huangshi' | 'yingshi';

export const SPECIES_NAME: Record<StoneSpecies, string> = {
  taihu: '太湖石',
  huangshi: '黄石',
  yingshi: '英石'
};

/** 叠石手法（《园冶》传统叠山八法） */
export type Technique = 'an' | 'lian' | 'jie' | 'dou' | 'kua' | 'pin' | 'xuan' | 'jian';

export const TECHNIQUE_NAME: Record<Technique, string> = {
  an: '安', lian: '连', jie: '接', dou: '斗',
  kua: '挎', pin: '拼', xuan: '悬', jian: '剑'
};

/** 程序化生成时记录的通孔信息（本地网格空间，单位米） */
export interface HoleInfo {
  id: number;
  center: [number, number, number];
  axis: [number, number, number];   // 归一化孔轴方向
  radius: number;                   // 等效孔口半径
  length: number;                   // 孔道长度
}

/** 石料库中的一块石头定义 */
export interface StoneDef {
  id: string;                       // uuid
  code: string;                     // 编号，如 TH-007
  species: StoneSpecies;
  seed: number;
  /** 程序化网格参数，网格本身不入库（按 seed 确定性重建），库体积小 */
  resolution: number;
  size: [number, number, number];   // 外包尺寸 xyz（米）
  holes: HoleInfo[];
  volume: number;                   // 网格体积 m³（含孔洞扣减）
  weight: number;                   // 重量 kN
  massTon: number;                  // 吨
  origin: string;                   // 产地
  yard: string;                     // 堆场位置
  createdAt: number;
}

/** 设计方案中一块已落位的石头 */
export interface Placement {
  id: string;                       // placement uuid
  stoneId: string;
  /** 落位变换：位置（石头局部原点的世界坐标）与四元数 */
  position: [number, number, number];
  quaternion: [number, number, number, number];
  technique: Technique;
  order: number;                    // 吊装顺序（1 起）
  /** 校核结果，每次布局变更后重算 */
  check?: StabilityResult;
}

export interface ContactPoint {
  x: number; y: number; z: number;
  area: number;
}

export interface StabilityResult {
  stoneId: string;
  centerOfMass: [number, number, number]; // 世界坐标重心
  supportPolygon: [number, number, number][]; // 支撑接触点凸包（世界坐标）
  supportArea: number;              // m²
  contactArea: number;              // 接触面积 m²
  contactRatio: number;             // 接触面积 / 石头底面积
  insideSupport: boolean;           // 重心投影是否在支撑面内
  eccentricity: number;             // 偏心距 m
  /** 抗倾覆稳定系数 K = 抗倾覆力矩 / 倾覆力矩（绕支撑凸包最不利边） */
  overturnFactor: number;
  status: 'ok' | 'warn' | 'danger';
  isCantilever: boolean;            // 悬挑石
  isCoping: boolean;                // 压顶石（order 最大且重心超出下方支撑外缘）
  warnings: string[];
}

export interface ViewPoint {
  id: string;
  name: string;                     // 观景亭 / 园路A ...
  position: [number, number, number];
  target: [number, number, number];
}

export interface TransparentHole {
  holeId: string;                   // placementId#holeIdx
  stoneCode: string;
  viewName: string;
  /** 透光类型：看到天 / 看到水 */
  sees: 'sky' | 'water';
}

export type WeatherMode = 'clear' | 'overcast' | 'dusk';

export interface LightingConfig {
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  hour: number;                     // 6~18
  weather: WeatherMode;
  waterLevel: number;               // 水面标高 m
  waterEnabled: boolean;
}

export interface ProjectDoc {
  id: string;
  name: string;
  updatedAt: number;
  placements: Placement[];
  viewpoints: ViewPoint[];
  lighting: LightingConfig;
  transparentHoles: TransparentHole[];
  notes: string;
}

export interface AppSettings {
  density: Record<StoneSpecies, number>;  // 容重 kN/m³
  minContactRatio: number;                 // 接触面积比下限，低于则标黄
  safeOverturnFactor: number;              // 抗倾覆安全系数下限（压顶石强制校核）
  gtaoRadius: number;                      // AO 采样半径（米）
  gtaoSamples: number;                     // 每像素螺旋采样数
  gtaoHalfRes: boolean;
  temporalFrames: number;                  // 时域累积帧数上限
  techniqueWarnRatio: number;              // 单一手法占比超过该值提醒
}

export const DEFAULT_SETTINGS: AppSettings = {
  density: { taihu: 25.0, huangshi: 26.5, yingshi: 25.5 },
  minContactRatio: 0.08,
  safeOverturnFactor: 1.5,
  gtaoRadius: 1.2,
  gtaoSamples: 16,
  gtaoHalfRes: true,
  temporalFrames: 24,
  techniqueWarnRatio: 0.4
};

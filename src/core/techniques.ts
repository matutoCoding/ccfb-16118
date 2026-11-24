// 传统叠山八法说明（《园冶》《假山掇山》工艺语义）
import { Technique, TECHNIQUE_NAME } from './types';

interface TechniqueMeta {
  name: string;
  desc: string;
  scene: string;
}

export const TECHNIQUES: Record<Technique, TechniqueMeta> = {
  an:  { name: TECHNIQUE_NAME.an,  desc: '安：置石安稳落于基座，求平衡端正，多用于底层脚石', scene: '基座、脚石' },
  lian: { name: TECHNIQUE_NAME.lian, desc: '连：左右石头水平连缀成势，石纹与气相贯', scene: '山体横向延展' },
  jie: { name: TECHNIQUE_NAME.jie, desc: '接：上下竖向接石，错缝搭接避免通缝', scene: '层间垒砌' },
  dou: { name: TECHNIQUE_NAME.dou, desc: '斗：两石相斗成洞拱，顶石受挤压成拱券', scene: '洞顶、拱券' },
  kua: { name: TECHNIQUE_NAME.kua, desc: '挎：侧石斜挎如挎物，重心内收靠主石夹持', scene: '山腰侧挂' },
  pin: { name: TECHNIQUE_NAME.pin, desc: '拼：小块拼合成大体型，以拼缝模拟整石皴纹', scene: '补形、凑体' },
  xuan: { name: TECHNIQUE_NAME.xuan, desc: '悬：横向挑出之悬石，后压必须重于前挑，需铁件拉结', scene: '悬挑、飞梁' },
  jian: { name: TECHNIQUE_NAME.jian, desc: '剑：竖向尖立如剑，石身瘦挺，底脚收窄须深埋', scene: '峰石、立峰' }
};

// 光影预览页面：GTAO 开关与参数、季节/时刻/天气、水面、视点透光孔、AO 离线校验
import * as THREE from 'three';
import { store } from '../../core/store';
import { LightingConfig, WeatherMode } from '../../core/types';
import { clear, fmt, h, toast } from '../dom';
import { ViewportHost } from '../../render/viewportHost';
import { analyzeTransparency, applyViewpoint } from '../../render/transparency';
import { RayTraceScene, validateAo, AoProbe } from '../../render/referenceAo';

const SEASONS: [LightingConfig['season'], string][] = [
  ['spring', '春'], ['summer', '夏'], ['autumn', '秋'], ['winter', '冬']
];
const WEATHERS: [WeatherMode, string][] = [
  ['clear', '晴天'], ['overcast', '阴天'], ['dusk', '晨昏']
];

export class PreviewPage {
  private root: HTMLElement;
  private host!: ViewportHost;
  private unsub: () => void;
  private fpsEl!: HTMLElement;
  private resultEl!: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
    this.unsub = store.subscribe(this.onStore);
  }

  private build() {
    clear(this.root);
    const viewport = h('div', { class: 'viewport' });
    this.fpsEl = h('div', { class: 'fps' }, '-- fps');
    viewport.append(this.fpsEl);

    const right = h('div', { class: 'side-panel right page-col' }, this.panel());
    this.root.append(viewport, right);
    this.host = new ViewportHost(viewport);
    this.host.syncAll();
    this.host.onFps = fps => { this.fpsEl.textContent = `${fps} fps`; };
  }

  private panel() {
    const wrap = h('div', {});
    const cfg = store.project.lighting;

    const render = () => {
      clear(wrap);
      wrap.append(
        h('h2', {}, '光影预览'),

        h('h3', {}, '环境光遮蔽 GTAO'),
        h('div', { class: 'row' },
          h('label', {}, '启用 AO'),
          h('input', { type: 'checkbox', ...(this.host?.useGtao ? { checked: true } : {}),
            onChange: (e: Event) => {
              this.host.useGtao = (e.target as HTMLInputElement).checked;
              this.host.gtao.resetAccumulation();
            } })
        ),
        h('div', { class: 'row' }, h('label', {}, '采样半径'),
          h('input', { class: 'grow', type: 'range', min: '0.3', max: '2.5', step: '0.1',
            value: String(store.settings.gtaoRadius),
            onChange: (e: Event) => {
              const v = Number((e.target as HTMLInputElement).value);
              void store.saveSettings({ gtaoRadius: v }).then(() => this.host.updateGtaoParams());
            } }),
          h('span', { class: 'mono', style: 'width:38px' }, `${fmt(store.settings.gtaoRadius, 1)}m`)
        ),
        h('div', { class: 'row' }, h('label', {}, '切片采样'),
          h('input', { class: 'grow', type: 'range', min: '8', max: '16', step: '1',
            value: String(store.settings.gtaoSamples),
            onChange: (e: Event) => {
              const v = Number((e.target as HTMLInputElement).value);
              void store.saveSettings({ gtaoSamples: v }).then(() => this.host.updateGtaoParams());
            } }),
          h('span', { class: 'mono', style: 'width:38px' }, String(store.settings.gtaoSamples))
        ),
        h('div', { class: 'muted' }, '弯曲法线驱动天光遮挡，时域累积降噪，洞内按地平角层层衰减并含多反弹补光'),
        h('button', { class: 'primary mt8', onClick: () => this.runAoValidation() },
          '运行 AO 离线校验（逐点射线参考）'),

        h('h3', {}, '太阳与天气'),
        h('div', { class: 'toolbar' }, ...SEASONS.map(([s, label]) =>
          h('button', { class: cfg.season === s ? 'primary' : '',
            onClick: () => this.patchLighting({ season: s }) }, label))),
        h('div', { class: 'row mt8' }, h('label', {}, '时刻'),
          h('input', { class: 'grow', type: 'range', min: '6', max: '18', step: '0.5',
            value: String(cfg.hour),
            onInput: (e: Event) => this.patchLighting({ hour: Number((e.target as HTMLInputElement).value) }) }),
          h('span', { class: 'mono', style: 'width:48px' }, `${fmt(cfg.hour, 1)}时`)
        ),
        h('div', { class: 'toolbar mt8' }, ...WEATHERS.map(([w, label]) =>
          h('button', { class: cfg.weather === w ? 'primary' : '',
            onClick: () => this.patchLighting({ weather: w }) }, label))),

        h('h3', {}, '水面倒影'),
        h('div', { class: 'row' }, h('label', {}, '启用'),
          h('input', { type: 'checkbox', ...(cfg.waterEnabled ? { checked: true } : {}),
            onChange: (e: Event) => this.patchLighting({ waterEnabled: (e.target as HTMLInputElement).checked }) })),
        h('div', { class: 'row' }, h('label', {}, '水面标高'),
          h('input', { class: 'grow', type: 'range', min: '-0.5', max: '1.5', step: '0.05',
            value: String(cfg.waterLevel),
            onInput: (e: Event) => this.patchLighting({ waterLevel: Number((e.target as HTMLInputElement).value) }) }),
          h('span', { class: 'mono', style: 'width:48px' }, `${fmt(cfg.waterLevel, 2)}m`)
        ),

        h('h3', {}, '观景视点'),
        h('div', { class: 'toolbar' }, ...store.project.viewpoints.map(v =>
          h('button', { onClick: () => { applyViewpoint(this.host.sm.camera, v); this.host.gtao.resetAccumulation(); } }, v.name))),

        h('h3', {}, '透光孔分析'),
        h('button', { onClick: () => this.runTransparency() }, '统计各视点透光孔'),
        this.resultEl = h('div', { class: 'mt8' })
      );
    };
    this._render = render;
    render();
    return wrap;
  }
  private _render: () => void = () => {};

  private patchLighting(patch: Partial<LightingConfig>) {
    Object.assign(store.project.lighting, patch);
    void store.persistProject();
    this.host.sm.applyLighting(store.project.lighting);
    this.host.gtao.resetAccumulation();
    this._render();
  }

  private runTransparency() {
    const defs = new Map(store.stones.map(s => [s.id, s]));
    const r = analyzeTransparency(store.project, defs, this.host.sm.bodies);
    store.project.transparentHoles = r.holes;
    void store.persistProject();
    clear(this.resultEl);
    const totalSky = r.holes.filter(x => x.sees === 'sky').length;
    const totalWater = r.holes.filter(x => x.sees === 'water').length;
    this.resultEl.append(
      h('div', { class: 'ok-box' },
        `共识别透光孔 ${r.holes.length} 处（见天 ${totalSky}，见水 ${totalWater}），已写入方案说明`),
      h('table', { class: 'mt8' },
        h('thead', {}, h('tr', {}, h('th', {}, '视点'), h('th', {}, '见天'), h('th', {}, '见水'), h('th', {}, '合计'))),
        h('tbody', {}, ...r.perView.map(v => h('tr', {},
          h('td', {}, v.viewName), h('td', { class: 'mono' }, String(v.sky)),
          h('td', { class: 'mono' }, String(v.water)), h('td', { class: 'mono' }, String(v.total)))))
      )
    );
    toast('透光孔统计完成并写入方案', 'ok');
  }

  /** AO 校验：在石头表面取探针，分别跑 CPU-GTAO 与逐点射线参考 */
  private async runAoValidation() {
    toast('正在离线射线采样，约需数秒…', 'info');
    await new Promise(r => setTimeout(r, 30));
    const radius = store.settings.gtaoRadius;
    const rtScene = new RayTraceScene();
    for (const body of this.host.sm.bodies.values()) {
      rtScene.addMesh(this.host.sm.geometryFor(body.def), body.matrix);
    }
    if (this.host.sm.bodies.size === 0) { toast('场景中没有石头', 'err'); return; }

    // 每个 body 取 6 个表面探针（确定性种子）
    const probes: AoProbe[] = [];
    let seedBase = 1234;
    for (const body of this.host.sm.bodies.values()) {
      const geo = this.host.sm.geometryFor(body.def);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const nor = geo.attributes.normal as THREE.BufferAttribute;
      const step = Math.max(1, Math.floor(pos.count / 6));
      for (let i = 0; i < pos.count && probes.length < 40; i += step) {
        const lp = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(body.matrix);
        const ln = new THREE.Vector3().fromBufferAttribute(nor, i).transformDirection(body.matrix).normalize();
        const ref = rtScene.referenceAo(lp, ln, radius, 96, seedBase++);
        const gtao = rtScene.gtaoAtProbe(lp, ln, radius);
        probes.push({ point: lp, normal: ln, reference: ref, gtao });
      }
    }
    const report = validateAo(probes, 96);
    this.showAoReport(report);
  }

  private showAoReport(r: ReturnType<typeof validateAo>) {
    const box = h('div', { class: r.pass5Percent ? 'ok-box' : 'warn-box' },
      h('div', { style: 'font-weight:700' },
        r.pass5Percent ? '✓ 平均误差 < 5%，AO 结果可信' : '平均误差 ≥ 5%，建议增大采样数/半径'),
      h('div', { class: 'mt8' },
        `探针 ${r.probes} 个 · 每探针 96 条余弦加权射线`),
      h('div', { class: 'mono mt8' },
        `参考均值 ${fmt(r.meanReference, 4)}  GTAO均值 ${fmt(r.meanGtao, 4)}`),
      h('div', { class: 'mono' },
        `平均绝对误差 ${fmt(r.meanError * 100, 2)}%  最大误差 ${fmt(r.maxError * 100, 2)}%`),
      h('div', { class: 'validate-meter mt8' },
        h('div', { style: `width:${Math.min(100, r.meanError * 100 * 10)}%` }))
    );
    this.resultEl.prepend(box);
    toast(r.pass5Percent ? 'AO 校验通过' : 'AO 误差超标', r.pass5Percent ? 'ok' : 'err');
  }

  private onStore = () => {
    this.host.syncAll();
    this._render();
  };

  dispose() {
    this.unsub();
    this.host.dispose();
  }
}

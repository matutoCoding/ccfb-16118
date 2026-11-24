// 施工交底页面：吊装顺序编号、吊点位置、落位坐标、交底单导出、分步截图
import * as THREE from 'three';
import { store } from '../../core/store';
import { SPECIES_NAME, TECHNIQUE_NAME, TransparentHole } from '../../core/types';
import { clear, download, fmt, h, toast } from '../dom';
import { ViewportHost } from '../../render/viewportHost';
import { analyzeTransparency } from '../../render/transparency';

interface BriefRow {
  order: number;
  code: string;
  species: string;
  weight: number;
  liftPoint: [number, number, number];
  landing: [number, number, number];
  technique: string;
  holes: number;
}

export class BriefingPage {
  private root: HTMLElement;
  private host!: ViewportHost;
  private unsub: () => void;
  private rows: BriefRow[] = [];
  private screenshots: { order: number; url: string }[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
    this.unsub = store.subscribe(this.onStore);
  }

  private build() {
    clear(this.root);
    const viewport = h('div', { class: 'viewport' });
    this.root.append(viewport);
    // 先建三维宿主（computeRows 依赖 host.sm.bodies），再建右侧面板
    this.host = new ViewportHost(viewport);
    this.host.syncAll();
    const right = h('div', { class: 'side-panel right page-col' }, this.panel());
    this.root.append(right);
  }

  /** 吊点取石头局部最高点（世界坐标），落位坐标取局部原点世界坐标 */
  private computeRows() {
    this.rows = [...store.project.placements]
      .sort((a, b) => a.order - b.order)
      .map(p => {
        const def = store.getStone(p.stoneId);
        if (!def) return null;
        const body = this.host.sm.bodies.get(p.id);
        const lift: [number, number, number] = [0, 0, 0];
        if (body) {
          const top = new THREE.Vector3(0, def.size[1] / 2, 0).applyMatrix4(body.matrix);
          lift[0] = top.x; lift[1] = top.y + 0.15; lift[2] = top.z;
        }
        return {
          order: p.order,
          code: def.code,
          species: SPECIES_NAME[def.species],
          weight: def.weight,
          liftPoint: lift,
          landing: p.position,
          technique: TECHNIQUE_NAME[p.technique],
          holes: def.holes.length
        };
      })
      .filter((r): r is BriefRow => r !== null);
  }

  private panel() {
    const wrap = h('div', {});
    const render = () => {
      clear(wrap);
      this.computeRows();
      const rowEls = this.rows.map(r => h('tr', {
        class: 'clickable',
        onClick: () => this.focusOrder(r.order)
      },
        h('td', { class: 'mono' }, String(r.order)),
        h('td', { class: 'mono' }, r.code),
        h('td', {}, r.species),
        h('td', { class: 'mono' }, fmt(r.weight, 1)),
        h('td', { class: 'mono', style: 'font-size:10.5px' }, r.liftPoint.map(v => fmt(v)).join(',')),
        h('td', { class: 'mono', style: 'font-size:10.5px' }, r.landing.map(v => fmt(v)).join(',')),
        h('td', {}, r.technique)
      ));
      wrap.append(
        h('h2', {}, '施工交底'),
        h('div', { class: 'muted' }, '吊装顺序按自下而上自动编号；吊点为各石最高点上方 15cm，落位坐标为石头定位原点'),
        h('div', { class: 'toolbar mt8' },
          h('button', { class: 'primary', onClick: () => this.exportDoc() }, '导出交底单'),
          h('button', { onClick: () => this.captureSteps() }, '分步截图'),
        ),
        h('div', { class: 'scroll mt8' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', {}, '序'), h('th', {}, '编号'), h('th', {}, '石种'),
            h('th', {}, '重量kN'), h('th', {}, '吊点 x,y,z'), h('th', {}, '落位 x,y,z'), h('th', {}, '手法'))),
          h('tbody', {}, ...rowEls)
        )),
        h('h3', {}, '方案说明（含透光孔统计）'),
        h('div', { class: 'doc-preview' }, this.buildDocText(true))
      );
    };
    this._render = render;
    render();
    return wrap;
  }
  private _render: () => void = () => {};

  private focusOrder(order: number) {
    const p = store.project.placements.find(x => x.order === order);
    if (!p) return;
    const body = this.host.sm.bodies.get(p.id);
    if (body) this.host.orbit.target.set(...p.position);
    // 只显示到当前序的石头（吊装进度预览）
    for (const [id, mesh] of this.host.sm.rockMeshes) {
      const pl = this.host.sm.bodies.get(id)!.placement;
      mesh.visible = pl.order <= order;
    }
    this.host.gtao.resetAccumulation();
  }

  private transparencySummary(): TransparentHole[] {
    const defs = new Map(store.stones.map(s => [s.id, s]));
    return analyzeTransparency(store.project, defs, this.host.sm.bodies).holes;
  }

  private buildDocText(preview: boolean): string {
    const proj = store.project;
    const lines: string[] = [];
    lines.push(`假山叠石施工交底单`);
    lines.push(`方案名称：${proj.name}    生成时间：${new Date().toLocaleString('zh-CN')}`);
    lines.push('=' .repeat(56));
    lines.push(`一、吊装顺序与落位（共 ${this.rows.length} 块，总重 ${fmt(this.rows.reduce((s, r) => s + r.weight, 0), 1)} kN）`);
    for (const r of this.rows) {
      lines.push(
        `${String(r.order).padStart(2, '0')} ${r.code}（${r.species} ${fmt(r.weight, 1)}kN）` +
        ` 吊点(${r.liftPoint.map(v => fmt(v)).join(',')})` +
        ` 落位(${r.landing.map(v => fmt(v)).join(',')}) 手法:${r.technique}` +
        (r.holes ? ` 通孔${r.holes}个` : '')
      );
    }
    lines.push('');
    lines.push('二、稳定要求');
    for (const p of proj.placements) {
      const c = p.check;
      if (!c) continue;
      const code = store.getStone(p.stoneId)?.code;
      lines.push(`#${p.order} ${code}: K=${fmt(c.overturnFactor)} 接触比${fmt(c.contactRatio * 100, 1)}% ` +
        (c.status === 'danger' ? '【危险，禁止吊装就位】' : c.status === 'warn' ? '【需铁件/砂浆垫层】' : '【合格】'));
      for (const w of c.warnings) lines.push(`   · ${w}`);
    }
    lines.push('');
    lines.push('三、透光孔（观景效果验收依据）');
    const holes = this.transparencySummary();
    if (holes.length === 0) {
      lines.push('当前视点未识别到透光孔。');
    } else {
      for (const v of proj.viewpoints) {
        const list = holes.filter(x => x.viewName === v.name);
        const sky = list.filter(x => x.sees === 'sky').length;
        const water = list.filter(x => x.sees === 'water').length;
        lines.push(`${v.name}：透光孔 ${list.length} 个（透天 ${sky} / 透水 ${water}）`);
      }
    }
    lines.push('');
    lines.push('四、安全注意');
    lines.push('1. 悬挑石（悬/挎法）须先装扁担石或扒钉，砂浆垫层强度不低于 C20；');
    lines.push('2. 压顶石抗倾覆系数须 ≥ ' + store.settings.safeOverturnFactor + '，就位后禁止单侧堆载；');
    lines.push('3. 吊车作业半径内站人严禁，落位以本单坐标 ±2cm 控制。');
    if (preview) lines.push('');
    return lines.join('\n');
  }

  private exportDoc() {
    download(`${store.project.name}-施工交底单.txt`, '﻿' + this.buildDocText(false), 'text/plain;charset=utf-8');
    toast('交底单已导出', 'ok');
  }

  /** 分步截图：逐序显示石头并截图，打包为 PNG 下载（逐张） */
  private async captureSteps() {
    if (this.rows.length === 0) { toast('没有可截图的布置', 'err'); return; }
    toast('开始逐步骤屏，请勿切换页面…', 'info');
    this.screenshots = [];
    for (const r of this.rows) {
      this.focusOrder(r.order);
      await new Promise(res => setTimeout(res, 180)); // 等时域累积若干帧
      const url = this.host.screenshot();
      this.screenshots.push({ order: r.order, url });
      download(`步骤${String(r.order).padStart(2, '0')}-${r.code}.png`,
        await (await fetch(url)).blob());
    }
    // 恢复全部显示
    for (const mesh of this.host.sm.rockMeshes.values()) mesh.visible = true;
    toast(`已导出 ${this.screenshots.length} 张分步截图`, 'ok', 3500);
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

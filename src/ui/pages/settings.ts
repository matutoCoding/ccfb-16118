// 设置页面：石料容重、校核限值、GTAO 参数、方案与数据管理
import * as db from '../../core/db';
import { store } from '../../core/store';
import { StoneSpecies, SPECIES_NAME } from '../../core/types';
import { buildTestLibrary } from '../../geometry/generator';
import { clear, download, fmt, h, toast } from '../dom';

export class SettingsPage {
  private root: HTMLElement;
  private unsub: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.unsub = store.subscribe(this.render);
    this.render();
  }

  private render = () => {
    clear(this.root);
    const s = store.settings;
    const page = h('div', { class: 'full-page page-col' },
      h('h2', {}, '系统设置'),

      h('h3', {}, '石料容重（kN/m³，重量 G = γ·V）'),
      h('div', { class: 'card', style: 'max-width:640px' },
        ...(Object.keys(s.density) as StoneSpecies[]).map(sp =>
          h('div', { class: 'row' },
            h('label', {}, SPECIES_NAME[sp]),
            h('input', { class: 'grow', type: 'number', step: '0.1', value: String(s.density[sp]),
              onChange: (e: Event) => {
                const v = Number((e.target as HTMLInputElement).value);
                void store.saveSettings({ density: { ...s.density, [sp]: v } });
              } }),
            h('span', { class: 'muted' }, '常用 24~27')
          ))
      ),

      h('h3', {}, '稳定校核限值'),
      h('div', { class: 'card', style: 'max-width:640px' },
        h('div', { class: 'row' },
          h('label', {}, '最小接触比'),
          h('input', { class: 'grow', type: 'range', min: '0.03', max: '0.2', step: '0.01',
            value: String(s.minContactRatio),
            onChange: (e: Event) => void store.saveSettings({
              minContactRatio: Number((e.target as HTMLInputElement).value)
            }) }),
          h('span', { class: 'mono', style: 'width:52px' }, `${fmt(s.minContactRatio * 100, 0)}%`)
        ),
        h('div', { class: 'row' },
          h('label', {}, '抗倾覆 K'),
          h('input', { class: 'grow', type: 'range', min: '1.2', max: '2.5', step: '0.1',
            value: String(s.safeOverturnFactor),
            onChange: (e: Event) => void store.saveSettings({
              safeOverturnFactor: Number((e.target as HTMLInputElement).value)
            }) }),
          h('span', { class: 'mono', style: 'width:52px' }, fmt(s.safeOverturnFactor, 1))
        ),
        h('div', { class: 'row' },
          h('label', {}, '手法提醒占比'),
          h('input', { class: 'grow', type: 'range', min: '0.25', max: '0.7', step: '0.05',
            value: String(s.techniqueWarnRatio),
            onChange: (e: Event) => void store.saveSettings({
              techniqueWarnRatio: Number((e.target as HTMLInputElement).value)
            }) }),
          h('span', { class: 'mono', style: 'width:52px' }, `${fmt(s.techniqueWarnRatio * 100, 0)}%`)
        )
      ),

      h('h3', {}, 'GTAO 光影参数'),
      h('div', { class: 'card', style: 'max-width:640px' },
        h('div', { class: 'row' },
          h('label', {}, '采样半径'),
          h('input', { class: 'grow', type: 'range', min: '0.3', max: '2.5', step: '0.1',
            value: String(s.gtaoRadius),
            onChange: (e: Event) => void store.saveSettings({
              gtaoRadius: Number((e.target as HTMLInputElement).value)
            }) }),
          h('span', { class: 'mono', style: 'width:52px' }, `${fmt(s.gtaoRadius, 1)}m`)
        ),
        h('div', { class: 'row' },
          h('label', {}, '切片采样数'),
          h('input', { class: 'grow', type: 'range', min: '8', max: '16', step: '1',
            value: String(s.gtaoSamples),
            onChange: (e: Event) => void store.saveSettings({
              gtaoSamples: Number((e.target as HTMLInputElement).value)
            }) }),
          h('span', { class: 'mono', style: 'width:52px' }, String(s.gtaoSamples))
        ),
        h('div', { class: 'row' },
          h('label', {}, '时域帧数'),
          h('input', { class: 'grow', type: 'range', min: '8', max: '48', step: '2',
            value: String(s.temporalFrames),
            onChange: (e: Event) => void store.saveSettings({
              temporalFrames: Number((e.target as HTMLInputElement).value)
            }) }),
          h('span', { class: 'mono', style: 'width:52px' }, String(s.temporalFrames))
        ),
        h('div', { class: 'row' },
          h('label', {}, '半分辨率 AO'),
          h('input', { type: 'checkbox', ...(s.gtaoHalfRes ? { checked: true } : {}),
            onChange: (e: Event) => void store.saveSettings({
              gtaoHalfRes: (e.target as HTMLInputElement).checked
            }) })
        )
      ),

      h('h3', {}, '方案与数据'),
      h('div', { class: 'card', style: 'max-width:640px' },
        h('div', { class: 'muted' },
          `当前方案：${store.project.name} · 用石 ${store.project.placements.length} 块 · 石料库 ${store.stones.length} 块`),
        h('div', { class: 'toolbar mt8' },
          h('button', { onClick: () => this.exportProject() }, '导出方案 JSON'),
          h('button', { onClick: () => this.regenerateLibrary() }, '重建测试石料库（30块）'),
          h('button', { class: 'danger', onClick: () => this.clearAll() }, '清空全部数据')
        )
      ),

      h('h3', {}, '性能指标自检'),
      h('div', { class: 'card muted', style: 'max-width:640px;line-height:1.9' },
        h('div', {}, '· 30 块石头场景：各三维页面右上角实时显示 FPS，目标稳定 60 帧'),
        h('div', {}, '· AO 可信度：光影预览页一键运行离线逐点射线参考，平均误差目标 < 5%'),
        h('div', {}, '· 稳定计算：稳定校核页列出重心/支撑面/抗倾覆 K 的完整计算口径，可与手算对照'),
        h('div', {}, '· 全部数据存于浏览器 IndexedDB（库名 rockery-studio-db），网格按种子确定性重建不入库')
      )
    );
    this.root.append(page);
  };

  private exportProject() {
    download(`${store.project.name}.json`, JSON.stringify(store.project, null, 2), 'application/json');
    toast('方案 JSON 已导出', 'ok');
  }

  private async regenerateLibrary() {
    if (!confirm('将清空现有石料库并重新生成 30 块测试石料，布置方案也会清空，确认？')) return;
    const all = await db.getAllStones();
    for (const st of all) await db.deleteStone(st.id);
    const lib = buildTestLibrary(store.settings.density);
    await store.addStones(lib.map(g => g.def));
    await store.newProject();
    toast('测试石料库已重建', 'ok');
  }

  private async clearAll() {
    if (!confirm('清空 IndexedDB 中全部石料与方案？此操作不可恢复。')) return;
    indexedDB.deleteDatabase('rockery-studio-db');
    location.reload();
  }

  dispose() {
    this.unsub();
  }
}

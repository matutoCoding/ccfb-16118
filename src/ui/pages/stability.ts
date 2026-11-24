// 稳定校核页面：逐块重心/支撑面/抗倾覆系数、压顶石专项、手算对照
import { store } from '../../core/store';
import { SPECIES_NAME, TECHNIQUE_NAME } from '../../core/types';
import { clear, fmt, h } from '../dom';
import { ViewportHost } from '../../render/viewportHost';
import { dangerCount, warnCount } from '../../physics/recompute';

export class StabilityPage {
  private root: HTMLElement;
  private host!: ViewportHost;
  private unsub: () => void;
  private fpsEl!: HTMLElement;

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
    this.host.sm.showCheckHelpers(true);
    this.host.onFps = fps => { this.fpsEl.textContent = `${fps} fps`; };
  }

  private panel() {
    const wrap = h('div', {});
    const render = () => {
      clear(wrap);
      const ps = store.project.placements;
      const d = dangerCount(ps), w = warnCount(ps);
      const ordered = [...ps].sort((a, b) => a.order - b.order);
      const top = ordered[ordered.length - 1];
      const warningNodes: HTMLElement[] = [];
      for (const p of ordered) {
        for (const msg of (p.check ? p.check.warnings : [])) {
          const cls = msg.includes('倾覆') || msg.includes('不足') ? 'danger-box' : 'warn-box';
          const code = store.getStone(p.stoneId)?.code;
          warningNodes.push(h('div', { class: cls }, `#${p.order} ${code}：${msg}`));
        }
      }

      wrap.append(
        h('h2', {}, '稳定校核'),
        h('div', { class: d ? 'danger-box' : w ? 'warn-box' : 'ok-box' },
          d ? `${d} 块存在倾覆危险（红标），${w} 块需注意`
            : w ? `${w} 块需注意（黄标），其余满足安全限值`
            : ps.length ? '全部石头满足稳定与安全系数要求' : '尚未布置石头'),
        h('div', { class: 'muted mt8' },
          `判定限值：接触面积比 ≥ ${fmt(store.settings.minContactRatio * 100, 0)}%，抗倾覆 K ≥ ${store.settings.safeOverturnFactor}`),

        h('h3', {}, '压顶石专项'),
        top?.check ? this.copingCard(top) : h('div', { class: 'muted' }, '无压顶石'),

        h('h3', {}, '逐块校核（自下而上）'),
        h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', {}, '序'), h('th', {}, '编号'), h('th', {}, '状态'),
            h('th', {}, '接触比'), h('th', {}, 'K'), h('th', {}, '重心y'))),
          h('tbody', {}, ...ordered.map(p => h('tr', {
            class: 'clickable',
            onClick: () => this.focusStone(p.id)
          },
            h('td', { class: 'mono' }, String(p.order)),
            h('td', { class: 'mono' }, store.getStone(p.stoneId)?.code ?? ''),
            h('td', {}, h('span', { class: `badge ${p.check?.status ?? 'warn'}` },
              p.check?.status === 'ok' ? '稳' : p.check?.status === 'warn' ? '警' : '险')),
            h('td', { class: 'mono' }, p.check ? `${fmt(p.check.contactRatio * 100, 1)}%` : '—'),
            h('td', { class: 'mono' }, p.check ? fmt(p.check.overturnFactor) : '—'),
            h('td', { class: 'mono' }, p.check ? fmt(p.check.centerOfMass[1]) : '—')
          )))
        )),

        h('h3', {}, '手算对照（计算书口径）'),
        this.handCalcNote(),
        h('h3', {}, '告警明细')
      );
      wrap.append(...warningNodes);
    };
    this._render = render;
    render();
    return wrap;
  }
  private _render: () => void = () => {};

  private copingCard(p: (typeof store.project.placements)[number]) {
    const c = p.check!;
    return h('div', { class: 'card' },
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, '石料编号'), h('span', { class: 'mono' }, store.getStone(p.stoneId)?.code ?? '—'),
        h('span', { class: 'k' }, '重量 G'), h('span', { class: 'mono' }, `${fmt(store.getStone(p.stoneId)?.weight ?? 0, 1)} kN`),
        h('span', { class: 'k' }, '抗倾覆 K'), h('span', {
          class: 'mono',
          style: `color:${c.overturnFactor >= store.settings.safeOverturnFactor ? 'var(--ok)' : 'var(--danger)'}`
        }, fmt(c.overturnFactor)),
        h('span', { class: 'k' }, '是否悬挑'), h('span', {}, c.isCantilever ? '是（需铁件/垫层）' : '否'),
        h('span', { class: 'k' }, '结论'), h('span', {},
          c.overturnFactor >= store.settings.safeOverturnFactor ? '满足压顶抗倾覆要求' : '不满足，须压脚或拉结')
      )
    );
  }

  private handCalcNote() {
    return h('div', { class: 'card muted', style: 'line-height:1.8' },
      h('div', {}, '系统计算口径，可与手算逐项核对：'),
      h('div', { class: 'mono mt8', style: 'font-size:11.5px' },
        '① 重心 C：网格有向体积加权（散度定理），随落位变换到世界坐标'),
      h('div', { class: 'mono', style: 'font-size:11.5px' },
        '② 支撑面：接触点（竖向容差 3cm）在水平面投影的凸包'),
      h('div', { class: 'mono', style: 'font-size:11.5px' },
        '③ 抗倾覆 K = (d稳 + d倾) / (d稳 − d倾)，绕支撑凸包最不利边取最小值'),
      h('div', { class: 'mono', style: 'font-size:11.5px' },
        '   其中 d稳 = 重心到边的内侧水平距，d倾 = 边到对侧凸包点距离'),
      h('div', { class: 'mono', style: 'font-size:11.5px' },
        '④ 重量 G = γ·V，容重在设置页可调（太湖 25 / 黄石 26.5 / 英石 25.5 kN/m³）'),
      h('div', { class: 'mono', style: 'font-size:11.5px' },
        '⑤ 压顶石限值取 K ≥ 1.5（可在设置页修改）')
    );
  }

  private focusStone(id: string) {
    const body = this.host.sm.bodies.get(id);
    if (!body) return;
    const p = body.placement;
    this.host.orbit.target.set(p.position[0], p.position[1], p.position[2]);
    this.host.gtao.resetAccumulation();
  }

  private onStore = () => {
    this.host.syncAll();
    this.host.sm.showCheckHelpers(true);
    this._render();
  };

  dispose() {
    this.unsub();
    this.host.dispose();
  }
}

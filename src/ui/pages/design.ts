// 叠石设计页面：石料选择 → 拖放落位（自动贴附/防穿插）→ 手法标签 → 实时校核提示
import { store } from '../../core/store';
import { SPECIES_NAME, Technique, TECHNIQUE_NAME } from '../../core/types';
import { TECHNIQUES } from '../../core/techniques';
import { clear, fmt, h, toast } from '../dom';
import { ViewportHost } from '../../render/viewportHost';
import { PlacementEditor } from '../../render/editor';

const TECH_LIST: Technique[] = ['an', 'lian', 'jie', 'dou', 'kua', 'pin', 'xuan', 'jian'];

export class DesignPage {
  private root: HTMLElement;
  private host!: ViewportHost;
  private editor!: PlacementEditor;
  private unsub: () => void;
  private statusEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private showHelpers = true;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
    this.unsub = store.subscribe(this.onStore);
  }

  private build() {
    clear(this.root);
    const left = h('div', { class: 'side-panel page-col' },
      h('h2', {}, '石料选择'),
      h('div', { class: 'muted' }, '点击石料后在视口中移动选位，R 键旋转 15°，单击落位，Esc 取消'),
      h('div', { class: 'scroll mt8' }, this.stoneList())
    );

    const viewport = h('div', { class: 'viewport' });
    const hud = h('div', { class: 'overlay-hud' },
      h('div', { class: 'hud-pill' }, '左键旋转视角 · 右键平移 · 滚轮缩放'),
      h('div', { class: 'hud-pill' }, `已布置 ${store.project.placements.length} 块`)
    );
    this.fpsEl = h('div', { class: 'fps' }, '-- fps');
    this.statusEl = h('div', { class: 'status-line' }, '就绪');
    viewport.append(hud, this.fpsEl, this.statusEl);

    const right = h('div', { class: 'side-panel right page-col' }, this.rightPanel());
    this.root.append(left, viewport, right);

    this.host = new ViewportHost(viewport);
    this.host.syncAll();
    this.host.onFps = fps => { this.fpsEl.textContent = `${fps} fps`; };
    this.host.sm.showCheckHelpers(this.showHelpers);
    this.editor = new PlacementEditor(this.host.sm, this.host.orbit);
    this.editor.onStatus = (msg, ok) => {
      this.statusEl.textContent = msg;
      this.statusEl.className = `status-line ${ok ? 'ok' : 'err'}`;
    };
    this.editor.onPlaced = p => {
      store.addPlacement(p);
      toast('落位成功，已自动贴附接触面', 'ok');
    };
    this.host.onPick = id => {
      store.selectedPlacementId = id;
      this.refreshRight();
    };
  }

  private stoneList() {
    return h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, '编号'), h('th', {}, '石种'), h('th', {}, '重量'), h('th', {}, ''))),
      h('tbody', {}, ...store.stones.map(s => h('tr', {},
        h('td', { class: 'mono' }, s.code),
        h('td', {}, h('span', { class: `tag ${s.species}` }, SPECIES_NAME[s.species])),
        h('td', {}, `${fmt(s.massTon, 1)}t`),
        h('td', {}, h('button', {
          onClick: () => {
            this.editor.beginPlace(s);
            this.statusEl.textContent = `正在放置 ${s.code}：移动选位，R 旋转，单击落下`;
            this.statusEl.className = 'status-line ok';
          }
        }, '取用'))
      )))
    );
  }

  private rightPanel() {
    const panel = h('div', {});
    const render = () => {
      clear(panel);
      const stats = store.techniqueStats();
      panel.append(
        h('h2', {}, '选中石料'),
        this.selectedSection(),
        h('div', { class: 'split' }),
        h('h3', {}, '叠石手法'),
        h('div', { class: 'tech-grid' },
          ...TECH_LIST.map(t => h('button', {
            class: `tech-btn ${this.currentTechnique() === t ? 'sel' : ''}`,
            title: TECHNIQUES[t].desc,
            onClick: () => this.applyTechnique(t)
          }, TECHNIQUE_NAME[t]))
        ),
        h('div', { class: 'muted mt8', style: 'line-height:1.7' },
          ...Object.entries(TECHNIQUES).map(([k, v]) =>
            h('div', {}, `${TECHNIQUE_NAME[k as Technique]}：${v.desc}`))
        ),
        h('div', { class: 'split' }),
        h('h3', {}, '手法分布'),
        this.techniqueStatsSection(stats),
        h('div', { class: 'split' }),
        h('div', { class: 'toolbar' },
          h('button', {
            onClick: () => { this.showHelpers = !this.showHelpers; this.host.sm.showCheckHelpers(this.showHelpers); render(); }
          }, this.showHelpers ? '隐藏校核辅助' : '显示校核辅助'),
          h('button', { class: 'danger', onClick: () => this.removeSelected() }, '移除选中')
        )
      );
    };
    this._renderRight = render;
    render();
    return panel;
  }
  private _renderRight: () => void = () => {};
  private refreshRight() { this._renderRight(); }

  private currentTechnique(): Technique | null {
    const p = store.project.placements.find(x => x.id === store.selectedPlacementId);
    return p ? p.technique : null;
  }

  private selectedSection() {
    const p = store.project.placements.find(x => x.id === store.selectedPlacementId);
    if (!p) return h('div', { class: 'muted' }, '在视口中点击一块已布置的石头查看详情');
    const def = store.getStone(p.stoneId);
    const check = p.check;
    return h('div', {},
      h('div', { class: 'card' },
        h('div', { class: 'kv' },
          h('span', { class: 'k' }, '编号'), h('span', { class: 'mono' }, def?.code ?? ''),
          h('span', { class: 'k' }, '吊装序'), h('span', { class: 'mono' }, `#${p.order}`),
          h('span', { class: 'k' }, '落位坐标'), h('span', { class: 'mono' },
            `(${p.position.map(v => fmt(v)).join(', ')})`),
          h('span', { class: 'k' }, '手法'), h('span', {}, TECHNIQUE_NAME[p.technique])
        )
      ),
      h('div', { class: 'toolbar' },
        h('button', { onClick: () => this.rotateSelected(Math.PI / 12) }, '逆时针 15°'),
        h('button', { onClick: () => this.rotateSelected(-Math.PI / 12) }, '顺时针 15°')
      ),
      check ? h('div', { class: 'card' },
        h('div', { class: 'row between' },
          h('span', {}, '校核状态'),
          h('span', { class: `badge ${check.status}` }, check.status === 'ok' ? '稳定' : check.status === 'warn' ? '注意' : '危险')),
        h('div', { class: 'kv mt8' },
          h('span', { class: 'k' }, '接触面积比'), h('span', { class: 'mono' }, `${fmt(check.contactRatio * 100, 1)}%`),
          h('span', { class: 'k' }, '支撑面积'), h('span', { class: 'mono' }, `${fmt(check.supportArea, 3)} m²`),
          h('span', { class: 'k' }, '抗倾覆系数'), h('span', { class: 'mono' }, fmt(check.overturnFactor)),
          h('span', { class: 'k' }, '重心在支撑内'), h('span', {}, check.insideSupport ? '是' : '否')
        ),
        check.contactRatio < store.settings.minContactRatio
          ? h('div', { class: 'warn-box mt8' }, '接触面积过小（黄标）：易应力集中，建议砂浆垫层或换面')
          : h('div', {}),
        ...check.warnings.map(w => h('div', {
          class: w.includes('倾覆') || w.includes('不足') ? 'danger-box' : 'warn-box'
        }, w))
      ) : h('div', {})
    );
  }

  private techniqueStatsSection(stats: ReturnType<typeof store.techniqueStats>) {
    const rows = (Object.keys(stats.counts) as Technique[]).map(t =>
      h('div', { class: 'row between' },
        h('span', {}, TECHNIQUE_NAME[t]),
        h('span', { class: 'mono' }, `${stats.counts[t]} 块`))
    );
    return h('div', {},
      ...rows,
      stats.warn && stats.dominant
        ? h('div', { class: 'warn-box mt8' },
          `“${TECHNIQUE_NAME[stats.dominant]}”占比 ${fmt(stats.ratio * 100, 0)}%，超过 ${fmt(store.settings.techniqueWarnRatio * 100, 0)}%，手法偏呆板，建议穿插其它手法`)
        : h('div', { class: 'ok-box mt8' }, '手法分布均衡，无呆板风险')
    );
  }

  private applyTechnique(t: Technique) {
    if (!store.selectedPlacementId) { toast('请先在视口选中一块石头', 'err'); return; }
    store.setTechnique(store.selectedPlacementId, t);
  }

  private rotateSelected(delta: number) {
    const id = store.selectedPlacementId;
    if (!id) return;
    const body = this.host.sm.bodies.get(id);
    if (!body) return;
    const result = this.editor.rotateSelected(body, delta);
    if (result.penetration > 0.02) {
      toast('旋转后产生穿插，已取消', 'err');
      this.host.syncAll();
      return;
    }
    store.updatePlacement(id, {
      position: result.position,
      quaternion: body.placement.quaternion
    });
  }

  private removeSelected() {
    if (store.selectedPlacementId) store.removePlacement(store.selectedPlacementId);
  }

  private onStore = () => {
    this.host.syncAll();
    this.host.sm.showCheckHelpers(this.showHelpers);
    this.refreshRight();
  };

  dispose() {
    this.unsub();
    this.editor.dispose();
    this.host.dispose();
  }
}

// 石料库页面：按石种/编号管理，小三维预览 + 元数据
import * as THREE from 'three';
import { store } from '../../core/store';
import { SPECIES_NAME, StoneDef, StoneSpecies } from '../../core/types';
import { buildGeometry, generateStone } from '../../geometry/generator';
import { clear, download, fmt, h, toast } from '../dom';

const SPECIES: StoneSpecies[] = ['taihu', 'huangshi', 'yingshi'];

export class LibraryPage {
  private root: HTMLElement;
  private filter: StoneSpecies | 'all' = 'all';
  private preview: THREE.WebGLRenderer | null = null;
  private previewScene = new THREE.Scene();
  private previewCam = new THREE.PerspectiveCamera(45, 1, 0.05, 50);
  private previewMesh: THREE.Mesh | null = null;
  private raf = 0;
  private selected: StoneDef | null = null;
  private unsub: () => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.render();
    this.unsub = store.subscribe(this.render);
  }

  private render = () => {
    clear(this.root);
    const list = store.stones.filter(s => this.filter === 'all' || s.species === this.filter);

    const left = h('div', { class: 'side-panel page-col' },
      h('h2', {}, '石料库'),
      h('div', { class: 'toolbar' },
        ...SPECIES.map(sp => h('button', {
          class: this.filter === sp ? 'primary' : '',
          onClick: () => { this.filter = sp; this.render(); }
        }, SPECIES_NAME[sp])),
        h('button', { onClick: () => { this.filter = 'all'; this.render(); } }, '全部')
      ),
      h('div', { class: 'muted' }, `共 ${list.length} 块，网格按种子确定性重建，不入库`),
      h('div', { class: 'toolbar mt8' },
        h('button', { class: 'primary', onClick: () => this.addOne() }, '补一块'),
        h('button', { onClick: () => this.exportCsv() }, '导出清单 CSV'),
      ),
      h('div', { class: 'scroll mt8' }, this.stoneTable(list))
    );

    const right = h('div', { class: 'side-panel right page-col' }, this.detailPanel());
    this.root.append(left, right);
    this.startPreview();
  };

  private stoneTable(list: StoneDef[]) {
    const rows = list.map(s => h('tr', {
      class: 'clickable',
      onClick: () => { this.selected = s; this.render(); }
    },
      h('td', { class: 'mono' }, s.code),
      h('td', {}, h('span', { class: `tag ${s.species}` }, SPECIES_NAME[s.species])),
      h('td', {}, `${fmt(s.massTon, 1)}t`),
      h('td', {}, s.species === 'taihu' ? `${s.holes.length} 孔` : '—'),
      h('td', {}, s.yard)
    ));
    return h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, '编号'), h('th', {}, '石种'), h('th', {}, '重量'),
        h('th', {}, '孔洞'), h('th', {}, '堆场'))),
      h('tbody', {}, ...rows));
  }

  private detailPanel() {
    const s = this.selected ?? store.stones[0];
    if (!s) return h('div', { class: 'muted' }, '石料库为空，点击“补一块”生成');
    this.selected = s;
    const viewport = h('div', { class: 'viewport mt8', style: 'height:260px;border-radius:8px;overflow:hidden' });
    setTimeout(() => this.mountPreview(viewport, s), 0);

    return h('div', {},
      h('h2', {}, `${s.code} · ${SPECIES_NAME[s.species]}`),
      viewport,
      h('div', { class: 'card mt8' },
        h('div', { class: 'kv' },
          h('span', { class: 'k' }, '种子'), h('span', { class: 'mono' }, String(s.seed)),
          h('span', { class: 'k' }, '外包尺寸'), h('span', { class: 'mono' }, `${s.size.map(v => fmt(v)).join(' × ')} m`),
          h('span', { class: 'k' }, '网格体积'), h('span', { class: 'mono' }, `${fmt(s.volume, 3)} m³`),
          h('span', { class: 'k' }, '重量'), h('span', { class: 'mono' }, `${fmt(s.weight, 1)} kN / ${fmt(s.massTon, 2)} t`),
          h('span', { class: 'k' }, '产地'), h('span', {}, s.origin),
          h('span', { class: 'k' }, '堆场位置'), h('span', {}, s.yard),
          h('span', { class: 'k' }, '通孔数量'), h('span', {}, s.species === 'taihu'
            ? `${s.holes.length} 个（穿透）` : '无'),
        )
      ),
      s.species === 'taihu' ? h('div', { class: 'card' },
        h('h3', {}, '孔道参数'),
        ...s.holes.map(hh => h('div', { class: 'muted mono', style: 'margin:4px 0;font-size:11px' },
          `#${hh.id} 半径${fmt(hh.radius, 2)}m 孔长${fmt(hh.length, 2)}m 轴[${hh.axis.map(v => fmt(v, 2)).join(',')}]`))
      ) : h('div', {}),
      h('div', { class: 'toolbar mt8' },
        h('button', { class: 'danger', onClick: () => this.remove(s) }, '删除该石料')
      )
    );
  }

  private mountPreview(container: HTMLElement, s: StoneDef) {
    if (this.preview) { this.preview.domElement.remove(); this.preview.dispose(); }
    this.preview = new THREE.WebGLRenderer({ antialias: true });
    this.preview.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.preview.setSize(container.clientWidth, container.clientHeight);
    container.append(this.preview.domElement);
    this.previewScene.background = new THREE.Color(0x141a21);
    this.previewCam.aspect = container.clientWidth / container.clientHeight;
    this.previewCam.updateProjectionMatrix();
    if (this.previewMesh) { this.previewScene.remove(this.previewMesh); this.previewMesh.geometry.dispose(); }
    const geo = buildGeometry(s);
    this.previewMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: s.species === 'taihu' ? 0x9aa3a8 : s.species === 'huangshi' ? 0xb08d5f : 0x6f7a72,
      roughness: 0.9
    }));
    this.previewScene.add(new THREE.HemisphereLight(0xcfe4ff, 0x444038, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 2); dir.position.set(3, 5, 4);
    this.previewScene.add(dir);
    this.previewScene.add(this.previewMesh);
    this.previewCam.position.set(2.2, 1.6, 2.6);
    this.previewCam.lookAt(0, 0, 0);
    cancelAnimationFrame(this.raf);
    const spin = () => {
      this.raf = requestAnimationFrame(spin);
      if (this.previewMesh) this.previewMesh.rotation.y += 0.008;
      this.preview?.render(this.previewScene, this.previewCam);
    };
    spin();
  }

  private startPreview() { /* mountPreview 内驱动 */ }

  private async addOne() {
    const sp = SPECIES[Math.floor(Math.random() * 3)];
    const idx = store.stones.filter(s => s.species === sp).length + 1;
    const g = generateStone(sp, Date.now() % 100000, store.settings.density[sp]);
    g.def.code = `${sp === 'taihu' ? 'TH' : sp === 'huangshi' ? 'HS' : 'YS'}-${String(idx).padStart(3, '0')}`;
    await store.addStone(g.def);
    this.selected = g.def;
    toast('已生成新石料', 'ok');
  }

  private async remove(s: StoneDef) {
    await store.removeStone(s.id);
    this.selected = null;
    toast(`已删除 ${s.code}`, 'info');
  }

  private exportCsv() {
    const rows = [['编号', '石种', '重量kN', '吨', '体积m3', '孔数', '产地', '堆场']];
    for (const s of store.stones) {
      rows.push([s.code, SPECIES_NAME[s.species], s.weight.toFixed(1), s.massTon.toFixed(2),
        s.volume.toFixed(3), String(s.holes.length), s.origin, s.yard]);
    }
    download('石料库清单.csv', '﻿' + rows.map(r => r.join(',')).join('\n'), 'text/csv');
  }

  dispose() {
    this.unsub();
    cancelAnimationFrame(this.raf);
    this.preview?.dispose();
  }
}

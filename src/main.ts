import './ui/styles.css';
import { store } from './core/store';
import { buildTestLibrary } from './geometry/generator';
import { h, clear, toast } from './ui/dom';
import { LibraryPage } from './ui/pages/library';
import { DesignPage } from './ui/pages/design';
import { StabilityPage } from './ui/pages/stability';
import { PreviewPage } from './ui/pages/preview';
import { BriefingPage } from './ui/pages/briefing';
import { SettingsPage } from './ui/pages/settings';

type Route = 'library' | 'design' | 'stability' | 'preview' | 'briefing' | 'settings';

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: 'library', label: '石料库', icon: '◈' },
  { route: 'design', label: '叠石设计', icon: '⛰' },
  { route: 'stability', label: '稳定校核', icon: '⚖' },
  { route: 'preview', label: '光影预览', icon: '☀' },
  { route: 'briefing', label: '施工交底', icon: '📋' },
  { route: 'settings', label: '设置', icon: '⚙' }
];

class App {
  private view = document.getElementById('view')!;
  private sidebar = document.getElementById('sidebar')!;
  private route: Route = (location.hash.replace('#/', '') as Route) || 'design';
  private page: { dispose?: () => void } | null = null;

  constructor() {
    window.addEventListener('hashchange', () => {
      this.route = (location.hash.replace('#/', '') as Route) || 'design';
      this.renderNav();
      this.renderPage();
    });
  }

  async start() {
    await store.init();
    if (store.stones.length === 0) {
      const lib = buildTestLibrary(store.settings.density);
      await store.addStones(lib.map(g => g.def));
      toast(`已生成测试石料 ${lib.length} 块（太湖石均带穿透孔洞）`, 'ok', 4000);
    }
    this.renderNav();
    this.renderPage();
  }

  private renderNav() {
    clear(this.sidebar);
    this.sidebar.append(
      h('div', { class: 'brand' }, '叠石匠', h('small', {}, '假山设计与预览系统'))
    );
    for (const n of NAV) {
      this.sidebar.append(h('div', {
        class: `nav-item ${this.route === n.route ? 'active' : ''}`,
        onClick: () => { location.hash = `#/${n.route}`; }
      }, h('span', { class: 'ico' }, n.icon), h('span', {}, n.label)));
    }
    this.sidebar.append(
      h('div', { class: 'sidebar-foot' },
        h('div', {}, `石料 ${store.stones.length} 块`),
        h('div', {}, `用石 ${store.project.placements.length} 块`))
    );
  }

  private renderPage() {
    this.page?.dispose?.();
    clear(this.view);
    const wrap = h('div', { class: 'page' });
    this.view.append(wrap);
    switch (this.route) {
      case 'library': this.page = new LibraryPage(wrap); break;
      case 'design': this.page = new DesignPage(wrap); break;
      case 'stability': this.page = new StabilityPage(wrap); break;
      case 'preview': this.page = new PreviewPage(wrap); break;
      case 'briefing': this.page = new BriefingPage(wrap); break;
      case 'settings': this.page = new SettingsPage(wrap); break;
    }
  }
}

new App().start();

// 共享三维视口宿主：SceneManager + GTAO 管线 + 渲染循环 + 拾取 + FPS
import * as THREE from 'three';
import { SceneManager } from './sceneManager';
import { GtaoPipeline } from './gtao';
import { OrbitController } from './orbit';
import { store } from '../core/store';
import { recomputeAll } from '../physics/recompute';

export class ViewportHost {
  sm: SceneManager;
  orbit: OrbitController;
  gtao: GtaoPipeline;
  private container: HTMLElement;
  private raf = 0;
  private frameCount = 0;
  private fpsTime = performance.now();
  fps = 0;
  onFps: ((fps: number) => void) | null = null;
  onPick: ((placementId: string | null) => void) | null = null;
  useGtao = true;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downPos = { x: 0, y: 0 };
  private ro: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    this.sm = new SceneManager(container);
    this.orbit = new OrbitController(this.sm.camera, this.sm.renderer.domElement);
    this.gtao = new GtaoPipeline(this.sm.renderer, this.sm.scene, this.sm.camera, {
      radius: store.settings.gtaoRadius,
      samples: store.settings.gtaoSamples,
      halfRes: store.settings.gtaoHalfRes,
      temporalFrames: store.settings.temporalFrames
    });
    this.sm.renderer.domElement.addEventListener('pointerdown', e => {
      this.downPos = { x: e.clientX, y: e.clientY };
    });
    this.sm.renderer.domElement.addEventListener('pointerup', e => {
      if (Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 5) return;
      this.pick(e);
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.loop();
  }

  private pick(e: PointerEvent) {
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.sm.camera);
    const hits = this.raycaster.intersectObjects(this.sm.pickables, false);
    this.onPick?.(hits.length ? (hits[0].object.userData.placementId as string) : null);
  }

  /** 全量同步：数据 → 场景 → 校核 → 光照，并把校核结果落库 */
  syncAll() {
    const defs = new Map(store.stones.map(s => [s.id, s]));
    this.sm.syncPlacements(defs, store.project.placements);
    recomputeAll(this.sm.bodies);
    this.sm.applyLighting(store.project.lighting);
    this.gtao.resetAccumulation();
    // 校核结果写回 IndexedDB（不触发 emit，避免与本次同步递归）
    void store.persistProject();
  }

  updateGtaoParams() {
    this.gtao.dispose();
    this.gtao = new GtaoPipeline(this.sm.renderer, this.sm.scene, this.sm.camera, {
      radius: store.settings.gtaoRadius,
      samples: store.settings.gtaoSamples,
      halfRes: store.settings.gtaoHalfRes,
      temporalFrames: store.settings.temporalFrames
    });
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.sm.resize(w, h);
    this.gtao.resize();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    // 水面微动
    const t = performance.now() * 0.001;
    (this.sm.water.material as THREE.MeshStandardMaterial).roughness = 0.12 + 0.05 * Math.sin(t * 0.7);
    this.orbit.update();

    if (this.useGtao) {
      const sunWorld = this.sm.sun.position.clone().normalize();
      this.gtao.setSun(sunWorld, this.sm.skyColor, this.sm.sun.color);
      this.gtao.render();
    } else {
      this.sm.renderer.render(this.sm.scene, this.sm.camera);
    }

    this.frameCount++;
    const now = performance.now();
    if (now - this.fpsTime >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.fpsTime));
      this.frameCount = 0; this.fpsTime = now;
      this.onFps?.(this.fps);
    }
  };

  screenshot(): string {
    return this.sm.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.orbit.dispose();
    this.gtao.dispose();
    this.sm.dispose();
  }
}

// 三维场景管理：几何缓存、布置体构建、日光/天气、水面、拾取与状态着色
import * as THREE from 'three';
import { LightingConfig, Placement, SPECIES_NAME, StoneDef, TECHNIQUE_NAME, WeatherMode } from '../core/types';
import { buildGeometry } from '../geometry/generator';
import { createRockBody, refreshBody, RockBody } from '../physics/solver';

const SPECIES_COLOR: Record<string, number> = {
  taihu: 0x9aa3a8,   // 青灰
  huangshi: 0xb08d5f, // 土黄褐
  yingshi: 0x6f7a72   // 黛青
};

export class SceneManager {
  scene = new THREE.Scene();
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  water: THREE.Mesh;
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private matCache = new Map<string, THREE.MeshStandardMaterial>();
  private rockGroup = new THREE.Group();
  private helperGroup = new THREE.Group();
  rockMeshes = new Map<string, THREE.Mesh>();      // placementId -> mesh
  bodies = new Map<string, RockBody>();
  pickables: THREE.Object3D[] = [];
  private sunTarget = new THREE.Object3D();

  constructor(canvasContainer: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasContainer.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, canvasContainer.clientWidth / canvasContainer.clientHeight, 0.05, 200);
    this.camera.position.set(7, 5, 9);

    this.scene.background = new THREE.Color(0xbfd0dd);
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5a5046, 0.7);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = 12;
    this.sun.shadow.camera.left = -s; this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s; this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.camera.far = 60;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;

    // 地面
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x8a8475, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);

    // 水面（默认在 y=0 以下时不可见感）
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x3f6f8f, roughness: 0.15, metalness: 0.35,
        transparent: true, opacity: 0.78 })
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0;
    this.scene.add(this.water);

    this.scene.add(this.rockGroup, this.helperGroup);
  }

  geometryFor(def: StoneDef): THREE.BufferGeometry {
    let g = this.geoCache.get(def.id);
    if (!g) {
      g = buildGeometry(def);
      this.geoCache.set(def.id, g);
    }
    return g;
  }

  private materialFor(def: StoneDef): THREE.MeshStandardMaterial {
    let m = this.matCache.get(def.species);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: SPECIES_COLOR[def.species],
        roughness: def.species === 'taihu' ? 0.82 : 0.95,
        metalness: 0.02
      });
      this.matCache.set(def.species, m);
    }
    return m;
  }

  syncPlacements(defs: Map<string, StoneDef>, placements: Placement[]) {
    const alive = new Set(placements.map(p => p.id));
    for (const [id, mesh] of this.rockMeshes) {
      if (!alive.has(id)) {
        this.rockGroup.remove(mesh);
        this.rockMeshes.delete(id);
        this.bodies.delete(id);
      }
    }
    for (const p of placements) {
      const def = defs.get(p.stoneId);
      if (!def) continue;
      let mesh = this.rockMeshes.get(p.id);
      if (!mesh) {
        const geo = this.geometryFor(def);
        mesh = new THREE.Mesh(geo, this.materialFor(def));
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData.placementId = p.id;
        mesh.userData.code = def.code;
        mesh.userData.species = SPECIES_NAME[def.species];
        mesh.userData.technique = TECHNIQUE_NAME[p.technique];
        this.rockGroup.add(mesh);
        this.rockMeshes.set(p.id, mesh);
        const body = createRockBody(def, geo, p);
        this.bodies.set(p.id, body);
      }
      mesh.position.set(...p.position);
      mesh.quaternion.set(...p.quaternion);
      const body = this.bodies.get(p.id)!;
      body.placement = p;
      refreshBody(body);
      this.applyStatusColor(p.id, p.check?.status ?? null);
    }
    this.pickables = [...this.rockMeshes.values()];
  }

  private statusColor(status: string | null): THREE.Color | null {
    if (status === 'danger') return new THREE.Color(0xc0392b);
    if (status === 'warn') return new THREE.Color(0xd9a22e);
    return null;
  }

  applyStatusColor(placementId: string, status: string | null) {
    const mesh = this.rockMeshes.get(placementId);
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const c = this.statusColor(status);
    mat.emissive = c ?? new THREE.Color(0x000000);
    mat.emissiveIntensity = c ? 0.45 : 0;
  }

  /** 显示/隐藏校核辅助：支撑凸包线、重心点 */
  showCheckHelpers(visible: boolean) {
    this.helperGroup.clear();
    if (!visible) return;
    for (const [id, body] of this.bodies) {
      const check = body.placement.check;
      if (!check || check.supportPolygon.length < 3) continue;
      const pts = check.supportPolygon.map(p => new THREE.Vector3(p[0], body.placement.position[1] - body.def.size[1] / 2 + 0.02, p[2]));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
        color: check.status === 'danger' ? 0xff3b30 : 0x35e0a0
      }));
      this.helperGroup.add(line);
      const com = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x2266ff }));
      com.position.set(...check.centerOfMass);
      this.helperGroup.add(com);
    }
  }

  // ---------- 光照 ----------
  /** 太阳高度角/方位角：按北纬30°近似模型，hour 6~18 */
  sunDirection(cfg: LightingConfig): THREE.Vector3 {
    const decl: Record<string, number> = { spring: 0, summer: 0.4, autumn: -0.05, winter: -0.4 };
    const dec = decl[cfg.season];
    const dayAngle = ((cfg.hour - 6) / 12) * Math.PI; // 6:00 日出 → 18:00 日落
    const elev = Math.max(0.05, Math.sin(dayAngle) * Math.cos(dec) * 1.1 - 0.15 + Math.sin(dec) * 0.4);
    const az = (cfg.hour - 12) * (Math.PI / 7.5); // 方位随时间
    return new THREE.Vector3(
      Math.sin(az) * Math.cos(elev),
      Math.sin(elev),
      -Math.cos(az) * Math.cos(elev)
    ).normalize();
  }

  applyLighting(cfg: LightingConfig) {
    const dir = this.sunDirection(cfg);
    this.sun.position.copy(dir).multiplyScalar(20);
    this.water.visible = cfg.waterEnabled;
    this.water.position.y = cfg.waterLevel;

    const weather: Record<WeatherMode, { sky: number; sun: number; sunI: number; hemi: number; bg: number }> = {
      clear:    { sky: 0xbfd8f5, sun: 0xfff1d6, sunI: 2.4, hemi: 0.75, bg: 0xbfd0dd },
      overcast: { sky: 0xaeb9c2, sun: 0xd8dde2, sunI: 0.5, hemi: 1.15, bg: 0x9aa6b0 },
      dusk:     { sky: 0xe8a06a, sun: 0xff9d5c, sunI: 1.5, hemi: 0.45, bg: 0xd98f66 }
    };
    const w = weather[cfg.weather];
    this.sun.color.setHex(w.sun);
    this.sun.intensity = w.sunI;
    this.hemi.intensity = w.hemi;
    (this.scene.background as THREE.Color).setHex(w.bg);
  }

  get skyColor(): THREE.Color {
    return new THREE.Color(this.hemi.color);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose() {
    this.renderer.dispose();
    for (const g of this.geoCache.values()) g.dispose();
    for (const m of this.matCache.values()) m.dispose();
    this.renderer.domElement.remove();
  }
}

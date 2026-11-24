// 全局应用状态仓库（轻量发布订阅），跨页面共享
import { AppSettings, DEFAULT_SETTINGS, Placement, ProjectDoc, StoneDef, Technique, ViewPoint } from './types';
import * as db from './db';
import { uuid } from './rng';

type Listener = () => void;

class Store {
  stones: StoneDef[] = [];
  project: ProjectDoc = this.blankProject();
  settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  selectedPlacementId: string | null = null;
  selectedStoneId: string | null = null;
  private listeners = new Set<Listener>();

  private blankProject(): ProjectDoc {
    return {
      id: uuid(),
      name: '未命名假山方案',
      updatedAt: Date.now(),
      placements: [],
      viewpoints: [
        { id: uuid(), name: '观景亭', position: [6, 2.2, 6], target: [0, 1.2, 0] },
        { id: uuid(), name: '园路A', position: [-5.5, 1.6, 3.5], target: [0, 1.0, 0] },
        { id: uuid(), name: '园路B', position: [3.5, 1.6, -5.5], target: [0, 1.0, 0] }
      ],
      lighting: { season: 'summer', hour: 10, weather: 'clear', waterLevel: 0, waterEnabled: true },
      transparentHoles: [],
      notes: ''
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() { for (const fn of this.listeners) fn(); }

  async init() {
    this.settings = await db.loadSettings();
    this.stones = await db.getAllStones();
    const projects = await db.getAllProjects();
    if (projects.length) {
      this.project = projects.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    }
    this.emit();
  }

  // ---- 石料库 ----
  async addStone(def: StoneDef) {
    this.stones.push(def);
    await db.putStone(def);
    this.emit();
  }
  async addStones(defs: StoneDef[]) {
    this.stones.push(...defs);
    await db.putStones(defs);
    this.emit();
  }
  async removeStone(id: string) {
    this.stones = this.stones.filter(s => s.id !== id);
    this.project.placements = this.project.placements.filter(p => p.stoneId !== id);
    await db.deleteStone(id);
    await this.persistProject();
    this.emit();
  }
  getStone(id: string): StoneDef | undefined { return this.stones.find(s => s.id === id); }

  // ---- 方案 ----
  async persistProject() {
    this.project.updatedAt = Date.now();
    await db.putProject(this.project);
  }
  async newProject() {
    await this.persistProject();
    this.project = this.blankProject();
    this.selectedPlacementId = null;
    await db.putProject(this.project);
    this.emit();
  }
  async loadProject(id: string) {
    const all = await db.getAllProjects();
    const p = all.find(x => x.id === id);
    if (p) { this.project = p; this.selectedPlacementId = null; this.emit(); }
  }
  async deleteProject(id: string) {
    await db.deleteProject(id);
    if (this.project.id === id) {
      this.project = this.blankProject();
      this.emit();
    }
  }

  addPlacement(p: Placement) {
    this.project.placements.push(p);
    this.selectedPlacementId = p.id;
    this.renumber();
    void this.persistProject().then(() => this.emit());
  }
  updatePlacement(id: string, patch: Partial<Placement>) {
    const p = this.project.placements.find(x => x.id === id);
    if (!p) return;
    Object.assign(p, patch);
    void this.persistProject().then(() => this.emit());
  }
  removePlacement(id: string) {
    this.project.placements = this.project.placements.filter(p => p.id !== id);
    if (this.selectedPlacementId === id) this.selectedPlacementId = null;
    this.renumber();
    void this.persistProject().then(() => this.emit());
  }
  private renumber() {
    const sorted = [...this.project.placements].sort((a, b) => a.position[1] - b.position[1] || a.order - b.order);
    sorted.forEach((p, i) => { p.order = i + 1; });
  }
  setTechnique(id: string, t: Technique) {
    this.updatePlacement(id, { technique: t });
  }

  addViewPoint(v: ViewPoint) {
    this.project.viewpoints.push(v);
    void this.persistProject().then(() => this.emit());
  }
  removeViewPoint(id: string) {
    this.project.viewpoints = this.project.viewpoints.filter(v => v.id !== id);
    void this.persistProject().then(() => this.emit());
  }

  async saveSettings(patch: Partial<AppSettings>) {
    this.settings = { ...this.settings, ...patch };
    await db.saveSettings(this.settings);
    this.emit();
  }

  /** 手法占比统计与呆板提醒 */
  techniqueStats(): { counts: Record<Technique, number>; total: number; dominant: Technique | null; ratio: number; warn: boolean } {
    const counts = { an: 0, lian: 0, jie: 0, dou: 0, kua: 0, pin: 0, xuan: 0, jian: 0 } as Record<Technique, number>;
    for (const p of this.project.placements) counts[p.technique]++;
    const total = this.project.placements.length;
    let dominant: Technique | null = null;
    let max = 0;
    (Object.keys(counts) as Technique[]).forEach(k => {
      if (counts[k] > max) { max = counts[k]; dominant = k; }
    });
    const ratio = total ? max / total : 0;
    return { counts, total, dominant, ratio, warn: total >= 5 && ratio > this.settings.techniqueWarnRatio };
  }
}

export const store = new Store();

// 叠石编辑：候选石 ghost 预览、水平面拖拽、R 键旋转、落位吸附/穿插校验
import * as THREE from 'three';
import { Placement, StoneDef, Technique } from '../core/types';
import { uuid } from '../core/rng';
import { SceneManager } from './sceneManager';
import { OrbitController } from './orbit';
import { createRockBody, measurePenetration, RockBody, solveSnap } from '../physics/solver';

export class PlacementEditor {
  private sm: SceneManager;
  private orbit: OrbitController;
  private ghost: THREE.Mesh | null = null;
  private ghostBody: RockBody | null = null;
  private ghostDef: StoneDef | null = null;
  private yaw = 0;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private dragging = false;
  private locked = false;
  onPlaced: ((p: Placement) => void) | null = null;
  onStatus: ((msg: string, ok: boolean) => void) | null = null;

  constructor(sm: SceneManager, orbit: OrbitController) {
    this.sm = sm; this.orbit = orbit;
    const dom = sm.renderer.domElement;
    dom.addEventListener('pointerdown', this.handleDown);
    dom.addEventListener('pointermove', this.handleMove);
    window.addEventListener('pointerup', this.handleUp);
    window.addEventListener('keydown', this.handleKey);
  }

  /** 从石料库“拿”一块石头进入放置模式 */
  beginPlace(def: StoneDef) {
    this.cancelPlace();
    this.locked = false;
    const geo = this.sm.geometryFor(def);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7fb8ff, transparent: true, opacity: 0.55, roughness: 0.6
    });
    this.ghost = new THREE.Mesh(geo, mat);
    this.ghost.castShadow = false;
    this.sm.scene.add(this.ghost);
    this.ghostDef = def;
    this.yaw = 0;
    const placement: Placement = {
      id: uuid(), stoneId: def.id,
      position: [0, 2, 0], quaternion: [0, 0, 0, 1],
      technique: 'an', order: 0
    };
    this.ghostBody = createRockBody(def, geo, placement);
    this.orbit.enabled = false;
    // 立即在原点吸附一次，避免未移动就落位时停在初始高度
    this.updateGhost(0, 0);
    this.onStatus?.('移动鼠标选位，R 旋转，单击落位，Esc 取消', true);
  }

  cancelPlace() {
    if (this.ghost) {
      this.sm.scene.remove(this.ghost);
      (this.ghost.material as THREE.Material).dispose();
      this.ghost = null;
    }
    this.ghostBody = null; this.ghostDef = null;
    this.dragging = false;
    this.orbit.enabled = true;
  }

  get placing(): boolean { return this.ghost !== null; }

  private setPointer(e: PointerEvent) {
    const rect = this.sm.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private groundPoint(e: PointerEvent): THREE.Vector3 | null {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.sm.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? hit : null;
  }

  private handleDown = (e: PointerEvent) => {
    if (!this.ghost || e.button !== 0) return;
    this.dragging = true;
  };

  private handleMove = (e: PointerEvent) => {
    if (!this.ghost || !this.ghostBody || !this.ghostDef) return;
    const gp = this.groundPoint(e);
    if (!gp) return;
    this.updateGhost(gp.x, gp.z);
  };

  private updateGhost(x: number, z: number) {
    if (!this.ghostBody || !this.ghost || !this.ghostDef) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0));
    const bodies = [...this.sm.bodies.values()];
    const result = solveSnap(bodies, this.ghostBody, [x, z], q);
    this.ghost.position.set(...result.position);
    this.ghost.quaternion.copy(q);
    const mat = this.ghost.material as THREE.MeshStandardMaterial;
    if (result.penetration > 0.02) {
      mat.color.setHex(0xff5a4d);
      this.onStatus?.(`穿插量 ${(result.penetration * 100).toFixed(1)}cm 过大，该位置放不下`, false);
    } else if (result.supportIds.length === 0 && result.position[1] <= 0.01) {
      mat.color.setHex(0x7fb8ff);
      this.onStatus?.('落在地面，单击确认', true);
    } else {
      mat.color.setHex(0x67d39a);
      this.onStatus?.(`已贴附支撑，单击落位（残留穿插 ${(result.penetration * 100).toFixed(1)}cm）`, true);
    }
  }

  private handleUp = (e: PointerEvent) => {
    if (!this.ghost || !this.ghostBody || !this.ghostDef) return;
    const wasDragging = this.dragging;
    this.dragging = false;
    if (e.button !== 0) return;
    // 守卫：一个 ghost 只允许落位一次，防止重复事件造成连放
    if (this.locked) return;
    this.locked = true;
    void wasDragging;
    // 区分：放置模式下 pointerup 即尝试落位（拖拽中也允许）
    const result = measurePenetration([...this.sm.bodies.values()], this.ghostBody);
    if (result > 0.02) {
      this.locked = false; // 允许移动后重试
      this.onStatus?.('存在穿插，无法落位，请换位置', false);
      return;
    }
    const p: Placement = {
      id: this.ghostBody.placement.id,
      stoneId: this.ghostDef.id,
      position: [...this.ghostBody.placement.position] as [number, number, number],
      quaternion: [this.ghostBody.placement.quaternion[0], this.ghostBody.placement.quaternion[1],
                   this.ghostBody.placement.quaternion[2], this.ghostBody.placement.quaternion[3]],
      technique: 'an',
      order: 0
    };
    this.onPlaced?.(p);
    this.cancelPlace();
  };

  private handleKey = (e: KeyboardEvent) => {
    if (!this.ghost) return;
    if (e.key === 'r' || e.key === 'R') {
      this.yaw += Math.PI / 12;
      const gp = new THREE.Vector3(this.ghost.position.x, 0, this.ghost.position.z);
      this.updateGhost(gp.x, gp.z);
    } else if (e.key === 'Escape') {
      this.cancelPlace();
      this.onStatus?.('已取消放置', true);
    }
  };

  /** 已布置石头的原地旋转（选中后调用） */
  rotateSelected(body: RockBody, deltaYaw: number) {
    const q = new THREE.Quaternion(...body.placement.quaternion);
    const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, deltaYaw, 0));
    q.premultiply(dq);
    body.placement.quaternion = [q.x, q.y, q.z, q.w];
    const result = solveSnap(
      [...this.sm.bodies.values()].filter(b => b.placement.id !== body.placement.id),
      body, [body.placement.position[0], body.placement.position[2]], q);
    return result;
  }

  dispose() {
    const dom = this.sm.renderer.domElement;
    dom.removeEventListener('pointerdown', this.handleDown);
    dom.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerup', this.handleUp);
    window.removeEventListener('keydown', this.handleKey);
  }
}

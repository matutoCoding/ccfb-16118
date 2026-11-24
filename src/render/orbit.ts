// 轨道相机控制（自包含，无 examples 依赖）：左键旋转、右键平移、滚轮缩放
import * as THREE from 'three';

export class OrbitController {
  private dom: HTMLElement;
  private camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3(0, 1, 0);
  private spherical = new THREE.Spherical(12, Math.PI / 2.6, Math.PI / 4);
  private minDist = 2;
  private maxDist = 60;
  private dragging: null | 'rotate' | 'pan' = null;
  private lastX = 0;
  private lastY = 0;
  enabled = true;
  /** 每帧相机是否在动（供时域累积决定是否重置） */
  moving = false;
  private moved = false;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera; this.dom = dom;
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    this.update();
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    this.dragging = e.button === 2 ? 'pan' : 'rotate';
    this.lastX = e.clientX; this.lastY = e.clientY;
    this.moved = false;
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging || !this.enabled) return;
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    this.lastX = e.clientX; this.lastY = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 1) this.moved = true;
    if (this.dragging === 'rotate') {
      this.spherical.theta -= dx * 0.005;
      this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi - dy * 0.005, 0.12, Math.PI - 0.12);
    } else {
      const panScale = this.spherical.radius * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      this.target.addScaledVector(right, -dx * panScale).addScaledVector(up, dy * panScale);
    }
    this.update();
  };
  private onUp = () => { this.dragging = null; };
  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.spherical.radius = THREE.MathUtils.clamp(
      this.spherical.radius * (1 + Math.sign(e.deltaY) * 0.09), this.minDist, this.maxDist);
    this.update();
  };

  /** 本次 pointer 按下后是否发生过拖拽（用于区分点击与拖拽） */
  consumeClick(): boolean {
    const c = !this.moved;
    return c;
  }

  setView(pos: THREE.Vector3, lookAt: THREE.Vector3) {
    this.target.copy(lookAt);
    const off = pos.clone().sub(lookAt);
    this.spherical.setFromVector3(off);
    this.update();
  }

  update() {
    const off = new THREE.Vector3().setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(off);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.moving = !!this.dragging;
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.dom.removeEventListener('wheel', this.onWheel);
  }
}

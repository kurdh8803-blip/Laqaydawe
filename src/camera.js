/**
 * 战斗相机 —— 经典格斗侧视机位：自动框住双方，距离随间隔伸缩，KO 时推近
 */
import * as THREE from 'three';

export class FightCamera {
  constructor(camera) {
    this.cam = camera;
    this.look = new THREE.Vector3(0, 1.6, 0);
    this.shake = 0;
    this.zoomPunch = 0;
  }

  addShake(v) { this.shake = Math.min(0.9, this.shake + v); }
  addZoomPunch(v) { this.zoomPunch = Math.min(0.5, this.zoomPunch + v); }

  update(dt, f1, f2, opts = {}) {
    const midX = (f1.x + f2.x) / 2;
    const sep = Math.abs(f1.x - f2.x);
    const high = Math.max(f1.y, f2.y);

    // 目标参数：角色保持在画面中上部，接近水平侧视机位
    const dist = THREE.MathUtils.clamp(3.9 + sep * 0.56 + high * 0.35, 4.6, 10.8);
    const targetLook = new THREE.Vector3(
      THREE.MathUtils.clamp(midX * 0.86, -5.5, 5.5),
      1.55 + high * 0.35,
      0
    );
    const targetPos = new THREE.Vector3(targetLook.x * 0.92, targetLook.y + 0.5, dist);

    const k = opts.snap ? 1 : Math.min(1, dt * 4.2);
    this.look.lerp(targetLook, k);
    this.cam.position.lerp(targetPos, k);

    // KO 推近
    if (opts.koFocus) {
      const w = opts.koFocus;
      this.look.lerp(new THREE.Vector3(w.x, 1.1 + w.y * 0.5, 0), Math.min(1, dt * 3));
      this.cam.position.lerp(new THREE.Vector3(w.x * 0.9, 2.2, 5.4), Math.min(1, dt * 3));
    }

    // 震动 + 变焦冲击
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.zoomPunch = Math.max(0, this.zoomPunch - dt * 1.6);
    const s = this.shake * this.shake;
    this.cam.position.x += (Math.random() - 0.5) * s * 0.7;
    this.cam.position.y += (Math.random() - 0.5) * s * 0.55;
    const fov = 42 - this.zoomPunch * 6;
    if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }

    this.cam.lookAt(this.look);
  }
}

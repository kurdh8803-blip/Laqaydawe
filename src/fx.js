/**
 * 特效：打击火花、尘土、必杀光效、KO 冲击波、屏幕闪白
 * 全部程序化粒子，无外部资源
 */
import * as THREE from 'three';

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.rings = [];
    this.flashEl = null;
    // 共享粒子几何体（仅材质随生命周期销毁）
    this._particleGeo = new THREE.SphereGeometry(0.08, 6, 6);
    this._ringGeo = new THREE.TorusGeometry(0.1, 0.05, 8, 40);
    // 屏幕闪白层
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:15;pointer-events:none;background:#fff;opacity:0;transition:opacity .06s';
    document.body.appendChild(el);
    this.flashEl = el;
  }

  _spawn(pos, color, size, opts) {
    const m = new THREE.Mesh(this._particleGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.scale.setScalar(size / 0.08 * (0.7 + Math.random() * 0.6));
    m.position.copy(pos);
    if (opts?.spreadX) m.position.x += (Math.random() - 0.5) * opts.spreadX;
    if (opts?.dustZ !== undefined && Math.random() < 9999) {
      m.position.y += 0.1;
      m.position.z = (Math.random() - 0.5) * 0.6;
    }
    return m;
  }

  flash(a = 0.5, color = '#fff') {
    this.flashEl.style.background = color;
    this.flashEl.style.opacity = a;
    setTimeout(() => { this.flashEl.style.opacity = 0; }, 60);
  }

  /** 打击火花 */
  sparks(pos, color = 0xffd76b, n = 14, speed = 6) {
    for (let i = 0; i < n; i++) {
      const m = this._spawn(pos, color, 0.04 + Math.random() * 0.06);
      const a = Math.random() * Math.PI * 2, up = Math.random() * Math.PI * 0.5;
      const v = new THREE.Vector3(Math.cos(a) * Math.cos(up), Math.sin(up) + 0.3, Math.sin(a) * Math.cos(up))
        .multiplyScalar(speed * (0.5 + Math.random()));
      this.particles.push({ m, v, life: 0.4 + Math.random() * 0.25, t: 0, grav: 10 });
      this.scene.add(m);
    }
  }

  /** 落地/冲刺尘土 */
  dust(pos, n = 10, color = 0xd9a86c) {
    for (let i = 0; i < n; i++) {
      const m = this._spawn(
        { x: pos.x, y: pos.y || 0, z: 0 }, color, 0.08 + Math.random() * 0.14,
        { spreadX: 1.6, dustZ: 1 }
      );
      m.material.opacity = 0.55;
      const v = new THREE.Vector3((Math.random() - 0.5) * 2.4, 1.2 + Math.random() * 1.8, (Math.random() - 0.5) * 1.2);
      this.particles.push({ m, v, life: 0.55 + Math.random() * 0.3, t: 0, grav: 2.2 });
      this.scene.add(m);
    }
  }

  /** 冲击环（必杀/KO）：实际目标半径展开，避免中段全屏半透明覆盖 */
  ring(pos, color = 0xffd76b, maxR = 3.2, life = 0.45) {
    const m = new THREE.Mesh(
      this._ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide })
    );
    m.position.copy(pos);
    m.lookAt(new THREE.Vector3(0, 2, 8));
    this.rings.push({ m, t: 0, life, target: maxR / 0.15 });   // 环几何体外径≈0.15
    this.scene.add(m);
  }

  /** 必杀气焰（缠绕上升粒子） */
  auraBurst(fighter, color = 0xff9030) {
    for (let i = 0; i < 26; i++) {
      const m = this._spawn(
        { x: fighter.x, y: fighter.y, z: 0 }, color, 0.05 + Math.random() * 0.09
      );
      m.position.x += (Math.random() - 0.5) * 1.2;
      m.position.y += Math.random() * 2.2;
      m.position.z = (Math.random() - 0.5) * 0.9;
      this.particles.push({
        m,
        v: new THREE.Vector3((Math.random() - 0.5) * 1.2, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 1.2),
        life: 0.5 + Math.random() * 0.4, t: 0, grav: -1.5,
      });
      this.scene.add(m);
    }
  }

  /** 羽毛风暴：羽毛从天而降扎地 */
  featherRain(x) {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(0.05, 0.34, 5),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xfff4e0 : 0xffb0a0, transparent: true })
      );
      m.position.set(x + (Math.random() - 0.5) * 1.4, 4.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.8);
      m.rotation.z = (Math.random() - 0.5) * 0.6;
      this.particles.push({
        m, v: new THREE.Vector3((Math.random() - 0.5) * 1.2, -8 - Math.random() * 4, 0),
        life: 0.8, t: 0, grav: 6, spin: (Math.random() - 0.5) * 9,
      });
      this.scene.add(m);
    }
  }

  /** 狼群围猎：半透明幻狼从侧翼掠袭穿过 */
  phantomWolf(centerX, fromLeft) {
    const g = new THREE.Group();
    const ghostM = new THREE.MeshBasicMaterial({ color: 0x9fb8e8, transparent: true, opacity: 0.55 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 6, 10), ghostM);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.55;
    g.add(body);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 8), ghostM);
    head.rotation.z = -Math.PI / 2;
    head.position.set(0.5, 0.72, 0);
    g.add(head);
    for (const [lx, ly] of [[-0.25, 0.2], [0.3, 0.2]]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 4, 8), ghostM);
      leg.position.set(lx, ly, 0);
      g.add(leg);
    }
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 4, 8), ghostM);
    tail.position.set(-0.55, 0.7, 0);
    tail.rotation.z = 0.7;
    g.add(tail);
    const dir = fromLeft ? 1 : -1;
    g.scale.x = dir;
    g.position.set(centerX - dir * 8, 0, 0.3);
    this.phantoms ??= [];
    this.phantoms.push({ g, t: 0, life: 0.75, speed: 17, dir });
    this.scene.add(g);
  }

  update(dt) {
    // 幻狼掠袭
    if (this.phantoms) {
      for (let i = this.phantoms.length - 1; i >= 0; i--) {
        const p = this.phantoms[i];
        p.t += dt;
        p.g.position.x += p.dir * p.speed * dt;
        p.g.position.y = Math.sin(p.t * 30) * 0.05;
        p.g.traverse?.((o) => { if (o.material) o.material.opacity = 0.55 * (1 - p.t / p.life); });
        if (p.t >= p.life) {
          this.scene.remove(p.g);
          p.g.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
          this.phantoms.splice(i, 1);
        }
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      p.v.y -= p.grav * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.material.opacity = 1 - p.t / p.life;
      if (p.spin !== undefined) p.m.rotation.z += p.spin * dt;
      if (p.t >= p.life) {
        this.scene.remove(p.m);
        if (p.spin !== undefined) p.m.geometry.dispose();   // 羽毛为专属几何
        else p.m.material.dispose();   // 圆粒子共享几何，仅销毁材质
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = Math.min(1, r.t / r.life);
      const ease = 1 - (1 - k) * (1 - k);   // easeOut：先快后慢
      r.m.scale.setScalar(0.3 + ease * r.target);
      r.m.material.opacity = Math.pow(1 - k, 1.4) * 0.9;
      if (r.t >= r.life) {
        this.scene.remove(r.m);
        r.m.material.dispose();   // 几何体为共享资源
        this.rings.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.particles) { this.scene.remove(p.m); }
    for (const r of this.rings) { this.scene.remove(r.m); }
    for (const p of this.phantoms || []) { this.scene.remove(p.g); }
    this.particles = []; this.rings = []; this.phantoms = [];
  }
}

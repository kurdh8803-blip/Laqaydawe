/**
 * 程序化角色模型 —— 毛绒质感牛族/豹族斗士
 * 参考「牛来」原片：大脑袋、大口鼻、梨形身材、短腿长臂、蓬松毛绒质感
 * 关节层级 + 姿态插值动画系统（攻击动画由招式数据驱动）
 */
import * as THREE from 'three';

// ---------- 共享材质工具 ----------
let _furBump = null;
function furBump() {
  if (_furBump) return _furBump;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + (Math.random() * 135) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  _furBump = new THREE.CanvasTexture(c);
  _furBump.wrapS = _furBump.wrapT = THREE.RepeatWrapping;
  _furBump.repeat.set(4, 4);
  _furBump.userData.shared = true;   // 跨模型共享，dispose 时跳过
  return _furBump;
}

/** 豹拉斑点纹理（图3：黄底黑斑） */
function spotsTexture(baseHex, spotHex) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + baseHex.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#' + spotHex.toString(16).padStart(6, '0');
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const r = 3 + Math.random() * 7;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.6 + Math.random() * 0.5), Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
    // 空心豹纹环
    if (Math.random() < 0.4) {
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.ellipse(x + 14, y + 8, r + 3, r * 0.8, 1, 0, Math.PI * 2); ctx.stroke();
      ctx.fillRect(x + 13, y + 7, 3, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function furMat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: 1.0, metalness: 0,
    bumpMap: furBump(), bumpScale: 1.2,
    ...opts,
  });
  return m;
}

// ---------- 姿态/动画采样 ----------
const EASE = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const Z3 = [0, 0, 0];

/** 无分配采样：结果写入复用的 out 姿态对象（关节列表在片段上缓存） */
export function sampleClipInto(clip, time, out) {
  const keys = clip.keys;
  let lo = keys[0], hi = keys[keys.length - 1], a, b;
  if (time <= lo.t) { a = hi = null; a = lo; b = lo; }
  else if (time >= hi.t) { a = hi; b = hi; }
  else {
    a = lo; b = hi;
    for (let i = 0; i < keys.length - 1; i++) {
      if (keys[i + 1].t >= time) { a = keys[i]; b = keys[i + 1]; break; }
    }
  }
  let k = (time - a.t) / ((b.t - a.t) || 1e-5);
  k = EASE(k < 0 ? 0 : k > 1 ? 1 : k);
  // 关节并集缓存（每片段只算一次）
  if (!clip._joints) {
    const s = {};
    for (const key of keys) for (const j in key.p) s[j] = true;
    clip._joints = Object.keys(s);
  }
  for (const j of clip._joints) {
    const va = a.p[j] || Z3, vb = b.p[j] || Z3;
    let v = out[j];
    if (!v) v = out[j] = [0, 0, 0];
    v[0] = va[0] + (vb[0] - va[0]) * k;
    v[1] = va[1] + (vb[1] - va[1]) * k;
    v[2] = va[2] + (vb[2] - va[2]) * k;
  }
}

/** 兼容包装 */
export function sampleClip(clip, time) {
  const out = {};
  sampleClipInto(clip, time, out);
  return out;
}

/** 由招式数据生成攻击动画片段：蓄力 → 判定全程保持伸展 → 收招 */
export function buildAttackClip(move) {
  const eps = 0.02;
  const tStrikeIn = move.startup + Math.min(move.active * 0.3, 0.05);
  const tActiveEnd = move.startup + move.active;
  const tEnd = move.startup + move.active + move.recovery;
  return {
    dur: tEnd,
    keys: [
      { t: 0, p: move.poseGuard || {} },
      { t: move.startup * 0.92, p: move.poseWindup },
      { t: tStrikeIn, p: move.poseStrike },
      { t: Math.max(tStrikeIn + 0.01, tActiveEnd - eps), p: move.poseStrike },
      { t: tEnd, p: move.poseGuard || {} },
    ],
  };
}

// =====================================================================
//  角色模型
// =====================================================================
export class FighterModel {
  constructor(def) {
    this.def = def;
    const L = def.look;
    const S = L.scale;

    this.root = new THREE.Group();
    this.body = new THREE.Group();          // KO 倒地/飞天旋转用
    this.body.scale.setScalar(S);
    this.root.add(this.body);

    const fur = L.spots
      ? new THREE.MeshStandardMaterial({ map: spotsTexture(L.fur, 0x2c1f0a), roughness: 1, bumpMap: furBump(), bumpScale: 1.1 })
      : furMat(L.fur);
    const furDark = L.spots ? fur : furMat(L.furDark);
    const muzzleM = furMat(L.muzzle);
    const bellyM = furMat(L.belly);

    // ---- 髋部（身体起伏）----
    const hips = this.hips = new THREE.Group();
    hips.position.y = 0.78;
    this.body.add(hips);

    // 躯干：梨形圆润身体
    const torso = this.j_torso = new THREE.Group();
    torso.position.y = 0.18;
    hips.add(torso);
    const torsoMesh = this.torsoMesh = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 20), fur);
    torsoMesh.scale.set(0.95 * L.girth, 1.05, 0.92 * L.girth);
    torsoMesh.position.y = 0.28;
    torso.add(torsoMesh);
    this._shadow(torsoMesh);

    // 肚皮
    const belly = this.bellyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 16), bellyM);
    belly.scale.set(0.8, 1.0, 0.42);
    belly.position.set(0, 0.16, 0.34 * L.girth);
    torso.add(belly);

    // ---- 头部 ----
    const head = this.j_head = new THREE.Group();
    head.position.y = 0.86;
    torso.add(head);
    const skull = this.skullMesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 26, 22), L.spots ? fur : fur);
    skull.scale.set(1.05, 0.95, 1.0);
    skull.position.y = 0.18;
    head.add(skull); this._shadow(skull);

    // 大口鼻（原片标志）—— 按物种变化
    const species = this.def.species || L.species || 'cow';
    if (species === 'bird') {
      // 云雀：黄色圆锥喙
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 10), muzzleM);
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, 0.14, 0.48);
      head.add(beak);
    } else if (species === 'wolf') {
      // 头狼：前伸的尖口鼻
      const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 14), muzzleM);
      muzzle.scale.set(0.85, 0.72, 1.7);
      muzzle.position.set(0, 0.05, 0.42);
      head.add(muzzle);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4 }));
      nose.position.set(0, 0.1, 0.72);
      head.add(nose);
    } else if (species === 'snake') {
      // 蛇：没有牛口鼻 —— 楔形尖吻 + 吐信
      const tongueM = new THREE.MeshStandardMaterial({ color: 0xd84848, roughness: 0.6 });
      for (const sx of [-1, 1]) {
        const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.22, 6), tongueM);
        fork.rotation.x = Math.PI / 2;
        fork.rotation.z = sx * 0.22;
        fork.position.set(sx * 0.03, 0.02, 0.62);
        head.add(fork);
      }
    } else {
      const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 16), muzzleM);
      muzzle.scale.set(1.05, 0.78, 0.72);
      muzzle.position.set(0, 0.08, 0.36);
      head.add(muzzle);
      // 鼻孔
      const nostrilM = new THREE.MeshStandardMaterial({ color: 0x7a5432, roughness: 0.8 });
      for (const sx of [-1, 1]) {
        const n = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), nostrilM);
        n.position.set(sx * 0.075, 0.13, 0.51);
        head.add(n);
      }
      // 嘴缝
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.018, 0.02), nostrilM);
      mouth.position.set(0, 0.0, 0.52);
      head.add(mouth);
    }

    // 草蛇颈盾（眼镜蛇兜帽，参考图深绿头颈）
    if (L.hood) {
      const hood = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 22, 16),
        new THREE.MeshStandardMaterial({ color: L.furDark, roughness: 0.95 })
      );
      hood.scale.set(1.15, 0.9, 0.32);
      hood.position.set(0, 0.12, -0.06);
      head.add(hood);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.045, 8, 28),
        new THREE.MeshStandardMaterial({ color: 0xf5c0b8, roughness: 0.9 })
      );
      ring.position.set(0, 0.1, -0.22);
      head.add(ring);
    }

    // 云雀头冠
    if (L.crest) {
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16 - i * 0.03, 6), furDark);
        f.position.set(0.02 * (i - 1), 0.5 + i * 0.015, -0.02 - i * 0.03);
        f.rotation.x = -0.5 - i * 0.15;
        head.add(f);
      }
    }

    // 眼睛（白眼球 + 棕虹膜 + 深瞳）—— 物种差异化：蛇为侧位竖瞳、鸟为圆亮小眼、狼为黄瞳小眼白
    const eyeWhiteM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    const irisM = new THREE.MeshStandardMaterial({ color: L.eye, roughness: 0.3 });
    this.eyeMats = [irisM];
    this.eyeGroups = [];
    for (const sx of [-1, 1]) {
      const eg = new THREE.Group();
      if (species === 'snake') {
        // 蛇眼：头部两侧靠上，竖缝瞳
        eg.position.set(sx * 0.21, 0.32, 0.16);
      } else if (species === 'bird') {
        eg.position.set(sx * 0.19, 0.3, 0.26);
      } else {
        eg.position.set(sx * 0.165, 0.3, 0.325);
      }
      head.add(eg);
      this.eyeGroups.push(eg);
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 12), eyeWhiteM);
      white.scale.set(1, 1.15, 0.55);
      if (species === 'snake') white.scale.set(0.5, 0.85, 0.5);
      else if (species === 'bird') white.scale.set(0.72, 0.95, 0.5);
      else if (species === 'wolf') white.scale.set(0.72, 0.9, 0.5);
      eg.add(white);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), irisM);
      iris.position.z = 0.038; iris.scale.set(1, 1.2, 0.5);
      if (species === 'snake') iris.scale.set(0.42, 1.3, 0.5);      // 竖缝蛇瞳
      else if (species === 'bird') iris.scale.set(1.05, 1.05, 0.5); // 圆亮鸟眼
      eg.add(iris);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x0a0604, roughness: 0.2 }));
      pupil.position.z = 0.058; pupil.scale.set(1, 1.25, 0.5);
      if (species === 'snake') pupil.scale.set(0.42, 1.35, 0.5);
      eg.add(pupil);
      // 眉毛
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.06), furMat(L.brow, { roughness: 0.9 }));
      brow.position.set(sx * 0.165, 0.42, 0.345);
      brow.rotation.z = sx * (L.brow === 0x241208 ? -0.42 : -0.18);   // 内低外高 = 怒容
      brow.rotation.x = -0.25;
      head.add(brow);
      if (sx > 0) this.browR = brow; else this.browL = brow;
    }

    // 耳朵：牛/豹圆耳；狼尖立耳（黄耳尖）；蛇/鸟无耳
    if (species === 'wolf') {
      for (const sx of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 8), furDark);
        ear.position.set(sx * 0.22, 0.55, 0);
        ear.rotation.z = sx * -0.22;
        head.add(ear);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.1, 8),
          new THREE.MeshStandardMaterial({ color: 0xf5d76b, roughness: 0.9 }));
        tip.position.set(sx * 0.028, 0.13, 0);
        ear.add(tip);
      }
    } else if (species !== 'bird' && species !== 'snake') {
      const earGeo = new THREE.SphereGeometry(L.earBig ? 0.14 : 0.11, 12, 10);
      for (const sx of [-1, 1]) {
        const ear = new THREE.Mesh(earGeo, furDark);
        ear.scale.set(0.55, 1.1, 0.75);
        ear.position.set(sx * 0.34, 0.48, 0.0);
        ear.rotation.z = sx * -0.5;
        head.add(ear);
        const inner = new THREE.Mesh(new THREE.SphereGeometry(L.earBig ? 0.09 : 0.07, 10, 8), muzzleM);
        inner.scale.set(0.5, 0.9, 0.5);
        inner.position.set(sx * 0.02, 0.0, -0.05);
        ear.add(inner);
      }
    }

    // 牛角（灰角：图1/图4/图6）—— 宽间距、外撇上翘
    if (L.horns) {
      const hornM = new THREE.MeshStandardMaterial({ color: L.horn, roughness: 0.65 });
      const tipM = new THREE.MeshStandardMaterial({ color: L.hornTip, roughness: 0.6 });
      for (const sx of [-1, 1]) {
        const h = new THREE.Group();
        h.position.set(sx * 0.3, 0.4, 0);
        h.rotation.z = sx * -1.15;
        h.rotation.x = -0.15;
        head.add(h);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.115, 0.26, 10), hornM);
        base.position.y = 0.12; h.add(base);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.082, 0.34, 10), tipM);
        tip.position.set(sx * 0.14, 0.36, 0);
        tip.rotation.z = sx * -0.65;
        h.add(tip);
      }
    }

    // 尾巴：牛豹细尾 / 狼粗尾上翘 / 鸟尾羽扇 / 蛇长尾
    if (species === 'bird') {
      const fan = new THREE.Group();
      for (let i = -1; i <= 1; i++) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.42), furDark);
        f.position.set(i * 0.075, 0, -0.22);
        f.rotation.y = i * 0.22;
        fan.add(f);
      }
      fan.position.set(0, 0.42, -0.42);
      fan.rotation.x = -0.5;
      torso.add(fan);
      this.tail = fan;
    } else if (species === 'wolf') {
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.44, 4, 10), fur);
      tail.position.set(0, 0.62, -0.48 * L.girth);
      tail.rotation.x = -0.9;
      torso.add(tail);
      this.tail = tail;
    } else if (species === 'snake') {
      const seg1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.42, 4, 8), fur);
      seg1.position.set(0, 0.28, -0.42 * L.girth);
      seg1.rotation.x = 1.1;
      torso.add(seg1);
      const seg2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.3, 4, 8), fur);
      seg2.position.set(0, 0.1, -0.62);
      seg2.rotation.x = 0.35;
      torso.add(seg2);
      this.tail = seg2;
    } else {
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 4, 8), furDark);
      tail.position.set(0, 0.35, -0.5 * L.girth);
      tail.rotation.x = 0.8;
      torso.add(tail);
      this.tail = tail;
    }

    // ---- 手臂（鸟为翅膀：压扁的羽板；蛇为细藤）----
    const armR = species === 'snake' ? 0.05 : species === 'bird' ? 0.085 : species === 'wolf' ? 0.125 : 0.105;
    const handColor = L.hand || L.muzzle;
    const handM = new THREE.MeshStandardMaterial({ color: handColor, roughness: 0.95 });
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const shoulder = this['j_arm' + side] = new THREE.Group();
      shoulder.position.set(sx * 0.5 * L.girth, 0.62, 0);
      torso.add(shoulder);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(armR, 0.3, 6, 12), fur);
      upper.position.y = -0.19;
      shoulder.add(upper);
      const elbow = this['j_fore' + side] = new THREE.Group();
      elbow.position.y = -0.38;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(armR * 0.92, 0.26, 6, 12), fur);
      fore.position.y = -0.16;
      elbow.add(fore);
      if (species === 'bird') {
        // 翅膀羽板：压扁拉宽，末端白羽
        upper.scale.set(2.4, 1, 0.42);
        fore.scale.set(2.7, 1, 0.38);
        const feather = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.3, 6), handM);
        feather.rotation.x = Math.PI;
        feather.position.y = -0.34;
        elbow.add(feather);
      }
      // 拳头 / 翼尖 / 蛇头
      const hand = this['hand' + side] = new THREE.Mesh(new THREE.SphereGeometry(species === 'snake' ? 0.09 : 0.135, 12, 10), handM);
      hand.position.y = -0.36;
      hand.scale.set(1.05, 0.95, 1.05);
      elbow.add(hand);
      this._shadow(upper); this._shadow(fore);
    }

    // ---- 腿（蛇/鸟纤细，狼粗壮；鸟黄色爪）----
    const legR = species === 'snake' ? 0.07 : (species === 'bird' ? 0.075 : (species === 'wolf' ? 0.155 : 0.14));
    const footC = L.feet || L.muzzle;
    const footM = new THREE.MeshStandardMaterial({ color: footC, roughness: 0.95 });
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      const hip = this['j_leg' + side] = new THREE.Group();
      hip.position.set(sx * 0.22, 0.02, 0);
      hips.add(hip);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(legR + 0.02, 0.2, 6, 12), fur);
      thigh.position.y = -0.16;
      hip.add(thigh);
      const knee = this['j_shin' + side] = new THREE.Group();
      knee.position.y = -0.32;
      hip.add(knee);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(legR, 0.16, 6, 12), species === 'bird' ? muzzleM : fur);
      shin.position.y = -0.13;
      knee.add(shin);
      const foot = this['foot' + side] = new THREE.Mesh(new THREE.SphereGeometry(species === 'snake' ? 0.09 : 0.13, 12, 10), footM);
      foot.scale.set(0.95, 0.6, 1.5);
      foot.position.set(0, -0.28, 0.06);
      knee.add(foot);
      this._shadow(thigh); this._shadow(shin);
    }

    // 物种体形：蛇/鸟/狼重塑身架，摆脱"套头牛"感
    this._applySpeciesBody(species);
    this.species = species;

    // 关节默认姿态（肘/膝微屈，手臂自然下垂微张）
    this.poseTarget = this._neutralPose();
    this.poseCurrent = this._neutralPose();
    this._clipPose = {};          // 片段采样复用对象（零分配）
    this._addPose = {             // 程序层叠加复用对象
      torso: [0, 0, 0], head: [0, 0, 0],
      armL: [0, 0, 0], foreL: [0, 0, 0], armR: [0, 0, 0], foreR: [0, 0, 0],
      legL: [0, 0, 0], shinL: [0, 0, 0], legR: [0, 0, 0], shinR: [0, 0, 0],
    };

    this.clip = null; this.clipTime = 0; this.clipRate = 1;
    this.breathT = Math.random() * 10;
    this.walkT = 0;
    this.spinRoll = 0;
  }

  _shadow(m) { m.castShadow = true; m.receiveShadow = false; }

  /**
   * 物种体形重塑 —— 让蛇像蛇、鸟像鸟、狼像狼：
   * snake 立颈盘身（无腿感，贴地滑行）、bird 卵身细腿（头身一体）、wolf 前倾兽身
   */
  _applySpeciesBody(species) {
    const torsoMesh = this.torsoMesh, belly = this.bellyMesh, skull = this.skullMesh;
    if (species === 'snake') {
      // 激进蛇化：躯干改为前倾蛇身、隐藏全部四肢、盘绕底座承重（攻击由躯干前扑完成）
      this.hips.position.y = 0.5;
      torsoMesh.geometry?.dispose?.();
      torsoMesh.geometry = new THREE.CapsuleGeometry(0.16, 0.72, 8, 14);
      torsoMesh.scale.set(1, 1, 1);
      torsoMesh.position.set(0, 0.36, 0);
      torsoMesh.rotation.x = 0.35;                     // 前倾蛇身
      belly.visible = false;
      this.j_head.position.set(0, 0.66, 0.24);
      skull.geometry?.dispose?.();
      skull.geometry = new THREE.ConeGeometry(0.2, 0.6, 12);      // 楔形蛇头
      skull.rotation.x = Math.PI / 2;
      skull.scale.set(0.95, 1, 0.62);
      skull.position.set(0, 0.18, 0.26);
      this.browL.visible = false; this.browR.visible = false;
      // 彻底去四肢：肩/髋关节整体隐藏（攻击/踢击命中点仍存在但不可见）
      for (const j of ['j_armL', 'j_armR', 'j_legL', 'j_legR']) {
        this[j].visible = false;
      }
      // 蛇身下段：从前倾躯干延续到盘绕底座的弯折
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.4, 8, 12),
        new THREE.MeshStandardMaterial({ color: this.def.look.fur, roughness: 0.95 }));
      lower.position.set(0, -0.18, -0.3);
      lower.rotation.x = -0.85;
      this.j_torso.add(lower);
      // 肩位收到颈部两侧，细臂读作蛇身侧鳍
      this.j_armL.position.set(0.2, 0.42, 0.05);
      this.j_armR.position.set(-0.2, 0.42, 0.05);
      // 腿缩成贴地小柱
      this.j_legL.position.set(0.13, -0.28, 0.05);
      this.j_legR.position.set(-0.13, -0.28, 0.05);
      for (const s of ['L', 'R']) {
        this['j_leg' + s].scale.setScalar(0.55);
        this['j_shin' + s].scale.setScalar(0.7);
      }
      // 盘起的底座
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.14, 10, 22),
        new THREE.MeshStandardMaterial({ color: this.def.look.furDark, roughness: 0.95 })
      );
      coil.rotation.x = Math.PI / 2;
      coil.scale.set(1.25, 1, 0.75);
      coil.position.y = 0.1;
      this.hips.add(coil);
    } else if (species === 'bird') {
      // 卵形身 + 头身一体 + 细黄腿；藏起牛式眉毛
      this.hips.position.y = 0.6;
      torsoMesh.scale.set(0.72, 0.86, 0.78);
      torsoMesh.position.y = 0.32;
      belly.scale.set(0.62, 0.72, 0.4);
      belly.position.set(0, 0.2, 0.26);
      this.j_head.position.set(0, 0.66, 0.1);
      skull.scale.set(0.74, 0.7, 0.78);       // 小圆鸟头，与卵身拉开比例
      this.j_armL.position.set(0.36, 0.5, 0.02);
      this.j_armR.position.set(-0.36, 0.5, 0.02);
      this.j_legL.position.set(0.13, -0.3, 0);
      this.j_legR.position.set(-0.13, -0.3, 0);
      this.browL.visible = false; this.browR.visible = false;
    } else if (species === 'wolf') {
      // 前倾兽身：肩前探、头前压，配合长吻尖耳
      this.hips.position.y = 0.74;
      torsoMesh.scale.set(0.9, 1.0, 1.05);
      torsoMesh.position.set(0, 0.3, 0.04);
      this.j_torso.rotation.x = 0.22;
      belly.scale.set(0.72, 0.9, 0.5);
      belly.position.set(0, 0.22, 0.4);
      this.j_head.position.set(0, 0.8, 0.22);
      skull.scale.set(0.78, 0.85, 1.05);      // 收窄拉长的狼颅
      this.j_armL.position.set(0.48, 0.66, 0.14);
      this.j_armR.position.set(-0.48, 0.66, 0.14);
      this.j_legL.position.set(0.24, 0.0, 0.02);
      this.j_legR.position.set(-0.24, 0.0, 0.02);
    }
  }

  /** 释放 GPU 资源：几何体/材质全清，贴图跳过跨模型共享项 */
  dispose() {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const slot of ['map', 'bumpMap']) {
          const t = m[slot];
          if (t && !t.userData?.shared) t.dispose();
        }
        m.dispose();
      }
    });
    this.root.parent?.remove(this.root);
  }

  _neutralPose() {
    return {
      armL: [0, 0, 0.22], foreL: [-0.5, 0, 0],
      armR: [0, 0, -0.22], foreR: [-0.5, 0, 0],
      legL: [0, 0, 0.06], shinL: [0.12, 0, 0],
      legR: [0, 0, -0.06], shinR: [0.12, 0, 0],
      torso: [0, 0, 0], head: [0, 0, 0],
    };
  }

  /** 播放片段（攻击/受击/防御等），loop=false 播完保持末帧 */
  play(clip, rate = 1) {
    // 预置关节并集为零值（与未采样关节默认回零的历史行为一致）
    if (!clip._joints) { const s = {}; for (const k of clip.keys) for (const j in k.p) s[j] = true; clip._joints = Object.keys(s); }
    const cp = this._clipPose;
    for (const j of clip._joints) {
      let v = cp[j]; if (!v) v = cp[j] = [0, 0, 0];
      v[0] = 0; v[1] = 0; v[2] = 0;
    }
    this.clip = clip; this.clipTime = 0; this.clipRate = rate;
  }
  stopClip() { this.clip = null; }

  /** 直接设置目标姿态（防御/胜利等保持型姿态） */
  setPose(pose) { this.clip = null; this.poseTarget = { ...this._neutralPose(), ...pose }; }

  update(dt, ctx) {
    // ctx: { state, vx, vy, grounded, walkSpeed, specialKind, moveT }
    this.breathT += dt;

    // 清空复用的程序叠加层（保留容器，零分配）
    const add = this._addPose;
    for (const j in add) { add[j][0] = 0; add[j][1] = 0; add[j][2] = 0; }
    let usedAdd = false;

    // 1) 片段采样 or 保持姿态（写入复用对象）
    let target = this.poseTarget;
    if (this.clip) {
      this.clipTime += dt * this.clipRate;
      target = this._clipPose;
      sampleClipInto(this.clip, this.clipTime, target);
    }

    // 2) 运动程序层叠加（写入共享数组）
    const st = ctx.state;
    const put = (j, x, y, z) => { const a = add[j]; a[0] = x; a[1] = y; a[2] = z; };

    if (st === 'walk' && ctx.grounded) {
      if (this.species === 'snake') {
        // 蛇行：前倾身左右摆动滑行（四肢已隐藏）
        this.walkT += dt * ctx.walkSpeed * 3.4;
        const s = Math.sin(this.walkT);
        put('torso', 0.38, s * 0.24, 0);
        put('head', -0.3, s * 0.18, 0);
        usedAdd = true;
      } else {
      this.walkT += dt * ctx.walkSpeed * 2.6;
      const s = Math.sin(this.walkT);
      put('legL', s * 0.55, 0, 0.06);
      put('legR', -s * 0.55, 0, -0.06);
      put('shinL', Math.max(0, -s) * 0.7 + 0.12, 0, 0);
      put('shinR', Math.max(0, s) * 0.7 + 0.12, 0, 0);
      put('armL', -s * 0.35, 0, 0.3);
      put('armR', s * 0.35, 0, -0.3);
      usedAdd = true;
      }
    } else if (st === 'jump' || st === 'fall') {
      const t = THREE.MathUtils.clamp(-ctx.vy / 9, -1, 1);
      put('legL', -0.5 + t * 0.3, 0, 0.1); put('shinL', 0.9, 0, 0);
      put('legR', -0.35 + t * 0.3, 0, -0.1); put('shinR', 0.75, 0, 0);
      put('armL', -0.6, 0, 0.9); put('armR', -0.6, 0, -0.9);
      usedAdd = true;
    } else if (st === 'special' && ctx.specialKind === 'rush') {
      this.walkT += dt * 22;
      const s = Math.sin(this.walkT);
      put('legL', s * 0.9 - 0.5, 0, 0.1); put('legR', -s * 0.9 - 0.5, 0, -0.1);
      put('shinL', Math.max(0, -s) * 1.1 + 0.3, 0, 0);
      put('shinR', Math.max(0, s) * 1.1 + 0.3, 0, 0);
      put('torso', 0.55, s * 0.06, 0);
      put('head', -0.35, 0, 0);
      put('armL', 0.7, 0, 0.35); put('armR', 0.7, 0, -0.35);
      put('foreL', -0.9, 0, 0); put('foreR', -0.9, 0, 0);
      usedAdd = true;
    } else if (st === 'special' && ctx.specialKind === 'flurry') {
      this.walkT += dt * 34;
      const s = Math.sin(this.walkT), c = Math.cos(this.walkT * 0.5);
      put('legL', -1.4 + s * 0.7, 0, 0.15); put('shinL', 1.4 + s * 0.8, 0, 0);
      put('legR', -1.4 - s * 0.7, 0, -0.15); put('shinR', 1.4 - s * 0.8, 0, 0);
      put('armL', -0.9 + c * 0.5, 0, 0.7); put('armR', -0.9 - c * 0.5, 0, -0.7);
      put('torso', -0.15, c * 0.3, 0);
      usedAdd = true;
    } else if (st === 'special' && ctx.specialKind === 'coil') {
      // 绳影缠绕：双臂波浪环抱，身体绕轴微旋
      this.walkT += dt * 16;
      const s = Math.sin(this.walkT);
      put('armL', -0.6 + s * 0.8, 0, 1.5 + s * 0.4); put('armR', -0.6 - s * 0.8, 0, -1.5 - s * 0.4);
      put('foreL', -1.6 - s * 0.5, 0, 0); put('foreR', -1.6 + s * 0.5, 0, 0);
      put('torso', 0.25, s * 0.35, 0);
      put('head', -0.15, s * 0.3, 0);
      usedAdd = true;
    } else if (st === 'special' && ctx.specialKind === 'storm') {
      // 羽毛风暴：高频振翅悬停
      this.walkT += dt * 26;
      const s = Math.sin(this.walkT);
      put('armL', -0.3, 0, 1.9 + s * 0.55); put('armR', -0.3, 0, -1.9 - s * 0.55);
      put('foreL', -0.3 - s * 0.3, 0, 0); put('foreR', -0.3 + s * 0.3, 0, 0);
      put('legL', 0.45 + s * 0.12, 0, 0.12); put('legR', 0.45 - s * 0.12, 0, -0.12);
      put('torso', 0.18, s * 0.06, 0);
      usedAdd = true;
    } else if (st === 'special' && ctx.specialKind === 'pack') {
      // 狼群围猎：仰天长啸的战栗
      this.walkT += dt * 13;
      const s = Math.sin(this.walkT);
      put('head', -0.75, s * 0.08, 0);
      put('torso', -0.32, 0, 0);
      put('armL', -0.5, 0, 0.55 + s * 0.1); put('armR', -0.5, 0, -0.55 - s * 0.1);
      usedAdd = true;
    }

    // 3) 呼吸（待机微动）
    if (st === 'idle' || st === 'block') {
      const b = Math.sin(this.breathT * 3.2) * 0.035;
      put('torso', b, 0, 0);
      this.hips.position.y = 0.78 + Math.sin(this.breathT * 3.2) * 0.012;
      usedAdd = true;
    } else if (this.hips.position.y !== 0.78) {
      this.hips.position.y += (0.78 - this.hips.position.y) * Math.min(1, dt * 10);
    }

    // 4) 姿态混合并应用（原地写 poseCurrent，不产生新数组）
    // 片段播放时：未在片段中出现的关节回到零位（避免上一动作的姿势残留污染命中位置）
    const blend = this.clip ? 1 : Math.min(1, dt * 14);
    for (const j in this.poseCurrent) {
      const cur = this.poseCurrent[j];
      let tg;
      if (this.clip) tg = target[j] || Z3;
      else tg = target[j] !== undefined ? target[j] : Z3;
      const ad = usedAdd ? add[j] : null;
      const nx = cur[0] + (tg[0] + (ad ? ad[0] : 0) - cur[0]) * blend;
      const ny = cur[1] + (tg[1] + (ad ? ad[1] : 0) - cur[1]) * blend;
      const nz = cur[2] + (tg[2] + (ad ? ad[2] : 0) - cur[2]) * blend;
      cur[0] = nx; cur[1] = ny; cur[2] = nz;
      const joint = this['j_' + j];
      if (joint && (nx !== joint.rotation.x || ny !== joint.rotation.y || nz !== joint.rotation.z)) {
        joint.rotation.set(nx, ny, nz);
      }
    }
  }
}

/**
 * 斗士实体：状态机 + 物理 + 招式执行 + 受击反应
 * 状态: idle/walk/jump/fall/attack/block/blockstun/hit/launch/knockdown/getup/dodge/special/ko/win
 */
import * as THREE from 'three';
import { FighterModel } from './model.js';
import { MOVES, SPECIALS, SPECIAL_POSES } from './moves.js';
import { buildAttackClip } from './model.js';
import { ARENA, PHYS, GAME } from './config.js';

const V3 = new THREE.Vector3();

// 保持型姿态（进入状态时设置，模型自动混合过去）
const BLOCK_POSE = {
  armL: [-1.15, 0, 0.5], foreL: [-1.65, 0, 0],
  armR: [-1.15, 0, -0.5], foreR: [-1.65, 0, 0],
  torso: [0.14, 0, 0], head: [0.08, 0, 0],
  legL: [0.18, 0, 0.12], legR: [0.18, 0, -0.12], shinL: [0.3, 0, 0], shinR: [0.3, 0, 0],
};
const DODGE_POSE = { torso: [0.5, 0, 0], head: [-0.2, 0, 0], legL: [0.4, 0, 0.15], legR: [0.4, 0, -0.15] };
const WIN_POSE = { armL: [-0.25, 0, 2.35], foreL: [-0.4, 0, 0], armR: [-0.25, 0, -2.35], foreR: [-0.4, 0, 0], head: [-0.15, 0, 0] };
const HIT_POSE = { torso: [-0.42, 0, 0], head: [0.35, 0, 0], armL: [-0.9, 0, 1.0], armR: [-0.5, 0, -0.7], foreL: [-0.9, 0, 0], legL: [-0.35, 0, 0.1] };

export class Fighter {
  constructor(charDef, opts = {}) {
    this.char = charDef;
    this.index = opts.index ?? 0;          // 0 = P1, 1 = P2
    this.isP1 = this.index === 0;
    this.x = opts.x ?? 0;
    this.y = 0;                             // 离地高度
    this.vx = 0; this.vy = 0;
    this.facing = opts.facing ?? 1;         // 1 → 面向 +X
    this.hp = charDef.stats.maxHp;
    this.meter = 0;
    this.state = 'idle';
    this.stateT = 0;
    this.inputHeld = {};
    this.buffered = null;                   // { move, t } 攻击缓冲
    this.tapTimes = { left: -9, right: -9 }; // 双击闪避检测
    this.dodgeCooldown = 0;
    this.iframes = 0;
    this.armor = false;
    this.comboCount = 0;                    // 当前连击数
    this.comboDmg = 0;
    this.roundsWon = 0;

    // 当前攻击
    this.move = null; this.moveClip = null; this.hasHit = false; this.lastHitTick = -9;
    this.special = null;
    this.flyRoll = 0;

    this.model = new FighterModel(charDef);
    this.model.root.position.set(this.x, 0, 0);
    this._syncFacing();

    this.onEvent = opts.onEvent || (() => {});   // (type, data) → fx/sfx/ui
  }

  get scale() { return this.char.look.scale; }
  get maxHp() { return this.char.stats.maxHp; }
  get grounded() { return this.y <= 0.001 && this.vy <= 0; }

  // ---------------- 输入 ----------------
  setInput(held, just) {
    this.inputHeld = held; this.just = just;
    // 攻击缓冲（放宽窗口，接近对手时提前输入也能命中）
    for (const m of ['lp', 'hp', 'lk', 'hk']) {
      if (just[m]) this.buffered = { move: m, t: 0.28 };
    }
    if (just.sp && this.meter >= 100) this.buffered = { move: 'special', t: 0.32 };
    // 双击闪避
    for (const d of ['left', 'right']) {
      if (just[d]) {
        if (this.stateT >= 0 && performance.now() / 1000 - this.tapTimes[d] < 0.24) {
          this.tryDodge(d === 'left' ? -1 : 1);
        }
        this.tapTimes[d] = performance.now() / 1000;
      }
    }
  }

  canAct() {
    return ['idle', 'walk', 'jump', 'fall'].includes(this.state);
  }

  tryDodge(dir) {
    if (!this.canAct() || this.dodgeCooldown > 0 || !this.grounded) return;
    this.state = 'dodge'; this.stateT = 0;
    this.vx = dir * 7.5;
    this.iframes = 0.26;
    this.dodgeCooldown = 0.85;
    this.onEvent('dodge', { who: this });
  }

  startAttack(moveId) {
    const mv = MOVES[moveId];
    this.move = { id: moveId, ...mv };
    this.moveClip = buildAttackClip(this.move);
    this.state = 'attack'; this.stateT = 0;
    this.hasHit = false;
    this.lastHitTick = -9;
    this.comboTick = 0;
    // 前冲惯性：重招冲得更快
    this.vx = this.facing * (mv.heavy ? 2.3 : 1.0);
    this.model.play(this.moveClip, 1);
    this.onEvent('attack', { who: this, move: this.move });
  }

  startSpecial() {
    const sp = SPECIALS[this.char.specialKind];
    this.special = { ...sp, t: 0, hitTick: 0 };
    this.state = 'special'; this.stateT = 0;
    this.meter = 0;
    this.armor = !!sp.armor;
    this.hasHit = false;
    this.lastHitTick = -9;   // 清除上一招的节拍残留，否则多段必杀后续段全部失效
    this.comboTick = 0;
    this.onEvent('special', { who: this, special: sp });
    // 模型动画
    if (sp.kind === 'fly') {
      this.model.play({ dur: sp.startup, keys: [{ t: 0, p: {} }, { t: 0.6, p: { torso: [0.5, 0, 0], legL: [-0.7, 0, 0.1], legR: [-0.7, 0, -0.1] } }, { t: sp.startup, p: SPECIAL_POSES.flyStrike }] }, 1);
    } else if (sp.kind === 'upper') {
      this.model.play({ dur: sp.startup + sp.active, keys: [{ t: 0, p: SPECIAL_POSES.upperWindup }, { t: sp.startup * 0.8, p: SPECIAL_POSES.upperWindup }, { t: sp.startup + sp.active * 0.6, p: SPECIAL_POSES.upperStrike }] }, 1);
    } else if (sp.kind === 'rush') {
      this.model.play({ dur: sp.startup + sp.active, keys: [{ t: 0, p: { torso: [0.5, 0, 0], head: [-0.3, 0, 0], legL: [-0.4, 0, 0.1], legR: [-0.4, 0, -0.1] } }, { t: sp.startup + sp.active, p: {} }] }, 1);
    } else if (sp.kind === 'coil') {
      this.model.play({ dur: sp.startup + sp.active, keys: [{ t: 0, p: {} }, { t: sp.startup * 0.8, p: SPECIAL_POSES.coilWindup }, { t: sp.startup + sp.active, p: SPECIAL_POSES.coilWindup }] }, 1);
    } else if (sp.kind === 'storm') {
      this.model.play({ dur: sp.startup + sp.active, keys: [{ t: 0, p: {} }, { t: sp.startup, p: SPECIAL_POSES.stormRise }, { t: sp.startup + sp.active, p: SPECIAL_POSES.stormRise }] }, 1);
    } else if (sp.kind === 'pack') {
      this.model.play({ dur: sp.startup + sp.active, keys: [{ t: 0, p: {} }, { t: sp.startup * 0.7, p: SPECIAL_POSES.packHowl }, { t: sp.startup + sp.active, p: SPECIAL_POSES.packHowl }] }, 1);
    } else {
      this.model.play({ dur: sp.startup + sp.active + sp.recovery, keys: [{ t: 0, p: { torso: [0.3, 0, 0] } }, { t: sp.startup + sp.active, p: {} }] }, 1);
    }
  }

  // ---------------- 受击 ----------------
  takeHit(atk, opts) {
    // opts: { damage, hitstun, blockstun, knockback, launch, knockdown, dir, heavy }
    if (this.state === 'ko' || this.iframes > 0) return 'whiff';
    const blocking = (this.state === 'block' || this.state === 'blockstun') &&
      Math.sign(atk.x - this.x) === this.facing;   // 面向攻击方才有效
    const dir = opts.dir;

    if (blocking) {
      const chip = Math.max(4, Math.round(opts.damage * 0.1));
      this.hp = Math.max(0, this.hp - chip);
      this.state = 'blockstun'; this.stateT = 0;
      this.blockstunT = opts.blockstun;
      this.vx = dir * Math.min(3.2, opts.knockback * 0.55);
      this.meter = Math.min(100, this.meter + opts.damage * 0.18);
      this.onEvent('block', { who: this, heavy: opts.heavy });
      return 'block';
    }

    if (this.armor) {   // 霸体：掉血不硬直
      this.hp = Math.max(1, this.hp - opts.damage);
      this.meter = Math.min(100, this.meter + opts.damage * 0.2);
      this.onEvent('armorhit', { who: this });
      return 'armor';
    }

    this.hp = Math.max(0, this.hp - opts.damage);
    this.meter = Math.min(100, this.meter + opts.damage * 0.22);
    if (this.hp <= 0) {
      this.state = 'ko'; this.stateT = 0;
      this.vx = dir * Math.max(3.5, opts.knockback * 0.8);
      this.vy = Math.max(4.5, opts.launch || 4.5);
      this.move = null; this.special = null; this.armor = false;
      this.onEvent('ko', { who: this, heavy: true });
      return 'ko';
    }
    if (opts.launch > 0 || opts.knockdown || !this.grounded) {
      this.state = 'launch'; this.stateT = 0;
      this.vx = dir * opts.knockback * 0.55;
      this.vy = Math.max(opts.launch, opts.knockdown ? 3.4 : 0, this.grounded ? 0 : 2.6);
    } else {
      this.state = 'hit'; this.stateT = 0;
      this.hitstunT = opts.hitstun;
      this.vx = dir * Math.min(4.2, opts.knockback * 0.6);
    }
    this.move = null; this.special = null;
    this.model.stopClip();
    this.onEvent('hurt', { who: this, heavy: opts.heavy });
    return 'hit';
  }

  // ---------------- 主更新 ----------------
  update(dt, opponent, world) {
    this.stateT += dt;
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    if (this.buffered) { this.buffered.t -= dt; if (this.buffered.t <= 0) this.buffered = null; }

    const held = this.inputHeld || {};
    const just = this.just || {};

    // 自动面向对手（地面、非攻击/受击状态）
    if (this.grounded && ['idle', 'walk', 'jump', 'fall'].includes(this.state)) {
      const want = opponent.x >= this.x ? 1 : -1;
      if (want !== this.facing) { this.facing = want; this._syncFacing(); }
    }

    switch (this.state) {
      case 'idle': case 'walk': {
        if (this.state !== 'walk') this.state = 'idle';
        let mx = 0;
        if (held.left) mx -= 1;
        if (held.right) mx += 1;
        // 后退减速
        const back = mx !== 0 && Math.sign(mx) !== this.facing;
        const spd = back ? this.char.stats.backWalk : this.char.stats.walk;
        if (held.down && this.grounded) {
          this.state = 'block'; this.vx *= 0.7;
        } else if (mx !== 0) {
          this.state = 'walk';
          this.vx = mx * spd;
        } else {
          this.state = 'idle';
          this.vx *= Math.max(0, 1 - dt * 12);
        }
        if (just.up && this.grounded) {
          this.vy = PHYS.jumpVel; this.vx = mx * this.char.stats.walk * 1.15;
          this.state = 'jump'; this.stateT = 0;
          this.onEvent('jump', { who: this });
        }
        this._tryStartAction();
        break;
      }
      case 'jump': case 'fall': {
        // 空中微控
        let mx = 0;
        if (held.left) mx -= 1;
        if (held.right) mx += 1;
        this.vx += mx * 4.5 * dt;
        this.vx = THREE.MathUtils.clamp(this.vx, -this.char.stats.walk * 1.6, this.char.stats.walk * 1.6);
        if (this.state === 'jump' && this.vy < 0) this.state = 'fall';
        if (just.lp) this.startAttack('air_lp');
        else if (just.lk || just.hk) this.startAttack('air_hk');
        else if (just.hp) this.startAttack('air_lp');
        this._tryStartAction();
        break;
      }
      case 'attack': {
        const mv = this.move;
        const t = this.stateT;
        // 前冲惯性衰减（避免出招滑行推人）
        this.vx *= Math.max(0, 1 - dt * 7);
        const hitStart = mv.startup, hitEnd = mv.startup + mv.active;
        // 招式取消（连招核心）：命中后可在收招期取消为可衔接招式
        if (this.hasHit && t > hitStart && this.buffered) {
          const next = this.buffered.move;
          if (next === 'special' && mv.canCancel.includes('special') && this.meter >= 100) {
            this.buffered = null; this.startSpecial(); break;
          }
          if (next !== 'special' && mv.canCancel.includes(next) && this.grounded && !mv.air) {
            this.buffered = null; this.startAttack(next); break;
          }
        }
        if (!mv.air && !this.grounded) { /* 地面招式踩空立即收招 */ }
        if (t >= hitEnd + mv.recovery) {
          this.state = this.grounded ? 'idle' : 'fall';
          this.move = null; this.model.stopClip();
        }
        break;
      }
      case 'special': {
        const sp = this.special;
        const t = this.stateT;
        if (sp.kind === 'rush') {
          if (t < sp.startup) { this.vx *= 0.8; }
          else if (t < sp.startup + sp.active) {
            this.vx = this.facing * sp.dashSpeed;
            // 多段判定
            if (t - this.lastHitTick >= sp.hitInterval || !this.hasHit) world.tryHit(this, sp, { tick: true });
          } else {
            this.vx *= Math.max(0, 1 - dt * 8);
            this.armor = false;
            if (t >= sp.startup + sp.active + sp.recovery) this._endSpecial();
          }
        } else if (sp.kind === 'fly') {
          if (t < sp.startup) { this.vx *= 0.8; }
          else if (t < sp.startup + sp.active) {
            if (t - sp.startup < 0.02) { this.vy = sp.riseVel; this.onEvent('jump', { who: this }); }
            this.vx = this.facing * sp.flySpeed;
            this.vy -= PHYS.gravity * 0.55 * dt;   // 滑翔
            this.flyRoll += dt * 3.2;
            world.tryHit(this, sp, {});
          } else {
            this.armor = false;
            if (this.grounded && this.vy <= 0) { this._endSpecial(); }
          }
        } else if (sp.kind === 'flurry') {
          if (t < sp.startup) { this.vx *= 0.8; }
          else if (t < sp.startup + sp.active) {
            this.vx = 0;
            if (!this.hasHit || t - this.lastHitTick >= sp.hitInterval) world.tryHit(this, sp, { tick: true, suck: sp.suck });
          } else if (t >= sp.startup + sp.active + sp.recovery) this._endSpecial();
        } else if (sp.kind === 'upper') {
          if (t < sp.startup) {
            this.vx = this.facing * sp.stepSpeed * (t / sp.startup);
          } else if (t < sp.startup + sp.active) {
            this.vx = this.facing * sp.stepSpeed * 0.3;
            if (!this.hasHit) { this.vy = sp.selfRise; world.tryHit(this, sp, {}); }
          } else {
            this.vx *= Math.max(0, 1 - dt * 6);
            if (this.grounded && t > sp.startup + sp.active + 0.12) this._endSpecial();
          }
        } else if (sp.kind === 'coil') {
          // 绳影缠绕：前扑咬住 → 缠住原地连绞 → 末段甩飞
          if (t < sp.startup) {
            this.vx *= 0.8;
          } else if (!this.hasHit) {
            this.vx = this.facing * sp.lungeSpeed;
            world.tryHit(this, sp, { tick: true });
            if (!this.hasHit && t > sp.startup + 0.55) this.vx *= 0.6;   // 扑空减速
          } else {
            // 缠绕段：贴住对手绕行连绞（对手被 hitstun 锁在原地）
            this.vx = 0;
            this.x = THREE.MathUtils.lerp(this.x, opponent.x - this.facing * 0.75, Math.min(1, dt * 10));
            if (t - this.lastHitTick >= sp.hitInterval) world.tryHit(this, sp, { tick: true, suck: 0.4 });
            if (t >= sp.startup + sp.active) this.vx = this.facing * 3;
          }
          if (t >= sp.startup + sp.active + sp.recovery && this.grounded) this._endSpecial();
        } else if (sp.kind === 'storm') {
          // 羽毛风暴：腾空悬停追踪 → 羽羽落下 → 收尾俯冲
          if (t < sp.startup) {
            this.vx *= 0.8;
            if (t > sp.startup - 0.1 && this.grounded) { this.vy = sp.riseVel; this.onEvent('jump', { who: this }); }
          } else if (t < sp.startup + sp.active) {
            // 悬停在对手上空
            this.vy = (sp.hoverY - this.y) * 6 - this.vy * 0.5;
            this.vx = THREE.MathUtils.clamp((opponent.x - this.x) * 4, -7, 7);
            if (t - this.lastHitTick >= sp.hitInterval || !this.hasHit) {
              if (world.tryHit(this, sp, { tick: true, fromSky: true })) this.onEvent('feather', { who: this, x: opponent.x });
            }
          } else {
            // 俯冲收尾
            this.vx *= Math.max(0, 1 - dt * 3);
            if (this.grounded && this.vy <= 0) { this.onEvent('land', { who: this }); this._endSpecial(); }
          }
        } else if (sp.kind === 'pack') {
          // 狼群围猎：原地嚎叫，幻狼从两侧反复穿越撕咬
          if (t < sp.startup) {
            this.vx *= 0.8;
          } else if (t < sp.startup + sp.active) {
            this.vx = 0;
            if (!this.hasHit || t - this.lastHitTick >= sp.hitInterval) {
              if (world.tryHit(this, sp, { tick: true })) this.onEvent('wolfrush', { who: this, x: opponent.x });
            }
          } else if (t >= sp.startup + sp.active + sp.recovery) this._endSpecial();
        }
        break;
      }
      case 'block': {
        if (!held.down) { this.state = 'idle'; }
        this.vx *= Math.max(0, 1 - dt * 10);
        break;
      }
      case 'blockstun': {
        this.vx *= Math.max(0, 1 - dt * 6);
        if (this.stateT >= this.blockstunT) this.state = held.down ? 'block' : 'idle';
        break;
      }
      case 'hit': {
        this.vx *= Math.max(0, 1 - dt * 5);
        if (this.stateT >= this.hitstunT) this.state = 'idle';
        break;
      }
      case 'launch': {
        if (this.grounded && this.vy <= 0) {
          this.state = 'knockdown'; this.stateT = 0;
          this.vx *= 0.3;
          this.onEvent('land', { who: this });
        }
        break;
      }
      case 'knockdown': {
        this.vx *= Math.max(0, 1 - dt * 8);
        if (this.stateT >= 0.62) { this.state = 'getup'; this.stateT = 0; this.iframes = 0.4; }
        break;
      }
      case 'getup': {
        if (this.stateT >= 0.34) this.state = 'idle';
        break;
      }
      case 'dodge': {
        this.vx *= Math.max(0, 1 - dt * 7);
        if (this.stateT >= 0.34) this.state = 'idle';
        break;
      }
      case 'ko': {
        this.vx *= Math.max(0, 1 - dt * 3);
        break;
      }
      case 'win': break;
    }

    // 缓冲招式（攻击结束后消化）
    if (this.canAct() && this.buffered) this._tryStartAction(true);

    // ---- 物理 ----
    this.vy -= PHYS.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) {
      if (this.state === 'jump' || this.state === 'fall') {
        this.state = 'idle'; this.onEvent('land', { who: this });
      }
      if (this.state === 'attack' && this.move?.air) {
        this.state = 'idle'; this.move = null; this.model.stopClip();
      }
      this.y = 0; this.vy = 0;
      if (['special'].includes(this.state) && this.special?.kind === 'fly' && this.stateT > this.special.startup + this.special.active) {
        this._endSpecial();
      }
    }
    // 场地边界
    const lim = ARENA.halfWidth - 0.6;
    if (this.x < -lim) { this.x = -lim; this.vx = Math.max(0, this.vx); }
    if (this.x > lim) { this.x = lim; this.vx = Math.min(0, this.vx); }

    // ---- 模型同步 ----
    this._syncModel(dt);
  }

  _endSpecial() {
    this.state = 'idle'; this.stateT = 0;
    this.special = null; this.armor = false;
    this.model.stopClip();
    this.flyRoll = 0;
  }

  _tryStartAction(fromBuffer = false) {
    if (!this.buffered) return;
    const b = this.buffered;
    if (b.move === 'special') {
      if (this.meter >= 100) { this.buffered = null; this.startSpecial(); }
      return;
    }
    if (this.grounded) { this.buffered = null; this.startAttack(b.move); }
    else if (!fromBuffer) {
      // 空中：映射空中招式
      const air = (b.move === 'lp' || b.move === 'hp') ? 'air_lp' : 'air_hk';
      this.buffered = null; this.startAttack(air);
    }
  }

  _syncFacing() {
    this.model.root.rotation.y = this.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  _syncModel(dt) {
    const m = this.model;
    m.root.position.set(this.renderX ?? this.x, this.renderY ?? this.y, 0);
    // 状态切换 → 保持型姿态
    if (this.state !== this._poseState) {
      this._poseState = this.state;
      if (this.state === 'block' || this.state === 'blockstun') m.setPose(BLOCK_POSE);
      else if (this.state === 'dodge') m.setPose(DODGE_POSE);
      else if (this.state === 'win') m.setPose(WIN_POSE);
      else if (this.state === 'hit') m.setPose(HIT_POSE);
      else if (['idle', 'walk', 'jump', 'fall'].includes(this.state) && !m.clip) m.setPose({});
    }
    // 倒地/被击飞/起身的身体旋转
    let bodyRotX = 0, targetY = 0;
    if (this.state === 'launch') { m.body.rotation.x -= dt * 6.5; }
    else if (this.state === 'knockdown' || this.state === 'ko') {
      bodyRotX = -Math.PI / 2 * 0.96;
      m.body.rotation.x += (bodyRotX - m.body.rotation.x) * Math.min(1, dt * 9);
    } else if (this.state === 'getup') {
      m.body.rotation.x += (0 - m.body.rotation.x) * Math.min(1, dt * 8);
    } else {
      m.body.rotation.x += (0 - m.body.rotation.x) * Math.min(1, dt * 12);
    }
    if (this.state === 'special' && this.special?.kind === 'fly' && this.stateT > this.special.startup) {
      m.body.rotation.z = Math.sin(this.flyRoll) * 0.35;
    } else {
      m.body.rotation.z += (0 - m.body.rotation.z) * Math.min(1, dt * 10);
    }
    // 模型动画状态（必杀程序层只在有效段驱动）
    const sp = this.special;
    const spActive = sp && (this.stateT < sp.startup + sp.active || sp.kind === 'fly');
    m.update(dt, {
      state: this.state === 'walk' ? 'walk' : this.state,
      vx: this.vx, vy: this.vy,
      grounded: this.y <= 0.001,
      walkSpeed: Math.abs(this.vx),
      specialKind: spActive ? sp.kind : null,
      moveT: this.stateT,
    });
  }

  // ---------------- 命中判定 ----------------
  /** 攻击判定球心 */
  hitOrigin(move) {
    if (move.limb === 'body') {
      return V3.set(this.x + this.facing * 0.5, this.y + 1.1 * this.scale, 0).clone();
    }
    const part = this.model[move.limb];
    const p = part.getWorldPosition(new THREE.Vector3());
    return p;
  }

  /** 受击胶囊（线段 + 半径） */
  hurtCapsule() {
    const s = this.scale;
    return {
      y0: this.y + 0.45 * s,
      y1: this.y + (this.state === 'knockdown' || this.state === 'ko' ? 0.7 : 2.05) * s,
      r: 0.52 * s,
      x: this.x,
    };
  }

  /** 本回合获胜：举起双臂 */
  setWinner() {
    this.state = 'win'; this.stateT = 0;
    this.move = null; this.special = null;
    this.model.stopClip();
    this.onEvent('win', { who: this });
  }

  /** 客机木偶：快照驱动，位置插值平滑 */
  puppetStep(dt) {
    if (this.renderX == null) { this.renderX = this.x; this.renderY = this.y; }
    const k = Math.min(1, dt * 15);
    this.renderX += (this.x - this.renderX) * k;
    this.renderY += (this.y - this.renderY) * k;
    if (Math.abs(this.renderX - this.x) < 0.005) this.renderX = this.x;
    if (Math.abs(this.renderY - this.y) < 0.005) this.renderY = this.y;
    this.stateT += dt;
    this.iframes = Math.max(0, this.iframes - dt);
    this._syncModel(dt);
  }

  /** 快照（联机同步） */
  serialize() {
    return {
      x: +this.x.toFixed(3), y: +this.y.toFixed(3), vx: +this.vx.toFixed(2), vy: +this.vy.toFixed(2),
      facing: this.facing, hp: Math.round(this.hp), meter: Math.round(this.meter),
      state: this.state, stateT: +this.stateT.toFixed(3),
      move: this.move?.id ?? null, hasHit: this.hasHit,
      spKind: this.special?.kind ?? null, combo: this.comboCount,
      roundsWon: this.roundsWon,
    };
  }

  applySnapshot(s) {
    if (this.renderX == null) { this.renderX = this.x; this.renderY = this.y; }
    else { this.renderX = this.x; this.renderY = this.y; }   // 以当前值作为插值起点
    this.x = s.x; this.y = s.y; this.vx = s.vx; this.vy = s.vy;
    if (s.facing !== this.facing) { this.facing = s.facing; this._syncFacing(); }
    this.hp = s.hp; this.meter = s.meter;
    const stateChanged = s.state !== this.state;
    this.state = s.state; this.stateT = s.stateT; this.comboCount = s.combo;
    this.roundsWon = s.roundsWon;
    if (stateChanged) {
      this.model.stopClip();
      if (s.move) {
        const mv = MOVES[s.move];
        this.move = { id: s.move, ...mv };
        this.model.play(buildAttackClip(mv), 1);
        this.model.clipTime = s.stateT;
      } else if (s.spKind) {
        // 必杀由事件驱动演出，这里保底姿态
      } else if (s.state === 'ko' || s.state === 'knockdown') {
        this.model.stopClip();
      }
    }
    this._syncModel(1 / 60);
  }
}

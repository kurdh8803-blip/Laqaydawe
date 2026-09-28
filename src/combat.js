/**
 * 战斗核心：命中判定、伤害结算、连击统计、打击停顿
 * World 同时承担「游戏规则载体」，被 main(本地) 与 net(主机端) 复用
 */
import * as THREE from 'three';
import { GAME } from './config.js';
import { SFX } from './audio.js';

export class World {
  constructor({ fighters, fx, camera }) {
    this.fighters = fighters;   // [f1, f2]
    this.fx = fx;
    this.camera = camera;
    this.hitstop = 0;           // 全局打击停顿
    this.timeScale = 1;         // KO 慢动作
    this.events = [];           // 本帧事件（联机转发用）
    this.stats = { calls: 0, hits: 0 };   // 判定统计（调试/验证用）
  }

  get running() { return true; }

  pushEvent(type, data) { this.events.push({ type, ...data }); }

  /** 距离（用于攻击可达性） */
  dist(a, b) { return Math.abs(a.x - b.x); }

  /** 判定：攻击者 atk 用 move 的数据对目标出手 */
  tryHit(atk, move, { tick = false, suck = 0 } = {}) {
    // 按身份取对手（绝不能用朝向推断——位置互换后朝向会翻转，会变成"打自己"）
    const def = this.fighters[0] === atk ? this.fighters[1] : this.fighters[0];
    if (!def || def === atk) return;
    if (def.state === 'ko') return;
    this.stats.calls++;

    // 多段技的节拍
    const now = atk.stateT;
    if (tick) {
      if (atk.hasHit && now - atk.lastHitTick < move.hitInterval) return;
    } else if (atk.hasHit) return;

    const origin = atk.hitOrigin(move);
    const cap = def.hurtCapsule();
    // 球-胶囊相交（XY 平面近似：先判 x 距离）
    const dx = Math.max(0, Math.abs(origin.x - cap.x) - cap.r);
    const cy = THREE.MathUtils.clamp(origin.y, cap.y0, cap.y1);
    const dy = origin.y - cy;
    const hitR = move.hitR;
    if (dx * dx + dy * dy > hitR * hitR) {
      return;
    }
    this.stats.hits++;

    atk.hasHit = true;
    atk.lastHitTick = now;

    // 连击计数：目标已在受击状态则延续
    const wasCombo = ['hit', 'launch', 'knockdown', 'blockstun'].includes(def.state);
    atk.comboCount = wasCombo ? atk.comboCount + 1 : 1;
    const scale = GAME.comboScaling[Math.min(atk.comboCount - 1, GAME.comboScaling.length - 1)];

    // 伤害：力量倍率 × 连段递减（多段技每段已按 hits 摊薄）
    let damage = move.damage * atk.char.stats.power * scale;

    // 乱舞吸附：拉向自己但绝不拉过身（保持同侧至少 1.15 距离，防止位置互换）
    if (suck > 0) {
      const d = atk.x - def.x;
      const dirTo = Math.sign(d) || 1;
      const pull = Math.min(suck, Math.max(0, Math.abs(d) - 1.15));
      def.x += dirTo * pull;
    }

    const dir = Math.sign(def.x - atk.x) || atk.facing;
    let isFinal = false;
    let knockback = move.knockback, launch = move.launch || 0, knockdown = !!move.knockdown;
    if (tick && move.hits) {
      const hitDone = atk.comboTick = (atk.comboTick || 0) + 1;
      if (hitDone >= move.hits) {
        isFinal = true;
        knockback = move.finalKnockback ?? knockback * 2;
        knockdown = !!move.finalKnockdown;
        launch = move.launch || 0;
        damage *= 1.6;   // 末段加成
      }
    }

    const result = def.takeHit(atk, {
      damage, hitstun: move.hitstun, blockstun: move.blockstun,
      knockback, launch, knockdown, dir, heavy: !!move.heavy,
    });

    // 打击停顿 + 特效 + 音效（多段 tick 命中使用短停顿，避免连环冻结锁死画面）
    const heavy = !!move.heavy;
    const stopTime = (tick ? 0.045 : heavy ? GAME.hitstopHeavy : GAME.hitstop);
    this.hitstop = Math.max(this.hitstop, stopTime);
    const hitPos = origin.clone();
    if (result === 'block') {
      SFX.block();
      this.fx.sparks(hitPos, 0x9fd8ff, 8, 4);
      this.pushEvent('fx', { kind: 'sparks', x: hitPos.x, y: hitPos.y, z: hitPos.z, color: 0x9fd8ff, result: 'block' });
    } else if (result !== 'whiff') {
      heavy ? SFX.hitHeavy() : SFX.hitLight();
      this.fx.sparks(hitPos, heavy ? 0xffb347 : 0xffe08a, heavy ? 20 : 12, heavy ? 8 : 5.5);
      this.pushEvent('fx', { kind: 'sparks', x: hitPos.x, y: hitPos.y, z: hitPos.z, color: heavy ? 0xffb347 : 0xffe08a, big: heavy, result: 'hit' });
      this.camera.addShake(heavy ? 0.5 : 0.22);
      if (heavy) this.camera.addZoomPunch(0.25);
      if (result === 'ko') {
        SFX.ko();
        this.fx.ring(hitPos, 0xffd76b, 2.4, 0.55);
        this.fx.flash(0.55);
        this.camera.addShake(0.9);
        this.pushEvent('fx', { kind: 'ko' });
      }
    }

    // 攻击方回气（命中多、挥空少）
    atk.meter = Math.min(100, atk.meter + (move.meterGain || 6) * (result === 'block' ? 0.4 : 1));
    if (atk.meter >= 100 && !atk._meterNotified) {
      atk._meterNotified = true;
      SFX.meterFull();
      this.pushEvent('meterfull', { who: atk.isP1 ? 'p1' : 'p2' });
    }
    if (atk.meter < 100) atk._meterNotified = false;

    this.pushEvent('hitinfo', {
      attacker: atk.isP1 ? 'p1' : 'p2', combo: atk.comboCount, damage: Math.round(damage), result,
    });
    return true;
  }

  /** 招式结束时的挥空回气 */
  grantWhiffMeter(f) {
    if (f.move && !f.hasHit) {
      f.meter = Math.min(100, f.meter + (f.move.whiffMeter || 2));
    }
  }

  /** 分离重叠：两角色互相推开 */
  resolveCollision() {
    const [a, b] = this.fighters;
    if (!a || !b) return;
    const minD = (a.scale + b.scale) * 0.56;
    const d = b.x - a.x;
    const ad = Math.abs(d);
    if (ad < minD && ad > 1e-4) {
      const push = (minD - ad) / 2;
      const s = Math.sign(d);
      // 倒地者不推
      if (a.state !== 'knockdown' && a.state !== 'ko') a.x -= push * s;
      if (b.state !== 'knockdown' && b.state !== 'ko') b.x += push * s;
    } else if (ad <= 1e-4) {
      a.x -= 0.05; b.x += 0.05;
    }
  }

  /** 推进一帧（含 hitstop / 慢动作）。返回本帧事件列表 */
  step(dt, inputs) {
    this.events = [];
    // 输入捕获必须无条件执行：打击停顿期间玩家的按键也要进入攻击缓冲，
    // 否则大招连段的长冻结会把后续操作静默吞掉
    const captured = [];
    for (let i = 0; i < this.fighters.length; i++) {
      const inp = inputs ? inputs[i] : null;
      captured.push({
        held: inp ? inp.held : {},
        just: inp ? inp.just : {},
        hasInp: !!inp,
      });
    }

    // 打击停顿：画面冻结但相机/特效照常，输入仍进缓冲
    if (this.hitstop > 0) {
      for (let i = 0; i < this.fighters.length; i++) {
        const c = captured[i];
        if (c.hasInp) this.fighters[i].setInput(c.held, c.just);
      }
      this.hitstop -= dt;
      this.fx.update(dt);
      return this.events;
    }
    const sdt = dt * this.timeScale;

    for (let i = 0; i < this.fighters.length; i++) {
      const f = this.fighters[i];
      const c = captured[i];
      f.setInput(c.held, c.just);
      f.update(sdt, this.fighters[1 - i], this);
      // 挥空回气（招式刚结束时）
      if (f.state !== 'attack' && f._lastWasAttack) this.grantWhiffMeter(f);
      f._lastWasAttack = f.state === 'attack';
    }
    // 普通攻击判定窗口
    for (const f of this.fighters) {
      if (f.state === 'attack' && f.move) {
        const mv = f.move;
        if (f.stateT >= mv.startup && f.stateT < mv.startup + mv.active) {
          this.tryHit(f, mv, {});
        }
      }
    }
    this.resolveCollision();
    this.fx.update(dt);
    return this.events;
  }
}

/**
 * 简易格斗 AI —— 人机练习/联机掉线兜底
 * 行为：接近 → 择距离出招 / 偶尔防御 / 能量满放必杀 / 偶尔闪避跳入
 */
import { emptyInput } from './config.js';

export class AIController {
  constructor(difficulty = 1) {
    this.difficulty = difficulty;   // 0 易 1 中 2 难
    this.think = 0;
    this.plan = 'approach';
    this.planT = 0;
    this.input = emptyInput();
    this.holdFrames = 0;
  }

  update(dt, me, foe) {
    const inp = emptyInput();
    this.planT += dt;
    if (this.holdFrames > 0) {
      this.holdFrames--;
      return this._held || inp;
    }
    const dist = Math.abs(foe.x - me.x);
    const dirToFoe = Math.sign(foe.x - me.x) || 1;
    const rnd = () => Math.random();

    // 决策间隔（难度越高越快）
    if (this.planT > 0.28 - this.difficulty * 0.07) {
      this.planT = 0;
      const r = rnd();
      if (me.meter >= 100 && dist < 2.6 && r < 0.75) this.plan = 'special';
      else if (foe.state === 'attack' && dist < 2.4 && r < 0.3 + this.difficulty * 0.2) this.plan = 'block';
      else if (dist > 2.2) this.plan = r < 0.8 ? 'approach' : 'jumpin';
      else if (dist > 1.3) this.plan = r < 0.55 ? 'approach' : r < 0.75 ? 'poke' : 'block';
      else this.plan = r < 0.5 ? 'combo' : r < 0.7 ? 'poke' : r < 0.85 ? 'block' : 'retreat';
    }

    switch (this.plan) {
      case 'approach':
        inp[dirToFoe > 0 ? 'right' : 'left'] = true;
        if (dist < 1.5) this.plan = 'combo';
        break;
      case 'retreat':
        inp[dirToFoe > 0 ? 'left' : 'right'] = true;
        if (this.planT > 0.3) this.plan = 'approach';
        break;
      case 'block':
        inp.down = true;
        if (this.planT > 0.5) this.plan = 'approach';
        break;
      case 'poke':
        this._press(rnd() < 0.5 ? 'lk' : 'lp', inp);
        this.plan = 'approach';
        break;
      case 'combo':
        this._press('lp', inp);
        this._queue = 'hp';
        this.plan = 'combob';
        break;
      case 'combob':
        this._press(this._queue || 'hp', inp);
        this._queue = null;
        this.plan = 'approach';
        break;
      case 'jumpin':
        inp.up = true;
        inp[dirToFoe > 0 ? 'right' : 'left'] = true;
        if (me.y > 0.8) { this._press('hk', inp); this.plan = 'approach'; }
        if (this.planT > 1.0) this.plan = 'approach';
        break;
      case 'special':
        this._press('sp', inp);
        this.plan = 'approach';
        break;
    }
    this._held = inp;
    this.holdFrames = 2;   // 按住 2-3 帧模拟人类按键
    return inp;
  }

  _press(key, inp) { inp[key] = true; }
}

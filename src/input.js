/**
 * 键盘输入：区分「按住」与「刚按下」，映射两位玩家
 */
import { CONTROLS, emptyInput } from './config.js';

export class Input {
  constructor() {
    this.held = { p1: emptyInput(), p2: emptyInput() };
    this.just = { p1: emptyInput(), p2: emptyInput() };
    this.enabled = { p1: true, p2: true };
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    // 失焦时按住的键会收不到 keyup，全部释放避免「按键卡死」
    window.addEventListener('blur', () => {
      this.held = { p1: emptyInput(), p2: emptyInput() };
      this.just = { p1: emptyInput(), p2: emptyInput() };
    });
    // 防止空格/方向键滚动页面
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
  }

  _key(e, down) {
    for (const pid of ['p1', 'p2']) {
      const map = CONTROLS[pid];
      for (const [action, codes] of Object.entries(map)) {
        const list = Array.isArray(codes) ? codes : [codes];
        if (list.includes(e.code)) {
          if (down && !this.held[pid][action]) this.just[pid][action] = true;
          this.held[pid][action] = down;
        }
      }
    }
  }

  /** 每帧末清除 just */
  flush() {
    for (const pid of ['p1', 'p2']) {
      for (const k of Object.keys(this.just[pid])) this.just[pid][k] = false;
    }
  }

  /** 联机 guest 的输入直接注入 */
  inject(pid, held) {
    const j = {};
    for (const k of Object.keys(held)) {
      j[k] = held[k] && !this.held[pid][k];
    }
    this.held[pid] = { ...held };
    this.just[pid] = j;
  }
}

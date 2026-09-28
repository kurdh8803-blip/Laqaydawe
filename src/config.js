/** 全局配置：物理、按键映射、战斗数值 */

export const ARENA = {
  halfWidth: 9.5,      // 左右墙
  groundY: 0,
};

export const PHYS = {
  gravity: 26,
  jumpVel: 9.2,
};

export const GAME = {
  roundTime: 60,
  roundsToWin: 2,
  hitstop: 0.085,       // 命中停顿（帧收益的打击感核心）
  hitstopHeavy: 0.13,
  slowmoKO: 0.28,       // KO 慢动作时间缩放
  comboScaling: [1.0, 0.8, 0.65, 0.52, 0.42, 0.35],  // 连招伤害递减
};

/** 按键映射（KeyboardEvent.code；一个动作可绑定多个键，兼容无小键盘的笔记本） */
export const CONTROLS = {
  p1: {
    left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS',
    lp: 'Space', hp: 'ShiftLeft', lk: 'KeyE', hk: 'KeyQ',
    sp: 'KeyF',
  },
  p2: {
    left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
    lp: ['Numpad1', 'Digit1'], hp: ['Numpad2', 'Digit2'],
    lk: ['Numpad4', 'Digit4'], hk: ['Numpad5', 'Digit5'],
    sp: ['Numpad3', 'Digit3'],
  },
};

/** 输入快照（联机传输用） */
export function emptyInput() {
  return { left: false, right: false, up: false, down: false, lp: false, hp: false, lk: false, hk: false, sp: false };
}

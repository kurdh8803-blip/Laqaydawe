/**
 * WebAudio 合成音效 —— 无外部资源：挥拳、命中、防御、KO、必杀、UI
 */
let ctx = null;
let master = null;

function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (e) {
      // 无音频环境时静默降级
      ctx = null; master = null;
      throw new NoAudioError();
    }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
class NoAudioError extends Error {}
/** 所有音效入口的安全包装：无声环境不阻塞游戏逻辑（保留 this 以支持内部互调） */
function safe(fn) {
  return function (...args) {
    try { return fn.apply(this, args); } catch (e) { /* ignore */ }
  };
}

let _noise = null;
function noiseBuf(_dur = 0.3) {
  const c = ac();
  if (!_noise) {   // 共享 1 秒白噪声缓冲，避免每次命中都分配
    _noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = _noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return _noise;
}

function env(g, t0, a, peak, dur) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

const SFX = {
  whoosh() {
    const c = ac(), t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = noiseBuf(0.18);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.1); f.Q.value = 1.2;
    const g = c.createGain(); env(g, t, 0.01, 0.25, 0.16);
    src.connect(f).connect(g).connect(master); src.start(t);
  },
  whooshHeavy() {
    const c = ac(), t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = noiseBuf(0.26);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.16); f.Q.value = 1;
    const g = c.createGain(); env(g, t, 0.015, 0.4, 0.24);
    src.connect(f).connect(g).connect(master); src.start(t);
  },
  hitLight() {
    const c = ac(), t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.09);
    const g = c.createGain(); env(g, t, 0.004, 0.7, 0.1);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.12);
    const src = c.createBufferSource(); src.buffer = noiseBuf(0.08);
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
    const g2 = c.createGain(); env(g2, t, 0.002, 0.3, 0.07);
    src.connect(f).connect(g2).connect(master); src.start(t);
  },
  hitHeavy() {
    const c = ac(), t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.16);
    const g = c.createGain(); env(g, t, 0.005, 1.0, 0.2);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.24);
    const src = c.createBufferSource(); src.buffer = noiseBuf(0.14);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
    const g2 = c.createGain(); env(g2, t, 0.003, 0.55, 0.13);
    src.connect(f).connect(g2).connect(master); src.start(t);
  },
  block() {
    const c = ac(), t = c.currentTime;
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.08);
    const g = c.createGain(); env(g, t, 0.003, 0.3, 0.09);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.1);
  },
  ko() {
    const c = ac(), t = c.currentTime;
    // 重低音砰
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const g = c.createGain(); env(g, t, 0.005, 1.2, 0.6);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.65);
    // 锣声
    const o2 = c.createOscillator(); o2.type = 'square';
    o2.frequency.setValueAtTime(660, t + 0.05);
    const g2 = c.createGain(); env(g2, t + 0.05, 0.01, 0.16, 0.9);
    o2.connect(g2).connect(master); o2.start(t + 0.05); o2.stop(t + 1.0);
  },
  special() {
    const c = ac(), t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(880, t + 0.35);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
    const g = c.createGain(); env(g, t, 0.02, 0.4, 0.4);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.45);
  },
  rush() {
    const c = ac(), t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = noiseBuf(0.7);
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1800, t + 0.4);
    const g = c.createGain(); env(g, t, 0.05, 0.55, 0.65);
    src.connect(f).connect(g).connect(master); src.start(t);
  },
  fly() {
    const c = ac(), t = c.currentTime;
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(1200, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(400, t + 0.6);
    const g = c.createGain(); env(g, t, 0.02, 0.4, 0.65);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.7);
  },
  flurry() {
    this.whooshHeavy();
    setTimeout(() => this.hitLight(), 90);
  },
  upper() {
    const c = ac(), t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.22);
    const g = c.createGain(); env(g, t, 0.01, 0.5, 0.3);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.35);
  },
  jump() { this.whoosh(); },
  land() {
    const c = ac(), t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(100, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.1);
    const g = c.createGain(); env(g, t, 0.004, 0.3, 0.11);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.13);
  },
  select() {
    const c = ac(), t = c.currentTime;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 880;
    const g = c.createGain(); env(g, t, 0.005, 0.12, 0.07);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.09);
  },
  confirm() {
    const c = ac(), t = c.currentTime;
    [523, 659, 784].forEach((fq, i) => {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = fq;
      const g = c.createGain(); env(g, t + i * 0.07, 0.005, 0.14, 0.12);
      o.connect(g).connect(master); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.14);
    });
  },
  roundBell() {
    const c = ac(), t = c.currentTime;
    [880, 1108].forEach((fq, i) => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fq;
      const g = c.createGain(); env(g, t + i * 0.18, 0.01, 0.3, 0.5);
      o.connect(g).connect(master); o.start(t + i * 0.18); o.stop(t + i * 0.18 + 0.55);
    });
  },
  meterFull() {
    const c = ac(), t = c.currentTime;
    [660, 880, 1320].forEach((fq, i) => {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = fq;
      const g = c.createGain(); env(g, t + i * 0.05, 0.005, 0.16, 0.2);
      o.connect(g).connect(master); o.start(t + i * 0.05); o.stop(t + i * 0.05 + 0.22);
    });
  },
};

// 导出安全包装版：无声环境（如无用户手势/无音频设备）下不阻塞游戏逻辑
const SafeSFX = {};
for (const k of Object.keys(SFX)) SafeSFX[k] = safe(SFX[k]);
export { SafeSFX as SFX };

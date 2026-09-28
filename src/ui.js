/**
 * DOM UI：HUD (شریتی خوێن/شریتی وزە/کاتی خولی یاری/ژمارەی کۆمبۆ)، ڕاگەیاندنی ناوەڕاست، ئەنجامی یاری، ڕووکاری هەڵبژاردنی کاراکتەر
 */

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.hpView = { p1: { cur: 1, ghost: 1 }, p2: { cur: 1, ghost: 1 } };
    this.meterView = { p1: 0, p2: 0 };
    this.announceTimer = null;
    // هەڵگرتنی بەستەری DOM + نرخی دوایین نووسین (بۆ ڕێگریکردن لە دووبارەکردنەوەی هەژمارکردنی ستایل لە هەر فریمێکدا)
    this.el = {
      p1fill: $('p1-fill'), p1ghost: $('p1-ghost'), p1meter: $('p1-meter'), p1glow: $('p1-meter-glow'), p1pips: $('p1-pips'),
      p2fill: $('p2-fill'), p2ghost: $('p2-ghost'), p2meter: $('p2-meter'), p2glow: $('p2-meter-glow'), p2pips: $('p2-pips'),
      timer: $('timer'),
    };
    this._last = { p1fill: -1, p1ghost: -1, p1meter: -1, p2fill: -1, p2ghost: -1, p2meter: -1, timer: '', glow1: null, glow2: null, pips1: 0, pips2: 0 };
  }

  _setBar(elRef, key, v) {
    if (Math.abs(this._last[key] - v) > 0.001) {
      this._last[key] = v;
      elRef.style.transform = `scaleX(${v})`;
    }
  }

  // ---------- گۆڕینی ڕووکار ----------
  show(id) { $(id).classList.remove('hidden'); }
  hide(id) { $(id).classList.add('hidden'); }
  showOnly(ids) {
    for (const s of ['screen-title', 'screen-select', 'screen-result', 'hud', 'ctrl-hint']) this.hide(s);
    for (const s of ids) this.show(s);
  }

  // ---------- HUD ----------
  bindHud(f1, f2) {
    $('p1-name').textContent = `P1 ${f1.char.name}`;
    $('p2-name').textContent = `P2 ${f2.char.name}`;
  }

  updateHud(f1, f2, dt) {
    const E = this.el, L = this._last;
    const side = (p, f) => {
      const v = this.hpView[p];
      const ratio = Math.max(0, f.hp / f.maxHp);
      v.cur += (ratio - v.cur) * Math.min(1, dt * 22);
      if (v.ghost > ratio) v.ghost = Math.max(ratio, v.ghost - dt * 0.22);
      else v.ghost = ratio;
      this._setBar(E[`${p}fill`], `${p}fill`, v.cur);
      this._setBar(E[`${p}ghost`], `${p}ghost`, v.ghost);
      const mt = f.meter / 100;
      this.meterView[p] += (mt - this.meterView[p]) * Math.min(1, dt * 14);
      this._setBar(E[`${p}meter`], `${p}meter`, this.meterView[p]);
      const glowOn = f.meter >= 100;
      if (L[`${p === 'p1' ? 'glow1' : 'glow2'}`] !== glowOn) {
        L[`${p === 'p1' ? 'glow1' : 'glow2'}`] = glowOn;
        E[`${p}glow`].classList.toggle('hidden', !glowOn);
      }
      const pipKey = p === 'p1' ? 'pips1' : 'pips2';
      if (L[pipKey] !== f.roundsWon) {
        L[pipKey] = f.roundsWon;
        const children = E[`${p}pips`].children;
        for (let i = 0; i < children.length; i++) children[i].classList.toggle('won', i < f.roundsWon);
      }
    };
    side('p1', f1); side('p2', f2);
  }

  setTimer(t) {
    const el = this.el.timer;
    const s = String(Math.max(0, Math.ceil(t)));
    if (this._last.timer !== s) {
      this._last.timer = s;
      el.textContent = s;
      el.style.color = Number(s) <= 10 ? '#ff6a4d' : '';
    }
  }

  showCombo(pid, count) {
    if (count < 2) return;
    const el = $(`combo-${pid}`);
    el.textContent = `${count} کۆمبۆ!`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ---------- ڕاگەیاندنی ناوەڕاست ----------
  announce(text, { dur = 1.1, size = null } = {}) {
    const el = $('announce-text');
    el.textContent = text;
    if (size) el.style.fontSize = size;
    el.classList.remove('slam');
    void el.offsetWidth;
    el.classList.add('slam');
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => { el.classList.remove('slam'); el.style.opacity = 0; }, dur * 1000);
    el.style.opacity = '';
  }

  // ---------- ئەنجامی یاری ----------
  showResult(winnerName, winnerLabel, s1, s2) {
    $('result-winner').textContent = `${winnerLabel} ${winnerName} سەرکەوت!`;
    $('result-score').textContent = `${s1} - ${s2}`;
    this.show('screen-result');
  }
}

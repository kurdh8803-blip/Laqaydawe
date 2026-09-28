/**
 * کڵایەنتی یاری لە تۆڕی ناوخۆیی (LAN) —— پێکهاتەی دەسەڵاتی ماڵەوە
 * ماڵەوە: شبیه‌سازیی تەواو جێبەجێ دەکات، لە 30Hz وێنەی دۆخ بڵاو دەکاتەوە؛ وەرگرتنی داخڵکردنی کڵایەنت
 * کڵایەنت: لە 30Hz داخڵکردنی ناوخۆیی بۆ سەرەوە دەنێرێت؛ وێنەی دۆخ وەردەگرێت و بۆ پاڵەوانی ساختە بەکاریدێنێت (ڕەندرکردنی نەرم بە نێوانگرتن)
 */
export class NetSession {
  constructor(handlers) {
    this.ws = null;
    this.role = null;         // 'host' | 'guest'
    this.handlers = handlers; // { onRole, onMatched, onPick, onReady, onStart, onCmd, onState, onInput, onClose }
    this._inputTimer = null;
    this._stateTimer = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = this.ws = new WebSocket(`${proto}://${location.host}`);
      const timeout = setTimeout(() => reject(new Error('پەیوەندی کاتی بەسەرچوو')), 5000);
      ws.onopen = () => { clearTimeout(timeout); resolve(); };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('نەتوانرا پەیوەندی بە سێرڤەرەوە بکرێت')); };
      ws.onclose = () => {
        this._stopTimers();
        this.handlers.onClose?.();
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        this.rxCount = (this.rxCount || 0) + 1;
        this.lastRx = msg.type;
        this._route(msg);
      };
    });
  }

  _route(msg) {
    const h = this.handlers;
    switch (msg.type) {
      case 'role': this.role = msg.role; h.onRole?.(msg.role); break;
      case 'matched': h.onMatched?.(); break;
      case 'pick': h.onPick?.(msg.from, msg.char); break;
      case 'ready': h.onReady?.(msg.from, msg.char); break;
      case 'cmd': h.onStart?.(msg); break;
      case 'state': if (this.role === 'guest') h.onState?.(msg); break;
      case 'input': if (this.role === 'host') h.onInput?.(msg.keys); break;
      case 'peer-left': h.onClose?.(true); break;
    }
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
      this.txCount = (this.txCount || 0) + 1;
      if (obj.type === 'state') this.stateTx = (this.stateTx || 0) + 1;
    }
  }

  /** کڵایەنت: ناردنی داخڵکردن بۆ سەرەوە */
  startInputLoop(getInput) {
    this._stopTimer('_inputTimer');
    this._getInput = getInput;
    this._inputTimer = setInterval(() => {
      if (this.role !== 'guest') return;
      this.send({ type: 'input', keys: this._getInput() });
    }, 33);
  }

  /** ماڵەوە: ناردنی وێنەی دۆخ بۆ خوارەوە */
  startStateLoop(getState) {
    this._stopTimer('_stateTimer');
    this._getState = getState;
    this._stateTimer = setInterval(() => {
      if (this.role !== 'host') return;
      const data = this._getState();
      if (data) this.send({ type: 'state', ...data });
    }, 33);
  }

  _stopTimer(key) { if (this[key]) { clearInterval(this[key]); this[key] = null; } }
  _stopTimers() { this._stopTimer('_inputTimer'); this._stopTimer('_stateTimer'); }

  /** وەستاندنی بازنەی داتا (پەیوەندی دەپارێزێت) */
  stopLoops() { this._stopTimers(); }

  destroy() {
    this._stopTimers();
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
  }
}

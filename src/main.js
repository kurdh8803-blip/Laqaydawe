/**
 * 游戏主程序：标题 → 选人 → 对战 → 结算 状态机
 * 模式：local 本地双人 / ai 人机 / net-host / net-guest（联机见 net.js 集成）
 */
import * as THREE from 'three';
import { buildStage } from './stage.js';
import { FightCamera } from './camera.js';
import { Fighter } from './fighter.js';
import { World } from './combat.js';
import { FX } from './fx.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { SFX } from './audio.js';
import { CHARACTERS, getChar } from './characters.js';
import { GAME, emptyInput } from './config.js';
import { AIController } from './ai.js';
import { FighterModel } from './model.js';

const $ = (id) => document.getElementById(id);
const BOOT_ID = Date.now().toString(36);   // 页面实例标识（截图命名用）

class Game {
  constructor() {
    this.phase = 'title';          // title / select / fight / result
    this.mode = 'local';
    this.ui = new UI();
    this.input = new Input();

    // ---------- 渲染器 ----------
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    document.body.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2e1a4d);
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 2.6, 9);
    this.fcam = new FightCamera(this.camera);

    this.stageRef = buildStage(this.scene, 'sunset');
    this.fx = new FX(this.scene);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ---------- 战斗态 ----------
    this.fighters = [];
    this.world = null;
    this.round = 1;
    this.score = [0, 0];
    this.timer = GAME.roundTime;
    this.subPhase = 'intro';       // intro / live / koSlow / roundend
    this.subT = 0;
    this.picks = [0, 1];           // 选人索引
    this.selectCursor = [0, 1];
    this.selectDone = [false, false];
    this.ai = null;
    this.aiP1 = null;
    this.demo = null;              // 'ai' | 'showcase' 演示驱动模式
    this.showcase = null;
    this.net = null;               // NetSession（局域网）
    this._stageSeq = Math.floor(Math.random() * 3);
    this._stageParam = null;
    this.netRole = null;           // 'host' | 'guest'
    this.remoteInput = {};         // 主机收到的客机输入
    this._netLatest = null;        // 客机最新快照
    this._pendingNetEvts = [];     // 主机待下发的事件
    this._isNet = false;
    this._justSnap = { p1: emptyInput(), p2: emptyInput() };   // 待消费按键事件（跨帧保留直到消费）

    this._bindMenus();
    this._clock = performance.now();
    this._acc = 0;
    this._announceQ = [];
    // 固定步长主循环：rAF 驱动 + 定时器兜底（页面被节流时也能推进，120Hz 屏不会加速）
    this.simTime = 0;
    const q = new URLSearchParams(location.search);
    this.freezeAt = Number(q.get('freeze')) || null;
    this.shotEvery = Number(q.get('shotEvery')) || null;   // 每隔 N 秒模拟时间截图回传
    this._lastShot = -9;
    this.renderer.setAnimationLoop(() => this._frame());
    this._interval = setInterval(() => this._frame(), 250);
  }

  /** 将当前渲染帧回传到开发服务器（/__shot） */
  _capture(name) {
    try {
      const url = this.renderer.domElement.toDataURL('image/png');
      fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: url }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  _frame() {
    if (this._frozen) return;
    const now = performance.now();
    const dtReal = (now - this._clock) / 1000;
    this._clock = now;
    if (dtReal <= 0 || dtReal > 2) { this.renderer.render(this.scene, this.camera); return; }
    // 帧首合并按键事件（OR 并入，不清空已有待处理项）：即便本帧没有模拟步，
    // 按键也会留在快照里等下一个模拟步消费，绝不丢失
    for (const pid of ['p1', 'p2']) {
      const src = this.input.just[pid];
      const dst = this._justSnap[pid];
      for (const k in src) if (src[k]) dst[k] = true;
    }
    this.input.flush();
    // 测试参数：运行到指定模拟时刻后冻结（便于对特定姿势截图）
    if (this.freezeAt != null && this.simTime >= this.freezeAt) {
      this._frozen = true;
      this.renderer.setAnimationLoop(null);
      clearInterval(this._interval);
      this.renderer.render(this.scene, this.camera);
      this._capture(`${BOOT_ID}_freeze${this.freezeAt}`);
      return;
    }
    // 周期性截图回传
    if (this.shotEvery && this.simTime - this._lastShot >= this.shotEvery) {
      this._lastShot = this.simTime;
      this._capture(`${BOOT_ID}_t${this.simTime.toFixed(2)}`);
    }
    this._acc += dtReal;
    const step = 1 / 60;
    let n = Math.floor(this._acc / step);
    this._acc -= n * step;
    n = Math.min(n, 30);
    for (let i = 0; i < n; i++) {
      this.simTime += step;
      this.tick(step);
      if (i === 0) {   // just 已被首个模拟步消费，复位等待下一次按键
        this._justSnap = { p1: emptyInput(), p2: emptyInput() };
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ================= 菜单 =================
  _bindMenus() {
    $('btn-local').onclick = () => { this._click(); this.mode = 'local'; this.enterSelect(); };
    $('btn-vsai').onclick = () => { this._click(); this.mode = 'ai'; this.enterSelect(); };
    $('btn-lan').onclick = () => { this._click(); this.openNetPanel(); };
    $('btn-select-back').onclick = () => {
      this._click();
      if (this._isNet) this.net?.send({ type: 'cmd', cmd: 'menu' });
      this.exitToTitle();
    };
    $('btn-rematch').onclick = () => {
      this._click();
      if (this._isNet) { this.net?.send({ type: 'cmd', cmd: 'rematch' }); return; }   // 双方都会收到回声并各自重开
      this.ui.hide('screen-result');
      this.score = [0, 0]; this.round = 1;
      this.startMatch(this.picks[0], this.picks[1]);
    };
    $('btn-to-menu').onclick = () => {
      this._click();
      if (this._isNet) this.net?.send({ type: 'cmd', cmd: 'menu' });
      this.exitToTitle();
    };
  }

  _click() { SFX.select(); document.activeElement?.blur?.(); }

  /** 局域网联机面板 */
  openNetPanel() {
    const panel = $('net-panel'), status = $('net-status');
    panel.classList.remove('hidden');
    status.textContent = '正在连接服务器…';
    $('btn-net-cancel').onclick = () => { this.net?.destroy(); this.net = null; panel.classList.add('hidden'); };

    import('./net.js').then(async ({ NetSession }) => {
      try {
        this.net?.destroy();
        this.net = new NetSession(this._netHandlers());
        await this.net.connect();
        status.textContent = '已连接，正在匹配对手…';
        this.net.send({ type: 'join' });
      } catch (e) {
        status.textContent = e.message + '（请确认已在项目目录运行 node server.js）';
      }
    });
  }

  _netHandlers() {
    return {
      onRole: (role) => {
        this.netRole = role;
        $('net-status').textContent = role === 'host'
          ? '房间已创建，等待对手加入…（把局域网地址发给朋友）'
          : '已找到房间，正在握手…';
      },
      onMatched: () => {
        $('net-panel').classList.add('hidden');
        this.mode = this.netRole === 'host' ? 'net-host' : 'net-guest';
        SFX.confirm();
        this.enterSelect();
        // 测试参数：自动确认选人
        if (this.__autoPick != null) {
          setTimeout(() => {
            const slot = this._localSlot();
            const idx = Number(this.__autoPick);
            this.selectCursor[slot] = idx;
            this.picks[slot] = idx;
            this.selectDone[slot] = true;
            this._refreshSelectVisual();
            this.net?.send({ type: 'ready', char: idx });
            this._netMaybeStartMatch();
          }, 900);
        }
      },
      // 远端光标镜像
      onPick: (from, idx) => {
        const slot = from === 'host' ? 0 : 1;
        if (!this.selectDone[slot]) this.selectCursor[slot] = idx;
        else this.picks[slot] = idx;
        this._refreshSelectVisual();
      },
      // 远端确认
      onReady: (from, idx) => {
        const slot = from === 'host' ? 0 : 1;
        this.selectCursor[slot] = idx;
        this.picks[slot] = idx;
        this.selectDone[slot] = true;
        SFX.confirm();
        this._refreshSelectVisual();
        this._netMaybeStartMatch();
      },
      // 主机广播：开始比赛 / 重赛
      onStart: (msg) => {
        if (msg.cmd === 'start') {
          this.picks = [msg.c1, msg.c2];
          this.startMatch(msg.c1, msg.c2);
        } else if (msg.cmd === 'rematch') {
          this.ui.hide('screen-result');
          this.score = [0, 0]; this.round = 1;
          this.startMatch(this.picks[0], this.picks[1]);
        } else if (msg.cmd === 'menu') {
          this.exitToTitle();
        }
      },
      onState: (snap) => this._applyNetState(snap),
      onInput: (keys) => { this.remoteInput = keys || {}; },
      onClose: (peerLeft) => {
        const wasInGame = this.phase !== 'title';
        this.exitToTitle();
        this.net?.destroy(); this.net = null; this.netRole = null; this._isNet = false;
        if (wasInGame) this.ui.announce(peerLeft ? '对手已离开' : '与服务器断开', { dur: 1.8, size: 'clamp(28px,5vw,50px)' });
      },
    };
  }

  /** 联机选人时的本地输入聚合（两套键位都作用于自己的光标） */
  _localSlot() { return this.mode === 'net-host' ? 0 : 1; }

  _netMaybeStartMatch() {
    if (this.phase !== 'select' || this.mode !== 'net-host') return;
    if (this.selectDone[0] && this.selectDone[1]) {
      this.net?.send({ type: 'cmd', cmd: 'start', c1: this.picks[0], c2: this.picks[1] });
      this.startMatch(this.picks[0], this.picks[1]);
    }
  }

  exitToTitle() {
    this.phase = 'title';
    this._teardownFighters();
    this.ui.showOnly(['screen-title']);
  }

  _teardownFighters() {
    // 释放 GPU 资源（几何体/材质/专属贴图），防止多局对战后显存泄漏导致的渐进卡顿
    for (const f of this.fighters) f.model.dispose();
    this.fighters = [];
    this.world = null;
    this.fx.clear();
    this.net?.stopLoops();
    this._pendingNetEvts = [];
  }

  // ================= 选人 =================
  enterSelect() {
    this.phase = 'select';
    this.selectCursor = [0, 1];
    this.selectDone = [false, false];
    this._selHold = [{ dir: 0, t: 0 }, { dir: 0, t: 0 }];   // 按住状态差分的记忆
    this._isNet = this.mode === 'net-host' || this.mode === 'net-guest';
    this.ui.showOnly(['screen-select']);
    $('select-sub').textContent = this.mode === 'ai'
      ? '第一步：选你的角色（A/D 或 ←/→ 移动，空格 / 小键盘1 / 数字1 确认）'
      : this._isNet
        ? `你是 ${this.mode === 'net-host' ? 'P1（左侧）' : 'P2（右侧）'}，A/D 或 ←/→ 移动光标，空格确认`
        : 'P1 与 P2 分别移动光标，按轻拳键确认';
    $('select-foot').innerHTML = this._isNet
      ? '等待双方确认后自动开始'
      : 'P1：<b>A/D</b> 移动 · <b>空格</b> 确认　　P2：<b>←/→</b> 移动 · <b>小键盘1</b> 确认';
    this._buildCharCards();
    SFX.roundBell();
  }

  _buildCharCards() {
    const grid = $('char-grid');
    grid.innerHTML = '';
    for (let i = 0; i < CHARACTERS.length; i++) {
      const c = CHARACTERS[i];
      const card = document.createElement('div');
      card.className = 'char-card';
      card.id = `card-${c.id}`;
      const img = document.createElement('img');
      fillPortraitAsync(card, img, c, i);
      img.style.cssText = 'width:150px;height:150px;object-fit:contain;margin:0 auto;display:block';
      card.appendChild(img);
      card.insertAdjacentHTML('beforeend', `
        <div class="char-name">${c.name}</div>
        <div class="char-title">${c.title}</div>
        <div class="stat-row"><span class="stat-label">力量</span><span class="stat-dots">${dots(c.stats.power, 1.25)}</span></div>
        <div class="stat-row"><span class="stat-label">速度</span><span class="stat-dots">${dots(c.stats.walk, 3.2)}</span></div>
        <div class="stat-row"><span class="stat-label">体力</span><span class="stat-dots">${dots(c.stats.maxHp, 1150)}</span></div>
        <div class="char-tip" style="font-size:11px;color:rgba(255,243,220,.55);margin-top:6px">必杀：${c.stats.specialName}</div>
      `);
      grid.appendChild(card);
    }
    this._refreshSelectVisual();
  }

  _refreshSelectVisual() {
    for (let i = 0; i < CHARACTERS.length; i++) {
      const card = $(`card-${CHARACTERS[i].id}`);
      card.classList.toggle('p1-cursor', this.selectCursor[0] === i);
      card.classList.toggle('p2-cursor', this.selectCursor[1] === i);
      // 确认标签
      card.querySelectorAll('.pick-tag').forEach(e => e.remove());
      if (this.selectDone[0] && this.picks[0] === i) {
        card.insertAdjacentHTML('beforeend', '<div class="pick-tag t1">P1 ✓</div>');
      }
      if (this.selectDone[1] && this.picks[1] === i && this.mode !== 'ai') {
        card.insertAdjacentHTML('beforeend', '<div class="pick-tag t2">P2 ✓</div>');
      }
    }
  }

  updateSelect(dt = 1 / 60) {
    if (this.phase !== 'select') return;
    if (!this._selHold) this._selHold = [{ dir: 0, t: 0 }, { dir: 0, t: 0 }];
    const held1 = this.input.held.p1, held2 = this.input.held.p2;
    const n = CHARACTERS.length;
    const isNet = this.mode === 'net-host' || this.mode === 'net-guest';

    const stepCursor = (slot, dir) => {
      this.selectCursor[slot] = (this.selectCursor[slot] + dir + n) % n;
      SFX.select();
      this._refreshSelectVisual();
      if (isNet && slot === this._localSlot()) this.net?.send({ type: 'pick', char: this.selectCursor[slot] });
    };

    // 纯按住状态差分驱动：不依赖按键事件管线，方向键按住就一定会移动
    // （首次/变向立即走一格，按住 0.28s 后以 0.13s 间隔连移 —— 街机选人手感）
    const nav = (slot, held) => {
      const h = this._selHold[slot];
      const dir = (held.left ? -1 : 0) + (held.right ? 1 : 0);
      if (dir !== 0 && h.dir !== dir) { stepCursor(slot, dir); h.dir = dir; h.t = -0.28; return; }
      if (dir !== 0) {
        h.t += dt;
        if (h.t >= 0.13) { h.t = 0; stepCursor(slot, dir); }
      } else h.dir = 0;
    };
    // 确认/取消同样用 held 差分沿检测，事件管线彻底不参与
    const edge = (slot, v, tag) => {
      const h = this._selHold[slot], k = '_' + tag;
      const r = v && !h[k];
      h[k] = v;
      return r;
    };

    // 联机：两套键位都作用于本地玩家
    const both = {
      left: held1.left || held2.left, right: held1.right || held2.right,
      ok: held1.lp || held2.lp || held1.hp || held2.hp || held1.sp || held2.sp,
      cancel: held1.hk || held2.hk,
    };

    if (isNet) {
      const slot = this._localSlot();
      if (!this.selectDone[slot]) {
        nav(slot, both);
        if (edge(slot, both.ok, 'c')) {
          this.picks[slot] = this.selectCursor[slot];
          this.selectDone[slot] = true;
          SFX.confirm();
          this._refreshSelectVisual();
          this.net?.send({ type: 'ready', char: this.picks[slot] });
          this._netMaybeStartMatch();
        } else if (edge(slot, both.cancel, 'x')) {
          this.net?.send({ type: 'cmd', cmd: 'menu' });
          this.exitToTitle();
        }
      }
      return;
    }

    if (!this.selectDone[0]) {
      // 人机模式：两套键位都可操控（含 小键盘1/数字1 确认）
      const h1 = this.mode === 'ai' ? both : held1;
      nav(0, h1);
      const ok1 = this.mode === 'ai' ? both.ok : (held1.lp || held1.hp);
      if (edge(0, ok1, 'c')) {
        this.picks[0] = this.selectCursor[0];
        this.selectDone[0] = true;
        SFX.confirm();
        this._refreshSelectVisual();
        if (this.mode === 'ai') {
          // 第二步：玩家为 AI 挑对手（光标从主角右边一格开始）
          this.selectCursor[1] = (this.picks[0] + 1) % n;
          // 关键：吞掉本次仍按住的确认键 —— 否则同一次按键会立刻确认第二步，
          // 玩家必须松开再按才能为 AI 定角色
          this._selHold[1]._c = true;
          $('select-sub').textContent = '第二步：为 AI 选择对手（同样的键位，确认后开战）';
          this._refreshSelectVisual();
        }
      } else if (edge(0, this.mode === 'ai' ? both.cancel : held1.hk, 'x')) {
        this.exitToTitle(); return;   // Q 取消
      }
    }
    if (this.mode === 'ai' && this.selectDone[0] && !this.selectDone[1]) {
      nav(1, both);
      if (edge(1, both.ok, 'c')) {
        this.picks[1] = this.selectCursor[1];
        this.selectDone[1] = true;
        SFX.confirm();
        this._refreshSelectVisual();
      }
    }
    if (this.mode === 'ai' && this.selectDone[0] && this.selectDone[1]) {
      // 双方确认后倒计时开局（与本地模式一致）
      this._selectGoT = (this._selectGoT ?? 0.8) - dt;
      if (this._selectGoT <= 0) { this._selectGoT = null; this.startMatch(this.picks[0], this.picks[1]); }
    }
    if (this.mode === 'local' && !this.selectDone[1]) {
      nav(1, held2);
      if (edge(1, held2.lp || held2.hp, 'c')) {
        this.picks[1] = this.selectCursor[1];
        this.selectDone[1] = true;
        SFX.confirm();
        this._refreshSelectVisual();
      } else if (edge(1, held2.hk, 'x')) {
        this.exitToTitle(); return;
      }
    }
    if (this.selectDone[0] && this.selectDone[1] && this.mode === 'local') {
      this._selectGoT = (this._selectGoT ?? 0.8) - dt;
      if (this._selectGoT <= 0) { this._selectGoT = null; this.startMatch(this.picks[0], this.picks[1]); }
    }
  }

  // ================= 比赛 =================
  startMatch(pick1, pick2) {
    this._teardownFighters();
    // 舞台轮换（可用 &stage=night|forest|sunset 固定）
    const order = ['sunset', 'night', 'forest'];
    const stageId = this._stageParam || order[(this._stageSeq++) % order.length];
    this.stageRef?.dispose();
    this.stageRef = buildStage(this.scene, stageId);
    this.round = 1; this.score = [0, 0];
    const c1 = getChar(CHARACTERS[pick1].id);
    const c2 = getChar(CHARACTERS[pick2].id);

    const f1 = new Fighter(c1, { index: 0, x: -3.2, facing: 1, onEvent: (t, d) => this._onFighterEvent(t, d) });
    const f2 = new Fighter(c2, { index: 1, x: 3.2, facing: -1, onEvent: (t, d) => this._onFighterEvent(t, d) });
    this.fighters = [f1, f2];
    this.scene.add(f1.model.root, f2.model.root);
    this.world = new World({ fighters: this.fighters, fx: this.fx, camera: this.fcam });

    this.ui.showOnly(['hud', 'ctrl-hint']);
    this.ui.bindHud(f1, f2);
    this._isNet = this.mode === 'net-host' || this.mode === 'net-guest';
    this.ai = this.mode === 'ai' ? new AIController(1) : null;
    this.aiP1 = null;
    this.showcase = null;
    this.remoteInput = {}; this._prevRemote = {};

    // 联机数据通道
    if (this.net) {
      if (this.mode === 'net-host') {
        if (window.__AUTO_PILOT) this.aiP1 = new AIController(1);   // 测试：主机自动出招
        this.net.startStateLoop(() => this._netSnap());
      } else if (this.mode === 'net-guest') {
        if (window.__AUTO_PILOT) this._apAI = new AIController(1);  // 测试：客机自动驾驶上行
        this.net.startInputLoop(() => this._apInp || { ...emptyInput(), ...this.input.held.p2 });
      }
    }

    // 演示驱动（URL ?demo=ai / ?demo=showcase）：用于自动化验证与展示
    if (this.demo === 'ai') {
      this.aiP1 = new AIController(1);
      this.ai ??= new AIController(1);
    } else if (this.demo === 'showcase') {
      const q = new URLSearchParams(location.search);
      const seq = q.get('spOnly') ? ['special', 'special', 'back'] : ['lp', 'hp', 'lk', 'hk', 'jump', 'block', 'dodge', 'special'];
      this.showcase = { seq, i: 0, _wait: 0.6, _taps: 0, _tapT: 0, _airHit: false };
      if (q.get('full')) f1.meter = 100;   // 快速验证必杀
    }

    this.phase = 'fight';
    this._beginRound();
    // 预编译着色器：避免双方首次出招/命中特效时的编译尖峰
    requestAnimationFrame(() => {
      try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* ignore */ }
    });
  }

  _beginRound() {
    const [f1, f2] = this.fighters;
    for (const f of this.fighters) {
      f.hp = f.maxHp;
      f.x = f.isP1 ? -3.2 : 3.2;
      f.y = 0; f.vx = 0; f.vy = 0;
      f.facing = f.isP1 ? 1 : -1;
      f._syncFacing();
      f.state = 'idle'; f.stateT = 0;
      f.comboCount = 0;
      f.meter = Math.min(f.meter, 100);   // 能量跨回合保留
      f.renderX = null;
    }
    this.timer = GAME.roundTime;
    this.subPhase = 'intro'; this.subT = 0;
    this.world.timeScale = 1;
    this.world.hitstop = 0;
    this.ui.setTimer(this.timer);
    this.ui.announce(`ROUND ${this.round}`, { dur: 1.0 });
    SFX.roundBell();
    if (this._isNet) this.netEvt({ k: 'round', n: this.round });   // 转发给客机
  }

  _onFighterEvent(type, data) {
    const f = data.who;
    switch (type) {
      case 'jump': SFX.jump(); break;
      case 'land': this.fx.dust({ x: f.x, y: 0 }, 8); SFX.land(); break;
      case 'dodge': this.fx.dust({ x: f.x, y: 0 }, 6, 0xfff0d0); SFX.whoosh(); break;
      case 'feather': this.fx.featherRain(data.x); SFX.whoosh(); break;
      case 'wolfrush':
        this.fx.phantomWolf(data.x, (this._wolfSide = !this._wolfSide));
        SFX.whooshHeavy();
        break;
      case 'attack': data.move.sfx && SFX[data.move.sfx]?.(); break;
      case 'special':
        SFX.special();
        SFX[data.special.sfx]?.();
        this.fx.auraBurst(f, f.isP1 ? 0x63c8ff : 0xff7854);
        this.fx.ring(new THREE.Vector3(f.x, 1.2, 0), f.isP1 ? 0x63c8ff : 0xffa030, 1.7, 0.45);
        this.fx.flash(0.25, f.isP1 ? '#9fd8ff' : '#ffc9a0');
        this.ui.announce(f.char.stats.specialName, { dur: 1.2, size: 'clamp(48px,8vw,110px)' });
        this.fcam.addShake(0.35);
        this.netEvt({ k: 'special', slot: f.index, name: f.char.stats.specialName, sfx: data.special.sfx });
        break;
      case 'ko': break;   // KO 流程由 world 事件驱动
      case 'win': break;
    }
  }

    // ================= 主循环 =================
  tick(dt) {
    switch (this.phase) {
      case 'title':
        // 标题背景：缓慢环绕舞台
        this._titleCam(dt);
        break;
      case 'select':
        this.updateSelect(dt);
        this._titleCam(dt);
        break;
      case 'fight':
        this._tickFight(dt);
        break;
      case 'result':
        this._resultCam(dt);
        break;
    }
  }

  _titleCam(dt) {
    const t = performance.now() / 1000;
    this.camera.position.lerp(new THREE.Vector3(Math.sin(t * 0.12) * 6, 3.2, 10.5), Math.min(1, dt * 2));
    this.camera.lookAt(0, 1.6, 0);
    if (this.camera.fov !== 46) { this.camera.fov = 46; this.camera.updateProjectionMatrix(); }
    if (this.fighters.length) {
      for (const f of this.fighters) f.model.update(dt, { state: 'idle', vx: 0, vy: 0, grounded: true });
    }
  }

  _resultCam(dt) {
    const t = performance.now() / 1000;
    const w = this.fighters[this._winnerIdx ?? 0];
    if (w) {
      const a = t * 0.5;
      this.camera.position.lerp(new THREE.Vector3(w.x + Math.sin(a) * 4.2, 2.2, 4.6), Math.min(1, dt * 2));
      this.camera.lookAt(w.x, 1.4, 0);
      if (this.camera.fov !== 40) { this.camera.fov = 40; this.camera.updateProjectionMatrix(); }
      for (const f of this.fighters) f.model.update(dt, { state: f.state, vx: 0, vy: 0, grounded: true });
    }
    this.fx.update(dt);
  }

  _tickFight(dt) {
    const [f1, f2] = this.fighters;
    if (!f1) return;
    if (this.mode === 'net-guest') { this._tickFightGuest(dt); return; }

    this.subT += dt;

    // ---- 输入收集 ----
    let inputs;
    if (this.subPhase === 'intro' || this.subPhase === 'koSlow' || this.subPhase === 'roundend') {
      inputs = [null, null];   // 无输入
    } else {
      const justSnap = this._justSnap || { p1: emptyInput(), p2: emptyInput() };
      const p1Inp = this.showcase ? this._showcaseInput(dt, f1, f2)
        : this.aiP1 ? (() => { const r = this.aiP1.update(dt, f1, f2); return { held: r, just: r }; })()
        : { held: this.input.held.p1, just: justSnap.p1 };
      const p2Inp = (this.mode === 'ai' || this.demo === 'ai')
        ? (() => { const r = this.ai.update(dt, f2, f1); return { held: r, just: r }; })()
        : (this.mode === 'net-host')
          ? (() => { const r = this._remoteInputPair(); return { held: r.held, just: r.just }; })()
          : { held: this.input.held.p2, just: justSnap.p2 };
      inputs = [p1Inp, p2Inp];
    }

    // ---- 世界推进 ----
    const events = this.world.step(dt, inputs);
    // 连击统计（调试/成就可复用）
    for (const ev of events) {
      if (ev.type === 'hitinfo') this._maxCombo = Math.max(this._maxCombo || 0, ev.combo);
    }

    // ---- 事件处理 ----
    for (const ev of events) {
      if (ev.type === 'hitinfo' && ev.combo >= 2) {
        this.ui.showCombo(ev.attacker, ev.combo);
        if (!this.demo) this.netEvt({ k: 'combo', side: ev.attacker, combo: ev.combo });
      }
      if (ev.type === 'fx' && ev.kind === 'sparks') {
        this.netEvt({ k: 'sparks', x: ev.x, y: ev.y, z: ev.z, c: ev.color, big: !!ev.big, sfx: ev.result === 'block' ? 'block' : (ev.big ? 'hitHeavy' : 'hitLight') });
      }
      if (ev.type === 'hitinfo' && ev.result === 'ko') {
        if (this.demo) {
          // 演示模式：跳过回合流程，原地复活继续
          for (const f of this.fighters) {
            if (f.state === 'ko') { f.state = 'idle'; f.hp = f.maxHp; f.y = 0; f.vy = 0; }
          }
        } else {
          const loserIdx = this.fighters[0].state === 'ko' ? 0 : 1;
          this.netEvt({ k: 'ko', slot: loserIdx });
          this._onKO();
        }
      }
    }

    // ---- 演示模式：锁血 + 计时暂停 ----
    if (this.demo) {
      // 压测：demo=ai 下按时间触发完整重建（验证舞台/角色资源释放）
      if (this.demo === 'ai' && this._cycleLeft > 0 && this.simTime - (this._lastCycleT ?? 0) > 9) {
        this._lastCycleT = this.simTime;
        this._cycleLeft--;
        this.startMatch(this.picks[0], this.picks[1]);
        return;
      }
      for (const f of this.fighters) {
        if (f.state !== 'ko') f.hp = Math.max(f.hp, f.maxHp * 0.55);
        if (f.state === 'ko') { f.state = 'idle'; f.hp = f.maxHp; f.y = 0; f.vy = 0; }
      }
    }

    // ---- 子阶段 ----
    if (this.subPhase === 'intro') {
      if (this.subT >= 1.15 && !this._fightAnnounced) {
        this._fightAnnounced = true;
        this.ui.announce('开打！', { dur: 0.8, size: 'clamp(64px,11vw,150px)' });
        SFX.roundBell();
        if (this._isNet) this.netEvt({ k: 'fight' });
      }
      if (this.subT >= 1.7) { this.subPhase = 'live'; this.subT = 0; this._fightAnnounced = false; }
    } else if (this.subPhase === 'live') {
      if (!this.demo) {
        this.timer -= dt;
        this.ui.setTimer(this.timer);
        if (this.timer <= 0) this._onTimeUp();
      }
    } else if (this.subPhase === 'koSlow') {
      // 慢动作由 world.timeScale 控制
      if (this.subT >= 1.35) {
        this.world.timeScale = 1;
        const winner = this.fighters[1 - this._koLoserIdx];
        if (winner && winner.state !== 'ko') winner.setWinner();
        this._finishRound(1 - this._koLoserIdx);
      }
    } else if (this.subPhase === 'roundend') {
      if (this.subT >= (this.demo ? 2.0 : 2.3)) {
        // 压测钩子（&cycle=N）：完整 teardown → 重建，验证多局资源释放
        if (this._cycleLeft > 0) {
          this._cycleLeft--;
          this.startMatch(this.picks[0], this.picks[1]);
          return;
        }
        // 下一回合 or 结算（演示模式无限循环）
        if (!this.demo && (this.score[0] >= GAME.roundsToWin || this.score[1] >= GAME.roundsToWin)) {
          this._showResult();
        } else {
          this.round++;
          this._beginRound();
        }
      }
    }

    // ---- 相机 / HUD ----
    this.fcam.update(dt, f1, f2, {
      koFocus: this.subPhase === 'koSlow' ? this.fighters[this._koLoserIdx] : null,
    });
    this.ui.updateHud(f1, f2, dt);
  }

  /** 招式展示序列：依次演示 轻拳/重拳/轻踢/重踢/跳攻/防御/闪避/必杀（带严格走位门控） */
  _showcaseInput(dt, me, foe) {
    const sc = this.showcase;
    const held = { left: false, right: false, up: false, down: false, lp: false, hp: false, lk: false, hk: false, sp: false };
    const just = { ...held };
    const dist = Math.abs(foe.x - me.x);
    const dir = Math.sign(foe.x - me.x) || 1;
    const act = sc.seq[sc.i % sc.seq.length];
    const go = () => { held[dir > 0 ? 'right' : 'left'] = true; };

    // 闪避二连击拍
    if (sc._taps > 0) {
      sc._tapT -= dt;
      if (sc._tapT <= 0) {
        just[dir > 0 ? 'right' : 'left'] = true;
        sc._taps--; sc._tapT = 0.09;
      }
    }

    // 位置门控：攻击类动作距离太远先走位（不消耗动作等待）
    const positional = act === 'jump' || act === 'block' || act === 'dodge' || act === 'back';
    if (!positional && !sc._taps && dist > 2.05) { go(); return { held, just }; }

    // 动作持续期
    if (sc._wait > 0) {
      sc._wait -= dt;
      if (act === 'block') held.down = true;
      if (act === 'jump') {
        go();
        if (me.y > 0.9 && !sc._airHit) { just.hk = true; sc._airHit = true; }
      }
      return { held, just };
    }

    // 触发下一个动作
    switch (act) {
      case 'lp': just.lp = true; sc._wait = 0.85; break;
      case 'hp': just.hp = true; sc._wait = 1.15; break;
      case 'lk': just.lk = true; sc._wait = 0.95; break;
      case 'hk': just.hk = true; sc._wait = 1.15; break;
      case 'jump': just.up = true; sc._wait = 1.5; sc._airHit = false; break;
      case 'block': held.down = true; sc._wait = 1.5; break;
      case 'dodge': sc._taps = 2; sc._tapT = 0.01; sc._wait = 1.1; break;
      case 'back':
        held[dir > 0 ? 'left' : 'right'] = true;
        sc._wait = 1.2;   // 后撤拉开距离再冲
        break;
      case 'special':
        if (me.meter >= 100) { just.sp = true; sc._wait = 2.8; }
        else { just.lp = true; sc._wait = 0.75; }   // 没能量先攒
        break;
    }
    sc.i++;
    return { held, just };
  }

  // ================= 局域网联机 =================
  /** 主机：把 P2 键位状态转成沿/跳变 */
  _remoteInputPair() {
    const cur = { ...emptyInput(), ...this.remoteInput };
    const just = {};
    for (const k of Object.keys(cur)) {
      just[k] = !!cur[k] && !this._prevRemote[k];
    }
    this._prevRemote = cur;
    return { held: cur, just };
  }

  /** 主机：构造状态快照 */
  _netSnap() {
    if (!this.fighters.length) return null;
    const [a, b] = this.fighters;
    return {
      phase: this.phase, sub: this.subPhase,
      t: +this.timer.toFixed(2), round: this.round,
      score: [...this.score],
      f: [a.serialize(), b.serialize()],
      evts: this._pendingNetEvts.splice(0, this._pendingNetEvts.length),
    };
  }

  netEvt(o) { if (this._isNet) this._pendingNetEvts.push(o); }

  /** 客机：应用主机快照 */
  _applyNetState(snap) {
    if (!this.fighters.length || !snap || !snap.f) return;
    this._netLatest = snap;
    for (let i = 0; i < 2; i++) this.fighters[i].applySnapshot(snap.f[i]);
    this.timer = snap.t; this.round = snap.round; this.score = snap.score;
    if (snap.evts?.length) this._playNetEvts(snap.evts);
    if (snap.phase === 'result' && this.phase === 'fight') {
      this.phase = 'result';
      const wIdx = snap.score[0] >= GAME.roundsToWin ? 0 : 1;
      const w = this.fighters[wIdx];
      if (w.state !== 'win') { w.state = 'win'; this._poseState = 'win'; w.model.setPose({ armL: [-0.25, 0, 2.35], foreL: [-0.4, 0, 0], armR: [-0.25, 0, -2.35], foreR: [-0.4, 0, 0], head: [-0.15, 0, 0] }); }
      this.ui.showResult(w.char.name, w.isP1 ? 'P1' : 'P2', snap.score[0], snap.score[1]);
    }
  }

  /** 客机：播放主机转发的事件（特效/音效/公告） */
  _playNetEvts(list) {
    for (const ev of list) {
      switch (ev.k) {
        case 'sparks':
          this.fx.sparks(new THREE.Vector3(ev.x, ev.y, ev.z), ev.c, ev.big ? 20 : 12, ev.big ? 8 : 5.5);
          SFX[ev.sfx]?.();
          this.fcam.addShake(ev.big ? 0.45 : 0.2);
          break;
        case 'special': {
          SFX.special(); SFX[ev.sfx]?.();
          const f = this.fighters[ev.slot];
          this.fx.auraBurst(f, ev.slot === 0 ? 0x63c8ff : 0xff7854);
          this.fx.ring(new THREE.Vector3(f.x, 1.2, 0), ev.slot === 0 ? 0x63c8ff : 0xffa030, 1.7, 0.45);
          this.ui.announce(ev.name, { dur: 1.2, size: 'clamp(48px,8vw,110px)' });
          this.fcam.addShake(0.35);
          break;
        }
        case 'ko':
          SFX.ko();
          this.fx.flash(0.55);
          this.fx.ring(new THREE.Vector3(this.fighters[ev.slot].x, 1.3, 0), 0xffd76b, 2.4, 0.55);
          this.ui.announce('K.O.', { dur: 1.6, size: 'clamp(90px,17vw,240px)' });
          break;
        case 'round':
          this.ui.announce(`ROUND ${ev.n}`, { dur: 1.0 });
          SFX.roundBell();
          break;
        case 'fight':
          this.ui.announce('开打！', { dur: 0.8, size: 'clamp(64px,11vw,150px)' });
          break;
        case 'winner':
          this.ui.announce(`${ev.label} ${ev.name} 胜`, { dur: 1.4, size: 'clamp(36px,6vw,72px)' });
          break;
        default:
          if (ev.combo) this.ui.showCombo(ev.side, ev.combo);
      }
    }
  }

  /** 客机主循环：木偶渲染 + HUD 镜像 */
  _tickFightGuest(dt) {
    const [f1, f2] = this.fighters;
    // 自动驾驶（测试）：本地 AI 决策经输入通道上行到主机执行
    if (this._apAI) {
      const me = this.fighters[this._localSlot()];
      const foe = this.fighters[1 - this._localSlot()];
      this._apInp = { ...emptyInput(), ...this._apAI.update(dt, me, foe) };
    }
    for (const f of this.fighters) f.puppetStep(dt);
    this.fx.update(dt);
    this.fcam.update(dt, f1, f2, {});
    this.ui.updateHud(f1, f2, dt);
    this.ui.setTimer(this.timer);
  }

  _onKO() {
    if (this.subPhase !== 'live') return;
    const loserIdx = this.fighters[0].state === 'ko' ? 0 : 1;
    this._koLoserIdx = loserIdx;
    this.subPhase = 'koSlow'; this.subT = 0;
    this.world.timeScale = GAME.slowmoKO;
    this.ui.announce('K.O.', { dur: 1.6, size: 'clamp(90px,17vw,240px)' });
  }

  _onTimeUp() {
    if (this.subPhase !== 'live') return;
    const [f1, f2] = this.fighters;
    this.ui.announce('TIME UP', { dur: 1.4, size: 'clamp(56px,10vw,130px)' });
    const r1 = f1.hp / f1.maxHp, r2 = f2.hp / f2.maxHp;
    let w = r1 === r2 ? -1 : (r1 > r2 ? 0 : 1);
    if (w >= 0) this.fighters[w].setWinner();
    this.subPhase = 'roundend'; this.subT = 0.9;   // 跳过慢动作等待
    this._finishRound(w);
  }

  _finishRound(winnerIdx) {
    this.subPhase = 'roundend';
    if (this.subT < 0.9) this.subT = 0.9;
    if (winnerIdx >= 0) {
      this.score[winnerIdx]++;
      this.fighters[winnerIdx].roundsWon = this.score[winnerIdx];
    }
    if (winnerIdx >= 0) {
      const label = this.fighters[winnerIdx].isP1 ? 'P1' : (this.mode === 'ai' ? 'AI' : 'P2');
      setTimeout(() => {
        this.ui.announce(`${label} ${this.fighters[winnerIdx].char.name} 胜`, { dur: 1.4, size: 'clamp(36px,6vw,72px)' });
      }, 200);
      this.netEvt({ k: 'winner', label: this.fighters[winnerIdx].isP1 ? 'P1' : 'P2', name: this.fighters[winnerIdx].char.name });
    }
    this._winnerIdx = winnerIdx;
  }

  _showResult() {
    this.phase = 'result';
    const w = this.score[0] > this.score[1] ? 0 : 1;
    this._winnerIdx = w;
    const f = this.fighters[w];
    if (f.state !== 'win') f.setWinner();
    this.ui.showResult(f.char.name, f.isP1 ? 'P1' : (this.mode === 'ai' ? 'AI' : 'P2'), this.score[0], this.score[1]);
    SFX.confirm();
  }
}

// ---------- 工具 ----------
function dots(value, max) {
  const n = Math.max(1, Math.min(5, Math.round((value / max) * 5)));
  let s = '';
  for (let i = 0; i < 5; i++) s += `<span class="stat-dot ${i < n ? 'on' : ''}"></span>`;
  return s;
}

// ---------- 角色立绘（单个复用渲染器，异步逐个生成，不阻塞选人界面） ----------
const portraitCache = new Map();
let _pRenderer = null;

function _renderPortraitOnce(charDef) {
  if (portraitCache.has(charDef.id)) return;
  if (!_pRenderer) {
    _pRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    _pRenderer.setSize(220, 220);
    _pRenderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  const key = new THREE.DirectionalLight(0xffe0b0, 2.4); key.position.set(-3, 5, 6); scene.add(key);
  scene.add(new THREE.HemisphereLight(0xc090d0, 0x805030, 1.2));
  const model = new FighterModel(charDef);
  scene.add(model.root);
  model.update(0.05, { state: 'idle', vx: 0, vy: 0, grounded: true });   // 摆好待机姿势
  const h = 2.5 * charDef.look.scale;
  cam.position.set(1.4, h * 0.58, h * 1.25);
  cam.lookAt(0, h * 0.52, 0);
  scene.updateMatrixWorld(true);
  _pRenderer.render(scene, cam);
  const url = _pRenderer.domElement.toDataURL('image/png');
  portraitCache.set(charDef.id, url);
  model.dispose();   // 立绘模型即用即弃，释放 GPU 资源
}

/** 选人卡片立绘：先显示占位色块，随后空闲时段逐个替换为渲染图（错峰避免集中卡顿） */
function fillPortraitAsync(card, imgEl, charDef, i = 0) {
  if (portraitCache.has(charDef.id)) {
    imgEl.src = portraitCache.get(charDef.id);
    return;
  }
  // 占位：角色主色圆点
  const c = '#' + charDef.look.fur.toString(16).padStart(6, '0');
  imgEl.src = 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><circle cx="75" cy="75" r="46" fill="${c}"/></svg>`
  );
  let tries = 0;
  const step = () => {
    try {
      _renderPortraitOnce(charDef);
      imgEl.src = portraitCache.get(charDef.id);
      card.classList.add('portrait-ready');
    } catch (e) {
      if (++tries < 3) setTimeout(step, 60);
    }
  };
  setTimeout(step, 40 + i * 90);
}

// ---------- 启动 ----------
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  window.__game = game;

  // 标题菜单键盘快捷键（1/2/3）
  window.addEventListener('keydown', (e) => {
    if (game.phase !== 'title') return;
    if (e.code === 'Digit1') $('btn-local').click();
    if (e.code === 'Digit2') $('btn-vsai').click();
    if (e.code === 'Digit3') $('btn-lan').click();
  });

  // 直通参数（便于测试）：?select=1 直达选人；?fight=id1,id2&mode=local|ai 直达对战；&demo=ai|showcase 演示驱动
  // 联机：&lan=1 自动匹配（首窗为主机）；&pick=N 自动确认角色；&auto=1 客机自动驾驶
  const q = new URLSearchParams(location.search);
  const idxOf = (id) => Math.max(0, CHARACTERS.findIndex(c => c.id === id));
  window.__AUTO_PILOT = q.get('auto') === '1';
  game._stageParam = q.get('stage');
  game._cycleLeft = Number(q.get('cycle')) || 0;
  if (q.get('fight')) {
    const [a, b] = q.get('fight').split(',');
    game.mode = q.get('mode') === 'ai' ? 'ai' : 'local';
    game.demo = q.get('demo') || null;
    setTimeout(() => game.startMatch(idxOf(a), idxOf(b)), 100);
  } else if (q.get('select') != null) {
    game.mode = q.get('mode') === 'ai' ? 'ai' : 'local';
    game.enterSelect();
    // 测试钩子：&autopick=我,AI对手 —— 用按键脉冲走真实输入路径（完整验证 held 差分选人）
    // 注意：blur 会整体替换 held 对象，脉冲必须每次实时取引用
    if (q.get('autopick')) {
      const [a, b] = q.get('autopick').split(',').map(Number);
      const N = CHARACTERS.length;
      const seq = [];
      for (let k = 0; k < (a % N); k++) seq.push('right');   // 第一步：移到主角
      seq.push('ok');
      for (let k = 0; k < ((b - (a + 1)) % N + N) % N; k++) seq.push('right');   // 第二步：移到 AI 对手
      seq.push('ok');
      let i = 0;
      const timer = setInterval(() => {
        if (i >= seq.length || game.phase !== 'select') { clearInterval(timer); return; }
        const key = seq[i++] === 'right' ? 'right' : 'lp';
        game.input.held.p1[key] = true;
        setTimeout(() => { game.input.held.p1[key] = false; }, 140);
      }, 300);
    }
  } else if (q.get('lan')) {
    setTimeout(() => {
      game.openNetPanel();
      game.__autoPick = q.get('pick');
    }, 300);
  }
});

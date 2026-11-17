// All DOM access for the HUD, overlays and debug buttons lives here.
// It has no dependency on Three.js or Rapier.

export class UI {
  constructor(doc = document) {
    this.doc = doc;
    const $ = (id) => doc.getElementById(id);
    this.loading = $('loading');
    this.loadingStatus = $('loading-status');
    this.fatal = $('fatal');
    this.fatalMessage = $('fatal-message');
    this.fatalDetails = $('fatal-details');
    this.fatalHint = $('fatal-hint');
    this.pauseOverlay = $('pause-overlay');
    this.toastEl = $('toast');
    this.fpsEl = $('fps');
    this.keyEls = [...doc.querySelectorAll('#input-monitor [data-action]')];
    this._toastTimer = null;
    this.botCountEl = $('bot-count-label');
    this.botEnabledEl = $('bot-enabled');
    this.diffButtons = [...doc.querySelectorAll('#bot-difficulty [data-diff]')];
    this.handEls = { left: $('hand-left'), right: $('hand-right') };
    this.bannerEl = $('banner');
    this.mapButtons = [...doc.querySelectorAll('#map-select [data-map]')];
    this.online = {
      name: $('online-name'), server: $('online-server'), code: $('online-code'),
      host: $('online-host'), join: $('online-join'), leave: $('online-leave'),
      status: $('online-status'), players: $('online-players'), fields: $('online-fields'),
    };
    this.leaveBtn = $('leave-btn');
    this.pauseNote = $('pause-note');
    this._last = {};
  }

  setLoading(text) {
    if (this.loadingStatus) this.loadingStatus.textContent = text;
  }

  hideLoading() {
    this.loading.classList.add('hidden');
  }

  showFatal(err) {
    const message = err && err.message ? err.message : String(err);
    this.loading.classList.add('hidden');
    this.fatalMessage.textContent = message.split('\n')[0];
    this.fatalDetails.textContent = (err && err.stack) || message;
    // Errors like these usually mean some files are from an older version than others.
    const mismatch = /Mismatched game files|does not provide an export|is not a function|is not a constructor|is not defined/.test(message);
    if (this.fatalHint) this.fatalHint.classList.toggle('hidden', !mismatch);
    this.fatal.classList.remove('hidden');
  }

  showPause(visible) {
    this.pauseOverlay.classList.toggle('hidden', !visible);
  }

  toast(text, ms = 1800) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  setFps(fps) {
    this.fpsEl.textContent = `${Math.round(fps)} FPS`;
  }

  /** Lights up the on-screen key caps for every action currently held. */
  updateInputMonitor(isDown) {
    for (const el of this.keyEls) el.classList.toggle('active', isDown(el.dataset.action));
  }

  onPauseClick(handler) {
    this._bind('pause-btn', handler);
    this._bind('resume-btn', handler);
  }

  onDebugAction(handler) {
    for (const btn of this.doc.querySelectorAll('[data-debug]')) {
      btn.addEventListener('click', () => {
        handler(btn.dataset.debug);
        btn.blur(); // so a later Space press does not "click" the focused button
      });
    }
  }

  /** Text, mode: 'ready' | 'punch' | 'reach' | 'hold'. Only touches the page when it changes. */
  setHandStatus(side, text, mode) {
    const el = this.handEls[side];
    if (!el) return;
    const key = `${text}|${mode}`;
    if (this._last[side] === key) return;
    this._last[side] = key;
    el.querySelector('.t').textContent = `${side === 'left' ? 'Left' : 'Right'}: ${text}`;
    el.dataset.mode = mode;
  }

  setBanner(text) {
    if (this._last.banner === text) return;
    this._last.banner = text;
    this.bannerEl.textContent = text;
    this.bannerEl.classList.toggle('show', !!text);
  }

  /** { enabled, count, active, max, difficulty } */
  setBotState({ enabled, count, active, max, difficulty }) {
    this.botCountEl.textContent = `Active bots: ${active} / ${max}` + (enabled ? '' : ' (off)');
    this.botEnabledEl.checked = !!enabled;
    const locked = this.doc.body && this.doc.body.classList && this.doc.body.classList.contains('role-guest');
    this.doc.getElementById('bot-plus').disabled = locked || (count >= max && enabled);
    this.doc.getElementById('bot-minus').disabled = locked || count <= 0;
    for (const b of this.diffButtons) b.classList.toggle('active', b.dataset.diff === difficulty);
  }

  // ---- online panel ----

  /** handler({ type: 'host' | 'join' | 'leave', name, server, code }) */
  onOnlineAction(handler) {
    const fire = (type) => handler({ type, ...this.getOnlineForm() });
    const bind = (el, type) => el.addEventListener('click', () => { fire(type); el.blur(); });
    bind(this.online.host, 'host');
    bind(this.online.join, 'join');
    bind(this.online.leave, 'leave');
    bind(this.leaveBtn, 'leave');
  }

  getOnlineForm() {
    const o = this.online;
    return { name: (o.name.value || '').trim(), server: (o.server.value || '').trim(), code: (o.code.value || '').trim() };
  }

  setOnlineForm({ name, server }) {
    if (name !== undefined) this.online.name.value = name;
    if (server !== undefined) this.online.server.value = server;
  }

  /** kind: 'info' | 'ok' | 'error' */
  setOnlineStatus(text, kind = 'info') {
    this.online.status.textContent = text;
    this.online.status.dataset.kind = kind;
  }

  setOnlinePlayers(names) {
    const ul = this.online.players;
    const key = names.join('|');
    if (this._last.players === key) return;
    this._last.players = key;
    ul.textContent = '';
    for (const n of names) {
      const li = this.doc.createElement('li');
      li.textContent = n;
      ul.appendChild(li);
    }
  }

  setOnlineBusy(busy) {
    this.online.host.disabled = busy; this.online.join.disabled = busy;
  }

  /** role: 'solo' | 'host' | 'guest'. Guests cannot change the bots, the map or most test tools. */
  setRole(role) {
    const body = this.doc.body;
    if (body && body.classList) { body.classList.remove('role-solo', 'role-host', 'role-guest'); body.classList.add('role-' + role); }
    const online = role !== 'solo';
    this.online.fields.classList.toggle('hidden', online);
    this.online.leave.classList.toggle('hidden', !online);
    this.leaveBtn.classList.toggle('hidden', !online);
    const lock = role === 'guest';
    for (const id of ['bot-minus', 'bot-plus', 'bot-reset', 'bot-enabled']) { const el = this.doc.getElementById(id); if (el) el.disabled = lock; }
    for (const b of [...this.diffButtons, ...this.mapButtons]) b.disabled = lock;
    for (const b of this.doc.querySelectorAll('[data-debug]')) b.disabled = lock && b.dataset.debug !== 'respawn';
    if (!lock) this._last.botLock = false;
  }

  setPauseNote(text) {
    this.pauseNote.textContent = text;
    this.pauseNote.classList.toggle('hidden', !text);
  }

  /** handler(mapId) */
  onMapSelect(handler) {
    for (const b of this.mapButtons) b.addEventListener('click', () => { handler(b.dataset.map); b.blur(); });
  }

  setMapState(id) {
    for (const b of this.mapButtons) b.classList.toggle('active', b.dataset.map === id);
  }

  /** handler({ type: 'plus' | 'minus' | 'enabled' | 'difficulty' | 'reset', value }) */
  onBotControl(handler) {
    const bindClick = (id, type) => {
      const el = this.doc.getElementById(id);
      el.addEventListener('click', () => { handler({ type }); el.blur(); });
    };
    bindClick('bot-plus', 'plus');
    bindClick('bot-minus', 'minus');
    bindClick('bot-reset', 'reset');
    this.botEnabledEl.addEventListener('change', () => { handler({ type: 'enabled', value: this.botEnabledEl.checked }); this.botEnabledEl.blur(); });
    for (const b of this.diffButtons) {
      b.addEventListener('click', () => { handler({ type: 'difficulty', value: b.dataset.diff }); b.blur(); });
    }
  }

  _bind(id, handler) {
    const el = this.doc.getElementById(id);
    el.addEventListener('click', () => {
      handler();
      el.blur();
    });
  }
}

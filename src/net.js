// Browser side of the connection to the online server (see server/server.js).

/**
 * Turns whatever the player typed into a WebSocket address.
 *   "my-game.onrender.com"      -> wss://my-game.onrender.com/ws
 *   "https://my-game.onrender.com/" -> wss://my-game.onrender.com/ws
 *   "localhost:3000"            -> ws://localhost:3000/ws
 * An empty box means "the server this page came from", but only when the page really is served by the
 * game server (Render or localhost). A page on GitHub Pages has no server behind it, so that needs an address.
 * Returns null when the text cannot be an address.
 */
export function normalizeServerUrl(input, loc = globalThis.location) {
  let s = String(input == null ? '' : input).trim();
  if (!s) {
    const own = loc && loc.host && /^https?:$/.test(loc.protocol || '') && /^(localhost|127\.|.*\.onrender\.com$)/.test(loc.hostname || '');
    if (own) s = (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host;
    else return null;
  }
  s = s.replace(/\s+/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme && !/^(https?|wss?)$/i.test(scheme[1])) return null;   // ftp://, file://, ... are not game servers
  if (/^https:\/\//i.test(s)) s = 'wss://' + s.slice(8);
  else if (/^http:\/\//i.test(s)) s = 'ws://' + s.slice(7);
  else if (!/^wss?:\/\//i.test(s)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|\[::1\])/i.test(s);
    s = (local ? 'ws://' : 'wss://') + s;
  }
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (!u.hostname || !/^wss?:$/.test(u.protocol)) return null;
  return `${u.protocol}//${u.host}/ws`;
}

export class NetClient {
  constructor({ WebSocketImpl = globalThis.WebSocket } = {}) {
    this.WebSocketImpl = WebSocketImpl;
    this.ws = null;
    this.handlers = new Map();   // message type -> [fn]
    this.heartbeat = null;
    this.closedByUs = false;
  }

  get open() { return !!this.ws && this.ws.readyState === 1; }

  /** Resolves once connected; rejects with a readable error if it cannot connect. */
  connect(url, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.WebSocketImpl) { reject(new Error('This browser has no WebSocket support.')); return; }
      let ws;
      try { ws = new this.WebSocketImpl(url); } catch (err) { reject(new Error(err && err.message ? err.message : 'Could not open a connection.')); return; }
      this.ws = ws;
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch (_) { /* already closed */ } reject(new Error('The server did not answer. If it is on a free Render plan it may be waking up, so try again in a minute.')); } }, timeoutMs);
      ws.onopen = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        this.heartbeat = setInterval(() => this.send({ t: 'ping' }), 20000);
        resolve();
      };
      ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Could not reach the server.')); } };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (_) { return; }
        if (msg && typeof msg.t === 'string') this._dispatch(msg.t, msg);
      };
      ws.onclose = () => {
        clearInterval(this.heartbeat);
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('The connection was closed.')); return; }
        if (!this.closedByUs) this._dispatch('disconnect', { t: 'disconnect' });
      };
    });
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  _dispatch(type, msg) {
    for (const fn of [...(this.handlers.get(type) || [])]) fn(msg);
  }

  send(obj) {
    if (this.open) this.ws.send(JSON.stringify(obj));
  }

  /** Sends a message and resolves with the first reply of type okType; rejects on a server error. */
  request(obj, okType, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const done = (fn, v) => { clearTimeout(timer); offOk(); offErr(); fn(v); };
      const offOk = this.on(okType, (m) => done(resolve, m));
      const offErr = this.on('error', (m) => done(reject, new Error(m.msg || 'The server refused the request.')));
      const timer = setTimeout(() => done(reject, new Error('The server did not reply.')), timeoutMs);
      this.send(obj);
    });
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.heartbeat);
    if (this.ws) { try { this.ws.close(); } catch (_) { /* already closed */ } }
  }
}

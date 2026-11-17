// Online play. The HOST's browser runs the whole game (physics, bots, everyone's fighter) and
// sends the world to the guests about 20 times a second. Guests send their keys back and only
// DRAW what they receive. The server in between just forwards messages.
import { createWorld } from './world.js?v=s4r1';
import { getMap } from './maps.js?v=s4r1';
import { cameraRelativeMove } from './character.js?v=s4r1';
import { ACTION } from './input.js?v=s4r1';
import { Avatar } from './avatar.js?v=s4r1';
import { PALETTE, MAX_EXTRA_CRATES } from './config.js?v=s4r1';

export const SNAP_HZ = 20;
export const INPUT_HZ = 30;
export const INTERP_MS = 110;      // guests draw the world this far in the past so motion is smooth

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
export const STATE_CODE = { normal: 0, stumble: 1, down: 2, recover: 3 };
export const MODE_CODE = { ready: 0, punch: 1, reach: 2, hold: 3 };
const MODE_TEXT = ['ready', 'punch', 'reaching', 'holding'];

export function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

// ------------------------------------------------------------------------------------ host

/** One fighter as a flat array (small to send). */
export function encodeFighter(f) {
  const p = f.body.translation(); const o = f.pose.out;
  const lh = f.hands.left.body.translation(); const rh = f.hands.right.body.translation();
  const ls = f.handStatus('left'); const rs = f.handStatus('right');
  return [
    f.index, r2(p.x), r2(p.y), r2(p.z), r3(o.yaw), r3(o.leanX), r3(o.leanZ), r3(o.scaleY), r3(o.bob), r3(o.legL.x), r3(o.legR.x),
    STATE_CODE[f.controller.state] || 0, MODE_CODE[ls.mode] || 0, MODE_CODE[rs.mode] || 0,
    r2(lh.x), r2(lh.y), r2(lh.z), r2(rh.x), r2(rh.y), r2(rh.z),
    f.heldBy ? f.heldBy.index : -1, r2(f.flash),
    ls.mode === 'hold' ? ls.text.replace('grabbing ', '') : '', rs.mode === 'hold' ? rs.text.replace('grabbing ', '') : '',
  ];
}

export class HostSync {
  constructor({ sim, net, hostName = 'Host', getPaused = () => false, now = () => performance.now() }) {
    this.sim = sim; this.net = net; this.hostName = hostName; this.getPaused = getPaused; this.now = now;
    this.sendT = 0; this.metaT = 0; this.seq = 0; this.lastMeta = '';
    this.events = [];
    this.peers = new Map();            // net id -> name
    this.lastRespawn = new Map();
    this.onPlayersChanged = null;
    this._offs = [
      net.on('peer', (m) => this._onPeer(m)),
      net.on('guest', (m) => this._onGuest(m)),
    ];
    this._offCombat = sim.combat.on((type, d) => {
      const code = { hit: 1, throw: 2, grab: 3, breakfree: 4 }[type];
      if (!code) return;
      const a = (d.attacker || d.holder || null); const b = (d.victim || null);
      this.events.push([code, a ? a.index : -1, b ? b.index : -1, r2(d.impulse || d.speed || 0)]);
    });
  }

  get playerNames() { return [this.hostName, ...[...this.peers.values()]]; }

  _onPeer(m) {
    if (m.ev === 'join') {
      const f = this.sim.addRemote(m.id, m.name);
      if (!f) { this._sendTo(m.id, { t: 'full' }); return; }
      this.peers.set(m.id, m.name);
      this._sendTo(m.id, { t: 'welcome', you: f.index });
      this.sendMeta(true);
    } else if (m.ev === 'leave') {
      this.sim.removeRemote(m.id);
      this.peers.delete(m.id);
      this.sendMeta(true);
    }
    if (this.onPlayersChanged) this.onPlayersChanged(this.playerNames);
  }

  _onGuest(m) {
    const f = this.sim.remotes.get(m.id);
    if (!f || !m.d || typeof m.d !== 'object') return;
    if (m.d.t === 'in') f.setInput(m.d);
    else if (m.d.t === 'respawn') {
      const t = this.now();
      if (t - (this.lastRespawn.get(m.id) || -1e9) > 2000) { this.lastRespawn.set(m.id, t); f.respawn(); }
    }
  }

  _send(d) { this.net.send({ t: 'host', d }); }
  _sendTo(id, d) { this.net.send({ t: 'host', to: id, d }); }

  buildMeta() {
    const sim = this.sim;
    const fighters = sim.combat.fighters.map((f) => ({ id: f.index, name: f.name, color: f.color, kind: f.kind }));
    const crates = [];
    for (const e of sim.physics.entities) if (e.kind === 'crate') crates.push({ id: e.netId, size: r2(e.half * 2), color: e.color });
    const st = sim.bots.settings;
    return { t: 'meta', map: sim.mapId, host: this.hostName, fighters, crates, bots: { enabled: st.enabled, count: st.count, difficulty: st.difficulty, active: sim.bots.activeCount, max: 5 } };
  }

  sendMeta(force) {
    const meta = this.buildMeta(); const s = JSON.stringify(meta);
    if (force || s !== this.lastMeta) { this.lastMeta = s; this._send(meta); }
  }

  buildSnapshot() {
    const sim = this.sim;
    const f = sim.combat.fighters.map(encodeFighter);
    const c = [];
    for (const e of sim.physics.entities) {
      if (e.kind !== 'crate') continue;
      const p = e.body.translation(); const q = e.body.rotation();
      c.push([e.netId, r2(p.x), r2(p.y), r2(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)]);
    }
    const ev = this.events; this.events = [];
    return { t: 'snap', s: ++this.seq, pa: this.getPaused() ? 1 : 0, f, c, ev };
  }

  /** Call every frame. Sends snapshots at ~20 Hz (only when someone is listening). */
  update(dt) {
    if (!this.peers.size) { this.events.length = 0; return; }
    this.sendT += dt; this.metaT += dt;
    if (this.metaT >= 0.5) { this.metaT = 0; this.sendMeta(false); }
    if (this.sendT >= 1 / SNAP_HZ) { this.sendT = 0; this._send(this.buildSnapshot()); }
  }

  dispose() {
    for (const off of this._offs) off();
    if (this._offCombat) this._offCombat();
    for (const id of [...this.peers.keys()]) this.sim.removeRemote(id);
    this.peers.clear();
  }
}

// ------------------------------------------------------------------------------------ guest

export class GuestSession {
  constructor({ THREE, scene, cameraRig, net, ui, now = () => performance.now() }) {
    this.THREE = THREE; this.scene = scene; this.cameraRig = cameraRig; this.net = net; this.ui = ui; this.now = now;
    this.you = -1;
    this.mapId = null;
    this.visual = null;                // map visuals (no physics)
    this.avatars = new Map();          // fighter index -> { avatar, name, kind }
    this.crates = new Map();           // crate id -> mesh
    this.crateKey = '';
    this.names = new Map();
    this.buffer = [];                  // recent snapshots { t, rows: Map, crates: Map, ev, pa }
    this.hostPaused = false;
    this.botInfo = null;
    this.players = [];
    this.focus = { x: 0, y: 0.85, z: 0 };
    this.haveSnap = false;
    this.hud = { left: { mode: 'ready', text: 'ready' }, right: { mode: 'ready', text: 'ready' }, banner: '' };
    this.jumpSeq = 0; this.inT = 0; this.sinceSent = 0; this.lastSent = null;
    this.onPlayersChanged = null;
    this._pose = { yaw: 0, leanX: 0, leanZ: 0, scaleY: 1, scaleXZ: 1, bob: 0, legL: { x: 0 }, legR: { x: 0 } };
  }

  /** A message from the host. */
  handle(d) {
    if (!d || typeof d.t !== 'string') return;
    if (d.t === 'welcome') this.you = d.you;
    else if (d.t === 'meta') this._applyMeta(d);
    else if (d.t === 'snap') this._pushSnap(d);
  }

  _applyMeta(m) {
    if (m.map !== this.mapId) {
      if (this.visual) this.visual.dispose();
      this.mapId = m.map;
      this.visual = createWorld({ THREE: this.THREE, scene: this.scene, physics: null, map: getMap(m.map), palette: PALETTE, maxExtraCrates: MAX_EXTRA_CRATES });
      this.crates.clear();           // the old map's crate meshes went with it
      this.crateKey = '';
    }
    // fighters
    const want = new Set(m.fighters.map((f) => f.id));
    for (const [id, a] of [...this.avatars]) if (!want.has(id)) { a.avatar.dispose(); this.avatars.delete(id); }
    for (const f of m.fighters) {
      this.names.set(f.id, f.name);
      if (!this.avatars.has(f.id)) {
        const avatar = new Avatar(this.THREE, this.scene, f.color);
        avatar.root.visible = false;
        for (const h of ['left', 'right']) { avatar.hand[h].mesh.visible = false; avatar.hand[h].arm.visible = false; avatar.hand[h].cap.visible = false; }
        if (f.id !== this.you) avatar.setLabel(f.name);
        this.avatars.set(f.id, { avatar, name: f.name, kind: f.kind, shown: false });
      }
    }
    // crates
    const key = m.crates.map((c) => c.id).join(',');
    if (key !== this.crateKey && this.visual) {
      this.crateKey = key;
      const ids = new Set(m.crates.map((c) => c.id));
      for (const [id, mesh] of [...this.crates]) if (!ids.has(id)) { this.visual.removeCrateMesh(mesh); this.crates.delete(id); }
      for (const c of m.crates) if (!this.crates.has(c.id)) this.crates.set(c.id, this.visual.createCrateMesh(c.size, c.color));
    }
    this.botInfo = m.bots;
    this.hostName = m.host;
    const players = m.fighters.filter((f) => f.kind === 'player' || f.kind === 'remote').map((f) => f.name);
    if (players.join('|') !== this.players.join('|')) { this.players = players; if (this.onPlayersChanged) this.onPlayersChanged(players); }
  }

  _pushSnap(d) {
    const rows = new Map(); for (const r of d.f) rows.set(r[0], r);
    const crates = new Map(); for (const c of d.c) crates.set(c[0], c);
    this.buffer.push({ t: this.now(), rows, crates });
    if (this.buffer.length > 20) this.buffer.shift();
    this.hostPaused = d.pa === 1;
    this.haveSnap = true;
    for (const e of d.ev || []) this._onEvent(e);
  }

  _onEvent(e) {
    const [code, a, b, strength] = e;
    if (code === 1 && (a === this.you || b === this.you)) this.cameraRig.shake(Math.min(0.5, 0.12 + strength * 0.02));
    else if (code === 2 && (a === this.you || b === this.you)) this.cameraRig.shake(0.25);
    else if (code === 4 && b === this.you) this.ui.toast('You broke free!');
  }

  /** Finds the two snapshots around (now - INTERP_MS) and how far between them we are. */
  _bracket() {
    const buf = this.buffer;
    const rt = this.now() - INTERP_MS;
    if (buf.length === 1 || rt <= buf[0].t) return { a: buf[0], b: buf[0], k: 0 };
    for (let i = buf.length - 1; i > 0; i--) {
      if (buf[i - 1].t <= rt) {
        const a = buf[i - 1]; const b = buf[i];
        if (rt >= b.t) return { a: b, b, k: 0 };
        return { a, b, k: (rt - a.t) / Math.max(1, b.t - a.t) };
      }
    }
    return { a: buf[0], b: buf[0], k: 0 };
  }

  /** Draws the world from the buffered snapshots. */
  render() {
    if (!this.buffer.length) return;
    const { a, b, k } = this._bracket();
    const mix = (x, y) => x + (y - x) * k;
    const o = this._pose;
    for (const [id, rb] of b.rows) {
      const av = this.avatars.get(id);
      if (!av) continue;
      const ra = a.rows.get(id) || rb;
      const x = mix(ra[1], rb[1]); const y = mix(ra[2], rb[2]); const z = mix(ra[3], rb[3]);
      // a sudden jump (respawn) must not be smoothed across the map
      const snap = Math.hypot(rb[1] - ra[1], rb[3] - ra[3]) > 6 || Math.abs(rb[2] - ra[2]) > 8;
      const p = snap ? rb : null;
      const px = p ? rb[1] : x; const py = p ? rb[2] : y; const pz = p ? rb[3] : z;
      o.yaw = lerpAngle(ra[4], rb[4], k); o.leanX = mix(ra[5], rb[5]); o.leanZ = mix(ra[6], rb[6]);
      o.scaleY = mix(ra[7], rb[7]); o.scaleXZ = 1 / Math.sqrt(o.scaleY); o.bob = mix(ra[8], rb[8]);
      o.legL.x = mix(ra[9], rb[9]); o.legR.x = mix(ra[10], rb[10]);
      const A = av.avatar;
      if (!av.shown) {
        av.shown = true; A.root.visible = true;
        for (const h of ['left', 'right']) { A.hand[h].mesh.visible = true; A.hand[h].arm.visible = true; A.hand[h].cap.visible = true; }
      }
      A.root.position.set(px, py, pz);
      A.applyPose(o);
      const L = A.hand.left.mesh.position; const R = A.hand.right.mesh.position;
      L.set(p ? rb[14] : mix(ra[14], rb[14]), p ? rb[15] : mix(ra[15], rb[15]), p ? rb[16] : mix(ra[16], rb[16]));
      R.set(p ? rb[17] : mix(ra[17], rb[17]), p ? rb[18] : mix(ra[18], rb[18]), p ? rb[19] : mix(ra[19], rb[19]));
      A.placeArms(A.root.position, o);
      A.setFlash(rb[21]);
      if (id === this.you) {
        this.focus.x = px; this.focus.y = py; this.focus.z = pz;
        this.hud.left = { mode: ['ready', 'punch', 'reach', 'hold'][rb[12]], text: rb[12] === 3 ? `grabbing ${rb[22] || 'something'}` : MODE_TEXT[rb[12]] };
        this.hud.right = { mode: ['ready', 'punch', 'reach', 'hold'][rb[13]], text: rb[13] === 3 ? `grabbing ${rb[23] || 'something'}` : MODE_TEXT[rb[13]] };
        const by = rb[20];
        this.hud.banner = this.hostPaused ? 'The host paused the game' : by >= 0 ? `${this.names.get(by) || 'Someone'} has grabbed you! Struggle: move or jump` : '';
      }
    }
    for (const [id, mesh] of this.crates) {
      const cb = b.crates.get(id); if (!cb) continue;
      const ca = a.crates.get(id) || cb;
      mesh.position.set(mix(ca[1], cb[1]), mix(ca[2], cb[2]), mix(ca[3], cb[3]));
      // nearest-quaternion lerp (good enough at 20 Hz)
      const dot = ca[4] * cb[4] + ca[5] * cb[5] + ca[6] * cb[6] + ca[7] * cb[7]; const sgn = dot < 0 ? -1 : 1;
      let qx = mix(ca[4] * sgn, cb[4]); let qy = mix(ca[5] * sgn, cb[5]); let qz = mix(ca[6] * sgn, cb[6]); let qw = mix(ca[7] * sgn, cb[7]);
      const l = Math.hypot(qx, qy, qz, qw) || 1; qx /= l; qy /= l; qz /= l; qw /= l;
      mesh.quaternion.set(qx, qy, qz, qw);
    }
    if (this.visual) this.visual.update(0.016);
  }

  /** Reads this player's keys and sends them to the host (about 30 times a second). */
  sendInput(dt, input, cameraYaw) {
    const m = cameraRelativeMove(cameraYaw, input.getAxis(ACTION.MOVE_BACK, ACTION.MOVE_FORWARD), input.getAxis(ACTION.MOVE_LEFT, ACTION.MOVE_RIGHT));
    if (input.wasPressed(ACTION.JUMP)) this.jumpSeq++;
    this.inT += dt; this.sinceSent += dt;
    if (this.inT < 1 / INPUT_HZ) return;
    this.inT = 0;
    const cur = { t: 'in', mx: r2(m.x), mz: r2(m.z), js: this.jumpSeq, l: input.isDown(ACTION.LEFT_HAND) ? 1 : 0, r: input.isDown(ACTION.RIGHT_HAND) ? 1 : 0 };
    const l = this.lastSent;
    const changed = !l || l.mx !== cur.mx || l.mz !== cur.mz || l.js !== cur.js || l.l !== cur.l || l.r !== cur.r;
    if (changed || this.sinceSent > 0.25) {
      this.lastSent = cur; this.sinceSent = 0;
      this.net.send({ t: 'guest', d: cur });
    }
  }

  requestRespawn() { this.net.send({ t: 'guest', d: { t: 'respawn' } }); }

  dispose() {
    for (const a of this.avatars.values()) a.avatar.dispose();
    this.avatars.clear();
    this.crates.clear();
    if (this.visual) this.visual.dispose();
    this.visual = null;
  }
}

// A human playing over the network, as seen by the host: a normal Fighter (same body, hands and
// physics as everyone else) whose intent comes from messages sent by that player's browser.
import { Fighter, emptyIntent } from './fighter.js?v=s4r1';

const clampUnit = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

export class RemoteFighter extends Fighter {
  constructor({ THREE, physics, scene, config, color, spawn, index, name, netId }) {
    super({ THREE, physics, scene, config, color, spawn, index, kind: 'remote', name });
    this.netId = netId;
    this.setLabel(name);
    this.remoteInput = { mx: 0, mz: 0, js: 0, l: false, r: false };
    this.lastJumpSeq = 0;
    this.silence = 0;           // seconds since the last message
    this._intent = emptyIntent();
  }

  /** m = { mx, mz, js, l, r } as sent by the guest. Everything is validated: guests are not trusted. */
  setInput(m) {
    const i = this.remoteInput;
    let mx = clampUnit(m.mx); let mz = clampUnit(m.mz);
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    i.mx = mx; i.mz = mz;
    i.js = Number.isFinite(m.js) ? Math.floor(m.js) : i.js;
    i.l = m.l === true || m.l === 1;
    i.r = m.r === true || m.r === 1;
    this.silence = 0;
  }

  update(dt) {
    this.silence += dt;
    const i = this.remoteInput; const it = this._intent;
    if (this.silence > 1) { i.mx = 0; i.mz = 0; i.l = false; i.r = false; } // connection stalled: stand still
    it.moveX = i.mx; it.moveZ = i.mz;
    it.jump = i.js !== this.lastJumpSeq;      // a new jump press arrived
    this.lastJumpSeq = i.js;
    it.left = i.l; it.right = i.r;
    this.applyAimAssist(it);
    super.update(dt, it);
  }
}

// Combat between fighters and objects: punch impacts, grabbing, carrying, struggling, throwing.
//
// Everything works through the physics bodies:
//  * A punch is detected when a real hand body, moving fast, touches a target; the target body
//    then receives an impulse proportional to the hand's closing speed.
//  * A grab is a "link": while it lasts, a spring pulls the held body toward a carry point in
//    front of the holder. The pull is force-limited, so heavy things sag and need two hands, and
//    gravity still acts on whatever is held.
//  * Letting go gives the object its own velocity plus a throw impulse. A held character can
//    struggle (move / jump) to break free.
import { COMBAT, handGroups } from './config.js?v=s4r1';
import { HS } from './hands.js?v=s4r1';

const hyp3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isFighterKind = (k) => k === 'player' || k === 'bot' || k === 'remote';

export class CombatSystem {
  constructor(physics, cfg = COMBAT) {
    this.physics = physics;
    this.cfg = cfg;
    this.fighters = [];
    this.links = [];
    this.time = 0;
    this.listeners = [];
    this._pre = (dt) => this.fixedUpdate(dt);
    physics.addPreStep(this._pre); // registered after the fighters, so it runs after they steer themselves
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  addFighter(f) {
    this.fighters.push(f);
    f.combat = this;
  }

  /** The lowest fighter slot (0-5) not in use. */
  freeIndex() {
    for (let i = 0; i < 6; i++) if (!this.fighters.some((f) => f.index === i)) return i;
    return -1;
  }

  removeFighter(f) {
    this.releaseAll(f);
    const i = this.fighters.indexOf(f);
    if (i >= 0) this.fighters.splice(i, 1);
    f.combat = null;
  }

  // ------------------------------------------------------------------ queries

  _holderOf(entity) {
    for (const l of this.links) if (l.target === entity) return l.holder;
    return null;
  }

  _linksOn(entity) {
    let n = 0;
    for (const l of this.links) if (l.target === entity) n++;
    return n;
  }

  /** Distance from a point to the surface of a crate or character. */
  _surfaceDist(px, py, pz, e) {
    const p = e.body.translation();
    if (e.kind === 'crate') return hyp3(px - p.x, py - p.y, pz - p.z) - e.half * 1.25;
    const hy = clamp(py, p.y - 0.4, p.y + 0.4); // distance to the capsule's centre line, minus its radius
    return hyp3(px - p.x, py - hy, pz - p.z) - 0.52;
  }

  /** Can fighter f grab this entity right now? */
  _grabbable(f, e) {
    if (e.kind === 'crate') {
      const h = this._holderOf(e);
      return !h || h === f;
    }
    if (isFighterKind(e.kind)) {
      const t = e.owner;
      if (!t || t === f || t.disposed) return false;
      if (t.heldBy && t.heldBy !== f) return false;
      return this.time >= t.noGrabUntil;
    }
    return false;
  }

  holdInfo(f) {
    let count = 0; let mass = 0; let age = 0; let targetIsFighter = false; let left = false; let right = false;
    for (const l of this.links) {
      if (l.holder !== f) continue;
      count++; mass += l.mass; age = Math.max(age, l.age);
      if (l.tf) targetIsFighter = true;
      if (l.hand.side > 0) left = true; else right = true;
    }
    return count ? { count, mass, age, targetIsFighter, left, right } : null;
  }

  heldLabel(hand) {
    for (const l of this.links) if (l.hand === hand) return l.tf ? l.tf.name : 'crate';
    return 'something';
  }

  /** Nearest thing in front of a fighter worth aiming at (used by the human player's aim assist). */
  findAimTarget(f, range = this.cfg.aimRange, cone = this.cfg.aimCone) {
    const p = f.body.translation();
    const fx = Math.sin(f.pose.yaw); const fz = Math.cos(f.pose.yaw);
    let best = null; let bestScore = Infinity;
    for (const e of this.physics.entities) {
      if (e.kind !== 'crate' && !(isFighterKind(e.kind) && e.owner !== f)) continue;
      if (this._holderOf(e) === f) continue; // never aim at what we are already holding
      const q = e.body.translation();
      const dx = q.x - p.x; const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 0.01) continue;
      const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
      if (ang > cone) continue;
      const score = d * (isFighterKind(e.kind) ? 0.6 : 1) + ang * 0.5;
      if (score < bestScore) { bestScore = score; best = { x: q.x, y: q.y, z: q.z, entity: e }; }
    }
    return best;
  }

  // ------------------------------------------------------------------ main step

  fixedUpdate(dt) {
    this.time += dt;
    for (const f of this.fighters) this._updateStrikes(f);
    for (const f of this.fighters) this._updateReach(f);
    this._updateStruggle(dt);
    this._updateLinks(dt);
    for (const f of this.fighters) this._updateCarryStats(f);
  }

  // ------------------------------------------------------------------ punching

  _updateStrikes(f) {
    const c = this.cfg;
    for (const h of f.handList) {
      const sm = h.sm;
      if (!sm.strikeActive) { h.pendingHit = null; continue; }
      if (sm.hitDone) continue;

      // A contact made while the button is still held is only "pending": if the button is let go
      // before the strike ends it was a tap and the punch lands; if it stays held it becomes a grab.
      if (h.pendingHit) {
        if (!sm.down) this._applyPunch(f, h, h.pendingHit);
        continue;
      }

      const hp = h.body.translation();
      const hv = h.body.linvel();
      const speed = hyp3(hv.x, hv.y, hv.z);
      if (speed < c.punchMinSpeed) continue;
      const dx = hv.x / speed; const dy = hv.y / speed; const dz = hv.z / speed;

      let best = null; let bestD = Infinity;
      for (const e of this.physics.entities) {
        if (e.kind !== 'crate' && !(isFighterKind(e.kind) && e.owner !== f)) continue;
        if (e.kind === 'crate' && this._holderOf(e) === f) continue;
        const d = this._surfaceDist(hp.x, hp.y, hp.z, e) - c.handRadius;
        if (d > c.punchContactSlack) continue;
        const q = e.body.translation();
        const tx = q.x - hp.x; const ty = q.y - hp.y; const tz = q.z - hp.z;
        const tl = hyp3(tx, ty, tz) || 1;
        if ((dx * tx + dy * ty + dz * tz) / tl < 0.1) continue; // must be moving toward it
        if (d < bestD) { bestD = d; best = e; }
      }
      if (!best) continue;

      const tv = best.body.linvel();
      const closing = (hv.x - tv.x) * dx + (hv.y - tv.y) * dy + (hv.z - tv.z) * dz;
      if (closing < c.punchMinSpeed) continue;
      const hit = { target: best, closing, dx, dy, dz };
      if (sm.down) h.pendingHit = hit;
      else this._applyPunch(f, h, hit);
    }
  }

  _applyPunch(f, h, hit) {
    const c = this.cfg;
    h.sm.hitDone = true;
    h.pendingHit = null;
    const best = hit.target;
    if (!this.physics.entities.has(best)) return;
    const J = c.punchMass * hit.closing;
    const { dx, dy, dz } = hit;
    // Push direction: mostly "away from the puncher", a little of the fist's own direction, so punches
    // send things away from the attacker even if the fist travelled slightly sideways.
    const ap = f.body.translation(); const tp = best.body.translation();
    let ax = tp.x - ap.x; let az = tp.z - ap.z; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const hl = Math.hypot(dx, dz);
    let nx = (hl > 0.05 ? dx / hl : 0) * 0.3 + ax * 0.7; let nz = (hl > 0.05 ? dz / hl : 0) * 0.3 + az * 0.7;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    best.body.applyImpulse({ x: nx * J, y: J * c.punchUpward + Math.max(0, dy) * J * 0.3, z: nz * J }, true);
    const hv = h.body.linvel();
    h.body.setLinvel({ x: hv.x * 0.2, y: hv.y * 0.2, z: hv.z * 0.2 }, true); // the fist stops on impact
    const victim = isFighterKind(best.kind) ? best.owner : null;
    if (victim) {
      victim.flash = 1; victim.lastHitBy = f;
      const dv = J / Math.max(0.1, best.body.mass());
      if (dv > c.flinchMin) {                 // even a light hit visibly jolts the body and throws the arms about
        victim.pose.kick(nx, nz, dv * 0.6);
        victim.flail(nx, nz, dv * c.flail);
      }
    }
    this.emit('hit', { attacker: f, side: h.name, target: best, victim, impulse: J, closing: hit.closing });
  }

  // ------------------------------------------------------------------ reaching and grabbing

  _updateReach(f) {
    const c = this.cfg;
    if (!f.canAct) return;
    for (const h of f.handList) {
      if (h.sm.state !== HS.REACH) { h.seek = null; continue; }
      const base = f.body.translation();
      const sh = f.shoulderPos(h.side, base, this._tmpSh || (this._tmpSh = { x: 0, y: 0, z: 0 }));
      const hp = h.body.translation();
      const fx = Math.sin(f.pose.yaw); const fz = Math.cos(f.pose.yaw);
      const other = h.side > 0 ? f.hands.right : f.hands.left;

      // Pick the best candidate: close to the shoulder, in front, and preferably what the other hand holds
      let best = null; let bestScore = Infinity;
      for (const e of this.physics.entities) {
        if (!this._grabbable(f, e)) continue;
        const q = e.body.translation();
        const dx = q.x - sh.x; const dz = q.z - sh.z; const dy = q.y - sh.y;
        const dc = hyp3(dx, dy, dz);
        if (dc > c.seekRange + (e.half || 0.45)) continue;
        const hl = Math.hypot(dx, dz) || 1;
        if ((dx * fx + dz * fz) / hl < -0.1) continue;
        let score = dc;
        if (other.sm.state === HS.HOLD && this._holderOf(e) === f) score -= 0.5;
        if (score < bestScore) { bestScore = score; best = e; }
      }
      if (!best) { h.seek = null; continue; }

      const q = best.body.translation();
      h.seek = h.seek || { x: 0, y: 0, z: 0 };
      h.seek.x = q.x; h.seek.y = q.y + (best.kind === 'crate' ? 0 : 0.15); h.seek.z = q.z;

      if (this._surfaceDist(hp.x, hp.y, hp.z, best) - c.handRadius <= c.grabRange) {
        this._createLink(f, h, best);
      }
    }
  }

  _createLink(f, h, e) {
    const c = this.cfg;
    const base = f.body.translation();
    const q = e.body.translation();
    const fx = Math.sin(f.pose.yaw); const fz = Math.cos(f.pose.yaw);
    const sx = Math.cos(f.pose.yaw); const sz = -Math.sin(f.pose.yaw);
    const dx = q.x - base.x; const dy = q.y - base.y; const dz = q.z - base.z;
    const tf = isFighterKind(e.kind) ? e.owner : null;
    const link = {
      holder: f, hand: h, target: e, tf,
      age: 0, mass: e.body.mass(), wasTwoHanded: false,
      hvx: 0, hvy: 0, hvz: 0, // smoothed hand velocity while holding (used for the throw)
      // where the target was when grabbed, in the holder's frame, so it is pulled in smoothly
      startSide: dx * sx + dz * sz, startUp: dy, startFwd: dx * fx + dz * fz,
    };
    this.links.push(link);
    h.sm.beginHold();
    h.seek = null;
    f.setHandFilter(h, tf ? 1 << (2 + tf.index) : 0x0002); // the hand no longer collides with what it holds
    if (this._linksOn(e) > 1) for (const l of this.links) if (l.target === e) l.wasTwoHanded = true;
    if (tf) {
      tf.heldBy = f;
      tf.controller.grabbed = true;
      tf.struggle = 0;
      tf.struggleJumps = 0;
    }
    this.emit('grab', { holder: f, target: e, victim: tf, side: h.name });
    return link;
  }

  // ------------------------------------------------------------------ struggling

  _updateStruggle(dt) {
    const c = this.cfg;
    for (const t of this.fighters) {
      if (!t.heldBy) continue;
      const mv = Math.min(1, Math.hypot(t.intent.moveX, t.intent.moveZ));
      t.struggle += dt * c.struggleMove * mv + t.struggleJumps * c.struggleJump;
      t.struggleJumps = 0;
      t.struggle = Math.max(0, t.struggle - dt * c.struggleDecay);
      const two = this._linksOn(t.entity) > 1;
      if (t.struggle >= c.struggleThreshold * (two ? c.struggleTwoHand : 1)) {
        this._breakFree(t);
      }
    }
  }

  _breakFree(t) {
    const holder = t.heldBy;
    const hp = holder ? holder.body.translation() : null;
    const tp = t.body.translation();
    this._removeLinksOn(t.entity, false);
    t.noGrabUntil = this.time + this.cfg.regrabCooldown;
    if (hp) { // a small shove away from the holder
      const dx = tp.x - hp.x; const dz = tp.z - hp.z; const d = Math.hypot(dx, dz) || 1;
      const m = t.body.mass();
      t.body.applyImpulse({ x: (dx / d) * m * 3, y: m * 2, z: (dz / d) * m * 3 }, true);
    }
    this.emit('breakfree', { victim: t, holder });
  }

  // ------------------------------------------------------------------ carrying and releasing

  _updateLinks(dt) {
    const c = this.cfg;
    const g = Math.abs(this.physics.config.gravity);
    for (let i = this.links.length - 1; i >= 0; i--) {
      const link = this.links[i];
      if (!this.links.includes(link)) continue;
      const f = link.holder; const h = link.hand; const e = link.target;
      link.age += dt;

      if (f.disposed || !this.physics.entities.has(e)) { this._removeLink(link); continue; }
      if (!f.canAct) { this._removeLink(link); this.emit('dropped', { holder: f, target: e }); continue; } // lost balance
      if (h.sm.state !== HS.HOLD) { this._release(link, true); continue; }             // button let go

      const base = f.body.translation();
      const p = e.body.translation();
      if (hyp3(p.x - base.x, p.y - base.y, p.z - base.z) > c.maxLinkDistance) {
        this._removeLink(link);
        this.emit('dropped', { holder: f, target: e });
        continue;
      }

      const n = this._linksOn(e);
      const two = n > 1;
      const ramp = clamp(link.age / c.carryRamp, 0, 1);
      const k = 1 - (1 - ramp) * (1 - ramp);
      const isChar = !!link.tf;
      const fwd = isChar ? c.carryForwardChar : c.carryForward;
      const up = isChar ? (two ? c.carryUpCharTwo : c.carryUpChar) : (two ? c.carryUpTwo : c.carryUp);
      const lat = two ? 0 : (h.side > 0 ? c.carryLateral : -c.carryLateral);
      const side = link.startSide + (lat - link.startSide) * k;
      const upv = link.startUp + (up - link.startUp) * k;
      const fw = link.startFwd + (fwd - link.startFwd) * k;
      const fx = Math.sin(f.pose.yaw); const fz = Math.cos(f.pose.yaw);
      const sx = Math.cos(f.pose.yaw); const sz = -Math.sin(f.pose.yaw);
      const tx = base.x + sx * side + fx * fw;
      const ty = base.y + upv;
      const tz = base.z + sz * side + fz * fw;

      // Spring toward the carry point, gravity compensation, limited by the holder's strength
      const v = e.body.linvel();
      const hv = f.body.linvel();
      const m = link.mass;
      let ax = c.kp * (tx - p.x) - c.kd * (v.x - hv.x);
      let ay = c.kp * (ty - p.y) - c.kd * (v.y - hv.y) + g;
      let az = c.kp * (tz - p.z) - c.kd * (v.z - hv.z);
      ax /= n; ay /= n; az /= n;
      let Fx = m * ax; let Fy = m * ay; let Fz = m * az;
      const cap = c.strength * f.strengthMul;
      const fm = hyp3(Fx, Fy, Fz);
      if (fm > cap) { const s = cap / fm; Fx *= s; Fy *= s; Fz *= s; }
      e.body.applyImpulse({ x: Fx * dt, y: Fy * dt, z: Fz * dt }, true);

      const hand = h.body.linvel();
      link.hvx += (hand.x - link.hvx) * 0.25; link.hvy += (hand.y - link.hvy) * 0.25; link.hvz += (hand.z - link.hvz) * 0.25;

      // The hand follows the body part it is holding
      const gx = base.x - p.x; const gz = base.z - p.z; const gl = Math.hypot(gx, gz) || 1;
      const reach = isChar ? 0.42 : (e.half || 0.5) * 0.95;
      h.grip = h.grip || { x: 0, y: 0, z: 0 };
      h.grip.x = p.x + (gx / gl) * reach;
      h.grip.y = p.y + (isChar ? 0.25 : 0.1);
      h.grip.z = p.z + (gz / gl) * reach;
    }
  }

  _updateCarryStats(f) {
    let mass = 0; let n = 0;
    const seen = [];
    for (const l of this.links) {
      if (l.holder !== f) continue;
      n++;
      if (!seen.includes(l.target)) { seen.push(l.target); mass += l.mass; }
    }
    f.carryMass = mass;
    const two = n > 1 && seen.length === 1;
    f.controller.speedMul = n === 0 ? 1 : Math.max(0.4, 1 / (1 + this.cfg.carrySlow * mass / (two ? 1.6 : 1)));
  }

  /** Normal let-go: the object keeps its velocity and gets a throw. */
  _release(link, throwIt) {
    const c = this.cfg;
    const f = link.holder; const e = link.target; const tf = link.tf;
    this._removeLink(link);
    const stillHeld = this._linksOn(e) > 0;
    if (stillHeld) { e.__twoHandedUntil = this.time + c.twoHandWindow; return; }
    if (!throwIt || link.age < c.throwMinHold || !this.physics.entities.has(e)) {
      if (tf) tf.noGrabUntil = this.time + 0.3;
      return;
    }
    const two = link.wasTwoHanded && (e.__twoHandedUntil || 0) >= this.time;
    const m = link.mass;
    const g = Math.abs(this.physics.config.gravity);
    const strength = c.strength * f.strengthMul * (two ? c.twoHandMult : 1);
    const sf = clamp(strength / (m * g * 1.3), 0.25, 1);       // heavy things do not fly as far
    const speed = (two ? c.throwTwo : c.throwOne) * sf;
    const fx = Math.sin(f.pose.yaw); const fz = Math.cos(f.pose.yaw);
    const vx = fx * speed + link.hvx * c.throwHandShare;
    const vy = c.throwUp * sf + Math.max(0, link.hvy) * c.throwHandShare;
    const vz = fz * speed + link.hvz * c.throwHandShare;
    e.body.applyImpulse({ x: m * vx, y: m * vy, z: m * vz }, true);
    if (tf) {
      tf.noGrabUntil = this.time + 0.5;
      tf.controller.forceStumble(fx, fz, false); // thrown characters tumble
    }
    this.emit('throw', { holder: f, target: e, victim: tf, speed: Math.hypot(vx, vz), twoHanded: two });
  }

  /** Removes one link and tidies the hand and the held character. */
  _removeLink(link) {
    const i = this.links.indexOf(link);
    if (i >= 0) this.links.splice(i, 1);
    const f = link.holder; const h = link.hand;
    h.sm.endHold();
    h.grip = null;
    if (!f.disposed) f.setHandFilter(h, 0);
    const tf = link.tf;
    if (tf && this._linksOn(link.target) === 0) {
      tf.heldBy = null;
      tf.controller.grabbed = false;
    }
  }

  _removeLinksOn(entity) {
    for (let i = this.links.length - 1; i >= 0; i--) if (this.links[i].target === entity) this._removeLink(this.links[i]);
  }

  /** Drops everything a fighter holds and everyone holding it (respawn, removal). */
  releaseAll(f) {
    for (let i = this.links.length - 1; i >= 0; i--) {
      const l = this.links[i];
      if (l.holder === f || l.tf === f) this._removeLink(l);
    }
    f.heldBy = null;
    f.controller.grabbed = false;
    f.controller.speedMul = 1;
  }
}

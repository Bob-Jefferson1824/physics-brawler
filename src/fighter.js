// A fighter: the soft pink (or coloured) toy character that the player and the bots both use.
//
// Physics: one upright capsule body for the torso/legs, plus TWO REAL HAND BODIES (small balls
// steered by velocity). The hands collide with crates and other characters, push them, and are
// what the grab links attach to. Arms are drawn as stretchy tubes from the shoulder to the hand
// body, so they always look connected.
//
// Both the human player and bots drive a Fighter the same way: by giving it an "intent"
// { moveX, moveZ, jump, left, right, faceYaw }.
import { CharacterController, CharacterPose } from './character.js?v=s4r1';
import { HandStateMachine, HS } from './hands.js?v=s4r1';
import { COMBAT, handGroups, charGroups } from './config.js?v=s4r1';
import { Avatar, shoulderFromPose } from './avatar.js?v=s4r1';

export function emptyIntent() {
  return { moveX: 0, moveZ: 0, jump: false, left: false, right: false, faceYaw: null };
}

export class Fighter {
  constructor({ THREE, physics, scene, config, color, spawn, index = 0, kind = 'player', name = 'Fighter' }) {
    this.THREE = THREE;
    this.physics = physics;
    this.scene = scene;
    this.config = config;
    this.color = color;
    this.index = index;
    this.kind = kind;
    this.name = name;
    this.spawn = { x: spawn.x, y: spawn.y, z: spawn.z };

    this.controller = new CharacterController();
    this.pose = new CharacterPose();
    this.intent = emptyIntent();
    this.combat = null;          // set by CombatSystem.addFighter
    this.heldBy = null;          // fighter currently holding this one
    this.struggle = 0;
    this.struggleJumps = 0;
    this.noGrabUntil = 0;
    this.strengthMul = 1;
    this.carryMass = 0;
    this.flash = 0;
    this.flailT = 0;             // arms swing loosely for a moment after a hit
    this.disposed = false;

    this._buildVisual(scene);

    const { radius, halfHeight } = config;
    this.body = physics.createDynamicCapsule({
      position: spawn, halfHeight, radius, lockTilt: true, lockYaw: true, groups: charGroups(index),
    });
    this.entity = physics.register(this.body, this.root, { kind, owner: this });

    // Two real hand bodies
    this.hands = {
      left: this._makeHand('left', +1, 0xff3f8f),
      right: this._makeHand('right', -1, 0xff3f8f),
    };
    this.handList = [this.hands.left, this.hands.right];

    this._pre = (dt) => this._fixedUpdate(dt);
    physics.addPreStep(this._pre);
  }

  // ---------------------------------------------------------------- visuals

  _buildVisual(scene) {
    const a = new Avatar(this.THREE, scene, this.color);
    this.avatar = a;
    this.bodyMat = a.bodyMat; this.endMat = a.endMat;
    this.root = a.root; this.pivot = a.pivot; this.squash = a.squash;
    this.legL = a.legL; this.legR = a.legR;
  }

  setLabel(text) { this.avatar.setLabel(text); }

  _makeHand(name, side) {
    const r = COMBAT.handRadius;
    const v = this.avatar.hand[name];
    const rest = this._restGoal({ side }, this.spawn, {});
    const body = this.physics.createHandBall({
      position: rest, radius: r, mass: COMBAT.handMass, groups: handGroups(this.index),
    });
    const entity = this.physics.register(body, v.mesh, { kind: 'hand', respawn: false, owner: this });
    return {
      name, side, sm: new HandStateMachine(name), body, mesh: v.mesh, entity, arm: v.arm, cap: v.cap,
      goal: { x: 0, y: 0, z: 0, vmax: 10, gain: 20 }, seek: null, grip: null, limp: 0,
    };
  }

  _applyPose(o) {
    this.avatar.applyPose(o);
  }

  /** Draws the stretchy arms after physics + interpolation. Call once per frame. */
  updateVisuals(dt) {
    if (this.disposed) return;
    this.avatar.placeArms(this.root.position, this.pose.out);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.avatar.setFlash(this.flash);
  }

  // ---------------------------------------------------------------- state helpers

  /** Smoothed (interpolated) position of the character, used as the camera target. */
  get position() { return this.root.position; }
  get grounded() { return this.controller.grounded; }
  get pos() { return this.body.translation(); }
  get stateName() { return this.controller.state; }
  get facing() { return this.pose.yaw; }
  get isPlayer() { return this.kind === 'player' || this.kind === 'remote'; } // human-controlled
  get canAct() {
    const s = this.controller.state;
    return !this.disposed && !this.heldBy && s !== 'stumble' && s !== 'down';
  }
  get holdInfo() { return this.combat ? this.combat.holdInfo(this) : null; }

  /** Aim assist for human players: while punching, grabbing or carrying, turn toward the nearest target. */
  applyAimAssist(it) {
    it.faceYaw = null;
    if ((it.left || it.right || this.holdInfo) && this.combat && this.canAct) {
      const a = this.combat.findAimTarget(this);
      if (a) {
        const p = this.body.translation();
        it.faceYaw = Math.atan2(a.x - p.x, a.z - p.z);
      }
    }
  }

  /** What a hand is doing, for the HUD. */
  handStatus(name) {
    const h = this.hands[name];
    const st = h.sm.state;
    if (st === HS.HOLD) {
      const label = this.combat ? this.combat.heldLabel(h) : 'something';
      return { mode: 'hold', text: `grabbing ${label}` };
    }
    if (st === HS.REACH) return { mode: 'reach', text: 'reaching' };
    if (st === HS.STRIKE || st === HS.RETRACT) return { mode: 'punch', text: 'punch' };
    return { mode: 'ready', text: 'ready' };
  }

  /** Where the shoulder is: from the body position, facing, lean and squash. */
  shoulderPos(side, base, out) {
    return shoulderFromPose(this.pose.out, side, base, out);
  }

  /** Natural hanging position of a hand, from the walk/air/stumble arm animation. */
  _restGoal(h, base, out) {
    const o = this.pose.out;
    const a = h.side > 0 ? o.armL : o.armR;
    const dlx = Math.sin(a.z);
    const dly = -Math.cos(a.z) * Math.cos(a.x);
    const dlz = -Math.cos(a.z) * Math.sin(a.x);
    const cx = Math.cos(o.yaw); const sx = Math.sin(o.yaw);
    const len = COMBAT.armRest;
    const sh = this._tmpR || (this._tmpR = { x: 0, y: 0, z: 0 });
    this.shoulderPos(h.side, base, sh);
    out.x = sh.x + (dlx * cx + dlz * sx) * len;
    out.y = sh.y + dly * len;
    out.z = sh.z + (-dlx * sx + dlz * cx) * len;
    return out;
  }

  // ---------------------------------------------------------------- per-frame update

  /** intent: { moveX, moveZ, jump (press), left, right (held), faceYaw|null } */
  update(dt, intent) {
    if (this.disposed) return;
    this.intent = intent;
    const c = this.controller;
    c.setMove(intent.moveX, intent.moveZ);
    if (intent.jump) {
      c.requestJump();
      if (this.heldBy) this.struggleJumps++;
    }
    const canAct = this.canAct;
    for (const h of this.handList) {
      const want = h.side > 0 ? intent.left : intent.right;
      if (want && !h.sm.down) h.sm.press();
      else if (!want && h.sm.down) h.sm.release();
      h.sm.update(dt, canAct);
    }
    const v = this.body.linvel();
    const o = this.pose.update(dt, {
      vx: v.x, vy: v.y, vz: v.z,
      grounded: c.grounded, state: c.state, stumbleDir: c.stumbleDir,
      move: c.move, events: c.consumeEvents(),
      faceYaw: intent.faceYaw, grabbed: !!this.heldBy,
    });
    this._applyPose(o);
  }

  // ---------------------------------------------------------------- per-physics-step update

  _fixedUpdate(dt) {
    if (this.disposed) return;
    const body = this.body;
    const t = body.translation();
    const v = body.linvel();
    const grounded = this._probeGround(t);
    const out = this.controller.fixedUpdate(dt, v, grounded);
    if (Math.abs(out.x - v.x) + Math.abs(out.y - v.y) + Math.abs(out.z - v.z) > 1e-4) {
      body.setLinvel(out, true);
    }
    this._stepHands(t, out, dt);
  }

  _probeGround(t) {
    const { radius, halfHeight } = this.config;
    const y = t.y - halfHeight - radius - 0.02;
    const len = this.controller.cfg.groundProbeLength;
    const o = radius * 0.65;
    const offsets = [[0, 0], [o, 0], [-o, 0], [0, o], [0, -o]];
    for (const [ox, oz] of offsets) {
      if (this.physics.raycast(t.x + ox, y, t.z + oz, 0, -1, 0, len) >= 0) return true;
    }
    return false;
  }

  /** Works out where a hand wants to be, and how fast it may move there. */
  _handGoal(h, base) {
    const g = h.goal;
    const o = this.pose.out;
    const fx = Math.sin(o.yaw); const fz = Math.cos(o.yaw);   // facing
    const sx = Math.cos(o.yaw); const sz = -Math.sin(o.yaw);  // character's left
    const sh = this._tmpG || (this._tmpG = { x: 0, y: 0, z: 0 });
    this.shoulderPos(h.side, base, sh);
    const inward = -0.15 * h.side;
    const st = h.sm.state;
    if (st === HS.STRIKE) {
      // Aim assist: if something is in front, the fist goes toward it (also lower for low crates)
      const a = this.combat ? this.combat.findAimTarget(this, 2.4, 1.0) : null;
      let dx = fx; let dz = fz; let y = sh.y - 0.05; let reach = COMBAT.strikeReach;
      if (a) {
        const ddx = a.x - sh.x; const ddz = a.z - sh.z; const dl = Math.hypot(ddx, ddz) || 1;
        dx = ddx / dl; dz = ddz / dl;
        y = Math.max(sh.y - 0.8, Math.min(sh.y - 0.05, a.y + 0.1));
        reach = Math.max(1.1, Math.min(1.8, dl + 0.45)); // aim through the target so the fist is still fast on contact
      }
      g.x = sh.x + dx * reach + sx * inward * 0.5;
      g.y = y;
      g.z = sh.z + dz * reach + sz * inward * 0.5;
      g.vmax = COMBAT.strikeSpeed; g.gain = COMBAT.strikeGain;
    } else if (st === HS.REACH) {
      if (h.seek) { g.x = h.seek.x; g.y = h.seek.y; g.z = h.seek.z; }
      else {
        g.x = sh.x + fx * COMBAT.reachForward + sx * inward;
        g.y = sh.y - COMBAT.reachDrop;
        g.z = sh.z + fz * COMBAT.reachForward + sz * inward;
      }
      g.vmax = COMBAT.reachSpeed; g.gain = COMBAT.reachGain;
    } else if (st === HS.HOLD && h.grip) {
      g.x = h.grip.x; g.y = h.grip.y; g.z = h.grip.z;
      g.vmax = COMBAT.holdSpeed; g.gain = COMBAT.holdGain;
    } else {
      this._restGoal(h, base, g);
      g.vmax = st === HS.RETRACT ? COMBAT.retractSpeed : COMBAT.idleSpeed;
      g.gain = COMBAT.idleGain;
    }
    if (g.y < 0.22) g.y = 0.22; // never steer a hand into the floor
    return g;
  }

  /**
   * Steers each hand body toward its goal. Normally the hand follows tightly (velocity control).
   * When the fighter is hit, stumbling, knocked down or held, the arms go LIMP: the hand is then
   * driven by a loose spring instead, so it lags behind the body, swings and flops.
   */
  _stepHands(base, ownerVel, dt = 1 / 60) {
    const st = this.controller.state;
    this.flailT = Math.max(0, this.flailT - dt);
    const wantLimp = !this.canAct || st === 'recover' || this.flailT > 0;
    const k = COMBAT.limpK; const cdamp = COMBAT.limpC;
    for (const h of this.handList) {
      const g = this._handGoal(h, base);
      const p = h.body.translation();
      const ex = g.x - p.x; const ey = g.y - p.y; const ez = g.z - p.z;
      // Safety: if a hand somehow ends up far from its owner, put it back (no stuck hands)
      if (Math.hypot(p.x - base.x, p.y - base.y, p.z - base.z) > 4) {
        h.body.setTranslation({ x: g.x, y: g.y, z: g.z }, true);
        h.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        h.limp = 0;
        continue;
      }
      h.limp += ((wantLimp ? 1 : 0) - h.limp) * Math.min(1, dt * COMBAT.limpBlend);
      // tight control
      let vx = ex * g.gain; let vy = ey * g.gain; let vz = ez * g.gain;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > g.vmax) { const kk = g.vmax / sp; vx *= kk; vy *= kk; vz *= kk; }
      vx += ownerVel.x; vy += ownerVel.y; vz += ownerVel.z;
      if (h.limp > 0.02) {
        // loose spring: keeps its own velocity, is pulled toward the goal, droops with gravity
        const cur = h.body.linvel();
        const sx = cur.x + (k * ex - cdamp * (cur.x - ownerVel.x * 0.3)) * dt;
        const sy = cur.y + (k * ey - cdamp * (cur.y - ownerVel.y * 0.3) - COMBAT.limpGravity) * dt;
        const sz = cur.z + (k * ez - cdamp * (cur.z - ownerVel.z * 0.3)) * dt;
        vx += (sx - vx) * h.limp; vy += (sy - vy) * h.limp; vz += (sz - vz) * h.limp;
      }
      h.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    }
  }

  /** Throws the arms about after a hit: outward and up, away from the direction of the blow. */
  flail(dx, dz, amount) {
    this.flailT = 0.6;
    const o = this.pose.out;
    const cx = Math.cos(o.yaw); const sx = Math.sin(o.yaw);
    for (const h of this.handList) {
      const v = h.body.linvel();
      const side = h.side;                       // +1 left, -1 right
      h.body.setLinvel({
        x: v.x - dx * amount * 0.6 + cx * side * amount * 0.5,
        y: v.y + amount * 0.55,
        z: v.z - dz * amount * 0.6 - sx * side * amount * 0.5,
      }, true);
      h.limp = 1;
    }
  }

  setHandFilter(h, excludeMask) {
    this.physics.setColliderGroups(h.body, handGroups(this.index, excludeMask));
  }

  // ---------------------------------------------------------------- lifecycle

  /** Called after the physics system moved this fighter back to its spawn point. */
  onRespawned() {
    if (this.combat) this.combat.releaseAll(this);
    this.controller.reset();
    this.pose.reset();
    this.struggle = 0;
    this.struggleJumps = 0;
    this.heldBy = null;
    this.flash = 0;
    const base = this.body.translation();
    for (const h of this.handList) {
      h.sm.reset();
      h.seek = null;
      h.grip = null;
      const g = this._restGoal(h, base, {});
      h.body.setTranslation(g, true);
      h.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      h.entity.currP.set(g.x, g.y, g.z);
      h.entity.prevP.copy(h.entity.currP);
      h.mesh.position.set(g.x, g.y, g.z);
    }
    this._applyPose(this.pose.out);
  }

  respawn() {
    this.physics.respawnEntity(this.entity);
  }

  /** Test tool: a hard sideways shove plus a hop. */
  shove() {
    const angle = Math.random() * Math.PI * 2;
    const m = this.body.mass();
    this.body.applyImpulse({ x: Math.cos(angle) * m * 11, y: m * 8, z: Math.sin(angle) * m * 11 }, true);
  }

  dispose() {
    if (this.disposed) return;
    if (this.combat) this.combat.removeFighter(this);
    this.disposed = true;
    this.physics.removePreStep(this._pre);
    this.physics.remove(this.entity);
    for (const h of this.handList) this.physics.remove(h.entity);
    this.avatar.dispose();
  }
}

// Pure movement and animation logic for the player character.
// No Three.js or Rapier in here, so it can be unit-tested without a browser.
//
//  CharacterController - turns intent (move direction, jump) into the velocity the physics body
//                        should have each fixed step. Handles acceleration, jumping rules and
//                        stumbling when the body is hit by something sudden.
//  CharacterPose       - turns the body's physical state into cartoon animation values
//                        (lean, wobble, limb swing, squash and stretch).
import { CHARACTER } from './config.js?v=s4r1';

const hypot = Math.hypot;

/** Converts keyboard axes into a world-space direction relative to where the camera looks. */
export function cameraRelativeMove(cameraYaw, forwardAxis, rightAxis) {
  // The camera sits at (sin yaw, cos yaw) from the target, so it looks along (-sin yaw, -cos yaw).
  const s = Math.sin(cameraYaw);
  const c = Math.cos(cameraYaw);
  let x = -s * forwardAxis + c * rightAxis;
  let z = -c * forwardAxis - s * rightAxis;
  const len = hypot(x, z);
  if (len > 1) { x /= len; z /= len; } // diagonals are no faster than straight lines
  return { x, z };
}

export class CharacterController {
  constructor(cfg = CHARACTER) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.move = { x: 0, z: 0 };
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.jumpCooldown = 0;
    this.last = { x: 0, z: 0 };   // horizontal velocity we asked for last step
    this.wasGrounded = false;
    this.peakFall = 0;
    this.grounded = false;
    this.state = 'normal';        // 'normal' | 'stumble' | 'down' | 'recover'
    this.grabbed = false;         // set by the combat system while someone is holding this character
    this.speedMul = 1;            // set by the combat system while carrying something heavy
    this.stateTimer = 0;
    this.stumbleCooldown = 0;
    this.stumbleDir = { x: 0, z: 1 };
    this.events = { jumped: false, landed: 0, stumbled: false, knockedDown: false };
  }

  setMove(x, z) {
    this.move.x = x;
    this.move.z = z;
  }

  /** Call once per key PRESS (not while held), so holding Space cannot chain jumps. */
  requestJump() {
    this.jumpBuffer = this.cfg.jumpBuffer;
  }

  /** Returns and clears the one-shot events (jump, landing, stumble) for the animation system. */
  consumeEvents() {
    const e = this.events;
    this.events = { jumped: false, landed: 0, stumbled: false, knockedDown: false };
    return e;
  }

  /** Used by the combat system (for example when this character is thrown). */
  forceStumble(dirX, dirZ, knockDown = false) {
    const len = hypot(dirX, dirZ) || 1;
    this.stumbleDir = { x: dirX / len, z: dirZ / len };
    this.events.stumbled = true;
    if (knockDown) {
      this.state = 'down';
      this.stateTimer = this.cfg.downTime;
      this.events.knockedDown = true;
    } else if (this.state === 'normal' || this.state === 'recover') {
      this.state = 'stumble';
      this.stateTimer = this.cfg.stumbleTime;
    }
  }

  /**
   * Called before every physics step.
   * vel = current body velocity, grounded = result of the ground probe.
   * Returns the velocity to give the body.
   */
  fixedUpdate(dt, vel, grounded) {
    const cfg = this.cfg;
    this.grounded = grounded;

    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    this.stumbleCooldown = Math.max(0, this.stumbleCooldown - dt);

    if (grounded && this.jumpCooldown <= 0) this.coyote = cfg.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);

    // Landing detection (fall speed is remembered because contact zeroes it before we look)
    if (!grounded) this.peakFall = Math.max(this.peakFall, -vel.y);
    let landSpeed = 0;
    if (grounded && !this.wasGrounded) {
      landSpeed = Math.max(this.peakFall, -vel.y);
      this.peakFall = 0;
      if (landSpeed > 3) this.events.landed = Math.max(this.events.landed, landSpeed);
    }
    this.wasGrounded = grounded;

    // Sudden velocity change we did not ask for (shove, heavy hit) makes the character stumble.
    const ex = vel.x - this.last.x;
    const ez = vel.z - this.last.z;
    const em = hypot(ex, ez);
    if (em > cfg.knockdownThreshold && this.state !== 'down') {
      this.state = 'down';
      this.stateTimer = cfg.downTime;
      this.stumbleDir = { x: ex / em, z: ez / em };
      this.events.stumbled = true;
      this.events.knockedDown = true;
    } else if (em > cfg.stumbleThreshold && this.state === 'normal' && this.stumbleCooldown <= 0) {
      this.state = 'stumble';
      this.stateTimer = cfg.stumbleTime;
      this.stumbleDir = { x: ex / em, z: ez / em };
      this.events.stumbled = true;
    }

    // Landing hard while already stumbling (for example after being thrown) knocks the character down
    if (landSpeed > cfg.hardLandSpeed && this.state === 'stumble') {
      this.state = 'down';
      this.stateTimer = cfg.downTime;
      this.events.knockedDown = true;
    }

    if (this.state === 'down') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) { this.state = 'recover'; this.stateTimer = cfg.recoverTime; }
    } else if (this.state === 'stumble') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) { this.state = 'recover'; this.stateTimer = cfg.recoverTime; }
    } else if (this.state === 'recover') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) { this.state = 'normal'; this.stumbleCooldown = cfg.stumbleCooldown; }
    }

    // Horizontal: move current velocity toward the wanted velocity at a limited rate
    const down = this.state === 'down';
    let control = (grounded ? 1 : cfg.airControl) *
      (this.state === 'stumble' ? 0.25 : this.state === 'recover' ? 0.7 : down ? 0.35 : 1);
    if (this.grabbed) control *= 0.25; // held characters can barely steer, they can only struggle
    const hasInput = !down && hypot(this.move.x, this.move.z) > 0.01;
    const topSpeed = cfg.maxSpeed * this.speedMul;
    const tx = down ? 0 : this.move.x * topSpeed;
    const tz = down ? 0 : this.move.z * topSpeed;
    const dx = tx - vel.x;
    const dz = tz - vel.z;
    const dm = hypot(dx, dz);
    const rate = (hasInput ? cfg.accel : cfg.decel) * control * dt;
    let nx;
    let nz;
    if (dm <= rate) { nx = tx; nz = tz; }
    else { nx = vel.x + (dx / dm) * rate; nz = vel.z + (dz / dm) * rate; }
    if (landSpeed > 15) { nx *= 0.7; nz *= 0.7; } // hard landings cost some speed

    // Vertical: only jumps (and a fall-speed cap) touch it; gravity stays with the physics engine
    let ny = vel.y;
    if (this.jumpBuffer > 0 && this.coyote > 0 && this.jumpCooldown <= 0 &&
        this.state !== 'stumble' && this.state !== 'down' && !this.grabbed) {
      ny = cfg.jumpSpeed;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumpCooldown = cfg.jumpCooldown;
      this.events.jumped = true;
    }
    ny = Math.max(ny, -cfg.maxFallSpeed);

    this.last.x = nx;
    this.last.z = nz;
    return { x: nx, y: ny, z: nz };
  }
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const mix = (a, b, t) => a + (b - a) * t;

/** Cartoon animation values driven by the body's real velocity and state. */
export class CharacterPose {
  constructor(cfg = CHARACTER) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.yaw = 0;
    this.lx = 0; this.lz = 0;       // lean (radians toward world +X / +Z)
    this.lvx = 0; this.lvz = 0;     // lean spring velocity
    this.s = 0; this.sv = 0;        // squash/stretch spring
    this.phase = 0;
    this.time = 0;
    this.aAir = 0;
    this.aStumble = 0;
    this.prevVx = 0; this.prevVz = 0;
    this.ax = 0; this.az = 0;
    this.out = {
      yaw: 0, leanX: 0, leanZ: 0, scaleY: 1, scaleXZ: 1, bob: 0,
      armL: { x: 0, z: 0.2 }, armR: { x: 0, z: -0.2 },
      legL: { x: 0 }, legR: { x: 0 },
    };
  }

  /** A visual jolt (a hit that is too light to make the character stumble). */
  kick(dx, dz, amount) {
    this.lvx += dx * amount;
    this.lvz += dz * amount;
  }

  /** s = { vx, vy, vz, grounded, state, stumbleDir, move: {x,z}, events } */
  update(rawDt, s) {
    const dt = Math.min(rawDt, 1 / 30);
    if (dt <= 0) return this.out;
    const cfg = this.cfg;
    this.time += dt;
    const speed = hypot(s.vx, s.vz);
    const sf = Math.min(1, speed / cfg.maxSpeed);

    // Turn toward the aim target if there is one, otherwise toward where the player is steering
    const downOrStumble = s.state === 'stumble' || s.state === 'down';
    const aiming = s.faceYaw !== undefined && s.faceYaw !== null;
    if (!downOrStumble && (aiming || hypot(s.move.x, s.move.z) > 0.1)) {
      const target = aiming ? s.faceYaw : Math.atan2(s.move.x, s.move.z);
      const sharp = aiming ? cfg.turnSharpness * 1.4 : cfg.turnSharpness;
      this.yaw = wrapAngle(this.yaw + wrapAngle(target - this.yaw) * (1 - Math.exp(-sharp * dt)));
    }

    // Smoothed acceleration, used for leaning into speed changes and turns
    const kA = 1 - Math.exp(-12 * dt);
    this.ax += (Math.max(-60, Math.min(60, (s.vx - this.prevVx) / dt)) - this.ax) * kA;
    this.az += (Math.max(-60, Math.min(60, (s.vz - this.prevVz) / dt)) - this.az) * kA;
    this.prevVx = s.vx; this.prevVz = s.vz;

    // One-shot events
    const ev = s.events || {};
    if (ev.stumbled) {
      const kick = ev.knockedDown ? 9 : 6;
      this.lvx += s.stumbleDir.x * kick;
      this.lvz += s.stumbleDir.z * kick;
    }
    if (ev.jumped) this.sv += 2.2;
    if (ev.landed) this.sv -= Math.min(ev.landed * 0.35, 4.5);

    // Lean spring: leans toward velocity and acceleration, tips over when stumbling,
    // and wobbles back upright afterwards because the spring is under-damped.
    let tx = s.vx * 0.022 + this.ax * 0.010;
    let tz = s.vz * 0.022 + this.az * 0.010;
    let leanCap = 0.9;
    if (s.state === 'stumble') { tx = s.stumbleDir.x * 0.8; tz = s.stumbleDir.z * 0.8; }
    else if (s.state === 'down') { tx = s.stumbleDir.x * 1.4; tz = s.stumbleDir.z * 1.4; leanCap = 1.5; } // lies flat
    const tm = hypot(tx, tz);
    if (tm > leanCap) { tx *= leanCap / tm; tz *= leanCap / tm; }
    const k = 90;
    const c = 11;
    this.lvx += (k * (tx - this.lx) - c * this.lvx) * dt;
    this.lvz += (k * (tz - this.lz) - c * this.lvz) * dt;
    this.lx += this.lvx * dt;
    this.lz += this.lvz * dt;

    // Squash and stretch spring (stretches a little while rising, squashes on landing)
    const sTarget = s.grounded ? 0 : Math.max(-0.08, Math.min(0.12, s.vy * 0.012));
    this.sv += (140 * (sTarget - this.s) - 9 * this.sv) * dt;
    this.s += this.sv * dt;
    this.s = Math.max(-0.45, Math.min(0.45, this.s));

    // Walk cycle advances with distance actually travelled on the ground
    if (s.grounded && speed > 0.3) this.phase += speed * dt * 1.7;

    this.aAir += ((s.grounded ? 0 : 1) - this.aAir) * (1 - Math.exp(-12 * dt));
    const stTarget = (s.state === 'stumble' || s.state === 'down') ? 1 : s.grabbed ? 0.8 : s.state === 'recover' ? 0.35 : 0;
    this.aStumble += (stTarget - this.aStumble) * (1 - Math.exp(-10 * dt));

    // Limb poses
    const t = this.time;
    const swing = Math.sin(this.phase);
    const A = 0.9 * sf;
    const walk = {
      legL: -swing * A, legR: swing * A,
      armLx: swing * A * 0.9, armRx: -swing * A * 0.9,
      armLz: 0.2 + sf * 0.05, armRz: -0.2 - sf * 0.05,
    };
    const flap = s.vy < 0 ? Math.sin(t * 16) * 0.25 : 0;
    const air = {
      legL: -0.7, legR: 0.35,
      armLx: -0.6 + flap, armRx: -0.6 - flap,
      armLz: 1.1, armRz: -1.1,
    };
    const stumble = {
      legL: Math.sin(t * 11) * 0.9, legR: Math.sin(t * 11 + Math.PI) * 0.9,
      armLx: -1.2 + Math.sin(t * 13) * 0.9, armRx: -1.2 + Math.sin(t * 13 + 2) * 0.9,
      armLz: 0.9 + Math.sin(t * 9) * 0.3, armRz: -0.9 - Math.sin(t * 9 + 1) * 0.3,
    };
    const pose = {};
    for (const key of Object.keys(walk)) {
      const base = mix(walk[key], air[key], this.aAir);
      pose[key] = mix(base, stumble[key], this.aStumble);
    }

    const o = this.out;
    o.yaw = this.yaw;
    // Gentle idle sway keeps the toy feeling alive when standing still
    const sway = (1 - sf) * 0.02 * Math.sin(t * 1.7);
    o.leanX = this.lx + sway;
    o.leanZ = this.lz + sway * 0.7;
    o.scaleY = 1 + this.s;
    o.scaleXZ = 1 / Math.sqrt(o.scaleY);
    o.bob = (s.grounded ? Math.abs(Math.sin(this.phase)) * 0.07 * sf : 0) + Math.sin(t * 2.4) * 0.008;
    o.legL.x = pose.legL; o.legR.x = pose.legR;
    o.armL.x = pose.armLx; o.armL.z = pose.armLz;
    o.armR.x = pose.armRx; o.armR.z = pose.armRz;
    return o;
  }
}

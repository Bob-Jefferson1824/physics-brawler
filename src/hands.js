// Pure state machine for one hand (no Three.js / Rapier).
//
//   tap  -> STRIKE (punch out) -> RETRACT -> IDLE
//   hold -> STRIKE -> REACH (arm stays out looking for something to grab) -> HOLD (grabbed) -> RETRACT
//   release in any state -> RETRACT
//
// The combat system decides when REACH becomes HOLD (a real grab link was made) and when a HOLD
// ends. This file only tracks timing, so it can be unit-tested on its own.
import { COMBAT } from './config.js?v=s4r1';

export const HS = Object.freeze({
  IDLE: 'idle',
  STRIKE: 'strike',
  RETRACT: 'retract',
  REACH: 'reach',
  HOLD: 'hold',
});

export class HandStateMachine {
  constructor(side, cfg = COMBAT) {
    this.side = side;
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.state = HS.IDLE;
    this.t = 0;
    this.down = false;          // is the button currently held
    this.cooldown = 0;
    this.strikeActive = false;  // true while a punch can still hit something
    this.hitDone = false;       // each punch hits at most once
    this._buffer = 0;           // a press made slightly early (during cooldown) still counts
    this.events = { punched: false };
  }

  press() {
    if (!this.down) {
      this.down = true;
      this._buffer = this.cfg.pressBuffer;
    }
  }

  release() {
    this.down = false;
  }

  /** Called by the combat system when a grab link was created. */
  beginHold() {
    if (this.state !== HS.REACH) return false;
    this.state = HS.HOLD;
    this.t = 0;
    return true;
  }

  /** Called by the combat system when a held object is let go or lost. */
  endHold() {
    if (this.state === HS.HOLD) this._toRetract();
  }

  consumeEvents() {
    const e = this.events;
    this.events = { punched: false };
    return e;
  }

  _toRetract() {
    this.state = HS.RETRACT;
    this.t = 0;
    this.strikeActive = false;
  }

  update(dt, canAct) {
    const c = this.cfg;
    this.t += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this._buffer = Math.max(0, this._buffer - dt);

    // Losing balance (stumble, knocked down, being held) pulls the arm back
    if (!canAct && this.state !== HS.IDLE && this.state !== HS.RETRACT) this._toRetract();

    if (this.state === HS.IDLE || this.state === HS.RETRACT) {
      if (this._buffer > 0 && canAct && this.cooldown <= 0) {
        this.state = HS.STRIKE;
        this.t = 0;
        this.strikeActive = true;
        this.hitDone = false;
        this.cooldown = c.punchCooldown;
        this._buffer = 0;
        this.events.punched = true;
      } else if (this.state === HS.RETRACT && this.t >= c.retractTime) {
        this.state = HS.IDLE;
        this.t = 0;
      }
    } else if (this.state === HS.STRIKE) {
      if (this.t >= c.strikeTime) {
        this.strikeActive = false;
        if (this.down) { this.state = HS.REACH; this.t = 0; } // still held: go looking for a grab
        else this._toRetract();
      }
    } else if (this.state === HS.REACH || this.state === HS.HOLD) {
      if (!this.down) this._toRetract();
    }
  }
}

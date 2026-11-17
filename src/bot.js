// AI opponents. A BotBrain decides what to do (pure logic, testable); a Bot is a Fighter driven by
// that brain, so bots use exactly the same body, hands and physics as the player.
import { Fighter } from './fighter.js?v=s4r1';
import { BOTS } from './config.js?v=s4r1';
import { squareArena } from './maps.js?v=s4r1';

export const DIFFICULTY = {
  easy:   { reaction: [0.7, 1.1],   perception: 9,  grabBias: 0.15, bothHands: 0.0,  throwSkill: 0.2, crateInterest: 0.15, speedMul: 0.65, edgeAvoid: 3.2, struggle: 0.4, attackDelay: 1.5, strength: 0.8 },
  normal: { reaction: [0.35, 0.6],  perception: 13, grabBias: 0.35, bothHands: 0.25, throwSkill: 0.6, crateInterest: 0.45, speedMul: 0.85, edgeAvoid: 4,   struggle: 0.8, attackDelay: 1,   strength: 1 },
  hard:   { reaction: [0.12, 0.25], perception: 18, grabBias: 0.55, bothHands: 0.5,  throwSkill: 1,   crateInterest: 0.7,  speedMul: 1,    edgeAvoid: 5,   struggle: 1.3, attackDelay: 0.6, strength: 1.1 },
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/**
 * Decides what a bot does. It never touches physics: it reads a "self" view and returns an intent.
 *   self:  { pos, stateName, heldBy, holdInfo, facing }
 *   world: { enemies: [self-like views + isPlayer], crates: [{ pos, mass, held }] }
 */
export class BotBrain {
  constructor({ difficulty = 'normal', seed = 1, arenaHalf = 20, arena = null } = {}) {
    this.half = arenaHalf;
    this.arena = arena || squareArena(arenaHalf); // answers "is there floor here?" for any map
    this.rng = mulberry32(seed * 7919 + 13);
    this.setDifficulty(difficulty);
    // Each bot gets its own personality so they do not all behave identically
    this.aggression = 0.75 + this.rng() * 0.5;
    this.handBias = this.rng();
    this.wanderSpeed = 0.55 + this.rng() * 0.35;
    this.grabLean = (this.rng() - 0.5) * 0.3;
    this.intent = { moveX: 0, moveZ: 0, jump: false, left: false, right: false, faceYaw: null };
    this.mode = 'wander';
    this.time = 0;
    this.decT = this.rng() * 0.5;
    this.attackT = 0.5 + this.rng();
    this.leftT = 0; this.rightT = 0; this.noPressT = 0;
    this.goal = null; this.goalT = 0;
    this.target = null; this.crate = null;
    this.edgePlan = false; this.throwAfter = 1;
    this.nextLeft = this.rng() < 0.5;
    this.strugT = 0; this.strugAngle = 0;
  }

  setDifficulty(name) {
    this.diffName = DIFFICULTY[name] ? name : 'normal';
    this.diff = DIFFICULTY[this.diffName];
  }

  _r(a, b) { return a + this.rng() * (b - a); }

  update(dt, self, getWorld) {
    const I = this.intent; const d = this.diff;
    this.time += dt;
    this.decT -= dt; this.attackT -= dt; this.leftT -= dt; this.rightT -= dt; this.noPressT -= dt;
    I.jump = false; I.faceYaw = null;

    // Being held: struggle (the faster the bot, the harder it struggles)
    if (self.heldBy) {
      this.strugT -= dt;
      if (this.strugT <= 0) { this.strugT = 0.25; this.strugAngle = this.rng() * Math.PI * 2; }
      I.moveX = Math.cos(this.strugAngle); I.moveZ = Math.sin(this.strugAngle);
      if (this.rng() < dt * 2.2 * d.struggle) I.jump = true;
      I.left = false; I.right = false; this.leftT = this.rightT = 0;
      return I;
    }
    const st = self.stateName;
    if (st === 'stumble' || st === 'down') {
      I.moveX = 0; I.moveZ = 0; I.left = false; I.right = false; this.leftT = this.rightT = 0;
      this.decT = Math.min(this.decT, this._r(d.reaction[0], d.reaction[1]));
      return I;
    }

    const p = self.pos;
    const holding = self.holdInfo;
    const carryToEdge = !!(holding && holding.targetIsFighter && this.edgePlan);

    // Stay away from drops (unless deliberately carrying someone to throw them off)
    if (!this.arena.isSafe(p.x, p.z, d.edgeAvoid) && !carryToEdge) {
      const c = this.arena.centreOf(p.x, p.z);
      const dx = c.x - p.x; const dz = c.z - p.z; const dl = Math.hypot(dx, dz) || 1;
      I.moveX = (dx / dl) * d.speedMul; I.moveZ = (dz / dl) * d.speedMul;
      this._buttons(holding);
      return I;
    }

    const wasCarrying = this.mode === 'carry';
    if (this.decT <= 0 || (holding && !wasCarrying) || (!holding && wasCarrying)) {
      this._decide(self, holding, getWorld());
      this.decT = this._r(d.reaction[0], d.reaction[1]);
    }

    switch (this.mode) {
      case 'attack': this._doAttack(self, p); break;
      case 'fetch': this._doFetch(p); break;
      case 'carry': this._doCarry(self, p, holding); break;
      default: this._doWander(dt, p); break;
    }
    this._buttons(holding);
    return I;
  }

  _buttons(holding) {
    const I = this.intent;
    if (this.mode === 'carry' && holding && this.noPressT <= 0) {
      I.left = holding.left; I.right = holding.right; // keep holding until deciding to throw
    } else {
      I.left = this.noPressT <= 0 && this.leftT > 0;
      I.right = this.noPressT <= 0 && this.rightT > 0;
    }
  }

  _decide(self, holding, world) {
    const d = this.diff; const p = self.pos;
    if (holding) {
      this.mode = 'carry';
      this.target = this._nearestEnemy(p, world, 99);
      this.throwAfter = this._r(0.8, 1.8) * (this.diffName === 'hard' ? 0.7 : this.diffName === 'easy' ? 1.2 : 1);
      this.edgePlan = holding.targetIsFighter && (this.diffName === 'hard' || (this.diffName === 'normal' && this.rng() < 0.4));
      return;
    }
    const enemy = this._nearestEnemy(p, world, d.perception);
    if (enemy) { this.mode = 'attack'; this.target = enemy; return; }
    if (this.rng() < d.crateInterest) {
      let best = null; let bd = 11;
      for (const c of world.crates) {
        if (c.held) continue;
        const dd = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
        if (dd < bd) { bd = dd; best = c; }
      }
      if (best) { this.mode = 'fetch'; this.crate = best; return; }
    }
    this.mode = 'wander';
  }

  _nearestEnemy(p, world, range) {
    let best = null; let bs = Infinity;
    for (const e of world.enemies) {
      const q = e.pos; const dist = Math.hypot(q.x - p.x, q.z - p.z);
      if (dist > range) continue;
      const score = dist * (e.isPlayer ? 0.75 : 1); // bots pick on the human a little more
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  }

  _steer(tx, tz, p, speed, stop = 0) {
    const I = this.intent;
    const dx = tx - p.x; const dz = tz - p.z; const dist = Math.hypot(dx, dz);
    if (dist <= stop || dist < 0.01) { I.moveX = 0; I.moveZ = 0; return dist; }
    I.moveX = (dx / dist) * speed; I.moveZ = (dz / dist) * speed;
    return dist;
  }

  _doWander(dt, p) {
    const d = this.diff;
    this.goalT -= dt;
    if (!this.goal || this.goalT <= 0 || Math.hypot(this.goal.x - p.x, this.goal.z - p.z) < 1.2) {
      this.goal = this.arena.randomPoint(this.rng, d.edgeAvoid + 1.5);
      this.goalT = this._r(3, 6);
    }
    this._steer(this.goal.x, this.goal.z, p, this.wanderSpeed * d.speedMul);
  }

  _doAttack(self, p) {
    const I = this.intent; const d = this.diff; const t = this.target;
    if (!t) { this.mode = 'wander'; return; }
    const q = t.pos; const dx = q.x - p.x; const dz = q.z - p.z; const dist = Math.hypot(dx, dz);
    I.faceYaw = Math.atan2(dx, dz);
    this._steer(q.x, q.z, p, d.speedMul * this.aggression, 1.25);
    if (dist <= 1.8 && this.attackT <= 0 && this.noPressT <= 0) {
      if (this.rng() < d.grabBias + this.grabLean) {            // try to grab
        const both = this.rng() < d.bothHands;
        const secs = this._r(1.2, 2.0);
        if (both || this.handBias > 0.5) this.rightT = secs;
        if (both || this.handBias <= 0.5) this.leftT = secs;
        this.attackT = this._r(1.6, 2.6) * d.attackDelay;
      } else {                                                   // punch (a quick tap)
        if (this.nextLeft) this.leftT = 0.09; else this.rightT = 0.09;
        if (this.rng() < 0.7) this.nextLeft = !this.nextLeft;
        this.attackT = (this._r(0.35, 0.7) / this.aggression) * d.attackDelay;
      }
    }
  }

  _doFetch(p) {
    const I = this.intent; const c = this.crate;
    if (!c || c.held) { this.mode = 'wander'; return; }
    const dist = this._steer(c.pos.x, c.pos.z, p, this.diff.speedMul * 0.8, 1.0);
    I.faceYaw = Math.atan2(c.pos.x - p.x, c.pos.z - p.z);
    if (dist < 1.6 && this.attackT <= 0 && this.noPressT <= 0) {
      if (this.handBias > 0.3) this.leftT = 2.5;
      if (this.handBias < 0.7 || c.mass > 1.2) this.rightT = 2.5; // heavier crates: use both hands
      this.attackT = 1.5;
    }
  }

  _doCarry(self, p, holding) {
    const I = this.intent; const d = this.diff;
    if (holding.age > 6) { this._letGo(); return; }
    const t = this.target;
    if (this.edgePlan && holding.targetIsFighter) {
      // Carry the victim toward the nearest drop and throw them off
      const e = this.arena.dropEdge(p);
      this._steer(e.x, e.z, p, d.speedMul * 0.8);
      I.faceYaw = e.yaw;
      if (e.dist <= 4.2 && Math.abs(angDiff(self.facing, e.yaw)) < 0.5 && holding.age >= 0.6) this._letGo();
      return;
    }
    if (t) {
      const dx = t.pos.x - p.x; const dz = t.pos.z - p.z; const dist = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      I.faceYaw = want;
      this._steer(t.pos.x, t.pos.z, p, d.speedMul * 0.7, 3.5);
      const aligned = Math.abs(angDiff(self.facing, want)) < (this.diffName === 'hard' ? 0.35 : 0.8);
      if (holding.age >= this.throwAfter && (aligned || holding.age > this.throwAfter + 1.2)) this._letGo();
    } else if (holding.age >= this.throwAfter) {
      this._letGo(); // nobody to throw at: just put it down
    }
  }

  _letGo() {
    this.leftT = 0; this.rightT = 0;
    this.noPressT = 0.7; // do not instantly grab again
    this.attackT = Math.max(this.attackT, 0.6);
    this.edgePlan = false;
    this.intent.left = false; this.intent.right = false;
  }
}

/** A Fighter whose intent comes from a BotBrain. */
export class Bot extends Fighter {
  constructor({ THREE, physics, scene, config, color, spawn, index, name, difficulty, arenaHalf, arena = null }) {
    super({ THREE, physics, scene, config, color, spawn, index, kind: 'bot', name });
    this.brain = new BotBrain({ difficulty, seed: index, arenaHalf, arena });
    this.setLabel(name);
    this.strengthMul = this.brain.diff.strength;
  }

  setDifficulty(name) {
    this.brain.setDifficulty(name);
    this.strengthMul = this.brain.diff.strength;
  }

  think(dt, getWorld) {
    const intent = this.brain.update(dt, this, getWorld);
    this.update(dt, intent);
  }
}

/** Creates, removes and resets the bots; owns the bot settings. */
export class BotManager {
  constructor({ THREE, physics, scene, combat, config, arenaHalf, settings, arena = null, spawnFor = null }) {
    this.THREE = THREE; this.physics = physics; this.scene = scene; this.combat = combat;
    this.config = config; this.arenaHalf = arenaHalf;
    this.arena = arena || squareArena(arenaHalf);
    this.spawnFor = spawnFor || ((i) => ({ x: BOTS.spawns[i - 1].x, y: 2, z: BOTS.spawns[i - 1].z }));
    this.reserved = 0;           // slots taken by online players (they count toward the 6 fighters)
    this.settings = { enabled: true, count: BOTS.defaultCount, difficulty: BOTS.defaultDifficulty, ...settings };
    this.settings.count = Math.max(0, Math.min(BOTS.max, Math.round(this.settings.count)));
    this.bots = [];
    this.apply();
  }

  get activeCount() { return this.bots.length; }

  _freeIndex() {
    for (let i = 1; i <= BOTS.max; i++) {
      if (this.bots.some((b) => b.index === i)) continue;
      if (this.combat.fighters.some((f) => f.index === i)) continue; // taken by an online player
      return i;
    }
    return -1;
  }

  /** The most bots that fit alongside the online players. */
  get capacity() { return Math.max(0, BOTS.max - this.reserved); }

  /** Called when the map changes: bots learn the new layout. */
  setArena(arena) {
    this.arena = arena;
    for (const b of this.bots) b.brain.arena = arena;
  }

  _create(index) {
    const bot = new Bot({
      THREE: this.THREE, physics: this.physics, scene: this.scene, config: this.config,
      color: BOTS.colors[index - 1], spawn: this.spawnFor(index), arena: this.arena,
      index, name: `Bot ${index}`, difficulty: this.settings.difficulty, arenaHalf: this.arenaHalf,
    });
    this.combat.addFighter(bot);
    this.bots.push(bot);
    return bot;
  }

  /** Makes the number of live bots match the settings. */
  apply() {
    const target = this.settings.enabled ? Math.min(this.settings.count, this.capacity) : 0;
    while (this.bots.length > target) this.bots.pop().dispose();
    while (this.bots.length < target) {
      const i = this._freeIndex();
      if (i < 0) break;
      this._create(i);
    }
    this.bots.sort((a, b) => a.index - b.index);
  }

  setCount(n) { this.settings.count = Math.max(0, Math.min(BOTS.max, Math.round(n))); this.apply(); }
  setEnabled(on) { this.settings.enabled = !!on; this.apply(); }
  setDifficulty(name) {
    if (!DIFFICULTY[name]) return;
    this.settings.difficulty = name;
    for (const b of this.bots) b.setDifficulty(name);
  }

  /** Puts every bot back at its starting place with a fresh mind. */
  reset() {
    for (const b of this.bots) {
      this.combat.releaseAll(b);
      this.physics.respawnEntity(b.entity); // also calls onRespawned through the game's handler
      b.onRespawned();
      b.brain = new BotBrain({ difficulty: this.settings.difficulty, seed: b.index, arenaHalf: this.arenaHalf, arena: this.arena });
    }
  }

  /** Lightweight view of the world for a bot's brain (built only when it needs to decide). */
  _world(bot) {
    const enemies = [];
    for (const f of this.combat.fighters) if (f !== bot && !f.disposed) enemies.push(f);
    const crates = [];
    for (const e of this.physics.entities) {
      if (e.kind !== 'crate') continue;
      crates.push({ pos: e.body.translation(), mass: e.body.mass(), held: !!this.combat._holderOf(e) });
    }
    return { enemies, crates };
  }

  update(dt) {
    for (const b of this.bots) b.think(dt, () => this._world(b));
  }

  updateVisuals(dt) {
    for (const b of this.bots) b.updateVisuals(dt);
  }
}

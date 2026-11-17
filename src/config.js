// Central place for tunable numbers and dependency URLs.

// Pinned versions so the game does not break when a library releases an update.
// Each library lists a primary CDN and a fallback CDN.
export const DEPENDENCIES = {
  three: [
    'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
    'https://unpkg.com/three@0.170.0/build/three.module.js',
  ],
  // The "compat" build of Rapier embeds its WebAssembly, so no extra file fetch is needed.
  rapier: [
    'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/rapier.es.js',
    'https://unpkg.com/@dimforge/rapier3d-compat@0.14.0/rapier.es.js',
  ],
};

export const PHYSICS = {
  gravity: -22,          // stronger than Earth (-9.81) for a snappy, exaggerated feel
  fixedStep: 1 / 60,     // physics always advances in steps of this size
  maxFrameTime: 0.1,     // longest frame time we will simulate (avoids a "spiral of death")
  killHeight: -25,       // anything below this is respawned
};

export const ARENA = {
  halfSize: 20,          // floor is 40 x 40 units; top surface is at y = 0
};

export const CAMERA = {
  fov: 60,
  distance: 11,
  minDistance: 5,
  maxDistance: 20,
  pitch: 0.55,           // radians above horizontal
  minPitch: 0.12,
  maxPitch: 1.3,
  followSharpness: 7,    // horizontal catch-up speed (higher = tighter)
  followSharpnessY: 3,   // vertical catch-up is slower so jumps do not jerk the camera
  minFocusY: -1.5,       // camera stops following downward below this, so it does not dive into the void
  lookHeight: 1.0,
  orbitSensitivity: 0.005,
};

export const PLAYER = {
  spawn: { x: 0, y: 2, z: 0 },
  radius: 0.45,
  halfHeight: 0.4,       // half the length of the straight middle section of the capsule
  color: 0xff7eb6,
};

export const PALETTE = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0x9d4edd, 0xff9f45];

export const MAX_EXTRA_CRATES = 25;

// Movement and animation tuning for the player character (see character.js).
export const CHARACTER = {
  maxSpeed: 7,            // top walking speed (units per second)
  accel: 48,              // how fast velocity changes while a key is held
  decel: 42,              // how fast the character slows when no key is held
  airControl: 0.4,        // fraction of acceleration available in the air
  jumpSpeed: 9.5,         // launch speed; with gravity -22 this is about 2 units of height
  coyoteTime: 0.1,        // grace period to still jump just after walking off an edge
  jumpBuffer: 0.12,       // a jump pressed this long before landing still counts
  jumpCooldown: 0.2,      // minimum time between jumps
  maxFallSpeed: 40,
  turnSharpness: 14,      // how quickly the body turns toward the movement direction
  stumbleThreshold: 8.5,  // sudden outside speed change (shove, big hit) needed to cause a stumble
  stumbleTime: 0.7,
  recoverTime: 0.5,
  stumbleCooldown: 0.5,
  knockdownThreshold: 13, // an outside speed change this big knocks the character flat
  downTime: 1.4,          // time spent lying down before getting up
  hardLandSpeed: 14,      // landing this fast while already stumbling = knocked down
  groundProbeLength: 0.28,
};

// ---------------------------------------------------------------------------------------------
// Stage 3: collision groups (which bodies may touch which)
//   bit 0 = arena, bit 1 = crates, bits 2-7 = characters 0-5, bits 8-13 = hands of characters 0-5
// A fighter's hands never collide with that fighter's own body, and hands never collide with hands.
// ---------------------------------------------------------------------------------------------
export const MAX_FIGHTERS = 6;
const CHAR_BITS = 0x00fc;
export function crateGroups() { return ((0x0002 << 16) | 0xffff) >>> 0; }
export function charGroups(index) {
  const filter = 0xffff & ~(1 << (8 + index)); // everything except this character's own hands
  return (((1 << (2 + index)) << 16) | filter) >>> 0;
}
export function handGroups(index, excludeMask = 0) {
  // collides with the arena, crates and other characters (not its own owner, not other hands)
  const filter = (0x0001 | 0x0002 | CHAR_BITS) & ~(1 << (2 + index)) & ~excludeMask;
  return (((1 << (8 + index)) << 16) | filter) >>> 0;
}

export const COMBAT = {
  handRadius: 0.17,
  handMass: 0.6,
  armRest: 0.62,            // resting arm length (hand hangs this far from the shoulder)
  // punching
  strikeTime: 0.12, strikeReach: 1.45, strikeSpeed: 16, strikeGain: 40,
  retractTime: 0.22, retractSpeed: 12,
  idleSpeed: 30, idleGain: 30,
  punchCooldown: 0.34, pressBuffer: 0.12,
  punchMass: 0.38,          // how hard a punch hits: impulse = punchMass x closing speed (weaker than Stage 3 v1)
  punchMinSpeed: 5, punchUpward: 0.18, punchContactSlack: 0.08,
  // reaching and grabbing
  reachForward: 1.25, reachDrop: 0.35, reachSpeed: 12, reachGain: 30, seekRange: 2.5,
  grabRange: 0.6,           // how close the hand must get to a crate/character to grab it
  holdSpeed: 14, holdGain: 30,
  // carrying (a spring pulls the held body toward a point in front of the holder)
  carryRamp: 0.45, carryForward: 1.1, carryForwardChar: 1.2,
  carryUp: 0.55, carryUpTwo: 0.95, carryUpChar: 0.35, carryUpCharTwo: 0.6, carryLateral: 0.22,
  kp: 70, kd: 14,
  strength: 34,             // maximum pulling force per hand (compare weight = mass x 22)
  twoHandMult: 2.1, carrySlow: 0.45, maxLinkDistance: 2.6,
  // throwing
  throwOne: 8, throwTwo: 11, throwUp: 3.2, throwHandShare: 0.6, throwMinHold: 0.25, twoHandWindow: 0.25,
  // breaking free
  struggleMove: 0.55, struggleJump: 0.3, struggleDecay: 0.35, struggleThreshold: 1.0,
  struggleTwoHand: 1.7, regrabCooldown: 0.8,
  // loose arms: after a hit, while stumbling, knocked down or held, the arms swing freely
  limpK: 55, limpC: 6, limpGravity: 9, limpBlend: 9, flinchMin: 3.5, flail: 0.55,
  // aim assist for the human player
  aimRange: 3.2, aimCone: 1.3,
};

export const BOTS = {
  max: 5,
  defaultCount: 3,
  defaultDifficulty: 'normal',
  colors: [0x4d96ff, 0x6bcb77, 0xffd93d, 0x9d4edd, 0xff9f45],
  spawns: [{ x: -13, z: -12 }, { x: 13, z: 12 }, { x: -14, z: 14 }, { x: 14, z: -14 }, { x: 0, z: 16 }],
};

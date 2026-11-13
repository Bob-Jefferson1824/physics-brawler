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
  groundProbeLength: 0.28,
};

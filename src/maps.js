// Map definitions (pure data) and the "arena" queries bots use to understand where floor is.
// A map is a set of floor pieces (all with their top surface at y = 0), solid props, starting
// crates, spawn points and a colour theme. Anything not on a floor piece is a drop: whoever falls
// there is respawned (see the kill height in config.js).

const CLASSIC_CRATES = [];
{
  const pyramid = [[4, 0.5, 6], [5.05, 0.5, 6], [6.1, 0.5, 6], [4.5, 1.5, 6], [5.6, 1.5, 6], [5.05, 2.5, 6]];
  for (const [x, y, z] of pyramid) CLASSIC_CRATES.push({ x, y, z, size: 1 });
  for (let i = 0; i < 4; i++) CLASSIC_CRATES.push({ x: -4, y: 0.5 + i * 1.02, z: -5, size: 1 });
  CLASSIC_CRATES.push({ x: 0, y: 0.7, z: -8, size: 1.4 });
  CLASSIC_CRATES.push({ x: 3, y: 0.4, z: -3, size: 0.8 });
  CLASSIC_CRATES.push({ x: -3, y: 0.5, z: 5, size: 1 });
}

export const MAPS = {
  // ---------------------------------------------------------------- the original arena
  classic: {
    id: 'classic',
    name: 'Classic Arena',
    half: 20,
    openEdges: ['east', 'south'], // the north and west edges have rails
    theme: {
      skyTop: '#5db7ff', skyBottom: '#fff1d6', fog: 0xd9ecff,
      hemiSky: 0xdff0ff, hemiGround: 0xffe2b8, sun: 0xffffff, sunPos: [18, 28, 12],
      checkerA: '#9ee6c4', checkerB: '#7fd6b0', side: 0xffb86b, under: 0x8e6bbf,
      rail: 0xff6b9d, block: 0x4d96ff,
    },
    floors: [{ x: 0, z: 0, w: 40, d: 40 }],
    statics: [
      { name: 'Rail North', pos: { x: 0, y: 0.6, z: -19.75 }, half: { x: 20, y: 0.6, z: 0.25 }, color: 'rail' },
      { name: 'Rail West', pos: { x: -19.75, y: 0.6, z: 0 }, half: { x: 0.25, y: 0.6, z: 20 }, color: 'rail' },
      { name: 'Raised Block', pos: { x: 9, y: 0.75, z: -9 }, half: { x: 3, y: 0.75, z: 3 }, color: 'block' },
      { name: 'Ramp', pos: { x: -8, y: 1.2, z: 6 }, half: { x: 3, y: 0.2, z: 4 }, rotX: -0.3, color: 'block' },
    ],
    crates: CLASSIC_CRATES,
    dropBox: { x: 12, z: 12 },
    spawns: {
      player: { x: 0, z: 0 },
      others: [{ x: -13, z: -12 }, { x: 13, z: 12 }, { x: -14, z: 14 }, { x: 14, z: -14 }, { x: 0, z: 16 }],
    },
    decorRadius: 40,
  },

  // ---------------------------------------------------------------- new: a cross with gaps
  crossroads: {
    id: 'crossroads',
    name: 'Crossroads',
    half: 21,
    marginCap: 1.2, // the arms are narrow, so bots may walk closer to their sides
    theme: {
      skyTop: '#ff9ecb', skyBottom: '#ffe9b0', fog: 0xffe3f0,
      hemiSky: 0xfff0e0, hemiGround: 0xffd0c0, sun: 0xfff1d6, sunPos: [-18, 26, 14],
      checkerA: '#ffd8a8', checkerB: '#ffc78a', side: 0x7d5ba6, under: 0x5b4a8c,
      rail: 0xff6b9d, block: 0x4d96ff,
    },
    floors: [
      { x: 0, z: 0, w: 14, d: 14 },        // hub
      { x: 0, z: -14, w: 8, d: 14 },       // north arm
      { x: 0, z: 14, w: 8, d: 14 },        // south arm
      { x: 14, z: 0, w: 14, d: 8 },        // east arm
      { x: -14, z: 0, w: 14, d: 8 },       // west arm
      { x: 12, z: -12, w: 7, d: 7, noBots: true },   // four islands, a jump away from the arms
      { x: 12, z: 12, w: 7, d: 7, noBots: true },
      { x: -12, z: -12, w: 7, d: 7, noBots: true },
      { x: -12, z: 12, w: 7, d: 7, noBots: true },
    ],
    statics: [
      { name: 'Pedestal', pos: { x: 0, y: 0.4, z: 0 }, half: { x: 2.5, y: 0.4, z: 2.5 }, color: 'block' },
      { name: 'Bumper NE', pos: { x: 4.5, y: 0.75, z: -4.5 }, half: { x: 1, y: 0.75, z: 1 }, color: 'rail' },
      { name: 'Bumper NW', pos: { x: -4.5, y: 0.75, z: -4.5 }, half: { x: 1, y: 0.75, z: 1 }, color: 'rail' },
      { name: 'Bumper SE', pos: { x: 4.5, y: 0.75, z: 4.5 }, half: { x: 1, y: 0.75, z: 1 }, color: 'rail' },
      { name: 'Bumper SW', pos: { x: -4.5, y: 0.75, z: 4.5 }, half: { x: 1, y: 0.75, z: 1 }, color: 'rail' },
      { name: 'Rail North tip', pos: { x: 0, y: 0.6, z: -20.75 }, half: { x: 4, y: 0.6, z: 0.25 }, color: 'rail' },
      { name: 'Rail West tip', pos: { x: -20.75, y: 0.6, z: 0 }, half: { x: 0.25, y: 0.6, z: 4 }, color: 'rail' },
      { name: 'South ramp', pos: { x: 0, y: 1.2, z: 13 }, half: { x: 2.5, y: 0.2, z: 3 }, rotX: -0.3, color: 'block' },
    ],
    crates: [
      { x: -12, y: 0.5, z: -1, size: 1 }, { x: -13.05, y: 0.5, z: -1, size: 1 }, { x: -14.1, y: 0.5, z: -1, size: 1 },
      { x: -12.5, y: 1.5, z: -1, size: 1 }, { x: -13.6, y: 1.5, z: -1, size: 1 }, { x: -13.05, y: 2.5, z: -1, size: 1 },
      { x: 12, y: 0.5, z: 1, size: 1 }, { x: 12, y: 1.52, z: 1, size: 1 }, { x: 12, y: 2.54, z: 1, size: 1 }, { x: 12, y: 3.56, z: 1, size: 1 },
      { x: 0, y: 0.7, z: -14, size: 1.4 }, { x: 1.8, y: 0.4, z: -11, size: 0.8 },
      { x: -1.5, y: 0.5, z: 17, size: 1 }, { x: 1.5, y: 0.5, z: 17, size: 1 },
      { x: 12, y: 0.5, z: -12, size: 1 }, { x: 12, y: 0.5, z: 12, size: 1 },
      { x: -12, y: 0.5, z: -12, size: 1 }, { x: -12, y: 0.5, z: 12, size: 1 },
    ],
    spawns: {
      player: { x: 0, z: -4.5 },
      others: [{ x: 0, z: -17 }, { x: 17, z: 0 }, { x: 0, z: 17 }, { x: -17, z: 0 }, { x: -4.5, z: 0 }],
    },
    decorRadius: 36,
  },
};

export const MAP_ORDER = ['classic', 'crossroads'];

export function getMap(id) {
  return MAPS[id] || MAPS.classic;
}

/** Spawn point for fighter `index` (0 = the host/solo player) on a map, with spawn height. */
export function spawnPoint(map, index) {
  const p = index === 0 ? map.spawns.player : map.spawns.others[(index - 1) % map.spawns.others.length];
  return { x: p.x, y: 2, z: p.z };
}

/** A plain square arena (used when only a size is known). */
export function squareArena(half) {
  return makeArena({ half, floors: [{ x: 0, z: 0, w: half * 2, d: half * 2 }], openEdges: ['east', 'south'] });
}

/**
 * Questions bots (and the crate dropper) ask about a map:
 *   isSafe(x, z, margin)    is there floor here, at least `margin` away from any drop?
 *   centreOf(x, z)          the middle of the nearest piece of floor (to steer back to)
 *   randomPoint(rng, margin) a random safe point
 *   dropEdge(p)             where to carry someone to throw them off: { x, z, yaw, dist }
 */
export function makeArena(def) {
  const pieces = def.floors.filter((f) => !f.noBots);
  const cap = def.marginCap === undefined ? Infinity : def.marginCap;
  const inRect = (f, x, z, m) => Math.abs(x - f.x) <= f.w / 2 - m && Math.abs(z - f.z) <= f.d / 2 - m;
  const rectDist = (f, x, z) => {
    const dx = Math.max(0, Math.abs(x - f.x) - f.w / 2); const dz = Math.max(0, Math.abs(z - f.z) - f.d / 2);
    return Math.hypot(dx, dz);
  };
  const arena = {
    half: def.half,
    pieces,
    isSafe(x, z, margin = 0) {
      const m = Math.min(margin, cap);
      for (const f of pieces) if (inRect(f, x, z, m)) return true;
      return false;
    },
    centreOf(x, z) {
      let best = pieces[0]; let bd = Infinity;
      for (const f of pieces) { const d = rectDist(f, x, z); if (d < bd) { bd = d; best = f; } }
      return { x: best.x, z: best.z };
    },
    randomPoint(rng, margin = 0) {
      const m = Math.min(margin, cap);
      let total = 0;
      for (const f of pieces) total += Math.max(0.01, (f.w - 2 * m)) * Math.max(0.01, (f.d - 2 * m));
      let pick = rng() * total; let chosen = pieces[0];
      for (const f of pieces) {
        pick -= Math.max(0.01, (f.w - 2 * m)) * Math.max(0.01, (f.d - 2 * m));
        if (pick <= 0) { chosen = f; break; }
      }
      const w = Math.max(0, chosen.w - 2 * m); const d = Math.max(0, chosen.d - 2 * m);
      return { x: chosen.x + (rng() - 0.5) * w, z: chosen.z + (rng() - 0.5) * d };
    },
    dropEdge(p) {
      if (def.openEdges) {                                   // square arena with two open sides
        const h = def.half;
        const east = h - p.x < h - p.z;
        return east ? { x: h - 0.5, z: p.z, yaw: Math.PI / 2, dist: h - p.x } : { x: p.x, z: h - 0.5, yaw: 0, dist: h - p.z };
      }
      let best = null;                                       // otherwise: march in 16 directions to find the nearest drop
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2; const dx = Math.sin(a); const dz = Math.cos(a);
        for (let t = 0.5; t <= 16; t += 0.5) {
          if (!arena.isSafe(p.x + dx * t, p.z + dz * t, 0)) {
            if (!best || t < best.dist) best = { x: p.x + dx * (t - 0.6), z: p.z + dz * (t - 0.6), yaw: a, dist: t };
            break;
          }
        }
      }
      return best || { x: p.x, z: p.z, yaw: 0, dist: 99 };
    },
  };
  return arena;
}

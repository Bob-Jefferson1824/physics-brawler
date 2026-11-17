// The running game world on this machine: physics, the current map, the local player, bots,
// online players (when hosting) and combat. A solo game and a hosted game both use this;
// guests in an online game do not (they only draw what the host sends).
import { PhysicsWorld } from './physics.js?v=s4r1';
import { createWorld } from './world.js?v=s4r1';
import { Player } from './player.js?v=s4r1';
import { CombatSystem } from './combat.js?v=s4r1';
import { BotManager } from './bot.js?v=s4r1';
import { RemoteFighter } from './remote.js?v=s4r1';
import { PHYSICS, PLAYER, ARENA, PALETTE, MAX_EXTRA_CRATES, BOTS, crateGroups } from './config.js?v=s4r1';
import { getMap, spawnPoint } from './maps.js?v=s4r1';

export class LocalSim {
  constructor({ THREE, RAPIER, scene, mapId = 'classic', botSettings = {} }) {
    this.THREE = THREE;
    this.scene = scene;
    this.physics = new PhysicsWorld(THREE, RAPIER, PHYSICS);
    this.mapId = getMap(mapId).id;
    this.map = getMap(mapId);
    this.world = this._buildWorld();
    this.player = new Player({
      THREE, physics: this.physics, scene, config: { ...PLAYER, spawn: spawnPoint(this.map, 0) },
    });
    this.combat = new CombatSystem(this.physics);
    this.combat.addFighter(this.player);
    this.bots = new BotManager({
      THREE, physics: this.physics, scene, combat: this.combat, config: PLAYER, arenaHalf: ARENA.halfSize,
      settings: botSettings, arena: this.world.arena, spawnFor: (i) => spawnPoint(this.map, i),
    });
    this.remotes = new Map();            // net id -> RemoteFighter
    this.onPlayerRespawn = null;
    this.physics.onRespawn = (entity) => {
      const f = entity.owner;
      if (!f || (entity.kind !== 'player' && entity.kind !== 'bot' && entity.kind !== 'remote')) return;
      f.onRespawned();
      if (f === this.player && this.onPlayerRespawn) this.onPlayerRespawn();
    };
  }

  _buildWorld() {
    return createWorld({
      THREE: this.THREE, scene: this.scene, physics: this.physics, map: this.map,
      palette: PALETTE, maxExtraCrates: MAX_EXTRA_CRATES, crateGroups: crateGroups(),
    });
  }

  /** Everyone fighting right now (player, bots, online players). */
  get fighters() { return this.combat.fighters; }

  /** Advances the game by dt seconds. */
  step(dt, input, cameraYaw) {
    this.player.update(dt, input, cameraYaw);
    this.bots.update(dt);
    for (const r of this.remotes.values()) r.update(dt);
    this.physics.step(dt);
    this.world.update(dt);
  }

  /** Smooths positions between physics steps and draws arms. Call every frame, also while paused. */
  postFrame(dt) {
    this.physics.interpolate();
    for (const f of this.combat.fighters) f.updateVisuals(dt);
  }

  /** Replaces the map: everyone is released, moved to the new spawn points, and bots learn the layout. */
  setMap(id) {
    const next = getMap(id);
    if (next.id === this.mapId) return false;
    for (const f of [...this.combat.fighters]) this.combat.releaseAll(f);
    this.world.dispose();
    this.mapId = next.id;
    this.map = next;
    this.world = this._buildWorld();
    this.bots.setArena(this.world.arena);
    for (const f of this.combat.fighters) {
      const sp = spawnPoint(next, f.index);
      f.entity.spawnPos = { x: sp.x, y: sp.y, z: sp.z };
      f.spawn = { x: sp.x, y: sp.y, z: sp.z };
      this.physics.respawnEntity(f.entity);
    }
    this.bots.reset();
    return true;
  }

  // ---------------------------------------------------------------- online players

  /** Adds an online player (host side). Returns the new fighter, or null if the game is full. */
  addRemote(netId, name) {
    if (this.remotes.has(netId)) return this.remotes.get(netId);
    // Online players take a fighter slot; if the arena is full a bot makes room
    this.bots.reserved += 1;
    this.bots.apply();
    const index = this.combat.freeIndex();
    if (index < 1) { this.bots.reserved -= 1; this.bots.apply(); return null; }
    const sp = spawnPoint(this.map, index);
    const fighter = new RemoteFighter({
      THREE: this.THREE, physics: this.physics, scene: this.scene, config: PLAYER, color: BOTS.colors[index - 1],
      spawn: sp, index, name, netId,
    });
    this.combat.addFighter(fighter);
    this.remotes.set(netId, fighter);
    return fighter;
  }

  removeRemote(netId) {
    const f = this.remotes.get(netId);
    if (!f) return;
    this.remotes.delete(netId);
    f.dispose();
    this.bots.reserved = Math.max(0, this.bots.reserved - 1);
    this.bots.apply();
  }

  dispose() {
    for (const f of [...this.combat.fighters]) f.dispose();
    this.world.dispose();
    this.physics.onRespawn = null;
    if (this.physics.world && typeof this.physics.world.free === 'function') this.physics.world.free();
  }
}

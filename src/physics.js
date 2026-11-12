// Thin wrapper around Rapier: fixed-timestep stepping, mesh syncing with
// interpolation, and respawning. THREE and RAPIER are passed in (see deps.js).

export class PhysicsWorld {
  constructor(THREE, RAPIER, config) {
    this.THREE = THREE;
    this.RAPIER = RAPIER;
    this.config = config;
    this.world = new RAPIER.World({ x: 0, y: config.gravity, z: 0 });
    this.world.timestep = config.fixedStep;
    this.entities = new Set();
    this.accumulator = 0;
    this.onRespawn = null; // optional callback(entity)
  }

  // ---- Body creation ----

  createStaticBox({ position, halfExtents, rotation = null, friction = 0.8, restitution = 0.1 }) {
    const R = this.RAPIER;
    const desc = R.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z);
    if (rotation) desc.setRotation(rotation);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(
      R.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
        .setFriction(friction)
        .setRestitution(restitution),
      body
    );
    return body;
  }

  createDynamicBox({ position, halfExtents, density = 0.8, friction = 0.7, restitution = 0.25, linearDamping = 0.05, angularDamping = 0.15 }) {
    const R = this.RAPIER;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(linearDamping)
      .setAngularDamping(angularDamping)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(
      R.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
        .setDensity(density)
        .setFriction(friction)
        .setRestitution(restitution),
      body
    );
    return body;
  }

  /** Upright capsule. With lockTilt the body cannot fall over, it can only spin around Y. */
  createDynamicCapsule({ position, halfHeight, radius, density = 1, friction = 0.5, restitution = 0.1, lockTilt = true }) {
    const R = this.RAPIER;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(0.4)
      .setAngularDamping(1.0)
      .setCcdEnabled(true);
    if (lockTilt) {
      if (typeof desc.enabledRotations === 'function') desc.enabledRotations(false, true, false);
      else desc.lockRotations();
    }
    const body = this.world.createRigidBody(desc);
    this.world.createCollider(
      R.ColliderDesc.capsule(halfHeight, radius)
        .setDensity(density)
        .setFriction(friction)
        .setRestitution(restitution),
      body
    );
    return body;
  }

  // ---- Syncing physics bodies to Three.js meshes ----

  /** Links a dynamic body to a mesh. The mesh is moved automatically each frame. */
  register(body, mesh, { kind = 'object', respawn = true } = {}) {
    const THREE = this.THREE;
    const t = body.translation();
    const r = body.rotation();
    const entity = {
      kind,
      body,
      mesh,
      respawn,
      spawnPos: { x: t.x, y: t.y, z: t.z },
      spawnRot: { x: r.x, y: r.y, z: r.z, w: r.w },
      prevP: new THREE.Vector3(t.x, t.y, t.z),
      currP: new THREE.Vector3(t.x, t.y, t.z),
      prevQ: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      currQ: new THREE.Quaternion(r.x, r.y, r.z, r.w),
    };
    mesh.position.copy(entity.currP);
    mesh.quaternion.copy(entity.currQ);
    this.entities.add(entity);
    return entity;
  }

  remove(entity) {
    this.entities.delete(entity);
    this.world.removeRigidBody(entity.body);
  }

  // ---- Simulation ----

  /** Advances physics by real elapsed time using fixed steps. */
  step(dt) {
    const { fixedStep, maxFrameTime } = this.config;
    this.accumulator += Math.min(dt, maxFrameTime);
    while (this.accumulator >= fixedStep) {
      for (const e of this.entities) {
        e.prevP.copy(e.currP);
        e.prevQ.copy(e.currQ);
      }
      this.world.step();
      for (const e of this.entities) this._readState(e);
      this._checkRespawns();
      this.accumulator -= fixedStep;
    }
  }

  /** Positions meshes between the last two physics states so motion looks smooth. */
  interpolate() {
    const alpha = this.accumulator / this.config.fixedStep;
    for (const e of this.entities) {
      e.mesh.position.lerpVectors(e.prevP, e.currP, alpha);
      e.mesh.quaternion.copy(e.prevQ).slerp(e.currQ, alpha);
    }
  }

  /** Puts an entity back where it first appeared, with no leftover motion. */
  respawnEntity(entity) {
    const { body, spawnPos, spawnRot } = entity;
    body.setTranslation(spawnPos, true);
    body.setRotation(spawnRot, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this._readState(entity);
    entity.prevP.copy(entity.currP);
    entity.prevQ.copy(entity.currQ);
    entity.mesh.position.copy(entity.currP);
    entity.mesh.quaternion.copy(entity.currQ);
    if (this.onRespawn) this.onRespawn(entity);
  }

  _readState(e) {
    const t = e.body.translation();
    const r = e.body.rotation();
    e.currP.set(t.x, t.y, t.z);
    e.currQ.set(r.x, r.y, r.z, r.w);
  }

  _checkRespawns() {
    const { killHeight } = this.config;
    for (const e of this.entities) {
      if (!e.respawn) continue;
      const y = e.currP.y;
      if (y < killHeight || !Number.isFinite(y)) this.respawnEntity(e);
    }
  }
}

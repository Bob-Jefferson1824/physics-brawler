// The player character: a soft, toy-like pink brawler with arms, legs and eyes.
//
// Physics: one upright capsule body (Rapier) that is steered by character.js and collides with
// the arena and crates for real. Looks: a hierarchy of rounded meshes animated from the body's
// real velocity and state. Hands/feet/limbs are visual in Stage 2; the physical ragdoll body
// and grabbing come in later stages.
import { CharacterController, CharacterPose, cameraRelativeMove } from './character.js';
import { ACTION } from './input.js';

export class Player {
  constructor({ THREE, physics, scene, config }) {
    this.THREE = THREE;
    this.physics = physics;
    this.config = config;
    this.controller = new CharacterController();
    this.pose = new CharacterPose();
    this._leanQ = new THREE.Quaternion();
    this._yawQ = new THREE.Quaternion();
    this._axis = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    this._buildVisual(scene);

    // Physics body, driven by the controller once per fixed step
    this.body = physics.createDynamicCapsule({
      position: config.spawn, halfHeight: config.halfHeight, radius: config.radius,
      lockTilt: true, lockYaw: true,
    });
    this.entity = physics.register(this.body, this.root, { kind: 'player' });
    physics.addPreStep((dt) => this._fixedUpdate(dt));
  }

  _buildVisual(scene) {
    const THREE = this.THREE;
    const { radius, halfHeight, color } = this.config;

    const pink = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const darkColor = new THREE.Color(color).offsetHSL(0, 0.05, -0.12);
    const endMat = new THREE.MeshStandardMaterial({ color: darkColor, roughness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const ink = new THREE.MeshStandardMaterial({ color: 0x1b1b2f, roughness: 0.3 });

    // root sits at the capsule centre (synced to physics); pivot sits at the feet and carries
    // facing and lean; squash scales the body from the feet.
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.pivot.position.y = -(halfHeight + radius);
    this.squash = new THREE.Group();
    this.root.add(this.pivot);
    this.pivot.add(this.squash);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.5, 10, 24), pink);
    torso.position.y = 0.95;
    this.squash.add(torso);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), white);
      eye.position.set(side * 0.17, 1.28, 0.34);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), ink);
      pupil.position.set(0, 0, 0.1);
      eye.add(pupil);
      this.squash.add(eye);
    }

    // Arms: the character faces +Z, so its left side is +X.
    const makeArm = (x) => {
      const g = new THREE.Group();
      g.position.set(x, 1.15, 0);
      const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 6, 12), pink);
      limb.position.y = -0.22;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), endMat);
      hand.position.y = -0.5;
      g.add(limb, hand);
      this.squash.add(g);
      return g;
    };
    const makeLeg = (x) => {
      const g = new THREE.Group();
      g.position.set(x, 0.54, 0);
      const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.2, 6, 12), pink);
      limb.position.y = -0.2;
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), endMat);
      foot.scale.set(1.05, 0.6, 1.5);
      foot.position.set(0, -0.42, 0.09);
      g.add(limb, foot);
      this.squash.add(g);
      return g;
    };
    this.armL = makeArm(0.47);
    this.armR = makeArm(-0.47);
    this.legL = makeLeg(0.2);
    this.legR = makeLeg(-0.2);

    this.root.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    scene.add(this.root);
  }

  /** Smoothed position of the character, used as the camera target. */
  get position() {
    return this.root.position;
  }

  get grounded() {
    return this.controller.grounded;
  }

  /** Reads input and animates. Call once per frame while the game is running. */
  update(dt, input, cameraYaw) {
    const forward = input.getAxis(ACTION.MOVE_BACK, ACTION.MOVE_FORWARD);
    const right = input.getAxis(ACTION.MOVE_LEFT, ACTION.MOVE_RIGHT);
    const m = cameraRelativeMove(cameraYaw, forward, right);
    this.controller.setMove(m.x, m.z);
    if (input.wasPressed(ACTION.JUMP)) this.controller.requestJump();

    const v = this.body.linvel();
    const c = this.controller;
    const o = this.pose.update(dt, {
      vx: v.x, vy: v.y, vz: v.z,
      grounded: c.grounded, state: c.state, stumbleDir: c.stumbleDir,
      move: c.move, events: c.consumeEvents(),
    });
    this._applyPose(o);
  }

  _applyPose(o) {
    const lean = Math.hypot(o.leanX, o.leanZ);
    if (lean > 1e-5) {
      this._axis.set(o.leanZ / lean, 0, -o.leanX / lean); // tips the top of the body toward the lean
      this._leanQ.setFromAxisAngle(this._axis, lean);
    } else {
      this._leanQ.identity();
    }
    this._yawQ.setFromAxisAngle(this._up, o.yaw);
    this.pivot.quaternion.multiplyQuaternions(this._leanQ, this._yawQ);
    this.squash.scale.set(o.scaleXZ, o.scaleY, o.scaleXZ);
    this.squash.position.y = o.bob;
    this.armL.rotation.set(o.armL.x, 0, o.armL.z);
    this.armR.rotation.set(o.armR.x, 0, o.armR.z);
    this.legL.rotation.x = o.legL.x;
    this.legR.rotation.x = o.legR.x;
  }

  /** Runs before every physics step: probe the ground, then steer the body. */
  _fixedUpdate(dt) {
    const body = this.body;
    const t = body.translation();
    const v = body.linvel();
    const grounded = this._probeGround(t);
    const out = this.controller.fixedUpdate(dt, v, grounded);
    // Only write when something changed, so an idle character can still fall asleep.
    if (Math.abs(out.x - v.x) + Math.abs(out.y - v.y) + Math.abs(out.z - v.z) > 1e-4) {
      body.setLinvel(out, true);
    }
  }

  /** Five short rays below the feet, so standing on an edge still counts as grounded. */
  _probeGround(t) {
    const { radius, halfHeight } = this.config;
    const y = t.y - halfHeight - radius - 0.02; // just below the lowest point of the capsule
    const len = this.controller.cfg.groundProbeLength;
    const o = radius * 0.65;
    const offsets = [[0, 0], [o, 0], [-o, 0], [0, o], [0, -o]];
    for (const [ox, oz] of offsets) {
      if (this.physics.raycast(t.x + ox, y, t.z + oz, 0, -1, 0, len) >= 0) return true;
    }
    return false;
  }

  /** Called after the physics system has put the player back at the spawn point. */
  onRespawned() {
    this.controller.reset();
    this.pose.reset();
    this._applyPose(this.pose.out);
  }

  respawn() {
    this.physics.respawnEntity(this.entity);
  }

  /** Test tool: a hard sideways shove plus a hop. Big enough to make the character stumble. */
  shove() {
    const angle = Math.random() * Math.PI * 2;
    const m = this.body.mass();
    this.body.applyImpulse({ x: Math.cos(angle) * m * 11, y: m * 8, z: Math.sin(angle) * m * 11 }, true);
  }
}

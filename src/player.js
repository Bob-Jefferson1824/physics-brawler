// Placeholder player: a rounded, cartoony capsule with eyes, driven by a real
// physics body. It cannot be steered yet (movement arrives in Stage 2) but it
// falls, collides, gets pushed around and respawns.

export class Player {
  constructor({ THREE, physics, scene, config }) {
    this.physics = physics;
    const { radius, halfHeight, color, spawn } = config;

    // Visual
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(radius, halfHeight * 2, 8, 20), bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x1b1b2f, roughness: 0.3 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), eyeWhite);
      eye.position.set(side * 0.18, 0.4, radius - 0.06);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), pupil);
      p.position.set(0, 0, 0.09);
      eye.add(p);
      eye.castShadow = true;
      group.add(eye);
    }
    scene.add(group);
    this.mesh = group;

    // Physics
    this.body = physics.createDynamicCapsule({ position: spawn, halfHeight, radius, lockTilt: true });
    this.entity = physics.register(this.body, group, { kind: 'player' });
  }

  /** Smoothed position of the character, used as the camera target. */
  get position() {
    return this.mesh.position;
  }

  respawn() {
    this.physics.respawnEntity(this.entity);
  }

  /** Debug helper: a random sideways kick plus a hop, to watch physics and the camera. */
  shove() {
    const angle = Math.random() * Math.PI * 2;
    const m = this.body.mass();
    this.body.applyImpulse({ x: Math.cos(angle) * m * 9, y: m * 9, z: Math.sin(angle) * m * 9 }, true);
  }
}

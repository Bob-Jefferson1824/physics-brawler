// The look of a fighter (soft toy body, eyes, legs, stretchy arms, hands, optional name tag).
// It knows nothing about physics: the host's Fighter drives it from the simulation, and online
// guests drive it from the host's snapshots. Both therefore draw characters identically.
const SHOULDER_X = 0.47;
const SHOULDER_H = 1.15;   // shoulder height above the feet
const FEET_BELOW = 0.85;   // capsule centre to feet

/** Quaternion (x,y,z,w) that turns the +Y axis onto the unit vector (dx,dy,dz). */
export function quatFromUp(dx, dy, dz, out) {
  if (dy > 0.99999) { out.x = 0; out.y = 0; out.z = 0; out.w = 1; return out; }
  if (dy < -0.99999) { out.x = 1; out.y = 0; out.z = 0; out.w = 0; return out; }
  let ax = dz; let az = -dx;                       // up x dir
  const al = Math.hypot(ax, az);
  ax /= al; az /= al;
  const half = Math.acos(dy) / 2;
  const s = Math.sin(half);
  out.x = ax * s; out.y = 0; out.z = az * s; out.w = Math.cos(half);
  return out;
}

/** Where a shoulder is, from the body position and the pose (facing, lean, squash). side: +1 left, -1 right. */
export function shoulderFromPose(o, side, base, out) {
  const cx = Math.cos(o.yaw); const sx = Math.sin(o.yaw);
  const lat = SHOULDER_X * side;
  out.x = base.x + lat * cx + o.leanX * SHOULDER_H;
  out.y = base.y - FEET_BELOW + SHOULDER_H * o.scaleY + o.bob;
  out.z = base.z - lat * sx + o.leanZ * SHOULDER_H;
  return out;
}

export class Avatar {
  constructor(THREE, scene, color) {
    this.THREE = THREE;
    this.scene = scene;
    this._leanQ = new THREE.Quaternion();
    this._yawQ = new THREE.Quaternion();
    this._axis = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._q = { x: 0, y: 0, z: 0, w: 1 };
    this._sh = { x: 0, y: 0, z: 0 };
    this.label = null;

    this.bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: 0 });
    const endColor = new THREE.Color(color).offsetHSL(0, 0.05, -0.12);
    this.endMat = new THREE.MeshStandardMaterial({ color: endColor, roughness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const ink = new THREE.MeshStandardMaterial({ color: 0x1b1b2f, roughness: 0.3 });

    // root sits at the capsule centre; pivot sits at the feet and carries facing and lean;
    // squash scales the body from the feet.
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.pivot.position.y = -FEET_BELOW;
    this.squash = new THREE.Group();
    this.root.add(this.pivot);
    this.pivot.add(this.squash);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.5, 10, 24), this.bodyMat);
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

    const makeLeg = (x) => {
      const g = new THREE.Group();
      g.position.set(x, 0.54, 0);
      const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.2, 6, 12), this.bodyMat);
      limb.position.y = -0.2;
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), this.endMat);
      foot.scale.set(1.05, 0.6, 1.5);
      foot.position.set(0, -0.42, 0.09);
      g.add(limb, foot);
      this.squash.add(g);
      return g;
    };
    this.legL = makeLeg(0.2);
    this.legR = makeLeg(-0.2);

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(this.root);

    // Arms (stretchy tubes), shoulder caps and hands live in the scene, in world space
    this.hand = {};
    for (const name of ['left', 'right']) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), this.endMat);
      mesh.castShadow = true;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 1, 12), this.bodyMat);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), this.bodyMat);
      arm.castShadow = true;
      scene.add(mesh); scene.add(arm); scene.add(cap);
      this.hand[name] = { mesh, arm, cap, side: name === 'left' ? 1 : -1 };
    }
  }

  /** o: { yaw, leanX, leanZ, scaleY, scaleXZ, bob, legL:{x}, legR:{x} } */
  applyPose(o) {
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
    this.legL.rotation.x = o.legL.x;
    this.legR.rotation.x = o.legR.x;
  }

  /** Stretches each arm from its shoulder to the hand mesh, wherever that currently is. */
  placeArms(base, o) {
    const sh = this._sh;
    for (const name of ['left', 'right']) {
      const h = this.hand[name];
      shoulderFromPose(o, h.side, base, sh);
      const hp = h.mesh.position;
      let dx = hp.x - sh.x; let dy = hp.y - sh.y; let dz = hp.z - sh.z;
      const len = Math.max(Math.hypot(dx, dy, dz), 0.001);
      dx /= len; dy /= len; dz /= len;
      h.arm.position.set((hp.x + sh.x) / 2, (hp.y + sh.y) / 2, (hp.z + sh.z) / 2);
      h.arm.scale.set(1, len, 1);
      quatFromUp(dx, dy, dz, this._q);
      h.arm.quaternion.set(this._q.x, this._q.y, this._q.z, this._q.w);
      h.cap.position.set(sh.x, sh.y, sh.z);
    }
  }

  setFlash(v) {
    this.bodyMat.emissiveIntensity = v * 0.7;
  }

  /** A name tag floating above the head. */
  setLabel(text) {
    if (!text || this.label) return;
    const THREE = this.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const g = canvas.getContext('2d');
    g.fillStyle = 'rgba(30,32,48,0.72)';
    g.beginPath();
    if (g.roundRect) g.roundRect(4, 8, 248, 48, 24); else g.rect(4, 8, 248, 48);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = 'bold 30px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(text).slice(0, 14), 128, 33);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(1.7, 0.43, 1);
    sprite.position.set(0, 1.55, 0);
    sprite.renderOrder = 10;
    this.root.add(sprite);
    this.label = sprite;
  }

  dispose() {
    this.scene.remove(this.root);
    for (const name of ['left', 'right']) {
      const h = this.hand[name];
      this.scene.remove(h.mesh); this.scene.remove(h.arm); this.scene.remove(h.cap);
      h.mesh.geometry.dispose(); h.arm.geometry.dispose(); h.cap.geometry.dispose();
    }
  }
}

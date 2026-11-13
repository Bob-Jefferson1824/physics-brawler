// Third-person camera: smoothly follows a target point and can be orbited
// by dragging with the mouse/trackpad. Scroll (or pinch) zooms.

export class ThirdPersonCamera {
  constructor(THREE, camera, domElement, config) {
    this.THREE = THREE;
    this.camera = camera;
    this.dom = domElement;
    this.config = config;
    this.enabled = true;          // set false while paused
    this.yaw = 0;                 // 0 = camera on the +Z side of the target
    this.pitch = config.pitch;
    this.distance = config.distance;
    this.focus = new THREE.Vector3();
    this._dragging = false;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);

    domElement.addEventListener('pointerdown', this._onPointerDown);
    domElement.addEventListener('pointermove', this._onPointerMove);
    domElement.addEventListener('pointerup', this._onPointerUp);
    domElement.addEventListener('pointercancel', this._onPointerUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
    domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Jump straight to the target with no smoothing (used at start-up). */
  snapTo(target) {
    this.focus.set(target.x, Math.max(target.y, this.config.minFocusY), target.z);
    this._apply();
  }

  update(dt, target) {
    const kh = 1 - Math.exp(-this.config.followSharpness * dt);
    const kv = 1 - Math.exp(-this.config.followSharpnessY * dt);
    // Do not follow the player down into the void; the camera just watches them fall.
    const targetY = Math.max(target.y, this.config.minFocusY);
    this.focus.x += (target.x - this.focus.x) * kh;
    this.focus.y += (targetY - this.focus.y) * kv;
    this.focus.z += (target.z - this.focus.z) * kh;
    this._apply();
  }

  _apply() {
    const cp = Math.cos(this.pitch);
    const offsetX = Math.sin(this.yaw) * cp * this.distance;
    const offsetY = Math.sin(this.pitch) * this.distance;
    const offsetZ = Math.cos(this.yaw) * cp * this.distance;
    this.camera.position.set(
      this.focus.x + offsetX,
      Math.max(this.focus.y + offsetY, 0.6), // never dip below the floor
      this.focus.z + offsetZ
    );
    this.camera.lookAt(this.focus.x, this.focus.y + this.config.lookHeight, this.focus.z);
  }

  _onPointerDown(e) {
    if (!this.enabled) return;
    this._dragging = true;
    this.dom.setPointerCapture(e.pointerId);
    this.dom.classList.add('dragging');
  }

  _onPointerMove(e) {
    if (!this._dragging || !this.enabled) return;
    const s = this.config.orbitSensitivity;
    this.yaw -= e.movementX * s;
    this.pitch = Math.min(this.config.maxPitch, Math.max(this.config.minPitch, this.pitch + e.movementY * s));
  }

  _onPointerUp(e) {
    if (!this._dragging) return;
    this._dragging = false;
    this.dom.classList.remove('dragging');
    if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
  }

  _onWheel(e) {
    e.preventDefault();
    if (!this.enabled) return;
    const { minDistance, maxDistance } = this.config;
    this.distance = Math.min(maxDistance, Math.max(minDistance, this.distance + e.deltaY * 0.01));
  }
}

// Wires everything together and runs the main loop.
import { loadDependencies } from './deps.js';
import { PHYSICS, ARENA, CAMERA, PLAYER, PALETTE, MAX_EXTRA_CRATES } from './config.js';
import { PhysicsWorld } from './physics.js';
import { createWorld } from './world.js';
import { Player } from './player.js';
import { ThirdPersonCamera } from './camera.js';
import { InputManager, ACTION } from './input.js';

export class Game {
  constructor({ canvas, ui }) {
    this.canvas = canvas;
    this.ui = ui;
    this.paused = false;
    this.failed = false;
    this._last = 0;
    this._fpsTime = 0;
    this._fpsFrames = 0;
    this._frame = this._frame.bind(this);
  }

  async init() {
    const { THREE, RAPIER } = await loadDependencies((t) => this.ui.setLoading(t));
    this.THREE = THREE;

    // Renderer and scene
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 300);

    // Systems
    this.physics = new PhysicsWorld(THREE, RAPIER, PHYSICS);
    this.world = createWorld({
      THREE, scene: this.scene, physics: this.physics,
      arena: ARENA, palette: PALETTE, maxExtraCrates: MAX_EXTRA_CRATES,
    });
    this.player = new Player({ THREE, physics: this.physics, scene: this.scene, config: PLAYER });
    this.cameraRig = new ThirdPersonCamera(THREE, this.camera, this.canvas, CAMERA);
    this.input = new InputManager();

    this.physics.onRespawn = (entity) => {
      if (entity.kind !== 'player') return;
      this.player.onRespawned();
      this.cameraRig.snapTo(this.player.position); // no long camera swoop back from the void
      this.ui.toast('Player respawned');
    };

    // UI wiring
    this.ui.onPauseClick(() => this.setPaused(!this.paused));
    this.ui.onDebugAction((name) => this._debugAction(name));
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('blur', () => { if (!this.paused) this.setPaused(true); });
    this._resize();

    this.cameraRig.snapTo(this.player.position);
    this.physics.interpolate();
  }

  start() {
    this._last = performance.now();
    requestAnimationFrame(this._frame);
  }

  setPaused(paused) {
    this.paused = paused;
    this.input.setGameplayEnabled(!paused);
    this.cameraRig.enabled = !paused;
    this.ui.showPause(paused);
  }

  _debugAction(name) {
    if (this.paused) return;
    if (name === 'respawn') this.player.respawn();
    else if (name === 'shove') this.player.shove();
    else if (name === 'drop') this.world.dropCrate();
    else if (name === 'reset') {
      this.world.resetCrates();
      this.ui.toast('Crates reset');
    }
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _frame(now) {
    if (this.failed) return;
    requestAnimationFrame(this._frame);
    try {
      const rawDt = (now - this._last) / 1000;
      this._last = now;
      const dt = Math.min(Math.max(rawDt, 0), 0.1);

      if (this.input.wasPressed(ACTION.PAUSE)) this.setPaused(!this.paused);

      if (!this.paused) {
        this.player.update(dt, this.input, this.cameraRig.yaw);
        this.physics.step(dt);
        this.world.update(dt);
      }
      this.physics.interpolate();
      this.cameraRig.update(dt, this.player.position);
      this.renderer.render(this.scene, this.camera);

      this.ui.updateInputMonitor((a) => this.input.isDown(a));
      this._fpsTime += rawDt;
      this._fpsFrames++;
      if (this._fpsTime >= 0.5) {
        this.ui.setFps(this._fpsFrames / this._fpsTime);
        this._fpsTime = 0;
        this._fpsFrames = 0;
      }
      this.input.endFrame();
    } catch (err) {
      this.failed = true;
      console.error(err);
      this.ui.showFatal(err);
    }
  }
}

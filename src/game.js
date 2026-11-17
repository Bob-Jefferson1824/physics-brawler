// Wires everything together and runs the main loop.
//
// Modes:  solo  - this browser runs the game (default)
//         host  - same as solo, plus it shares the game with online guests
//         guest - this browser only draws what the host sends and sends its keys back
import { loadDependencies } from './deps.js?v=s4r1';
import { CAMERA, BOTS } from './config.js?v=s4r1';
import { LocalSim } from './sim.js?v=s4r1';
import { MAP_ORDER, getMap } from './maps.js?v=s4r1';
import { ThirdPersonCamera } from './camera.js?v=s4r1';
import { InputManager, ACTION } from './input.js?v=s4r1';
import { NetClient, normalizeServerUrl } from './net.js?v=s4r1';
import { HostSync, GuestSession } from './multiplayer.js?v=s4r1';

/**
 * Confirms each part of the game has the methods game.js relies on. If the site is served with
 * files from different versions (for example an old player.js beside a new game.js), this fails
 * at startup with a message naming the mismatched file, instead of crashing later in the loop.
 */
function checkInterfaces(parts) {
  const problems = [];
  for (const { file, obj, methods, props = [] } of parts) {
    const missing = [
      ...methods.filter((m) => typeof obj[m] !== 'function').map((m) => `${m}()`),
      ...props.filter((p) => !(p in obj)),
    ];
    if (missing.length) problems.push(`${file} is missing ${missing.join(', ')}`);
  }
  if (problems.length) {
    throw new Error(
      `Mismatched game files: ${problems.join('; ')}. ` +
      'The site is mixing files from different versions. Upload every file from the latest ZIP, ' +
      'wait for GitHub Pages to finish deploying, then hard-refresh (Cmd+Shift+R).'
    );
  }
}

const SETTINGS_KEY = 'brawler.settings.v1';
const ONLINE_KEY = 'brawler.online.v1';

function readJson(key) {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {}; // storage blocked or corrupt: use defaults
  }
}

function writeJson(key, value) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(key, JSON.stringify(value));
  } catch (_) { /* not saved, no problem */ }
}

function loadSettings() {
  const v = readJson(SETTINGS_KEY);
  const out = {};
  if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
  if (Number.isFinite(v.count)) out.count = v.count;
  if (['easy', 'normal', 'hard'].includes(v.difficulty)) out.difficulty = v.difficulty;
  if (MAP_ORDER.includes(v.map)) out.map = v.map;
  return out;
}

export class Game {
  constructor({ canvas, ui, loadDeps = loadDependencies, WebSocketImpl = undefined, now = () => performance.now() }) {
    this.canvas = canvas;
    this.ui = ui;
    this.loadDeps = loadDeps; // injectable so the startup sequence can be tested without a CDN
    this.WebSocketImpl = WebSocketImpl;
    this.now = now;
    this.paused = false;
    this.failed = false;
    this.mode = 'solo';
    this.net = null;
    this.hostSync = null;
    this.guest = null;
    this._last = 0;
    this._fpsTime = 0;
    this._fpsFrames = 0;
    this._frame = this._frame.bind(this);
  }

  async init() {
    checkInterfaces([{ file: 'ui.js', obj: this.ui, methods: [
      'setLoading', 'hideLoading', 'showFatal', 'showPause', 'toast', 'setFps',
      'updateInputMonitor', 'onPauseClick', 'onDebugAction', 'onBotControl', 'setBotState',
      'setHandStatus', 'setBanner', 'onMapSelect', 'setMapState',
      'onOnlineAction', 'setOnlineStatus', 'setOnlinePlayers', 'setOnlineBusy', 'setRole', 'setPauseNote',
      'getOnlineForm', 'setOnlineForm'] }]);
    const { THREE, RAPIER } = await this.loadDeps((t) => this.ui.setLoading(t));
    this.THREE = THREE;
    this.RAPIER = RAPIER;

    // Renderer and scene
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 300);
    this.cameraRig = new ThirdPersonCamera(THREE, this.camera, this.canvas, CAMERA);
    this.input = new InputManager();

    this._createSim();
    checkInterfaces([
      { file: 'camera.js', obj: this.cameraRig, methods: ['update', 'snapTo', 'shake'] },
      { file: 'input.js', obj: this.input, methods: ['wasPressed', 'isDown', 'getAxis', 'setGameplayEnabled', 'endFrame'] },
      { file: 'net.js', obj: new NetClient({ WebSocketImpl: null }), methods: ['connect', 'send', 'on', 'request', 'close'] },
    ]);

    // UI wiring
    this.ui.onPauseClick(() => this.setPaused(!this.paused));
    this.ui.onDebugAction((name) => this._debugAction(name));
    this.ui.onBotControl((c) => this._botControl(c));
    this.ui.onMapSelect((id) => this._selectMap(id));
    this.ui.onOnlineAction((a) => this._onlineAction(a));
    const prefs = readJson(ONLINE_KEY);
    this.ui.setOnlineForm({ name: prefs.name || `Player${Math.floor(Math.random() * 90 + 10)}`, server: prefs.server || this._defaultServer() });
    this._pushBotState();
    this.ui.setMapState(this.sim.mapId);
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('blur', () => { if (!this.paused && this.mode === 'solo') this.setPaused(true); });
    this._resize();

    this.cameraRig.snapTo(this.player.position);
    this.sim.postFrame(0);
  }

  // ---------------------------------------------------------------- the local game world

  _createSim() {
    const saved = loadSettings();
    this.sim = new LocalSim({ THREE: this.THREE, RAPIER: this.RAPIER, scene: this.scene, mapId: saved.map || 'classic', botSettings: saved });
    checkInterfaces([
      { file: 'physics.js', obj: this.sim.physics, methods: [
        'createStaticBox', 'createDynamicBox', 'createDynamicCapsule', 'register', 'remove', 'removeStatic',
        'step', 'interpolate', 'respawnEntity', 'raycast', 'addPreStep'] },
      { file: 'sim.js', obj: this.sim, methods: ['step', 'postFrame', 'setMap', 'addRemote', 'removeRemote', 'dispose'] },
      { file: 'world.js', obj: this.sim.world, methods: ['dropCrate', 'resetCrates', 'update', 'dispose'] },
      { file: 'player.js', obj: this.sim.player, methods: ['update', 'respawn', 'shove', 'onRespawned', 'updateVisuals', 'handStatus'], props: ['position'] },
      { file: 'combat.js', obj: this.sim.combat, methods: ['on', 'addFighter', 'releaseAll', 'findAimTarget', 'holdInfo'] },
      { file: 'bot.js', obj: this.sim.bots, methods: ['update', 'updateVisuals', 'setCount', 'setEnabled', 'setDifficulty', 'reset', 'apply'] },
    ]);
    this.sim.onPlayerRespawn = () => {
      this.cameraRig.snapTo(this.player.position); // no long camera swoop back from the void
      this.ui.toast('Player respawned');
    };
    // Camera shake and messages for fights involving the player
    this.sim.combat.on((type, d) => {
      const p = this.sim && this.sim.player;
      const involvesPlayer = d.attacker === p || d.victim === p || d.holder === p;
      if (type === 'hit' && involvesPlayer) this.cameraRig.shake(Math.min(0.5, 0.12 + d.impulse * 0.02));
      else if (type === 'throw' && involvesPlayer) this.cameraRig.shake(0.25);
      else if (type === 'breakfree' && d.victim === p) this.ui.toast('You broke free!');
    });
  }

  // The game world is owned by the LocalSim (null while this browser is an online guest).
  get physics() { return this.sim ? this.sim.physics : null; }
  get world() { return this.sim ? this.sim.world : null; }
  get player() { return this.sim ? this.sim.player : null; }
  get combat() { return this.sim ? this.sim.combat : null; }
  get bots() { return this.sim ? this.sim.bots : null; }

  start() {
    this._last = this.now();
    requestAnimationFrame(this._frame);
  }

  setPaused(paused) {
    this.paused = paused;
    this.input.setGameplayEnabled(!paused);
    this.cameraRig.enabled = !paused;
    this.ui.showPause(paused);
    if (paused) {
      this.ui.setPauseNote(this.mode === 'solo' ? '' : this.mode === 'host'
        ? 'You are hosting: pausing freezes the game for everyone.'
        : 'Online: the game keeps running while this menu is open.');
    }
  }

  _debugAction(name) {
    if (this.paused) return;
    if (this.mode === 'guest') {
      if (name === 'respawn' && this.guest) this.guest.requestRespawn();
      return;
    }
    if (name === 'respawn') this.player.respawn();
    else if (name === 'shove') this.player.shove();
    else if (name === 'drop') this.world.dropCrate();
    else if (name === 'reset') {
      this.world.resetCrates();
      this.ui.toast('Crates reset');
    }
  }

  _pushBotState() {
    if (!this.sim) return;
    const st = this.bots.settings;
    this.ui.setBotState({ enabled: st.enabled, count: st.count, active: this.bots.activeCount, max: BOTS.max, difficulty: st.difficulty });
  }

  _botControl({ type, value }) {
    if (!this.sim) return;
    const b = this.bots;
    if (type === 'plus') { b.settings.enabled = true; b.setCount(b.settings.count + 1); }
    else if (type === 'minus') b.setCount(b.settings.count - 1);
    else if (type === 'enabled') b.setEnabled(!!value);
    else if (type === 'difficulty') b.setDifficulty(value);
    else if (type === 'reset') { b.reset(); this.ui.toast('Bots reset'); }
    this._saveSettings();
    this._pushBotState();
  }

  _saveSettings() {
    const b = this.bots;
    writeJson(SETTINGS_KEY, { enabled: b.settings.enabled, count: b.settings.count, difficulty: b.settings.difficulty, map: this.sim.mapId });
  }

  _selectMap(id) {
    if (!this.sim) return;
    if (this.sim.setMap(id)) {
      this.cameraRig.snapTo(this.player.position);
      this.ui.setMapState(this.sim.mapId);
      this.ui.toast(getMap(id).name);
      this._saveSettings();
    }
  }

  // ---------------------------------------------------------------- online play

  _defaultServer() {
    const loc = globalThis.location;
    // When the page itself is served by the game server, no address is needed
    if (loc && /\.onrender\.com$|^localhost$|^127\./.test(loc.hostname || '')) return loc.host;
    return '';
  }

  async _onlineAction({ type, name, server, code }) {
    if (type === 'leave') { this._leaveOnline('You left the online game.'); return; }
    if (this.mode !== 'solo') return;
    const url = normalizeServerUrl(server, globalThis.location);
    if (!url) { this.ui.setOnlineStatus('Type your server address first, for example my-game.onrender.com', 'error'); return; }
    if (type === 'join' && !/^[A-Za-z]{4}$/.test(String(code || '').trim())) { this.ui.setOnlineStatus('Type the 4-letter room code from the host.', 'error'); return; }
    writeJson(ONLINE_KEY, { name, server });
    this.ui.setOnlineBusy(true);
    this.ui.setOnlineStatus('Connecting... (a sleeping free server can take about a minute)', 'info');
    const net = new NetClient({ WebSocketImpl: this.WebSocketImpl });
    try {
      await net.connect(url);
      if (type === 'host') await this._startHosting(net, name);
      else await this._startJoining(net, name, String(code).trim().toUpperCase());
    } catch (err) {
      net.close();
      this.ui.setOnlineBusy(false);
      this.ui.setOnlineStatus(`Could not connect: ${err && err.message ? err.message : err}`, 'error');
    }
  }

  async _startHosting(net, name) {
    const created = await net.request({ t: 'create', name }, 'created');
    this.net = net;
    this.mode = 'host';
    this.hostSync = new HostSync({ sim: this.sim, net, hostName: String(name || 'Host').slice(0, 14), getPaused: () => this.paused, now: this.now });
    this.hostSync.onPlayersChanged = (names) => this.ui.setOnlinePlayers(names);
    net.on('disconnect', () => this._leaveOnline('Lost the connection to the server.'));
    this.ui.setRole('host');
    this.ui.setOnlinePlayers(this.hostSync.playerNames);
    this.ui.setOnlineStatus(`Hosting. Room code: ${created.room}. Tell your friends to Join with this code.`, 'ok');
    this.ui.setOnlineBusy(false);
    this.ui.toast(`Room ${created.room}`);
  }

  async _startJoining(net, name, code) {
    const joined = await net.request({ t: 'join', room: code, name }, 'joined');
    this.net = net;
    this.mode = 'guest';
    // This browser stops simulating: everything is drawn from the host's snapshots
    this.sim.dispose();
    this.sim = null;
    this.guest = new GuestSession({ THREE: this.THREE, scene: this.scene, cameraRig: this.cameraRig, net, ui: this.ui, now: this.now });
    this.guest.onPlayersChanged = (names) => this.ui.setOnlinePlayers(names);
    net.on('host', (m) => this.guest.handle(m.d));
    net.on('closed', () => this._leaveOnline('The host ended the game.'));
    net.on('disconnect', () => this._leaveOnline('Lost the connection to the server.'));
    this._guestCamera = false;
    this.ui.setRole('guest');
    this.ui.setOnlinePlayers([joined.hostName]);
    this.ui.setOnlineStatus(`Joined ${joined.room} (host: ${joined.hostName}). Waiting for the game...`, 'ok');
    this.ui.setOnlineBusy(false);
    this.setPaused(false);
  }

  _leaveOnline(message) {
    if (this.mode === 'solo') return;
    const wasGuest = this.mode === 'guest';
    if (this.hostSync) { this.hostSync.dispose(); this.hostSync = null; }
    if (this.net) { this.net.send({ t: 'leave' }); this.net.close(); this.net = null; }
    if (this.guest) { this.guest.dispose(); this.guest = null; }
    this.mode = 'solo';
    if (wasGuest) {
      this._createSim();                                     // back to a normal single-player game
      this.cameraRig.snapTo(this.player.position);
      this.sim.postFrame(0);
      this.ui.setMapState(this.sim.mapId);
      this._pushBotState();
    }
    this.ui.setRole('solo');
    this.ui.setOnlinePlayers([]);
    this.ui.setOnlineBusy(false);
    this.ui.setOnlineStatus(message || 'Offline (solo game).', 'info');
    if (this.paused) this.setPaused(false);
    this.ui.setBanner('');
    this.ui.toast(message || 'Offline');
  }

  // ---------------------------------------------------------------- loop

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

      if (this.mode === 'guest') this._guestFrame(dt);
      else this._simFrame(dt);

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

  /** Solo and host: run the game here. */
  _simFrame(dt) {
    if (!this.paused) this.sim.step(dt, this.input, this.cameraRig.yaw);
    if (this.hostSync) this.hostSync.update(dt);
    this.sim.postFrame(dt);
    this.cameraRig.update(dt, this.player.position);
    const hl = this.player.handStatus('left'); const hr = this.player.handStatus('right');
    this.ui.setHandStatus('left', hl.text, hl.mode);
    this.ui.setHandStatus('right', hr.text, hr.mode);
    this.ui.setBanner(this.player.heldBy ? `${this.player.heldBy.name} has grabbed you! Struggle: move or jump` : '');
    if (this.bots.activeCount !== this._shownBots) { this._shownBots = this.bots.activeCount; this._pushBotState(); }
  }

  /** Guest: send keys, draw the host's world. */
  _guestFrame(dt) {
    const g = this.guest;
    if (!this.paused) g.sendInput(dt, this.input, this.cameraRig.yaw);
    g.render();
    if (g.haveSnap) {
      if (!this._guestCamera) { this.cameraRig.snapTo(g.focus); this._guestCamera = true; this.ui.setOnlineStatus(`Playing in room (host: ${g.hostName}).`, 'ok'); }
      this.cameraRig.update(dt, g.focus);
    }
    this.ui.setHandStatus('left', g.hud.left.text, g.hud.left.mode);
    this.ui.setHandStatus('right', g.hud.right.text, g.hud.right.mode);
    this.ui.setBanner(g.hud.banner);
    if (g.botInfo && g.botInfo !== this._shownBotInfo) {
      this._shownBotInfo = g.botInfo;
      this.ui.setBotState({ enabled: g.botInfo.enabled, count: g.botInfo.count, active: g.botInfo.active, max: g.botInfo.max, difficulty: g.botInfo.difficulty });
      this.ui.setMapState(g.mapId);
    }
  }
}

// Keyboard input with named actions and remappable bindings.
// Game code asks about ACTIONS ("jump"), never about raw keys ("Space"),
// so a future Settings menu only needs to call rebind().
//
// Bindings use KeyboardEvent.code (physical key position), so WASD stays
// in the same place on non-QWERTY keyboards.
//
// This module has no dependencies, so it can be tested without a browser.

export const ACTION = Object.freeze({
  MOVE_FORWARD: 'moveForward',
  MOVE_LEFT: 'moveLeft',
  MOVE_BACK: 'moveBack',
  MOVE_RIGHT: 'moveRight',
  JUMP: 'jump',
  LEFT_HAND: 'leftHand',
  RIGHT_HAND: 'rightHand',
  PAUSE: 'pause',
});

export const DEFAULT_BINDINGS = Object.freeze({
  [ACTION.MOVE_FORWARD]: ['KeyW'],
  [ACTION.MOVE_LEFT]: ['KeyA'],
  [ACTION.MOVE_BACK]: ['KeyS'],
  [ACTION.MOVE_RIGHT]: ['KeyD'],
  [ACTION.JUMP]: ['Space'],
  [ACTION.LEFT_HAND]: ['KeyQ'],
  [ACTION.RIGHT_HAND]: ['KeyE'],
  [ACTION.PAUSE]: ['Escape'],
});

// System actions keep working while the game is paused; gameplay actions do not.
const SYSTEM_ACTIONS = new Set([ACTION.PAUSE]);
const STORAGE_KEY = 'brawler.bindings.v1';

function cloneBindings(bindings) {
  const out = {};
  for (const [action, codes] of Object.entries(bindings)) out[action] = [...codes];
  return out;
}

function safeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (_) {
    return null; // storage can be blocked by browser privacy settings
  }
}

function isTextEntry(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export class InputManager {
  constructor({ target = globalThis.window, storage = safeStorage(), defaults = DEFAULT_BINDINGS } = {}) {
    this.target = target;
    this.storage = storage;
    this.defaults = defaults;
    this.bindings = cloneBindings(defaults);
    this.codeMap = new Map();   // key code -> [actions]
    this.down = new Set();      // key codes currently held
    this.pressed = new Set();   // actions pressed since the last endFrame()
    this.released = new Set();  // actions released since the last endFrame()
    this.gameplayEnabled = true;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onFocusLost = this._onFocusLost.bind(this);

    this._load();
    this._rebuild();
    this.attach();
  }

  attach() {
    if (!this.target) return;
    this.target.addEventListener('keydown', this._onKeyDown);
    this.target.addEventListener('keyup', this._onKeyUp);
    this.target.addEventListener('blur', this._onFocusLost);
    if (globalThis.document) globalThis.document.addEventListener('visibilitychange', this._onFocusLost);
  }

  detach() {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this._onKeyDown);
    this.target.removeEventListener('keyup', this._onKeyUp);
    this.target.removeEventListener('blur', this._onFocusLost);
    if (globalThis.document) globalThis.document.removeEventListener('visibilitychange', this._onFocusLost);
  }

  // ---- Queries (use these from game code) ----

  /** True while any key bound to the action is held. */
  isDown(action) {
    if (!this._available(action)) return false;
    const codes = this.bindings[action];
    return !!codes && codes.some((c) => this.down.has(c));
  }

  /** True only on the frame the action was pressed. */
  wasPressed(action) {
    return this.pressed.has(action);
  }

  /** True only on the frame the action was released. */
  wasReleased(action) {
    return this.released.has(action);
  }

  /** Returns -1, 0 or 1. Opposite keys held together cancel out. */
  getAxis(negativeAction, positiveAction) {
    return (this.isDown(positiveAction) ? 1 : 0) - (this.isDown(negativeAction) ? 1 : 0);
  }

  /** Call once at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }

  /** Disabling gameplay input (pause) leaves only system actions such as pause working. */
  setGameplayEnabled(enabled) {
    this.gameplayEnabled = !!enabled;
    if (!this.gameplayEnabled) {
      for (const set of [this.pressed, this.released]) {
        for (const action of [...set]) if (!SYSTEM_ACTIONS.has(action)) set.delete(action);
      }
    }
  }

  // ---- Remapping (for the future Settings menu) ----

  getBinding(action) {
    return [...(this.bindings[action] || [])];
  }

  /**
   * Binds an action to the given key codes, e.g. rebind('jump', ['KeyJ']).
   * Any other action using one of those keys loses it (no conflicts).
   * Returns the list of { action, code } that were displaced so the UI can warn.
   */
  rebind(action, codes) {
    if (!(action in this.bindings)) throw new Error(`Unknown action: ${action}`);
    if (!Array.isArray(codes) || codes.length === 0 || codes.some((c) => typeof c !== 'string' || !c)) {
      throw new Error('rebind needs a non-empty array of key code strings');
    }
    const displaced = [];
    for (const [other, otherCodes] of Object.entries(this.bindings)) {
      if (other === action) continue;
      for (const code of codes) {
        const i = otherCodes.indexOf(code);
        if (i !== -1) {
          otherCodes.splice(i, 1);
          displaced.push({ action: other, code });
        }
      }
    }
    this.bindings[action] = [...new Set(codes)];
    this._rebuild();
    this._save();
    return displaced;
  }

  resetBindings() {
    this.bindings = cloneBindings(this.defaults);
    this._rebuild();
    this._save();
  }

  // ---- Internals ----

  _available(action) {
    return this.gameplayEnabled || SYSTEM_ACTIONS.has(action);
  }

  _rebuild() {
    this.codeMap.clear();
    for (const [action, codes] of Object.entries(this.bindings)) {
      for (const code of codes) {
        if (!this.codeMap.has(code)) this.codeMap.set(code, []);
        this.codeMap.get(code).push(action);
      }
    }
  }

  _onKeyDown(e) {
    if (isTextEntry(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser/OS shortcuts (Cmd+W etc.) alone
    const actions = this.codeMap.get(e.code);
    if (!actions) return;
    e.preventDefault(); // stops Space scrolling the page
    if (e.repeat || this.down.has(e.code)) return;
    this.down.add(e.code);
    for (const action of actions) if (this._available(action)) this.pressed.add(action);
  }

  _onKeyUp(e) {
    // macOS does not send keyup for other keys while Cmd is held, so letting go of Cmd
    // clears everything to avoid "stuck" keys.
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') {
      this._releaseAll();
      return;
    }
    if (!this.down.delete(e.code)) return;
    const actions = this.codeMap.get(e.code) || [];
    for (const action of actions) if (this._available(action)) this.released.add(action);
    if (actions.length) e.preventDefault();
  }

  _onFocusLost() {
    this._releaseAll();
  }

  _releaseAll() {
    for (const code of this.down) {
      for (const action of this.codeMap.get(code) || []) {
        if (this._available(action)) this.released.add(action);
      }
    }
    this.down.clear();
  }

  _load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      for (const action of Object.keys(this.bindings)) {
        const codes = saved[action];
        if (Array.isArray(codes) && codes.every((c) => typeof c === 'string')) this.bindings[action] = codes;
      }
    } catch (_) {
      /* ignore corrupt saved bindings and keep the defaults */
    }
  }

  _save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch (_) {
      /* storage full or blocked: bindings just will not persist */
    }
  }
}

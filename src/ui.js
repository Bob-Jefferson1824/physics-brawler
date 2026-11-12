// All DOM access for the HUD, overlays and debug buttons lives here.
// It has no dependency on Three.js or Rapier.

export class UI {
  constructor(doc = document) {
    this.doc = doc;
    const $ = (id) => doc.getElementById(id);
    this.loading = $('loading');
    this.loadingStatus = $('loading-status');
    this.fatal = $('fatal');
    this.fatalMessage = $('fatal-message');
    this.fatalDetails = $('fatal-details');
    this.pauseOverlay = $('pause-overlay');
    this.toastEl = $('toast');
    this.fpsEl = $('fps');
    this.keyEls = [...doc.querySelectorAll('#input-monitor [data-action]')];
    this._toastTimer = null;
  }

  setLoading(text) {
    if (this.loadingStatus) this.loadingStatus.textContent = text;
  }

  hideLoading() {
    this.loading.classList.add('hidden');
  }

  showFatal(err) {
    const message = err && err.message ? err.message : String(err);
    this.loading.classList.add('hidden');
    this.fatalMessage.textContent = message.split('\n')[0];
    this.fatalDetails.textContent = (err && err.stack) || message;
    this.fatal.classList.remove('hidden');
  }

  showPause(visible) {
    this.pauseOverlay.classList.toggle('hidden', !visible);
  }

  toast(text, ms = 1800) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  setFps(fps) {
    this.fpsEl.textContent = `${Math.round(fps)} FPS`;
  }

  /** Lights up the on-screen key caps for every action currently held. */
  updateInputMonitor(isDown) {
    for (const el of this.keyEls) el.classList.toggle('active', isDown(el.dataset.action));
  }

  onPauseClick(handler) {
    this._bind('pause-btn', handler);
    this._bind('resume-btn', handler);
  }

  onDebugAction(handler) {
    for (const btn of this.doc.querySelectorAll('[data-debug]')) {
      btn.addEventListener('click', () => {
        handler(btn.dataset.debug);
        btn.blur(); // so a later Space press does not "click" the focused button
      });
    }
  }

  _bind(id, handler) {
    const el = this.doc.getElementById(id);
    el.addEventListener('click', () => {
      handler();
      el.blur();
    });
  }
}

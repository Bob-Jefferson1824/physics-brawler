// Entry point. Kept tiny on purpose: game.js is imported dynamically so that any
// failure while loading libraries or starting the game shows a readable error
// screen instead of a blank page.
import { UI } from './ui.js?v=s4r1';

const ui = new UI();

async function boot() {
  try {
    ui.setLoading('Loading game...');
    const { Game } = await import('./game.js?v=s4r1');
    const game = new Game({ canvas: document.getElementById('game-canvas'), ui });
    await game.init();
    ui.hideLoading();
    game.start();
    window.game = game; // handy for debugging in the browser console
  } catch (err) {
    console.error(err);
    ui.showFatal(err);
  }
}

boot();

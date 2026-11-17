// Loads Three.js and Rapier from a CDN, trying a fallback CDN if the first fails.
// Only game.js imports this file; every other module receives THREE and RAPIER as arguments.
import { DEPENDENCIES } from './config.js?v=s4r1';

async function importFirst(urls, label) {
  const errors = [];
  for (const url of urls) {
    try {
      return await import(url);
    } catch (err) {
      console.warn(`[deps] ${label}: failed to load ${url}`, err);
      errors.push(`${url}\n   -> ${err && err.message ? err.message : err}`);
    }
  }
  throw new Error(`Could not load ${label} from any CDN.\n${errors.join('\n')}`);
}

export async function loadDependencies(onStatus = () => {}) {
  onStatus('Loading Three.js...');
  const THREE = await importFirst(DEPENDENCIES.three, 'Three.js');

  onStatus('Loading Rapier physics...');
  const rapierModule = await importFirst(DEPENDENCIES.rapier, 'Rapier');
  const RAPIER = rapierModule.default || rapierModule;
  if (typeof RAPIER.init !== 'function') {
    throw new Error('Rapier loaded but has no init() function. Unexpected package layout.');
  }

  onStatus('Starting physics engine...');
  await RAPIER.init();

  return { THREE, RAPIER };
}

# Physics Brawler (working title)

An original, browser-based 3D physics brawler inspired by the chaos of party fighting games.
Built with Three.js (graphics), Rapier (physics) and plain JavaScript. No build step, no installs.

**Status: Stage 1 (foundation).** See "Features" below.

## Run it
The game uses ES modules, so it must be served over http(s). Opening `index.html` by
double-clicking (a `file://` address) will NOT work in most browsers.

Easiest: deploy to GitHub Pages (steps below) and open the URL.

## Deploy to GitHub Pages
1. Create a new public repository on github.com (for example `physics-brawler`).
2. Unzip the download on your computer. GitHub does not unzip files for you.
3. In the repository click **Add file > Upload files**, then drag in the CONTENTS of the
   `physics-brawler` folder (`index.html`, `style.css`, `src`, `.nojekyll`, `README.md`),
   not the folder itself. `index.html` must be at the top level of the repository.
4. Click **Commit changes**.
5. Go to **Settings > Pages**. Under "Build and deployment" choose **Deploy from a branch**,
   branch **main**, folder **/ (root)**, then **Save**.
6. After a minute or two the site is live at `https://YOUR-USERNAME.github.io/physics-brawler/`.

## Files
- `index.html`, `style.css` - page, HUD and overlays
- `src/main.js` - entry point and error handling
- `src/game.js` - main loop and wiring
- `src/deps.js`, `src/config.js` - CDN loading (with fallback) and tunable settings
- `src/physics.js` - Rapier wrapper: fixed timestep, interpolation, respawn
- `src/world.js` - arena, lighting, crates
- `src/player.js` - placeholder player
- `src/camera.js` - third-person camera
- `src/input.js` - remappable action-based keyboard input
- `src/ui.js` - HUD and overlay access

## Libraries (pinned, loaded from jsDelivr with an unpkg fallback)
- three 0.170.0
- @dimforge/rapier3d-compat 0.14.0

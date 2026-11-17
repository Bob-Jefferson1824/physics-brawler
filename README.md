# Physics Brawler

An original browser-based 3D physics brawler (Three.js + Rapier). Play solo against bots, or online with friends.

## Controls
W A S D move (relative to the camera) · Space jump · **Q** left hand · **E** right hand · Esc pause
Tap Q/E to punch. Hold to reach and grab crates or other fighters. Release to let go (moving while you release throws).
Hold Q and E together for a two-handed grab (needed for heavy crates). If someone grabs you, struggle by moving or jumping.
Drag to orbit the camera, scroll to zoom.

## What is in the game
* **Maps:** Classic Arena and Crossroads (a cross-shaped platform with deadly gaps and four jumpable islands).
* **Bots:** 0 to 5, Easy / Normal / Hard, Reset Bots, on/off.
* **Online:** up to 6 players (host + 5 friends) plus bots. The HOST's browser runs the game; friends send their keys and see the host's world.

## Playing online
1. One player opens the game, types a name and the server address, and clicks **Host**. A 4-letter room code appears.
2. Friends open the same game, type their name, the same server address and the room code, and click **Join**.
3. The host chooses the map, bots and difficulty. If the host leaves, the game ends for everyone.

## Deploying (GitHub + Render)

### Option A (simplest): everything on Render
1. Put all the files in a GitHub repository (see "Files" below; upload the whole folder contents).
2. On render.com: **New > Web Service**, connect the repository.
3. Settings: Runtime **Node**, Build Command `npm install`, Start Command `npm start`. (Or choose **New > Blueprint**: `render.yaml` sets this up.)
4. When it is live, open `https://YOUR-NAME.onrender.com`. Everyone opens that same address. The server box fills itself in, so just click Host / Join.

### Option B: game on GitHub Pages, online server on Render
1. Do Option A for the server (it also serves the game, which is fine).
2. Turn on GitHub Pages for the repository (Settings > Pages > main branch, root).
3. On the GitHub Pages site, type your Render address (for example `your-name.onrender.com`) into the **Server** box, then Host / Join. The address is remembered.

### Notes
* Render's free plan sleeps after about 15 minutes of no visitors. The first connection afterwards can take up to a minute; just try again.
* Optional: set an `ALLOWED_ORIGINS` environment variable on Render (comma separated, for example `https://you.github.io`) to refuse connections from other websites.
* The server only creates rooms and forwards messages. All physics runs in the host's browser.

## Files
* `index.html`, `style.css` - page and HUD
* `src/` - game code: `game.js` (loop and modes), `sim.js` (the running world), `maps.js` (map data), `world.js` (builds a map),
  `fighter.js` / `avatar.js` (characters), `player.js`, `remote.js`, `bot.js`, `combat.js`, `hands.js`, `character.js`,
  `physics.js`, `camera.js`, `input.js`, `net.js`, `multiplayer.js`, `ui.js`, `config.js`, `deps.js`, `main.js`
* `server/server.js`, `package.json`, `render.yaml` - the online server (Node; only needed for online play)

## Updating
Every file reference carries a version tag (currently `v=s4r1`). When you upload a new version, upload ALL files, then hard-refresh
(Cmd+Shift+R). The game checks at startup that its files match and names any that do not. To change the tag yourself, find-and-replace
`v=s4r1` across `index.html` and `src/`.

Libraries (loaded from jsDelivr, with an unpkg fallback): three 0.170.0, @dimforge/rapier3d-compat 0.14.0.

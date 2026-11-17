'use strict';
// Physics Brawler online server.
//
//  * Serves the game files (so one Render URL is the whole game), and
//  * relays messages between the players of a room over WebSockets at /ws.
//
// The HOST's browser runs the physics. This server never simulates anything: it only creates
// rooms, hands out player slots, and forwards messages (host -> guests, guests -> host).
//
// Run:  npm install  then  npm start      (Render sets PORT automatically)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const MAX_PLAYERS = 6;              // host + 5 guests
const MAX_MESSAGE = 32 * 1024;      // bytes; snapshots are a few KB
const MAX_ROOMS = 200;
const MAX_CONNECTIONS = 1000;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (easy to confuse with 1 and 0)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function cleanName(raw) {
  const s = String(raw == null ? '' : raw).replace(/[^\p{L}\p{N} _\-.!]/gu, '').trim().slice(0, 14);
  return s || 'Player';
}

function randomCode(rooms) {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

/** Resolves a URL path to a file under the game folder, or null if it must not be served. */
function resolveStatic(urlPath, root) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch (_) { return null; }
  if (p.includes('\0')) return null;
  if (p.endsWith('/')) p += 'index.html';
  const full = path.resolve(root, '.' + p);
  if (full !== root && !full.startsWith(root + path.sep)) return null;      // no ../ escapes
  const rel = path.relative(root, full).split(path.sep);
  if (rel.some((seg) => seg.startsWith('.') && seg !== '.nojekyll')) return null;   // no dotfiles
  if (['server', 'node_modules'].includes(rel[0])) return null;
  if (['package.json', 'package-lock.json', 'render.yaml'].includes(rel[rel.length - 1])) return null;
  if (!MIME[path.extname(full).toLowerCase()]) return null;
  return full;
}

function createServer({ root = ROOT, allowedOrigins = [], log = () => {} } = {}) {
  const rooms = new Map();
  let connections = 0;

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const file = resolveStatic(req.url || '/', root);
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()], 'Cache-Control': 'public, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

  server.on('upgrade', (req, socket, head) => {
    const url = (req.url || '').split('?')[0];
    const origin = req.headers.origin;
    const originOk = !allowedOrigins.length || !origin || allowedOrigins.includes(origin);
    if (url !== '/ws' || !originOk || connections >= MAX_CONNECTIONS) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const send = (ws, obj) => { if (ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
  const playersOf = (room) => [{ id: 0, name: room.host.name }, ...[...room.guests].map(([id, g]) => ({ id, name: g.name }))];

  function leaveRoom(ws, reason) {
    const room = ws.room;
    if (!room) return;
    ws.room = null;
    if (room.host === ws) {                       // the host leaving ends the room
      rooms.delete(room.code);
      for (const [, g] of room.guests) { g.ws.room = null; send(g.ws, { t: 'closed', reason: reason || 'host-left' }); }
      log('room closed', room.code);
    } else {
      room.guests.delete(ws.slot);
      const msg = { t: 'peer', ev: 'leave', id: ws.slot, name: ws.name };
      send(room.host, msg);
      for (const [, g] of room.guests) send(g.ws, msg);
    }
  }

  wss.on('connection', (ws) => {
    connections++;
    ws.isAlive = true;
    ws.room = null; ws.slot = -1; ws.name = 'Player';
    ws.tokens = 200; ws.lastRefill = Date.now();
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const now = Date.now();                                   // rate limit: 120 messages/second, burst 200
      ws.tokens = Math.min(200, ws.tokens + ((now - ws.lastRefill) / 1000) * 120); ws.lastRefill = now;
      if (--ws.tokens < 0) return;
      const text = data.toString();
      let msg;
      try { msg = JSON.parse(text); } catch (_) { return; }
      if (!msg || typeof msg.t !== 'string') return;

      switch (msg.t) {
        case 'ping': send(ws, { t: 'pong' }); break;
        case 'create': {
          if (ws.room) { send(ws, { t: 'error', msg: 'You are already in a room.' }); break; }
          if (rooms.size >= MAX_ROOMS) { send(ws, { t: 'error', msg: 'The server is full. Try again later.' }); break; }
          const code = randomCode(rooms);
          if (!code) { send(ws, { t: 'error', msg: 'Could not create a room.' }); break; }
          ws.name = cleanName(msg.name);
          const room = { code, host: ws, guests: new Map() };
          rooms.set(code, room); ws.room = room; ws.slot = 0;
          send(ws, { t: 'created', room: code, id: 0 });
          log('room created', code);
          break;
        }
        case 'join': {
          if (ws.room) { send(ws, { t: 'error', msg: 'You are already in a room.' }); break; }
          const room = rooms.get(String(msg.room || '').toUpperCase().trim());
          if (!room) { send(ws, { t: 'error', msg: 'No game found with that code.' }); break; }
          if (room.guests.size + 1 >= MAX_PLAYERS) { send(ws, { t: 'error', msg: 'That game is full.' }); break; }
          let id = 1; while (room.guests.has(id)) id++;
          ws.name = cleanName(msg.name);
          room.guests.set(id, { ws, name: ws.name });
          ws.room = room; ws.slot = id;
          send(ws, { t: 'joined', room: room.code, id, hostName: room.host.name, players: playersOf(room) });
          const peer = { t: 'peer', ev: 'join', id, name: ws.name };
          send(room.host, peer);
          for (const [gid, g] of room.guests) if (gid !== id) send(g.ws, peer);
          break;
        }
        case 'host': {                                          // host -> all guests (or one, with "to")
          const room = ws.room;
          if (!room || room.host !== ws) break;
          if (msg.to !== undefined) { const g = room.guests.get(msg.to); if (g) send(g.ws, { t: 'host', d: msg.d }); break; }
          for (const [, g] of room.guests) send(g.ws, text);
          break;
        }
        case 'guest': {                                         // a guest -> the host
          const room = ws.room;
          if (!room || room.host === ws) break;
          send(room.host, { t: 'guest', id: ws.slot, d: msg.d });
          break;
        }
        case 'leave': leaveRoom(ws, 'left'); break;
        default: break;
      }
    });

    ws.on('close', () => { connections--; leaveRoom(ws, 'host-left'); });
    ws.on('error', () => {});
  });

  // Keep connections alive (hosting platforms drop idle sockets) and drop dead ones
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) { /* closing */ }
    }
  }, 25000);
  heartbeat.unref();

  return {
    server, wss, rooms,
    listen(port) { return new Promise((resolve) => server.listen(port, () => resolve(server.address().port))); },
    close() { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); return new Promise((r) => server.close(r)); },
  };
}

module.exports = { createServer, resolveStatic, cleanName };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const app = createServer({ allowedOrigins: allowed, log: (...a) => console.log(...a) });
  app.listen(port).then((p) => console.log(`Physics Brawler server listening on port ${p}`));
}

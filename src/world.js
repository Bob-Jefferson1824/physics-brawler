// Builds a map: sky, lights, floors, props, crates and decorations. Works for any map in maps.js.
// With physics = null it builds only the visuals (used by guests in an online game).
import { makeArena } from './maps.js?v=s4r1';

function makeCanvasTexture(THREE, size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export function createWorld({ THREE, scene, physics, map, palette, maxExtraCrates, crateGroups = null }) {
  const theme = map.theme;
  const arena = makeArena(map);
  const group = new THREE.Group();      // everything the map adds lives under this, so it can be removed in one go
  scene.add(group);
  const staticBodies = [];

  // ---- Sky and lights ----
  const sky = document.createElement('canvas');
  sky.width = 2;
  sky.height = 256;
  const sctx = sky.getContext('2d');
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, theme.skyTop);
  grad.addColorStop(1, theme.skyBottom);
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(theme.fog, 70, 150);

  group.add(new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, 1.1));
  const sun = new THREE.DirectionalLight(theme.sun, 1.8);
  sun.position.set(theme.sunPos[0], theme.sunPos[1], theme.sunPos[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 90;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  group.add(sun);

  // ---- Floors (top surface at y = 0) ----
  const checker = makeCanvasTexture(THREE, 64, (ctx, s) => {
    ctx.fillStyle = theme.checkerA; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = theme.checkerB; ctx.fillRect(0, 0, s / 2, s / 2); ctx.fillRect(s / 2, s / 2, s / 2, s / 2);
  });
  checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
  const sideMat = new THREE.MeshStandardMaterial({ color: theme.side, roughness: 0.7 });
  const underMat = new THREE.MeshStandardMaterial({ color: theme.under, roughness: 0.9 });
  for (const f of map.floors) {
    const tex = checker.clone();
    tex.needsUpdate = true;
    tex.repeat.set(f.w / 4, f.d / 4);   // each checker square is 2 units across
    const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(f.w, 1, f.d), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]); // +x -x +y -y +z -z
    floor.position.set(f.x, -0.5, f.z);
    floor.receiveShadow = true;
    group.add(floor);
    // Visual-only underside so each piece looks like a floating island
    const under = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, f.w - 2), 5, Math.max(1, f.d - 2)), underMat);
    under.position.set(f.x, -3.5, f.z);
    group.add(under);
    if (physics) {
      staticBodies.push(physics.createStaticBox({
        position: { x: f.x, y: -0.5, z: f.z }, halfExtents: { x: f.w / 2, y: 0.5, z: f.d / 2 }, friction: 0.9,
      }));
    }
  }

  // ---- Static props ----
  const mats = {
    rail: new THREE.MeshStandardMaterial({ color: theme.rail, roughness: 0.5 }),
    block: new THREE.MeshStandardMaterial({ color: theme.block, roughness: 0.5 }),
  };
  for (const s of map.statics) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.half.x * 2, s.half.y * 2, s.half.z * 2), mats[s.color] || mats.block);
    mesh.name = s.name;
    mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
    let rotation = null;
    if (s.rotX) {
      rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.rotX, 0, 0));
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (physics) staticBodies.push(physics.createStaticBox({ position: s.pos, halfExtents: s.half, rotation }));
  }

  // ---- Crates ----
  const crateTextures = new Map();
  function crateMaterial(color) {
    if (!crateTextures.has(color)) {
      const tex = makeCanvasTexture(THREE, 128, (ctx, s) => {
        ctx.fillStyle = hex(color); ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 12; ctx.strokeRect(6, 6, s - 12, s - 12);
        ctx.lineWidth = 8; ctx.beginPath();
        ctx.moveTo(14, 14); ctx.lineTo(s - 14, s - 14); ctx.moveTo(s - 14, 14); ctx.lineTo(14, s - 14); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 0, s, 10);
      });
      crateTextures.set(color, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65 }));
    }
    return crateTextures.get(color);
  }

  /** A crate mesh with no physics (guests build these from the host's snapshots). */
  function createCrateMesh(size, color) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), crateMaterial(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function removeCrateMesh(mesh) {
    group.remove(mesh);
    mesh.geometry.dispose();
  }

  const initialCrates = [];
  const extraCrates = [];
  let nextNetId = 1;

  function spawnCrate(position, size, color) {
    const h = size / 2;
    const mesh = createCrateMesh(size, color);
    const body = physics.createDynamicBox({ position, halfExtents: { x: h, y: h, z: h }, groups: crateGroups });
    const entity = physics.register(body, mesh, { kind: 'crate', half: h });
    entity.netId = nextNetId++;   // lets online guests refer to this crate
    entity.color = color;
    return entity;
  }

  const P = palette;
  if (physics) {
    let c = 0;
    for (const cr of map.crates) initialCrates.push(spawnCrate({ x: cr.x, y: cr.y, z: cr.z }, cr.size, P[c++ % P.length]));
  }

  function removeCrate(entity) {
    physics.remove(entity);
    group.remove(entity.mesh);
    entity.mesh.geometry.dispose(); // materials are shared, so only the geometry is freed
  }

  function dropCrate() {
    if (!physics) return;
    const size = 0.8 + Math.random() * 0.6;
    let x; let z;
    if (map.dropBox) { x = (Math.random() - 0.5) * 2 * map.dropBox.x; z = (Math.random() - 0.5) * 2 * map.dropBox.z; }
    else { const p = arena.randomPoint(Math.random, 1.5); x = p.x; z = p.z; }
    extraCrates.push(spawnCrate({ x, y: 12, z }, size, P[Math.floor(Math.random() * P.length)]));
    while (extraCrates.length > maxExtraCrates) removeCrate(extraCrates.shift());
  }

  function resetCrates() {
    if (!physics) return;
    while (extraCrates.length) removeCrate(extraCrates.pop());
    for (const e of initialCrates) physics.respawnEntity(e);
  }

  // ---- Decorations (visual only) ----
  const decor = [];
  const decorColors = [0xff6b6b, 0xffd93d, 0x9d4edd, 0x4d96ff, 0x6bcb77, 0xff9f45];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const m = new THREE.Mesh(
      i % 2 ? new THREE.SphereGeometry(2.2, 24, 16) : new THREE.TorusGeometry(2, 0.8, 16, 32),
      new THREE.MeshStandardMaterial({ color: decorColors[i], roughness: 0.5 })
    );
    m.position.set(Math.cos(angle) * map.decorRadius, 8 + (i % 3) * 5, Math.sin(angle) * map.decorRadius);
    m.castShadow = false;
    group.add(m);
    decor.push({ mesh: m, baseY: m.position.y, phase: i });
  }
  let time = 0;
  function update(dt) {
    time += dt;
    for (const d of decor) {
      d.mesh.position.y = d.baseY + Math.sin(time * 0.8 + d.phase) * 0.8;
      d.mesh.rotation.y += dt * 0.3;
      d.mesh.rotation.x += dt * 0.15;
    }
  }

  /** Removes the whole map (meshes, crates and colliders). */
  function dispose() {
    if (physics) {
      for (const e of [...initialCrates, ...extraCrates]) physics.remove(e);
      for (const b of staticBodies) physics.removeStatic(b);
    }
    initialCrates.length = 0;
    extraCrates.length = 0;
    scene.remove(group);
  }

  return { map, arena, dropCrate, resetCrates, update, dispose, createCrateMesh, removeCrateMesh, initialCrates, extraCrates };
}

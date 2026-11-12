// Builds the arena: sky, lights, floor, rails, ramp, block, crates and decorations.

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

export function createWorld({ THREE, scene, physics, arena, palette, maxExtraCrates }) {
  const half = arena.halfSize;

  // ---- Sky and lights ----
  const sky = document.createElement('canvas');
  sky.width = 2;
  sky.height = 256;
  const sctx = sky.getContext('2d');
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5db7ff');
  grad.addColorStop(1, '#fff1d6');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0xd9ecff, 70, 150);

  scene.add(new THREE.HemisphereLight(0xdff0ff, 0xffe2b8, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(18, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 90;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // ---- Floor (top surface at y = 0) ----
  const checker = makeCanvasTexture(THREE, 64, (ctx, s) => {
    ctx.fillStyle = '#9ee6c4'; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#7fd6b0'; ctx.fillRect(0, 0, s / 2, s / 2); ctx.fillRect(s / 2, s / 2, s / 2, s / 2);
  });
  checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
  checker.repeat.set(half / 2, half / 2);
  const sideMat = new THREE.MeshStandardMaterial({ color: 0xffb86b, roughness: 0.7 });
  const topMat = new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 1, half * 2),
    [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]); // +x -x +y -y +z -z
  floor.position.set(0, -0.5, 0);
  floor.receiveShadow = true;
  scene.add(floor);
  physics.createStaticBox({ position: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: half, y: 0.5, z: half }, friction: 0.9 });

  // Visual-only underside so the arena looks like a floating island
  const under = new THREE.Mesh(new THREE.BoxGeometry(half * 1.8, 5, half * 1.8),
    new THREE.MeshStandardMaterial({ color: 0x8e6bbf, roughness: 0.9 }));
  under.position.set(0, -3.5, 0);
  scene.add(under);

  // ---- Static props ----
  const railMat = new THREE.MeshStandardMaterial({ color: 0xff6b9d, roughness: 0.5 });
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x4d96ff, roughness: 0.5 });

  function addStatic(name, position, halfExtents, material, rotation = null) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2), material);
    mesh.name = name;
    mesh.position.set(position.x, position.y, position.z);
    if (rotation) mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    physics.createStaticBox({ position, halfExtents, rotation });
    return mesh;
  }

  // Rails on the north and west edges only; the south and east edges are open drops.
  addStatic('Rail North', { x: 0, y: 0.6, z: -half + 0.25 }, { x: half, y: 0.6, z: 0.25 }, railMat);
  addStatic('Rail West', { x: -half + 0.25, y: 0.6, z: 0 }, { x: 0.25, y: 0.6, z: half }, railMat);
  addStatic('Raised Block', { x: 9, y: 0.75, z: -9 }, { x: 3, y: 0.75, z: 3 }, blockMat);
  const rampQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0));
  addStatic('Ramp', { x: -8, y: 1.2, z: 6 }, { x: 3, y: 0.2, z: 4 }, blockMat, rampQ);

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

  const initialCrates = [];
  const extraCrates = [];

  function spawnCrate(position, size, color) {
    const h = size / 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), crateMaterial(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const body = physics.createDynamicBox({ position, halfExtents: { x: h, y: h, z: h } });
    const entity = physics.register(body, mesh, { kind: 'crate' });
    return entity;
  }

  // A small pyramid, a tall stack, and a few loose crates
  const P = palette;
  let c = 0;
  const next = () => P[c++ % P.length];
  const pyramid = [
    [4, 0.5, 6], [5.05, 0.5, 6], [6.1, 0.5, 6], [4.5, 1.5, 6], [5.6, 1.5, 6], [5.05, 2.5, 6],
  ];
  for (const [x, y, z] of pyramid) initialCrates.push(spawnCrate({ x, y, z }, 1, next()));
  for (let i = 0; i < 4; i++) initialCrates.push(spawnCrate({ x: -4, y: 0.5 + i * 1.02, z: -5 }, 1, next()));
  initialCrates.push(spawnCrate({ x: 0, y: 0.7, z: -8 }, 1.4, next()));
  initialCrates.push(spawnCrate({ x: 3, y: 0.4, z: -3 }, 0.8, next()));
  initialCrates.push(spawnCrate({ x: -3, y: 0.5, z: 5 }, 1, next()));

  function removeCrate(entity) {
    physics.remove(entity);
    scene.remove(entity.mesh);
    entity.mesh.geometry.dispose(); // materials are shared, so only the geometry is freed
  }

  function dropCrate() {
    const size = 0.8 + Math.random() * 0.6;
    const pos = { x: (Math.random() - 0.5) * 24, y: 12, z: (Math.random() - 0.5) * 24 };
    extraCrates.push(spawnCrate(pos, size, P[Math.floor(Math.random() * P.length)]));
    while (extraCrates.length > maxExtraCrates) removeCrate(extraCrates.shift());
  }

  function resetCrates() {
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
    m.position.set(Math.cos(angle) * 40, 8 + (i % 3) * 5, Math.sin(angle) * 40);
    m.castShadow = false;
    scene.add(m);
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

  return { dropCrate, resetCrates, update, initialCrates, extraCrates };
}

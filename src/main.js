const DEFAULT_VERSION = '1.18.2';
const DEFAULT_MODE = 'Creative';
const WORLD_RADIUS = 26;
const SEA_LEVEL = 7;
const REACH = 6;
const FOV = Math.PI / 3;
const PLAYER_EYE_HEIGHT = 1.62;
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.32;
const START = { x: 0.5, y: 13.2, z: 8.5 };

const BLOCKS = {
  grass: { name: 'Grass Block', color: '#5da130' },
  dirt: { name: 'Dirt', color: '#866043' },
  stone: { name: 'Stone', color: '#7f7f7f' },
  oak: { name: 'Oak Log', color: '#87622f' },
  leaves: { name: 'Oak Leaves', color: '#2f7d32', alpha: 0.86 },
  glass: { name: 'Glass', color: '#9adcf5', alpha: 0.52 },
  planks: { name: 'Oak Planks', color: '#b78649' },
  brick: { name: 'Bricks', color: '#9f463d' },
  glowstone: { name: 'Glowstone', color: '#ffd76a', glow: true },
  water: { name: 'Water', color: '#3f76e4', alpha: 0.55, liquid: true }
};
const HOTBAR = ['grass', 'dirt', 'stone', 'oak', 'leaves', 'glass', 'planks', 'brick', 'glowstone'];
const SOLID = new Set(Object.keys(BLOCKS).filter((id) => !BLOCKS[id].liquid));
const world = new Map();
const keys = new Set();
const player = { ...START, yaw: 0, pitch: 0, vy: 0, flying: true, selected: 0 };
let lastFrame = performance.now();
let toastTimer;
let target = null;

const app = document.querySelector('#app');
app.innerHTML = `
  <canvas id="game" aria-label="Hydracraft 3D Minecraft-style client"></canvas>
  <div id="hud">
    <div class="topbar">
      <section class="panel brand">
        <h1>Hydracraft Web Client</h1>
        <p>A dependency-free Prismarine-style web client that defaults to Java ${DEFAULT_VERSION}, Creative mode, first-person control, raycast block editing, fly movement, fog, sky color, and a classic nine-slot hotbar.</p>
      </section>
      <section class="panel meta" aria-live="polite">
        <span>Version <strong>${DEFAULT_VERSION}</strong></span>
        <span>Default mode <strong>${DEFAULT_MODE}</strong></span>
        <span>Camera <strong id="position">0 0 0</strong></span>
        <span>Selected <strong id="selected">Grass Block</strong></span>
      </section>
    </div>
    <div id="crosshair" aria-hidden="true"></div>
    <div id="hotbar" aria-label="Creative hotbar"></div>
    <section id="controls" class="panel">
      <h2>Controls</h2>
      <ul>
        <li>Click Play to lock the mouse; look around with Minecraft-style mouselook.</li>
        <li>WASD moves, Ctrl sprints, Space rises, Shift descends, and F toggles creative flight.</li>
        <li>Left click breaks blocks; right click places the selected creative block.</li>
        <li>Use 1-9 or the mouse wheel to change hotbar slots; R respawns on the platform.</li>
      </ul>
    </section>
    <div id="toast" role="status"></div>
    <div id="lock">
      <div class="lock-card">
        <h2>Click to play Hydracraft</h2>
        <p>Starts on Minecraft Java ${DEFAULT_VERSION} in Creative mode with direct browser player control.</p>
        <button type="button" id="play">Play in browser</button>
      </div>
    </div>
  </div>`;

const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d', { alpha: false });
const hotbar = document.querySelector('#hotbar');
const selectedLabel = document.querySelector('#selected');
const positionLabel = document.querySelector('#position');
const lockOverlay = document.querySelector('#lock');
const toast = document.querySelector('#toast');

const faceDefs = [
  { n: [1, 0, 0], shade: 0.78, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], shade: 0.62, corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], shade: 1.08, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], shade: 0.48, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], shade: 0.72, corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], shade: 0.88, corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }
];

function blockKey(x, y, z) { return `${x},${y},${z}`; }
function parseKey(value) { return value.split(',').map(Number); }
function getBlock(x, y, z) { return world.get(blockKey(x, y, z)); }
function isSolid(x, y, z) { return SOLID.has(getBlock(Math.floor(x), Math.floor(y), Math.floor(z))); }
function setBlock(x, y, z, id) { world.set(blockKey(x, y, z), id); }
function removeBlock(x, y, z) { world.delete(blockKey(x, y, z)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function hexToRgb(hex) { return hex.slice(1).match(/../g).map((part) => parseInt(part, 16)); }
function shadeColor(hex, shade) {
  const [r, g, b] = hexToRgb(hex).map((channel) => clamp(Math.round(channel * shade), 0, 255));
  return `rgb(${r},${g},${b})`;
}

function resize() {
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * scale);
  canvas.height = Math.floor(window.innerHeight * scale);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function heightAt(x, z) {
  const rolling = Math.sin(x * 0.23) * 2.2 + Math.cos(z * 0.19) * 2.1;
  const ridges = Math.sin((x + z) * 0.11) * 1.8 + Math.cos((x - z) * 0.17) * 1.2;
  return Math.max(4, Math.round(8 + rolling + ridges));
}

function growTree(x, y, z) {
  for (let i = 0; i < 4; i += 1) setBlock(x, y + i, z, 'oak');
  for (let lx = -2; lx <= 2; lx += 1) {
    for (let ly = 2; ly <= 4; ly += 1) {
      for (let lz = -2; lz <= 2; lz += 1) {
        if (Math.abs(lx) + Math.abs(lz) + Math.max(0, ly - 3) <= 4) setBlock(x + lx, y + ly, z + lz, 'leaves');
      }
    }
  }
}

function generateWorld() {
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 1) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 1) {
      const h = heightAt(x, z);
      for (let y = 0; y <= h; y += 1) setBlock(x, y, z, y === h ? 'grass' : y > h - 4 ? 'dirt' : 'stone');
      if (h < SEA_LEVEL) for (let y = h + 1; y <= SEA_LEVEL; y += 1) setBlock(x, y, z, 'water');
      if ((x * 928371 + z * 689287) % 47 === 0 && h > SEA_LEVEL) growTree(x, h + 1, z);
    }
  }
  for (let x = -3; x <= 3; x += 1) for (let z = 5; z <= 11; z += 1) setBlock(x, 11, z, (x + z) % 2 ? 'glass' : 'planks');
  setBlock(0, 12, 5, 'glowstone');
}

function drawHotbar() {
  hotbar.innerHTML = '';
  HOTBAR.forEach((id, index) => {
    const slot = document.createElement('button');
    slot.className = `slot${index === player.selected ? ' active' : ''}`;
    slot.type = 'button';
    slot.title = BLOCKS[id].name;
    slot.innerHTML = `<span class="swatch" style="background:${BLOCKS[id].color}"></span><kbd>${index + 1}</kbd>`;
    slot.addEventListener('click', () => selectSlot(index));
    hotbar.append(slot);
  });
  selectedLabel.textContent = BLOCKS[HOTBAR[player.selected]].name;
}

function selectSlot(index) {
  player.selected = (index + HOTBAR.length) % HOTBAR.length;
  drawHotbar();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1300);
}

function forwardVector() {
  const cp = Math.cos(player.pitch);
  return { x: Math.sin(player.yaw) * cp, y: Math.sin(player.pitch), z: Math.cos(player.yaw) * cp };
}

function projectPoint(x, y, z) {
  const dx = x - player.x;
  const dy = y - player.y;
  const dz = z - player.z;
  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  const right = dx * cosY - dz * sinY;
  const forward = dx * sinY + dz * cosY;
  const sinP = Math.sin(player.pitch), cosP = Math.cos(player.pitch);
  const up = dy * cosP - forward * sinP;
  const depth = dy * sinP + forward * cosP;
  if (depth <= 0.06) return null;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const focal = width / (2 * Math.tan(FOV / 2));
  return { x: width / 2 + (right * focal) / depth, y: height / 2 - (up * focal) / depth, depth };
}

function visibleFaces() {
  const faces = [];
  for (const [key, id] of world) {
    const [x, y, z] = parseKey(key);
    const dx = x + 0.5 - player.x;
    const dy = y + 0.5 - player.y;
    const dz = z + 0.5 - player.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > 58 * 58) continue;
    for (const face of faceDefs) {
      const nx = x + face.n[0], ny = y + face.n[1], nz = z + face.n[2];
      const neighbor = getBlock(nx, ny, nz);
      if (neighbor && (!BLOCKS[id].alpha || !BLOCKS[neighbor].alpha)) continue;
      const center = [x + 0.5 + face.n[0] * 0.5, y + 0.5 + face.n[1] * 0.5, z + 0.5 + face.n[2] * 0.5];
      const towardCamera = (player.x - center[0]) * face.n[0] + (player.y - center[1]) * face.n[1] + (player.z - center[2]) * face.n[2];
      if (towardCamera <= 0) continue;
      const points = face.corners.map(([cx, cy, cz]) => projectPoint(x + cx, y + cy, z + cz));
      if (points.some((point) => !point)) continue;
      faces.push({ id, key, points, distanceSq, shade: face.shade, normal: face.n });
    }
  }
  return faces.sort((a, b) => b.distanceSq - a.distanceSq);
}

function drawSkyAndGround() {
  const w = window.innerWidth, h = window.innerHeight;
  const horizon = h / 2 + Math.sin(player.pitch) * h * 0.9;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#7db7ff');
  sky.addColorStop(1, '#b9e4ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#5f8f42';
  ctx.fillRect(0, clamp(horizon, 0, h), w, h);
}

function drawWorld() {
  drawSkyAndGround();
  for (const face of visibleFaces()) {
    const block = BLOCKS[face.id];
    const fog = clamp(1 - Math.sqrt(face.distanceSq) / 72, 0.2, 1);
    ctx.globalAlpha = (block.alpha ?? 1) * fog;
    ctx.beginPath();
    ctx.moveTo(face.points[0].x, face.points[0].y);
    for (let i = 1; i < face.points.length; i += 1) ctx.lineTo(face.points[i].x, face.points[i].y);
    ctx.closePath();
    ctx.fillStyle = shadeColor(block.color, block.glow ? 1.18 : face.shade);
    ctx.fill();
    ctx.globalAlpha = Math.min(0.22, fog);
    ctx.strokeStyle = '#050505';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (target) drawTargetOutline();
}

function drawTargetOutline() {
  const [x, y, z] = target.block;
  const points = [
    projectPoint(x, y, z), projectPoint(x + 1, y, z), projectPoint(x + 1, y + 1, z), projectPoint(x, y + 1, z),
    projectPoint(x, y, z + 1), projectPoint(x + 1, y, z + 1), projectPoint(x + 1, y + 1, z + 1), projectPoint(x, y + 1, z + 1)
  ];
  if (points.some((point) => !point)) return;
  const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 2;
  for (const [a, b] of edges) {
    ctx.beginPath(); ctx.moveTo(points[a].x, points[a].y); ctx.lineTo(points[b].x, points[b].y); ctx.stroke();
  }
}

function raycast() {
  const dir = forwardVector();
  let previous = [Math.floor(player.x), Math.floor(player.y), Math.floor(player.z)];
  for (let d = 0; d <= REACH; d += 0.05) {
    const x = Math.floor(player.x + dir.x * d);
    const y = Math.floor(player.y + dir.y * d);
    const z = Math.floor(player.z + dir.z * d);
    const id = getBlock(x, y, z);
    if (id && id !== 'water') return { block: [x, y, z], previous, id };
    previous = [x, y, z];
  }
  return null;
}

function playerIntersects(x, y, z) {
  const minX = player.x - PLAYER_RADIUS, maxX = player.x + PLAYER_RADIUS;
  const minY = player.y - PLAYER_EYE_HEIGHT, maxY = minY + PLAYER_HEIGHT;
  const minZ = player.z - PLAYER_RADIUS, maxZ = player.z + PLAYER_RADIUS;
  return maxX > x && minX < x + 1 && maxY > y && minY < y + 1 && maxZ > z && minZ < z + 1;
}

function wouldCollide(next) {
  const minX = Math.floor(next.x - PLAYER_RADIUS), maxX = Math.floor(next.x + PLAYER_RADIUS);
  const minY = Math.floor(next.y - PLAYER_EYE_HEIGHT), maxY = Math.floor(next.y - PLAYER_EYE_HEIGHT + PLAYER_HEIGHT);
  const minZ = Math.floor(next.z - PLAYER_RADIUS), maxZ = Math.floor(next.z + PLAYER_RADIUS);
  for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) for (let z = minZ; z <= maxZ; z += 1) if (isSolid(x, y, z)) return true;
  return false;
}

function moveAxis(axis, amount) {
  const next = { x: player.x, y: player.y, z: player.z };
  next[axis] += amount;
  if (player.flying || !wouldCollide(next)) player[axis] = next[axis];
  else if (axis === 'y') player.vy = 0;
}

function updateMovement(delta) {
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
  const strafe = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  const vertical = Number(keys.has('Space')) - Number(keys.has('ShiftLeft') || keys.has('ShiftRight'));
  const length = Math.hypot(forward, strafe, vertical) || 1;
  const speed = (player.flying ? 11 : 4.3) * (keys.has('ControlLeft') || keys.has('ControlRight') ? 1.45 : 1);
  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  const vx = ((sinY * forward + cosY * strafe) / length) * speed;
  const vz = ((cosY * forward - sinY * strafe) / length) * speed;
  const vy = player.flying ? (vertical / length) * speed : (player.vy -= 24 * delta);
  moveAxis('x', vx * delta);
  moveAxis('z', vz * delta);
  moveAxis('y', vy * delta);
}

function breakBlock() {
  if (!target) return;
  removeBlock(...target.block);
}

function placeBlock() {
  if (!target) return;
  const [x, y, z] = target.previous;
  if (getBlock(x, y, z) || playerIntersects(x, y, z)) return;
  setBlock(x, y, z, HOTBAR[player.selected]);
}

function resetSpawn() {
  Object.assign(player, START, { yaw: 0, pitch: 0, vy: 0, flying: true });
  showToast('Respawned in Creative mode');
}

function frame(now) {
  const delta = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  updateMovement(delta);
  target = raycast();
  drawWorld();
  positionLabel.textContent = `${player.x.toFixed(1)} ${player.y.toFixed(1)} ${player.z.toFixed(1)}`;
  requestAnimationFrame(frame);
}

generateWorld();
resize();
drawHotbar();
requestAnimationFrame(frame);

window.addEventListener('resize', resize);
document.querySelector('#play').addEventListener('click', () => canvas.requestPointerLock());
canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => lockOverlay.classList.toggle('hidden', document.pointerLockElement === canvas));
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= event.movementX * 0.0025;
  player.pitch = clamp(player.pitch - event.movementY * 0.0025, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
});
document.addEventListener('keydown', (event) => {
  keys.add(event.code);
  if (/^Digit[1-9]$/.test(event.code)) selectSlot(Number(event.code.slice(5)) - 1);
  if (!event.repeat && event.code === 'KeyF') { player.flying = !player.flying; showToast(player.flying ? 'Creative flight enabled' : 'Creative flight disabled'); }
  if (!event.repeat && event.code === 'KeyR') resetSpawn();
});
document.addEventListener('keyup', (event) => keys.delete(event.code));
document.addEventListener('mousedown', (event) => {
  if (document.pointerLockElement !== canvas) return;
  if (event.button === 0) breakBlock();
  if (event.button === 2) placeBlock();
});
document.addEventListener('contextmenu', (event) => event.preventDefault());
document.addEventListener('wheel', (event) => selectSlot(player.selected + Math.sign(event.deltaY)));

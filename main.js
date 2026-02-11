// Hot Water Tank — Beat-Reactive Boiler Room (Canvas2D + Web Audio API)
// No build step. Serve with: python3 -m http.server

// ---- Config (easy to swap audio) -------------------------------------------
const AUDIO_CANDIDATES = [
  "assets/hot-water-tank.mp3",
  "assets/hot_water_tank.mp3",
  // Convenience fallback for this repo's existing filename (URL-encoded at runtime).
  "Boldy James & The Alchemist - ＂Hot Water Tank＂.mp3",
];

// ---- Canvas / pixel scaling ------------------------------------------------
const INTERNAL_W = 400;
const INTERNAL_H = 224;
const TILE = 16;

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d", { alpha: false });

const sceneCanvas = document.createElement("canvas");
sceneCanvas.width = INTERNAL_W;
sceneCanvas.height = INTERNAL_H;
const sceneCtx = sceneCanvas.getContext("2d");

const warpCanvas = document.createElement("canvas");
warpCanvas.width = INTERNAL_W;
warpCanvas.height = INTERNAL_H;
const warpCtx = warpCanvas.getContext("2d");

const punchCanvas = document.createElement("canvas");
punchCanvas.width = INTERNAL_W;
punchCanvas.height = INTERNAL_H;
const punchCtx = punchCanvas.getContext("2d");

for (const c of [ctx, sceneCtx, warpCtx, punchCtx]) c.imageSmoothingEnabled = false;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

let fitScale = 2;
let presentX = 0;
let presentY = 0;

function resize() {
  const maxW = Math.floor(canvas.clientWidth);
  const maxH = Math.floor(canvas.clientHeight);
  fitScale = Math.max(1, Math.floor(Math.min(maxW / INTERNAL_W, maxH / INTERNAL_H)));
  canvas.width = INTERNAL_W * fitScale;
  canvas.height = INTERNAL_H * fitScale;
  presentX = Math.floor((canvas.width - INTERNAL_W * fitScale) / 2);
  presentY = Math.floor((canvas.height - INTERNAL_H * fitScale) / 2);
  ctx.imageSmoothingEnabled = false;
}

window.addEventListener("resize", resize);
resize();

// ---- UI --------------------------------------------------------------------
const playBtn = document.querySelector("#playBtn");
const pauseBtn = document.querySelector("#pauseBtn");
const volumeEl = document.querySelector("#volume");
const debugToggle = document.querySelector("#debugToggle");
const statusEl = document.querySelector("#status");
const promptEl = document.querySelector("#prompt");
const debugEl = document.querySelector("#debug");

function setStatus(text) {
  statusEl.textContent = text;
}

function setPrompt(text) {
  if (!text) {
    promptEl.style.display = "none";
    promptEl.textContent = "";
    return;
  }
  promptEl.textContent = text;
  promptEl.style.display = "block";
}

// ---- Audio (Web Audio API + AnalyserNode) ----------------------------------
let audioCtx = null;
let analyser = null;
let freqData = null;
let audioEl = null;
let gainNode = null;
let audioReady = false;

let amp = 0;
let bass = 0;
let bassSmooth = 0;
let bassAvg = 0.08;
let beat = 0;
let lastBeatAt = -1e9;

async function headOk(url) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (res.ok) return true;
    if (res.status === 405) return true; // some servers disallow HEAD but still serve GET
    return false;
  } catch {
    return false;
  }
}

async function pickAudioUrl(candidates) {
  for (const raw of candidates) {
    const url = raw.includes("%") ? raw : encodeURI(raw);
    // If it's already a path like assets/..., encodeURI is fine too.
    if (await headOk(url)) return url;
  }
  return encodeURI(candidates[0]);
}

function computeRms(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i] / 255;
    sum += v * v;
  }
  return Math.sqrt(sum / bytes.length);
}

function computeBandAvg(bytes, sampleRate, hzLo, hzHi) {
  const binCount = bytes.length;
  const nyquist = sampleRate / 2;
  const lo = clamp(Math.floor((hzLo / nyquist) * binCount), 0, binCount - 1);
  const hi = clamp(Math.floor((hzHi / nyquist) * binCount), 0, binCount - 1);
  if (hi <= lo) return 0;
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += bytes[i];
  return sum / (hi - lo + 1) / 255;
}

function setAudioButtons(isPlaying) {
  playBtn.disabled = isPlaying;
  pauseBtn.disabled = !isPlaying;
}

async function initAudio() {
  if (audioCtx) return;

  audioEl = new Audio();
  audioEl.crossOrigin = "anonymous";
  audioEl.loop = true;
  audioEl.preload = "auto";

  const chosen = await pickAudioUrl(AUDIO_CANDIDATES);
  audioEl.src = chosen;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  gainNode = audioCtx.createGain();
  gainNode.gain.value = Number(volumeEl.value);

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.75;
  freqData = new Uint8Array(analyser.frequencyBinCount);

  const src = audioCtx.createMediaElementSource(audioEl);
  src.connect(analyser);
  analyser.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  audioEl.addEventListener("error", () => {
    audioReady = false;
    setStatus(
      "Audio failed to load. Put an .mp3 at assets/hot-water-tank.mp3 or edit AUDIO_CANDIDATES in main.js."
    );
    setAudioButtons(false);
  });

  audioEl.addEventListener("canplay", () => {
    audioReady = true;
    setStatus(`Loaded audio: ${decodeURI(chosen)}`);
  });
}

async function playAudio() {
  await initAudio();
  if (!audioCtx || !audioEl) return;
  await audioCtx.resume();
  try {
    await audioEl.play();
    setAudioButtons(true);
    setStatus("Playing. (WASD to move, E to interact)");
  } catch (err) {
    setStatus(`Play blocked: ${String(err)}`);
    setAudioButtons(false);
  }
}

function pauseAudio() {
  if (!audioEl) return;
  audioEl.pause();
  setAudioButtons(false);
  setStatus("Paused.");
}

playBtn.addEventListener("click", playAudio);
pauseBtn.addEventListener("click", pauseAudio);
volumeEl.addEventListener("input", () => {
  if (gainNode) gainNode.gain.value = Number(volumeEl.value);
});
debugToggle.addEventListener("change", () => {
  debugEl.hidden = !debugToggle.checked;
});

// ---- Input -----------------------------------------------------------------
const keys = new Map();
window.addEventListener("keydown", (e) => {
  if (["KeyW", "KeyA", "KeyS", "KeyD", "KeyE"].includes(e.code)) e.preventDefault();
  keys.set(e.code, true);
});
window.addEventListener("keyup", (e) => keys.set(e.code, false));
function isDown(code) {
  return keys.get(code) === true;
}

let ePressed = false;
function consumeE() {
  const down = isDown("KeyE");
  const fired = down && !ePressed;
  ePressed = down;
  return fired;
}

// ---- World / tile map ------------------------------------------------------
const W_TILES = 96;
const H_TILES = 64;

const Tile = Object.freeze({
  Floor: 0,
  Wall: 1,
  Grate: 2,
  Tank: 3,
  Pipe: 4,
  Panel: 5,
  Vent: 6,
  Gate: 7,
});

const SOLID = new Set([Tile.Wall, Tile.Tank, Tile.Pipe, Tile.Panel, Tile.Gate]);
const GATE = Object.freeze({ tx: 61, ty: 28, w: 2, h: 4 });

const map = new Uint8Array(W_TILES * H_TILES);
function idx(tx, ty) {
  return ty * W_TILES + tx;
}
function getTile(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= W_TILES || ty >= H_TILES) return Tile.Wall;
  return map[idx(tx, ty)];
}
function setTile(tx, ty, t) {
  if (tx < 0 || ty < 0 || tx >= W_TILES || ty >= H_TILES) return;
  map[idx(tx, ty)] = t;
}
function fillRect(tx, ty, tw, th, t) {
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) setTile(tx + x, ty + y, t);
}

function carveRoom(tx, ty, tw, th) {
  fillRect(tx, ty, tw, th, Tile.Floor);
  for (let x = tx; x < tx + tw; x++) {
    setTile(x, ty, Tile.Wall);
    setTile(x, ty + th - 1, Tile.Wall);
  }
  for (let y = ty; y < ty + th; y++) {
    setTile(tx, y, Tile.Wall);
    setTile(tx + tw - 1, y, Tile.Wall);
  }
}

// Boiler-room layout: a few connected chambers + a tank hall.
function generateMap() {
  map.fill(Tile.Grate);
  fillRect(0, 0, W_TILES, 1, Tile.Wall);
  fillRect(0, H_TILES - 1, W_TILES, 1, Tile.Wall);
  fillRect(0, 0, 1, H_TILES, Tile.Wall);
  fillRect(W_TILES - 1, 0, 1, H_TILES, Tile.Wall);

  carveRoom(3, 3, 34, 22); // entry / panels
  carveRoom(37, 3, 56, 26); // main hall
  carveRoom(8, 25, 40, 30); // furnace wing
  carveRoom(48, 30, 42, 28); // tank hall

  // Doorways (remove wall tiles to connect rooms).
  fillRect(36, 12, 2, 4, Tile.Floor);
  fillRect(22, 24, 4, 2, Tile.Floor);
  // Main hall -> tank hall corridor (narrow, with a gate).
  fillRect(GATE.tx, GATE.ty, GATE.w, GATE.h, Tile.Floor);
  fillRect(GATE.tx, GATE.ty, GATE.w, GATE.h, Tile.Gate);

  // Pipes along walls.
  for (let x = 5; x < 34; x += 3) setTile(x, 5, Tile.Pipe);
  for (let x = 40; x < 90; x += 4) setTile(x, 6, Tile.Pipe);
  for (let y = 8; y < 24; y += 3) setTile(5, y, Tile.Pipe);
  for (let y = 34; y < 56; y += 4) setTile(89, y, Tile.Pipe);

  // Control panels.
  fillRect(10, 8, 6, 2, Tile.Panel);
  fillRect(14, 16, 4, 2, Tile.Panel);
  fillRect(28, 10, 6, 2, Tile.Panel);

  // Furnace block.
  fillRect(15, 34, 10, 8, Tile.Wall);
  fillRect(18, 36, 4, 4, Tile.Panel);

  // Hot water tank (big).
  fillRect(62, 38, 12, 10, Tile.Tank);
  fillRect(64, 36, 8, 2, Tile.Pipe); // top pipes
  fillRect(60, 49, 16, 2, Tile.Pipe); // bottom pipes

  // Vents.
  setTile(52, 36, Tile.Vent);
  setTile(78, 34, Tile.Vent);
  setTile(24, 44, Tile.Vent);
  setTile(12, 48, Tile.Vent);
}

generateMap();

const WORLD_W = W_TILES * TILE;
const WORLD_H = H_TILES * TILE;

// ---- Entities --------------------------------------------------------------
const player = {
  x: 8 * TILE + 3,
  y: 10 * TILE + 2,
  w: 12,
  h: 12,
  dir: "down",
  animTime: 0,
  animFrame: 0,
};

function playerCenter() {
  return { x: player.x + player.w / 2, y: player.y + player.h / 2 };
}

const camera = { x: 0, y: 0, shake: 0 };
let steamEnabled = false;
let consoleArmed = false;
let gateOpen = false;
let overheadLights = true;
let alarmEnabled = false;

const torches = [
  { id: "torch-entry-1", x: 6 * TILE + 4, y: 6 * TILE + 2, lit: true },
  { id: "torch-entry-2", x: 33 * TILE + 4, y: 8 * TILE + 2, lit: true },
  { id: "torch-main-1", x: 44 * TILE + 4, y: 6 * TILE + 2, lit: true },
  { id: "torch-main-2", x: 58 * TILE + 4, y: 24 * TILE + 2, lit: true },
  { id: "torch-tank-1", x: 52 * TILE + 4, y: 40 * TILE + 2, lit: true },
];

const valve = {
  id: "valve",
  // Placed on the main-hall side of the gate so it's reachable immediately.
  x: 59 * TILE + 6,
  y: 26 * TILE + 6,
  w: 14,
  h: 14,
  label: "Press E to turn valve",
  onInteract: () => {
    steamEnabled = !steamEnabled;
    gateOpen = !gateOpen;
    for (let y = 0; y < GATE.h; y++) {
      for (let x = 0; x < GATE.w; x++) {
        setTile(GATE.tx + x, GATE.ty + y, gateOpen ? Tile.Floor : Tile.Gate);
      }
    }
    setStatus(steamEnabled ? "Valve opened: steam online." : "Valve closed: steam offline.");
  },
};

const consolePanel = {
  id: "console",
  x: 12 * TILE + 8,
  y: 8 * TILE + 0,
  w: 32,
  h: 18,
  label: "Press E to arm console",
  onInteract: () => {
    consoleArmed = !consoleArmed;
    setStatus(consoleArmed ? "Console armed: bass sync enabled." : "Console disarmed.");
  },
};

const lightSwitch = {
  id: "lights",
  x: 18 * TILE + 6,
  y: 18 * TILE + 6,
  w: 14,
  h: 14,
  label: "Press E to toggle lights",
  onInteract: () => {
    overheadLights = !overheadLights;
    setStatus(overheadLights ? "Overhead lights: ON" : "Overhead lights: OFF");
  },
};

const alarmPanel = {
  id: "alarm",
  x: 46 * TILE + 6,
  y: 10 * TILE + 6,
  w: 14,
  h: 14,
  label: "Press E to toggle alarm",
  onInteract: () => {
    alarmEnabled = !alarmEnabled;
    setStatus(alarmEnabled ? "Alarm panel: ARMED" : "Alarm panel: OFF");
  },
};

const interactables = [valve, consolePanel, lightSwitch, alarmPanel];
for (const t of torches) {
  interactables.push({
    id: t.id,
    x: t.x,
    y: t.y,
    w: 16,
    h: 16,
    get label() {
      return t.lit ? "Press E to extinguish torch" : "Press E to light torch";
    },
    onInteract: () => {
      t.lit = !t.lit;
      setStatus(t.lit ? "Torch lit." : "Torch out.");
    },
  });
}

// ---- Particles (red dust + steam) -----------------------------------------
const dust = [];
const DUST_COUNT = 140;

function spawnDust() {
  dust.length = 0;
  for (let i = 0; i < DUST_COUNT; i++) {
    dust.push({
      x: Math.random() * WORLD_W,
      y: Math.random() * WORLD_H,
      vx: (Math.random() * 2 - 1) * 4,
      vy: -(6 + Math.random() * 10),
      a: 0.25 + Math.random() * 0.55,
      s: 1,
    });
  }
}

spawnDust();

const steam = [];
function puffSteam(x, y, strength) {
  const count = 4 + Math.floor(strength * 10);
  for (let i = 0; i < count; i++) {
    steam.push({
      x: x + (Math.random() * 2 - 1) * 3,
      y: y + (Math.random() * 2 - 1) * 3,
      vx: (Math.random() * 2 - 1) * (10 + strength * 30),
      vy: -(20 + Math.random() * 30 + strength * 80),
      life: 0.6 + Math.random() * 0.5,
      t: 0,
    });
  }
}

// ---- Movement + collision (tile AABB) -------------------------------------
function isSolidAt(tx, ty) {
  return SOLID.has(getTile(tx, ty));
}

function moveAndCollide(ent, dx, dy) {
  // X axis
  if (dx !== 0) {
    ent.x += dx;
    const left = Math.floor(ent.x / TILE);
    const right = Math.floor((ent.x + ent.w - 1) / TILE);
    const top = Math.floor(ent.y / TILE);
    const bottom = Math.floor((ent.y + ent.h - 1) / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        if (!isSolidAt(tx, ty)) continue;
        const tileX = tx * TILE;
        if (dx > 0) ent.x = tileX - ent.w;
        else ent.x = tileX + TILE;
      }
    }
  }

  // Y axis
  if (dy !== 0) {
    ent.y += dy;
    const left = Math.floor(ent.x / TILE);
    const right = Math.floor((ent.x + ent.w - 1) / TILE);
    const top = Math.floor(ent.y / TILE);
    const bottom = Math.floor((ent.y + ent.h - 1) / TILE);
    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        if (!isSolidAt(tx, ty)) continue;
        const tileY = ty * TILE;
        if (dy > 0) ent.y = tileY - ent.h;
        else ent.y = tileY + TILE;
      }
    }
  }

  ent.x = clamp(ent.x, TILE, WORLD_W - TILE - ent.w);
  ent.y = clamp(ent.y, TILE, WORLD_H - TILE - ent.h);
}

// ---- Rendering -------------------------------------------------------------
const PAL = Object.freeze({
  void: "#070a10",
  navy: "#0b1424",
  steel0: "#152235",
  steel1: "#1d2d44",
  steel2: "#2a4160",
  steel3: "#355275",
  grout: "#101827",
  red: "#ff3a2e",
  amber: "#ffb000",
  ember: "#ff6a2a",
  steam: "#c8d5e6",
});

function drawTile(g, t, sx, sy, ttx, tty, time, glow) {
  // ttx/tty are tile coordinates (for tiny pattern variation)
  if (t === Tile.Floor || t === Tile.Grate) {
    g.fillStyle = t === Tile.Grate ? PAL.steel0 : PAL.steel1;
    g.fillRect(sx, sy, TILE, TILE);
    g.fillStyle = PAL.grout;
    g.fillRect(sx, sy + TILE - 2, TILE, 2);
    if (t === Tile.Grate) {
      g.fillStyle = PAL.steel2;
      for (let x = 2; x < TILE; x += 5) g.fillRect(sx + x, sy + 3, 1, TILE - 6);
      g.fillStyle = PAL.steel1;
      g.fillRect(sx + 2, sy + 3, TILE - 4, 1);
      g.fillRect(sx + 2, sy + TILE - 4, TILE - 4, 1);
    }
    if ((ttx + tty) % 7 === 0) {
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(sx + 2, sy + 2, 1, 1);
    }
    return;
  }

  if (t === Tile.Wall) {
    g.fillStyle = PAL.navy;
    g.fillRect(sx, sy, TILE, TILE);
    g.fillStyle = PAL.steel2;
    g.fillRect(sx, sy, TILE, 3);
    g.fillStyle = PAL.steel1;
    g.fillRect(sx, sy + 3, TILE, TILE - 3);
    g.fillStyle = "rgba(255,255,255,0.05)";
    if ((ttx * 13 + tty * 7) % 11 === 0) g.fillRect(sx + 3, sy + 6, 1, 3);
    return;
  }

  if (t === Tile.Pipe) {
    g.fillStyle = PAL.steel1;
    g.fillRect(sx, sy, TILE, TILE);
    g.fillStyle = PAL.steel3;
    g.fillRect(sx + 3, sy + 6, TILE - 6, 4);
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(sx + 4, sy + 7, TILE - 8, 1);
    if ((ttx + tty) % 5 === 0) {
      const p = 0.4 + 0.6 * glow;
      g.fillStyle = `rgba(255,58,46,${0.08 * p})`;
      g.fillRect(sx + 3, sy + 5, TILE - 6, 6);
    }
    return;
  }

  if (t === Tile.Panel) {
    g.fillStyle = PAL.steel0;
    g.fillRect(sx, sy, TILE, TILE);
    g.fillStyle = PAL.steel2;
    g.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
    const pulse = consoleArmed ? 0.35 + 0.65 * glow : 0.12;
    g.fillStyle = `rgba(255,176,0,${0.12 + 0.22 * pulse})`;
    if ((ttx + tty) % 2 === 0) g.fillRect(sx + 4, sy + 5, 2, 2);
    if ((ttx + tty) % 3 === 0) g.fillRect(sx + 9, sy + 8, 2, 2);
    g.fillStyle = `rgba(255,58,46,${0.08 + 0.16 * glow})`;
    if ((ttx + tty) % 4 === 0) g.fillRect(sx + 6, sy + 10, 3, 1);
    return;
  }

  if (t === Tile.Vent) {
    g.fillStyle = PAL.steel1;
    g.fillRect(sx, sy, TILE, TILE);
    g.fillStyle = PAL.steel2;
    g.fillRect(sx + 3, sy + 3, TILE - 6, TILE - 6);
    g.fillStyle = "rgba(0,0,0,0.35)";
    for (let x = 4; x < TILE - 4; x += 2) g.fillRect(sx + x, sy + 5, 1, TILE - 10);
    const p = steamEnabled ? 0.2 + 0.8 * glow : 0.1;
    g.fillStyle = `rgba(255,58,46,${0.08 * p})`;
    g.fillRect(sx + 3, sy + 3, TILE - 6, 1);
    return;
  }

  if (t === Tile.Gate) {
    g.fillStyle = PAL.steel0;
    g.fillRect(sx, sy, TILE, TILE);
    g.fillStyle = PAL.steel2;
    g.fillRect(sx + 4, sy + 2, TILE - 8, TILE - 4);
    g.fillStyle = "rgba(0,0,0,0.4)";
    g.fillRect(sx + 7, sy + 3, 2, TILE - 6);
    const warn = 0.2 + 0.8 * glow;
    g.fillStyle = `rgba(255,58,46,${0.12 * warn})`;
    g.fillRect(sx + 4, sy + 2, TILE - 8, 2);
    return;
  }

  if (t === Tile.Tank) {
    g.fillStyle = PAL.steel1;
    g.fillRect(sx, sy, TILE, TILE);
    g.fillStyle = PAL.steel2;
    g.fillRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(sx + 3, sy + 3, 1, TILE - 6);
    g.fillRect(sx + 6, sy + 3, 1, TILE - 6);
    const hot = 0.2 + 0.8 * glow;
    g.fillStyle = `rgba(255,106,42,${0.06 + 0.18 * hot})`;
    if ((ttx + tty) % 6 === 0) g.fillRect(sx + 9, sy + 10, 4, 2);
    return;
  }
}

function drawProps(g, camX, camY, glow, time) {
  // Torches (Zelda-ish warm points of light)
  for (const t of torches) {
    const sx = Math.floor(t.x - camX);
    const sy = Math.floor(t.y - camY);
    if (sx < -20 || sy < -20 || sx > INTERNAL_W + 20 || sy > INTERNAL_H + 20) continue;

    // Wall mount
    g.fillStyle = PAL.steel2;
    g.fillRect(sx + 4, sy + 9, 4, 2);
    g.fillStyle = PAL.steel3;
    g.fillRect(sx + 5, sy + 10, 2, 6);

    // Flame
    if (t.lit) {
      const flick = 0.65 + 0.35 * Math.sin(time * 9 + t.x * 0.03);
      const a = 0.55 + 0.35 * glow;
      g.fillStyle = `rgba(255,106,42,${0.6 * a})`;
      g.fillRect(sx + 5, sy + 6, 2, 3);
      g.fillStyle = `rgba(255,176,0,${(0.35 + 0.35 * flick) * a})`;
      g.fillRect(sx + 6, sy + 7, 1, 2);
      g.fillStyle = `rgba(255,58,46,${0.22 * a})`;
      g.fillRect(sx + 5, sy + 8, 1, 1);
    } else {
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(sx + 5, sy + 6, 2, 3);
    }
  }

  // Valve (steam + gate)
  {
    const sx = Math.floor(valve.x - camX);
    const sy = Math.floor(valve.y - camY);
    if (sx > -20 && sy > -20 && sx < INTERNAL_W + 20 && sy < INTERNAL_H + 20) {
      g.fillStyle = PAL.steel0;
      g.fillRect(sx, sy, 14, 14);
      g.fillStyle = PAL.steel2;
      g.fillRect(sx + 1, sy + 1, 12, 12);
      g.fillStyle = steamEnabled ? PAL.ember : PAL.red;
      g.fillRect(sx + 6, sy + 3, 2, 8);
      g.fillRect(sx + 3, sy + 6, 8, 2);
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(sx + 2, sy + 12, 10, 2);
    }
  }

  // Console panel
  {
    const sx = Math.floor(consolePanel.x - camX);
    const sy = Math.floor(consolePanel.y - camY);
    if (sx > -40 && sy > -40 && sx < INTERNAL_W + 40 && sy < INTERNAL_H + 40) {
      g.fillStyle = PAL.steel0;
      g.fillRect(sx, sy + 2, 32, 16);
      g.fillStyle = PAL.steel2;
      g.fillRect(sx + 1, sy + 3, 30, 14);
      const pulse = consoleArmed ? 0.25 + 0.75 * glow : 0.12;
      g.fillStyle = `rgba(255,176,0,${0.10 + 0.30 * pulse})`;
      g.fillRect(sx + 4, sy + 6, 3, 2);
      g.fillRect(sx + 10, sy + 6, 3, 2);
      g.fillRect(sx + 16, sy + 6, 3, 2);
      g.fillStyle = `rgba(255,58,46,${0.06 + 0.20 * glow})`;
      g.fillRect(sx + 24, sy + 12, 5, 2);
    }
  }

  // Light switch + alarm panel
  for (const it of [lightSwitch, alarmPanel]) {
    const sx = Math.floor(it.x - camX);
    const sy = Math.floor(it.y - camY);
    if (sx < -20 || sy < -20 || sx > INTERNAL_W + 20 || sy > INTERNAL_H + 20) continue;
    g.fillStyle = PAL.steel0;
    g.fillRect(sx, sy, 14, 14);
    g.fillStyle = PAL.steel2;
    g.fillRect(sx + 1, sy + 1, 12, 12);
    if (it.id === "lights") {
      g.fillStyle = overheadLights ? PAL.amber : "rgba(0,0,0,0.3)";
      g.fillRect(sx + 6, sy + 4, 2, 6);
      g.fillRect(sx + 5, sy + (overheadLights ? 4 : 9), 4, 2);
    } else {
      const a = alarmEnabled ? 0.18 + 0.25 * glow : 0.08;
      g.fillStyle = `rgba(255,58,46,${a})`;
      g.fillRect(sx + 4, sy + 4, 6, 6);
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(sx + 2, sy + 12, 10, 2);
    }
  }
}

function drawPlayer(g, sx, sy, dir, frame, glow) {
  // 16x18 sprite-ish, high-contrast for readability (Zelda-ish top-down silhouette)
  const ox = Math.floor(sx);
  const oy = Math.floor(sy);

  const walk = frame % 2;
  const step = walk ? 1 : 0;

  const outline = "#070a10";
  const armor0 = "#0f1a2d";
  const armor1 = "#22395a";
  const armorHi = "#5c87b7";
  const cape0 = "#2a0f14";
  const cape1 = "#8a2324";

  // Shadow
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.fillRect(ox + 3, oy + 16, 10, 2);

  // Tiny aura (helps player pop on dark tiles)
  const aura = clamp(0.08 + glow * 0.18, 0, 0.22);
  g.fillStyle = `rgba(255,176,0,${aura})`;
  g.fillRect(ox + 6, oy + 2, 4, 1);

  // Outline silhouette
  g.fillStyle = outline;
  g.fillRect(ox + 5, oy + 2, 6, 10); // torso+helmet block
  g.fillRect(ox + 4, oy + 3, 8, 8);
  g.fillRect(ox + 5, oy + 12, 6, 4); // legs
  g.fillRect(ox + 3, oy + 6, 2, 5 + step); // left arm outline
  g.fillRect(ox + 11, oy + 6, 2, 5 + (1 - step)); // right arm outline

  // Cape (behind)
  g.fillStyle = cape0;
  g.fillRect(ox + 4, oy + 7, 8, 7);
  g.fillStyle = cape1;
  g.fillRect(ox + (dir === "left" ? 3 : 11), oy + 8, 2, 4 + step);

  // Armor fill
  g.fillStyle = armor0;
  g.fillRect(ox + 5, oy + 4, 6, 10);
  g.fillStyle = armor1;
  g.fillRect(ox + 6, oy + 5, 4, 7);
  g.fillStyle = armorHi;
  g.fillRect(ox + 6, oy + 6, 1, 5);

  // Helmet
  g.fillStyle = armor1;
  g.fillRect(ox + 5, oy + 2, 6, 3);
  g.fillStyle = armorHi;
  g.fillRect(ox + 6, oy + 3, 2, 1);

  // Visor
  g.fillStyle = `rgba(255,176,0,${0.18 + 0.32 * glow})`;
  g.fillRect(ox + 7, oy + 4, 2, 1);

  // Boots
  g.fillStyle = outline;
  g.fillRect(ox + 6, oy + 14 + step, 2, 2);
  g.fillRect(ox + 9, oy + 14 + (1 - step), 2, 2);

  // Weapon (shovel-sword vibe, compact)
  g.fillStyle = "#2a4160";
  if (dir === "up") {
    g.fillRect(ox + 8, oy + 0, 1, 4);
    g.fillRect(ox + 7, oy + 0, 3, 1);
  } else if (dir === "down") {
    g.fillRect(ox + 8, oy + 12, 1, 5);
    g.fillRect(ox + 7, oy + 16, 3, 1);
  } else if (dir === "left") {
    g.fillRect(ox + 1, oy + 9, 5, 1);
    g.fillRect(ox + 1, oy + 8, 1, 3);
  } else {
    g.fillRect(ox + 10, oy + 9, 5, 1);
    g.fillRect(ox + 14, oy + 8, 1, 3);
  }
}

function drawLighting(g, glow, time) {
  g.save();
  g.globalCompositeOperation = "lighter";

  // Overhead lamps (cool light) for readability.
  if (overheadLights) {
    const cool = 0.35 + 0.65 * (0.2 + 0.8 * glow);
    drawGlow(g, 20 * TILE, 14 * TILE, 110, `rgba(190,220,255,${0.02 + 0.08 * cool})`);
    drawGlow(g, 66 * TILE, 16 * TILE, 150, `rgba(190,220,255,${0.02 + 0.08 * cool})`);
    drawGlow(g, 26 * TILE, 44 * TILE, 140, `rgba(190,220,255,${0.02 + 0.07 * cool})`);
    drawGlow(g, 70 * TILE, 46 * TILE, 160, `rgba(190,220,255,${0.02 + 0.07 * cool})`);
  }

  // Torches (warm pools of light, Zelda-ish)
  for (const t of torches) {
    if (!t.lit) continue;
    const flick = 0.65 + 0.35 * Math.sin(time * 9 + t.x * 0.03);
    const hot = 0.25 + 0.75 * glow;
    const cx = t.x + 6;
    const cy = t.y + 8;
    drawGlow(g, cx, cy, 78, `rgba(255,106,42,${0.03 + 0.10 * flick * hot})`);
    drawGlow(g, cx, cy, 44, `rgba(255,176,0,${0.02 + 0.08 * flick * hot})`);
  }

  // Furnace glow (left wing)
  const furnacePulse = 0.35 + 0.65 * glow;
  drawGlow(g, 20 * TILE, 38 * TILE, 90, `rgba(255,106,42,${0.05 + 0.16 * furnacePulse})`);
  drawGlow(g, 20 * TILE, 38 * TILE, 52, `rgba(255,176,0,${0.03 + 0.12 * furnacePulse})`);

  // Tank glow (right hall)
  const tankPulse = 0.2 + 0.8 * glow;
  drawGlow(g, 68 * TILE, 43 * TILE, 120, `rgba(255,58,46,${0.02 + 0.12 * tankPulse})`);
  drawGlow(g, 68 * TILE, 43 * TILE, 70, `rgba(255,176,0,${0.02 + 0.06 * tankPulse})`);

  // Warning lights (occasional; alarm makes them punchier)
  const warn = alarmEnabled
    ? 0.35 + 0.65 * glow
    : consoleArmed
      ? 0.25 + 0.75 * glow
      : 0.12 + 0.08 * Math.sin(time * 2.0);
  drawGlow(g, 30 * TILE, 10 * TILE, 48, `rgba(255,58,46,${0.02 + 0.12 * warn})`);
  drawGlow(g, 86 * TILE, 34 * TILE, 48, `rgba(255,58,46,${0.02 + 0.10 * warn})`);
  if (alarmEnabled) drawGlow(g, 60 * TILE, 26 * TILE, 60, `rgba(255,58,46,${0.01 + 0.10 * warn})`);

  g.restore();
}

function drawGlow(g, wx, wy, r, color) {
  // wx/wy in world coords; caller must transform camera.
  const grd = g.createRadialGradient(wx, wy, 2, wx, wy, r);
  grd.addColorStop(0, color);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(wx - r, wy - r, r * 2, r * 2);
}

// ---- Main loop -------------------------------------------------------------
let lastT = performance.now();
let time = 0;
let beatPulse = 0;

function updateAudio(dt, nowMs) {
  beat = 0;
  if (!audioCtx || !analyser || !freqData || !audioReady) {
    bass = 0;
    bassSmooth = lerp(bassSmooth, 0, 0.08);
    amp = lerp(amp, 0, 0.08);
    return;
  }

  analyser.getByteFrequencyData(freqData);

  amp = computeRms(freqData);
  bass = computeBandAvg(freqData, audioCtx.sampleRate, 20, 150);
  bassSmooth = lerp(bassSmooth, bass, 0.12);
  bassAvg = lerp(bassAvg, bassSmooth, 0.02);

  const threshold = 1.35;
  const cooldownMs = 170;
  const strongEnough = bassSmooth > 0.12;
  if (strongEnough && bassSmooth > bassAvg * threshold && nowMs - lastBeatAt > cooldownMs) {
    beat = 1;
    lastBeatAt = nowMs;
  }

  if (beat) beatPulse = 1;
  beatPulse = Math.max(0, beatPulse - dt * 2.8);
}

function update(dt, nowMs) {
  time += dt;

  updateAudio(dt, nowMs);

  // Camera punch/shake on bass.
  const targetShake = beat ? 2.0 + bassSmooth * 5.0 : bassSmooth * 1.4;
  camera.shake = lerp(camera.shake, targetShake, 0.25);
  camera.shake *= 0.92;

  // Player movement
  let mx = 0;
  let my = 0;
  if (isDown("KeyW")) my -= 1;
  if (isDown("KeyS")) my += 1;
  if (isDown("KeyA")) mx -= 1;
  if (isDown("KeyD")) mx += 1;

  const mag = Math.hypot(mx, my) || 1;
  mx /= mag;
  my /= mag;

  const speed = 78;
  const dx = mx * speed * dt;
  const dy = my * speed * dt;
  if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
    if (Math.abs(mx) > Math.abs(my)) player.dir = mx < 0 ? "left" : "right";
    else player.dir = my < 0 ? "up" : "down";
    player.animTime += dt;
    if (player.animTime > 0.12) {
      player.animTime = 0;
      player.animFrame = (player.animFrame + 1) % 2;
    }
  } else {
    player.animTime = 0;
    player.animFrame = 0;
  }

  moveAndCollide(player, dx, 0);
  moveAndCollide(player, 0, dy);

  // Interactions
  let nearest = null;
  let nearestD = Infinity;
  const pc = playerCenter();
  for (const it of interactables) {
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    const d = dist2(pc.x, pc.y, cx, cy);
    if (d < 28 * 28 && d < nearestD) {
      nearest = it;
      nearestD = d;
    }
  }

  const eFired = consumeE();
  setPrompt(nearest ? nearest.label : "");
  if (nearest && eFired) nearest.onInteract();

  // Dust motion (beat nudges + glow)
  const gust = (beat ? 1 : 0) * (0.4 + bassSmooth * 0.9);
  for (const p of dust) {
    p.vx += (Math.random() * 2 - 1) * 4 * gust;
    p.vy += -(10 * gust);
    p.vx = clamp(p.vx, -22, 22);
    p.vy = clamp(p.vy, -46, -4);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.x < 0) p.x += WORLD_W;
    if (p.x >= WORLD_W) p.x -= WORLD_W;
    if (p.y < 0) p.y += WORLD_H;
    if (p.y >= WORLD_H) p.y -= WORLD_H;
    p.s = 1 + bassSmooth * 0.5;
  }

  // Steam puffs from vents
  const ventPuffChance = steamEnabled ? 0.03 + bassSmooth * 0.12 : 0.01 + bassSmooth * 0.06;
  if (beat || Math.random() < ventPuffChance) {
    const strength = clamp(bassSmooth * 1.2 + (beat ? 0.35 : 0), 0, 1);
    const vents = [
      { tx: 52, ty: 36 },
      { tx: 78, ty: 34 },
      { tx: 24, ty: 44 },
      { tx: 12, ty: 48 },
    ];
    const v = vents[(Math.random() * vents.length) | 0];
    puffSteam((v.tx + 0.5) * TILE, (v.ty + 0.5) * TILE, strength);
  }

  for (let i = steam.length - 1; i >= 0; i--) {
    const s = steam[i];
    s.t += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vx *= 0.93;
    s.vy *= 0.94;
    s.vy -= 10 * dt;
    if (s.t > s.life) steam.splice(i, 1);
  }

  // Camera follows player
  const c = playerCenter();
  camera.x = clamp(c.x - INTERNAL_W / 2, 0, WORLD_W - INTERNAL_W);
  camera.y = clamp(c.y - INTERNAL_H / 2, 0, WORLD_H - INTERNAL_H);
}

function render() {
  // Base scene
  sceneCtx.fillStyle = PAL.void;
  sceneCtx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);

  // Camera shake as pixel offsets
  const shake = Math.max(0, camera.shake);
  const shakeX = Math.round((Math.random() * 2 - 1) * shake);
  const shakeY = Math.round((Math.random() * 2 - 1) * shake);

  const camX = Math.round(camera.x) + shakeX;
  const camY = Math.round(camera.y) + shakeY;

  // Draw tiles in view
  const tx0 = Math.floor(camX / TILE);
  const ty0 = Math.floor(camY / TILE);
  const tx1 = Math.ceil((camX + INTERNAL_W) / TILE);
  const ty1 = Math.ceil((camY + INTERNAL_H) / TILE);

  const glow = clamp(0.15 + bassSmooth * 0.95 + beatPulse * 0.5, 0, 1);

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = getTile(tx, ty);
      const sx = tx * TILE - camX;
      const sy = ty * TILE - camY;
      drawTile(sceneCtx, t, sx, sy, tx, ty, time, glow);
    }
  }

  drawProps(sceneCtx, camX, camY, glow, time);

  // Dust particles (red speckles)
  for (const p of dust) {
    const sx = Math.floor(p.x - camX);
    const sy = Math.floor(p.y - camY);
    if (sx < -2 || sy < -2 || sx > INTERNAL_W + 2 || sy > INTERNAL_H + 2) continue;
    const a = clamp(p.a + bassSmooth * 0.15 + beatPulse * 0.12, 0, 0.95);
    sceneCtx.fillStyle = `rgba(255,58,46,${a})`;
    sceneCtx.fillRect(sx, sy, 1, 1);
    if (p.s > 1.25 && Math.random() < 0.12) sceneCtx.fillRect(sx + 1, sy, 1, 1);
  }

  // Steam particles
  for (const s of steam) {
    const sx = Math.floor(s.x - camX);
    const sy = Math.floor(s.y - camY);
    if (sx < -8 || sy < -8 || sx > INTERNAL_W + 8 || sy > INTERNAL_H + 8) continue;
    const k = 1 - s.t / s.life;
    const a = 0.07 + 0.22 * k;
    sceneCtx.fillStyle = `rgba(200,213,230,${a})`;
    sceneCtx.fillRect(sx, sy, 2, 2);
    if (k > 0.6) sceneCtx.fillRect(sx + 2, sy + 1, 1, 1);
  }

  // Interactables hint sparkle
  const pc = playerCenter();
  for (const it of interactables) {
    const sx = Math.floor(it.x - camX);
    const sy = Math.floor(it.y - camY);
    if (!rectsOverlap(sx, sy, it.w, it.h, 0, 0, INTERNAL_W, INTERNAL_H)) continue;
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    const near = dist2(pc.x, pc.y, cx, cy) < 28 * 28;
    const a = near ? 0.35 + 0.35 * glow : 0.15;
    sceneCtx.fillStyle = `rgba(255,176,0,${a})`;
    sceneCtx.fillRect(sx + 2, sy - 2, 2, 2);
    sceneCtx.fillStyle = `rgba(255,58,46,${0.15 + 0.25 * glow})`;
    sceneCtx.fillRect(sx + it.w - 3, sy - 1, 1, 1);
  }

  // Player (centered by camera)
  drawPlayer(sceneCtx, player.x - camX - 2, player.y - camY - 6, player.dir, player.animFrame, glow);

  // Lighting overlays (world-space)
  sceneCtx.save();
  sceneCtx.translate(-camX, -camY);
  drawLighting(sceneCtx, glow, time);
  sceneCtx.restore();

  // Mild global lift so the scene reads better (still dark overall).
  const ambient = overheadLights ? 0.06 : 0.03;
  const lift = clamp(ambient + bassSmooth * 0.02 + beatPulse * 0.02, 0, 0.12);
  sceneCtx.save();
  sceneCtx.globalCompositeOperation = "lighter";
  sceneCtx.fillStyle = `rgba(70,110,160,${lift})`;
  sceneCtx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
  sceneCtx.restore();

  // Alarm wash (subtle red tint, especially on beats).
  if (alarmEnabled) {
    const flash = clamp(0.015 + 0.045 * beatPulse + 0.02 * glow, 0, 0.09);
    sceneCtx.save();
    sceneCtx.globalCompositeOperation = "lighter";
    sceneCtx.fillStyle = `rgba(255,58,46,${flash})`;
    sceneCtx.fillRect(0, 0, INTERNAL_W, INTERNAL_H);
    sceneCtx.restore();
  }

  // ---- Heat warp (scanline offsets) ---------------------------------------
  warpCtx.clearRect(0, 0, INTERNAL_W, INTERNAL_H);
  const warpStrength = clamp(bassSmooth * 3.0 + beatPulse * 2.2, 0, 6);
  const phase = time * (1.6 + bassSmooth * 1.6);
  const band = 3;
  for (let y = 0; y < INTERNAL_H; y += band) {
    const wobble = Math.sin(y * 0.075 + phase) + 0.6 * Math.sin(y * 0.13 - phase * 1.2);
    const dx = Math.round(wobble * warpStrength);
    warpCtx.drawImage(sceneCanvas, 0, y, INTERNAL_W, band, dx, y, INTERNAL_W, band);
  }

  // ---- Punch zoom (crop + scale internally to keep crisp pixel upscale) ----
  const punch = clamp(0.55 * bassSmooth + 0.55 * beatPulse, 0, 1);
  const zoom = 1 + punch * 0.03; // tiny camera punch
  const sw = INTERNAL_W / zoom;
  const sh = INTERNAL_H / zoom;
  const sx = (INTERNAL_W - sw) / 2;
  const sy = (INTERNAL_H - sh) / 2;
  punchCtx.clearRect(0, 0, INTERNAL_W, INTERNAL_H);
  punchCtx.drawImage(warpCanvas, sx, sy, sw, sh, 0, 0, INTERNAL_W, INTERNAL_H);

  // Present
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(punchCanvas, 0, 0, INTERNAL_W, INTERNAL_H, presentX, presentY, INTERNAL_W * fitScale, INTERNAL_H * fitScale);

  if (debugToggle.checked) {
    debugEl.hidden = false;
    debugEl.textContent =
      `amp ${(amp).toFixed(3)}\n` +
      `bass ${(bass).toFixed(3)}\n` +
      `bassSmooth ${(bassSmooth).toFixed(3)}\n` +
      `bassAvg ${(bassAvg).toFixed(3)}\n` +
      `beat ${beat}\n` +
      `steam ${steamEnabled ? "on" : "off"}\n` +
      `console ${consoleArmed ? "armed" : "off"}\n` +
      `gate ${gateOpen ? "open" : "closed"}`;
  } else {  
    debugEl.hidden = true;
  }
} 

// modifica tion s
  
function frame(now) { 
  const dt = clamp((now - lastT) / 1000, 0, 0.05);
  lastT = now;

  update(dt, now);
  render();
  requestAnimationFrame(frame);
}

setStatus("Ready. Click Play to start the beat-reactive boiler room.");
requestAnimationFrame(frame);

// ANDES RESCUE — Platanus Hack 26
// Pseudo-3D isometric rescue game. Everything (terrain, trees, houses, helicopter,
// people, fire) is computed at runtime: no images, no models.

const SW = 800;
const SH = 600;

// DO NOT replace existing keys — they match the physical arcade cabinet wiring.
// To add local testing shortcuts, append extra keys to any array.
const CABINET_KEYS = {
  P1_U: ['w'],
  P1_D: ['s'],
  P1_L: ['a'],
  P1_R: ['d'],
  P1_1: ['u'],
  P1_2: ['i'],
  P1_3: ['o'],
  P1_4: ['j'],
  P1_5: ['k'],
  P1_6: ['l'],
  P2_U: ['ArrowUp'],
  P2_D: ['ArrowDown'],
  P2_L: ['ArrowLeft'],
  P2_R: ['ArrowRight'],
  P2_1: ['r'],
  P2_2: ['t'],
  P2_3: ['y'],
  P2_4: ['f'],
  P2_5: ['g'],
  P2_6: ['h'],
  START1: ['Enter'],
  START2: ['2'],
};

const KEY_TO_ARCADE = {};
for (const [code, keys] of Object.entries(CABINET_KEYS)) {
  for (const key of keys) {
    KEY_TO_ARCADE[key.length === 1 ? key.toLowerCase() : key] = code;
  }
}

const held = Object.create(null);
window.addEventListener('keydown', (e) => {
  const code = KEY_TO_ARCADE[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (code) held[code] = true;
  if (AC && AC.state !== 'running') AC.resume();
});
window.addEventListener('keyup', (e) => {
  const code = KEY_TO_ARCADE[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (code) held[code] = false;
});

function getStorage() {
  if (window.platanusArcadeStorage) return window.platanusArcadeStorage;
  return {
    async get(key) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? { found: false, value: null } : { found: true, value: JSON.parse(raw) };
      } catch (e) {
        return { found: false, value: null };
      }
    },
    async set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {}
    },
  };
}
const TOP_KEY = 'andes-rescue:top';
const DIS = ['TERREMOTO', 'INCENDIO FORESTAL', 'TSUNAMI', 'ALUVIÓN'];
const TIP = ['Sismos: casas que colapsan, rocas que caen e incendios', 'El fuego avanza con el viento', 'Las olas suben cada vez más alto: ¡apúrate!', 'Lluvia intensa: el barro baja por las quebradas'];

// ---------------------------------------------------------------- world constants
const N = 36; // map size in tiles
const HW = 24; // half tile width (px)
const HH = 12; // half tile height (px)
const ZS = 26; // px per height unit
const OX = N * HW;
const OY = 150;
const WW = N * HW * 2;
const WH = OY + N * HH * 2 + 60;
const CAP = 6;
const HANG = 4;
const SLOTS = [[0.2, 0.2], [-0.22, 0.2], [0.2, -0.2], [-0.22, -0.2]];
const CRUISE = 1.9;

const T_WATER = 0, T_SAND = 1, T_GRASS = 2, T_FOREST = 3, T_ROCK = 4, T_SNOW = 5, T_PAD = 6;
const FUEL = [0, 0, 0.7, 1, 0.15, 0, 0];

// ---------------------------------------------------------------- math helpers
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const VIEW = nrm([1, 1, (2 * HH) / ZS]);
const LIGHT = nrm([-0.35, 0.65, 1]);

// isometric projection: world (x, y, z) -> screen px
const P = (x, y, z) => ({ x: OX + (x - y) * HW, y: OY + (x + y) * HH - z * ZS });

function shade(c, k) {
  const r = Math.min(255, ((c >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((c >> 8) & 255) * k) | 0;
  const b = Math.min(255, (c & 255) * k) | 0;
  return (r << 16) | (g << 8) | b;
}
function mix(a, b, t) {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return ((r | 0) << 16) | ((g | 0) << 8) | (bl | 0);
}
const lit = (c, n) => shade(c, 0.52 + 0.6 * Math.max(0, dot(n, LIGHT)));

// value noise
let SEED = 1;
function hash(i, j) {
  const s = Math.sin(i * 127.1 + j * 311.7 + SEED * 17.31) * 43758.5453;
  return s - Math.floor(s);
}
function vn(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => vn(x, y) * 0.5 + vn(x * 2, y * 2) * 0.25 + vn(x * 4, y * 4) * 0.15 + vn(x * 8, y * 8) * 0.1;

// ---------------------------------------------------------------- tiny 3D mesh engine
// A face is { p: [[x,y,z]...], c: color, o: [x,y,z] (center of its convex part) }.
function prism(F, cx, cy, z0, z1, r, ts, n, c, rot) {
  const o = [cx, cy, (z0 + z1) / 2], B = [], T = [];
  for (let i = 0; i < n; i++) {
    const a = (rot || 0) + (i * Math.PI * 2) / n, ca = Math.cos(a), sa = Math.sin(a);
    B.push([cx + r * ca, cy + r * sa, z0]);
    T.push([cx + r * ts * ca, cy + r * ts * sa, z1]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    F.push({ p: ts ? [B[i], B[j], T[j], T[i]] : [B[i], B[j], T[i]], c, o });
  }
  if (ts) F.push({ p: T, c: shade(c, 1.08), o });
}

function box(F, cx, cy, cz, sx, sy, sz, c) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2, o = [cx, cy, cz];
  const v = (a, b, d) => [a ? x1 : x0, b ? y1 : y0, d ? z1 : z0];
  F.push({ p: [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)], c, o });
  F.push({ p: [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)], c, o });
  F.push({ p: [v(0, 1, 0), v(1, 1, 0), v(1, 1, 1), v(0, 1, 1)], c, o });
  F.push({ p: [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)], c, o });
  F.push({ p: [v(0, 0, 0), v(0, 1, 0), v(0, 1, 1), v(0, 0, 1)], c, o });
}

// Project, back-face cull, flat-shade and painter-sort a list of faces.
function drawFaces(g, F, tf, dx, dy, stroke) {
  const L = [];
  for (const f of F) {
    const p = tf ? f.p.map(tf) : f.p;
    const o = tf ? tf(f.o) : f.o;
    let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    const m = [0, 0, 0];
    for (const v of p) {
      m[0] += v[0];
      m[1] += v[1];
      m[2] += v[2];
    }
    m[0] /= p.length;
    m[1] /= p.length;
    m[2] /= p.length;
    if (dot(n, sub(m, o)) < 0) n = [-n[0], -n[1], -n[2]];
    n = nrm(n);
    if (dot(n, VIEW) < 0.01) continue;
    L.push([dot(m, VIEW), p, lit(f.c, n)]);
  }
  L.sort((a, b) => a[0] - b[0]);
  for (const f of L) {
    const pts = f[1].map((v) => {
      const q = P(v[0], v[1], v[2]);
      q.x += dx;
      q.y += dy;
      return q;
    });
    g.fillStyle(f[2], 1);
    g.fillPoints(pts, true);
    if (stroke) {
      g.lineStyle(1, f[2], 1);
      g.strokePoints(pts, true);
    }
  }
}

function bake(key, F, w, h, bx, by) {
  const g = S.make.graphics({}, false);
  drawFaces(g, F, null, bx - OX, by - OY, true);
  g.generateTexture(key, w, h);
  g.destroy();
}

// ---------------------------------------------------------------- asset generation
const GREENS = [0x2f6b2a, 0x3b7a30, 0x4a8a37, 0x5a963b];

function makeTextures() {
  // soft particle
  const g = S.make.graphics({}, false);
  for (let r = 16; r > 0; r--) {
    g.fillStyle(0xffffff, 0.07 + (16 - r) * 0.012);
    g.fillCircle(16, 16, r);
  }
  g.generateTexture('dot', 32, 32);
  g.destroy();

  // trees: 0-3 pines, 4-7 broadleaf
  for (let k = 0; k < 8; k++) {
    const F = [], c = GREENS[k % 4];
    if (k < 4) {
      prism(F, 0, 0, 0, 0.3, 0.06, 1, 5, 0x6b4a2b);
      prism(F, 0, 0, 0.16, 0.74, 0.34, 0, 7, c, 0.2);
      prism(F, 0, 0, 0.5, 1.12, 0.25, 0, 7, shade(c, 1.12), 0.5);
    } else {
      prism(F, 0, 0, 0, 0.34, 0.06, 1, 5, 0x6b4a2b);
      prism(F, 0, 0, 0.24, 0.42, 0.24, 1.4, 7, c, 0.3);
      prism(F, 0, 0, 0.42, 0.66, 0.336, 1, 7, shade(c, 1.05), 0.3);
      prism(F, 0, 0, 0.66, 0.86, 0.336, 0.5, 7, shade(c, 1.12), 0.3);
    }
    bake('t' + k, F, 44, 64, 22, 56);
  }
  let F = [];
  prism(F, 0, 0, 0, 0.42, 0.05, 0.6, 5, 0x241d18);
  prism(F, 0, 0, 0.3, 0.6, 0.14, 0, 5, 0x37302b);
  bake('tb0', F, 44, 64, 22, 56);
  F = [];
  prism(F, 0, 0, 0, 0.38, 0.05, 0.7, 5, 0x241d18);
  box(F, 0.06, 0, 0.36, 0.2, 0.03, 0.03, 0x2b2420);
  bake('tb1', F, 44, 64, 22, 56);

  // houses
  const WALLS = [0xf2ead8, 0xe8c9a0, 0xc9dbe6];
  const ROOFS = [0xb5452f, 0x5a4a6b, 0x2f6f8f];
  for (let k = 0; k < 3; k++) {
    F = [];
    house(F, WALLS[k], ROOFS[k]);
    bake('h' + k, F, 52, 52, 26, 42);
  }
  F = [];
  box(F, 0, 0, 0.08, 0.56, 0.44, 0.16, 0x3a3330);
  box(F, 0.1, 0.05, 0.22, 0.05, 0.05, 0.16, 0x231d19);
  box(F, -0.15, -0.1, 0.2, 0.3, 0.05, 0.04, 0x2b2420);
  bake('hb', F, 52, 52, 26, 42);
  F = [];
  prism(F, 0, 0, 0, 0.16, 0.2, 1.15, 6, 0x7d746a, 0.4);
  prism(F, 0, 0, 0.16, 0.36, 0.23, 0.45, 6, 0x958c7f, 0.4);
  bake('rock', F, 40, 40, 20, 30);
  F = [];
  const te = (sx, sy) => [sx * 0.42, sy * 0.36, 0], tr = (sx) => [sx * 0.42, 0, 0.46], to = [0, 0, 0.15], TW = 0xf4f1e8;
  F.push({ p: [te(-1, -1), te(1, -1), tr(1), tr(-1)], c: TW, o: to });
  F.push({ p: [te(-1, 1), te(1, 1), tr(1), tr(-1)], c: TW, o: to });
  F.push({ p: [te(1, -1), te(1, 1), tr(1)], c: TW, o: to });
  F.push({ p: [te(-1, -1), te(-1, 1), tr(-1)], c: TW, o: to });
  F.push({ p: [[0.425, -0.13, 0], [0.425, 0.13, 0], [0.425, 0, 0.3]], c: 0x3a3530, o: to });
  box(F, -0.32, -0.3, 0.4, 0.03, 0.03, 0.8, 0x8a8f96);
  box(F, -0.2, -0.3, 0.72, 0.22, 0.01, 0.14, HELI_R);
  const tg = S.make.graphics({}, false);
  drawFaces(tg, F, null, 30 - OX, 44 - OY, true);
  const cc = P(0, 0.2, 0.22);
  tg.fillStyle(HELI_R, 1);
  tg.fillRect(cc.x + 30 - OX - 1.5, cc.y + 44 - OY - 5, 3, 10);
  tg.fillRect(cc.x + 30 - OX - 5, cc.y + 44 - OY - 1.5, 10, 3);
  tg.generateTexture('tent', 60, 60);
  tg.destroy();
}

function house(F, wc, rc) {
  box(F, 0, 0, 0.16, 0.56, 0.44, 0.32, wc);
  box(F, 0.1, 0.221, 0.09, 0.11, 0.004, 0.17, 0x6a4326);
  box(F, -0.14, 0.221, 0.18, 0.1, 0.004, 0.08, 0x9fd3e8);
  box(F, 0.281, 0, 0.18, 0.004, 0.12, 0.08, 0x9fd3e8);
  const ex = 0.34, ey = 0.29, z0 = 0.3, z1 = 0.54, o = [0, 0, 0.4];
  const e = (sx, sy) => [sx * ex, sy * ey, z0], r = (sx) => [sx * ex, 0, z1];
  F.push({ p: [e(-1, -1), e(1, -1), r(1), r(-1)], c: rc, o });
  F.push({ p: [e(-1, 1), e(1, 1), r(1), r(-1)], c: rc, o });
  F.push({ p: [[0.28, -0.22, 0.32], [0.28, 0.22, 0.32], [0.28, 0, 0.52]], c: wc, o: [0, 0, 0.38] });
  F.push({ p: [[-0.28, -0.22, 0.32], [-0.28, 0.22, 0.32], [-0.28, 0, 0.52]], c: wc, o: [0, 0, 0.38] });
}

const HELI_Y = 0xffc61a, HELI_R = 0xe23b2e, HELI_D = 0x2a2f36;
function heliMesh() {
  const F = [];
  box(F, -0.04, 0, 0.36, 0.62, 0.4, 0.36, HELI_Y);
  box(F, 0.34, 0, 0.33, 0.2, 0.34, 0.27, 0x1f4e6e);
  box(F, -0.04, 0, 0.58, 0.42, 0.26, 0.08, shade(HELI_Y, 0.9));
  box(F, -0.04, 0.215, 0.27, 0.5, 0.02, 0.08, HELI_R);
  box(F, -0.04, -0.215, 0.27, 0.5, 0.02, 0.08, HELI_R);
  box(F, -0.64, 0, 0.44, 0.62, 0.09, 0.09, HELI_Y);
  box(F, -0.92, 0, 0.6, 0.14, 0.04, 0.26, HELI_R);
  box(F, -0.86, 0, 0.46, 0.12, 0.34, 0.03, HELI_R);
  for (const sy of [-0.2, 0.2]) {
    box(F, 0, sy, 0.03, 0.8, 0.04, 0.03, HELI_D);
    box(F, 0.18, sy, 0.11, 0.03, 0.03, 0.14, HELI_D);
    box(F, -0.2, sy, 0.11, 0.03, 0.03, 0.14, HELI_D);
  }
  box(F, 0, 0, 0.67, 0.05, 0.05, 0.1, HELI_D);
  return F;
}

// ---------------------------------------------------------------- audio
let AC = null;
const AU = {};
function initAudio() {
  try {
    AC = S.sound.context;
  } catch (e) {
    AC = null;
  }
  if (!AC) return;
  const sr = AC.sampleRate;
  AU.out = AC.createGain();
  AU.out.gain.value = 0.6;
  AU.out.connect(AC.destination);
  // rotor: looping filtered noise with periodic thumps
  const len = Math.floor(sr * 0.5), buf = AC.createBuffer(1, len, sr), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const ph = ((i / sr) * 14) % 1;
    d[i] = (Math.random() * 2 - 1) * (0.25 + Math.pow(1 - ph, 4));
  }
  const nb = AC.createBuffer(1, sr * 0.3, sr), nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  AU.noise = nb;
  const src = AC.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = AC.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  AU.rotor = AC.createGain();
  AU.rotor.gain.value = 0;
  src.connect(lp);
  lp.connect(AU.rotor);
  AU.rotor.connect(AU.out);
  src.start();
  AU.rsrc = src;
  const rs = AC.createBufferSource(), hp = AC.createBiquadFilter();
  rs.buffer = nb;
  rs.loop = true;
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  AU.rain = AC.createGain();
  AU.rain.gain.value = 0;
  rs.connect(hp);
  hp.connect(AU.rain);
  AU.rain.connect(AU.out);
  rs.start();
}

function blip(f1, f2, dur, type, vol, delay) {
  if (!AC) return;
  const t = AC.currentTime + (delay || 0);
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(AU.out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function crackle(vol) {
  if (!AC) return;
  const s = AC.createBufferSource(), g = AC.createGain(), f = AC.createBiquadFilter();
  s.buffer = AU.noise;
  s.playbackRate.value = rnd(0.6, 1.6);
  f.type = 'highpass';
  f.frequency.value = rnd(1200, 3500);
  const t = AC.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + rnd(0.02, 0.07));
  s.connect(f);
  f.connect(g);
  g.connect(AU.out);
  s.start(t, rnd(0.2));
  s.stop(t + 0.1);
}

function noise(dur, f, vol, att) {
  if (!AC) return;
  const s = AC.createBufferSource(), fl = AC.createBiquadFilter(), g = AC.createGain(), t = AC.currentTime;
  s.buffer = AU.noise;
  s.loop = true;
  fl.type = 'lowpass';
  fl.frequency.value = f;
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(vol, t + att);
  g.gain.linearRampToValueAtTime(0.001, t + dur);
  s.connect(fl);
  fl.connect(g);
  g.connect(AU.out);
  s.start(t);
  s.stop(t + dur + 0.05);
}

const SND = {
  board: () => blip(620, 980, 0.09, 'square', 0.07),
  unload: () => {
    blip(880, 1320, 0.1, 'triangle', 0.16);
    blip(1320, 1760, 0.12, 'triangle', 0.12, 0.08);
  },
  dead: () => blip(320, 70, 0.5, 'sawtooth', 0.06),
  land: () => blip(180, 90, 0.18, 'sine', 0.25),
  deny: () => blip(160, 150, 0.15, 'square', 0.06),
  rumble: (d) => noise(d, 90, 0.6, 0.3),
  wave: () => noise(3.2, 650, 0.3, 1.4),
  hang: () => blip(400, 700, 0.12, 'square', 0.07),
  fall: () => blip(900, 200, 0.6, 'square', 0.07),
  level: () => [523, 659, 784, 1047].forEach((f, i) => blip(f, f * 1.01, 0.18, 'triangle', 0.14, i * 0.12)),
  over: () => [392, 330, 262, 196].forEach((f, i) => blip(f, f * 0.98, 0.3, 'triangle', 0.14, i * 0.22)),
  start: () => blip(300, 900, 0.3, 'square', 0.08),
};

// ---------------------------------------------------------------- game state
let S; // scene
let G; // global game state
let HV, TT, FU, FS, FT, OCC, TOB, BURN, PEOPLE, WATERT, FOAMT, TA, FL, WZ, DST, BOULD, MUD;
let HELI_F;

const config = {
  type: Phaser.AUTO,
  width: SW,
  height: SH,
  parent: 'game-root',
  backgroundColor: '#0a1420',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: { create, update },
};
function create() {
  S = this;
  G = { st: 'title', t: 0, level: 1, score: 0, top: [], prev: {}, msgT: 0, rocks: [] };
  makeTextures();
  HELI_F = heliMesh();
  initAudio();

  S.cameras.main.setBounds(0, 0, WW, WH);

  G.scorch = S.add.renderTexture(0, 0, WW, WH).setOrigin(0, 0).setDepth(-999);
  G.tmp = S.make.graphics({}, false);
  G.rainG = S.add.graphics().setScrollFactor(0).setDepth(9000);
  G.fx = S.add.graphics().setDepth(-998).setBlendMode(Phaser.BlendModes.ADD);
  G.water = S.add.graphics().setDepth(-998.5);
  G.shadow = S.add.graphics().setDepth(-997);
  G.heliG = S.add.graphics();

  G.flame = S.add
    .particles(0, 0, 'dot', {
      lifespan: { min: 350, max: 700 },
      speedY: { min: -55, max: -24 },
      speedX: { min: -8, max: 8 },
      scale: { start: 0.42, end: 0.04 },
      alpha: { start: 0.75, end: 0 },
      tint: [0xffc23a, 0xff7a1a, 0xff4a0a, 0xff5a14],
      blendMode: 'ADD',
      emitting: false,
    })
    .setDepth(5000);
  G.smoke = S.add
    .particles(0, 0, 'dot', {
      lifespan: { min: 1800, max: 3000 },
      speedY: { min: -32, max: -14 },
      speedX: { min: -6, max: 6 },
      scale: { start: 0.45, end: 1.9 },
      alpha: { start: 0.3, end: 0 },
      tint: 0x3b3735,
      emitting: false,
    })
    .setDepth(6000);

  G.spray = S.add
    .particles(0, 0, 'dot', {
      lifespan: { min: 500, max: 900 },
      speedY: { min: -60, max: -25 },
      speedX: { min: -15, max: 15 },
      gravityY: 90,
      scale: { start: 0.35, end: 0.05 },
      alpha: { start: 0.85, end: 0 },
      emitting: false,
    })
    .setDepth(5000);
  createHud();
  getStorage()
    .get(TOP_KEY)
    .then((r) => {
      if (r && r.found && Array.isArray(r.value)) G.top = r.value.filter((e) => e && typeof e.s === 'number' && typeof e.n === 'string').slice(0, 5);
      refreshTitle();
    })
    .catch(() => {});

  buildLevel(1, true);
  showTitle();
}

// ---------------------------------------------------------------- level generation
const HVI = (i, j) => HV[i * (N + 1) + j];
const tileAvg = (t) => TA[t];
const gw = (x, y) => Math.max(gh(x, y), WZ[tileAt(x, y)]);
function gh(x, y) {
  x = clamp(x, 0, N - 0.001);
  y = clamp(y, 0, N - 0.001);
  const i = x | 0, j = y | 0, fx = x - i, fy = y - j;
  const a = HVI(i, j), b = HVI(i + 1, j), c = HVI(i, j + 1), d = HVI(i + 1, j + 1);
  return Math.max(0, a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy);
}
const tileAt = (x, y) => clamp(x | 0, 0, N - 1) * N + clamp(y | 0, 0, N - 1);

function clearLevel() {
  if (TOB) for (const l of TOB) for (const o of l) o.img.destroy();
  if (PEOPLE) for (const p of PEOPLE) p.g.destroy();
  if (G.terrain) G.terrain.destroy();
  if (G.miniImg) G.miniImg.destroy();
  if (G.tent) G.tent.destroy();
  for (const k of ['terrain', 'mini']) if (S.textures.exists(k)) S.textures.remove(k);
  G.scorch.clear();
  for (const r of G.rocks) r.destroy();
  G.rocks = [];
  G.flame.killAll();
  G.smoke.killAll();
}

function buildLevel(L, attract) {
  clearLevel();
  SEED = rnd(1000);
  G.level = L;
  G.dis = [1, 2, 0, 3][(L - 1) % 4];
  G.tier = ((L - 1) / 4) | 0;
  const NV = (N + 1) * (N + 1);
  HV = new Float32Array(NV);
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) {
      const d = (i + j) / (2 * N);
      const h = 4.6 * (0.74 - d) + (fbm(i * 0.11, j * 0.11) - 0.5) * 3.4 + (vn(i * 0.35 + 9, j * 0.35) - 0.5) * 0.5;
      HV[i * (N + 1) + j] = clamp(h, -1.6, 4.2);
    }

  // helipad: a flat 2x2 spot on the left side, kept above tsunami / mud reach
  const wtop = 1.5 + 0.35 * G.tier;
  let best = null, bs = 1e9;
  for (let i = 3; i < 11; i++)
    for (let j = Math.floor(N * 0.42); j < Math.floor(N * 0.72); j++) {
      let mn = 9, mx = -9;
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++) {
          const h = HVI(i + a, j + b);
          mn = Math.min(mn, h);
          mx = Math.max(mx, h);
        }
      const sc = mx - mn + (mn < 0.35 ? 5 : 0) + (mx > 1.8 && G.dis !== 2 ? 3 : 0) + (G.dis === 2 ? Math.max(0, wtop - mn) * 1.5 : 0);
      if (sc < bs) {
        bs = sc;
        best = [i, j, (mn + mx) / 2];
      }
    }
  const [pi, pj] = best;
  let ph = best[2];
  const req = G.dis === 2 ? wtop + 0.45 : G.dis === 3 ? ph + 1 : ph;
  if (req > ph) {
    // raise a smooth hill under the pad
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++) {
        const d = Math.hypot(i - pi - 1, j - pj - 0.5), k = i * (N + 1) + j;
        const w = d < 2.5 ? 1 : d > 6 ? 0 : 1 - (d - 2.5) / 3.5;
        HV[k] = Math.max(HV[k], HV[k] + (req - HV[k]) * w * w * (3 - 2 * w));
      }
    ph = req;
  }
  for (let a = -1; a < 4; a++)
    for (let b = -2; b < 4; b++) {
      const i = pi + a, j = pj + b;
      if (i < 0 || j < 0 || i > N || j > N) continue;
      const w = a >= 0 && a <= 2 && b >= -1 && b <= 2 ? 1 : 0.5;
      HV[i * (N + 1) + j] += (ph - HV[i * (N + 1) + j]) * w;
    }
  G.pad = { i: pi, j: pj, x: pi + 1, y: pj + 1, z: ph };

  // tile types
  TA = new Float32Array(N * N);
  for (let t = 0; t < N * N; t++) {
    const i = (t / N) | 0, j = t % N;
    TA[t] = (HVI(i, j) + HVI(i + 1, j) + HVI(i, j + 1) + HVI(i + 1, j + 1)) / 4;
  }
  TT = new Uint8Array(N * N);
  for (let t = 0; t < N * N; t++) {
    const a = tileAvg(t);
    TT[t] = a < 0 ? T_WATER : a < 0.28 ? T_SAND : a < 2.1 ? T_GRASS : a < 2.9 ? T_ROCK : T_SNOW;
  }
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) TT[(pi + a) * N + pj + b] = T_PAD;

  OCC = new Uint8Array(N * N);
  OCC[(pi + 1) * N + pj - 1] = 2;
  TOB = [];
  for (let t = 0; t < N * N; t++) TOB.push([]);
  FS = new Uint8Array(N * N);
  FT = new Float32Array(N * N);
  BURN = [];
  PEOPLE = [];
  BOULD = [];
  FL = new Uint8Array(N * N);
  WZ = new Float32Array(N * N);

  const padD = (i, j) => Math.hypot(i + 0.5 - G.pad.x, j + 0.5 - G.pad.y);

  // villages
  const vill = [];
  const nv = 3 + (L > 2 ? 1 : 0);
  for (let tries = 0; vill.length < nv && tries < 500; tries++) {
    const i = (rnd(2, N - 3)) | 0, j = (rnd(2, N - 3)) | 0;
    if (TT[i * N + j] !== T_GRASS || padD(i, j) < 9) continue;
    if (vill.some((v) => Math.hypot(v[0] - i, v[1] - j) < 7) || (G.dis === 2 && TA[i * N + j] > 1.1) || (G.dis === 3 && (TA[i * N + j] < 0.5 || TA[i * N + j] > 1.8))) continue;
    vill.push([i, j]);
  }
  const houses = [];
  for (const [vi, vj] of vill) {
    const k = 3 + ((Math.random() * 3) | 0);
    for (let tries = 0, n = 0; n < k && tries < 40; tries++) {
      const i = Math.round(vi + rnd(-2.4, 2.4)), j = Math.round(vj + rnd(-2.4, 2.4));
      if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) continue;
      const t = i * N + j;
      if (TT[t] !== T_GRASS || OCC[t]) continue;
      OCC[t] = 2;
      addObj(t, i + 0.5, j + 0.5, 'house', (Math.random() * 3) | 0);
      houses.push([i + 0.5, j + 0.5]);
      n++;
    }
  }

  // forests
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const t = i * N + j;
      if (OCC[t] || padD(i, j) < 3.2) continue;
      if (vill.some((v) => Math.hypot(v[0] - i, v[1] - j) < 1.5)) continue;
      const a = tileAvg(t);
      if (TT[t] === T_GRASS) {
        const f = fbm(i * 0.17 + 40, j * 0.17 + 40);
        if (f > 0.5) {
          TT[t] = T_FOREST;
          OCC[t] = 1;
          const n = f > 0.58 ? 2 : 1;
          for (let k = 0; k < n; k++) {
            const pine = a > 1.3 ? Math.random() < 0.85 : Math.random() < 0.35;
            addObj(t, i + rnd(0.2, 0.8), j + rnd(0.2, 0.8), 'tree', (pine ? 0 : 4) + ((Math.random() * 4) | 0));
          }
        } else if (Math.random() < 0.05) {
          OCC[t] = 1;
          addObj(t, i + 0.5, j + 0.5, 'tree', 4 + ((Math.random() * 4) | 0));
        }
      } else if (TT[t] === T_ROCK && Math.random() < 0.1) {
        OCC[t] = 1;
        addObj(t, i + 0.5, j + 0.5, 'tree', (Math.random() * 4) | 0);
      }
    }
  FU = new Float32Array(N * N);
  for (let t = 0; t < N * N; t++) FU[t] = OCC[t] === 2 ? 0.9 : FUEL[TT[t]];

  // water lists for shimmer / foam
  WATERT = [];
  FOAMT = [];
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const t = i * N + j;
      if (TT[t] !== T_WATER) continue;
      WATERT.push(t);
      let coast = false;
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          const u = i + a, v = j + b;
          if (u >= 0 && v >= 0 && u < N && v < N && TT[u * N + v] !== T_WATER) coast = true;
        }
      if (coast) FOAMT.push(t);
    }

  drawTerrain();
  G.door = { x: pi + 1.62, y: pj - 0.5 };
  const tq = P(pi + 1.5, pj - 0.5, gh(pi + 1.5, pj - 0.5));
  G.tent = S.add.image(tq.x, tq.y, 'tent').setOrigin(0.5, 44 / 60).setDepth(pi + pj + 1).setScale(1.35);
  drawMinimapBase();

  // people
  const np = Math.min(28, 14 + L * 2);
  for (const [hx, hy] of houses) {
    const k = 1 + (Math.random() < 0.6 ? 1 : 0);
    for (let n = 0; n < k && PEOPLE.length < np; n++) addPerson(hx + rnd(-0.6, 0.6), hy + rnd(0.3, 0.7));
  }
  for (let tries = 0; PEOPLE.length < np && tries < 400; tries++) {
    const i = (rnd(1, N - 1)) | 0, j = (rnd(1, N - 1)) | 0, t = i * N + j;
    if ((TT[t] !== T_FOREST && TT[t] !== T_GRASS) || padD(i, j) < 8) continue;
    addPerson(i + 0.5, j + 0.5);
  }

  // fire
  G.R = G.dis ? 0.16 * (1 + 0.3 * G.tier) : 0.07 * (1 + 0.25 * G.tier);
  const wa = rnd(Math.PI * 2);
  G.wind = Math.min(1.2, 0.4 + 0.1 * L);
  G.wx = Math.cos(wa);
  G.wy = Math.sin(wa);
  G.smoke.accelerationX = (G.wx - G.wy) * 10 * G.wind;
  setupDisaster();
  const ign = G.dis === 1 ? Math.min(4, 1 + G.tier) : 0;
  for (let n = 0, tries = 0; n < ign && tries < 600; tries++) {
    const i = (rnd(1, N - 1)) | 0, j = (rnd(1, N - 1)) | 0, t = i * N + j;
    if (TT[t] !== T_FOREST || padD(i, j) < 11) continue;
    if (L < 3 && vill.some((v) => Math.hypot(v[0] - i, v[1] - j) < 5)) continue;
    ignite(t);
    n++;
  }

  // helicopter, parked on the pad
  G.h = { x: G.pad.x, y: G.pad.y, z: G.pad.z, vx: 0, vy: 0, a: -Math.PI / 4, rot: 0, alt: 0, dn: 0, acc: 0, landed: true, pass: 0, ut: 0, pitch: 0, roll: 0, mv: 0 };
  G.hang = [];
  G.rescued = 0;
  G.lost = 0;
  G.survived = 0;
  G.total = PEOPLE.length;
  G.attract = attract;
  G.auto = { a: 0, t: 0, tx: N / 2, ty: N / 2 };
  const c = P(G.h.x, G.h.y, G.h.z);
  S.cameras.main.centerOn(c.x, c.y);
}

function addObj(t, x, y, kind, v) {
  const z = gh(x, y), p = P(x, y, z);
  const tree = kind === 'tree';
  const img = S.add.image(p.x, p.y, tree ? 't' + v : 'h' + v).setOrigin(0.5, tree ? 56 / 64 : 42 / 52);
  if (tree) img.setScale(rnd(0.9, 1.25));
  img.setDepth(x + y);
  TOB[t].push({ x, y, kind, v, img });
}

function addPerson(x, y) {
  const t = tileAt(x, y);
  if (TT[t] === T_WATER) return;
  const SHIRTS = [0xff6ec7, 0x3fa9f5, 0xff9f1c, 0xe1ff00, 0xffffff, 0xb388ff, 0x2ec4b6, 0xff4d4d];
  const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
  PEOPLE.push({
    x, y, hx: x, hy: y, tx: x, ty: y, st: 0, hp: 1, ph: rnd(6), tk: rnd(0.3), wt: rnd(3), fire: null,
    spd: rnd(0.85, 1.1), c: SHIRTS[(Math.random() * 8) | 0], sk: SKINS[(Math.random() * 5) | 0],
    g: S.add.graphics(), dt: 0, mv: false, pk: 0,
  });
}

function terrainColor(t, i, j) {
  const a = tileAvg(t), v = 0.93 + hash(i * 3.1, j * 7.7) * 0.14;
  switch (TT[t]) {
    case T_WATER:
      return mix(0x3fa3c8, 0x1b4a75, clamp(-a / 1.1, 0, 1));
    case T_SAND:
      return shade(0xdcc68e, v);
    case T_GRASS:
      return shade(mix(0x86b84e, 0x5f9a3c, fbm(i * 0.2, j * 0.2)), v);
    case T_FOREST:
      return shade(0x4b7d32, v);
    case T_ROCK:
      return shade(0x8f887a, v);
    case T_SNOW:
      return shade(0xeef3f5, v);
    default:
      return 0x5b6168;
  }
}

function drawTerrain() {
  const g = S.make.graphics({}, false);
  const V = (i, j) => [i, j, Math.max(0, HVI(i, j))];
  const fill = (pts3, c, flatColor) => {
    let col = c;
    if (!flatColor) {
      let n = nrm(cross(sub(pts3[1], pts3[0]), sub(pts3[2], pts3[0])));
      if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
      col = lit(c, n);
    }
    const pts = pts3.map((v) => P(v[0], v[1], v[2]));
    g.fillStyle(col, 1);
    g.fillPoints(pts, true);
    g.lineStyle(1, col, 1);
    g.strokePoints(pts, true);
  };
  for (let s = 0; s < 2 * N - 1; s++)
    for (let i = Math.max(0, s - N + 1); i <= Math.min(N - 1, s); i++) {
      const j = s - i, t = i * N + j, c = terrainColor(t, i, j);
      if (TT[t] === T_WATER) {
        fill([[i, j, 0], [i + 1, j, 0], [i + 1, j + 1, 0], [i, j + 1, 0]], c, true);
      } else {
        const A = V(i, j), B = V(i + 1, j), C = V(i + 1, j + 1), D = V(i, j + 1);
        fill([A, B, C], c);
        fill([A, C, D], c);
      }
    }
  // diorama skirts on the two front edges
  const BOT = -1.3;
  for (let k = 0; k < N; k++) {
    for (const side of [0, 1]) {
      const a = side ? [N, k] : [k, N], b = side ? [N, k + 1] : [k + 1, N];
      const ha = Math.max(0, HVI(a[0], a[1])), hb = Math.max(0, HVI(b[0], b[1]));
      const t = side ? (N - 1) * N + k : k * N + N - 1;
      const wet = TT[t] === T_WATER;
      const base = wet ? 0x1d4f7a : 0x6b4f35;
      const col = shade(base, side ? 0.72 : 0.95);
      const pts = [P(a[0], a[1], ha), P(b[0], b[1], hb), P(b[0], b[1], BOT), P(a[0], a[1], BOT)];
      g.fillStyle(col, 1);
      g.fillPoints(pts, true);
      g.lineStyle(1, col, 1);
      g.strokePoints(pts, true);
      if (!wet) {
        const mid = Math.min(ha, hb) * 0.4 + BOT * 0.6;
        g.fillStyle(shade(col, 0.8), 1);
        g.fillPoints([P(a[0], a[1], mid), P(b[0], b[1], mid), P(b[0], b[1], BOT), P(a[0], a[1], BOT)], true);
      }
    }
  }
  // helipad markings
  const { x: px, y: py, z: pz } = G.pad;
  const ring = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    ring.push(P(px + Math.cos(a) * 0.85, py + Math.sin(a) * 0.85, pz + 0.01));
  }
  g.lineStyle(3, 0xe1ff00, 1);
  g.strokePoints(ring, true);
  g.lineStyle(4, 0xffffff, 1);
  const ln = (x0, y0, x1, y1) => {
    const a = P(px + x0, py + y0, pz + 0.01), b = P(px + x1, py + y1, pz + 0.01);
    g.lineBetween(a.x, a.y, b.x, b.y);
  };
  ln(-0.35, -0.4, -0.35, 0.4);
  ln(0.35, -0.4, 0.35, 0.4);
  ln(-0.35, 0, 0.35, 0);
  g.generateTexture('terrain', WW, WH);
  g.destroy();
  G.terrain = S.add.image(0, 0, 'terrain').setOrigin(0, 0).setDepth(-1000);
}

// ---------------------------------------------------------------- fire
const NB = [];
for (let a = -1; a <= 1; a++)
  for (let b = -1; b <= 1; b++) if (a || b) {
    const l = Math.hypot(a, b);
    NB.push([a, b, a / l, b / l, l > 1 ? 0.7 : 1]);
  }

function ignite(t) {
  FS[t] = 1;
  FT[t] = 3 + FU[t] * 4 + rnd(2);
  BURN.push(t);
  for (const o of TOB[t]) o.img.setTint(0xff8a4a);
  evac(t, '¡FUEGO! DESPEGUE DE EMERGENCIA');
}

function evac(t, s) {
  const h = G.h;
  if (h && h.landed && tileAt(h.x, h.y) === t) {
    h.alt = 1.2;
    h.landed = false;
    msg(s, 0xff4a1a);
  }
}

function burnOut(t) {
  FS[t] = 2;
  FU[t] = 0;
  for (const o of TOB[t]) {
    o.img.clearTint();
    o.img.setTexture(o.kind === 'tree' ? (o.v < 4 ? 'tb0' : 'tb1') : 'hb');
  }
  const i = (t / N) | 0, j = t % N;
  const pts = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map((v) => P(v[0], v[1], Math.max(0, HVI(v[0], v[1]))));
  G.tmp.fillStyle(TT[t] === T_ROCK ? 0x4a4440 : 0x1d1814, TT[t] === T_GRASS ? 0.55 : 0.75);
  G.tmp.fillPoints(pts, true);
  G.scorchDirty = true;
}

function fireStep(dt) {
  for (let k = BURN.length - 1; k >= 0; k--) {
    const t = BURN[k];
    FT[t] -= dt;
    if (FT[t] <= 0) {
      BURN.splice(k, 1);
      burnOut(t);
      continue;
    }
    const i = (t / N) | 0, j = t % N, ht = tileAvg(t);
    for (const [a, b, ux, uy, w] of NB) {
      const u = i + a, v = j + b;
      if (u < 0 || v < 0 || u >= N || v >= N) continue;
      const q = u * N + v;
      if (FS[q] || !FU[q]) continue;
      const wf = Math.max(0.15, 1 + 1.1 * G.wind * (ux * G.wx + uy * G.wy));
      const sl = 1 + clamp((tileAvg(q) - ht) * 0.7, -0.4, 0.9);
      if (Math.random() < G.R * FU[q] * wf * sl * w * dt) ignite(q);
    }
  }
  if (G.scorchDirty) {
    G.scorch.draw(G.tmp, 0, 0);
    G.tmp.clear();
    G.scorchDirty = false;
  }
}

function nearestT(x, y, r, A) {
  const ci = x | 0, cj = y | 0;
  let best = null, bd = r;
  for (let a = -r; a <= r; a++)
    for (let b = -r; b <= r; b++) {
      const i = ci + a, j = cj + b;
      if (i < 0 || j < 0 || i >= N || j >= N || A[i * N + j] !== 1) continue;
      const dx = x - (i + 0.5), dy = y - (j + 0.5), d = Math.hypot(dx, dy);
      if (d < bd) {
        bd = d;
        best = { d, dx: dx / (d || 1), dy: dy / (d || 1) };
      }
    }
  return best;
}

// ---------------------------------------------------------------- helicopter
function canLand(x, y) {
  const t = tileAt(x, y);
  if (TT[t] === T_WATER || TT[t] === T_FOREST || OCC[t] || FS[t] === 1 || FL[t]) return false;
  const i = (t / N) | 0, j = t % N;
  const hs = [HVI(i, j), HVI(i + 1, j), HVI(i, j + 1), HVI(i + 1, j + 1)];
  return Math.max(...hs) - Math.min(...hs) < 0.5;
}
const onPad = (h) => Math.hypot(h.x - G.pad.x, h.y - G.pad.y) < 1.2;

function heliStep(dt, ix, iy, up, down) {
  const h = G.h;
  const t = tileAt(h.x, h.y), ok = canLand(h.x, h.y);
  // minimum height: ground if landable, above the canopy over trees/houses, low hover elsewhere
  const minA = ok ? 0 : OCC[t] || TT[t] === T_FOREST ? 1.05 : 0.45;
  if (h.landed && (ix || iy)) {
    h.mv += dt;
    if (h.mv > 0.2) h.alt = 0.6;
  } else h.mv = 0;
  if (up) h.alt = Math.min(3.6, h.alt + 2.2 * dt);
  if (down) {
    h.alt -= 1.7 * dt;
    if (h.alt < minA && !ok && G.t > h.dn && G.st === 'play') {
      h.dn = G.t + 2.5;
      SND.deny();
      msg(h.pass >= CAP ? 'VUELA BAJO: LA GENTE SE COLGARÁ DE LOS PATINES' : 'NO SE PUEDE ATERRIZAR: SOLO SE COLGARÁN LOS QUE ESTÉN EN PELIGRO', 0xff6ec7);
    }
  }
  h.alt = Math.max(h.alt, minA);

  let ax = 0, ay = 0;
  if (!h.landed) {
    ax = (ix + iy) * 0.7071;
    ay = (iy - ix) * 0.7071;
    const l = Math.hypot(ax, ay);
    if (l > 1) {
      ax /= l;
      ay /= l;
    }
  }
  const low = h.alt < 0.5, acc = (low ? 6 : 10) * (1 - 0.08 * G.hang.length), drag = low ? 2.6 : 2;
  const pvx = h.vx, pvy = h.vy;
  h.vx += (ax * acc - h.vx * drag) * dt;
  h.vy += (ay * acc - h.vy * drag) * dt;
  if (h.landed) h.vx = h.vy = 0;
  h.acc = Math.hypot(h.vx - pvx, h.vy - pvy) / Math.max(dt, 0.001);
  h.x = clamp(h.x + h.vx * dt, 0.8, N - 0.8);
  h.y = clamp(h.y + h.vy * dt, 0.8, N - 0.8);
  const sp = Math.hypot(h.vx, h.vy);
  if (sp > 0.25) {
    const ta = Math.atan2(h.vy, h.vx);
    let d = ta - h.a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    h.a += d * Math.min(1, dt * 5);
  }
  h.pitch += (clamp(sp * 0.07, 0, 0.35) - h.pitch) * Math.min(1, dt * 4);
  const lat = -Math.sin(h.a) * ax + Math.cos(h.a) * ay;
  h.roll += (lat * 0.25 - h.roll) * Math.min(1, dt * 4);

  const gz = gw(h.x, h.y);
  const tz = (h.alt > 0.5 ? Math.max(gz, gw(h.x + h.vx * 0.4, h.y + h.vy * 0.4)) : gz) + h.alt;
  h.z += clamp(tz - h.z, -1.8 * dt, 2.6 * dt);
  const wasLanded = h.landed;
  h.landed = canLand(h.x, h.y) && h.alt <= 0 && h.z - gz < 0.03;
  if (h.landed) h.z = gz;
  if (h.landed && !wasLanded) SND.land();
  h.rot += dt * (h.landed ? 10 : 26);
  h.gz = gz;
}

function heliTf(h) {
  const ca = Math.cos(h.a), sa = Math.sin(h.a), cp = Math.cos(h.pitch), sp = Math.sin(h.pitch);
  const cr = Math.cos(h.roll), sr = Math.sin(h.roll), K = 1.15;
  return (q) => {
    const x = q[0] * K, y = q[1] * K, z = q[2] * K - 0.35;
    const x1 = x * cp + z * sp, z1 = -x * sp + z * cp;
    const y1 = y * cr - z1 * sr, z2 = y * sr + z1 * cr;
    return [h.x + x1 * ca - y1 * sa, h.y + x1 * sa + y1 * ca, h.z + z2 + 0.35];
  };
}

function drawHeli() {
  const h = G.h, g = G.heliG, s = G.shadow;
  g.clear();
  s.clear();
  const tf = heliTf(h);
  // shadow on the ground, shaped like the helicopter footprint
  const al = 0.32 * clamp(1 - (h.z - h.gz) * 0.12, 0.45, 1);
  const flat = (pts) => pts.map((q) => {
    const w = tf(q);
    return P(w[0], w[1], h.gz);
  });
  s.fillStyle(0x000000, al);
  s.fillPoints(flat([[0.42, 0.22, 0], [0.42, -0.22, 0], [-0.36, -0.22, 0], [-0.36, 0.22, 0]]), true);
  s.fillPoints(flat([[-0.36, 0.05, 0], [-0.95, 0.05, 0], [-0.95, -0.05, 0], [-0.36, -0.05, 0]]), true);
  const disk = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    disk.push([Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0]);
  }
  s.fillStyle(0x000000, al * 0.3);
  s.fillPoints(flat(disk), true);

  drawHangers(g, tf, false);
  drawFaces(g, HELI_F, tf, 0, 0, false);
  drawHangers(g, tf, true);
  // main rotor
  const hub = tf([0, 0, 0.73]);
  const hp = P(hub[0], hub[1], hub[2]);
  g.fillStyle(0xffffff, h.landed ? 0.06 : 0.13);
  g.fillPoints(disk.map((q) => {
    const w = tf([q[0], q[1], 0.73]);
    return P(w[0], w[1], w[2]);
  }), true);
  g.lineStyle(2.5, 0x1a1d22, 0.9);
  for (let k = 0; k < 2; k++) {
    const a = h.rot + k * Math.PI;
    const w1 = tf([Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0.73]);
    const w2 = tf([-Math.cos(a) * 0.9, -Math.sin(a) * 0.9, 0.73]);
    const p1 = P(w1[0], w1[1], w1[2]), p2 = P(w2[0], w2[1], w2[2]);
    g.lineBetween(p1.x, p1.y, p2.x, p2.y);
  }
  g.fillStyle(HELI_D, 1);
  g.fillCircle(hp.x, hp.y, 2.5);
  // tail rotor
  const ta = h.rot * 1.7;
  const t1 = tf([-0.95 + Math.cos(ta) * 0.14, 0.05, 0.62 + Math.sin(ta) * 0.14]);
  const t2 = tf([-0.95 - Math.cos(ta) * 0.14, 0.05, 0.62 - Math.sin(ta) * 0.14]);
  const q1 = P(t1[0], t1[1], t1[2]), q2 = P(t2[0], t2[1], t2[2]);
  g.lineStyle(2, 0x1a1d22, 0.9);
  g.lineBetween(q1.x, q1.y, q2.x, q2.y);
  // blinking beacon
  if (Math.sin(G.t * 9) > 0.6) {
    const b = tf([-0.92, 0, 0.75]), bp = P(b[0], b[1], b[2]);
    g.fillStyle(0xff3030, 1);
    g.fillCircle(bp.x, bp.y, 2);
  }
  g.setDepth(h.z - h.gz > 0.45 ? 7000 : h.x + h.y + 0.6);
}

// ---------------------------------------------------------------- people
function peopleStep(dt, live) {
  const h = G.h;
  for (const p of PEOPLE) {
    if (p.st === 3 || p.st === 4 || p.st === 7) continue;
    if (p.st > 7) {
      // rescued: walk to the field hospital, wave at the helicopter, go in
      const dx = G.door.x - p.x, dy = G.door.y - p.y, d = Math.hypot(dx, dy);
      p.mv = false;
      if (p.st === 8 && d > 0.15) {
        p.x += (dx / d) * 1.3 * dt;
        p.y += (dy / d) * 1.3 * dt;
        p.ph += dt * 12;
        p.mv = true;
      } else if ((p.st = 9) && (p.wt -= dt) < 0) p.st = 4;
      continue;
    }
    if (p.st === 6) {
      fallStep(p, dt);
      continue;
    }
    if (p.st === 5) {
      p.dt += dt;
      continue;
    }
    if (!live) continue;
    const t = tileAt(p.x, p.y);
    p.tk -= dt;
    if (p.tk <= 0) {
      p.tk = 0.25;
      p.fire = danger(p);
    }
    if (FS[t] === 1) p.hp -= dt * 2.4;
    if (FL[t] && WZ[t] - gh(p.x, p.y) > 0.12) p.hp -= dt * 1.1;
    else if (p.fire && p.fire.d < 1.6) p.hp -= dt * (1.7 - p.fire.d) * 0.5;
    if (p.hp <= 0) {
      kill(p);
      continue;
    }
    let vx = 0, vy = 0, sp = 0;
    const dh = Math.hypot(h.x - p.x, h.y - p.y);
    // with room in the cabin, only desperate people (danger nearby) grab the skids
    const canHang = G.hang.length < HANG && (h.pass >= CAP || !!p.fire);
    const low = !h.landed && h.z - h.gz < 1.25;
    if (((h.landed && (h.pass < CAP || canHang)) || (low && canHang)) && dh < 7 && !onPad(h)) {
      p.st = 2;
      vx = (h.x - p.x) / dh;
      vy = (h.y - p.y) / dh;
      sp = p.tr ? 0.7 : 1.8;
      if (dh < (h.landed ? 0.35 : 0.5)) {
        if (h.landed && h.pass < CAP) {
          p.st = 3;
          h.pass++;
          SND.board();
          popup(p.x, p.y, '+1', '#e1ff00');
        } else {
          p.st = 7;
          p.gmax = p.grip = rnd(0.85, 1.2);
          G.hang.push(p);
          SND.hang();
          popup(p.x, p.y, '¡COLGADO!', '#ff6ec7');
        }
        continue;
      }
    } else if (p.fire) {
      // panic: run in bursts, then freeze
      p.st = 1;
      p.pk += dt;
      if (p.pk > 1.6) p.pk = -rnd(0.8, 1.6);
      vx = p.fire.dx;
      vy = p.fire.dy;
      if (G.dis === 2) {
        // run uphill, away from the water
        const gx = gh(p.x + 0.4, p.y) - gh(p.x - 0.4, p.y), gy = gh(p.x, p.y + 0.4) - gh(p.x, p.y - 0.4), l = Math.hypot(gx, gy) || 1;
        vx = vx * 0.4 + gx / l;
        vy = vy * 0.4 + gy / l;
        const m = Math.hypot(vx, vy) || 1;
        vx /= m;
        vy /= m;
      }
      sp = p.tr ? 0 : p.pk > 0 ? 1.15 * p.spd : 0;
    } else if (p.tr) {
      p.st = 0;
    } else {
      p.st = 0;
      p.wt -= dt;
      if (p.wt <= 0) {
        p.wt = rnd(2, 5);
        p.tx = p.hx + rnd(-1.2, 1.2);
        p.ty = p.hy + rnd(-1.2, 1.2);
      }
      const d = Math.hypot(p.tx - p.x, p.ty - p.y);
      if (d > 0.1) {
        vx = (p.tx - p.x) / d;
        vy = (p.ty - p.y) / d;
        sp = 0.4;
      }
    }
    p.mv = false;
    if (sp) {
      // try direct, then deflect left/right to walk around water
      for (const da of [0, 0.7, -0.7, 1.5, -1.5]) {
        const c = Math.cos(da), s = Math.sin(da);
        const ux = vx * c - vy * s, uy = vx * s + vy * c;
        const nx = p.x + ux * sp * dt, ny = p.y + uy * sp * dt;
        if (nx < 0.3 || ny < 0.3 || nx > N - 0.3 || ny > N - 0.3) continue;
        if (TT[tileAt(nx, ny)] === T_WATER) continue;
        p.x = nx;
        p.y = ny;
        p.mv = true;
        p.ph += dt * sp * 9;
        break;
      }
    }
  }
}

function kill(p) {
  p.st = 5;
  p.dt = 0;
  G.lost++;
  SND.dead();
}

function danger(p) {
  let d = G.dis > 1 ? nearestT(p.x, p.y, 4, FL) : nearestT(p.x, p.y, 3, FS);
  if (d && d.d > (G.dis > 1 ? 3.5 : 2.6)) d = null;
  for (const b of BOULD) {
    const dx = p.x - b.x, dy = p.y - b.y, l = Math.hypot(dx, dy);
    if (l < 2.5 && (!d || l < d.d)) d = { d: l, dx: -dy / (l || 1), dy: dx / (l || 1) };
  }
  if (!d && G.dis === 0 && G.qk.dur > 0) {
    const a = rnd(7);
    d = { d: 3, dx: Math.cos(a), dy: Math.sin(a) };
  }
  return d;
}

// people hanging from the skids lose grip with direct fire, jerks and high speed
function hangStep(dt) {
  const h = G.h, sp = Math.hypot(h.vx, h.vy);
  const fire = FS[tileAt(h.x, h.y)] === 1 && h.z - h.gz < 2.4;
  G.danger = false;
  for (let k = G.hang.length - 1; k >= 0; k--) {
    const p = G.hang[k];
    if (h.landed) {
      if (!onPad(h) && h.pass < CAP) {
        G.hang.splice(k, 1);
        p.st = 3;
        h.pass++;
        SND.board();
      }
      continue;
    }
    let d = 0;
    if (fire) d += 0.8;
    if (h.acc > 5) d += (h.acc - 5) * 0.12;
    if (sp > 4.2) d += (sp - 4.2) * 0.3;
    p.grip = Math.min(p.gmax, p.grip + (d ? -d : 0.06) * dt);
    if (p.grip < 0.4) G.danger = true;
    if (p.grip <= 0) {
      G.hang.splice(k, 1);
      p.st = 6;
      p.x = clamp(h.x + rnd(-0.2, 0.2), 0.3, N - 0.3);
      p.y = clamp(h.y + rnd(-0.2, 0.2), 0.3, N - 0.3);
      p.fz = Math.max(0.05, h.z - 0.45 - gh(p.x, p.y));
      p.vz = 0;
      p.fvx = h.vx * 0.6;
      p.fvy = h.vy * 0.6;
      SND.fall();
      popup(p.x, p.y, '¡SE SOLTÓ!', '#ff4a1a');
    }
  }
}

function fallStep(p, dt) {
  p.vz -= 9 * dt;
  p.fz += p.vz * dt;
  p.x = clamp(p.x + p.fvx * dt, 0.3, N - 0.3);
  p.y = clamp(p.y + p.fvy * dt, 0.3, N - 0.3);
  p.ph += dt * 20;
  if (p.fz > 0) return;
  p.fz = 0;
  if (TT[tileAt(p.x, p.y)] === T_WATER || FL[tileAt(p.x, p.y)] || p.vz < -5) kill(p);
  else {
    p.st = 0;
    p.hp -= 0.3;
    p.hx = p.tx = p.x;
    p.hy = p.ty = p.y;
  }
}

function drawHangers(g, tf, front) {
  const h = G.h, svx = clamp(-(h.vx - h.vy) * 1.6, -9, 9);
  const c = dot([h.x, h.y, h.z], VIEW);
  G.hang.forEach((p, k) => {
    const w = tf([SLOTS[k][0], SLOTS[k][1], 0.02]), a = P(w[0], w[1], w[2]);
    if (dot(w, VIEW) > c !== front) return;
    const sx = svx + Math.sin(G.t * 3 + k * 1.7) * 1.5, kick = p.grip < 0.4 ? Math.sin(G.t * 30 + k) * 3 : 0;
    const x = a.x, y = a.y;
    if (h.landed) {
      g.fillStyle(p.c, 1);
      g.fillRect(x - 2.5, y - 12, 5, 6.5);
      g.fillStyle(p.sk, 1);
      g.fillCircle(x, y - 14.5, 2.6);
      return;
    }
    g.lineStyle(1.6, p.sk, 1);
    g.lineBetween(x - 1.5, y, x - 2.5 + sx * 0.3, y + 11);
    g.lineBetween(x + 1.5, y, x + 2.5 + sx * 0.3, y + 11);
    g.fillStyle(p.sk, 1);
    g.fillCircle(x + sx * 0.3, y + 9, 2.5);
    g.fillStyle(p.grip < 0.4 && Math.sin(G.t * 20) > 0 ? 0xff3030 : p.c, 1);
    g.fillRect(x - 2.5 + sx * 0.5, y + 11.5, 5, 6.5);
    g.lineStyle(2, 0x2b2b3a, 1);
    g.lineBetween(x - 1 + sx * 0.6, y + 18, x - 1.5 + sx + kick, y + 24);
    g.lineBetween(x + 1 + sx * 0.6, y + 18, x + 1.5 + sx - kick, y + 24);
  });
}

function drawPeople() {
  const h = G.h, cam = S.cameras.main.worldView;
  for (const p of PEOPLE) {
    const g = p.g;
    g.clear();
    if (p.st === 3 || p.st === 4 || p.st === 7 || (p.st === 5 && p.dt > 3)) {
      g.setVisible(false);
      continue;
    }
    const q = P(p.x, p.y, gh(p.x, p.y) + (p.st === 6 ? p.fz : 0));
    if (q.x < cam.x - 30 || q.x > cam.right + 30 || q.y < cam.y - 40 || q.y > cam.bottom + 40) {
      g.setVisible(false);
      continue;
    }
    g.setVisible(true);
    g.setDepth(p.st === 6 ? 6999 : p.x + p.y + 0.3);
    const x = q.x, y = q.y;
    if (p.st !== 6) {
      g.fillStyle(0x000000, 0.25);
      g.fillEllipse(x, y, 9, 4);
    }
    if (p.st === 5) {
      const a = 1 - p.dt / 3;
      g.fillStyle(0x333333, a);
      g.fillRect(x - 6, y - 3, 10, 3);
      g.fillStyle(0x555555, a);
      g.fillCircle(x + 5, y - 2, 2.2);
      continue;
    }
    const s = p.mv ? Math.sin(p.ph) * 2.6 : 0;
    g.lineStyle(2, 0x2b2b3a, 1);
    g.lineBetween(x - 1, y - 6, x - 1.5 + s, y);
    g.lineBetween(x + 1, y - 6, x + 1.5 - s, y);
    const wave = p.st === 6 || p.st === 9 || (p.st !== 2 && !h.landed && Math.hypot(h.x - p.x, h.y - p.y) < 7);
    g.lineStyle(1.6, p.sk, 1);
    if (wave) {
      const w = Math.sin(G.t * 14 + p.ph) * 2;
      g.lineBetween(x - 2.5, y - 11, x - 5 + w, y - 17);
      g.lineBetween(x + 2.5, y - 11, x + 5 - w, y - 17);
    } else {
      g.lineBetween(x - 2.5, y - 11, x - 3.5 - s * 0.5, y - 6);
      g.lineBetween(x + 2.5, y - 11, x + 3.5 + s * 0.5, y - 6);
    }
    g.fillStyle(p.hp < 0.6 ? mix(p.c, 0x222222, 0.5) : p.c, 1);
    g.fillRect(x - 2.5, y - 12, 5, 6.5);
    g.fillStyle(p.sk, 1);
    g.fillCircle(x, y - 14.5, 2.6);
    if (p.st < 2) {
      const b = Math.sin(G.t * 6 + p.ph) * 2 - 22;
      g.fillStyle(p.tr ? 0xffffff : p.st === 1 ? 0xff4a1a : 0xff6ec7, 1);
      g.fillTriangle(x - 3.5, y + b - 4, x + 3.5, y + b - 4, x, y + b + 1);
    }
  }
}

// ---------------------------------------------------------------- effects
function fxStep(dt) {
  const cam = S.cameras.main.worldView, g = G.fx;
  g.clear();
  let vis = 0;
  for (const t of BURN) {
    const i = (t / N) | 0, j = t % N;
    const c = P(i + 0.5, j + 0.5, Math.max(0, tileAvg(t)));
    if (c.x < cam.x - 40 || c.x > cam.right + 40 || c.y < cam.y - 40 || c.y > cam.bottom + 60) continue;
    vis++;
    const pts = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map((v) => P(v[0], v[1], Math.max(0, HVI(v[0], v[1]))));
    g.fillStyle(0xff5a1a, 0.22 + Math.random() * 0.14);
    g.fillPoints(pts, true);
    const hgt = TOB[t].length ? 18 : 4;
    if (Math.random() < 0.13 * dt * 60) G.flame.emitParticleAt(c.x + rnd(-12, 12), c.y - rnd(hgt) + 2, 1);
    if (Math.random() < 0.04 * dt * 60) G.smoke.emitParticleAt(c.x + rnd(-8, 8), c.y - hgt - 6, 1);
  }
  if (vis && Math.random() < Math.min(0.6, vis * 0.02)) crackle(Math.min(0.12, 0.02 + vis * 0.004));

  // water shimmer and coastal foam
  const rg = G.rainG, rn = G.dis === 3 && G.st !== 'title' ? G.al.rain : 0;
  rg.clear();
  if (rn > 0.05) {
    rg.fillStyle(0x0a1622, 0.34 * rn);
    rg.fillRect(0, 0, SW, SH);
    rg.lineStyle(1, 0xbcd8f0, 0.6);
    for (let k = 0; k < 140 * rn; k++) {
      const x = rnd(SW + 60), y = rnd(SH);
      rg.lineBetween(x, y, x - 5, y + 16);
    }
  }
  if (AU.rain) AU.rain.gain.value = 0.12 * rn;
  const w = G.water;
  w.clear();
  if ((G.dis === 2 && G.ts.n >= 0) || G.dis === 3) drawFlood(w, cam);
  else for (const t of FOAMT) {
    const i = (t / N) | 0, j = t % N, c = P(i + 0.5, j + 0.5, 0);
    if (c.x < cam.x - 30 || c.x > cam.right + 30 || c.y < cam.y - 20 || c.y > cam.bottom + 20) continue;
    w.fillStyle(0xffffff, 0.08 + 0.07 * Math.sin(G.t * 2 + i * 0.7 + j * 0.4));
    w.fillPoints([P(i, j, 0), P(i + 1, j, 0), P(i + 1, j + 1, 0), P(i, j + 1, 0)], true);
  }
  w.lineStyle(1.2, 0xd8f3ff, 0.55);
  if (G.dis !== 2 || G.ts.n < 0) for (const t of WATERT) {
    if (G.dis === 3) break;
    const i = (t / N) | 0, j = t % N;
    const k = Math.sin(G.t * 1.3 + hash(i, j) * 40);
    if (k < 0.82) continue;
    const c = P(i + hash(j, i), j + hash(i + 3, j), 0);
    if (c.x < cam.x || c.x > cam.right || c.y < cam.y || c.y > cam.bottom) continue;
    const l = (k - 0.82) * 40;
    w.lineBetween(c.x - l, c.y, c.x + l, c.y);
  }
}

// ---------------------------------------------------------------- HUD
function txt(x, y, s, size, color, ox) {
  return S.add
    .text(x, y, s, { fontFamily: 'monospace', fontSize: size + 'px', fontStyle: 'bold', color: color || '#ffffff', stroke: '#06101a', strokeThickness: 4 })
    .setOrigin(ox === undefined ? 0 : ox, 0)
    .setScrollFactor(0)
    .setDepth(10001);
}

function createHud() {
  const U = {};
  G.U = U;
  U.bar = S.add.rectangle(0, 0, SW, 34, 0x06101a, 0.55).setOrigin(0, 0).setScrollFactor(0).setDepth(10000);
  U.lvl = txt(12, 8, '', 16, '#e1ff00');
  U.score = txt(150, 8, '', 16);
  U.ppl = txt(12, 40, '', 13);
  U.abordo = txt(14, SH - 52, 'A BORDO', 12, '#b8c48d');
  U.colg = txt(14 + 74 + CAP * 18 + 4, SH - 72, 'COLGADOS', 11, '#ff6ec7');
  U.viento = txt(MX, MY + N * MS + 40, 'VIENTO', 10, '#b8c48d', 0.5);
  U.g = S.add.graphics().setScrollFactor(0).setDepth(10001);
  U.mini = S.add.graphics().setScrollFactor(0).setDepth(10002);
  U.msg = txt(SW / 2, SH - 70, '', 18, '#ffffff', 0.5);
  U.hint = txt(SW / 2, SH - 26, '', 12, '#b8c48d', 0.5);
  U.ban = txt(SW / 2, 200, '', 34, '#e1ff00', 0.5);
  U.ban2 = txt(SW / 2, 248, '', 16, '#ffffff', 0.5);
  U.ov = S.add.rectangle(0, 0, SW, SH, 0x050a10, 0.55).setOrigin(0, 0).setScrollFactor(0).setDepth(10000);
  U.title = txt(SW / 2, 120, 'ANDES RESCUE', 56, '#e1ff00', 0.5).setStroke('#06101a', 8);
  U.sub = txt(SW / 2, 192, 'Rescata a los habitantes antes de que la catástrofe los alcance', 15, '#ffffff', 0.5);
  U.press = txt(SW / 2, 330, 'PRESIONA START', 26, '#ff6ec7', 0.5);
  U.ctrl = txt(SW / 2, 380, 'JOYSTICK: VOLAR    BOTÓN 1: SUBIR    BOTÓN 2: BAJAR\nAterriza cerca de la gente. Si vuelas bajo, los que estén en peligro se colgarán.\nLlévalos al helipuerto (H) sin que se suelten.', 13, '#b8c48d', 0.5).setAlign('center');
  U.bestT = txt(SW / 2, 456, '', 13, '#ffffff', 0.5).setAlign('center');
  U.sumL = txt(SW / 2, 290, '', 16, '#ffffff', 0.5).setAlign('center');
}

function setGroup(names, v) {
  for (const n of names) G.U[n].setVisible(v);
}
const TITLE_UI = ['ov', 'title', 'sub', 'press', 'ctrl', 'bestT'];
const PLAY_UI = ['bar', 'lvl', 'score', 'ppl', 'g', 'mini', 'msg', 'hint', 'abordo', 'viento', 'colg'];

function refreshTitle() {
  G.U.bestT.setText(G.top.length ? 'MEJORES RESCATISTAS\n' + G.top.map((e, i) => i + 1 + '. ' + e.n + '  ' + String(e.s).padStart(7) + '  NIVEL ' + e.l).join('\n') : '');
}
function showTitle() {
  G.st = 'title';
  setGroup(PLAY_UI, false);
  setGroup(TITLE_UI, true);
  setGroup(['ban', 'ban2', 'sumL'], false);
  G.U.title.setText('ANDES RESCUE');
  G.U.sub.setText('Rescata a los habitantes antes de que la catástrofe los alcance');
  G.U.press.setText('PRESIONA START');
  G.U.ctrl.setVisible(true);
  if (G.miniImg) G.miniImg.setVisible(false);
  refreshTitle();
}

function startGame() {
  SND.start();
  G.score = 0;
  startLevel(1);
}

function startLevel(L) {
  buildLevel(L, false);
  G.st = 'play';
  G.lt = 0;
  setGroup(TITLE_UI, false);
  setGroup(PLAY_UI, true);
  G.U.sumL.setVisible(false);
  G.miniImg.setVisible(true);
  banner('NIVEL ' + L + '  ·  ' + DIS[G.dis], TIP[G.dis] + '  ·  ' + G.total + ' personas');
  if (L === 1) msg('Vuela hacia la gente y baja con BOTÓN 2 para aterrizar', 0xffffff, 5);
  G.U.viento.setVisible(G.dis < 2);
}

function banner(a, b) {
  const U = G.U;
  U.ban.setText(a).setVisible(true).setAlpha(1);
  U.ban2.setText(b).setVisible(true).setAlpha(1);
  S.tweens.killTweensOf([U.ban, U.ban2]);
  S.tweens.add({ targets: [U.ban, U.ban2], alpha: 0, delay: 2600, duration: 700 });
}

function msg(s, color, secs) {
  G.U.msg.setText(s).setColor('#' + (color || 0xffffff).toString(16).padStart(6, '0'));
  G.msgT = secs || 2.2;
}

function popup(x, y, s, color) {
  const q = P(x, y, gh(x, y) + 0.8);
  const t = S.add
    .text(q.x, q.y, s, { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color, stroke: '#06101a', strokeThickness: 3 })
    .setOrigin(0.5)
    .setDepth(8000);
  S.tweens.add({ targets: t, y: q.y - 34, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
}

const MS = 2.1, MX = SW - 14 - N * MS, MY = 44;
const MP = (x, y) => [MX + (x - y) * MS, MY + (x + y) * MS * 0.5];

function drawMinimapBase() {
  const g = S.make.graphics({}, false);
  const ox = N * MS + 2, oy = 2;
  g.fillStyle(0x06101a, 0.7);
  g.fillPoints([{ x: ox, y: oy - 2 }, { x: ox + N * MS + 3, y: oy + N * MS * 0.5 }, { x: ox, y: oy + N * MS + 2 }, { x: ox - N * MS - 3, y: oy + N * MS * 0.5 }], true);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const t = i * N + j;
      const c = TT[t] === T_PAD ? 0xe1ff00 : shade(terrainColor(t, i, j), 0.9);
      g.fillStyle(c, 1);
      const x = ox + (i - j) * MS, y = oy + (i + j) * MS * 0.5;
      g.fillPoints([{ x, y }, { x: x + MS, y: y + MS * 0.5 }, { x, y: y + MS }, { x: x - MS, y: y + MS * 0.5 }], true);
    }
  g.generateTexture('mini', N * MS * 2 + 4, N * MS + 6);
  g.destroy();
  G.miniImg = S.add.image(MX - N * MS - 2, MY - 2, 'mini').setOrigin(0, 0).setScrollFactor(0).setDepth(10001);
}

function drawHud() {
  const U = G.U, h = G.h, g = U.g, m = U.mini;
  let ground = 0;
  for (const p of PEOPLE) if (p.st < 3 || p.st === 6) ground++;
  U.lvl.setText('NIVEL ' + G.level);
  U.score.setText('PUNTOS ' + String(G.score).padStart(6, '0'));
  U.ppl.setText('EN PELIGRO ' + ground + '   RESCATADOS ' + G.rescued + '   PERDIDOS ' + G.lost);
  g.clear();
  // passengers
  const bx = 14, by = SH - 34;
  g.fillStyle(0x06101a, 0.6);
  g.fillRoundedRect(bx - 6, by - 26, CAP * 18 + HANG * 18 + 92, 40, 6);
  for (let k = 0; k < CAP + HANG; k++) {
    const x = bx + 74 + k * 18 + (k >= CAP ? 14 : 0), hk = k - CAP;
    const f = k < CAP ? k < h.pass : hk < G.hang.length;
    g.fillStyle(f ? (k < CAP ? 0xe1ff00 : 0xff6ec7) : 0x34404a, 1);
    g.fillCircle(x, by - 14, 3.5);
    g.fillRect(x - 4, by - 9, 8, 11);
    if (k >= CAP && f) {
      const gr = clamp(G.hang[hk].grip, 0, 1);
      g.fillStyle(gr < 0.4 ? 0xff3030 : 0xffffff, 1);
      g.fillRect(x - 6, by + 5, 12 * gr, 2);
    }
  }
  // wind arrow
  if (G.dis < 2) {
  const wx = MX, wy = MY + N * MS + 26;
  const sx = (G.wx - G.wy), sy = (G.wx + G.wy) * 0.5, l = Math.hypot(sx, sy) || 1;
  const ux = sx / l, uy = sy / l, L = 10 + G.wind * 8;
  g.lineStyle(3, 0xffffff, 0.9);
  g.lineBetween(wx - ux * L, wy - uy * L, wx + ux * L, wy + uy * L);
  g.fillStyle(0xffffff, 0.9);
  g.fillTriangle(wx + ux * (L + 7), wy + uy * (L + 7), wx + ux * L - uy * 6, wy + uy * L + ux * 6, wx + ux * L + uy * 6, wy + uy * L - ux * 6);
  }
  // off-screen pointers
  const cam = S.cameras.main;
  if (h.pass > 0 || G.hang.length) {
    const pq = P(G.pad.x, G.pad.y, G.pad.z);
    edgeArrow(g, pq.x - cam.scrollX, pq.y - cam.scrollY, 0xe1ff00);
  }
  if (h.pass < CAP || G.hang.length < HANG) {
    let bp = null, bd = 1e9;
    for (const p of PEOPLE)
      if (p.st < 3) {
        const d = Math.hypot(p.x - h.x, p.y - h.y);
        if (d < bd) {
          bd = d;
          bp = p;
        }
      }
    if (bp) {
      const q = P(bp.x, bp.y, gh(bp.x, bp.y));
      edgeArrow(g, q.x - cam.scrollX, q.y - cam.scrollY, 0xff6ec7);
    }
  }
  // minimap dynamic layer
  m.clear();
  for (let t = 0; t < N * N; t++) {
    const c = FS[t] === 1 ? (Math.random() < 0.5 ? 0xff5a1a : 0xffb02e) : FL[t] && TT[t] ? (G.dis === 3 ? 0x8a6a44 : 0x3fa3c8) : FS[t] ? 0x2a2420 : 0;
    if (!c) continue;
    const i = (t / N) | 0, j = t % N, [x, y] = MP(i + 0.5, j + 0.5);
    m.fillStyle(c, 1);
    m.fillRect(x - 1.5, y - 1, 3, 2);
  }
  for (const p of PEOPLE)
    if (p.st < 3) {
      const [x, y] = MP(p.x, p.y);
      m.fillStyle(0xff6ec7, 1);
      m.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
  const [hx, hy] = MP(h.x, h.y);
  if (Math.sin(G.t * 10) > -0.3) {
    m.fillStyle(0xffffff, 1);
    m.fillCircle(hx, hy, 3);
  }
}

function edgeArrow(g, x, y, c) {
  if (x > 20 && x < SW - 20 && y > 50 && y < SH - 20) return;
  const cx = SW / 2, cy = SH / 2 + 10, a = Math.atan2(y - cy, x - cx);
  const ca = Math.cos(a), sa = Math.sin(a);
  const t = Math.min(Math.abs((SW / 2 - 28) / (ca || 1e-6)), Math.abs((SH / 2 - 48) / (sa || 1e-6)));
  const px = cx + ca * t, py = cy + sa * t, pul = 1 + Math.sin(G.t * 8) * 0.15;
  g.fillStyle(c, 0.95);
  g.fillTriangle(px + ca * 14 * pul, py + sa * 14 * pul, px - sa * 9, py + ca * 9, px + sa * 9, py - ca * 9);
}

// ---------------------------------------------------------------- main loop
function update(time, delta) {
  const dt = Math.min(delta / 1000, 0.05);
  G.t += dt;
  const pr = (c) => held[c] && !G.prev[c];
  const h = G.h;
  let ix = 0, iy = 0, up = false, down = false;

  if (G.st === 'title') {
    // attract mode: autopilot flies over the burning map
    const A = G.auto;
    A.t -= dt;
    if (A.t <= 0 || Math.hypot(A.tx - h.x, A.ty - h.y) < 1.5) {
      A.t = rnd(4, 8);
      A.tx = rnd(5, N - 5);
      A.ty = rnd(5, N - 5);
    }
    h.alt = 1.9;
    const dx = A.tx - h.x, dy = A.ty - h.y, d = Math.hypot(dx, dy) || 1;
    ix = clamp((dx - dy) / d, -1, 1) * 0.7;
    iy = clamp((dx + dy) / d, -1, 1) * 0.7;
    G.U.press.setAlpha(0.55 + 0.45 * Math.sin(G.t * 5));
    if (pr('START1') || pr('P1_1')) startGame();
  } else if (G.st === 'play') {
    ix = (held.P1_R ? 1 : 0) - (held.P1_L ? 1 : 0);
    iy = (held.P1_D ? 1 : 0) - (held.P1_U ? 1 : 0);
    up = held.P1_1 || held.P1_4;
    down = held.P1_2 || held.P1_5;
    G.lt += dt;
  } else if (G.st === 'sum') {
    G.sumT -= dt;
    if (G.sumT <= 0 || (G.sumT < 3 && (pr('P1_1') || pr('START1')))) startLevel(G.level + 1);
  } else if (G.st === 'name') {
    nameStep(pr);
  } else if (G.st === 'over') {
    G.overT += dt;
    G.U.press.setAlpha(0.55 + 0.45 * Math.sin(G.t * 5));
    if (G.overT > 1.5 && (pr('START1') || pr('P1_1'))) {
      buildLevel(1, true);
      showTitle();
    }
  }

  if (G.st !== 'sum') {
    heliStep(dt, ix, iy, up, down);
    fireStep(dt);
    if (G.dis === 2) tsunamiStep(dt);
    if (G.dis === 0) quakeStep(dt);
    if (G.dis === 3) mudStep(dt);
  }
  peopleStep(dt, G.st === 'play' || G.st === 'title');

  if (G.st === 'play') {
    // unloading at the helipad
    hangStep(dt);
    if ((h.landed || h.z - h.gz < 0.9) && onPad(h) && (h.pass > 0 || G.hang.length)) {
      h.ut -= dt;
      if (h.ut <= 0) {
        h.ut = 0.3;
        const hg = G.hang.length > 0;
        const p = hg ? G.hang.pop() : PEOPLE.find((q) => q.st === 3);
        if (!hg) h.pass--;
        if (p) {
          p.st = 8;
          p.x = h.x + rnd(-0.25, 0.25);
          p.y = h.y + rnd(-0.25, 0.25);
          p.wt = rnd(0.9, 1.4);
        }
        G.rescued++;
        const pts = (hg ? 150 : 100) * G.level;
        G.score += pts;
        SND.unload();
        popup(h.x, h.y, '+' + pts, '#e1ff00');
      }
    }
    // contextual hints
    const ground = PEOPLE.filter((p) => p.st < 3 || p.st === 6).length;
    const load = h.pass + G.hang.length;
    let hint = 'JOYSTICK: VOLAR   ·   BOTÓN 1: SUBIR   ·   BOTÓN 2: BAJAR';
    if (G.danger) hint = '¡SE ESTÁN SOLTANDO! VUELA SUAVE, BAJO Y LEJOS DEL FUEGO';
    else if (load >= CAP + HANG) hint = '¡LLENO! VUELVE AL HELIPUERTO (H)';
    else if (h.landed && !onPad(h)) hint = 'EMBARCANDO...  BOTÓN 1 PARA SUBIR';
    else if (h.pass >= CAP) hint = 'CABINA LLENA: VUELA BAJO SOBRE LA GENTE PARA QUE SE CUELGUEN';
    else if (load > 0 && !ground) hint = 'LLEVA A LOS PASAJEROS AL HELIPUERTO (H)';
    G.U.hint.setText(hint);
    checkLevelEnd(ground);
  }

  // rotor sound
  if (AU.rotor) {
    const v = G.st === 'title' || G.st === 'over' ? 0.05 : h.landed ? 0.06 : 0.17;
    AU.rotor.gain.value += (v - AU.rotor.gain.value) * Math.min(1, dt * 4);
    AU.rsrc.playbackRate.value = h.landed ? 0.75 : 1 + Math.hypot(h.vx, h.vy) * 0.03;
  }

  // camera follows helicopter with look-ahead
  const cam = S.cameras.main, c = P(h.x + h.vx * 0.5, h.y + h.vy * 0.5, h.z);
  const k = Math.min(1, dt * 3.5);
  cam.scrollX += (c.x - SW / 2 - cam.scrollX) * k;
  cam.scrollY += (c.y - SH / 2 + 30 - cam.scrollY) * k;

  drawHeli();
  drawPeople();
  fxStep(dt);
  if (G.st === 'play' || G.st === 'sum') drawHud();
  if (G.msgT > 0) {
    G.msgT -= dt;
    G.U.msg.setAlpha(Math.min(1, G.msgT * 2));
  }
  for (const k2 in CABINET_KEYS) G.prev[k2] = !!held[k2];
}

function checkLevelEnd(ground) {
  const h = G.h;
  if (G.lt < 3 || h.pass > 0 || G.hang.length) return;
  if (ground > 0 && active()) return;
  // fire is out (survivors stay safe) or nobody is left on the ground
  G.survived = ground;
  for (const p of PEOPLE) if (p.st < 3) p.st = 4;
  // the run ends when the helicopter could not save anyone in a level
  if (G.rescued === 0) return gameOver();
  const surv = G.survived * 25 * G.level;
  const perfect = G.lost === 0 ? 500 * G.level : 0;
  G.score += surv + perfect;
  G.st = 'sum';
  G.sumT = 6;
  SND.level();
  const U = G.U;
  U.ban.setText('NIVEL ' + G.level + ' SUPERADO').setVisible(true).setAlpha(1);
  S.tweens.killTweensOf([U.ban, U.ban2]);
  U.ban2.setVisible(false);
  U.sumL
    .setText(
      'RESCATADOS    ' + G.rescued + '\n' + 'SOBREVIVIENTES ' + G.survived + '  (+' + surv + ')\n' + 'PERDIDOS      ' + G.lost +
        (perfect ? '\n\n¡SIN PÉRDIDAS!  +' + perfect : '') + '\n\nPUNTOS  ' + G.score
    )
    .setVisible(true);
}

function gameOver() {
  G.st = 'over';
  G.overT = 0;
  SND.over();
  setGroup(PLAY_UI, false);
  G.miniImg.setVisible(false);
  setGroup(['ban', 'ban2', 'sumL'], false);
  setGroup(['ov', 'title', 'sub', 'press', 'bestT'], true);
  G.U.title.setText('FIN DEL JUEGO');
  G.U.sub.setText('Nadie llegó al helipuerto.  Llegaste al nivel ' + G.level + '  ·  ' + G.score + ' puntos');
  G.U.press.setText('START PARA VOLVER');
  refreshTitle();
  const T = G.top;
  if (G.score > 0 && (T.length < 5 || G.score > T[T.length - 1].s)) {
    G.st = 'name';
    G.nm = [0, 0, 0];
    G.nc = 0;
    G.U.title.setText('¡NUEVO RÉCORD!');
    G.U.bestT.setText('JOYSTICK ARRIBA / ABAJO: LETRA     BOTÓN 1: SIGUIENTE');
    showName();
  }
}

function showName() {
  G.U.press.setText(G.nm.map((c, i) => (i === G.nc ? '[' : ' ') + String.fromCharCode(65 + c) + (i === G.nc ? ']' : ' ')).join(' '));
}

function nameStep(pr) {
  if (pr('P1_U')) G.nm[G.nc] = (G.nm[G.nc] + 1) % 26;
  if (pr('P1_D')) G.nm[G.nc] = (G.nm[G.nc] + 25) % 26;
  if (pr('P1_L')) G.nc = Math.max(0, G.nc - 1);
  if (pr('P1_R')) G.nc = Math.min(2, G.nc + 1);
  if (pr('P1_1') || pr('START1')) {
    if (G.nc < 2) G.nc++;
    else {
      G.top.push({ n: G.nm.map((c) => String.fromCharCode(65 + c)).join(''), s: G.score, l: G.level });
      G.top.sort((a, b) => b.s - a.s);
      G.top = G.top.slice(0, 5);
      getStorage().set(TOP_KEY, G.top);
      SND.unload();
      G.st = 'over';
      G.overT = 0;
      G.U.title.setText('FIN DEL JUEGO');
      G.U.press.setText('START PARA VOLVER');
      refreshTitle();
      return;
    }
  }
  showName();
}

// ---------------------------------------------------------------- tsunami & earthquake
function setupDisaster() {
  G.ts = { n: -1, done: true };
  G.qk = { done: true, dur: 0 };
  if (G.dis === 2) {
    const top = 1.5 + 0.35 * G.tier;
    DST = new Int16Array(N * N).fill(999);
    const q = [];
    for (let t = 0; t < N * N; t++) if (TT[t] === T_WATER) {
      DST[t] = 0;
      q.push(t);
    }
    for (let k = 0; k < q.length; k++) {
      const t = q[k], i = (t / N) | 0, j = t % N;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = i + a, v = j + b, w = u * N + v;
        if (u < 0 || v < 0 || u >= N || v >= N || DST[w] <= DST[t] + 1 || TA[w] >= top) continue;
        DST[w] = DST[t] + 1;
        q.push(w);
      }
    }
    G.ts = { n: -1, t: 7, front: -1, lv: 0, top, cnt: 4 + G.tier, sp: 3 + G.tier * 0.5, iv: Math.max(9, 14 - G.tier * 1.5), done: false };
  }
  if (G.dis === 0) G.qk = { n: 0, k: 5 + G.tier, t: 5, dur: 0, nb: 0, bt: 0, done: false };
  MUD = new Float32Array(N * N);
  G.al = { done: true, rain: 0 };
  if (G.dis === 3) {
    // mudflow sources: high ravines on the mountain side
    const src = [];
    for (let k = 0; src.length < 3 + G.tier && k < 400; k++) {
      const t = tileAt(rnd(2, N - 2), rnd(2, N - 2));
      if (TA[t] > 1.8 && TA[t] < 3.4 && Math.hypot(((t / N) | 0) - G.pad.x, (t % N) - G.pad.y) > 9 && !src.some((u) => Math.hypot(((u / N) | 0) - ((t / N) | 0), (u % N) - (t % N)) < 6)) src.push(t);
    }
    G.al = { n: -1, t: 7, cnt: 3 + G.tier, inj: 0, acc: 0, rain: 0.3, src, done: false };
  }
}

const active = () => (G.dis === 1 ? BURN.length > 0 : G.dis === 2 ? !G.ts.done : G.dis === 3 ? !G.al.done : !G.qk.done || BURN.length > 0);

function tsunamiStep(dt) {
  const T = G.ts;
  if (T.done) return;
  T.t -= dt;
  if (T.t < 3 && !T.warn && T.n + 1 < T.cnt) {
    T.warn = true;
    msg('¡VIENE UNA OLA!', 0x6fd3ff, 2.8);
  }
  if (T.t <= 0) {
    if (T.n + 1 < T.cnt) {
      T.n++;
      T.lv = (T.top * (T.n + 1)) / T.cnt;
      T.front = 0;
      T.t = T.iv;
      T.warn = false;
      SND.wave();
    } else T.done = true;
  }
  if (T.front < 0) return;
  T.front += dt * T.sp;
  for (let t = 0; t < N * N; t++) {
    if (DST[t] > T.front || WZ[t] >= T.lv || TA[t] >= T.lv) continue;
    if (!FL[t]) {
      FL[t] = 1;
      FU[t] = 0;
      evac(t, '¡AGUA! DESPEGUE DE EMERGENCIA');
    }
    WZ[t] = T.lv;
    if (T.lv - TA[t] > 0.25) for (const o of TOB[t]) if (o.kind === 'house' && !o.dead) {
      o.dead = 1;
      o.img.setTexture('hb').setTint(0x9ab4c4);
    }
  }
  if (T.front > 90) T.front = -1;
}

function drawFlood(w, cam) {
  const T = G.ts;
  for (let t = 0; t < N * N; t++) {
    const z = WZ[t];
    if (!z) continue;
    const i = (t / N) | 0, j = t % N, c = P(i + 0.5, j + 0.5, z);
    if (c.x < cam.x - 40 || c.x > cam.right + 40 || c.y < cam.y - 30 || c.y > cam.bottom + 60) continue;
    const m = G.dis === 3, V = (a, b) => P(a, b, m ? Math.max(0, HVI(a, b)) + MUD[t] : z);
    const q = [V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)];
    w.fillStyle(m ? mix(0x9a7650, 0x5a3e26, clamp(MUD[t] / 0.6, 0, 1)) : mix(0x4fb3d8, 0x1b4a75, clamp((z - TA[t]) / 1.6, 0, 1)), m ? 0.95 : 0.92);
    w.fillPoints(q, true);
    if (!m && (i === N - 1 || j === N - 1)) {
      w.fillStyle(0x1d4f7a, 0.95);
      const e = i === N - 1 ? [P(N, j, z), P(N, j + 1, z), P(N, j + 1, 0), P(N, j, 0)] : [P(i, N, z), P(i + 1, N, z), P(i + 1, N, 0), P(i, N, 0)];
      w.fillPoints(e, true);
    }
    const f = T.front >= 0 ? Math.abs(DST[t] - T.front) : 9;
    if (f < 1.3) {
      w.fillStyle(0xffffff, 0.75 * (1 - f / 1.3));
      w.fillPoints(q, true);
      if (Math.random() < 0.08 && TA[t] > 0) G.spray.emitParticleAt(c.x + rnd(-10, 10), c.y, 1);
    } else if (Math.sin(G.t * 1.5 + hash(i, j) * 40) > 0.9) {
      w.lineStyle(1.2, m ? 0xc8a070 : 0xd8f3ff, 0.5);
      w.lineBetween(c.x - 5, c.y, c.x + 5, c.y);
    }
  }
}

function quakeStep(dt) {
  const Q = G.qk;
  Q.t -= dt;
  if (Q.dur > 0) {
    Q.dur -= dt;
    Q.bt -= dt;
    if (Q.bt <= 0 && Q.nb > 0) {
      Q.nb--;
      Q.bt = rnd(0.15, 0.5);
      boulder();
    }
  } else if (Q.t <= 0 && Q.n < Q.k) {
    Q.n++;
    Q.t = rnd(9, 12) - G.tier;
    Q.dur = 2.2 + Q.n * 0.25;
    Q.nb = 1 + Q.n + G.tier;
    S.cameras.main.shake(Q.dur * 1000, 0.003 + 0.0012 * Q.n);
    SND.rumble(Q.dur);
    msg(Q.n === 1 ? '¡TERREMOTO!' : '¡RÉPLICA!', 0xffb02e);
    for (const l of TOB) for (const o of l) if (o.kind === 'house' && !o.dead && Math.random() < 0.2 + 0.08 * Q.n) collapse(o);
    fissure();
  }
  for (let k = BOULD.length - 1; k >= 0; k--) {
    const b = BOULD[k];
    b.life += dt;
    const gx = (gh(b.x + 0.3, b.y) - gh(b.x - 0.3, b.y)) / 0.6, gy = (gh(b.x, b.y + 0.3) - gh(b.x, b.y - 0.3)) / 0.6;
    b.vx += (-gx * 9 - b.vx * 0.5) * dt;
    b.vy += (-gy * 9 - b.vy * 0.5) * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const sp = Math.hypot(b.vx, b.vy);
    const off = b.x < 0.3 || b.y < 0.3 || b.x > N - 0.3 || b.y > N - 0.3 || TT[tileAt(b.x, b.y)] === T_WATER;
    if (off) b.img.destroy();
    if (off || (b.life > 1.5 && sp < 0.25) || b.life > 14) {
      BOULD.splice(k, 1);
      continue;
    }
    const q = P(b.x, b.y, gh(b.x, b.y));
    b.img.setPosition(q.x, q.y - 6).setDepth(b.x + b.y + 0.2);
    b.img.rotation += sp * dt * 3 * (b.vx > b.vy ? 1 : -1);
    if (sp > 0.8 && Math.random() < dt * 10) G.smoke.emitParticleAt(q.x, q.y, 1);
    for (const p of PEOPLE) if (p.st < 3 && Math.hypot(p.x - b.x, p.y - b.y) < 0.42) kill(p);
  }
  Q.done = Q.n >= Q.k && Q.t <= 0 && Q.dur <= 0 && !BOULD.length;
}

function boulder() {
  let x = rnd(1, N - 1), y = rnd(1, N - 1);
  for (let k = 0; k < 40; k++) {
    x = rnd(1, N - 1);
    y = rnd(1, N - 1);
    if (TA[tileAt(x, y)] > 1.6) break;
  }
  const img = S.add.image(0, 0, 'rock').setOrigin(0.5, 0.6).setScale(rnd(0.9, 1.5));
  G.rocks.push(img);
  BOULD.push({ x, y, vx: 0, vy: 0, life: 0, img });
}

function collapse(o) {
  o.dead = 1;
  o.img.setTexture('hb');
  const q = P(o.x, o.y, gh(o.x, o.y));
  G.smoke.emitParticleAt(q.x, q.y - 6, 10);
  for (const p of PEOPLE) if (p.st < 3 && Math.hypot(p.x - o.x, p.y - o.y) < 1.1) p.tr = 1;
  if (Math.random() < 0.25) ignite(tileAt(o.x, o.y));
}

function fissure() {
  let x = rnd(3, N - 3), y = rnd(3, N - 3), a = rnd(7);
  const g = G.tmp, pts = [];
  for (let k = 0; k < 8; k++) {
    const t = tileAt(x, y);
    if (TT[t] === T_WATER || TT[t] === T_PAD) break;
    OCC[t] = OCC[t] || 3;
    pts.push(P(x, y, gh(x, y)));
    a += rnd(-0.8, 0.8);
    x = clamp(x + Math.cos(a) * 0.8, 0.5, N - 0.5);
    y = clamp(y + Math.sin(a) * 0.8, 0.5, N - 0.5);
  }
  if (pts.length < 2) return;
  g.lineStyle(4, 0x15100c, 0.95);
  g.strokePoints(pts, false);
  g.lineStyle(1, 0x8a6a4a, 0.8);
  g.strokePoints(pts.map((p) => ({ x: p.x + 1, y: p.y + 2 })), false);
  G.scorchDirty = true;
}

// ---------------------------------------------------------------- mudslide (aluvión)
function mudStep(dt) {
  const A = G.al;
  if (A.done) return;
  A.t -= dt;
  const more = A.n + 1 < A.cnt;
  if (A.t < 4 && !A.warn && more) {
    A.warn = true;
    msg('¡LLUVIA INTENSA! SE VIENE UN ALUVIÓN', 0xc8a070, 3);
  }
  if (A.t <= 0 && more) {
    A.n++;
    A.t = Math.max(9, 14 - G.tier);
    A.inj = 4.5;
    A.warn = false;
    SND.rumble(3.5);
    msg('¡ALUVIÓN! EL BARRO BAJA POR LA QUEBRADA', 0xc8a070);
  }
  if (!more && A.t < -10) A.done = true;
  A.rain += ((A.inj > 0 || (A.t < 4 && more) ? 1 : 0.3) - A.rain) * Math.min(1, dt);
  A.acc += dt;
  while (A.acc > 0.1) {
    A.acc -= 0.1;
    flowStep(A);
  }
}

function flowStep(A) {
  if (A.inj > 0) {
    A.inj -= 0.1;
    for (const t of A.src) MUD[t] += 0.24 * (1 + 0.2 * G.tier);
  }
  const NM = Float32Array.from(MUD);
  for (let t = 0; t < N * N; t++) {
    const m = MUD[t];
    if (m < 0.005) continue;
    const i = (t / N) | 0, j = t % N, h0 = TA[t] + m;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const u = i + a, v = j + b;
      if (u < 0 || v < 0 || u >= N || v >= N || TT[u * N + v] === T_PAD) continue;
      const w = u * N + v, d = h0 - Math.max(0, TA[w]) - MUD[w];
      if (d > 0.012) {
        const f = Math.min(m * 0.24, d * 0.35);
        NM[t] -= f;
        NM[w] += f;
      }
    }
  }
  for (let t = 0; t < N * N; t++) {
    const m = (MUD[t] = TT[t] === T_WATER ? 0 : NM[t] * 0.999);
    if (m > 0.06) {
      if (!FL[t]) {
        FL[t] = 1;
        FU[t] = 0;
        evac(t, '¡BARRO! DESPEGUE DE EMERGENCIA');
      }
      WZ[t] = Math.max(0.01, TA[t] + m);
      if (m > 0.22) for (const o of TOB[t]) if (!o.dead) {
        o.dead = 1;
        if (o.kind === 'house') o.img.setTexture('hb');
        o.img.setTint(0x9a7650);
      }
    } else if (FL[t] && m < 0.03) FL[t] = WZ[t] = 0;
  }
}

new Phaser.Game(config);

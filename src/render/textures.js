// Procedural 16x16 pixel-art textures: the block atlas, item sprites and crack overlays.
import { TILES, TILE_INDEX, ATLAS_TILES_PER_ROW, BLOCKS } from '../world/blocks.js';
import { mulberry32 } from '../world/noise.js';
import { ITEMS, TOOL_MATERIALS, ARMOR_MATERIALS } from '../items.js';
import { ITEM_GRASS, ITEM_FOLIAGE, ITEM_WATER } from '../world/biomeColors.js';

const T = 16;

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

class Painter {
  constructor(data, stride, ox, oy, rand) {
    this.data = data;
    this.stride = stride;
    this.ox = ox;
    this.oy = oy;
    this.rand = rand;
  }

  px(x, y, c, a = c ? c[3] ?? 255 : 255) {
    if (!c || x < 0 || y < 0 || x >= T || y >= T) return;
    const i = ((this.oy + y) * this.stride + this.ox + x) * 4;
    this.data[i] = clamp(c[0]);
    this.data[i + 1] = clamp(c[1]);
    this.data[i + 2] = clamp(c[2]);
    this.data[i + 3] = clamp(a);
  }

  get(x, y) {
    const i = ((this.oy + y) * this.stride + this.ox + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  fill(fn) {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const c = fn(x, y);
      if (c) this.px(x, y, c);
    }
  }

  noise(base, amount, a = 255) {
    this.fill(() => shade(base, (this.rand() - 0.5) * amount, a));
  }

  line(x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, typeof c === 'function' ? c(x0, y0) : c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  rect(x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.px(x, y, typeof c === 'function' ? c(x, y) : c);
  }
}

function shade(c, d, a = 255) {
  return [c[0] + d, c[1] + d, c[2] + d, a];
}

function mul(c, f, a = 255) {
  return [c[0] * f, c[1] * f, c[2] * f, a];
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 255];
}

// Alpha value that marks a texel as tintable: the chunk shader multiplies it by the biome colour.
const TINTED = 254;

function gray(v, a = TINTED) {
  return [v, v, v, a];
}

// ---------- reusable painters ----------
const C = {
  stone: [125, 125, 125],
  dirt: [134, 96, 67],
  grass: [100, 165, 60],
  oakPlanks: [162, 130, 78],
  birchPlanks: [200, 183, 125],
  sprucePlanks: [115, 85, 50],
  sand: [219, 207, 160],
  snow: [242, 250, 250],
};

// Smooth tileable noise for this painter's tile (0..1 per texel).
function tileField(p, blur = 1) {
  return tileNoise(Math.floor(p.rand() * 1e9), blur);
}

// Minecraft-style stone: soft blotches in a few grey tones with scattered dark specks.
function stone(p, base = C.stone) {
  const n = tileField(p);
  p.fill((x, y) => {
    const v = n[x + y * T] * 0.75 + p.rand() * 0.25;
    let d = v < 0.3 ? -16 : v < 0.52 ? -5 : v < 0.78 ? 5 : 14;
    if (p.rand() < 0.05) d = -24;
    return shade(base, d);
  });
}

function dirt(p, base = C.dirt) {
  const n = tileField(p);
  p.fill((x, y) => {
    const v = n[x + y * T] * 0.6 + p.rand() * 0.4;
    const r = p.rand();
    if (r < 0.07) return mul(base, 0.66);
    if (r > 0.95) return mul(base, 1.22);
    return mul(base, v < 0.35 ? 0.86 : v < 0.65 ? 0.97 : 1.07);
  });
}

// Four boards, three texels of wood over a dark seam, with staggered end joints and grain streaks.
function planks(p, base) {
  const joints = [3, 11, 7, 14];
  const grain = new Float32Array(T * T).fill(1);
  for (let row = 0; row < 4; row++) {
    for (let line = 0; line < 3; line++) {
      const y = row * 4 + line;
      const n = 1 + Math.floor(p.rand() * 2);
      for (let k = 0; k < n; k++) {
        const x0 = Math.floor(p.rand() * T);
        const len = 3 + Math.floor(p.rand() * 6);
        const f = p.rand() < 0.65 ? 0.86 : 1.08;
        for (let i = 0; i < len; i++) grain[((x0 + i) % T) + y * T] = f;
      }
    }
  }
  p.fill((x, y) => {
    const row = y >> 2;
    if (y % 4 === 3) return mul(base, 0.64);
    if (x === joints[row]) return mul(base, 0.72);
    if (x === (joints[row] + 1) % T) return mul(base, 1.1);
    const top = y % 4 === 0 ? 1.04 : 1;
    return mul(base, grain[x + y * T] * top * (0.97 + p.rand() * 0.06));
  });
}

// Bark: irregular vertical streaks in three tones.
function logSide(p, bark, stripe = 0.8) {
  const tones = [mul(bark, stripe * 0.92), mul(bark, 0.9), bark, mul(bark, 1.12)];
  for (let x = 0; x < T; x++) {
    let t = Math.floor(p.rand() * tones.length);
    const start = Math.floor(p.rand() * T);
    for (let k = 0; k < T; k++) {
      const y = (start + k) % T;
      if (p.rand() < 0.22) t = Math.max(0, Math.min(tones.length - 1, t + (p.rand() < 0.5 ? -1 : 1)));
      p.px(x, y, shade(tones[t], (p.rand() - 0.5) * 6));
    }
  }
}

// Log end: rounded growth rings inside a ring of bark.
function logTop(p, inner, bark) {
  p.fill((x, y) => {
    const dx = Math.abs(x - 7.5);
    const dy = Math.abs(y - 7.5);
    const cheb = Math.max(dx, dy);
    if (cheb > 6.5) return mul(bark, 0.85 + p.rand() * 0.25);
    const d = Math.hypot(dx, dy) * 0.8 + cheb * 0.2;
    const ring = Math.floor(d / 1.6) % 2 === 0;
    return mul(inner, (ring ? 1.04 : 0.86) * (0.97 + p.rand() * 0.06));
  });
}

// Leaf clumps: lit on their upper left, with see-through gaps between them.
function leafPattern(p, tone) {
  const n = tileField(p);
  const at = (x, y) => n[((x + T) % T) + ((y + T) % T) * T];
  p.fill((x, y) => {
    const v = at(x, y) * 0.7 + p.rand() * 0.3;
    if (v < 0.27) return [0, 0, 0, 0];
    const lit = at(x - 1, y - 1) < at(x, y) - 0.04;
    const dim = at(x + 1, y + 1) < at(x, y) - 0.04;
    return tone(lit ? 1.18 : dim ? 0.74 : v > 0.7 ? 1.05 : 0.92);
  });
}

function leaves(p, base) {
  leafPattern(p, (f) => mul(base, f));
}

// Greyscale leaves that take the biome foliage colour.
function tintedLeaves(p) {
  leafPattern(p, (f) => gray(Math.min(250, 168 * f)));
}

// Ore: stone with a few separate clusters of ore, each lit from the top left.
const ORE_CLUSTERS = [
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [1, 1]],
  [[1, 0], [0, 1], [1, 1], [2, 1], [2, 2], [1, 2]],
  [[0, 0], [0, 1], [1, 1]],
];
function ore(p, spec) {
  stone(p);
  const hi = mix(spec, [255, 255, 255], 0.38);
  const dark = mul(spec, 0.62);
  const centres = [];
  for (let tries = 0; tries < 200 && centres.length < 5; tries++) {
    const cx = 1 + Math.floor(p.rand() * 12);
    const cy = 1 + Math.floor(p.rand() * 12);
    if (centres.every(([x, y]) => Math.abs(x - cx) + Math.abs(y - cy) > 5)) centres.push([cx, cy]);
  }
  for (const [cx, cy] of centres) {
    const shape = ORE_CLUSTERS[Math.floor(p.rand() * ORE_CLUSTERS.length)];
    const has = (x, y) => shape.some(([a, b]) => a === x && b === y);
    for (const [x, y] of shape) {
      const s = (has(x, y - 1) ? 0 : 1) + (has(x - 1, y) ? 0 : 1) - (has(x, y + 1) ? 0 : 1) - (has(x + 1, y) ? 0 : 1);
      p.px(cx + x, cy + y, s > 0 ? hi : s < 0 ? dark : spec);
    }
  }
}

// Rounded stones (a tileable Voronoi pattern), each shaded light on top-left and dark on
// bottom-right, separated by dark mortar.
function pebbles(p, count, tones, mortar, gap = 1.1) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([p.rand() * 16, p.rand() * 16, tones[Math.floor(p.rand() * tones.length)]]);
  p.fill((x, y) => {
    let d1 = 1e9;
    let d2 = 1e9;
    let best = 0;
    let bdx = 0;
    let bdy = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16) {
        const dx = x + 0.5 - pts[i][0] - ox;
        const dy = y + 0.5 - pts[i][1] - oy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; best = i; bdx = dx; bdy = dy; } else if (d < d2) d2 = d;
      }
    }
    if (d2 - d1 < gap) return shade(mortar, (p.rand() - 0.5) * 8);
    const base = pts[best][2];
    const edge = d2 - d1 < gap + 1.6;
    const lightness = -(bdx + bdy) / (d1 + 0.5);
    let f = 1;
    if (edge && lightness > 0.4) f = 1.2;
    else if (edge && lightness < -0.4) f = 0.78;
    return mul(base, f * (0.95 + p.rand() * 0.1));
  });
}

function cobble(p) {
  pebbles(p, 12, [[116, 116, 116], [130, 130, 130], [104, 104, 104], [142, 142, 142]], [74, 74, 74], 0.8);
}

function bordered(p, base, border, noiseAmt = 10) {
  p.fill((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return border;
    return shade(base, (p.rand() - 0.5) * noiseAmt);
  });
}

function sapling(p, leaf, stem, spruce) {
  p.fill(() => [0, 0, 0, 0]);
  p.rect(7, 10, 8, 15, (x) => (x === 7 ? stem : mul(stem, 0.8)));
  for (let y = 1; y < 12; y++) {
    const w = spruce ? Math.floor((y - 1) / 2) + 1 : Math.round(Math.sqrt(Math.max(0, 25 - (y - 6) * (y - 6))));
    for (let x = 8 - w; x < 8 + w; x++) {
      if (p.rand() < 0.2) continue;
      p.px(x, y, mul(leaf, 0.8 + p.rand() * 0.35));
    }
  }
}

function wheat(p, stage) {
  p.fill(() => [0, 0, 0, 0]);
  const height = [4, 7, 11, 14][stage];
  const color = stage === 3 ? [200, 175, 70] : stage === 2 ? [140, 170, 50] : [70, 160, 40];
  for (let i = 0; i < 6; i++) {
    const x = 1 + i * 2 + Math.floor(p.rand() * 2);
    const h = height - Math.floor(p.rand() * 3);
    for (let y = 15; y > 15 - h; y--) p.px(x, y, mul(color, 0.8 + p.rand() * 0.3));
    if (stage === 3) {
      for (let y = 15 - h; y < 15 - h + 4; y++) {
        p.px(x - 1, y, [170, 140, 50]);
        p.px(x + 1, y, [220, 190, 90]);
      }
    }
  }
}


// ---------- animated liquids ----------
// Tileable smooth noise on a 16x16 torus, sampled with a drifting offset so frames loop seamlessly.
function tileNoise(seed, blurPasses = 2) {
  const rand = mulberry32(seed);
  let g = new Float32Array(T * T);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  for (let pass = 0; pass < blurPasses; pass++) {
    const n = new Float32Array(T * T);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += g[((x + dx + T) % T) + ((y + dy + T) % T) * T];
        n[x + y * T] = sum / 9;
      }
    }
    g = n;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of g) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < g.length; i++) g[i] = (g[i] - lo) / (hi - lo);
  return g;
}

function sampleWrap(g, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (xx, yy) => g[(((xx % T) + T) % T) + (((yy % T) + T) % T) * T];
  const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return a + (b - a) * fy;
}

const WATER_FRAMES = 32;
const WATER_FPS = 10;
const LAVA_FRAMES = 40;
const LAVA_FPS = 5;
let liquidNoise = null;
function noiseFields() {
  if (!liquidNoise) liquidNoise = [tileNoise(11), tileNoise(23), tileNoise(37, 1), tileNoise(41, 1)];
  return liquidNoise;
}

// Greyscale ripples (tinted blue by the biome water colour), translucent.
function waterFrame(p, f) {
  const [a, b] = noiseFields();
  const t = f / WATER_FRAMES;
  p.fill((x, y) => {
    const v = sampleWrap(a, x + 16 * t, y) * 0.6 + sampleWrap(b, x - 8 * t, y + 16 * t) * 0.4;
    const q = Math.floor(Math.pow(v, 1.4) * 7) / 6;
    const g = 150 + q * 95;
    return [g, g, g, 180];
  });
}

const LAVA_PALETTE = [[140, 26, 4], [178, 40, 6], [210, 66, 8], [232, 100, 14], [246, 140, 26], [252, 180, 46], [255, 218, 96]];

function lavaFrame(p, f) {
  const [, , a, b] = noiseFields();
  const t = f / LAVA_FRAMES;
  p.fill((x, y) => {
    const v = sampleWrap(a, x + 16 * t, y + 16 * t) * 0.55 + sampleWrap(b, x - 16 * t, y) * 0.45;
    const i = Math.max(0, Math.min(LAVA_PALETTE.length - 1, Math.floor(v * LAVA_PALETTE.length)));
    return LAVA_PALETTE[i];
  });
}

const ANIMATED = [
  { tile: 'water', paint: waterFrame, frames: WATER_FRAMES, fps: WATER_FPS },
  { tile: 'lava', paint: lavaFrame, frames: LAVA_FRAMES, fps: LAVA_FPS },
];


function bedBlanket(p) {
  p.fill((x, y) => {
    if (x === 0 || x === 15) return [120, 18, 18];
    return shade([168, 30, 30], (p.rand() - 0.5) * 14 + (y % 5 === 0 ? -10 : 0));
  });
}

// Vertical faces of the bed: blanket over a wooden frame (only the lower 9 rows show).
function bedSide(p, part) {
  const wood = [140, 104, 60];
  p.fill((x, y) => {
    if (part === 'head_end') return y < 7 ? [0, 0, 0, 0] : shade(y === 7 ? [165, 128, 78] : wood, (p.rand() - 0.5) * 10);
    if (y < 7) return [0, 0, 0, 0];
    if (y <= 10) return part === 'head' && x < 5 ? shade([226, 226, 226], (p.rand() - 0.5) * 8) : shade([168, 30, 30], (p.rand() - 0.5) * 12);
    if (y === 11) return [120, 18, 18];
    return shade((x < 3 || x > 12) && y > 12 ? [110, 80, 45] : wood, (p.rand() - 0.5) * 10);
  });
}

function doorPlanks(p) {
  p.fill((x, y) => {
    if (x === 0 || x === 15) return [104, 76, 40];
    const seam = x % 5 === 0;
    return shade(seam ? [140, 108, 62] : C.oakPlanks, (p.rand() - 0.5) * 10 + Math.sin(y * 0.7 + x) * 4);
  });
}

function mushroom(p, cap, spots) {
  p.fill(() => [0, 0, 0, 0]);
  p.rect(7, 10, 8, 15, (x) => (x === 7 ? [226, 218, 200] : [196, 188, 170]));
  for (let y = 5; y <= 10; y++) {
    const w = y === 5 ? 2 : y === 6 ? 3 : 4;
    for (let x = 8 - w; x < 8 + w; x++) {
      if (y === 10 && (x < 5 || x > 10)) continue;
      p.px(x, y, spots && (x + y * 3) % 5 === 0 && y < 9 ? spots : mul(cap, y === 10 ? 0.75 : 0.95 + p.rand() * 0.1));
    }
  }
}

function flower(p, kind, petal, centre) {
  p.fill(() => [0, 0, 0, 0]);
  const stem = [60, 130, 40];
  p.line(7, 15, 7, kind === 'ball' ? 5 : 8, stem);
  p.px(6, 12, [70, 150, 45]);
  p.px(8, 13, [70, 150, 45]);
  if (kind === 'tulip') {
    p.rect(6, 4, 8, 7, (x, y) => (y === 4 && x === 7 ? null : x === 7 ? centre : petal));
    p.px(5, 5, petal);
    p.px(9, 5, petal);
    p.line(5, 11, 8, 9, [70, 150, 45]);
  } else if (kind === 'ball') {
    for (let y = 1; y < 6; y++) for (let x = 5; x < 10; x++) if (Math.hypot(x - 7, y - 3) < 2.6) p.px(x, y, p.rand() < 0.3 ? centre : petal);
  } else if (kind === 'cluster') {
    for (const [x, y] of [[5, 6], [9, 5], [7, 4], [6, 8], [10, 8]]) {
      p.px(x, y, centre);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) p.px(x + dx, y + dy, petal);
    }
  } else if (kind === 'daisy') {
    for (let y = 3; y < 10; y++) for (let x = 4; x < 11; x++) if (Math.hypot(x - 7, y - 6) < 3.2) p.px(x, y, petal);
    p.rect(6, 5, 8, 7, centre);
  } else {
    for (const [x, y] of [[7, 3], [5, 5], [9, 5], [6, 7], [8, 7], [7, 5], [7, 4], [6, 5], [8, 5], [7, 6]]) p.px(x, y, petal);
    p.px(7, 5, centre);
  }
}

// ---------- tile table ----------
const PAINTERS = {
  stone: (p) => stone(p),
  dirt: (p) => dirt(p),
  grass_top: (p) => {
    const n = tileField(p);
    p.fill((x, y) => {
      const v = n[x + y * T] * 0.55 + p.rand() * 0.45;
      return gray(v < 0.3 ? 142 : v < 0.5 ? 160 : v < 0.7 ? 176 : v < 0.85 ? 192 : 210);
    });
  },
  grass_side: (p) => {
    dirt(p);
    // Grass hanging over the dirt in uneven strands.
    const depth = Array.from({ length: T }, () => 3 + Math.floor(p.rand() * 2));
    for (let i = 0; i < 4; i++) depth[Math.floor(p.rand() * T)] = 5 + Math.floor(p.rand() * 2);
    p.fill((x, y) => {
      if (y >= depth[x]) return null;
      const r = p.rand();
      if (y === depth[x] - 1) return gray(r < 0.5 ? 140 : 152);
      return gray(r < 0.2 ? 150 : r > 0.85 ? 206 : 176 + (p.rand() - 0.5) * 14);
    });
  },
  cobblestone: (p) => cobble(p),
  oak_planks: (p) => planks(p, C.oakPlanks),
  birch_planks: (p) => planks(p, C.birchPlanks),
  spruce_planks: (p) => planks(p, C.sprucePlanks),
  bedrock: (p) => p.fill(() => {
    const pal = [[50, 50, 50], [90, 90, 90], [25, 25, 25], [130, 130, 130], [70, 70, 70]];
    return pal[Math.floor(p.rand() * pal.length)];
  }),
  sand: (p) => p.fill(() => {
    const r = p.rand();
    if (r < 0.08) return mul(C.sand, 0.86);
    if (r > 0.93) return mul(C.sand, 1.05);
    return shade(C.sand, (p.rand() - 0.5) * 10);
  }),
  gravel: (p) => pebbles(p, 22, [[136, 128, 126], [112, 106, 104], [158, 150, 146], [124, 112, 104], [96, 94, 94]], [82, 78, 78], 0.7),
  oak_log: (p) => logSide(p, [104, 82, 50]),
  oak_log_top: (p) => logTop(p, [170, 136, 82], [104, 82, 50]),
  birch_log: (p) => {
    p.fill(() => shade([216, 214, 206], (p.rand() - 0.5) * 12));
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(p.rand() * 14);
      const y = Math.floor(p.rand() * 16);
      const len = 2 + Math.floor(p.rand() * 3);
      for (let k = 0; k < len; k++) p.px(x + k, y, [45, 45, 40]);
    }
  },
  birch_log_top: (p) => logTop(p, [205, 188, 130], [216, 214, 206]),
  spruce_log: (p) => logSide(p, [60, 40, 20], 0.75),
  spruce_log_top: (p) => logTop(p, [120, 90, 55], [60, 40, 20]),
  oak_leaves: (p) => tintedLeaves(p),
  birch_leaves: (p) => leaves(p, [88, 116, 58]),
  spruce_leaves: (p) => leaves(p, [56, 90, 56]),
  glass: (p) => p.fill((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [215, 235, 240, 255];
    if ((x === y + 3 && x < 9) || (x === y + 4 && x < 8) || (x === y - 6 && x > 8)) return [255, 255, 255, 170];
    return [0, 0, 0, 0];
  }),
  coal_ore: (p) => ore(p, [35, 35, 35]),
  iron_ore: (p) => ore(p, [216, 175, 147]),
  gold_ore: (p) => ore(p, [250, 235, 80]),
  diamond_ore: (p) => ore(p, [95, 235, 240]),
  water: (p) => waterFrame(p, 0),
  lava: (p) => lavaFrame(p, 0),
  crafting_table_top: (p) => {
    planks(p, C.oakPlanks);
    p.fill((x, y) => {
      if (x === 0 || y === 0 || x === 15 || y === 15) return [90, 62, 35];
      if ((x === 5 || x === 10 || y === 5 || y === 10) && x > 1 && x < 14 && y > 1 && y < 14) return [110, 78, 44];
      return null;
    });
  },
  crafting_table_side: (p) => {
    planks(p, C.oakPlanks);
    p.rect(0, 0, 15, 2, (x, y) => (y === 2 ? [70, 48, 24] : shade([112, 80, 44], (x % 3) * 5)));
    // A saw and a hammer hanging on the side.
    pixmap(p, [
      '................',
      '................',
      '................',
      '...bb...........',
      '..bBBb....kkkkk.',
      '..bBBb....kgggk.',
      '..kssk....kgGgk.',
      '..kssk....kkwkk.',
      '..kssk.....kwk..',
      '..kssk.....kwk..',
      '..ksSk.....kwk..',
      '..ksSk.....kwk..',
      '..ksSk.....kwk..',
      '..ktttk....kWk..',
      '...kkk.....kkk..',
    ], { b: [110, 72, 36], B: [140, 96, 50], k: [48, 32, 16], s: [180, 180, 180], S: [140, 140, 140], t: [120, 120, 120],
      g: [150, 150, 150], G: [200, 200, 200], w: [120, 84, 40], W: [90, 62, 30] });
  },
  crafting_table_front: (p) => {
    planks(p, C.oakPlanks);
    p.rect(0, 0, 15, 2, (x, y) => (y === 2 ? [70, 48, 24] : shade([112, 80, 44], (x % 3) * 5)));
    // Pliers and a mallet.
    pixmap(p, [
      '................',
      '................',
      '................',
      '................',
      '..kkkkkkk.......',
      '..kGGGGgk..kk...',
      '..kkkwkkk.kGgk..',
      '.....kwk..kggk..',
      '.....kwk...kwk..',
      '.....kwk...kwk..',
      '.....kwk..kwk...',
      '.....kwk..kwk...',
      '.....kWk.kwk....',
      '.....kkk.kWk....',
      '.........kkk....',
    ], { k: [48, 32, 16], g: [140, 140, 140], G: [196, 196, 196], w: [120, 84, 40], W: [90, 62, 30] });
  },
  furnace_side: (p) => {
    stone(p, [118, 118, 118]);
    p.rect(0, 0, 15, 0, [78, 78, 78]);
    p.rect(0, 1, 15, 1, [150, 150, 150]);
    p.rect(0, 15, 15, 15, [78, 78, 78]);
  },
  furnace_top: (p) => {
    stone(p, [124, 124, 124]);
    p.fill((x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? [86, 86, 86] : x === 1 || y === 1 ? [150, 150, 150] : null));
  },
  furnace_front: (p) => {
    PAINTERS.furnace_side(p);
    p.rect(3, 2, 12, 5, (x) => shade([100, 100, 100], (x % 2) * 6));
    p.rect(4, 8, 11, 13, [28, 28, 28]);
    p.rect(3, 7, 12, 7, [80, 80, 80]);
  },
  furnace_front_lit: (p) => {
    PAINTERS.furnace_front(p);
    p.rect(4, 8, 11, 13, (x, y) => (y > 9 || p.rand() < 0.5 ? mix([255, 90, 10], [255, 220, 60], p.rand()) : [40, 20, 10]));
  },
  torch: (p) => {
    p.fill(() => [0, 0, 0, 0]);
    p.rect(7, 8, 8, 15, (x) => (x === 7 ? [135, 100, 55] : [100, 72, 38]));
    p.px(7, 6, [255, 240, 150]);
    p.px(8, 6, [255, 200, 60]);
    p.px(7, 7, [255, 170, 40]);
    p.px(8, 7, [240, 130, 20]);
  },
  snow: (p) => p.noise(C.snow, 8),
  snowy_grass_side: (p) => {
    dirt(p);
    const depth = Array.from({ length: T }, () => 3 + Math.floor(p.rand() * 2.4));
    p.fill((x, y) => (y < depth[x] ? shade(C.snow, (p.rand() - 0.5) * 8) : null));
  },
  sandstone_top: (p) => p.noise([216, 203, 155], 8),
  sandstone_side: (p) => p.fill((x, y) => {
    if (y < 3) return shade([222, 210, 165], (p.rand() - 0.5) * 6);
    if (y === 3 || y === 12) return [190, 175, 125];
    if (y > 12) return shade([205, 190, 140], (p.rand() - 0.5) * 10);
    return shade([214, 200, 150], (p.rand() - 0.5) * 10);
  }),
  sandstone_bottom: (p) => p.noise([210, 196, 148], 16),
  cactus_side: (p) => {
    p.fill((x) => {
      if (x === 0 || x === 15) return [40, 80, 20];
      return shade(x % 4 === 1 ? [95, 150, 55] : [70, 125, 40], (p.rand() - 0.5) * 12);
    });
    for (let i = 0; i < 8; i++) p.px(1 + Math.floor(p.rand() * 14), Math.floor(p.rand() * 16), [20, 30, 10]);
  },
  cactus_top: (p) => p.fill((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) return [50, 95, 30];
    return shade(d < 3 ? [120, 170, 70] : [85, 140, 50], (p.rand() - 0.5) * 12);
  }),
  cactus_bottom: (p) => PAINTERS.cactus_top(p),
  tall_grass: (p) => {
    p.fill(() => [0, 0, 0, 0]);
    for (let i = 0; i < 9; i++) {
      const x0 = 1 + Math.floor(p.rand() * 14);
      const h = 5 + Math.floor(p.rand() * 9);
      const lean = p.rand() < 0.5 ? -1 : 1;
      for (let k = 0; k < h; k++) {
        const x = x0 + (k > h * 0.6 ? lean : 0);
        p.px(x, 15 - k, gray(135 + p.rand() * 55));
      }
    }
  },
  poppy: (p) => {
    p.fill(() => [0, 0, 0, 0]);
    p.rect(7, 8, 7, 15, [50, 120, 30]);
    p.px(6, 11, [60, 140, 40]);
    p.px(8, 12, [60, 140, 40]);
    p.rect(5, 4, 9, 7, (x, y) => ((x === 5 || x === 9) && (y === 4 || y === 7) ? null : [200 + p.rand() * 40, 20, 20]));
    p.px(7, 5, [40, 10, 10]);
  },
  dandelion: (p) => {
    p.fill(() => [0, 0, 0, 0]);
    p.rect(7, 9, 7, 15, [60, 130, 30]);
    p.px(8, 12, [60, 140, 40]);
    p.rect(6, 6, 8, 8, () => [250, 225 + p.rand() * 30, 40]);
    p.px(7, 5, [250, 230, 60]);
  },
  dead_bush: (p) => {
    p.fill(() => [0, 0, 0, 0]);
    const brown = [120, 85, 45];
    p.line(7, 15, 7, 8, brown);
    p.line(7, 11, 3, 6, brown);
    p.line(7, 10, 12, 5, brown);
    p.line(4, 7, 2, 3, brown);
    p.line(11, 6, 13, 2, brown);
    p.line(7, 8, 8, 3, brown);
  },
  clay: (p) => p.noise([160, 166, 180], 10),
  bricks: (p) => {
    const tones = Array.from({ length: 8 }, () => [140 + p.rand() * 26, 64 + p.rand() * 14, 48 + p.rand() * 10]);
    p.fill((x, y) => {
      const row = y >> 2;
      if (y % 4 === 3) return shade([168, 160, 152], (p.rand() - 0.5) * 10);
      const off = row % 2 === 0 ? 0 : 4;
      if ((x + off) % 8 === 7) return shade([168, 160, 152], (p.rand() - 0.5) * 10);
      const tone = tones[(row * 2 + Math.floor(((x + off) % 16) / 8)) % 8];
      return mul(tone, (y % 4 === 0 ? 1.12 : 1) * (0.94 + p.rand() * 0.12));
    });
  },
  chest_side: (p) => p.fill((x, y) => {
    if (x === 0 || x === 15 || y === 0 || y === 15 || y === 5) return [75, 48, 20];
    return shade([165, 112, 48], (p.rand() - 0.5) * 14 + (y % 4 === 0 ? -8 : 0));
  }),
  chest_front: (p) => {
    PAINTERS.chest_side(p);
    p.rect(7, 4, 8, 7, [190, 190, 190]);
    p.px(7, 7, [60, 60, 60]);
    p.px(8, 7, [60, 60, 60]);
  },
  chest_top: (p) => bordered(p, [160, 108, 45], [75, 48, 20], 14),
  white_wool: (p) => p.fill((x, y) => shade([232, 232, 232], (p.rand() - 0.5) * 14 + ((x + y) % 4 === 0 ? -8 : 0))),
  stone_bricks: (p) => p.fill((x, y) => {
    if (y === 7 || y === 15) return [85, 85, 85];
    if ((y < 7 && x === 15) || (y > 7 && x === 7)) return [85, 85, 85];
    if (y === 0 || y === 8) return [145, 145, 145];
    return shade([122, 122, 122], (p.rand() - 0.5) * 10);
  }),
  ice: (p) => p.fill((x, y) => {
    if ((x === y + 2 && x < 10) || (x === y - 5 && x > 9) || (x + y === 20 && x > 10)) return [235, 245, 255, 220];
    return shade([150, 185, 245], (p.rand() - 0.5) * 10, 185);
  }),
  obsidian: (p) => p.fill(() => (p.rand() < 0.12 ? [65, 45, 95] : shade([22, 18, 32], (p.rand() - 0.5) * 12))),
  coal_block: (p) => bordered(p, [28, 28, 28], [45, 45, 45], 14),
  iron_block: (p) => p.fill((x, y) => (x === 0 || y === 0 ? [255, 255, 255] : x === 15 || y === 15 ? [170, 170, 170] : shade([220, 220, 220], (p.rand() - 0.5) * 8))),
  gold_block: (p) => p.fill((x, y) => (x === 0 || y === 0 ? [255, 250, 160] : x === 15 || y === 15 ? [200, 150, 30] : shade([250, 210, 60], (p.rand() - 0.5) * 12))),
  diamond_block: (p) => p.fill((x, y) => (x === 0 || y === 0 ? [210, 255, 250] : x === 15 || y === 15 ? [40, 170, 165] : shade([100, 225, 220], (p.rand() - 0.5) * 12))),
  oak_sapling: (p) => sapling(p, [60, 128, 38], [104, 82, 50], false),
  birch_sapling: (p) => sapling(p, [110, 155, 70], [216, 214, 206], false),
  spruce_sapling: (p) => sapling(p, [52, 92, 58], [60, 40, 20], true),
  pumpkin_top: (p) => {
    p.fill((x, y) => shade([205, 120, 25], (p.rand() - 0.5) * 12 + (Math.abs(x - 7.5) > 6 || Math.abs(y - 7.5) > 6 ? -20 : 0)));
    p.rect(7, 6, 8, 9, [90, 70, 30]);
  },
  pumpkin_side: (p) => p.fill((x) => shade([205, 120, 25], (p.rand() - 0.5) * 10 + (x % 5 === 0 ? -30 : 0))),
  pumpkin_face: (p) => {
    PAINTERS.pumpkin_side(p);
    const dark = [45, 25, 5];
    p.rect(3, 4, 5, 6, dark);
    p.rect(10, 4, 12, 6, dark);
    p.rect(3, 10, 12, 11, dark);
    p.rect(5, 12, 10, 12, dark);
  },
  jack_o_lantern: (p) => {
    PAINTERS.pumpkin_side(p);
    const glow = () => [255, 210 + p.rand() * 40, 70];
    p.rect(3, 4, 5, 6, glow);
    p.rect(10, 4, 12, 6, glow);
    p.rect(3, 10, 12, 11, glow);
    p.rect(5, 12, 10, 12, glow);
  },
  farmland: (p) => p.fill((x, y) => shade(y % 4 === 0 ? [85, 55, 30] : [110, 75, 45], (p.rand() - 0.5) * 14)),
  farmland_wet: (p) => p.fill((x, y) => shade(y % 4 === 0 ? [50, 30, 15] : [70, 45, 25], (p.rand() - 0.5) * 10)),

  bed_head_top: (p) => {
    bedBlanket(p);
    p.rect(1, 1, 14, 6, () => shade([226, 226, 226], (p.rand() - 0.5) * 10));
    p.rect(1, 1, 14, 1, [240, 240, 240]);
    p.rect(1, 6, 14, 6, [190, 190, 190]);
  },
  bed_foot_top: (p) => {
    bedBlanket(p);
    p.rect(0, 0, 15, 0, [196, 40, 40]);
  },
  bed_head_end: (p) => bedSide(p, 'head_end'),
  bed_foot_end: (p) => bedSide(p, 'foot_end'),
  bed_side_head: (p) => bedSide(p, 'head'),
  bed_side_foot: (p) => bedSide(p, 'foot'),
  chest_latch: (p) => p.fill((x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? [60, 60, 60] : shade([196, 196, 196], (p.rand() - 0.5) * 20))),
  oak_door_top: (p) => {
    doorPlanks(p);
    for (const [x0, x1] of [[3, 6], [9, 12]]) p.rect(x0, 3, x1, 9, [0, 0, 0, 0]);
    p.rect(2, 2, 13, 2, [104, 76, 40]);
    p.rect(2, 10, 13, 10, [104, 76, 40]);
    p.rect(7, 3, 8, 9, [104, 76, 40]);
    p.rect(2, 3, 2, 9, [104, 76, 40]);
    p.rect(13, 3, 13, 9, [104, 76, 40]);
  },
  oak_door_bottom: (p) => {
    doorPlanks(p);
    p.rect(3, 3, 12, 12, (x, y) => (x === 3 || y === 3 ? [118, 88, 48] : x === 12 || y === 12 ? [175, 140, 88] : null));
    p.rect(12, 0, 13, 1, [70, 70, 70]);
    p.px(12, 2, [110, 110, 110]);
  },
  ladder: (p) => {
    p.fill(() => [0, 0, 0, 0]);
    const rail = (x) => { p.rect(x, 0, x, 15, [126, 96, 56]); p.rect(x + 1, 0, x + 1, 15, [98, 72, 40]); };
    rail(2);
    rail(12);
    for (const y of [1, 5, 9, 13]) {
      p.rect(2, y, 13, y, [140, 108, 64]);
      p.rect(2, y + 1, 13, y + 1, [96, 70, 40]);
    }
  },
  bookshelf: (p) => {
    planks(p, C.oakPlanks);
    const colours = [[150, 40, 40], [45, 70, 150], [60, 120, 50], [120, 80, 40], [110, 50, 120], [180, 150, 60], [40, 110, 110]];
    for (const [y0, y1] of [[2, 6], [9, 13]]) {
      p.rect(0, y0 - 1, 15, y1 + 1, [74, 54, 30]);
      let x = 1;
      while (x < 15) {
        const w = 1 + Math.floor(p.rand() * 2);
        const h = y0 + Math.floor(p.rand() * 2);
        const c = colours[Math.floor(p.rand() * colours.length)];
        p.rect(x, h, Math.min(14, x + w - 1), y1, (xx) => (xx === x ? mul(c, 1.2) : c));
        x += w + (p.rand() < 0.25 ? 1 : 0);
      }
    }
    p.rect(0, 0, 15, 0, [104, 78, 44]);
    p.rect(0, 15, 15, 15, [104, 78, 44]);
  },
  sugar_cane: (p) => {
    p.fill(() => [0, 0, 0, 0]);
    for (const x0 of [2, 7, 11]) {
      for (let y = 0; y < 16; y++) {
        const joint = (y + x0) % 5 === 0;
        p.px(x0, y, gray(joint ? 205 : 170));
        p.px(x0 + 1, y, gray(joint ? 185 : 140));
      }
      p.px(x0 + 2, (x0 * 3) % 16, gray(150));
      p.px(x0 - 1, (x0 * 5 + 3) % 16, gray(160));
    }
  },
  fern: (p) => {
    p.fill(() => [0, 0, 0, 0]);
    for (const [cx, lean] of [[4, -1], [8, 0], [11, 1]]) {
      for (let k = 0; k < 12; k++) {
        const y = 15 - k;
        const x = cx + Math.round(lean * k * 0.25);
        p.px(x, y, gray(140));
        if (k > 2 && k % 2 === 0) { p.px(x - 1, y, gray(170)); p.px(x + 1, y - 1, gray(160)); }
      }
    }
  },
  brown_mushroom: (p) => mushroom(p, [150, 110, 80], null),
  red_mushroom: (p) => mushroom(p, [200, 30, 30], [240, 240, 240]),
  azure_bluet: (p) => flower(p, 'cluster', [236, 236, 236], [236, 200, 60]),
  oxeye_daisy: (p) => flower(p, 'daisy', [240, 240, 240], [230, 190, 40]),
  cornflower: (p) => flower(p, 'star', [70, 100, 220], [40, 50, 140]),
  allium: (p) => flower(p, 'ball', [180, 100, 220], [150, 70, 190]),
  blue_orchid: (p) => flower(p, 'star', [60, 180, 230], [120, 220, 250]),
  red_tulip: (p) => flower(p, 'tulip', [210, 40, 30], [150, 20, 20]),
  orange_tulip: (p) => flower(p, 'tulip', [240, 130, 30], [190, 90, 20]),
  white_tulip: (p) => flower(p, 'tulip', [236, 236, 236], [200, 200, 200]),
  pink_tulip: (p) => flower(p, 'tulip', [240, 160, 200], [210, 120, 170]),
  lily_of_the_valley: (p) => {
    p.fill(() => [0, 0, 0, 0]);
    p.line(7, 15, 7, 5, [60, 130, 40]);
    p.line(7, 5, 11, 3, [60, 130, 40]);
    p.line(8, 15, 4, 8, [80, 150, 50]);
    for (const [x, y] of [[9, 5], [11, 5], [10, 7], [12, 4]]) { p.px(x, y, [245, 245, 245]); p.px(x, y + 1, [220, 220, 220]); }
  },
  smooth_stone: (p) => p.fill((x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? [138, 138, 138] : shade([160, 160, 160], (p.rand() - 0.5) * 8))),
  smooth_stone_slab_side: (p) => p.fill((x, y) => (y === 0 || y === 15 || y === 7 || y === 8 ? (y === 8 ? [168, 168, 168] : [132, 132, 132]) : shade([158, 158, 158], (p.rand() - 0.5) * 8))),
  mossy_cobblestone: (p) => {
    cobble(p);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(p.rand() * 16);
      const y = Math.floor(p.rand() * 16);
      p.rect(x, y, x + (p.rand() < 0.5 ? 1 : 0), y, [70 + p.rand() * 30, 110 + p.rand() * 30, 40]);
    }
  },
  glass_pane_top: (p) => p.fill((x) => (x === 7 || x === 8 ? [215, 235, 240] : [0, 0, 0, 0])),

  acacia_log: (p) => { logSide(p, [104, 98, 88], 0.82); for (let i = 0; i < 10; i++) p.px(Math.floor(p.rand() * 16), Math.floor(p.rand() * 16), [80, 74, 66]); },
  acacia_log_top: (p) => logTop(p, [186, 96, 52], [104, 98, 88]),
  acacia_leaves: (p) => tintedLeaves(p),
  acacia_planks: (p) => planks(p, [170, 92, 50]),
  acacia_sapling: (p) => sapling(p, [120, 150, 40], [104, 98, 88], false),
  jungle_log: (p) => { logSide(p, [88, 66, 34], 0.78); for (let y = 0; y < 16; y += 4) p.line(0, y, 15, y + 1, [70, 52, 26]); },
  jungle_log_top: (p) => logTop(p, [168, 122, 80], [88, 66, 34]),
  jungle_leaves: (p) => { tintedLeaves(p); for (let i = 0; i < 6; i++) p.px(Math.floor(p.rand() * 16), Math.floor(p.rand() * 16), gray(225)); },
  jungle_planks: (p) => planks(p, [160, 115, 80]),
  jungle_sapling: (p) => sapling(p, [50, 140, 30], [88, 66, 34], false),
  dark_oak_log: (p) => logSide(p, [62, 46, 26], 0.8),
  dark_oak_log_top: (p) => logTop(p, [88, 64, 36], [62, 46, 26]),
  dark_oak_leaves: (p) => tintedLeaves(p),
  dark_oak_planks: (p) => planks(p, [70, 46, 22]),
  dark_oak_sapling: (p) => sapling(p, [40, 100, 30], [62, 46, 26], false),
  vine: (p) => {
    p.fill(() => [0, 0, 0, 0]);
    for (let i = 0; i < 7; i++) {
      let x = Math.floor(p.rand() * 16);
      const len = 6 + Math.floor(p.rand() * 10);
      for (let y = 0; y < len; y++) {
        p.px(x, y, gray(130 + p.rand() * 70));
        if (p.rand() < 0.35) p.px(x + 1, y, gray(160 + p.rand() * 60));
        if (p.rand() < 0.2) x += p.rand() < 0.5 ? -1 : 1;
      }
    }
  },
  lily_pad: (p) => {
    p.fill(() => [0, 0, 0, 0]);
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 6.8 || (x > 7 && Math.abs(y - 7.5) < (x - 7) * 0.25)) continue;
      p.px(x, y, d > 6 ? [22, 86, 30] : shade([32, 112, 42], (p.rand() - 0.5) * 16));
    }
  },
  red_sand: (p) => p.noise([190, 102, 33], 18),
  terracotta: (p) => p.noise([152, 94, 67], 10),
  orange_terracotta: (p) => p.noise([162, 84, 38], 10),
  yellow_terracotta: (p) => p.noise([186, 133, 35], 10),
  brown_terracotta: (p) => p.noise([77, 51, 36], 8),
  red_terracotta: (p) => p.noise([143, 61, 47], 10),
  white_terracotta: (p) => p.noise([210, 178, 161], 10),
  light_gray_terracotta: (p) => p.noise([135, 107, 98], 10),
  granite: (p) => p.fill(() => { const r = p.rand(); return r < 0.25 ? [120, 78, 62] : r < 0.4 ? [170, 118, 96] : shade([149, 103, 85], (p.rand() - 0.5) * 16); }),
  diorite: (p) => p.fill(() => { const r = p.rand(); return r < 0.25 ? [126, 126, 128] : r < 0.4 ? [230, 230, 230] : shade([188, 188, 190], (p.rand() - 0.5) * 16); }),
  andesite: (p) => p.fill(() => { const r = p.rand(); return r < 0.2 ? [110, 110, 112] : r < 0.35 ? [150, 150, 152] : shade([136, 136, 137], (p.rand() - 0.5) * 12); }),
  lapis_ore: (p) => ore(p, [30, 70, 180]),
  redstone_ore: (p) => ore(p, [200, 20, 20]),
  emerald_ore: (p) => ore(p, [30, 200, 90]),
  spawner: (p) => p.fill((x, y) => {
    if (x % 5 === 0 || y % 5 === 0 || x === 15 || y === 15) return shade([34, 44, 56], (p.rand() - 0.5) * 16);
    return [0, 0, 0, 0];
  }),
  coarse_dirt: (p) => p.fill(() => { const r = p.rand(); return r < 0.25 ? [100, 72, 50] : r < 0.4 ? [120, 120, 120] : shade(C.dirt, (p.rand() - 0.5) * 18); }),
  podzol_top: (p) => p.fill(() => { const r = p.rand(); return r < 0.3 ? [74, 50, 22] : r < 0.5 ? [122, 88, 40] : shade([98, 68, 30], (p.rand() - 0.5) * 16); }),
  podzol_side: (p) => {
    dirt(p);
    const depth = Array.from({ length: T }, () => 2 + Math.floor(p.rand() * 2));
    p.fill((x, y) => (y < depth[x] ? shade([98, 68, 30], (p.rand() - 0.5) * 16) : null));
  },
  wheat_0: (p) => wheat(p, 0),
  wheat_1: (p) => wheat(p, 1),
  wheat_2: (p) => wheat(p, 2),
  wheat_3: (p) => wheat(p, 3),
};

let atlasCanvas = null;
let itemAtlasCanvas = null;

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

// Tiles that carry a biome tint, with the fixed colour used for items and icons.
function itemTints() {
  const out = new Map();
  const colours = { grass: ITEM_GRASS, foliage: ITEM_FOLIAGE, water: ITEM_WATER };
  for (const b of BLOCKS) {
    if (!b || !b.tint) continue;
    for (const t of Object.values(b.textures)) out.set(t, colours[b.tint]);
  }
  return out;
}

// The world atlas: tintable texels are greyscale with alpha 254 (see chunkShader.js).
export function getAtlasCanvas() {
  if (atlasCanvas) return atlasCanvas;
  const size = ATLAS_TILES_PER_ROW * T;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  TILES.forEach((name, i) => {
    const painter = PAINTERS[name];
    if (!painter) throw new Error('No painter for tile ' + name);
    const p = new Painter(img.data, size, (i % ATLAS_TILES_PER_ROW) * T, Math.floor(i / ATLAS_TILES_PER_ROW) * T, mulberry32(hashStr(name)));
    painter(p);
  });
  ctx.putImageData(img, 0, 0);
  atlasCanvas = canvas;

  // Item atlas: the same tiles with the default biome colours baked in.
  const items = new Uint8ClampedArray(img.data);
  for (const [name, col] of itemTints()) {
    const tile = TILE_INDEX[name];
    const ox = (tile % ATLAS_TILES_PER_ROW) * T;
    const oy = Math.floor(tile / ATLAS_TILES_PER_ROW) * T;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const i = ((oy + y) * size + ox + x) * 4;
        const a = items[i + 3];
        if (a === 0 || a === 255) continue;
        items[i] = (items[i] * col[0]) / 255;
        items[i + 1] = (items[i + 1] * col[1]) / 255;
        items[i + 2] = (items[i + 2] * col[2]) / 255;
        items[i + 3] = 255;
      }
    }
  }
  itemAtlasCanvas = makeCanvas(size, size);
  const ictx = itemAtlasCanvas.getContext('2d');
  const iimg = ictx.createImageData(size, size);
  iimg.data.set(items);
  ictx.putImageData(iimg, 0, 0);
  return canvas;
}

// Atlas for items, icons, particles and held blocks (tints applied with default colours).
export function getItemAtlasCanvas() {
  getAtlasCanvas();
  return itemAtlasCanvas;
}

// Animated tiles (water, lava). Call every frame; returns true when the atlas changed.
let animFrames = null;
export function updateAnimatedTiles(seconds) {
  const canvas = getAtlasCanvas();
  const ctx = canvas.getContext('2d');
  if (!animFrames) {
    animFrames = ANIMATED.map((a) => {
      const frames = [];
      for (let f = 0; f < a.frames; f++) {
        const img = ctx.createImageData(T, T);
        a.paint(new Painter(img.data, T, 0, 0, mulberry32(f)), f);
        frames.push(img);
      }
      const tile = TILE_INDEX[a.tile];
      return { ...a, images: frames, x: (tile % ATLAS_TILES_PER_ROW) * T, y: Math.floor(tile / ATLAS_TILES_PER_ROW) * T, current: 0 };
    });
  }
  let changed = false;
  for (const a of animFrames) {
    const f = Math.floor(seconds * a.fps) % a.frames;
    if (f === a.current) continue;
    a.current = f;
    ctx.putImageData(a.images[f], a.x, a.y);
    changed = true;
  }
  return changed;
}

export function tileRect(tile) {
  return { x: (tile % ATLAS_TILES_PER_ROW) * T, y: Math.floor(tile / ATLAS_TILES_PER_ROW) * T, w: T, h: T };
}

// ---------- crack overlay (10 stages) ----------
export function makeCrackCanvases() {
  const out = [];
  const rand = mulberry32(99);
  const lines = [];
  for (let i = 0; i < 24; i++) {
    const pts = [[7 + Math.floor(rand() * 3) - 1, 7 + Math.floor(rand() * 3) - 1]];
    const dir = rand() * Math.PI * 2;
    for (let k = 0; k < 9; k++) {
      const [x, y] = pts[pts.length - 1];
      const a = dir + (rand() - 0.5) * 1.4;
      pts.push([Math.round(x + Math.cos(a) * 1.6), Math.round(y + Math.sin(a) * 1.6)]);
    }
    lines.push(pts);
  }
  for (let stage = 0; stage < 10; stage++) {
    const c = makeCanvas(T, T);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(T, T);
    const p = new Painter(img.data, T, 0, 0, rand);
    const count = 2 + stage * 2.2;
    const len = 3 + stage;
    for (let i = 0; i < count; i++) {
      const pts = lines[i];
      for (let k = 0; k < Math.min(len, pts.length - 1); k++) {
        p.line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], [20, 20, 20, 200]);
      }
    }
    ctx.putImageData(img, 0, 0);
    out.push(c);
  }
  return out;
}

// ---------- item sprites ----------
// Minecraft item style: every sprite has a dark outline and is lit from the top left.
const STICK = [137, 103, 58];
const STICK_L = [168, 130, 76];

// Five tones of a colour: outline, dark, mid, light and highlight.
function ramp(c) {
  return { o: mul(c, 0.3), d: mul(c, 0.7), m: [c[0], c[1], c[2], 255], l: mul(c, 1.15), h: mix(c, [255, 255, 255], 0.5) };
}

// Adds a dark outline: each empty texel beside the sprite takes a darkened copy of its neighbour.
function outline(p, f = 0.32) {
  const add = [];
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (p.get(x, y)[3] !== 0) continue;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= T || ny >= T) continue;
        const c = p.get(nx, ny);
        if (c[3] === 0) continue;
        add.push([x, y, mul(c, f)]);
        break;
      }
    }
  }
  for (const [x, y, c] of add) p.px(x, y, c);
}

// Fills the texels for which inside(x, y) is true with a ramp, light on the upper-left edges of
// the shape and dark on the lower-right ones.
function shaded(p, inside, r) {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (!inside(x, y)) continue;
      const s = (inside(x, y - 1) ? 0 : 1) + (inside(x - 1, y) ? 0 : 1) - (inside(x, y + 1) ? 0 : 1) - (inside(x + 1, y) ? 0 : 1);
      p.px(x, y, s >= 2 ? r.h : s > 0 ? r.l : s < 0 ? r.d : r.m);
    }
  }
}

function maskFn(rows, ch = '#') {
  return (x, y) => y >= 0 && y < rows.length && x >= 0 && x < rows[y].length && rows[y][x] === ch;
}

// Diagonal stick from the bottom-left corner up to (x1, 15 - x1).
function handle(p, x0, x1) {
  for (let x = x0; x <= x1; x++) p.px(x, 15 - x, x % 2 ? STICK_L : STICK);
}

function blob(p, cx, cy, r, color, rand) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= r) p.px(x, y, mul(color, d > r - 1 ? 0.8 : 0.9 + rand() * 0.2));
  }
}

// Round sprite shaded like a ball lit from the top left.
function ball(p, cx, cy, rx, ry, color, rand, speckle = 0.08) {
  const r = ramp(color);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry;
    const d = dx * dx + dy * dy;
    if (d > 1) continue;
    const lit = -(dx + dy) * 0.7 + (1 - d) * 0.3;
    let c = lit > 0.55 ? r.h : lit > 0.2 ? r.l : lit > -0.35 ? r.m : r.d;
    if (rand() < speckle) c = mul(c, 0.9);
    p.px(x, y, c);
  }
}

const TOOL_HEADS = {
  pickaxe: [
    '................',
    '.....######.....',
    '...#########....',
    '..###....####...',
    '............##..',
    '............###.',
    '............###.',
    '.............##.',
    '.............##.',
    '.............##.',
    '.............##.',
    '............##..',
    '............##..',
    '............#...',
  ],
  axe: [
    '................',
    '.......###......',
    '......######....',
    '.....########...',
    '.....######.##..',
    '.....#####..###.',
    '......###....#..',
    '.......#........',
  ],
  shovel: [
    '................',
    '..........###...',
    '.........#####..',
    '........######..',
    '........#####...',
    '.........###....',
  ],
  hoe: [
    '................',
    '.......######...',
    '......#######...',
    '......##....#...',
    '......#.........',
  ],
};

function tool(p, type, color) {
  const head = ramp(color);
  if (type === 'sword') {
    // Blade along the diagonal, a cross guard, grip and pommel (u runs along the blade, v across).
    const blade = (x, y) => {
      const u = x - y;
      const v = x + y;
      return (v === 15 || v === 16) && u >= -3 && u <= 12;
    };
    shaded(p, blade, head);
    const guard = ramp([74, 52, 26]);
    shaded(p, (x, y) => {
      const u = x - y;
      const v = x + y;
      return (u === -4 || u === -5) && v >= 11 && v <= 20;
    }, guard);
    handle(p, 2, 4);
    p.px(1, 14, guard.l);
    outline(p);
    return;
  }
  const rows = TOOL_HEADS[type];
  handle(p, 2, type === 'shovel' ? 9 : type === 'hoe' ? 12 : 11);
  shaded(p, maskFn(rows), head);
  outline(p);
}

function ingot(p, color) {
  // A bar seen from above: light top face, front face and dark right end.
  pixmap(p, [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....hhhhhhhhl..',
    '....hllllllllmd.',
    '...hllllllllmdd.',
    '..hmmmmmmmmmddd.',
    '..lmmmmmmmmmdd..',
    '..lmmmmmmmmmd...',
    '..dddddddddd....',
  ], ramp(color));
  outline(p);
}

// Meat sprites in Minecraft's layout: food lies diagonally from bottom-left to top-right, lit from
// the top left, with an outline in a darker shade of its own colour.
// Ellipse test with its long axis turned by `angle` (0 = along the bottom-left/top-right diagonal).
function ellipse(cx, cy, ra, rb, angle = 0) {
  const ca = Math.cos(angle - Math.PI / 4);
  const sa = Math.sin(angle - Math.PI / 4);
  return (x, y) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const a = (dx * ca + dy * sa) / ra;
    const b = (-dx * sa + dy * ca) / rb;
    return a * a + b * b <= 1;
  };
}

// Paints the texels of `inside` with colour(x, y) (a palette entry), shaded at the edges.
function food(p, inside, colour) {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      if (!inside(x, y)) continue;
      const s = (inside(x, y - 1) ? 0 : 1) + (inside(x - 1, y) ? 0 : 1) - (inside(x, y + 1) ? 0 : 1) - (inside(x + 1, y) ? 0 : 1);
      const c = colour(x, y);
      p.px(x, y, mul(c, (s > 0 ? 1.1 : s < 0 ? 0.82 : 1) * (0.96 + p.rand() * 0.08)));
    }
  }
}

// Across-axis coordinate for the diagonal food shapes: negative towards the top left.
const across = (x, y, cx, cy) => (x + 0.5 - cx + y + 0.5 - cy) / Math.SQRT2;
const along = (x, y, cx, cy) => (x + 0.5 - cx - (y + 0.5 - cy)) / Math.SQRT2;

// Porkchop: a rounded chop narrowing into a curled tail at the bottom left, with a pale fat rim
// along its upper edge and a lighter streak.
function porkchop(p, pal) {
  const head = ellipse(9.4, 6.6, 5.6, 4.4);
  const tail = ellipse(5, 10.6, 3, 2);
  const tip = (x, y) => (x === 2 && (y === 12 || y === 13)) || (x === 3 && y === 13);
  const inside = (x, y) => head(x, y) || tail(x, y) || tip(x, y);
  food(p, inside, (x, y) => {
    const b = across(x, y, 9.4, 6.6);
    if (!inside(x, y - 1) || (!inside(x - 1, y) && b < 0)) return pal.fat;
    if (b < -2.4) return pal.light;
    if (Math.abs(b - 0.8) < 0.45 && head(x, y)) return pal.light;
    if (b > 2.8) return pal.dark;
    return pal.meat;
  });
  outline(p, 0.42);
}

// Beef: a thick red steak marbled with white fat running along it.
function beef(p, pal) {
  const inside = ellipse(8, 8, 7.4, 5);
  food(p, inside, (x, y) => {
    const b = across(x, y, 8, 8);
    const a = Math.floor(along(x, y, 8, 8) + 10);
    if (b < -3.6) return pal.fat;
    if (Math.abs(b + 1.5) < 0.42 && a % 4 !== 0) return pal.fat;
    if (Math.abs(b - 1.3) < 0.42 && a % 5 > 1) return pal.fat;
    if (b > 3.4) return pal.dark;
    return pal.meat;
  });
  outline(p, 0.42);
}

// Mutton: a chop in the upper right with its bone sticking out to the bottom left.
function mutton(p, pal) {
  const meat = ellipse(9.8, 6.2, 5.6, 4.4);
  const bone = (x, y) => (x + y === 15 || x + y === 16) && x >= 2 && x <= 6;
  const knob = (x, y) => (x === 1 && (y === 12 || y === 13)) || (x === 2 && y === 14) || (x === 3 && y === 14);
  food(p, (x, y) => bone(x, y) || knob(x, y), () => pal.bone);
  food(p, meat, (x, y) => {
    const b = across(x, y, 9.8, 6.2);
    if (b < -2.9 || !meat(x, y - 1) || !meat(x + 1, y)) return pal.fat;
    if (Math.abs(b - 0.4) < 0.45) return pal.light;
    return pal.meat;
  });
  outline(p, 0.42);
}

// Chicken: a plucked bird with its two drumsticks pointing to the upper left.
const CHICKEN = [
  '................',
  '.....bb.........',
  '....bbb.........',
  '.....bLL........',
  '.bb...LLL.......',
  '.bbb...LLSSS....',
  '..bLL..LSSSSSS..',
  '...LLL.SSSSSSSS.',
  '....LLSSSSSSSSS.',
  '.....LSSSSSSSSD.',
  '.....SSSSSSSSSD.',
  '......SSSSSSSDD.',
  '......SSSSSSSD..',
  '.......SSSSDD...',
  '.........DDD....',
];
function chicken(p, pal) {
  const at = (x, y) => (y >= 0 && y < CHICKEN.length && x >= 0 && x < 16 ? CHICKEN[y][x] : '.');
  const colours = { b: pal.bone, L: pal.leg, S: pal.skin, D: pal.dark };
  food(p, (x, y) => at(x, y) !== '.', (x, y) => colours[at(x, y)]);
  outline(p, 0.42);
}

// Rotten flesh: a ragged, greenish strip with dark rot and holes.
function rottenFlesh(p, pal) {
  const inside = (x, y) => ellipse(8, 8, 7.4, 3.6)(x, y) && !((x * 7 + y * 13) % 17 === 0) && !(x === 6 && y === 9) && !(x === 11 && y === 3);
  food(p, inside, (x, y) => {
    const h = (x * 31 + y * 17) % 11;
    if (h === 0 || h === 5) return pal.dark;
    if (h === 3 || h === 8) return pal.green;
    return pal.flesh;
  });
  // Torn edges.
  for (const [x, y] of [[3, 10], [13, 4], [10, 9], [5, 5]]) p.px(x, y, pal.flesh);
  outline(p, 0.42);
}

const BONE = [242, 238, 224];

// Paints a sprite from string rows using a palette of characters ('.' = transparent).
function pixmap(p, rows, pal) {
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const c = pal[rows[y][x]];
      if (c) p.px(x, y, c);
    }
  }
}

const ARMOR_SHAPES = [
  [ // helmet
    '................',
    '................',
    '................',
    '....oooooooo....',
    '...oLLLLLLXXo...',
    '..oLXXXXXXXXDo..',
    '..oLXXXXXXXXDo..',
    '..oXXooooooXDo..',
    '..oXDo....oXDo..',
    '..oXDo....oXDo..',
    '..oooo....oooo..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  [ // chestplate
    '................',
    '..oooo....oooo..',
    '.oLXXXo..oXXXDo.',
    '.oLXXXXooXXXXDo.',
    '.oLXXXXXXXXXXDo.',
    '.oooLXXXXXXDooo.',
    '...oLXXXXXXDo...',
    '...oLXXXXXXDo...',
    '...oLXXXXXXDo...',
    '...oLXXXXXXDo...',
    '...oLXXXXXXDo...',
    '...oLDDDDDDDo...',
    '...oooooooooo...',
    '................',
    '................',
    '................',
  ],
  [ // leggings
    '................',
    '...oooooooooo...',
    '...oLXXXXXXDo...',
    '...oLXXXXXXDo...',
    '...oLXDooLXDo...',
    '...oLXDooLXDo...',
    '...oLXDooLXDo...',
    '...oLXDooLXDo...',
    '...oLXDooLXDo...',
    '...oLXDooLXDo...',
    '...oLXDooLXDo...',
    '...oLXDooLXDo...',
    '...oooooooooo...',
    '................',
    '................',
    '................',
  ],
  [ // boots
    '................',
    '................',
    '................',
    '................',
    '..oooo....oooo..',
    '..oLXo....oLXo..',
    '..oLXo....oLXo..',
    '..oLXo....oLXo..',
    'ooLXXo....oLXXoo',
    'oLXXDo....oLXXDo',
    'oooooo....oooooo',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
];

function armorSprite(p, slot, color) {
  pixmap(p, ARMOR_SHAPES[slot], { X: color, L: mul(color, 1.2), D: mul(color, 0.7), o: mul(color, 0.35) });
}

// Faint silhouette shown in empty armour slots.
export function armorSlotCanvas(slot) {
  const key = `slot:${slot}`;
  if (itemCanvasCache.has(key)) return itemCanvasCache.get(key);
  const c = makeCanvas(T, T);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(T, T);
  pixmap(new Painter(img.data, T, 0, 0, Math.random), ARMOR_SHAPES[slot], { o: [60, 60, 60, 150], X: [120, 120, 120, 90], L: [130, 130, 130, 90], D: [110, 110, 110, 90] });
  ctx.putImageData(img, 0, 0);
  itemCanvasCache.set(key, c);
  return c;
}

// Bow; pull 0..3 draws the string back with an arrow nocked.
function bow(p, pull) {
  const wood = [120, 82, 40];
  const woodL = [160, 116, 62];
  for (let a = Math.PI; a <= Math.PI * 1.5 + 0.001; a += 0.02) {
    const x = Math.round(13 + 11.5 * Math.cos(a));
    const y = Math.round(13 + 11.5 * Math.sin(a));
    p.px(x, y, woodL);
    p.px(x + 1, y + 1, wood);
  }
  const mid = 7 + pull * 1.4;
  const str = [210, 210, 210];
  p.line(12, 2, Math.round(mid), Math.round(mid), str);
  p.line(Math.round(mid), Math.round(mid), 2, 12, str);
  if (pull > 0) {
    const back = Math.round(mid);
    p.line(back - 1, back - 1, Math.max(2, back - 9), Math.max(2, back - 9), [110, 80, 45]);
    p.px(Math.max(1, back - 10), Math.max(1, back - 10), [140, 140, 140]);
    p.px(Math.max(2, back - 9), Math.max(1, back - 10), [110, 110, 110]);
    p.px(back, back, [235, 235, 235]);
    p.px(back + 1, back, [200, 200, 200]);
  }
}

export function getBowCanvas(pull) {
  const key = `bow:${pull}`;
  if (itemCanvasCache.has(key)) return itemCanvasCache.get(key);
  const c = makeCanvas(T, T);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(T, T);
  bow(new Painter(img.data, T, 0, 0, mulberry32(pull)), pull);
  ctx.putImageData(img, 0, 0);
  itemCanvasCache.set(key, c);
  return c;
}

function coalLump(p, color) {
  pixmap(p, [
    '................',
    '................',
    '......mmmm......',
    '....mmlhmmmm....',
    '...mlhlmmmmdm...',
    '..mlllmmmmmddm..',
    '..mllmmmdmmmdd..',
    '.mmlmmmmmmmdddm.',
    '.mmmmmdmmmmmddm.',
    '.dmmmmmmmmmdddd.',
    '..dmmmmmmmdddd..',
    '...ddmmmdddd....',
    '....dddddd......',
  ], ramp(color));
  outline(p, 0.45);
}

function bucket(p, liquid) {
  pixmap(p, [
    '................',
    '................',
    '................',
    '...hhhhhhhhhh...',
    '..hxxxxxxxxxxm..',
    '..lhxxxxxxxxmd..',
    '..llhhhhhhhmmd..',
    '...llllllmmdd...',
    '...lllllmmmdd...',
    '....llllmmdd....',
    '....llmmmmdd....',
    '.....dddddd.....',
  ], { ...ramp([196, 196, 196]), x: [44, 44, 44] });
  if (liquid) {
    for (let x = 3; x <= 12; x++) p.px(x, 4, liquid[1]);
    for (let x = 4; x <= 11; x++) p.px(x, 5, liquid[0]);
  }
  outline(p);
}

function fruit(p, color, rand) {
  ball(p, 8, 9.5, 5.5, 5, color, rand, 0.05);
  p.px(5, 7, [255, 255, 255]);
  p.rect(8, 2, 8, 4, [96, 64, 30]);
  p.px(9, 3, [70, 160, 40]);
  p.px(10, 3, [70, 160, 40]);
  p.px(10, 2, [96, 190, 60]);
  p.px(11, 2, [70, 160, 40]);
  outline(p);
}

const ITEM_PAINTERS = {
  lapis_lazuli: (p, r) => { for (let i = 0; i < 5; i++) blob(p, 4 + r() * 8, 4 + r() * 8, 2 + r() * 1.5, [40, 80, 200], r); },
  redstone: (p, r) => { for (let i = 0; i < 40; i++) { const a = r() * Math.PI * 2; const d = Math.sqrt(r()) * 5; p.px(Math.round(7.5 + Math.cos(a) * d), Math.round(9 + Math.sin(a) * d * 0.7), mul([200, 20, 20], 0.6 + r() * 0.6)); } },
  emerald: (p) => {
    pixmap(p, [
      '................',
      '.......hh.......',
      '......hllm......',
      '.....hlllmm.....',
      '....hlhllmmd....',
      '....hllllmmd....',
      '...hlllllmmmd...',
      '...hllllmmmmd...',
      '...lllllmmmmd...',
      '....lllmmmmd....',
      '....llmmmmdd....',
      '.....lmmmdd.....',
      '......mmdd......',
      '.......dd.......',
    ], ramp([36, 196, 96]));
    outline(p);
  },
  stick: (p) => { handle(p, 3, 12); outline(p); },
  coal: (p) => coalLump(p, [52, 52, 52]),
  charcoal: (p) => coalLump(p, [66, 56, 44]),
  iron_ingot: (p) => ingot(p, [215, 215, 215]),
  gold_ingot: (p) => ingot(p, [250, 215, 60]),
  brick: (p) => ingot(p, [160, 80, 55]),
  diamond: (p) => {
    pixmap(p, [
      '................',
      '................',
      '................',
      '.....hhhhhh.....',
      '....hhllllmm....',
      '...hlhllllmmd...',
      '..hlllllllmmmd..',
      '..dmmmmmmmmmdd..',
      '...dmmmmmmmdd...',
      '....dmmmmmdd....',
      '.....dmmmdd.....',
      '......dmdd......',
      '.......dd.......',
    ], ramp([74, 222, 214]));
    outline(p);
  },
  bucket: (p) => bucket(p, null),
  water_bucket: (p) => bucket(p, [[48, 86, 214], [66, 112, 232]]),
  lava_bucket: (p) => bucket(p, [[232, 110, 20], [252, 176, 40]]),
  apple: (p, r) => fruit(p, [206, 28, 30], r),
  golden_apple: (p, r) => fruit(p, [248, 206, 48], r),
  porkchop: (p) => porkchop(p, { meat: [232, 138, 140], light: [246, 180, 176], dark: [196, 104, 110], fat: [252, 226, 216] }),
  cooked_porkchop: (p) => porkchop(p, { meat: [192, 128, 72], light: [224, 176, 112], dark: [146, 92, 50], fat: [238, 208, 150] }),
  beef: (p) => beef(p, { meat: [196, 40, 40], dark: [146, 24, 28], fat: [244, 204, 200] }),
  steak: (p) => beef(p, { meat: [116, 66, 34], dark: [82, 44, 22], fat: [176, 122, 70] }),
  mutton: (p) => mutton(p, { meat: [206, 56, 52], light: [232, 110, 100], fat: [246, 222, 212], bone: BONE }),
  cooked_mutton: (p) => mutton(p, { meat: [140, 82, 44], light: [170, 112, 64], fat: [206, 164, 112], bone: BONE }),
  rotten_flesh: (p) => rottenFlesh(p, { flesh: [150, 116, 70], dark: [88, 64, 40], green: [108, 150, 64] }),
  gunpowder: (p, r) => { for (let i = 0; i < 45; i++) { const a = r() * Math.PI * 2; const d = Math.sqrt(r()) * 5; p.px(Math.round(7.5 + Math.cos(a) * d), Math.round(9 + Math.sin(a) * d * 0.7), mul([90, 90, 90], 0.6 + r() * 0.8)); } },
  leather: (p, r) => { for (let y = 3; y < 14; y++) for (let x = 3; x < 13; x++) if (!((x === 3 || x === 12) && (y === 3 || y === 13))) p.px(x, y, mul([150, 85, 45], 0.85 + r() * 0.3)); },
  clay_ball: (p, r) => { ball(p, 8, 8.5, 5, 4.5, [160, 166, 182], r); outline(p); },
  flint: (p, r) => { for (let y = 3; y < 13; y++) { const w = Math.round(4 - Math.abs(y - 7) * 0.5); for (let x = 7 - w; x <= 7 + w; x++) p.px(x, y, mul([60, 60, 62], 0.8 + r() * 0.5)); } },
  wheat_seeds: (p, r) => { for (let i = 0; i < 7; i++) { const x = 3 + Math.floor(r() * 10); const y = 4 + Math.floor(r() * 9); p.px(x, y, [70, 150, 40]); p.px(x, y + 1, [50, 110, 30]); } },
  wheat: (p) => { for (let i = 0; i < 5; i++) { p.line(3 + i * 2, 14, 6 + i, 3, [200, 170, 60]); p.px(6 + i, 3, [230, 200, 90]); p.px(6 + i, 4, [230, 200, 90]); } p.line(4, 10, 12, 10, [140, 110, 40]); },


  oak_door: (p) => {
    p.rect(4, 1, 11, 14, (x, y) => (x === 4 || x === 11 || y === 1 || y === 14 ? [104, 76, 40] : [162, 130, 78]));
    p.rect(5, 3, 7, 6, [0, 0, 0, 0]);
    p.rect(8, 3, 10, 6, [0, 0, 0, 0]);
    p.px(10, 9, [60, 60, 60]);
  },
  paper: (p) => { p.rect(3, 2, 12, 13, (x, y) => (x === 12 || y === 13 ? [200, 200, 190] : [245, 245, 238])); p.line(5, 5, 10, 5, [210, 210, 200]); p.line(5, 8, 10, 8, [210, 210, 200]); },
  book: (p) => { p.rect(3, 2, 12, 13, (x, y) => (x === 3 || y === 2 || y === 13 ? [90, 50, 25] : [120, 70, 35])); p.rect(11, 3, 12, 12, [240, 235, 220]); p.rect(5, 5, 9, 6, [200, 160, 60]); },
  snowball: (p, r) => { ball(p, 8, 8.5, 5, 5, [236, 244, 250], r, 0); outline(p, 0.55); },
  bowl: (p) => { for (let y = 7; y < 13; y++) { const w = 6 - Math.max(0, y - 9); p.line(8 - w, y, 7 + w, y, y === 7 ? [90, 62, 32] : [140, 100, 56]); } },
  mushroom_stew: (p) => { ITEM_PAINTERS.bowl(p); p.line(3, 7, 12, 7, [150, 100, 60]); p.line(4, 6, 11, 6, [170, 120, 70]); p.px(6, 6, [200, 60, 50]); p.px(9, 6, [120, 90, 60]); },
  bone: (p) => {
    const W = [236, 232, 214];
    const S = [196, 190, 170];
    p.line(4, 11, 11, 4, W);
    p.line(5, 11, 11, 5, S);
    for (const [x, y] of [[2, 11], [4, 13], [11, 2], [13, 4]]) { p.rect(x, y, x + 1, y + 1, W); p.px(x + 1, y + 1, S); }
    p.rect(3, 12, 4, 12, W);
    p.rect(12, 3, 12, 4, W);
  },
  bone_meal: (p, r) => {
    for (let i = 0; i < 70; i++) {
      const x = 3 + Math.floor(r() * 10);
      const y = 7 + Math.floor(r() * 7);
      if (Math.abs(x - 7.5) / 5 + (13 - y) / 7 > 1.05) continue;
      p.px(x, y, r() < 0.3 ? [205, 203, 196] : [243, 242, 236]);
    }
  },
  string: (p) => {
    const c = [225, 225, 225];
    let px = 2;
    let py = 13;
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      const x = Math.round(2 + t * 11 + Math.sin(t * 9) * 1.2);
      const y = Math.round(13 - t * 11 + Math.cos(t * 9) * 1.2);
      p.line(px, py, x, y, c);
      px = x;
      py = y;
    }
  },
  feather: (p) => {
    p.line(3, 13, 12, 4, [150, 140, 120]);
    for (let i = 0; i < 8; i++) {
      const x = 5 + i;
      const y = 11 - i;
      p.px(x - 1, y - 1, [245, 245, 245]);
      p.px(x + 1, y + 1, [220, 220, 220]);
      if (i > 1 && i < 7) { p.px(x - 2, y - 1, [230, 230, 230]); p.px(x + 1, y + 2, [205, 205, 205]); }
    }
    p.px(12, 3, [245, 245, 245]);
  },
  arrow: (p) => {
    p.line(3, 12, 11, 4, [110, 80, 45]);
    p.line(4, 12, 11, 5, [80, 58, 32]);
    p.rect(11, 2, 12, 3, [150, 150, 150]);
    p.px(13, 2, [95, 95, 95]);
    p.px(12, 4, [95, 95, 95]);
    p.px(11, 4, [120, 120, 120]);
    for (const [x, y] of [[1, 12], [2, 11], [2, 13], [3, 14], [1, 14], [2, 12]]) p.px(x, y, [235, 235, 235]);
    p.px(1, 13, [200, 200, 200]);
    p.px(3, 13, [200, 200, 200]);
  },
  bow: (p) => bow(p, 0),
  egg: (p, r) => {
    for (let y = 2; y < 15; y++) for (let x = 3; x < 13; x++) {
      const d = Math.hypot((x - 7.5) / 4.6, (y - 8.8) / (y < 9 ? 6.4 : 5.6));
      if (d > 1) continue;
      p.px(x, y, d > 0.86 ? [196, 175, 130] : r() < 0.08 ? [205, 180, 140] : mul([242, 228, 196], 0.94 + r() * 0.08));
    }
    p.px(6, 5, [255, 250, 235]);
  },
  chicken: (p) => chicken(p, { skin: [246, 206, 192], leg: [236, 188, 174], dark: [212, 160, 148], bone: BONE }),
  cooked_chicken: (p) => chicken(p, { skin: [214, 146, 72], leg: [196, 126, 58], dark: [164, 100, 42], bone: [238, 224, 192] }),
  spider_eye: (p, r) => {
    blob(p, 7.5, 8, 5.5, [150, 26, 30], r);
    blob(p, 7.5, 8.5, 2.2, [60, 8, 12], r);
    p.px(5, 5, [230, 120, 120]);
    p.px(6, 5, [210, 90, 90]);
  },
  bread: (p, r) => { for (let y = 5; y < 12; y++) for (let x = 1; x < 15; x++) { const d = Math.hypot((x - 7.5) / 7, (y - 8.5) / 3.6); if (d <= 1) p.px(x, y, d > 0.8 ? [130, 80, 30] : mul(y < 7 ? [190, 130, 55] : [170, 110, 45], 0.9 + r() * 0.2)); } },
};

// Painters above that leave the outline to getItemCanvas.
const AUTO_OUTLINE = new Set(['lapis_lazuli', 'redstone', 'gunpowder', 'leather', 'flint', 'wheat_seeds', 'wheat', 'oak_door', 'paper', 'book',
  'bowl', 'mushroom_stew', 'bone', 'bone_meal', 'feather', 'arrow', 'egg', 'spider_eye', 'bread', 'string']);

const itemCanvasCache = new Map();

// 16x16 canvas for a non-block item.
export function getItemCanvas(id) {
  if (itemCanvasCache.has(id)) return itemCanvasCache.get(id);
  const it = ITEMS[id];
  const c = makeCanvas(T, T);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(T, T);
  const rand = mulberry32(hashStr(it ? it.key : String(id)));
  const p = new Painter(img.data, T, 0, 0, rand);
  if (it && it.tool) {
    const mat = TOOL_MATERIALS.find((m) => m.key === it.tool.material);
    tool(p, it.tool.type, mat.color);
  } else if (it && it.armor) {
    armorSprite(p, it.armor.slot, ARMOR_MATERIALS.find((m) => m.key === it.armor.material).color);
  } else if (it && ITEM_PAINTERS[it.key]) {
    ITEM_PAINTERS[it.key](p, rand);
    if (AUTO_OUTLINE.has(it.key)) outline(p);
  } else {
    p.rect(4, 4, 11, 11, [255, 0, 255]);
  }
  ctx.putImageData(img, 0, 0);
  itemCanvasCache.set(id, c);
  return c;
}

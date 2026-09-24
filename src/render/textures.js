// Procedural 16x16 pixel-art textures: the block atlas, item sprites and crack overlays.
import { TILES, TILE_INDEX, ATLAS_TILES_PER_ROW, BLOCKS } from '../world/blocks.js';
import { mulberry32 } from '../world/noise.js';
import { ITEMS, TOOL_MATERIALS } from '../items.js';
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

function stone(p, base = C.stone) {
  p.fill(() => {
    const r = p.rand();
    if (r < 0.1) return shade(base, -22 + p.rand() * 6);
    if (r > 0.94) return shade(base, 14);
    return shade(base, (p.rand() - 0.5) * 16);
  });
}

function dirt(p, base = C.dirt) {
  p.fill(() => {
    const r = p.rand();
    if (r < 0.12) return mul(base, 0.78);
    if (r > 0.93) return mul(base, 1.15);
    return shade(base, (p.rand() - 0.5) * 18);
  });
}

function planks(p, base) {
  const seams = [3, 11, 7, 14];
  p.fill((x, y) => {
    const row = y >> 2;
    if (y % 4 === 3) return mul(base, 0.68);
    if (x === seams[row]) return mul(base, 0.75);
    const grain = Math.sin((x + row * 7) * 0.9 + y * 0.3) * 6;
    return shade(base, grain + (p.rand() - 0.5) * 10);
  });
}

function logSide(p, bark, stripe = 0.8) {
  const cols = Array.from({ length: T }, () => (p.rand() < 0.35 ? stripe : 1));
  p.fill((x) => mul(bark, cols[x] * (0.92 + p.rand() * 0.16)));
}

function logTop(p, inner, bark) {
  p.fill((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) return mul(bark, 0.9 + p.rand() * 0.2);
    const ring = Math.floor(d) % 2 === 0 ? 1 : 0.82;
    return mul(inner, ring * (0.95 + p.rand() * 0.1));
  });
}

function leaves(p, base) {
  p.fill(() => {
    const r = p.rand();
    if (r < 0.22) return [0, 0, 0, 0];
    if (r < 0.4) return mul(base, 0.72);
    if (r > 0.9) return mul(base, 1.2);
    return shade(base, (p.rand() - 0.5) * 20);
  });
}

// Greyscale leaves that take the biome foliage colour.
function tintedLeaves(p) {
  p.fill(() => {
    const r = p.rand();
    if (r < 0.2) return [0, 0, 0, 0];
    if (r < 0.38) return gray(112 + p.rand() * 12);
    if (r > 0.9) return gray(212);
    return gray(160 + (p.rand() - 0.5) * 26);
  });
}

function ore(p, spec) {
  stone(p);
  const n = 5 + Math.floor(p.rand() * 3);
  for (let i = 0; i < n; i++) {
    const cx = 2 + Math.floor(p.rand() * 12);
    const cy = 2 + Math.floor(p.rand() * 12);
    const size = 2 + Math.floor(p.rand() * 3);
    for (let k = 0; k < size; k++) {
      const x = cx + Math.floor(p.rand() * 3) - 1;
      const y = cy + Math.floor(p.rand() * 3) - 1;
      p.px(x, y, p.rand() < 0.35 ? mul(spec, 0.7) : spec);
    }
  }
}

function cobble(p, base = [122, 122, 122]) {
  const pts = [];
  for (let i = 0; i < 11; i++) pts.push([p.rand() * 16, p.rand() * 16, 0.75 + p.rand() * 0.45]);
  p.fill((x, y) => {
    let d1 = 1e9;
    let d2 = 1e9;
    let best = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16) {
        const dx = x + 0.5 - pts[i][0] - ox;
        const dy = y + 0.5 - pts[i][1] - oy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
      }
    }
    if (d2 - d1 < 1.1) return mul(base, 0.55);
    return mul(base, pts[best][2] * (0.93 + p.rand() * 0.14));
  });
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

// ---------- tile table ----------
const PAINTERS = {
  stone: (p) => stone(p),
  dirt: (p) => dirt(p),
  grass_top: (p) => p.fill(() => {
    const r = p.rand();
    if (r < 0.14) return gray(146 + p.rand() * 8);
    if (r > 0.9) return gray(204 + p.rand() * 10);
    return gray(172 + (p.rand() - 0.5) * 18);
  }),
  grass_side: (p) => {
    dirt(p);
    const depth = Array.from({ length: T }, () => (p.rand() < 0.2 ? 5 : 3) + Math.floor(p.rand() * 2));
    p.fill((x, y) => {
      if (y >= depth[x]) return null;
      const r = p.rand();
      return gray(r < 0.15 ? 150 : r > 0.88 ? 205 : 172 + (p.rand() - 0.5) * 18);
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
  sand: (p) => p.noise(C.sand, 18),
  gravel: (p) => p.fill(() => {
    const pal = [[132, 126, 124], [104, 98, 95], [155, 145, 140], [118, 108, 100], [90, 88, 88]];
    return shade(pal[Math.floor(p.rand() * pal.length)], (p.rand() - 0.5) * 8);
  }),
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
    p.rect(0, 0, 15, 2, (x) => shade([100, 70, 40], (x % 3) * 4));
    p.rect(3, 5, 4, 12, [120, 120, 120]); // saw blade
    p.rect(2, 4, 5, 4, [90, 60, 30]);
    p.rect(10, 5, 13, 7, [140, 140, 140]); // hammer head
    p.rect(11, 8, 12, 13, [90, 60, 30]);
  },
  crafting_table_front: (p) => {
    planks(p, C.oakPlanks);
    p.rect(0, 0, 15, 2, (x) => shade([100, 70, 40], (x % 3) * 4));
    p.rect(3, 5, 12, 6, [110, 110, 110]);
    p.rect(7, 7, 8, 13, [90, 60, 30]);
    p.rect(2, 11, 4, 13, [150, 150, 150]);
  },
  furnace_side: (p) => {
    p.fill((x, y) => shade([118, 118, 118], (p.rand() - 0.5) * 10 + (y === 0 || y === 15 ? -25 : 0)));
  },
  furnace_top: (p) => bordered(p, [125, 125, 125], [90, 90, 90], 12),
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
  bricks: (p) => p.fill((x, y) => {
    const row = y >> 2;
    if (y % 4 === 3) return [175, 170, 160];
    if ((row % 2 === 0 && (x === 7 || x === 15)) || (row % 2 === 1 && (x === 3 || x === 11))) return [175, 170, 160];
    return shade([150, 72, 55], (p.rand() - 0.5) * 20);
  }),
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
  bed_top: (p) => p.fill((x, y) => {
    if (y < 6) return x === 0 || x === 15 || y === 0 ? [190, 190, 190] : shade([225, 225, 225], (p.rand() - 0.5) * 6);
    return x === 0 || x === 15 ? [130, 20, 20] : shade([170, 30, 30], (p.rand() - 0.5) * 14);
  }),
  bed_side: (p) => p.fill((x, y) => {
    if (y < 7) return [0, 0, 0, 0];
    if (y < 11) return shade([170, 30, 30], (p.rand() - 0.5) * 14);
    if (y < 13) return shade([150, 110, 65], (p.rand() - 0.5) * 10);
    if (x < 3 || x > 12) return [120, 85, 50];
    return [150, 110, 65];
  }),
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
const STICK_L = [150, 115, 60];
const STICK_D = [95, 70, 35];

function handle(p, x0, y0, x1, y1) {
  p.line(x0, y0, x1, y1, STICK_L);
  p.line(x0 + 1, y0, x1 + 1, y1, STICK_D);
}

function blob(p, cx, cy, r, color, rand) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= r) p.px(x, y, mul(color, d > r - 1 ? 0.7 : 0.9 + rand() * 0.25));
  }
}

function ingot(p, color) {
  const dark = mul(color, 0.6);
  for (let y = 5; y <= 11; y++) {
    const x0 = 2 + Math.max(0, 7 - y) + (y > 9 ? 0 : 0);
    const x1 = 13 - Math.max(0, y - 9);
    for (let x = x0; x <= x1; x++) {
      let c = color;
      if (y === 5 || x === x0) c = mul(color, 1.2);
      if (y === 11 || x === x1) c = dark;
      p.px(x, y, c);
    }
  }
}

function meat(p, color, fat, rand) {
  for (let y = 3; y < 14; y++) for (let x = 2; x < 14; x++) {
    const d = Math.hypot((x - 7.5) / 6, (y - 8) / 5);
    if (d > 1) continue;
    let c = mul(color, 0.85 + rand() * 0.3);
    if (d > 0.82) c = fat;
    p.px(x, y, c);
  }
  p.rect(12, 11, 14, 13, [230, 225, 210]);
}

function tool(p, type, color) {
  const light = mul(color, 1.15);
  const dark = mul(color, 0.6);
  switch (type) {
    case 'pickaxe':
      handle(p, 3, 13, 10, 6);
      p.line(4, 2, 9, 2, light);
      p.line(3, 3, 10, 3, color);
      p.line(10, 3, 13, 6, color);
      p.line(11, 3, 14, 6, dark);
      p.line(13, 7, 13, 12, color);
      p.line(14, 7, 14, 11, dark);
      p.line(2, 4, 3, 4, dark);
      break;
    case 'axe':
      handle(p, 3, 13, 11, 5);
      p.rect(7, 2, 11, 4, color);
      p.rect(6, 3, 8, 8, color);
      p.line(7, 2, 11, 2, light);
      p.line(6, 8, 8, 8, dark);
      p.line(5, 3, 5, 7, light);
      break;
    case 'shovel':
      handle(p, 3, 13, 9, 7);
      p.rect(9, 3, 12, 6, color);
      p.line(10, 2, 13, 2, light);
      p.line(13, 3, 13, 5, dark);
      p.line(9, 7, 11, 7, dark);
      break;
    case 'sword':
      p.line(4, 11, 13, 2, color);
      p.line(5, 11, 14, 2, dark);
      p.line(4, 10, 12, 2, light);
      p.line(2, 9, 6, 13, [60, 40, 20]);
      p.line(3, 9, 7, 13, [80, 55, 25]);
      handle(p, 1, 14, 3, 12);
      break;
    case 'hoe':
      handle(p, 3, 13, 11, 5);
      p.rect(7, 2, 12, 3, color);
      p.line(7, 2, 12, 2, light);
      p.rect(12, 4, 13, 5, dark);
      break;
    default:
  }
}

const ITEM_PAINTERS = {
  stick: (p) => handle(p, 4, 12, 11, 5),
  coal: (p, r) => blob(p, 7.5, 8, 5, [40, 40, 40], r),
  charcoal: (p, r) => blob(p, 7.5, 8, 5, [55, 45, 35], r),
  iron_ingot: (p) => ingot(p, [215, 215, 215]),
  gold_ingot: (p) => ingot(p, [250, 215, 60]),
  brick: (p) => ingot(p, [160, 80, 55]),
  diamond: (p) => {
    const c = [90, 235, 225];
    for (let y = 3; y < 13; y++) {
      const w = y < 6 ? 2 + (y - 3) * 2 : Math.max(0, 12 - y) * 1;
      for (let x = 8 - w; x <= 7 + w; x++) p.px(x, y, mul(c, y < 6 ? 1.15 : 0.9 + ((x + y) % 3) * 0.08));
    }
  },
  bucket: (p) => {
    const g = [190, 190, 190];
    for (let y = 5; y < 14; y++) {
      const inset = Math.floor((y - 5) / 3);
      p.line(3 + inset, y, 12 - inset, y, y === 5 ? [120, 120, 120] : g);
      p.px(3 + inset, y, [140, 140, 140]);
      p.px(12 - inset, y, [110, 110, 110]);
    }
    p.line(4, 4, 11, 4, [100, 100, 100]);
  },
  water_bucket: (p) => { ITEM_PAINTERS.bucket(p); p.line(4, 5, 11, 5, [50, 90, 220]); p.line(4, 6, 11, 6, [60, 110, 230]); },
  lava_bucket: (p) => { ITEM_PAINTERS.bucket(p); p.line(4, 5, 11, 5, [240, 120, 20]); p.line(4, 6, 11, 6, [250, 180, 40]); },
  apple: (p, r) => { blob(p, 7.5, 9, 5, [210, 30, 30], r); p.line(8, 2, 8, 4, [90, 60, 30]); p.px(9, 3, [60, 150, 40]); p.px(10, 2, [60, 150, 40]); p.px(6, 7, [255, 150, 150]); },
  golden_apple: (p, r) => { blob(p, 7.5, 9, 5, [250, 210, 50], r); p.line(8, 2, 8, 4, [90, 60, 30]); p.px(9, 3, [60, 150, 40]); p.px(6, 7, [255, 255, 200]); },
  porkchop: (p, r) => meat(p, [235, 140, 140], [250, 220, 215], r),
  cooked_porkchop: (p, r) => meat(p, [180, 120, 70], [220, 190, 140], r),
  beef: (p, r) => meat(p, [200, 50, 45], [240, 200, 200], r),
  steak: (p, r) => meat(p, [120, 70, 35], [170, 120, 70], r),
  mutton: (p, r) => meat(p, [215, 70, 60], [240, 220, 210], r),
  cooked_mutton: (p, r) => meat(p, [150, 90, 50], [200, 160, 110], r),
  rotten_flesh: (p, r) => meat(p, [130, 110, 60], [100, 140, 70], r),
  gunpowder: (p, r) => { for (let i = 0; i < 45; i++) { const a = r() * Math.PI * 2; const d = Math.sqrt(r()) * 5; p.px(Math.round(7.5 + Math.cos(a) * d), Math.round(9 + Math.sin(a) * d * 0.7), mul([90, 90, 90], 0.6 + r() * 0.8)); } },
  leather: (p, r) => { for (let y = 3; y < 14; y++) for (let x = 3; x < 13; x++) if (!((x === 3 || x === 12) && (y === 3 || y === 13))) p.px(x, y, mul([150, 85, 45], 0.85 + r() * 0.3)); },
  clay_ball: (p, r) => blob(p, 7.5, 8.5, 4.5, [165, 170, 185], r),
  flint: (p, r) => { for (let y = 3; y < 13; y++) { const w = Math.round(4 - Math.abs(y - 7) * 0.5); for (let x = 7 - w; x <= 7 + w; x++) p.px(x, y, mul([60, 60, 62], 0.8 + r() * 0.5)); } },
  wheat_seeds: (p, r) => { for (let i = 0; i < 7; i++) { const x = 3 + Math.floor(r() * 10); const y = 4 + Math.floor(r() * 9); p.px(x, y, [70, 150, 40]); p.px(x, y + 1, [50, 110, 30]); } },
  wheat: (p) => { for (let i = 0; i < 5; i++) { p.line(3 + i * 2, 14, 6 + i, 3, [200, 170, 60]); p.px(6 + i, 3, [230, 200, 90]); p.px(6 + i, 4, [230, 200, 90]); } p.line(4, 10, 12, 10, [140, 110, 40]); },
  bread: (p, r) => { for (let y = 5; y < 12; y++) for (let x = 1; x < 15; x++) { const d = Math.hypot((x - 7.5) / 7, (y - 8.5) / 3.6); if (d <= 1) p.px(x, y, d > 0.8 ? [130, 80, 30] : mul(y < 7 ? [190, 130, 55] : [170, 110, 45], 0.9 + r() * 0.2)); } },
};

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
  } else if (it && ITEM_PAINTERS[it.key]) {
    ITEM_PAINTERS[it.key](p, rand);
  } else {
    p.rect(4, 4, 11, 11, [255, 0, 255]);
  }
  ctx.putImageData(img, 0, 0);
  itemCanvasCache.set(id, c);
  return c;
}

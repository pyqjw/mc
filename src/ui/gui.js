// Minecraft-style GUI graphics painted at native GUI resolution (1 unit = 1 GUI pixel) and shown
// scaled up with pixelated rendering: hotbar, selection frame, XP bar, status icons, logo.
import { mulberry32 } from '../world/noise.js';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function rgba(c) {
  return `rgba(${c[0]},${c[1]},${c[2]},${c.length > 3 ? c[3] : 1})`;
}

function rect(ctx, x, y, w, h, c) {
  ctx.fillStyle = typeof c === 'string' ? c : rgba(c);
  ctx.fillRect(x, y, w, h);
}

// ------------------------------------------------------------ GUI scale
// Largest integer scale that keeps a 320x240 GUI on screen, like Minecraft's "auto" setting.
export function autoGuiScale(w = window.innerWidth, h = window.innerHeight) {
  return Math.max(1, Math.min(Math.floor(w / 320), Math.floor(h / 240), 5));
}

export function applyGuiScale(setting) {
  const auto = autoGuiScale();
  const s = setting > 0 ? Math.min(setting, Math.max(auto, 1)) : auto;
  document.documentElement.style.setProperty('--s', String(s));
  return s;
}

// ------------------------------------------------------------ hotbar & bars
export function hotbarURL() {
  return cached('hotbar', () => {
    const c = canvas(182, 22);
    const x = c.getContext('2d');
    rect(x, 0, 0, 182, 22, [0, 0, 0, 0.72]);
    rect(x, 1, 1, 180, 20, [150, 150, 150, 0.85]);
    for (let i = 0; i < 9; i++) {
      const sx = 1 + i * 20;
      x.clearRect(sx + 1, 2, 18, 18);
      rect(x, sx + 1, 2, 18, 18, [16, 16, 16, 0.45]);
      rect(x, sx + 1, 2, 18, 1, [0, 0, 0, 0.35]);
      rect(x, sx + 1, 2, 1, 18, [0, 0, 0, 0.35]);
      rect(x, sx + 1, 19, 18, 1, [255, 255, 255, 0.12]);
      rect(x, sx + 18, 2, 1, 18, [255, 255, 255, 0.12]);
    }
    return c.toDataURL();
  });
}

export function selectorURL() {
  return cached('selector', () => {
    const c = canvas(24, 24);
    const x = c.getContext('2d');
    rect(x, 0, 0, 24, 24, [0, 0, 0, 0.8]);
    x.clearRect(3, 3, 18, 18);
    rect(x, 1, 1, 22, 2, [255, 255, 255, 1]);
    rect(x, 1, 1, 2, 22, [255, 255, 255, 1]);
    rect(x, 1, 21, 22, 2, [170, 170, 170, 1]);
    rect(x, 21, 1, 2, 22, [170, 170, 170, 1]);
    rect(x, 3, 3, 18, 1, [60, 60, 60, 0.9]);
    rect(x, 3, 3, 1, 18, [60, 60, 60, 0.9]);
    return c.toDataURL();
  });
}

// Experience bar: empty background or the green fill.
export function xpBarURL(full) {
  return cached(`xp:${full}`, () => {
    const c = canvas(182, 5);
    const x = c.getContext('2d');
    if (full) {
      rect(x, 1, 1, 180, 3, [128, 255, 32]);
      rect(x, 1, 1, 180, 1, [176, 255, 112]);
      rect(x, 1, 3, 180, 1, [72, 176, 16]);
    } else {
      rect(x, 0, 0, 182, 5, [0, 0, 0]);
      rect(x, 1, 1, 180, 3, [30, 42, 30]);
      rect(x, 1, 1, 180, 1, [44, 60, 44]);
    }
    for (let i = 1; i < 9; i++) rect(x, i * 20 + 1, 1, 1, 3, full ? [70, 150, 20] : [12, 16, 12]);
    return c.toDataURL();
  });
}

// ------------------------------------------------------------ status icons (9x9)
const ICONS = {
  heart: [
    '.oo...oo.',
    'oWRo.oRRo',
    'oRRRoRRRo',
    'oRRRRRRDo',
    '.oRRRRDo.',
    '..oRRDo..',
    '...oDo...',
    '....o....',
    '.........',
  ],
  food: [
    '.....ooo.',
    '....oLMMo',
    '...oLMMMo',
    '...oMMMDo',
    '..oMMMDo.',
    '.oWoooo..',
    'oWWo.....',
    'oWo......',
    '.o.......',
  ],
  armor: [
    '.oo...oo.',
    'oWLoooLLo',
    'oLLLLLLLo',
    '.oLLLLLo.',
    '.oLLLLLo.',
    '.oLLLLDo.',
    '.oLLLLDo.',
    '.oLDDDDo.',
    '..ooooo..',
  ],
  bubble: [
    '..ooooo..',
    '.oBBBBBo.',
    'oBWWBBBBo',
    'oBWBBBBBo',
    'oBBBBBBBo',
    'oBBBBBBDo',
    'oBBBBBDDo',
    '.oBBBDDo.',
    '..ooooo..',
  ],
};

const FILL = {
  heart: { R: [255, 19, 19], W: [255, 210, 210], D: [187, 0, 0] },
  heartPoison: { R: [148, 132, 23], W: [220, 214, 120], D: [96, 84, 12] },
  food: { M: [181, 103, 44], L: [228, 160, 88], D: [122, 63, 26], W: [240, 232, 220] },
  armor: { L: [200, 200, 205], W: [255, 255, 255], D: [140, 140, 148] },
  bubble: { B: [64, 150, 255], W: [230, 245, 255], D: [32, 96, 200] },
};

// kind: heart | food | armor | bubble; state: full | half | empty; flash draws a white outline.
export function iconURL(kind, state, flash = false, variant = null) {
  return cached(`icon:${kind}:${state}:${flash}:${variant}`, () => {
    const rows = ICONS[kind];
    const c = canvas(9, 9);
    const x = c.getContext('2d');
    const fill = FILL[variant || kind];
    const outline = flash ? [255, 255, 255] : kind === 'bubble' ? [18, 40, 110] : [0, 0, 0];
    const emptyIn = kind === 'armor' ? null : kind === 'food' ? [40, 30, 20] : [45, 18, 18];
    for (let yy = 0; yy < 9; yy++) {
      for (let xx = 0; xx < 9; xx++) {
        const ch = rows[yy][xx];
        if (ch === '.') continue;
        if (ch === 'o') {
          if (kind === 'bubble' && state === 'empty') continue;
          rect(x, xx, yy, 1, 1, outline);
          continue;
        }
        let filled = state === 'full';
        if (state === 'half') filled = kind === 'food' ? xx >= 4 : xx <= 4;
        if (filled) rect(x, xx, yy, 1, 1, fill[ch] || fill.R || fill.M || fill.L || fill.B);
        else if (emptyIn && kind !== 'bubble') rect(x, xx, yy, 1, 1, emptyIn);
      }
    }
    return c.toDataURL();
  });
}

// Green recipe book icon (16x16) for the recipe book button.
export function bookIconURL() {
  return cached('book', () => {
    const c = canvas(16, 16);
    const x = c.getContext('2d');
    rect(x, 3, 2, 10, 12, [30, 70, 20]);
    rect(x, 4, 3, 8, 10, [70, 150, 45]);
    rect(x, 4, 3, 8, 1, [110, 190, 70]);
    rect(x, 4, 3, 1, 10, [110, 190, 70]);
    rect(x, 12, 3, 1, 11, [230, 225, 205]);
    rect(x, 4, 13, 9, 1, [230, 225, 205]);
    rect(x, 6, 6, 4, 1, [200, 170, 60]);
    rect(x, 6, 8, 4, 1, [200, 170, 60]);
    return c.toDataURL();
  });
}

// ------------------------------------------------------------ backgrounds
// Subtle noise tile for button faces.
export function noiseURL() {
  return cached('noise', () => {
    const c = canvas(16, 16);
    const x = c.getContext('2d');
    const r = mulberry32(7);
    for (let yy = 0; yy < 16; yy++) {
      for (let xx = 0; xx < 16; xx++) {
        const v = r();
        rect(x, xx, yy, 1, 1, v < 0.5 ? [0, 0, 0, 0.05 + r() * 0.06] : [255, 255, 255, 0.03 + r() * 0.05]);
      }
    }
    return c.toDataURL();
  });
}

// ------------------------------------------------------------ logo
const LOGO_FONT = {
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
};

// Blocky stone-textured title, drawn like Minecraft's logo: each letter pixel is a small stone
// block with a lit face and a dark extruded side.
export function logoCanvas(text = 'WEBCRAFT') {
  return cached(`logo:${text}`, () => {
    const B = 5; // canvas pixels per letter pixel
    const D = 3; // extrusion depth
    const gap = 1;
    const letters = [...text].map((ch) => LOGO_FONT[ch]);
    const cols = letters.reduce((n, l) => n + l[0].length + gap, -gap);
    const c = canvas(cols * B + D + 2, 7 * B + D + 2);
    const x = c.getContext('2d');
    const r = mulberry32(1337);
    const cells = [];
    let cx = 0;
    for (const l of letters) {
      for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < l[0].length; xx++) if (l[yy][xx] === '#') cells.push([cx + xx, yy]);
      cx += l[0].length + gap;
    }
    const has = new Set(cells.map(([a, b]) => `${a},${b}`));
    // Outline + extrusion.
    for (const [gx, gy] of cells) {
      for (let d = D; d >= 1; d--) rect(x, 1 + gx * B + d, 1 + gy * B + d, B, B, d === D ? [20, 20, 20] : [58, 58, 58]);
    }
    for (const [gx, gy] of cells) rect(x, gx * B, gy * B, B + 2, B + 2, [16, 16, 16]);
    // Stone faces.
    for (const [gx, gy] of cells) {
      for (let yy = 0; yy < B; yy++) {
        for (let xx = 0; xx < B; xx++) {
          let v = 150 + (r() - 0.5) * 34;
          if (r() < 0.12) v -= 30;
          const top = !has.has(`${gx},${gy - 1}`) && yy === 0;
          const left = !has.has(`${gx - 1},${gy}`) && xx === 0;
          const bottom = !has.has(`${gx},${gy + 1}`) && yy === B - 1;
          const right = !has.has(`${gx + 1},${gy}`) && xx === B - 1;
          if (top || left) v += 45;
          if (bottom || right) v -= 40;
          rect(x, 1 + gx * B + xx, 1 + gy * B + yy, 1, 1, [v, v, v * 1.02]);
        }
      }
    }
    return c;
  });
}

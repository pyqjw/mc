// Tree shapes, shared by world generation and sapling growth.
// `set(x, y, z, id, overwrite, meta)` places a block; `overwrite=false` only replaces air / replaceable blocks.
import { B } from './blocks.js';

export const TREE_TYPES = {
  oak: { log: B.OAK_LOG, leaves: B.OAK_LEAVES },
  fancy_oak: { log: B.OAK_LOG, leaves: B.OAK_LEAVES },
  swamp_oak: { log: B.OAK_LOG, leaves: B.OAK_LEAVES },
  birch: { log: B.BIRCH_LOG, leaves: B.BIRCH_LEAVES },
  tall_birch: { log: B.BIRCH_LOG, leaves: B.BIRCH_LEAVES },
  spruce: { log: B.SPRUCE_LOG, leaves: B.SPRUCE_LEAVES },
  pine: { log: B.SPRUCE_LOG, leaves: B.SPRUCE_LEAVES },
  acacia: { log: B.ACACIA_LOG, leaves: B.ACACIA_LEAVES },
  jungle: { log: B.JUNGLE_LOG, leaves: B.JUNGLE_LEAVES },
  mega_jungle: { log: B.JUNGLE_LOG, leaves: B.JUNGLE_LEAVES },
  jungle_bush: { log: B.JUNGLE_LOG, leaves: B.OAK_LEAVES },
  dark_oak: { log: B.DARK_OAK_LOG, leaves: B.DARK_OAK_LEAVES },
};

// Horizontal directions (north, east, south, west) as used by block metas.
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function treeHeight(type, rand) {
  switch (type) {
    case 'spruce': return 6 + Math.floor(rand() * 4);
    case 'pine': return 8 + Math.floor(rand() * 5);
    case 'birch': return 5 + Math.floor(rand() * 3);
    case 'tall_birch': return 9 + Math.floor(rand() * 4);
    case 'fancy_oak': return 8 + Math.floor(rand() * 5);
    case 'acacia': return 5 + Math.floor(rand() * 3);
    case 'jungle': return 8 + Math.floor(rand() * 7);
    case 'mega_jungle': return 18 + Math.floor(rand() * 10);
    case 'jungle_bush': return 1;
    case 'dark_oak': return 6 + Math.floor(rand() * 3);
    case 'swamp_oak': return 5 + Math.floor(rand() * 3);
    default: return 4 + Math.floor(rand() * 3);
  }
}

// Space a tree needs around its trunk (for chunk-border handling).
export const TREE_RADIUS = 5;

// Logs from (x0, y0, z0) to (x1, y1, z1), stepping one axis at a time so every log touches the
// previous one by a face.
function logLine(set, log, x0, y0, z0, x1, y1, z1) {
  let x = x0;
  let y = y0;
  let z = z0;
  set(x, y, z, log, true);
  while (x !== x1 || y !== y1 || z !== z1) {
    if (x !== x1) x += Math.sign(x1 - x);
    else if (z !== z1) z += Math.sign(z1 - z);
    else y += Math.sign(y1 - y);
    set(x, y, z, log, true);
  }
}

function blob(set, leaves, cx, cy, cz, r, rand, squash = 1) {
  const R = Math.ceil(r);
  for (let dy = -Math.ceil(r * squash); dy <= Math.ceil(r * squash); dy++) {
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy / squash, dz);
        if (d > r + 0.3 || (d > r - 0.6 && rand() < 0.35)) continue;
        set(cx + dx, cy + dy, cz + dz, leaves, false);
      }
    }
  }
}

// Vines hanging down the side of `block` at (x, y, z), facing direction d.
function vine(set, x, y, z, d, len) {
  const vx = x + DIRS[d][0];
  const vz = z + DIRS[d][1];
  for (let i = 0; i < len; i++) set(vx, y - i, vz, B.VINE, false, d);
}

function roundCanopy(set, leaves, x, top, z, rand, wide = false) {
  for (let ly = top - 3; ly <= top + 1; ly++) {
    const rel = ly - top;
    const radius = rel >= 0 ? 1 : wide ? 3 : 2;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
        if (corner && (rel >= 0 || rand() < 0.5)) {
          if (rel === 1 || rel === 0 || rand() < 0.6) continue;
        }
        set(x + dx, ly, z + dz, leaves, false);
      }
    }
  }
}

// Leaves further than this (in steps through leaves) from a log would decay, as in the game.
const LEAF_REACH = 6;

// Places a tree whose trunk base is at (x, y, z). `blocked(x, y, z)`, if given, tells where the
// ground will keep leaves and vines from being placed.
export function placeTree(set, type, x, y, z, rand, height = treeHeight(type, rand), blocked = null) {
  for (const p of buildTree(type, x, y, z, rand, height, blocked)) set(p[0], p[1], p[2], p[3], p[4], p[5]);
}

// The blocks of a tree as [x, y, z, id, overwrite, meta]. The tree is drawn into a buffer first so
// that leaves too far from a log (which would decay, or float on their own) and vines left hanging
// from nothing are dropped before anything reaches the world.
export function buildTree(type, x, y, z, rand, height = treeHeight(type, rand), blocked = null) {
  // Keys are offsets from the trunk base (trees stay within +-32 blocks).
  const key = (bx, by, bz) => ((bx - x + 32) * 64 + (by - y + 32)) * 64 + (bz - z + 32);
  const parts = new Map();
  const put = (bx, by, bz, id, overwrite, meta = 0) => {
    const k = key(bx, by, bz);
    if (!overwrite && parts.has(k)) return;
    parts.set(k, [bx, by, bz, id, overwrite, meta]);
  };
  drawTree(put, type, x, y, z, rand, height);
  if (blocked) {
    for (const [k, p] of parts) if (!p[4] && blocked(p[0], p[1], p[2])) parts.delete(k);
  }

  const isLeaf = (p) => p && !p[4] && p[3] !== B.VINE;
  // Leaves within reach of a log, found by walking out from the logs.
  const kept = new Set();
  let frontier = [];
  for (const p of parts.values()) if (p[4]) frontier.push(p);
  for (let d = 1; d <= LEAF_REACH && frontier.length; d++) {
    const next = [];
    for (const [px, py, pz] of frontier) {
      for (const [dx, dy, dz] of NEIGHBOURS) {
        const k = key(px + dx, py + dy, pz + dz);
        const n = parts.get(k);
        if (!isLeaf(n) || kept.has(k)) continue;
        kept.add(k);
        next.push(n);
      }
    }
    frontier = next;
  }
  // Vines must hang from a log or kept leaf, or from the vine above; check them top down.
  const vines = [...parts.values()].filter((p) => p[3] === B.VINE).sort((a, b) => b[1] - a[1]);
  for (const [vx, vy, vz, , , meta] of vines) {
    const [ox, oz] = DIRS[(meta + 2) & 3];
    const behind = parts.get(key(vx + ox, vy, vz + oz));
    const k = key(vx, vy, vz);
    if ((behind && behind[4]) || kept.has(key(vx + ox, vy, vz + oz)) || kept.has(key(vx, vy + 1, vz))) kept.add(k);
  }
  const out = [];
  for (const [k, p] of parts) if (p[4] || kept.has(k)) out.push(p);
  return out;
}

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function drawTree(set, type, x, y, z, rand, height) {
  const { log, leaves } = TREE_TYPES[type] || TREE_TYPES.oak;
  const top = y + height - 1;
  switch (type) {
    case 'spruce':
    case 'pine': {
      // Layered cone; pines keep a bare trunk and a narrow top.
      let radius = 0;
      let maxR = type === 'pine' ? 2 : 1;
      const start = type === 'pine' ? y + Math.floor(height * 0.45) : y + 2;
      for (let ly = top + 1; ly >= start; ly--) {
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (radius > 0 && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
            set(x + dx, ly, z + dz, leaves, false);
          }
        }
        if (radius >= maxR) {
          radius = type === 'pine' ? 0 : 1;
          maxR = Math.min(maxR + 1, 3);
        } else {
          radius++;
        }
      }
      for (let ly = y; ly <= top; ly++) set(x, ly, z, log, true);
      return;
    }
    case 'fancy_oak': {
      // A tall trunk with branches ending in leaf clusters.
      for (let ly = y; ly <= top; ly++) set(x, ly, z, log, true);
      blob(set, leaves, x, top, z, 2.6, rand, 0.7);
      const branches = 2 + Math.floor(rand() * 3);
      for (let b = 0; b < branches; b++) {
        const a = rand() * Math.PI * 2;
        const by = y + Math.floor(height * (0.45 + rand() * 0.35));
        const len = 2 + Math.floor(rand() * 2);
        let bx = x;
        let bz = z;
        let bly = by;
        for (let i = 1; i <= len; i++) {
          const nx = x + Math.round(Math.cos(a) * i);
          const nz = z + Math.round(Math.sin(a) * i);
          const ny = by + Math.floor(i / 2);
          logLine(set, log, bx, bly, bz, nx, ny, nz);
          bx = nx;
          bz = nz;
          bly = ny;
        }
        blob(set, leaves, bx, bly + 1, bz, 2.2, rand, 0.7);
      }
      return;
    }
    case 'acacia': {
      // Trunk that bends out to one side, with flat umbrella canopies.
      const d = DIRS[Math.floor(rand() * 4)];
      const bendAt = y + 1 + Math.floor(rand() * 2);
      let tx = x;
      let tz = z;
      for (let ly = y; ly <= top; ly++) {
        if (ly > bendAt && ly < top) {
          // Step sideways at the level below so the bent trunk stays joined.
          tx += d[0];
          tz += d[1];
          set(tx, ly - 1, tz, log, true);
        }
        set(tx, ly, tz, log, true);
      }
      const canopy = (cx, cy, cz) => {
        for (let dx = -3; dx <= 3; dx++) {
          for (let dz = -3; dz <= 3; dz++) {
            if (Math.abs(dx) + Math.abs(dz) > 4) continue;
            set(cx + dx, cy, cz + dz, leaves, false);
          }
        }
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) set(cx + dx, cy + 1, cz + dz, leaves, false);
      };
      canopy(tx, top + 1, tz);
      if (rand() < 0.5) {
        // A second, lower branch the other way.
        const e = [-d[0], -d[1]];
        let bx = x;
        let bz = z;
        const by = bendAt;
        for (let i = 1; i <= 2; i++) {
          bx += e[0];
          bz += e[1];
          set(bx, by + i - 1, bz, log, true);
          set(bx, by + i, bz, log, true);
        }
        canopy(bx, by + 3, bz);
      }
      return;
    }
    case 'jungle_bush': {
      set(x, y, z, log, true);
      blob(set, leaves, x, y + 1, z, 2.2, rand, 0.6);
      return;
    }
    case 'jungle': {
      for (let ly = y; ly <= top; ly++) set(x, ly, z, log, true);
      roundCanopy(set, leaves, x, top, z, rand, true);
      for (let d = 0; d < 4; d++) if (rand() < 0.6) vine(set, x, top - 2, z, d, 2 + Math.floor(rand() * (height - 3)));
      return;
    }
    case 'mega_jungle': {
      // 2x2 trunk with branches and a wide crown.
      for (let ly = y; ly <= top; ly++) {
        for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(x + ox, ly, z + oz, log, true);
      }
      blob(set, leaves, x + 1, top + 1, z + 1, 4.5, rand, 0.45);
      for (let by = y + Math.floor(height * 0.5); by < top - 3; by += 3 + Math.floor(rand() * 3)) {
        const d = DIRS[Math.floor(rand() * 4)];
        const bx = x + (d[0] > 0 ? 1 : 0) + d[0] * 2;
        const bz = z + (d[1] > 0 ? 1 : 0) + d[1] * 2;
        set(bx - d[0], by, bz - d[1], log, true);
        set(bx, by, bz, log, true);
        set(bx, by + 1, bz, log, true);
        blob(set, leaves, bx, by + 2, bz, 2.3, rand, 0.5);
      }
      for (const [ox, oz, d] of [[0, 0, 0], [1, 0, 1], [1, 1, 2], [0, 1, 3], [0, 0, 3], [1, 1, 1]]) {
        if (rand() < 0.7) vine(set, x + ox, top - 1, z + oz, d, 3 + Math.floor(rand() * (height - 4)));
      }
      return;
    }
    case 'dark_oak': {
      for (let ly = y; ly <= top; ly++) {
        for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(x + ox, ly, z + oz, log, true);
      }
      for (let ly = top - 1; ly <= top + 1; ly++) {
        const r = ly === top + 1 ? 2 : 4;
        for (let dx = -r; dx <= r + 1; dx++) {
          for (let dz = -r; dz <= r + 1; dz++) {
            const ex = dx < 0 ? -dx : dx - 1;
            const ez = dz < 0 ? -dz : dz - 1;
            if (ex + ez > r + 1 || (ex === r && ez === r)) continue;
            set(x + dx, ly, z + dz, leaves, false);
          }
        }
      }
      return;
    }
    case 'swamp_oak': {
      for (let ly = y; ly <= top; ly++) set(x, ly, z, log, true);
      roundCanopy(set, leaves, x, top, z, rand, true);
      // Vines hanging from the edge of the canopy.
      for (let i = 0; i < 10; i++) {
        const d = Math.floor(rand() * 4);
        const off = Math.floor(rand() * 7) - 3;
        const [dx, dz] = DIRS[d];
        const lx = x + dx * 3 + (dx === 0 ? off : 0);
        const lz = z + dz * 3 + (dz === 0 ? off : 0);
        vine(set, lx, top - 2, lz, d, 1 + Math.floor(rand() * 4));
      }
      return;
    }
    default: {
      // Oak / birch.
      roundCanopy(set, leaves, x, top, z, rand);
      for (let ly = y; ly <= top; ly++) set(x, ly, z, log, true);
    }
  }
}

// Tree grown from a sapling of the given wood.
export function saplingTree(wood, rand) {
  if (wood === 'oak') return rand() < 0.1 ? 'fancy_oak' : 'oak';
  if (wood === 'jungle') return 'jungle';
  return wood;
}

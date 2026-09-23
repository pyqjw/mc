// Tree shapes, shared by world generation and sapling growth.
// `set(x, y, z, id, overwrite)` places a block; `overwrite=false` only replaces air / replaceable blocks.
import { B } from './blocks.js';

export const TREE_TYPES = {
  oak: { log: B.OAK_LOG, leaves: B.OAK_LEAVES },
  birch: { log: B.BIRCH_LOG, leaves: B.BIRCH_LEAVES },
  spruce: { log: B.SPRUCE_LOG, leaves: B.SPRUCE_LEAVES },
};

export function treeHeight(type, rand) {
  if (type === 'spruce') return 6 + Math.floor(rand() * 4);
  if (type === 'birch') return 5 + Math.floor(rand() * 3);
  return 4 + Math.floor(rand() * 3);
}

// Places a tree whose trunk base is at (x, y, z).
export function placeTree(set, type, x, y, z, rand, height = treeHeight(type, rand)) {
  const { log, leaves } = TREE_TYPES[type];
  const top = y + height - 1;
  if (type === 'spruce') {
    let radius = 0;
    let maxR = 1;
    for (let ly = top + 1; ly >= y + 2; ly--) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (radius > 0 && Math.abs(dx) === radius && Math.abs(dz) === radius) continue;
          set(x + dx, ly, z + dz, leaves, false);
        }
      }
      if (radius >= maxR) {
        radius = 1;
        maxR = Math.min(maxR + 1, 3);
      } else {
        radius++;
      }
    }
  } else {
    for (let ly = top - 3; ly <= top + 1; ly++) {
      const rel = ly - top;
      const radius = rel >= 0 ? 1 : 2;
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
  for (let ly = y; ly <= top; ly++) set(x, ly, z, log, true);
}

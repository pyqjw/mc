// Voxel ray casting (Amanatides & Woo) with per-block selection boxes.
import { BLOCKS, RENDER, IS_FLUID, IS_SOLID, B } from './blocks.js';

// Selection / hit box of a block in local block coordinates.
export function blockBox(id, meta) {
  const b = BLOCKS[id];
  switch (b.render) {
    case RENDER.CROSS:
      if (id === B.WHEAT) return [0, 0, 0, 1, Math.max(2, (meta + 1) * 2) / 16, 1];
      return [0.15, 0, 0.15, 0.85, 0.8, 0.85];
    case RENDER.TORCH: return [0.375, 0, 0.375, 0.625, 0.625, 0.625];
    case RENDER.BED: return [0, 0, 0, 1, b.height, 1];
    default: return [0, 0, 0, 1, 1, 1];
  }
}

function rayBox(ox, oy, oz, dx, dy, dz, box) {
  let t0 = 0;
  let t1 = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  let face = -1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < box[a] || o[a] > box[a + 3]) return null;
      continue;
    }
    let ta = (box[a] - o[a]) / d[a];
    let tb = (box[a + 3] - o[a]) / d[a];
    let fa = a * 2 + 1; // entering through the min side => normal points negative
    if (ta > tb) { [ta, tb] = [tb, ta]; fa = a * 2; }
    if (ta > t0) { t0 = ta; face = fa; }
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return { t: t0, face };
}

const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Returns { x, y, z, id, meta, normal:[nx,ny,nz], dist } or null.
// opts.fluids: also hit fluid source blocks (for buckets). opts.solid: only hit solid blocks.
export function raycast(world, origin, dir, maxDist, opts = {}) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;
  const tDeltaX = Math.abs(1 / dir.x);
  const tDeltaY = Math.abs(1 / dir.y);
  const tDeltaZ = Math.abs(1 / dir.z);
  let tMaxX = dir.x > 0 ? (x + 1 - origin.x) * tDeltaX : (origin.x - x) * tDeltaX;
  let tMaxY = dir.y > 0 ? (y + 1 - origin.y) * tDeltaY : (origin.y - y) * tDeltaY;
  let tMaxZ = dir.z > 0 ? (z + 1 - origin.z) * tDeltaZ : (origin.z - z) * tDeltaZ;
  if (!isFinite(tMaxX)) tMaxX = Infinity;
  if (!isFinite(tMaxY)) tMaxY = Infinity;
  if (!isFinite(tMaxZ)) tMaxZ = Infinity;

  for (let i = 0; i < 200; i++) {
    const id = world.getBlock(x, y, z);
    if (id > 0) {
      const meta = world.getMeta(x, y, z);
      let hit = false;
      if (IS_FLUID[id]) hit = !!opts.fluids && meta === 0;
      else hit = !opts.solid || IS_SOLID[id] === 1;
      if (hit) {
        const box = IS_FLUID[id] ? [0, 0, 0, 1, 1, 1] : blockBox(id, meta);
        const r = rayBox(origin.x - x, origin.y - y, origin.z - z, dir.x, dir.y, dir.z, box);
        if (r && r.t <= maxDist) {
          const normal = r.face >= 0 ? FACE_NORMALS[r.face] : [0, 1, 0];
          return { x, y, z, id, meta, normal, dist: r.t, box };
        }
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      if (tMaxX > maxDist) break;
      x += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      if (tMaxY > maxDist) break;
      y += stepY;
      tMaxY += tDeltaY;
    } else {
      if (tMaxZ > maxDist) break;
      z += stepZ;
      tMaxZ += tDeltaZ;
    }
  }
  return null;
}

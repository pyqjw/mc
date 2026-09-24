// Voxel ray casting (Amanatides & Woo) with per-block selection boxes.
import { BLOCKS, RENDER, IS_FLUID, IS_SOLID, B } from './blocks.js';
import { SHAPE_OF, shapeBoxes, selectionBox } from './shapes.js';

// Selection box of a torch: standing, or on a wall (meta 1..4 = direction away from the wall + 1).
function torchBox(meta) {
  const p = (v) => v / 16;
  switch (meta) {
    case 1: return [p(5.5), p(3), p(11), p(10.5), p(13), 1]; // north: wall to the south
    case 2: return [0, p(3), p(5.5), p(5), p(13), p(10.5)]; // east: wall to the west
    case 3: return [p(5.5), p(3), 0, p(10.5), p(13), p(5)]; // south
    case 4: return [p(11), p(3), p(5.5), 1, p(13), p(10.5)]; // west
    default: return [p(6), 0, p(6), p(10), p(10), p(10)];
  }
}

// Selection / hit boxes of a block in local block coordinates. `nb(dx, dz)` gives neighbours.
export function selectBoxes(id, meta, nb = null) {
  const b = BLOCKS[id];
  if (SHAPE_OF[id]) return shapeBoxes(id, meta, 'select', nb);
  switch (b.render) {
    case RENDER.CROSS:
      if (id === B.WHEAT) return [[0, 0, 0, 1, Math.max(2, (meta + 1) * 2) / 16, 1]];
      return [[0.15, 0, 0.15, 0.85, 0.8, 0.85]];
    case RENDER.TORCH: return [torchBox(meta)];
    case RENDER.BED: return [[0, 0, 0, 1, b.height, 1]];
    default: return [[0, 0, 0, 1, 1, 1]];
  }
}

// Bounding selection box (for the highlight outline).
export function blockBox(id, meta, nb = null) {
  if (SHAPE_OF[id]) return selectionBox(id, meta, nb);
  return selectBoxes(id, meta, nb)[0];
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
        const bx = x;
        const bz = z;
        const by = y;
        const nb = (dx, dz) => [world.getBlock(bx + dx, by, bz + dz), world.getMeta(bx + dx, by, bz + dz)];
        const boxes = IS_FLUID[id] ? [[0, 0, 0, 1, 1, 1]] : selectBoxes(id, meta, nb);
        let best = null;
        for (const box of boxes) {
          const r = rayBox(origin.x - x, origin.y - y, origin.z - z, dir.x, dir.y, dir.z, box);
          if (r && r.t <= maxDist && (!best || r.t < best.t)) best = r;
        }
        if (best) {
          const normal = best.face >= 0 ? FACE_NORMALS[best.face] : [0, 1, 0];
          const box = IS_FLUID[id] ? [0, 0, 0, 1, 1, 1] : blockBox(id, meta, nb);
          return { x, y, z, id, meta, normal, dist: best.t, box };
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

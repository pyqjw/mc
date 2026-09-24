// AABB-vs-voxel collision shared by the player, mobs and dropped items.
import { BLOCKS, IS_SOLID, IS_FLUID, fluidHeight } from '../world/blocks.js';
import { SHAPE_OF, shapeBoxes } from '../world/shapes.js';

const BLOCK_TOP = new Float32Array(256).fill(1);
for (const b of BLOCKS) if (b) BLOCK_TOP[b.id] = b.height;

const EPS = 1e-7;

// Calls cb(x0, y0, z0, x1, y1, z1) for every collision box of the block at (x, y, z).
export function forEachCollisionBox(world, x, y, z, cb) {
  const id = world.getBlock(x, y, z);
  if (id < 0) { cb(x, y, z, x + 1, y + 1, z + 1); return; } // unloaded chunks and the void floor act as walls
  if (!IS_SOLID[id]) return;
  if (SHAPE_OF[id]) {
    const nb = (dx, dz) => [world.getBlock(x + dx, y, z + dz), world.getMeta(x + dx, y, z + dz)];
    for (const b of shapeBoxes(id, world.getMeta(x, y, z), 'collision', nb)) cb(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
    return;
  }
  cb(x, y, z, x + 1, y + BLOCK_TOP[id], z + 1);
}

// Box: [minX, minY, minZ, maxX, maxY, maxZ]
function sweep(world, box, axis, d) {
  if (d === 0) return 0;
  const lo = [box[0], box[1], box[2]];
  const hi = [box[3], box[4], box[5]];
  if (d > 0) hi[axis] += d; else lo[axis] += d;
  const x0 = Math.floor(lo[0]); const x1 = Math.floor(hi[0] - EPS);
  const y0 = Math.floor(lo[1]) - 1; const y1 = Math.floor(hi[1] - EPS);
  const z0 = Math.floor(lo[2]); const z1 = Math.floor(hi[2] - EPS);
  const cmin = [0, 0, 0];
  const cmax = [0, 0, 0];
  const test = (ax, ay, az, bx, by, bz) => {
    cmin[0] = ax; cmin[1] = ay; cmin[2] = az;
    cmax[0] = bx; cmax[1] = by; cmax[2] = bz;
    for (let a = 0; a < 3; a++) {
      if (a === axis) continue;
      if (box[a + 3] <= cmin[a] + EPS || box[a] >= cmax[a] - EPS) return;
    }
    if (d > 0 && box[axis + 3] <= cmin[axis] + EPS) d = Math.min(d, cmin[axis] - box[axis + 3]);
    else if (d < 0 && box[axis] >= cmax[axis] - EPS) d = Math.max(d, cmax[axis] - box[axis]);
  };
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) forEachCollisionBox(world, x, y, z, test);
    }
  }
  return d;
}

function makeBox(e, px, py, pz) {
  return [px - e.halfW, py, pz - e.halfW, px + e.halfW, py + e.height, pz + e.halfW];
}

function moveOnce(world, e, px, py, pz, dx, dy, dz) {
  let box = makeBox(e, px, py, pz);
  const ry = sweep(world, box, 1, dy);
  py += ry;
  box = makeBox(e, px, py, pz);
  const rx = sweep(world, box, 0, dx);
  px += rx;
  box = makeBox(e, px, py, pz);
  const rz = sweep(world, box, 2, dz);
  pz += rz;
  return { px, py, pz, rx, ry, rz };
}

// Moves entity `e` (pos: feet centre, halfW, height, stepHeight) by (dx, dy, dz) with collision.
export function moveEntity(world, e, dx, dy, dz) {
  const p = e.pos;
  let r = moveOnce(world, e, p.x, p.y, p.z, dx, dy, dz);
  const blockedH = Math.abs(r.rx - dx) > 1e-9 || Math.abs(r.rz - dz) > 1e-9;
  const grounded = e.onGround || (dy < 0 && r.ry !== dy);
  if (blockedH && grounded && e.stepHeight > 0) {
    // Try stepping up onto a low obstacle.
    const up = moveOnce(world, e, p.x, p.y, p.z, 0, e.stepHeight, 0);
    const across = moveOnce(world, e, up.px, up.py, up.pz, dx, 0, dz);
    const down = moveOnce(world, e, across.px, across.py, across.pz, 0, -(up.py - p.y) + Math.min(0, dy), 0);
    const d1 = r.rx * r.rx + r.rz * r.rz;
    const d2 = (down.px - p.x) ** 2 + (down.pz - p.z) ** 2;
    if (d2 > d1 + 1e-6) {
      r = { px: down.px, py: down.py, pz: down.pz, rx: down.px - p.x, ry: dy < 0 ? dy : 0, rz: down.pz - p.z };
      r.stepped = true;
    }
  }
  const hitX = Math.abs(r.rx - dx) > 1e-9;
  const hitZ = Math.abs(r.rz - dz) > 1e-9;
  const hitY = Math.abs(r.ry - dy) > 1e-9;
  p.x = r.px;
  p.y = r.py;
  p.z = r.pz;
  e.onGround = r.stepped ? true : hitY && dy < 0;
  e.hitCeiling = hitY && dy > 0;
  e.hitH = hitX || hitZ;
  return { hitX, hitY, hitZ };
}

// Is there solid support directly below the box at (px, pz)? Used for sneaking at edges.
export function hasGroundBelow(world, e, px, py, pz) {
  const box = makeBox(e, px, py, pz);
  return sweep(world, box, 1, -0.6) > -0.6 + 1e-6;
}

// How deep (0..1 of the entity height) the entity is submerged in the given fluid id.
export function fluidSubmersion(world, e, fluid) {
  const p = e.pos;
  const x0 = Math.floor(p.x - e.halfW + 0.001);
  const x1 = Math.floor(p.x + e.halfW - 0.001);
  const z0 = Math.floor(p.z - e.halfW + 0.001);
  const z1 = Math.floor(p.z + e.halfW - 0.001);
  const y0 = Math.floor(p.y);
  const y1 = Math.floor(p.y + e.height);
  let top = -Infinity;
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const id = world.getBlock(x, y, z);
        if (id !== fluid) continue;
        const above = world.getBlock(x, y + 1, z);
        const surface = y + fluidHeight(world.getMeta(x, y, z), above === fluid);
        if (surface > p.y) top = Math.max(top, surface);
      }
    }
  }
  if (top === -Infinity) return 0;
  return Math.min(1, (top - p.y) / e.height);
}

export function pointInFluid(world, x, y, z) {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);
  const id = world.getBlock(bx, by, bz);
  if (id <= 0 || !IS_FLUID[id]) return 0;
  const above = world.getBlock(bx, by + 1, bz);
  const surface = by + fluidHeight(world.getMeta(bx, by, bz), above === id);
  return y < surface ? id : 0;
}

// Is the point inside a block's collision boxes?
export function pointInSolid(world, x, y, z) {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);
  let inside = false;
  forEachCollisionBox(world, bx, by, bz, (x0, y0, z0, x1, y1, z1) => {
    if (x > x0 && x < x1 && y > y0 && y < y1 && z > z0 && z < z1) inside = true;
  });
  return inside;
}

// Is the entity in a climbable block (ladder)?
export function onClimbable(world, e) {
  const x = Math.floor(e.pos.x);
  const z = Math.floor(e.pos.z);
  for (const y of [Math.floor(e.pos.y), Math.floor(e.pos.y + 0.6)]) {
    const id = world.getBlock(x, y, z);
    if (id > 0 && BLOCKS[id].climbable) return true;
  }
  return false;
}

// Does the entity's box intersect any block with the given predicate?
export function touchingBlocks(world, e, grow = 0.01) {
  const p = e.pos;
  const out = [];
  const x0 = Math.floor(p.x - e.halfW - grow);
  const x1 = Math.floor(p.x + e.halfW + grow);
  const z0 = Math.floor(p.z - e.halfW - grow);
  const z1 = Math.floor(p.z + e.halfW + grow);
  const y0 = Math.floor(p.y - grow);
  const y1 = Math.floor(p.y + e.height + grow);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = world.getBlock(x, y, z);
    if (id > 0) out.push(id);
  }
  return out;
}

export { BLOCK_TOP };

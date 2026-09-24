import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeBoxes, stairShape, STAIR, doorBox } from '../src/world/shapes.js';
import { B } from '../src/world/blocks.js';
import { World } from '../src/world/world.js';
import { moveEntity } from '../src/entity/physics.js';
import { buildChunkMesh } from '../src/world/mesher.js';
import { blockIndex, CHUNK_VOLUME } from '../src/constants.js';
import { raycast } from '../src/world/raycast.js';

function flatWorld() {
  const w = new World({ seed: 1, worldId: 't', storage: null, scene: null, materials: null, workers: false });
  w.requestMesh = () => {};
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const blocks = new Uint8Array(CHUNK_VOLUME);
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y <= 10; y++) blocks[blockIndex(x, y, z)] = B.STONE;
      w.insertChunk(cx, cz, blocks);
    }
  }
  w.game = { spawnBlockDrops: () => {}, dropItem: () => {}, sound: () => {} };
  return w;
}

test('slab halves and stair steps', () => {
  assert.deepEqual(shapeBoxes(B.OAK_SLAB, 0, 'collision'), [[0, 0, 0, 1, 0.5, 1]]);
  assert.deepEqual(shapeBoxes(B.OAK_SLAB, 1, 'collision'), [[0, 0.5, 0, 1, 1, 1]]);
  // Stairs facing east: bottom slab plus the east half on top.
  assert.deepEqual(shapeBoxes(B.OAK_STAIRS, 1, 'collision', null), [[0, 0, 0, 1, 0.5, 1], [0.5, 0.5, 0, 1, 1, 1]]);
});

test('stairs form inner and outer corners like Minecraft', () => {
  // Facing north with a west-facing stair in front (north) -> outer corner.
  const nb = (map) => (dx, dz) => map[`${dx},${dz}`] || [0, 0];
  assert.equal(stairShape(0, nb({ '0,-1': [B.OAK_STAIRS, 3] })), STAIR.OUTER_LEFT);
  assert.equal(stairShape(0, nb({ '0,1': [B.OAK_STAIRS, 1] })), STAIR.INNER_RIGHT);
  assert.equal(stairShape(0, nb({ '0,1': [B.OAK_STAIRS, 1 | 4] })), STAIR.STRAIGHT); // other half
  assert.equal(stairShape(0, nb({})), STAIR.STRAIGHT);
});

test('doors swing on their hinge', () => {
  assert.deepEqual(doorBox(0), [0, 0, 13 / 16, 1, 1, 1]); // closed, facing north
  assert.deepEqual(doorBox(0 | 4), [0, 0, 0, 3 / 16, 1, 1]); // open, hinge left
  assert.deepEqual(doorBox(0 | 4 | 16), [13 / 16, 0, 0, 1, 1, 1]); // open, hinge right
});

test('entities stand on slabs and step up stairs', () => {
  const w = flatWorld();
  w.setBlock(0, 11, 0, B.OAK_SLAB, { meta: 0 });
  const e = { pos: { x: 0.5, y: 13, z: 0.5 }, halfW: 0.3, height: 1.8, stepHeight: 0.6, onGround: false };
  for (let i = 0; i < 40; i++) moveEntity(w, e, 0, -0.2, 0);
  assert.ok(Math.abs(e.pos.y - 11.5) < 1e-6, `y=${e.pos.y}`);
  // Walk from the floor onto a stair step without jumping.
  w.setBlock(3, 11, 0, B.OAK_STAIRS, { meta: 1 }); // tall half to the east
  const p = { pos: { x: 1.5, y: 11, z: 0.5 }, halfW: 0.3, height: 1.8, stepHeight: 0.6, onGround: true };
  for (let i = 0; i < 20; i++) moveEntity(w, p, 0.1, -0.05, 0);
  assert.ok(p.pos.y >= 11.5 - 1e-6, `stepped to ${p.pos.y}`);
});

test('breaking one half of a door or bed removes the other', () => {
  const w = flatWorld();
  w.setBlock(0, 11, 0, B.OAK_DOOR, { meta: 0, update: false });
  w.setBlock(0, 12, 0, B.OAK_DOOR, { meta: 8 });
  assert.equal(w.getBlock(0, 12, 0), B.OAK_DOOR);
  w.setBlock(0, 11, 0, B.AIR);
  assert.equal(w.getBlock(0, 12, 0), B.AIR);
  w.setBlock(2, 11, 2, B.BED, { meta: 1, update: false });
  w.setBlock(3, 11, 2, B.BED, { meta: 1 | 4 });
  w.setBlock(3, 11, 2, B.AIR);
  assert.equal(w.getBlock(2, 11, 2), B.AIR);
  // Toggling opens both halves.
  w.setBlock(5, 11, 5, B.OAK_DOOR, { meta: 2, update: false });
  w.setBlock(5, 12, 5, B.OAK_DOOR, { meta: 2 | 8 });
  assert.equal(w.toggleDoor(5, 12, 5), true);
  assert.equal(w.getMeta(5, 11, 5) & 4, 4);
});

test('wall torches and ladders need their wall', () => {
  const w = flatWorld();
  w.setBlock(0, 11, 0, B.STONE);
  w.setBlock(1, 11, 0, B.TORCH, { meta: 1 + 1 }); // leaning east, wall to the west
  w.setBlock(0, 12, 1, B.STONE);
  w.setBlock(0, 12, 2, B.LADDER, { meta: 2 }); // facing south, wall to the north
  w.setBlock(0, 11, 0, B.AIR);
  assert.equal(w.getBlock(1, 11, 0), B.AIR);
  assert.equal(w.getBlock(0, 12, 2), B.LADDER);
  w.setBlock(0, 12, 1, B.AIR);
  assert.equal(w.getBlock(0, 12, 2), B.AIR);
});

test('shaped blocks mesh, and slabs pass on neighbouring light', () => {
  const chunks = [];
  for (let i = 0; i < 9; i++) chunks.push({ blocks: new Uint8Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME) });
  chunks[4].blocks[blockIndex(5, 60, 5)] = B.OAK_SLAB;
  chunks[4].blocks[blockIndex(7, 60, 5)] = B.OAK_FENCE;
  chunks[4].blocks[blockIndex(8, 60, 5)] = B.OAK_FENCE;
  const r = buildChunkMesh(chunks);
  assert.ok(r.solid.indices.length / 6 >= 6 + 6 * 2);
  assert.equal(r.skyLight[blockIndex(5, 60, 5)], 15);
});

test('rays hit the actual shape of a slab', () => {
  const w = flatWorld();
  w.setBlock(0, 11, 0, B.STONE_SLAB, { meta: 0 });
  const hit = raycast(w, { x: 0.5, y: 13, z: 0.5 }, { x: 0, y: -1, z: 0 }, 5);
  assert.equal(hit.id, B.STONE_SLAB);
  assert.ok(Math.abs(hit.dist - 1.5) < 1e-6);
  assert.deepEqual(hit.normal, [0, 1, 0]);
});

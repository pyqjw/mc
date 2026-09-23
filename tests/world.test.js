import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, newFurnace } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { I } from '../src/items.js';
import { blockIndex, CHUNK_VOLUME } from '../src/constants.js';

// A 3x3 chunk flat world with a stone floor at y=10.
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
  const drops = [];
  w.game = { spawnBlockDrops: (x, y, z, id) => drops.push(id), dropItem: () => {}, sound: () => {} };
  w.drops = drops;
  return w;
}

function run(w, ticks) {
  for (let i = 0; i < ticks; i++) w.tick(1000, 1000); // player far away: no random ticks nearby
}

test('water spreads 7 blocks on flat ground', () => {
  const w = flatWorld();
  w.setBlock(0, 11, 0, B.WATER);
  run(w, 200);
  assert.equal(w.getBlock(7, 11, 0), B.WATER);
  assert.equal(w.getMeta(7, 11, 0), 7);
  assert.equal(w.getBlock(8, 11, 0), B.AIR);
  assert.equal(w.getBlock(0, 11, -7), B.WATER);
});

test('removing the source makes flowing water disappear', () => {
  const w = flatWorld();
  w.setBlock(0, 11, 0, B.WATER);
  run(w, 200);
  w.setBlock(0, 11, 0, B.AIR);
  run(w, 300);
  assert.equal(w.getBlock(3, 11, 0), B.AIR);
});

test('water flowing onto lava makes obsidian', () => {
  const w = flatWorld();
  w.setBlock(2, 11, 0, B.LAVA);
  w.setBlock(0, 11, 0, B.WATER);
  run(w, 100);
  assert.equal(w.getBlock(2, 11, 0), B.OBSIDIAN);
});

test('sand falls when unsupported', () => {
  const w = flatWorld();
  w.setBlock(3, 15, 3, B.SAND, { update: false });
  w.setBlock(3, 14, 3, B.DIRT, { update: false });
  w.setBlock(3, 14, 3, B.AIR);
  assert.equal(w.getBlock(3, 15, 3), B.AIR);
  assert.equal(w.getBlock(3, 11, 3), B.SAND);
});

test('torches and flowers pop off when their support is removed', () => {
  const w = flatWorld();
  w.setBlock(1, 11, 1, B.DIRT);
  w.setBlock(1, 12, 1, B.POPPY);
  w.setBlock(1, 11, 1, B.AIR);
  assert.equal(w.getBlock(1, 12, 1), B.AIR);
  assert.ok(w.drops.includes(B.POPPY));
});

test('leaves decay after the log is removed', () => {
  const w = flatWorld();
  w.setBlock(5, 11, 5, B.OAK_LOG, { update: false });
  w.setBlock(5, 12, 5, B.OAK_LEAVES, { update: false });
  w.setBlock(6, 12, 5, B.OAK_LEAVES, { update: false, meta: 1 }); // player placed: persistent
  w.setBlock(5, 11, 5, B.AIR);
  run(w, 300);
  assert.equal(w.getBlock(5, 12, 5), B.AIR);
  assert.equal(w.getBlock(6, 12, 5), B.OAK_LEAVES);
});

test('furnace smelts ore with coal', () => {
  const w = flatWorld();
  w.setBlock(0, 11, 0, B.FURNACE);
  const t = w.tiles.get('0,11,0');
  assert.deepEqual(t, newFurnace());
  t.items[0] = { id: I.IRON_ORE, count: 2, damage: 0 };
  t.items[1] = { id: I.COAL, count: 1, damage: 0 };
  run(w, 5);
  assert.equal(w.getBlock(0, 11, 0), B.LIT_FURNACE);
  run(w, 400);
  assert.deepEqual(t.items[2], { id: I.IRON_INGOT, count: 2, damage: 0 });
  assert.equal(t.items[0], null);
});

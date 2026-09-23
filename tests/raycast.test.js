import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raycast } from '../src/world/raycast.js';
import { B } from '../src/world/blocks.js';

function mockWorld(blocks) {
  return {
    getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) || 0,
    getMeta: () => 0,
  };
}

test('hits the first block and reports the face normal', () => {
  const w = mockWorld(new Map([['0,0,-3', B.STONE], ['0,0,-5', B.DIRT]]));
  const hit = raycast(w, { x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
  assert.equal(hit.id, B.STONE);
  assert.deepEqual([hit.x, hit.y, hit.z], [0, 0, -3]);
  assert.deepEqual(hit.normal, [0, 0, 1]);
  assert.ok(Math.abs(hit.dist - 2.5) < 1e-9);
});

test('respects max distance and skips water unless asked', () => {
  const w = mockWorld(new Map([['0,-2,0', B.WATER], ['0,-4,0', B.STONE]]));
  const dir = { x: 0, y: -1, z: 0 };
  assert.equal(raycast(w, { x: 0.5, y: 0.5, z: 0.5 }, dir, 2), null);
  assert.equal(raycast(w, { x: 0.5, y: 0.5, z: 0.5 }, dir, 10).id, B.STONE);
  assert.equal(raycast(w, { x: 0.5, y: 0.5, z: 0.5 }, dir, 10, { fluids: true }).id, B.WATER);
});

test('small blocks like torches use their own hit box', () => {
  const w = mockWorld(new Map([['0,0,-2', B.TORCH]]));
  // Passing beside the torch stick misses it.
  assert.equal(raycast(w, { x: 0.1, y: 0.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 5), null);
  assert.equal(raycast(w, { x: 0.5, y: 0.3, z: 0.5 }, { x: 0, y: 0, z: -1 }, 5).id, B.TORCH);
});

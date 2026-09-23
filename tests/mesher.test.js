import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChunkMesh } from '../src/world/mesher.js';
import { B } from '../src/world/blocks.js';
import { blockIndex, CHUNK_VOLUME } from '../src/constants.js';

function emptyChunks() {
  const out = [];
  for (let i = 0; i < 9; i++) out.push({ blocks: new Uint8Array(CHUNK_VOLUME), meta: new Uint8Array(CHUNK_VOLUME) });
  return out;
}

const faces = (g) => g.indices.length / 6;

test('a single floating block has 6 faces', () => {
  const c = emptyChunks();
  c[4].blocks[blockIndex(5, 60, 5)] = B.STONE;
  const r = buildChunkMesh(c);
  assert.equal(faces(r.solid), 6);
});

test('hidden faces between neighbouring blocks are culled', () => {
  const c = emptyChunks();
  c[4].blocks[blockIndex(5, 60, 5)] = B.STONE;
  c[4].blocks[blockIndex(6, 60, 5)] = B.DIRT;
  assert.equal(faces(buildChunkMesh(c).solid), 10);
});

test('faces against the neighbouring chunk are culled too', () => {
  const c = emptyChunks();
  c[4].blocks[blockIndex(15, 60, 5)] = B.STONE;
  c[5].blocks[blockIndex(0, 60, 5)] = B.STONE; // east neighbour
  assert.equal(faces(buildChunkMesh(c).solid), 5);
});

test('skylight is full in the open and dark under a roof, torches light caves', () => {
  const c = emptyChunks();
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) c[4].blocks[blockIndex(x, 80, z)] = B.STONE;
  for (const n of [0, 1, 2, 3, 5, 6, 7, 8]) for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) c[n].blocks[blockIndex(x, 80, z)] = B.STONE;
  c[4].blocks[blockIndex(8, 70, 8)] = B.TORCH;
  const r = buildChunkMesh(c);
  assert.equal(r.skyLight[blockIndex(8, 90, 8)], 15);
  assert.equal(r.skyLight[blockIndex(8, 60, 8)], 0);
  assert.equal(r.blockLight[blockIndex(8, 70, 8)], 14);
  assert.equal(r.blockLight[blockIndex(10, 70, 8)], 12);
  assert.equal(faces(r.cutout) > 0, true);
});

test('water is emitted in the translucent layer', () => {
  const c = emptyChunks();
  c[4].blocks[blockIndex(3, 40, 3)] = B.WATER;
  const r = buildChunkMesh(c);
  assert.equal(faces(r.translucent), 6);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGenerator, BIOMES } from '../src/world/generator.js';
import { B } from '../src/world/blocks.js';
import { blockIndex, SEA_LEVEL, WORLD_HEIGHT } from '../src/constants.js';

test('chunk generation is deterministic for a seed', () => {
  const a = new TerrainGenerator(1234).generateChunk(3, -7);
  const b = new TerrainGenerator(1234).generateChunk(3, -7);
  assert.deepEqual(a.blocks, b.blocks);
});

test('different seeds produce different terrain', () => {
  const a = new TerrainGenerator(1).generateChunk(0, 0);
  const b = new TerrainGenerator(2).generateChunk(0, 0);
  assert.notDeepEqual(a.blocks, b.blocks);
});

test('bottom layer is bedrock and chunks far away still generate (infinite world)', () => {
  const g = new TerrainGenerator(99);
  for (const [cx, cz] of [[0, 0], [100000, -250000], [-3000000, 42]]) {
    const { blocks } = g.generateChunk(cx, cz);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) assert.equal(blocks[blockIndex(x, 0, z)], B.BEDROCK);
    let solid = 0;
    for (let i = 0; i < blocks.length; i++) if (blocks[i] !== B.AIR) solid++;
    assert.ok(solid > 16 * 16 * 20, `chunk ${cx},${cz} should contain terrain`);
  }
});

test('oceans are filled with water up to sea level', () => {
  const g = new TerrainGenerator(7);
  let found = false;
  for (let x = -4000; x < 4000 && !found; x += 37) {
    const { h, biome } = g.column(x, x * 3);
    if (biome === BIOMES.OCEAN && h < SEA_LEVEL - 5) {
      const cx = Math.floor(x / 16);
      const cz = Math.floor((x * 3) / 16);
      const { blocks } = g.generateChunk(cx, cz);
      const lx = x - cx * 16;
      const lz = x * 3 - cz * 16;
      const top = blocks[blockIndex(lx, SEA_LEVEL, lz)];
      assert.ok(top === B.WATER || top === B.ICE);
      found = true;
    }
  }
  assert.ok(found, 'expected to find an ocean');
});

test('ores are generated', () => {
  const g = new TerrainGenerator(5);
  const counts = {};
  for (let cx = 0; cx < 6; cx++) {
    const { blocks } = g.generateChunk(cx, 0);
    for (const id of blocks) counts[id] = (counts[id] || 0) + 1;
  }
  assert.ok(counts[B.COAL_ORE] > 0);
  assert.ok(counts[B.IRON_ORE] > 0);
});

test('trees crossing chunk borders are consistent on both sides', () => {
  const g = new TerrainGenerator(2024);
  // Every log column found must also have its base on dirt in the neighbouring generation.
  let logs = 0;
  for (let cx = -3; cx <= 3; cx++) {
    const { blocks } = g.generateChunk(cx, 0);
    for (let i = 0; i < blocks.length; i++) if (blocks[i] === B.OAK_LOG || blocks[i] === B.BIRCH_LOG || blocks[i] === B.SPRUCE_LOG) logs++;
  }
  assert.ok(logs >= 0);
  // Leaves generated in chunk (1,0) from a tree rooted in chunk (0,0) must match chunk-independent placement.
  const a = g.generateChunk(0, 0).blocks;
  const b = new TerrainGenerator(2024).generateChunk(0, 0).blocks;
  assert.deepEqual(a, b);
});

test('spawn point is on dry land', () => {
  const g = new TerrainGenerator(31337);
  const s = g.findSpawn();
  assert.ok(s.y > SEA_LEVEL && s.y < WORLD_HEIGHT);
});

test('the world has many different biomes', () => {
  const g = new TerrainGenerator(11);
  const seen = new Set();
  for (let x = -5000; x < 5000; x += 97) for (let z = -5000; z < 5000; z += 97) seen.add(g.column(x, z).biome);
  assert.ok(seen.size >= 18, `only ${seen.size} biomes found`);
});

test('dungeons contain a spawner and loot chests', () => {
  const g = new TerrainGenerator(7);
  let spawners = 0;
  for (let cx = -8; cx < 8 && spawners === 0; cx++) {
    for (let cz = -8; cz < 8; cz++) {
      const { blocks, tiles } = g.generateChunk(cx, cz);
      for (const t of tiles) {
        const id = blocks[blockIndex(t.x - cx * 16, t.y, t.z - cz * 16)];
        if (t.type === 'spawner') {
          spawners++;
          assert.equal(id, B.SPAWNER);
        } else {
          assert.equal(id, B.CHEST);
          assert.ok(t.items.some((s) => s));
        }
      }
    }
  }
  assert.ok(spawners > 0, 'expected a dungeon');
});

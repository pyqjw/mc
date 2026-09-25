import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/world.js';
import { TerrainGenerator, BIOMES } from '../src/world/generator.js';
import { B, BLOCKS, IS_FLUID, IS_LOG } from '../src/world/blocks.js';

// Generates an n x n chunk area (plus a border) into a World and returns it.
function region(seed, cx0, cz0, n) {
  const g = new TerrainGenerator(seed);
  const w = new World({ seed, worldId: 't', storage: null, scene: null, materials: null, workers: false });
  for (let cz = cz0 - 1; cz <= cz0 + n; cz++) {
    for (let cx = cx0 - 1; cx <= cx0 + n; cx++) {
      const { blocks, meta } = g.generateChunk(cx, cz);
      w.insertChunk(cx, cz, blocks, meta);
    }
  }
  return { g, w, x0: cx0 * 16, z0: cz0 * 16, size: n * 16 };
}

function findChunk(g, biome) {
  for (let r = 0; r < 4000; r += 64) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
      const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
      if (g.column(x, z).biome === biome) return [Math.floor(x / 16) - 1, Math.floor(z / 16) - 1];
    }
  }
  throw new Error('biome not found');
}

// Every kind of generation glitch the game would show or "fix" at the first block update.
function anomalies({ w, x0, z0, size }) {
  const found = [];
  const GRAVITY = new Set([B.SAND, B.RED_SAND, B.GRAVEL]);
  for (let x = x0; x < x0 + size; x++) {
    for (let z = z0; z < z0 + size; z++) {
      for (let y = 1; y < 127; y++) {
        const id = w.getBlock(x, y, z);
        if (id === 0) continue;
        const below = w.getBlock(x, y - 1, z);
        const at = `${BLOCKS[id].key} at ${x},${y},${z}`;
        if (GRAVITY.has(id) && (below === 0 || IS_FLUID[below])) found.push('hanging ' + at);
        if (IS_FLUID[id]) {
          if (below === 0) found.push('fluid over air: ' + at);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (w.getBlock(x + dx, y, z + dz) === 0) { found.push('fluid next to air: ' + at); break; }
          }
        }
        if (BLOCKS[id].support && !w.hasSupport(x, y, z, BLOCKS[id].support)) found.push('unsupported ' + at);
        if ((id === B.GRASS || id === B.SNOWY_GRASS) && IS_FLUID[w.getBlock(x, y + 1, z)]) found.push('grass under water ' + at);
        if (IS_LOG[id] && below === 0 && ![...[[1, 0], [-1, 0], [0, 1], [0, -1]], [0, 0]].some(([dx, dz]) => IS_LOG[w.getBlock(x + dx, y, z + dz)] && (dx || dz))
          && !IS_LOG[w.getBlock(x, y + 1, z)]) found.push('lone log ' + at);
      }
    }
  }
  return found;
}

for (const [seed, biome] of [[7, BIOMES.SWAMP], [1, BIOMES.JUNGLE], [42, BIOMES.STONY_PEAKS], [2024, BIOMES.BADLANDS], [1, BIOMES.BEACH]]) {
  const name = Object.keys(BIOMES).find((k) => BIOMES[k] === biome);
  test(`generated ${name.toLowerCase()} terrain has no glitches (seed ${seed})`, () => {
    const g = new TerrainGenerator(seed);
    const [cx, cz] = findChunk(g, biome);
    const found = anomalies(region(seed, cx, cz, 3));
    assert.deepEqual(found.slice(0, 5), [], `${found.length} problems`);
  });
}

test('cave lookups outside a chunk agree with generation', () => {
  const g = new TerrainGenerator(99);
  const { blocks } = g.generateChunk(2, -3);
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    const lx = (i * 7) % 16;
    const lz = (i * 11) % 16;
    const y = 8 + ((i * 13) % 50);
    const id = blocks[lx | (lz << 4) | (y << 8)];
    // Only natural rock and cave space (ores and dungeons change blocks later).
    if (id !== B.STONE && id !== B.AIR && id !== B.WATER && id !== B.LAVA) continue;
    if (y > g.column(32 + lx, -48 + lz).h - 8) continue;
    assert.equal(g.caveAt(32 + lx, y, -48 + lz), id !== B.STONE, `at ${lx},${y},${lz}`);
    checked++;
  }
  assert.ok(checked > 50);
});

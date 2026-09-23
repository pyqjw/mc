// Deterministic infinite terrain generator. Any chunk can be generated independently from the seed.
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, CHUNK_VOLUME, blockIndex } from '../constants.js';
import { B } from './blocks.js';
import { SimplexNoise, mulberry32, hash3, hashFloat } from './noise.js';
import { placeTree } from './trees.js';

export const BIOMES = {
  OCEAN: 0,
  BEACH: 1,
  PLAINS: 2,
  FOREST: 3,
  DESERT: 4,
  TAIGA: 5,
  SNOWY: 6,
  MOUNTAINS: 7,
  RIVER: 8,
  BIRCH_FOREST: 9,
};
export const BIOME_NAMES = ['海洋', '沙滩', '平原', '森林', '沙漠', '针叶林', '雪原', '山地', '河流', '桦木森林'];

// Trees per column for each biome.
const TREE_DENSITY = [0, 0, 0.004, 0.045, 0, 0.03, 0.008, 0.006, 0, 0.04];
const MAX_TREE_DENSITY = 0.045;

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Continentalness -> base height spline.
const SPLINE = [
  [-1.0, 28], [-0.45, 38], [-0.25, 50], [-0.12, 59], [-0.05, 63], [0.05, 66], [0.3, 72], [0.6, 80], [1.0, 88],
];
function spline(c) {
  if (c <= SPLINE[0][0]) return SPLINE[0][1];
  for (let i = 1; i < SPLINE.length; i++) {
    if (c <= SPLINE[i][0]) {
      const [x0, y0] = SPLINE[i - 1];
      const [x1, y1] = SPLINE[i];
      const t = (c - x0) / (x1 - x0);
      return lerp(y0, y1, t * t * (3 - 2 * t));
    }
  }
  return SPLINE[SPLINE.length - 1][1];
}

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    const rand = mulberry32(this.seed);
    this.continental = new SimplexNoise(rand);
    this.hills = new SimplexNoise(rand);
    this.mountain = new SimplexNoise(rand);
    this.ridge = new SimplexNoise(rand);
    this.temperature = new SimplexNoise(rand);
    this.humidity = new SimplexNoise(rand);
    this.river = new SimplexNoise(rand);
    this.cave1 = new SimplexNoise(rand);
    this.cave2 = new SimplexNoise(rand);
    this.cave3 = new SimplexNoise(rand);
    this.detail = new SimplexNoise(rand);
  }

  // Height and biome of a world column. Pure function of (x, z).
  column(x, z) {
    const c = this.continental.fbm2(x / 700, z / 700, 5) * 1.3 + 0.12;
    let h = spline(c);
    const land = smoothstep(-0.12, 0.05, c);
    const hill = this.hills.fbm2(x / 140, z / 140, 4);
    h += hill * lerp(3, 9, land);

    const m = this.mountain.fbm2(x / 450, z / 450, 3);
    const mountainFactor = smoothstep(0.15, 0.55, m) * land;
    if (mountainFactor > 0) {
      const r = 1 - Math.abs(this.ridge.fbm2(x / 180, z / 180, 4));
      h += mountainFactor * (r * r * 55 + 8);
    }

    // Rivers carve valleys through land.
    const rv = Math.abs(this.river.fbm2(x / 900, z / 900, 3));
    let river = 0;
    if (land > 0.5 && rv < 0.05) {
      river = 1 - rv / 0.05;
      const bed = SEA_LEVEL - 3;
      const t = smoothstep(0, 0.6, river) * (1 - mountainFactor * 0.6);
      h = lerp(h, bed, t);
    }

    h = Math.max(6, Math.min(WORLD_HEIGHT - 8, Math.round(h)));

    const temp = this.temperature.fbm2(x / 1000, z / 1000, 3) - Math.max(0, h - 90) * 0.012;
    const hum = this.humidity.fbm2(x / 900 + 50, z / 900 + 50, 3);

    let biome;
    if (h < SEA_LEVEL - 1 && river > 0.3) biome = BIOMES.RIVER;
    else if (h < SEA_LEVEL - 2) biome = BIOMES.OCEAN;
    else if (h <= SEA_LEVEL + 1 && mountainFactor < 0.2 && temp > -0.3) biome = BIOMES.BEACH;
    else if (mountainFactor > 0.45 && h > 85) biome = BIOMES.MOUNTAINS;
    else if (temp > 0.3 && hum < 0.05) biome = BIOMES.DESERT;
    else if (temp < -0.35) biome = BIOMES.SNOWY;
    else if (temp < -0.12) biome = BIOMES.TAIGA;
    else if (hum > 0.3) biome = BIOMES.BIRCH_FOREST;
    else if (hum > 0.08) biome = BIOMES.FOREST;
    else biome = BIOMES.PLAINS;
    return { h, biome, temp };
  }

  // True where caves carve out solid rock.
  isCave(x, y, z, surface, underwater) {
    if (y <= 4) return false;
    if (underwater && y > surface - 6) return false;
    if (y > surface) return false;
    const a = this.cave1.noise3(x / 48, y / 32, z / 48);
    const b = this.cave2.noise3(x / 48, y / 32, z / 48);
    if (a * a + b * b < 0.0065) return true;
    if (y < 48) {
      const cheese = this.cave3.noise3(x / 80, y / 40, z / 80);
      if (cheese > 0.62 - (48 - y) * 0.002) return true;
    }
    return false;
  }

  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const seed = this.seed;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const { h, biome, temp } = this.column(wx, wz);
        heights[lx + lz * 16] = h;
        biomes[lx + lz * 16] = biome;
        const underwater = h < SEA_LEVEL;
        const cold = temp < -0.35;

        let top;
        let filler;
        let fillerDepth = 3 + (hash3(seed, wx, 1, wz) & 1);
        switch (biome) {
          case BIOMES.DESERT: top = B.SAND; filler = B.SAND; fillerDepth = 4; break;
          case BIOMES.BEACH: top = cold ? B.GRAVEL : B.SAND; filler = B.SAND; break;
          case BIOMES.OCEAN: top = h < SEA_LEVEL - 12 ? B.GRAVEL : (hash3(seed, wx, 2, wz) % 7 === 0 ? B.CLAY : B.SAND); filler = B.SAND; break;
          case BIOMES.RIVER: top = hash3(seed, wx, 2, wz) % 5 === 0 ? B.CLAY : B.SAND; filler = B.SAND; break;
          case BIOMES.SNOWY: top = B.SNOWY_GRASS; filler = B.DIRT; break;
          case BIOMES.MOUNTAINS:
            if (h > 100) { top = B.SNOW_BLOCK; filler = B.STONE; } else if (h > 92) { top = B.STONE; filler = B.STONE; } else { top = B.GRASS; filler = B.DIRT; }
            break;
          default: top = B.GRASS; filler = B.DIRT;
        }
        if (underwater && (top === B.GRASS || top === B.SNOWY_GRASS)) top = B.DIRT;

        const bedrockTop = 1 + (hash3(seed, wx, 0, wz) % 4);
        for (let y = 0; y <= h; y++) {
          let id;
          if (y <= bedrockTop && (y === 0 || hashFloat(seed, wx, y, wz) < 0.6)) id = B.BEDROCK;
          else if (y === h) id = top;
          else if (y > h - fillerDepth) id = filler;
          else if (biome === BIOMES.DESERT && y > h - fillerDepth - 3) id = B.SANDSTONE;
          else id = B.STONE;
          if (id !== B.BEDROCK && this.isCave(wx, y, wz, h, underwater || biome === BIOMES.RIVER)) {
            id = y <= 10 ? B.LAVA : B.AIR;
          }
          blocks[blockIndex(lx, y, lz)] = id;
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          blocks[blockIndex(lx, y, lz)] = (y === SEA_LEVEL && cold) ? B.ICE : B.WATER;
        }
      }
    }

    this.placeOres(blocks, cx, cz);
    this.placePlants(blocks, heights, biomes, cx, cz);
    this.placeTrees(blocks, cx, cz);
    return { blocks, meta, heights, biomes };
  }

  placeOres(blocks, cx, cz) {
    const rand = mulberry32(hash3(this.seed, cx, 77, cz));
    const ores = [
      // id, veins per chunk, vein size, min y, max y
      [B.COAL_ORE, 20, 12, 5, 120],
      [B.IRON_ORE, 14, 8, 5, 64],
      [B.GOLD_ORE, 3, 8, 5, 32],
      [B.DIAMOND_ORE, 1.5, 6, 5, 16],
      [B.GRAVEL, 6, 20, 5, 100],
      [B.DIRT, 6, 20, 5, 100],
    ];
    for (const [id, veins, size, minY, maxY] of ores) {
      const count = Math.floor(veins) + (rand() < veins % 1 ? 1 : 0);
      for (let v = 0; v < count; v++) {
        let x = rand() * 16;
        let y = minY + rand() * (maxY - minY);
        let z = rand() * 16;
        const n = 1 + Math.floor(rand() * size);
        for (let i = 0; i < n; i++) {
          const bx = Math.floor(x);
          const by = Math.floor(y);
          const bz = Math.floor(z);
          if (bx >= 0 && bx < 16 && bz >= 0 && bz < 16 && by > 0 && by < WORLD_HEIGHT) {
            const idx = blockIndex(bx, by, bz);
            if (blocks[idx] === B.STONE) blocks[idx] = id;
          }
          x += rand() * 2 - 1;
          y += rand() * 2 - 1;
          z += rand() * 2 - 1;
        }
      }
    }
  }

  placePlants(blocks, heights, biomes, cx, cz) {
    const seed = this.seed ^ 0x5eed;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const h = heights[lx + lz * 16];
        if (h + 1 >= WORLD_HEIGHT || h < SEA_LEVEL) continue;
        const ground = blocks[blockIndex(lx, h, lz)];
        const aboveIdx = blockIndex(lx, h + 1, lz);
        if (blocks[aboveIdx] !== B.AIR) continue;
        const wx = cx * 16 + lx;
        const wz = cz * 16 + lz;
        const r = hashFloat(seed, wx, 3, wz);
        const biome = biomes[lx + lz * 16];
        if (ground === B.GRASS) {
          const grassChance = biome === BIOMES.PLAINS ? 0.16 : biome === BIOMES.MOUNTAINS ? 0.04 : 0.07;
          if (r < grassChance) blocks[aboveIdx] = B.TALL_GRASS;
          else if (r < grassChance + (biome === BIOMES.PLAINS ? 0.02 : 0.006)) {
            blocks[aboveIdx] = hashFloat(seed, wx, 4, wz) < 0.5 ? B.POPPY : B.DANDELION;
          } else if (biome === BIOMES.PLAINS && r > 0.9993) {
            blocks[aboveIdx] = B.PUMPKIN;
          }
        } else if (ground === B.SAND && biome === BIOMES.DESERT) {
          if (r < 0.005) {
            const height = 1 + Math.floor(hashFloat(seed, wx, 5, wz) * 3);
            for (let i = 1; i <= height && h + i < WORLD_HEIGHT; i++) blocks[blockIndex(lx, h + i, lz)] = B.CACTUS;
          } else if (r < 0.012) {
            blocks[aboveIdx] = B.DEAD_BUSH;
          }
        }
      }
    }
  }

  // Trees can straddle chunk borders, so look at every tree origin within reach of this chunk.
  placeTrees(blocks, cx, cz) {
    const seed = this.seed ^ 0x7ee5;
    const x0 = cx * 16;
    const z0 = cz * 16;
    const set = (x, y, z, id, overwrite) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16 || y < 0 || y >= WORLD_HEIGHT) return;
      const idx = blockIndex(lx, y, lz);
      const cur = blocks[idx];
      if (overwrite || cur === B.AIR || cur === B.TALL_GRASS || cur === B.POPPY || cur === B.DANDELION) {
        blocks[idx] = id;
      }
    };
    const R = 3;
    for (let wz = z0 - R; wz < z0 + 16 + R; wz++) {
      for (let wx = x0 - R; wx < x0 + 16 + R; wx++) {
        const r = hashFloat(seed, wx, 0, wz);
        if (r >= MAX_TREE_DENSITY) continue;
        const { h, biome } = this.column(wx, wz);
        if (r >= TREE_DENSITY[biome] || h < SEA_LEVEL || h > WORLD_HEIGHT - 14) continue;
        if (biome === BIOMES.MOUNTAINS && h > 92) continue;
        if (this.isCave(wx, h, wz, h, false)) continue;
        // Keep trees apart: skip if a neighbouring column also rolled a tree with a lower hash.
        let crowded = false;
        for (let dz = -1; dz <= 1 && !crowded; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx || dz) && hashFloat(seed, wx + dx, 0, wz + dz) < r) { crowded = true; break; }
          }
        }
        if (crowded) continue;
        const t = hashFloat(seed, wx, 1, wz);
        let type = 'oak';
        if (biome === BIOMES.TAIGA || biome === BIOMES.SNOWY) type = 'spruce';
        else if (biome === BIOMES.BIRCH_FOREST) type = t < 0.8 ? 'birch' : 'oak';
        else if (biome === BIOMES.FOREST) type = t < 0.2 ? 'birch' : 'oak';
        else if (biome === BIOMES.MOUNTAINS) type = t < 0.5 ? 'spruce' : 'oak';
        const rand = mulberry32(hash3(seed, wx, 2, wz));
        placeTree(set, type, wx, h + 1, wz, rand);
        set(wx, h, wz, B.DIRT, true);
      }
    }
  }

  // Finds a dry land spawn point near the origin.
  findSpawn() {
    for (let r = 0; r < 4000; r += 8) {
      const steps = Math.max(1, Math.floor((r * 2 * Math.PI) / 16));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r);
        const z = Math.round(Math.sin(a) * r);
        const { h, biome } = this.column(x, z);
        if (h > SEA_LEVEL && biome !== BIOMES.OCEAN && biome !== BIOMES.RIVER && biome !== BIOMES.MOUNTAINS
          && !this.isCave(x, h, z, h, false)) {
          return { x: x + 0.5, y: h + 1, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: WORLD_HEIGHT - 20, z: 0.5 };
  }
}

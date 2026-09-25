// Deterministic infinite terrain generator, loosely following Minecraft 1.18+: climate noises
// (continentalness, erosion, peaks & valleys, temperature, humidity) shape the land and pick the
// biome; mountains get 3D overhangs; caves are spaghetti tunnels, cheese caverns, flooded aquifers
// and ravines; features include ore veins, stone blobs, trees per biome, dungeons and wells.
// Any chunk can be generated on its own from the seed.
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, CHUNK_VOLUME, blockIndex } from '../constants.js';
import { B, BLOCKS, IS_SOLID, IS_LOG } from './blocks.js';
import { SimplexNoise, mulberry32, hash3, hashFloat } from './noise.js';
import { buildTree, TREE_RADIUS } from './trees.js';

const H = WORLD_HEIGHT;

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
  SAVANNA: 10,
  JUNGLE: 11,
  SWAMP: 12,
  DARK_FOREST: 13,
  BADLANDS: 14,
  DEEP_OCEAN: 15,
  STONY_PEAKS: 16,
  SNOWY_PEAKS: 17,
  SNOWY_TAIGA: 18,
  STONY_SHORE: 19,
  FROZEN_RIVER: 20,
  MEADOW: 21,
  FROZEN_OCEAN: 22,
  SNOWY_BEACH: 23,
};
export const BIOME_NAMES = [
  '海洋', '沙滩', '平原', '森林', '沙漠', '针叶林', '雪原', '风袭丘陵', '河流', '桦木森林', '热带草原', '丛林', '沼泽',
  '黑森林', '恶地', '深海', '裸岩山峰', '积雪山峰', '积雪针叶林', '石岸', '冻河', '草甸', '冻洋', '积雪沙滩',
];

// Below this temperature precipitation is snow and water freezes.
export const SNOW_TEMP = -0.45;

// Biomes where the ground is water.
export const WATER_BIOMES = new Set([BIOMES.OCEAN, BIOMES.DEEP_OCEAN, BIOMES.FROZEN_OCEAN, BIOMES.RIVER, BIOMES.FROZEN_RIVER]);

// Trees: [type, weight] lists and trees per column for each biome.
const TREES = [];
const TREE_DENSITY = new Float32Array(32);
function trees(biome, density, list) {
  TREE_DENSITY[biome] = density;
  TREES[biome] = list;
}
trees(BIOMES.PLAINS, 0.003, [['oak', 8], ['fancy_oak', 1]]);
trees(BIOMES.FOREST, 0.045, [['oak', 10], ['birch', 3], ['fancy_oak', 1]]);
trees(BIOMES.BIRCH_FOREST, 0.045, [['birch', 8], ['tall_birch', 2]]);
trees(BIOMES.DARK_FOREST, 0.07, [['dark_oak', 10], ['oak', 1], ['birch', 1]]);
trees(BIOMES.TAIGA, 0.035, [['spruce', 3], ['pine', 1]]);
trees(BIOMES.SNOWY_TAIGA, 0.03, [['spruce', 3], ['pine', 1]]);
trees(BIOMES.SNOWY, 0.004, [['spruce', 1]]);
trees(BIOMES.MOUNTAINS, 0.008, [['spruce', 1], ['oak', 1]]);
trees(BIOMES.SAVANNA, 0.006, [['acacia', 5], ['oak', 1]]);
trees(BIOMES.JUNGLE, 0.09, [['jungle', 4], ['jungle_bush', 5], ['mega_jungle', 1], ['fancy_oak', 1]]);
trees(BIOMES.SWAMP, 0.012, [['swamp_oak', 1]]);
trees(BIOMES.MEADOW, 0.0006, [['birch', 1], ['oak', 1]]);
let MAX_TREE_DENSITY = 0;
for (const d of TREE_DENSITY) MAX_TREE_DENSITY = Math.max(MAX_TREE_DENSITY, d);

// Flower kinds per biome.
const FLOWERS = {
  [BIOMES.PLAINS]: [B.DANDELION, B.POPPY, B.AZURE_BLUET, B.OXEYE_DAISY, B.CORNFLOWER, B.RED_TULIP, B.ORANGE_TULIP, B.WHITE_TULIP, B.PINK_TULIP],
  [BIOMES.MEADOW]: [B.DANDELION, B.POPPY, B.AZURE_BLUET, B.OXEYE_DAISY, B.CORNFLOWER, B.ALLIUM],
  [BIOMES.FOREST]: [B.DANDELION, B.POPPY, B.LILY_OF_THE_VALLEY, B.ALLIUM],
  [BIOMES.BIRCH_FOREST]: [B.DANDELION, B.POPPY, B.LILY_OF_THE_VALLEY],
  [BIOMES.DARK_FOREST]: [B.POPPY, B.LILY_OF_THE_VALLEY],
  [BIOMES.SWAMP]: [B.BLUE_ORCHID],
  [BIOMES.JUNGLE]: [B.POPPY, B.DANDELION],
  [BIOMES.SAVANNA]: [B.DANDELION, B.POPPY],
  default: [B.DANDELION, B.POPPY],
};

// Badlands terracotta bands, bottom to top.
const BANDS = [B.TERRACOTTA, B.ORANGE_TERRACOTTA, B.TERRACOTTA, B.YELLOW_TERRACOTTA, B.TERRACOTTA, B.BROWN_TERRACOTTA,
  B.TERRACOTTA, B.RED_TERRACOTTA, B.ORANGE_TERRACOTTA, B.WHITE_TERRACOTTA, B.TERRACOTTA, B.LIGHT_GRAY_TERRACOTTA,
  B.ORANGE_TERRACOTTA, B.TERRACOTTA, B.RED_TERRACOTTA, B.TERRACOTTA];

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Continentalness -> base height spline.
const SPLINE = [
  [-1.0, 24], [-0.55, 30], [-0.35, 40], [-0.2, 52], [-0.12, 59], [-0.06, 62], [0.02, 64], [0.15, 67], [0.35, 72], [0.6, 78], [1.0, 86],
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

function pickWeighted(list, r) {
  let total = 0;
  for (const [, w] of list) total += w;
  let t = r * total;
  for (const [v, w] of list) {
    t -= w;
    if (t <= 0) return v;
  }
  return list[list.length - 1][0];
}

// Coarse 3D noise grid for a chunk (every 4 blocks horizontally, 4 vertically) with trilinear
// interpolation, like Minecraft's noise caves. fn(x, y, z) is evaluated at the grid points.
const GX = 5;
const GY = H / 4 + 1;
class Grid3 {
  constructor() {
    this.v = new Float32Array(GX * GX * GY);
  }

  fill(x0, z0, fn) {
    let i = 0;
    for (let gy = 0; gy < GY; gy++) {
      for (let gz = 0; gz < GX; gz++) {
        for (let gx = 0; gx < GX; gx++) this.v[i++] = fn(x0 + gx * 4, gy * 4, z0 + gz * 4);
      }
    }
  }

  at(lx, y, lz) {
    const fx = lx / 4;
    const fy = y / 4;
    const fz = lz / 4;
    const ix = Math.min(GX - 2, fx | 0);
    const iy = Math.min(GY - 2, fy | 0);
    const iz = Math.min(GX - 2, fz | 0);
    const tx = fx - ix;
    const ty = fy - iy;
    const tz = fz - iz;
    const v = this.v;
    const i000 = ix + iz * GX + iy * GX * GX;
    const i100 = i000 + 1;
    const i010 = i000 + GX * GX;
    const i110 = i010 + 1;
    const i001 = i000 + GX;
    const i101 = i001 + 1;
    const i011 = i010 + GX;
    const i111 = i011 + 1;
    return trilerp(v[i000], v[i100], v[i001], v[i101], v[i010], v[i110], v[i011], v[i111], tx, ty, tz);
  }
}

function trilerp(v000, v100, v001, v101, v010, v110, v011, v111, tx, ty, tz) {
  const a = v000 + (v100 - v000) * tx;
  const b = v001 + (v101 - v001) * tx;
  const c = v010 + (v110 - v010) * tx;
  const d = v011 + (v111 - v011) * tx;
  const e = a + (b - a) * tz;
  const f = c + (d - c) * tz;
  return e + (f - e) * ty;
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Block-meta facings: north, east, south, west.
const FACING = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const LAVA_LEVEL = 10;
// Cave fluid of a column, as a code: LAVA_LEVEL for lava, WATER_CODE + level for aquifer water.
const WATER_CODE = 1000;
const fluidTop = (code) => code % WATER_CODE;
const GRAVITY_FIX = { [B.SAND]: B.SANDSTONE, [B.RED_SAND]: B.TERRACOTTA, [B.GRAVEL]: B.STONE };
const GRASSY = new Set([B.GRASS, B.SNOWY_GRASS, B.PODZOL, B.COARSE_DIRT]);
const SOIL_TOPS = new Set([B.GRASS, B.SNOWY_GRASS, B.PODZOL, B.COARSE_DIRT, B.DIRT]);

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    const rand = mulberry32(this.seed);
    this.continental = new SimplexNoise(rand);
    this.erosion = new SimplexNoise(rand);
    this.weird = new SimplexNoise(rand);
    this.hills = new SimplexNoise(rand);
    this.ridge = new SimplexNoise(rand);
    this.temperature = new SimplexNoise(rand);
    this.humidity = new SimplexNoise(rand);
    this.river = new SimplexNoise(rand);
    this.cave1 = new SimplexNoise(rand);
    this.cave2 = new SimplexNoise(rand);
    this.cave3 = new SimplexNoise(rand);
    this.caveThick = new SimplexNoise(rand);
    this.overhang = new SimplexNoise(rand);
    this.aquifer = new SimplexNoise(rand);
    this.ravine = new SimplexNoise(rand);
    this.surface = new SimplexNoise(rand);
    this.pillars = new SimplexNoise(rand);
    this.grids = [new Grid3(), new Grid3(), new Grid3(), new Grid3()];
    this.columns = new Map();
    this.trees = new Map();
    this.treeParts = new Map();
    // Cave noises, sampled on the coarse grid.
    this.caveFns = [
      (x, y, z) => this.cave1.noise3(x / 55, y / 32, z / 55),
      (x, y, z) => this.cave2.noise3(x / 55, y / 32, z / 55),
      (x, y, z) => this.cave3.noise3(x / 75, y / 36, z / 75) - 0.35 * this.pillars.noise3(x / 14, y / 30, z / 14),
    ];
  }

  // Climate, height and biome of a world column (cached: neighbouring chunks ask for the same
  // columns). Callers must not modify the result.
  column(x, z) {
    const key = x + ',' + z;
    let c = this.columns.get(key);
    if (c === undefined) {
      if (this.columns.size > 60000) this.columns.clear();
      c = this.computeColumn(x, z);
      this.columns.set(key, c);
    }
    return c;
  }

  // Climate, height and biome of a world column. Pure function of (x, z).
  computeColumn(x, z) {
    const c = this.continental.fbm2(x / 900, z / 900, 5) * 1.35 + 0.08;
    const e = this.erosion.fbm2(x / 650 + 30, z / 650 - 20, 4) * 1.6;
    const w = this.weird.fbm2(x / 400 - 70, z / 400 + 40, 4) * 1.6;
    const pv = 1 - Math.abs(3 * Math.abs(w) - 2); // peaks (1) and valleys (-1)
    const land = smoothstep(-0.14, 0.02, c);
    let h = spline(c);

    // Rolling hills, more of them where erosion is low.
    const rugged = smoothstep(0.6, -0.6, e);
    h += this.hills.fbm2(x / 110, z / 110, 4) * lerp(2, 10, rugged) * land;
    h += pv * lerp(1.5, 7, rugged) * land;

    // Mountains: far inland, low erosion; jagged ridges raised further on peaks.
    const m = smoothstep(-0.05, -0.55, e) * smoothstep(0.05, 0.4, c);
    if (m > 0) {
      const r = 1 - Math.abs(this.ridge.fbm2(x / 170, z / 170, 5));
      h += m * (r * r * 48 + 8) * (0.65 + 0.35 * Math.max(0, pv));
    }

    // Rivers run through wide, gentle valleys and carve a channel in the middle.
    const rv = Math.abs(this.river.fbm2(x / 850, z / 850, 3));
    let river = 0;
    if (land > 0.4 && rv < 0.14 && h > SEA_LEVEL + 2) {
      const valley = smoothstep(0.14, 0.045, rv) * 0.7 * (1 - m * 0.7) * smoothstep(0.4, 0.6, land);
      h -= (h - (SEA_LEVEL + 2)) * valley;
    }
    if (land > 0.4 && rv < 0.045) {
      river = 1 - rv / 0.045;
      const t = smoothstep(0, 0.6, river) * (1 - m * 0.7);
      h = lerp(h, SEA_LEVEL - 4, t);
    }

    let temp = this.temperature.fbm2(x / 1400, z / 1400, 2) * 1.45;
    const hum = this.humidity.fbm2(x / 950 + 50, z / 950 + 50, 3) * 1.5;

    // Pick the biome from the climate (a simplified Minecraft biome table).
    let biome;
    const hRaw = h;
    const chill = Math.max(0, hRaw - 88) * 0.02;
    if (hRaw < SEA_LEVEL - 1 && river > 0.3) {
      biome = temp < SNOW_TEMP ? BIOMES.FROZEN_RIVER : BIOMES.RIVER;
    } else if (hRaw < SEA_LEVEL - 1) {
      if (temp < SNOW_TEMP - 0.1) biome = BIOMES.FROZEN_OCEAN;
      else biome = c < -0.4 ? BIOMES.DEEP_OCEAN : BIOMES.OCEAN;
    } else if (hRaw <= SEA_LEVEL + 2 && c < 0.03 && m < 0.2) {
      if (e < -0.35) biome = BIOMES.STONY_SHORE;
      else if (temp < SNOW_TEMP) biome = BIOMES.SNOWY_BEACH;
      else biome = BIOMES.BEACH;
    } else if (m > 0.45 && hRaw > 92) {
      biome = temp - chill < -0.25 ? BIOMES.SNOWY_PEAKS : BIOMES.STONY_PEAKS;
    } else if (m > 0.2 && hRaw > 84) {
      biome = hum > -0.05 && temp > -0.3 && temp < 0.35 && pv < 0.6 ? BIOMES.MEADOW : BIOMES.MOUNTAINS;
    } else if (temp < SNOW_TEMP) {
      biome = hum > 0 ? BIOMES.SNOWY_TAIGA : BIOMES.SNOWY;
    } else if (temp < -0.15) {
      biome = hum > -0.15 ? BIOMES.TAIGA : BIOMES.PLAINS;
    } else if (temp < 0.25) {
      if (hum > 0.15 && e > -0.1 && hRaw <= SEA_LEVEL + 8) biome = BIOMES.SWAMP;
      else if (hum < -0.25) biome = BIOMES.PLAINS;
      else if (hum < 0.05) biome = BIOMES.FOREST;
      else if (hum < 0.3) biome = BIOMES.BIRCH_FOREST;
      else biome = BIOMES.DARK_FOREST;
    } else if (temp < 0.42) {
      if (hum < -0.1) biome = BIOMES.SAVANNA;
      else if (hum < 0.25) biome = hum < 0.05 ? BIOMES.PLAINS : BIOMES.FOREST;
      else biome = BIOMES.JUNGLE;
    } else if (hum < -0.05) {
      biome = w > 0.05 && e > -0.3 ? BIOMES.BADLANDS : BIOMES.DESERT;
    } else if (hum < 0.25) {
      biome = BIOMES.SAVANNA;
    } else {
      biome = BIOMES.JUNGLE;
    }

    // Swamps sit right at the water line. The pull fades out towards the swamp's edges so there
    // is no step at its border.
    const swamp = smoothstep(0.15, 0.25, hum) * smoothstep(-0.1, 0, e) * smoothstep(-0.15, -0.05, temp) * (1 - smoothstep(0.15, 0.25, temp))
      * (1 - smoothstep(SEA_LEVEL + 4, SEA_LEVEL + 8, hRaw)) * (1 - river) * (1 - m);
    if (swamp > 0) {
      h = lerp(h, SEA_LEVEL + this.surface.noise2(x / 12, z / 12) * 1.6, 0.85 * swamp);
      if (WATER_BIOMES.has(biome)) h = Math.min(h, SEA_LEVEL - 2);
    }
    // Badlands rise in flat-topped terraces, fading out towards neighbouring biomes.
    if (temp > 0.37 && hum < 0 && w > 0 && biome !== BIOMES.RIVER) {
      const bad = smoothstep(0.37, 0.5, temp) * smoothstep(0, -0.12, hum) * smoothstep(0, 0.12, w) * smoothstep(-0.35, -0.2, e);
      const plateau = smoothstep(0.15, 0.5, w) * smoothstep(0.05, 0.3, c) * bad;
      if (plateau > 0.02) {
        const top = h + plateau * 24;
        const terraced = Math.floor(top / 5) * 5 + Math.min(4, (top % 5) * 0.4);
        h = lerp(top, terraced, Math.min(1, plateau * 5));
      }
    }

    h = Math.max(6, Math.min(H - 8, Math.round(h)));
    temp -= Math.max(0, h - 88) * 0.02;
    return { h, biome, temp, hum, m, c, e, river };
  }

  // ------------------------------------------------------------ chunk generation
  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const seed = this.seed;
    const heights = new Int16Array(256);
    const biomes = new Uint8Array(256);
    const temps = new Float32Array(256);
    const tiles = [];

    // Column data with a 1-block border (for slopes).
    const cols = [];
    for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) cols.push(this.column(x0 + x, z0 + z));
    const col = (lx, lz) => cols[(lx + 1) + (lz + 1) * 18];

    // 3D noise grids: two tunnel noises, caverns and mountain overhangs.
    const [g1, g2, g3, g4] = this.grids;
    g1.fill(x0, z0, this.caveFns[0]);
    g2.fill(x0, z0, this.caveFns[1]);
    g3.fill(x0, z0, this.caveFns[2]);
    const fluids = new Int16Array(18 * 18);
    for (let z = -1; z <= 16; z++) for (let x = -1; x <= 16; x++) fluids[(x + 1) + (z + 1) * 18] = this.caveFluid(x0 + x, z0 + z);
    const fluid = (lx, lz) => fluids[(lx + 1) + (lz + 1) * 18];
    g4.fill(x0, z0, (x, y, z) => this.overhang.fbm3(x / 26, y / 18, z / 26, 2));

    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const wx = x0 + lx;
        const wz = z0 + lz;
        const info = col(lx, lz);
        const { h, biome, temp, m } = info;
        heights[lx + lz * 16] = h;
        biomes[lx + lz * 16] = biome;
        temps[lx + lz * 16] = temp;
        const slope = Math.max(
          Math.abs(col(lx + 1, lz).h - h), Math.abs(col(lx - 1, lz).h - h),
          Math.abs(col(lx, lz + 1).h - h), Math.abs(col(lx, lz - 1).h - h),
        );
        const cold = temp < SNOW_TEMP;

        // Solid terrain: the height map, bent into cliffs and overhangs in the mountains.
        // Jagged rock in the mountains: 3D noise lets rock rise above the height map, but only
        // on top of rock, so nothing is left hanging.
        const amp = m > 0.25 ? (m - 0.25) * 16 : 0;
        let top = h;
        while (amp > 0 && top < H - 2 && (h - top - 1) + g4.at(lx, top + 1, lz) * amp * 1.4 > 0) top++;
        const yTop = top;
        const solidAt = (y) => y <= top;

        // Surface materials.
        const surf = this.surfaceFor(info, slope, wx, wz);
        const bedrockTop = 1 + (hash3(seed, wx, 0, wz) % 4);
        let depth = -1;
        for (let y = yTop; y >= 0; y--) {
          const idx = blockIndex(lx, y, lz);
          if (!solidAt(y)) {
            depth = -1;
            continue;
          }
          depth++;
          let id;
          if (y <= bedrockTop && (y === 0 || hashFloat(seed, wx, y, wz) < 0.6)) id = B.BEDROCK;
          else if (biome === BIOMES.BADLANDS && depth < 18 && y > 50) {
            id = depth === 0 && y < 90 ? B.RED_SAND : depth < 2 && y < 90 ? B.RED_SAND : BANDS[(y + Math.floor(this.surface.noise2(wx / 60, wz / 60) * 3) + 32) % BANDS.length];
          } else if (depth === 0) {
            // Under the sea there is no grass.
            const wet = h < SEA_LEVEL && y < SEA_LEVEL;
            id = wet ? surf.wet || (GRASSY.has(surf.top) ? surf.under : surf.top) : surf.top;
          }
          else if (depth < surf.depth) id = surf.filler;
          else if (surf.stoneLayer && depth < surf.depth + 4) id = surf.stoneLayer;
          else id = B.STONE;
          blocks[idx] = id;
        }
        // Water up to sea level; frozen at the top in cold places.
        for (let y = SEA_LEVEL; y > 0 && h < SEA_LEVEL; y--) {
          const idx = blockIndex(lx, y, lz);
          if (blocks[idx] !== B.AIR) break;
          blocks[idx] = y === SEA_LEVEL && cold ? B.ICE : B.WATER;
        }

        // Caves (after the surface, so cave floors stay stone).
        const ctx = this.caveContext(info, wx, wz, fluid(lx, lz), SIDES.map(([dx, dz]) => [col(lx + dx, lz + dz).h, fluid(lx + dx, lz + dz)]));
        for (let y = 5; y <= ctx.top; y++) {
          const idx = blockIndex(lx, y, lz);
          const id = blocks[idx];
          if (id === B.AIR || id === B.WATER || id === B.BEDROCK || id === B.ICE) continue;
          const fill = this.caveFill(ctx, y, g1.at(lx, y, lz), g2.at(lx, y, lz), y < 56 ? g3.at(lx, y, lz) : 0);
          if (fill >= 0) blocks[idx] = fill;
        }
      }
    }

    const rand = mulberry32(hash3(seed, cx, 77, cz));
    this.placeOres(blocks, cx, cz, rand, biomes);
    this.placeDungeon(blocks, meta, cx, cz, heights, tiles);
    this.placeFeatures(blocks, meta, heights, biomes, cx, cz);
    this.dropFloating(blocks, heights, fluid, col);
    this.settleGravity(blocks);
    this.placePlants(blocks, meta, heights, biomes, cx, cz);
    this.placeTrees(blocks, meta, cx, cz);
    this.tidyTrees(blocks, meta);
    this.placeSnow(blocks, cx, cz, heights, temps);
    return { blocks, meta, heights, biomes, tiles };
  }

  // Top block, filler and depth for a column.
  surfaceFor(info, slope, wx, wz) {
    const { biome, h } = info;
    const n = this.surface.noise2(wx / 9, wz / 9);
    const r = hashFloat(this.seed, wx, 5, wz);
    const s = { top: B.GRASS, under: B.DIRT, filler: B.DIRT, depth: 3 + (r < 0.5 ? 1 : 0), wet: null, stoneLayer: null };
    switch (biome) {
      case BIOMES.DESERT:
        s.top = B.SAND; s.filler = B.SAND; s.depth = 4; s.stoneLayer = B.SANDSTONE; break;
      case BIOMES.BEACH:
        s.top = B.SAND; s.filler = B.SAND; s.stoneLayer = B.SANDSTONE; break;
      case BIOMES.SNOWY_BEACH:
        s.top = B.SAND; s.filler = B.SAND; break;
      case BIOMES.STONY_SHORE:
        s.top = n > 0.2 ? B.GRAVEL : B.STONE; s.filler = B.STONE; break;
      case BIOMES.OCEAN:
      case BIOMES.FROZEN_OCEAN:
        s.top = h < SEA_LEVEL - 14 ? B.GRAVEL : n > 0.45 ? B.CLAY : n < -0.4 ? B.GRAVEL : B.SAND; s.filler = B.SAND; break;
      case BIOMES.DEEP_OCEAN:
        s.top = n > 0.3 ? B.SAND : B.GRAVEL; s.filler = B.GRAVEL; break;
      case BIOMES.RIVER:
      case BIOMES.FROZEN_RIVER:
        s.top = n > 0.35 ? B.CLAY : n < -0.35 ? B.GRAVEL : B.SAND; s.filler = B.SAND; break;
      case BIOMES.SNOWY:
      case BIOMES.SNOWY_TAIGA:
        s.top = B.SNOWY_GRASS; break;
      case BIOMES.TAIGA:
        if (n > 0.35) s.top = B.PODZOL;
        else if (n < -0.55) s.top = B.COARSE_DIRT;
        break;
      case BIOMES.SAVANNA:
        if (n > 0.5) s.top = B.COARSE_DIRT;
        break;
      case BIOMES.SWAMP:
        s.wet = B.CLAY;
        break;
      case BIOMES.DARK_FOREST:
        if (n > 0.6) s.top = B.PODZOL;
        break;
      case BIOMES.STONY_PEAKS:
        s.top = n > 0.4 ? B.GRAVEL : n < -0.3 ? B.ANDESITE : B.STONE; s.filler = B.STONE; break;
      case BIOMES.SNOWY_PEAKS:
        s.top = slope > 2 ? B.STONE : B.SNOW_BLOCK; s.filler = slope > 2 ? B.STONE : B.SNOW_BLOCK; s.depth = 2; break;
      case BIOMES.MOUNTAINS:
        if (h > 102) { s.top = B.SNOW_BLOCK; s.filler = B.STONE; } else if (n > 0.55) { s.top = B.GRAVEL; s.filler = B.GRAVEL; }
        break;
      default:
    }
    // Steep slopes show bare stone (or gravel), like Minecraft's mountains.
    if (slope >= 4 && s.top !== B.SAND && s.top !== B.SNOW_BLOCK && biome !== BIOMES.BADLANDS) {
      s.top = n > 0.3 ? B.GRAVEL : B.STONE;
      s.filler = B.STONE;
    }
    return s;
  }

  // Cave fluid of a column: lava up to y 10, or in aquifer regions water up to a level that is the
  // same over large areas, so that neighbouring pools line up.
  caveFluid(wx, wz) {
    if (this.aquifer.noise2(wx / 160, wz / 160) <= 0.15) return LAVA_LEVEL;
    const step = Math.min(3, Math.floor((this.aquifer.noise2(wx / 120 + 7, wz / 120) + 1) * 2));
    return WATER_CODE + 16 + step * 8;
  }

  // Per-column cave settings. `sides` holds [height, fluid] of the four neighbouring columns.
  caveContext(info, wx, wz, fluid, sides) {
    const { h, biome } = info;
    const underwater = h < SEA_LEVEL || WATER_BIOMES.has(biome) || biome === BIOMES.SWAMP;
    // Never open a cave beside the sea or a river: the water would pour in.
    let shoreLo = Infinity;
    for (const [nh] of sides) if (nh < SEA_LEVEL) shoreLo = Math.min(shoreLo, nh - 6);
    const ravineRegion = this.ravine.noise2(wx / 700 + 91, wz / 700 - 13) > 0.45;
    return {
      h,
      top: underwater ? h - 7 : h,
      underwater,
      shoreLo,
      fluid,
      level: fluidTop(fluid),
      sides,
      rv: Math.abs(this.ravine.noise2(wx / 180, wz / 180)),
      ravineW: ravineRegion ? 0.028 : 0,
      ravineBottom: 18 + Math.floor(this.ravine.noise2(wx / 40, wz / 40) * 6),
      thick: 0.004 + 0.008 * (this.caveThick.noise2(wx / 200, wz / 200) + 1) * 0.5,
    };
  }

  // What a cave leaves at height y of a column (-1: rock stays): tunnels, caverns with pillars and
  // ravines; below the column's fluid level it fills with lava or aquifer water. Where two
  // different fluids (or a fluid and the open surface) would meet, the rock stays as a wall.
  caveFill(ctx, y, a, b, cheese) {
    let carve = a * a + b * b < ctx.thick;
    if (!carve && y < 56 && cheese > 0.58 - (56 - y) * 0.004) carve = true;
    if (!carve && ctx.ravineW > 0 && y >= ctx.ravineBottom && !ctx.underwater) {
      const mid = (ctx.ravineBottom + ctx.h) / 2;
      const width = ctx.ravineW * (1 - Math.abs(y - mid) / Math.max(1, ctx.h - ctx.ravineBottom) * 0.9);
      if (ctx.rv < width) carve = true;
    }
    if (!carve) return -1;
    if (y >= ctx.shoreLo && y <= SEA_LEVEL) return -1;
    for (const [nh, nf] of ctx.sides) {
      if (nf !== ctx.fluid && y <= Math.max(ctx.level, fluidTop(nf))) return -1;
      if (y <= ctx.level && nh < y) return -1;
    }
    if (y > ctx.level) return B.AIR;
    return ctx.fluid === LAVA_LEVEL ? B.LAVA : B.WATER;
  }

  // Is the block at (x, y, z) hollowed out by a cave? Same result as chunk generation, for use
  // outside a chunk (tree and spawn placement).
  caveAt(x, y, z) {
    const info = this.column(x, z);
    const sides = SIDES.map(([dx, dz]) => [this.column(x + dx, z + dz).h, this.caveFluid(x + dx, z + dz)]);
    const ctx = this.caveContext(info, x, z, this.caveFluid(x, z), sides);
    if (y < 5 || y > ctx.top) return false;
    const X = Math.floor(x / 4) * 4;
    const Z = Math.floor(z / 4) * 4;
    const Y = Math.min(GY - 2, y >> 2) * 4;
    const tx = (x - X) / 4;
    const ty = y / 4 - Y / 4;
    const tz = (z - Z) / 4;
    const at = (fn) => trilerp(fn(X, Y, Z), fn(X + 4, Y, Z), fn(X, Y, Z + 4), fn(X + 4, Y, Z + 4),
      fn(X, Y + 4, Z), fn(X + 4, Y + 4, Z), fn(X, Y + 4, Z + 4), fn(X + 4, Y + 4, Z + 4), tx, ty, tz);
    const [f1, f2, f3] = this.caveFns;
    return this.caveFill(ctx, y, at(f1), at(f2), y < 56 ? at(f3) : 0) >= 0;
  }

  // ------------------------------------------------------------ ores and stone
  // Minecraft-style vein: ellipsoids along a short line.
  vein(blocks, rand, id, size, x, y, z, replace) {
    const a = rand() * Math.PI;
    const len = size / 8;
    const x1 = x + Math.sin(a) * len;
    const x2 = x - Math.sin(a) * len;
    const z1 = z + Math.cos(a) * len;
    const z2 = z - Math.cos(a) * len;
    const y1 = y + rand() * 3 - 1;
    const y2 = y + rand() * 3 - 1;
    for (let i = 0; i < size; i++) {
      const t = i / size;
      const cxv = x1 + (x2 - x1) * t;
      const cyv = y1 + (y2 - y1) * t;
      const czv = z1 + (z2 - z1) * t;
      const r = ((Math.sin(Math.PI * t) + 1) * (rand() * size / 16) + 1) / 2;
      const r2 = r * r;
      for (let bx = Math.floor(cxv - r); bx <= Math.floor(cxv + r); bx++) {
        if (bx < 0 || bx > 15) continue;
        for (let bz = Math.floor(czv - r); bz <= Math.floor(czv + r); bz++) {
          if (bz < 0 || bz > 15) continue;
          for (let by = Math.floor(cyv - r); by <= Math.floor(cyv + r); by++) {
            if (by < 1 || by >= H) continue;
            const dx = bx + 0.5 - cxv;
            const dy = by + 0.5 - cyv;
            const dz = bz + 0.5 - czv;
            if (dx * dx + dy * dy + dz * dz > r2) continue;
            const idx = blockIndex(bx, by, bz);
            if (replace(blocks[idx])) blocks[idx] = id;
          }
        }
      }
    }
  }

  placeOres(blocks, cx, cz, rand, biomes) {
    const stone = (id) => id === B.STONE || id === B.GRANITE || id === B.DIORITE || id === B.ANDESITE;
    const onlyStone = (id) => id === B.STONE;
    const mountains = biomes.some((b) => b === BIOMES.MOUNTAINS || b === BIOMES.STONY_PEAKS || b === BIOMES.SNOWY_PEAKS || b === BIOMES.MEADOW);
    const badlands = biomes.some((b) => b === BIOMES.BADLANDS);
    // [id, veins per chunk, size, min y, max y, triangular?]
    const list = [
      [B.GRANITE, 2, 33, 5, 90], [B.DIORITE, 2, 33, 5, 90], [B.ANDESITE, 2, 33, 5, 90],
      [B.GRAVEL, 4, 30, 5, 100], [B.DIRT, 5, 30, 5, 100],
      [B.COAL_ORE, 18, 17, 5, 125], [B.IRON_ORE, 12, 9, 5, 72, true], [B.GOLD_ORE, 3, 9, 5, 34, true],
      [B.REDSTONE_ORE, 4, 8, 5, 18], [B.LAPIS_ORE, 1.5, 7, 5, 32, true], [B.DIAMOND_ORE, 1.5, 7, 5, 16],
    ];
    if (mountains) list.push([B.IRON_ORE, 8, 9, 80, 125], [B.COAL_ORE, 6, 17, 90, 125]);
    if (badlands) list.push([B.GOLD_ORE, 6, 9, 32, 80]);
    for (const [id, veins, size, minY, maxY, tri] of list) {
      const count = Math.floor(veins) + (rand() < veins % 1 ? 1 : 0);
      for (let v = 0; v < count; v++) {
        const t = tri ? (rand() + rand()) / 2 : rand();
        const y = minY + t * (maxY - minY);
        this.vein(blocks, rand, id, size, rand() * 16, y, rand() * 16, size > 20 ? onlyStone : stone);
      }
    }
    // Emeralds: single blocks in mountain stone.
    if (mountains) {
      const n = 3 + Math.floor(rand() * 6);
      for (let i = 0; i < n; i++) {
        const idx = blockIndex(Math.floor(rand() * 16), 20 + Math.floor(rand() * 90), Math.floor(rand() * 16));
        if (blocks[idx] === B.STONE) blocks[idx] = B.EMERALD_ORE;
      }
    }
  }

  // ------------------------------------------------------------ structures
  // A cobblestone room with a monster spawner and loot chests, deep underground.
  placeDungeon(blocks, meta, cx, cz, heights, tiles) {
    const rand = mulberry32(hash3(this.seed, cx, 31, cz));
    if (rand() > 0.12) return;
    const rx = 1 + Math.floor(rand() * 2); // interior half size 2..3
    const rz = 1 + Math.floor(rand() * 2) + 1;
    const ox = 4 + Math.floor(rand() * 6);
    const oz = 4 + Math.floor(rand() * 6);
    const hx = rx + 1;
    const hz = Math.min(rz, 3);
    const y0 = 12 + Math.floor(rand() * 34);
    if (y0 + 6 > heights[ox + oz * 16] - 8) return;
    // Needs mostly solid rock around it.
    let solid = 0;
    let total = 0;
    for (let x = ox - hx - 1; x <= ox + hx + 1; x++) {
      for (let z = oz - hz - 1; z <= oz + hz + 1; z++) {
        for (const y of [y0 - 1, y0 + 5]) {
          total++;
          if (IS_SOLID[blocks[blockIndex(x, y, z)]] && blocks[blockIndex(x, y, z)] !== B.WATER) solid++;
        }
      }
    }
    if (solid < total * 0.9) return;
    const cobble = () => (rand() < 0.35 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE);
    for (let x = ox - hx - 1; x <= ox + hx + 1; x++) {
      for (let z = oz - hz - 1; z <= oz + hz + 1; z++) {
        for (let y = y0 - 1; y <= y0 + 4; y++) {
          const edge = x === ox - hx - 1 || x === ox + hx + 1 || z === oz - hz - 1 || z === oz + hz + 1;
          const idx = blockIndex(x, y, z);
          if (y === y0 - 1) blocks[idx] = cobble();
          else if (y === y0 + 4) blocks[idx] = B.COBBLESTONE;
          else if (edge) { if (blocks[idx] !== B.AIR) blocks[idx] = B.COBBLESTONE; } else blocks[idx] = B.AIR;
        }
      }
    }
    const wx = cx * 16;
    const wz = cz * 16;
    blocks[blockIndex(ox, y0, oz)] = B.SPAWNER;
    const mobs = ['zombie', 'zombie', 'skeleton', 'spider'];
    tiles.push({ x: wx + ox, y: y0, z: wz + oz, type: 'spawner', mob: mobs[Math.floor(rand() * mobs.length)], delay: 200 });
    // One or two chests against the walls.
    const chests = 1 + (rand() < 0.5 ? 1 : 0);
    const spots = [[ox - hx, oz, 1], [ox + hx, oz, 3], [ox, oz - hz, 2], [ox, oz + hz, 0]];
    for (let i = 0; i < chests; i++) {
      const [x, z, facing] = spots.splice(Math.floor(rand() * spots.length), 1)[0];
      blocks[blockIndex(x, y0, z)] = B.CHEST;
      meta[blockIndex(x, y0, z)] = facing;
      tiles.push({ x: wx + x, y: y0, z: wz + z, type: 'chest', items: this.dungeonLoot(rand) });
    }
  }

  dungeonLoot(rand) {
    const items = new Array(27).fill(null);
    // [id, min, max, weight] (a smaller version of Minecraft's dungeon table).
    const table = [
      [284, 1, 8, 10], [273, 1, 8, 10], [274, 1, 8, 10], [286, 1, 8, 10], [282, 1, 4, 10], [283, 1, 1, 10],
      [259, 1, 4, 10], [260, 1, 4, 5], [262, 1, 1, 10], [257, 3, 8, 10], [331, 1, 4, 5], [266, 1, 1, 2],
      [280, 2, 4, 10], [361, 1, 1, 2], [354, 1, 1, 2], [288, 2, 8, 6],
    ];
    const n = 4 + Math.floor(rand() * 5);
    for (let i = 0; i < n; i++) {
      const [id, min, max] = pickWeighted(table.map((t) => [t, t[3]]), rand);
      const slot = Math.floor(rand() * 27);
      if (!items[slot]) items[slot] = { id, count: min + Math.floor(rand() * (max - min + 1)), damage: 0 };
    }
    return items;
  }

  // Small surface structures that fit inside the chunk: desert wells and mossy boulders.
  placeFeatures(blocks, meta, heights, biomes, cx, cz) {
    const rand = mulberry32(hash3(this.seed, cx, 53, cz));
    const ox = 3 + Math.floor(rand() * 10);
    const oz = 3 + Math.floor(rand() * 10);
    const biome = biomes[ox + oz * 16];
    const h = heights[ox + oz * 16];
    if (h <= SEA_LEVEL || h + 6 >= H) return;
    // Only on flat, solid ground.
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const i = ox + dx + (oz + dz) * 16;
        if (heights[i] !== h || biomes[i] !== biome) return;
        for (let y = h - 3; y <= h; y++) if (!IS_SOLID[blocks[blockIndex(ox + dx, y, oz + dz)]]) return;
        if (blocks[blockIndex(ox + dx, h + 1, oz + dz)] !== B.AIR) return;
      }
    }
    if (biome === BIOMES.DESERT && rand() < 0.02) {
      // Desert well.
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let y = h - 1; y <= h; y++) blocks[blockIndex(ox + dx, y, oz + dz)] = B.SANDSTONE;
          for (let y = h + 1; y < h + 6; y++) blocks[blockIndex(ox + dx, y, oz + dz)] = B.AIR;
        }
      }
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          blocks[blockIndex(ox + dx, h + 1, oz + dz)] = Math.abs(dx) + Math.abs(dz) === 1 ? B.AIR : B.SANDSTONE;
          if (Math.abs(dx) === 1 && Math.abs(dz) === 1) {
            blocks[blockIndex(ox + dx, h + 2, oz + dz)] = B.SANDSTONE;
            blocks[blockIndex(ox + dx, h + 3, oz + dz)] = B.SANDSTONE;
          }
          blocks[blockIndex(ox + dx, h + 4, oz + dz)] = B.SANDSTONE_SLAB;
        }
      }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (Math.abs(dx) + Math.abs(dz) === 1) blocks[blockIndex(ox + dx, h + 1, oz + dz)] = B.SANDSTONE_SLAB;
      blocks[blockIndex(ox, h + 4, oz)] = B.SANDSTONE;
      blocks[blockIndex(ox, h, oz)] = B.WATER;
      blocks[blockIndex(ox, h - 1, oz)] = B.WATER;
      blocks[blockIndex(ox, h + 1, oz)] = B.WATER;
      return;
    }
    if ((biome === BIOMES.TAIGA || biome === BIOMES.SNOWY_TAIGA) && rand() < 0.25) {
      // Mossy boulder.
      const r = 1.2 + rand() * 0.9;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dy = -1; dy <= 2; dy++) {
            if (Math.hypot(dx, dy * 1.2, dz) > r + rand() * 0.5) continue;
            blocks[blockIndex(ox + dx, h + 1 + dy, oz + dz)] = rand() < 0.7 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE;
          }
        }
      }
    }
  }

  // Removes rock left floating in the air by caves: pieces not connected to the bedrock (or
  // standing in a lake or lava pool, like an island) go. A piece touching the chunk's side may rest
  // on the next chunk, so it stays unless it is a small lump (the next chunk then drops its part).
  dropFloating(blocks, heights, fluid, col) {
    const seen = new Uint8Array(CHUNK_VOLUME);
    const solid = (id) => id !== B.AIR && id !== B.WATER && id !== B.LAVA;
    const flood = (start, onCell) => {
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const idx = stack.pop();
        onCell(idx);
        const lx = idx & 15;
        const lz = (idx >> 4) & 15;
        const y = idx >> 8;
        if (lx > 0) visit(idx - 1);
        if (lx < 15) visit(idx + 1);
        if (lz > 0) visit(idx - 16);
        if (lz < 15) visit(idx + 16);
        if (y > 0) visit(idx - 256);
        if (y < H - 1) visit(idx + 256);
      }
      function visit(i) {
        if (seen[i] || !solid(blocks[i])) return;
        seen[i] = 1;
        stack.push(i);
      }
    };
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      if (seen[i] || !solid(blocks[i])) continue;
      if (i < 256 || blocks[i - 256] === B.WATER || blocks[i - 256] === B.LAVA) flood(i, () => {});
    }
    for (let idx = 256; idx < CHUNK_VOLUME; idx++) {
      if (seen[idx] || !solid(blocks[idx])) continue;
      const cells = [];
      let border = false;
      let wet = false;
      const fluidAt = (i) => blocks[i] === B.WATER || blocks[i] === B.LAVA;
      flood(idx, (i) => {
        cells.push(i);
        const lx = i & 15;
        const lz = (i >> 4) & 15;
        if (lx === 0 || lx === 15 || lz === 0 || lz === 15) border = true;
        if ((lx > 0 && fluidAt(i - 1)) || (lx < 15 && fluidAt(i + 1)) || (lz > 0 && fluidAt(i - 16)) || (lz < 15 && fluidAt(i + 16))
          || (i >= 256 && fluidAt(i - 256)) || (i + 256 < CHUNK_VOLUME && fluidAt(i + 256))) wet = true;
        // Across the chunk's side: the sea, or cave fluid that may be there.
        const y = i >> 8;
        for (const [dx, dz] of SIDES) {
          const nx = lx + dx;
          const nz = lz + dz;
          if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) continue;
          const nh = col(nx, nz).h;
          if ((nh < SEA_LEVEL && y > nh && y <= SEA_LEVEL) || y <= fluidTop(fluid(nx, nz))) wet = true;
        }
      });
      // Pieces holding back water or lava stay too.
      if (border && (cells.length >= 48 || wet)) continue;
      for (const i of cells) {
        // Fill the hole with whatever surrounds it: the sea, the cave's fluid, or air.
        const lx = i & 15;
        const lz = (i >> 4) & 15;
        const y = i >> 8;
        const f = fluid(lx, lz);
        const h = heights[lx + lz * 16];
        if (h < SEA_LEVEL && y > h && y <= SEA_LEVEL) blocks[i] = B.WATER;
        else if (y <= fluidTop(f)) blocks[i] = f === LAVA_LEVEL ? B.LAVA : B.WATER;
        else blocks[i] = B.AIR;
      }
    }
  }

  // Leaves cut off from their tree by the terrain, and vines hanging from nothing, are removed
  // (only where the chunk can see it; across its sides the neighbour's blocks are trusted).
  tidyTrees(blocks, meta) {
    const leaf = (id) => id > 0 && BLOCKS[id].leaves;
    const dist = new Uint8Array(CHUNK_VOLUME).fill(255);
    let frontier = [];
    for (let idx = 0; idx < CHUNK_VOLUME; idx++) {
      const id = blocks[idx];
      const lx = idx & 15;
      const lz = (idx >> 4) & 15;
      if (IS_LOG[id] || (leaf(id) && (lx === 0 || lx === 15 || lz === 0 || lz === 15))) {
        dist[idx] = 0;
        frontier.push(idx);
      }
    }
    for (let d = 1; d <= 6 && frontier.length; d++) {
      const next = [];
      for (const idx of frontier) {
        const lx = idx & 15;
        const lz = (idx >> 4) & 15;
        const y = idx >> 8;
        const around = [lx > 0 ? idx - 1 : -1, lx < 15 ? idx + 1 : -1, lz > 0 ? idx - 16 : -1, lz < 15 ? idx + 16 : -1,
          y > 0 ? idx - 256 : -1, y < H - 1 ? idx + 256 : -1];
        for (const n of around) {
          if (n < 0 || dist[n] !== 255 || !leaf(blocks[n])) continue;
          dist[n] = d;
          next.push(n);
        }
      }
      frontier = next;
    }
    for (let idx = 0; idx < CHUNK_VOLUME; idx++) if (dist[idx] === 255 && leaf(blocks[idx])) blocks[idx] = B.AIR;
    // Vines, top down: each needs its block behind it or a vine above.
    for (let y = H - 2; y > 0; y--) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const idx = blockIndex(lx, y, lz);
          const up = blocks[idx + 256];
          if (blocks[idx] !== B.VINE || up === B.VINE || (up > 0 && BLOCKS[up].leaves)) continue;
          const [dx, dz] = FACING[(meta[idx] + 2) & 3];
          const bx = lx + dx;
          const bz = lz + dz;
          if (bx < 0 || bx > 15 || bz < 0 || bz > 15) continue;
          if (!IS_SOLID[blocks[blockIndex(bx, y, bz)]]) blocks[idx] = B.AIR;
        }
      }
    }
  }

  // Sand and gravel left hanging over a cave would fall at the first update: firm them up instead
  // (sand to sandstone, like Minecraft's beaches and deserts).
  settleGravity(blocks) {
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        for (let y = 1; y < H; y++) {
          const idx = blockIndex(lx, y, lz);
          const fix = GRAVITY_FIX[blocks[idx]];
          if (fix === undefined) continue;
          const below = blocks[idx - 256];
          if (below === B.AIR || below === B.WATER || below === B.LAVA) blocks[idx] = fix;
        }
      }
    }
  }

  // ------------------------------------------------------------ plants
  placePlants(blocks, meta, heights, biomes, cx, cz) {
    const seed = this.seed ^ 0x5eed;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const h = heights[lx + lz * 16];
        if (h + 3 >= H) continue;
        const wx = cx * 16 + lx;
        const wz = cz * 16 + lz;
        const biome = biomes[lx + lz * 16];
        const r = hashFloat(seed, wx, 3, wz);
        // Lily pads on swamp water.
        if (biome === BIOMES.SWAMP && h < SEA_LEVEL && blocks[blockIndex(lx, SEA_LEVEL, lz)] === B.WATER && blocks[blockIndex(lx, SEA_LEVEL + 1, lz)] === B.AIR) {
          if (r < 0.07) blocks[blockIndex(lx, SEA_LEVEL + 1, lz)] = B.LILY_PAD;
          continue;
        }
        if (h < SEA_LEVEL) continue;
        // Surface may differ from the height map (overhangs): find the top block.
        let y = Math.min(H - 3, h + 12);
        while (y > h - 12 && blocks[blockIndex(lx, y, lz)] === B.AIR) y--;
        const ground = blocks[blockIndex(lx, y, lz)];
        const aboveIdx = blockIndex(lx, y + 1, lz);
        if (blocks[aboveIdx] !== B.AIR) continue;
        if (ground === B.GRASS || ground === B.DIRT || ground === B.SAND || ground === B.PODZOL) {
          // Sugar cane along shores.
          if (y === SEA_LEVEL && hashFloat(seed, wx, 6, wz) < 0.12 && this.nextToWater(blocks, lx, y, lz, cx, cz)) {
            const height = 1 + Math.floor(hashFloat(seed, wx, 7, wz) * 3);
            for (let i = 1; i <= height && y + i < H; i++) blocks[blockIndex(lx, y + i, lz)] = B.SUGAR_CANE;
            continue;
          }
        }
        if (ground === B.GRASS || ground === B.PODZOL) {
          const grassChance = {
            [BIOMES.PLAINS]: 0.16, [BIOMES.SAVANNA]: 0.3, [BIOMES.JUNGLE]: 0.25, [BIOMES.MEADOW]: 0.3,
            [BIOMES.MOUNTAINS]: 0.04, [BIOMES.SWAMP]: 0.08, [BIOMES.DARK_FOREST]: 0.05,
          }[biome] ?? 0.07;
          const flowerChance = biome === BIOMES.MEADOW ? 0.08 : biome === BIOMES.PLAINS ? 0.022 : biome === BIOMES.FOREST || biome === BIOMES.BIRCH_FOREST ? 0.01 : 0.004;
          if (r < grassChance) {
            const fern = biome === BIOMES.TAIGA || biome === BIOMES.SNOWY_TAIGA ? 0.6 : biome === BIOMES.JUNGLE ? 0.25 : 0;
            blocks[aboveIdx] = hashFloat(seed, wx, 8, wz) < fern ? B.FERN : B.TALL_GRASS;
          } else if (r < grassChance + flowerChance) {
            // Flowers grow in patches of one kind.
            const patch = hashFloat(seed, Math.floor(wx / 6), 9, Math.floor(wz / 6));
            const set = FLOWERS[biome] || FLOWERS.default;
            blocks[aboveIdx] = set[Math.floor(patch * set.length)];
          } else if ((biome === BIOMES.TAIGA || biome === BIOMES.FOREST || biome === BIOMES.DARK_FOREST || biome === BIOMES.SWAMP) && r > 0.997) {
            blocks[aboveIdx] = hashFloat(seed, wx, 10, wz) < 0.6 ? B.BROWN_MUSHROOM : B.RED_MUSHROOM;
          } else if ((biome === BIOMES.PLAINS || biome === BIOMES.SAVANNA) && r > 0.9993) {
            blocks[aboveIdx] = B.PUMPKIN;
          }
        } else if (ground === B.SAND && biome === BIOMES.DESERT) {
          if (r < 0.005) {
            this.cactus(blocks, lx, y, lz, 1 + Math.floor(hashFloat(seed, wx, 5, wz) * 3));
          } else if (r < 0.012) {
            blocks[aboveIdx] = B.DEAD_BUSH;
          }
        } else if (biome === BIOMES.BADLANDS && (ground === B.RED_SAND || ground === B.TERRACOTTA || ground === B.ORANGE_TERRACOTTA)) {
          if (ground === B.RED_SAND && r < 0.004) {
            this.cactus(blocks, lx, y, lz, 1 + Math.floor(hashFloat(seed, wx, 5, wz) * 3));
          } else if (r < 0.02) {
            blocks[aboveIdx] = B.DEAD_BUSH;
          }
        }
      }
    }
  }

  // A cactus needs free space on all four sides (and stays inside the chunk so the neighbours
  // cannot put anything next to it).
  cactus(blocks, lx, y, lz, height) {
    if (lx < 1 || lx > 14 || lz < 1 || lz > 14 || y + height >= H) return;
    for (let i = 1; i <= height; i++) {
      if (blocks[blockIndex(lx, y + i, lz)] !== B.AIR) return;
      for (const [dx, dz] of SIDES) if (blocks[blockIndex(lx + dx, y + i, lz + dz)] !== B.AIR) return;
    }
    for (let i = 1; i <= height; i++) blocks[blockIndex(lx, y + i, lz)] = B.CACTUS;
  }

  nextToWater(blocks, lx, y, lz, cx, cz) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = lx + dx;
      const z = lz + dz;
      if (x < 0 || x > 15 || z < 0 || z > 15) {
        // Outside this chunk: ask the terrain shape instead.
        if (this.column(cx * 16 + x, cz * 16 + z).h < SEA_LEVEL) return true;
        continue;
      }
      if (blocks[blockIndex(x, y, z)] === B.WATER) return true;
    }
    return false;
  }

  // A layer of snow on the ground (and on leaves) in cold places.
  placeSnow(blocks, cx, cz, heights, temps) {
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        if (temps[lx + lz * 16] >= SNOW_TEMP && heights[lx + lz * 16] <= 100) continue;
        let y = H - 2;
        while (y > 0 && blocks[blockIndex(lx, y, lz)] === B.AIR) y--;
        const top = blocks[blockIndex(lx, y, lz)];
        if (!IS_SOLID[top] || top === B.ICE || top === B.SNOW || top === B.LILY_PAD || top === B.CACTUS) continue;
        blocks[blockIndex(lx, y + 1, lz)] = B.SNOW;
        if (top === B.GRASS) blocks[blockIndex(lx, y, lz)] = B.SNOWY_GRASS;
      }
    }
  }

  // Trees can straddle chunk borders, so look at every tree origin within reach of this chunk.
  placeTrees(blocks, meta, cx, cz) {
    const seed = this.seed ^ 0x7ee5;
    const x0 = cx * 16;
    const z0 = cz * 16;
    const set = (x, y, z, id, overwrite, m = 0) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lx >= 16 || lz < 0 || lz >= 16 || y < 0 || y >= H) return;
      const idx = blockIndex(lx, y, lz);
      const cur = blocks[idx];
      const soft = cur === B.AIR || cur === B.TALL_GRASS || cur === B.FERN || cur === B.POPPY || cur === B.DANDELION || cur === B.SNOW;
      if (overwrite || soft || (cur === B.VINE && id !== B.VINE)) {
        blocks[idx] = id;
        meta[idx] = m;
      }
    };
    // Where the ground will stop a tree's leaves (the height map, cached for this chunk).
    const heightCache = new Map();
    const groundAt = (x, y, z) => {
      const k = x + ',' + z;
      let h = heightCache.get(k);
      if (h === undefined) {
        h = this.column(x, z).h;
        heightCache.set(k, h);
      }
      return y <= h;
    };
    const R = TREE_RADIUS;
    for (let wz = z0 - R; wz < z0 + 16 + R; wz++) {
      for (let wx = x0 - R; wx < x0 + 16 + R; wx++) {
        const tree = this.treeAt(wx, wz);
        if (!tree) continue;
        // The finished blocks of each tree are kept for the other chunks it reaches into.
        const key = wx + ',' + wz;
        let parts = this.treeParts.get(key);
        if (!parts) {
          if (this.treeParts.size > 2000) this.treeParts.clear();
          parts = buildTree(tree.type, wx, tree.h + 1, wz, mulberry32(hash3(seed, wx, 2, wz)), undefined, groundAt);
          this.treeParts.set(key, parts);
        }
        for (const p of parts) set(p[0], p[1], p[2], p[3], p[4], p[5]);
        const { type, h } = tree;
        set(wx, h, wz, B.DIRT, true);
        if (type === 'dark_oak' || type === 'mega_jungle') {
          set(wx + 1, h, wz, B.DIRT, true);
          set(wx, h, wz + 1, B.DIRT, true);
          set(wx + 1, h, wz + 1, B.DIRT, true);
        }
      }
    }
  }

  // The tree rooted at column (wx, wz), if any: { type, h }. Cached, since up to four chunks
  // ask about each tree.
  treeAt(wx, wz) {
    const key = wx + ',' + wz;
    if (this.trees.has(key)) return this.trees.get(key);
    if (this.trees.size > 30000) this.trees.clear();
    const tree = this.findTree(wx, wz);
    this.trees.set(key, tree);
    return tree;
  }

  findTree(wx, wz) {
    const seed = this.seed ^ 0x7ee5;
    const r = hashFloat(seed, wx, 0, wz);
    if (r >= MAX_TREE_DENSITY) return null;
    // Keep trees apart: skip if a neighbouring column also rolled a tree with a lower hash.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dz) && hashFloat(seed, wx + dx, 0, wz + dz) < r) return null;
      }
    }
    const info = this.column(wx, wz);
    const { biome, h } = info;
    if (r >= TREE_DENSITY[biome]) return null;
    if (h < SEA_LEVEL || h > H - 32 || info.m > 0.25) return null;
    // Trees need soil (the column's own surface block, not stone on a slope or sand)…
    let slope = 0;
    for (const [dx, dz] of SIDES) slope = Math.max(slope, Math.abs(this.column(wx + dx, wz + dz).h - h));
    if (!SOIL_TOPS.has(this.surfaceFor(info, slope, wx, wz).top)) return null;
    // …and solid ground: no trees floating over a cave mouth.
    if (this.caveAt(wx, h, wz) || this.caveAt(wx, h - 1, wz)) return null;
    let type = pickWeighted(TREES[biome], hashFloat(seed, wx, 1, wz));
    if (type === 'dark_oak' || type === 'mega_jungle') {
      // 2x2 trunks need all four columns level and solid; otherwise grow the small kind.
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1]]) {
        if (this.column(wx + dx, wz + dz).h !== h || this.caveAt(wx + dx, h, wz + dz)) { type = type === 'dark_oak' ? 'oak' : 'jungle'; break; }
      }
    }
    return { type, h };
  }

  // Finds a dry land spawn point near the origin.
  findSpawn() {
    const bad = new Set([...WATER_BIOMES, BIOMES.STONY_PEAKS, BIOMES.SNOWY_PEAKS, BIOMES.MOUNTAINS, BIOMES.SWAMP]);
    for (let r = 0; r < 6000; r += 8) {
      const steps = Math.max(1, Math.floor((r * 2 * Math.PI) / 16));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r);
        const z = Math.round(Math.sin(a) * r);
        const { h, biome } = this.column(x, z);
        if (h > SEA_LEVEL && !bad.has(biome) && !this.caveAt(x, h, z) && !this.caveAt(x, h - 1, z)) {
          return { x: x + 0.5, y: h + 1, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: H - 20, z: 0.5 };
  }
}

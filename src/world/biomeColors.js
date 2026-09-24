// Biome tint colours for grass, foliage and water (like Minecraft's colour maps), blended across
// biome borders the way Minecraft's "biome blend" option does. Runs in the mesh workers.
import { BIOMES, SNOW_TEMP } from './generator.js';

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

// Colours per biome id (see BIOMES).
const GRASS = [];
const FOLIAGE = [];
GRASS[BIOMES.OCEAN] = hex(0x8eb971); FOLIAGE[BIOMES.OCEAN] = hex(0x71a74d);
GRASS[BIOMES.BEACH] = hex(0x91bd59); FOLIAGE[BIOMES.BEACH] = hex(0x77ab2f);
GRASS[BIOMES.PLAINS] = hex(0x91bd59); FOLIAGE[BIOMES.PLAINS] = hex(0x77ab2f);
GRASS[BIOMES.FOREST] = hex(0x79c05a); FOLIAGE[BIOMES.FOREST] = hex(0x59ae30);
GRASS[BIOMES.DESERT] = hex(0xbfb755); FOLIAGE[BIOMES.DESERT] = hex(0xaea42a);
GRASS[BIOMES.TAIGA] = hex(0x86b783); FOLIAGE[BIOMES.TAIGA] = hex(0x68a464);
GRASS[BIOMES.SNOWY] = hex(0x80b497); FOLIAGE[BIOMES.SNOWY] = hex(0x60a17b);
GRASS[BIOMES.MOUNTAINS] = hex(0x8ab689); FOLIAGE[BIOMES.MOUNTAINS] = hex(0x6da36b);
GRASS[BIOMES.RIVER] = hex(0x8eb971); FOLIAGE[BIOMES.RIVER] = hex(0x71a74d);
GRASS[BIOMES.BIRCH_FOREST] = hex(0x88bb67); FOLIAGE[BIOMES.BIRCH_FOREST] = hex(0x6ba941);
GRASS[BIOMES.SAVANNA] = hex(0xbfb755); FOLIAGE[BIOMES.SAVANNA] = hex(0xaea42a);
GRASS[BIOMES.JUNGLE] = hex(0x59c93c); FOLIAGE[BIOMES.JUNGLE] = hex(0x30bb0b);
GRASS[BIOMES.SWAMP] = hex(0x6a7039); FOLIAGE[BIOMES.SWAMP] = hex(0x6a7039);
GRASS[BIOMES.DARK_FOREST] = hex(0x507a32); FOLIAGE[BIOMES.DARK_FOREST] = hex(0x59ae30);
GRASS[BIOMES.BADLANDS] = hex(0x90814d); FOLIAGE[BIOMES.BADLANDS] = hex(0x9e814d);
GRASS[BIOMES.DEEP_OCEAN] = hex(0x8eb971); FOLIAGE[BIOMES.DEEP_OCEAN] = hex(0x71a74d);
GRASS[BIOMES.STONY_PEAKS] = hex(0x9abe4b); FOLIAGE[BIOMES.STONY_PEAKS] = hex(0x82ac1e);
GRASS[BIOMES.SNOWY_PEAKS] = hex(0x80b497); FOLIAGE[BIOMES.SNOWY_PEAKS] = hex(0x60a17b);
GRASS[BIOMES.SNOWY_TAIGA] = hex(0x80b497); FOLIAGE[BIOMES.SNOWY_TAIGA] = hex(0x60a17b);
GRASS[BIOMES.STONY_SHORE] = hex(0x8ab689); FOLIAGE[BIOMES.STONY_SHORE] = hex(0x6da36b);
GRASS[BIOMES.FROZEN_RIVER] = hex(0x80b497); FOLIAGE[BIOMES.FROZEN_RIVER] = hex(0x60a17b);
GRASS[BIOMES.MEADOW] = hex(0x83bb6d); FOLIAGE[BIOMES.MEADOW] = hex(0x63a948);
GRASS[BIOMES.FROZEN_OCEAN] = hex(0x80b497); FOLIAGE[BIOMES.FROZEN_OCEAN] = hex(0x60a17b);
GRASS[BIOMES.SNOWY_BEACH] = hex(0x83b593); FOLIAGE[BIOMES.SNOWY_BEACH] = hex(0x64a278);

const WATER_DEFAULT = hex(0x3f76e4);
const WATER_WARM = hex(0x43d5ee);
const WATER_LUKEWARM = hex(0x45adf2);
const WATER_COLD = hex(0x3d57d6);
const WATER_FROZEN = hex(0x3938c9);
const WATER_SWAMP = hex(0x617b64);
const OCEANS = new Set([BIOMES.OCEAN, BIOMES.DEEP_OCEAN, BIOMES.BEACH, BIOMES.STONY_SHORE]);

// Default colours for items and icons (Minecraft uses fixed colours outside the world too).
export const ITEM_GRASS = hex(0x7cbd6b);
export const ITEM_FOLIAGE = hex(0x48b518);
export const ITEM_WATER = WATER_DEFAULT;

function waterColor(biome, temp) {
  if (biome === BIOMES.SWAMP) return WATER_SWAMP;
  if (biome === BIOMES.FROZEN_OCEAN || biome === BIOMES.FROZEN_RIVER || biome === BIOMES.SNOWY_BEACH) return WATER_FROZEN;
  if (OCEANS.has(biome)) {
    if (temp > 0.38) return WATER_WARM;
    if (temp > 0.2) return WATER_LUKEWARM;
    if (temp < -0.35) return WATER_FROZEN;
    if (temp < -0.18) return WATER_COLD;
    return WATER_DEFAULT;
  }
  if (biome === BIOMES.SNOWY || biome === BIOMES.SNOWY_TAIGA || (biome === BIOMES.RIVER && temp < SNOW_TEMP)) return WATER_FROZEN;
  return WATER_DEFAULT;
}

export const BLEND_RADIUS = 4;

// Per-chunk climate cache: biome id and temperature of every column.
class ClimateCache {
  constructor(generator, max = 1024) {
    this.generator = generator;
    this.max = max;
    this.map = new Map();
  }

  get(cx, cz) {
    const key = cx + ',' + cz;
    let e = this.map.get(key);
    if (e) {
      // Refresh LRU order.
      this.map.delete(key);
      this.map.set(key, e);
      return e;
    }
    const biome = new Uint8Array(256);
    const temp = new Float32Array(256);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const c = this.generator.column(cx * 16 + x, cz * 16 + z);
        biome[x + z * 16] = c.biome;
        temp[x + z * 16] = c.temp;
      }
    }
    e = { biome, temp };
    this.map.set(key, e);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return e;
  }
}

const caches = new WeakMap();

// Blended tints for the 16x16 columns of chunk (cx, cz): { grass, foliage, water }, each a
// Uint8Array of 256 * 3 RGB values indexed by (x + z * 16) * 3.
export function chunkTints(generator, cx, cz) {
  let cache = caches.get(generator);
  if (!cache) {
    cache = new ClimateCache(generator);
    caches.set(generator, cache);
  }
  const R = BLEND_RADIUS;
  const S = 16 + 2 * R;
  // Raw colours in the (16 + 2R)^2 neighbourhood.
  const raw = [new Float32Array(S * S * 3), new Float32Array(S * S * 3), new Float32Array(S * S * 3)];
  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const wx = cx * 16 + x - R;
      const wz = cz * 16 + z - R;
      const ccx = Math.floor(wx / 16);
      const ccz = Math.floor(wz / 16);
      const e = cache.get(ccx, ccz);
      const i = (wx - ccx * 16) + (wz - ccz * 16) * 16;
      const biome = e.biome[i];
      const cols = [GRASS[biome] || GRASS[BIOMES.PLAINS], FOLIAGE[biome] || FOLIAGE[BIOMES.PLAINS], waterColor(biome, e.temp[i])];
      const o = (x + z * S) * 3;
      for (let k = 0; k < 3; k++) {
        raw[k][o] = cols[k][0];
        raw[k][o + 1] = cols[k][1];
        raw[k][o + 2] = cols[k][2];
      }
    }
  }
  // Separable box blur, then keep the centre 16x16.
  const out = [new Uint8Array(768), new Uint8Array(768), new Uint8Array(768)];
  const tmp = new Float32Array(16 * S * 3);
  const n = 2 * R + 1;
  for (let k = 0; k < 3; k++) {
    const src = raw[k];
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < 16; x++) {
        let r = 0; let g = 0; let b = 0;
        for (let d = 0; d < n; d++) {
          const o = (x + d + z * S) * 3;
          r += src[o]; g += src[o + 1]; b += src[o + 2];
        }
        const o = (x + z * 16) * 3;
        tmp[o] = r / n; tmp[o + 1] = g / n; tmp[o + 2] = b / n;
      }
    }
    const dst = out[k];
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let r = 0; let g = 0; let b = 0;
        for (let d = 0; d < n; d++) {
          const o = (x + (z + d) * 16) * 3;
          r += tmp[o]; g += tmp[o + 1]; b += tmp[o + 2];
        }
        const o = (x + z * 16) * 3;
        dst[o] = Math.round(r / n); dst[o + 1] = Math.round(g / n); dst[o + 2] = Math.round(b / n);
      }
    }
  }
  return { grass: out[0], foliage: out[1], water: out[2] };
}

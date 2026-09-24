// Main-thread world: chunk streaming around the player, block access, block updates, fluids,
// random ticks and tile entities (furnaces, chests).
import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT, CHUNK_VOLUME, blockIndex, chunkKey } from '../constants.js';
import {
  B, BLOCKS, IS_OPAQUE, IS_SOLID, IS_FLUID, LIGHT_ATTEN, LIGHT_EMIT,
} from './blocks.js';
import { TerrainGenerator } from './generator.js';
import { placeTree, treeHeight } from './trees.js';
import { DIRS, attachedDir } from './shapes.js';
import { mulberry32 } from './noise.js';
import { SMELTING, SMELT_TIME, SMELT_XP } from '../crafting.js';
import { FUEL, maxStack, I } from '../items.js';

const H = WORLD_HEIGHT;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
    this.blocks = null;
    this.meta = null;
    this.state = 'loading'; // loading | ready
    this.meshes = [];
    this.skyLight = null;
    this.blockLight = null;
    this.version = 0;
    this.meshedVersion = -1;
    this.hasMesh = false;
    this.modified = false;
    this.pendingEntities = null;
  }
}

class WorkerPool {
  constructor(seed, onMessage) {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.busy = 0;
      w.onmessage = (e) => {
        w.busy--;
        onMessage(e.data);
      };
      w.onerror = (e) => console.error('Worker error', e);
      w.postMessage({ type: 'init', seed });
      this.workers.push(w);
    }
  }

  freeWorker() {
    let best = null;
    for (const w of this.workers) if (w.busy < 2 && (!best || w.busy < best.busy)) best = w;
    return best;
  }

  post(w, msg, transfer) {
    w.busy++;
    w.postMessage(msg, transfer || []);
  }

  terminate() {
    for (const w of this.workers) w.terminate();
  }
}

const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SOIL = new Set([B.GRASS, B.DIRT, B.SNOWY_GRASS, B.FARMLAND]);

export class World {
  constructor({ seed, worldId, storage, scene, materials, workers = true }) {
    this.seed = seed;
    this.worldId = worldId;
    this.storage = storage;
    this.scene = scene;
    this.materials = materials;
    this.generator = new TerrainGenerator(seed);
    this.chunks = new Map();
    this.savedKeys = new Set();
    this.genQueue = new Set();
    this.meshUrgent = new Set();
    this.meshNormal = new Set();
    this.tiles = new Map(); // "x,y,z" -> tile entity
    this.scheduled = new Map(); // "x,y,z" -> due tick
    this.tickCount = 0;
    this.renderDistance = 6;
    this.centerCx = 0;
    this.centerCz = 0;
    this.rand = mulberry32((seed ^ Date.now()) >>> 0);
    this.game = null;
    this.skyDarken = 0;
    this.pool = workers ? new WorkerPool(seed, (msg) => this.onWorkerMessage(msg)) : null;
    this.jobId = 0;
    this.stats = { generated: 0, meshed: 0 };
  }

  async init() {
    const keys = await this.storage.chunkKeys(this.worldId);
    for (const k of keys) this.savedKeys.add(k);
  }

  dispose() {
    if (this.pool) this.pool.terminate();
    for (const c of this.chunks.values()) this.disposeMeshes(c);
    this.chunks.clear();
  }

  // ---------------------------------------------------------------- block access
  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  chunkAt(x, z) {
    const c = this.chunks.get(chunkKey(Math.floor(x / 16), Math.floor(z / 16)));
    return c && c.state === 'ready' ? c : null;
  }

  isLoaded(x, z) {
    return this.chunkAt(x, z) !== null;
  }

  // Returns block id, 0 above the world, and -1 if the chunk is not loaded or y < 0.
  getBlock(x, y, z) {
    if (y >= H) return 0;
    if (y < 0) return -1;
    const c = this.chunkAt(x, z);
    if (!c) return -1;
    return c.blocks[blockIndex(x & 15, y, z & 15)];
  }

  getMeta(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    return c.meta[blockIndex(x & 15, y, z & 15)];
  }

  getSkyLight(x, y, z) {
    if (y >= H) return 15;
    if (y < 0) return 0;
    const c = this.chunkAt(x, z);
    if (!c || !c.skyLight) return 15;
    return c.skyLight[blockIndex(x & 15, y, z & 15)];
  }

  getBlockLight(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const c = this.chunkAt(x, z);
    if (!c || !c.blockLight) return 0;
    return c.blockLight[blockIndex(x & 15, y, z & 15)];
  }

  // Effective light level 0..15 taking the time of day into account.
  getLight(x, y, z) {
    return Math.max(this.getBlockLight(x, y, z), this.getSkyLight(x, y, z) - this.skyDarken);
  }

  // Sets a block. opts: { meta, update (default true), keepTile, drop }
  setBlock(x, y, z, id, opts = {}) {
    if (y < 0 || y >= H) return false;
    const c = this.chunkAt(x, z);
    if (!c) return false;
    const lx = x & 15;
    const lz = z & 15;
    const i = blockIndex(lx, y, lz);
    const old = c.blocks[i];
    const oldMeta = c.meta[i];
    const meta = opts.meta || 0;
    if (old === id && oldMeta === meta) return false;
    c.blocks[i] = id;
    c.meta[i] = meta;
    c.modified = true;
    c.version++;

    const key = x + ',' + y + ',' + z;
    if (old !== id && this.tiles.has(key) && !opts.keepTile) {
      const tile = this.tiles.get(key);
      this.tiles.delete(key);
      if (this.game) for (const s of tile.items) if (s) this.game.dropItem(x + 0.5, y + 0.5, z + 0.5, s);
    }
    if (old !== id) {
      if (id === B.FURNACE && !this.tiles.has(key)) this.tiles.set(key, newFurnace());
      if (id === B.CHEST && !this.tiles.has(key)) this.tiles.set(key, { type: 'chest', items: new Array(27).fill(null) });
    }

    const lightChanged = LIGHT_ATTEN[old] !== LIGHT_ATTEN[id] || LIGHT_EMIT[old] !== LIGHT_EMIT[id];
    this.remeshAround(c, lx, lz, lightChanged);

    if (opts.update !== false) {
      if (IS_FLUID[id]) this.schedule(x, y, z, id === B.WATER ? 5 : 30);
      for (const [dx, dy, dz] of NEIGHBORS) this.neighborChanged(x + dx, y + dy, z + dz);
      if ((old === B.OAK_LOG || old === B.BIRCH_LOG || old === B.SPRUCE_LOG) && id !== old) this.scheduleLeafDecay(x, y, z);
    }
    return true;
  }

  setMeta(x, y, z, meta) {
    return this.setBlock(x, y, z, this.getBlock(x, y, z), { meta, keepTile: true, update: false });
  }

  remeshAround(c, lx, lz, lightChanged) {
    this.requestMesh(c, true);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = this.getChunk(c.cx + dx, c.cz + dz);
        if (!n || n.state !== 'ready') continue;
        const edge = (dx === -1 ? lx === 0 : dx === 1 ? lx === 15 : true)
          && (dz === -1 ? lz === 0 : dz === 1 ? lz === 15 : true);
        if (edge) this.requestMesh(n, true);
        else if (lightChanged) this.requestMesh(n, false);
      }
    }
  }

  // Inserts a chunk with the given data directly (used by tests and tools).
  insertChunk(cx, cz, blocks, meta) {
    const c = new Chunk(cx, cz);
    c.blocks = blocks;
    c.meta = meta || new Uint8Array(CHUNK_VOLUME);
    this.chunks.set(c.key, c);
    c.state = 'ready';
    return c;
  }

  requestMesh(c, urgent) {
    if (urgent) {
      this.meshUrgent.add(c.key);
      this.meshNormal.delete(c.key);
    } else if (!this.meshUrgent.has(c.key)) {
      this.meshNormal.add(c.key);
    }
  }

  // ---------------------------------------------------------------- block updates
  neighborChanged(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id <= 0) return;
    const b = BLOCKS[id];
    if (IS_FLUID[id]) {
      this.schedule(x, y, z, id === B.WATER ? 5 : 30);
      return;
    }
    if (b.gravity) {
      const below = this.getBlock(x, y - 1, z);
      if (below === 0 || (below > 0 && (BLOCKS[below].replaceable))) this.fall(x, y, z, id);
      return;
    }
    if (b.twoPart && !this.partnerPresent(x, y, z, id)) {
      this.setBlock(x, y, z, B.AIR); // the other half dropped the item
      return;
    }
    if (b.support && !this.hasSupport(x, y, z, b.support)) {
      this.breakBlock(x, y, z, true);
      return;
    }
    if (id === B.FARMLAND && IS_SOLID[this.getBlock(x, y + 1, z)] && this.getBlock(x, y + 1, z) !== B.WHEAT) {
      this.setBlock(x, y, z, B.DIRT);
    }
  }

  // Doors and beds are made of two blocks; each half needs the other.
  partnerPresent(x, y, z, id) {
    const meta = this.getMeta(x, y, z);
    let px = x;
    let py = y;
    let pz = z;
    let want;
    if (BLOCKS[id].twoPart === 'door') {
      py += meta & 8 ? -1 : 1;
      want = (m) => (m & 8) !== (meta & 8);
    } else {
      const d = DIRS[meta & 3];
      const s = meta & 4 ? -1 : 1;
      px += d[0] * s;
      pz += d[1] * s;
      want = (m) => (m & 4) !== (meta & 4);
    }
    const other = this.getBlock(px, py, pz);
    if (other < 0) return true;
    return other === id && want(this.getMeta(px, py, pz));
  }

  // Support check for a block about to be placed with `meta` (uses the meta instead of the world).
  hasSupportFor(x, y, z, kind, meta) {
    const d = kind === 'wall' ? DIRS[attachedDir(meta)] : kind === 'torch' && meta >= 1 && meta <= 4 ? DIRS[meta - 1] : null;
    if (kind === 'wall') return IS_OPAQUE[Math.max(0, this.getBlock(x + d[0], y, z + d[1]))] === 1;
    if (kind === 'torch' && d) return IS_OPAQUE[Math.max(0, this.getBlock(x - d[0], y, z - d[1]))] === 1;
    if (kind === 'torch') {
      const below = this.getBlock(x, y - 1, z);
      return below < 0 || IS_OPAQUE[below] === 1 || below === B.FARMLAND || below === B.OAK_FENCE || below === B.GLASS;
    }
    return this.hasSupport(x, y, z, kind);
  }

  hasSupport(x, y, z, kind) {
    const below = this.getBlock(x, y - 1, z);
    if (below < 0) return true;
    switch (kind) {
      case 'soil': return SOIL.has(below);
      case 'farmland': return below === B.FARMLAND;
      case 'sand': return below === B.SAND || SOIL.has(below);
      case 'cactus': {
        if (below !== B.SAND && below !== B.CACTUS) return false;
        for (const [dx, , dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
          if (IS_SOLID[Math.max(0, this.getBlock(x + dx, y, z + dz))]) return false;
        }
        return true;
      }
      case 'solid': {
        const id = this.getBlock(x, y, z);
        // The upper half of a door stands on the lower half.
        if (id === B.OAK_DOOR && (this.getMeta(x, y, z) & 8)) return true;
        return IS_SOLID[below] === 1;
      }
      case 'torch': {
        const meta = this.getMeta(x, y, z);
        if (meta >= 1 && meta <= 4) {
          const d = DIRS[meta - 1];
          return IS_OPAQUE[Math.max(0, this.getBlock(x - d[0], y, z - d[1]))] === 1;
        }
        return IS_OPAQUE[below] === 1 || below === B.FARMLAND || below === B.OAK_FENCE || below === B.GLASS;
      }
      case 'wall': {
        const d = DIRS[attachedDir(this.getMeta(x, y, z))];
        return IS_OPAQUE[Math.max(0, this.getBlock(x + d[0], y, z + d[1]))] === 1;
      }
      case 'cane': {
        if (below === B.SUGAR_CANE) return true;
        if (!SOIL.has(below) && below !== B.SAND) return false;
        for (const [dx, , dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
          const n = this.getBlock(x + dx, y - 1, z + dz);
          if (n === B.WATER || n === B.ICE || n < 0) return true;
        }
        return false;
      }
      case 'mushroom': return IS_OPAQUE[below] === 1;
      default: return true;
    }
  }

  // Opens or closes a door (both halves). Returns the new open state.
  toggleDoor(x, y, z) {
    const meta = this.getMeta(x, y, z);
    const open = !(meta & 4);
    const oy = meta & 8 ? y - 1 : y + 1;
    this.setBlock(x, y, z, B.OAK_DOOR, { meta: open ? meta | 4 : meta & ~4, update: false });
    if (this.getBlock(x, oy, z) === B.OAK_DOOR) {
      const om = this.getMeta(x, oy, z);
      this.setBlock(x, oy, z, B.OAK_DOOR, { meta: open ? om | 4 : om & ~4, update: false });
    }
    return open;
  }

  // Removes a block, optionally dropping its items as if broken by hand.
  breakBlock(x, y, z, drop, tool = null) {
    const id = this.getBlock(x, y, z);
    if (id <= 0) return;
    const meta = this.getMeta(x, y, z);
    this.setBlock(x, y, z, B.AIR);
    if (drop && this.game) this.game.spawnBlockDrops(x, y, z, id, meta, tool);
  }

  fall(x, y, z, id) {
    let ty = y - 1;
    while (ty > 0) {
      const b = this.getBlock(x, ty - 1, z);
      if (b !== 0 && !(b > 0 && BLOCKS[b].replaceable)) break;
      ty--;
    }
    const target = this.getBlock(x, ty, z);
    this.setBlock(x, y, z, B.AIR);
    if (target > 0 && BLOCKS[target].render === 2 && this.game) this.game.spawnBlockDrops(x, ty, z, target, 0, null);
    this.setBlock(x, ty, z, id);
  }

  schedule(x, y, z, delay) {
    const key = x + ',' + y + ',' + z;
    const due = this.tickCount + delay;
    const cur = this.scheduled.get(key);
    if (cur === undefined || cur > due) this.scheduled.set(key, due);
  }

  scheduleLeafDecay(x, y, z) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let dx = -4; dx <= 4; dx++) {
          const id = this.getBlock(x + dx, y + dy, z + dz);
          if (id > 0 && BLOCKS[id].leaves && this.getMeta(x + dx, y + dy, z + dz) === 0) {
            this.schedule(x + dx, y + dy, z + dz, 20 + Math.floor(this.rand() * 200));
          }
        }
      }
    }
  }

  // Natural leaves decay if no log is reachable within 4 leaf steps.
  leafTick(x, y, z) {
    const seen = new Set([x + ',' + y + ',' + z]);
    let frontier = [[x, y, z]];
    for (let d = 0; d < 4; d++) {
      const next = [];
      for (const [px, py, pz] of frontier) {
        for (const [dx, dy, dz] of NEIGHBORS) {
          const nx = px + dx; const ny = py + dy; const nz = pz + dz;
          const k = nx + ',' + ny + ',' + nz;
          if (seen.has(k)) continue;
          seen.add(k);
          const id = this.getBlock(nx, ny, nz);
          if (id === B.OAK_LOG || id === B.BIRCH_LOG || id === B.SPRUCE_LOG || id < 0) return;
          if (id > 0 && BLOCKS[id].leaves) next.push([nx, ny, nz]);
        }
      }
      frontier = next;
    }
    this.breakBlock(x, y, z, true);
  }

  // ---------------------------------------------------------------- fluids
  fluidTick(x, y, z) {
    const F = this.getBlock(x, y, z);
    if (!IS_FLUID[F]) return;
    const m = this.getMeta(x, y, z);
    const isSource = m === 0;
    const drop = F === B.WATER ? 1 : 2;
    const other = F === B.WATER ? B.LAVA : B.WATER;

    if (F === B.LAVA) {
      for (const [dx, dy, dz] of NEIGHBORS) {
        if (dy < 0) continue;
        if (this.getBlock(x + dx, y + dy, z + dz) === B.WATER) {
          this.setBlock(x, y, z, isSource ? B.OBSIDIAN : B.COBBLESTONE);
          if (this.game) this.game.sound('fizz', x, y, z);
          return;
        }
      }
    }

    let level = isSource ? 0 : (m & 8 ? 0 : m & 7);
    if (!isSource) {
      let newMeta;
      if (this.getBlock(x, y + 1, z) === F) {
        newMeta = 8;
      } else {
        let minL = 99;
        let sources = 0;
        for (const [dx, , dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
          if (this.getBlock(x + dx, y, z + dz) !== F) continue;
          const nm = this.getMeta(x + dx, y, z + dz);
          if (nm === 0) sources++;
          const l = nm === 0 || (nm & 8) ? 0 : nm & 7;
          minL = Math.min(minL, l);
        }
        const below = this.getBlock(x, y - 1, z);
        if (F === B.WATER && sources >= 2 && (IS_SOLID[Math.max(0, below)] || (below === F && this.getMeta(x, y - 1, z) === 0))) newMeta = 0;
        else if (minL + drop > 7) newMeta = -1;
        else newMeta = minL + drop;
      }
      if (newMeta === -1) {
        this.setBlock(x, y, z, B.AIR);
        return;
      }
      if (newMeta !== m) {
        this.setBlock(x, y, z, F, { meta: newMeta });
        return; // re-scheduled by setBlock
      }
      level = newMeta & 8 ? 0 : newMeta & 7;
    }

    // Flow down.
    const below = this.getBlock(x, y - 1, z);
    let belowHole = false;
    if (below >= 0) {
      if (below === F) {
        belowHole = true;
        const bm = this.getMeta(x, y - 1, z);
        if (bm !== 0 && !(bm & 8)) this.setBlock(x, y - 1, z, F, { meta: 8 });
      } else if (below === other) {
        belowHole = true;
        if (F === B.LAVA) this.setBlock(x, y - 1, z, B.STONE);
        else this.setBlock(x, y - 1, z, this.getMeta(x, y - 1, z) === 0 ? B.OBSIDIAN : B.COBBLESTONE);
      } else if (below === 0 || BLOCKS[below].replaceable || (BLOCKS[below].render === 2) || below === B.TORCH) {
        belowHole = true;
        if (below !== 0 && this.game) this.game.spawnBlockDrops(x, y - 1, z, below, 0, null);
        this.setBlock(x, y - 1, z, F, { meta: 8 });
      }
    }

    // Spread sideways.
    if (isSource || !belowHole) {
      const nl = level + drop;
      if (nl > 7) return;
      for (const [dx, , dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        const n = this.getBlock(nx, y, nz);
        if (n < 0) continue;
        if (n === F) {
          const nm = this.getMeta(nx, y, nz);
          if (nm !== 0 && !(nm & 8) && (nm & 7) > nl) this.setBlock(nx, y, nz, F, { meta: nl });
        } else if (n === other) {
          if (F === B.WATER) this.setBlock(nx, y, nz, this.getMeta(nx, y, nz) === 0 ? B.OBSIDIAN : B.COBBLESTONE);
        } else if (n === 0 || BLOCKS[n].render === 2 || n === B.TORCH) {
          if (n !== 0 && this.game) this.game.spawnBlockDrops(nx, y, nz, n, this.getMeta(nx, y, nz), null);
          this.setBlock(nx, y, nz, F, { meta: nl });
        }
      }
    }
  }

  // ---------------------------------------------------------------- ticking
  tick(playerX, playerZ) {
    this.tickCount++;
    // Scheduled block ticks.
    if (this.scheduled.size) {
      const due = [];
      for (const [k, t] of this.scheduled) {
        if (t <= this.tickCount) due.push(k);
        if (due.length > 400) break;
      }
      for (const k of due) {
        this.scheduled.delete(k);
        const [x, y, z] = k.split(',').map(Number);
        const id = this.getBlock(x, y, z);
        if (id < 0) continue;
        if (IS_FLUID[id]) this.fluidTick(x, y, z);
        else if (id > 0 && BLOCKS[id].leaves && this.getMeta(x, y, z) === 0) this.leafTick(x, y, z);
      }
    }
    this.randomTicks(playerX, playerZ);
    this.tickFurnaces();
  }

  randomTicks(px, pz) {
    const pcx = Math.floor(px / 16);
    const pcz = Math.floor(pz / 16);
    const R = 4;
    const r = this.rand;
    for (let cz = pcz - R; cz <= pcz + R; cz++) {
      for (let cx = pcx - R; cx <= pcx + R; cx++) {
        const c = this.getChunk(cx, cz);
        if (!c || c.state !== 'ready') continue;
        for (let n = 0; n < 24; n++) {
          const lx = (r() * 16) | 0;
          const lz = (r() * 16) | 0;
          const y = (r() * H) | 0;
          const id = c.blocks[blockIndex(lx, y, lz)];
          if (id === 0 || id === B.STONE) continue;
          this.randomTick(cx * 16 + lx, y, cz * 16 + lz, id);
        }
      }
    }
  }

  randomTick(x, y, z, id) {
    const r = this.rand;
    switch (id) {
      case B.GRASS:
      case B.SNOWY_GRASS: {
        const above = this.getBlock(x, y + 1, z);
        if (above > 0 && (IS_OPAQUE[above] || IS_FLUID[above])) {
          this.setBlock(x, y, z, B.DIRT);
          return;
        }
        if (this.getLight(x, y + 1, z) >= 9) {
          const tx = x + ((r() * 3) | 0) - 1;
          const ty = y + ((r() * 5) | 0) - 3;
          const tz = z + ((r() * 3) | 0) - 1;
          if (this.getBlock(tx, ty, tz) === B.DIRT) {
            const ab = this.getBlock(tx, ty + 1, tz);
            if (ab >= 0 && !IS_OPAQUE[ab] && !IS_FLUID[ab] && this.getLight(tx, ty + 1, tz) >= 4) {
              this.setBlock(tx, ty, tz, B.GRASS);
            }
          }
        }
        break;
      }
      case B.OAK_SAPLING:
      case B.BIRCH_SAPLING:
      case B.SPRUCE_SAPLING:
        if (this.getLight(x, y + 1, z) >= 9 && r() < 0.15) this.growTree(x, y, z, BLOCKS[id].sapling);
        break;
      case B.WHEAT: {
        const m = this.getMeta(x, y, z);
        if (m < 7 && this.getLight(x, y + 1, z) >= 9) {
          const wet = this.getMeta(x, y - 1, z) & 1;
          if (r() < (wet ? 0.33 : 0.15)) this.setMeta(x, y, z, m + 1);
        }
        break;
      }
      case B.FARMLAND: {
        let wet = 0;
        for (let dz = -4; dz <= 4 && !wet; dz++) for (let dx = -4; dx <= 4 && !wet; dx++) for (let dy = 0; dy <= 1; dy++) {
          if (this.getBlock(x + dx, y + dy, z + dz) === B.WATER) { wet = 1; break; }
        }
        const m = this.getMeta(x, y, z);
        if (wet !== (m & 1)) this.setMeta(x, y, z, wet);
        else if (!wet && this.getBlock(x, y + 1, z) !== B.WHEAT && r() < 0.1) this.setBlock(x, y, z, B.DIRT);
        break;
      }
      case B.SUGAR_CANE:
        if (this.getBlock(x, y + 1, z) === 0 && r() < 0.06) {
          let h = 1;
          while (this.getBlock(x, y - h, z) === B.SUGAR_CANE) h++;
          if (h < 3) this.setBlock(x, y + 1, z, B.SUGAR_CANE);
        }
        break;
      case B.CACTUS:
        if (this.getBlock(x, y + 1, z) === 0 && r() < 0.06) {
          let h = 1;
          while (this.getBlock(x, y - h, z) === B.CACTUS) h++;
          if (h < 3 && this.hasSupport(x, y + 1, z, 'cactus')) this.setBlock(x, y + 1, z, B.CACTUS);
        }
        break;
      default:
    }
  }

  growTree(x, y, z, type) {
    const rand = this.rand;
    const height = treeHeight(type, rand);
    for (let dy = 1; dy <= height + 1; dy++) {
      const id = this.getBlock(x, y + dy, z);
      if (id !== 0 && !(id > 0 && BLOCKS[id].leaves)) return false;
    }
    this.setBlock(x, y, z, B.AIR, { update: false });
    const set = (bx, by, bz, id, overwrite) => {
      const cur = this.getBlock(bx, by, bz);
      if (cur < 0) return;
      if (overwrite || cur === 0 || (cur > 0 && BLOCKS[cur].replaceable && !IS_FLUID[cur])) this.setBlock(bx, by, bz, id, { update: false });
    };
    placeTree(set, type, x, y, z, rand, height);
    const below = this.getBlock(x, y - 1, z);
    if (below === B.GRASS || below === B.SNOWY_GRASS || below === B.FARMLAND) this.setBlock(x, y - 1, z, B.DIRT, { update: false });
    return true;
  }

  tickFurnaces() {
    for (const [key, t] of this.tiles) {
      if (t.type !== 'furnace') continue;
      const [x, y, z] = key.split(',').map(Number);
      if (!this.isLoaded(x, z)) continue;
      const [input, fuel, out] = t.items;
      const result = input ? SMELTING[input.id] : undefined;
      const canSmelt = result !== undefined && (!out || (out.id === result && out.count < maxStack(result)));
      const wasBurning = t.burn > 0;
      if (t.burn > 0) t.burn--;
      if (t.burn === 0 && canSmelt && fuel && FUEL[fuel.id]) {
        t.burn = t.burnMax = FUEL[fuel.id];
        if (fuel.id === I.LAVA_BUCKET) t.items[1] = { id: I.BUCKET, count: 1, damage: 0 };
        else if (--fuel.count <= 0) t.items[1] = null;
      }
      if (t.burn > 0 && canSmelt) {
        t.cook++;
        if (t.cook >= SMELT_TIME) {
          t.cook = 0;
          t.xp = (t.xp || 0) + (SMELT_XP[result] || 0);
          if (out) out.count++;
          else t.items[2] = { id: result, count: 1, damage: 0 };
          if (--input.count <= 0) t.items[0] = null;
        }
      } else if (t.cook > 0) {
        t.cook = Math.max(0, t.cook - 2);
      }
      const burning = t.burn > 0;
      if (burning !== wasBurning) {
        const meta = this.getMeta(x, y, z);
        this.setBlock(x, y, z, burning ? B.LIT_FURNACE : B.FURNACE, { meta, keepTile: true, update: false });
      }
    }
  }

  // Explosion (creepers). Destroys blocks, returns nothing; entity damage is handled by the game.
  explode(cx, cy, cz, power) {
    const r = Math.ceil(power + 1);
    const rand = this.rand;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const z0 = Math.floor(cz);
    const toBreak = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > power * (0.7 + rand() * 0.6)) continue;
          const id = this.getBlock(x0 + dx, y0 + dy, z0 + dz);
          if (id <= 0 || id === B.BEDROCK || id === B.OBSIDIAN || IS_FLUID[id]) continue;
          toBreak.push([x0 + dx, y0 + dy, z0 + dz, id]);
        }
      }
    }
    for (const [x, y, z, id] of toBreak) {
      const meta = this.getMeta(x, y, z);
      this.setBlock(x, y, z, B.AIR);
      if (this.game && rand() < 1 / power) this.game.spawnBlockDrops(x, y, z, id, meta, null);
    }
  }

  // ---------------------------------------------------------------- streaming
  update(px, pz) {
    const pcx = Math.floor(px / 16);
    const pcz = Math.floor(pz / 16);
    const R = this.renderDistance;
    const moved = pcx !== this.centerCx || pcz !== this.centerCz || this.chunks.size === 0 || this.lastR !== R;
    this.centerCx = pcx;
    this.centerCz = pcz;
    this.lastR = R;
    if (moved) {
      // Request missing chunks (data radius R+1 so that the edge meshes have neighbours).
      for (let dz = -R - 1; dz <= R + 1; dz++) {
        for (let dx = -R - 1; dx <= R + 1; dx++) {
          const cx = pcx + dx;
          const cz = pcz + dz;
          const key = chunkKey(cx, cz);
          if (!this.chunks.has(key)) {
            const c = new Chunk(cx, cz);
            this.chunks.set(key, c);
            if (this.savedKeys.has(key)) this.loadSaved(c);
            else this.genQueue.add(key);
          }
        }
      }
      // Unload far chunks.
      const unloadR = R + 3;
      const toSave = [];
      for (const [key, c] of this.chunks) {
        if (Math.abs(c.cx - pcx) > unloadR || Math.abs(c.cz - pcz) > unloadR) {
          if (c.state === 'ready') {
            const rec = this.chunkRecord(c, true);
            if (rec) toSave.push(rec);
          }
          this.disposeMeshes(c);
          this.chunks.delete(key);
          this.genQueue.delete(key);
          this.meshUrgent.delete(key);
          this.meshNormal.delete(key);
        } else if (c.hasMesh && (Math.abs(c.cx - pcx) > R || Math.abs(c.cz - pcz) > R)) {
          this.disposeMeshes(c);
          c.meshedVersion = -1;
        }
      }
      if (toSave.length) this.storage.putChunks(this.worldId, toSave).catch((e) => console.error(e));
      // Queue meshes for ready chunks that need one.
      for (const c of this.chunks.values()) {
        if (c.state === 'ready' && !c.hasMesh && this.inMeshRange(c)) this.meshNormal.add(c.key);
      }
    }
    this.pump();
  }

  inMeshRange(c) {
    return Math.abs(c.cx - this.centerCx) <= this.renderDistance && Math.abs(c.cz - this.centerCz) <= this.renderDistance;
  }

  neighborsReady(c) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(c.cx + dx, c.cz + dz);
        if (!n || n.state !== 'ready') return false;
      }
    }
    return true;
  }

  pump() {
    if (!this.pool) return;
    for (;;) {
      const w = this.pool.freeWorker();
      if (!w) return;
      const job = this.nextJob();
      if (!job) return;
      if (job.type === 'generate') {
        this.pool.post(w, { type: 'generate', id: ++this.jobId, cx: job.c.cx, cz: job.c.cz });
      } else {
        const c = job.c;
        const chunks = [];
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const n = this.getChunk(c.cx + dx, c.cz + dz);
            chunks.push({ blocks: n.blocks, meta: n.meta });
          }
        }
        this.pool.post(w, { type: 'mesh', id: ++this.jobId, cx: c.cx, cz: c.cz, version: c.version, chunks });
      }
    }
  }

  nextJob() {
    for (const key of this.meshUrgent) {
      this.meshUrgent.delete(key);
      const c = this.chunks.get(key);
      if (c && c.state === 'ready' && this.inMeshRange(c) && this.neighborsReady(c)) return { type: 'mesh', c };
    }
    let best = null;
    let bestD = Infinity;
    for (const key of this.meshNormal) {
      const c = this.chunks.get(key);
      if (!c || c.state !== 'ready' || !this.inMeshRange(c)) { this.meshNormal.delete(key); continue; }
      if (!this.neighborsReady(c)) continue;
      const d = Math.hypot(c.cx - this.centerCx, c.cz - this.centerCz) - 0.5;
      if (d < bestD) { bestD = d; best = { type: 'mesh', c }; }
    }
    for (const key of this.genQueue) {
      const c = this.chunks.get(key);
      if (!c) { this.genQueue.delete(key); continue; }
      const d = Math.hypot(c.cx - this.centerCx, c.cz - this.centerCz);
      if (d < bestD) { bestD = d; best = { type: 'generate', c }; }
    }
    if (best) {
      if (best.type === 'mesh') this.meshNormal.delete(best.c.key);
      else this.genQueue.delete(best.c.key);
    }
    return best;
  }

  async loadSaved(c) {
    try {
      const rec = await this.storage.getChunk(this.worldId, c.key);
      if (this.chunks.get(c.key) !== c) return;
      if (!rec) { this.genQueue.add(c.key); return; }
      c.blocks = rec.blocks;
      c.meta = rec.meta || new Uint8Array(CHUNK_VOLUME);
      c.modified = false;
      for (const t of rec.tiles || []) {
        const { x, y, z, ...data } = t;
        this.tiles.set(x + ',' + y + ',' + z, data);
      }
      c.pendingEntities = rec.entities || [];
      c.hadExtras = (rec.tiles && rec.tiles.length > 0) || c.pendingEntities.length > 0;
      this.chunkReady(c, false);
    } catch (e) {
      console.error('Failed to load chunk', c.key, e);
      this.genQueue.add(c.key);
    }
  }

  // Serialises a chunk for saving; returns null when there is nothing worth saving.
  chunkRecord(c, unload) {
    const tiles = [];
    const x0 = c.cx * 16;
    const z0 = c.cz * 16;
    for (const [key, t] of this.tiles) {
      const [x, y, z] = key.split(',').map(Number);
      if (x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16) tiles.push({ x, y, z, ...t });
    }
    const entities = this.game ? this.game.entitiesInChunk(c.cx, c.cz, unload) : [];
    if (unload) for (const t of tiles) this.tiles.delete(t.x + ',' + t.y + ',' + t.z);
    // Chunks that once held tiles/entities must be rewritten so stale copies are not restored.
    if (!c.modified && tiles.length === 0 && entities.length === 0 && !c.hadExtras) return null;
    c.hadExtras = tiles.length > 0 || entities.length > 0;
    this.savedKeys.add(c.key);
    c.modified = false;
    return { key: c.key, blocks: c.blocks, meta: c.meta, tiles, entities };
  }

  // Records for all loaded chunks that need saving (without unloading them).
  dirtyRecords() {
    const out = [];
    for (const c of this.chunks.values()) {
      if (c.state !== 'ready') continue;
      const rec = this.chunkRecord(c, false);
      if (rec) out.push({ ...rec, blocks: rec.blocks.slice(), meta: rec.meta.slice(), tiles: JSON.parse(JSON.stringify(rec.tiles)) });
    }
    return out;
  }

  chunkReady(c, fresh) {
    c.state = 'ready';
    if (fresh && this.game) this.game.onChunkGenerated(c);
    if (c.pendingEntities && this.game) {
      this.game.restoreEntities(c.pendingEntities);
      c.pendingEntities = null;
    }
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(c.cx + dx, c.cz + dz);
        if (n && n.state === 'ready' && !n.hasMesh && this.inMeshRange(n)) this.meshNormal.add(n.key);
      }
    }
  }

  onWorkerMessage(msg) {
    const c = this.chunks.get(chunkKey(msg.cx, msg.cz));
    if (msg.type === 'generated') {
      this.stats.generated++;
      if (c && c.state === 'loading') {
        c.blocks = msg.blocks;
        c.meta = msg.meta;
        this.chunkReady(c, true);
      }
    } else if (msg.type === 'meshed') {
      this.stats.meshed++;
      if (c && c.state === 'ready' && msg.version >= c.meshedVersion && this.inMeshRange(c)) {
        this.applyMesh(c, msg);
      }
    }
    this.pump();
  }

  applyMesh(c, msg) {
    this.disposeMeshes(c);
    c.skyLight = msg.skyLight;
    c.blockLight = msg.blockLight;
    c.meshedVersion = msg.version;
    const layers = [['solid', this.materials.solid], ['cutout', this.materials.cutout], ['translucent', this.materials.translucent]];
    for (const [k, mat] of layers) {
      const g = msg[k];
      if (g.indices.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
      geo.setAttribute('aLight', new THREE.BufferAttribute(g.light, 4, true));
      geo.setAttribute('aTint', new THREE.BufferAttribute(g.tint, 4, true));
      geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c.cx * 16, 0, c.cz * 16);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (k === 'translucent') mesh.renderOrder = 1;
      else mesh.layers.enable(1); // casts sun shadows
      this.scene.add(mesh);
      c.meshes.push(mesh);
    }
    c.hasMesh = true;
  }

  disposeMeshes(c) {
    for (const m of c.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    c.meshes = [];
    c.hasMesh = false;
  }

  // Are all chunks within `r` chunks of (x, z) meshed?
  areaReady(x, z, r) {
    const pcx = Math.floor(x / 16);
    const pcz = Math.floor(z / 16);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = this.getChunk(pcx + dx, pcz + dz);
        if (!c || !c.hasMesh) return false;
      }
    }
    return true;
  }

  loadingProgress(x, z, r) {
    const pcx = Math.floor(x / 16);
    const pcz = Math.floor(z / 16);
    let done = 0;
    let total = 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        total++;
        const c = this.getChunk(pcx + dx, pcz + dz);
        if (c && c.hasMesh) done++;
      }
    }
    return done / total;
  }

  // Top-most non-air block at (x, z), or -1.
  topY(x, z) {
    for (let y = H - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id > 0) return y;
      if (id < 0) return -1;
    }
    return -1;
  }
}

export function newFurnace() {
  return { type: 'furnace', items: [null, null, null], burn: 0, burnMax: 0, cook: 0 };
}

export { CHUNK_SIZE };

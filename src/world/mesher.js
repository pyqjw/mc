// Light propagation and chunk mesh generation. Runs inside web workers (also usable from node for tests).
//
// To mesh chunk (cx, cz) we copy it and its 8 neighbours into a 48x48 region so that light (which travels
// at most 15 blocks) can be computed correctly for the centre chunk, then emit geometry for the centre only.
import { CHUNK_SIZE, WORLD_HEIGHT, CHUNK_VOLUME, blockIndex } from '../constants.js';
import {
  IS_OPAQUE, LIGHT_ATTEN, LIGHT_EMIT, RENDER_TYPE, RENDER_LAYER, CULL_SELF, IS_FLUID,
  TEX_TOP, TEX_BOTTOM, TEX_SIDE, TEX_FRONT, IS_ORIENTABLE, RENDER, LAYER, ATLAS_TILES_PER_ROW, TILE_INDEX, B,
  fluidHeight, BLOCKS,
} from './blocks.js';

const H = WORLD_HEIGHT;
const PAD = 16;
const RS = CHUNK_SIZE + PAD * 2; // 48
const RA = RS * RS;
const RN = RA * H;

const rBlocks = new Uint8Array(RN);
const rMeta = new Uint8Array(RN);
const sky = new Uint8Array(RN);
const blk = new Uint8Array(RN);
const tops = new Int16Array(RA);
const QUEUE_SIZE = 1 << 21;
const QUEUE_MASK = QUEUE_SIZE - 1;
const queue = new Int32Array(QUEUE_SIZE);

// Block heights for partial blocks (beds, farmland).
const BLOCK_HEIGHT = new Float32Array(256).fill(1);
for (const b of BLOCKS) if (b) BLOCK_HEIGHT[b.id] = b.height;

function ri(x, y, z) {
  return x + z * RS + y * RA;
}

function copyRegion(chunks) {
  rBlocks.fill(0);
  rMeta.fill(0);
  for (let dz = 0; dz < 3; dz++) {
    for (let dx = 0; dx < 3; dx++) {
      const c = chunks[dz * 3 + dx];
      if (!c) continue;
      const ox = dx * 16;
      const oz = dz * 16;
      const { blocks, meta } = c;
      for (let y = 0; y < H; y++) {
        for (let z = 0; z < 16; z++) {
          const s = z * 16 + y * 256;
          const d = ri(ox, y, oz + z);
          rBlocks.set(blocks.subarray(s, s + 16), d);
          if (meta) rMeta.set(meta.subarray(s, s + 16), d);
        }
      }
    }
  }
}

function propagate(light, head, tail) {
  while (head !== tail) {
    const i = queue[head];
    head = (head + 1) & QUEUE_MASK;
    const L = light[i];
    if (L <= 1) continue;
    const x = i % RS;
    const z = ((i / RS) | 0) % RS;
    const y = (i / RA) | 0;
    // 6 neighbours
    for (let d = 0; d < 6; d++) {
      let j;
      switch (d) {
        case 0: if (x === RS - 1) continue; j = i + 1; break;
        case 1: if (x === 0) continue; j = i - 1; break;
        case 2: if (z === RS - 1) continue; j = i + RS; break;
        case 3: if (z === 0) continue; j = i - RS; break;
        case 4: if (y === H - 1) continue; j = i + RA; break;
        default: if (y === 0) continue; j = i - RA; break;
      }
      const a = LIGHT_ATTEN[rBlocks[j]];
      if (a >= 15) continue;
      const nl = L - 1 - a;
      if (nl > light[j]) {
        light[j] = nl;
        queue[tail] = j;
        tail = (tail + 1) & QUEUE_MASK;
      }
    }
  }
}

function computeLight() {
  sky.fill(0);
  blk.fill(0);
  // Direct skylight straight down each column.
  for (let z = 0; z < RS; z++) {
    for (let x = 0; x < RS; x++) {
      let L = 15;
      let top = -1;
      for (let y = H - 1; y >= 0; y--) {
        const i = ri(x, y, z);
        const id = rBlocks[i];
        if (id !== 0 && top < 0) top = y;
        const a = LIGHT_ATTEN[id];
        if (a >= 15) L = 0;
        else if (a > 0) L = Math.max(0, L - a);
        sky[i] = L;
      }
      tops[x + z * RS] = top;
    }
  }
  // Seed horizontal spreading only where a neighbouring column is taller.
  let tail = 0;
  for (let z = 0; z < RS; z++) {
    for (let x = 0; x < RS; x++) {
      let maxN = tops[x + z * RS];
      if (x > 0) maxN = Math.max(maxN, tops[x - 1 + z * RS]);
      if (x < RS - 1) maxN = Math.max(maxN, tops[x + 1 + z * RS]);
      if (z > 0) maxN = Math.max(maxN, tops[x + (z - 1) * RS]);
      if (z < RS - 1) maxN = Math.max(maxN, tops[x + (z + 1) * RS]);
      maxN = Math.min(H - 1, maxN + 1);
      for (let y = 0; y <= maxN; y++) {
        const i = ri(x, y, z);
        if (sky[i] > 1) {
          queue[tail] = i;
          tail = (tail + 1) & QUEUE_MASK;
        }
      }
    }
  }
  propagate(sky, 0, tail);

  tail = 0;
  for (let i = 0; i < RN; i++) {
    const e = LIGHT_EMIT[rBlocks[i]];
    if (e > 0) {
      blk[i] = e;
      queue[tail] = i;
      tail = (tail + 1) & QUEUE_MASK;
    }
  }
  propagate(blk, 0, tail);
}

class GeometryBuilder {
  constructor() {
    this.cap = 16384;
    this.pos = new Float32Array(this.cap * 3);
    this.uv = new Float32Array(this.cap * 2);
    this.light = new Uint8Array(this.cap * 4);
    this.idx = new Uint32Array(this.cap * 1.5);
    this.vc = 0;
    this.ic = 0;
  }

  reset() {
    this.vc = 0;
    this.ic = 0;
  }

  ensure(n) {
    if (this.vc + n <= this.cap) return;
    let cap = this.cap;
    while (this.vc + n > cap) cap *= 2;
    const grow = (arr, per, T) => {
      const a = new T(cap * per);
      a.set(arr);
      return a;
    };
    this.pos = grow(this.pos, 3, Float32Array);
    this.uv = grow(this.uv, 2, Float32Array);
    this.light = grow(this.light, 4, Uint8Array);
    this.idx = grow(this.idx, 1.5, Uint32Array);
    this.cap = cap;
  }

  vertex(x, y, z, u, v, s, b, shade) {
    const n = this.vc++;
    this.pos[n * 3] = x;
    this.pos[n * 3 + 1] = y;
    this.pos[n * 3 + 2] = z;
    this.uv[n * 2] = u;
    this.uv[n * 2 + 1] = v;
    this.light[n * 4] = s;
    this.light[n * 4 + 1] = b;
    this.light[n * 4 + 2] = shade;
    this.light[n * 4 + 3] = 255;
  }

  quad(flip) {
    const b = this.vc - 4;
    const idx = this.idx;
    let k = this.ic;
    if (flip) {
      idx[k++] = b + 1; idx[k++] = b + 2; idx[k++] = b + 3;
      idx[k++] = b + 1; idx[k++] = b + 3; idx[k++] = b;
    } else {
      idx[k++] = b; idx[k++] = b + 1; idx[k++] = b + 2;
      idx[k++] = b; idx[k++] = b + 2; idx[k++] = b + 3;
    }
    this.ic = k;
  }

  output() {
    return {
      positions: this.pos.slice(0, this.vc * 3),
      uvs: this.uv.slice(0, this.vc * 2),
      light: this.light.slice(0, this.vc * 4),
      indices: this.idx.slice(0, this.ic),
    };
  }
}

const builders = [new GeometryBuilder(), new GeometryBuilder(), new GeometryBuilder()];

// Face table: normal, 4 corners (CCW from outside), uv per corner, directional shade.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.6, dir: 1 }, // +x east
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6, dir: 3 }, // -x west
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, dir: -1 }, // +y top
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, dir: -2 }, // -y bottom
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8, dir: 2 }, // +z south
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8, dir: 0 }, // -z north
];
const FACE_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO_CURVE = [0.45, 0.65, 0.82, 1.0];

const TILE = 1 / ATLAS_TILES_PER_ROW;
const EPS = 1 / 4096;

function tileUV(tile, fu, fv) {
  const tx = tile % ATLAS_TILES_PER_ROW;
  const ty = Math.floor(tile / ATLAS_TILES_PER_ROW);
  const u0 = tx * TILE + EPS;
  const v0 = 1 - (ty + 1) * TILE + EPS;
  const size = TILE - 2 * EPS;
  return [u0 + fu * size, v0 + fv * size];
}

function isOpaqueAt(x, y, z) {
  if (y < 0) return 1;
  if (y >= H) return 0;
  return IS_OPAQUE[rBlocks[ri(x, y, z)]];
}

function faceTile(id, face, meta) {
  if (face.dir === -1) return TEX_TOP[id];
  if (face.dir === -2) return TEX_BOTTOM[id];
  if (IS_ORIENTABLE[id] && (meta & 3) === face.dir) return TEX_FRONT[id];
  return TEX_SIDE[id];
}

const WHEAT_TILE = TILE_INDEX.wheat_0;
const FARMLAND_WET = TILE_INDEX.farmland_wet;

function emitCube(g, id, meta, x, y, z, lx, lz, height) {
  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    const [nx, ny, nz] = face.n;
    const fx = x + nx;
    const fy = y + ny;
    const fz = z + nz;
    let nid;
    if (fy < 0) continue;
    else if (fy >= H) nid = 0;
    else nid = rBlocks[ri(fx, fy, fz)];
    if (!(height < 1 && f === 2)) {
      if (IS_OPAQUE[nid]) continue;
      if (nid === id && CULL_SELF[id]) continue;
    }
    let tile = faceTile(id, face, meta);
    if (id === B.FARMLAND && f === 2 && (meta & 1)) tile = FARMLAND_WET;

    // Light samples: face cell plus its 8 neighbours in the face plane.
    const fi = fy < H ? ri(fx, Math.max(0, fy), fz) : -1;
    const fSky = fi < 0 ? 15 : sky[fi];
    const fBlk = fi < 0 ? 0 : blk[fi];
    const aos = [0, 0, 0, 0];
    g.ensure(4);
    for (let v = 0; v < 4; v++) {
      const c = face.c[v];
      // tangent offsets
      const tx = nx !== 0 ? 0 : (c[0] ? 1 : -1);
      const ty = ny !== 0 ? 0 : (c[1] ? 1 : -1);
      const tz = nz !== 0 ? 0 : (c[2] ? 1 : -1);
      // two side cells: split tangent into its two axes
      let s1x = fx; let s1y = fy; let s1z = fz;
      let s2x = fx; let s2y = fy; let s2z = fz;
      if (nx !== 0) { s1y += ty; s2z += tz; } else if (ny !== 0) { s1x += tx; s2z += tz; } else { s1x += tx; s2y += ty; }
      const cx = fx + tx;
      const cy = fy + ty;
      const cz = fz + tz;
      const o1 = isOpaqueAt(s1x, s1y, s1z);
      const o2 = isOpaqueAt(s2x, s2y, s2z);
      const oc = isOpaqueAt(cx, cy, cz);
      const ao = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
      aos[v] = ao;
      let ss = fSky;
      let sb = fBlk;
      let n = 1;
      if (!o1) {
        if (s1y >= H) { ss += 15; } else { const i1 = ri(s1x, s1y, s1z); ss += sky[i1]; sb += blk[i1]; }
        n++;
      }
      if (!o2) {
        if (s2y >= H) { ss += 15; } else { const i2 = ri(s2x, s2y, s2z); ss += sky[i2]; sb += blk[i2]; }
        n++;
      }
      if (!oc && !(o1 && o2)) {
        if (cy >= H) { ss += 15; } else { const i3 = ri(cx, cy, cz); ss += sky[i3]; sb += blk[i3]; }
        n++;
      }
      let py = c[1];
      let fv = FACE_UV[v][1];
      if (height < 1) {
        py = c[1] * height;
        if (f !== 2 && f !== 3) fv = FACE_UV[v][1] * height;
      }
      const [u, vv] = tileUV(tile, FACE_UV[v][0], fv);
      g.vertex(lx + c[0], y + py, lz + c[2], u, vv,
        Math.round((ss / n) * 17), Math.round((sb / n) * 17), Math.round(face.shade * AO_CURVE[ao] * 255));
    }
    g.quad(aos[0] + aos[2] < aos[1] + aos[3]);
  }
}

function emitLiquid(g, id, meta, x, y, z, lx, lz) {
  const above = y + 1 < H ? rBlocks[ri(x, y + 1, z)] : 0;
  const h = fluidHeight(meta, IS_FLUID[above] && above === id);
  const tile = TEX_SIDE[id];
  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    const [nx, ny, nz] = face.n;
    const fx = x + nx;
    const fy = y + ny;
    const fz = z + nz;
    if (fy < 0) continue;
    const nid = fy >= H ? 0 : rBlocks[ri(fx, fy, fz)];
    if (nid === id) continue;
    if (IS_OPAQUE[nid] && !(f === 2 && h < 1)) continue;
    const fi = fy >= H ? -1 : ri(fx, fy, fz);
    const own = ri(x, y, z);
    const s = Math.max(fi < 0 ? 15 : sky[fi], sky[own]);
    const b = Math.max(fi < 0 ? 0 : blk[fi], blk[own]);
    g.ensure(4);
    for (let v = 0; v < 4; v++) {
      const c = face.c[v];
      const py = c[1] * h;
      const fv = f === 2 || f === 3 ? FACE_UV[v][1] : FACE_UV[v][1] * h;
      const [u, vv] = tileUV(tile, FACE_UV[v][0], fv);
      g.vertex(lx + c[0], y + py, lz + c[2], u, vv, s * 17, b * 17, Math.round(face.shade * 255));
    }
    g.quad(false);
  }
}

function emitCross(g, id, meta, x, y, z, lx, lz) {
  const i = ri(x, y, z);
  const s = sky[i] * 17;
  const b = blk[i] * 17;
  let tile = TEX_SIDE[id];
  if (id === B.WHEAT) tile = WHEAT_TILE + Math.min(3, meta >> 1);
  const quads = [
    [[0.15, 0, 0.15], [0.85, 0, 0.85], [0.85, 1, 0.85], [0.15, 1, 0.15]],
    [[0.15, 0, 0.85], [0.85, 0, 0.15], [0.85, 1, 0.15], [0.15, 1, 0.85]],
  ];
  const yOff = BLOCK_HEIGHT[y > 0 ? rBlocks[ri(x, y - 1, z)] : 0] < 1 ? BLOCK_HEIGHT[rBlocks[ri(x, y - 1, z)]] - 1 : 0;
  for (const q of quads) {
    g.ensure(4);
    for (let v = 0; v < 4; v++) {
      const c = q[v];
      const [u, vv] = tileUV(tile, FACE_UV[v][0], FACE_UV[v][1]);
      g.vertex(lx + c[0], y + c[1] + yOff, lz + c[2], u, vv, s, b, 230);
    }
    g.quad(false);
  }
}

function emitTorch(g, id, x, y, z, lx, lz) {
  const i = ri(x, y, z);
  const s = sky[i] * 17;
  const b = blk[i] * 17;
  const tile = TEX_SIDE[id];
  const x0 = 7 / 16;
  const x1 = 9 / 16;
  const top = 10 / 16;
  for (let f = 0; f < 6; f++) {
    if (f === 3) continue;
    const face = FACES[f];
    g.ensure(4);
    for (let v = 0; v < 4; v++) {
      const c = face.c[v];
      const px = c[0] ? x1 : x0;
      const pz = c[2] ? x1 : x0;
      const py = c[1] ? top : 0;
      let fu;
      let fv;
      if (f === 2) {
        fu = c[0] ? x1 : x0;
        fv = c[2] ? 8 / 16 : 10 / 16;
      } else {
        fu = FACE_UV[v][0] ? x1 : x0;
        fv = FACE_UV[v][1] ? top : 0;
      }
      const [u, vv] = tileUV(tile, fu, fv);
      g.vertex(lx + px, y + py, lz + pz, u, vv, s, b, Math.round(face.shade * 255));
    }
    g.quad(false);
  }
}

// chunks: array of 9 {blocks, meta} (or null), index = (dz + 1) * 3 + (dx + 1).
export function buildChunkMesh(chunks) {
  copyRegion(chunks);
  computeLight();
  for (const g of builders) g.reset();

  for (let y = 0; y < H; y++) {
    for (let z = PAD; z < PAD + 16; z++) {
      for (let x = PAD; x < PAD + 16; x++) {
        const i = ri(x, y, z);
        const id = rBlocks[i];
        if (id === 0) continue;
        const rt = RENDER_TYPE[id];
        const g = builders[RENDER_LAYER[id]];
        const lx = x - PAD;
        const lz = z - PAD;
        switch (rt) {
          case RENDER.CUBE: emitCube(g, id, rMeta[i], x, y, z, lx, lz, 1); break;
          case RENDER.BED: emitCube(g, id, rMeta[i], x, y, z, lx, lz, BLOCK_HEIGHT[id]); break;
          case RENDER.LIQUID: emitLiquid(g, id, rMeta[i], x, y, z, lx, lz); break;
          case RENDER.CROSS: emitCross(g, id, rMeta[i], x, y, z, lx, lz); break;
          case RENDER.TORCH: emitTorch(g, id, x, y, z, lx, lz); break;
          default: break;
        }
      }
    }
  }

  // Export light of the centre chunk for main thread use (mob lighting, spawning).
  const skyOut = new Uint8Array(CHUNK_VOLUME);
  const blkOut = new Uint8Array(CHUNK_VOLUME);
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < 16; z++) {
      const s = ri(PAD, y, PAD + z);
      const d = blockIndex(0, y, z);
      skyOut.set(sky.subarray(s, s + 16), d);
      blkOut.set(blk.subarray(s, s + 16), d);
    }
  }

  return {
    solid: builders[LAYER.SOLID].output(),
    cutout: builders[LAYER.CUTOUT].output(),
    translucent: builders[LAYER.TRANSLUCENT].output(),
    skyLight: skyOut,
    blockLight: blkOut,
  };
}

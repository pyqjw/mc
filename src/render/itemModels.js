// 3D models for items: cubes for blocks, flat sprites for everything else. Used for the held item and drops.
import * as THREE from 'three';
import { BLOCKS, RENDER, TEX_TOP, TEX_BOTTOM, TEX_SIDE, TEX_FRONT, ATLAS_TILES_PER_ROW } from '../world/blocks.js';
import { shapeBoxes, boxTextures, iconMeta } from '../world/shapes.js';
import { getItemAtlasCanvas, getItemCanvas, getBowCanvas, tileRect } from './textures.js';

let atlasTexture = null;
const geoCache = new Map();
const spriteTexCache = new Map();

function atlasTex() {
  if (!atlasTexture) {
    atlasTexture = new THREE.CanvasTexture(getItemAtlasCanvas());
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.generateMipmaps = false;
  }
  return atlasTexture;
}

export function isCubeItem(id) {
  const b = id < 256 ? BLOCKS[id] : null;
  return !!b && (b.render === RENDER.CUBE || b.render === RENDER.BED || (b.render === RENDER.SHAPE && !b.itemSprite && b.shape !== 'ladder'));
}

// Model of a block made of boxes, centred at the origin (unit size).
function shapeGeometry(id) {
  const meta = iconMeta(id);
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const T = 1 / ATLAS_TILES_PER_ROW;
  const faces = [
    { c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.6 },
    { c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6 },
    { c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
    { c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
    { c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.85 },
    { c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.85 },
  ];
  const fuv = [(x, y, z) => [1 - z, y], (x, y, z) => [z, y], (x, y, z) => [x, 1 - z], (x, y, z) => [x, z], (x, y, z) => [x, y], (x, y, z) => [1 - x, y]];
  shapeBoxes(id, meta, 'render').forEach((box, bi) => {
    const tex = boxTextures(id, meta, bi);
    faces.forEach((f, fi) => {
      const tile = tex.tiles[fi];
      if (tile < 0) return;
      const tx = tile % ATLAS_TILES_PER_ROW;
      const ty = Math.floor(tile / ATLAS_TILES_PER_ROW);
      const base = pos.length / 3;
      for (const c of f.c) {
        const x = c[0] ? box[3] : box[0];
        const y = c[1] ? box[4] : box[1];
        const z = c[2] ? box[5] : box[2];
        pos.push(x - 0.5, y - 0.5, z - 0.5);
        const [u, v] = fuv[fi](x, y, z);
        uv.push((tx + u) * T, 1 - (ty + 1) * T + v * T);
        col.push(f.shade, f.shade, f.shade);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// Unit cube centred at the origin with atlas UVs and baked face shading. Front faces +z.
export function blockGeometry(id) {
  if (geoCache.has(id)) return geoCache.get(id);
  const b = BLOCKS[id];
  if (b.render === RENDER.SHAPE) {
    const g = shapeGeometry(id);
    geoCache.set(id, g);
    return g;
  }
  const h = b.height;
  const faces = [
    { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], tile: TEX_SIDE[id], shade: 0.6 },
    { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], tile: TEX_SIDE[id], shade: 0.6 },
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], tile: TEX_TOP[id], shade: 1 },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], tile: TEX_BOTTOM[id], shade: 0.5 },
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], tile: b.orientable ? TEX_FRONT[id] : TEX_SIDE[id], shade: 0.85 },
    { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], tile: TEX_SIDE[id], shade: 0.85 },
  ];
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const T = 1 / ATLAS_TILES_PER_ROW;
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const f of faces) {
    const base = pos.length / 3;
    const tx = f.tile % ATLAS_TILES_PER_ROW;
    const ty = Math.floor(f.tile / ATLAS_TILES_PER_ROW);
    f.c.forEach((c, i) => {
      pos.push(c[0] - 0.5, c[1] * h - 0.5, c[2] - 0.5);
      const fv = (f.n[1] === 0 ? uvs[i][1] * h : uvs[i][1]);
      uv.push((tx + uvs[i][0]) * T, 1 - (ty + 1) * T + fv * T);
      col.push(f.shade, f.shade, f.shade);
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  geoCache.set(id, g);
  return g;
}

// Texture for a flat item sprite (items, plants, torches).
export function spriteTexture(id) {
  if (spriteTexCache.has(id)) return spriteTexCache.get(id);
  let canvas;
  if (id < 256 && BLOCKS[id].itemSprite) {
    canvas = getItemCanvas(id);
  } else if (id < 256) {
    const src = getItemAtlasCanvas();
    const r = tileRect(TEX_SIDE[id]);
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    canvas.getContext('2d').drawImage(src, r.x, r.y, 16, 16, 0, 0, 16, 16);
  } else {
    canvas = getItemCanvas(id);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  spriteTexCache.set(id, t);
  return t;
}

// A sprite turned into a 3D item model one pixel thick, like Minecraft's item models: a front and a
// back quad plus a side quad for every pixel edge that borders transparency. Centred, 1 unit wide.
const extrudedCache = new Map();
export function extrudedGeometry(id) {
  return extrudedFromCanvas(spriteTexture(id).image, id);
}

function extrudedFromCanvas(canvas, key) {
  if (extrudedCache.has(key)) return extrudedCache.get(key);
  const data = canvas.getContext('2d').getImageData(0, 0, 16, 16).data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && data[(y * 16 + x) * 4 + 3] > 127;
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const h = 1 / 32;
  const quad = (corners, uvs, shade) => {
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(...corners[i]);
      uv.push(...uvs[i]);
      col.push(shade, shade, shade);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad([[-0.5, -0.5, h], [0.5, -0.5, h], [0.5, 0.5, h], [-0.5, 0.5, h]], [[0, 0], [1, 0], [1, 1], [0, 1]], 1);
  quad([[0.5, -0.5, -h], [-0.5, -0.5, -h], [-0.5, 0.5, -h], [0.5, 0.5, -h]], [[1, 0], [0, 0], [0, 1], [1, 1]], 0.8);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!solid(x, y)) continue;
      const x0 = x / 16 - 0.5;
      const x1 = (x + 1) / 16 - 0.5;
      const y1 = 0.5 - y / 16;
      const y0 = 0.5 - (y + 1) / 16;
      const c = [(x + 0.5) / 16, 1 - (y + 0.5) / 16];
      const u4 = [c, c, c, c];
      if (!solid(x + 1, y)) quad([[x1, y0, h], [x1, y0, -h], [x1, y1, -h], [x1, y1, h]], u4, 0.7);
      if (!solid(x - 1, y)) quad([[x0, y0, -h], [x0, y0, h], [x0, y1, h], [x0, y1, -h]], u4, 0.7);
      if (!solid(x, y - 1)) quad([[x0, y1, h], [x1, y1, h], [x1, y1, -h], [x0, y1, -h]], u4, 0.9);
      if (!solid(x, y + 1)) quad([[x0, y0, -h], [x1, y0, -h], [x1, y0, h], [x0, y0, h]], u4, 0.55);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  extrudedCache.set(key, g);
  return g;
}

// Bow being drawn (pull 1..3), for the first-person view.
const bowTextures = [];
export function bowMesh(pull) {
  if (!bowTextures[pull]) {
    const t = new THREE.CanvasTexture(getBowCanvas(pull));
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    bowTextures[pull] = t;
  }
  const mat = new THREE.MeshBasicMaterial({ map: bowTextures[pull], vertexColors: true, alphaTest: 0.5 });
  return new THREE.Mesh(extrudedFromCanvas(getBowCanvas(pull), `bow:${pull}`), mat);
}

// Returns a fresh mesh (with its own material so brightness can be tinted per instance). Geometries
// are shared and must not be disposed by the caller.
export function makeItemMesh(id) {
  if (isCubeItem(id)) {
    const mat = new THREE.MeshBasicMaterial({ map: atlasTex(), vertexColors: true, alphaTest: 0.5 });
    return new THREE.Mesh(blockGeometry(id), mat);
  }
  const mat = new THREE.MeshBasicMaterial({ map: spriteTexture(id), vertexColors: true, alphaTest: 0.5 });
  return new THREE.Mesh(extrudedGeometry(id), mat);
}

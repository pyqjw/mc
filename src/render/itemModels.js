// 3D models for items: cubes for blocks, flat sprites for everything else. Used for the held item and drops.
import * as THREE from 'three';
import { BLOCKS, RENDER, TEX_TOP, TEX_BOTTOM, TEX_SIDE, TEX_FRONT, ATLAS_TILES_PER_ROW } from '../world/blocks.js';
import { getAtlasCanvas, getItemCanvas, tileRect } from './textures.js';

let atlasTexture = null;
const geoCache = new Map();
const spriteTexCache = new Map();

function atlasTex() {
  if (!atlasTexture) {
    atlasTexture = new THREE.CanvasTexture(getAtlasCanvas());
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.generateMipmaps = false;
  }
  return atlasTexture;
}

export function isCubeItem(id) {
  const b = id < 256 ? BLOCKS[id] : null;
  return !!b && (b.render === RENDER.CUBE || b.render === RENDER.BED);
}

// Unit cube centred at the origin with atlas UVs and baked face shading. Front faces +z.
export function blockGeometry(id) {
  if (geoCache.has(id)) return geoCache.get(id);
  const b = BLOCKS[id];
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
  if (id < 256) {
    const src = getAtlasCanvas();
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

// Returns a fresh mesh (with its own material so brightness can be tinted per instance).
export function makeItemMesh(id) {
  if (isCubeItem(id)) {
    const mat = new THREE.MeshBasicMaterial({ map: atlasTex(), vertexColors: true, alphaTest: 0.5 });
    return new THREE.Mesh(blockGeometry(id), mat);
  }
  const mat = new THREE.MeshBasicMaterial({ map: spriteTexture(id), alphaTest: 0.5, side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
}

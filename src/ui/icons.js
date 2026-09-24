// Inventory icons: isometric renders for blocks, flat sprites for items. Cached as data URLs.
import { BLOCKS, RENDER, TEX_TOP, TEX_SIDE, TEX_FRONT } from '../world/blocks.js';
import { getItemAtlasCanvas, getItemCanvas, tileRect } from '../render/textures.js';

const cache = new Map();

function drawFace(ctx, atlas, tile, matrix, darken, clipH = 16) {
  const r = tileRect(tile);
  ctx.save();
  ctx.setTransform(...matrix);
  ctx.drawImage(atlas, r.x, r.y + (16 - clipH), 16, clipH, 0, 0, 16, 16);
  if (darken > 0) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0,0,0,${darken})`;
    ctx.fillRect(0, 0, 16, 16);
  }
  ctx.restore();
}

function isoIcon(id) {
  const b = BLOCKS[id];
  const atlas = getItemAtlasCanvas();
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const h = b.height;
  const drop = (1 - h) * 32; // partial blocks sit lower
  // Each face on its own layer so darkening only affects that face.
  const layer = (fn) => {
    const l = document.createElement('canvas');
    l.width = l.height = S;
    const lc = l.getContext('2d');
    lc.imageSmoothingEnabled = false;
    fn(lc);
    ctx.drawImage(l, 0, 0);
  };
  const front = b.orientable ? TEX_FRONT[id] : TEX_SIDE[id];
  layer((lc) => drawFace(lc, atlas, front, [28 / 16, 14 / 16, 0, 2 * h, 4, 16 + drop], 0.18, 16 * h));
  layer((lc) => drawFace(lc, atlas, TEX_SIDE[id], [28 / 16, -14 / 16, 0, 2 * h, 32, 30 + drop], 0.38, 16 * h));
  layer((lc) => drawFace(lc, atlas, TEX_TOP[id], [28 / 16, -14 / 16, 28 / 16, 14 / 16, 4, 16 + drop], 0));
  return c.toDataURL();
}

function flatIcon(canvas) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  c.getContext('2d').drawImage(canvas, 0, 0);
  return c.toDataURL();
}

export function iconURL(id) {
  if (cache.has(id)) return cache.get(id);
  let url;
  if (id < 256) {
    const b = BLOCKS[id];
    if (b.render === RENDER.CUBE || b.render === RENDER.BED) url = isoIcon(id);
    else {
      const r = tileRect(TEX_SIDE[id]);
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      c.getContext('2d').drawImage(getItemAtlasCanvas(), r.x, r.y, 16, 16, 0, 0, 16, 16);
      url = c.toDataURL();
    }
  } else {
    url = flatIcon(getItemCanvas(id));
  }
  cache.set(id, url);
  return url;
}

export function isIsoIcon(id) {
  if (id >= 256) return false;
  const b = BLOCKS[id];
  return b.render === RENDER.CUBE || b.render === RENDER.BED;
}

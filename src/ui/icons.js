// Inventory icons: isometric renders for blocks, flat sprites for items. Cached as data URLs.
import { BLOCKS, RENDER, TEX_TOP, TEX_SIDE, TEX_FRONT } from '../world/blocks.js';
import { getItemAtlasCanvas, getItemCanvas, tileRect } from '../render/textures.js';
import { shapeBoxes, boxTextures, iconMeta } from '../world/shapes.js';

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

// Isometric icon of a block made of boxes (stairs, slabs, fences, ...).
const P = (x, y, z) => [32 + (x - z) * 28, 32 + (x + z) * 14 - y * 30];

function isoShapeIcon(id) {
  const atlas = getItemAtlasCanvas();
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const meta = iconMeta(id);
  const boxes = shapeBoxes(id, meta, 'render').map((b, i) => ({ b, i }));
  boxes.sort((a, b) => (a.b[0] + a.b[3] + a.b[2] + a.b[5] + a.b[1] + a.b[4]) - (b.b[0] + b.b[3] + b.b[2] + b.b[5] + b.b[1] + b.b[4]));
  const clamp = (v) => Math.min(1, Math.max(0, v));
  for (const { b, i } of boxes) {
    const tex = boxTextures(id, meta, i);
    const [x0, y0, z0, x1, y1, z1] = b;
    // [face, darken, A, B, C (world corners for texture u0v0, u1v0, u0v1), u0, u1, v0, v1]
    const faces = [
      [2, 0, [x0, y1, z1], [x1, y1, z1], [x0, y1, z0], x0, x1, 1 - z1, 1 - z0],
      [4, 0.18, [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], x0, x1, y0, y1],
      [0, 0.38, [x1, y0, z1], [x1, y0, z0], [x1, y1, z1], 1 - z1, 1 - z0, y0, y1],
    ];
    for (const [f, darken, A, B2, C, u0, u1, v0, v1] of faces) {
      const tile = tex.tiles[f];
      if (tile < 0 || u1 <= u0 || v1 <= v0) continue;
      const r = tileRect(tile);
      const ta = [clamp(u0) * 16, (1 - clamp(v0)) * 16];
      const tb = [clamp(u1) * 16, (1 - clamp(v0)) * 16];
      const tc = [clamp(u0) * 16, (1 - clamp(v1)) * 16];
      const pa = P(...A);
      const pb = P(...B2);
      const pc = P(...C);
      const du = tb[0] - ta[0];
      const dv = tc[1] - ta[1];
      if (!du || !dv) continue;
      const a = (pb[0] - pa[0]) / du;
      const bb = (pb[1] - pa[1]) / du;
      const cc = (pc[0] - pa[0]) / dv;
      const d = (pc[1] - pa[1]) / dv;
      const l = document.createElement('canvas');
      l.width = l.height = S;
      const lc = l.getContext('2d');
      lc.imageSmoothingEnabled = false;
      lc.setTransform(a, bb, cc, d, pa[0] - a * ta[0] - cc * ta[1], pa[1] - bb * ta[0] - d * ta[1]);
      const sx = Math.min(ta[0], tb[0]);
      const sy = Math.min(ta[1], tc[1]);
      const sw = Math.max(1, Math.abs(tb[0] - ta[0]));
      const sh = Math.max(1, Math.abs(tc[1] - ta[1]));
      lc.drawImage(atlas, r.x + sx, r.y + sy, sw, sh, sx, sy, sw, sh);
      if (darken > 0) {
        lc.setTransform(1, 0, 0, 1, 0, 0);
        lc.globalCompositeOperation = 'source-atop';
        lc.fillStyle = `rgba(0,0,0,${darken})`;
        lc.fillRect(0, 0, S, S);
      }
      ctx.drawImage(l, 0, 0);
    }
  }
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
    else if (b.itemSprite) url = flatIcon(getItemCanvas(id));
    else if (b.render === RENDER.SHAPE && b.shape !== 'ladder') url = isoShapeIcon(id);
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
  return b.render === RENDER.CUBE || b.render === RENDER.BED || (b.render === RENDER.SHAPE && !b.itemSprite && b.shape !== 'ladder');
}

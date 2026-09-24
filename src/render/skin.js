// Player skin in the standard 64x64 Minecraft skin layout, plus box geometry with skin UVs.
// The default skin is painted procedurally (a Steve-like explorer); a custom skin image in the
// same layout can be used instead.
import * as THREE from 'three';
import { mulberry32 } from '../world/noise.js';

export const SKIN_SIZE = 64;

// Texture origins (u, v) and box sizes (w, h, d) of the skin parts.
export const SKIN_PARTS = {
  head: { u: 0, v: 0, w: 8, h: 8, d: 8 },
  hat: { u: 32, v: 0, w: 8, h: 8, d: 8 },
  body: { u: 16, v: 16, w: 8, h: 12, d: 4 },
  rightArm: { u: 40, v: 16, w: 4, h: 12, d: 4 },
  leftArm: { u: 32, v: 48, w: 4, h: 12, d: 4 },
  rightLeg: { u: 0, v: 16, w: 4, h: 12, d: 4 },
  leftLeg: { u: 16, v: 48, w: 4, h: 12, d: 4 },
};

// Face regions of a box part: [x, y, w, h] in skin pixels, keyed by BoxGeometry face order
// (+x = the part's left side, -x = its right side, +y, -y, +z = front, -z = back).
export function partRegions(p) {
  const { u, v, w, h, d } = p;
  return [
    [u + d + w, v + d, d, h], // +x (left)
    [u, v + d, d, h], // -x (right)
    [u + d, v, w, d], // +y (top)
    [u + d + w, v, w, d], // -y (bottom)
    [u + d, v + d, w, h], // +z (front)
    [u + 2 * d + w, v + d, w, h], // -z (back)
  ];
}

// Per-face brightness (BoxGeometry face order) that gives box models a Minecraft-like shaded look.
export const FACE_SHADE = [0.72, 0.62, 1.0, 0.5, 0.86, 0.66];

// BoxGeometry (sizes in skin pixels * scale) whose UVs sample the skin regions of `part`, with
// per-face shading in a colour attribute (use vertexColors on the material).
export function skinBox(part, scale = 1 / 16, inflate = 0) {
  const p = SKIN_PARTS[part];
  const g = new THREE.BoxGeometry((p.w + inflate * 2) * scale, (p.h + inflate * 2) * scale, (p.d + inflate * 2) * scale);
  const uv = g.attributes.uv;
  const col = new Float32Array(uv.count * 3);
  partRegions(p).forEach(([rx, ry, rw, rh], f) => {
    for (let i = f * 4; i < f * 4 + 4; i++) {
      const u0 = uv.getX(i);
      const v0 = uv.getY(i);
      uv.setXY(i, (rx + u0 * rw) / SKIN_SIZE, 1 - (ry + (1 - v0) * rh) / SKIN_SIZE);
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = FACE_SHADE[f];
    }
  });
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function rgb(c) {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
}

// Paints the default skin.
export function paintDefaultSkin() {
  const c = document.createElement('canvas');
  c.width = c.height = SKIN_SIZE;
  const ctx = c.getContext('2d');
  const rand = mulberry32(2009);
  const px = (x, y, col) => {
    ctx.fillStyle = rgb(col);
    ctx.fillRect(x, y, 1, 1);
  };
  const vary = (col, amt) => {
    const d = (rand() - 0.5) * amt;
    return [col[0] + d, col[1] + d, col[2] + d];
  };
  const fillRegion = (r, fn) => {
    const [x0, y0, w, h] = r;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x0 + x, y0 + y, fn(x, y, w, h));
  };

  const SKIN = [194, 142, 106];
  const SKIN_D = [160, 110, 78];
  const HAIR = [58, 38, 22];
  const HAIR_L = [78, 52, 30];
  const SHIRT = [0, 170, 170];
  const SHIRT_D = [0, 140, 140];
  const PANTS = [62, 58, 158];
  const PANTS_D = [48, 44, 128];
  const SHOES = [88, 88, 92];

  const hair = () => (rand() < 0.3 ? HAIR_L : vary(HAIR, 10));
  const skin = () => vary(SKIN, 14);

  // Head.
  const head = partRegions(SKIN_PARTS.head);
  fillRegion(head[2], hair); // top
  fillRegion(head[3], () => vary(SKIN_D, 6)); // bottom (chin)
  fillRegion(head[5], (x, y) => (y < 7 ? hair() : vary(SKIN_D, 6))); // back
  for (const side of [head[0], head[1]]) {
    fillRegion(side, (x, y) => (y < 2 || (y < 4 && x > 3) || (y < 7 && x > 5) ? hair() : skin()));
  }
  fillRegion(head[4], (x, y) => {
    if (y < 2) return hair();
    if (y === 2 && (x === 0 || x === 7)) return hair();
    if (y === 4 && (x === 1 || x === 6)) return [245, 245, 245]; // eye whites
    if (y === 4 && (x === 2 || x === 5)) return [70, 60, 150]; // irises
    if (y === 5 && (x === 3 || x === 4)) return [140, 90, 60]; // nose
    if (y === 6 && x >= 2 && x <= 5) return [110, 60, 40]; // mouth
    if (y === 7 && x >= 2 && x <= 5) return [130, 80, 55];
    return skin();
  });

  // Body: shirt with a darker collar.
  const body = partRegions(SKIN_PARTS.body);
  for (let f = 0; f < 6; f++) {
    fillRegion(body[f], (x, y) => {
      if (f === 4 && y === 0 && x >= 3 && x <= 4) return SKIN; // neckline
      return vary(y > 9 ? SHIRT_D : SHIRT, 12);
    });
  }

  // Arms: short sleeves, then bare arm.
  for (const part of ['rightArm', 'leftArm']) {
    const r = partRegions(SKIN_PARTS[part]);
    for (let f = 0; f < 6; f++) {
      if (f === 2) fillRegion(r[f], () => vary(SHIRT, 10));
      else if (f === 3) fillRegion(r[f], () => vary(SKIN_D, 6));
      else fillRegion(r[f], (x, y) => (y < 4 ? vary(y === 3 ? SHIRT_D : SHIRT, 10) : vary(y > 9 ? SKIN_D : SKIN, 14)));
    }
  }

  // Legs: trousers and shoes.
  for (const part of ['rightLeg', 'leftLeg']) {
    const r = partRegions(SKIN_PARTS[part]);
    for (let f = 0; f < 6; f++) {
      if (f === 3) fillRegion(r[f], () => vary(SHOES, 6));
      else fillRegion(r[f], (x, y) => (y > 9 ? vary(SHOES, 8) : vary(y === 0 ? PANTS_D : PANTS, 12)));
    }
  }
  return c;
}

let skinCanvas = null;
export function getSkinCanvas() {
  if (!skinCanvas) skinCanvas = paintDefaultSkin();
  return skinCanvas;
}

// Flat front view of the skin (16x32 pixels), for places without a 3D view.
export function drawSkinFront(ctx, dx = 0, dy = 0) {
  const src = getSkinCanvas();
  const parts = [
    [8, 8, 8, 8, 4, 0], // head
    [20, 20, 8, 12, 4, 8], // body
    [44, 20, 4, 12, 0, 8], // right arm (viewer's left)
    [36, 52, 4, 12, 12, 8], // left arm
    [4, 20, 4, 12, 4, 20], // right leg
    [20, 52, 4, 12, 8, 20], // left leg
  ];
  for (const [sx, sy, w, h, x, y] of parts) ctx.drawImage(src, sx, sy, w, h, dx + x, dy + y, w, h);
}

let skinTexture = null;
export function getSkinTexture() {
  if (!skinTexture) {
    skinTexture = new THREE.CanvasTexture(getSkinCanvas());
    skinTexture.magFilter = THREE.NearestFilter;
    skinTexture.minFilter = THREE.NearestFilter;
    skinTexture.generateMipmaps = false;
  }
  return skinTexture;
}

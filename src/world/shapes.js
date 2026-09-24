// Non-cube block shapes built from boxes: slabs, stairs, doors, ladders, fences, gates, panes,
// beds, chests and snow layers. Shared by the mesher (workers), physics and ray casting.
//
// Boxes are [x0, y0, z0, x1, y1, z1] in block-local units (0..1; collision may reach y = 1.5).
// Horizontal directions use Minecraft's order as indices: 0 = north (-z), 1 = east (+x),
// 2 = south (+z), 3 = west (-x).
import { BLOCKS, TILE_INDEX, TEX_TOP, TEX_BOTTOM, TEX_SIDE, TEX_FRONT } from './blocks.js';

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const px = (v) => v / 16;

export const SHAPE_ID = { slab: 1, stairs: 2, door: 3, ladder: 4, fence: 5, gate: 6, pane: 7, bed: 8, chest: 9, snow: 10, vine: 11, lilypad: 12 };
export const SHAPE_OF = new Uint8Array(256);
const CONNECT = new Uint8Array(256); // fences / panes connect to these (bit 1 fence, bit 2 pane)
for (const b of BLOCKS) {
  if (!b) continue;
  if (b.shape) SHAPE_OF[b.id] = SHAPE_ID[b.shape];
}
for (const b of BLOCKS) {
  if (!b) continue;
  if (b.shape === 'fence' || b.shape === 'gate') CONNECT[b.id] |= 1;
  if (b.shape === 'pane' || b.key === 'glass') CONNECT[b.id] |= 2;
  if (b.opaque && b.solid) CONNECT[b.id] |= 3;
}

// Box covering the half of the block towards horizontal direction d, over the y range.
function halfBox(d, y0, y1) {
  switch (d) {
    case 0: return [0, y0, 0, 1, y1, 0.5];
    case 1: return [0.5, y0, 0, 1, y1, 1];
    case 2: return [0, y0, 0.5, 1, y1, 1];
    default: return [0, y0, 0, 0.5, y1, 1];
  }
}

function intersect(a, b) {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.min(a[3], b[3]), Math.min(a[4], b[4]), Math.min(a[5], b[5])];
}

// ------------------------------------------------------------ stairs
// meta: bits 0-1 facing (the side of the tall part), bit 2 upside down.
export const STAIR = { STRAIGHT: 0, OUTER_LEFT: 1, OUTER_RIGHT: 2, INNER_LEFT: 3, INNER_RIGHT: 4 };
const cw = (d) => (d + 1) & 3;
const ccw = (d) => (d + 3) & 3;
const opp = (d) => (d + 2) & 3;

// Minecraft's stair corner rules. nb(dx, dz) -> [id, meta] of the neighbour at the same height.
export function stairShape(meta, nb) {
  const f = meta & 3;
  const half = meta & 4;
  const isStair = (id) => SHAPE_OF[id] === SHAPE_ID.stairs;
  const canTake = (d) => {
    const [id, m] = nb(DIRS[d][0], DIRS[d][1]);
    return !isStair(id) || (m & 3) !== f || (m & 4) !== half;
  };
  const [fid, fm] = nb(DIRS[f][0], DIRS[f][1]);
  if (isStair(fid) && (fm & 4) === half) {
    const d1 = fm & 3;
    if ((d1 & 1) !== (f & 1) && canTake(opp(d1))) return d1 === ccw(f) ? STAIR.OUTER_LEFT : STAIR.OUTER_RIGHT;
  }
  const b = opp(f);
  const [bid, bm] = nb(DIRS[b][0], DIRS[b][1]);
  if (isStair(bid) && (bm & 4) === half) {
    const d2 = bm & 3;
    if ((d2 & 1) !== (f & 1) && canTake(d2)) return d2 === ccw(f) ? STAIR.INNER_LEFT : STAIR.INNER_RIGHT;
  }
  return STAIR.STRAIGHT;
}

function stairBoxes(meta, nb) {
  const f = meta & 3;
  const up = meta & 4;
  const base = up ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
  const y0 = up ? 0 : 0.5;
  const y1 = up ? 0.5 : 1;
  const shape = nb ? stairShape(meta, nb) : STAIR.STRAIGHT;
  const main = halfBox(f, y0, y1);
  switch (shape) {
    case STAIR.OUTER_LEFT: return [base, intersect(main, halfBox(ccw(f), y0, y1))];
    case STAIR.OUTER_RIGHT: return [base, intersect(main, halfBox(cw(f), y0, y1))];
    case STAIR.INNER_LEFT: return [base, main, intersect(halfBox(opp(f), y0, y1), halfBox(ccw(f), y0, y1))];
    case STAIR.INNER_RIGHT: return [base, main, intersect(halfBox(opp(f), y0, y1), halfBox(cw(f), y0, y1))];
    default: return [base, main];
  }
}

// ------------------------------------------------------------ doors
// meta: bits 0-1 facing (the way the player looked when placing), bit 2 open, bit 3 upper half,
// bit 4 hinge on the right.
const DT = 3 / 16;
const DOOR_BOX = { N: [0, 0, 1 - DT, 1, 1, 1], S: [0, 0, 0, 1, 1, DT], E: [0, 0, 0, DT, 1, 1], W: [1 - DT, 0, 0, 1, 1, 1] };
export function doorBox(meta) {
  const f = meta & 3;
  const open = meta & 4;
  const right = meta & 16;
  switch (f) {
    case 1: return open ? (right ? DOOR_BOX.N : DOOR_BOX.S) : DOOR_BOX.E;
    case 2: return open ? (right ? DOOR_BOX.E : DOOR_BOX.W) : DOOR_BOX.S;
    case 3: return open ? (right ? DOOR_BOX.S : DOOR_BOX.N) : DOOR_BOX.W;
    default: return open ? (right ? DOOR_BOX.W : DOOR_BOX.E) : DOOR_BOX.N;
  }
}

// ------------------------------------------------------------ ladders
// meta: the direction the ladder faces (away from its wall).
export function ladderBox(meta, t = DT) {
  const DT = t;
  switch (meta & 3) {
    case 0: return [0, 0, 1 - DT, 1, 1, 1];
    case 1: return [0, 0, 0, DT, 1, 1];
    case 2: return [0, 0, 0, 1, 1, DT];
    default: return [1 - DT, 0, 0, 1, 1, 1];
  }
}

// Direction of the wall a ladder / wall torch hangs on.
export function attachedDir(meta) {
  return opp(meta & 3);
}

// ------------------------------------------------------------ fences, gates & panes
function connections(nb, bit) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    const [id] = nb(DIRS[d][0], DIRS[d][1]);
    out.push(id > 0 && (CONNECT[id] & bit) !== 0);
  }
  return out;
}

function fenceBoxes(nb, kind) {
  const conn = nb ? connections(nb, 1) : [false, true, false, true];
  const h = kind === 'collision' ? 1.5 : 1;
  if (kind !== 'render') {
    const out = [[px(6), 0, px(6), px(10), h, px(10)]];
    if (conn[0]) out.push([px(6), 0, 0, px(10), h, px(6)]);
    if (conn[2]) out.push([px(6), 0, px(10), px(10), h, 1]);
    if (conn[1]) out.push([px(10), 0, px(6), 1, h, px(10)]);
    if (conn[3]) out.push([0, 0, px(6), px(6), h, px(10)]);
    return out;
  }
  const out = [[px(6), 0, px(6), px(10), 1, px(10)]];
  for (const [y0, y1] of [[6, 9], [12, 15]]) {
    if (conn[0]) out.push([px(7), px(y0), 0, px(9), px(y1), px(6)]);
    if (conn[2]) out.push([px(7), px(y0), px(10), px(9), px(y1), 1]);
    if (conn[1]) out.push([px(10), px(y0), px(7), 1, px(y1), px(9)]);
    if (conn[3]) out.push([0, px(y0), px(7), px(6), px(y1), px(9)]);
  }
  return out;
}

// meta: bits 0-1 facing, bit 2 open. Closed gates span across the facing direction.
function gateBoxes(meta, kind) {
  const f = meta & 3;
  const open = meta & 4;
  const alongX = (f & 1) === 0; // facing north/south: the gate runs along x
  const rot = (b) => (alongX ? b : [b[2], b[1], b[0], b[5], b[4], b[3]]);
  if (kind === 'collision') return open ? [] : [rot([0, 0, px(6), 1, 1.5, px(10)])];
  if (kind === 'select') return [rot([0, 0, px(6), 1, 1, px(10)])];
  const out = [rot([0, px(5), px(7), px(2), 1, px(9)]), rot([px(14), px(5), px(7), 1, 1, px(9)])];
  if (!open) {
    for (const [y0, y1] of [[6, 9], [12, 15]]) {
      out.push(rot([px(2), px(y0), px(7), px(6), px(y1), px(9)]));
      out.push(rot([px(10), px(y0), px(7), px(14), px(y1), px(9)]));
    }
    out.push(rot([px(6), px(6), px(7), px(8), px(15), px(9)]));
    out.push(rot([px(8), px(6), px(7), px(10), px(15), px(9)]));
  } else {
    // Leaves swung open towards the facing direction.
    const toward = f === 0 || f === 3 ? -1 : 1;
    const z0 = toward > 0 ? px(9) : px(1);
    const z1 = toward > 0 ? px(15) : px(7);
    for (const [x0, x1] of [[0, 2], [14, 16]]) {
      for (const [y0, y1] of [[6, 9], [12, 15]]) out.push(rot([px(x0), px(y0), z0, px(x1), px(y1), z1]));
      out.push(rot([px(x0), px(9), toward > 0 ? px(13) : px(1), px(x1), px(12), toward > 0 ? px(15) : px(3)]));
    }
  }
  return out;
}

function paneBoxes(nb) {
  const conn = nb ? connections(nb, 2) : [false, true, false, true];
  const out = [[px(7), 0, px(7), px(9), 1, px(9)]];
  if (conn[0]) out.push([px(7), 0, 0, px(9), 1, px(7)]);
  if (conn[2]) out.push([px(7), 0, px(9), px(9), 1, 1]);
  if (conn[1]) out.push([px(9), 0, px(7), 1, 1, px(9)]);
  if (conn[3]) out.push([0, 0, px(7), px(7), 1, px(9)]);
  return out;
}

// ------------------------------------------------------------ public API
// Boxes of a block for 'collision', 'select' or 'render'. nb(dx, dz) gives horizontal neighbours
// as [id, meta] (may be null for icons).
export function shapeBoxes(id, meta, kind, nb = null) {
  switch (SHAPE_OF[id]) {
    case SHAPE_ID.slab: return [(meta & 1) ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]];
    case SHAPE_ID.stairs: return kind === 'select' ? [[0, 0, 0, 1, 1, 1]] : stairBoxes(meta, nb);
    case SHAPE_ID.door: return [doorBox(meta)];
    case SHAPE_ID.ladder: return [ladderBox(meta)];
    case SHAPE_ID.vine: return kind === 'collision' ? [] : [ladderBox(meta, 1 / 16)];
    case SHAPE_ID.lilypad: return [[0, 0, 0, 1, kind === 'collision' ? 1.5 / 16 : 1 / 64, 1]];
    case SHAPE_ID.fence: return fenceBoxes(nb, kind);
    case SHAPE_ID.gate: return gateBoxes(meta, kind);
    case SHAPE_ID.pane: return paneBoxes(nb);
    case SHAPE_ID.bed: return [[0, 0, 0, 1, px(9), 1]];
    case SHAPE_ID.chest: {
      const out = [[px(1), 0, px(1), px(15), px(14), px(15)]];
      if (kind === 'render') {
        // Latch on the front.
        const f = meta & 3;
        const latch = [[px(7), px(7), 0, px(9), px(11), px(1)], [px(15), px(7), px(7), 1, px(11), px(9)], [px(7), px(7), px(15), px(9), px(11), 1], [0, px(7), px(7), px(1), px(11), px(9)]][f];
        out.push(latch);
      }
      return out;
    }
    case SHAPE_ID.snow: {
      const layers = (meta & 7) + 1;
      if (kind === 'collision') return layers > 1 ? [[0, 0, 0, 1, (layers - 1) / 8, 1]] : [];
      return [[0, 0, 0, 1, layers / 8, 1]];
    }
    default: return [[0, 0, 0, 1, 1, 1]];
  }
}

// Bounding box of the selection boxes (for the outline and hit tests).
export function selectionBox(id, meta, nb = null) {
  const boxes = shapeBoxes(id, meta, 'select', nb);
  const b = [1, 1, 1, 0, 0, 0];
  for (const x of boxes) {
    for (let i = 0; i < 3; i++) {
      b[i] = Math.min(b[i], x[i]);
      b[i + 3] = Math.max(b[i + 3], x[i + 3]);
    }
  }
  return b;
}

// ------------------------------------------------------------ textures for rendering
// Face order (as in the mesher): 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z. Directions of the side
// faces: +x east (1), -x west (3), +z south (2), -z north (0).
const FACE_DIR = [1, 3, -1, -2, 2, 0];

// Returns { tiles: [6], rot: [6] (quarter turns of the UVs), flipU: [6] } for a render box.
export function boxTextures(id, meta, boxIndex) {
  const tiles = [];
  const rot = [0, 0, 0, 0, 0, 0];
  const flipU = [false, false, false, false, false, false];
  const shape = SHAPE_OF[id];
  if (shape === SHAPE_ID.door) {
    const t = (meta & 8) ? TILE_INDEX.oak_door_top : TILE_INDEX.oak_door_bottom;
    for (let f = 0; f < 6; f++) tiles.push(t);
    const flip = !!(meta & 16) !== !!(meta & 4);
    for (let f = 0; f < 6; f++) flipU[f] = flip;
    return { tiles, rot, flipU };
  }
  if (shape === SHAPE_ID.bed) {
    const head = meta & 4;
    const f = meta & 3;
    for (let face = 0; face < 6; face++) {
      if (face === 2) tiles.push(head ? TILE_INDEX.bed_head_top : TILE_INDEX.bed_foot_top);
      else if (face === 3) tiles.push(TILE_INDEX.oak_planks);
      else if (FACE_DIR[face] === f) tiles.push(head ? TILE_INDEX.bed_head_end : TILE_INDEX.bed_side_foot);
      else if (FACE_DIR[face] === opp(f)) tiles.push(head ? TILE_INDEX.bed_side_head : TILE_INDEX.bed_foot_end);
      else tiles.push(head ? TILE_INDEX.bed_side_head : TILE_INDEX.bed_side_foot);
    }
    // Pillow towards the head: the textures are drawn with the head at the top (north).
    rot[2] = [0, 1, 2, 3][f];
    return { tiles, rot, flipU };
  }
  if (shape === SHAPE_ID.chest && boxIndex > 0) {
    for (let f = 0; f < 6; f++) tiles.push(TILE_INDEX.chest_latch);
    return { tiles, rot, flipU };
  }
  const orient = shape === SHAPE_ID.chest;
  for (let f = 0; f < 6; f++) {
    if (f === 2) tiles.push(TEX_TOP[id]);
    else if (f === 3) tiles.push(TEX_BOTTOM[id]);
    else if (orient && FACE_DIR[f] === ((meta & 3) + 0)) tiles.push(TEX_FRONT[id]);
    else tiles.push(TEX_SIDE[id]);
  }
  return { tiles, rot, flipU };
}

// Meta used for inventory icons and held / dropped models.
export function iconMeta(id) {
  switch (SHAPE_OF[id]) {
    case SHAPE_ID.stairs: return 3;
    case SHAPE_ID.chest: return 2;
    case SHAPE_ID.bed: return 4 | 1;
    default: return 0;
  }
}

// Block registry. Pure data so it can be shared with web workers.

// Every texture tile in the atlas, in atlas order. textures.js paints them.
export const TILES = [
  'stone', 'dirt', 'grass_top', 'grass_side', 'cobblestone', 'oak_planks', 'bedrock', 'sand',
  'gravel', 'oak_log', 'oak_log_top', 'oak_leaves', 'glass', 'coal_ore', 'iron_ore', 'gold_ore',
  'diamond_ore', 'water', 'lava', 'crafting_table_top', 'crafting_table_side', 'crafting_table_front', 'furnace_front', 'furnace_front_lit',
  'furnace_side', 'furnace_top', 'torch', 'snow', 'snowy_grass_side', 'sandstone_top', 'sandstone_side', 'sandstone_bottom',
  'cactus_side', 'cactus_top', 'birch_log', 'birch_log_top', 'birch_leaves', 'spruce_log', 'spruce_log_top', 'spruce_leaves',
  'birch_planks', 'spruce_planks', 'tall_grass', 'poppy', 'dandelion', 'dead_bush', 'clay', 'bricks',
  'chest_front', 'chest_side', 'chest_top', 'white_wool', 'stone_bricks', 'ice', 'obsidian', 'coal_block',
  'iron_block', 'gold_block', 'diamond_block', 'bed_top', 'bed_side', 'oak_sapling', 'birch_sapling', 'spruce_sapling',
  'cactus_bottom', 'pumpkin_top', 'pumpkin_side', 'pumpkin_face', 'jack_o_lantern', 'farmland', 'farmland_wet', 'wheat_0',
  'wheat_1', 'wheat_2', 'wheat_3',
];
export const TILE_INDEX = Object.fromEntries(TILES.map((n, i) => [n, i]));
export const ATLAS_TILES_PER_ROW = 16;

export const RENDER = {
  NONE: 0,
  CUBE: 1,
  CROSS: 2,
  TORCH: 3,
  LIQUID: 4,
  BED: 5,
};

export const LAYER = {
  SOLID: 0,
  CUTOUT: 1,
  TRANSLUCENT: 2,
};

export const BLOCKS = [];
export const BLOCK_BY_KEY = {};

function def(id, key, name, props = {}) {
  const tex = props.tex || key;
  const textures = typeof tex === 'string'
    ? { top: tex, bottom: tex, side: tex, front: tex }
    : { top: tex.top || tex.side, bottom: tex.bottom || tex.top || tex.side, side: tex.side, front: tex.front || tex.side };
  const b = {
    id,
    key,
    name,
    render: RENDER.CUBE,
    layer: LAYER.SOLID,
    solid: true, // has collision
    opaque: true, // blocks light completely and hides neighbour faces
    lightAtten: 0, // extra attenuation when light passes through (non-opaque blocks)
    light: 0, // light emission
    hardness: 1,
    tool: null, // 'pickaxe' | 'axe' | 'shovel' | 'sword'
    harvestLevel: -1, // -1: drops with anything. >=0: needs a pickaxe of at least that tier
    replaceable: false,
    gravity: false,
    support: null, // 'soil' | 'sand' | 'solid' | 'torch' | 'cactus'
    interact: null,
    sound: 'stone',
    cullSelf: false,
    orientable: false,
    drops: null, // function(rand, toolItem) => [[id, count], ...] or null for self
    height: 1,
    tint: null, // 'grass' | 'foliage' | 'water': biome colour applied to texels with alpha < 255
    ...props,
  };
  b.textures = textures;
  BLOCKS[id] = b;
  BLOCK_BY_KEY[key] = b;
  return b;
}

const cross = { render: RENDER.CROSS, layer: LAYER.CUTOUT, solid: false, opaque: false, hardness: 0, sound: 'grass' };
const leaves = { layer: LAYER.CUTOUT, opaque: false, lightAtten: 1, hardness: 0.2, sound: 'grass', leaves: true };

def(0, 'air', '空气', { render: RENDER.NONE, solid: false, opaque: false, hardness: 0, replaceable: true });
def(1, 'stone', '石头', { hardness: 1.5, tool: 'pickaxe', harvestLevel: 0, drops: () => [[4, 1]] });
def(2, 'grass', '草方块', { tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, hardness: 0.6, tool: 'shovel', sound: 'grass', tint: 'grass', drops: () => [[3, 1]] });
def(3, 'dirt', '泥土', { hardness: 0.5, tool: 'shovel', sound: 'gravel' });
def(4, 'cobblestone', '圆石', { hardness: 2, tool: 'pickaxe', harvestLevel: 0 });
def(5, 'oak_planks', '橡木木板', { hardness: 2, tool: 'axe', sound: 'wood' });
def(6, 'bedrock', '基岩', { hardness: -1 });
def(7, 'sand', '沙子', { hardness: 0.5, tool: 'shovel', gravity: true, sound: 'sand' });
def(8, 'gravel', '沙砾', {
  hardness: 0.6, tool: 'shovel', gravity: true, sound: 'gravel',
  drops: (r) => (r() < 0.1 ? [[279, 1]] : [[8, 1]]),
});
def(9, 'oak_log', '橡木原木', { tex: { top: 'oak_log_top', side: 'oak_log' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(10, 'oak_leaves', '橡树树叶', {
  ...leaves,
  tint: 'foliage',
  drops: (r) => {
    const out = [];
    if (r() < 0.05) out.push([48, 1]);
    if (r() < 0.02) out.push([265, 1]);
    return out;
  },
});
def(11, 'glass', '玻璃', { layer: LAYER.CUTOUT, opaque: false, hardness: 0.3, sound: 'glass', cullSelf: true, drops: () => [] });
def(12, 'coal_ore', '煤矿石', { hardness: 3, tool: 'pickaxe', harvestLevel: 0, xp: [0, 2], drops: () => [[257, 1]] });
def(13, 'iron_ore', '铁矿石', { hardness: 3, tool: 'pickaxe', harvestLevel: 1 });
def(14, 'gold_ore', '金矿石', { hardness: 3, tool: 'pickaxe', harvestLevel: 2 });
def(15, 'diamond_ore', '钻石矿石', { hardness: 3, tool: 'pickaxe', harvestLevel: 2, xp: [3, 7], drops: () => [[261, 1]] });
def(16, 'water', '水', {
  render: RENDER.LIQUID, layer: LAYER.TRANSLUCENT, solid: false, opaque: false, lightAtten: 2,
  hardness: -1, replaceable: true, cullSelf: true, fluid: 'water', sound: null, tint: 'water',
});
def(17, 'lava', '熔岩', {
  render: RENDER.LIQUID, layer: LAYER.SOLID, solid: false, opaque: false, lightAtten: 14, light: 15,
  hardness: -1, replaceable: true, cullSelf: true, fluid: 'lava', sound: null,
});
def(18, 'crafting_table', '工作台', {
  tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' },
  hardness: 2.5, tool: 'axe', sound: 'wood', interact: 'crafting', orientable: true,
});
def(19, 'furnace', '熔炉', {
  tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front' },
  hardness: 3.5, tool: 'pickaxe', harvestLevel: 0, interact: 'furnace', orientable: true,
});
def(20, 'lit_furnace', '熔炉', {
  tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit' },
  hardness: 3.5, tool: 'pickaxe', harvestLevel: 0, interact: 'furnace', orientable: true, light: 13,
  drops: () => [[19, 1]],
});
def(21, 'torch', '火把', {
  render: RENDER.TORCH, layer: LAYER.CUTOUT, solid: false, opaque: false, light: 14, hardness: 0,
  support: 'torch', sound: 'wood',
});
def(22, 'snow_block', '雪块', { tex: 'snow', hardness: 0.2, tool: 'shovel', sound: 'snow' });
def(23, 'snowy_grass', '覆雪草方块', {
  tex: { top: 'snow', bottom: 'dirt', side: 'snowy_grass_side' }, hardness: 0.6, tool: 'shovel', sound: 'snow',
  drops: () => [[3, 1]],
});
def(24, 'sandstone', '砂岩', {
  tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' },
  hardness: 0.8, tool: 'pickaxe', harvestLevel: 0,
});
def(25, 'cactus', '仙人掌', {
  tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, layer: LAYER.CUTOUT, opaque: false,
  hardness: 0.4, support: 'cactus', sound: 'wool', damage: 1,
});
def(26, 'birch_log', '白桦原木', { tex: { top: 'birch_log_top', side: 'birch_log' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(27, 'birch_leaves', '白桦树叶', { ...leaves, drops: (r) => (r() < 0.05 ? [[49, 1]] : []) });
def(28, 'spruce_log', '云杉原木', { tex: { top: 'spruce_log_top', side: 'spruce_log' }, hardness: 2, tool: 'axe', sound: 'wood' });
def(29, 'spruce_leaves', '云杉树叶', { ...leaves, drops: (r) => (r() < 0.05 ? [[50, 1]] : []) });
def(30, 'birch_planks', '白桦木板', { hardness: 2, tool: 'axe', sound: 'wood' });
def(31, 'spruce_planks', '云杉木板', { hardness: 2, tool: 'axe', sound: 'wood' });
def(32, 'tall_grass', '草', { ...cross, replaceable: true, support: 'soil', tint: 'grass', drops: (r) => (r() < 0.125 ? [[280, 1]] : []) });
def(33, 'poppy', '虞美人', { ...cross, support: 'soil' });
def(34, 'dandelion', '蒲公英', { ...cross, support: 'soil' });
def(35, 'dead_bush', '枯萎的灌木', { ...cross, replaceable: true, support: 'sand', drops: (r) => [[256, Math.floor(r() * 3)]] });
def(36, 'clay', '黏土块', { hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: () => [[276, 4]] });
def(37, 'bricks', '砖块', { hardness: 2, tool: 'pickaxe', harvestLevel: 0 });
def(38, 'chest', '箱子', {
  tex: { top: 'chest_top', side: 'chest_side', front: 'chest_front' },
  hardness: 2.5, tool: 'axe', sound: 'wood', interact: 'chest', orientable: true, opaque: false,
});
def(39, 'white_wool', '白色羊毛', { hardness: 0.8, sound: 'wool' });
def(40, 'stone_bricks', '石砖', { hardness: 1.5, tool: 'pickaxe', harvestLevel: 0 });
def(41, 'ice', '冰', { layer: LAYER.TRANSLUCENT, opaque: false, lightAtten: 1, hardness: 0.5, tool: 'pickaxe', sound: 'glass', cullSelf: true, slippery: true, drops: () => [] });
def(42, 'obsidian', '黑曜石', { hardness: 50, tool: 'pickaxe', harvestLevel: 3 });
def(43, 'coal_block', '煤炭块', { hardness: 5, tool: 'pickaxe', harvestLevel: 0 });
def(44, 'iron_block', '铁块', { hardness: 5, tool: 'pickaxe', harvestLevel: 1, sound: 'metal' });
def(45, 'gold_block', '金块', { hardness: 3, tool: 'pickaxe', harvestLevel: 2, sound: 'metal' });
def(46, 'diamond_block', '钻石块', { hardness: 5, tool: 'pickaxe', harvestLevel: 2, sound: 'metal' });
def(47, 'bed', '床', {
  tex: { top: 'bed_top', bottom: 'oak_planks', side: 'bed_side' }, render: RENDER.BED, opaque: false,
  hardness: 0.2, sound: 'wood', interact: 'bed', support: 'solid', height: 9 / 16,
});
def(48, 'oak_sapling', '橡树树苗', { ...cross, support: 'soil', sapling: 'oak' });
def(49, 'birch_sapling', '白桦树苗', { ...cross, support: 'soil', sapling: 'birch' });
def(50, 'spruce_sapling', '云杉树苗', { ...cross, support: 'soil', sapling: 'spruce' });
def(53, 'pumpkin', '南瓜', {
  tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_face' },
  hardness: 1, tool: 'axe', sound: 'wood', orientable: true,
});
def(54, 'jack_o_lantern', '南瓜灯', {
  tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' },
  hardness: 1, tool: 'axe', sound: 'wood', orientable: true, light: 15,
});
def(56, 'farmland', '耕地', {
  tex: { top: 'farmland', bottom: 'dirt', side: 'dirt' }, render: RENDER.BED, opaque: false, height: 15 / 16,
  hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: () => [[3, 1]],
});
// Wheat crop: meta = growth stage 0..7.
def(57, 'wheat', '小麦', {
  ...cross, tex: 'wheat_0', support: 'farmland', crop: true,
  drops: (r, tool, meta) => (meta >= 7
    ? [[282, 1], [280, 1 + Math.floor(r() * 3)]]
    : [[280, 1]]),
});

export const B = Object.fromEntries(BLOCKS.filter(Boolean).map((b) => [b.key.toUpperCase(), b.id]));

// Flat typed lookup tables for hot loops (mesher, lighting, physics).
export const MAX_BLOCK_ID = 256;
export const IS_OPAQUE = new Uint8Array(MAX_BLOCK_ID);
export const IS_SOLID = new Uint8Array(MAX_BLOCK_ID);
export const LIGHT_ATTEN = new Uint8Array(MAX_BLOCK_ID);
export const LIGHT_EMIT = new Uint8Array(MAX_BLOCK_ID);
export const RENDER_TYPE = new Uint8Array(MAX_BLOCK_ID);
export const RENDER_LAYER = new Uint8Array(MAX_BLOCK_ID);
export const CULL_SELF = new Uint8Array(MAX_BLOCK_ID);
export const IS_FLUID = new Uint8Array(MAX_BLOCK_ID);
export const TEX_TOP = new Uint16Array(MAX_BLOCK_ID);
export const TEX_BOTTOM = new Uint16Array(MAX_BLOCK_ID);
export const TEX_SIDE = new Uint16Array(MAX_BLOCK_ID);
export const TEX_FRONT = new Uint16Array(MAX_BLOCK_ID);
export const IS_ORIENTABLE = new Uint8Array(MAX_BLOCK_ID);
export const TINT = { NONE: 0, GRASS: 1, FOLIAGE: 2, WATER: 3 };
export const TINT_TYPE = new Uint8Array(MAX_BLOCK_ID);

for (const b of BLOCKS) {
  if (!b) continue;
  IS_OPAQUE[b.id] = b.opaque ? 1 : 0;
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  LIGHT_ATTEN[b.id] = b.opaque ? 15 : b.lightAtten;
  LIGHT_EMIT[b.id] = b.light;
  RENDER_TYPE[b.id] = b.render;
  RENDER_LAYER[b.id] = b.layer;
  CULL_SELF[b.id] = b.cullSelf ? 1 : 0;
  IS_FLUID[b.id] = b.fluid ? 1 : 0;
  IS_ORIENTABLE[b.id] = b.orientable ? 1 : 0;
  TINT_TYPE[b.id] = b.tint ? TINT[b.tint.toUpperCase()] : 0;
  for (const [slot, arr] of [['top', TEX_TOP], ['bottom', TEX_BOTTOM], ['side', TEX_SIDE], ['front', TEX_FRONT]]) {
    const t = b.textures[slot];
    if (b.render !== RENDER.NONE && TILE_INDEX[t] === undefined) {
      throw new Error(`Unknown texture tile "${t}" for block ${b.key}`);
    }
    arr[b.id] = TILE_INDEX[t] || 0;
  }
}

export function getBlock(id) {
  return BLOCKS[id] || BLOCKS[0];
}

// Fluid helpers. meta for fluids: bits 0-2 = level (0 = source, 1..7 flowing), bit 3 = falling.
export function fluidHeight(meta, fluidAbove) {
  if (fluidAbove) return 1;
  if (meta & 8) return 1;
  const level = meta & 7;
  return (8 - level) / 9;
}

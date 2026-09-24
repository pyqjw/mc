// Crafting recipes (shaped + shapeless) and furnace smelting.
import { I, toolId, TOOL_MATERIALS, ARMOR_MATERIALS, armorId } from './items.js';

const TAGS = {
  planks: [I.OAK_PLANKS, I.BIRCH_PLANKS, I.SPRUCE_PLANKS],
  log: [I.OAK_LOG, I.BIRCH_LOG, I.SPRUCE_LOG],
  coal: [I.COAL, I.CHARCOAL],
};

export const RECIPES = [];

function ingredient(v) {
  if (typeof v === 'string') return TAGS[v];
  return [v];
}

function shaped(pattern, key, id, count = 1) {
  const rows = pattern.map((r) => [...r].map((ch) => (ch === ' ' ? null : ingredient(key[ch]))));
  RECIPES.push({ type: 'shaped', w: pattern[0].length, h: pattern.length, rows, result: { id, count } });
}

function shapeless(ings, id, count = 1) {
  RECIPES.push({ type: 'shapeless', ings: ings.map(ingredient), result: { id, count } });
}

shapeless([I.OAK_LOG], I.OAK_PLANKS, 4);
shapeless([I.BIRCH_LOG], I.BIRCH_PLANKS, 4);
shapeless([I.SPRUCE_LOG], I.SPRUCE_PLANKS, 4);
shaped(['P', 'P'], { P: 'planks' }, I.STICK, 4);
shaped(['PP', 'PP'], { P: 'planks' }, I.CRAFTING_TABLE);
shaped(['CCC', 'C C', 'CCC'], { C: I.COBBLESTONE }, I.FURNACE);
shaped(['PPP', 'P P', 'PPP'], { P: 'planks' }, I.CHEST);
shaped(['C', 'S'], { C: 'coal', S: I.STICK }, I.TORCH, 4);
shaped(['X X', ' X '], { X: I.IRON_INGOT }, I.BUCKET);
shaped(['SS', 'SS'], { S: I.SAND }, I.SANDSTONE);
shaped(['SS', 'SS'], { S: I.STONE }, I.STONE_BRICKS, 4);
shaped(['BB', 'BB'], { B: I.BRICK }, I.BRICKS);
shaped(['CC', 'CC'], { C: I.CLAY_BALL }, I.CLAY);
shaped(['WWW', 'PPP'], { W: I.WHITE_WOOL, P: 'planks' }, I.BED);
shaped(['WWW'], { W: I.WHEAT }, I.BREAD);
shaped(['GGG', 'GAG', 'GGG'], { G: I.GOLD_INGOT, A: I.APPLE }, I.GOLDEN_APPLE);
shaped(['P', 'T'], { P: I.PUMPKIN, T: I.TORCH }, I.JACK_O_LANTERN);
shaped([' SX', 'S X', ' SX'], { S: I.STICK, X: I.STRING }, I.BOW);
shaped(['F', 'S', 'E'], { F: I.FLINT, S: I.STICK, E: I.FEATHER }, I.ARROW, 4);
shapeless([I.BONE], I.BONE_MEAL, 3);
shaped(['SS', 'SS'], { S: I.STRING }, I.WHITE_WOOL);
shaped(['PP', 'PP', 'PP'], { P: I.OAK_PLANKS }, I.OAK_DOOR, 3);
shaped(['S S', 'SSS', 'S S'], { S: I.STICK }, I.LADDER, 3);
shaped(['PSP', 'PSP'], { P: 'planks', S: I.STICK }, I.OAK_FENCE, 3);
shaped(['SPS', 'SPS'], { P: 'planks', S: I.STICK }, I.OAK_FENCE_GATE);
shaped(['GGG', 'GGG'], { G: I.GLASS }, I.GLASS_PANE, 16);
shaped(['PPP', 'BBB', 'PPP'], { P: 'planks', B: I.BOOK }, I.BOOKSHELF);
shaped(['CCC'], { C: I.SUGAR_CANE }, I.PAPER, 3);
shapeless([I.PAPER, I.PAPER, I.PAPER, I.LEATHER], I.BOOK);
shaped(['SS', 'SS'], { S: I.SNOWBALL }, I.SNOW_BLOCK);
shaped(['BBB'], { B: I.SNOW_BLOCK }, I.SNOW, 6);
shaped(['P P', ' P '], { P: 'planks' }, I.BOWL, 4);
shapeless([I.BOWL, I.BROWN_MUSHROOM, I.RED_MUSHROOM], I.MUSHROOM_STEW);
// Slabs (6 from a row of 3) and stairs (4 from 6).
for (const [slab, stairs, base] of [
  [I.OAK_SLAB, I.OAK_STAIRS, I.OAK_PLANKS], [I.BIRCH_SLAB, I.BIRCH_STAIRS, I.BIRCH_PLANKS], [I.SPRUCE_SLAB, I.SPRUCE_STAIRS, I.SPRUCE_PLANKS],
  [I.COBBLESTONE_SLAB, I.COBBLESTONE_STAIRS, I.COBBLESTONE], [I.STONE_SLAB, null, I.SMOOTH_STONE],
  [I.STONE_BRICK_SLAB, I.STONE_BRICK_STAIRS, I.STONE_BRICKS], [I.SANDSTONE_SLAB, I.SANDSTONE_STAIRS, I.SANDSTONE],
  [I.BRICK_SLAB, I.BRICK_STAIRS, I.BRICKS],
]) {
  shaped(['XXX'], { X: base }, slab, 6);
  if (stairs) shaped(['X  ', 'XX ', 'XXX'], { X: base }, stairs, 4);
}

for (const [block, material] of [[I.COAL_BLOCK, I.COAL], [I.IRON_BLOCK, I.IRON_INGOT], [I.GOLD_BLOCK, I.GOLD_INGOT], [I.DIAMOND_BLOCK, I.DIAMOND]]) {
  shaped(['XXX', 'XXX', 'XXX'], { X: material }, block);
  shapeless([block], material, 9);
}

const TOOL_HEADS = { wooden: 'planks', stone: I.COBBLESTONE, iron: I.IRON_INGOT, golden: I.GOLD_INGOT, diamond: I.DIAMOND };
for (const m of TOOL_MATERIALS) {
  const X = TOOL_HEADS[m.key];
  const key = { X, S: I.STICK };
  shaped(['XXX', ' S ', ' S '], key, toolId(m.key, 'pickaxe'));
  shaped(['XX', 'XS', ' S'], key, toolId(m.key, 'axe'));
  shaped(['X', 'S', 'S'], key, toolId(m.key, 'shovel'));
  shaped(['X', 'X', 'S'], key, toolId(m.key, 'sword'));
  shaped(['XX', ' S', ' S'], key, toolId(m.key, 'hoe'));
}

const ARMOR_HEADS = { leather: I.LEATHER, iron: I.IRON_INGOT, golden: I.GOLD_INGOT, diamond: I.DIAMOND };
for (const m of ARMOR_MATERIALS) {
  const key = { X: ARMOR_HEADS[m.key] };
  shaped(['XXX', 'X X'], key, armorId(m.key, 'helmet'));
  shaped(['X X', 'XXX', 'XXX'], key, armorId(m.key, 'chestplate'));
  shaped(['XXX', 'X X', 'X X'], key, armorId(m.key, 'leggings'));
  shaped(['X X', 'X X'], key, armorId(m.key, 'boots'));
}

// grid: array of size*size stacks (or null). Returns {id, count} or null.
export function findRecipe(grid, size) {
  let minX = size; let minY = size; let maxX = -1; let maxY = -1;
  const items = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = grid[y * size + x];
      if (s && s.count > 0) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        items.push(s.id);
      }
    }
  }
  if (items.length === 0) return null;
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const at = (x, y) => {
    const s = grid[(minY + y) * size + minX + x];
    return s && s.count > 0 ? s.id : null;
  };

  for (const r of RECIPES) {
    if (r.type === 'shaped') {
      if (r.w !== w || r.h !== h) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < h && ok; y++) {
          for (let x = 0; x < w && ok; x++) {
            const need = r.rows[y][mirror ? w - 1 - x : x];
            const have = at(x, y);
            if (need === null) ok = have === null;
            else ok = have !== null && need.includes(have);
          }
        }
        if (ok) return { ...r.result };
      }
    } else {
      if (r.ings.length !== items.length) continue;
      const left = [...items];
      let ok = true;
      for (const ing of r.ings) {
        const i = left.findIndex((id) => ing.includes(id));
        if (i < 0) { ok = false; break; }
        left.splice(i, 1);
      }
      if (ok) return { ...r.result };
    }
  }
  return null;
}

export const SMELTING = {
  [I.COBBLESTONE]: I.STONE,
  [I.SAND]: I.GLASS,
  [I.IRON_ORE]: I.IRON_INGOT,
  [I.GOLD_ORE]: I.GOLD_INGOT,
  [I.DIAMOND_ORE]: I.DIAMOND,
  [I.COAL_ORE]: I.COAL,
  [I.OAK_LOG]: I.CHARCOAL,
  [I.BIRCH_LOG]: I.CHARCOAL,
  [I.SPRUCE_LOG]: I.CHARCOAL,
  [I.PORKCHOP]: I.COOKED_PORKCHOP,
  [I.BEEF]: I.STEAK,
  [I.MUTTON]: I.COOKED_MUTTON,
  [I.CLAY_BALL]: I.BRICK,
  [I.CLAY]: I.BRICKS,
  [I.CHICKEN]: I.COOKED_CHICKEN,
  [I.STONE]: I.SMOOTH_STONE,
};

// Experience per smelted item (collected when the output is taken).
export const SMELT_XP = {
  [I.STONE]: 0.1,
  [I.GLASS]: 0.1,
  [I.IRON_INGOT]: 0.7,
  [I.GOLD_INGOT]: 1,
  [I.DIAMOND]: 1,
  [I.COAL]: 0.1,
  [I.CHARCOAL]: 0.15,
  [I.COOKED_PORKCHOP]: 0.35,
  [I.STEAK]: 0.35,
  [I.COOKED_MUTTON]: 0.35,
  [I.COOKED_CHICKEN]: 0.35,
  [I.BRICK]: 0.3,
  [I.BRICKS]: 0.3,
};

export const SMELT_TIME = 200; // ticks per item

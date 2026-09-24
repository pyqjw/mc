// Item registry. Ids < 256 are block items (same id as the block), >= 256 are pure items.
import { BLOCKS } from './world/blocks.js';

export const ITEMS = {};

function item(id, key, name, props = {}) {
  ITEMS[id] = { id, key, name, stack: 64, isBlock: false, ...props };
  return ITEMS[id];
}

// Blocks that exist in the world but never as an inventory item.
const NON_ITEM_BLOCKS = new Set(['air', 'water', 'lava', 'lit_furnace', 'wheat', 'farmland']);
for (const b of BLOCKS) {
  if (!b || NON_ITEM_BLOCKS.has(b.key) || b.slabOf) continue;
  item(b.id, b.key, b.name, { isBlock: true, placeBlock: b.id, stack: b.key === 'bed' ? 1 : 64 });
}

item(256, 'stick', '木棍');
item(257, 'coal', '煤炭');
item(258, 'charcoal', '木炭');
item(259, 'iron_ingot', '铁锭');
item(260, 'gold_ingot', '金锭');
item(261, 'diamond', '钻石');
item(262, 'bucket', '桶', { stack: 16, bucket: 'empty' });
item(263, 'water_bucket', '水桶', { stack: 1, bucket: 'water' });
item(264, 'lava_bucket', '熔岩桶', { stack: 1, bucket: 'lava' });
item(265, 'apple', '苹果', { food: { hunger: 4, saturation: 2.4 } });
item(266, 'golden_apple', '金苹果', { food: { hunger: 4, saturation: 9.6, always: true, effects: [['regeneration', 5, 1, 2]] } });
item(267, 'porkchop', '生猪排', { food: { hunger: 3, saturation: 1.8 } });
item(268, 'cooked_porkchop', '熟猪排', { food: { hunger: 8, saturation: 12.8 } });
item(269, 'beef', '生牛肉', { food: { hunger: 3, saturation: 1.8 } });
item(270, 'steak', '牛排', { food: { hunger: 8, saturation: 12.8 } });
item(271, 'mutton', '生羊肉', { food: { hunger: 2, saturation: 1.2 } });
item(272, 'cooked_mutton', '熟羊肉', { food: { hunger: 6, saturation: 9.6 } });
item(273, 'rotten_flesh', '腐肉', { food: { hunger: 4, saturation: 0.8, effects: [['hunger', 30, 0.8]] } });
item(274, 'gunpowder', '火药');
item(275, 'leather', '皮革');
item(276, 'clay_ball', '黏土球');
item(277, 'brick', '红砖');
item(279, 'flint', '燧石');
item(280, 'wheat_seeds', '小麦种子', { placeBlock: 57 });
item(282, 'wheat', '小麦');
item(283, 'bread', '面包', { food: { hunger: 5, saturation: 6 } });
item(284, 'bone', '骨头');
item(285, 'bone_meal', '骨粉');
item(286, 'string', '线');
item(287, 'feather', '羽毛');
item(288, 'arrow', '箭');
item(289, 'bow', '弓', { stack: 1, durability: 384, bow: true });
item(290, 'egg', '鸡蛋', { stack: 16, throwable: 'egg' });
item(291, 'chicken', '生鸡肉', { food: { hunger: 2, saturation: 1.2, effects: [['hunger', 30, 0.3]] } });
item(292, 'cooked_chicken', '熟鸡肉', { food: { hunger: 6, saturation: 7.2 } });
item(293, 'spider_eye', '蜘蛛眼', { food: { hunger: 2, saturation: 3.2, effects: [['poison', 5, 1]] } });
item(294, 'paper', '纸');
item(295, 'book', '书');
item(296, 'snowball', '雪球', { stack: 16, throwable: 'snowball' });
item(297, 'bowl', '碗');
item(330, 'lapis_lazuli', '青金石');
item(331, 'redstone', '红石粉');
item(332, 'emerald', '绿宝石');
item(298, 'mushroom_stew', '蘑菇煲', { stack: 1, food: { hunger: 6, saturation: 7.2, leaves: 297 } });

export const TOOL_MATERIALS = [
  { key: 'wooden', name: '木', tier: 0, speed: 2, durability: 59, color: [150, 116, 65] },
  { key: 'stone', name: '石', tier: 1, speed: 4, durability: 131, color: [127, 127, 127] },
  { key: 'iron', name: '铁', tier: 2, speed: 6, durability: 250, color: [216, 216, 216] },
  { key: 'golden', name: '金', tier: 0, speed: 12, durability: 32, color: [250, 220, 70] },
  { key: 'diamond', name: '钻石', tier: 3, speed: 8, durability: 1561, color: [80, 230, 220] },
];
// Attack damage and attack speed (swings per second) per material (wooden, stone, iron, golden,
// diamond), Minecraft 1.9+ values.
export const TOOL_TYPES = [
  { key: 'pickaxe', name: '镐', damage: [2, 3, 4, 2, 5], attackSpeed: [1.2, 1.2, 1.2, 1.2, 1.2] },
  { key: 'axe', name: '斧', damage: [7, 9, 9, 7, 9], attackSpeed: [0.8, 0.8, 0.9, 1.0, 1.0] },
  { key: 'shovel', name: '锹', damage: [2.5, 3.5, 4.5, 2.5, 5.5], attackSpeed: [1, 1, 1, 1, 1] },
  { key: 'sword', name: '剑', damage: [4, 5, 6, 4, 7], attackSpeed: [1.6, 1.6, 1.6, 1.6, 1.6] },
  { key: 'hoe', name: '锄', damage: [1, 1, 1, 1, 1], attackSpeed: [1, 2, 3, 1, 4] },
];
export const HAND_ATTACK_SPEED = 4;

export function toolId(material, type) {
  const mi = TOOL_MATERIALS.findIndex((m) => m.key === material);
  const ti = TOOL_TYPES.findIndex((t) => t.key === type);
  return 300 + mi * 5 + ti;
}

TOOL_MATERIALS.forEach((m, mi) => {
  TOOL_TYPES.forEach((t, ti) => {
    item(300 + mi * 5 + ti, `${m.key}_${t.key}`, `${m.name}${t.name}`, {
      stack: 1,
      tool: {
        type: t.key,
        material: m.key,
        tier: m.tier,
        speed: m.speed,
        durability: m.durability,
        damage: t.damage[mi],
        attackSpeed: t.attackSpeed[mi],
      },
    });
  });
});

// Armour: helmet, chestplate, leggings, boots for each material (ids 350 + material * 4 + slot).
export const ARMOR_MATERIALS = [
  { key: 'leather', name: '皮革', mult: 5, points: [1, 3, 2, 1], toughness: 0, color: [160, 101, 64] },
  { key: 'iron', name: '铁', mult: 15, points: [2, 6, 5, 2], toughness: 0, color: [216, 216, 216] },
  { key: 'golden', name: '金', mult: 7, points: [2, 5, 3, 1], toughness: 0, color: [247, 220, 80] },
  { key: 'diamond', name: '钻石', mult: 33, points: [3, 8, 6, 3], toughness: 2, color: [93, 226, 230] },
];
export const ARMOR_SLOTS = [
  { key: 'helmet', name: '头盔', leather: '帽子', base: 11 },
  { key: 'chestplate', name: '胸甲', leather: '外套', base: 16 },
  { key: 'leggings', name: '护腿', leather: '裤子', base: 15 },
  { key: 'boots', name: '靴子', leather: '靴子', base: 13 },
];

export function armorId(material, slot) {
  const mi = ARMOR_MATERIALS.findIndex((m) => m.key === material);
  const si = ARMOR_SLOTS.findIndex((t) => t.key === slot);
  return 350 + mi * 4 + si;
}

ARMOR_MATERIALS.forEach((m, mi) => {
  ARMOR_SLOTS.forEach((t, si) => {
    item(350 + mi * 4 + si, `${m.key}_${t.key}`, `${m.name}${mi === 0 ? t.leather : t.name}`, {
      stack: 1,
      durability: t.base * m.mult,
      armor: { slot: si, points: m.points[si], toughness: m.toughness, material: m.key },
    });
  });
});

export const I = Object.fromEntries(Object.values(ITEMS).map((it) => [it.key.toUpperCase(), it.id]));

// Furnace fuel burn times in ticks.
export const FUEL = {
  [I.COAL]: 1600,
  [I.CHARCOAL]: 1600,
  [I.COAL_BLOCK]: 16000,
  [I.LAVA_BUCKET]: 20000,
  [I.STICK]: 100,
  [I.OAK_SAPLING]: 100,
  [I.BIRCH_SAPLING]: 100,
  [I.SPRUCE_SAPLING]: 100,
  [I.ACACIA_SAPLING]: 100,
  [I.JUNGLE_SAPLING]: 100,
  [I.DARK_OAK_SAPLING]: 100,
};
for (const key of ['oak_planks', 'birch_planks', 'spruce_planks', 'acacia_planks', 'jungle_planks', 'dark_oak_planks', 'oak_log', 'birch_log',
  'spruce_log', 'acacia_log', 'jungle_log', 'dark_oak_log', 'crafting_table', 'chest']) {
  FUEL[I[key.toUpperCase()]] = 300;
}
for (const t of TOOL_TYPES) FUEL[toolId('wooden', t.key)] = 200;
FUEL[I.BOW] = 300;

export function getItem(id) {
  return ITEMS[id] || null;
}

export function maxStack(id) {
  const it = ITEMS[id];
  return it ? it.stack : 64;
}

export function itemName(id) {
  const it = ITEMS[id];
  return it ? it.name : '未知物品';
}

export function makeStack(id, count = 1, damage = 0) {
  return { id, count, damage };
}

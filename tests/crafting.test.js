import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRecipe, SMELTING } from '../src/crafting.js';
import { I, toolId } from '../src/items.js';

const s = (id, count = 1) => ({ id, count, damage: 0 });

test('log becomes 4 planks anywhere in the grid', () => {
  const grid = [null, null, null, s(I.BIRCH_LOG)];
  assert.deepEqual(findRecipe(grid, 2), { id: I.BIRCH_PLANKS, count: 4 });
});

test('sticks and crafting table', () => {
  assert.deepEqual(findRecipe([s(I.OAK_PLANKS), null, s(I.SPRUCE_PLANKS), null], 2), { id: I.STICK, count: 4 });
  assert.deepEqual(findRecipe([s(I.OAK_PLANKS), s(I.OAK_PLANKS), s(I.OAK_PLANKS), s(I.OAK_PLANKS)], 2), { id: I.CRAFTING_TABLE, count: 1 });
});

test('pickaxe needs a 3x3 grid and exact shape', () => {
  const P = s(I.COBBLESTONE);
  const S = s(I.STICK);
  const grid = [P, P, P, null, S, null, null, S, null];
  assert.deepEqual(findRecipe(grid, 3), { id: toolId('stone', 'pickaxe'), count: 1 });
  const hoe = [P, P, null, null, S, null, null, S, null];
  assert.equal(findRecipe(hoe, 3).id, toolId('stone', 'hoe'));
  const wrong = [P, null, P, null, S, null, null, S, null];
  assert.equal(findRecipe(wrong, 3), null);
});

test('mirrored axe recipe works', () => {
  const X = s(I.IRON_INGOT);
  const S = s(I.STICK);
  const left = [X, X, null, X, S, null, null, S, null];
  const right = [null, X, X, null, S, X, null, S, null];
  assert.equal(findRecipe(left, 3).id, toolId('iron', 'axe'));
  assert.equal(findRecipe(right, 3).id, toolId('iron', 'axe'));
});

test('torch accepts coal or charcoal', () => {
  assert.deepEqual(findRecipe([s(I.CHARCOAL), null, s(I.STICK), null], 2), { id: I.TORCH, count: 4 });
});

test('furnace smelting table', () => {
  assert.equal(SMELTING[I.IRON_ORE], I.IRON_INGOT);
  assert.equal(SMELTING[I.SAND], I.GLASS);
  assert.equal(SMELTING[I.BEEF], I.STEAK);
});

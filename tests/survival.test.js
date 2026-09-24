import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player, xpToNextLevel } from '../src/entity/player.js';
import { splitXp } from '../src/entity/xporbs.js';
import { findRecipe } from '../src/crafting.js';
import { I, armorId, getItem } from '../src/items.js';

const fakeGame = () => ({ sound: () => {}, onPlayerDeath: () => {} });
const s = (id, count = 1) => ({ id, count, damage: 0 });

test('experience levels follow Minecraft costs', () => {
  assert.equal(xpToNextLevel(0), 7);
  assert.equal(xpToNextLevel(15), 37);
  assert.equal(xpToNextLevel(30), 112);
  const p = new Player(fakeGame());
  p.addXp(7);
  assert.equal(p.xpLevel, 1);
  assert.ok(p.xpProgress < 1e-9);
  p.addXp(9 + 11); // levels 1->2 (9) and 2->3 (11)
  assert.equal(p.xpLevel, 3);
  assert.equal(p.score, 27);
  assert.equal(p.deathXp(), 21);
});

test('orb values split like Minecraft', () => {
  assert.deepEqual(splitXp(5), [3, 1, 1]);
  assert.deepEqual(splitXp(20), [17, 3]);
  assert.equal(splitXp(100).reduce((a, b) => a + b, 0), 100);
});

test('armour reduces damage with the 1.9 formula and wears down', () => {
  const p = new Player(fakeGame());
  p.armor = [s(armorId('diamond', 'helmet')), s(armorId('diamond', 'chestplate')), s(armorId('diamond', 'leggings')), s(armorId('diamond', 'boots'))];
  assert.equal(p.armorPoints(), 20);
  p.damage(10, 'mob');
  // 20 armour, 8 toughness: min(20, max(4, 20 - 10 / 4)) = 17.5 -> 70% absorbed.
  assert.ok(Math.abs(p.health - 17) < 1e-6, `health ${p.health}`);
  assert.equal(p.armor[1].damage, 2);
  p.invulnerable = 0;
  p.damage(5, 'fall'); // fall damage ignores armour
  assert.ok(Math.abs(p.health - 12) < 1e-6);
});

test('poison hurts but never kills; regeneration heals', () => {
  const p = new Player(fakeGame());
  p.health = 3;
  p.addEffect('poison', 10);
  for (let i = 0; i < 200; i++) { p.invulnerable = 0; p.tickEffects(); }
  assert.equal(p.health, 1);
  p.addEffect('regeneration', 5, 2);
  for (let i = 0; i < 100; i++) p.tickEffects();
  assert.ok(p.health >= 4);
});

test('bow, arrows, armour and bone meal recipes', () => {
  const S = s(I.STICK);
  const T = s(I.STRING);
  assert.equal(findRecipe([null, S, T, S, null, T, null, S, T], 3).id, I.BOW);
  assert.deepEqual(findRecipe([s(I.FLINT), null, null, S, null, null, s(I.FEATHER), null, null], 3), { id: I.ARROW, count: 4 });
  const L = s(I.LEATHER);
  assert.equal(findRecipe([L, null, L, L, L, L, L, L, L], 3).id, armorId('leather', 'chestplate'));
  assert.equal(findRecipe([s(I.IRON_INGOT), null, s(I.IRON_INGOT), s(I.IRON_INGOT), null, s(I.IRON_INGOT), null, null, null], 3).id, armorId('iron', 'boots'));
  assert.deepEqual(findRecipe([s(I.BONE), null, null, null], 2), { id: I.BONE_MEAL, count: 3 });
  assert.equal(getItem(armorId('diamond', 'chestplate')).durability, 528);
});

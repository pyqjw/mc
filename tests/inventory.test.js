import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, clickSlot, moveInto } from '../src/inventory.js';
import { I, toolId } from '../src/items.js';

test('add merges stacks and respects max stack size', () => {
  const inv = new Inventory(36);
  assert.equal(inv.add({ id: I.DIRT, count: 40 }), 0);
  assert.equal(inv.add({ id: I.DIRT, count: 40 }), 0);
  assert.equal(inv.slots[0].count, 64);
  assert.equal(inv.slots[1].count, 16);
  inv.add({ id: toolId('iron', 'pickaxe'), count: 1 });
  inv.add({ id: toolId('iron', 'pickaxe'), count: 1 });
  assert.equal(inv.slots[2].count, 1);
  assert.equal(inv.slots[3].count, 1);
});

test('full inventory returns leftovers', () => {
  const inv = new Inventory(2);
  assert.equal(inv.add({ id: I.STONE, count: 200 }), 72);
});

test('left and right click semantics', () => {
  const slots = [{ id: I.COBBLESTONE, count: 10, damage: 0 }, null];
  let cursor = clickSlot(slots, 0, null, 1); // right click: take half
  assert.equal(cursor.count, 5);
  assert.equal(slots[0].count, 5);
  cursor = clickSlot(slots, 1, cursor, 1); // right click: place one
  assert.equal(slots[1].count, 1);
  assert.equal(cursor.count, 4);
  cursor = clickSlot(slots, 0, cursor, 0); // left click: merge
  assert.equal(cursor, null);
  assert.equal(slots[0].count, 9);
});

test('tools wear out and break', () => {
  const inv = new Inventory(9);
  inv.add({ id: toolId('wooden', 'pickaxe'), count: 1 });
  let broke = false;
  for (let i = 0; i < 59 && !broke; i++) broke = inv.damageHand(1);
  assert.ok(broke);
  assert.equal(inv.hand, null);
});

test('moveInto fills existing stacks first', () => {
  const slots = [null, { id: I.SAND, count: 60, damage: 0 }, null];
  const left = moveInto(slots, 0, 3, { id: I.SAND, count: 10, damage: 0 });
  assert.equal(left, null);
  assert.equal(slots[1].count, 64);
  assert.equal(slots[0].count, 6);
});

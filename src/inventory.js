// Item stacks, the player inventory and slot click behaviour (Minecraft rules).
import { maxStack, getItem } from './items.js';

export function sameItem(a, b) {
  return !!a && !!b && a.id === b.id && (a.damage || 0) === (b.damage || 0) && maxStack(a.id) > 1;
}

export function cloneStack(s) {
  return s ? { id: s.id, count: s.count, damage: s.damage || 0 } : null;
}

export class Inventory {
  constructor(size = 36) {
    this.slots = new Array(size).fill(null);
    this.selected = 0;
  }

  // Adds a stack; returns the number of items that did not fit.
  add(stack) {
    let left = stack.count;
    const max = maxStack(stack.id);
    if (max > 1) {
      for (let i = 0; i < this.slots.length && left > 0; i++) {
        const s = this.slots[i];
        if (s && sameItem(s, stack) && s.count < max) {
          const n = Math.min(max - s.count, left);
          s.count += n;
          left -= n;
        }
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(max, left);
        this.slots[i] = { id: stack.id, count: n, damage: stack.damage || 0 };
        left -= n;
      }
    }
    return left;
  }

  canFit(stack) {
    let room = 0;
    const max = maxStack(stack.id);
    for (const s of this.slots) {
      if (!s) room += max;
      else if (sameItem(s, stack)) room += max - s.count;
      if (room >= stack.count) return true;
    }
    return false;
  }

  get hand() {
    return this.slots[this.selected];
  }

  consumeHand(n = 1) {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
  }

  // Applies tool wear; returns true if the tool broke.
  damageHand(amount = 1) {
    const s = this.slots[this.selected];
    if (!s) return false;
    const it = getItem(s.id);
    if (!it || !it.tool) return false;
    s.damage = (s.damage || 0) + amount;
    if (s.damage >= it.tool.durability) {
      this.slots[this.selected] = null;
      return true;
    }
    return false;
  }

  toJSON() {
    return this.slots.map(cloneStack);
  }

  load(arr) {
    this.slots = this.slots.map((_, i) => cloneStack(arr && arr[i]));
  }
}

// Standard left/right click on a slot. `slots` is an array, `i` the index, `cursor` the carried stack.
// Returns the new cursor. `accept(stack)` decides if a stack may be placed in the slot.
export function clickSlot(slots, i, cursor, button, accept = () => true) {
  const s = slots[i];
  if (button === 0) {
    if (!cursor) {
      slots[i] = null;
      return s;
    }
    if (!accept(cursor)) return cursor;
    if (!s) {
      slots[i] = cursor;
      return null;
    }
    if (sameItem(s, cursor)) {
      const max = maxStack(s.id);
      const n = Math.min(max - s.count, cursor.count);
      s.count += n;
      cursor.count -= n;
      return cursor.count > 0 ? cursor : null;
    }
    slots[i] = cursor;
    return s;
  }
  // right click
  if (!cursor) {
    if (!s) return null;
    const take = Math.ceil(s.count / 2);
    s.count -= take;
    if (s.count <= 0) slots[i] = null;
    return { id: s.id, count: take, damage: s.damage || 0 };
  }
  if (!accept(cursor)) return cursor;
  if (!s) {
    slots[i] = { id: cursor.id, count: 1, damage: cursor.damage || 0 };
    cursor.count--;
    return cursor.count > 0 ? cursor : null;
  }
  if (sameItem(s, cursor) && s.count < maxStack(s.id)) {
    s.count++;
    cursor.count--;
    return cursor.count > 0 ? cursor : null;
  }
  slots[i] = cursor;
  return s;
}

// Moves a stack into a range of slots (shift-click). Returns what is left (or null).
export function moveInto(slots, from, to, stack, accept = () => true) {
  if (!stack || !accept(stack)) return stack;
  const max = maxStack(stack.id);
  if (max > 1) {
    for (let i = from; i < to && stack.count > 0; i++) {
      const s = slots[i];
      if (s && sameItem(s, stack) && s.count < max) {
        const n = Math.min(max - s.count, stack.count);
        s.count += n;
        stack.count -= n;
      }
    }
  }
  for (let i = from; i < to && stack.count > 0; i++) {
    if (!slots[i]) {
      slots[i] = { id: stack.id, count: stack.count, damage: stack.damage || 0 };
      stack.count = 0;
    }
  }
  return stack.count > 0 ? stack : null;
}

// Inventory / crafting table / furnace / chest screens plus pause and death menus.
import { renderStack } from './hud.js';
import { iconURL, isIsoIcon } from './icons.js';
import { clickSlot, moveInto, sameItem, cloneStack } from '../inventory.js';
import { findRecipe, RECIPES, SMELTING } from '../crafting.js';
import { FUEL, getItem, itemName, maxStack } from '../items.js';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export class Screens {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('screen');
    this.pauseEl = document.getElementById('pause');
    this.deathEl = document.getElementById('death');
    this.cursorEl = document.getElementById('cursor-item');
    this.tooltipEl = document.getElementById('tooltip');
    this.current = null;
    this.cursor = null;
    this.hover = null;
    this.slotEls = [];
    this.mouse = { x: 0, y: 0 };
    this.onMouseMove = (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.positionFloating();
    };
    window.addEventListener('mousemove', this.onMouseMove);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  destroy() {
    window.removeEventListener('mousemove', this.onMouseMove);
    this.root.innerHTML = '';
    this.root.style.display = 'none';
  }

  get isOpen() {
    return this.current !== null;
  }

  get inv() {
    return this.game.player.inventory;
  }

  positionFloating() {
    this.cursorEl.style.left = `${this.mouse.x}px`;
    this.cursorEl.style.top = `${this.mouse.y}px`;
    this.tooltipEl.style.left = `${this.mouse.x + 14}px`;
    this.tooltipEl.style.top = `${this.mouse.y - 28}px`;
  }

  // ------------------------------------------------------------ building blocks
  invDesc(i) {
    const inv = this.inv;
    return { get: () => inv.slots[i], set: (s) => { inv.slots[i] = s; }, group: i < 9 ? 'hotbar' : 'main', index: i };
  }

  arrDesc(arr, i, group, accept) {
    return { get: () => arr[i], set: (s) => { arr[i] = s; }, group, accept, index: i };
  }

  slot(parent, desc) {
    const e = el('div', 'slot', parent);
    e.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      this.onSlotClick(desc, ev.button, ev.shiftKey);
    });
    e.addEventListener('mouseenter', () => { this.hover = desc; this.updateTooltip(); });
    e.addEventListener('mouseleave', () => { if (this.hover === desc) this.hover = null; this.updateTooltip(); });
    this.slotEls.push([e, desc]);
    return e;
  }

  playerGrid(parent) {
    const main = el('div', 'grid cols9', parent);
    for (let i = 9; i < 36; i++) this.slot(main, this.invDesc(i));
    el('div', 'gap', parent);
    const hot = el('div', 'grid cols9', parent);
    for (let i = 0; i < 9; i++) this.slot(hot, this.invDesc(i));
  }

  panel(title) {
    this.root.innerHTML = '';
    this.slotEls = [];
    const panel = el('div', 'panel', this.root);
    el('div', 'panel-title', panel, title);
    return panel;
  }

  craftingArea(parent, size) {
    this.craftSize = size;
    this.craftGrid = new Array(size * size).fill(null);
    this.craftResult = null;
    const row = el('div', 'craft-row', parent);
    const grid = el('div', `grid cols${size}`, row);
    for (let i = 0; i < size * size; i++) this.slot(grid, this.arrDesc(this.craftGrid, i, 'craft'));
    el('div', 'arrow', row);
    const out = this.slot(row, { get: () => this.craftResult, output: 'craft', group: 'output' });
    out.classList.add('big');
    return row;
  }

  // ------------------------------------------------------------ screens
  open(kind, data) {
    if (this.current) this.close();
    this.current = { kind, data };
    this.root.style.display = 'flex';
    if (kind === 'inventory') {
      const p = this.panel('物品栏');
      const top = el('div', 'inv-top', p);
      const preview = el('div', 'player-preview', top);
      preview.innerHTML = '<div class="pp-head"></div><div class="pp-body"></div><div class="pp-legs"></div>';
      const craftBox = el('div', 'craft-box', top);
      el('div', 'label', craftBox, '合成');
      this.craftingArea(craftBox, 2);
      const book = el('button', 'mc-btn small', craftBox, '合成指南');
      book.addEventListener('click', () => this.toggleRecipeBook());
      this.playerGrid(p);
    } else if (kind === 'crafting') {
      const p = this.panel('工作台');
      this.craftingArea(p, 3);
      const book = el('button', 'mc-btn small', p, '合成指南');
      book.addEventListener('click', () => this.toggleRecipeBook());
      el('div', 'label', p, '物品栏');
      this.playerGrid(p);
    } else if (kind === 'furnace') {
      const tile = data.tile;
      const p = this.panel('熔炉');
      const f = el('div', 'furnace', p);
      const col = el('div', 'furnace-col', f);
      this.slot(col, this.arrDesc(tile.items, 0, 'container'));
      this.flame = el('div', 'flame', col);
      el('div', 'flame-fill', this.flame);
      this.slot(col, this.arrDesc(tile.items, 1, 'container', (s) => !!FUEL[s.id]));
      this.furnaceArrow = el('div', 'arrow progress', f);
      el('div', 'arrow-fill', this.furnaceArrow);
      const out = this.slot(f, { get: () => tile.items[2], set: (s) => { tile.items[2] = s; }, output: 'take', group: 'container' });
      out.classList.add('big');
      el('div', 'label', p, '物品栏');
      this.playerGrid(p);
    } else if (kind === 'chest') {
      const p = this.panel('箱子');
      const g = el('div', 'grid cols9', p);
      for (let i = 0; i < 27; i++) this.slot(g, this.arrDesc(data.tile.items, i, 'container'));
      el('div', 'label', p, '物品栏');
      this.playerGrid(p);
    }
    this.render();
  }

  close() {
    if (!this.current) return;
    // Return crafting grid and cursor items to the inventory (or drop them).
    const giveBack = (s) => {
      if (!s) return;
      const left = this.inv.add(s);
      if (left > 0) this.game.dropFromPlayer({ id: s.id, count: left, damage: s.damage });
    };
    if (this.craftGrid) this.craftGrid.forEach(giveBack);
    giveBack(this.cursor);
    this.craftGrid = null;
    this.craftResult = null;
    this.cursor = null;
    this.hover = null;
    this.current = null;
    this.root.innerHTML = '';
    this.root.style.display = 'none';
    this.cursorEl.innerHTML = '';
    this.tooltipEl.style.display = 'none';
    this.recipeBook = null;
  }

  // ------------------------------------------------------------ interaction
  onSlotClick(desc, button, shift) {
    if (button !== 0 && button !== 2) return;
    this.game.sound('click');
    if (desc.output === 'craft') this.takeCraftResult(shift);
    else if (desc.output === 'take') this.takeOutput(desc, shift);
    else if (shift) this.quickMove(desc);
    else {
      const arr = [desc.get()];
      this.cursor = clickSlot(arr, 0, this.cursor, button === 0 ? 0 : 1, desc.accept || (() => true));
      desc.set(arr[0]);
    }
    this.afterChange();
  }

  afterChange() {
    if (this.craftGrid) this.craftResult = findRecipe(this.craftGrid, this.craftSize);
    this.render();
  }

  consumeCraft() {
    for (let i = 0; i < this.craftGrid.length; i++) {
      const s = this.craftGrid[i];
      if (!s) continue;
      s.count--;
      if (s.count <= 0) this.craftGrid[i] = null;
    }
  }

  takeCraftResult(shift) {
    let res = this.craftResult;
    if (!res) return;
    if (shift) {
      for (let n = 0; n < 64 && res; n++) {
        if (!this.inv.canFit(res)) break;
        this.inv.add({ ...res, damage: 0 });
        this.consumeCraft();
        res = findRecipe(this.craftGrid, this.craftSize);
      }
      return;
    }
    if (!this.cursor) {
      this.cursor = { ...res, damage: 0 };
    } else if (sameItem(this.cursor, { ...res, damage: 0 }) && this.cursor.count + res.count <= maxStack(res.id)) {
      this.cursor.count += res.count;
    } else {
      return;
    }
    this.consumeCraft();
  }

  takeOutput(desc, shift) {
    const s = desc.get();
    if (!s) return;
    if (shift) {
      const left = this.inv.add(s);
      desc.set(left > 0 ? { ...s, count: left } : null);
      return;
    }
    if (!this.cursor) {
      this.cursor = s;
      desc.set(null);
    } else if (sameItem(this.cursor, s) && this.cursor.count + s.count <= maxStack(s.id)) {
      this.cursor.count += s.count;
      desc.set(null);
    }
  }

  quickMove(desc) {
    const stack = cloneStack(desc.get());
    if (!stack) return;
    const inv = this.inv.slots;
    const kind = this.current.kind;
    let left = stack;
    const toPlayer = (s) => {
      let r = moveInto(inv, 9, 36, s);
      if (r) r = moveInto(inv, 0, 9, r);
      return r;
    };
    if (desc.group === 'craft' || desc.group === 'container') {
      left = toPlayer(stack);
    } else if (kind === 'chest') {
      left = moveInto(this.current.data.tile.items, 0, 27, stack);
    } else if (kind === 'furnace') {
      const items = this.current.data.tile.items;
      if (SMELTING[stack.id] !== undefined) left = moveInto(items, 0, 1, stack);
      else if (FUEL[stack.id]) left = moveInto(items, 1, 2, stack);
      else left = desc.group === 'hotbar' ? moveInto(inv, 9, 36, stack) : moveInto(inv, 0, 9, stack);
    } else if (desc.group === 'hotbar') {
      left = moveInto(inv, 9, 36, stack);
    } else {
      left = moveInto(inv, 0, 9, stack);
    }
    desc.set(left);
  }

  // Number keys swap the hovered slot with a hotbar slot; Q drops from it.
  onKey(e) {
    if (!this.current) return false;
    if (e.code === 'KeyE' || e.code === 'Escape') {
      return 'close';
    }
    const h = this.hover;
    if (!h || h.output) return true;
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m) {
      const i = Number(m[1]) - 1;
      const a = h.get();
      const b = this.inv.slots[i];
      if (h.accept && b && !h.accept(b)) return true;
      h.set(b);
      this.inv.slots[i] = a;
      this.afterChange();
    } else if (e.code === 'KeyQ') {
      const s = h.get();
      if (s) {
        const n = e.ctrlKey ? s.count : 1;
        this.game.dropFromPlayer({ id: s.id, count: n, damage: s.damage });
        s.count -= n;
        if (s.count <= 0) h.set(null);
        this.afterChange();
      }
    }
    return true;
  }

  // ------------------------------------------------------------ rendering
  render() {
    for (const [e, d] of this.slotEls) renderStack(e, d.get());
    if (this.cursor) {
      if (!this.cursorEl.firstChild) el('div', 'slot floating', this.cursorEl);
      renderStack(this.cursorEl.firstChild, this.cursor);
    } else {
      this.cursorEl.innerHTML = '';
    }
    this.updateTooltip();
  }

  updateTooltip() {
    const s = this.hover && !this.cursor ? this.hover.get() : null;
    if (!s) {
      this.tooltipEl.style.display = 'none';
      return;
    }
    const it = getItem(s.id);
    let text = itemName(s.id);
    if (it && it.tool) text += `\n耐久: ${it.tool.durability - (s.damage || 0)} / ${it.tool.durability}`;
    if (it && it.food) text += `\n饥饿值 +${it.food.hunger}`;
    this.tooltipEl.textContent = text;
    this.tooltipEl.style.display = 'block';
  }

  // Called every frame while a screen is open.
  update() {
    if (!this.current) return;
    if (this.current.kind === 'furnace') {
      const t = this.current.data.tile;
      this.flame.firstChild.style.height = `${t.burnMax ? (t.burn / t.burnMax) * 100 : 0}%`;
      this.furnaceArrow.firstChild.style.width = `${(t.cook / 200) * 100}%`;
      for (const [e, d] of this.slotEls) renderStack(e, d.get());
    }
  }

  toggleRecipeBook() {
    if (this.recipeBook) {
      this.recipeBook.remove();
      this.recipeBook = null;
      return;
    }
    const book = el('div', 'recipe-book', this.root);
    this.recipeBook = book;
    el('div', 'panel-title', book, '合成指南（点击关闭）');
    const list = el('div', 'recipe-list', book);
    const shown = new Set();
    for (const r of RECIPES) {
      const key = `${r.result.id}:${r.type}`;
      if (shown.has(key)) continue;
      shown.add(key);
      const card = el('div', 'recipe', list);
      const g = el('div', 'mini-grid', card);
      const cells = new Array(9).fill(null);
      if (r.type === 'shaped') {
        for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) cells[y * 3 + x] = r.rows[y][x];
      } else {
        r.ings.forEach((ing, i) => { cells[i] = ing; });
      }
      for (const c of cells) {
        const cell = el('div', 'mini', g);
        if (c) {
          const img = el('img', isIsoIcon(c[0]) ? 'iso' : 'flat', cell);
          img.src = iconURL(c[0]);
          cell.title = itemName(c[0]);
        }
      }
      el('div', 'mini-arrow', card, '→');
      const out = el('div', 'mini big', card);
      const img = el('img', isIsoIcon(r.result.id) ? 'iso' : 'flat', out);
      img.src = iconURL(r.result.id);
      if (r.result.count > 1) el('span', 'count', out, String(r.result.count));
      card.title = itemName(r.result.id);
      el('div', 'recipe-name', card, itemName(r.result.id));
    }
    el('div', 'panel-title', book, '熔炉烧炼');
    const sl = el('div', 'recipe-list', book);
    for (const [from, to] of Object.entries(SMELTING)) {
      const card = el('div', 'recipe', sl);
      const a = el('div', 'mini big', card);
      el('img', isIsoIcon(+from) ? 'iso' : 'flat', a).src = iconURL(+from);
      el('div', 'mini-arrow', card, '🔥→');
      const b = el('div', 'mini big', card);
      el('img', isIsoIcon(to) ? 'iso' : 'flat', b).src = iconURL(to);
      el('div', 'recipe-name', card, itemName(to));
    }
    book.addEventListener('mousedown', (e) => { if (e.target === book || e.target.classList.contains('panel-title')) this.toggleRecipeBook(); });
  }
}

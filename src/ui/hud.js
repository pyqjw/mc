// In-game HUD laid out in GUI pixels like Minecraft: crosshair, hotbar, XP bar and level, health,
// hunger, armour and air rows, the selected item's name, chat messages and the F3 debug screen.
import { iconURL as itemIconURL, isIsoIcon } from './icons.js';
import { hotbarURL, selectorURL, xpBarURL, iconURL } from './gui.js';
import { getItem, itemName } from '../items.js';

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

export function renderStack(slotEl, stack) {
  let img = slotEl.querySelector('img');
  let cnt = slotEl.querySelector('.count');
  let dur = slotEl.querySelector('.dur');
  if (!img) {
    img = el('img', '', slotEl);
    img.draggable = false;
    cnt = el('span', 'count', slotEl);
    dur = el('div', 'dur', slotEl);
    el('div', '', dur);
  }
  const key = stack ? `${stack.id}:${stack.count}:${stack.damage || 0}` : '';
  if (slotEl.dataset.key === key) return;
  slotEl.dataset.key = key;
  if (!stack) {
    img.style.display = 'none';
    cnt.textContent = '';
    dur.style.display = 'none';
    return;
  }
  img.style.display = '';
  img.src = itemIconURL(stack.id);
  img.className = isIsoIcon(stack.id) ? 'iso' : 'flat';
  cnt.textContent = stack.count > 1 ? String(stack.count) : '';
  const it = getItem(stack.id);
  const maxDur = it && (it.tool ? it.tool.durability : it.durability);
  if (maxDur && stack.damage > 0) {
    const frac = 1 - stack.damage / maxDur;
    dur.style.display = '';
    const bar = dur.firstChild;
    bar.style.width = `${Math.max(1, Math.round(frac * 13)) * 100 / 13}%`;
    bar.style.background = `hsl(${Math.round(frac * 120)}, 100%, 50%)`;
  } else {
    dur.style.display = 'none';
  }
}

export class HUD {
  constructor(game) {
    this.game = game;
    const root = document.getElementById('hud');
    this.root = root;
    root.innerHTML = '';
    this.crosshair = el('div', 'crosshair', root);
    this.vignette = el('div', 'vignette', root);
    this.waterOverlay = el('div', 'water-overlay', root);
    this.sleepOverlay = el('div', 'sleep-overlay', root);
    const bottom = el('div', 'hud-bottom', root);
    this.itemName = el('div', 'item-name', bottom);

    const row = (cls) => {
      const r = el('div', `icon-row ${cls}`, bottom);
      const icons = [];
      for (let i = 0; i < 10; i++) icons.push(el('img', '', r));
      return { row: r, icons };
    };
    this.armorRow = row('armor');
    this.airRow = row('air');
    this.heartRow = row('hearts');
    this.foodRow = row('food');

    this.xp = el('div', 'xp-bar', bottom);
    this.xp.style.backgroundImage = `url(${xpBarURL(false)})`;
    this.xpFill = el('div', 'xp-fill', this.xp);
    this.xpFill.style.backgroundImage = `url(${xpBarURL(true)})`;
    this.xpLevel = el('div', 'xp-level', bottom);

    this.hotbar = el('div', 'hotbar', bottom);
    this.hotbar.style.backgroundImage = `url(${hotbarURL()})`;
    this.slots = [];
    for (let i = 0; i < 9; i++) {
      const s = el('div', 'hslot', this.hotbar);
      s.style.left = `calc(${3 + i * 20} * var(--u))`;
      this.slots.push(s);
    }
    this.selector = el('div', 'selector', this.hotbar);
    this.selector.style.backgroundImage = `url(${selectorURL()})`;

    this.messages = el('div', 'messages', root);
    this.debug = el('div', 'debug', root);
    this.debugLeft = el('div', 'debug-col', this.debug);
    this.debugRight = el('div', 'debug-col right', this.debug);
    this.debug.style.display = 'none';
    this.showDebug = false;
    this.itemNameTimer = 0;
    this.lastSelectedId = null;
    this.prev = {};
    this.flash = 0;
    this.hurtFlash = 0;
    this.lastHealth = null;
    this.ticker = 0;
  }

  message(text, seconds = 4) {
    const m = el('div', 'msg', this.messages);
    m.textContent = text;
    setTimeout(() => m.classList.add('fade'), seconds * 1000);
    setTimeout(() => m.remove(), seconds * 1000 + 800);
    while (this.messages.children.length > 8) this.messages.firstChild.remove();
  }

  flashHotbar() {
    this.flash = 0.1;
  }

  toggleDebug() {
    this.showDebug = !this.showDebug;
    this.debug.style.display = this.showDebug ? '' : 'none';
  }

  setIcon(img, src, dy = 0) {
    if (img.dataset.src !== src) {
      img.dataset.src = src;
      img.src = src;
    }
    const t = dy ? `translateY(calc(${dy} * var(--u)))` : '';
    if (img.style.transform !== t) img.style.transform = t;
  }

  update(dt) {
    const p = this.game.player;
    const inv = p.inventory;
    this.ticker += dt;
    for (let i = 0; i < 9; i++) renderStack(this.slots[i], inv.slots[i]);
    this.selector.style.left = `calc(${-1 + inv.selected * 20} * var(--u))`;

    const hand = inv.hand;
    const handId = hand ? hand.id : 0;
    if (handId !== this.lastSelectedId || inv.selected !== this.lastSelected) {
      this.lastSelectedId = handId;
      this.lastSelected = inv.selected;
      this.itemName.textContent = hand ? itemName(hand.id) : '';
      this.itemNameTimer = hand ? 2 : 0;
    }
    this.itemNameTimer -= dt;
    this.itemName.style.opacity = Math.max(0, Math.min(1, this.itemNameTimer));

    // Health: blink with white outlines after damage, shake when low, bounce while regenerating.
    const hp = Math.ceil(p.health);
    if (this.lastHealth !== null && hp < this.lastHealth) this.hurtFlash = 1;
    this.lastHealth = hp;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    const flash = this.hurtFlash > 0 && Math.floor(this.hurtFlash * 6.6) % 2 === 1;
    const tick = Math.floor(this.ticker * 20);
    const regen = p.regenTicks > 0 || (p.food >= 18 && p.health < 20);
    for (let i = 0; i < 10; i++) {
      const v = hp - i * 2;
      const state = v >= 2 ? 'full' : v === 1 ? 'half' : 'empty';
      let dy = 0;
      if (hp <= 4) dy = ((tick * 7 + i * 13) % 3) - 1;
      if (regen && p.regenTicks > 0 && i === tick % 25) dy -= 2;
      this.setIcon(this.heartRow.icons[i], iconURL('heart', state, flash), dy);
    }

    const food = p.food;
    for (let i = 0; i < 10; i++) {
      const v = food - i * 2;
      const state = v >= 2 ? 'full' : v === 1 ? 'half' : 'empty';
      const shake = p.saturation <= 0 && (tick + i * 7) % (food * 3 + 1) === 0 ? ((tick + i) % 3) - 1 : 0;
      this.setIcon(this.foodRow.icons[i], iconURL('food', state), shake);
    }

    const armor = p.armorPoints ? p.armorPoints() : 0;
    this.armorRow.row.style.visibility = armor > 0 ? 'visible' : 'hidden';
    if (armor > 0) {
      for (let i = 0; i < 10; i++) {
        const v = armor - i * 2;
        this.setIcon(this.armorRow.icons[i], iconURL('armor', v >= 2 ? 'full' : v === 1 ? 'half' : 'empty'));
      }
    }

    const air = p.air;
    const underwater = air < 300 || p.eyeFluid === 16;
    this.airRow.row.style.visibility = underwater ? 'visible' : 'hidden';
    if (underwater) {
      const full = Math.ceil((Math.max(0, air) - 2) / 30);
      const popping = Math.ceil(Math.max(0, air) / 30) - full;
      for (let i = 0; i < 10; i++) {
        const img = this.airRow.icons[i];
        img.style.visibility = i < full + popping ? 'visible' : 'hidden';
        this.setIcon(img, iconURL('bubble', i < full ? 'full' : 'empty'));
      }
    }

    const level = p.xpLevel || 0;
    const prog = p.xpProgress || 0;
    this.xpFill.style.width = `calc(${Math.floor(prog * 182)} * var(--u))`;
    const lvl = level > 0 ? String(level) : '';
    if (this.xpLevel.textContent !== lvl) this.xpLevel.textContent = lvl;

    this.vignette.style.opacity = p.hurtTime > 0 ? Math.min(0.6, p.hurtTime * 2) : 0;
    this.waterOverlay.style.opacity = p.eyeFluid ? 1 : 0;
    this.waterOverlay.style.background = p.eyeFluid === 17 ? 'rgba(255,90,0,0.55)' : 'rgba(20,60,200,0.25)';
    this.sleepOverlay.style.opacity = this.game.sleepFade || 0;
    if (this.flash > 0) this.flash -= dt;

    if (this.showDebug) {
      const [left, right] = this.game.debugText();
      this.fillDebug(this.debugLeft, left);
      this.fillDebug(this.debugRight, right);
    }
  }

  fillDebug(col, lines) {
    while (col.children.length < lines.length) el('div', 'debug-line', col);
    while (col.children.length > lines.length) col.lastChild.remove();
    lines.forEach((t, i) => {
      const line = col.children[i];
      if (line.textContent !== t) line.textContent = t;
      line.style.visibility = t ? 'visible' : 'hidden';
    });
  }
}

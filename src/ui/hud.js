// In-game HUD: crosshair, hotbar, health, hunger, air, messages and the F3 debug screen.
import { iconURL, isIsoIcon, hudSprite } from './icons.js';
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
  img.src = iconURL(stack.id);
  img.className = isIsoIcon(stack.id) ? 'iso' : 'flat';
  cnt.textContent = stack.count > 1 ? String(stack.count) : '';
  const it = getItem(stack.id);
  if (it && it.tool && stack.damage > 0) {
    const frac = 1 - stack.damage / it.tool.durability;
    dur.style.display = '';
    const bar = dur.firstChild;
    bar.style.width = `${Math.max(1, frac * 100)}%`;
    bar.style.background = `hsl(${Math.round(frac * 120)}, 100%, 45%)`;
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
    el('div', 'crosshair', root);
    this.vignette = el('div', 'vignette', root);
    this.waterOverlay = el('div', 'water-overlay', root);
    this.sleepOverlay = el('div', 'sleep-overlay', root);
    const bottom = el('div', 'hud-bottom', root);
    this.itemName = el('div', 'item-name', bottom);
    const stats = el('div', 'stats', bottom);
    const left = el('div', 'stats-left', stats);
    const right = el('div', 'stats-right', stats);
    this.bubbles = el('div', 'icon-row right', right);
    this.hearts = el('div', 'icon-row', left);
    this.food = el('div', 'icon-row right', right);
    this.heartEls = [];
    this.foodEls = [];
    this.bubbleEls = [];
    for (let i = 0; i < 10; i++) {
      this.heartEls.push(el('img', '', this.hearts));
      this.foodEls.push(el('img', '', this.food));
      this.bubbleEls.push(el('img', '', this.bubbles));
    }
    this.hotbar = el('div', 'hotbar', bottom);
    this.slots = [];
    for (let i = 0; i < 9; i++) this.slots.push(el('div', 'hslot', this.hotbar));
    this.selector = el('div', 'selector', this.hotbar);
    this.messages = el('div', 'messages', root);
    this.debug = el('div', 'debug', root);
    this.debug.style.display = 'none';
    this.showDebug = false;
    this.itemNameTimer = 0;
    this.lastSelectedId = null;
    this.prev = {};
    this.flash = 0;
  }

  message(text, seconds = 4) {
    const m = el('div', 'msg', this.messages);
    m.textContent = text;
    setTimeout(() => m.classList.add('fade'), seconds * 1000);
    setTimeout(() => m.remove(), seconds * 1000 + 800);
    while (this.messages.children.length > 6) this.messages.firstChild.remove();
  }

  flashHotbar() {
    this.flash = 0.1;
  }

  toggleDebug() {
    this.showDebug = !this.showDebug;
    this.debug.style.display = this.showDebug ? '' : 'none';
  }

  update(dt) {
    const p = this.game.player;
    const inv = p.inventory;
    for (let i = 0; i < 9; i++) renderStack(this.slots[i], inv.slots[i]);
    this.selector.style.transform = `translateX(calc(${inv.selected} * var(--slot)))`;

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

    const hp = Math.ceil(p.health);
    const food = p.food;
    const air = p.air;
    const lowHp = hp <= 4;
    if (this.prev.hp !== hp || lowHp) {
      this.prev.hp = hp;
      for (let i = 0; i < 10; i++) {
        const v = hp - i * 2;
        const e = this.heartEls[i];
        const src = hudSprite('heart', v >= 2 ? 'full' : v === 1 ? 'half' : 'empty');
        if (e.getAttribute('src') !== src) e.src = src;
        e.style.transform = lowHp ? `translateY(${Math.round(Math.random() * 2 - 1)}px)` : '';
      }
    }
    if (this.prev.food !== food) {
      this.prev.food = food;
      for (let i = 0; i < 10; i++) {
        const v = food - i * 2;
        this.foodEls[i].src = hudSprite('food', v >= 2 ? 'full' : v === 1 ? 'half' : 'empty');
      }
    }
    const underwater = air < 300;
    this.bubbles.style.visibility = underwater ? 'visible' : 'hidden';
    if (underwater) {
      const n = Math.ceil(Math.max(0, air) / 30);
      for (let i = 0; i < 10; i++) {
        this.bubbleEls[i].style.visibility = i < n ? 'visible' : 'hidden';
        if (!this.bubbleEls[i].src) this.bubbleEls[i].src = hudSprite('bubble', 'full');
      }
    }

    this.vignette.style.opacity = p.hurtTime > 0 ? Math.min(0.6, p.hurtTime * 2) : 0;
    this.waterOverlay.style.opacity = p.eyeFluid ? 1 : 0;
    this.waterOverlay.style.background = p.eyeFluid === 17 ? 'rgba(255,90,0,0.55)' : 'rgba(20,60,200,0.25)';
    this.sleepOverlay.style.opacity = this.game.sleepFade || 0;
    if (this.flash > 0) this.flash -= dt;

    if (this.showDebug) this.debug.textContent = this.game.debugText();
  }
}

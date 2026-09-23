// App shell: title screen, world selection, settings and starting / stopping game sessions.
import { Renderer } from './render/renderer.js';
import { getAtlasCanvas } from './render/textures.js';
import { Storage } from './storage.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { seedFromString } from './world/noise.js';

const $ = (id) => document.getElementById(id);

const DEFAULT_SETTINGS = { renderDistance: 6, fov: 70, sensitivity: 1, volume: 0.6, viewBobbing: true, hideHud: false };

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('webcraft-settings') || '{}');
    return { ...DEFAULT_SETTINGS, ...s, hideHud: false };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  try {
    localStorage.setItem('webcraft-settings', JSON.stringify(s));
  } catch {
    // storage may be unavailable (private mode); settings then last for this session only
  }
}

class App {
  constructor() {
    this.canvas = $('game');
    this.renderer = new Renderer(this.canvas);
    this.storage = new Storage();
    this.audio = new Audio();
    this.input = new Input(this.canvas);
    this.settings = loadSettings();
    this.audio.volume = this.settings.volume;
    this.game = null;
    this.setupTitleBackground();
    this.bindMenus();
    this.bindSettings();
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKey = (e) => this.onKey(e);
    this.canvas.addEventListener('mousedown', () => {
      this.audio.resume();
      if (this.game && !this.input.locked && !this.game.screens.isOpen && !this.game.player.dead) this.input.lock();
    });
    window.addEventListener('beforeunload', () => { if (this.game) this.game.save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.game) this.game.save(); });
    // Idle render of an empty sky behind the menus.
    this.renderer.updateSky(1000, 6, false, false);
    this.renderer.render();
  }

  setupTitleBackground() {
    const atlas = getAtlasCanvas();
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    c.getContext('2d').drawImage(atlas, 16, 0, 16, 16, 0, 0, 16, 16); // dirt tile
    document.documentElement.style.setProperty('--dirt', `url(${c.toDataURL()})`);
  }

  async init() {
    await this.storage.open();
  }

  show(id) {
    for (const s of ['title-main', 'title-worlds', 'title-create', 'title-help']) $(s).style.display = s === id ? '' : 'none';
    $('title').style.display = 'flex';
  }

  bindMenus() {
    $('btn-singleplayer').onclick = () => { this.audio.resume(); this.showWorlds(); };
    $('btn-help').onclick = () => this.show('title-help');
    $('btn-help-back').onclick = () => this.show('title-main');
    $('btn-back').onclick = () => this.show('title-main');
    $('btn-new-world').onclick = () => {
      $('new-name').value = '新的世界';
      $('new-seed').value = '';
      this.show('title-create');
    };
    $('btn-create-cancel').onclick = () => this.showWorlds();
    $('btn-create').onclick = () => this.createWorld();
    $('btn-resume').onclick = () => this.input.lock();
    $('btn-quit').onclick = () => this.quitToTitle();
    $('btn-respawn').onclick = () => this.game && this.game.respawn();
    $('btn-death-quit').onclick = () => this.quitToTitle();
  }

  bindSettings() {
    const s = this.settings;
    const bind = (id, lbl, get, set, fmt = (v) => v) => {
      const input = $(id);
      input.value = get();
      $(lbl).textContent = fmt(get());
      input.oninput = () => {
        set(Number(input.value));
        $(lbl).textContent = fmt(get());
        saveSettings(s);
      };
    };
    bind('set-rd', 'lbl-rd', () => s.renderDistance, (v) => {
      s.renderDistance = v;
      if (this.game) this.game.world.renderDistance = v;
    });
    bind('set-fov', 'lbl-fov', () => s.fov, (v) => { s.fov = v; });
    bind('set-sens', 'lbl-sens', () => Math.round(s.sensitivity * 100), (v) => { s.sensitivity = v / 100; });
    bind('set-vol', 'lbl-vol', () => Math.round(s.volume * 100), (v) => { s.volume = v / 100; this.audio.volume = s.volume; });
    const bob = $('set-bob');
    bob.checked = s.viewBobbing;
    bob.onchange = () => { s.viewBobbing = bob.checked; saveSettings(s); };
  }

  async showWorlds() {
    this.show('title-worlds');
    const list = $('world-list');
    list.innerHTML = '';
    const worlds = await this.storage.listWorlds();
    if (worlds.length === 0) {
      list.innerHTML = '<p class="hint">还没有世界，创建一个吧！</p>';
    }
    for (const w of worlds) {
      const row = document.createElement('div');
      row.className = 'world-row';
      const info = document.createElement('div');
      info.className = 'world-info';
      const name = document.createElement('b');
      name.textContent = w.name;
      const sub = document.createElement('small');
      const day = Math.floor((w.time || 0) / 24000) + 1;
      sub.textContent = `生存模式 · 第 ${day} 天 · 种子 ${w.seed} · ${w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : '未游玩'}`;
      info.append(name, sub);
      const play = document.createElement('button');
      play.className = 'mc-btn small';
      play.textContent = '进入';
      play.onclick = () => this.play(w);
      const del = document.createElement('button');
      del.className = 'mc-btn small danger';
      del.textContent = '删除';
      del.onclick = async () => {
        if (!window.confirm(`确定要删除世界「${w.name}」吗？此操作无法撤销！`)) return;
        await this.storage.deleteWorld(w.id);
        this.showWorlds();
      };
      row.append(info, play, del);
      list.appendChild(row);
    }
  }

  async createWorld() {
    const name = $('new-name').value.trim() || '新的世界';
    const seed = seedFromString($('new-seed').value);
    const meta = {
      id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      name,
      seed,
      created: Date.now(),
      lastPlayed: Date.now(),
      time: 1000,
    };
    await this.storage.putWorld(meta);
    this.play(meta);
  }

  async play(meta) {
    $('title').style.display = 'none';
    $('loading').style.display = 'flex';
    $('loading-text').textContent = '正在加载世界…';
    $('loading-bar').style.width = '0%';
    const game = new Game(this, this.renderer, this.storage, this.audio, this.input, this.settings);
    this.game = game;
    await game.load(meta);
    $('loading-text').textContent = '正在生成地形…';
    await game.waitForTerrain((p) => { $('loading-bar').style.width = `${Math.round(p * 100)}%`; });
    $('loading').style.display = 'none';
    game.start();
    game.hud.message('点击画面开始游戏。按 E 打开物品栏，F3 查看坐标。', 6);
    if (!meta.player) game.hud.message('提示：先徒手撸树获取原木吧！', 8);
    game.save();
    this.showPause(true);
  }

  async quitToTitle() {
    const game = this.game;
    this.game = null;
    $('pause').style.display = 'none';
    $('death').style.display = 'none';
    $('hud').innerHTML = '';
    if (game) await game.quit();
    this.renderer.updateSky(1000, 6, false, false);
    this.renderer.render();
    this.showWorlds();
  }

  showPause(show) {
    $('pause').style.display = show ? 'flex' : 'none';
    if (this.game) this.game.paused = show;
  }

  onLockChange(locked) {
    if (!this.game) return;
    if (locked) {
      this.showPause(false);
    } else if (!this.game.screens.isOpen && !this.game.player.dead) {
      this.showPause(true);
    }
  }

  onKey(e) {
    const game = this.game;
    if (!game) return;
    if (e.code === 'F3') { game.hud.toggleDebug(); e.preventDefault(); return; }
    if (e.code === 'F1') {
      this.settings.hideHud = !this.settings.hideHud;
      $('hud').style.display = this.settings.hideHud ? 'none' : '';
      e.preventDefault();
      return;
    }
    if (game.screens.isOpen) {
      const r = game.screens.onKey(e);
      if (r === 'close') {
        game.closeScreen();
        // Browsers refuse pointer lock right after Esc; fall back to the pause menu.
        setTimeout(() => {
          if (this.game && !this.input.locked && !game.screens.isOpen && !game.player.dead) this.showPause(true);
        }, 250);
      }
      return;
    }
    if (e.code === 'KeyE' && this.input.locked && !game.player.dead && !e.repeat) {
      game.openScreen('inventory');
    }
  }
}

const app = new App();
app.init().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal">启动失败：${e.message}</div>`);
});
window.app = app;

// App shell: title screen (with a live world panorama), world selection, options and starting /
// stopping game sessions.
import { Renderer } from './render/renderer.js';
import { getAtlasCanvas } from './render/textures.js';
import { Storage } from './storage.js';
import { Audio } from './audio/engine.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { World } from './world/world.js';
import { seedFromString } from './world/noise.js';
import { applyGuiScale, logoCanvas, noiseURL } from './ui/gui.js';
import { iconURL } from './ui/icons.js';
import { B } from './world/blocks.js';

const $ = (id) => document.getElementById(id);

const DEFAULT_SETTINGS = {
  renderDistance: 6, fov: 70, sensitivity: 1, volume: 0.7, music: 0.5, shaders: 'medium', viewBobbing: true, guiScale: 0, hideHud: false,
};

const SPLASHES = [
  '无限世界！', '方块！', '100% 纯像素！', '也试试原版吧！', '苦力怕！嘶嘶……', '不要往下直挖！', '钻石！', '天黑前要回家！',
  '浏览器里的沙盒！', '撸树！', '睡个好觉！', '小心熔岩！', '也有羊！', '由 Three.js 驱动！', '合成！', '看，一只猪！',
  '别吃腐肉！', '把火把插满墙！', '无需安装！', '种子无穷无尽！', '先做一把镐！', '僵尸怕太阳！', '工作台就是一切！',
];

const NULL_STORAGE = { chunkKeys: async () => [], getChunk: async () => null, putChunks: async () => {} };

// Option widgets shown on the options screen.
const OPTIONS = [
  { type: 'slider', key: 'fov', label: '视野', min: 30, max: 110, step: 1, fmt: (v) => (v === 70 ? '普通' : v === 110 ? '超广角' : v) },
  { type: 'slider', key: 'renderDistance', label: '渲染距离', min: 2, max: 16, step: 1, fmt: (v) => `${v} 区块` },
  { type: 'cycle', key: 'shaders', label: '光影', values: ['off', 'medium', 'high'], names: { off: '关（经典画面）', medium: '中', high: '高' } },
  { type: 'cycle', key: 'guiScale', label: '界面尺寸', values: [0, 1, 2, 3, 4, 5], names: { 0: '自动' } },
  { type: 'slider', key: 'sensitivity', label: '鼠标灵敏度', min: 20, max: 300, step: 5, scale: 100, fmt: (v) => `${v}%` },
  { type: 'toggle', key: 'viewBobbing', label: '视角摇晃' },
  { type: 'slider', key: 'volume', label: '主音量', min: 0, max: 100, step: 1, scale: 100, fmt: (v) => (v === 0 ? '关' : `${v}%`) },
  { type: 'slider', key: 'music', label: '音乐', min: 0, max: 100, step: 1, scale: 100, fmt: (v) => (v === 0 ? '关' : `${v}%`) },
];

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
    this.audio.musicVolume = this.settings.music;
    // Browsers only allow audio after a user gesture.
    const unlock = () => this.audio.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.game = null;
    this.panorama = null;
    this.selectedWorld = null;
    this.renderer.setQuality(this.settings.shaders);
    applyGuiScale(this.settings.guiScale);
    window.addEventListener('resize', () => applyGuiScale(this.settings.guiScale));
    this.setupTextures();
    this.bindMenus();
    this.buildOptions();
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKey = (e) => this.onKey(e);
    this.canvas.addEventListener('mousedown', () => {
      this.audio.resume();
      if (this.game && !this.input.locked && !this.game.screens.isOpen && !this.game.player.dead && !this.menuOpen()) this.input.lock();
    });
    window.addEventListener('beforeunload', () => { if (this.game) this.game.save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.game) this.game.save(); });
    this.showTitle();
  }

  setupTextures() {
    const atlas = getAtlasCanvas();
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    c.getContext('2d').drawImage(atlas, 16, 0, 16, 16, 0, 0, 16, 16); // dirt tile
    document.documentElement.style.setProperty('--dirt', `url(${c.toDataURL()})`);
    document.documentElement.style.setProperty('--noise', `url(${noiseURL()})`);
    const logo = logoCanvas();
    const el = $('logo');
    el.width = logo.width;
    el.height = logo.height;
    el.getContext('2d').drawImage(logo, 0, 0);
    el.style.width = `calc(${logo.width} * var(--u))`;
  }

  async init() {
    await this.storage.open();
  }

  // ------------------------------------------------------------ title & panorama
  showTitle() {
    this.show('title-main');
    $('splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
    this.startPanorama();
  }

  show(id) {
    for (const s of ['title-main', 'title-worlds', 'title-create']) $(s).style.display = s === id ? '' : 'none';
    const title = $('title');
    title.style.display = 'flex';
    title.classList.toggle('panorama', id === 'title-main');
    title.classList.toggle('dirt-bg', id !== 'title-main');
    for (const c of title.querySelectorAll('.corner')) c.style.display = id === 'title-main' ? '' : 'none';
  }

  // A slowly turning view over a fixed world behind the title screen, like Minecraft's panorama.
  startPanorama() {
    if (this.panorama || this.game) return;
    const world = new World({
      seed: seedFromString('webcraft'), worldId: '__panorama__', storage: NULL_STORAGE, scene: this.renderer.scene, materials: this.renderer.materials,
    });
    world.renderDistance = Math.min(5, this.settings.renderDistance);
    const spawn = world.generator.findSpawn();
    const pano = { world, x: spawn.x, y: spawn.y + 9, z: spawn.z, yaw: 0.6, last: performance.now() };
    this.panorama = pano;
    world.init().catch(() => {});
    const cam = this.renderer.camera;
    const loop = (now) => {
      if (this.panorama !== pano) return;
      const dt = Math.min(0.1, (now - pano.last) / 1000);
      pano.last = now;
      pano.yaw += dt * 0.025;
      world.update(pano.x, pano.z);
      cam.position.set(pano.x, pano.y, pano.z);
      cam.rotation.set(-0.12, pano.yaw, 0);
      cam.fov = 70;
      cam.updateProjectionMatrix();
      this.renderer.updateSky(3200, world.renderDistance, false, false);
      this.renderer.updateFollow(cam.position, now / 50);
      this.renderer.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stopPanorama() {
    if (!this.panorama) return;
    this.panorama.world.dispose();
    this.panorama = null;
  }

  // ------------------------------------------------------------ menus
  menuOpen() {
    return $('options').style.display !== 'none' || $('help').style.display !== 'none';
  }

  // Shows an overlay screen (options / help) on top of the title or the pause menu.
  openOverlay(id) {
    const fromGame = !!this.game;
    const el = $(id);
    el.classList.toggle('dim', fromGame);
    el.classList.toggle('dirt-bg', !fromGame);
    el.style.display = 'flex';
    if (fromGame) $('pause').style.display = 'none';
    else $('title').style.display = 'none';
  }

  closeOverlay(id) {
    $(id).style.display = 'none';
    if (this.game) this.showPause(true);
    else this.showTitle();
  }

  bindMenus() {
    $('btn-singleplayer').onclick = () => { this.audio.resume(); this.showWorlds(); };
    $('btn-options').onclick = () => this.openOverlay('options');
    $('btn-help').onclick = () => this.openOverlay('help');
    $('btn-pause-options').onclick = () => this.openOverlay('options');
    $('btn-pause-help').onclick = () => this.openOverlay('help');
    $('btn-options-done').onclick = () => this.closeOverlay('options');
    $('btn-help-back').onclick = () => this.closeOverlay('help');
    $('btn-back').onclick = () => this.showTitle();
    $('btn-new-world').onclick = () => {
      $('new-name').value = '新的世界';
      $('new-seed').value = '';
      this.show('title-create');
      $('new-name').focus();
    };
    $('btn-create-cancel').onclick = () => this.showWorlds();
    $('btn-create').onclick = () => this.createWorld();
    $('btn-play-selected').onclick = () => { if (this.selectedWorld) this.play(this.selectedWorld); };
    $('btn-delete-world').onclick = async () => {
      const w = this.selectedWorld;
      if (!w || !window.confirm(`确定要删除世界「${w.name}」吗？\n此操作无法撤销！`)) return;
      await this.storage.deleteWorld(w.id);
      this.showWorlds();
    };
    $('btn-resume').onclick = () => this.input.lock();
    $('btn-quit').onclick = () => this.quitToTitle();
    $('btn-respawn').onclick = () => this.game && this.game.respawn();
    $('btn-death-quit').onclick = () => this.quitToTitle();
    for (const b of document.querySelectorAll('.mc-btn')) b.addEventListener('click', () => this.audio.play('click'));
  }

  buildOptions() {
    const s = this.settings;
    const grid = $('options-grid');
    grid.innerHTML = '';
    const apply = (key) => {
      if (key === 'renderDistance' && this.game) this.game.world.renderDistance = s.renderDistance;
      if (key === 'shaders') this.renderer.setQuality(s.shaders);
      if (key === 'guiScale') applyGuiScale(s.guiScale);
      if (key === 'volume') this.audio.setVolume(s.volume);
      if (key === 'music') this.audio.setMusicVolume(s.music);
      saveSettings(s);
    };
    for (const o of OPTIONS) {
      if (o.type === 'slider') {
        const el = document.createElement('div');
        el.className = 'mc-slider';
        const handle = document.createElement('div');
        handle.className = 'handle';
        const label = document.createElement('div');
        label.className = 'label';
        el.append(handle, label);
        const get = () => Math.round(s[o.key] * (o.scale || 1));
        const render = () => {
          const v = get();
          label.textContent = `${o.label}: ${o.fmt ? o.fmt(v) : v}`;
          handle.style.left = `calc((100% - 8 * var(--u)) * ${(v - o.min) / (o.max - o.min)})`;
        };
        const setFromX = (clientX) => {
          const r = el.getBoundingClientRect();
          const hw = r.height * 0.4;
          const t = Math.max(0, Math.min(1, (clientX - r.left - hw / 2) / (r.width - hw)));
          const v = Math.round((o.min + t * (o.max - o.min)) / o.step) * o.step;
          if (v !== get()) {
            s[o.key] = v / (o.scale || 1);
            render();
            apply(o.key);
          }
        };
        el.addEventListener('mousedown', (e) => {
          setFromX(e.clientX);
          const move = (ev) => setFromX(ev.clientX);
          const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            this.audio.play('click');
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        });
        render();
        grid.appendChild(el);
      } else {
        const b = document.createElement('button');
        b.className = 'mc-btn';
        const render = () => {
          let v;
          if (o.type === 'toggle') v = s[o.key] ? '开' : '关';
          else v = (o.names && o.names[s[o.key]]) ?? s[o.key];
          b.textContent = `${o.label}: ${v}`;
        };
        b.onclick = () => {
          this.audio.play('click');
          if (o.type === 'toggle') s[o.key] = !s[o.key];
          else s[o.key] = o.values[(o.values.indexOf(s[o.key]) + 1) % o.values.length];
          render();
          apply(o.key);
        };
        render();
        grid.appendChild(b);
      }
    }
  }

  async showWorlds() {
    this.show('title-worlds');
    this.selectedWorld = null;
    $('btn-play-selected').disabled = true;
    $('btn-delete-world').disabled = true;
    const list = $('world-list');
    list.innerHTML = '';
    const worlds = await this.storage.listWorlds();
    if (worlds.length === 0) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = '还没有世界，创建一个吧！';
      list.appendChild(p);
    }
    for (const w of worlds) {
      const row = document.createElement('div');
      row.className = 'world-row';
      const icon = document.createElement('img');
      icon.className = 'world-icon';
      icon.src = iconURL(B.GRASS);
      const info = document.createElement('div');
      info.className = 'world-info';
      const name = document.createElement('div');
      name.textContent = w.name;
      const sub = document.createElement('div');
      sub.className = 'sub';
      const day = Math.floor((w.time || 0) / 24000) + 1;
      sub.textContent = `${w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : '未游玩'}`;
      const sub2 = document.createElement('div');
      sub2.className = 'sub';
      sub2.textContent = `生存模式 · 第 ${day} 天 · 种子 ${w.seed}`;
      info.append(name, sub, sub2);
      row.append(icon, info);
      row.onclick = () => {
        for (const r of list.children) r.classList.remove('selected');
        row.classList.add('selected');
        this.selectedWorld = w;
        $('btn-play-selected').disabled = false;
        $('btn-delete-world').disabled = false;
      };
      row.ondblclick = () => this.play(w);
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
    this.stopPanorama();
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
    if (this.audio.music) this.audio.music.soon(20);
    game.hud.message('点击画面开始游戏。按 E 打开物品栏，F3 查看调试信息。', 6);
    if (!meta.player) game.hud.message('提示：先徒手撸树获取原木吧！', 8);
    game.save();
    this.showPause(true);
  }

  async quitToTitle() {
    const game = this.game;
    this.game = null;
    $('pause').style.display = 'none';
    $('death').style.display = 'none';
    $('options').style.display = 'none';
    $('help').style.display = 'none';
    $('hud').innerHTML = '';
    if (game) await game.quit();
    this.showWorlds();
    this.startPanorama();
  }

  showPause(show) {
    $('pause').style.display = show ? 'flex' : 'none';
    if (this.game) this.game.paused = show || this.menuOpen();
  }

  onLockChange(locked) {
    if (!this.game) return;
    if (locked) {
      $('options').style.display = 'none';
      $('help').style.display = 'none';
      this.showPause(false);
    } else if (!this.game.screens.isOpen && !this.game.player.dead && !this.menuOpen()) {
      this.showPause(true);
    }
  }

  onKey(e) {
    if (e.code === 'Escape' && !this.game) {
      if ($('options').style.display !== 'none') this.closeOverlay('options');
      else if ($('help').style.display !== 'none') this.closeOverlay('help');
      else if ($('title-create').style.display !== 'none') this.showWorlds();
      else if ($('title-worlds').style.display !== 'none') this.showTitle();
      return;
    }
    const game = this.game;
    if (!game) return;
    if (e.code === 'Escape' && this.menuOpen()) {
      if ($('options').style.display !== 'none') this.closeOverlay('options');
      else this.closeOverlay('help');
      return;
    }
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

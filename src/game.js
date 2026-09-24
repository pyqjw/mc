// Game session: owns the world, player, entities and UI, and runs the frame / tick loop.
import * as THREE from 'three';
import { World } from './world/world.js';
import { raycast } from './world/raycast.js';
import { B, BLOCKS, IS_SOLID, IS_FLUID, RENDER } from './world/blocks.js';
import { BIOME_NAMES } from './world/generator.js';
import { WORLD_HEIGHT } from './constants.js';
import { Player } from './entity/player.js';
import { MobManager } from './entity/mobs.js';
import { DropManager } from './entity/drops.js';
import { XpOrbManager } from './entity/xporbs.js';
import { ProjectileManager } from './entity/projectiles.js';
import { Particles } from './entity/particles.js';
import { Hand } from './render/hand.js';
import { HUD } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { getItem, I, ITEMS, HAND_ATTACK_SPEED } from './items.js';
import { blockSound } from './audio/sounds.js';
import { BIOMES } from './world/generator.js';

const REACH = 4.5;
const ENTITY_REACH = 3;

const DEATH_MESSAGES = {
  arrow: '被骷髅射杀了',
  poison: '中毒身亡',
  fall: '从高处摔了下来',
  lava: '试图在熔岩里游泳',
  drown: '淹死了',
  starve: '饿死了',
  mob: '被怪物杀死了',
  explosion: '被炸死了',
  cactus: '被仙人掌戳死了',
  void: '掉出了这个世界',
};

export class Game {
  constructor(app, renderer, storage, audio, input, settings) {
    this.app = app;
    this.renderer = renderer;
    this.storage = storage;
    this.audio = audio;
    this.input = input;
    this.settings = settings;
    this.running = false;
    this.paused = false;
    this.tickAcc = 0;
    this.time = 1000;
    this.daylight = 1;
    this.mining = null;
    this.miningCooldown = 0;
    this.useCooldown = 0;
    this.usingItem = null;
    this.useTime = 0;
    this.sleepFade = 0;
    this.sleeping = false;
    this.fps = 0;
    this.frames = 0;
    this.fpsTime = 0;
    this.saveTimer = 0;
    this.tmpV = new THREE.Vector3();
    this.target = null;
  }

  async load(meta) {
    this.meta = meta;
    this.world = new World({
      seed: meta.seed, worldId: meta.id, storage: this.storage, scene: this.renderer.scene, materials: this.renderer.materials,
    });
    this.world.game = this;
    this.world.renderDistance = this.settings.renderDistance;
    await this.world.init();
    this.player = new Player(this);
    this.mobs = new MobManager(this);
    this.drops = new DropManager(this);
    this.xpOrbs = new XpOrbManager(this);
    this.projectiles = new ProjectileManager(this);
    this.particles = new Particles(this);
    this.hand = new Hand();
    this.hand.resize(window.innerWidth, window.innerHeight);
    this.renderer.onResize = (w, h) => this.hand.resize(w, h);
    this.hud = new HUD(this);
    this.screens = new Screens(this);

    this.time = meta.time ?? 1000;
    if (!meta.spawn) meta.spawn = this.world.generator.findSpawn();
    if (meta.player) {
      this.player.load(meta.player);
    } else {
      this.player.pos.set(meta.spawn.x, meta.spawn.y, meta.spawn.z);
      this.player.yaw = Math.PI * 0.75;
      this.needsSafeSpot = true;
      this.searchGround = true;
    }
  }

  // Waits for the terrain around the player; calls onProgress(0..1).
  async waitForTerrain(onProgress) {
    return new Promise((resolve) => {
      const step = () => {
        const p = this.player.pos;
        this.world.update(p.x, p.z);
        const prog = this.world.loadingProgress(p.x, p.z, 2);
        onProgress(prog);
        if (prog >= 1) resolve();
        else setTimeout(step, 50);
      };
      step();
    });
  }

  start() {
    this.running = true;
    this.last = performance.now();
    if (this.player.dead) this.showDeath();
    const loop = (t) => {
      if (!this.running) return;
      this.frame(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ main loop
  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = Math.round(this.frames / this.fpsTime);
      this.frames = 0;
      this.fpsTime = 0;
    }
    const input = this.input;
    const player = this.player;
    const active = input.locked && !this.screens.isOpen && !player.dead && !this.paused;

    const mouse = input.consumeMouse();
    if (active) {
      const sens = 0.0022 * this.settings.sensitivity;
      player.yaw -= mouse.dx * sens;
      player.pitch -= mouse.dy * sens;
      player.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, player.pitch));
      if (mouse.wheel) {
        player.inventory.selected = (((player.inventory.selected + mouse.wheel) % 9) + 9) % 9;
      }
      for (let i = 1; i <= 9; i++) if (input.pressed.has(`Digit${i}`)) player.inventory.selected = i - 1;
    }

    if (!this.paused) {
      if (this.needsSafeSpot) this.findSafeSpot();
      this.tickAcc += dt;
      let n = 0;
      while (this.tickAcc >= 0.05 && n < 5) {
        this.tick();
        this.tickAcc -= 0.05;
        n++;
      }
      if (n >= 5) this.tickAcc = 0;
      const noInput = { movement: () => ({ forward: 0, strafe: 0, jump: false, sneak: false, sprint: false }) };
      const pinput = active ? input : noInput;
      // Physics in small steps for stability.
      let rem = dt;
      while (rem > 0) {
        const step = Math.min(rem, 1 / 60);
        player.update(step, pinput);
        rem -= step;
      }
      this.interact(dt, active);
      this.mobs.update(dt);
      this.drops.update(dt);
      this.xpOrbs.update(dt);
      this.projectiles.update(dt);
      this.particles.update(dt);
      this.updateSleep(dt);
    }
    this.world.update(player.pos.x, player.pos.z);

    // Camera.
    const cam = this.renderer.camera;
    const eye = player.eyePos(this.tmpV);
    const bob = this.settings.viewBobbing ? player.bobAmount : 0;
    cam.position.set(
      eye.x + Math.cos(player.yaw) * Math.sin(player.bobPhase) * 0.05 * bob,
      eye.y - Math.abs(Math.cos(player.bobPhase)) * 0.07 * bob,
      eye.z - Math.sin(player.yaw) * Math.sin(player.bobPhase) * 0.05 * bob,
    );
    cam.rotation.set(player.pitch, player.yaw, player.hurtTime > 0 ? Math.sin(player.hurtTime * 9) * 0.06 : 0);
    let fovTarget = this.settings.fov * (player.sprinting ? 1.12 : 1);
    if (this.usingItem && this.usingItem.bow) {
      const f = Math.min(1, this.useTime);
      fovTarget *= 1 - f * f * 0.15;
    }
    cam.fov += (fovTarget - cam.fov) * Math.min(1, dt * 10);
    cam.updateProjectionMatrix();

    const dayTime = this.time % 24000;
    const eyeFluid = player.eyeFluid;
    this.daylight = this.renderer.updateSky(dayTime, this.world.renderDistance, eyeFluid === B.WATER, eyeFluid === B.LAVA);
    this.renderer.updateFollow(cam.position, this.time);
    this.updateAudio(dt);

    // Held item.
    const hand = player.inventory.hand;
    const light = this.world.getLight(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    const lb = Math.max(0.1, light / 15);
    this.hand.update(dt, {
      heldId: hand ? hand.id : 0, bobPhase: player.bobPhase, bobAmount: bob, light: lb * lb * 0.5 + lb * 0.5,
      eating: !!this.usingItem && !this.usingItem.bow, bowPull: this.usingItem && this.usingItem.bow ? this.useTime : -1,
    });

    this.renderer.render(this.settings.hideHud ? null : this.hand.scene, this.hand.camera);
    this.hud.update(dt);
    this.screens.update();
    input.endFrame();
  }

  tick() {
    if (!this.sleeping) this.time++;
    const day = this.daylight;
    this.world.skyDarken = Math.round((1 - (day - 0.25) / 0.75) * 11);
    this.world.tick(this.player.pos.x, this.player.pos.z);
    this.player.tick();
    this.mobs.tick();
    this.saveTimer++;
    if (this.saveTimer >= 20 * 30) {
      this.saveTimer = 0;
      this.save();
    }
  }

  // ------------------------------------------------------------------ interaction
  interact(dt, active) {
    const player = this.player;
    const input = this.input;
    const inv = player.inventory;
    if (this.miningCooldown > 0) this.miningCooldown -= dt;
    if (this.useCooldown > 0) this.useCooldown -= dt;

    const eye = player.eyePos(new THREE.Vector3());
    const dir = player.lookDir(new THREE.Vector3());
    const hit = active ? raycast(this.world, eye, dir, REACH) : null;
    const mobHit = active ? this.mobs.raycast(eye, dir, ENTITY_REACH) : null;
    const targetMob = mobHit && (!hit || mobHit.dist < hit.dist) ? mobHit.mob : null;
    this.target = hit;

    if (hit && !targetMob && !this.settings.hideHud) {
      const b = hit.box;
      this.renderer.setHighlight([hit.x + b[0], hit.y + b[1], hit.z + b[2], hit.x + b[3], hit.y + b[4], hit.z + b[5]]);
    } else {
      this.renderer.setHighlight(null);
    }

    if (!active) {
      this.mining = null;
      this.renderer.setCrack(null);
      this.cancelUsing();
      return;
    }

    // Drop item.
    if (input.pressed.has('KeyQ')) {
      const s = inv.hand;
      if (s) {
        const n = input.down('ControlLeft') || input.down('ControlRight') ? s.count : 1;
        this.dropFromPlayer({ id: s.id, count: n, damage: s.damage });
        inv.consumeHand(n);
        this.hand.startSwing();
      }
    }

    // Attack / mine. Every swing restarts the attack cooldown (Minecraft 1.9+ combat).
    player.attackTimer += dt;
    if (input.clicked.has(0)) {
      this.hand.startSwing();
      if (targetMob) this.attack(targetMob);
      player.attackTimer = 0;
    }
    if (input.buttons.has(0) && !targetMob && hit && this.miningCooldown <= 0) {
      const same = this.mining && this.mining.x === hit.x && this.mining.y === hit.y && this.mining.z === hit.z && this.mining.id === hit.id;
      if (!same) this.mining = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, progress: 0, soundTimer: 0 };
      const m = this.mining;
      const time = this.breakTime(hit.id);
      if (time === Infinity) {
        m.progress = 0;
      } else {
        m.progress += time === 0 ? 1 : dt / time;
        m.soundTimer -= dt;
        if (m.soundTimer <= 0) {
          m.soundTimer = 0.25;
          this.blockSound('hit', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, hit.id);
          this.hand.startSwing();
        }
      }
      if (m.progress >= 1) {
        this.playerBreak(hit.x, hit.y, hit.z);
        this.mining = null;
        this.miningCooldown = time === 0 ? 0.15 : 0.3;
      }
      const b = hit.box;
      this.renderer.setCrack(this.mining ? [hit.x + b[0], hit.y + b[1], hit.z + b[2], hit.x + b[3], hit.y + b[4], hit.z + b[5]] : null,
        this.mining ? Math.floor(this.mining.progress * 10) : -1);
    } else {
      if (!input.buttons.has(0)) this.mining = null;
      this.renderer.setCrack(null);
    }

    // Use / place (right button).
    if (input.buttons.has(2)) {
      if (this.usingItem) {
        this.continueUsing(dt);
      } else if (input.clicked.has(2) || this.useCooldown <= 0) {
        this.useCooldown = 0.2;
        this.use(hit, targetMob, eye, dir);
      }
    } else {
      this.stopUsing();
    }
  }

  breakTime(id) {
    const b = BLOCKS[id];
    if (b.hardness < 0) return Infinity;
    if (b.hardness === 0) return 0;
    const s = this.player.inventory.hand;
    const tool = s ? getItem(s.id)?.tool : null;
    let speed = 1;
    if (tool && tool.type === b.tool) speed = tool.speed;
    if (tool && tool.type === 'sword' && b.leaves) speed = 1.5;
    const canHarvest = b.harvestLevel < 0 || (tool && tool.type === 'pickaxe' && tool.tier >= b.harvestLevel);
    if (!this.player.onGround && !this.player.inWater) speed /= 5;
    if (this.player.eyeFluid === B.WATER) speed /= 5;
    const perTick = speed / b.hardness / (canHarvest ? 30 : 100);
    if (perTick > 1) return 0;
    return Math.ceil(1 / perTick) / 20;
  }

  playerBreak(x, y, z) {
    const world = this.world;
    const id = world.getBlock(x, y, z);
    if (id <= 0) return;
    const meta = world.getMeta(x, y, z);
    const s = this.player.inventory.hand;
    const tool = s ? getItem(s.id)?.tool : null;
    this.particles.blockBreak(x, y, z, id);
    this.blockSound('break', x + 0.5, y + 0.5, z + 0.5, id);
    world.setBlock(x, y, z, B.AIR);
    if (id === B.ICE) {
      const below = world.getBlock(x, y - 1, z);
      if (below > 0 && below !== B.AIR) world.setBlock(x, y, z, B.WATER);
    }
    this.spawnBlockDrops(x, y, z, id, meta, tool);
    const bxp = BLOCKS[id].xp;
    if (bxp && (BLOCKS[id].harvestLevel < 0 || (tool && tool.type === 'pickaxe' && tool.tier >= BLOCKS[id].harvestLevel))) {
      const n = bxp[0] + Math.floor(Math.random() * (bxp[1] - bxp[0] + 1));
      if (n > 0) this.xpOrbs.spawn(x + 0.5, y + 0.5, z + 0.5, n);
    }
    if (tool && BLOCKS[id].hardness > 0) {
      if (this.player.inventory.damageHand(tool.type === 'sword' ? 2 : 1)) this.sound('break_tool');
    }
    this.player.exhaustion += 0.005;
  }

  spawnBlockDrops(x, y, z, id, meta, tool) {
    const b = BLOCKS[id];
    if (!b) return;
    if (b.harvestLevel >= 0 && !(tool && tool.type === 'pickaxe' && tool.tier >= b.harvestLevel)) return;
    const drops = b.drops ? b.drops(Math.random, tool, meta) : [[id, 1]];
    for (const [did, n] of drops) {
      if (n > 0 && ITEMS[did]) this.dropItem(x + 0.5, y + 0.4, z + 0.5, { id: did, count: n });
    }
  }

  // Attack strength 0..1 from the time since the last swing and the held item's attack speed.
  attackStrength() {
    const s = this.player.inventory.hand;
    const tool = s ? getItem(s.id)?.tool : null;
    const speed = tool ? tool.attackSpeed : HAND_ATTACK_SPEED;
    return Math.min(1, (this.player.attackTimer + 0.025) * speed);
  }

  attack(mob) {
    const player = this.player;
    const s = player.inventory.hand;
    const tool = s ? getItem(s.id)?.tool : null;
    const strength = this.attackStrength();
    const full = strength > 0.9;
    let dmg = (tool ? tool.damage : 1) * (0.2 + strength * strength * 0.8);
    const crit = full && player.vel.y < 0 && !player.onGround && !player.inWater && !player.sprinting;
    const knockSprint = full && player.sprinting;
    const sweep = full && !crit && !knockSprint && player.onGround && tool && tool.type === 'sword';
    if (crit) {
      dmg *= 1.5;
      for (let i = 0; i < 3; i++) this.particles.smoke(mob.pos.x, mob.pos.y + mob.height * 0.7, mob.pos.z, 4, 0xffffaa, 0.1, 3, 0.4);
    }
    mob.lastHurtByPlayer = this.time;
    if (mob.damage(dmg, player.pos, knockSprint ? 1.6 : full ? 1 : 0.5)) {
      if (tool && player.inventory.damageHand(tool.type === 'sword' ? 1 : 2)) this.sound('break_tool');
      player.exhaustion += 0.1;
      if (player.sprinting) player.sprinting = false;
      const snd = crit ? 'attack.crit' : knockSprint ? 'attack.knockback' : sweep ? 'attack.sweep' : full ? 'attack.strong' : 'attack.weak';
      this.sound(snd, mob.pos.x, mob.pos.y + 1, mob.pos.z);
    }
    if (sweep) {
      const p = mob.pos;
      for (const m of this.mobs.inBox(p.x - 1, p.y - 0.25, p.z - 1, p.x + 1, p.y + mob.height + 0.25, p.z + 1)) {
        if (m === mob || m.pos.distanceTo(player.pos) > 3) continue;
        m.lastHurtByPlayer = this.time;
        m.damage(1, player.pos, 0.4);
      }
      const eye = player.eyePos(new THREE.Vector3());
      const dir = player.lookDir(new THREE.Vector3());
      this.particles.sweep(eye.x + dir.x * 1.4, eye.y - 0.4 + dir.y * 1.4, eye.z + dir.z * 1.4, player.yaw);
    }
  }

  use(hit, targetMob, eye, dir) {
    const player = this.player;
    const inv = player.inventory;
    const world = this.world;
    const s = inv.hand;
    const item = s ? getItem(s.id) : null;

    // Interact with blocks first (unless sneaking with an item).
    if (hit && !(player.sneaking && s)) {
      const b = BLOCKS[hit.id];
      if (b.interact) {
        this.hand.startSwing();
        this.interactBlock(hit, b.interact);
        return;
      }
    }
    if (!item) return;

    if (item.food) {
      if (player.food < 20 || item.food.always) {
        this.usingItem = { id: s.id, slot: inv.selected };
        this.useTime = 0;
      }
      return;
    }

    if (item.bucket) {
      this.useBucket(item, eye, dir);
      return;
    }

    if (item.bow) {
      if (this.findArrow() >= 0) {
        this.usingItem = { id: s.id, slot: inv.selected, bow: true };
        this.useTime = 0;
      }
      return;
    }

    if (item.throwable) {
      const pos = eye.clone().addScaledVector(dir, 0.3);
      this.projectiles.shoot(pos, dir.clone().multiplyScalar(30).add(player.vel), { kind: 'egg', shooter: 'player' });
      this.sound('throw', eye.x, eye.y, eye.z, 0.6, 1 / (Math.random() * 0.4 + 0.8));
      inv.consumeHand(1);
      this.hand.startSwing();
      return;
    }

    if (item.armor) {
      const old = player.equip(s);
      inv.slots[inv.selected] = old;
      this.hand.startSwing();
      return;
    }

    if (s.id === I.BONE_MEAL && hit) {
      if (this.useBoneMeal(hit.x, hit.y, hit.z)) {
        inv.consumeHand(1);
        this.hand.startSwing();
      }
      return;
    }

    if (item.tool && item.tool.type === 'hoe' && hit && hit.normal[1] === 1) {
      if ((hit.id === B.GRASS || hit.id === B.DIRT) && world.getBlock(hit.x, hit.y + 1, hit.z) === 0) {
        world.setBlock(hit.x, hit.y, hit.z, B.FARMLAND);
        this.blockSound('place', hit.x + 0.5, hit.y + 1, hit.z + 0.5, B.DIRT);
        this.hand.startSwing();
        if (inv.damageHand(1)) this.sound('break_tool');
        // Tilling grass can drop seeds from the tall grass above in MC; keep it simple.
      }
      return;
    }

    if (item.placeBlock !== undefined && hit) this.placeBlock(hit, item.placeBlock);
  }

  placeBlock(hit, blockId) {
    const world = this.world;
    const player = this.player;
    const target = BLOCKS[hit.id];
    let x = hit.x;
    let y = hit.y;
    let z = hit.z;
    if (!(target.replaceable && !IS_FLUID[hit.id])) {
      x += hit.normal[0];
      y += hit.normal[1];
      z += hit.normal[2];
    }
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const cur = world.getBlock(x, y, z);
    if (cur < 0 || !(cur === 0 || BLOCKS[cur].replaceable)) return;
    const b = BLOCKS[blockId];
    if (b.solid) {
      const box = [x, y, z, x + 1, y + b.height, z + 1];
      const hits = (e) => e.pos.x + e.halfW > box[0] && e.pos.x - e.halfW < box[3]
        && e.pos.y + e.height > box[1] && e.pos.y < box[4]
        && e.pos.z + e.halfW > box[2] && e.pos.z - e.halfW < box[5];
      if (hits(player)) return;
      for (const m of this.mobs.mobs) if (!m.dead && hits(m)) return;
    }
    if (b.support && !world.hasSupport(x, y, z, b.support)) return;
    let meta = 0;
    if (b.orientable) {
      // Front faces the player.
      const dx = -Math.sin(player.yaw);
      const dz = -Math.cos(player.yaw);
      let facing;
      if (Math.abs(dx) > Math.abs(dz)) facing = dx > 0 ? 1 : 3;
      else facing = dz > 0 ? 2 : 0;
      meta = (facing + 2) % 4;
    }
    if (b.leaves) meta = 1; // player-placed leaves never decay
    if (cur !== 0 && BLOCKS[cur].render === RENDER.CROSS) this.spawnBlockDrops(x, y, z, cur, 0, null);
    world.setBlock(x, y, z, blockId, { meta });
    this.player.inventory.consumeHand(1);
    this.hand.startSwing();
    this.blockSound('place', x + 0.5, y + 0.5, z + 0.5, blockId);
  }

  interactBlock(hit, kind) {
    const key = `${hit.x},${hit.y},${hit.z}`;
    if (kind === 'crafting') this.openScreen('crafting');
    else if (kind === 'furnace') {
      const tile = this.world.tiles.get(key);
      if (tile) this.openScreen('furnace', { tile });
    } else if (kind === 'chest') {
      const tile = this.world.tiles.get(key);
      if (tile) this.openScreen('chest', { tile });
    } else if (kind === 'bed') {
      this.trySleep(hit);
    }
  }

  trySleep(hit) {
    const player = this.player;
    player.spawn = { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 };
    const t = this.time % 24000;
    if (t < 12542 || t > 23459) {
      this.hud.message('已设置重生点。你只能在夜间睡觉');
      return;
    }
    const near = this.mobs.mobs.some((m) => m.def.hostile && !m.dead && m.pos.distanceTo(player.pos) < 8);
    if (near) {
      this.hud.message('你现在不能休息，周围有怪物在游荡');
      return;
    }
    this.hud.message('已设置重生点');
    this.sleeping = true;
    this.sleepTimer = 0;
  }

  updateSleep(dt) {
    if (this.sleeping) {
      this.sleepTimer += dt;
      this.sleepFade = Math.min(1, this.sleepTimer / 2);
      if (this.sleepTimer > 2.5) {
        this.time = (Math.floor(this.time / 24000) + 1) * 24000;
        this.sleeping = false;
      }
    } else if (this.sleepFade > 0) {
      this.sleepFade = Math.max(0, this.sleepFade - dt);
    }
  }

  useBucket(item, eye, dir) {
    const world = this.world;
    const inv = this.player.inventory;
    if (item.bucket === 'empty') {
      const hit = raycast(world, eye, dir, REACH, { fluids: true });
      if (!hit || !IS_FLUID[hit.id] || hit.meta !== 0) return;
      world.setBlock(hit.x, hit.y, hit.z, B.AIR);
      const filled = { id: hit.id === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET, count: 1, damage: 0 };
      if (inv.hand.count === 1) inv.slots[inv.selected] = filled;
      else {
        inv.consumeHand(1);
        if (inv.add(filled) > 0) this.dropFromPlayer(filled);
      }
      this.sound('bucket.fill', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 1, hit.id === B.LAVA ? 0.7 : 1);
      this.hand.startSwing();
      return;
    }
    const hit = raycast(world, eye, dir, REACH);
    if (!hit) return;
    let x = hit.x;
    let y = hit.y;
    let z = hit.z;
    if (!BLOCKS[hit.id].replaceable) {
      x += hit.normal[0];
      y += hit.normal[1];
      z += hit.normal[2];
    }
    const cur = world.getBlock(x, y, z);
    if (cur < 0 || !(cur === 0 || BLOCKS[cur].replaceable)) return;
    if (cur !== 0 && !IS_FLUID[cur]) this.spawnBlockDrops(x, y, z, cur, 0, null);
    world.setBlock(x, y, z, item.bucket === 'water' ? B.WATER : B.LAVA);
    inv.slots[inv.selected] = { id: I.BUCKET, count: 1, damage: 0 };
    this.sound('bucket.empty', x + 0.5, y + 0.5, z + 0.5, 1, item.bucket === 'lava' ? 0.7 : 1);
    this.hand.startSwing();
  }

  continueUsing(dt) {
    const inv = this.player.inventory;
    const s = inv.hand;
    if (!s || s.id !== this.usingItem.id || inv.selected !== this.usingItem.slot) {
      this.usingItem = null;
      this.useTime = 0;
      return;
    }
    this.useTime += dt;
    if (this.usingItem.bow) return;
    if (Math.floor(this.useTime / 0.22) !== Math.floor((this.useTime - dt) / 0.22)) {
      this.sound('eat');
    }
    if (this.useTime >= 1.6) {
      const item = getItem(s.id);
      this.player.eat(item.food);
      inv.consumeHand(1);
      this.sound('burp');
      this.usingItem = null;
      this.useCooldown = 0.3;
    }
  }

  stopUsing() {
    if (this.usingItem && this.usingItem.bow) this.releaseBow();
    this.cancelUsing();
  }

  // Stops eating / drawing without effect (screens opened, death).
  cancelUsing() {
    this.usingItem = null;
    this.useTime = 0;
  }

  // Index of the first arrow stack in the inventory, or -1.
  findArrow() {
    const slots = this.player.inventory.slots;
    const h = this.player.inventory.selected;
    // Minecraft looks at the hands first, then the hotbar, then the rest.
    if (slots[h] && slots[h].id === I.ARROW) return h;
    return slots.findIndex((s) => s && s.id === I.ARROW);
  }

  // Fires the bow with power from the draw time (Minecraft's curve).
  releaseBow() {
    const player = this.player;
    const inv = player.inventory;
    const t = this.useTime;
    this.usingItem = null;
    this.useTime = 0;
    let f = Math.min(1, t);
    f = (f * f + f * 2) / 3;
    if (f < 0.1) return;
    const ai = this.findArrow();
    if (ai < 0) return;
    const eye = player.eyePos(new THREE.Vector3());
    const dir = player.lookDir(new THREE.Vector3());
    const vel = dir.clone().multiplyScalar(f * 60).add(new THREE.Vector3(player.vel.x, player.onGround ? 0 : player.vel.y, player.vel.z));
    this.projectiles.shoot(eye.clone().addScaledVector(dir, 0.2).setY(eye.y - 0.1), vel, {
      kind: 'arrow', shooter: 'player', damage: 2, crit: f >= 1, pickup: true,
    });
    this.sound('bow', eye.x, eye.y, eye.z, 1, 1 / (Math.random() * 0.4 + 1.2) + f * 0.5);
    const a = inv.slots[ai];
    a.count--;
    if (a.count <= 0) inv.slots[ai] = null;
    if (inv.damageHand(1)) this.sound('break_tool');
  }

  // Bone meal: grows crops and saplings, or sprouts grass and flowers. Returns true if used.
  useBoneMeal(x, y, z) {
    const world = this.world;
    const id = world.getBlock(x, y, z);
    const b = BLOCKS[id];
    let used = false;
    if (id === B.WHEAT) {
      const m = world.getMeta(x, y, z);
      if (m < 7) {
        world.setMeta(x, y, z, Math.min(7, m + 2 + Math.floor(Math.random() * 4)));
        used = true;
      }
    } else if (b && b.sapling) {
      used = true;
      if (Math.random() < 0.45) world.growTree(x, y, z, b.sapling);
    } else if (id === B.GRASS && world.getBlock(x, y + 1, z) === 0) {
      used = true;
      for (let i = 0; i < 40; i++) {
        const tx = x + Math.floor(Math.random() * 7) - 3;
        const tz = z + Math.floor(Math.random() * 7) - 3;
        const ty = y + Math.floor(Math.random() * 3) - 1;
        if (world.getBlock(tx, ty, tz) !== B.GRASS || world.getBlock(tx, ty + 1, tz) !== 0) continue;
        const r = Math.random();
        world.setBlock(tx, ty + 1, tz, r < 0.85 ? B.TALL_GRASS : r < 0.93 ? B.DANDELION : B.POPPY);
      }
    }
    if (used) {
      this.particles.happy(x + 0.5, y + 0.6, z + 0.5);
      this.sound('bone_meal', x + 0.5, y + 0.5, z + 0.5);
    }
    return used;
  }

  // ------------------------------------------------------------------ entities & world callbacks
  dropItem(x, y, z, stack, vel = null, delay = 0.5) {
    return this.drops.spawn(stack, x, y, z, vel, delay);
  }

  dropFromPlayer(stack) {
    const p = this.player;
    const eye = p.eyePos(new THREE.Vector3());
    const dir = p.lookDir(new THREE.Vector3());
    const vel = dir.clone().multiplyScalar(6);
    vel.y += 1.5;
    this.dropItem(eye.x, eye.y - 0.3, eye.z, stack, vel, 2);
  }

  isSolidBlock(id) {
    return IS_SOLID[id] === 1;
  }

  onChunkGenerated(chunk) {
    this.mobs.spawnAnimals(chunk);
  }

  entitiesInChunk(cx, cz, remove) {
    return this.mobs.inChunk(cx, cz, remove);
  }

  restoreEntities(list) {
    this.mobs.restore(list);
  }

  explosion(x, y, z, power) {
    this.world.explode(x, y, z, power);
    this.particles.explosion(x, y, z);
    this.sound('explode', x, y, z);
    const affect = (e, isPlayer) => {
      const cx = e.pos.x;
      const cy = e.pos.y + e.height / 2;
      const cz = e.pos.z;
      const d = Math.hypot(cx - x, cy - y, cz - z);
      const r = power * 2;
      if (d >= r) return;
      const impact = 1 - d / r;
      const dmg = Math.floor(((impact * impact + impact) / 2) * 7 * r + 1);
      const k = impact * 14;
      const nx = (cx - x) / (d || 1);
      const nz = (cz - z) / (d || 1);
      if (isPlayer) {
        e.invulnerable = 0;
        e.damage(dmg, 'explosion');
      } else {
        e.hurtTime = 0;
        e.damage(dmg, null);
      }
      e.vel.x += nx * k;
      e.vel.z += nz * k;
      e.vel.y += impact * 8;
    };
    if (!this.player.dead) affect(this.player, true);
    for (const m of this.mobs.mobs) if (!m.dead) affect(m, false);
  }

  sound(name, x, y, z, vol = 1, pitch = 1) {
    this.audio.play(name, x, y, z, vol, pitch);
  }

  // Block material sound for an action: 'step' (footsteps), 'hit' (mining), 'break' or 'place'.
  blockSound(action, x, y, z, id = null) {
    const bid = id ?? this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    if (!bid || bid <= 0) return;
    const name = blockSound(BLOCKS[bid].sound, action);
    if (!name) return;
    const [vol, pitch] = { step: [0.55, 1], hit: [0.4, 0.75], break: [1, 0.85], place: [0.9, 0.8] }[action];
    this.audio.play(name, x, y, z, vol, pitch);
  }

  // Footstep sound of the block under a position.
  stepSound(x, y, z, vol = 1) {
    const bid = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    if (bid <= 0) return;
    const name = blockSound(BLOCKS[bid].sound, 'step');
    if (name) this.audio.play(name, x, y, z, 0.55 * vol);
  }

  // Describes the player's surroundings to the audio engine (ambience, reverb, muffling).
  updateAudio(dt) {
    const cam = this.renderer.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position, fwd, up);
    const p = this.player.pos;
    const w = this.world;
    this.envTimer = (this.envTimer || 0) - dt;
    if (this.envTimer <= 0 || !this.env) {
      this.envTimer = 0.5;
      const hx = Math.floor(p.x);
      const hy = Math.floor(p.y + 1.6);
      const hz = Math.floor(p.z);
      const sky = w.getSkyLight(hx, hy, hz);
      const roof = w.topY(hx, hz) > hy + 2;
      let water = 0;
      let lava = 0;
      for (let i = 0; i < 48; i++) {
        const id = w.getBlock(hx + Math.floor(Math.random() * 17) - 8, hy + Math.floor(Math.random() * 9) - 5, hz + Math.floor(Math.random() * 17) - 8);
        if (id === B.WATER) water++;
        else if (id === B.LAVA) lava++;
      }
      const biome = w.generator.column(hx, hz).biome;
      const prev = this.env || { nearWater: 0, nearLava: 0 };
      this.env = {
        outdoors: Math.min(1, Math.max(0, (sky - 8) / 7)),
        cave: roof && sky < 6 ? 1 - sky / 6 : 0,
        altitude: p.y,
        nearWater: prev.nearWater * 0.5 + Math.min(1, water / 12) * 0.5,
        nearLava: prev.nearLava * 0.5 + Math.min(1, lava / 8) * 0.5,
        birds: biome !== BIOMES.DESERT && biome !== BIOMES.OCEAN && biome !== BIOMES.SNOWY && biome !== BIOMES.BEACH,
      };
    }
    this.audio.setEnvironment({
      ...this.env,
      underwater: this.player.eyeFluid === B.WATER,
      day: (this.daylight - 0.25) / 0.75,
      paused: this.paused,
    });
  }

  // Moves the player up out of solid blocks (after spawning in a fresh chunk). For a brand new
  // world, first look for open ground nearby so we do not start on top of a tree.
  findSafeSpot() {
    const p = this.player.pos;
    if (!this.world.areaReady(p.x, p.z, 1)) return;
    const world = this.world;
    if (this.searchGround) {
      this.searchGround = false;
      for (let r = 0; r <= 12; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = Math.floor(p.x) + dx;
            const z = Math.floor(p.z) + dz;
            const top = world.topY(x, z);
            if (top < 0) continue;
            const id = world.getBlock(x, top, z);
            if (id === B.GRASS || id === B.SAND || id === B.SNOWY_GRASS || id === B.DIRT) {
              p.set(x + 0.5, top + 1, z + 0.5);
              this.meta.spawn = { x: p.x, y: p.y, z: p.z };
              this.needsSafeSpot = false;
              return;
            }
          }
        }
      }
    }
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    let y = Math.max(1, Math.floor(p.y));
    const free = (yy) => {
      const a = world.getBlock(x, yy, z);
      const b = world.getBlock(x, yy + 1, z);
      return a >= 0 && b >= 0 && !IS_SOLID[a] && !IS_SOLID[b] && !IS_FLUID[a];
    };
    while (y < WORLD_HEIGHT - 2 && !free(y)) y++;
    if (y !== Math.floor(p.y)) p.y = y;
    this.needsSafeSpot = false;
  }

  // ------------------------------------------------------------------ screens & death
  openScreen(kind, data) {
    this.screens.open(kind, data);
    this.cancelUsing();
    this.mining = null;
    this.input.unlock();
  }

  closeScreen() {
    this.screens.close();
    this.input.lock();
  }

  onPlayerDeath(cause) {
    const p = this.player;
    this.cancelUsing();
    for (let i = 0; i < 4; i++) {
      if (!p.armor[i]) continue;
      const vel = new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 2, (Math.random() - 0.5) * 5);
      this.dropItem(p.pos.x, p.pos.y + 1, p.pos.z, p.armor[i], vel, 1);
      p.armor[i] = null;
    }
    const xp = p.deathXp();
    if (xp > 0) this.xpOrbs.spawn(p.pos.x, p.pos.y + 0.5, p.pos.z, xp);
    this.finalScore = p.score;
    for (let i = 0; i < p.inventory.slots.length; i++) {
      const s = p.inventory.slots[i];
      if (!s) continue;
      const vel = new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 2, (Math.random() - 0.5) * 5);
      this.dropItem(p.pos.x, p.pos.y + 1, p.pos.z, s, vel, 1);
      p.inventory.slots[i] = null;
    }
    if (this.screens.isOpen) this.screens.close();
    this.deathCause = cause;
    this.showDeath();
    this.input.unlock();
  }

  showDeath() {
    const el = document.getElementById('death');
    el.style.display = 'flex';
    document.getElementById('death-cause').textContent = `玩家${DEATH_MESSAGES[this.deathCause] || '死了'}`;
    document.querySelector('#death-score span').textContent = String(this.finalScore ?? this.player.score ?? 0);
  }

  respawn() {
    document.getElementById('death').style.display = 'none';
    const spawn = this.player.spawn && this.bedStillThere(this.player.spawn) ? this.player.spawn : this.meta.spawn;
    if (this.player.spawn && spawn !== this.player.spawn) {
      this.hud.message('你的床已丢失或被阻挡');
      this.player.spawn = null;
    }
    this.player.respawn(spawn);
    this.needsSafeSpot = true;
    this.input.lock();
  }

  bedStillThere(sp) {
    const x = Math.floor(sp.x);
    const y = Math.floor(sp.y) - 1;
    const z = Math.floor(sp.z);
    if (!this.world.isLoaded(x, z)) return true; // assume it is still there
    return this.world.getBlock(x, y, z) === B.BED;
  }

  // ------------------------------------------------------------------ saving
  async save() {
    if (!this.world) return;
    const meta = this.meta;
    meta.time = this.time;
    meta.player = this.player.toJSON();
    meta.lastPlayed = Date.now();
    try {
      await this.storage.putWorld(JSON.parse(JSON.stringify(meta)));
      await this.storage.putChunks(meta.id, this.world.dirtyRecords());
    } catch (e) {
      console.error('Save failed', e);
    }
  }

  async quit() {
    this.running = false;
    await this.save();
    this.dispose();
  }

  dispose() {
    this.running = false;
    this.audio.setEnvironment(null);
    this.mobs.clear();
    this.drops.clear();
    this.xpOrbs.clear();
    this.projectiles.clear();
    this.particles.clear();
    this.world.dispose();
    this.screens.destroy();
    this.renderer.setHighlight(null);
    this.renderer.setCrack(null);
  }

  // F3 screen text: [left lines, right lines], like Minecraft's debug overlay.
  debugText() {
    const p = this.player.pos;
    const w = this.world;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    const z = Math.floor(p.z);
    const col = w.generator.column(x, z);
    const dirs = [['北', 'Z 轴负方向'], ['西', 'X 轴负方向'], ['南', 'Z 轴正方向'], ['东', 'X 轴正方向']];
    const yaw = ((this.player.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const [dir, axis] = dirs[Math.round(yaw / (Math.PI / 2)) % 4];
    const mcYaw = ((((-yaw * 180) / Math.PI + 180) % 360) + 360) % 360 - 180;
    const day = Math.floor(this.time / 24000) + 1;
    const t = this.time % 24000;
    const hours = Math.floor(((t / 1000) + 6) % 24);
    const mins = Math.floor(((t % 1000) / 1000) * 60);
    const left = [
      `WebCraft 1.1（浏览器版）`,
      `${this.fps} fps  ${w.stats.meshed} 次区块构建`,
      `实体: ${this.mobs.mobs.length + this.drops.items.length}（生物 ${this.mobs.mobs.length}，掉落物 ${this.drops.items.length}）`,
      '',
      `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(5)} / ${p.z.toFixed(3)}`,
      `方块: ${x} ${y} ${z}`,
      `区块: ${x & 15} ${y & 15} ${z & 15} 位于 ${Math.floor(x / 16)} ${Math.floor(z / 16)}（已加载 ${w.chunks.size}）`,
      `朝向: ${dir}（朝向${axis}）(${mcYaw.toFixed(1)} / ${(-this.player.pitch * 180 / Math.PI).toFixed(1)})`,
      `客户端光照: ${w.getLight(x, y + 1, z)}（天空: ${w.getSkyLight(x, y + 1, z)}，方块: ${w.getBlockLight(x, y + 1, z)}）`,
      `生物群系: ${BIOME_NAMES[col.biome]}`,
      `第 ${day} 天 ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`,
      `种子: ${this.meta.seed}`,
    ];
    const gl = this.renderer.renderer.getContext();
    const right = [
      `WebGL ${gl instanceof WebGL2RenderingContext ? '2' : '1'}  光影: ${{ off: '关', medium: '中', high: '高' }[this.renderer.quality]}`,
      `显示: ${window.innerWidth}x${window.innerHeight}  渲染距离: ${w.renderDistance}`,
      `绘制调用: ${this.renderer.renderer.info.render.calls}`,
      '',
    ];
    if (this.target) {
      const tb = BLOCKS[this.target.id];
      right.push('目标方块:', `${this.target.x}, ${this.target.y}, ${this.target.z}`, `webcraft:${tb.key}`, tb.name);
    }
    return [left, right];
  }
}

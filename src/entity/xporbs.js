// Experience orbs: glowing sprites that drift towards the player and are collected one at a time.
import * as THREE from 'three';
import { moveEntity, fluidSubmersion } from './physics.js';
import { B } from '../world/blocks.js';

// Orb sizes: [max value, sprite size in pixels].
const SIZES = [[2, 4], [6, 5], [16, 6], [36, 7], [72, 8], [Infinity, 9]];

// Splits an amount into orb values like Minecraft (largest first).
export function splitXp(amount) {
  const out = [];
  const values = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
  let left = Math.floor(amount);
  while (left > 0) {
    const v = values.find((x) => x <= left);
    out.push(v);
    left -= v;
  }
  return out;
}

const textures = [];
function orbTexture(i) {
  if (textures[i]) return textures[i];
  const size = SIZES[i][1];
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const o = (16 - size) / 2;
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      if (d > 1.02) continue;
      let col = '#4a8a0e';
      if (d < 0.75) col = '#b5ff3c';
      if (d < 0.45) col = '#f4ff9a';
      if (d >= 0.85) col = '#2c5a06';
      ctx.fillStyle = col;
      ctx.fillRect(o + x, o + y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  textures[i] = t;
  return t;
}

class Orb {
  constructor(game, x, y, z, value) {
    this.game = game;
    this.value = value;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 4 + 2, (Math.random() - 0.5) * 4);
    this.halfW = 0.125;
    this.height = 0.25;
    this.stepHeight = 0;
    this.onGround = false;
    this.age = 0;
    this.phase = Math.random() * 10;
    const si = SIZES.findIndex(([max]) => value <= max);
    this.material = new THREE.SpriteMaterial({ map: orbTexture(si), alphaTest: 0.5, fog: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.scale.setScalar(0.5);
    game.renderer.scene.add(this.sprite);
  }

  dispose() {
    this.game.renderer.scene.remove(this.sprite);
    this.material.dispose();
  }

  update(dt) {
    const world = this.game.world;
    this.age += dt;
    if (!world.isLoaded(this.pos.x, this.pos.z)) return;
    const p = this.game.player;
    // Float towards the player when close (Minecraft pulls orbs within 8 blocks).
    if (!p.dead) {
      const dx = p.pos.x - this.pos.x;
      const dy = p.pos.y + 0.8 - this.pos.y;
      const dz = p.pos.z - this.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 8 && d > 0.01) {
        const f = (1 - d / 8) ** 2 * 60 * dt;
        this.vel.x += (dx / d) * f;
        this.vel.y += (dy / d) * f;
        this.vel.z += (dz / d) * f;
      }
    }
    if (fluidSubmersion(world, this, B.WATER) > 0) {
      this.vel.y += 12 * dt;
      this.vel.multiplyScalar(Math.exp(-3 * dt));
    } else {
      this.vel.y -= 12 * dt;
    }
    const drag = this.onGround ? Math.exp(-6 * dt) : Math.exp(-0.4 * dt);
    this.vel.x *= drag;
    this.vel.z *= drag;
    const r = moveEntity(world, this, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    if (r.hitY) this.vel.y = r.hitY && this.vel.y < -2 ? -this.vel.y * 0.3 : 0;
    if (r.hitX) this.vel.x = 0;
    if (r.hitZ) this.vel.z = 0;
    // Colour pulses between green and yellow, like the Minecraft orb.
    const t = (this.age + this.phase) * 5;
    this.material.color.setRGB(0.75 + 0.25 * Math.sin(t), 1, 0.3 + 0.2 * Math.sin(t + 4.19));
    this.sprite.position.set(this.pos.x, this.pos.y + 0.18 + Math.sin(this.age * 3 + this.phase) * 0.03, this.pos.z);
  }
}

export class XpOrbManager {
  constructor(game) {
    this.game = game;
    this.orbs = [];
  }

  spawn(x, y, z, amount) {
    for (const v of splitXp(amount)) this.orbs.push(new Orb(this.game, x, y, z, v));
  }

  // Fractional amounts (smelting) round randomly.
  spawnFloat(x, y, z, amount) {
    let n = Math.floor(amount);
    if (Math.random() < amount - n) n++;
    if (n > 0) this.spawn(x, y, z, n);
  }

  clear() {
    for (const o of this.orbs) o.dispose();
    this.orbs = [];
  }

  update(dt) {
    const p = this.game.player;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.update(dt);
      let remove = o.age > 300;
      if (!remove && !p.dead && p.xpCooldown <= 0 && o.age > 0.3) {
        const dx = p.pos.x - o.pos.x;
        const dy = p.pos.y + 0.9 - o.pos.y;
        const dz = p.pos.z - o.pos.z;
        if (Math.abs(dx) < 1 && Math.abs(dz) < 1 && Math.abs(dy) < 1.4) {
          p.xpCooldown = 2;
          p.addXp(o.value);
          this.game.sound('orb', undefined, undefined, undefined, 0.3, 0.6 + Math.random() * 0.7);
          remove = true;
        }
      }
      if (remove) {
        o.dispose();
        this.orbs.splice(i, 1);
      }
    }
  }
}

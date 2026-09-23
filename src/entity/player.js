// The player: movement physics (walking, sprinting, sneaking, swimming) and survival stats.
import * as THREE from 'three';
import { moveEntity, hasGroundBelow, fluidSubmersion, pointInFluid, touchingBlocks } from './physics.js';
import { B } from '../world/blocks.js';
import { Inventory } from '../inventory.js';

const GRAVITY = 32;
const JUMP_VELOCITY = 9.0;
const WALK = 4.317;
const SPRINT = 5.612;
const SNEAK = 1.31;

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.halfW = 0.3;
    this.height = 1.8;
    this.stepHeight = 0.6;
    this.onGround = false;
    this.hitH = false;
    this.sneaking = false;
    this.sprinting = false;
    this.inWater = 0;
    this.inLava = 0;
    this.eyeFluid = 0;
    this.fallDistance = 0;

    this.health = 20;
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 300;
    this.foodTimer = 0;
    this.regenTicks = 0;
    this.invulnerable = 0; // seconds
    this.hurtTime = 0;
    this.dead = false;
    this.spawn = null;

    this.inventory = new Inventory(36);
    this.walkDist = 0;
    this.stepSoundDist = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.eyeHeightSmooth = 1.62;
    this.lavaTimer = 0;
  }

  get eyeHeight() {
    return this.sneaking ? 1.27 : 1.62;
  }

  eyePos(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eyeHeightSmooth, this.pos.z);
  }

  lookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  update(dt, input) {
    if (this.dead) return;
    const world = this.game.world;
    // Stay frozen until the chunk under us exists.
    if (!world.isLoaded(this.pos.x, this.pos.z)) return;

    const mv = input.movement();
    this.sneaking = mv.sneak && !this.inWater;
    const forward = mv.forward;
    const strafe = mv.strafe;
    if (mv.sprint && forward > 0 && this.food > 6 && !this.sneaking) this.sprinting = true;
    if (forward <= 0 || this.food <= 6 || this.sneaking || (this.hitH && this.onGround)) this.sprinting = false;

    this.inWater = fluidSubmersion(world, this, B.WATER);
    this.inLava = fluidSubmersion(world, this, B.LAVA);
    const eye = this.eyePos();
    this.eyeFluid = pointInFluid(world, eye.x, eye.y, eye.z);

    // Desired horizontal velocity.
    let speed = this.sneaking ? SNEAK : this.sprinting ? SPRINT : WALK;
    if (this.inWater > 0) speed *= this.sprinting ? 0.6 : 0.5;
    if (this.inLava > 0) speed *= 0.35;
    if (this.game.usingItem) speed *= 0.3;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = -sin * forward + cos * strafe;
    let wz = -cos * forward - sin * strafe;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }
    const tx = wx * speed;
    const tz = wz * speed;

    const below = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z));
    const onIce = this.onGround && below === B.ICE;
    const fluid = this.inWater > 0 || this.inLava > 0;
    const rate = this.onGround ? (onIce ? 1.2 : 14) : fluid ? 6 : 2.2;
    const k = 1 - Math.exp(-rate * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;

    // Vertical.
    if (fluid) {
      const g = this.inLava > 0 ? 4 : 6;
      this.vel.y -= g * dt;
      this.vel.y *= Math.exp(-(this.inLava > 0 ? 4 : 3) * dt);
      if (mv.jump) {
        this.vel.y += 26 * dt;
        if (this.vel.y > 2.6) this.vel.y = 2.6;
        if (this.hitH) this.vel.y = Math.max(this.vel.y, 5.5); // climb out onto the shore
      }
      this.fallDistance = 0;
    } else {
      if (mv.jump && this.onGround) {
        this.vel.y = JUMP_VELOCITY;
        if (this.sprinting) {
          this.vel.x += -sin * 2.2;
          this.vel.z += -cos * 2.2;
          this.exhaustion += 0.2;
        } else {
          this.exhaustion += 0.05;
        }
      }
      this.vel.y -= GRAVITY * dt;
      this.vel.y *= Math.pow(0.98, dt * 20);
      if (this.vel.y < -78) this.vel.y = -78;
    }

    let dx = this.vel.x * dt;
    const dy = this.vel.y * dt;
    let dz = this.vel.z * dt;

    // Sneaking keeps you from walking off edges.
    if (this.sneaking && this.onGround) {
      if (dx !== 0 && !hasGroundBelow(world, this, this.pos.x + dx, this.pos.y, this.pos.z)) { dx = 0; this.vel.x = 0; }
      if (dz !== 0 && !hasGroundBelow(world, this, this.pos.x + dx, this.pos.y, this.pos.z + dz)) { dz = 0; this.vel.z = 0; }
    }

    const oldX = this.pos.x;
    const oldY = this.pos.y;
    const oldZ = this.pos.z;
    const wasOnGround = this.onGround;
    const r = moveEntity(world, this, dx, dy, dz);
    if (r.hitX) this.vel.x = 0;
    if (r.hitZ) this.vel.z = 0;
    if (r.hitY) this.vel.y = 0;

    // Fall damage.
    if (!this.onGround && this.pos.y < oldY) this.fallDistance += oldY - this.pos.y;
    if (fluid) this.fallDistance = 0;
    if (this.onGround && !wasOnGround) {
      if (this.fallDistance > 3) {
        const dmg = Math.ceil(this.fallDistance - 3);
        this.damage(dmg, 'fall');
        this.game.sound(dmg > 4 ? 'fall.big' : 'fall.small', this.pos.x, this.pos.y, this.pos.z);
      } else if (this.fallDistance > 0.8) {
        this.game.stepSound(this.pos.x, this.pos.y - 0.2, this.pos.z, 1.2);
      }
      this.fallDistance = 0;
    }
    if (this.onGround) this.fallDistance = 0;

    // Walking bookkeeping: exhaustion, footsteps, view bobbing.
    const moved = Math.hypot(this.pos.x - oldX, this.pos.z - oldZ);
    if (fluid) this.exhaustion += moved * 0.01;
    else if (this.sprinting) this.exhaustion += moved * 0.1;
    if (this.onGround && !fluid) {
      this.walkDist += moved;
      this.stepSoundDist += moved;
      if (this.stepSoundDist > 1.7 && !this.sneaking) {
        this.stepSoundDist = 0;
        this.game.stepSound(this.pos.x, this.pos.y - 0.2, this.pos.z, this.sprinting ? 1.1 : 0.8);
      }
    } else if (fluid) {
      this.swimDist = (this.swimDist || 0) + moved;
      if (this.swimDist > 2.2) {
        this.swimDist = 0;
        this.game.sound('swim', this.pos.x, this.pos.y + 1, this.pos.z);
      }
    }
    // Splash when falling into water.
    if (this.inWater > 0 && !this.wasInWater && this.vel.y < -3) {
      this.game.sound('splash', this.pos.x, this.pos.y, this.pos.z, Math.min(1, -this.vel.y / 12 + 0.3));
    }
    this.wasInWater = this.inWater > 0;
    const targetBob = this.onGround ? Math.min(1, moved / dt / WALK) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 10);
    this.bobPhase = this.walkDist * Math.PI * 0.62;
    this.eyeHeightSmooth += (this.eyeHeight - this.eyeHeightSmooth) * Math.min(1, dt * 15);

    // Hazards.
    if (this.inLava > 0) {
      this.damage(4, 'lava');
    }
    const touching = touchingBlocks(world, this, 0.01);
    if (touching.includes(B.CACTUS)) this.damage(1, 'cactus');
    if (this.pos.y < -20) this.damage(4, 'void');

    if (this.invulnerable > 0) this.invulnerable -= dt;
    if (this.hurtTime > 0) this.hurtTime -= dt;
  }

  // Survival stats, 20 times per second.
  tick() {
    if (this.dead) return;
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
    }
    this.foodTimer++;
    if (this.saturation > 0 && this.food >= 20 && this.health < 20) {
      if (this.foodTimer >= 10) {
        const amount = Math.min(this.saturation, 6);
        this.heal(amount / 6);
        this.exhaustion += amount;
        this.foodTimer = 0;
      }
    } else if (this.food >= 18 && this.health < 20) {
      if (this.foodTimer >= 80) {
        this.heal(1);
        this.exhaustion += 6;
        this.foodTimer = 0;
      }
    } else if (this.food <= 0) {
      if (this.foodTimer >= 80) {
        if (this.health > 1) this.damage(1, 'starve');
        this.foodTimer = 0;
      }
    } else {
      this.foodTimer = 0;
    }
    if (this.regenTicks > 0) {
      this.regenTicks--;
      if (this.regenTicks % 50 === 0) this.heal(1);
    }

    if (this.eyeFluid === B.WATER) {
      this.air--;
      if (this.air <= -20) {
        this.air = 0;
        this.damage(2, 'drown');
      }
    } else {
      this.air = Math.min(300, this.air + 4);
    }
  }

  heal(n) {
    this.health = Math.min(20, this.health + n);
  }

  damage(amount, cause, from = null) {
    if (this.dead || amount <= 0) return false;
    if (this.invulnerable > 0) return false;
    this.health -= amount;
    this.invulnerable = 0.5;
    this.hurtTime = 0.35;
    this.exhaustion += 0.1;
    this.lastDamageCause = cause;
    this.game.sound('hurt');
    if (from) {
      const dx = this.pos.x - from.x;
      const dz = this.pos.z - from.z;
      const d = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / d) * 7;
      this.vel.z += (dz / d) * 7;
      this.vel.y = Math.max(this.vel.y, 5.5);
      this.hurtDir = Math.atan2(dz, dx);
    }
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.game.onPlayerDeath(cause);
    }
    return true;
  }

  eat(food) {
    this.food = Math.min(20, this.food + food.hunger);
    this.saturation = Math.min(this.food, this.saturation + food.saturation);
    if (food.regen) this.regenTicks = 20 * food.regen * 5;
  }

  respawn(spawn) {
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.vel.set(0, 0, 0);
    this.health = 20;
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 300;
    this.fallDistance = 0;
    this.dead = false;
    this.invulnerable = 1;
  }

  toJSON() {
    return {
      pos: [this.pos.x, this.pos.y, this.pos.z],
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      food: this.food,
      saturation: this.saturation,
      exhaustion: this.exhaustion,
      air: this.air,
      inventory: this.inventory.toJSON(),
      selected: this.inventory.selected,
      spawn: this.spawn,
      dead: this.dead,
    };
  }

  load(d) {
    this.pos.set(d.pos[0], d.pos[1], d.pos[2]);
    this.yaw = d.yaw || 0;
    this.pitch = d.pitch || 0;
    this.health = d.health ?? 20;
    this.food = d.food ?? 20;
    this.saturation = d.saturation ?? 5;
    this.exhaustion = d.exhaustion ?? 0;
    this.air = d.air ?? 300;
    this.inventory.load(d.inventory);
    this.inventory.selected = d.selected || 0;
    this.spawn = d.spawn || null;
    this.dead = !!d.dead;
  }
}

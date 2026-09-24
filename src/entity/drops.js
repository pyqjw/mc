// Dropped item entities: fall, float, merge and get picked up by the player.
import * as THREE from 'three';
import { moveEntity, fluidSubmersion } from './physics.js';
import { makeItemMesh, isCubeItem } from '../render/itemModels.js';
import { B } from '../world/blocks.js';
import { maxStack } from '../items.js';
import { castShadow } from '../render/shadows.js';
import { mulberry32 } from '../world/noise.js';

class ItemEntity {
  constructor(game, stack, x, y, z, vel, pickupDelay) {
    this.game = game;
    this.stack = { id: stack.id, count: stack.count, damage: stack.damage || 0 };
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = vel || new THREE.Vector3((Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2);
    this.halfW = 0.125;
    this.height = 0.25;
    this.stepHeight = 0;
    this.onGround = false;
    this.age = 0;
    this.pickupDelay = pickupDelay;
    this.spin = Math.random() * Math.PI * 2;
    this.cube = isCubeItem(stack.id);
    this.group = new THREE.Group();
    this.meshes = [];
    this.updateCopies();
    game.renderer.scene.add(this.group);
  }

  // Bigger stacks show more copies of the item, like Minecraft.
  updateCopies() {
    const c = this.stack.count;
    const n = c <= 1 ? 1 : c <= 16 ? 2 : c <= 32 ? 3 : 4;
    if (n === this.meshes.length) return;
    while (this.meshes.length < n) {
      const i = this.meshes.length;
      const m = makeItemMesh(this.stack.id);
      m.scale.setScalar(this.cube ? 0.25 : 0.42);
      if (i > 0) {
        const r = mulberry32(this.stack.id * 31 + i);
        if (this.cube) m.position.set((r() - 0.5) * 0.18, (r() - 0.5) * 0.18, (r() - 0.5) * 0.18);
        else m.position.set((r() - 0.5) * 0.12, (r() - 0.5) * 0.12, -i * 0.045);
      }
      this.group.add(m);
      this.meshes.push(m);
    }
    while (this.meshes.length > n) {
      const m = this.meshes.pop();
      this.group.remove(m);
      m.material.dispose();
    }
    this.mesh = this.meshes[0];
    castShadow(this.group);
  }

  dispose() {
    this.game.renderer.scene.remove(this.group);
    for (const m of this.meshes) m.material.dispose(); // geometries are shared
  }

  update(dt) {
    const world = this.game.world;
    this.age += dt;
    if (!world.isLoaded(this.pos.x, this.pos.z)) return;
    const water = fluidSubmersion(world, this, B.WATER);
    if (water > 0) {
      this.vel.y += (water > 0.5 ? 6 : -4) * dt;
      this.vel.multiplyScalar(Math.exp(-3 * dt));
    } else {
      this.vel.y -= 16 * dt;
      const drag = this.onGround ? Math.exp(-10 * dt) : Math.exp(-0.5 * dt);
      this.vel.x *= drag;
      this.vel.z *= drag;
    }
    // Pushed out of blocks it got stuck in.
    const id = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
    if (id > 0 && id !== B.WATER && id !== B.LAVA && this.game.isSolidBlock(id)) {
      this.pos.y += 4 * dt;
      this.vel.set(0, 0, 0);
    } else {
      const r = moveEntity(world, this, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
      if (r.hitY) this.vel.y = 0;
      if (r.hitX) this.vel.x = 0;
      if (r.hitZ) this.vel.z = 0;
    }
    if (fluidSubmersion(world, this, B.LAVA) > 0) this.age = 1e9;

    this.spin += dt * 1.6;
    const bob = Math.sin(this.age * 2.5) * 0.05 + 0.1;
    this.group.position.set(this.pos.x, this.pos.y + bob + (this.cube ? 0.08 : 0.16), this.pos.z);
    this.group.rotation.y = this.spin;
    this.updateCopies();
    const light = world.getLight(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.2), Math.floor(this.pos.z));
    const b = Math.max(0.08, light / 15);
    const v = b * b * 0.5 + b * 0.5;
    for (const m of this.meshes) m.material.color.setScalar(v);
  }
}

export class DropManager {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.mergeTimer = 0;
  }

  spawn(stack, x, y, z, vel = null, pickupDelay = 0.5) {
    if (!stack || stack.count <= 0) return null;
    const e = new ItemEntity(this.game, stack, x, y, z, vel, pickupDelay);
    this.items.push(e);
    return e;
  }

  clear() {
    for (const e of this.items) e.dispose();
    this.items = [];
  }

  update(dt) {
    const player = this.game.player;
    const inv = player.inventory;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      e.update(dt);
      let remove = e.age > 300;
      if (!remove && !player.dead && e.age > e.pickupDelay) {
        const dx = player.pos.x - e.pos.x;
        const dz = player.pos.z - e.pos.z;
        const dy = player.pos.y + 0.9 - e.pos.y;
        if (Math.abs(dx) < 1.3 && Math.abs(dz) < 1.3 && Math.abs(dy) < 1.5) {
          const left = inv.add(e.stack);
          if (left < e.stack.count) {
            this.game.sound('pop', e.pos.x, e.pos.y, e.pos.z);
            this.game.hud.flashHotbar();
          }
          e.stack.count = left;
          if (left === 0) remove = true;
        }
      }
      if (remove) {
        e.dispose();
        this.items.splice(i, 1);
      }
    }
    // Merge nearby identical stacks.
    this.mergeTimer += dt;
    if (this.mergeTimer > 1) {
      this.mergeTimer = 0;
      for (let i = 0; i < this.items.length; i++) {
        const a = this.items[i];
        if (!a || a.stack.count === 0) continue;
        for (let j = i + 1; j < this.items.length; j++) {
          const b = this.items[j];
          if (b.stack.id !== a.stack.id || b.stack.damage !== a.stack.damage || b.stack.count === 0) continue;
          if (a.pos.distanceToSquared(b.pos) > 1) continue;
          const room = maxStack(a.stack.id) - a.stack.count;
          if (room < b.stack.count) continue;
          a.stack.count += b.stack.count;
          b.stack.count = 0;
          b.age = 1e9;
        }
      }
    }
  }
}

// Dropped item entities: fall, float, merge and get picked up by the player.
import * as THREE from 'three';
import { moveEntity, fluidSubmersion } from './physics.js';
import { makeItemMesh, isCubeItem } from '../render/itemModels.js';
import { B } from '../world/blocks.js';
import { maxStack } from '../items.js';
import { castShadow } from '../render/shadows.js';

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
    this.mesh = makeItemMesh(stack.id);
    this.mesh.scale.setScalar(this.cube ? 0.25 : 0.4);
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    if (this.stack.count > 1 && this.cube) {
      this.mesh2 = makeItemMesh(stack.id);
      this.mesh2.scale.setScalar(0.25);
      this.mesh2.position.set(0.06, 0.06, 0.06);
      this.group.add(this.mesh2);
    }
    castShadow(this.group);
    game.renderer.scene.add(this.group);
  }

  dispose() {
    this.game.renderer.scene.remove(this.group);
    this.mesh.material.dispose();
    if (this.mesh2) this.mesh2.material.dispose();
    if (!this.cube) this.mesh.geometry.dispose();
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
    this.group.position.set(this.pos.x, this.pos.y + bob + (this.cube ? 0.08 : 0.12), this.pos.z);
    if (this.cube) {
      this.group.rotation.y = this.spin;
    } else {
      const cam = this.game.renderer.camera.position;
      this.group.rotation.y = Math.atan2(cam.x - this.pos.x, cam.z - this.pos.z);
    }
    const light = world.getLight(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.2), Math.floor(this.pos.z));
    const b = Math.max(0.08, light / 15);
    this.mesh.material.color.setScalar(b * b * 0.5 + b * 0.5);
    if (this.mesh2) this.mesh2.material.color.copy(this.mesh.material.color);
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

// Projectiles: arrows (from bows and skeletons) and thrown eggs.
import * as THREE from 'three';
import { raycast } from '../world/raycast.js';
import { B, IS_SOLID } from '../world/blocks.js';
import { I } from '../items.js';
import { castShadow } from '../render/shadows.js';
import { makeItemMesh } from '../render/itemModels.js';

let arrowTexture = null;
function arrowTex() {
  if (arrowTexture) return arrowTexture;
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 8;
  const x = c.getContext('2d');
  const px = (xx, yy, col) => { x.fillStyle = col; x.fillRect(xx, yy, 1, 1); };
  for (let i = 3; i < 14; i++) px(i, 3, '#6b4a2a');
  for (let i = 3; i < 14; i++) px(i, 4, '#4f3620');
  for (const [xx, yy] of [[13, 2], [14, 3], [14, 4], [13, 5], [15, 3], [15, 4]]) px(xx, yy, '#9a9a9a');
  for (const [xx, yy] of [[0, 1], [1, 2], [2, 2], [0, 6], [1, 5], [2, 5], [1, 1], [1, 6], [0, 3], [0, 4], [2, 3], [2, 4]]) px(xx, yy, '#e8e8e8');
  arrowTexture = new THREE.CanvasTexture(c);
  arrowTexture.magFilter = THREE.NearestFilter;
  arrowTexture.minFilter = THREE.NearestFilter;
  arrowTexture.generateMipmaps = false;
  return arrowTexture;
}

// Two crossed quads pointing along +z, like Minecraft's arrow entity.
function arrowGeometry() {
  const L = 0.5;
  const W = 0.125;
  const pos = [
    0, -W, -L / 2, 0, -W, L / 2, 0, W, L / 2, 0, W, -L / 2,
    -W, 0, -L / 2, W, 0, -L / 2, W, 0, L / 2, -W, 0, L / 2,
  ];
  const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}
let arrowGeo = null;

// Segment (origin, dir, len) against an entity's box; returns the hit distance or null.
function segmentHitsBox(o, d, len, e, grow = 0.15) {
  const min = [e.pos.x - e.halfW - grow, e.pos.y - grow, e.pos.z - e.halfW - grow];
  const max = [e.pos.x + e.halfW + grow, e.pos.y + e.height + grow, e.pos.z + e.halfW + grow];
  const oo = [o.x, o.y, o.z];
  const dd = [d.x, d.y, d.z];
  let t0 = 0;
  let t1 = len;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-9) {
      if (oo[a] < min[a] || oo[a] > max[a]) return null;
      continue;
    }
    let ta = (min[a] - oo[a]) / dd[a];
    let tb = (max[a] - oo[a]) / dd[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

class Projectile {
  // opts: { kind: 'arrow' | 'egg', shooter: 'player' | mob, damage, crit, pickup }
  constructor(game, pos, vel, opts) {
    this.game = game;
    this.kind = opts.kind;
    this.shooter = opts.shooter;
    this.damage = opts.damage ?? 2;
    this.crit = !!opts.crit;
    this.pickup = !!opts.pickup;
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.age = 0;
    this.stuck = null; // block the arrow sticks in
    this.dead = false;
    if (this.kind === 'arrow') {
      if (!arrowGeo) arrowGeo = arrowGeometry();
      this.material = new THREE.MeshBasicMaterial({ map: arrowTex(), alphaTest: 0.5, side: THREE.DoubleSide });
      this.mesh = new THREE.Mesh(arrowGeo, this.material);
    } else {
      this.mesh = makeItemMesh(I.EGG);
      this.mesh.scale.setScalar(0.3);
      this.material = this.mesh.material;
    }
    castShadow(this.mesh);
    game.renderer.scene.add(this.mesh);
    this.orient();
  }

  dispose() {
    this.game.renderer.scene.remove(this.mesh);
    this.material.dispose();
  }

  orient() {
    this.mesh.position.copy(this.pos);
    if (this.kind === 'arrow' && this.vel.lengthSq() > 1e-6) {
      const target = this.pos.clone().add(this.vel);
      this.mesh.lookAt(target);
    } else if (this.kind === 'egg') {
      this.mesh.rotation.y = this.age * 6;
    }
  }

  update(dt) {
    const game = this.game;
    const world = game.world;
    this.age += dt;
    const light = world.getLight(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z));
    const b = Math.max(0.1, light / 15);
    this.material.color.setScalar(b * b * 0.5 + b * 0.5);
    if (this.stuck) {
      const [sx, sy, sz] = this.stuck;
      if (!IS_SOLID[Math.max(0, world.getBlock(sx, sy, sz))]) {
        this.stuck = null; // the block went away: fall
        this.vel.set(0, -1, 0);
      } else {
        if (this.age > 60) this.dead = true;
        const p = game.player;
        if (this.pickup && !p.dead && this.pos.distanceTo(p.pos.clone().setY(p.pos.y + 0.9)) < 1.4) {
          if (p.inventory.add({ id: I.ARROW, count: 1, damage: 0 }) === 0) {
            game.sound('pop', this.pos.x, this.pos.y, this.pos.z);
            this.dead = true;
          }
        }
        return;
      }
    }
    if (!world.isLoaded(this.pos.x, this.pos.z)) return;
    const water = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)) === B.WATER;
    this.vel.y -= (this.kind === 'arrow' ? 20 : 12) * dt;
    this.vel.multiplyScalar(Math.pow(water ? 0.6 : 0.99, dt * 20));
    const step = this.vel.clone().multiplyScalar(dt);
    const len = step.length();
    if (len > 1e-6) {
      const dir = step.clone().divideScalar(len);
      let best = null;
      const hit = raycast(world, this.pos, dir, len, { solid: true });
      if (hit) best = { t: hit.dist, block: hit };
      const targets = [];
      if (this.shooter !== 'player' && !game.player.dead) targets.push(game.player);
      for (const m of game.mobs.mobs) if (!m.dead && m !== this.shooter) targets.push(m);
      for (const e of targets) {
        if (e === this.shooter && this.age < 0.25) continue;
        const t = segmentHitsBox(this.pos, dir, len, e);
        if (t !== null && (!best || t < best.t)) best = { t, entity: e };
      }
      if (best && best.entity) {
        this.pos.addScaledVector(dir, best.t);
        this.hitEntity(best.entity);
      } else if (best) {
        this.pos.addScaledVector(dir, Math.max(0, best.t - 0.02));
        this.hitBlock(best.block);
      } else {
        this.pos.add(step);
      }
    }
    if (this.crit && this.age % 0.1 < dt) game.particles.smoke(this.pos.x, this.pos.y, this.pos.z, 1, 0xffffff, 0.08, 0.3, 0.3);
    if (this.pos.y < -10) this.dead = true;
    this.orient();
  }

  hitBlock(hit) {
    const game = this.game;
    if (this.kind === 'egg') {
      this.breakEgg();
      return;
    }
    this.stuck = [hit.x, hit.y, hit.z];
    this.vel.set(0, 0, 0);
    this.age = 0;
    this.crit = false;
    game.sound('arrow.hit', this.pos.x, this.pos.y, this.pos.z);
  }

  hitEntity(e) {
    const game = this.game;
    if (this.kind === 'egg') {
      if (e !== game.player) e.damage(0.01, this.pos, 0.3);
      this.breakEgg();
      return;
    }
    const speed = this.vel.length() / 20; // blocks per tick
    let dmg = Math.ceil(speed * this.damage);
    if (this.crit) dmg += Math.floor(Math.random() * (dmg / 2 + 2));
    const from = this.pos.clone().sub(this.vel.clone().normalize());
    let ok;
    if (e === game.player) {
      ok = e.damage(dmg, 'arrow', from);
    } else {
      if (this.shooter === 'player') e.lastHurtByPlayer = game.time;
      ok = e.damage(dmg, from, 0.6);
    }
    if (ok) {
      game.sound('arrow.hit', this.pos.x, this.pos.y, this.pos.z);
      this.dead = true;
    } else {
      // Bounced off an entity that was just hurt.
      this.vel.multiplyScalar(-0.1);
    }
  }

  breakEgg() {
    const game = this.game;
    game.particles.smoke(this.pos.x, this.pos.y, this.pos.z, 6, 0xf2e6c8, 0.12, 2, 0.4);
    if (Math.random() < 1 / 8) game.mobs.spawn('chicken', this.pos.x, Math.floor(this.pos.y) + 0.1, this.pos.z);
    this.dead = true;
  }
}

export class ProjectileManager {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  shoot(pos, vel, opts) {
    const p = new Projectile(this.game, pos, vel, opts);
    this.list.push(p);
    return p;
  }

  clear() {
    for (const p of this.list) p.dispose();
    this.list = [];
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.update(dt);
      if (p.dead) {
        p.dispose();
        this.list.splice(i, 1);
      }
    }
  }
}

// Velocity for an arrow fired from `from` towards `to` (Minecraft skeleton aim), in blocks/second.
export function aimVelocity(from, to, speed, inaccuracy) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const h = Math.hypot(dx, dz);
  const dy = to.y - from.y + h * 0.2;
  const v = new THREE.Vector3(dx, dy, dz).normalize();
  const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.0075 * inaccuracy;
  v.x += g();
  v.y += g();
  v.z += g();
  return v.normalize().multiplyScalar(speed);
}

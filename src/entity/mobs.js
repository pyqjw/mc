// Mobs: passive animals (pig, cow, sheep) and hostiles (zombie, creeper), with box models and simple AI.
import * as THREE from 'three';
import { moveEntity, fluidSubmersion } from './physics.js';
import { B, IS_SOLID, IS_OPAQUE, BLOCKS } from '../world/blocks.js';
import { I } from '../items.js';
import { mulberry32 } from '../world/noise.js';
import { castShadow } from '../render/shadows.js';

const PX = 1 / 16;

// ------------------------------------------------------------ textures
// Each mob type paints all its box faces into one small atlas so a mob needs a single material.
class PartAtlas {
  constructor(seedKey) {
    this.size = 128;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    this.ctx = this.canvas.getContext('2d');
    this.x = 0;
    this.y = 0;
    this.rowH = 0;
    this.geos = new Map();
    let seed = 0;
    for (let i = 0; i < seedKey.length; i++) seed = (seed * 31 + seedKey.charCodeAt(i)) | 0;
    this.rand = mulberry32(seed);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
  }

  paint(x0, y0, w, h, painter) {
    const img = this.ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const col = painter(x, y, w, h, this.rand);
        const i = (y * w + x) * 4;
        img.data[i] = col[0];
        img.data[i + 1] = col[1];
        img.data[i + 2] = col[2];
        img.data[i + 3] = 255;
      }
    }
    this.ctx.putImageData(img, x0, y0);
  }

  // Box geometry (sizes in pixels) whose faces are painted by `faces` (front = +z).
  geometry(key, w, h, d, faces) {
    if (this.geos.has(key)) return this.geos.get(key);
    const rw = 2 * d + 2 * w;
    const rh = d + h;
    if (this.x + rw > this.size) {
      this.x = 0;
      this.y += this.rowH;
      this.rowH = 0;
    }
    const ox = this.x;
    const oy = this.y;
    this.x += rw;
    this.rowH = Math.max(this.rowH, rh);
    // Regions in BoxGeometry face order: +x, -x, +y, -y, +z, -z.
    const regions = [
      ['right', ox, oy + d, d, h],
      ['left', ox + d + w, oy + d, d, h],
      ['top', ox + d, oy, w, d],
      ['bottom', ox + d + w, oy, w, d],
      ['front', ox + d, oy + d, w, h],
      ['back', ox + 2 * d + w, oy + d, w, h],
    ];
    const geo = new THREE.BoxGeometry(w * PX, h * PX, d * PX);
    const uv = geo.attributes.uv;
    const S = this.size;
    regions.forEach(([name, rx, ry, rw2, rh2], f) => {
      this.paint(rx, ry, rw2, rh2, faces[name] || faces.side);
      for (let v = f * 4; v < f * 4 + 4; v++) {
        const u0 = uv.getX(v);
        const v0 = uv.getY(v);
        uv.setXY(v, (rx + 0.01 + u0 * (rw2 - 0.02)) / S, 1 - (ry + 0.01 + (1 - v0) * (rh2 - 0.02)) / S);
      }
    });
    this.texture.needsUpdate = true;
    this.geos.set(key, geo);
    return geo;
  }
}

const atlases = new Map();
function atlasFor(type) {
  if (!atlases.has(type)) atlases.set(type, new PartAtlas(type));
  return atlases.get(type);
}

function noisy(base, amt) {
  return (x, y, w, h, r) => {
    const d = (r() - 0.5) * amt;
    return [base[0] + d, base[1] + d, base[2] + d];
  };
}

// Builds a box part mesh sharing the mob's single material.
function part(key, wpx, hpx, dpx, faces, ctx) {
  return new THREE.Mesh(ctx.atlas.geometry(key, wpx, hpx, dpx, faces), ctx.material);
}

function withFace(base, amt, draw) {
  return (x, y, w, h, r) => draw(x, y, w, h) || noisy(base, amt)(x, y, w, h, r);
}

// ------------------------------------------------------------ models
function quadruped(def, ctx) {
  const root = new THREE.Group();
  const body = part(def.key + 'body', def.body[0], def.body[1], def.body[2], def.bodyFaces, ctx);
  const legH = def.leg[1] * PX;
  body.position.y = legH + (def.body[1] * PX) / 2;
  root.add(body);
  const headPivot = new THREE.Group();
  headPivot.position.set(0, legH + def.body[1] * PX * def.headY, (def.body[2] * PX) / 2);
  const head = part(def.key + 'head', def.head[0], def.head[1], def.head[2], def.headFaces, ctx);
  head.position.z = (def.head[2] * PX) / 2 - 1 * PX;
  headPivot.add(head);
  if (def.extras) def.extras(headPivot, head, ctx);
  root.add(headPivot);
  const legs = [];
  const lx = (def.body[0] * PX) / 2 - (def.leg[0] * PX) / 2;
  const lz = (def.body[2] * PX) / 2 - (def.leg[2] * PX) / 2;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * lx, legH, sz * lz);
    const leg = part(def.key + 'leg', def.leg[0], def.leg[1], def.leg[2], def.legFaces, ctx);
    leg.position.y = -legH / 2;
    pivot.add(leg);
    root.add(pivot);
    legs.push(pivot);
  }
  return { root, head: headPivot, legs, arms: [], body };
}

function biped(def, ctx) {
  const root = new THREE.Group();
  const legH = 12 * PX;
  const legs = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 2 * PX, legH, 0);
    const leg = part(def.key + 'leg', 4, 12, 4, def.legFaces, ctx);
    leg.position.y = -legH / 2;
    pivot.add(leg);
    root.add(pivot);
    legs.push(pivot);
  }
  const body = part(def.key + 'body', 8, 12, 4, def.bodyFaces, ctx);
  body.position.y = legH + 6 * PX;
  root.add(body);
  const arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 6 * PX, legH + 10 * PX, 0);
    const arm = part(def.key + 'arm', 4, 12, 4, def.armFaces, ctx);
    arm.position.y = -4 * PX;
    pivot.add(arm);
    pivot.rotation.x = -Math.PI / 2;
    root.add(pivot);
    arms.push(pivot);
  }
  const head = new THREE.Group();
  head.position.y = legH + 12 * PX;
  const h = part(def.key + 'head', 8, 8, 8, def.headFaces, ctx);
  h.position.y = 4 * PX;
  head.add(h);
  root.add(head);
  return { root, head, legs, arms, body };
}

function creeperModel(def, ctx) {
  const root = new THREE.Group();
  const legH = 6 * PX;
  const legs = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 2 * PX, legH, sz * 4 * PX);
    const leg = part('creeperleg', 4, 6, 4, def.skin, ctx);
    leg.position.y = -legH / 2;
    pivot.add(leg);
    root.add(pivot);
    legs.push(pivot);
  }
  const body = part('creeperbody', 8, 12, 4, def.skin, ctx);
  body.position.y = legH + 6 * PX;
  root.add(body);
  const head = new THREE.Group();
  head.position.y = legH + 12 * PX;
  const h = part('creeperhead', 8, 8, 8, { side: def.skin.side, front: def.face }, ctx);
  h.position.y = 4 * PX;
  head.add(h);
  root.add(head);
  return { root, head, legs, arms: [], body };
}

const eye = (x, y, w, h, ex, ey) => (x === ex || x === w - 1 - ex) && y === ey;

export const MOB_TYPES = {
  pig: {
    key: 'pig', name: '猪', hp: 10, w: 0.9, h: 0.9, speed: 1.2, hostile: false,
    drops: [[I.PORKCHOP, 1, 3]], sound: 'pig',
    body: [10, 8, 16], leg: [4, 6, 4], head: [8, 8, 8], headY: 0.75,
    bodyFaces: { side: noisy([236, 160, 160], 18) },
    legFaces: { side: noisy([230, 150, 150], 14) },
    headFaces: {
      side: noisy([236, 160, 160], 14),
      front: withFace([236, 160, 160], 14, (x, y, w) => {
        if (eye(x, y, w, 8, 1, 3)) return [20, 20, 20];
        if (eye(x, y, w, 8, 2, 3)) return [240, 240, 240];
        if (y >= 4 && y <= 6 && x >= 2 && x <= 5) return (y === 5 && (x === 2 || x === 5)) ? [120, 60, 60] : [215, 120, 125];
        return null;
      }),
    },
    model: quadruped,
  },
  cow: {
    key: 'cow', name: '牛', hp: 10, w: 0.9, h: 1.4, speed: 1.1, hostile: false,
    drops: [[I.BEEF, 1, 3], [I.LEATHER, 0, 2]], sound: 'cow',
    body: [12, 10, 18], leg: [4, 12, 4], head: [8, 8, 6], headY: 0.85,
    bodyFaces: { side: (x, y, w, h, r) => ((Math.sin(x * 0.9) + Math.cos(y * 0.7 + x * 0.3)) > 0.6 ? [240, 240, 240] : noisy([70, 50, 35], 16)(x, y, w, h, r)) },
    legFaces: { side: (x, y, w, h, r) => (y > h - 3 ? [40, 35, 30] : noisy([70, 50, 35], 12)(x, y, w, h, r)) },
    headFaces: {
      side: noisy([70, 50, 35], 12),
      front: withFace([70, 50, 35], 12, (x, y, w) => {
        if (eye(x, y, w, 8, 1, 3)) return [20, 20, 20];
        if (eye(x, y, w, 8, 2, 3)) return [240, 240, 240];
        if (y >= 5 && x >= 2 && x <= 5) return y === 6 && (x === 2 || x === 5) ? [50, 40, 40] : [200, 180, 170];
        if (y < 3 && x > 2 && x < 5) return [240, 240, 240];
        return null;
      }),
    },
    extras: (pivot, head, ctx) => {
      for (const sx of [-1, 1]) {
        const horn = part('cowhorn', 1, 3, 1, { side: noisy([220, 215, 200], 10) }, ctx);
        horn.position.set(sx * 5 * PX, 4.5 * PX, head.position.z - 1 * PX);
        pivot.add(horn);
      }
    },
    model: quadruped,
  },
  sheep: {
    key: 'sheep', name: '羊', hp: 8, w: 0.9, h: 1.3, speed: 1.1, hostile: false,
    drops: [[I.WHITE_WOOL, 1, 1], [I.MUTTON, 1, 2]], sound: 'sheep',
    body: [12, 10, 16], leg: [4, 12, 4], head: [6, 6, 8], headY: 0.9,
    bodyFaces: { side: noisy([235, 235, 232], 22) },
    legFaces: { side: (x, y, w, h, r) => (y < 5 ? noisy([235, 235, 232], 18)(x, y, w, h, r) : noisy([215, 185, 165], 10)(x, y, w, h, r)) },
    headFaces: {
      side: noisy([215, 185, 165], 10),
      top: noisy([235, 235, 232], 18),
      front: withFace([215, 185, 165], 10, (x, y, w) => {
        if (eye(x, y, w, 6, 0, 2)) return [20, 20, 20];
        if (eye(x, y, w, 6, 1, 2)) return [240, 240, 240];
        if (y === 0) return [235, 235, 232];
        if (y >= 4 && x >= 2 && x <= 3) return [170, 120, 110];
        return null;
      }),
    },
    model: quadruped,
  },
  zombie: {
    key: 'zombie', name: '僵尸', hp: 20, w: 0.6, h: 1.95, speed: 2.3, hostile: true, attack: 3,
    drops: [[I.ROTTEN_FLESH, 0, 2]], sound: 'zombie', burns: true,
    legFaces: { side: noisy([55, 60, 150], 18), bottom: noisy([60, 60, 60], 10) },
    bodyFaces: { side: noisy([40, 160, 170], 18) },
    armFaces: { side: (x, y, w, h, r) => (y < 4 ? noisy([40, 160, 170], 16)(x, y, w, h, r) : noisy([80, 140, 70], 16)(x, y, w, h, r)) },
    headFaces: {
      side: noisy([80, 140, 70], 16),
      top: noisy([60, 110, 50], 14),
      front: withFace([80, 140, 70], 16, (x, y) => {
        if (y === 4 && (x === 1 || x === 2 || x === 5 || x === 6)) return [20, 30, 20];
        if (y === 6 && x >= 2 && x <= 5) return [50, 80, 45];
        return null;
      }),
    },
    model: biped,
  },
  creeper: {
    key: 'creeper', name: '苦力怕', hp: 20, w: 0.6, h: 1.7, speed: 2.4, hostile: true,
    drops: [[I.GUNPOWDER, 0, 2]], sound: 'creeper',
    skin: { side: (x, y, w, h, r) => { const t = r(); return t < 0.2 ? [40, 110, 40] : t < 0.35 ? [150, 210, 140] : [90, 180, 80]; } },
    face: (x, y, w, h, r) => {
      if ((y >= 2 && y <= 3) && (x === 1 || x === 2 || x === 5 || x === 6)) return [10, 10, 10];
      if (y === 4 && (x === 3 || x === 4)) return [10, 10, 10];
      if ((y === 5 || y === 6) && x >= 2 && x <= 5) return [10, 10, 10];
      if (y === 7 && (x === 2 || x === 5)) return [10, 10, 10];
      const t = r();
      return t < 0.2 ? [40, 110, 40] : t < 0.35 ? [150, 210, 140] : [90, 180, 80];
    },
    model: creeperModel,
  },
};

// ------------------------------------------------------------ mob
export class Mob {
  constructor(game, type, x, y, z) {
    this.game = game;
    this.def = MOB_TYPES[type];
    this.type = type;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.halfW = this.def.w / 2;
    this.height = this.def.h;
    this.stepHeight = 0.6;
    this.onGround = false;
    this.hitH = false;
    this.health = this.def.hp;
    this.yaw = Math.random() * Math.PI * 2;
    this.bodyYaw = this.yaw;
    this.moveDir = null;
    this.moveSpeed = 0;
    this.aiTimer = 0;
    this.panic = 0;
    this.hurtTime = 0;
    this.deathTime = -1;
    this.limb = 0;
    this.fallDistance = 0;
    this.attackCooldown = 0;
    this.fuse = 0;
    this.burnTimer = 0;
    this.burning = false;
    this.soundTimer = 100 + Math.random() * 300;
    const atlas = atlasFor(type);
    this.material = new THREE.MeshBasicMaterial({ map: atlas.texture });
    this.materials = [this.material];
    this.model = this.def.model(this.def, { atlas, material: this.material });
    this.object = this.model.root;
    this.object.position.copy(this.pos);
    castShadow(this.object);
    game.renderer.scene.add(this.object);
  }

  get dead() {
    return this.deathTime >= 0;
  }

  dispose() {
    this.game.renderer.scene.remove(this.object);
    this.material.dispose(); // geometries and the texture are shared per mob type
  }

  damage(amount, from, knock = 1) {
    if (this.dead || this.hurtTime > 0) return false;
    this.health -= amount;
    this.hurtTime = 0.5;
    if (from) {
      const dx = this.pos.x - from.x;
      const dz = this.pos.z - from.z;
      const d = Math.hypot(dx, dz) || 1;
      this.vel.x = (dx / d) * 6 * knock;
      this.vel.z = (dz / d) * 6 * knock;
      this.vel.y = 5.5;
    }
    if (!this.def.hostile) this.panic = 100;
    if (this.health <= 0) this.die();
    else this.game.sound(this.def.sound + '_hurt', this.pos.x, this.pos.y + 1, this.pos.z);
    return true;
  }

  die() {
    this.deathTime = 0;
    this.health = 0;
    this.game.sound(this.def.sound + '_death', this.pos.x, this.pos.y + 1, this.pos.z);
    const r = Math.random;
    for (const [id, min, max] of this.def.drops) {
      const n = min + Math.floor(r() * (max - min + 1));
      if (n > 0) this.game.dropItem(this.pos.x, this.pos.y + 0.5, this.pos.z, { id: this.burning && id === I.PORKCHOP ? I.COOKED_PORKCHOP : id, count: n });
    }
  }

  // Per-frame physics and animation.
  update(dt) {
    const world = this.game.world;
    if (this.dead) {
      this.deathTime += dt;
      this.object.rotation.z = Math.min(1, this.deathTime * 2.5) * Math.PI / 2;
      this.tint(1, 0.4, 0.4);
      return;
    }
    if (!world.isLoaded(this.pos.x, this.pos.z)) return;
    const water = fluidSubmersion(world, this, B.WATER);
    const lava = fluidSubmersion(world, this, B.LAVA);
    this.inWater = water;

    let tx = 0;
    let tz = 0;
    if (this.moveDir !== null && this.moveSpeed > 0) {
      tx = Math.sin(this.moveDir) * this.moveSpeed;
      tz = Math.cos(this.moveDir) * this.moveSpeed;
    }
    const rate = this.onGround ? 10 : water ? 4 : 1.5;
    const k = 1 - Math.exp(-rate * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    if (water > 0 || lava > 0) {
      this.vel.y -= 6 * dt;
      this.vel.y *= Math.exp(-3 * dt);
      if (water > 0.4) this.vel.y += 14 * dt; // swim up
      this.fallDistance = 0;
    } else {
      this.vel.y -= 32 * dt;
      this.vel.y *= Math.pow(0.98, dt * 20);
    }
    if (this.hitH && this.onGround && this.moveSpeed > 0) this.vel.y = 8.6;

    const oldY = this.pos.y;
    const oldX = this.pos.x;
    const oldZ = this.pos.z;
    const wasOnGround = this.onGround;
    const r = moveEntity(world, this, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    if (r.hitX) this.vel.x = 0;
    if (r.hitZ) this.vel.z = 0;
    if (r.hitY) this.vel.y = 0;
    if (!this.onGround && this.pos.y < oldY) this.fallDistance += oldY - this.pos.y;
    if (this.onGround && !wasOnGround) {
      if (this.fallDistance > 3) this.damage(Math.ceil(this.fallDistance - 3), null);
      this.fallDistance = 0;
    }
    if (lava > 0) this.damage(4, null);

    // Animation.
    const moved = Math.hypot(this.pos.x - oldX, this.pos.z - oldZ);
    this.limb += moved * 5;
    const swingAmt = Math.min(1, moved / dt / 2);
    const swing = Math.sin(this.limb) * 0.9 * swingAmt;
    if (this.model.legs.length === 4) {
      this.model.legs[0].rotation.x = swing;
      this.model.legs[1].rotation.x = -swing;
      this.model.legs[2].rotation.x = -swing;
      this.model.legs[3].rotation.x = swing;
    } else {
      this.model.legs[0].rotation.x = swing;
      this.model.legs[1].rotation.x = -swing;
    }
    let dy = this.yaw - this.bodyYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.bodyYaw += dy * Math.min(1, dt * 8);
    this.object.position.copy(this.pos);
    this.object.rotation.y = this.bodyYaw;

    if (this.hurtTime > 0) this.hurtTime -= dt;
    // Lighting / hurt tint / creeper flash.
    const light = world.getLight(Math.floor(this.pos.x), Math.floor(this.pos.y + this.height * 0.8), Math.floor(this.pos.z));
    let b = Math.max(0.06, light / 15);
    b = b * b * 0.6 + b * 0.4;
    if (this.fuse > 0 && Math.floor(this.fuse / 4) % 2 === 0) {
      this.tint(1.6, 1.6, 1.6);
      const s = 1 + this.fuse / 30 * 0.25;
      this.object.scale.set(s, 1 + this.fuse / 30 * 0.1, s);
    } else if (this.hurtTime > 0.2) {
      this.tint(b * 1.3 + 0.3, b * 0.35, b * 0.35);
    } else if (this.burning) {
      this.tint(b + 0.4, b * 0.75 + 0.15, b * 0.4);
    } else {
      this.tint(b, b, b);
      this.object.scale.set(1, 1, 1);
    }
  }

  tint(r, g, b) {
    for (const m of this.materials) m.color.setRGB(r, g, b);
  }

  // 20 Hz AI.
  tick() {
    if (this.dead) return;
    const game = this.game;
    const world = game.world;
    const player = game.player;
    if (--this.soundTimer <= 0) {
      this.soundTimer = 150 + Math.random() * 400;
      game.sound(this.def.sound, this.pos.x, this.pos.y + 1, this.pos.z);
    }
    if (this.attackCooldown > 0) this.attackCooldown--;

    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz, player.pos.y - this.pos.y);

    if (this.def.hostile) {
      // Burn in daylight.
      this.burning = false;
      if (this.def.burns && game.daylight > 0.75 && !this.inWater) {
        const hx = Math.floor(this.pos.x);
        const hy = Math.floor(this.pos.y + this.height);
        const hz = Math.floor(this.pos.z);
        if (world.getSkyLight(hx, hy, hz) >= 15 && world.getBlock(hx, hy, hz) === 0) {
          this.burning = true;
          if (++this.burnTimer % 20 === 0) { this.hurtTime = 0; this.damage(1, null); }
        }
      }
      const chase = !player.dead && dist < 32;
      if (this.type === 'creeper') {
        if (chase && dist < 3.2) {
          if (this.fuse === 0) game.sound('fuse', this.pos.x, this.pos.y + 1, this.pos.z);
          this.fuse++;
          this.moveSpeed = 0;
          if (this.fuse >= 30) {
            this.explode();
            return;
          }
        } else if (this.fuse > 0 && dist > 7) {
          this.fuse = Math.max(0, this.fuse - 1);
        } else if (this.fuse > 0) {
          this.fuse++;
          if (this.fuse >= 30) { this.explode(); return; }
        }
      }
      if (chase && this.fuse === 0) {
        this.yaw = Math.atan2(dx, dz);
        this.moveDir = this.yaw;
        this.moveSpeed = this.def.speed;
        this.model.head.rotation.x = -Math.atan2(player.pos.y + 1.5 - (this.pos.y + this.height), Math.hypot(dx, dz)) * 0.5;
        if (this.def.attack && this.attackCooldown <= 0 && Math.hypot(dx, dz) < this.halfW + player.halfW + 0.5
          && player.pos.y < this.pos.y + this.height && player.pos.y + player.height > this.pos.y) {
          if (player.damage(this.def.attack, 'mob', this.pos)) {
            this.attackCooldown = 20;
            this.model.arms.forEach((a) => { a.rotation.x = -Math.PI / 2 - 0.5; });
          }
        }
        this.model.arms.forEach((a) => { a.rotation.x += (-Math.PI / 2 - a.rotation.x) * 0.3; });
        return;
      }
    }

    // Wandering / panicking.
    if (this.panic > 0) {
      this.panic--;
      if (this.aiTimer-- <= 0) {
        this.aiTimer = 10 + Math.random() * 20;
        this.moveDir = Math.random() * Math.PI * 2;
      }
      this.moveSpeed = this.def.speed * 2;
      this.yaw = this.moveDir;
    } else if (this.aiTimer-- <= 0) {
      if (Math.random() < 0.45) {
        this.moveDir = Math.random() * Math.PI * 2;
        this.moveSpeed = this.def.speed;
        this.yaw = this.moveDir;
        this.aiTimer = 40 + Math.random() * 60;
      } else {
        this.moveSpeed = 0;
        this.aiTimer = 40 + Math.random() * 120;
        if (Math.random() < 0.5) this.yaw += (Math.random() - 0.5) * 2;
      }
    }
    // Avoid walking off cliffs and into water/lava (passive mobs).
    if (this.moveSpeed > 0 && this.moveDir !== null && this.onGround) {
      const ax = Math.floor(this.pos.x + Math.sin(this.moveDir) * (this.halfW + 0.6));
      const az = Math.floor(this.pos.z + Math.cos(this.moveDir) * (this.halfW + 0.6));
      const y = Math.floor(this.pos.y);
      let drop = 0;
      while (drop < 4 && !IS_SOLID[Math.max(0, world.getBlock(ax, y - 1 - drop, az))]) drop++;
      const ahead = world.getBlock(ax, y - drop - 1, az);
      if (drop >= 4 || (!this.def.hostile && (ahead === B.WATER || ahead === B.LAVA || world.getBlock(ax, y, az) === B.LAVA))) {
        this.moveDir += Math.PI;
        this.yaw = this.moveDir;
      }
    }
    this.model.head.rotation.x *= 0.8;
  }

  explode() {
    const game = this.game;
    this.deathTime = 99;
    game.explosion(this.pos.x, this.pos.y + 0.8, this.pos.z, 3);
    const n = Math.floor(Math.random() * 3);
    if (n > 0) game.dropItem(this.pos.x, this.pos.y + 0.5, this.pos.z, { id: I.GUNPOWDER, count: n });
  }

  toJSON() {
    return { type: this.type, x: this.pos.x, y: this.pos.y, z: this.pos.z, health: this.health, yaw: this.yaw };
  }
}

// ------------------------------------------------------------ manager
export class MobManager {
  constructor(game) {
    this.game = game;
    this.mobs = [];
    this.spawnTimer = 0;
  }

  spawn(type, x, y, z) {
    const m = new Mob(this.game, type, x, y, z);
    this.mobs.push(m);
    return m;
  }

  clear() {
    for (const m of this.mobs) m.dispose();
    this.mobs = [];
  }

  remove(m) {
    const i = this.mobs.indexOf(m);
    if (i >= 0) this.mobs.splice(i, 1);
    m.dispose();
  }

  update(dt) {
    const p = this.game.player.pos;
    const maxD = this.game.world.renderDistance * 16;
    for (const m of this.mobs) {
      m.object.visible = Math.abs(m.pos.x - p.x) < maxD && Math.abs(m.pos.z - p.z) < maxD;
      m.update(dt);
    }
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (m.dead && m.deathTime > 1) {
        this.game.particles.poof(m.pos.x, m.pos.y + m.height / 2, m.pos.z);
        this.remove(m);
      }
    }
  }

  tick() {
    const p = this.game.player.pos;
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      m.tick();
      if (m.def.hostile && !m.dead) {
        const d = Math.hypot(m.pos.x - p.x, m.pos.z - p.z);
        if (d > 128 || (d > 32 && Math.random() < 1 / 800)) this.remove(m);
      }
    }
    if (++this.spawnTimer >= 20) {
      this.spawnTimer = 0;
      this.trySpawnHostiles();
    }
  }

  trySpawnHostiles() {
    const game = this.game;
    const world = game.world;
    const hostiles = this.mobs.filter((m) => m.def.hostile).length;
    if (hostiles >= 20 || game.player.dead) return;
    const p = game.player.pos;
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const d = 24 + Math.random() * 40;
      const x = Math.floor(p.x + Math.cos(a) * d);
      const z = Math.floor(p.z + Math.sin(a) * d);
      if (!world.isLoaded(x, z)) continue;
      // Pick a random height near the player (caves count too) or the surface.
      let y;
      if (Math.random() < 0.5) {
        y = world.topY(x, z) + 1;
      } else {
        y = Math.floor(p.y + (Math.random() - 0.5) * 40);
      }
      if (y < 1 || y > 126) continue;
      const below = world.getBlock(x, y - 1, z);
      if (below <= 0 || !IS_OPAQUE[below] || below === B.BEDROCK) continue;
      if (world.getBlock(x, y, z) !== 0 || world.getBlock(x, y + 1, z) !== 0) continue;
      if (world.getBlockLight(x, y, z) > 0) continue;
      if (world.getSkyLight(x, y, z) - world.skyDarken > 7) continue;
      const type = Math.random() < 0.6 ? 'zombie' : 'creeper';
      const count = type === 'zombie' ? 1 + Math.floor(Math.random() * 3) : 1;
      for (let i = 0; i < count; i++) this.spawn(type, x + 0.5 + i * 0.3, y, z + 0.5);
      return;
    }
  }

  // Animals appear when a chunk is first generated, like in Minecraft.
  spawnAnimals(chunk) {
    const rand = Math.random;
    if (rand() > 0.12) return;
    const types = ['pig', 'cow', 'sheep', 'sheep'];
    const type = types[Math.floor(rand() * types.length)];
    const n = 2 + Math.floor(rand() * 3);
    const baseX = Math.floor(rand() * 12) + 2;
    const baseZ = Math.floor(rand() * 12) + 2;
    for (let i = 0; i < n; i++) {
      const lx = Math.min(15, Math.max(0, baseX + Math.floor(rand() * 5) - 2));
      const lz = Math.min(15, Math.max(0, baseZ + Math.floor(rand() * 5) - 2));
      for (let y = 126; y > 1; y--) {
        const id = chunk.blocks[lx | (lz << 4) | (y << 8)];
        if (id === 0) continue;
        if (id === B.GRASS && chunk.blocks[lx | (lz << 4) | ((y + 1) << 8)] === 0) {
          this.spawn(type, chunk.cx * 16 + lx + 0.5, y + 1, chunk.cz * 16 + lz + 0.5);
        }
        if (id !== 0 && !(BLOCKS[id] && BLOCKS[id].leaves)) break;
      }
    }
  }

  inChunk(cx, cz, remove) {
    const out = [];
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (m.def.hostile || m.dead) continue;
      if (Math.floor(m.pos.x / 16) === cx && Math.floor(m.pos.z / 16) === cz) {
        out.push(m.toJSON());
        if (remove) this.remove(m);
      }
    }
    return out;
  }

  restore(list) {
    for (const e of list) {
      if (!MOB_TYPES[e.type]) continue;
      const m = this.spawn(e.type, e.x, e.y, e.z);
      m.health = e.health ?? m.health;
      m.yaw = m.bodyYaw = e.yaw || 0;
    }
  }

  // Ray pick for melee attacks.
  raycast(origin, dir, maxDist) {
    let best = null;
    let bestT = maxDist;
    for (const m of this.mobs) {
      if (m.dead) continue;
      const min = [m.pos.x - m.halfW, m.pos.y, m.pos.z - m.halfW];
      const max = [m.pos.x + m.halfW, m.pos.y + m.height, m.pos.z + m.halfW];
      let t0 = 0;
      let t1 = bestT;
      const o = [origin.x, origin.y, origin.z];
      const d = [dir.x, dir.y, dir.z];
      let ok = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) {
          if (o[a] < min[a] || o[a] > max[a]) { ok = false; break; }
        } else {
          let ta = (min[a] - o[a]) / d[a];
          let tb = (max[a] - o[a]) / d[a];
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) { ok = false; break; }
        }
      }
      if (ok && t0 < bestT) {
        bestT = t0;
        best = m;
      }
    }
    return best ? { mob: best, dist: bestT } : null;
  }
}

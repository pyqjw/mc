// Small billboard particles: block-break fragments, smoke puffs and explosion clouds.
import * as THREE from 'three';
import { TEX_SIDE, TEX_TOP, ATLAS_TILES_PER_ROW, BLOCKS } from '../world/blocks.js';

const MAX = 600;

export class Particles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.plane = new THREE.PlaneGeometry(1, 1);
    this.smokeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    this.breakMats = [];
  }

  // Block fragment materials, shared per light level.
  breakMaterial(light) {
    if (!this.breakMats[light]) {
      const mat = new THREE.MeshBasicMaterial({ map: this.game.renderer.itemAtlas, alphaTest: 0.5, side: THREE.DoubleSide });
      const b = Math.max(0.15, light / 15);
      mat.color.setScalar(b * b * 0.5 + b * 0.5);
      this.breakMats[light] = mat;
    }
    return this.breakMats[light];
  }

  clear() {
    for (const p of this.list) this.removeMesh(p);
    this.list = [];
  }

  removeMesh(p) {
    this.game.renderer.scene.remove(p.mesh);
    if (p.ownGeo) p.mesh.geometry.dispose();
    if (p.ownMat) p.mesh.material.dispose();
  }

  add(p) {
    if (this.list.length >= MAX) {
      this.removeMesh(this.list.shift());
    }
    this.list.push(p);
    this.game.renderer.scene.add(p.mesh);
  }

  blockBreak(x, y, z, id, count = 24) {
    const b = BLOCKS[id];
    if (!b) return;
    const tile = b.leaves || b.render !== 1 ? TEX_SIDE[id] : (Math.random() < 0.5 ? TEX_TOP[id] : TEX_SIDE[id]);
    const mat = this.breakMaterial(Math.max(0, Math.min(15, this.game.world.getLight(x, y, z))));
    const T = 1 / ATLAS_TILES_PER_ROW;
    const tx = tile % ATLAS_TILES_PER_ROW;
    const ty = Math.floor(tile / ATLAS_TILES_PER_ROW);
    for (let i = 0; i < count; i++) {
      const g = new THREE.PlaneGeometry(1, 1);
      const px = Math.floor(Math.random() * 12);
      const py = Math.floor(Math.random() * 12);
      const u0 = (tx + px / 16) * T;
      const u1 = (tx + (px + 4) / 16) * T;
      const v1 = 1 - (ty + py / 16) * T;
      const v0 = 1 - (ty + (py + 4) / 16) * T;
      const uv = g.attributes.uv;
      uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
      const mesh = new THREE.Mesh(g, mat);
      const s = 0.08 + Math.random() * 0.08;
      mesh.scale.setScalar(s);
      mesh.position.set(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6);
      const vel = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 4 + 1, (Math.random() - 0.5) * 4);
      this.add({ mesh, vel, life: 0.5 + Math.random() * 0.6, gravity: 20, ownGeo: true, collide: true });
    }
  }

  smoke(x, y, z, count, color = 0xcccccc, size = 0.3, speed = 1.5, life = 1) {
    for (let i = 0; i < count; i++) {
      const mat = this.smokeMat.clone();
      mat.color.setHex(color);
      const mesh = new THREE.Mesh(this.plane, mat);
      mesh.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      mesh.position.set(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6);
      const vel = new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.7 + 0.3, (Math.random() - 0.5) * speed);
      this.add({ mesh, vel, life: life * (0.6 + Math.random() * 0.6), maxLife: life, gravity: -0.5, ownMat: true, fade: true });
    }
  }

  // Green sparkles (bone meal).
  happy(x, y, z) {
    for (let i = 0; i < 12; i++) {
      const mat = this.smokeMat.clone();
      mat.color.setHex(Math.random() < 0.5 ? 0x7cff5a : 0x3ecf2a);
      const mesh = new THREE.Mesh(this.plane, mat);
      mesh.scale.setScalar(0.08 + Math.random() * 0.06);
      mesh.position.set(x + (Math.random() - 0.5) * 1.2, y + Math.random() * 0.6, z + (Math.random() - 0.5) * 1.2);
      const vel = new THREE.Vector3(0, 0.3 + Math.random() * 0.4, 0);
      this.add({ mesh, vel, life: 0.8 + Math.random() * 0.6, maxLife: 1.2, gravity: 0, ownMat: true, fade: true });
    }
  }

  // White arc in front of the player for a sword sweep.
  sweep(x, y, z, yaw) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const g = new THREE.RingGeometry(0.7, 1.0, 12, 1, Math.PI * 0.15, Math.PI * 0.7);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, yaw, 0);
    mesh.rotateX(-Math.PI / 2);
    this.add({ mesh, vel: new THREE.Vector3(), life: 0.25, maxLife: 0.3, gravity: 0, ownMat: true, ownGeo: true, fade: true, keepRotation: true });
  }

  poof(x, y, z) {
    this.smoke(x, y, z, 14, 0xeeeeee, 0.35, 2, 0.8);
  }

  explosion(x, y, z) {
    this.smoke(x, y, z, 50, 0xdddddd, 1.2, 9, 1.4);
    this.smoke(x, y, z, 20, 0x888888, 0.9, 5, 1.8);
  }

  update(dt) {
    const cam = this.game.renderer.camera;
    const world = this.game.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.removeMesh(p);
        this.list.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      if (p.fade) p.vel.multiplyScalar(Math.exp(-2.5 * dt));
      const m = p.mesh;
      m.position.addScaledVector(p.vel, dt);
      if (p.collide) {
        const id = world.getBlock(Math.floor(m.position.x), Math.floor(m.position.y - 0.05), Math.floor(m.position.z));
        if (id > 0 && this.game.isSolidBlock(id)) {
          m.position.y = Math.floor(m.position.y - 0.05) + 1.05;
          p.vel.set(p.vel.x * 0.5, 0, p.vel.z * 0.5);
        }
      }
      if (p.fade) m.material.opacity = Math.min(1, p.life / (p.maxLife * 0.5)) * 0.8;
      if (!p.keepRotation) m.quaternion.copy(cam.quaternion);
    }
  }
}

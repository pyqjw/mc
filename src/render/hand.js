// First-person arm / held item, rendered in its own scene on top of the world.
// Like Minecraft 1.9+, the bare arm shows when the hand is empty; held items float on their own.
import * as THREE from 'three';
import { makeItemMesh, isCubeItem, bowMesh } from './itemModels.js';
import { getItem, I } from '../items.js';
import { skinBox, getSkinTexture } from './skin.js';

// Pose of the empty arm: shoulder position and the direction the arm points in.
const ARM_SHOULDER = new THREE.Vector3(0.84, -0.78, -0.5);
const ARM_DIR = new THREE.Vector3(-0.4, 0.56, -0.72).normalize();
const ARM_TWIST = 2.4;

export class Hand {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.heldId = -1;
    this.mesh = null;
    this.swing = 0; // 0..1 progress of the current swing, <0 idle
    this.equip = 1;
    this.time = 0;

    // Right arm from the player skin, pivoting at the shoulder (the top of the box).
    this.armMat = new THREE.MeshBasicMaterial({ map: getSkinTexture(), vertexColors: true });
    const geo = skinBox('rightArm', 1 / 16);
    geo.translate(0, -0.375, 0);
    const armMesh = new THREE.Mesh(geo, this.armMat);
    armMesh.scale.set(1.25, 1.25, 1.25);
    this.arm = new THREE.Group();
    this.arm.add(armMesh);
    this.arm.position.copy(ARM_SHOULDER);
    this.arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), ARM_DIR);
    this.arm.rotateY(ARM_TWIST);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  startSwing() {
    if (this.swing < 0 || this.swing > 0.5) this.swing = 0;
  }

  setItem(id, pull = 0) {
    if (id === this.heldId && pull === this.pull) return;
    if (id !== this.heldId) this.equip = 0;
    this.heldId = id;
    this.pull = pull;
    if (this.mesh) {
      this.root.remove(this.mesh);
      if (this.mesh !== this.arm) this.mesh.material.dispose(); // geometries are shared
    }
    if (id <= 0) {
      this.mesh = this.arm;
    } else if (isCubeItem(id)) {
      this.mesh = makeItemMesh(id);
      this.mesh.scale.setScalar(0.36);
      this.mesh.position.set(0.54, -0.4, -0.8);
      this.mesh.rotation.set(0.1, Math.PI / 4, 0);
    } else if (id === I.BOW && pull > 0) {
      // Drawn bow held up in the middle of the view.
      this.mesh = bowMesh(pull);
      this.mesh.scale.setScalar(0.6);
      this.mesh.position.set(0.12, -0.2, -0.6);
      this.mesh.rotation.set(0.2, 0.8, 0.25, 'YXZ');
    } else {
      this.mesh = makeItemMesh(id);
      const it = getItem(id);
      const tool = !!(it && (it.tool || it.bow));
      this.mesh.scale.setScalar(it && it.bow ? 0.55 : tool ? 0.68 : 0.52);
      this.mesh.position.set(0.56, tool ? -0.3 : -0.36, -0.78);
      // Seen from behind (mirrored) so the head of a tool points up and to the left.
      this.mesh.rotation.set(-0.15, Math.PI + 0.1, tool ? 0.12 : 0, 'YXZ');
    }
    this.root.add(this.mesh);
  }

  update(dt, { heldId, bobPhase, bobAmount, light, eating, bowPull = -1 }) {
    this.time += dt;
    const pull = bowPull < 0 ? 0 : bowPull < 0.65 ? 1 : bowPull < 0.9 ? 2 : 3;
    this.setItem(heldId || 0, pull);
    if (this.swing >= 0) {
      this.swing += dt / 0.3;
      if (this.swing >= 1) this.swing = -1;
    }
    this.equip = Math.min(1, this.equip + dt * 5);
    const s = this.swing >= 0 ? this.swing : 0;
    const sw = Math.sin(s * Math.PI);
    const sw2 = Math.sin(Math.sqrt(s) * Math.PI);
    const r = this.root;
    const empty = this.mesh === this.arm;
    r.position.set(
      -sw2 * (empty ? 0.32 : 0.25) + Math.sin(bobPhase) * 0.035 * bobAmount,
      sw2 * (empty ? 0.16 : 0.12) - (1 - this.equip) * 0.6 - Math.abs(Math.cos(bobPhase)) * 0.04 * bobAmount,
      -sw * 0.15,
    );
    r.rotation.set(-sw * (empty ? 0.35 : 0.6), sw2 * 0.4, -sw * 0.25);
    if (eating) {
      r.position.x -= 0.2;
      r.position.y += 0.12 + Math.sin(this.time * 25) * 0.025;
      r.rotation.x += 0.4;
    }
    if (pull === 3) {
      // Full draw: the bow trembles.
      r.position.x += Math.sin(this.time * 40) * 0.004;
      r.position.y += Math.cos(this.time * 33) * 0.004;
    }
    const b = Math.max(0.1, light);
    if (empty) this.armMat.color.setScalar(Math.min(1.25, b * 1.2));
    else if (this.mesh) this.mesh.material.color.setScalar(b);
  }
}

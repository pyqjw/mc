// First-person arm / held item, rendered in its own scene on top of the world.
import * as THREE from 'three';
import { makeItemMesh, isCubeItem } from './itemModels.js';
import { getItem } from '../items.js';

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
    this.armMat = new THREE.MeshBasicMaterial({ color: 0xd8a070 });
    const armGeo = new THREE.BoxGeometry(0.16, 0.16, 0.7);
    armGeo.translate(0, 0, -0.2);
    this.arm = new THREE.Mesh(armGeo, this.armMat);
    this.time = 0;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  startSwing() {
    if (this.swing < 0 || this.swing > 0.5) this.swing = 0;
  }

  setItem(id) {
    if (id === this.heldId) return;
    this.heldId = id;
    this.equip = 0;
    if (this.mesh) {
      this.root.remove(this.mesh);
      if (this.mesh !== this.arm) {
        this.mesh.material.dispose();
        if (!isCubeItem(this.heldIdPrev)) this.mesh.geometry.dispose();
      }
    }
    this.heldIdPrev = id;
    if (id <= 0) {
      this.mesh = this.arm;
      this.arm.position.set(0.5, -0.5, -0.55);
      this.arm.rotation.set(0.45, 0.25, 0.35);
    } else if (isCubeItem(id)) {
      this.mesh = makeItemMesh(id);
      this.mesh.scale.setScalar(0.38);
      this.mesh.position.set(0.52, -0.42, -0.75);
      this.mesh.rotation.set(0.1, Math.PI / 4, 0);
    } else {
      this.mesh = makeItemMesh(id);
      const it = getItem(id);
      const tool = it && it.tool;
      this.mesh.scale.setScalar(tool ? 0.62 : 0.5);
      this.mesh.position.set(0.52, -0.33, -0.72);
      this.mesh.rotation.set(0, -Math.PI / 2 + 0.35, tool ? 0.35 : 0.1);
    }
    this.root.add(this.mesh);
  }

  update(dt, { heldId, bobPhase, bobAmount, light, eating }) {
    this.time += dt;
    this.setItem(heldId || 0);
    if (this.swing >= 0) {
      this.swing += dt / 0.3;
      if (this.swing >= 1) this.swing = -1;
    }
    this.equip = Math.min(1, this.equip + dt * 5);
    const s = this.swing >= 0 ? this.swing : 0;
    const sw = Math.sin(s * Math.PI);
    const sw2 = Math.sin(Math.sqrt(s) * Math.PI);
    const r = this.root;
    r.position.set(
      -sw2 * 0.25 + Math.sin(bobPhase) * 0.035 * bobAmount,
      sw2 * 0.12 - (1 - this.equip) * 0.6 - Math.abs(Math.cos(bobPhase)) * 0.04 * bobAmount,
      -sw * 0.15,
    );
    r.rotation.set(-sw * 0.6, sw2 * 0.4, -sw * 0.25);
    if (eating) {
      r.position.x -= 0.2;
      r.position.y += 0.12 + Math.sin(this.time * 25) * 0.025;
      r.rotation.x += 0.4;
    }
    const b = Math.max(0.1, light);
    if (this.mesh === this.arm) this.armMat.color.setRGB(0.85 * b, 0.63 * b, 0.44 * b);
    else if (this.mesh) this.mesh.material.color.setScalar(b);
  }
}

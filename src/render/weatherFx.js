// Rain and snow drawn like Minecraft: a textured vertical strip in every column around the camera
// that precipitation reaches, scrolling down; plus lightning bolts.
import * as THREE from 'three';
import { mulberry32 } from '../world/noise.js';
import { SNOW_TEMP } from '../world/generator.js';

const RADIUS = 10;
const MAX_COLUMNS = (RADIUS * 2 + 1) ** 2;

function streakTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 64;
  const x = c.getContext('2d');
  const r = mulberry32(kind === 'snow' ? 5 : 3);
  if (kind === 'rain') {
    for (let i = 0; i < 14; i++) {
      const px = Math.floor(r() * 16);
      const py = Math.floor(r() * 64);
      const len = 4 + Math.floor(r() * 6);
      for (let k = 0; k < len; k++) {
        const a = 0.35 + 0.5 * (k / len);
        x.fillStyle = `rgba(150,180,230,${a})`;
        x.fillRect(px, (py + k) % 64, 1, 1);
      }
    }
  } else {
    for (let i = 0; i < 18; i++) {
      const px = Math.floor(r() * 15);
      const py = Math.floor(r() * 63);
      x.fillStyle = 'rgba(255,255,255,0.95)';
      x.fillRect(px, py, r() < 0.4 ? 2 : 1, r() < 0.4 ? 2 : 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const VERT = /* glsl */ `
  attribute vec4 aData; // kind (0 rain, 1 snow), seed, light, unused
  uniform float time;
  uniform vec3 camPos;
  varying vec2 vUv;
  varying float vKind;
  varying float vLight;
  varying float vFade;
  void main() {
    vKind = aData.x;
    vLight = aData.z;
    vec3 p = position;
    float snow = step(0.5, aData.x);
    float speed = mix(3.2, 0.3, snow);
    float sway = snow * sin(time * 0.8 + aData.y * 6.2831) * 0.25;
    vUv = vec2(uv.x + sway + aData.y, p.y / 4.0 + time * speed + aData.y * 7.0);
    float d = length(p.xz - camPos.xz);
    vFade = clamp(1.3 - d / ${RADIUS.toFixed(1)}, 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D rainTex;
  uniform sampler2D snowTex;
  uniform float strength;
  uniform vec3 tint;
  varying vec2 vUv;
  varying float vKind;
  varying float vLight;
  varying float vFade;
  void main() {
    vec4 t = vKind > 0.5 ? texture2D(snowTex, vUv) : texture2D(rainTex, vUv);
    float a = t.a * strength * vFade;
    if (a < 0.02) discard;
    gl_FragColor = vec4(t.rgb * tint * vLight, a);
  }
`;

export class WeatherFx {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = {
      time: { value: 0 },
      camPos: { value: new THREE.Vector3() },
      strength: { value: 0 },
      tint: { value: new THREE.Color(1, 1, 1) },
      rainTex: { value: streakTexture('rain') },
      snowTex: { value: streakTexture('snow') },
    };
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_COLUMNS * 4 * 3);
    this.uv = new Float32Array(MAX_COLUMNS * 4 * 2);
    this.data = new Float32Array(MAX_COLUMNS * 4 * 4);
    const idx = new Uint32Array(MAX_COLUMNS * 6);
    for (let i = 0; i < MAX_COLUMNS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('aData', new THREE.BufferAttribute(this.data, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.lastKey = '';
    this.rebuildTimer = 0;
    this.climate = new Map();
    this.bolts = [];
  }

  dispose() {
    this.scene.remove(this.mesh);
    for (const b of this.bolts) this.scene.remove(b.mesh);
    this.bolts = [];
  }

  // Is precipitation at this column snow?
  snowy(world, x, z, y) {
    const key = x + ',' + z;
    let temp = this.climate.get(key);
    if (temp === undefined) {
      temp = world.generator.column(x, z).temp;
      if (this.climate.size > 20000) this.climate.clear();
      this.climate.set(key, temp);
    }
    return temp < SNOW_TEMP || y > 100;
  }

  update(dt, cam, world, weather, daylight, now) {
    const s = weather ? weather.rain : 0;
    this.uniforms.strength.value = s;
    this.uniforms.time.value = now;
    this.uniforms.camPos.value.copy(cam);
    this.uniforms.tint.value.setScalar(0.35 + 0.65 * daylight);
    this.mesh.visible = s > 0.01;
    this.updateBolts(dt);
    if (!this.mesh.visible) return;
    const cx = Math.floor(cam.x);
    const cy = Math.floor(cam.y);
    const cz = Math.floor(cam.z);
    this.rebuildTimer -= dt;
    const key = cx + ',' + cy + ',' + cz;
    if (key === this.lastKey && this.rebuildTimer > 0) return;
    this.lastKey = key;
    this.rebuildTimer = 0.5;
    let n = 0;
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (!world.isLoaded(x, z)) continue;
        // Rain stops at the highest block of the column.
        const top = world.heightAt(x, z);
        if (top >= cy + RADIUS) continue;
        const y0 = Math.max(top + 1, cy - RADIUS);
        const y1 = cy + RADIUS;
        if (y1 <= y0) continue;
        // One strip per column, turned to face the camera.
        const ax = x + 0.5 - cam.x;
        const az = z + 0.5 - cam.z;
        const len = Math.hypot(ax, az) || 1;
        const px = (-az / len) * 0.5;
        const pz = (ax / len) * 0.5;
        const o = n * 12;
        this.pos.set([x + 0.5 - px, y0, z + 0.5 - pz, x + 0.5 + px, y0, z + 0.5 + pz, x + 0.5 + px, y1, z + 0.5 + pz, x + 0.5 - px, y1, z + 0.5 - pz], o);
        this.uv.set([0, 0, 1, 0, 1, 1, 0, 1], n * 8);
        const kind = this.snowy(world, x, z, y0) ? 1 : 0;
        const seed = ((x * 73856093) ^ (z * 19349663)) >>> 0;
        const light = Math.max(0.25, world.getLight(x, Math.min(127, Math.max(y0, cy)), z) / 15 + 0.2);
        for (let k = 0; k < 4; k++) this.data.set([kind, (seed % 1000) / 1000, Math.min(1, light), 0], (n * 4 + k) * 4);
        n++;
      }
    }
    const g = this.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.attributes.aData.needsUpdate = true;
    g.setDrawRange(0, n * 6);
  }

  // ------------------------------------------------------------ lightning
  bolt(x, y, z) {
    const r = Math.random;
    const pts = [[x, y, z]];
    let px = x;
    let pz = z;
    for (let yy = y; yy < y + 90; yy += 3 + r() * 4) {
      px += (r() - 0.5) * 2.2;
      pz += (r() - 0.5) * 2.2;
      pts.push([px, yy, pz]);
    }
    const pos = [];
    const addStrip = (list, w) => {
      for (let i = 0; i < list.length - 1; i++) {
        const [ax, ay, az] = list[i];
        const [bx, by, bz] = list[i + 1];
        for (const [ox, oz] of [[w, 0], [0, w]]) {
          pos.push(ax - ox, ay, az - oz, ax + ox, ay, az + oz, bx + ox, by, bz + oz);
          pos.push(ax - ox, ay, az - oz, bx + ox, by, bz + oz, bx - ox, by, bz - oz);
        }
      }
    };
    addStrip(pts, 0.35);
    addStrip(pts, 0.12);
    // A couple of short branches.
    for (let b = 0; b < 2; b++) {
      const start = pts[2 + Math.floor(r() * (pts.length - 4))];
      const br = [start];
      let [bx, by, bz] = start;
      for (let i = 0; i < 4; i++) {
        bx += (r() - 0.5) * 3;
        bz += (r() - 0.5) * 3;
        by -= 2 + r() * 3;
        br.push([bx, by, bz]);
      }
      addStrip(br, 0.15);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.MeshBasicMaterial({
      color: 0xd8e4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.scene.add(mesh);
    this.bolts.push({ mesh, age: 0 });
  }

  updateBolts(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      // Minecraft's bolt flickers a few times before it fades.
      const t = b.age;
      b.mesh.visible = t < 0.08 || (t > 0.14 && t < 0.24) || (t > 0.3 && t < 0.36);
      b.mesh.material.opacity = Math.max(0, 1 - t / 0.5);
      if (t > 0.5) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.bolts.splice(i, 1);
      }
    }
  }
}

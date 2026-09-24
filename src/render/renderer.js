// Three.js setup: chunk materials, sky (gradient dome, sun, moon, stars, clouds), block highlight and cracks.
import * as THREE from 'three';
import { getAtlasCanvas, getItemAtlasCanvas, makeCrackCanvases, updateAnimatedTiles } from './textures.js';
import { mulberry32 } from '../world/noise.js';
import { CHUNK_VERT, CHUNK_FRAG } from './chunkShader.js';
import { Shadows } from './shadows.js';
import { PostFX } from './postfx.js';

// Tilt of the sun's path so shadows fall at an angle (like most shader packs).
const SUN_TILT = 0.4;

export const SHADER_QUALITY = {
  off: null,
  medium: { shadowSize: 1024, shadowRadius: 48, bloom: true, rays: false },
  high: { shadowSize: 2048, shadowRadius: 64, bloom: true, rays: true },
};

THREE.ColorManagement.enabled = false;

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 bottomColor;
  uniform vec3 sunDir;
  uniform vec3 glowColor;
  uniform float glow;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float s = max(dot(d, sunDir), 0.0);
    // Sunset colours are strongest on the side of the sky where the sun is.
    vec3 hor = mix(horizonColor, glowColor, pow(s, 3.0) * glow);
    vec3 c = h > 0.0 ? mix(hor, topColor, smoothstep(0.0, 0.45, h)) : mix(hor, bottomColor, smoothstep(0.0, 0.2, -h));
    c += glowColor * (pow(s, 6.0) * 0.25 + pow(s, 60.0) * 0.5) * (0.35 + glow);
    gl_FragColor = vec4(c, 1.0);
  }
`;

function lerpColor(a, b, t) {
  return new THREE.Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfd9ff, 60, 100); // for entities; chunks use their own uniforms
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';

    this.atlas = canvasTexture(getAtlasCanvas());
    this.itemAtlas = canvasTexture(getItemAtlasCanvas());
    this.uniforms = {
      map: { value: this.atlas },
      daylight: { value: 1 },
      fogColor: { value: new THREE.Color(0.75, 0.85, 1) },
      fogNear: { value: 60 },
      fogFar: { value: 100 },
      gamma: { value: 0.45 },
      time: { value: 0 },
      shadowMap: { value: null },
      shadowMatrix: { value: new THREE.Matrix4() },
      shadowTexel: { value: 1 / 1024 },
      lightDir: { value: new THREE.Vector3(0, 1, 0) },
      lightColor: { value: new THREE.Color(1, 1, 1) },
      ambientColor: { value: new THREE.Color(0.5, 0.55, 0.65) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      skyTop: { value: new THREE.Color() },
      skyHorizon: { value: new THREE.Color() },
    };
    this.quality = 'off';
    this.shadows = null;
    this.post = null;
    this.sunScreen = new THREE.Vector2();
    const mk = (props, alphaTest, opacity) => new THREE.ShaderMaterial({
      vertexShader: CHUNK_VERT,
      fragmentShader: CHUNK_FRAG,
      uniforms: { ...this.uniforms, alphaTest: { value: alphaTest }, opacity: { value: opacity } },
      ...props,
    });
    this.materials = {
      solid: mk({ side: THREE.FrontSide }, 0.0, 1),
      cutout: mk({ side: THREE.DoubleSide }, 0.5, 1),
      translucent: mk({ side: THREE.DoubleSide, transparent: true, depthWrite: false }, 0.01, 1),
    };

    this.buildSky();
    this.buildHighlight();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
    if (this.onResize) this.onResize(w, h);
  }

  buildSky() {
    this.skyUniforms = {
      topColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      bottomColor: { value: new THREE.Color() },
      sunDir: this.uniforms.sunDir,
      glowColor: { value: new THREE.Color(1, 0.6, 0.3) },
      glow: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyUniforms, side: THREE.BackSide, depthWrite: false,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.skyDome = dome;
    this.scene.add(dome);

    this.celestialTilt = new THREE.Group();
    this.celestialTilt.rotation.x = SUN_TILT;
    this.scene.add(this.celestialTilt);
    this.celestial = new THREE.Group();
    this.celestialTilt.add(this.celestial);

    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = sunCanvas.height = 32;
    const sctx = sunCanvas.getContext('2d');
    sctx.fillStyle = 'rgba(255,240,150,0.25)';
    sctx.fillRect(0, 0, 32, 32);
    sctx.fillStyle = '#fff6b0';
    sctx.fillRect(8, 8, 16, 16);
    sctx.fillStyle = '#ffffe8';
    sctx.fillRect(10, 10, 12, 12);
    const sunMat = new THREE.MeshBasicMaterial({ map: canvasTexture(sunCanvas), transparent: true, depthWrite: false, fog: false });
    this.sunMat = sunMat;
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), sunMat);
    this.sun.position.set(700, 0, 0);
    this.sun.lookAt(0, 0, 0);
    this.sun.renderOrder = -9;
    this.celestial.add(this.sun);

    const moonCanvas = document.createElement('canvas');
    moonCanvas.width = moonCanvas.height = 32;
    const mctx = moonCanvas.getContext('2d');
    mctx.fillStyle = '#dfe3ea';
    mctx.fillRect(10, 10, 12, 12);
    mctx.fillStyle = '#b8bec8';
    mctx.fillRect(12, 13, 3, 3);
    mctx.fillRect(17, 17, 3, 2);
    mctx.fillRect(16, 11, 2, 2);
    const moonMat = new THREE.MeshBasicMaterial({ map: canvasTexture(moonCanvas), transparent: true, depthWrite: false, fog: false });
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), moonMat);
    this.moon.position.set(-700, 0, 0);
    this.moon.lookAt(0, 0, 0);
    this.moon.renderOrder = -9;
    this.celestial.add(this.moon);

    const rand = mulberry32(1234);
    const starPos = [];
    for (let i = 0; i < 1200; i++) {
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      starPos.push(Math.cos(a) * r * 800, u * 800, Math.sin(a) * r * 800);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.renderOrder = -9;
    this.celestial.add(this.stars);

    // Clouds: a big flat textured plane that follows the camera.
    const cc = document.createElement('canvas');
    cc.width = cc.height = 64;
    const cctx = cc.getContext('2d');
    const crand = mulberry32(42);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(crand() * 64);
      const y = Math.floor(crand() * 64);
      const w = 2 + Math.floor(crand() * 7);
      const h = 2 + Math.floor(crand() * 5);
      cctx.fillStyle = '#fff';
      for (const [ox, oy] of [[0, 0], [-64, 0], [0, -64], [-64, -64]]) cctx.fillRect(x + ox, y + oy, w, h);
    }
    const ctex = canvasTexture(cc);
    ctex.wrapS = ctex.wrapT = THREE.RepeatWrapping;
    ctex.repeat.set(8, 8);
    this.cloudTex = ctex;
    this.cloudMat = new THREE.MeshBasicMaterial({ map: ctex, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1536, 1536), this.cloudMat);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.renderOrder = 2;
    this.scene.add(this.clouds);
  }

  buildHighlight() {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.crackTextures = makeCrackCanvases().map(canvasTexture);
    this.crackMat = new THREE.MeshBasicMaterial({
      map: this.crackTextures[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.crackMat);
    this.crack.visible = false;
    this.scene.add(this.crack);
  }

  setHighlight(box) {
    if (!box) {
      this.highlight.visible = false;
      return;
    }
    const [x0, y0, z0, x1, y1, z1] = box;
    this.highlight.visible = true;
    this.highlight.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.highlight.scale.set(x1 - x0 + 0.004, y1 - y0 + 0.004, z1 - z0 + 0.004);
  }

  setCrack(box, stage) {
    if (!box || stage < 0) {
      this.crack.visible = false;
      return;
    }
    const [x0, y0, z0, x1, y1, z1] = box;
    this.crack.visible = true;
    this.crack.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.crack.scale.set(x1 - x0, y1 - y0, z1 - z0);
    this.crackMat.map = this.crackTextures[Math.min(9, stage)];
  }

  // time: 0..24000 ticks. Returns daylight factor.
  updateSky(time, renderDistance, underwater, inLava) {
    const t = time / 24000;
    const angle = t * Math.PI * 2; // 0 = sunrise (east, +x)
    const sunY = Math.sin(angle);
    const day = THREE.MathUtils.smoothstep(sunY, -0.18, 0.25);
    this.celestial.rotation.z = angle;
    this.starMat.opacity = Math.max(0, 1 - day * 1.6) * 0.9;

    const dayTop = new THREE.Color(0.47, 0.65, 1.0);
    const dayHorizon = new THREE.Color(0.75, 0.85, 1.0);
    const nightTop = new THREE.Color(0.01, 0.01, 0.04);
    const nightHorizon = new THREE.Color(0.03, 0.04, 0.08);
    let top = lerpColor(nightTop, dayTop, day);
    let horizon = lerpColor(nightHorizon, dayHorizon, day);
    // Sunrise / sunset glow.
    const glow = Math.max(0, 1 - Math.abs(sunY) / 0.3) * 0.65;
    if (glow > 0) horizon = lerpColor(horizon, new THREE.Color(1.0, 0.55, 0.3), glow);

    const daylight = 0.25 + 0.75 * day;
    this.uniforms.daylight.value = daylight;

    // Sun direction on the tilted path, and the light used for shadows (sun by day, moon by night).
    const sunDir = new THREE.Vector3(Math.cos(angle), sunY * Math.cos(SUN_TILT), sunY * Math.sin(SUN_TILT)).normalize();
    this.uniforms.sunDir.value.copy(sunDir);
    const u = this.uniforms;
    if (sunY > -0.04) {
      u.lightDir.value.copy(sunDir);
      const warm = THREE.MathUtils.smoothstep(sunY, 0.0, 0.4);
      const k = THREE.MathUtils.smoothstep(sunY, -0.04, 0.12) * 0.78;
      u.lightColor.value.setRGB(1.0, 0.5 + 0.43 * warm, 0.25 + 0.6 * warm).multiplyScalar(k);
    } else {
      u.lightDir.value.copy(sunDir).negate();
      const k = THREE.MathUtils.smoothstep(-sunY, 0.04, 0.2) * 0.22;
      u.lightColor.value.setRGB(0.55, 0.65, 1.0).multiplyScalar(k);
    }
    u.ambientColor.value.setRGB(0.06 + 0.26 * day, 0.07 + 0.31 * day, 0.13 + 0.4 * day);
    if (glow > 0) u.ambientColor.value.lerp(new THREE.Color(0.55, 0.42, 0.4), glow * 0.4);
    this.skyUniforms.glow.value = glow;
    this.skyUniforms.glowColor.value.setRGB(1.0, 0.55 + 0.35 * day * (1 - glow), 0.3 + 0.5 * day * (1 - glow));
    if (sunY < -0.1) this.skyUniforms.glowColor.value.setRGB(0.1, 0.12, 0.2);
    this.sunMat.color.setScalar(this.quality === 'off' ? 1 : 2.6);
    const far = renderDistance * 16;
    if (underwater) {
      const c = new THREE.Color(0.08, 0.2, 0.55).multiplyScalar(0.3 + 0.7 * daylight);
      this.uniforms.fogColor.value.copy(c);
      this.uniforms.fogNear.value = 0;
      this.uniforms.fogFar.value = 22;
      top = c;
      horizon = c;
    } else if (inLava) {
      const c = new THREE.Color(0.8, 0.25, 0.02);
      this.uniforms.fogColor.value.copy(c);
      this.uniforms.fogNear.value = 0;
      this.uniforms.fogFar.value = 2.5;
      top = c;
      horizon = c;
    } else {
      this.uniforms.fogColor.value.copy(horizon);
      this.uniforms.fogNear.value = far * 0.55;
      this.uniforms.fogFar.value = far * 0.95;
    }
    this.scene.fog.color.copy(this.uniforms.fogColor.value);
    this.scene.fog.near = this.uniforms.fogNear.value;
    this.scene.fog.far = this.uniforms.fogFar.value;
    this.skyUniforms.topColor.value.copy(top);
    this.skyUniforms.horizonColor.value.copy(horizon);
    this.skyUniforms.bottomColor.value.copy(horizon).multiplyScalar(0.6);
    u.skyTop.value.copy(top);
    u.skyHorizon.value.copy(horizon);
    this.underwater = underwater;
    this.dayFactor = day;
    this.cloudMat.color.setScalar(0.25 + 0.75 * day);
    if (glow > 0 && sunY > -0.1) this.cloudMat.color.lerp(new THREE.Color(1.0, 0.6, 0.45), glow * 0.7);
    this.clouds.visible = !underwater && !inLava;
    return daylight;
  }

  updateFollow(camPos, time) {
    this.skyDome.position.copy(camPos);
    this.celestialTilt.position.copy(camPos);
    this.clouds.position.set(camPos.x, 140, camPos.z);
    const size = 1536 / 8; // world units per texture repeat
    const drift = time * 0.02;
    this.cloudTex.offset.set((camPos.x + drift) / size, -camPos.z / size);
  }

  // 'off' | 'medium' | 'high'
  setQuality(q) {
    const cfg = SHADER_QUALITY[q];
    this.quality = cfg ? q : 'off';
    if (this.shadows) { this.shadows.dispose(); this.shadows = null; }
    if (this.post) { this.post.dispose(); this.post = null; }
    for (const m of Object.values(this.materials)) {
      m.defines = cfg ? { SHADERS: 1, WAVING: 1 } : {};
      m.needsUpdate = true;
    }
    if (!cfg) {
      this.uniforms.shadowMap.value = null;
      return;
    }
    this.shadows = new Shadows(cfg.shadowSize, cfg.shadowRadius, this.atlas, this.uniforms.time);
    this.uniforms.shadowMap.value = this.shadows.target.depthTexture;
    this.uniforms.shadowTexel.value = this.shadows.texel;
    this.post = new PostFX(this.renderer, { bloom: cfg.bloom, rays: cfg.rays });
    this.post.setSize(window.innerWidth, window.innerHeight);
  }

  render(extraScene, extraCamera) {
    const r = this.renderer;
    const now = performance.now() / 1000;
    this.uniforms.time.value = now;
    if (updateAnimatedTiles(now)) this.atlas.needsUpdate = true;
    if (this.quality !== 'off' && this.post) {
      const u = this.uniforms;
      const lit = u.lightColor.value.r + u.lightColor.value.g > 0.02;
      if (lit) {
        this.shadows.update(this.camera.position, u.lightDir.value);
        this.shadows.render(r, this.scene);
        u.shadowMatrix.value.copy(this.shadows.matrix);
      }
      r.setRenderTarget(this.post.target);
      r.clear();
      r.render(this.scene, this.camera);
      // Sun rays when the sun is in front of the camera.
      const sp = this.uniforms.sunDir.value.clone().multiplyScalar(500).add(this.camera.position).project(this.camera);
      const facing = this.camera.getWorldDirection(new THREE.Vector3()).dot(this.uniforms.sunDir.value);
      let rays = 0;
      if (facing > 0 && Math.abs(sp.x) < 1.6 && Math.abs(sp.y) < 1.6 && !this.underwater) {
        rays = Math.min(1, facing * 1.5) * THREE.MathUtils.smoothstep(this.uniforms.sunDir.value.y, -0.05, 0.1) * 0.9;
      }
      this.sunScreen.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
      const day = this.dayFactor ?? 1;
      this.post.finish({
        sunScreen: this.sunScreen,
        rayStrength: rays,
        rayColor: u.lightColor.value,
        bloom: this.underwater ? 0.4 : 0.22,
        exposure: 0.9 + (1 - day) * 0.05,
        tint: this.underwater ? new THREE.Color(0.85, 0.95, 1.1) : new THREE.Color(1.02, 1.0, 0.97),
      });
    } else {
      r.setRenderTarget(null);
      r.clear();
      r.render(this.scene, this.camera);
    }
    if (extraScene) {
      r.clearDepth();
      r.render(extraScene, extraCamera);
    }
  }
}

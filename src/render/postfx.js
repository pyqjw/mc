// HDR post-processing: bloom, god rays, tone mapping, colour grading and vignette.
import * as THREE from 'three';

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BRIGHT_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform float threshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    float l = max(max(c.r, c.g), c.b);
    float k = clamp((l - threshold) / (l + 0.0001), 0.0, 1.0);
    gl_FragColor = vec4(c * k * k, 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 dir;
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tInput, vUv).rgb * 0.2270270;
    s += texture2D(tInput, vUv + dir * 1.3846154).rgb * 0.3162162;
    s += texture2D(tInput, vUv - dir * 1.3846154).rgb * 0.3162162;
    s += texture2D(tInput, vUv + dir * 3.2307692).rgb * 0.0702703;
    s += texture2D(tInput, vUv - dir * 3.2307692).rgb * 0.0702703;
    gl_FragColor = vec4(s, 1.0);
  }
`;

// Sky pixels near the sun, blurred radially towards the sun's screen position.
const RAYS_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 sunPos;
  uniform float aspect;
  varying vec2 vUv;
  const int SAMPLES = 40;
  void main() {
    vec2 delta = (vUv - sunPos) / float(SAMPLES) * 0.9;
    vec2 uv = vUv;
    float decay = 1.0;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < SAMPLES; i++) {
      uv -= delta;
      vec2 d = (uv - sunPos) * vec2(aspect, 1.0);
      float nearSun = exp(-dot(d, d) * 7.0);
      float sky = step(0.99999, texture2D(tDepth, uv).r);
      sum += texture2D(tColor, uv).rgb * sky * nearSun * decay;
      decay *= 0.95;
    }
    gl_FragColor = vec4(sum / float(SAMPLES), 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tBloom1;
  uniform sampler2D tBloom2;
  uniform sampler2D tBloom3;
  uniform sampler2D tRays;
  uniform float bloom;
  uniform float rays;
  uniform vec3 rayColor;
  uniform float exposure;
  uniform float saturation;
  uniform float vignette;
  uniform vec3 tint;
  varying vec2 vUv;

  vec3 shoulder(vec3 c) {
    // Identity below 0.7, smooth highlight roll-off above (keeps the classic look but tames HDR).
    const float t = 0.7;
    vec3 over = max(c - t, 0.0);
    return min(c, vec3(t)) + (1.0 - t) * (1.0 - exp(-over / (1.0 - t)));
  }

  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    vec3 b = texture2D(tBloom1, vUv).rgb * 0.5 + texture2D(tBloom2, vUv).rgb * 0.7 + texture2D(tBloom3, vUv).rgb * 0.9;
    c += b * bloom;
    c += texture2D(tRays, vUv).rgb * rayColor * rays;
    c *= exposure * tint;
    c = shoulder(c);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, saturation);
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
    vec2 v = vUv - 0.5;
    c *= 1.0 - vignette * dot(v, v) * 1.6;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

function rt(w, h, type, depth = false) {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: depth,
  });
  if (depth) t.depthTexture = new THREE.DepthTexture(Math.max(1, w), Math.max(1, h));
  return t;
}

export class PostFX {
  constructor(renderer, { bloom = true, rays = true } = {}) {
    this.renderer = renderer;
    this.useBloom = bloom;
    this.useRays = rays;
    this.type = THREE.HalfFloatType;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.brightMat = mk(BRIGHT_FRAG, { tColor: { value: null }, threshold: { value: 1.0 } });
    this.blurMat = mk(BLUR_FRAG, { tInput: { value: null }, dir: { value: new THREE.Vector2() } });
    this.raysMat = mk(RAYS_FRAG, { tColor: { value: null }, tDepth: { value: null }, sunPos: { value: new THREE.Vector2() }, aspect: { value: 1 } });
    this.compMat = mk(COMPOSITE_FRAG, {
      tColor: { value: null }, tBloom1: { value: null }, tBloom2: { value: null }, tBloom3: { value: null }, tRays: { value: null },
      bloom: { value: 0.35 }, rays: { value: 0 }, rayColor: { value: new THREE.Color(1, 0.9, 0.7) },
      exposure: { value: 1 }, saturation: { value: 1.0 }, vignette: { value: 0.35 }, tint: { value: new THREE.Color(1, 1, 1) },
    });
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.setSize(1, 1);
  }

  setSize(w, h) {
    this.disposeTargets();
    const pr = this.renderer.getPixelRatio();
    const W = Math.floor(w * pr);
    const H = Math.floor(h * pr);
    this.w = W;
    this.h = H;
    this.scene_ = rt(W, H, this.type, true);
    this.levels = [];
    for (let i = 1; i <= 3; i++) {
      const lw = Math.floor(W / 2 ** i);
      const lh = Math.floor(H / 2 ** i);
      this.levels.push({ a: rt(lw, lh, this.type), b: rt(lw, lh, this.type), w: lw, h: lh });
    }
    this.raysRT = rt(Math.floor(W / 2), Math.floor(H / 2), this.type);
  }

  disposeTargets() {
    if (!this.scene_) return;
    this.scene_.depthTexture.dispose();
    this.scene_.dispose();
    for (const l of this.levels) { l.a.dispose(); l.b.dispose(); }
    this.raysRT.dispose();
  }

  dispose() {
    this.disposeTargets();
    for (const m of [this.brightMat, this.blurMat, this.raysMat, this.compMat]) m.dispose();
    this.quad.geometry.dispose();
  }

  get target() {
    return this.scene_;
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  // p: { sunScreen: Vector2 | null, rayStrength, rayColor: Color, bloom, exposure, tint: Color }
  finish(p) {
    const color = this.scene_.texture;
    const r = this.renderer;
    if (this.useBloom && p.bloom > 0) {
      // Bright pass, then a blurred mip chain: each level blurs the previous one at half size.
      this.brightMat.uniforms.tColor.value = color;
      this.pass(this.brightMat, this.levels[0].a);
      for (let i = 0; i < this.levels.length; i++) {
        const l = this.levels[i];
        this.blurMat.uniforms.tInput.value = (i === 0 ? l : this.levels[i - 1]).a.texture;
        this.blurMat.uniforms.dir.value.set(1 / l.w, 0);
        this.pass(this.blurMat, l.b);
        this.blurMat.uniforms.tInput.value = l.b.texture;
        this.blurMat.uniforms.dir.value.set(0, 1 / l.h);
        this.pass(this.blurMat, l.a);
      }
    }
    const raysOn = this.useRays && p.sunScreen && p.rayStrength > 0.001;
    if (raysOn) {
      const u = this.raysMat.uniforms;
      u.tColor.value = color;
      u.tDepth.value = this.scene_.depthTexture;
      u.sunPos.value.copy(p.sunScreen);
      u.aspect.value = this.w / this.h;
      this.pass(this.raysMat, this.raysRT);
    }
    const c = this.compMat.uniforms;
    c.tColor.value = color;
    const bloomOn = this.useBloom && p.bloom > 0;
    c.tBloom1.value = bloomOn ? this.levels[0].a.texture : this.black;
    c.tBloom2.value = bloomOn ? this.levels[1].a.texture : this.black;
    c.tBloom3.value = bloomOn ? this.levels[2].a.texture : this.black;
    c.bloom.value = p.bloom;
    c.tRays.value = raysOn ? this.raysRT.texture : this.black;
    c.rays.value = raysOn ? p.rayStrength : 0;
    c.rayColor.value.copy(p.rayColor);
    c.exposure.value = p.exposure;
    c.tint.value.copy(p.tint);
    this.pass(this.compMat, null);
    r.setRenderTarget(null);
  }
}

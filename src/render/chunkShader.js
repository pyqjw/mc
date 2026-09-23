// GLSL for terrain. The classic path mimics Minecraft's lightmap; with the SHADERS define the same
// materials become a "shader pack": sun/moon shadow mapping, directional light, water reflections,
// waving foliage and HDR output for bloom.
//
// aLight = (sky light, block light, face shade * ambient occlusion, flag). Flags (0..255):
//   128 = leaves, 180 = water, 200 = water surface top vertex, 255 = top of a plant.

export const CHUNK_VERT = /* glsl */ `
  attribute vec4 aLight;
  uniform float time;
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vFlag;
  varying float vDepth;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vLight = aLight.xyz;
    vFlag = aLight.w;
    vec4 wp = modelMatrix * vec4(position, 1.0);
  #ifdef WAVING
    float f = aLight.w;
    if (f > 0.45 && f < 0.55) {
      // Leaves rustle.
      wp.x += sin(time * 1.7 + wp.x * 0.7 + wp.z * 0.3 + wp.y) * 0.035;
      wp.z += cos(time * 1.3 + wp.z * 0.8 + wp.y * 0.5) * 0.035;
      wp.y += sin(time * 2.1 + wp.x + wp.z) * 0.015;
    } else if (f > 0.97) {
      // Grass, flowers and crops sway at their tips.
      float s = sin(time * 2.0 + wp.x * 0.9 + wp.z * 0.6) * 0.09 + sin(time * 3.7 + wp.x * 1.7 + wp.z) * 0.03;
      wp.x += s;
      wp.z += s * 0.6;
    } else if (f > 0.76 && f < 0.8) {
      // Water surface bobs gently.
      wp.y += (sin(time * 1.6 + wp.x * 1.1 + wp.z * 0.7) + sin(time * 1.2 + wp.z * 1.6 - wp.x * 0.4)) * 0.02 - 0.04;
    }
  #endif
    vWorldPos = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vDepth = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const CHUNK_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float daylight;
  uniform float alphaTest;
  uniform float opacity;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform float gamma;
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vFlag;
  varying float vDepth;
  varying vec3 vWorldPos;

  float curve(float l) {
    float moody = l / (4.0 - 3.0 * l);
    return mix(moody, l, gamma);
  }

#ifdef SHADERS
  uniform float time;
  uniform sampler2D shadowMap;
  uniform mat4 shadowMatrix;
  uniform float shadowTexel;
  uniform vec3 lightDir;
  uniform vec3 lightColor;
  uniform vec3 ambientColor;
  uniform vec3 sunDir;
  uniform vec3 skyTop;
  uniform vec3 skyHorizon;

  const vec2 POISSON[12] = vec2[](
    vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
    vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
    vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
  );

  float shadowAt(vec3 wp, float ndl) {
    vec4 sc = shadowMatrix * vec4(wp, 1.0);
    vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
    if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
    float bias = 0.0004 + 0.0012 * (1.0 - ndl);
    float a = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
    mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
    float sum = 0.0;
    for (int i = 0; i < 12; i++) {
      vec2 o = rot * POISSON[i] * shadowTexel * 1.6;
      sum += step(p.z - bias, texture2D(shadowMap, p.xy + o).r);
    }
    float s = sum / 12.0;
    // Fade out towards the edge of the shadow map.
    float edge = max(abs(p.x - 0.5), abs(p.y - 0.5)) * 2.0;
    return mix(s, 1.0, smoothstep(0.8, 1.0, edge));
  }

  vec3 skyColor(vec3 d) {
    vec3 c = mix(skyHorizon, skyTop, smoothstep(0.0, 0.45, max(d.y, 0.0)));
    float s = max(dot(d, sunDir), 0.0);
    return c + lightColor * (pow(s, 8.0) * 0.25 + pow(s, 400.0) * 3.0);
  }
#endif

  void main() {
    vec4 tex = texture2D(map, vUv);
    if (tex.a < alphaTest) discard;
    float alpha = tex.a * opacity;
    vec3 col;
    vec3 fogC = fogColor;
#ifdef SHADERS
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    if (dot(N, V) < 0.0) N = -N;
    bool leaves = vFlag > 0.45 && vFlag < 0.55;
    bool plant = vFlag > 0.97;
    bool water = vFlag > 0.68 && vFlag < 0.8;
    float faceShade = abs(N.y) > 0.5 ? (N.y > 0.0 ? 1.0 : 0.5) : (abs(N.x) > 0.5 ? 0.6 : 0.8);
    float ao = clamp(vLight.z / faceShade, 0.0, 1.0);
    if (plant) ao = 1.0;

    float sky = vLight.x;
    float nl = dot(N, lightDir);
    float ndl = leaves || plant ? 0.3 + 0.35 * abs(nl) : max(nl, 0.0);
    float sunVis = smoothstep(0.45, 0.9, sky);
    float sh = ndl > 0.001 && sunVis > 0.0 ? shadowAt(vWorldPos + N * 0.06, max(nl, 0.0)) : 0.0;
    vec3 direct = lightColor * ndl * sh * sunVis;
    vec3 ambient = ambientColor * (sky * sky) * (0.75 + 0.25 * max(N.y, 0.0));
    // Torch light falls off quickly and is warm near the source.
    float bl = vLight.y;
    vec3 torch = vec3(1.0, 0.68, 0.38) * pow(bl, 4.0) * 1.25 + vec3(1.0, 0.8, 0.55) * pow(bl, 2.0) * 0.12;
    vec3 light = ambient * ao + direct * mix(ao, 1.0, 0.6) + torch * ao;
    light = max(light, vec3(0.018) * ao);
    col = tex.rgb * light;

    if (water) {
      vec3 Nw = N;
      if (N.y > 0.5) {
        vec2 p = vWorldPos.xz;
        float t = time;
        vec2 g = vec2(
          cos(p.x * 1.3 + t * 1.7) * 0.6 + cos((p.x + p.y) * 2.3 + t * 2.4) * 0.35 + cos(p.x * 4.1 - p.y * 3.3 + t * 3.1) * 0.15,
          cos(p.y * 1.1 - t * 1.5) * 0.6 + cos((p.x - p.y) * 1.9 + t * 1.9) * 0.35 + cos(p.y * 3.7 + p.x * 2.9 - t * 2.7) * 0.15
        ) * 0.07;
        Nw = normalize(vec3(-g.x, 1.0, -g.y));
      }
      float cosV = max(dot(Nw, V), 0.0);
      float fres = 0.03 + 0.97 * pow(1.0 - cosV, 5.0);
      vec3 R = reflect(-V, Nw);
      vec3 refl = skyColor(R) * (0.25 + 0.75 * sunVis);
      float spec = pow(max(dot(R, lightDir), 0.0), 220.0) * sh * sunVis * 6.0;
      vec3 base = tex.rgb * vec3(0.55, 0.8, 1.0) * (ambient + direct * 0.5 + torch) * 0.9;
      col = mix(base, refl, fres * (N.y > 0.5 ? 1.0 : 0.4)) + lightColor * spec;
      alpha = mix(0.62, 0.96, fres);
    }

    // Aerial perspective: fog lit by the sun when looking towards it.
    float toward = max(dot(-V, sunDir), 0.0);
    fogC = fogColor + lightColor * pow(toward, 6.0) * 0.35;
#else
    float skyL = curve(vLight.x * daylight);
    float blk = curve(vLight.y);
    vec3 light = max(vec3(skyL), vec3(blk) * vec3(1.0, 0.92, 0.78));
    light = max(light, vec3(0.035));
    col = tex.rgb * light * vLight.z;
#endif
    float f = smoothstep(fogNear, fogFar, vDepth);
    gl_FragColor = vec4(mix(col, fogC, f), alpha);
  }
`;

// Depth-only shader for the terrain shadow pass (alpha tested, with the same foliage motion).
export const SHADOW_VERT = /* glsl */ `
  attribute vec4 aLight;
  uniform float time;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float f = aLight.w;
    if (f > 0.45 && f < 0.55) {
      wp.x += sin(time * 1.7 + wp.x * 0.7 + wp.z * 0.3 + wp.y) * 0.035;
      wp.z += cos(time * 1.3 + wp.z * 0.8 + wp.y * 0.5) * 0.035;
    } else if (f > 0.97) {
      float s = sin(time * 2.0 + wp.x * 0.9 + wp.z * 0.6) * 0.09 + sin(time * 3.7 + wp.x * 1.7 + wp.z) * 0.03;
      wp.x += s;
      wp.z += s * 0.6;
    }
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const SHADOW_FRAG = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  void main() {
    if (texture2D(map, vUv).a < 0.5) discard;
    gl_FragColor = vec4(1.0);
  }
`;

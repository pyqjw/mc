// Directional (sun / moon) shadow map covering the area around the player.
import * as THREE from 'three';
import { SHADOW_VERT, SHADOW_FRAG } from './chunkShader.js';

export const LAYER_TERRAIN_SHADOW = 1;
export const LAYER_ENTITY_SHADOW = 2;

export class Shadows {
  constructor(size, radius, atlas, timeUniform) {
    this.size = size;
    this.radius = radius;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      depthTexture: new THREE.DepthTexture(size, size),
      depthBuffer: true,
    });
    this.target.depthTexture.minFilter = THREE.NearestFilter;
    this.target.depthTexture.magFilter = THREE.NearestFilter;
    this.camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 1, 700);
    this.camera.up.set(0, 0, 1);
    this.matrix = new THREE.Matrix4();
    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: { map: { value: atlas }, time: timeUniform },
      side: THREE.DoubleSide,
    });
    this.entityMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.lightRot = new THREE.Matrix4();
    this.tmp = new THREE.Vector3();
  }

  dispose() {
    this.target.depthTexture.dispose();
    this.target.dispose();
    this.terrainMat.dispose();
    this.entityMat.dispose();
  }

  get texel() {
    return 1 / this.size;
  }

  // Positions the light camera; the centre is snapped to shadow texels so edges do not shimmer.
  update(center, lightDir) {
    const cam = this.camera;
    this.lightRot.lookAt(new THREE.Vector3(0, 0, 0), lightDir.clone().negate(), cam.up);
    const inv = this.lightRot.clone().invert();
    const c = this.tmp.copy(center).applyMatrix4(inv);
    const step = (this.radius * 2) / this.size;
    c.x = Math.round(c.x / step) * step;
    c.y = Math.round(c.y / step) * step;
    c.applyMatrix4(this.lightRot);
    cam.position.copy(c).addScaledVector(lightDir, 350);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    this.matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }

  render(renderer, scene) {
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(this.target);
    renderer.autoClear = false;
    renderer.clear(true, true, false);
    this.camera.layers.set(LAYER_TERRAIN_SHADOW);
    scene.overrideMaterial = this.terrainMat;
    renderer.render(scene, this.camera);
    this.camera.layers.set(LAYER_ENTITY_SHADOW);
    scene.overrideMaterial = this.entityMat;
    renderer.render(scene, this.camera);
    scene.overrideMaterial = prevOverride;
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevTarget);
  }
}

// Marks every mesh of an object as a shadow caster.
export function castShadow(object, layer = LAYER_ENTITY_SHADOW) {
  object.traverse((o) => { if (o.isMesh) o.layers.enable(layer); });
}

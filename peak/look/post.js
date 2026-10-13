// The picture after the scene is drawn: the scene and its ink outlines go into a multisampled half-float buffer, a
// gentle bloom picks out the sun and the snow's sparkle, and one last pass grades the colour (cool shadows, warm
// highlights, a touch more saturation), rolls off the highlights, adds a soft vignette and writes sRGB to the screen.
// Quality adapts: when frames run slow the resolution steps down (and the bloom goes last), and back up when there's
// room again. Phones and tablets (light) start a step lower, and on the lowest steps redraw the sun's shadows only
// every other frame.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// The scene plus OutlineEffect's ink, straight into the composer's multisampled buffer.
class InkPass extends Pass {
  constructor(scene, camera, outline) {
    super();
    Object.assign(this, { scene, camera, outline });
    this.needsSwap = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(readBuffer);
    this.outline.render(this.scene, this.camera);
  }
}

// UnrealBloomPass without its last step: it leaves the glow in its own buffer, and the grade adds it.
class GlowPass extends UnrealBloomPass {
  render(renderer, writeBuffer, readBuffer) {
    renderer.getClearColor(this._oldClearColor);
    this._oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    const quad = this._fsQuad;
    this.highPassUniforms.tDiffuse.value = readBuffer.texture;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    this.highPassUniforms.smoothWidth.value = this.knee;
    quad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    quad.render(renderer);
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i];
      quad.material = blur;
      blur.uniforms.colorTexture.value = input.texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      quad.render(renderer);
      blur.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      quad.render(renderer);
      input = this.renderTargetsVertical[i];
    }
    quad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    quad.render(renderer);
    renderer.setClearColor(this._oldClearColor, this._oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }

  get texture() { return this.renderTargetsHorizontal[0].texture; }
}

// The last pass: glow, grade, highlight roll-off, sRGB, vignette, and a little dither against banding.
class GradePass extends Pass {
  constructor(glow) {
    super();
    this.glow = glow;
    this.needsSwap = false;
    this.uniforms = {
      tDiffuse: { value: null }, tGlow: { value: null }, uGlow: { value: 1 },
      uExposure: { value: 1.0 }, uSaturation: { value: 1.1 },
      uShadowTint: { value: new THREE.Vector3(0.93, 0.98, 1.1) },     // cool shadows
      uLightTint: { value: new THREE.Vector3(1.02, 1.0, 0.97) },       // warm highlights
      uVignette: { value: new THREE.Vector3(0.62, 0.68, 0.86) },      // the corners darken towards blue, not black
      uAspect: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, depthTest: false, depthWrite: false,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse, tGlow;
        uniform float uGlow, uExposure, uSaturation, uAspect;
        uniform vec3 uShadowTint, uLightTint, uVignette;
        varying vec2 vUv;
        float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
        // colours below 0.9 stay exactly as painted; above, they roll off to white instead of clipping
        vec3 rollOff(vec3 c) {
          float peak = max(max(c.r, c.g), c.b);
          if (peak <= 0.9) return c;
          float mapped = 0.9 + 0.1 * (1.0 - exp(-(peak - 0.9) / 0.1));
          return mix(c * (mapped / peak), vec3(mapped), smoothstep(1.0, 4.0, peak) * 0.8);
        }
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          c += texture2D(tGlow, vUv).rgb * uGlow;
          c *= uExposure;
          float l = luma(c);
          c *= mix(vec3(1.0), uShadowTint, 1.0 - smoothstep(0.02, 0.3, l));
          c *= mix(vec3(1.0), uLightTint, smoothstep(0.25, 0.9, l));
          c = max(mix(vec3(luma(c)), c, uSaturation), 0.0);
          c = rollOff(c);
          vec4 outColor = sRGBTransferOETF(vec4(c, 1.0));
          vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
          float v = smoothstep(0.42, 1.05, length(q) / length(vec2(uAspect, 1.0) * 0.5));
          outColor.rgb *= mix(vec3(1.0), uVignette, v * 0.55);
          float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          outColor.rgb += (n - 0.5) / 255.0;
          gl_FragColor = outColor;
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(width, height) { this.uniforms.uAspect.value = width / Math.max(1, height); }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tGlow.value = this.glow.texture;
    this.uniforms.uGlow.value = this.glow.enabled ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

// Pixel ratios to step through, from sharp to soft (never above the screen's own); the bloom stops below 1.
const RATIOS = [1.5, 1.25, 1, 0.85, 0.7];
// A coarse pointer means a phone or tablet, with a mobile GPU: it starts at ratio 1, redraws the sun's shadows every
// other frame from 0.85 down, and its sun gets a smaller shadow map (main.js).
export const LIGHT = { start: 1, slowShadows: 0.85, shadowMap: 1024 };

export function createPost(renderer, scene, camera, outline,
  { adaptive = true, light = matchMedia('(pointer: coarse)').matches } = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  // nothing reads the scene's depth after it's drawn, so the multisampled depth isn't copied out (perf: ~2 ms a frame
  // on an integrated GPU at retina size, docs/performance.md)
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4,
    resolveDepthBuffer: false });
  const composer = new EffectComposer(renderer, target);
  const glow = new GlowPass(new THREE.Vector2(size.x, size.y), 0.32, 0.55, 1.15);
  glow.knee = 0.5;
  const grade = new GradePass(glow);
  composer.addPass(new InkPass(scene, camera, outline));
  composer.addPass(glow);
  composer.addPass(grade);

  const steps = [...new Set(RATIOS.map(r => Math.min(r, devicePixelRatio)))];
  let level = light ? Math.max(0, steps.findIndex(r => r <= LIGHT.start)) : 0, ratio = steps[level], frame = 0;
  const apply = () => {
    ratio = steps[level];
    renderer.setPixelRatio(ratio);
    composer.setPixelRatio(ratio);
    glow.enabled = ratio >= Math.min(devicePixelRatio, 1);
  };
  apply();

  // frame-time watch: slow for a while → a step down; quick for longer → a step back up
  const watch = { slow: 0, quick: 0, smooth: 1 / 60, ups: 0 };   // only two tries back up, so it can't seesaw
  return {
    composer, glow, grade, light,
    get ratio() { return ratio; },
    shadowSize: size => light ? Math.min(size, LIGHT.shadowMap) : size,     // for the sun (main.js)
    render() {
      // a phone on its lowest steps: the sun's shadows every other frame
      const half = light && ratio <= LIGHT.slowShadows;
      renderer.shadowMap.autoUpdate = !half;
      if (half) renderer.shadowMap.needsUpdate = (frame++ & 1) === 0;
      composer.render();
    },
    setSize(width, height) {
      renderer.setSize(width, height);
      composer.setSize(width, height);
    },
    // dt: the real time since the last frame
    adapt(dt) {
      if (!adaptive || dt <= 0 || dt > 0.25) return;
      watch.smooth += (dt - watch.smooth) * 0.08;
      watch.slow = watch.smooth > 1 / 48 ? watch.slow + dt : 0;
      watch.quick = watch.smooth < 1 / 57 ? watch.quick + dt : 0;
      if (watch.slow > 1.5 && level < steps.length - 1) { level++; apply(); watch.slow = 0; watch.smooth = 1 / 60; }
      if (watch.quick > 6 && level > 0 && watch.ups < 2) { level--; apply(); watch.quick = 0; watch.ups++; }
    },
  };
}

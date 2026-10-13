// Wood and rope for the props and beams: toon materials (look.js) with grain or a twist, no image files.
import * as THREE from 'three';
import { RAMPS, outlineColor } from './look.js';
import { NOISE } from './materials.js';

// ------------------------------------------------------------------ wood

const woods = new Map();

// Wood with grain running along the object's own axis ('x', 'y' or 'z'), and a knot now and then.
export function wood(color = '#b07a4a', axis = 'z') {
  const key = `${new THREE.Color(color).getHex()}-${axis}`;
  if (woods.has(key)) return woods.get(key);
  const material = new THREE.MeshToonMaterial({ color, gradientMap: RAMPS.world });
  material.userData.outlineParameters = { ...outlineColor('default'), alpha: 1 };
  const across = { x: 'yz', y: 'xz', z: 'xy' }[axis];
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = position;
        #ifdef USE_INSTANCING
          vLocal += instanceMatrix[3].xyz * 3.7;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocal;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 p = vLocal;
          float along = p.${axis};
          vec2 cross2 = p.${across};
          float wobble = fbm3(vec3(cross2 * 3.0, along * 0.35)) * 2.0;
          float grain = 0.5 + 0.5 * sin((cross2.x * 1.3 + cross2.y * 0.7) * 70.0 + wobble * 6.0);
          float knot = smoothstep(0.82, 0.9, noise3(vec3(cross2 * 6.0, along * 2.2)));
          float tone = 0.88 + 0.16 * grain - 0.25 * knot + 0.08 * (noise3(vec3(along * 1.5, cross2 * 4.0)) - 0.5);
          diffuseColor.rgb *= tone;
        }`);
  };
  material.customProgramCacheKey = () => `peak-wood-${axis}`;
  woods.set(key, material);
  return material;
}

// ------------------------------------------------------------------ rope

let ropeTexture = null;

// A twisted rope: diagonal strands. length (m) sets how often the twist repeats along a mesh whose uv.x runs 0..1.
export function rope(length, color = '#d9c08a') {
  if (!ropeTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#b9ab92';
    ctx.lineWidth = 11;
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(k * 32 - 8, 72);
      ctx.lineTo(k * 32 + 72, -8);
      ctx.stroke();
    }
    ropeTexture = new THREE.CanvasTexture(canvas);
    ropeTexture.wrapS = ropeTexture.wrapT = THREE.RepeatWrapping;
    ropeTexture.colorSpace = THREE.SRGBColorSpace;
  }
  const map = ropeTexture.clone();
  map.repeat.set(Math.max(1, Math.round(length / 0.07)), 1);
  map.needsUpdate = true;
  const material = new THREE.MeshToonMaterial({ color, map, gradientMap: RAMPS.world });
  material.userData.outlineParameters = { color: [0.16, 0.2, 0.3], thickness: 0.004, alpha: 1 };
  return material;
}

// The toon look shared by Mnot and the mountain: stepped light ramps and ink outlines.
import * as THREE from 'three';

function toonRamp(...tones) {
  const ramp = new THREE.DataTexture(new Uint8Array(tones.flatMap(t => [t, t, t, 255])), tones.length, 1);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

// Mnot keeps the viewer's two tones (three on the metal); the mountain gets three, so the facets read. The far
// range turns its shady side further from the sun, so the faces read from far away.
export const RAMPS = { mnot: toonRamp(120, 255), metal: toonRamp(95, 170, 255), world: toonRamp(118, 196, 255),
  far: toonRamp(52, 160, 255) };

const OUTLINES = {
  mnot: { color: [0.09, 0.3, 0.38], thickness: 0.0045 },
  default: { color: [0.16, 0.2, 0.3], thickness: 0.004 },
  rock: { color: [0.22, 0.24, 0.36], thickness: 0.0032 },
};

const cache = new Map();

// A shared toon material. outline: a name from OUTLINES, or false for none.
export function toon(color, { vertexColors = false, outline = 'default', ramp = RAMPS.world, ...rest } = {}) {
  const key = JSON.stringify([new THREE.Color(color).getHex(), vertexColors, outline, ramp.uuid, rest]);
  if (!cache.has(key)) {
    const material = new THREE.MeshToonMaterial({ color, gradientMap: ramp, vertexColors, ...rest });
    material.userData.outlineParameters = outline ? { ...OUTLINES[outline], alpha: 1 } : { visible: false };
    cache.set(key, material);
  }
  return cache.get(key);
}

export function noOutline(material) {
  material.userData.outlineParameters = { visible: false };
  return material;
}

export function outlineColor(name) {
  return OUTLINES[name];
}

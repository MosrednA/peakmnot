// Every shader built behind the preloader (peak/ui/preload.css), not in play, where each one is a hitch of tens of
// milliseconds: one frame drawn with nothing culled, so the whole level is drawn once, with its shadows and ink.
// Nothing hidden either: a thing far ahead that the game hides, or one not shown yet, would build a shader of its own,
// or a shadow's, the first time it shows. Lights stay as they are: one more light would build every shader again.
// The painted things that cast a shadow (signs, banners) get a depth material of their own: three.js draws every
// other shadow with one, and builds its shader again only when the kind of mesh changes (Mnot's skinned can, the
// instanced ones), from the first mesh after the change; a painted one there builds a shader more, in play.
// docs/performance.md, "The downhill", has the measurements.
import * as THREE from 'three';

const PAINTED_SHADOW = new THREE.MeshDepthMaterial();

export function warmUp(scene, render) {
  const culled = [], hidden = [];
  scene.traverse(o => {
    if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
    if (!o.visible && !o.isLight) { hidden.push(o); o.visible = true; }
    if (o.castShadow && o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !o.customDepthMaterial
      && [].concat(o.material).some(m => m.map && !(m.alphaTest > 0))) o.customDepthMaterial = PAINTED_SHADOW;
  });
  render();
  for (const o of culled) o.frustumCulled = true;
  for (const o of hidden) o.visible = false;
}

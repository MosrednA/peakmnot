// Props stand on rock. A prop lists its feet (points in its own frame, and how far in from a rock's lip they must
// be), and once the route is dressed and the prop turned to its camera (decor.js), every foot must sit on a rock top
// within a few centimetres of its own height: not over the abyss, not buried in a higher rock, and not on a board
// walk, a ledge that crumbles or a gondola. A prop that doesn't fit is nudged in toward the middle of its ledge, then
// made a little smaller; in ?manual mode (the tests) the console says so, so a misplaced prop shows up.
import * as THREE from 'three';

const RISE = 0.05;                  // how far a foot may stand from its rock's top
const SHRINK = [1, 0.85, 0.7];
const STEP = 0.04;                  // metres per nudge
const MANUAL = typeof location !== 'undefined' && new URLSearchParams(location.search).has('manual');
const _p = new THREE.Vector3();

// Give a prop its feet: [x, z] or [x, y, z] in its own frame, each at least inset in from a rock's lip.
export function feet(object, points, label, inset = 0.06) {
  object.userData.feet = { label, inset,
    points: points.map(p => (p.length === 2 ? new THREE.Vector3(p[0], 0, p[1]) : new THREE.Vector3(...p))) };
  return object;
}

// Whether a rock can carry a prop: solid and staying put.
const firm = s => !s.off && !s.loose && !s.moving && s.kind !== 'board';

// Whether a foot at (x, y, z) stands on a rock's top, inset in from its lip, with no higher rock round it.
function onTop(world, x, y, z, inset) {
  let ok = false;
  for (const s of world.solids) {
    if (s.off || !s.near(x, z, 0.1)) continue;
    const d = s.closest(x, z).d;
    if (s.top > y + RISE && s.bottom < y + 1 && d < 0.03) return false;      // inside a wall
    if (firm(s) && Math.abs(s.top - y) <= RISE && d <= -inset) ok = true;
  }
  return ok;
}

// Every foot of a prop, in the world, where it stands now.
function footholds(object) {
  object.updateMatrix();
  return object.userData.feet.points.map(p => p.clone().applyMatrix4(object.matrix));
}

export function standing(world, object) {
  const { inset } = object.userData.feet;
  return footholds(object).every(p => onTop(world, p.x, p.y, p.z, inset));
}

// The ledge a point belongs to: the firm rock at its height that it is in, or nearest to.
function ledgeOf(world, p) {
  let best = null, bestD = Infinity;
  for (const s of world.solids) {
    if (!firm(s) || Math.abs(s.top - p.y) > RISE) continue;
    const d = s.closest(p.x, p.z).d;
    if (d < bestD) { best = s; bestD = d; }
  }
  return bestD < 1.5 ? best : null;
}

// Fit a prop onto its rock: as it is, else nudged toward the middle of its ledge, else a little smaller. place turns
// it to its camera again after each move. Returns whether it fits.
export function settle(world, object, place = () => {}) {
  place(object);
  if (standing(world, object)) return true;
  const start = object.position.clone(), scale = object.scale.clone();
  const holds = footholds(object), anchor = holds.reduce((a, p) => a.add(p), new THREE.Vector3())
    .divideScalar(holds.length);
  const home = ledgeOf(world, anchor);
  const shift = home ? new THREE.Vector3(home.center.x - anchor.x, 0, home.center.y - anchor.z) : new THREE.Vector3();
  const span = shift.length();
  for (const k of SHRINK) {
    object.scale.copy(scale).multiplyScalar(k);
    for (let d = 0; d <= span + 1e-6; d += STEP) {
      object.position.copy(start).addScaledVector(shift, span ? d / span : 0);
      place(object);
      if (standing(world, object)) {
        warn(object, start, `moved ${d.toFixed(2)} m to ${where(object.position)}${k < 1 ? `, scaled to ${k}` : ''}`);
        return true;
      }
      if (!span) break;
    }
  }
  object.position.copy(start);
  object.scale.copy(scale);
  place(object);
  warn(object, start, 'and nothing on its ledge fits');
  return false;
}

// A single foot (a windsock's pole, say) fitted onto its rock: the point to build it at.
export function onRock(world, foot, label, inset = 0.08) {
  const probe = feet(new THREE.Object3D(), [[0, 0]], label, inset);
  probe.position.copy(foot);
  settle(world, probe);
  return probe.position.clone();
}

const where = p => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;

function warn(object, start, what) {
  if (MANUAL) console.warn(`Prop off its rock: "${object.userData.feet.label}" at ${where(start)}, ${what}`);
}

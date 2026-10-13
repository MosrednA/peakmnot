// Icy patches: a slab of blue ice glazed over the top of a rock, made to read as ice at a glance: deep blue under a
// glossy surface, streaks of light that slide over it as the camera moves (a reflection), a frosty rim, cracks down
// in it and old skid marks on top. Each patch tilts a little towards its low side (drift, in m/s²): the slab is
// thicker on the high side, the skid marks run downhill, and it pulls whoever stands on it that way. A patch is a
// rounded box (icePatch) or an arc of a ring (iceArc, for ring.js). How Mnot slides on it is skate.js;
// world.iceAt(x, z, y) finds the patch under a point. Each patch is one or more entries in world.ice:
// { outline (a convex Solid), y, drift, lift(x, z), reach (how far past the outline its edge is still slippery) }.
import * as THREE from 'three';
import { Solid, random } from './world.js';
import { toon, noOutline } from '../look/look.js';

const THICK = { low: 0.035, high: 0.085 };   // the slab's thickness on its low and high side
const TILE = 1.6;                            // metres over which the cracks and skid marks repeat
let marks = null;

// An icy patch from its extents, like route.js's rock(): x0..x1 by z0..z1 on a rock whose top is at y. Keep it a
// little inside the rock's lip. drift: [x, z], the pull towards the low side.
export function icePatch(world, x0, x1, z0, z1, y, { round = 0.22, drift = [0, 0] } = {}) {
  const r = Math.min(round, (x1 - x0) / 2.5, (z1 - z0) / 2.5), points = [];
  const corners = [[x1 - r, z1 - r, 0], [x0 + r, z1 - r, 1], [x0 + r, z0 + r, 2], [x1 - r, z0 + r, 3]];
  for (const [cx, cz, k] of corners) {
    for (let i = 0; i <= 3; i++) {
      const a = (k + i / 3) * Math.PI / 2;
      points.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) });
    }
  }
  // the slab's top: thin on the low side, thick on the high side (flat when it doesn't tilt)
  const pull = Math.hypot(drift[0], drift[1]);
  const down = pull ? new THREE.Vector2(drift[0] / pull, drift[1] / pull) : new THREE.Vector2(0, 1);
  const along = points.map(p => p.x * down.x + p.z * down.y), lo = Math.min(...along), hi = Math.max(...along);
  const lift = (x, z) => pull
    ? THREE.MathUtils.lerp(THICK.high, THICK.low, ((x * down.x + z * down.y) - lo) / (hi - lo))
    : (THICK.low + THICK.high) / 2;
  const outline = new Solid(points, y, y, 'ice');
  world.ice.push({ outline, y, drift: new THREE.Vector3(drift[0], 0, drift[1]), lift, reach: 0 });
  const center = new THREE.Vector2((x0 + x1) / 2, (z0 + z1) / 2);
  const half = new THREE.Vector2((x1 - x0) / 2, (z1 - z0) / 2);
  slab(world, points, y, lift, 'box', { uCenter: center, uHalf: half, uRound: r, uDown: down });
  return outline;
}

// Ice on an arc of a ring (ring.js): between radius inner and outer round center ([x, z]), from angle `from` to `to`
// (degrees, 0 = +X, 90 = +Z), on a rock top at y. It runs right up to both lips and stays slippery reach metres past
// them, so a slide goes over the edge rather than stopping on it. drift: the pull into the ring's hole (m/s², < 0
// pulls outwards). The collision is a convex outline per `step` degrees; the look is one smooth slab.
export function iceArc(world, { center, inner, outer, from, to, y, drift = 0, reach = 0.12, step = 15 }) {
  const [cx, cz] = center, rad = THREE.MathUtils.degToRad;
  const at = (r, a) => ({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) });
  const lift = (x, z) => {
    const t = THREE.MathUtils.clamp((Math.hypot(x - cx, z - cz) - inner) / (outer - inner), 0, 1);
    return drift ? THREE.MathUtils.lerp(THICK.low, THICK.high, drift > 0 ? t : 1 - t) : (THICK.low + THICK.high) / 2;
  };
  const n = Math.ceil((to - from) / step - 1e-6), outlines = [];
  for (let k = 0; k < n; k++) {
    const a0 = rad(from + (to - from) * k / n), a1 = rad(from + (to - from) * (k + 1) / n), mid = (a0 + a1) / 2;
    const outline = new Solid([at(outer, a0), at(outer, mid), at(outer, a1), at(inner, a1), at(inner, a0)], y, y,
      'ice');
    const pull = new THREE.Vector3(-Math.cos(mid), 0, -Math.sin(mid)).multiplyScalar(drift);
    world.ice.push({ outline, y, drift: pull, lift, reach });
    outlines.push(outline);
  }
  // the look: a little in from the lips, so the slab's sides don't fight with the rock's
  const inset = 0.03, i0 = inner + inset, i1 = outer - inset, gap = inset / ((inner + outer) / 2);
  const a0 = rad(from) + gap, a1 = rad(to) - gap, m = Math.ceil((a1 - a0) / rad(3)), points = [];
  for (let i = 0; i <= m; i++) points.push(at(i1, a0 + (a1 - a0) * i / m));
  for (let i = m; i >= 0; i--) points.push(at(i0, a0 + (a1 - a0) * i / m));
  slab(world, points, y, lift, 'arc', { uCenter: new THREE.Vector2(cx, cz), uRadii: new THREE.Vector2(i0, i1),
    uArc: new THREE.Vector2((a0 + a1) / 2, (a1 - a0) / 2), uDrift: drift });
  return outlines;
}

// The slab and its glaze over an outline (points in XZ, in order), its top lift(x, z) above y.
function slab(world, points, y, lift, kind, uniforms) {
  const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, -p.z)));
  const block = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).rotateX(-Math.PI / 2);
  const at = block.attributes.position;
  for (let i = 0; i < at.count; i++) at.setY(i, at.getY(i) > 0.5 ? lift(at.getX(i), at.getZ(i)) : -0.02);
  block.computeVertexNormals();
  const sheet = new THREE.Mesh(block, toon('#8cc9ea'));
  sheet.position.y = y;
  sheet.receiveShadow = true;
  const top = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  for (let i = 0; i < top.attributes.position.count; i++) {
    top.attributes.position.setY(i, lift(top.attributes.position.getX(i), top.attributes.position.getZ(i)) + 0.003);
  }
  const glaze = new THREE.Mesh(top, glazeMaterial(kind, uniforms));
  glaze.position.y = y;
  glaze.renderOrder = 1;
  world.group.add(sheet, glaze);
}

// Each kind of outline in the glaze: how far a point is in from the edge, how far it is towards the low side (0..1),
// and where it is on the marks (their v runs along the skid marks).
const SHAPES = {
  box: /* glsl */ `
    uniform vec2 uCenter, uHalf, uDown;
    uniform float uRound;
    float box(vec2 p, vec2 b, float r) {
      vec2 q = abs(p) - b + r;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }
    void shape(vec2 p, out float inside, out float low, out vec2 uv) {
      inside = -box(p - uCenter, uHalf, uRound);
      low = clamp(0.5 + 0.5 * dot(p - uCenter, uDown) / max(uHalf.x, uHalf.y), 0.0, 1.0);
      uv = vec2(dot(p, vec2(-uDown.y, uDown.x)), dot(p, uDown));      // skid marks downhill
    }`,
  // uRadii: the inner and outer radius round uCenter; uArc: the arc's middle angle and half its span
  arc: /* glsl */ `
    uniform vec2 uCenter, uRadii, uArc;
    uniform float uDrift;
    void shape(vec2 p, out float inside, out float low, out vec2 uv) {
      vec2 q = p - uCenter;
      float d = length(q), a = mod(atan(q.y, q.x) - uArc.x + 3.14159265, 6.2831853) - 3.14159265;
      inside = min(min(d - uRadii.x, uRadii.y - d), (uArc.y - abs(a)) * d);
      float t = clamp((d - uRadii.x) / (uRadii.y - uRadii.x), 0.0, 1.0);
      low = uDrift > 0.0 ? 1.0 - t : uDrift < 0.0 ? t : 0.5;
      uv = vec2(d, a * d);                                              // skid marks round the ring
    }`,
};

// The surface: drawn over the slab, see-through where the slab's own toon blue shows.
function glazeMaterial(kind, values) {
  const uniforms = { uMarks: { value: marks ??= paintMarks() } };
  for (const [name, value] of Object.entries(values)) uniforms[name] = { value };
  return noOutline(new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMarks;
      varying vec3 vWorld;
      ${SHAPES[kind]}

      void main() {
        vec2 p = vWorld.xz, uv;
        float inside, low;
        shape(p, inside, low, uv);                                // inside: metres in from the edge
        if (inside < 0.0) discard;
        vec3 view = normalize(vWorld - cameraPosition);
        // cracks (red) and skid marks and frost (green, blue)
        vec4 marks = texture2D(uMarks, uv / ${TILE.toFixed(2)});
        // deep blue under the surface, deepest towards the low side, the sky in it where you look across it
        float graze = pow(1.0 - abs(view.y), 3.0);
        vec3 color = mix(vec3(0.02, 0.15, 0.4), vec3(0.6, 0.83, 1.0), 0.75 * graze);
        float alpha = (0.3 + 0.3 * low) * smoothstep(0.03, 0.25, inside);
        color = mix(color, vec3(0.0, 0.07, 0.24), marks.r);
        alpha = max(alpha, 0.8 * marks.r * smoothstep(0.03, 0.12, inside));
        // streaks of light sliding over it as the camera moves, a wide one and a thin one
        float u = dot(p - 0.45 * cameraPosition.xz, vec2(0.8, -0.6)) * 1.3, aa = 1.5 * fwidth(u);
        float wide = 1.0 - smoothstep(0.06, 0.06 + aa, abs(fract(u) - 0.5));
        float thin = 1.0 - smoothstep(0.018, 0.018 + aa, abs(fract(u + 0.27) - 0.5));
        float streak = max(wide, 0.8 * thin) * smoothstep(0.05, 0.15, inside) * (0.6 + 0.4 * graze);
        // a frosty rim along the edge
        float rim = 1.0 - smoothstep(0.015, 0.045, inside);
        float white = max(max(streak, 0.75 * max(marks.g, 0.6 * marks.b)), 0.9 * rim);
        gl_FragColor = vec4(mix(color, vec3(0.94, 0.99, 1.0), white), max(alpha, white));
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  }));
}

// One tile of marks, shared by every patch: cracks in red, skid marks running along v in green, frost in blue. Each
// stroke is drawn at its neighbouring tiles' offsets too, so the tile repeats without seams.
function paintMarks() {
  const size = 512, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d'), rand = random(41);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = ctx.lineJoin = 'round';
  const tiled = draw => { for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) draw(dx, dy); };
  const stroke = (path, color, width) => tiled((dx, dy) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    path.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
    ctx.stroke();
  });
  // cracks: a few jagged lines with a branch or two
  const crack = (x, y, a, steps, width) => {
    const path = [[x, y]];
    for (let i = 0; i < steps; i++) {
      a += (rand() - 0.5) * 1.1;
      x += Math.cos(a) * (14 + 22 * rand());
      y += Math.sin(a) * (14 + 22 * rand());
      path.push([x, y]);
      if (rand() < 0.18 && width > 1.6) crack(x, y, a + (rand() < 0.5 ? 1 : -1) * (0.6 + 0.5 * rand()), 4, width * 0.6);
    }
    stroke(path, 'rgb(255,0,0)', width);
  };
  for (let i = 0; i < 4; i++) crack(size * rand(), size * rand(), Math.PI * 2 * rand(), 8 + 6 * rand(), 3);
  // skid marks: long, gently curving, mostly downhill
  for (let i = 0; i < 16; i++) {
    const x = size * rand(), y = size * rand(), length = 70 + 170 * rand(), a = Math.PI / 2 + (rand() - 0.5) * 0.6;
    const bend = (rand() - 0.5) * 40, path = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      path.push([x + Math.cos(a) * length * t + bend * Math.sin(Math.PI * t), y + Math.sin(a) * length * t]);
    }
    stroke(path, `rgb(0,${Math.round(110 + 145 * rand())},0)`, 2 + 2 * rand());
  }
  // frost: specks
  ctx.fillStyle = 'rgb(0,0,255)';
  for (let i = 0; i < 260; i++) {
    const x = size * rand(), y = size * rand(), s = 1 + 2 * rand();
    tiled((dx, dy) => ctx.fillRect(x + dx, y + dy, s, s));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

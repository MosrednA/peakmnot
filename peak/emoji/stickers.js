// The emojis on the field: thick die-cut tokens, each its sticker's outline (sheet.js, traced by tools/emoji_atlas.py)
// extruded, with the sticker from the sheet (emojis.webp) on both faces and a white rim, inked like the rest of the
// world. They hover over the snow and spin; one coming close slows down and turns to face Mnot, the next one on the
// list hops for joy and the others lean back out of reach. The same sheet draws the list in the HUD (cssSticker).
import * as THREE from 'three';
import { toon } from '../look/look.js';
import { SHEET, OUTLINES } from './sheet.js';

export const SHEET_URL = new URL('./emojis.webp', import.meta.url);
const SIZE = 1.3;                  // m across a sticker's cell
const THICK = 0.16;                // m through a token, without its bevel
const BEVEL = 0.035;               // m
const HEIGHT = 1.05;               // m to a token's middle
const SPIN = 1.1;                  // radians a second
const TOUCH = 0.85;                // m from Mnot's middle: touched
const NEAR = [3.6, 1.8];           // m: from here a token starts turning to face Mnot, and at this it does
const FACE = 5;                    // how fast it turns to face (a second), close by
const WARP = { out: 0.4, back: 1.1 };   // s: a touched wrong one twisting away, and a blinked one coming back
const TILT = 1.2;                  // radians a token leans back while the camera peeks from high up, to be read
const TAU = Math.PI * 2;
const ease = (from, to, k) => THREE.MathUtils.smoothstep(k, from, to);
const turn = a => Math.atan2(Math.sin(a), Math.cos(a));

const cellOf = name => {
  const i = SHEET.names.indexOf(name);
  if (i < 0) throw new Error(`no sticker "${name}" in sheet.js`);
  return { i, c: i % SHEET.columns, r: Math.floor(i / SHEET.columns) };
};

// The sticker as a CSS background, for the HUD: the sheet, sized and shifted to its cell.
export function cssSticker(el, name) {
  const { c, r } = cellOf(name);
  el.style.backgroundImage = `url(${SHEET_URL})`;
  el.style.backgroundSize = `${SHEET.columns * 100}% ${SHEET.rows * 100}%`;
  el.style.backgroundPosition = `${c / (SHEET.columns - 1) * 100}% ${r / (SHEET.rows - 1) * 100}%`;
  el.title = `:${name}:`;
}

export async function loadSheet(renderer) {
  const texture = await new THREE.TextureLoader().loadAsync(SHEET_URL.href);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

// A token's shape: its outline extruded and bevelled, centred on its middle, the faces mapped to its cell of the
// sheet (the back one shows the sticker mirrored, as a real token would from behind).
function tokenGeometry(name) {
  const { i, c, r } = cellOf(name);
  const px = SHEET.cell;
  const shapes = OUTLINES[i].map(loop => {
    const points = [];
    for (let k = 0; k < loop.length; k += 2) points.push(new THREE.Vector2((loop[k] / px - 0.5) * SIZE, (0.5 - loop[k + 1] / px) * SIZE));
    return new THREE.Shape(points);
  });
  const uv = (x, y) => new THREE.Vector2((c + x / SIZE + 0.5) / SHEET.columns, 1 - (r + 0.5 - y / SIZE) / SHEET.rows);
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: THICK, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL * 0.6, bevelSegments: 2, curveSegments: 1,
    UVGenerator: {
      generateTopUV: (g, v, a, b, d) => [a, b, d].map(n => uv(v[n * 3], v[n * 3 + 1])),
      generateSideWallUV: () => [0, 1, 2, 3].map(() => new THREE.Vector2()),
    },
  });
  geometry.translate(0, 0, -THICK / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export class Stickers {
  constructor(texture) {
    this.group = new THREE.Group();
    this.group.name = 'the emojis';
    // the faces unlit, so an emoji reads true from any side; the rim toon-shaded, so the token reads as a thing
    const face = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.35 });
    face.userData.outlineParameters = { color: [0.16, 0.2, 0.3], thickness: 0.004, alpha: 1 };
    this.materials = [face, toon('#ffffff')];
    this.geometries = new Map();
    this.list = [];
    this.time = 0;
  }

  // the field's emojis, all of them standing again
  set(emojis) {
    this.clear();
    for (const [i, e] of emojis.entries()) {
      if (!this.geometries.has(e.name)) this.geometries.set(e.name, tokenGeometry(e.name));
      const token = new THREE.Mesh(this.geometries.get(e.name), this.materials);
      token.name = `:${e.name}:`;
      token.rotation.order = 'YXZ';               // turned first, then leant back
      token.castShadow = true;
      const holder = new THREE.Group();
      holder.position.copy(e.at).setY(HEIGHT);
      holder.add(token);
      this.group.add(holder);
      const phase = i * 2.399;
      this.list.push({ emoji: e, holder, token, phase, yaw: phase, going: 0, how: null });
    }
  }

  clear() {
    for (const s of this.list) s.holder.removeFromParent();
    this.list = [];
  }

  // The emoji Mnot touches at `pos`, if any (still standing).
  touched(pos) {
    for (const s of this.list) {
      if (s.emoji.taken || s.how) continue;
      if (Math.hypot(pos.x - s.emoji.at.x, pos.z - s.emoji.at.z) < TOUCH) return s;
    }
    return null;
  }

  // A token going: 'taken' (it hops up, whirls and shrinks away), 'warped' (a wrong one touched: it twists thin and
  // is gone), 'blinked' (a listed one touched too early: it twists away and pops back a moment later) or 'wrong'
  // (the touch that ends the run: it swells and shakes, and stays).
  go(s, how) {
    s.how = how;
    s.going = 0;
  }

  // player: where Mnot is; next: the list's next emoji (it hops when Mnot is near); peek: how far the camera has
  // risen to look over the field (0..1), when every token turns to it and leans back, so each one reads from above
  update(dt, camera, player, next, peek = 0) {
    this.time += dt;
    for (const s of this.list) {
      const { holder, token, emoji } = s;
      if (emoji.taken) continue;
      const near = ease(NEAR[0], NEAR[1], Math.hypot(player.x - emoji.at.x, player.z - emoji.at.z));
      const close = Math.max(near, peek);
      // spinning, slowing down and turning to face the camera as Mnot comes close: eased all the way, the short way
      // round, so it never snaps
      const face = Math.atan2(camera.position.x - holder.position.x, camera.position.z - holder.position.z);
      s.yaw += SPIN * dt * (1 - close);
      s.yaw += turn(face - s.yaw) * (1 - Math.exp(-FACE * close * dt));
      token.rotation.y = s.yaw;
      token.position.y = 0.08 * Math.sin(this.time * 2.1 + s.phase);
      token.rotation.z = 0.06 * Math.sin(this.time * 1.4 + s.phase * 2);
      token.rotation.x = -TILT * peek;
      if (!s.how) {
        if (emoji === next) token.position.y += 0.22 * near * Math.abs(Math.sin(this.time * 7));    // pick me
        else token.rotation.x -= 0.32 * near * (1 - peek);                    // not me: leaning back, out of reach
        continue;
      }
      s.going += dt;
      const k = s.going;
      if (s.how === 'taken') {
        const t = Math.min(1, k / 0.5);
        token.position.y += 1.8 * t - 0.5 * t * t;
        token.rotation.y += TAU * 2 * t * t;
        token.scale.setScalar(Math.max(0.001, (1 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 2))) * (1 - t * t)));
        if (t >= 1) { holder.visible = false; emoji.taken = true; s.how = null; }
      } else if (s.how === 'warped' || s.how === 'blinked') {
        // twisting thin and tall, faster and faster, up a little and gone; a blinked one pops back where it was
        const out = Math.min(1, k / WARP.out), back = s.how === 'blinked' ? ease(WARP.back, WARP.back + 0.3, k) : 0;
        const thin = (1 - out * out) * (1 - back) + back * (1 + 0.25 * Math.sin(Math.PI * back));
        const tall = (1 + 0.8 * out) * (1 - back) + back;
        token.scale.set(Math.max(0.001, thin), Math.max(0.001, tall), Math.max(0.001, thin));
        token.position.y += 0.5 * out * (1 - back);
        s.yaw += 30 * out * out * dt * (1 - back);
        token.rotation.y = s.yaw;
        if (s.how === 'warped' && out >= 1) { holder.visible = false; emoji.taken = true; s.how = null; }
        if (back >= 1) { token.scale.setScalar(1); s.how = null; }
      } else {
        token.scale.setScalar(1 + 0.5 * Math.min(1, k / 0.18));
        s.yaw += turn(face - s.yaw) * (1 - Math.exp(-12 * dt));
        token.rotation.y = s.yaw;
        token.rotation.z = 0.3 * Math.sin(k * 38) * Math.exp(-k * 2.2);
      }
    }
  }
}

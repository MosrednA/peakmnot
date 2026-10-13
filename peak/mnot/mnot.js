// Mnot in the game: loads models/mnot.glb, gives it the toon look, and blends its clips. The rig stores its own
// speeds and jump timing (see README.md), so the game reads those instead of guessing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RAMPS } from '../look/look.js';

const ONE_SHOTS = new Set(['JumpStart', 'LeapStart', 'Land', 'LeapLand', 'LandHard', 'PushGlasses', 'LookUp', 'TapFoot']);
const GAITS = new Set(['Walk', 'Run']);

export const RIG_DEFAULTS = { walk_speed: 0.625, run_speed: 2.08, jump_takeoff: 0.12, leap_takeoff: 0.12,
  jump_gravity: 15, jump_height: 0.6, run_jump_height: 0.8, hard_landing_speed: 6 };

export async function loadMnot(url = 'models/mnot.glb') {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  let body = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    const std = o.material;
    const params = { name: std.name, color: std.color, transparent: std.transparent, opacity: std.opacity,
      depthWrite: std.depthWrite };
    // the lenses stay flat and unlit, like the drawing
    const cel = std.name === 'Lens' ? new THREE.MeshBasicMaterial(params)
      : new THREE.MeshToonMaterial({ ...params, gradientMap: RAMPS.mnot });
    if (std.name === 'Aluminium' || std.name === 'Tab') {
      cel.color = std.color.clone().multiplyScalar(1.1);
      cel.gradientMap = RAMPS.metal;
    }
    cel.userData.outlineParameters = std.name === 'Lens' ? { visible: false }
      : { color: [0.09, 0.3, 0.38], thickness: 0.0045, alpha: 1 };
    if (std.name === 'Lens') o.castShadow = false;
    o.material = cel;
    if (o.morphTargetDictionary && !body) body = o;
  });
  const rigNode = root.getObjectByName('MnotRig');
  const rig = Object.fromEntries(Object.entries(RIG_DEFAULTS).map(([k, d]) => [k, rigNode?.userData[k] ?? d]));
  // the visible model sits in a holder, so the game can squash it without touching the player's transform
  const holder = new THREE.Group();
  holder.add(root);
  return { root: holder, model: root, rig, animator: new Animator(root, gltf.animations), body };
}

// Blends clips by weight: the current clip fades in, the others fade out, and the weights always add up to one.
// A clip that comes back while it's still fading out carries on where it was, so quick changes never pop.
export class Animator {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map();
    this.weights = new Map();
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      if (ONE_SHOTS.has(clip.name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.setEffectiveWeight(0);
      this.actions.set(clip.name, action);
      this.weights.set(clip.name, 0);
    }
    this.current = null;
    this.rate = Infinity;
    this.stepPhase = null;
  }

  has(name) { return this.actions.has(name); }

  get action() { return this.actions.get(this.current); }
  get time() { return this.action?.time ?? 0; }
  get duration() { return this.action?.getClip().duration ?? 0; }
  get finished() { return ONE_SHOTS.has(this.current) && this.time >= this.duration - 1e-4; }

  // restart plays a one-shot from `at` seconds even if it's already the current clip.
  play(name, fade = 0.15, { restart = false, at = 0 } = {}) {
    const next = this.actions.get(name);
    if (!next) return false;
    if (name === this.current && !restart) return true;
    const previous = this.action;
    if (restart || ONE_SHOTS.has(name) || this.weights.get(name) === 0) {
      next.reset();
      next.time = at;
      // Walk and Run share their stride phase, so switching between them keeps the feet in step
      if (previous && GAITS.has(name) && GAITS.has(this.current) && !restart) {
        next.time = previous.time / previous.getClip().duration * next.getClip().duration;
      }
    }
    next.play();
    this.current = name;
    this.rate = fade > 0 ? 1 / fade : Infinity;
    return true;
  }

  // Walk and Run advance at one shared phase rate, set by the travel speed and their blended stride.
  setGaitSpeed(speed, strides) {
    let weight = 0, stride = 0;
    for (const name of GAITS) {
      const w = this.weights.get(name) ?? 0;
      weight += w;
      stride += w * strides[name] * (this.actions.get(name)?.getClip().duration ?? 1);
    }
    if (weight === 0) return;
    const frequency = speed / (stride / weight);
    for (const name of GAITS) {
      const action = this.actions.get(name);
      action?.setEffectiveTimeScale(frequency * action.getClip().duration);
    }
  }

  setTimeScale(name, scale) {
    this.actions.get(name)?.setEffectiveTimeScale(scale);
  }

  // Returns 'Walk' or 'Run' on the frame a foot comes down, else null.
  footstep() {
    const gait = GAITS.has(this.current) ? this.current : null;
    if (!gait || (this.weights.get(gait) ?? 0) < 0.5) { this.stepPhase = null; return null; }
    const action = this.action;
    const phase = Math.floor(action.time / action.getClip().duration * 2) % 2;
    const step = this.stepPhase !== null && phase !== this.stepPhase;
    this.stepPhase = phase;
    return step ? gait : null;
  }

  update(dt) {
    let total = 0;
    for (const [name, action] of this.actions) {
      let w = this.weights.get(name);
      const target = name === this.current ? 1 : 0;
      w = this.rate === Infinity ? target : target ? Math.min(1, w + dt * this.rate) : Math.max(0, w - dt * this.rate);
      if (w === 0 && action.isScheduled()) action.stop();
      this.weights.set(name, w);
      total += w;
    }
    for (const [name, action] of this.actions) action.setEffectiveWeight(this.weights.get(name) / (total || 1));
    this.mixer.update(dt);
  }
}

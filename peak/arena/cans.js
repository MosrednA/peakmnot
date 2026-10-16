// The cans as they're drawn: Mnot's model once (mnot.js), a copy of it for every player in the colour of their slot,
// its clip picked from its state in the room (sim.js: walking, in the air, reeling, waving, dancing), its name over
// its head and its last chat line in a bubble above that. The name and bubble are HTML (the page's #tags), so they
// stay sharp and are only ever text.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Animator, loadMnot } from '../mnot/mnot.js';
import { EMOTE } from './sim.js';

// a can for each slot (room.mjs gives each player the first one free): Mnot's red first
export const COLORS = ['#e23b2e', '#22a98f', '#3f7fd8', '#ffb02e', '#8e5bd0', '#4fbf4a', '#f06aa8', '#ffd84a',
  '#2b3352', '#ff7a45', '#62cbe8', '#eef1f6'];
const BUBBLE_TIME = 6;                            // s a chat line stays over its can
const REEL_CLIP = 'Teeter';

export class Cans {
  constructor(scene, tags) {
    this.scene = scene;
    this.tags = tags;
    this.list = new Map();                        // by player id
  }

  async load() {
    this.mnot = await loadMnot();
    this.clips = [...this.mnot.animator.actions.values()].map(a => a.getClip());
    const box = new THREE.Box3().setFromObject(this.mnot.model);
    this.height = box.max.y - box.min.y;
    return this.mnot;
  }

  // a new can for a player: { id, name, color }, mine or not
  add({ id, name, color }, mine = false) {
    this.remove(id);
    const model = cloneSkinned(this.mnot.model);
    const paint = new THREE.Color(COLORS[color % COLORS.length]);
    model.traverse(o => {
      if (!o.isMesh || o.material.name !== 'Can') return;
      o.material = o.material.clone();
      o.material.color.copy(paint);
    });
    const root = new THREE.Group();
    root.add(model);
    root.name = `can ${id}`;
    this.scene.add(root);
    const tag = document.createElement('div');
    tag.className = `tag${mine ? ' mine' : ''}`;
    tag.style.setProperty('--can', COLORS[color % COLORS.length]);
    const label = document.createElement('b');
    label.textContent = name;
    const bubble = document.createElement('span');
    bubble.className = 'bubble';
    bubble.hidden = true;
    tag.append(bubble, label);
    this.tags.append(tag);
    const can = { id, name, color, mine, root, model, animator: new Animator(model, this.clips), tag, bubble,
      said: 0, ground: true, emote: 0, bumps: null, air: 0, landing: 0 };
    can.animator.play('Idle', 0);
    this.list.set(id, can);
    return can;
  }

  remove(id) {
    const can = this.list.get(id);
    if (!can) return;
    this.scene.remove(can.root);
    can.root.traverse(o => { if (o.isMesh && o.material.name === 'Can') o.material.dispose(); });
    can.tag.remove();
    this.list.delete(id);
  }

  clear() { for (const id of [...this.list.keys()]) this.remove(id); }

  say(id, text) {
    const can = this.list.get(id);
    if (!can) return;
    can.bubble.textContent = text;
    can.bubble.hidden = false;
    can.said = BUBBLE_TIME;
  }

  // Put a can where its state says (sim.js fields, already smoothed by the page) and pick its clip. Returns what
  // happened to it this frame, for the sounds and puffs: 'jump', 'land', 'bump'.
  pose(can, s, dt) {
    const events = [];
    can.root.position.set(s.x, s.y, s.z);
    can.root.rotation.y = s.yaw;
    const anim = can.animator, speed = Math.hypot(s.vx, s.vz);
    if (can.bumps !== null && s.bumps !== can.bumps) events.push('bump');
    can.bumps = s.bumps;
    if (can.ground && !s.ground) {
      if (s.daze <= 0) events.push('jump');
      can.air = 0;
    }
    if (!can.ground && s.ground) {
      events.push('land');
      can.landing = 0.25;
    }
    can.ground = s.ground;
    can.air += dt;
    can.landing = Math.max(0, can.landing - dt);
    if (s.daze > 0) anim.play(REEL_CLIP, 0.08);
    else if (!s.ground) {
      if (events.includes('jump')) anim.play('JumpStart', 0.05, { at: this.mnot.rig.jump_takeoff });
      else if (anim.current !== 'JumpStart' || anim.finished) anim.play('Fall', 0.25);
    } else if (can.landing > 0 && speed < 0.4 && anim.current !== 'Idle') anim.play('Land', 0.06);
    else if (s.emote === EMOTE.wave) anim.play('Wave', 0.2);
    else if (s.emote === EMOTE.dance) anim.play('Dance', 0.3);
    else if (speed > 0.3) {
      anim.play(speed > 2.2 ? 'Run' : 'Walk', 0.2);
      anim.setGaitSpeed(speed, { Walk: this.mnot.rig.walk_speed, Run: this.mnot.rig.run_speed });
    } else if (anim.current !== 'Land' || anim.finished) anim.play('Idle', 0.25);
    anim.update(dt);
    if (can.said > 0 && (can.said -= dt) <= 0) can.bubble.hidden = true;
    return events;
  }

  // the names and bubbles over the heads, on the screen
  place(camera, width, height) {
    for (const can of this.list.values()) {
      const p = _at.copy(can.root.position).setY(can.root.position.y + this.height + 0.15).project(camera);
      const show = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
      can.tag.hidden = !show;
      if (!show) continue;
      const x = (p.x + 1) / 2 * width, y = (1 - p.y) / 2 * height;
      can.tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      can.tag.style.zIndex = String(1000 - Math.round(p.z * 1000));
    }
  }
}

const _at = new THREE.Vector3();

// Rockfall: inside a 'rockfall' zone (route.js) rocks drop from the cliff now and then. A shadow on the ground
// warns where one will land, growing and darkening until it hits, while pebbles and grit trickle down onto the spot
// from above, which leaves time to dodge; a hit dents the can and bonks Mnot aside. The rock lands in a burst of
// snow and stone chips (bursts.js), then bounces, rolls off down the slope and shrinks away.
import * as THREE from 'three';
import { toon, noOutline } from './look.js';
import { random } from './world.js';
import { bursts } from './bursts.js';

const WARNING = 1.2;          // seconds from the shadow appearing to the hit
const DROP = 6.5;             // metres a rock falls in that time
const GRAVITY = 2 * DROP / WARNING ** 2;
const HIT_RADIUS = 0.5;
const GAP = [1.5, 2.7];       // seconds between rocks
const AIMED = 0.55;           // the share of rocks dropped where Mnot is heading; the rest land just ahead

const ROCK_GEOMETRY = new THREE.DodecahedronGeometry(0.25, 0);
const SHADOW_GEOMETRY = new THREE.CircleGeometry(HIT_RADIUS, 24).rotateX(-Math.PI / 2);

export class Rockfall {
  constructor(scene, world, { player, game }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.game = game;
    this.rocks = [];
    this.timer = 0.8;
    this.rand = random(7);
    this.listeners = [];
  }

  // fn({ hit, at }) when a rock lands, for sounds
  onImpact(fn) { this.listeners.push(fn); }

  update(dt) {
    const p = this.player, zone = this.zoneAt(p.pos);
    if (zone && !this.game.out && !this.game.done) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.drop(zone);
        this.timer = GAP[0] + (GAP[1] - GAP[0]) * this.rand();
      }
    } else this.timer = Math.max(this.timer, 0.8);      // stepping in, the first rock comes after a moment
    for (const rock of this.rocks) this.fly(rock, dt);
    this.rocks = this.rocks.filter(rock => !rock.gone);
  }

  zoneAt(pos) {
    return this.world.zones.find(z => z.kind === 'rockfall' && pos.x > z.minX - 0.5 && pos.x < z.maxX + 0.5
      && pos.z > z.minZ - 0.8 && pos.z < z.maxZ && pos.y < z.top);
  }

  drop(zone) {
    const p = this.player, target = new THREE.Vector3();
    if (this.rand() < AIMED) target.copy(p.pos).addScaledVector(p.vel, WARNING * 0.8);
    else target.set(p.pos.x + (this.rand() * 2 - 1) * 1.2, 0, p.pos.z + 0.6 + this.rand() * 2.4);
    target.x = THREE.MathUtils.clamp(target.x, zone.minX, zone.maxX);
    target.z = THREE.MathUtils.clamp(target.z, zone.minZ, zone.maxZ);
    const ground = this.world.ground(target.x, target.z, zone.top, 0);
    if (!ground) return;
    target.y = ground.top;

    const mesh = new THREE.Mesh(ROCK_GEOMETRY, toon('#7f7a86', { outline: 'rock' }));
    mesh.castShadow = true;
    const size = 0.8 + 0.5 * this.rand();
    mesh.scale.setScalar(size);
    const shadow = new THREE.Mesh(SHADOW_GEOMETRY, noOutline(new THREE.MeshBasicMaterial({
      color: '#1d2238', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })));
    shadow.position.copy(target).y += 0.06;           // over the snow pillow on the rock's top
    this.scene.add(mesh, shadow);
    const spin = new THREE.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).normalize();
    this.rocks.push({ mesh, shadow, target, spin, size, t: 0, landed: false, pos: target.clone().setY(target.y + DROP),
      vel: new THREE.Vector3(), vy: 0, trickle: 0 });
  }

  fly(rock, dt) {
    rock.t += dt;
    const { mesh, shadow } = rock;
    mesh.rotateOnAxis(rock.spin, dt * (rock.landed ? 5 : 3));
    if (!rock.landed) {
      const k = Math.min(1, rock.t / WARNING);
      rock.pos.y = rock.target.y + DROP - 0.5 * GRAVITY * rock.t ** 2;
      shadow.material.opacity = 0.32 + 0.48 * k * k;
      shadow.scale.setScalar(0.5 + 0.5 * k);
      // pebbles and grit trickle down onto the spot, quicker as the rock comes; the first ones at once
      rock.trickle -= dt;
      if (rock.trickle <= 0 && k < 0.85) {
        bursts(this.world).trickle(rock.target, HIT_RADIUS * 0.9, { pebble: this.rand() < 0.6 });
        rock.trickle = 0.16 - 0.1 * k;
      }
      if (rock.t >= WARNING) this.land(rock);
    } else {
      // bounce and roll off down the slope
      rock.vy -= 15 * dt;
      rock.pos.addScaledVector(rock.vel, dt);
      rock.pos.y += rock.vy * dt;
      const ground = this.world.ground(rock.pos.x, rock.pos.z, rock.pos.y + 0.3, 0);
      if (ground && rock.pos.y < ground.top + 0.2 && rock.vy < 0) {
        rock.pos.y = ground.top + 0.2;
        rock.vy = rock.vy < -1.5 ? -0.4 * rock.vy : 0;
      }
      const fade = THREE.MathUtils.clamp((rock.t - WARNING - 1.2) / 0.5, 0, 1);
      mesh.scale.setScalar(rock.size * (1 - fade));
      if (fade >= 1 || rock.pos.y < rock.target.y - 15) this.remove(rock);
    }
    mesh.position.copy(rock.pos).y += 0.2 * (rock.landed ? 0 : 1);
  }

  land(rock) {
    rock.landed = true;
    rock.pos.y = rock.target.y + 0.2;
    this.scene.remove(rock.shadow);
    rock.shadow.material.dispose();
    const p = this.player;
    const away = new THREE.Vector3(p.pos.x - rock.target.x, 0, p.pos.z - rock.target.z);
    const hit = p.mode !== 'out' && away.length() < HIT_RADIUS && p.pos.y > rock.target.y - 0.5 && p.pos.y < rock.target.y + 1.4;
    if (hit) {
      if (away.lengthSq() < 1e-4) away.set(this.rand() - 0.5, 0, -1);
      this.game.dent('rock', rock.pos.clone().setY(rock.target.y + 1.6));
      p.knock(away);
    }
    // off it goes, down the slope (the steps climb towards +z), a little sideways
    rock.vel.set((this.rand() - 0.5) * 1.2, 0, -1.6 - this.rand());
    rock.vy = 2.6;
    const spray = bursts(this.world);
    spray.snow(rock.target, { puffs: 8, flakes: 10, spread: 0.6, grit: 0.4 });
    spray.chips(rock.target, { count: 5 });
    for (const fn of this.listeners) fn({ hit, at: rock.target });
  }

  remove(rock) {
    rock.gone = true;
    this.scene.remove(rock.mesh);
  }
}

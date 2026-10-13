// The climb, from base camp to the summit. Distances suit Mnot's jumps: a running jump clears about 1 m of gap and
// 0.5 m of height, so gaps here are 0.6-0.9 m and rises at most 0.4 m. Steps up to 0.25 m need no jump.
//
//   base camp → ledges (one loose) → board walk → ice → plank → checkpoint 1 → cliff ledges: a loose one, an icy
//   corner, a wind gap, a gondola → checkpoint 2 → rope → checkpoint 3 → a ring of ice round a sinkhole → ledges and
//   loose ledges under a crumbling cliff (rockfall) → snowy ledges → steep plank → icy ledges → a wind gap → a last
//   loose ledge → summit
//
// Each trick shows up first where a slip costs little (a slow loose ledge and ice with rock all round before
// checkpoint 1, an icy corner against a wall, a narrow wind gap, the ring right after a checkpoint), and for real near
// the top.
//
// Each stretch has its own camera shot (the rail at the bottom): three-quarter from the front for jumping, from the
// side like a 2.5D game along the cliff, from high up where rocks fall. Planks and ropes are always shot from the front
// (camera.js), so you see Mnot's glasses and lean.
import * as THREE from 'three';
import { checkpointFlag, summitFlag, signpost, tent, cairn, pennants, podcastTable, trailMap, snackStash, warningSign,
  bench, lostMic, dressRoute, onRock } from './decor.js';
import { looseLedge } from './crumble.js';
import { icePatch } from './ice.js';
import { ringRock } from './ring.js';
import { gondola } from './movers.js';
import { windsock } from './windsock.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);

// A rock pillar from its extents: x0..x1 by z0..z1, its top at y.
function rock(world, x0, x1, z0, z1, y, options = {}) {
  return world.rock({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y, ...options });
}

// A checkpoint: where Mnot comes back, which way Mnot faces (yaw, 0 = +Z), and the flag that marks it.
// Mnot reaches it within radius of the respawn spot, so the flag can stand out of the way.
function checkpoint(world, respawn, yaw, flagAt) {
  const flag = checkpointFlag(world, flagAt);
  const cp = { index: world.checkpoints.length, respawn, yaw, flag, at: respawn, radius: 1.5 };
  world.checkpoints.push(cp);
  return cp;
}

export function buildRoute(world) {
  // ---- base camp
  rock(world, -2.6, 2.7, -5.5, 2.5, 0, { chamfer: 0.9, seed: 1 });
  // the podcast's camp on the left of the shot, the way up on the right, and Mnot clear against the sky in between
  tent(world, v(0.85, 0, -3.7), -0.15);
  podcastTable(world, v(-1.2, 0, -2.55), 'camera');
  snackStash(world, v(-0.35, 0, -3.75), 'camera');
  trailMap(world, v(1.55, 0, 1.2), 'camera');
  checkpoint(world, v(0, 0, -0.6), -0.3, v(2.0, 0, -0.1)).flag.activate();

  // ---- ledges with gaps
  rock(world, -0.8, 1.4, 3.1, 5.1, 0.2);
  signpost(world, v(1.08, 0.2, 4.3), 'camera', 'Loose rock ahead.\nDon\'t stand there\noverthinking it.',
    { size: 22, height: 0.55 });
  rock(world, -1.3, 0.5, 5.9, 7.5, 0.6);
  looseLedge(world, -0.4, 1.6, 8.4, 10.2, 0.6, { delay: 1.3 });     // the first loose ledge: slow to go
  rock(world, -1.3, 1.7, 10.9, 13.4, 1.0, { chamfer: 0.5 });
  signpost(world, v(1.3, 1.0, 12.4), 'camera', 'Ledges: 7 left.\n(8 if you count\nthe camp. We don\'t.)',
    { size: 22, height: 0.6 });

  // ---- board walk, then a plank to balance on
  world.board(v(0.2, 1.0, 13.2), v(0.2, 1.0, 16.6));
  rock(world, -1.1, 1.5, 16.4, 19.0, 1.0);
  icePatch(world, -0.85, 0.85, 16.75, 18.5, 1.0, { drift: [-0.45, 0] });   // the first ice: rock all round it
  world.plank(v(0.2, 1.0, 18.85), v(0.2, 1.2, 23.15));
  world.zone('wind', 0.2, 21, 4, 0.45);
  signpost(world, v(1.15, 1.0, 18.3), 'camera', 'This plank is 4.32 m.\nNot 4.3. We measured.',
    { size: 24, height: 0.45, width: 1.2 });

  // ---- checkpoint 1, then ledges along a cliff
  rock(world, -1.4, 1.8, 23.0, 26.5, 1.2, { chamfer: 0.6 });
  checkpoint(world, v(0.4, 1.2, 24.6), 0.6, v(-0.9, 1.2, 23.6));
  rock(world, 8.3, 14, 21.5, 36.5, 10, { chamfer: 1.2 });          // the cliff to the east
  rock(world, 2.6, 9.2, 34.3, 38.5, 7.5, { chamfer: 0.9 });        // and to the north
  rock(world, 2.5, 4.3, 24.0, 25.2, 1.5);
  looseLedge(world, 4.9, 6.4, 24.4, 25.4, 1.9);
  rock(world, 7.0, 8.35, 24.2, 26.2, 2.3);                          // into the cliff: no slot to slip down
  icePatch(world, 7.08, 8.2, 24.3, 26.1, 2.3, { drift: [0, -0.7] });   // an icy corner: the cliff stops the slide
  rock(world, 7.2, 8.2, 26.75, 28.3, 2.65);
  rock(world, 7.5, 8.2, 28.9, 31.5, 2.9, { chamfer: 0.15 });       // a narrow ledge: careful steps
  rock(world, 6.6, 8.2, 32.3, 34.0, 3.3);
  // a wind gap between the two cliffs blows down the ledges; a windsock on the wall shows its beat
  world.zone('gust', 7.85, 31.9, 1.5, 1, { y: 3.1, yaw: Math.PI, offset: 1.5 });
  windsock(world, v(8.3, 5.15, 32.0), { bracket: v(-1, 0, 0) });
  // then a gondola along the north wall, up to checkpoint 2
  gondola(world, v(5.65, 3.3, 33.1), v(3.15, 4.2, 33.1), [v(6.95, 3.3, 33.6), v(1.85, 4.3, 33.6)]);
  signpost(world, v(7.8, 3.3, 33.45), 'camera', 'Gondola.\nRuns on Python.\nMostly.',
    { size: 24, height: 0.5, bottom: 1.95 });     // a tall station sign: it reads over Mnot waiting at the corner

  // ---- checkpoint 2, then the rope
  rock(world, -1.0, 2.2, 31.5, 35.0, 4.3, { chamfer: 0.6 });
  checkpoint(world, v(0.4, 4.3, 33.7), 0, v(-0.7, 4.3, 33.0));
  world.rope(v(0.4, 4.3, 34.85), v(0.4, 4.5, 41.15), { sag: 0.3 });
  world.zone('wind', 0.4, 38, 5.5, 1.0);
  signpost(world, v(1.5, 4.3, 34.3), 'camera', 'Technically a slackline,\nnot a tightrope.\n(Discuss.)',
    { size: 22, height: 0.6, width: 1.2 });

  // ---- checkpoint 3, right before a ring of ice round a sinkhole (ring.js): on at the south pad, round either way,
  // off at the north pad. Going straight slides you into the hole or off the outside. The pads overlap the ledges
  // either side by a few centimetres, so no hairline seam is left between them.
  rock(world, -1.2, 2.0, 41.0, 44.5, 4.5, { chamfer: 0.5 });
  checkpoint(world, v(0.4, 4.5, 42.4), 0, v(1.6, 4.5, 42.5));
  pennants(world, v(1.65, 4.5, 41.25), v(1.6, 4.5, 42.5), { posts: [true, false] });   // tied to the flag pole
  signpost(world, v(1.45, 4.5, 43.95), 'camera', 'Ring road.\nNo U-turns.\nNo brakes either.',
    { size: 24, height: 0.5 });
  ringRock(world, { center: [-0.4, 47.38], inner: 1.6, outer: 3.0, y: 4.5, pads: [[-105, -75], [75, 105]] });

  // ---- then steps up under a cliff that sheds rocks, the abyss on the other side
  const steps = [[50.25, 51.75, 4.72], [51.75, 53.15, 4.94], [55.75, 57.35, 5.42], [59.85, 61.75, 6.0]];
  for (const [z0, z1, y] of steps) rock(world, -1.0, 1.8, z0, z1, y, { chamfer: 0.12 });
  looseLedge(world, -0.6, 1.4, 53.85, 55.05, 5.18);                 // no waiting for rocks on these two
  looseLedge(world, -0.4, 1.4, 58.05, 59.15, 5.7);
  rock(world, 1.9, 5.0, 49.75, 62.75, 11.0, { chamfer: 0.8 });
  world.zone('rockfall', 0.4, 56.05, 6.2, 1, { minZ: 50.35, maxZ: 61.75, minX: -0.9, maxX: 1.7, top: 10.5 });
  warningSign(world, v(1.45, 4.72, 50.75), 'camera',
    'Falling rocks:\n0.8 per minute,\ngive or take a\nsignificant digit');

  // ---- snowy ledges, a steep plank and the summit
  rock(world, -0.6, 1.4, 62.45, 63.95, 6.4);
  rock(world, 2.0, 3.4, 64.35, 65.75, 6.8);
  world.plank(v(2.7, 6.8, 65.6), v(2.7, 7.6, 69.4), { wobble: 2.3 });     // the last test, in the wind
  rock(world, 1.7, 3.7, 69.25, 71.05, 7.6);
  // west over the ice, north through a wind gap, then east over a last loose ledge to the summit
  rock(world, -0.3, 1.0, 69.55, 70.75, 7.75);
  icePatch(world, -0.22, 0.92, 69.63, 70.67, 7.75, { drift: [0, -0.7] });    // land, slide, jump on
  rock(world, -2.5, -1.0, 69.35, 71.15, 7.95);
  icePatch(world, -1.7, -1.08, 69.45, 71.05, 7.95, { drift: [0, -0.6] });   // land on ice, slide onto rock
  world.zone('gust', -1.8, 71.6, 1.7, 1, { y: 8.0, yaw: Math.PI });
  rock(world, -2.4, -1.2, 72.05, 74.85, 8.15);
  windsock(world, onRock(world, v(-2.25, 8.15, 72.25), 'windsock'));    // across the gap, blowing at you
  signpost(world, v(-1.55, 8.15, 72.55), 'camera', 'Venturi effect.\nWe did a three-hour\nepisode on it.',
    { size: 21, height: 0.5, width: 1.1 });
  looseLedge(world, -0.45, 0.35, 73.95, 75.15, 8.3);
  rock(world, 1.0, 5.0, 73.25, 77.25, 8.4, { chamfer: 1.0 });
  world.zone('wind', 2.7, 67.75, 7, 0.9);
  world.zone('snow', 2.5, 69.75, 12, 1);
  // the flag in its cairn ahead, clear of the way in, so it stands beside Mnot in the summit shot (camera.js), the
  // plaque and the trophy turned to that camera
  world.summit = { at: v(3.0, 8.4, 75.35), radius: 1.2, flag: summitFlag(world, v(4.0, 8.4, 74.95), { yaw: 2.84 }) };

  // The camera rail: points along the walking line. theta is the camera's angle from the way the route goes
  // (90° looks from the side, smaller looks more from the front); it always sits on the route's right, so the way
  // up runs to the right of the screen.
  const shot = {
    jump: { theta: 62, pitch: 0.36, distance: 5.2 },
    side: { theta: 78, pitch: 0.14, distance: 6.4 },          // 2.5D, the cliff as the backdrop
    rockfall: { theta: 50, pitch: 0.85, distance: 6.4 },      // high up, to see the falling rocks' shadows
    bend: { theta: 48, pitch: 0.3, distance: 5.6 },           // more from the front: less far to swing at a bend
    // (not under 45: the controls' onwards key stays right, input.js)
    // high up from in front, the hole in view and Mnot coming round to face it; the keys turn plain screen
    // directions here (input.js), which suits steering round a ring
    ring: { theta: 12, pitch: 0.85, distance: 7.5 },
  };
  const rail = (x, y, z, s) => world.rail.push({ at: v(x, y, z), ...s, theta: THREE.MathUtils.degToRad(s.theta) });
  rail(0, 0, -1, shot.jump);
  rail(0.2, 1.2, 24.6, shot.jump);         // up the ledges, the board walk and the plank
  rail(3.4, 1.5, 24.6, shot.jump);         // east over the first cliff ledges
  rail(7.6, 2.3, 25.2, shot.side);         // round the corner: along the cliff, from the side
  rail(7.85, 3.3, 33.0, shot.side);
  rail(3.5, 4.1, 33.1, shot.side);         // along the north wall, on the gondola
  rail(0.4, 4.3, 33.1, shot.jump);         // the corner: onwards turns north, to the rope
  rail(0.4, 4.5, 42.6, shot.jump);         // the rope
  rail(0.4, 4.5, 44.0, shot.ring);         // round the ring
  rail(0.4, 4.5, 50.3, shot.ring);
  rail(0.4, 4.72, 51.6, shot.rockfall);    // the rockfall steps
  rail(0.4, 6.0, 61.15, shot.rockfall);
  rail(0.4, 6.4, 63.15, shot.jump);
  rail(2.7, 6.8, 65.05, shot.jump);
  rail(2.7, 7.6, 70.15, shot.jump);        // up the steep plank, then west over the ice
  rail(-1.75, 7.95, 70.25, shot.bend);     // turning north: from the front, so the face stays in view
  rail(-1.8, 8.15, 72.95, shot.side);      // through the wind gap, side-on
  rail(-1.8, 8.15, 74.55, shot.bend);      // turning east to the summit
  rail(3.0, 8.4, 74.55, shot.jump);

  dressRoute(world);      // props: beams fitted to their ledges, signs turned to the camera (decor.js)
  return { start: world.checkpoints[0] };
}

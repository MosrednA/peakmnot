// The climb, from base camp to the summit. Distances suit Mnot's jumps: a running jump clears about 1 m of gap and
// 0.5 m of height, so gaps here are 0.6-0.9 m and rises at most 0.4 m. Steps up to 0.25 m need no jump.
//
//   base camp → ledges → board walk → plank → checkpoint 1 → cliff ledges → checkpoint 2 → rope → checkpoint 3
//   → steps under a crumbling cliff (rockfall) → snowy ledges → steep plank → summit
//
// Each stretch has its own camera shot (the rail at the bottom): three-quarter from the front for jumping, from the
// side like a 2.5D game along the cliff, from high up where rocks fall. Planks and ropes are always shot from the front
// (camera.js), so you see Mnot's glasses and lean.
import * as THREE from 'three';
import { checkpointFlag, summitFlag, signpost, tent, cairn, pennants } from './decor.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const FACE = -1.1;    // a sign's turn that faces the camera on a stretch going +Z

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
  rock(world, -2.5, 2.5, -2.5, 2.5, 0, { chamfer: 0.8, seed: 1 });
  // props stand on the route's left, away from the camera, and signs face it
  tent(world, v(1.3, 0, -1.3), -0.7);
  cairn(world, v(-1.7, 0, -1.7), 0.5);
  signpost(world, v(1.6, 0, 1.1), FACE, 'PEAK MNOT\n↑ 4,810 m', { size: 40 });
  checkpoint(world, v(0, 0, -0.6), 0, v(2.0, 0, -0.1)).flag.activate();

  // ---- ledges with gaps
  rock(world, -0.8, 1.4, 3.1, 5.1, 0.2);
  rock(world, -1.3, 0.5, 5.9, 7.5, 0.6);
  rock(world, -0.4, 1.6, 8.4, 10.2, 0.6);
  rock(world, -1.3, 1.7, 10.9, 13.4, 1.0, { chamfer: 0.5 });
  signpost(world, v(1.25, 1.0, 12.4), FACE, 'Ledges: 7 left.\n(8 if you count\nthe camp. We don\'t.)',
    { size: 22, height: 0.6 });

  // ---- board walk, then a plank to balance on
  world.board(v(0.2, 1.0, 13.2), v(0.2, 1.0, 16.6));
  rock(world, -1.1, 1.5, 16.4, 19.0, 1.0);
  world.plank(v(0.2, 1.0, 18.85), v(0.2, 1.2, 23.15));
  world.zone('wind', 0.2, 21, 4, 0.45);
  signpost(world, v(1.15, 1.0, 18.3), FACE, 'This plank is 4.32 m.\nNot 4.3. We measured.',
    { size: 24, height: 0.45, width: 1.2 });

  // ---- checkpoint 1, then ledges along a cliff
  rock(world, -1.4, 1.8, 23.0, 26.5, 1.2, { chamfer: 0.6 });
  checkpoint(world, v(0.4, 1.2, 24.6), Math.PI / 2, v(-0.8, 1.2, 23.7));
  rock(world, 8.3, 14, 21.5, 36.5, 10, { chamfer: 1.2 });          // the cliff to the east
  rock(world, 2.6, 9.2, 34.3, 38.5, 7.5, { chamfer: 0.9 });        // and to the north
  rock(world, 2.5, 4.3, 24.0, 25.2, 1.5);
  rock(world, 4.9, 6.5, 24.5, 25.4, 1.9);
  rock(world, 7.0, 8.2, 24.2, 26.2, 2.3);
  rock(world, 7.2, 8.2, 26.9, 28.3, 2.7);
  rock(world, 7.5, 8.2, 28.9, 31.5, 2.9, { chamfer: 0.15 });       // a narrow ledge: careful steps
  rock(world, 6.6, 8.2, 32.1, 34.0, 3.3);
  rock(world, 4.8, 6.0, 32.6, 33.6, 3.7);
  rock(world, 2.8, 4.2, 32.4, 33.8, 4.1);

  // ---- checkpoint 2, then the rope
  rock(world, -1.0, 2.2, 31.5, 35.0, 4.3, { chamfer: 0.6 });
  checkpoint(world, v(0.4, 4.3, 33.7), 0, v(-0.5, 4.3, 31.9));
  world.rope(v(0.4, 4.3, 34.85), v(0.4, 4.5, 41.15), { sag: 0.3 });
  world.zone('wind', 0.4, 38, 5.5, 1.0);
  signpost(world, v(1.3, 4.3, 32.0), FACE, 'Technically a slackline,\nnot a tightrope.\n(Discuss.)',
    { size: 22, height: 0.6, width: 1.2 });

  // ---- checkpoint 3, then steps up under a cliff that sheds rocks, the abyss on the other side
  rock(world, -1.2, 2.0, 41.0, 44.5, 4.5, { chamfer: 0.5 });
  checkpoint(world, v(0.4, 4.5, 42.4), 0, v(-0.6, 4.5, 41.8));
  pennants(world, v(1.75, 4.5, 41.3), v(1.75, 4.5, 43.4));
  const steps = [[44.5, 46.0, 4.72], [46.0, 47.5, 4.94], [47.5, 49.0, 5.16], [49.0, 50.4, 5.38],
    [51.2, 52.8, 5.6], [52.8, 54.3, 5.82], [54.3, 56.0, 6.04]];
  for (const [z0, z1, y] of steps) rock(world, -1.0, 1.8, z0, z1, y, { chamfer: 0.12 });
  rock(world, 1.9, 5.0, 44.0, 57.0, 11.0, { chamfer: 0.8 });
  world.zone('rockfall', 0.4, 50.3, 6.2, 1, { minZ: 44.6, maxZ: 56, minX: -0.9, maxX: 1.7, top: 10.5 });
  signpost(world, v(1.45, 4.5, 43.9), -0.3, 'Falling rocks:\n0.8 per minute,\ngive or take a\nsignificant digit',
    { size: 20, height: 0.62 });

  // ---- snowy ledges, a steep plank and the summit
  rock(world, -0.6, 1.4, 56.7, 58.2, 6.4);
  rock(world, 2.0, 3.4, 58.6, 60.0, 6.8);
  world.plank(v(2.7, 6.8, 59.85), v(2.7, 7.6, 63.65), { wobble: 2.3 });     // the last test, in the wind
  rock(world, 1.7, 3.7, 63.5, 65.3, 7.6);
  rock(world, 2.5, 3.5, 65.9, 66.9, 8.0, { chamfer: 0.2 });
  rock(world, 1.0, 5.0, 67.5, 71.5, 8.4, { chamfer: 1.0 });
  world.zone('wind', 2.7, 62, 7, 0.9);
  world.zone('snow', 2.5, 64, 12, 1);
  world.summit = { at: v(3.0, 8.4, 69.6), radius: 1.2, flag: summitFlag(world, v(3.0, 8.4, 69.6)) };
  signpost(world, v(4.2, 8.4, 68.3), FACE, 'You have reached\nPEAK MNOT', { size: 30, height: 0.5 });

  // The camera rail: points along the walking line. theta is the camera's angle from the way the route goes
  // (90° looks from the side, smaller looks more from the front); it always sits on the route's right, so the way
  // up runs to the right of the screen.
  const shot = {
    jump: { theta: 62, pitch: 0.36, distance: 5.2 },
    side: { theta: 78, pitch: 0.14, distance: 6.4 },          // 2.5D, the cliff as the backdrop
    rockfall: { theta: 50, pitch: 0.85, distance: 6.4 },      // high up, to see the falling rocks' shadows
  };
  const rail = (x, y, z, s) => world.rail.push({ at: v(x, y, z), ...s, theta: THREE.MathUtils.degToRad(s.theta) });
  rail(0, 0, -1, shot.jump);
  rail(0.2, 1.2, 24.6, shot.jump);         // up the ledges, the board walk and the plank
  rail(3.4, 1.5, 24.6, shot.jump);         // east over the first cliff ledges
  rail(7.6, 2.3, 25.2, shot.side);         // round the corner: along the cliff, from the side
  rail(7.85, 3.3, 33.0, shot.side);
  rail(3.5, 4.1, 33.1, shot.side);         // along the north wall
  rail(0.4, 4.3, 33.1, shot.jump);         // the corner: onwards turns north, to the rope
  rail(0.4, 4.5, 43.4, shot.rockfall);     // the rope, then the rockfall steps
  rail(0.4, 6.0, 55.4, shot.rockfall);
  rail(0.4, 6.4, 57.4, shot.jump);
  rail(2.7, 6.8, 59.3, shot.jump);
  rail(2.7, 7.6, 64.4, shot.jump);
  rail(3.0, 8.4, 69.6, shot.jump);

  return { start: world.checkpoints[0] };
}

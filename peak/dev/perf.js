// The climb's side of the perf probe (peak/kit/perf.js), for peak.html?perf: main.js loads it instead of starting the
// game. The probe puts Mnot at base camp, at each checkpoint and on the summit, and watches a few seconds of frames at
// each; here are those spots, what's in the climb's scene (the route's rocks, beams and props, and what hangs in the
// scene itself) and the thank-you card's words. Under the card, Mnot dances on the summit in bursts of confetti.
import { probe as measure } from '../kit/perf.js';
import { look } from './bots.js';

export function probe(peak) {
  const { world } = peak;
  const spots = world.checkpoints.map((cp, i) => ({ label: i ? `checkpoint ${i}` : 'base camp',
    go: () => look(peak, cp.respawn.toArray(), cp.yaw) }));
  if (world.summit) spots.push({ label: 'summit', go: () => look(peak, world.summit.at.toArray(), 0) });
  return measure(peak, { name: 'Peak Mnot', what: 'the climb', board: 'peak', spots, things: () => things(peak), card: {
    pictures: 'a soda can on a mountain', way: 'up', wobble: 'Mnot on the rope', play: 'Climb Peak Mnot',
    jokes: [
      'Peak performance? Peak Mnot performance.',
      'Mnot drew the same summit thirty times in a row, to be sure. Not obsessive: statistics.',
    ],
    dance: () => dance(peak), more: () => peak.moments.confetti(24),
  } });
}

// What's in the scene, by thing: the route's parts (rocks, beams, props, the rest) and what hangs in the scene itself.
function things({ scene, world, mnot, weather }) {
  const rocks = new Set(world.blockers), beams = new Set(world.beams.map(b => b.mesh)), all = new Map();
  const add = (label, o) => (all.get(label) ?? all.set(label, []).get(label)).push(o);
  for (const o of world.group.children) {
    if (!o.visible) continue;
    add(rocks.has(o) ? 'rock pillars' : beams.has(o) ? 'planks and ropes' : o.userData.fade ? 'props' :
      'the rest of the route (boards, ledges, signs, gondolas, ice)', o);
  }
  const names = new Map([[mnot.root, 'Mnot'], [weather.flakes.points, 'snow'],
    [weather.streaks.lines, 'wind streaks']]);
  for (const o of scene.children) {
    if (o === world.group || !o.visible || o.isLight || !(o.isMesh || o.isPoints || o.isLine || o.children.length)) {
      continue;
    }
    add(names.get(o) ?? (o.name || `a ${o.type}`), o);
  }
  return all;
}

// Mnot on the summit, dancing for as long as the tab is open, with a burst of confetti every few seconds; the
// camera holds its summit close-up while Mnot celebrates (camera.js). On a narrow screen the card sits at the top,
// so the picture slides down a fifth of the screen to keep Mnot below it.
function dance(peak) {
  const { player, moments, world, camera } = peak;
  const narrow = matchMedia('(max-width: 640px)');
  look(peak, world.summit.at.toArray(), Math.PI);
  moments.confetti(70);
  let last = 0, next = 2;
  const frame = t => {
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
    last = t;
    if (narrow.matches) camera.setViewOffset(camera.aspect, 1, 0, -0.2, camera.aspect, 1);
    else if (camera.view?.enabled) camera.clearViewOffset();
    if (dt > 0) {
      player.idleClip = moments.playing = 'Dance';
      player.celebrate = 0.5;
      peak.step(dt, dt / Math.ceil(dt * 60 - 1e-6));
      if ((next -= dt) <= 0) {
        moments.confetti(30);
        next = 2.5 + 2 * Math.random();
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

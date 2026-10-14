// The downhill's side of the perf probe (peak/kit/perf.js), for downhill.html?perf: main.js loads it instead of
// starting the game. As on the climb, the probe puts the chair at a handful of spots and watches each a few seconds,
// the chair parked and Mnot idling on it (main.js): the start, the ice (where the most is in view), the river (the
// dearest on an integrated GPU), the ski jump and past the finish line, where the party plays. Here are those spots,
// what's in the downhill's scene and the thank-you card's words; under the card, Mnot's finish party plays on, with
// confetti every few seconds.
import { FEATURES } from './track.js';
import { probe as measure } from '../kit/perf.js';
import { confetti } from '../kit/party.js';

// where each spot is, metres down the run: the river's on its first floe, in the gorge (past its banner, which would
// hide it all), and the ski jump's on the in-run, the landing hill below
const SPOTS = [['the start', FEATURES.pits[0]], ['the ice', FEATURES.ice.from], ['the river', FEATURES.river.from + 6],
  ['the ski jump', FEATURES.jump.lip - 16]];
const PAST = FEATURES.finish + 12;     // where the party is

export function probe(downhill) {
  const spots = [...SPOTS.map(([label, s]) => ({ label, go: () => put(downhill, s) })),
    { label: 'the finish', go: () => celebrate(downhill) }];
  return measure(downhill, { name: 'Mnot Downhill', what: 'the run', board: 'downhill', spots,
    things: () => things(downhill), frame: dt => downhill.step(dt, dt), settle: () => downhill.restart(),
    card: {
      pictures: 'a soda can on a very expensive office chair', way: 'down', wobble: 'the chair on the moguls',
      play: 'Ride Mnot Downhill',
      jokes: [
        'Mnot sat still at five spots on the mountain to time this. Sitting still: what an office chair is built for.',
        '€1,649 of ergonomics, and your graphics card still did all the heavy lifting.',
        'Every pine on the mountain was drawn, every frame. No trees were harmed. A few chairs were.',
        'The office at the bottom wanted these numbers in a spreadsheet. Mnot sent JSON.',
        'Mnot drew the same stretch of piste thirty times in a row, to be sure. Not obsessive: statistics.',
      ],
      dance: () => dance(downhill), more: () => confetti(downhill.obstacles.puffs, downhill.ride.pos, { count: 50 }),
    } });
}

// The chair parked at s, with fresh wheels and everything set up again round it.
function put(downhill, s) {
  const { ride } = downhill;
  downhill.restart();
  ride.reset(s, { wheels: true });
  downhill.chase.snap(ride);
  downhill.step(1 / 120, 1 / 120);
}

// Past the finish line, the run done: the party starts.
function celebrate(downhill) {
  put(downhill, PAST);
  Object.assign(downhill.ride, { started: true, done: true });
}

// What's in the scene, by thing: the piste and the river, what stands on it (the obstacles by kind, the pines, the
// signs and banners) and what hangs in the scene itself (Mnot on the chair, the sky, the clouds, the range).
function things({ scene, obstacles }) {
  const all = new Map();
  const add = (label, o) => (all.get(label) ?? all.set(label, []).get(label)).push(o);
  const piste = scene.getObjectByName('piste');
  for (const o of piste.children) {
    if (o.visible) add(o.name === 'river' || o.name === 'gorge walls' ? 'the river and its gorge' : 'the piste', o);
  }
  const kinds = new Map(obstacles.list.filter(o => o.mesh).map(o => [o.mesh, o.kind]));
  const pools = new Set(Object.values(obstacles.puffs.pools).map(p => p.mesh));
  const flying = new Set(obstacles.debris.bodies.map(b => b.mesh));
  const LABELS = { rock: 'rocks', snowman: 'snowmen', pin: 'the bowling pins', photographer: 'the photographer' };
  for (const o of obstacles.group.children) {
    if (!o.visible) continue;
    const kind = kinds.get(o);
    add(kind ? LABELS[kind] ?? 'the office' : pools.has(o) ? 'snow puffs and bits' : flying.has(o) ? 'lost casters'
      : o.isInstancedMesh ? 'pines' : 'signs, banners and the lines on the snow', o);
  }
  const names = new Map([[scene.getObjectByName('chair'), 'Mnot on the chair']]);
  for (const o of scene.children) {
    if (o === piste || o === obstacles.group || !o.visible || o.isLight ||
      !(o.isMesh || o.isPoints || o.isLine || o.children.length)) continue;
    add(names.get(o) ?? (o.name || `a ${o.type}`), o);
  }
  return all;
}

// The finish party, past the line, for as long as the tab is open, with a burst of confetti every few seconds. On a
// narrow screen the card sits at the top, over half of it, so the picture slides down nearly half the screen to
// keep Mnot and the chair below it.
function dance(downhill) {
  const { ride, camera, obstacles } = downhill;
  const narrow = matchMedia('(max-width: 640px)');
  celebrate(downhill);
  confetti(obstacles.puffs, ride.pos);
  let last = 0, next = 3;
  const frame = t => {
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
    last = t;
    if (narrow.matches) camera.setViewOffset(camera.aspect, 1, 0, -0.45, camera.aspect, 1);
    else if (camera.view?.enabled) camera.clearViewOffset();
    if (dt > 0) {
      downhill.step(dt, dt);
      if ((next -= dt) <= 0) {
        confetti(obstacles.puffs, ride.pos, { count: 50 });
        next = 3 + 2 * Math.random();
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

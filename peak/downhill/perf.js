// The downhill's side of the perf probe (peak/kit/perf.js), for downhill.html?perf: main.js loads it instead of
// starting the game. The autopilot rides the whole run from the start, and the probe watches it stretch by stretch,
// each held still as the chair gets to it: the start, the crevasse, the ice, the moguls, the rollers, the river, the
// bowling lane, the ski jump, the office and the finish, where the autopilot lets go and the chair brakes to a stop
// for the party. Here are those stretches, what's in the downhill's scene and the thank-you card's words; under the
// card, Mnot's finish party plays on past the line, with confetti every few seconds.
import { FEATURES } from './track.js';
import { probe as measure } from '../kit/perf.js';
import { confetti } from '../kit/party.js';

// where each stretch starts, metres down the run
const STRETCHES = [['the start', FEATURES.pits[0]], ['the crevasse', FEATURES.kicker.from],
  ['the ice', FEATURES.ice.from], ['the moguls', FEATURES.moguls.from], ['the rollers', FEATURES.rollers[0].from],
  ['the river', FEATURES.river.from], ['the bowling lane', FEATURES.lane.from], ['the ski jump', FEATURES.pits[4]],
  ['the office', FEATURES.office.from], ['the finish', FEATURES.finish]];
const PARTY = 3;                // seconds of the party watched at the finish

export function probe(downhill) {
  const { ride, party } = downhill;
  let pilot = null;
  const spots = STRETCHES.map(([label, s], i) => ({ label, go: () => put(downhill, s),
    until: i < STRETCHES.length - 2 ? () => ride.s >= STRETCHES[i + 1][1]
      : i === STRETCHES.length - 2 ? () => ride.done
        : () => { pilot.on = false; return party.on && party.t > PARTY; } }));   // the finish: heels down, the party
  return measure(downhill, { name: 'Mnot Downhill', what: 'the ride down', long: 'about two minutes',
    board: 'downhill', spots, things: () => things(downhill), frame: dt => downhill.step(dt, dt),
    settle: () => { downhill.restart(); pilot = downhill.autopilot(true); downhill.step(1 / 60, 1 / 60); },
    card: {
      pictures: 'a soda can on a very expensive office chair', way: 'down', wobble: 'the chair on the moguls',
      play: 'Ride Mnot Downhill',
      jokes: [
        'Mnot rode the whole mountain down to time this. For science. Mostly for the ski jump.',
        '€1,649 of ergonomics, and your graphics card still did all the heavy lifting.',
        'Every pine on the mountain was drawn, every frame. No trees were harmed. A few chairs were.',
        'The office at the bottom wanted these numbers in a spreadsheet. Mnot sent JSON.',
        'Mnot drew the same stretch of piste thirty times in a row, to be sure. Not obsessive: statistics.',
      ],
      dance: () => dance(downhill), more: () => confetti(downhill.obstacles.puffs, ride.pos, { count: 50 }),
    } });
}

// Back at s, still, with fresh wheels and everything set up again round it, for the frame's parts.
function put(downhill, s) {
  const { ride } = downhill;
  downhill.autopilot(false);
  downhill.restart();
  ride.reset(s, { wheels: true });
  downhill.chase.snap(ride);
  downhill.step(1 / 120, 1 / 120);
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
  put(downhill, FEATURES.finish + 12);
  Object.assign(ride, { started: true, done: true });         // done: heels down (main.js intent()), then the party
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

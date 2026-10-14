// TEMPLATE for peak/<game>/perf.js: the game's side of the perf probe (peak/kit/perf.js), for mygame.html?perf;
// main.js loads it instead of starting the game. The probe puts Mnot at each spot in turn and watches a few seconds
// there, Mnot standing still; then, held still at the slowest, the frame's parts and what each thing in the scene
// costs. Pick a handful of spots, where the game is dearest to draw (the most in view, the effects): five or so keep
// the run to about a minute. Here are the spots, the things and the thank-you card's words; under the card, Mnot
// dances at the flag. The climb's peak/dev/perf.js and the downhill's peak/downhill/perf.js are the full examples.
import { probe as measure } from '../kit/perf.js';
import { confetti } from '../kit/party.js';

// where each spot is, metres towards the flag
const SPOTS = [['the start', 0], ['halfway', 7], ['the flag', 12]];

export function probe(game) {
  const spots = SPOTS.map(([label, z]) => ({ label, go: () => put(game, z) }));
  return measure(game, { name: 'My Game', what: 'the walk to the flag', long: 'about half a minute',
    board: 'mygame', spots, things: () => things(game), frame: dt => game.step(dt, dt),
    settle: () => game.restart(),
    card: {
      pictures: 'a soda can walking to a flag', way: 'to the flag', wobble: 'Mnot on the snow', play: 'Play My Game',
      jokes: ['Mnot walked to the same flag thirty times in a row, to be sure. Not obsessive: statistics.'],
      dance: () => dance(game), more: () => confetti(game.puffs, game.player.pos, { count: 50 }),
    } });
}

// Mnot standing at z.
function put(game, z) {
  game.restart();
  game.player.pos.set(0, 0, z);
  game.step(1 / 60, 1 / 60);
}

// What's in the scene, by thing: the scene's own children, by name.
function things({ scene, mnot }) {
  const all = new Map(), names = new Map([[mnot.root, 'Mnot']]);
  for (const o of scene.children) {
    if (!o.visible || o.isLight || !(o.isMesh || o.isPoints || o.isLine || o.children.length)) continue;
    const label = names.get(o) ?? (o.name || `a ${o.type}`);
    (all.get(label) ?? all.set(label, []).get(label)).push(o);
  }
  return all;
}

// Mnot dancing at the flag for as long as the tab is open, with a burst of confetti every few seconds.
function dance(game) {
  const { player, mnot, puffs } = game;
  put(game, 13);
  Object.assign(player, { done: true, yaw: Math.PI });      // round to the camera, as at the finish
  mnot.animator.play('Dance', 0.3);
  confetti(puffs, player.pos);
  let last = 0, next = 3;
  const frame = t => {
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
    last = t;
    if (dt > 0) {
      game.step(dt, dt);
      if ((next -= dt) <= 0) {
        confetti(puffs, player.pos, { count: 50 });
        next = 3 + 2 * Math.random();
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

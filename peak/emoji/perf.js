// Reaction Run's side of the perf probe (peak/kit/perf.js), for emoji.html?perf: main.js loads it instead of starting
// the game. As in the other games, the probe puts Mnot at a handful of spots and watches each a few seconds, Mnot
// standing still (main.js), on one field the same every run: the start, high over the field (the camera's peek, where
// the most is in view), the middle among the emojis, the list done (the others twisting away, the snow giving way,
// :peak-mnot: dropping in its beam) and the finish, where Mnot dances with it held up. Here are those spots, what's
// in the scene and the thank-you card's words; under the card, Mnot dances on, with confetti every few seconds.
import { probe as measure } from '../kit/perf.js';
import { confetti } from '../kit/party.js';

const SEED = 6;                // the field timed: one of the board's
const LOOK = 1.5;              // s the list done is let play before it's watched: the drop has landed by then

export function probe(emoji) {
  const spots = [['the start', start], ['over the field', peek], ['the middle', middle], ['the list done', listed],
    ['the finish', won]].map(([label, go]) => ({ label, go: () => go(emoji) }));
  return measure(emoji, { name: 'Reaction Run', what: 'the emoji field', board: 'emoji', spots,
    things: () => things(emoji), frame: dt => emoji.step(dt, dt), settle: () => emoji.deal(SEED),
    card: {
      pictures: 'a soda can in a field of emoji', way: 'round', wobble: 'Mnot after a bonk', play: 'Play Reaction Run',
      jokes: [
        'Mnot stood still in the same field five times to time this. Touching nothing: the whole point of the game.',
        'Every emoji in the field was drawn, every frame, both sides. Most of them were the wrong ones.',
        ':peak-mnot: dropped from the sky over and over, for science. It landed every time.',
        'The thread asked for these numbers in order. Mnot fetched them in order.',
        'Mnot read the same field thirty times in a row, to be sure. Not obsessive: statistics.',
      ],
      dance: () => dance(emoji), more: () => confetti(emoji.puffs, emoji.player.pos, { count: 50 }),
    } });
}

// The field as new, Mnot at its start, the camera over its shoulder.
function start(emoji) {
  emoji.restart();
  emoji.follow.intro = 0;
  emoji.step(1 / 60, 1 / 60);
}

// The camera high over the field, as when Space peeks.
function peek(emoji) {
  start(emoji);
  emoji.follow.intro = Infinity;
}

// Mnot in the middle, where :peak-mnot: drops, among the emojis.
function middle(emoji) {
  start(emoji);
  emoji.field.centre(...emoji.field.peak, emoji.player.pos);
  emoji.step(1 / 60, 1 / 60);
}

// From the start, the list done: the other emojis twist away, the snow gives way and :peak-mnot: drops into the
// middle in its beam, the camera up to watch and back down.
function listed(emoji) {
  start(emoji);
  emoji.player.next = emoji.field.order.length;
  emoji.toThePeak();
  emoji.step(LOOK, 1 / 60);
}

// Fetched: Mnot dancing in the middle, :peak-mnot: held up over its head, the camera round to the front.
function won(emoji) {
  listed(emoji);
  const { player, mnot, puffs } = emoji;
  emoji.field.centre(...emoji.field.peak, player.pos);
  player.done = true;
  mnot.animator.play('Dance', 0.3);
  confetti(puffs, player.pos);
  emoji.step(0.5, 1 / 60);
}

// What's in the scene, by thing: the field's floor and its snow walls apart, the rest of it together, and what hangs
// in the scene itself (Mnot, the emojis, the cracks, the stars, the sky, the clouds, the range), by name.
function things({ scene, mnot, field }) {
  const all = new Map(), names = new Map([[mnot.root, 'Mnot']]);
  const add = (label, o) => (all.get(label) ?? all.set(label, []).get(label)).push(o);
  for (const o of field.group.children) if (o.visible) add(o.name || 'the rest of the field', o);
  for (const o of scene.children) {
    if (o === field.group || !o.visible || o.isLight || !(o.isMesh || o.isPoints || o.isLine || o.children.length)) {
      continue;
    }
    add(names.get(o) ?? (o.name || `a ${o.type}`), o);
  }
  return all;
}

// Mnot dancing at the finish for as long as the tab is open, with a burst of confetti every few seconds. On a narrow
// screen the card sits at the top, over half of it, so the picture slides down below it and draws back (WIDE times
// as much in view), to keep both Mnot and :peak-mnot: over its head in sight.
const WIDE = 1.5;
function dance(emoji) {
  const { player, camera, puffs } = emoji;
  const narrow = matchMedia('(max-width: 640px)');
  won(emoji);
  let last = 0, next = 3;
  const frame = t => {
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
    last = t;
    const a = camera.aspect;
    if (narrow.matches) camera.setViewOffset(a, 1, -a * (WIDE - 1) / 2, -(WIDE - 1) / 2 - 0.42, a * WIDE, WIDE);
    else if (camera.view?.enabled) camera.clearViewOffset();
    if (dt > 0) {
      emoji.step(dt, dt);
      if ((next -= dt) <= 0) {
        confetti(puffs, player.pos, { count: 50 });
        next = 3 + 2 * Math.random();
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

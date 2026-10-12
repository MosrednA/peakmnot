// The jokes: a line for each mishap, shuffled so the same one doesn't come round again soon. Peak Mnot is the
// nerds digging too deep into a detail, so falling off the mountain is mostly that.
const LINES = {
  fall: ['Dug too deep.', 'Technically, that was a fall.', 'Gravity 1, Mnot 0.', "Let's call that research.",
    'A small detour. Downwards.', 'Too much detail.', 'Not peak. Pit.', 'Back to the drawing board.'],
  rock: ['Bonk!', 'Klonk!', 'Ow. Aluminium.', 'Rock 1, can 0.'],
  landing: ['Klonk!', 'Oof.', 'That left a mark.'],
  flat: ['Flattened!', 'Recycled!', 'Crushed it. Literally.'],
};
const bags = {};

export function quip(kind) {
  const bag = bags[kind] ??= [];
  if (!bag.length) {
    bag.push(...LINES[kind]);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop();
}

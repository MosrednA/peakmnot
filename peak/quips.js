// The jokes: a line for each mishap, shuffled so the same one doesn't come round again soon. Peak Mnot is the
// nerds digging too deep into a detail, so falling off the mountain is mostly that.
const LINES = {
  fall: ['Dug too deep.', 'Technically, that was a fall.', 'Gravity 1, Mnot 0.', "Let's call that research.",
    'A small detour. Downwards.', 'Too much detail.', 'Not peak. Pit.', 'Back to the drawing board.'],
  rock: ['Bonk!', 'Klonk!', 'Ow. Aluminium.', 'Rock 1, can 0.'],
  landing: ['Klonk!', 'Oof.', 'That left a mark.'],
  flat: ['Flattened!', 'Recycled!', 'Crushed it. Literally.'],
  // falls, by what caused them (player.js cause())
  crumble: ['Not load-bearing. Noted.', 'That ledge was still in beta.', 'Should have read the cracks.',
    'Loose rock. Looser plan.'],
  ice: ['Coefficient of friction: no.', 'Shift happens.', 'Ice to meet you.', 'A slippery slope argument.'],
  gust: ['Gone with the wind.', 'Venturi says hi.', 'Aerodynamics of a can: poor.', 'Should have read the windsock.'],
  gondola: ['Mind the gap.', 'The gondola waits for no can.', 'Timing: not a strength.', 'Missed the 4:15.'],
  // a pratfall on the ice (skate.js): no dent, just pride
  pratfall: ['Newton\'s first law, live.', 'Friction has left the chat.', 'Whoopsie-daisy.',
    'Nailed the landing. With the back.', 'Momentum: conserved.', 'Ice 1, Mnot 0.'],
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

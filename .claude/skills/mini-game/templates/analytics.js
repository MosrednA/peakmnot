// TEMPLATE for peak/<game>/analytics.js: replace "My Game" with the game's name as the dashboard shows it. Cookieless
// Plausible goals for real games, on the public site only (the kit's goals(), peak/kit/analytics.js): the title
// starts the game and the finish counts once a page; add the game's own moments (a checkpoint once, a mishap each
// time) the downhill's way (peak/downhill/analytics.js). Every goal is sent as "My Game: <goal>" and needs its
// Custom event goal in Plausible (SKILL.md, "Stats"). No names, player ids, times or scores.
import { goals } from '../kit/analytics.js';

/**
 * @param {{ title: { on: (name: 'start', fn: () => void) => void }, manual: boolean }} sources
 * @returns {{ finish: () => void }}  what the game calls when it happens
 */
export function hookAnalytics({ title, manual }) {
  const track = goals('My Game', { manual });
  if (!track) return { finish() {} };
  let started = false, finished = false;
  title.on('start', () => {
    if (started) return;
    started = true;
    track('Start');
  });
  return {
    finish() {
      if (!started || finished) return;
      finished = true;
      track('Finish');
    },
  };
}

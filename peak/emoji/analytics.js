// Cookieless Plausible goals for real runs, on the public site only (the kit's goals(), peak/kit/analytics.js): the
// title starts the game, the list done and the finish count once a page, and each mishap counts when it happens in a
// run (a wrong one touched, the third one out, a drop into a hole). Every goal starts with "Reaction Run: ", so the
// game's goals stay together in the dashboard (peak/README.md, "Analytics"). No names, player ids, times or scores.
// Local development, ?manual bots and a watched run stay out of the stats; a blocked tracker never interrupts a run.
import { goals } from '../kit/analytics.js';

/**
 * @param {{ title: { on: (name: 'start', fn: () => void) => void }, manual: boolean }} sources
 *   manual: a ?manual page or a watched run, which send nothing
 * @returns {{ run: () => void, listed: () => void, wrong: () => void, out: () => void, hole: () => void,
 *   finish: () => void }}  what main.js calls when it happens: run() as a run starts (after the title, R, N or
 *   the card's again), listed() as the list is done, wrong() for every try lost, out() for the third, hole() as
 *   Mnot drops into one, finish() at :peak-mnot:
 */
export function hookAnalytics({ title, manual }) {
  const track = goals('Reaction Run', { manual });
  const none = () => {};
  if (!track) return { run: none, listed: none, wrong: none, out: none, hole: none, finish: none };
  let started = false, running = false, listed = false, finished = false;

  title.on('start', () => {
    if (started) return;
    started = true;
    track('Start');
  });
  return {
    run() { running = started; },
    listed() {
      if (!running || listed) return;
      listed = true;
      track('List Done');
    },
    wrong() { if (running) track('Wrong One'); },
    out() {
      if (!running) return;
      running = false;
      track('Out');
    },
    hole() { if (running) track('Hole'); },
    finish() {
      if (!running) return;
      running = false;
      if (!finished) track('Finish');
      finished = true;
    },
  };
}

// Cookieless Plausible goals for real visits to the arena, on the public site only (the kit's goals(),
// peak/kit/analytics.js): the moments of a visit, each counted once a page: joining the plaza with a can, a first
// chat line, a first hard bump (into a can or the snow wall), a wave, a dance, and meeting someone (another person on
// the plaza, not a bot). Every goal starts with "Arena: ", so the arena's goals stay together in the dashboard
// (peak/README.md, "Analytics"). No names, player ids, chat or times. Local development and ?manual stay out of the
// stats; a blocked tracker never interrupts the plaza.
import { goals } from '../kit/analytics.js';

export const GOALS = ['Join', 'Chat', 'Bump', 'Wave', 'Dance', 'Not Alone'];

/**
 * @param {{ manual: boolean }} sources
 * @returns {(goal: string) => void}  what the page calls when a moment happens; each goal counts once a page
 */
export function hookAnalytics({ manual }) {
  const track = goals('Arena', { manual });
  const sent = new Set();
  return goal => {
    if (!track || sent.has(goal) || !GOALS.includes(goal)) return;
    sent.add(goal);
    track(goal);
  };
}

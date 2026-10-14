// Cookieless Plausible goals, the same way in every mini game (peak/README.md, "Analytics"). goals('Downhill') gives
// a send(name) that counts "Downhill: <name>", so each game's goals stay together in the dashboard. It counts on the
// public site only: on localhost, staging and ?manual (the bots and tests) it is null, so a game doesn't even listen
// there. The tracker itself is in the page's head; a missing or blocked one never interrupts the game. Only the
// goal's name is sent: no names, player ids, times or scores.

export const LIVE = 'peakmnot.mosredna.eu';

/** @typedef {(name: string) => void} Plausible */

/**
 * @param {string} game  the goals' prefix as the dashboard shows it: 'Downhill', 'Games', …
 * @param {{ manual?: boolean }} [options]  manual: a ?manual page, which sends nothing
 * @returns {((name: string) => void) | null}  null off the public site
 */
export function goals(game, { manual = false } = {}) {
  if (manual || location.hostname !== LIVE) return null;
  const tracker = /** @type {Window & { plausible?: Plausible }} */ (window);
  return name => {
    try { tracker.plausible?.(`${game}: ${name}`); } catch { /* analytics is optional */ }
  };
}

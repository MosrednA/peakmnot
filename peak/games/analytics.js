// Cookieless Plausible goals for the page of all the games (games.html, at /games), on the public site only, the
// games' way (peak/downhill/analytics.js): which game a visitor goes to play, and the viewer. Each link names its goal
// in data-goal, and every goal starts with "Games: ", so the page's goals stay together in the dashboard
// (peak/README.md, "Analytics"). The tracker sends with keepalive, so the event survives the page going. Local
// development stays out of the stats; a blocked tracker never stops the link.

/** @typedef {(name: string) => void} Plausible */

/** @param {{ addEventListener: (type: string, fn: (event: MouseEvent) => void) => void }} page  the document */
export function hookAnalytics(page) {
  if (location.hostname !== 'peakmnot.mosredna.eu') return;
  const tracker = /** @type {Window & { plausible?: Plausible }} */ (window);
  /** @param {MouseEvent} event */
  const follow = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;     // the middle button opens a tab: that counts too
    const link = /** @type {HTMLElement | null} */ (event.target)?.closest?.('a[data-goal]');
    if (!link) return;
    try { tracker.plausible?.(`Games: ${link.dataset.goal}`); } catch { /* analytics is optional */ }
  };
  page.addEventListener('click', follow);
  page.addEventListener('auxclick', follow);
}

// Cookieless Plausible goals for real climbs, on the public site only. The title starts a climb; checkpoints and
// the summit count once, and each loss counts when it happens (never again at respawn). No names or player ids.
// Local development and ?manual bots stay out of the stats; a blocked tracker never interrupts the game.

/**
 * @template Events
 * @typedef {{ on: <Name extends keyof Events>(name: Name, fn: (data: Events[Name]) => void) => void }} EventSource
 */
/** @typedef {(name: string) => void} Plausible */

/**
 * @param {{
 *   title: EventSource<{ start: { how: string } }>,
 *   game: EventSource<{ checkpoint: { index: number }, summit: void }>,
 *   player: EventSource<{ lost: { reason: string } }>,
 *   manual: boolean
 * }} sources
 */
export function hookAnalytics({ title, game, player, manual }) {
  if (manual || location.hostname !== 'peakmnot.mosredna.eu') return;
  const tracker = /** @type {Window & { plausible?: Plausible }} */ (window);
  let started = false, finished = false;
  /** @type {Set<number>} */
  const reached = new Set();
  /** @param {string} name */
  const track = name => {
    try { tracker.plausible?.(name); } catch { /* analytics is optional */ }
  };

  title.on('start', () => {
    if (started) return;
    started = true;
    track('Start Climb');
  });
  game.on('checkpoint', ({ index }) => {
    if (!started || finished || ![1, 2, 3].includes(index) || reached.has(index)) return;
    reached.add(index);
    track(`Checkpoint ${index} Reached`);
  });
  game.on('summit', () => {
    if (!started || finished) return;
    finished = true;
    track('Summit Reached');
  });
  player.on('lost', ({ reason }) => {
    if (!started || finished) return;
    if (reason === 'fall') track('Fall');
    else if (reason === 'flat') track('Flattened');
  });
}

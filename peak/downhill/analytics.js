// Cookieless Plausible goals for real rides, on the public site only, the climb's way (peak/analytics.js): the title
// starts the game, each pit stop and the finish count once a page, and each mishap counts when it happens in a run.
// Every goal starts with "Downhill: ", so each game's goals stay together in the dashboard (peak/README.md,
// "Analytics"). No names, player ids, times or scores. Local development and ?manual bots stay out of the stats; a
// blocked tracker never interrupts the ride.

/** @typedef {(name: string) => void} Plausible */

/**
 * @param {{
 *   title: { on: (name: 'start', fn: () => void) => void },
 *   ride: { on: (name: string, fn: (data: any) => void) => void },
 *   pits: number[],
 *   manual: boolean
 * }} sources  pits: FEATURES.pits (track.js), the start and then the pit stops, in metres
 */
export function hookAnalytics({ title, ride, pits, manual }) {
  if (manual || location.hostname !== 'peakmnot.mosredna.eu') return;
  const tracker = /** @type {Window & { plausible?: Plausible }} */ (window);
  let started = false, racing = false, finished = false;
  /** @type {Set<number>} */
  const reached = new Set();
  /** @param {string} name */
  const track = name => {
    try { tracker.plausible?.(`Downhill: ${name}`); } catch { /* analytics is optional */ }
  };

  title.on('start', () => {
    if (started) return;
    started = true;
    track('Start');
  });
  ride.on('start', () => { racing = started; });            // through the gate: a run is on, again after R
  ride.on('pit', ({ s }) => {
    const index = pits.indexOf(s);
    if (!racing || index < 1 || reached.has(index)) return;
    reached.add(index);
    track(`Pit Stop ${index}`);
  });
  ride.on('finish', () => {
    if (!racing) return;
    racing = false;
    if (!finished) track('Finish');
    finished = true;
  });
  ride.on('wrecked', () => { if (racing) track('Wrecked'); });
  ride.on('lost', ({ water }) => { if (racing) track(water ? 'Splash' : 'Off-Piste'); });
}

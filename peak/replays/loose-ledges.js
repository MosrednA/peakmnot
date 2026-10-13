// Rebuild loose-ledge contacts from v1's recorded grounded support indices. No new replay fields are needed.
const GROUND = 0;

// Recorded support rows arrive about every 100 ms and on state changes. Each eligible row can represent a touch;
// ignore further rows until the ledge's drop, wait and regrow cycle has completed.
export function looseLedgeContacts(samples, support, { delay, gone, back } = {}) {
  if (!Array.isArray(samples) || !Number.isInteger(support) || support < 0) return [];
  const cycle = (delay ?? 0.85) + (gone ?? 3.2) + (back ?? 0.35);
  const contacts = [];
  let readyAt = -Infinity;
  for (const sample of samples) {
    if (sample[7] !== GROUND || sample[9] !== support) continue;
    const at = sample[0] / 1000;
    if (at < readyAt - 1e-9) continue;
    contacts.push(at);
    readyAt = at + cycle;
  }
  return contacts;
}

// Map each route ledge to its deterministic contact times for this watched replay.
export function replayLooseLedges(replay, world) {
  const timelines = new Map();
  for (const ledge of world.animated ?? []) {
    if (!ledge.solid?.loose || !ledge.replayTiming || typeof ledge.seekReplay !== 'function') continue;
    const support = world.solids.indexOf(ledge.solid);
    if (support < 0) continue;
    timelines.set(ledge, looseLedgeContacts(replay.samples, support, ledge.replayTiming));
  }
  return timelines;
}

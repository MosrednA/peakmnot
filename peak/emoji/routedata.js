// Reaction Run as plain data, for the score server (server/emoji.json, checked by server/emoji.py): the field's
// geometry, the deal, the rules a run keeps to (main.js's own: how Mnot gets about, the tries, the holes, the
// finale), and the board's fields: every seed up to the pool's end that a random deal can give (main.js,
// counts()), each as its walls, emoji, cracks and the passages giving way at the end. The server checks every run
// against its field, so this must match the game: routeFingerprint() hashes all of it but the board's fields
// themselves, for which it takes the first fields the band is set by (dealt as they are, so a change to the deal
// changes them), the client sends that hash when a run starts, and the server says "route changed" if its copy is
// stale. To refresh server/emoji.json after changing the field, the deal or the rules, run
// `python -X utf8 server/export_route.py emoji` and paste the line it prints into the console of emoji.html?manual
// (it takes a few seconds: every board field is dealt afresh; server/README.md, "Reaction Run").
import { CELL, WALL } from './field.js';
import { TOUCH, WARP, PRIZE } from './stickers.js';
import { CRACK, QUAKE } from './cracks.js';

// board (main.js): rules, the numbers; plan(seed), a field planned without its looks; names, the sticker sheet's
// dealt; rated(), the first fields, which set the band; band(), what they rate, low and high; counts(seed, field):
// whether a seed's field (planned) is one of the board's.
export function emojiRoute(board) {
  const { rules } = board, first = board.rated()[0];
  return {
    v: 1,
    game: 'emoji',
    field: { cols: first.cols, rows: first.rows, cell: CELL, wall: WALL.t, start: first.start, peak: first.peak },
    deal: rules.deal,
    names: board.names,
    board: { pool: rules.pool, rated: rules.rated, band: rules.band, rates: board.band(), cracked: rules.cracked,
      given: rules.given },
    mnot: { body: rules.body, run: rules.run, bonk: rules.bonk, lives: rules.lives, hit: rules.hit, pit: rules.pit },
    touch: TOUCH,
    warp: WARP,
    prize: { touch: PRIZE.touch, fall: PRIZE.fall },
    finale: rules.finale,
    crack: { ...CRACK, wide: CELL },
    quake: QUAKE,
    sample: board.rated().map(f => f.layout()),
  };
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function routeFingerprint(board) {
  return sha256(JSON.stringify(emojiRoute(board)));
}

// server/emoji.json: the route, the board's fields by seed and the fingerprint. emoji: the page's (window.emoji).
export async function exportRoute(emoji) {
  const { board } = emoji, route = emojiRoute(board), fields = {};
  for (let seed = 1; seed <= board.rules.pool; seed++) {
    const field = board.plan(seed);
    if (board.counts(seed, field)) fields[seed] = field.layout();
  }
  return { ...route, fields, fingerprint: await sha256(JSON.stringify(route)) };
}

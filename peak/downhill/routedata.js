// The downhill as plain data, for the score server (server/downhill.json, checked by server/downhill.py): the piste's
// centreline and cross-section, the river's floes, everything hard to hit, the bowling pins, the ski jump's lip, the
// bonus table and the ride's numbers. The server checks every run against it, so it must match the game:
// routeFingerprint() hashes it, the client sends that hash when a run starts, and the server says "route changed" if
// its copy is stale. To refresh server/downhill.json after changing the piste, the obstacles or the physics, run
// `python -X utf8 server/export_route.py downhill` and paste the line it prints into the console of
// downhill.html?manual (server/README.md, "The downhill").
import { STEP, PISTE, BANK, BANK_HEIGHT, POWDER, EDGE, FEATURES, RIVER, FLOES } from './track.js';
import { G, FEEL, BODY } from './ride.js';
import { CHAIR } from './chair.js';
import { PINE_TIERS, TRUNK } from './obstacles.js';
import { KNOCKOFF } from './office.js';
import { SETTLE } from './bowling.js';
import { BONUS } from './bonus.js';

const round = places => v => Math.round(v * 10 ** places) / 10 ** places;
const r4 = round(4), r6 = round(6);

export function downhillRoute({ track, obstacles }) {
  const lip = track.point(FEATURES.jump.lip, 0);
  return {
    v: 1,
    game: 'downhill',
    g: G,
    feel: { roll: FEEL.roll, steer: FEEL.steer, drag: FEEL.drag, tuck: FEEL.tuck, push: FEEL.push,
      pushTop: FEEL.pushTop, jump: FEEL.jump, stick: FEEL.stick, wall: FEEL.wall, bounce: FEEL.bounce,
      hard: FEEL.hard, restitution: FEEL.restitution, crash: FEEL.crash },
    chair: { radius: CHAIR.radius, legs: CHAIR.legs, body: BODY },
    piste: { step: STEP, piste: PISTE, bank: BANK, bankHeight: BANK_HEIGHT, powder: POWDER, edge: EDGE },
    features: FEATURES,
    river: RIVER,
    floes: FLOES,
    // the centreline, every STEP metres: the point, the way down, the segment's length across the map, the banking
    line: { px: [...track.px].map(r4), py: [...track.py].map(r4), pz: [...track.pz].map(r4),
      tx: [...track.tx].map(r6), tz: [...track.tz].map(r6), hs: [...track.hs].map(r6), tilt: [...track.tilt].map(r6) },
    lip: [r4(lip.x), r4(lip.y), r4(lip.z)],
    // [kind, x, y, z, r, top] and, for a pine, its size and height (pineReach)
    hard: obstacles.list.filter(o => !o.soft).map(o => [o.kind, r4(o.x), r4(o.y), r4(o.z), r4(o.r), r4(o.top),
      ...(o.kind === 'tree' ? [r4(o.size), r4(o.tall)] : [])]),
    pine: { tiers: PINE_TIERS, trunk: TRUNK },
    pins: { feet: obstacles.pins.list.map(p => [r4(p.foot.x), r4(p.foot.y), r4(p.foot.z)]), radius: KNOCKOFF.radius,
      settle: SETTLE },
    bonus: BONUS,
  };
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function routeFingerprint(downhill) {
  return sha256(JSON.stringify(downhillRoute(downhill)));
}

// server/downhill.json: the route and its fingerprint.
export async function exportRoute(downhill) {
  const route = downhillRoute(downhill);
  return { ...route, fingerprint: await sha256(JSON.stringify(route)) };
}

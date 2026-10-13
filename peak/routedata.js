// The route as plain data, for the score server (server/route.json): the solids, beams, checkpoints, the summit,
// the camera rail (it follows the walking line), the wind gaps, the gondolas' timetables and the rig's numbers. The
// server checks every replay against it, so it must match the game: routeFingerprint() hashes the parts that don't
// move, the client sends that hash when a run starts, and the server says "route changed" if its copy is stale.
// To refresh server/route.json after changing route.js or the rig, run `python -X utf8 server/export_route.py`
// and paste the line it prints into the console of peak.html?manual (server/README.md, "The route").
import { FEEL } from './balance.js';
import { MAX_DENTS } from './game.js';
import * as skate from './skate.js';

const r3 = v => Math.round(v * 1000) / 1000;
const point = p => [r3(p.x), r3(p.y), r3(p.z)];

// Everything the server needs that stays put. Call it before the first step: the gondola's pallet is then at its
// first stop, as it is in exportRoute's fresh page.
export function staticRoute({ world, player }) {
  const rig = player.rig;
  return {
    v: 1,
    rig: { walk: r3(rig.walk_speed), run: r3(rig.run_speed), gravity: r3(rig.jump_gravity), jump: r3(rig.jump_height),
      runJump: r3(rig.run_jump_height), hard: r3(rig.hard_landing_speed) },
    beamSpeed: r3(FEEL.speed),
    slideMax: r3(skate.SLIDE_MAX ?? 3.2),       // the fastest slide on ice (skate.js)
    maxDents: MAX_DENTS,
    solids: world.solids.map(s => ({ poly: s.poly.map(p => [r3(p.x), r3(p.z)]), top: r3(s.top), kind: s.kind,
      loose: !!s.loose, moving: !!s.moving })),
    ice: world.ice.map(i => ({ poly: i.outline.poly.map(p => [r3(p.x), r3(p.z)]), y: r3(i.y),
      reach: r3(i.reach ?? 0) })),             // how far past the outline it's still ice
    beams: world.beams.map(b => ({ kind: b.kind, a: point(b.a), b: point(b.b), sag: r3(b.sag), dip: r3(b.dip) })),
    checkpoints: world.checkpoints.map(c => ({ index: c.index, at: point(c.at), respawn: point(c.respawn),
      radius: r3(c.radius) })),
    summit: { at: point(world.summit.at), radius: r3(world.summit.radius) },
    rail: world.rail.map(r => point(r.at)),
    gusts: world.zones.filter(z => z.kind === 'gust').map(z => ({ x: r3(z.x), z: r3(z.z), y: r3(z.y ?? 0),
      radius: r3(z.radius), strength: r3(z.strength) })),
  };
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// The hash of staticRoute: the snapshot is taken now, the hash comes later.
export function routeFingerprint(peak) {
  return sha256(JSON.stringify(staticRoute(peak)));
}

// Each gondola's timetable: where its pallet is (centre x, top y, centre z) every `step` seconds of game time over
// one cycle, probed by winding its clock forward and back. Only for the export: it moves the gondolas about.
export function moverTables(world, { step = 0.02, scan = 0.01 } = {}) {
  return world.animated.filter(m => m.kind === 'gondola' && m.solid).map((mover) => {
    const solid = mover.solid;
    const where = () => [solid.center.x, solid.top, solid.center.y];
    const probe = (t) => { mover.update(t); const at = where(); mover.update(-t); return at; };
    const base = where();
    const offsets = solid.poly.map(p => [r3(p.x - base[0]), r3(p.z - base[2])]);
    const seen = Array.from({ length: 6001 }, (_, i) => probe(i * scan));
    let period = null;
    for (let k = 50; k <= 3000 && period === null; k++) {
      let same = true;
      for (let i = 0; i + k < seen.length && i < 3000 && same; i += 2) {
        const a = seen[i], b = seen[i + k];
        same = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-4;
      }
      if (same) period = k * scan;
    }
    if (period === null) throw new Error('gondola timetable does not repeat within 30 s');
    const points = [];
    for (let i = 0; i * step < period - 1e-9; i++) points.push(probe(i * step).map(r3));
    return { solid: world.solids.indexOf(solid), offsets, period: r3(period), step, points };
  });
}

// server/route.json: the static route, its fingerprint, and the gondolas' timetables. Run it on a fresh
// peak.html?manual page, before any step.
export async function exportRoute(peak) {
  const route = staticRoute(peak);
  const fingerprint = await sha256(JSON.stringify(route));
  return { ...route, fingerprint, movers: moverTables(peak.world) };
}

// The room's rules, shared word for word by the page (main.js, which runs its own can ahead of the server) and the
// server (arena/room.mjs, which decides): cans on a round snowy plaza that walk, jump, wave and dance, and bump off
// each other, the snow wall round the edge and the snowmen on it. Plain numbers only, no three.js, so Node runs it as
// it is. A step is TICK seconds; every can steps with the input its player sent for that step (protocol.js).

export const TICK = 1 / 30;
export const MAX_PLAYERS = 12;
export const PLAZA = { radius: 11 };            // m: the inside of the snow wall round the plaza
export const BODY = 0.38;                       // m: a can's round, against the wall, the snowmen and other cans
// m/s, and how fast the speed follows the stick (1/s): on the snow, in the air, and reeling from a bump
export const MOVE = { run: 3.2, grip: 12, air: 2.5, turn: 12 };
// Mnot's own jump (the rig's jump_height and jump_gravity, mnot.js RIG_DEFAULTS)
export const JUMP = { gravity: 15, speed: Math.sqrt(2 * 15 * 0.6) };
// Two cans meeting: they spring apart a little harder than they came together (a can full of fizz), and from
// `hard` m/s closing speed both reel: `daze` s of slippery snow and wobbly steering, with a little hop.
export const BUMP = { bounce: 1.3, hard: 1.8, daze: 0.9, hop: 2.2, control: 0.25, grip: 1.6 };
export const WALL = { bounce: 0.5, hard: 2.6, daze: 0.45 };
export const EMOTE = { none: 0, wave: 1, dance: 2 };
const WAVE_TIME = 2.2;                          // s: one wave (the Wave clip twice round)
// the snowmen on the plaza: where, and their round at can height
export const SNOWMEN = [{ x: -4.6, z: 3.2, r: 0.55 }, { x: 5.2, z: 4.4, r: 0.55 }, { x: 0.4, z: -6.1, r: 0.55 }];
export const IDLE = Object.freeze({ x: 0, z: 0, jump: false, emote: 0 });

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// A new can, standing on the ring at its slot (0 to MAX_PLAYERS - 1), facing the middle.
export function spawn(slot) {
  const a = (slot / MAX_PLAYERS) * Math.PI * 2;
  const x = Math.sin(a) * 6.5, z = Math.cos(a) * 6.5;
  return { x, z, y: 0, vx: 0, vz: 0, vy: 0, yaw: Math.atan2(-x, -z), ground: true, daze: 0, emote: 0, emoteT: 0,
    bumps: 0 };
}

export const copy = can => ({ ...can });

// One step of one can, with its player's input: { x, z } the stick on the snow (length up to 1), jump and emote (0,
// wave or dance) pressed this step.
export function stepCan(c, input = IDLE, dt = TICK) {
  let mx = input.x, mz = input.z;
  const m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; }
  const reeling = c.daze > 0;
  // reeling, the stick barely steers and the snow barely holds, so a bump slides it on
  const speed = MOVE.run * (reeling ? BUMP.control : 1);
  const grip = !c.ground ? MOVE.air : reeling ? BUMP.grip : MOVE.grip;
  const k = 1 - Math.exp(-grip * dt);
  c.vx += (mx * speed - c.vx) * k;
  c.vz += (mz * speed - c.vz) * k;
  if (m > 0.1 && !reeling) c.yaw = wrap(c.yaw + wrap(Math.atan2(mx, mz) - c.yaw) * (1 - Math.exp(-MOVE.turn * dt)));
  if (input.jump && c.ground) {
    c.vy = JUMP.speed;
    c.ground = false;
  }
  // a wave plays once, a dance until it walks off; walking or jumping stops either
  if (input.emote && c.ground && !reeling) {
    c.emote = input.emote;
    c.emoteT = input.emote === EMOTE.wave ? WAVE_TIME : 0;
  }
  if (m > 0.2 || !c.ground || reeling) c.emote = 0;
  if (c.emote === EMOTE.wave && (c.emoteT -= dt) <= 0) c.emote = 0;
  if (!c.emote) c.emoteT = 0;
  if (!c.ground) {
    c.vy -= JUMP.gravity * dt;
    c.y += c.vy * dt;
    if (c.y <= 0) { c.y = 0; c.vy = 0; c.ground = true; }
  }
  c.x += c.vx * dt;
  c.z += c.vz * dt;
  c.daze = Math.max(0, c.daze - dt);
  keepIn(c);
}

// Off something that doesn't move (the wall, a snowman) along its normal n, pointing at the can.
function bounceOff(c, nx, nz) {
  const vn = c.vx * nx + c.vz * nz;
  if (vn >= 0) return;
  c.vx -= (1 + WALL.bounce) * vn * nx;
  c.vz -= (1 + WALL.bounce) * vn * nz;
  if (-vn > WALL.hard) {
    c.daze = Math.max(c.daze, WALL.daze);
    c.bumps = (c.bumps + 1) & 255;
  }
}

// Inside the snow wall, and out of the snowmen.
export function keepIn(c) {
  const r = Math.hypot(c.x, c.z), most = PLAZA.radius - BODY;
  if (r > most) {
    c.x *= most / r;
    c.z *= most / r;
    bounceOff(c, -c.x / most, -c.z / most);
  }
  for (const s of SNOWMEN) {
    const dx = c.x - s.x, dz = c.z - s.z, d = Math.hypot(dx, dz), least = s.r + BODY;
    if (d >= least) continue;
    const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
    c.x = s.x + nx * least;
    c.z = s.z + nz * least;
    bounceOff(c, nx, nz);
  }
}

// Every two cans that touch spring apart. With `only`, only that can moves (the page, running its own can ahead of
// the server against where the others were last seen); otherwise both do, half each. Returns the hard bumps, as
// [a, b, closing speed], for the tests.
export function collide(cans, only = null) {
  const hard = [];
  for (let i = 0; i < cans.length; i++) {
    for (let j = i + 1; j < cans.length; j++) {
      const a = cans[i], b = cans[j];
      if (only && a !== only && b !== only) continue;
      let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= BODY * 2) continue;
      if (d < 1e-6) { dx = 1; dz = 0; d = 1; }      // right on top of each other: apart along x
      const nx = dx / d, nz = dz / d, push = BODY * 2 - Math.min(d, BODY * 2);
      const sa = only ? (a === only ? 1 : 0) : 0.5, sb = only ? (b === only ? 1 : 0) : 0.5;
      a.x -= nx * push * sa; a.z -= nz * push * sa;
      b.x += nx * push * sb; b.z += nz * push * sb;
      const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (closing <= 0) continue;
      const kick = (1 + BUMP.bounce) * closing / 2;
      if (!only || a === only) { a.vx -= nx * kick; a.vz -= nz * kick; }
      if (!only || b === only) { b.vx += nx * kick; b.vz += nz * kick; }
      if (closing < BUMP.hard) continue;
      for (const c of [a, b]) {
        if (only && c !== only) continue;
        c.daze = BUMP.daze;
        c.emote = 0;
        c.bumps = (c.bumps + 1) & 255;
        if (c.ground) { c.vy = BUMP.hop; c.ground = false; }
      }
      hard.push([a, b, closing]);
    }
  }
  return hard;
}

// One step of the whole room (the server): every can steps once for each input its player sent for it (inputs: a
// Map of id to a list; none, and it holds where it is until its next one comes in), then the bumps, then the wall
// again for any can a bump pushed into it. So a can makes exactly the steps its page made, and the page that ran it
// ahead (main.js) lands where the server does.
export function stepRoom(cans, inputs) {
  for (const c of cans) for (const input of inputs.get(c.id) ?? []) stepCan(c, input);
  const hard = collide(cans);
  for (const c of cans) keepIn(c);
  return hard;
}

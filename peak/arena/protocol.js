// What goes over the WebSocket between the page and the server (arena/server.mjs), shared by both. The two that go
// thirty times a second are binary and small: the page's input for a step, and the server's snapshot of every can.
// Everything else (joining, chat, who's here) is JSON text: { t: 'join', name }, { t: 'chat', text } and so on.

export const KIND = { snapshot: 1, input: 2 };
export const PATH = '/arena/ws';

// The input for one step: its number (seq, counting up and round from 65535 to 0), the stick on the snow and the
// presses. 6 bytes.
const INPUT_SIZE = 6;
export function encodeInput({ seq, x, z, jump, emote }) {
  const v = new DataView(new ArrayBuffer(INPUT_SIZE));
  v.setUint8(0, KIND.input);
  v.setUint16(1, seq & 0xffff);
  v.setInt8(3, Math.round(Math.max(-1, Math.min(1, x)) * 127));
  v.setInt8(4, Math.round(Math.max(-1, Math.min(1, z)) * 127));
  v.setUint8(5, (jump ? 1 : 0) | ((emote & 3) << 1));
  return v.buffer;
}
export function decodeInput(data) {
  const v = view(data);
  if (!v || v.byteLength !== INPUT_SIZE || v.getUint8(0) !== KIND.input) return null;
  const b = v.getUint8(5);
  return { seq: v.getUint16(1), x: v.getInt8(3) / 127, z: v.getInt8(4) / 127, jump: !!(b & 1), emote: (b >> 1) & 3 };
}
// The input as the server will read it, so the page runs its own can on exactly that.
export const asSent = input => decodeInput(encodeInput(input));

// Is seq a after b, counting round?
export const after = (a, b) => a !== b && ((a - b) & 0xffff) < 0x8000;

// A snapshot: the server's step number, and every can: its id, where it is and how it moves (mm, mm/s), where it
// faces, on the snow or not, its emote and reeling time, how many hard bumps it took (counting round), and the last
// input of its player the server used (ack). 4 + 21 bytes a can.
const HEAD = 4, CAN = 21;
const mm = v => Math.max(-32767, Math.min(32767, Math.round(v * 1000)));
export function encodeSnapshot(tick, players) {
  const v = new DataView(new ArrayBuffer(HEAD + CAN * players.length));
  v.setUint8(0, KIND.snapshot);
  v.setUint16(1, tick & 0xffff);
  v.setUint8(3, players.length);
  players.forEach(({ id, can: c, ack }, i) => {
    const o = HEAD + i * CAN;
    v.setUint8(o, id);
    v.setUint8(o + 1, (c.ground ? 1 : 0) | ((c.emote & 3) << 1));
    v.setInt16(o + 2, mm(c.x));
    v.setInt16(o + 4, mm(c.z));
    v.setInt16(o + 6, mm(c.y));
    v.setInt16(o + 8, mm(c.vx));
    v.setInt16(o + 10, mm(c.vz));
    v.setInt16(o + 12, mm(c.vy));
    v.setInt16(o + 14, Math.round(c.yaw * 10000));
    v.setUint8(o + 16, Math.min(255, Math.round(c.daze * 100)));
    v.setUint8(o + 17, Math.min(255, Math.ceil(c.emoteT * 20)));
    v.setUint8(o + 18, c.bumps & 255);
    v.setUint16(o + 19, ack & 0xffff);
  });
  return v.buffer;
}
export function decodeSnapshot(data) {
  const v = view(data);
  if (!v || v.byteLength < HEAD || v.getUint8(0) !== KIND.snapshot) return null;
  const count = v.getUint8(3);
  if (v.byteLength !== HEAD + CAN * count) return null;
  const players = [];
  for (let i = 0; i < count; i++) {
    const o = HEAD + i * CAN, f = v.getUint8(o + 1);
    players.push({ id: v.getUint8(o), ack: v.getUint16(o + 19), can: {
      x: v.getInt16(o + 2) / 1000, z: v.getInt16(o + 4) / 1000, y: v.getInt16(o + 6) / 1000,
      vx: v.getInt16(o + 8) / 1000, vz: v.getInt16(o + 10) / 1000, vy: v.getInt16(o + 12) / 1000,
      yaw: v.getInt16(o + 14) / 10000, ground: !!(f & 1), emote: (f >> 1) & 3, daze: v.getUint8(o + 16) / 100,
      emoteT: v.getUint8(o + 17) / 20, bumps: v.getUint8(o + 18) } });
  }
  return { tick: v.getUint16(1), players };
}

// The kind of a binary message, or 0.
export function kindOf(data) {
  const v = view(data);
  return v && v.byteLength ? v.getUint8(0) : 0;
}

// A DataView over whatever the socket gave (an ArrayBuffer in the browser, a Buffer in Node), or null.
function view(data) {
  if (data instanceof ArrayBuffer) return new DataView(data);
  if (ArrayBuffer.isView(data)) return new DataView(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

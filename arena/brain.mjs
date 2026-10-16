// What a bot does, a can that isn't a person: it wanders the plaza, and now and then runs at someone to bump them,
// jumps, waves, dances or says something. The room's own bots (room.mjs, so nobody is alone on the plaza) and the
// test bots that come in over the line (bots.mjs) both think with it.
import { TICK, PLAZA, EMOTE } from '../peak/arena/sim.js';

export const NAMES = ['Fizz', 'Bubbles', 'Tab', 'Dent', 'Zero Sugar', 'Cola', 'Seltzer', 'Ginger', 'Tonic', 'Lime',
  'Root Beer', 'Spritz'];
export const LINES = ['hoi!', 'who bumped me', 'nice glasses', 'is this the queue for the summit?', 'brb, recycling',
  'fizz fizz', 'anyone seen the gondola?', 'bump gently, said the sign', 'zero sugar, all attitude', 'can confirm',
  "there are 10 kinds of cans: those who read binary and those who don't",
  'the plaza is 11 m across. radius! I meant radius', 'running at 30 ticks a second, feeling great',
  'sorry, I was buffering', 'my jitter buffer is bigger than yours', 'I live 3 ticks in the past and I like it here',
  'is this server authoritative or just confident?', 'it works on my machine', 'technically we are all aluminium',
  'my favourite number is 0x14A (330, like me)', 'every can is a cylinder if you squint',
  'the snowmen wear glasses too. respect', 'my glasses fog up at this altitude',
  'I paid 1649 euros for an office chair and now I live on a mountain', 'checkpoint reached (emotionally)',
  'hot take: the summit is overrated', 'I came for the podcast, stayed for the bumping', 'brb, defragmenting',
  'tabs. obviously', 'counting snowflakes: 1, 2, 3, ... this may take a while',
  'let me dig far too deep into this detail', 'carbonation at 100%', 'is the snow wall load-bearing?',
  'reaction run? I barely react at all', 'off by one can, again', 'snow is just water with ambition',
  'recycle, reduce, re-bump', 'my outline is 0.004 thick and very flattering', 'still waiting for the gondola'];
const HELLOS = ['hoi!', 'hi!', 'welcome to the plaza', 'a new can!'];

// A bot's mind. `step(self, cans)` is its input for one step and a line to say (or null), from its own { id, can }
// and everyone's; `greet()` has it wave at a newcomer next. `chat`: how likely a new idea comes with a line.
export function brain({ random = Math.random, chat = 0.15 } = {}) {
  let left = 0, target = wander(random), chase = null, still = false, hello = false;
  return {
    greet() { hello = true; },
    step({ id, can }, cans) {
      let jump = false, emote = 0, say = null;
      if (hello) {
        // stop, turn up, wave, say hello
        hello = false;
        chase = null;
        still = true;
        emote = EMOTE.wave;
        say = HELLOS[Math.floor(random() * HELLOS.length)];
        left = (2.5 + random()) / TICK;
      } else if (--left <= 0) {
        // a new idea: mostly somewhere to go, sometimes someone to bump, sometimes a wave or a dance on the spot
        const r = random(), others = cans.filter(p => p.id !== id);
        chase = null;
        still = false;
        if (r < 0.3 && others.length) chase = others[Math.floor(random() * others.length)].id;
        else if (r < 0.47) {
          emote = r < 0.4 ? EMOTE.wave : EMOTE.dance;
          still = true;
        } else target = wander(random);
        left = (2 + random() * 4) / TICK;
        if (random() < chat) say = LINES[Math.floor(random() * LINES.length)];
      }
      if (!still && random() < 0.01) jump = true;
      let x = 0, z = 0;
      const chased = chase !== null && cans.find(p => p.id === chase);
      const goal = chased ? chased.can : still ? null : target;
      if (goal) {
        const dx = goal.x - can.x, dz = goal.z - can.z, d = Math.hypot(dx, dz);
        if (d > 0.4) { x = dx / d; z = dz / d; } else if (!chased) left = 0;
      }
      return { input: { x, z, jump, emote }, say };
    },
  };
}

function wander(random) {
  const a = random() * Math.PI * 2, r = Math.sqrt(random()) * (PLAZA.radius - 1.5);
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
}

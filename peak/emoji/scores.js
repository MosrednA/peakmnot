// High scores for Reaction Run, on the climb's run and board (peak/scores/scores.js, server/README.md): when the clock
// starts on one of the board's fields, the server hands out a run; each listed emoji fetched is reported as it's
// reached; at :peak-mnot: the recorded run (record.js) goes up, the server checks it against its field
// (server/emoji.py) and says where it ranks, and the player may put a name on it, the same player and name as in the
// other games. The card and the Hall of Fame are the climb's (leaderboard.js), in the thread's words: the board ranks
// the time, then the wrong ones touched; the holes dropped into are shown. A field that isn't one of the board's (a
// ?seed= past them, or another deal: ?list= and the rest) is practice: recorded, never sent.
// ?manual (tests and bots) records but never talks to the server, unless ?scores is there too; nor does watching a
// run (?replay=, playback.js). level: the board's (kit/levels.js).
import { apiBase, createBoard, createQueue, createRun, playerName } from '../scores/scores.js';
import { Recorder } from './record.js';

const CARD_DELAY = 2200;              // ms after :peak-mnot:: the thread's own card has been read, the dance started
const ms = s => Math.round(s * 1000);
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

export const WORDS = {
  title: 'Thread complete!', fall: 'wrong one', dent: 'hole', again: 'Another field',
  checking: 'Checking your reactions…', carrying: 'Posting your reactions to the board…',
  fetching: 'Fetching the fastest threads…', made: n => `${plural(n, 'thread')} complete`,
  nobody: 'No thread complete yet. Be the first to react!',
  offline: 'The board is out of reach just now. Your run still counts, in the thread.',
  replays: true,                    // the Hall of Fame's Race ghost and Watch run (playback.js)
  leave: 'Leave this run? Your current run will be lost.',
};

// What a recorded run adds up to: the clock at :peak-mnot:, the wrong ones touched and the holes dropped into.
export function tally(recorder) {
  const { samples, events } = recorder;
  return { time: samples[samples.length - 1][0], falls: events.filter(e => e[1] === 'hit').length,
    dents: events.filter(e => e[1] === 'pit').length };
}

const RUN = { game: 'Reaction Run', run: 'run', checkpoint: 'reaction' };

// player: main.js's; route: a promise of the route's fingerprint (routedata.js), asked for when a run starts;
// field(): the seed of the field dealt now, and whether it's one of the board's; again(): the card's last button.
export function createScores({ player, route, field, manual = false, again, level = '', watching = false }) {
  const recorder = new Recorder(player);
  const asked = !manual || new URLSearchParams(location.search).has('scores');
  const live = !watching && asked && !!globalThis.crypto?.subtle;
  const off = { recorder, board: null, live: false, status: 'off', take() {}, update() {},
    reset() { recorder.reset(); } };
  if (!live) return off;
  const base = apiBase(location, 'emoji', level);
  const enqueue = createQueue();
  let session = null, seed = 0, cardTimer = 0, fingerprint = null;
  // the card, when it's up: a run that goes off before the server has answered says so there
  const onOff = (run) => { if (run === session && board.view === 'result' && !run.verdict) board.offline(); };
  const board = createBoard({ base, run: () => session, words: WORDS, again, isRunActive: () => recorder.recording });

  // At :peak-mnot: (the step of it, once the recorder has its last sample): send the run, show the card. A practice
  // field has no run, and no card: the thread's own says so (main.js).
  function finish() {
    const run = session, result = tally(recorder), from = seed;
    if (!run) return;
    cardTimer = setTimeout(() => {
      if (run !== session) return;
      board.showResult(result, playerName());
      if (run.status === 'off') board.offline();
      else if (run.verdict) board.verdict(run.verdict);
    }, CARD_DELAY);
    run.finish(result, async () => recorder.data(await fingerprint, from)).then((verdict) => {
      if (verdict && run === session && board.view === 'result') board.verdict(verdict);
    });
  }

  let was = recorder.state;
  return {
    recorder,
    board,
    live: true,
    get status() { return session?.status ?? 'idle'; },
    // the n-th listed one fetched (from 1)
    take(n) {
      if (session && recorder.recording) session.split(n, ms(player.time));
    },
    // once a step, after the recorder's: the clock started (a run, on a board field), :peak-mnot: or too long
    update() {
      const now = recorder.state;
      if (now === was) return;
      if (now === 'recording') {
        const dealt = field();
        seed = dealt.seed;
        if (dealt.counts) {
          fingerprint ??= route();
          session = createRun({ base, enqueue, route: fingerprint, clock: () => player.time, words: RUN, onOff });
        }
      }
      if (now === 'done') finish();
      if (now === 'full') session?.off('this run took too long for the board');
      was = now;
    },
    // this field again, or a new one: the run on the server, if any, is left to expire
    reset() {
      clearTimeout(cardTimer);
      recorder.reset();
      was = recorder.state;
      session = null;
      if (board.view === 'result') board.close();
    },
  };
}

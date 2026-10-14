// High scores for the downhill, on the climb's run and board (peak/scores/scores.js, server/README.md): when the
// chair passes the gate the server hands out a run; each pit stop is reported as it's reached; at the finish the
// recorded run (record.js) goes up, the server checks it (server/downhill.py) and says where it ranks, and the
// player may put a name on it, the same player and name as on the climb's board. The card and the Hall of Fame are
// the climb's (leaderboard.js), in the downhill's words. The board time is the clock less the bonus (bonus.js): the
// server adds the bonus up again from the run itself.
// ?manual (tests and bots) records but never talks to the server, unless ?scores is there too.
import { apiBase, createBoard, createQueue, createRun, playerName } from '../scores/scores.js';
import { Recorder } from './record.js';
import { routeFingerprint } from './routedata.js';
import { FEATURES } from './track.js';
import { bonusMs, pinsBonus } from './bonus.js';

const CARD_DELAY = 2500;              // ms after the finish: the chair has stopped and the party started
const ms = s => Math.round(s * 1000);
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

export const WORDS = {
  title: 'Finish!', fall: 'spill', dent: 'lost wheel', again: 'Ride again', checking: 'Checking your run…',
  carrying: 'Rolling your chair over to the board…', fetching: 'Fetching the fastest chairs…',
  made: n => `${plural(n, 'chair')} made it down`, nobody: 'Nobody has made it down yet. Be the first chair!',
  offline: 'The board is out of reach just now. Your run still counts, in our hearts.',
  replays: false,
};

// What a recorded run adds up to: the clock at the finish, the bonus, the board's time, spills and lost wheels.
export function tally(recorder) {
  const { samples, events } = recorder, clock = samples[samples.length - 1][0];
  const bowled = Math.max(0, ...events.filter(e => e[1] === 'bowl').map(e => pinsBonus(e[2])));
  const jump = Math.max(0, ...events.filter(e => e[1] === 'flight').map(e => e[2] / 100));
  const bonus = bonusMs(bowled, jump);
  return { time: Math.max(0, clock - bonus), clock, bonus,
    falls: events.filter(e => e[1] === 'lost' || e[1] === 'wrecked').length,
    dents: events.filter(e => e[1] === 'wheel').length };
}

const RIDE = { game: 'Mnot Downhill', run: 'run', checkpoint: 'pit stop' };

export function createScores({ ride, track, obstacles, manual = false, again }) {
  const recorder = new Recorder(ride, FEATURES.pits);
  const live = (!manual || new URLSearchParams(location.search).has('scores')) && !!globalThis.crypto?.subtle;
  if (!live) return { recorder, board: null, status: 'off', update() {}, reset() { recorder.reset(); } };
  const base = apiBase(location, 'downhill');
  const route = routeFingerprint({ track, obstacles });
  const enqueue = createQueue();
  let session = null, cardTimer = 0;               // the run on the server: a new one for every ride from the top
  // the card, when it's up: a run that goes off before the server has answered says so there
  const onOff = (run) => { if (run === session && board.view === 'result' && !run.verdict) board.offline(); };

  ride.on('start', () => {
    if (recorder.recording) session = createRun({ base, enqueue, route, clock: () => ride.time, words: RIDE, onOff });
  });
  ride.on('pit', ({ s }) => {
    if (session && recorder.recording) session.split(FEATURES.pits.indexOf(s), ms(ride.time));
  });

  const board = createBoard({ base, run: () => session, words: WORDS, again, isRunActive: () => recorder.recording });

  // Past the finish (the step after it, once the recorder has its last sample): send the run, show the card.
  function finish() {
    const run = session, result = tally(recorder);
    cardTimer = setTimeout(() => {
      if (run !== session) return;
      board.showResult(result, playerName());
      if (!run || run.status === 'off') board.offline();
      else if (run.verdict) board.verdict(run.verdict);
    }, CARD_DELAY);
    run?.finish(result, async () => recorder.data(await route)).then((verdict) => {
      if (verdict && run === session && board.view === 'result') board.verdict(verdict);
    });
  }

  let was = recorder.state;
  return {
    recorder,
    board,
    get status() { return session?.status ?? 'idle'; },
    // once a frame, after the physics
    update() {
      const now = recorder.state;
      if (now === was) return;
      if (now === 'done') finish();
      if (now === 'full') session?.off('this run took too long for the board');
      was = now;
    },
    // a new ride from the top: the run on the server, if any, is left to expire
    reset() {
      clearTimeout(cardTimer);
      recorder.reset();
      was = recorder.state;
      session = null;
      if (board.view === 'result') board.close();
    },
  };
}

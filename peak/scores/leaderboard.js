// The high-score screens (styled by scores.css): the summit card with the time, falls and dents, the rank, an
// optional name and the top list; the Hall of Fame behind the trophy button in the HUD and the title screen's
// #hall-of-fame button. Names come from other players, so they only ever go in as textContent. The words are the
// climb's; the downhill (peak/downhill/scores.js) brings its own.
const TOP = 10;

export function clockMs(ms) {
  const cs = Math.floor(ms / 10), m = Math.floor(cs / 6000), s = Math.floor(cs / 100) % 60;
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const WORDS = {
  title: 'Summit!', fall: 'fall', dent: 'dent', again: 'Climb again', checking: 'Checking your climb…',
  carrying: 'Carrying your can up to the board…', fetching: 'Fetching the fastest cans…',
  made: n => `${plural(n, 'can')} made it to the top`, nobody: 'Nobody has made it yet. Be the first can!',
  offline: 'The board is out of reach just now. Your climb still counts, in our hearts.',
  replays: true,                   // the Hall of Fame's ghost and replay buttons (peak/replays/)
  leave: 'Leave this climb? Your current run will be lost.',
};

export class Leaderboard {
  // load(limit) → { entries, me, total } or null; submit(name) → { ok, json } (scores.js); again() for the card's
  // last button (a new climb: the page again); words: any of WORDS
  constructor({ load, submit, isRunActive = () => false, again = () => location.reload(), words = {} }) {
    this.load = load;
    this.submit = submit;
    this.isRunActive = isRunActive;
    this.again = again;
    this.words = { ...WORDS, ...words };
    this.view = null;              // 'result' | 'hall'
    this.result = null;            // { time, falls, dents } of the climb just finished
    this.build();
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('#hall-of-fame, .sc-trophy')) { e.preventDefault(); this.openHall(); }
      const action = e.target.closest?.('[data-replay-action]');
      if (action) { e.preventDefault(); this.openReplay(action.dataset.replayAction, action.dataset.replayId); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panel.classList.contains('open')) this.close();
    });
  }

  build() {
    const hud = document.getElementById('scores-hud');
    if (hud) {
      const trophy = el('button', 'card sc-trophy', 'Hall of Fame');
      trophy.type = 'button';
      trophy.addEventListener('mousedown', e => e.preventDefault());     // keep Space from clicking it later
      hud.append(trophy);
    }
    const p = this.panel = el('aside', 'sc-panel card');
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-live', 'polite');
    const close = el('button', 'sc-x', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.onclick = () => this.close();
    this.titleEl = el('h2', 'sc-title');
    this.resultEl = el('div', 'sc-result');
    this.timeEl = el('div', 'sc-time');
    this.statsEl = el('div', 'sc-stats');
    this.resultEl.append(this.timeEl, this.statsEl);
    this.statusEl = el('p', 'sc-status');
    const form = this.form = el('form', 'sc-form');
    const label = el('label', '', 'Your name on the board ');
    label.append(el('small', '', '(optional)'));
    this.input = el('input');
    Object.assign(this.input, { maxLength: 20, placeholder: 'Mystery Can', autocomplete: 'off', spellcheck: false,
      id: 'sc-name' });
    label.htmlFor = 'sc-name';
    this.sendEl = el('button', 'sc-send', 'Submit');
    this.sendEl.type = 'submit';
    const row = el('div', 'sc-row');
    row.append(this.input, this.sendEl);
    form.append(label, row);
    form.addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
    this.listEl = el('ol', 'sc-list');
    this.noteEl = el('p', 'sc-note');
    const again = this.againEl = el('button', 'sc-again', this.words.again);
    again.type = 'button';
    again.onclick = () => this.again();
    p.append(close, this.titleEl, this.resultEl, this.statusEl, form, this.listEl, this.noteEl, again);
    document.body.append(p);
  }

  open(view) {
    this.view = view;
    this.panel.dataset.view = view;
    this.panel.classList.add('open');
  }

  close() {
    this.panel.classList.remove('open');
    document.activeElement?.blur?.();
  }

  // ------------------------------------------------------------------ the summit card

  // The climb is over: its numbers now, the verdict when the server has checked it.
  showResult({ time, falls, dents }, name = '') {
    this.result = { time, falls, dents };
    const w = this.words;
    this.titleEl.textContent = w.title;
    this.timeEl.textContent = clockMs(time);
    this.statsEl.replaceChildren(el('span', 'sc-falls', plural(falls, w.fall)), el('span', 'sc-dents', plural(dents, w.dent)));
    this.status(w.checking);
    this.form.hidden = true;
    this.input.value = name;
    this.listEl.replaceChildren();
    this.noteEl.textContent = '';
    this.againEl.hidden = false;
    this.open('result');
  }

  status(text, kind = '') {
    this.statusEl.textContent = text;
    this.statusEl.className = `sc-status ${kind}`;
  }

  // The server's verdict on the climb: where it would rank, and the player's best so far.
  verdict({ rank, total, best }) {
    const t = this.result?.time ?? 0;
    let line = `Rank #${rank} of ${Math.max(total, rank)}`;
    if (best && best.time <= t) line += ` · your best is still ${clockMs(best.time)}`;
    else if (best) line += ' · a new personal best!';
    this.status(line, 'good');
    this.form.hidden = false;
    this.sendEl.disabled = false;
    if (this.view === 'result' && this.panel.classList.contains('open') && !matchMedia('(pointer: coarse)').matches) {
      this.input.focus({ preventScroll: true });
    }
  }

  offline(text = this.words.offline) {
    this.status(text, 'muted');
    this.form.hidden = true;
  }

  async send() {
    this.sendEl.disabled = true;
    this.status(this.words.carrying);
    const answer = await this.submit(this.input.value.trim()).catch(() => null);
    if (!answer?.ok) {
      this.status("The board didn't take it. Try again in a moment?", 'muted');
      this.sendEl.disabled = false;
      return;
    }
    const j = answer.json;
    this.form.hidden = true;
    this.input.blur();
    this.status(j.improved ? `On the board as ${j.name}: #${j.rank}!` : `Still on the board as ${j.name}: #${j.rank}, with ${clockMs(j.best.time)}`, 'good');
    if (j.nameNote) this.noteEl.textContent = j.nameNote;
    this.list(j.board);
  }

  // ------------------------------------------------------------------ the Hall of Fame

  async openHall() {
    if (this.view === 'result' && this.panel.classList.contains('open')) return;   // the card has the list already
    this.titleEl.textContent = 'Hall of Fame';
    this.status(this.words.fetching);
    this.listEl.replaceChildren();
    this.noteEl.textContent = '';
    this.againEl.hidden = true;
    this.open('hall');
    const board = await this.load(TOP).catch(() => null);
    if (this.view !== 'hall') return;
    if (!board) { this.offline('The Hall of Fame is out of reach just now.'); return; }
    this.status(board.total ? this.words.made(board.total) : this.words.nobody);
    this.list(board);
  }

  openReplay(mode, id) {
    if (!id || !['ghost', 'replay'].includes(mode)) return;
    if (this.isRunActive() && !confirm(this.words.leave)) return;
    const url = new URL(location.href);         // its ?level= stays: the run is this level's (kit/levels.js)
    url.searchParams.delete('ghost');
    url.searchParams.delete('replay');
    url.searchParams.delete('hall');
    url.searchParams.set(mode, id);
    location.assign(url.href);
  }

  // The top list, the player's own entry highlighted (and added below if it's further down).
  list(board) {
    this.listEl.replaceChildren();
    if (!board) return;
    const w = this.words;
    const row = (entry) => {
      const li = el('li', entry.me ? 'me' : entry.house ? 'house' : '');
      li.append(el('span', 'sc-rank', String(entry.rank)), el('span', 'sc-name', entry.name),
        el('span', 'sc-t', clockMs(entry.time)), el('span', 'sc-f', String(entry.falls)));
      li.title = `${plural(entry.falls, w.fall)}, ${plural(entry.dents, w.dent)}`;
      if (entry.house) li.title = `House record: ${entry.quip ?? 'it came with the mountain'} (${li.title})`;
      const replayId = typeof entry.replayId === 'string' ? entry.replayId.trim() : '';
      if (!w.replays) return li;          // no replays here (yet): just the list
      if (entry.house || !replayId) {
        li.append(el('span', 'sc-replay-note', entry.house ? 'House record · no replay' : 'Replay unavailable'));
      } else {
        const actions = el('div', 'sc-replay-actions');
        for (const [mode, label] of [['ghost', 'Race ghost'], ['replay', 'Watch run']]) {
          const button = el('button', 'sc-replay-action', label);
          button.type = 'button';
          button.dataset.replayAction = mode;
          button.dataset.replayId = replayId;
          actions.append(button);
        }
        li.append(actions);
      }
      return li;
    };
    for (const entry of board.entries ?? []) this.listEl.append(row(entry));
    if (board.me && !(board.entries ?? []).some(e => e.me)) {
      this.listEl.append(el('li', 'sc-gap', '…'), row({ ...board.me, me: true }));
    }
  }
}

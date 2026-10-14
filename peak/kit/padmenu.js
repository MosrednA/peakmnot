// The controller on the screen, the same in every mini game: while one is connected, a small chip in the corner
// (with its name for a moment when it comes or goes), and behind it a card with what the buttons do and the
// settings; the Menu button or a click on the chip opens it. The hints follow the device in use: while it's the
// controller, body has the class `pad`, and the help line, "Press A to start" and How to play show its buttons, drawn
// as on the controller itself (pad.css: A, ✕ or B at the bottom). On the title it presses the page's own buttons (A
// Start, Y Hall of Fame, X How to play); on the Hall of Fame or the finish card, B closes it and Y plays again.
//
// The game says what its buttons do (controls for the card and How to play, help for the line at the bottom) and
// calls update(dt) once a step, after pad.poll(): true means the controller went to the page this step, and the
// game takes none of it.
import { BUTTON } from './gamepad.js';

const SAY = 2.6;              // seconds the chip shows the controller's name as it comes or goes
const REPEAT = [0.4, 0.14];   // a direction held on the card: the wait for the first repeat, then each next one
// the settings a game can put on the card, in their order on screen
const ROWS = {
  invert: { name: 'Camera', choices: [[false, 'Normal'], [true, 'Inverted']] },
  speed: { name: 'Look speed', choices: [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']] },
  rumble: { name: 'Rumble', choices: [[true, 'On'], [false, 'Off']] },
};
// the title's buttons the controller presses
const TITLE = [['a', 'title-start'], ['y', 'hall-of-fame'], ['x', 'title-help']];

// A button as the controller draws it (pad.css): 'a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'view', 'menu', 'move'
// (the left stick), 'look' (the right stick) or 'dpad'; several with spaces between.
export const glyphs = names => names.split(' ').map(name => `<i class="pg pg-${name}"></i>`).join('');

const el = (tag, className, html = '') => Object.assign(document.createElement(tag), { className, innerHTML: html });
const shown = e => e && e.getClientRects().length > 0 ? e : null;
// a button's glyph in front of its words, while the controller is in use
function mark(button, name) {
  if (button && !button.querySelector(':scope > .pg')) button.prepend(el('i', `pg pg-${name} pad-only`));
}

export class PadMenu {
  // pad: the GamepadInput; controls: [buttons, what they do] for the card and How to play; help: the same, short,
  // for the line at the bottom; press: the word in "Press A to …"; settings: which of ROWS the game has; sounds:
  // the game's MnotSounds, to say that the sound waits for a click or a key
  constructor(pad, { controls = [], help = controls, press = 'start', settings = ['rumble'], sounds = null } = {}) {
    Object.assign(this, { pad, sounds });
    this.open = false;
    this.row = 0;
    this.held = { dir: '', time: 0 };
    const list = (rows, tag) => rows.map(([names, what]) => `<${tag[0]}>${glyphs(names)}</${tag[0]}><${tag[1]}>${what}</${tag[1]}>`).join('');

    // the chip, bottom right
    const chip = this.chip = el('button', 'card', '<i class="pad-icon"></i><span class="pad-name"></span>');
    Object.assign(chip, { id: 'pad-chip', type: 'button', title: 'Controller' });
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-controls', 'pad-card');
    chip.addEventListener('click', () => this.toggle(false));

    // the card above it
    const card = this.card = el('section', 'card', `
      <header><i class="pad-icon"></i><b class="pad-title">Controller</b>
        <button type="button" class="pad-x" aria-label="Close">×</button></header>
      <dl class="pad-map">${list(controls, ['dt', 'dd'])}</dl>
      <div class="pad-set"></div>
      <p class="pad-note">The sound comes on with a click or a key: browsers don't let a controller start it.</p>
      <footer><span class="pad-steer">${glyphs('dpad')} choose</span><span class="pad-steer">${glyphs('a')} change</span>
        <span>${glyphs('b')} close</span></footer>`);
    Object.assign(card, { id: 'pad-card' });
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Controller');
    const set = card.querySelector('.pad-set');
    this.rows = settings.filter(key => ROWS[key]).map(key => {
      const { name, choices } = ROWS[key];
      const row = el('div', 'pad-row', `<span>${name}</span><span class="pad-seg">${choices.map(([, label]) =>
        `<button type="button">${label}</button>`).join('')}</span>`);
      row.dataset.key = key;
      row.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => this.choose(key, choices[i][0])));
      set.append(row);
      return row;
    });
    set.hidden = !this.rows.length;
    card.querySelector('.pad-x').addEventListener('click', () => this.hide());
    // buttons keep the focus away, so the keys keep going to the game
    for (const b of [chip, ...card.querySelectorAll('button')]) b.addEventListener('mousedown', e => e.preventDefault());
    document.body.append(chip, card);
    addEventListener('pointerdown', e => {
      if (this.open && !card.contains(e.target) && !chip.contains(e.target)) this.hide();
    }, { capture: true });
    addEventListener('keydown', e => { if (e.key === 'Escape') this.hide(); });

    // the page's hints, as the controller's: the line at the bottom, "Press A to start", How to play, the buttons
    const line = el('div', '', help.map(([names, what]) => `<span>${glyphs(names)} ${what}</span>`).join(' · '));
    line.id = 'pad-help';
    document.getElementById('help')?.after(line);
    document.querySelector('.ts-press')?.after(el('p', 'ts-press pad-press',
      `Press ${glyphs('a')} to ${press}<small class="pad-mute">the sound comes on with a click or a key</small>`));
    document.querySelector('#title-howto dl')?.after(el('dl', 'pad-howto', list(controls, ['dt', 'dd'])));
    for (const [name, id] of TITLE) mark(document.getElementById(id), name);

    pad.on('connect', () => {
      document.body.dataset.pad = pad.kind;
      document.body.dataset.padName = pad.name;
      card.querySelector('.pad-title').textContent = pad.name;
      chip.setAttribute('aria-label', `Controller: ${pad.name}`);
      this.say(pad.name);
      this.sync();
    });
    pad.on('disconnect', () => {
      this.hide();
      this.say('Disconnected');
    });
    pad.on('active', on => document.body.classList.toggle('pad', on));
    pad.on('settings', () => this.sync());
    sounds?.onStateChange?.(() => this.sync());
    this.sync();
  }

  // The chip with words for a moment: the controller's name as it comes, "Disconnected" as it goes (and then the chip
  // goes too).
  say(words) {
    const chip = this.chip, on = this.pad.connected;
    chip.querySelector('.pad-name').textContent = words;
    chip.classList.toggle('off', !on);
    chip.classList.add('on', 'say');
    clearTimeout(this.saying);
    this.saying = setTimeout(() => {
      chip.classList.remove('say');
      if (!this.pad.connected) chip.classList.remove('on');
    }, SAY * 1000);
  }

  show(steer = false) {
    if (!this.pad.connected) return;
    this.open = true;
    this.row = 0;
    this.card.classList.add('open');
    this.card.classList.toggle('steer', steer);
    this.chip.setAttribute('aria-expanded', 'true');
    this.direction(0);                  // a direction held as it opens isn't a press
    this.sync();
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.card.classList.remove('open');
    this.chip.setAttribute('aria-expanded', 'false');
  }

  toggle(steer) { if (this.open) this.hide(); else this.show(steer); }

  choose(key, value) {
    this.pad.set(key, value);
    if (key === 'rumble' && value) this.pad.rumble('bump', true);      // what it feels like
  }

  // The card as the settings are, and the notes about the sound.
  sync() {
    const pad = this.pad;
    const rows = this.rows.filter(row => {
      row.hidden = row.dataset.key === 'rumble' && !pad.rumbles;
      return !row.hidden;
    });
    this.row = Math.min(this.row, Math.max(0, rows.length - 1));
    for (const row of this.rows) {
      const key = row.dataset.key;
      row.classList.toggle('at', row === rows[this.row]);
      row.querySelectorAll('button').forEach((b, i) =>
        b.setAttribute('aria-pressed', String(ROWS[key].choices[i][0] === pad.settings[key])));
    }
    const s = this.sounds, quiet = !!s && s.enabled && s.context?.state !== 'running';
    document.body.classList.toggle('pad-quiet', quiet);
  }

  // Once a step, after pad.poll(). True when the controller went to the page this step: the card, the Hall of Fame
  // or the finish card, a title button.
  update(dt) {
    const pad = this.pad;
    if (!pad.connected) return false;
    if (this.open) {
      this.steer(dt);
      return true;
    }
    if (pad.fresh.has(BUTTON.menu)) {
      this.show(true);
      return true;
    }
    const panel = document.querySelector('.sc-panel.open');
    if (panel) {
      if (pad.fresh.has(BUTTON.b)) panel.querySelector('.sc-x')?.click();
      else if (pad.fresh.has(BUTTON.y)) shown(panel.querySelector('.sc-again'))?.click();
      mark(panel.querySelector('.sc-again'), 'y');
      panel.scrollBy?.(0, -(pad.stick.y || pad.dpad.y) * 600 * dt);
      return true;
    }
    if (document.body.classList.contains('title-up')) {
      const howto = document.getElementById('title-howto');
      if (pad.fresh.has(BUTTON.b) && howto && !howto.hidden) {
        document.getElementById('title-help')?.click();
        return true;
      }
      for (const [name, id] of TITLE) {
        if (pad.fresh.has(BUTTON[name]) && shown(document.getElementById(id))) {
          document.getElementById(id).click();
          return true;
        }
      }
    }
    return false;
  }

  // The card, by controller: up and down pick a setting, left and right (or A) change it, B or Menu close it.
  steer(dt) {
    const pad = this.pad;
    if (pad.fresh.has(BUTTON.b) || pad.fresh.has(BUTTON.menu)) return this.hide();
    const dir = this.direction(dt);
    const rows = this.rows.filter(row => !row.hidden);
    if (dir || pad.fresh.size) this.card.classList.add('steer');
    if (!rows.length) return;
    if (dir === 'up' || dir === 'down') this.row = (this.row + (dir === 'down' ? 1 : rows.length - 1)) % rows.length;
    const key = rows[this.row].dataset.key, { choices } = ROWS[key];
    const at = choices.findIndex(([value]) => value === pad.settings[key]);
    const next = dir === 'left' ? at - 1 : dir === 'right' ? at + 1 : pad.fresh.has(BUTTON.a) ? (at + 1) % choices.length : at;
    if (next !== at && choices[next]) this.choose(key, choices[next][0]);
    this.sync();
  }

  // A direction on the D-pad or the stick: once as it's pressed, then again and again while it's held.
  direction(dt) {
    const pad = this.pad, d = pad.dpad, s = pad.stick;
    const x = d.x || (Math.abs(s.x) > 0.5 ? Math.sign(s.x) : 0), y = d.y || (Math.abs(s.y) > 0.5 ? Math.sign(s.y) : 0);
    const dir = y && Math.abs(y) >= Math.abs(x) ? (y > 0 ? 'up' : 'down') : x ? (x > 0 ? 'right' : 'left') : '';
    const held = this.held;
    if (dir !== held.dir) {
      Object.assign(held, { dir, time: REPEAT[0] });
      return dir;
    }
    if (!dir || (held.time -= dt) > 0) return '';
    held.time = REPEAT[1];
    return dir;
  }
}

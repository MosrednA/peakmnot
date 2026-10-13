// The few bits of screen text: a toast for checkpoints, the summit, tips and mishaps, the balance meter on beams, a
// white fade for respawns, and the stats card (time, dents as little cans, falls). peak.html styles them.
import { FALL_ANGLE } from './balance.js';
import { touchText } from './touch.js';

// What a toast is about, from its title when the caller doesn't say: each kind has its own colour and bounce.
function kindOf(title, line) {
  if (/^checkpoint/i.test(title)) return 'checkpoint';
  if (/peak mnot/i.test(title)) return 'summit';
  if (/\bdent\b|back to/i.test(line)) return 'oops';
  return 'tip';
}

export class Hud {
  constructor() {
    this.toastEl = document.getElementById('toast');
    this.balanceEl = document.getElementById('balance');
    this.markerEl = this.balanceEl.querySelector('i');
    this.fadeEl = document.getElementById('fade');
    this.statsEl = document.getElementById('stats');
    this.toastTimer = 0;
    this.shown = '';
  }

  // kind: 'checkpoint' | 'summit' | 'tip' | 'oops', or left out to guess it from the text
  toast(title, line = '', seconds = 2.2, kind = kindOf(title, line)) {
    const el = this.toastEl;
    el.replaceChildren();
    const big = document.createElement('b');
    big.textContent = title;
    el.append(big);
    if (line) {
      const small = document.createElement('small');
      small.className = 'card';
      small.textContent = touchText(line);      // "Shift" and friends, in touch words on a phone
      el.append(small);
    }
    el.className = kind;
    void el.offsetWidth;           // restart the bounce
    el.classList.add('show');
    el.style.opacity = 1;
    this.toastTimer = seconds;
  }

  fade(on) { this.fadeEl.style.opacity = on ? 1 : 0; }

  // a line of text, or { time, dents, maxDents, falls } for the card with the cans
  stats(info) {
    if (typeof info === 'string') {
      if (this.shown !== info) this.statsEl.textContent = this.shown = info;
      return;
    }
    const { time, dents, maxDents, falls } = info;
    const key = `${time}|${dents}|${maxDents}|${falls}`;
    if (this.shown === key) return;
    if (!this.cans || this.cans.length !== maxDents) {
      this.statsEl.replaceChildren();
      this.timeEl = Object.assign(document.createElement('span'), { className: 'time' });
      const row = Object.assign(document.createElement('span'), { className: 'dents', title: 'dents' });
      this.cans = Array.from({ length: maxDents }, () => row.appendChild(Object.assign(document.createElement('i'), { className: 'can' })));
      this.fallsEl = Object.assign(document.createElement('span'), { className: 'falls', title: 'falls' });
      this.statsEl.append(this.timeEl, row, this.fallsEl);
    }
    this.timeEl.textContent = time;
    this.cans.forEach((can, i) => can.classList.toggle('dented', i < dents));
    this.fallsEl.textContent = falls;
    this.shown = key;
  }

  // forward: the camera's flat looking direction, to show the lean as seen on screen
  update(dt, player, forward) {
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.style.opacity = 0;
    const wobble = player.mode === 'beam' ? null : player.skate?.meterOnScreen(forward) ?? null;   // ice: skate.js
    const balancing = player.mode === 'beam' || wobble !== null;
    this.balanceEl.style.opacity = balancing ? 1 : 0;
    if (balancing) {
      // the marker shows the lean as seen on screen: left is a lean to the left
      const side = Math.sign(forward.dot(player.balance.beam?.dir ?? forward)) || 1;
      const lean = wobble ?? side * player.balance.lean / FALL_ANGLE;
      const at = Math.max(-1, Math.min(1, lean));
      this.markerEl.style.left = `${50 + 50 * at}%`;
      this.markerEl.style.transform = `rotate(${at * 25}deg)`;
    }
  }
}

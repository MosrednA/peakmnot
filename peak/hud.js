// The few bits of screen text: a toast for checkpoints and the summit, the balance meter on beams, a white fade
// for respawns, and a stats line.
import { FALL_ANGLE } from './balance.js';

export class Hud {
  constructor() {
    this.toastEl = document.getElementById('toast');
    this.balanceEl = document.getElementById('balance');
    this.markerEl = this.balanceEl.querySelector('i');
    this.fadeEl = document.getElementById('fade');
    this.statsEl = document.getElementById('stats');
    this.toastTimer = 0;
  }

  toast(title, line = '', seconds = 2.2) {
    this.toastEl.innerHTML = '';
    this.toastEl.append(title);
    if (line) {
      const small = document.createElement('small');
      small.textContent = line;
      this.toastEl.append(small);
    }
    this.toastEl.style.opacity = 1;
    this.toastTimer = seconds;
  }

  fade(on) { this.fadeEl.style.opacity = on ? 1 : 0; }

  stats(text) { if (this.statsEl.textContent !== text) this.statsEl.textContent = text; }

  // forward: the camera's flat looking direction, to show the lean as seen on screen
  update(dt, player, forward) {
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.style.opacity = 0;
    const balancing = player.mode === 'beam';
    this.balanceEl.style.opacity = balancing ? 1 : 0;
    if (balancing) {
      // the marker shows the lean as seen on screen: left is a lean to the left
      const side = Math.sign(forward.dot(player.balance.beam.dir)) || 1;
      const lean = side * player.balance.lean / FALL_ANGLE;
      this.markerEl.style.left = `${50 + 50 * Math.max(-1, Math.min(1, lean))}%`;
    }
  }
}

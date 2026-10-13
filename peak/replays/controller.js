// Loads a verified public replay and owns the small, accessible controls for racing or watching it.
import { ReplayActor, validateReplay } from './playback.js';
import { routeFingerprint } from '../scores/routedata.js';
import { apiBase } from '../scores/scores.js';

const node = (tag, className = '', text = '') => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};

const clockMs = (ms) => {
  const cs = Math.floor(ms / 10), minutes = Math.floor(cs / 6000), seconds = Math.floor(cs / 100) % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

export class ReplayController {
  constructor({ mode, id, scene, world, player, game, follow, title, isRunActive = () => false }) {
    Object.assign(this, { mode, id, scene, world, player, game, follow, title, isRunActive });
    // Start hashing before the frame loop can move any world objects.
    this.fingerprint = routeFingerprint({ world, player });
    this.ready = false;
    this.error = null;
    this.actor = null;
    this.name = '';
    this.recordedTime = 0;
    this.duration = 0;
    this.time = 0;
    this.speed = 1;
    this.playing = mode === 'replay';
    this.hidden = false;
    document.body.classList.add(mode === 'replay' ? 'replay-watch' : 'replay-race');
    this.build();
  }

  build() {
    const watching = this.mode === 'replay';
    this.el = node('section', `replay-ui ${watching ? 'replay-ui--watch' : 'replay-ui--race'}`);
    this.el.setAttribute('aria-label', watching ? 'Replay controls' : 'Ghost race controls');
    const top = node('div', 'replay-top');
    this.chip = node('strong', 'replay-chip', watching ? 'Loading run…' : 'Loading ghost…');
    this.backHall = node('button', 'replay-button replay-exit', watching ? 'Back to Hall' : 'Hall of Fame');
    this.backHall.type = 'button';
    this.backHall.onclick = () => this.exitToHall();
    top.append(this.chip, this.backHall);
    if (!watching) {
      this.toggleButton = node('button', 'replay-button replay-ghost-toggle', 'Hide ghost');
      this.toggleButton.type = 'button';
      this.toggleButton.setAttribute('aria-pressed', 'true');
      this.toggleButton.onclick = () => this.toggleGhost();
      top.append(this.toggleButton);
    }
    this.status = node('p', 'replay-status', 'Loading the replay…');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.backGame = node('button', 'replay-button replay-back-game', 'Back to game');
    this.backGame.type = 'button';
    this.backGame.hidden = true;
    this.backGame.onclick = () => this.backToGame();
    this.el.append(top, this.status);

    if (watching) {
      const controls = this.controls = node('div', 'replay-controls');
      const transport = node('div', 'replay-transport');
      this.playButton = node('button', 'replay-button replay-play', 'Pause');
      this.playButton.type = 'button';
      this.playButton.setAttribute('aria-label', 'Pause replay');
      this.playButton.setAttribute('aria-pressed', 'true');
      this.playButton.onclick = () => this.togglePlay();
      const restart = node('button', 'replay-button', 'Restart');
      restart.type = 'button';
      restart.onclick = () => this.restart();
      transport.append(this.playButton, restart);
      this.speedButtons = [];
      for (const speed of [0.5, 1, 2]) {
        const button = node('button', 'replay-button replay-speed', `${speed}×`);
        button.type = 'button';
        button.dataset.speed = String(speed);
        button.setAttribute('aria-pressed', String(speed === 1));
        button.onclick = () => this.setSpeed(speed);
        this.speedButtons.push(button);
        transport.append(button);
      }
      const timeline = node('div', 'replay-timeline');
      this.elapsed = node('span', 'replay-clock', '0:00.00');
      this.seekInput = node('input', 'replay-seek');
      Object.assign(this.seekInput, { type: 'range', min: '0', max: '0', step: '0.001', value: '0' });
      this.seekInput.setAttribute('aria-label', 'Replay position');
      this.seekInput.disabled = true;
      this.seekInput.addEventListener('input', () => this.seek(Number(this.seekInput.value)));
      this.total = node('span', 'replay-clock', '0:00.00');
      timeline.append(this.elapsed, this.seekInput, this.total);
      controls.append(transport, timeline);
      this.controls.append(this.backGame);
      this.el.append(controls);
    } else {
      this.el.append(this.backGame);
    }
    document.body.append(this.el);
  }

  async load() {
    try {
      if (!['ghost', 'replay'].includes(this.mode)) throw new Error('Choose either Race ghost or Watch run, not both.');
      if (!/^[A-Za-z0-9_-]{8,40}$/.test(this.id ?? '')) throw new Error('This replay link has an invalid run ID.');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      let res, payload;
      try {
        res = await fetch(`${apiBase()}/replay/${encodeURIComponent(this.id)}`, { credentials: 'omit', signal: controller.signal });
        try { payload = await res.json(); }
        catch (err) { if (err?.name === 'AbortError') throw err; payload = null; }
      } catch (err) {
        if (err?.name === 'AbortError') throw new Error('The replay request took too long. Try again later.');
        throw err;
      } finally { clearTimeout(timeout); }
      if (!res.ok) {
        const message = res.status === 404 ? 'This run is no longer available.' :
          payload?.message || `The replay server returned ${res.status}.`;
        throw new Error(message);
      }
      if (!payload?.replay || typeof payload.replay !== 'object') throw new Error('The server did not return a replay for this run.');
      const fingerprint = await this.fingerprint;
      validateReplay(payload.replay, fingerprint);
      this.actor = await ReplayActor.create({ scene: this.scene, world: this.world, replay: payload.replay,
        ghost: this.mode === 'ghost' });
      this.actor.seek(0);
      this.name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'Mystery Can';
      this.recordedTime = Number.isFinite(payload.time) ? payload.time : 0;
      this.duration = Math.max(0, Number(this.actor.duration) || 0);
      this.ready = true;
      if (this.mode === 'replay') this.follow?.snap(this.actor, this.world);
      this.chip.textContent = `${this.mode === 'ghost' ? 'Ghost' : 'Replay'}: ${this.name} · ${clockMs(this.recordedTime)}`;
      this.status.textContent = this.mode === 'ghost' ? 'Start climbing when you’re ready.' : 'Playing · 1×';
      this.el.classList.add('replay-ready');
      if (this.mode === 'replay') {
        this.seekInput.max = String(this.duration);
        this.total.textContent = clockMs(this.duration * 1000);
        this.seekInput.disabled = false;
      }
      return true;
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'The replay could not be loaded.');
      return false;
    }
  }

  fail(message) {
    this.error = message;
    this.ready = false;
    this.status.textContent = message;
    this.status.setAttribute('role', 'alert');
    this.backGame.hidden = false;
    this.el.classList.add('replay-error');
  }

  update(dt, { gameTime = this.game.time, titleVisible = false } = {}) {
    if (!this.ready || !this.actor) return;
    if (this.mode === 'ghost') this.time = titleVisible ? 0 : Math.max(0, gameTime);
    else if (this.playing) {
      this.time = Math.min(this.duration, this.time + Math.max(0, dt) * this.speed);
      if (this.time >= this.duration) this.playing = false;
    }
    this.actor.seek(this.time);
    if (this.mode === 'replay') this.syncControls();
    else {
      const status = titleVisible ? 'Start climbing when you’re ready.' : this.game.done ?
        `Summit reached · ${clockMs(gameTime * 1000)}` : 'Racing the ghost.';
      if (this.status.textContent !== status) this.status.textContent = status;
    }
  }

  worldTime() {
    return this.actor ? this.actor.phase + this.time : null;
  }

  togglePlay() {
    if (!this.ready) return;
    if (!this.playing && this.time >= this.duration) {
      this.time = 0;
      this.actor.seek(0);
      this.follow?.snap(this.actor, this.world);
    }
    this.playing = !this.playing;
    this.syncControls();
  }

  restart() {
    if (!this.ready) return;
    this.time = 0;
    this.playing = true;
    this.actor.seek(0);
    this.follow?.snap(this.actor, this.world);
    this.syncControls();
  }

  setSpeed(speed) {
    if (![0.5, 1, 2].includes(speed)) return;
    this.speed = speed;
    this.speedButtons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === speed)));
  }

  seek(seconds) {
    if (!this.ready) return;
    const previous = this.time;
    this.time = Math.min(this.duration, Math.max(0, Number(seconds) || 0));
    this.actor.seek(this.time);
    if (this.time < previous - 0.01 || Math.abs(this.time - previous) > 1.5) this.follow?.snap(this.actor, this.world);
    this.syncControls();
  }

  syncControls() {
    if (!this.seekInput) return;
    this.playButton.textContent = this.playing ? 'Pause' : 'Play';
    this.playButton.setAttribute('aria-label', this.playing ? 'Pause replay' : 'Play replay');
    this.playButton.setAttribute('aria-pressed', String(this.playing));
    this.seekInput.value = String(this.time);
    this.elapsed.textContent = clockMs(this.time * 1000);
    const status = this.time >= this.duration ? 'Replay finished.' : this.playing ? `Playing · ${this.speed}×` : 'Paused.';
    if (this.status.textContent !== status) this.status.textContent = status;
  }

  toggleGhost() {
    if (!this.actor || this.mode !== 'ghost') return;
    this.hidden = !this.hidden;
    this.actor.root.visible = !this.hidden;
    this.toggleButton.textContent = this.hidden ? 'Show ghost' : 'Hide ghost';
    this.toggleButton.setAttribute('aria-pressed', String(!this.hidden));
  }

  exitToHall() {
    if (this.isRunActive() && !confirm('Leave this climb? Your current run will be lost.')) return;
    const url = this.cleanUrl();
    url.searchParams.set('hall', '1');
    location.assign(url.href);
  }

  backToGame() {
    if (this.isRunActive() && !confirm('Leave this climb? Your current run will be lost.')) return;
    location.assign(this.cleanUrl().href);
  }

  cleanUrl() {
    const url = new URL(location.href);
    url.searchParams.delete('ghost');
    url.searchParams.delete('replay');
    url.searchParams.delete('hall');
    return url;
  }

  dispose() {
    this.actor?.dispose();
    this.el?.remove();
    document.body.classList.remove('replay-watch', 'replay-race');
  }
}

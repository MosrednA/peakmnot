// @ts-check
// Ties effects and music to game events, with one shared unlock and Sound setting.
import { PeakMusic } from '../music.js';

/** @typedef {{jump: undefined, lost: undefined, land: {hard: boolean}}} PlayerAudioEvents */
/** @typedef {{respawn: {flat: boolean}, summit: undefined}} GameAudioEvents */
/** @typedef {{on: <K extends keyof PlayerAudioEvents>(name: K, fn: (event: PlayerAudioEvents[K]) => void) => void,
 * anim: {footstep: () => 'Walk'|'Run'|null}, mode: 'ground'|'air'|'beam'|'out', vy: number, speed: number,
 * pos: {x: number, y: number, z: number}}} AudioPlayer */
/** @typedef {{on: <K extends keyof GameAudioEvents>(name: K, fn: (event: GameAudioEvents[K]) => void) => void,
 * world: {checkpoints: Array<{at: {x: number, y: number, z: number}}>}, done: boolean}} AudioGame */
/** @typedef {{on: (name: 'show'|'start', fn: () => void) => void}} AudioTitle */

/** @param {{sounds: import('../sounds.js').MnotSounds, player: AudioPlayer, game: AudioGame, button: HTMLButtonElement}} options */
export function hookSounds({ sounds, player, game, button }) {
  const music = sounds.music = new PeakMusic(sounds);
  let titleShown = document.body.classList.contains('title-up');
  music.setScene(titleShown ? 'camp' : 'climb');
  const refresh = () => {
    button.textContent = sounds.enabled ? 'Sound on' : 'Sound off';
    button.setAttribute('aria-pressed', String(sounds.enabled));
  };
  const setEnabled = sounds.setEnabled.bind(sounds);
  sounds.setEnabled = (on) => { setEnabled(on); refresh(); };
  button.onclick = () => sounds.setEnabled(!sounds.enabled);
  button.addEventListener('mousedown', e => e.preventDefault());   // keep Space from clicking it
  refresh();
  // browsers allow audio after a real gesture
  addEventListener('pointerdown', e => { if (e.isTrusted) void sounds.unlock(); }, { capture: true });
  addEventListener('keydown', e => { if (e.isTrusted) void sounds.unlock(); }, { capture: true });
  addEventListener('blur', () => sounds.pause());
  addEventListener('focus', () => sounds.resume());

  player.on('jump', () => sounds.play('jump'));
  player.on('land', ({ hard }) => { sounds.stopFall(); sounds.play(hard ? 'land-hard' : 'land-soft'); });
  player.on('lost', () => { sounds.startFall(); music.duck(0.24); });
  game.on('respawn', () => { sounds.stopFall(); music.duck(1); });
  game.on('summit', () => music.summit());

  // call once per step, after the player has moved
  return {
    music,
    // Call after creating the title; its page-load show event may already have fired.
    /** @param {AudioTitle} title */
    attachTitle(title) {
      titleShown = document.body.classList.contains('title-up');
      music.setScene(titleShown ? 'camp' : 'climb');
      title.on('show', () => { titleShown = true; music.setScene('camp'); });
      title.on('start', () => { titleShown = false; music.setScene('climb'); });
    },
    update() {
      const camp = game.world.checkpoints[0];
      const restingAtCamp = camp && player.mode === 'ground' && player.speed < 0.03
        && Math.hypot(player.pos.x - camp.at.x, player.pos.y - camp.at.y, player.pos.z - camp.at.z) < 3;
      music.setScene(titleShown || restingAtCamp && !game.done ? 'camp' : 'climb');
      const gait = player.anim.footstep();
      if (gait) sounds.step(gait);
      // the whoosh for a longer fall
      if (player.mode === 'air' && player.vy < -7) sounds.startFall();
      else if (player.mode !== 'out') sounds.stopFall();
    },
  };
}

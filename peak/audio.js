// Ties Codex's MnotSounds (sounds.js) to what happens in the game: steps, jumps, landings and the falling whoosh.
export function hookSounds({ sounds, player, game, button }) {
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
  player.on('lost', () => sounds.startFall());
  game.on('respawn', () => sounds.stopFall());

  // call once per step, after the player has moved
  return {
    update() {
      const gait = player.anim.footstep();
      if (gait) sounds.step(gait);
      // the whoosh for a longer fall
      if (player.mode === 'air' && player.vy < -7) sounds.startFall();
      else if (player.mode !== 'out') sounds.stopFall();
    },
  };
}

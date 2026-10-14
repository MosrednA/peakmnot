// The HUD's moving parts every mini game has, styled by kit.css: the toast that pops a big line over the play and a
// small one under it, a card that pops in again, the Sound button, and the audio unlock on the first real gesture.

// The toast (#toast: a <b> and a <small class="card">). toast(big, small, kind) shows it for `seconds`; kind is ''
// (white), 'checkpoint' (mint) or 'oops' (coral). toast.once(key, …) says a thing only the first time,
// toast.said is what once() has said, toast.left the seconds the one up now has left. toast.update(dt) once a frame.
export function toaster(el, seconds = 2.4) {
  const toast = (big, small = '', kind = '') => {
    el.className = '';
    void el.offsetWidth;                          // restart the pop
    el.className = `show ${kind}`;
    el.querySelector('b').textContent = big;
    const line = el.querySelector('small');
    line.textContent = small;
    line.hidden = !small;
    toast.left = seconds;
  };
  toast.left = 0;
  toast.said = new Set();
  toast.once = (key, ...args) => { if (!toast.said.has(key)) { toast.said.add(key); toast(...args); } };
  toast.update = dt => {
    toast.left -= dt;
    if (toast.left <= 0 && el.classList.contains('show')) el.className = '';
  };
  return toast;
}

// A card (hidden until now, or up already) pops in again, kit.css's `pop` animation from the start.
export function pop(el) {
  el.hidden = true;
  void el.offsetWidth;
  el.hidden = false;
}

// The HUD's Sound button (#sound) switches the sound and shows it (aria-pressed; the title screen's mirrors it).
// Audio starts on the first real key or tap: a browser allows it only then. A touch counts at pointerup and
// touchend on some phones, not at pointerdown, so all of them unlock.
export function soundSwitch(sounds, button) {
  const sync = () => button.setAttribute('aria-pressed', String(sounds.enabled));
  sync();
  button.addEventListener('click', () => { sounds.setEnabled(!sounds.enabled); sync(); button.blur(); });
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
    addEventListener(type, e => { if (e.isTrusted) void sounds.unlock(); }, { capture: true });
  }
  return sync;
}

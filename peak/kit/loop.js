// The frame loop, the preloader and the handle for tests, the same in every mini game. The loop measures each frame,
// lets the post-processing adapt its quality to it, steps the game by it (at most 50 ms, so a stall or a tab coming
// back doesn't fling anything) and draws. The preloader (peak/ui/preload.css, the page's #preload) stays up until the
// first frame is on screen. In ?manual there's no loop: the game stands still until a test steps it, the same way
// every time, through window.<game>.step(seconds, dt) (expose()).
import * as THREE from 'three';

// step(dt) moves the game on, render() draws it
export function startLoop({ manual = false, post, step, render }) {
  let revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    document.body.classList.remove('preloading');
    const cover = document.getElementById('preload');
    if (manual) cover?.remove();
    else { cover?.classList.add('done'); setTimeout(() => cover?.remove(), 600); }
  }
  if (manual) { reveal(); return; }
  const timer = new THREE.Timer();
  timer.connect(document);
  function frame(timestamp) {
    timer.update(timestamp);
    post.adapt(timer.getDelta());
    step(Math.min(timer.getDelta(), 0.05));
    render();
    requestAnimationFrame(frame);
    if (!revealed) requestAnimationFrame(reveal);
  }
  requestAnimationFrame(frame);
}

// The game's handle for the console and the tests, window[name]: what's in `api` (getters too), plus
// step(seconds, dt), which moves the game on by `seconds` in steps of `dt` and draws a frame (pass dt: a hidden tab
// has no frames of its own), and render().
export function expose(name, api, { step, render }) {
  api.step = (seconds = 1 / 60, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) step(dt); render(); };
  api.render = render;
  window[name] = api;
  return api;
}

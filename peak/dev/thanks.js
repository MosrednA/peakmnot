// The end of a perf run (perf.js): it goes to the server (server/perf.py), and once it's there Mnot says thank you.
// Mnot dances on the summit in bursts of confetti, and a card (thanks.css, the HUD's cream and ink) says how smoothly
// this computer drew the climb, with a nerdy joke and another on request. The numbers stay behind a button.
import { apiBase } from '../scores/scores.js';
import { look } from './bots.js';

// Peak Mnot is the nerds digging too deep into a detail; a benchmark is that, with a table at the end.
const JOKES = [
  'Mnot timed everything twice, ABBA style: with, without, without, with. Mamma mia.',
  'No cans were dented in the making of these numbers. Well. A few.',
  "There are 10 kinds of computers: those that ran this test, and those that didn't. Yours is the good kind.",
  'If your laptop got warm just now, that was Mnot. Give it a hug.',
  'Every frame was waited for with readPixels, like a proper scientist. Peer review pending.',
  "The rock shader used to paint rock under the snow too, where nobody could see it. We've had a word with it.",
  'Your graphics card has been weighed, measured, and found to be a graphics card.',
  "Somewhere, a fan is spinning down. You're welcome.",
  "It's not a bug, it's a benchmark.",
  'Draw calls made: hundreds. Phone calls made: zero. A perfect introvert run.',
  'Mnot asked whether this counts as cardio. It does not.',
  'The sky is drawn last now, so it only paints where no rock is in the way. Lazy sky. Smart sky.',
  'Peak performance? Peak Mnot performance.',
  'Your numbers are in a JSON file now. That is the highest honour a number can get.',
  'Mnot drew the same summit thirty times in a row, to be sure. Not obsessive: statistics.',
  'Results may vary. Mostly with the size of your screen, and the size of your GPU\'s ego.',
  'Fun fact: Mnot has no idea what a GPU is. It just knows it likes yours.',
  'This run took about as long as an intro of the podcast. Without the tangents.',
  '60 frames a second, or it didn\'t happen.',
  'Mnot would like to thank its GPU, its CPU, and above all its big glasses.',
];

// "ANGLE (AMD, AMD Radeon(TM) Graphics (0x000013C0) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "AMD Radeon Graphics"
export const gpuName = gpu => (gpu.match(/^ANGLE \([^,]+, (.+?)(?: \(0x[0-9A-Fa-f]+\))?(?: Direct3D|, |\)$)/)?.[1] ??
  gpu).replace(/^ANGLE Metal Renderer: |\((TM|R)\)/gi, '').replace(/\s+/g, ' ').trim();

// Sends a run to the server; says how that went.
export async function share(run) {
  try {
    const answer = await fetch(`${apiBase()}/perf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run),
    });
    return answer.ok ? { ok: true, say: 'Sent to the Peak Mnot server. Thank you!' }
      : { ok: false, say: `Not sent (${answer.status}): please copy it with the button below.` };
  } catch {
    return { ok: false, say: 'Not sent (no connection): please copy it with the button below.' };
  }
}

const how = fps => {
  const n = Math.round(fps);
  if (fps >= 55) return `Smooth as a freshly opened can: about ${n} frames a second, all the way up.`;
  if (fps >= 40) return `It kept up nicely, at about ${n} frames a second. A wobble here and there, but so does ` +
    'Mnot on the rope.';
  if (fps >= 25) return `It worked hard: about ${n} frames a second at full sharpness. When you play, the game turns ` +
    'the sharpness down by itself, so it runs smoother than that.';
  return `That was heavy going, at about ${n} frames a second. Exactly the kind of computer we needed numbers from, ` +
    'so: double thanks.';
};

// The card, over Mnot dancing on the summit; `numbers` is the box with the table (none for ?perf=thanks).
export async function thank(peak, { by = null, fps = 0, drawn = 0, tris = 0, gpu = '' }, numbers = null) {
  await styled();
  numbers?.style.setProperty('display', 'none');
  document.body.classList.add('perf-thanks');
  dance(peak);
  const veil = document.createElement('div');
  veil.className = 'pt-veil';
  veil.innerHTML = `<div class="pt-card card" role="dialog" aria-labelledby="pt-title">
      <div class="pt-can" aria-hidden="true"><div class="pl-can"><i></i><i></i></div></div>
      <span class="pt-spark" style="left: calc(50% - 64px); top: -2px">✦</span>
      <span class="pt-spark" style="left: calc(50% + 50px); top: -16px; animation-delay: 0.9s">✦</span>
      <span class="pt-spark small" style="left: calc(50% + 62px); top: 16px; animation-delay: 1.6s">✦</span>
      <h1 id="pt-title"></h1>
      <p class="pt-lead"></p>
      <p class="pt-how"></p>
      <div class="pt-joke"><b>P.S.</b> <span></span>
        <button type="button" class="pt-more">Another one</button></div>
      <p class="pt-soft">It has all reached the Peak Mnot server: graphics chip, screen and browser, no IP address.
        You can close this tab.</p>
      <div class="pt-buttons">
        <button type="button" class="pt-play">Climb Peak Mnot</button>
        <button type="button" class="pt-numbers">Raw numbers</button>
      </div>
    </div>`;
  const $ = selector => veil.querySelector(selector);
  $('h1').textContent = by ? `Thanks, ${by}!` : 'Thank you!';
  $('.pt-lead').textContent = `Your ${gpu ? gpuName(gpu) : 'computer'} just drew ${drawn.toLocaleString('en')} ` +
    `pictures of a soda can on a mountain: about ${Math.round(tris).toLocaleString('en')} million triangles, and ` +
    'Mnot wrote every one of them down.';
  $('.pt-how').textContent = fps ? how(fps) : '';
  const bag = [];
  const joke = () => {
    if (!bag.length) bag.push(...JOKES.map(j => [Math.random(), j]).sort((a, b) => a[0] - b[0]).map(([, j]) => j));
    $('.pt-joke span').textContent = bag.pop();
  };
  joke();
  $('.pt-more').onclick = () => {
    joke();
    peak.moments.confetti(24);
  };
  $('.pt-play').onclick = () => location.assign(location.pathname);
  if (numbers) {
    // the table as it was (perf.js), with Copy, and a way back to the card
    const back = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Back to the card' });
    back.style.cssText = `${numbers.querySelector('button')?.style.cssText ?? ''};margin-right:6px`;
    numbers.append(back);
    const show = raw => {
      veil.hidden = raw;
      numbers.style.display = raw ? '' : 'none';
    };
    $('.pt-numbers').onclick = () => show(true);
    back.onclick = () => show(false);
  } else $('.pt-numbers').remove();
  document.body.append(veil);
}

// thanks.css, through the same v/BUILD/ path as this module; on before the card shows, so it never flashes unstyled
function styled() {
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet',
    href: new URL('./thanks.css', import.meta.url).href });
  return new Promise(done => {
    link.onload = link.onerror = done;
    setTimeout(done, 3000);
    document.head.append(link);
  });
}

// Mnot on the summit, dancing for as long as the tab is open, with a burst of confetti every few seconds; the
// camera holds its summit close-up while Mnot celebrates (camera.js). On a narrow screen the card sits at the top,
// so the picture slides down a fifth of the screen to keep Mnot below it.
function dance(peak) {
  const { player, moments, world, camera } = peak;
  const narrow = matchMedia('(max-width: 640px)');
  look(peak, world.summit.at.toArray(), Math.PI);
  moments.confetti(70);
  let last = 0, next = 2;
  const frame = t => {
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 0;
    last = t;
    if (narrow.matches) camera.setViewOffset(camera.aspect, 1, 0, -0.2, camera.aspect, 1);
    else if (camera.view?.enabled) camera.clearViewOffset();
    if (dt > 0) {
      player.idleClip = moments.playing = 'Dance';
      player.celebrate = 0.5;
      peak.step(dt, dt / Math.ceil(dt * 60 - 1e-6));
      if ((next -= dt) <= 0) {
        moments.confetti(30);
        next = 2.5 + 2 * Math.random();
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

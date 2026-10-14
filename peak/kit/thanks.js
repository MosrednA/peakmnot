// The end of a perf run (perf.js), the same in every mini game: it goes to the server (server/perf.py), and once it's
// there Mnot says thank you. The game plays something under the card (the climb: Mnot dancing on the summit; the
// downhill: the finish party), and the card (thanks.css, the HUD's cream and ink) says how smoothly this computer
// drew it, with a nerdy joke and another on request. The numbers stay behind a button.
import { apiBase } from '../scores/scores.js';

// Peak Mnot is the nerds digging too deep into a detail; a benchmark is that, with a table at the end. Each game adds
// its own (card()'s jokes).
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
  'Your numbers are in a JSON file now. That is the highest honour a number can get.',
  'Results may vary. Mostly with the size of your screen, and the size of your GPU\'s ego.',
  'Fun fact: Mnot has no idea what a GPU is. It just knows it likes yours.',
  'This run took about as long as an intro of the podcast. Without the tangents.',
  '60 frames a second, or it didn\'t happen.',
  'Mnot would like to thank its GPU, its CPU, and above all its big glasses.',
];

// "ANGLE (AMD, AMD Radeon(TM) Graphics (0x000013C0) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "AMD Radeon Graphics"
export const gpuName = gpu => (gpu.match(/^ANGLE \([^,]+, (.+?)(?: \(0x[0-9A-Fa-f]+\))?(?: Direct3D|, |\)$)/)?.[1] ??
  gpu).replace(/^ANGLE Metal Renderer: |\((TM|R)\)/gi, '').replace(/\s+/g, ' ').trim();

// Sends a run to the server (this game's /api/<game>/perf); says how that went.
// board: the game's on the score server ('peak', 'downhill')
export async function share(run, board) {
  try {
    const answer = await fetch(`${apiBase(location, board)}/perf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run),
    });
    return answer.ok ? { ok: true, say: 'Sent to the Peak Mnot server. Thank you!' }
      : { ok: false, say: `Not sent (${answer.status}): please copy it with the button below.` };
  } catch {
    return { ok: false, say: 'Not sent (no connection): please copy it with the button below.' };
  }
}

// way: 'up' or 'down'; wobble: who else wobbles
const how = (fps, { way, wobble }) => {
  const n = Math.round(fps);
  if (fps >= 55) return `Smooth as a freshly opened can: about ${n} frames a second, all the way ${way}.`;
  if (fps >= 40) return `It kept up nicely, at about ${n} frames a second. A wobble here and there, but so does ` +
    `${wobble}.`;
  if (fps >= 25) return `It worked hard: about ${n} frames a second at full sharpness. When you play, the game turns ` +
    'the sharpness down by itself, so it runs smoother than that.';
  return `That was heavy going, at about ${n} frames a second. Exactly the kind of computer we needed numbers from, ` +
    'so: double thanks.';
};

// The card, over what the game plays under it; `numbers` is the box with the table (none for ?perf=thanks). The
// game's words: pictures (of what), way and wobble (how()), play (the button back to the game), its own jokes, and
// dance() and more(): what plays under the card, and a burst of confetti for each joke more.
export async function thank({ by = null, fps = 0, drawn = 0, tris = 0, gpu = '' }, numbers, words) {
  const { pictures, play, jokes = [] } = words;
  await styled();
  numbers?.style.setProperty('display', 'none');
  document.body.classList.add('perf-thanks');
  words.dance();
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
        <button type="button" class="pt-play"></button>
        <button type="button" class="pt-numbers">Raw numbers</button>
      </div>
    </div>`;
  const $ = selector => veil.querySelector(selector);
  $('h1').textContent = by ? `Thanks, ${by}!` : 'Thank you!';
  $('.pt-lead').textContent = `Your ${gpu ? gpuName(gpu) : 'computer'} just drew ${drawn.toLocaleString('en')} ` +
    `pictures of ${pictures}: about ${Math.round(tris).toLocaleString('en')} million triangles, and ` +
    'Mnot wrote every one of them down.';
  $('.pt-how').textContent = fps ? how(fps, words) : '';
  const bag = [];
  const joke = () => {
    if (!bag.length) {
      bag.push(...[...JOKES, ...jokes].map(j => [Math.random(), j]).sort((a, b) => a[0] - b[0]).map(([, j]) => j));
    }
    $('.pt-joke span').textContent = bag.pop();
  };
  joke();
  $('.pt-more').onclick = () => {
    joke();
    words.more();
  };
  $('.pt-play').textContent = play;
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

// The page of all the games (games.html, at /games): a card for each game, with a shot from about a quarter of the
// way in, and one for the next. A new game adds its card to games.html (with its goal, analytics.js) and its shot
// here (800 x 500, a JPEG), and a tab to the viewer (.claude/skills/mini-game/SKILL.md, "The files").
import { hookAnalytics } from './analytics.js';

hookAnalytics(document);

const THUMBS = {
  climb: new URL('./climb.jpg', import.meta.url),
  downhill: new URL('./downhill.jpg', import.meta.url),
  emoji: new URL('./emoji.jpg', import.meta.url),
};
for (const img of document.querySelectorAll('img[data-thumb]')) img.src = THUMBS[img.dataset.thumb];

// The routes (/, /downhill, /emoji, /viewer) are the score server's, live and on 5294 (PAGES in
// server/peak_scores.py). The dev server (tools/dev_server.py, on 5280, the downhill's 5293 or Reaction Run's 5296)
// serves each page by its file, and the viewer at /.
if ({ 5280: true, 5293: true, 5296: true }[location.port]) {
  for (const a of document.querySelectorAll('a[data-file]')) a.href = a.dataset.file;
}

// the logo's letters each bob a little after the one before, with snow on top (peak/ui/title.css, .ts-logo)
const logo = document.getElementById('logo');
const name = logo.textContent.trim();
logo.setAttribute('aria-label', name);
logo.textContent = '';
[...name.toUpperCase()].forEach((ch, i) => {
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  if (ch === ' ') span.className = 'gap';
  else {
    Object.assign(span, { className: 'l', textContent: ch });
    span.dataset.l = ch;
    span.style.setProperty('--i', i);
  }
  logo.append(span);
});

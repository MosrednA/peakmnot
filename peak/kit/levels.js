// Levels: every mini game is made for more than one, even while it has one. A level is a short id (a-z, 0-9; ''
// for the first) that the page is asked for with ?level=<id>, and on the score server a board of its own, with its
// runs, its replays and its route (server/games.py): /api/<game>/ for the first level, so a game keeps its board when
// it grows a second, and /api/<game>-<level>/ for each other one. A link to a level, its Hall of Fame, a ghost or a
// replay keeps the ?level= it was made on, so a replay always plays on the level it was ridden on.
const ID = /^[a-z0-9]{1,16}$/;

// The level this page is asked for: one of the game's ids (its first when the URL names none, or one it hasn't).
export function pickLevel(levels = [''], loc = location) {
  const want = new URLSearchParams(loc.search).get('level') ?? '';
  return levels.includes(want) && (want === '' || ID.test(want)) ? want : levels[0];
}

// A level's board on the score server: the game's own name for the first level.
export const boardName = (game, level = '') => (level ? `${game}-${level}` : game);

// A link to a level of this page: ?level= set, or gone for the first.
export function levelUrl(level, loc = location) {
  const url = new URL(loc.href);
  if (level) url.searchParams.set('level', level);
  else url.searchParams.delete('level');
  return url;
}

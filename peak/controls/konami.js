// The Konami code on the keyboard: up, up, down, down, left, right, left, right, B, A. Calls back for the party in
// moments.js. It reads the keys by what they say (e.key), so B and A work on any layout, and it leaves typing in a text
// field alone (the name on the summit card). The arrows and A still move Mnot as usual on the way.
const CODE = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright',
  'b', 'a'];

export function onKonami(fn) {
  const last = [];
  addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    last.push(e.key.toLowerCase());
    if (last.length > CODE.length) last.shift();
    if (last.length === CODE.length && last.every((key, i) => key === CODE[i])) {
      last.length = 0;
      fn();
    }
  });
}

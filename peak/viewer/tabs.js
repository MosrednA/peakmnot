// The viewer's tabs: Mnot (main.js: the model and its clips, walked and jumped with the keys) and one for each mini
// game, with what that game adds to Mnot (the downhill's: the office chair, its moves and the finish party). A game's
// tab is its own module, peak/<game>/viewer.js, loaded the first time the tab is opened: its createTab({ sounds })
// builds its own canvas and buttons, shares the viewer's sound switch and gives back { show(), hide() }. The tab
// stays in the address (index.html#downhill), so a reload opens it again.
// A new mini game adds its line to GAMES (.claude/skills/mini-game/SKILL.md, "The files").
const GAMES = [
  { id: 'downhill', label: 'Downhill', load: () => import('../downhill/viewer.js') },
];

// mnot: the Mnot tab's { show(), hide() }
export function startTabs({ sounds, mnot }) {
  const bar = document.getElementById('tabs');
  const tabs = [{ id: 'mnot', label: 'Mnot', view: mnot }, ...GAMES.map(game => ({ ...game, view: null }))];
  let current = tabs[0], wanted = current;
  for (const tab of tabs) {
    const b = tab.button = document.createElement('button');
    b.textContent = tab.label;
    b.setAttribute('role', 'tab');
    b.onclick = () => {
      history.replaceState(null, '', tab === tabs[0] ? location.pathname + location.search : `#${tab.id}`);
      open(tab);
    };
    bar.appendChild(b);
  }

  // the tab that's showing stays up until the new one has loaded
  async function open(tab) {
    wanted = tab;
    for (const t of tabs) {
      t.button.classList.toggle('on', t === tab);
      t.button.setAttribute('aria-selected', String(t === tab));
    }
    if (!tab.view) {
      tab.button.classList.add('loading');
      tab.loading ??= tab.load().then(module => module.createTab({ sounds }));
      try {
        tab.view = await tab.loading;
      } catch (error) {
        tab.loading = null;
        console.error(`The ${tab.label} tab didn't load:`, error);
      }
      tab.button.classList.remove('loading');
      if (wanted !== tab) return;                 // another tab was picked meanwhile
      if (!tab.view) { open(current); return; }
    }
    if (tab === current) return;
    current.view.hide();
    current = tab;
    tab.view.show();
  }

  const fromAddress = () => open(tabs.find(t => `#${t.id}` === location.hash) ?? tabs[0]);
  addEventListener('hashchange', fromAddress);
  fromAddress();
}

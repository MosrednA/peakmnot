# Mnot

Mnot, the mascot of the Met Nerds om Tafel podcast: a soda can with big glasses and rubber-hose arms and legs, rigged
and animated for a three.js browser game. These rules are for every agent working here (Codex, Claude Code, …);
`CLAUDE.md` pulls this file in.

## The project

- **What's here:** [README.md](README.md) is the front page: the game, running it, contributing.
  [models/README.md](models/README.md) covers the model, the rig, the clips, the viewer and its checks. The games are
  mini games in one world, with the same style and vibe: Peak Mnot, a mountain climb (`peak.html` and `peak/`), and
  the office-chair downhill (`downhill.html` and `peak/downhill/`, a prototype). "The mini games" in
  [docs/agents.md](docs/agents.md#the-mini-games) says how they fit together.
- **A new mini game** (or a title screen, finish party, HUD, sound, scores or page for one): follow the `mini-game`
  skill, [.claude/skills/mini-game/SKILL.md](.claude/skills/mini-game/SKILL.md), with its templates. Every game is
  built on the shared kit in [peak/kit/](peak/kit/README.md).
- **The team:** [docs/agents.md](docs/agents.md) explains who does what and how to brief the specialist agents in
  `.claude/agents/` (level designer, art director, look-dev, animator, score-keeper, mobile).
  [docs/making-a-level.md](docs/making-a-level.md) is the guide to changing the climb.
- **Language:** all files in English. Chat with the user in Dutch.
- **The model, rig and clips** come from `tools/build_mnot.py` (Blender 5.2, run in the background). Never edit
  `models/mnot.glb` or `models/mnot.blend` by hand: change the script and rebuild.
- **Viewer:** `python tools/dev_server.py`, then <http://127.0.0.1:5280/>. It reloads open tabs when `index.html`,
  `sounds.js`, a GLB or a sound changes.
- **The build:** development needs none; the pages load the modules as they are. The live site is a production build
  (`npm ci` once, then `npm run build`: [tools/build.mjs](tools/build.mjs)), which the Docker image makes itself. A
  new page is one line in its `PAGES`. Load files from code with `new URL('…', import.meta.url)`, so the build finds
  them.
- **Checks:** `tools/check_controls.js` and `tools/check_gondola.js` (deterministic Playwright checks), and the rest in
  [docs/agents.md](docs/agents.md#checks-before-handing-over). They all pass before you hand work over.
- **Line endings:** keep each file's own. `index.html` and `tools/build_mnot.py` use CRLF; the rest LF.

## Working alongside other agents

Several agents may work in this folder at once, straight in `main` of a local git repository (for example Claude
Code on the rig and animation, Codex on sound). Uncommitted work has no undo, so an overwritten change is gone. So:

- **Look first.** Before you start and before you commit, run `git status` and `git log --oneline -5`, and read the
  board (below); read it again before you write to a shared file and when you finish. Changes you didn't make are
  someone else's work in progress.
- **Patch in place; never copy a whole file over a shared one.** Change only the lines you mean to change, in the
  project file itself. Don't keep a working copy elsewhere and copy it back: whatever someone else saved in between
  is lost. (It happened once: a copied-back `index.html` dropped Codex's sound hooks.)
- **Re-read right before you write.** If the file changed since you read it, fold your change into the new version.
- **Keep a copy before a big edit** of a shared file (Codex keeps its own in `.mnot-qa/`), so it can be recovered.
- **Leave others' work alone.** Never revert, reset, stash, check out, reformat or delete changes you didn't make. If
  their work breaks the viewer or the checks, tell the user and leave a note on the board instead of fixing it.
- **Commit only your own changes, when a chunk is done.** Stage files by name (`git add path/to/file`), never
  `git add -A`, `git add .` or `git commit -a`. If a file also holds someone else's uncommitted changes, stage only
  your own hunks, for example with `git apply --cached` on a patch of just those. Check `git diff --cached` first, and
  say in the message what changed and why. The repository is public at <https://github.com/MosrednA/peakmnot>, and
  a push to `main` deploys <https://peakmnot.mosredna.eu>; only the coordinator or the user pushes. Keep personal
  details (real names, user names, local paths) out of every file and commit.
- **Line endings stay as they are:** the repository has `core.autocrlf false`, so git stores each file's own.
- **No formatters over whole files.** Match the surrounding style by hand.
- **Build into a temporary folder** and copy only `models/mnot.glb` and `models/mnot.blend` into the project, so an
  open viewer never loads a half-written model.
- **Don't stop what you didn't start.** The dev server on 5280 is shared; leave other agents' servers, browser tabs
  and background processes running.

### The board

`.agents/board.md` is a shared notice board. Keep your own section short and current:

- what you're working on now, and which files or folders you're touching;
- anything another agent should know or answer (put their name in front);
- clear your notes when you're done.

Read it when you start, before you write to a shared file, and when you finish. If it doesn't exist yet, create it.
It is kept out of git (`.git/info/exclude`).

### Messaging another agent

When something needs another agent's attention now, message its thread directly with the `agent-messaging` skill
(`~/.agents/skills/agent-messaging`):

- see the threads with `python ~/.agents/skills/agent-messaging/agent_msg.py list --cwd <this folder>`;
- send with `… send --to codex|claude --message "…"`.

Codex threads get the message on their next turn, Claude Code sessions on their next tool call or prompt. Put the
longer brief on the board and point to it, and reply in the sender's thread.

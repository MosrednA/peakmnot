# The team

Peak Mnot is made by a human with opinions, the maintainer, and AI coding agents working side by side in the same
folder. This page is for anyone who opens the repository, people and agents alike. It covers who does what, how
the agents keep out of each other's way, and how to put the same specialists to work on your own idea.

The house rules every agent follows are in [AGENTS.md](../AGENTS.md). This page is the longer story around them.

## Who does what

| Who | What they do | Where they work |
|---|---|---|
| **The maintainer** | Decides what the game becomes, plays it, gives feedback, and owns the live site | Everywhere |
| **The coordinator** (Claude Code's main session) | Turns a wish into briefs, starts the specialists, reviews their work, runs the checks, commits, pushes, and checks the deploy | Everywhere; the only agent that commits on `main` |
| **Codex** | Sound effects and music | `sounds.js`, `music.js`, `audio/`, `peak/audio.js` |
| **The specialists** (sub-agents in [`.claude/agents/`](../.claude/agents/)) | One area each, below | The files of their area |

A push to `main` deploys the live game, so only the coordinator or the maintainer pushes. On a fork, work on a
branch and open a pull request instead.

## The specialists

Each specialist is a Markdown file in `.claude/agents/`. It says what the job is, what to read first, which files are
the specialist's own, how to test, and what a good report looks like.

| Agent | Its job | Its files | Ask it for |
|---|---|---|---|
| [`level-designer`](../.claude/agents/level-designer.md) | The climb: ledges, gaps, beams, hazards, the camera rail, how Mnot moves, the test bots | `peak/world/`, the route's geometry in `route.js`, `peak/mnot/player.js` and its helpers, `peak/game.js`, `peak/ui/quips.js`, `peak/dev/bots.js` | A new stretch, a new mechanic, tuning a jump |
| [`art-director`](../.claude/agents/art-director.md) | Every shot charming, motivated and clean: props, signs, flags, the camp, the camera's framing | `peak/props/`, `peak/controls/camera.js`, the prop lines in `route.js` | An art pass, a new prop or sign, "something overlaps" |
| [`look-dev`](../.claude/agents/look-dev.md) | The picture itself: the rock shader, light, sky, clouds, post-processing, the HUD's style, frame rate | `peak/look/`, `peak/ui/` styles, the head and CSS of `peak.html` | Prettier snow, warmer light, a smoother frame rate |
| [`animator`](../.claude/agents/animator.md) | Mnot's animation clips, built in Blender from code, and the moments that play them | `tools/build_mnot.py`, `models/`, `peak/mnot/mnot.js`, `pose.js`, `moments.js` | A new animation, a fidget, a celebration |
| [`score-keeper`](../.claude/agents/score-keeper.md) | The high-score server and its anti-cheat, which checks every recorded climb | `server/`, `peak/scores/` | A leaderboard feature, a cheat to stop, a false alarm |
| [`mobile`](../.claude/agents/mobile.md) | Playing on phones and tablets: touch controls, small screens, phone performance | `peak/controls/touch.js`, `touch.css`, the stick in `input.js` | Anything that feels wrong under a thumb |

The areas overlap at the edges. `route.js` is shared between the level designer (the geometry) and the art director
(the props). `peak/main.js` and `peak.html` take one-line hooks from anyone. Each file's first comment says what
it does, and [peak/README.md](../peak/README.md) has the full module table.

## How they work together

- **The house rules** ([AGENTS.md](../AGENTS.md)). Look first (`git status`, `git log`, the board). Patch shared
  files in place, changing only your own lines. Re-read a file right before you write it. Never revert or reformat
  someone else's work. Keep each file's line endings.
- **The board.** `.agents/board.md` is a notice board kept out of git. Each agent has a short section: what it's
  doing now, which files it touches, and questions for others, with their name in front. Agents clear their notes
  when they're done.
- **Ownership.** When several specialists run at once, each brief says which files are theirs and who else is busy
  where. Two agents never rewrite the same file. Shared files get small, separate edits.
- **Specialists don't commit.** They leave their changes in the working tree and report. Whoever started them
  reviews the diff, runs the checks and commits, staging files by name.
- **Messages.** On the maintainer's machine, running agents can message each other's threads (see AGENTS.md). Without
  that, the board is enough.

A change usually goes like this:

1. The maintainer says what they want, in their own words ("Mnot should wobble on the edge of a rock").
2. The coordinator reads the code involved and writes a brief for each specialist: the wish, the goal, its files,
   who else is busy, and what "done" means.
3. The specialists build and test in the browser with the test bots. Then they report what they changed, which
   files, how they checked it and what's still open.
4. The coordinator reviews, plays the result, runs the checks, and commits by file name.
5. A push to `main` deploys, and the coordinator checks the live site.

## Using the specialists yourself

- **In Claude Code**, the files in `.claude/agents/` are picked up automatically. Ask for one by name ("use the
  level-designer agent to add a stretch with a swinging bridge"), or let the main session pick. You can run several
  at once if their files don't overlap: tell each one which files are its own.
- **In another agent** (Codex, Cursor, …), hand it the file as its brief: "Read `.claude/agents/level-designer.md`
  and work as that agent: …". The frontmatter at the top is only metadata.
- **As a person**, read the files as a map: they say what lives where, what matters in each area, and how it's
  tested.

### A brief that works

A specialist starts with an empty head, so give it everything it can't find in the repository:

- **The wish in the requester's own words**, and what it means in practice.
- **The goal**: what should be true when it's done, and for whom ("a player who stops at an edge has a moment to
  save Mnot; a run-up and a jump never get in the way").
- **Its files for this job**, and what others are busy with at the same time.
- **What "done" means**: the checks below, and anything specific ("the bot still summits in 75–100 s").
- **The report you want**: what changed and why, the files, how it was verified (screenshots, bot results), open
  questions.

## Checks before handing over

Every specialist runs the checks for its area. Before a commit, all of these pass:

| Check | How |
|---|---|
| The whole climb | `bots.climb` in `peak.html?manual` reaches the summit ([peak/README.md](../peak/README.md#tuning-with-the-bots)) |
| The score server | `python -m unittest discover server` |
| The analytics events | `node --test tools/check_analytics.mjs` |
| The replay motion | `node --test tools/check_replay_playback.mjs`: samples, strides, turns, clip blends and deterministic seeks |
| The replay controls | `tools/check_replays.js` with `python tools/replay_test_server.py` on 5291: watch, ghost race, scrubbing and moving ledges |
| The animation viewer | `tools/check_controls.js`, deterministic Playwright checks on `index.html` |
| The gondola | `tools/check_gondola.js`: carried at the pallet's own speed, whatever the frame times |
| The console | No errors in the browser console, on the title screen and while climbing |
| The docs | The folder's README is updated for what changed |

After a route change, `server/route.json` has to be exported again too
([making a level](making-a-level.md#the-high-scores)).

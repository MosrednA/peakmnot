# Documentation

[Mnot Games](../README.md) is the front page: choose a game, run the project and contribute.

| Reference | Covers |
|---|---|
| [Multi-game setup](multi-game.md) | Pages and routes, shared modules, game-specific code and adding a game |
| [The team](agents.md) | Specialist ownership, shared-worktree coordination and checks before handing over |
| [Making a level](making-a-level.md) | The climb's route, mechanics, test bots and score route export |
| [Performance](performance.md) | Measurement tools, findings and remaining work for the climb and downhill |
| [The climb](../peak/README.md) | Rules, controls, module reference, events, analytics and tests |
| [The downhill](../peak/downhill/README.md) | Prototype rules, controls, chair physics, scores, modules and tests |
| [The mini-game kit](../peak/kit/README.md) | Shared stage, loop, HUD, title, party, controller and analytics APIs |
| [The score server](../server/README.md) | Multi-game API, verification, SQLite, configuration and production serving |
| [Mnot's model and viewer](../models/README.md) | Model generation, rig, clips, viewer tabs and animation checks |
| [Audio](../audio/README.md) | Sound palette, processing and regeneration |
| [Mini-game skill](../.claude/skills/mini-game/SKILL.md) | The implementation recipe and templates for a new game |

Keep these references current with the implementation. A game owns its rules and module list in its folder's
README; shared architecture belongs in the multi-game guide and the kit and server references. When adding a game,
update the front page, the guide's route table and the team's game table, alongside the game's own README.

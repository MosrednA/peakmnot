"""The mini games the score server keeps a board for, and what is each game's own: the route its runs are checked
against, the replay checker, the house records and the words its jokes use. Everything else is shared: one database
(db.py), one API under /api/<game>/ (api.py), and one player per browser, with the same name in every game.

A new game is:
- its route as data (exported from the game) and a checker for its runs: server/<game>.py, on checks.py's shared
  checks, which hold for any game;
- a Game in load() below, with its house records and any words of its own;
- its page, <game>.html, which peak_scores.py serves at /<game> once the name is in NAMES;
- in the page, peak/scores/scores.js's createRun() and createBoard() for /api/<game>/.
"""

NAMES = ("peak", "downhill")        # the first is the one at /

# (id, name, quip, time ms, falls, dents): slow, silly runs, so a fresh board isn't empty and any real run beats
# them. Nobody can claim one, improve it or take its name (store.py). The climb's came with db.py's migration 2.
PEAK_HOUSE = (
    ("house-pi", "while(true) climb()", "Started at boot. Still going. Will never return.", 194150, 3, 1),
    ("house-404", "404: Peak Not Found", "Looked everywhere for the summit. It was up.", 244000, 4, 4),
    ("house-56k", "Dial-up Dave", "Loading the next ledge… 56 falls, one per kbit.", 312000, 56, 3),
    ("house-tau", "git push --force", "Rewrote the mountain's history. Twice. Tau, not pi.", 388300, 6, 2),
    ("house-1337", "Ctrl+Alt+Defeat", "Rebooted at every checkpoint. Very leet, very slow.", 817000, 13, 37),
)
# The downhill's: falls are spills, dents lost wheels.
DOWNHILL_HOUSE = (
    ("house-ooo", "Out of Office", "Auto-reply: away on the mountain until further notice.", 162000, 1, 0),
    ("house-sudo", "sudo roll --down", "Asked for root at every pit stop. Rounded pi up, too.", 194160, 3, 1),
    ("house-reply-all", "Reply All", "Took the whole lane down. And the office. And the thread.", 213330, 2, 5),
    ("house-bsod", "Blue Screen of Snow", "Crashed at the ski jump. Collected some error info. Restarted.",
     300000, 4, 2),
    ("house-caster", "Caster Troy", "Lost all five casters. Then a sixth. Faced off with a pine.", 366060, 3, 6),
    ("house-gary", "€49 Gary", "Rode the knock-off. It held. Mostly. Gary wants it back.", 469000, 4, 5),
    ("house-undo", "Ctrl+Z Ctrl+Z", "Undid every turn. The mountain kept them anyway.", 488080, 8, 2),
    ("house-meeting", "Meeting, Rescheduled", "Moved the run to next week. Then the week after.", 570000, 5, 3),
    ("house-obo", "Off-by-one Error", "Aimed for 10:24. Missed by one. Of course.", 623990, 1, 1),
    ("house-factorial", "O(n!) Slalom", "Tried every line past every rock, in every order. 4! = 24 spills.",
     880000, 24, 0),
)

# What the downhill's jokes say instead of the climb's (eggs.py: LOUD and SHADOW by code, and the shame list's note).
DOWNHILL_WORDS = {
    "too_fast_split": "Nice try: that stretch would take {can_ps:.0f} can-lengths a second. Even an office chair "
                      "on five fresh casters tops out at about {legs:.0f}.",
    "skipped_split": "You skipped a pit stop. The casters don't change themselves.",
    "burned": "I'm a teapot. This run is over; it rolled down the mountain with the last cheat.",
    "expired": "This run went flat: runs expire after a few hours, just like an open can.",
    "route": "The mountain has moved since this page loaded. Reload and ride the new one.",
    "oversized": "That payload is bigger than the mountain. Mnot rides with hand luggage only.",
    "too_fast": "Nice try: {can_ps:.0f} can-lengths a second. Even on five fresh casters the chair tops out at "
                "about {legs:.0f}.",
    "teleport": "Mnot Downhill detected: office chairs don't teleport. Not even the expensive ones.",
    "antigravity": "Mnot Downhill detected: chairs roll down. Newton checked.",
    "levitate": "Mnot Downhill detected: office chairs don't hover, not even with the gas lift all the way up.",
    "off_route": "That's not the piste. That's a different mountain. Possibly in a different game.",
    "respawn": "Back on the piste somewhere new? A spill only sends the chair back to the last pit stop.",
    "spacebar": "Jumping without pulling the lever? The gas lift is springy, but not that springy.",
    "start": "That run didn't start at the gate. Helicopters aren't allowed.",
    "finish": "Crossing the finish line while sitting somewhere else? Bold strategy.",
    "skipped": "A pit stop went missing from your run. The casters don't change themselves.",
    "bonus": "That's more time off the clock than the bowling and the ski jump give. The judges checked.",
    "shame_note": "Runs that didn't add up. Their riders were told they came first.",
}


class Game:
    """One game's board as the server knows it.

    route: what its runs are checked against; .fingerprint, .checkpoints (the first is the start; a split comes in
    for each of the others) and .segments() (metres and the least seconds of each stretch, the last one to the
    finish). verify(route, replay, claim, splits): None for a good run, else a checks.Rejection; raises
    checks.Malformed for a replay that isn't one. speed: m/s, the most the game goes, for the jokes. claim: the
    numbers the finish sends; time, falls and dents go on the board, and a game with time off the clock sends the
    clock too. perf: the climb's ?perf runs (perf.py) go to /api/<game>/perf."""

    def __init__(self, name, route, verify, speed, house=(), words=None, claim=("time", "falls", "dents"),
                 perf=False):
        self.name, self.route, self.verify, self.speed = name, route, verify, speed
        self.house, self.words, self.claim, self.perf = tuple(house), words or {}, tuple(claim), perf

    def clock_ms(self, claim):
        """The game's clock at the finish, for the wall-clock checks: the board's time unless time came off it."""
        return claim.get("clock", claim["time"])


def load(peak_route=None, downhill_route=None):
    """Every game, its route loaded (or the one given, for tests), in NAMES' order."""
    import downhill
    import route
    import verify
    peak = peak_route or route.Route.load()
    hill = downhill_route or downhill.Route.load()
    return [
        Game("peak", peak, verify.verify, peak.run_speed, house=PEAK_HOUSE, perf=True),
        Game("downhill", hill, downhill.verify, hill.top_speed, house=DOWNHILL_HOUSE, words=DOWNHILL_WORDS,
             claim=("time", "clock", "bonus", "falls", "dents")),
    ]

"""What the score server says to someone poking at it. Nothing here ever reaches a legitimate player's screen: the
game shows its own neutral text for any error, and the jokes live in JSON fields and the X-Mnot-Says header that
only devtools show.

Two kinds of answer:
- loud: the request itself is impossible (a forged signature, a reused nonce, a split from the future, a body the
  size of a fridge). An HTTP error with a joke.
- shadow: the request is well-formed but the climb in it isn't physically possible. The answer looks like a
  triumph (rank #1!), the board stays clean, and the run goes to the Hall of Shame (GET /api/<game>/shame).

The words are the climb's; another game (games.py) can say any of them its own way, by code.
"""
import random
import re

CAN = 0.122                          # metres: a 330 ml can, the unit of choice

LOUD = {
    # code: (status, message)
    "teapot": (418, "I'm a teapot, and you're not a can."),
    "stale": (418, "I'm a teapot. That nonce has already been drunk; they're single-use, like a can of soda."),
    "burned": (418, "I'm a teapot. This climb is over; it went down the mountain with the last cheat."),
    "forged_secret": (403, "That's not your secret. Mnot never forgets a face, and it doesn't have one for you."),
    "house": (403, "That's a house record. It came with the mountain: you can beat it, you can't be it."),
    "oversized": (413, "That payload is bigger than the mountain. Mnot climbs with hand luggage only."),
    "malformed": (400, "Mnot squinted at that through its big glasses and still couldn't read it."),
    "rate": (429, "Easy there. Mnot is a can, not a CDN. Have a sip and try again in a bit."),
    "not_found": (404, "Nothing up here but thin air and a nice view."),
    "expired": (410, "This climb went flat: runs expire after a few hours, just like an open can."),
    "too_fast_split": (422, "Nice try: that stretch would take {can_ps:.0f} can-lengths a second. Mnot's little legs "
                            "top out at about {legs:.0f}."),
    "skipped_split": (422, "You skipped a checkpoint. The flags are there for a reason: Mnot likes a flag."),
    "time_travel": (422, "This climb finished before it started. Doc Brown would like his DeLorean back."),
    "duplicate": (418, "I'm a teapot, and I've heard this one before."),
    "route": (409, "The mountain has moved since this page loaded. Reload and climb the new one."),
    "probe": (418, "Nothing here but carbonation. The admin panel is a soda can; it has no admin panel."),
    "method": (405, "Mnot only knows GET and POST. It's a can, not a REST purist."),
}

SHADOW = {
    # reason: what the shame list and the header say
    "too_fast": "Nice try: {can_ps:.0f} can-lengths a second. Mnot's little legs top out at about {legs:.0f}.",
    "teleport": "Peak Mnot detected: cans don't teleport. Not even with Shift held.",
    "antigravity": "Peak Mnot detected: cans fall down. Newton checked.",
    "levitate": "Peak Mnot detected: standing on thin air is a cartoon thing, and Mnot only looks like a cartoon.",
    "moonwalk": "Moving without pressing a key? Shift is for careful steps; there's no key for 'moonwalk'.",
    "beam_speed": "Sprinting across a tightrope? Holding Shift makes Mnot careful, not fast.",
    "gondola": "You rode a gondola that was on the other side of the gap. Bold.",
    "off_route": "That's not the mountain. That's a different mountain. Possibly in a different game.",
    "respawn": "Respawned somewhere new? The clouds only send Mnot back to where it was safe.",
    "spacebar": "Jumping without pressing Space? Mnot's legs are springy, but not that springy.",
    "edited": "This replay has been edited. The director's cut doesn't go on the board.",
    "start": "That climb didn't start at base camp. Helicopters aren't allowed.",
    "summit": "Celebrating at the summit while standing somewhere else? Bold strategy.",
    "skipped": "A checkpoint went missing from your replay. Mnot likes a flag.",
    "timeline": "The clock in this replay runs sideways. Mnot's runs forwards.",
    "finish": "Celebrating at the finish while standing somewhere else? Bold strategy.",
    "bonus": "That's more time off the clock than the run earned. The judges checked.",
}

SAYINGS = [
    "Stay hydrated. Stay carbonated.",
    "Big glasses, bigger ambitions.",
    "Met Nerds om Tafel. Mnot at the summit.",
    "Shift for careful steps. There is no Shift for careful cheating.",
    "Fun fact: the rope is 6.3 m. That's 51 cans.",
    "The summit is up. The API is sideways.",
    "If you're reading headers, you're one of us. Hi!",
    "Mnot's top speed is about 17 can-lengths a second. Don't tell it.",
]

ROBOTS = """User-agent: *
Disallow: /api/
# Robots may not climb the mountain. Mnot climbs alone.
# If you are a can, you're welcome; please use the stairs.
"""

WELL_KNOWN = {
    "name": "Mnot",
    "species": "soda can (330 ml)",
    "glasses": "big",
    "arms": "rubber hose",
    "podcast": "Met Nerds om Tafel",
    "hint": "The fastest way to the top of the board is the mountain. The API only knows how to say no in funny ways.",
}

PROBES = ("/.env", "/admin", "/wp-admin", "/wp-login.php", "/phpmyadmin", "/.git", "/config", "/server-status",
          "/api/peak/admin", "/api/peak/debug", "/api/peak/scores", "/api/peak/cheat", "/xmlrpc.php", "/.aws")
API_PROBES = re.compile(r"^/api/[a-z]+/(admin.*|debug|scores|cheat)$")      # the same in any game's API


def probe(path):
    path = path.rstrip("/").lower()
    return path in PROBES or bool(API_PROBES.match(path))


def saying():
    return random.choice(SAYINGS)


def speed_words(metres_per_second, legs=2.083):
    return {"can_ps": metres_per_second / CAN, "legs": legs / CAN}


def loud(code, words=None, **numbers):
    status, message = LOUD[code]
    message = (words or {}).get(code, message)
    return status, message.format(**numbers) if numbers else message


def shadow(reason, words=None, **numbers):
    message = (words or {}).get(reason) or SHADOW.get(reason, SHADOW["edited"])
    try:
        return message.format(**numbers)
    except (KeyError, IndexError, ValueError):
        return message.replace("{can_ps:.0f}", "a lot of").replace("{legs:.0f}", "17")

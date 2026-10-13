"""Names on the board: whatever the player typed, made safe and polite. The game only ever shows names as text
(textContent), so this isn't what stops HTML; it keeps the board readable and friendly.

clean(raw) -> (name, note): note is a line for the player when their name was changed, or None.
"""
import re
import secrets
import unicodedata

MAX_LENGTH = 20
PUNCTUATION = set(" .,-_'!?#&+()*~:@<>")
MARKS_PER_LETTER = 2             # accents yes, zalgo no

# Code that someone typed hoping a page would run it. Little Bobby Tables has a cousin.
INJECTION = re.compile(r"""<\s*/?\s*[a-z!]|\bon[a-z]+\s*=|javascript\s*:|\$\{|\{\{|\b(union\s+select|drop\s+table|
    insert\s+into|delete\s+from)\b|'\s*(or|and)\s+['\d]|;\s*--|\bselect\b.+\bfrom\b|\x00""", re.I | re.X)

# A small list, English and Dutch. Short words only count as a whole word ("Bass" is fine); long ones anywhere.
WORDS = {"ass", "cum", "dick", "cock", "fag", "sex", "tit", "tits", "kut", "lul", "pik", "hoer", "slet", "teef",
         "neuk", "nazi", "rape", "twat", "slut", "penis", "eikel", "anus", "tering", "flikker", "pedo"}
ANYWHERE = {"fuck", "shit", "cunt", "nigger", "nigga", "faggot", "retard", "whore", "bitch", "pussy", "asshole",
            "wanker", "kanker", "tyfus", "klootzak", "hitler", "mongool", "godver", "neuken", "vagina", "porno",
            "bastard"}
LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s",
                      "!": "i", "|": "i", "+": "t"})

BOBBY = "Little Bobby Cans"
NOTES = {
    "bobby": "Little Bobby Tables has a cousin now. Your name is stored as text, not run as code.",
    "polite": "Mnot washed that name's mouth out with soda.",
    "house": "That name belongs to a house record. Beat it on the mountain; the name stays theirs.",
}


def number():
    return 1000 + secrets.randbelow(9000)


def mystery():
    return f"Mystery Can #{number()}"


def taken(name, reserved):
    """Whether name is one of reserved, give or take case, spacing, punctuation and leetspeak."""
    key = lambda text: "".join(c for c in unicodedata.normalize("NFKC", text).casefold().translate(LEET) if c.isalnum())
    return key(name) in {key(r) for r in reserved}


def _letters(text):
    """Lower case, no accents, leetspeak undone: what a word filter looks at."""
    plain = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in plain if not unicodedata.combining(c)).translate(LEET)


def rude(text):
    letters = _letters(text)
    squashed = re.sub(r"[^a-z]", "", letters)
    stretched = re.sub(r"(.)\1+", r"\1", squashed)          # "fuuuck"
    if any(word in squashed or word in stretched for word in ANYWHERE):
        return True
    tokens = set(re.findall(r"[a-z]+", letters))
    # "k u t" or "k.u.t": single letters spelling a short word
    spelled = "".join(t for t in re.findall(r"[a-z]+", letters) if len(t) == 1)
    return bool(tokens & WORDS) or spelled in WORDS


def tidy(raw):
    """NFKC, no control or invisible characters, a few accents per letter, letters/digits/symbols and a little
    punctuation, single spaces, at most MAX_LENGTH characters."""
    text = unicodedata.normalize("NFKC", raw)
    out, marks = [], 0
    for c in text:
        cat = unicodedata.category(c)
        if cat[0] == "C":                     # Cc, Cf (zero-width, bidi), Co, Cs, Cn
            continue
        if cat in ("Mn", "Me", "Mc"):
            marks += 1
            if marks > MARKS_PER_LETTER or not out:
                continue
            out.append(c)
            continue
        marks = 0
        if cat[0] == "Z":
            out.append(" ")
        elif cat[0] in "LN" or cat == "So" or c in PUNCTUATION:
            out.append(c)
    name = re.sub(r"\s+", " ", "".join(out)).strip()
    if len(name) > MAX_LENGTH:
        name = name[:MAX_LENGTH].rstrip()
    while name and unicodedata.category(name[0])[0] == "M":
        name = name[1:]
    return name


def clean(raw):
    if raw is None:
        return mystery(), None
    if not isinstance(raw, str):
        raise ValueError("name")
    raw = raw[:200]
    if INJECTION.search(raw):
        return BOBBY, NOTES["bobby"]
    name = tidy(raw)
    if not name or not any(unicodedata.category(c)[0] in "LN" or unicodedata.category(c) == "So" for c in name):
        return mystery(), None
    if rude(name):
        return f"Polite Can #{number()}", NOTES["polite"]
    return name, None

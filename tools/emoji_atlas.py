"""Make the emoji game's sticker sheet from the community's Slack emoji (the mnot-emojis repository).

Each pick is cut out as a sticker (a white rim round its shape) in a 128 px cell of one WebP sheet, and its outline
traced, so the game can make it a thick die-cut token (an extrusion of the outline, the sticker on both faces). The
names, cells and outlines go in a module beside the sheet, so the game loads one small texture instead of a thousand
files. An animated GIF gives its first frame.

    python tools/emoji_atlas.py [--src ../mnot-emojis]

Writes peak/emoji/emojis.webp and peak/emoji/sheet.js. The picks are in PICKS below: no photos of real people, no
politics, and no two that look the same (spa and mnot are one can).
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "peak" / "emoji"
CELL = 128          # px a sticker
INNER = 100         # px the emoji itself, at most, inside the rim
RIM = 7             # px of white round its shape
COLUMNS = 8
SOLID = 128         # alpha from which a pixel is part of the token
CRUMB = 60          # px: a piece smaller than this is left out of the outline (its pixels stay in the sheet)
TOLERANCE = 0.9     # px an outline may stray from the traced edge

PICKS = [
    # snacks
    "bapao", "bbq", "bittergarnituur", "broodje-kroket", "frikandel-speciaal", "frituur", "kapsalon", "kibbeling",
    "kroket", "stroopwafel", "worstenbrood", "popcorn-groot", "cookie-clicker", "oliebol", "nugget", "kaassouffle",
    # things
    "toiletrol-voor", "badum", "caravan", "clippy", "cursor", "broken-wifi", "bitcoin", "terminal", "kurk",
    "fishing-pole", "fluit", "alarm", "raptor", "axolotl", "birb", "spaghetti-monster", "cubimal_chick", "party-poop",
    "this-is-fine", "upvote", "dont-panic", "1337", "yolo", "vlammenwerper-2", "wesp", "police", "cone-of-shame",
    "nerdbier", "mnot", "chefskiss",
    # parrots: alike on purpose, for the hard levels
    "partyparrot", "christmasparrot", "hardhat-parrot", "nerd-parrot", "headset-parrot", "sadparrot", "wineparrot",
    "nederland-parrot",
    # the prize at the end of every list, in the middle of the field (never dealt)
    "peak-mnot",
]

# the eight neighbours of a pixel, clockwise from the west, as (dy, dx)
AROUND = [(0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1)]


def sticker(path: Path) -> Image.Image:
    """The emoji fitted in INNER px, with a white rim round its shape, centred in a CELL px square."""
    im = Image.open(path)
    im.seek(0)
    im = im.convert("RGBA")
    scale = INNER / max(im.size)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    at = ((CELL - im.width) // 2, (CELL - im.height) // 2)
    shape = Image.new("L", (CELL, CELL), 0)
    shape.paste(im.getchannel("A").point(lambda a: 255 if a > 40 else 0), at)
    rim = shape.filter(ImageFilter.MaxFilter(RIM * 2 + 1)).filter(ImageFilter.GaussianBlur(0.8))
    cell.paste((255, 255, 255, 255), (0, 0), rim)
    cell.alpha_composite(im, at)
    return cell


def pieces(solid: np.ndarray) -> list[np.ndarray]:
    """The separate pieces of a mask (8-connected), each a mask of its own with its holes filled."""
    h, w = solid.shape
    seen = np.zeros_like(solid)
    found = []
    for y, x in zip(*np.nonzero(solid)):
        if seen[y, x]:
            continue
        piece = np.zeros_like(solid)
        stack = [(y, x)]
        seen[y, x] = True
        while stack:
            cy, cx = stack.pop()
            piece[cy, cx] = True
            for dy, dx in AROUND:
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if piece.sum() >= CRUMB:
            found.append(fill(piece))
    return found


def fill(piece: np.ndarray) -> np.ndarray:
    """A piece with its holes filled: everything the outside can't reach."""
    h, w = piece.shape
    outside = np.zeros_like(piece)
    stack = [(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)]
    while stack:
        y, x = stack.pop()
        if not (0 <= y < h and 0 <= x < w) or outside[y, x] or piece[y, x]:
            continue
        outside[y, x] = True
        stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
    return ~outside


def trace(piece: np.ndarray) -> list[tuple[int, int]]:
    """The edge of a piece, as its edge pixels (x, y) in order round it (Moore-neighbour tracing)."""
    ys, xs = np.nonzero(piece)
    start = (int(ys[0]), int(xs[0]))          # the top row's first pixel: its west is outside
    h, w = piece.shape
    inside = lambda y, x: 0 <= y < h and 0 <= x < w and piece[y, x]
    edge, here, back = [start], start, 0      # back: the direction we came in from, an index in AROUND
    for _ in range(4 * h * w):
        for turn in range(1, 9):
            d = (back + turn) % 8
            y, x = here[0] + AROUND[d][0], here[1] + AROUND[d][1]
            if inside(y, x):
                # the neighbour checked just before, seen from the new pixel, is where the scan goes on from
                py, px = here[0] + AROUND[(d - 1) % 8][0], here[1] + AROUND[(d - 1) % 8][1]
                back = AROUND.index((py - y, px - x))
                here = (y, x)
                break
        else:
            break                             # a single pixel
        if here == start:
            break
        edge.append(here)
    return [(x, y) for y, x in edge]


def simplify(points: list[tuple[int, int]], tolerance: float) -> list[tuple[int, int]]:
    """Ramer-Douglas-Peucker on a closed loop: split it at the point furthest from the first, simplify both halves."""
    def rdp(run):
        if len(run) < 3:
            return run
        (x0, y0), (x1, y1) = run[0], run[-1]
        length = max(1e-9, ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5)
        far, at = 0, 0
        for i, (x, y) in enumerate(run[1:-1], 1):
            d = abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / length
            if d > far:
                far, at = d, i
        if far <= tolerance:
            return [run[0], run[-1]]
        return rdp(run[:at + 1])[:-1] + rdp(run[at:])
    if len(points) < 4:
        return points
    x0, y0 = points[0]
    split = max(range(len(points)), key=lambda i: (points[i][0] - x0) ** 2 + (points[i][1] - y0) ** 2)
    return rdp(points[:split + 1])[:-1] + rdp(points[split:] + [points[0]])[:-1]


def outlines(cell: Image.Image) -> list[list[int]]:
    """The token's outline: one flat [x, y, x, y, …] loop (cell px, y down) a piece, the biggest first."""
    solid = np.array(cell.getchannel("A")) >= SOLID
    found = sorted(pieces(solid), key=lambda p: -int(p.sum()))
    return [[v for point in simplify(trace(p), TOLERANCE) for v in point] for p in found]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--src", type=Path, default=ROOT.parent / "mnot-emojis",
                        help="the mnot-emojis repository (its emojis/ folder holds the files)")
    args = parser.parse_args()
    files = {p.stem: p for p in (args.src / "emojis").iterdir()}
    missing = [name for name in PICKS if name not in files]
    if missing:
        raise SystemExit(f"not in {args.src / 'emojis'}: {', '.join(missing)}")
    rows = -(-len(PICKS) // COLUMNS)
    sheet = Image.new("RGBA", (COLUMNS * CELL, rows * CELL), (0, 0, 0, 0))
    shapes = []
    for i, name in enumerate(PICKS):
        cell = sticker(files[name])
        sheet.alpha_composite(cell, (i % COLUMNS * CELL, i // COLUMNS * CELL))
        shapes.append(outlines(cell))
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / "emojis.webp", "WEBP", quality=88, method=6)
    names = "".join(f"  {json.dumps(name)},\n" for name in PICKS)
    loops = "".join(f"  {json.dumps(loops, separators=(',', ':'))},\n" for loops in shapes)
    (OUT / "sheet.js").write_text(
        "// Made by tools/emoji_atlas.py: the stickers in emojis.webp, row by row, `cell` px each, and each one's\n"
        "// outline for its token: a loop of [x, y, x, y, …] in its cell's px (y down) a piece, the biggest first.\n"
        f"export const SHEET = {{ cell: {CELL}, columns: {COLUMNS}, rows: {rows}, names: [\n{names}] }};\n"
        f"export const OUTLINES = [\n{loops}];\n",
        encoding="utf-8", newline="\n")
    points = sum(len(loop) // 2 for loops in shapes for loop in loops)
    print(f"{len(PICKS)} stickers, {(OUT / 'emojis.webp').stat().st_size // 1024} KB, {points} outline points")


if __name__ == "__main__":
    main()

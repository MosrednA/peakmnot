"""Generate Mnot's small sound palette with ElevenLabs; the API key stays in the environment."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "audio" / "source"
MODEL = "eleven_text_to_sound_v2"
STYLE = (
    "Cosy game SFX for a tiny plush-like mascot. Warm, rounded, cushioned and very soft. "
    "Dry and isolated. No metal, rattle, creak, crackle, hiss, music or voices. "
)


@dataclass(frozen=True)
class Sound:
    name: str
    prompt: str
    duration: float
    loop: bool = False


@dataclass(frozen=True)
class Generation:
    name: str
    prompt: str
    duration: float
    loop: bool
    model: str
    character_cost: int | None
    source: str


SOUNDS = [
    Sound("walk-1", "One single tiny soft rubber slipper footstep on a felt-covered surface. A quiet warm rounded tup, pillowy and cute. Immediate onset, short smooth decay, only one footfall.", 0.5),
    Sound("walk-2", "One single gentle cushioned rubber shoe footstep on soft felt. A little muted dup with a rounded low body, like a small plush character walking. Immediate onset, short smooth decay, only one footfall.", 0.5),
    Sound("walk-3", "One single light padded slipper footstep on a soft mat. A warm mellow pup, with a smooth soft attack and short pillowy decay. Immediate onset, only one footfall.", 0.5),
    Sound("run-1", "One single quick tiny cushioned rubber shoe footfall on a soft mat. A compact springy muted tup, light and rounded. Immediate onset, very short smooth decay, only one footfall.", 0.5),
    Sound("run-2", "One single nimble padded slipper footfall on felt. A tiny mellow bouncing dup, quick but soft, like a little plush toy jogging. Immediate onset, very short smooth decay, only one footfall.", 0.5),
    Sound("jump", "One short soft rubber spring jump: a compressed bup releases into a round playful boing. A tiny plush character pushes off a cushion. Warm rubbery body, gentle attack and a short springy tail. No air, wind, whoosh or swoosh. Immediate onset, one jump.", 0.5),
    Sound("land-soft", "One gentle two-shoe landing on a thick soft mat. A little warm pillowy thup with a very short rounded rubber settling tail. Immediate onset, smooth decay, one soft landing.", 0.7),
    Sound("land-hard", "One slightly deeper cushioned landing on a thick pillow. A warm soft low pumf and a tiny rounded rubber bounce, comforting and playful. Immediate onset, smooth short decay, one impact.", 0.85),
    Sound("wave", "A single friendly greeting gesture as two tiny warm round liquid bubbles, bloop blup, quietly rising in pitch. Mellow soft attack, smooth little tail. Non-vocal and non-musical. Immediate onset, one short gesture.", 0.7),
    Sound("fall", "Seamless cartoon balancing loop: a tiny character awkwardly windmills its arms in mid-air. Soft elastic whup-whup flaps with a gently wobbling pitch and a few tiny rounded rubber plips. Mild playful slapstick, warm and understated. No big boing, whistle, crash or voices.", 2.4, True),
]


def generate(sound: Sound, api_key: str, replace: bool) -> Generation:
    path = OUTPUT / f"{sound.name}.mp3"
    metadata_path = path.with_suffix(".json")
    if not replace and path.exists() and metadata_path.exists():
        return Generation(**json.loads(metadata_path.read_text(encoding="utf-8")))
    if len(STYLE + sound.prompt) > 450:
        raise ValueError(f"Sound prompt exceeds the API's 450-character limit: {sound.name}")
    payload = {
        "text": STYLE + sound.prompt,
        "duration_seconds": sound.duration,
        "prompt_influence": 0.5,
        "model_id": MODEL,
        "loop": sound.loop,
    }
    request = Request(
        "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
        data=json.dumps(payload).encode(),
        headers={"xi-api-key": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=120) as response:
            data = response.read()
            content_type = response.headers.get("Content-Type", "")
            if not content_type.startswith("audio/") or len(data) < 1000:
                raise RuntimeError(f"Unexpected audio response for {sound.name}: {content_type}")
            cost = response.headers.get("character-cost")
    except HTTPError as error:
        detail = error.read().decode(errors="replace").replace(api_key, "[redacted]")
        raise RuntimeError(f"ElevenLabs {error.code} for {sound.name}: {detail[:400]}") from None
    path.write_bytes(data)
    metadata = Generation(sound.name, payload["text"], sound.duration, sound.loop, MODEL,
                          int(cost) if cost else None, path.relative_to(ROOT).as_posix())
    metadata_path.write_text(json.dumps(asdict(metadata), indent=2) + "\n", encoding="utf-8")
    print(f"Generated {sound.name}: {len(data)} bytes, character-cost={cost}", flush=True)
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("names", nargs="*", help="Optional sound names; existing outputs are reused.")
    parser.add_argument("--replace", action="store_true", help="Regenerate selected sounds using API credits.")
    args = parser.parse_args()
    available = {sound.name for sound in SOUNDS}
    if set(args.names) - available:
        parser.error("Unknown sound name")
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise SystemExit("ELEVENLABS_API_KEY is not available.")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    selected = [sound for sound in SOUNDS if not args.names or sound.name in args.names]
    with ThreadPoolExecutor(max_workers=2) as pool:
        metadata = list(pool.map(lambda sound: generate(sound, api_key, args.replace), selected))
    print(json.dumps({"sounds": len(metadata), "character_cost": sum(
        item.character_cost or 0 for item in metadata)}, indent=2))


if __name__ == "__main__":
    main()

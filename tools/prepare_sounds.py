"""Trim and level the generated effects, and export a small listening preview."""

from dataclasses import asdict, dataclass
import json
from pathlib import Path
import subprocess

import numpy as np
from scipy.signal import butter, resample_poly, sosfiltfilt
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
RATE = 44100
OUTPUT_RATE = 22050
LIMITS = {"walk-1": 0.2, "walk-2": 0.2, "walk-3": 0.2, "run-1": 0.16, "run-2": 0.16,
          "jump": 0.6, "land-soft": 0.45, "land-hard": 0.6, "wave": 0.6}


@dataclass(frozen=True)
class PreparedSound:
    name: str
    file: str
    duration: float
    peak: float
    rms: float
    onset: float
    source_trim: float
    loop: bool


def decode(path: Path) -> np.ndarray:
    result = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
                             "-ac", "1", "-ar", str(RATE), "-f", "f32le", "pipe:1"],
                            capture_output=True, check=True)
    return np.frombuffer(result.stdout, dtype=np.float32).copy()


def prepare(path: Path) -> tuple[PreparedSound, np.ndarray]:
    name = path.stem
    x = decode(path)
    x -= np.mean(x)
    cutoff = 1800 if name == "fall" else 3000
    x = sosfiltfilt(butter(2, cutoff, fs=RATE, output="sos"), x)
    trim = 0.0
    if name == "fall":
        overlap = int(RATE * 0.012)
        angle = np.linspace(0, np.pi / 2, overlap)
        seam = x[-overlap:] * np.cos(angle) + x[:overlap] * np.sin(angle)
        x = np.concatenate([x[overlap:-overlap], seam])
        x *= min(0.08 / max(float(np.sqrt(np.mean(x * x))), 1e-6), 0.35 / np.max(np.abs(x)))
    else:
        window = int(RATE * 0.005)
        rms = np.sqrt(np.convolve(x * x, np.ones(window) / window, mode="same"))
        active = np.flatnonzero(rms > max(float(np.max(rms)) * 0.035, 0.0001))
        if not len(active):
            raise ValueError(f"Silent generated effect: {name}")
        start = max(0, int(active[0]) - int(RATE * 0.004))
        end = min(len(x), int(active[-1]) + int(RATE * 0.025), start + int(RATE * LIMITS[name]))
        trim = start / RATE
        x = x[start:end]
        x *= 0.35 / max(float(np.max(np.abs(x))), 1e-6)
        fade_in, fade_out = min(int(RATE * 0.004), len(x)), min(int(RATE * 0.025), len(x))
        x[:fade_in] *= np.linspace(0, 1, fade_in)
        x[-fade_out:] *= np.linspace(1, 0, fade_out)
    x = resample_poly(x, 1, 2, padtype="wrap" if name == "fall" else "constant").astype(np.float32)
    x *= min(1, 0.35 / max(float(np.max(np.abs(x))), 1e-6))
    # Keep the five footstep variants equally gentle even when one has a fuller body.
    if name.startswith(("walk-", "run-")):
        x *= min(1, 0.025 / max(float(np.sqrt(np.mean(x * x))), 1e-6))
    elif name == "land-hard":
        x *= min(1, 0.035 / max(float(np.sqrt(np.mean(x * x))), 1e-6))
    output = ROOT / "audio" / f"{name}.wav"
    sf.write(output, x, OUTPUT_RATE, subtype="PCM_16")
    audible = np.flatnonzero(np.abs(x) > max(float(np.max(np.abs(x))) * 0.05, 1e-5))
    metadata = PreparedSound(name, output.relative_to(ROOT).as_posix(), len(x) / OUTPUT_RATE,
                             float(np.max(np.abs(x))), float(np.sqrt(np.mean(x * x))),
                             int(audible[0]) / OUTPUT_RATE, trim, name == "fall")
    return metadata, x


def main() -> None:
    prepared = [prepare(path) for path in sorted((ROOT / "audio" / "source").glob("*.mp3"))]
    if len(prepared) != 10:
        raise ValueError("Expected all ten generated sound effects")
    manifest = {"provider": "ElevenLabs", "model": "eleven_text_to_sound_v2", "sample_rate": OUTPUT_RATE,
                "sounds": [asdict(metadata) for metadata, _ in prepared]}
    (ROOT / "audio" / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    clips = {metadata.name: samples for metadata, samples in prepared}
    silence = np.zeros(int(OUTPUT_RATE * 0.15))
    walk = [np.concatenate([clips[name] * 0.45, np.zeros(max(0, int(OUTPUT_RATE * 0.4) - len(clips[name])))])
            for name in ["walk-1", "walk-2", "walk-3", "walk-1"]]
    run = [np.concatenate([clips[name] * 0.4, np.zeros(max(0, int(OUTPUT_RATE * 0.267) - len(clips[name])))])
           for name in ["run-1", "run-2", "run-1", "run-2", "run-1", "run-2"]]
    fall = clips["fall"] * 0.25
    ramp = int(OUTPUT_RATE * 0.05)
    fall[:ramp] *= np.linspace(0, 1, ramp)
    fall[-ramp:] *= np.linspace(1, 0, ramp)
    preview = np.concatenate([*walk, silence, *run, silence, clips["jump"] * 0.6, fall,
                              clips["land-soft"] * 0.6, silence, clips["land-hard"] * 0.7,
                              silence, clips["wave"] * 0.4]) * 0.55
    preview_path = ROOT / "audio" / "preview.wav"
    sf.write(preview_path, preview, OUTPUT_RATE, subtype="PCM_16")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(preview_path),
                    "-c:a", "libmp3lame", "-b:a", "96k", str(ROOT / "audio" / "preview.mp3")], check=True)
    fall_preview = np.tile(clips["fall"], 2) * 0.25 * 0.55
    fall_preview[:ramp] *= np.linspace(0, 1, ramp)
    fall_preview[-ramp:] *= np.linspace(1, 0, ramp)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le",
                    "-ar", str(OUTPUT_RATE), "-ac", "1", "-i", "pipe:0", "-c:a", "libmp3lame",
                    "-b:a", "96k", str(ROOT / "audio" / "fall-preview.mp3")],
                   input=fall_preview.astype(np.float32).tobytes(), check=True)
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

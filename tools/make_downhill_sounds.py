"""Build the downhill's small, original foley palette. Deterministic synthesis; no remote service or paid calls."""
from dataclasses import dataclass, asdict
import json
from pathlib import Path
import subprocess

import numpy as np
from scipy.signal import butter, sosfilt
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "audio" / "downhill"
RATE = 22050
RNG = np.random.default_rng(1649)


def time(seconds):
    return np.arange(round(seconds * RATE)) / RATE


def noise(seconds, low=0, high=3500, periodic=False):
    x = RNG.normal(0, 1, round(seconds * RATE))
    if periodic:
        f = np.fft.rfftfreq(len(x), 1 / RATE)
        shape = np.exp(-(f / high) ** 4)
        if low:
            shape *= 1 - np.exp(-(f / low) ** 4)
        shape[0] = 0
        x = np.fft.irfft(np.fft.rfft(x) * shape, len(x))
    else:
        cutoff = [low, high] if low else high
        x = sosfilt(butter(2, cutoff, btype="bandpass" if low else "lowpass", fs=RATE, output="sos"), x)
    return x / max(np.sqrt(np.mean(x * x)), 1e-9)


def tone(seconds, first, last, decay):
    t = time(seconds)
    freq = first + (last - first) * (1 - np.exp(-t * 8))
    return np.sin(2 * np.pi * np.cumsum(freq) / RATE) * np.exp(-t / decay)


def hit(seconds, pitch, material):
    t = time(seconds)
    ratios = {"wood": [1, 2.3, 3.8], "plastic": [1, 1.6, 2.7], "metal": [1, 2.71, 4.1]}[material]
    decay = {"wood": 0.035, "plastic": 0.07, "metal": 0.16}[material]
    x = sum(np.sin(2 * np.pi * pitch * r * t) * np.exp(-t / (decay / (1 + k * 0.55))) / (1 + k)
            for k, r in enumerate(ratios))
    return x + noise(seconds, high=3500) * np.exp(-t / 0.009) * 0.3


def add(x, clip, at, gain=1):
    start = round(at * RATE)
    n = min(len(clip), len(x) - start)
    if n > 0:
        x[start:start + n] += clip[:n] * gain


def clatter(seconds, pitch=430, material="plastic", count=5):
    x = np.zeros(round(seconds * RATE))
    for k in range(count):
        add(x, hit(0.18, pitch * RNG.uniform(0.7, 1.4), material), 0.015 + k * 0.045 + RNG.uniform(0, 0.02), 0.6 ** (k / 2))
    return x


def snow(seconds, heavy=False):
    t = time(seconds)
    x = noise(seconds, high=1800) * np.exp(-t / (0.085 if heavy else 0.045)) * 0.4
    x += tone(seconds, 115 if heavy else 175, 60, 0.085 if heavy else 0.05)
    if heavy:
        x += clatter(seconds, 350, count=4) * 0.23
    return x


def water(seconds):
    t = time(seconds)
    x = noise(seconds, high=2200) * np.exp(-t / 0.16) * 0.42
    for k in range(5):
        add(x, tone(0.16, 220 + k * 90, 390 + k * 160, 0.038), 0.08 + k * 0.074, 0.38)
    return x


def cheer(seconds):
    # A small wordless toy crowd: moving fundamentals under rounded /oo/ formants, with quiet handclaps.
    t = time(seconds)
    x = np.zeros(len(t))
    envelope = np.sin(np.pi * np.clip(t / seconds, 0, 1)) ** 1.5
    for base in [150, 185, 225, 270, 310]:
        f = base * (1 + 0.3 * np.sin(np.pi * t / seconds))
        phase = 2 * np.pi * np.cumsum(f) / RATE
        for harmonic in range(1, 16):
            hz = base * harmonic
            formants = np.exp(-((hz - 330) / 170) ** 2) + 0.45 * np.exp(-((hz - 900) / 240) ** 2)
            x += np.sin(harmonic * phase + RNG.uniform(0, 6)) * formants / harmonic * envelope
    return x * 0.3


def fanfare():
    x = np.zeros(round(1.35 * RATE))
    for at, frequency, length in [(0, 523.25, 0.16), (0.16, 659.25, 0.16), (0.32, 783.99, 0.18),
                                  (0.5, 1046.5, 0.72)]:
        t = time(length)
        note = (np.sin(2 * np.pi * frequency * t) + 0.23 * np.sin(4 * np.pi * frequency * t))
        note *= np.minimum(1, t / 0.012) * np.exp(-t / 0.23)
        add(x, note, at)
        if at == 0.5:
            add(x, tone(length, 659.25, 659.25, 0.23), at, 0.35)
            add(x, tone(length, 783.99, 783.99, 0.23), at, 0.35)
    return x


@dataclass(frozen=True)
class Sound:
    id: str
    duration: float
    loop: bool
    peak: float
    rms: float
    seam_step: float
    bytes: int


def save(name, samples, loop=False):
    x = np.asarray(samples, dtype=np.float64)
    x -= np.mean(x)
    if not loop:
        edge = min(round(0.003 * RATE), len(x))
        x[:edge] *= np.linspace(0, 1, edge)
        tail = min(round(0.035 * RATE), len(x))
        x[-tail:] *= np.linspace(1, 0, tail)
    target = 0.055 if loop else 0.075
    x *= min(target / max(np.sqrt(np.mean(x * x)), 1e-9), 0.35 / max(np.max(np.abs(x)), 1e-9))
    sf.write(OUT / f"{name}.wav", x, RATE, subtype="PCM_16")
    return Sound(name, len(x) / RATE, loop, float(np.max(np.abs(x))), float(np.sqrt(np.mean(x * x))),
                 float(abs(x[0] - x[-1])) if loop else 0, (OUT / f"{name}.wav").stat().st_size), x


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    clips = {}
    t = time(0.42)
    lift = noise(0.42, 400, 2800) * np.exp(-t / 0.06) * 0.5
    add(lift, hit(0.22, 260, "plastic"), 0.09, 0.65)
    clips["lift"] = lift
    clips["land-soft"] = snow(0.3)
    clips["land-hard"] = snow(0.55, True)
    clips["crash-rock"] = hit(0.32, 185, "wood") + snow(0.32, True) * 0.35
    clips["crash-tree"] = hit(0.38, 250, "wood") + noise(0.38, 1200, 4300) * np.exp(-time(0.38) / 0.035) * 0.18
    clips["crash-metal"] = hit(0.55, 375, "metal")
    clips["crash-desk"] = hit(0.33, 300, "wood") + clatter(0.33, 450, count=3) * 0.18
    printer = clatter(0.65, 560, count=7)
    add(printer, tone(0.07, 880, 880, 0.05), 0, 0.5)
    add(printer, tone(0.08, 660, 660, 0.05), 0.09, 0.4)
    clips["crash-printer"] = printer
    wheel = tone(0.34, 1450, 520, 0.055)
    add(wheel, clatter(0.2, 720, count=3), 0.11, 0.45)
    clips["wheel"] = wheel
    clips["snowman"] = snow(0.26) + noise(0.26, high=2800) * np.exp(-time(0.26) / 0.055) * 0.18
    clips["chair"] = clatter(0.48, 530, count=7)
    clips["photographer"] = snow(0.35) + hit(0.35, 540, "plastic") * 0.25
    clips["cooler"] = water(0.65)
    clips["ficus"] = noise(0.34, 1200, 4600) * np.exp(-time(0.34) / 0.07)
    strike = clatter(1.1, 480, count=12)
    add(strike, cheer(0.8), 0.2, 0.8)
    clips["strike"] = strike
    clips["crowd"] = cheer(1.0)
    photo = hit(0.18, 700, "plastic")
    add(photo, hit(0.1, 1050, "plastic"), 0.038, 0.6)
    clips["photo"] = photo
    pit = np.zeros(round(0.78 * RATE))
    for k in range(11):
        add(pit, hit(0.06, 850 + k * 23, "metal"), k * 0.043, 0.45)
    add(pit, hit(0.2, 280, "plastic"), 0.55)
    clips["pit"] = pit
    clips["lost"] = tone(0.7, 780, 140, 0.26) * (0.7 + 0.3 * np.sin(time(0.7) * 31))
    clips["splash"] = water(0.85) + snow(0.85, True) * 0.3
    clips["wrecked"] = clatter(0.85, 280, "metal", count=10) + tone(0.85, 570, 110, 0.3) * 0.3
    clips["finish"] = fanfare()
    # D-major bell answer with two little clock ticks; no random draws, so adding it preserves the older palette.
    bonus = np.zeros(round(0.36 * RATE))
    add(bonus, tone(0.22, 1174.66, 1174.66, 0.07), 0.015, 0.65)
    add(bonus, tone(0.24, 1479.98, 1479.98, 0.075), 0.105, 0.65)
    tick = tone(0.035, 1850, 1850, 0.004)
    add(bonus, tick, 0, 0.25); add(bonus, tick, 0.09, 0.2)
    clips["bonus"] = bonus

    loops = {}
    for name, low, high, rumble in [("roll-piste", 90, 2200, 0.15), ("roll-ice", 300, 3200, 0.08),
                                    ("roll-bank", 90, 1300, 0.12), ("roll-powder", 0, 1100, 0.06)]:
        t = time(2)
        x = noise(2, low, high, True) * (0.75 + 0.14 * np.sin(2 * np.pi * 10 * t))
        x += rumble * np.sin(2 * np.pi * 70 * t)
        loops[name] = x
    t = time(2)
    loops["wind"] = noise(2, high=1050, periodic=True) * (0.8 + 0.12 * np.sin(2 * np.pi * t))
    loops["brake"] = noise(2, 250, 2800, True) * (0.85 + 0.08 * np.sin(2 * np.pi * 9 * t))
    loops["scrape"] = noise(2, 750, 3200, True) * (0.7 + 0.22 * np.sin(2 * np.pi * 8 * t)) + 0.2 * np.sin(2 * np.pi * 190 * t)
    loops["swivel"] = noise(2, 250, 1500, True) * 0.25 + np.sin(2 * np.pi * 240 * t) * (0.7 + 0.1 * np.sin(2 * np.pi * 3 * t))
    metadata, prepared = [], {}
    for name, x in clips.items():
        info, samples = save(name, x)
        metadata.append(info); prepared[name] = samples
    for name, x in loops.items():
        # Copy a short periodic slice across the join to soften the high-frequency noise, keeping loop duration.
        n = round(0.018 * RATE)
        seam = (x[:n] + x[-n:]) / 2
        fade = np.linspace(0, 1, n)
        x[:n] = seam * (1 - fade) + x[:n] * fade
        x[-n:] = x[-n:] * (1 - fade) + seam * fade
        x[-1] = x[0]
        info, samples = save(name, x, True)
        metadata.append(info); prepared[name] = samples
    manifest = {"provider": "original deterministic synthesis", "sample_rate": RATE, "channels": 1,
                "format": "PCM_16", "sounds": [asdict(s) for s in metadata]}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    gap = np.zeros(round(0.13 * RATE))
    preview = []
    for name in ["lift", "land-soft", "land-hard", "crash-rock", "crash-tree", "crash-metal", "crash-desk",
                 "crash-printer", "wheel", "snowman", "chair", "cooler", "ficus", "photo", "pit", "strike", "crowd", "bonus", "lost", "splash", "wrecked", "finish"]:
        preview.extend([prepared[name] * 0.55 * 0.65, gap])
    for name in loops:
        x = np.tile(prepared[name], 2) * 0.55 * 0.3
        ramp = np.minimum(1, np.arange(len(x)) / (RATE * 0.2)) * np.minimum(1, np.arange(len(x))[::-1] / (RATE * 0.2))
        preview.extend([x * ramp, gap])
    sf.write(OUT / "preview.wav", np.concatenate(preview), RATE, subtype="PCM_16")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(OUT / "preview.wav"),
                    "-codec:a", "libmp3lame", "-b:a", "80k", str(OUT / "preview.mp3")], check=True)
    (OUT / "preview.wav").unlink()
    print(f"Prepared {len(metadata)} WAVs, {sum(s.bytes for s in metadata):,} bytes; preview.mp3 is a listening reel.")


if __name__ == "__main__":
    main()

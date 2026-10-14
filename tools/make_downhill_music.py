"""Arrange Pocket Altitude for the downhill from its committed MIDI scores; render locally with FluidSynth."""
import argparse
from dataclasses import dataclass, asdict
import json
from pathlib import Path
import struct
import subprocess

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "audio/music"
WORK = ROOT / ".mnot-qa/music/downhill"
RATE, BPM, BARS = 44100, 120, 32
TEMPO = 60_000_000 // BPM


@dataclass(frozen=True)
class Note:
    beat: float
    length: float
    channel: int
    key: int
    velocity: int


@dataclass(frozen=True)
class Score:
    ppq: int
    tempo: int
    notes: list[Note]


def read_score(path: Path) -> Score:
    """Read the project's format-0 MIDI sources, including running status, without another build dependency."""
    data = path.read_bytes()
    if data[:4] != b"MThd" or data[8:12] != b"\0\0\0\1" or data[14:18] != b"MTrk":
        raise ValueError("Expected a format-0, one-track MIDI score")
    ppq = int.from_bytes(data[12:14], "big")
    if not 0 < ppq < 0x8000:
        raise ValueError("Expected beat-based MIDI timing")
    at, tick, status, tempo = 22, 0, 0, 500000
    notes: list[Note] = []
    active: dict[tuple[int, int], list[tuple[int, int]]] = {}

    def number():
        nonlocal at
        value = 0
        for _ in range(4):
            byte = data[at]; at += 1
            value = (value << 7) | (byte & 127)
            if byte < 128:
                return value
        raise ValueError("Invalid MIDI variable-length integer")

    while at < len(data):
        tick += number()
        if data[at] >= 128:
            status = data[at]; at += 1
        if status == 255:
            kind = data[at]; at += 1
            size = number()
            if kind == 81:
                tempo = int.from_bytes(data[at:at + size], "big")
            at += size
            if kind == 47:
                break
            status = 0
            continue
        if not 0x80 <= status <= 0xef:
            raise ValueError("Unsupported MIDI source event")
        kind, channel = status & 0xf0, status & 15
        size = 1 if kind in [0xc0, 0xd0] else 2
        values = data[at:at + size]; at += size
        if kind == 0x90 and values[1]:
            active.setdefault((channel, values[0]), []).append((tick, values[1]))
        elif kind == 0x80 or kind == 0x90 and not values[1]:
            key = (channel, values[0])
            if active.get(key):
                start, velocity = active[key].pop(0)
                notes.append(Note(start / ppq, (tick - start) / ppq, channel, values[0], velocity))
    if any(active.values()):
        raise ValueError("Unfinished source notes")
    return Score(ppq, tempo, sorted(notes, key=lambda n: (n.beat, n.channel, n.key)))


def arrange_run(source: Score) -> list[Note]:
    notes = list(source.notes)  # the original melody, marimba, chords, bass and answers are kept verbatim
    for bar in range(BARS):
        at = bar * 4
        tones = sorted({n.key for n in source.notes if n.channel == 1 and at <= n.beat < at + 4})
        if len(tones) != 3:
            raise ValueError(f"Expected the original three-note harmony in bar {bar}")
        root = tones[0] - 24
        notes += [Note(at + 1.5, .2, 2, root + 7, 37), Note(at + 3.5, .2, 2, root, 34)]
        # Quiet brushes and lightly shuffled hats; the tune's own timing is unchanged.
        for beat in [0, 2]:
            notes.append(Note(at + beat, .07, 9, 36, 27))
        for beat in [1, 3]:
            notes.append(Note(at + beat, .11, 9, 38, 23))
        for beat in range(4):
            notes += [Note(at + beat, .045, 9, 42, 17), Note(at + beat + .57, .045, 9, 42, 14)]
    return notes


def arrange_finish(source: Score) -> list[Note]:
    # The existing summit answer, a little faster; the vibraphone and a quiet whistle share the final grin.
    return list(source.notes) + [Note(n.beat, n.length, 5, n.key, 44) for n in source.notes if n.channel == 4]


def variable(value):
    out = [value & 127]
    while value >> 7:
        value >>= 7
        out.insert(0, (value & 127) | 128)
    return bytes(out)


def midi(notes: list[Note], ppq: int, bars: int, repeats: int, *, finish: bool) -> bytes:
    events: list[tuple[int, bytes]] = [(0, b"\xff\x51\x03" + TEMPO.to_bytes(3, "big")),
                                     (0, b"\xff\x58\x04\x04\x02\x18\x08")]
    for channel, program, pan, volume in [(0, 12, 46, 88), (1, 45, 82, 73), (2, 58, 61, 80),
                                        (3, 9, 75, 60), (4, 11 if finish else 78, 58, 68),
                                        (5, 78, 68, 54), (9, 40, 64, 40)]:
        events += [(0, bytes([0xc0 | channel, program])), (0, bytes([0xb0 | channel, 10, pan])),
                   (0, bytes([0xb0 | channel, 7, volume])), (0, bytes([0xb0 | channel, 91, 27]))]
    for repeat in range(repeats):
        if not finish:
            for bar, program in [(0, 78), (8, 11), (16, 78), (24, 11)]:
                tick = round(max(0, repeat * bars * 4 + bar * 4 - .025) * ppq)
                events.append((tick, bytes([0xc4, program])))
        for n in notes:
            start = round((n.beat + repeat * bars * 4) * ppq)
            events += [(start, bytes([0x90 | n.channel, n.key, n.velocity])),
                       (start + round(n.length * ppq), bytes([0x80 | n.channel, n.key, 0]))]
    events.sort(key=lambda e: (e[0], 0 if e[1][0] & 0xf0 == 0x80 else 1))
    body = bytearray(); previous = 0
    for tick, message in events:
        body += variable(tick - previous) + message
        previous = tick
    body += variable(max(0, bars * 4 * repeats * ppq - previous)) + b"\xff\x2f\0"
    return b"MThd" + struct.pack(">IHHH", 6, 0, 1, ppq) + b"MTrk" + struct.pack(">I", len(body)) + body


def synthesise(name, notes, ppq, bars, repeats, synth, soundfont, finish):
    (OUT / f"{name}.mid").write_bytes(midi(notes, ppq, bars, 1, finish=finish))
    score = WORK / f"{name}-render.mid"
    score.write_bytes(midi(notes, ppq, bars, repeats, finish=finish))
    raw = WORK / f"{name}-render.wav"
    subprocess.run([str(synth), "-ni", "-F", str(raw), "-r", str(RATE), "-o", "synth.chorus.active=0",
                    "-o", "synth.reverb.room-size=0.36", "-o", "synth.reverb.damp=0.5",
                    "-o", "synth.reverb.level=0.16", str(soundfont), str(score)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    samples, rate = sf.read(raw, dtype="float32", always_2d=True)
    if rate != RATE:
        raise ValueError("Unexpected synthesiser sample rate")
    return samples


def loop_take(samples):
    period = round(BARS * 4 * TEMPO / 1e6 * RATE)
    start = period - round(.04 * RATE)
    x = samples[start:start + period].copy()
    width = round(.025 * RATE)
    t = np.linspace(0, 1, width)[:, None]
    ease = t ** 3 * (t * (t * 6 - 15) + 10)
    x[:width] = samples[start + period:start + period + width] * (1 - ease) + x[:width] * ease
    return x


def finish_take(samples, notes):
    length = round((max(n.beat + n.length for n in notes) * TEMPO / 1e6 + 1.2) * RATE)
    x = samples[:length].copy()
    fade = round(.3 * RATE)
    x[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return x


def export(name, samples, target):
    samples -= np.mean(samples, axis=0)
    samples *= min(target / max(float(np.sqrt(np.mean(samples * samples))), 1e-7),
                   .65 / max(float(np.max(np.abs(samples))), 1e-7))
    master = WORK / f"{name}-master.wav"
    sf.write(master, samples, RATE, subtype="PCM_24")
    output = OUT / f"{name}.mp3"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(master), "-c:a", "libmp3lame",
                    "-b:a", "112k", "-write_xing", "1", "-metadata", "artist=Peak Mnot",
                    "-metadata", f"title=Pocket Altitude — {name}", "-metadata", "comment=Original theme, 120 BPM downhill arrangement",
                    str(output)], check=True)
    return {"id": name, "file": f"audio/music/{name}.mp3", "duration": len(samples) / RATE,
            "bytes": output.stat().st_size, "peak": float(np.max(np.abs(samples))),
            "rms": float(np.sqrt(np.mean(samples * samples)))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fluidsynth", type=Path, default=ROOT / ".mnot-qa/music/tools/fluidsynth/fluidsynth-v2.6.1-win10-x64-cpp11/bin/fluidsynth.exe")
    parser.add_argument("--soundfont", type=Path, default=ROOT / ".mnot-qa/music/tools/GeneralUser-GS.sf2")
    args = parser.parse_args()
    if not args.fluidsynth.is_file() or not args.soundfont.is_file():
        raise RuntimeError("Supply --fluidsynth and --soundfont (GeneralUser GS); see audio/music/README.md")
    WORK.mkdir(parents=True, exist_ok=True)
    run = read_score(OUT / "peak-climb.mid")
    finish = read_score(OUT / "peak-summit.mid")
    run_notes, finish_notes = arrange_run(run), arrange_finish(finish)
    samples = synthesise("peak-downhill", run_notes, run.ppq, BARS, 3, args.fluidsynth, args.soundfont, False)
    loop = export("peak-downhill", loop_take(samples), .07)
    samples = synthesise("peak-downhill-finish", finish_notes, finish.ppq, 2, 1, args.fluidsynth, args.soundfont, True)
    sting = export("peak-downhill-finish", finish_take(samples, finish_notes), .1)
    manifest = {"title": "Pocket Altitude — Desk to Piste", "key": "D major", "bpm": BPM, "bars": BARS,
                "sample_rate": RATE, "renderer": "FluidSynth 2.6.1", "soundfont": "GeneralUser GS 2.0.3",
                "source_scores": ["audio/music/peak-climb.mid", "audio/music/peak-summit.mid"],
                "instruments": ["marimba", "pizzicato strings", "tuba", "glockenspiel", "whistle", "vibraphone", "brush kit"],
                "assets": [{**loop, "loop": True}, {**sting, "loop": False}]}
    (OUT / "downhill-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

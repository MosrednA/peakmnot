"""Render Reaction Run's original foley and Pocket Altitude arrangement locally.

Needs NumPy, SciPy, SoundFile, FFmpeg, FluidSynth and GeneralUser GS, as the downhill does.
"""
import argparse
import json
from pathlib import Path
import struct
import subprocess

import numpy as np
import soundfile as sf

from make_downhill_music import Note, read_score, variable
from make_downhill_sounds import add, hit, noise, snow, time, tone

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "audio/emoji"
WORK = ROOT / ".mnot-qa/emoji"
RATE, BPM, BARS = 44100, 112, 32
TEMPO = round(60_000_000 / BPM)


def foley():
    clips = {
        "start": tone(.3, 380, 760, .09),
        "take": tone(.32, 660, 1040, .085) + hit(.32, 880, "wood") * .3,
        "wrong": tone(.46, 260, 115, .15) + hit(.46, 185, "plastic") * .35,
        "early": tone(.42, 420, 230, .13) + hit(.42, 310, "wood") * .3,
        "out": tone(.75, 460, 65, .3),
        "fall": snow(.45, True),
        "bonk": snow(.24) + hit(.24, 210, "plastic") * .35,
        "peek-up": tone(.28, 340, 690, .1) * .5,
        "peek-down": tone(.25, 620, 290, .08) * .5,
        "clear": np.zeros(round(.75 * 22050)),
        "peak": snow(.5, True) + hit(.5, 390, "wood") * .25,
        "finish": tone(.4, 880, 1320, .12),
        "crack": np.zeros(round(.46 * 22050)),
        "quake": noise(1.1, low=45, high=550) * np.sin(np.pi*time(1.1)/1.1)**1.4,
        "hole": snow(.65, True) + noise(.65, high=1300) * np.exp(-time(.65) / .18) * .4,
        "pit": tone(.45, 210, 80, .15) + snow(.45) * .3,
        "climb": tone(.3, 200, 420, .065) + snow(.3) * .6,
    }
    for k in range(6):
        add(clips["clear"], tone(.2, 800 + 95*k, 1500 + 120*k, .055), k*.085, .6)
    for at, hz in [(0, 350), (.11, 480), (.29, 250)]:
        add(clips["crack"], hit(.15, hz, "wood"), at, .6)
    for name, low, high in [("slide", 120, 1900), ("skid", 450, 3400)]:
        t = time(2)
        clips[name] = noise(2, low=low, high=high, periodic=True) * (1 + .12*np.sin(2*np.pi*3*t))
    rows = []
    for name, x in clips.items():
        loop = name in ["slide", "skid"]
        x -= np.mean(x)
        x *= min(.13 / max(np.sqrt(np.mean(x*x)), 1e-9), .65 / max(np.max(np.abs(x)), 1e-9))
        if not loop:
            n = min(110, len(x)//4)
            x[:n] *= np.linspace(0, 1, n)
            x[-n:] *= np.linspace(1, 0, n)
        else:
            # Match the noise's actual endpoints too, keeping a high-frequency random sample from clicking.
            n = round(.015*22050)
            x[:n] += (x[-1]-x[0]) * (1-np.linspace(0, 1, n))**3
        sf.write(OUT / f"{name}.wav", x, 22050, subtype="PCM_16")
        rows.append({"name": name, "loop": loop, "seconds": len(x)/22050})
    return rows


def arrange(source):
    # The committed melody/harmony stay intact; a few bass pickups and quiet shuffled shakers add the trolley.
    notes = list(source.notes)
    for bar in range(BARS):
        tones = sorted({n.key for n in source.notes if n.channel == 1 and bar*4 <= n.beat < bar*4+4})
        notes.append(Note(bar*4+3.5, .18, 2, tones[0]-17, 34))
        for beat in range(4):
            notes.extend([Note(bar*4+beat, .05, 9, 42, 16), Note(bar*4+beat+.58, .05, 9, 42, 12)])
    return notes


def midi(notes, ppq, bars, repeats):
    events = [(0, b"\xff\x51\x03" + TEMPO.to_bytes(3, "big"))]
    # Marimba, pizzicato, tuba, music box and clarinet: the same little alpine band with a different lead.
    for channel, program, volume in [(0, 12, 85), (1, 45, 68), (2, 58, 76), (3, 10, 53), (4, 71, 58), (9, 0, 32)]:
        events += [(0, bytes([0xc0|channel, program])), (0, bytes([0xb0|channel, 7, volume])),
                   (0, bytes([0xb0|channel, 10, 46+channel*5]))]
    for repeat in range(repeats):
        for n in notes:
            start = round((n.beat + repeat*bars*4)*ppq)
            events += [(start, bytes([0x90|n.channel, n.key, n.velocity])),
                       (start+round(n.length*ppq), bytes([0x80|n.channel, n.key, 0]))]
    events.sort(key=lambda e: (e[0], 0 if e[1][0]&0xf0 == 0x80 else 1))
    body, previous = bytearray(), 0
    for tick, message in events:
        body += variable(tick-previous) + message
        previous = tick
    body += variable(max(0, bars*4*repeats*ppq-previous)) + b"\xff\x2f\0"
    return b"MThd" + struct.pack(">IHHH", 6, 0, 1, ppq) + b"MTrk" + struct.pack(">I", len(body)) + body


def music(synth, font):
    rows = []
    for name, source, bars, repeats in [("run", "peak-climb", BARS, 3), ("answer", "peak-summit", 2, 1)]:
        score = read_score(ROOT / f"audio/music/{source}.mid")
        notes = arrange(score) if name == "run" else score.notes
        (OUT / f"{name}.mid").write_bytes(midi(notes, score.ppq, bars, 1))
        feed, raw = WORK / f"{name}.mid", WORK / f"{name}.wav"
        feed.write_bytes(midi(notes, score.ppq, bars, repeats))
        subprocess.run([str(synth), "-ni", "-F", str(raw), "-r", str(RATE), "-o", "synth.chorus.active=0",
                        "-o", "synth.reverb.level=0.13", str(font), str(feed)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        x, _ = sf.read(raw, dtype="float32", always_2d=True)
        if name == "run":
            period = round(BARS*4*TEMPO/1e6*RATE)
            start = period-round(.04*RATE)
            take = x[start:start+period].copy()
            n = round(.025*RATE)
            t = np.linspace(0, 1, n)[:, None]
            t = t**3*(t*(t*6-15)+10)
            take[:n] = x[start+period:start+period+n]*(1-t) + take[:n]*t
        else:
            length = round((max(n.beat+n.length for n in notes)*TEMPO/1e6+1.2)*RATE)
            take = x[:length].copy()
            n = round(.3*RATE)
            take[-n:] *= np.linspace(1, 0, n)[:, None]
        take -= np.mean(take, axis=0)
        take *= min((.07 if name == "run" else .1)/max(np.sqrt(np.mean(take*take)), 1e-9),
                    .65/max(np.max(np.abs(take)), 1e-9))
        master = WORK / f"{name}-master.wav"
        sf.write(master, take, RATE, subtype="PCM_24")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(master), "-map_metadata", "-1",
                        "-c:a", "libmp3lame", "-b:a", "112k", "-write_xing", "1", str(OUT/f"{name}.mp3")], check=True)
        rows.append({"name": name, "seconds": len(take)/RATE, "bpm": BPM, "loop": name == "run"})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fluidsynth", type=Path, required=True)
    parser.add_argument("--soundfont", type=Path, required=True)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    manifest = {"sounds": foley(), "music": music(args.fluidsynth, args.soundfont),
                "theme": "Pocket Altitude — Reaction Run", "soundfont": "GeneralUser GS 2.0.3"}
    (OUT/"manifest.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8")
    print(f"Rendered {len(manifest['sounds'])} effects and two music arrangements")


if __name__ == "__main__":
    main()

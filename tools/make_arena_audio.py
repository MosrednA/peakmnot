"""Render the plaza's original can foley and a quiet Pocket Altitude arrangement locally.

Uses the existing NumPy/SciPy/SoundFile, FFmpeg, FluidSynth and GeneralUser GS toolchain.
"""
import argparse
import json
from pathlib import Path
import struct
import subprocess

import numpy as np
import soundfile as sf

from make_downhill_music import Note, read_score, variable
from make_downhill_sounds import add, hit, noise, time, tone

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "audio/arena"
WORK = ROOT / ".mnot-qa/arena"
BPM, BARS, RATE = 96, 32, 44100
TEMPO = round(60_000_000 / BPM)


def fizz(seconds):
    t = time(seconds)
    return noise(seconds, 1300, 6500) * (1-np.exp(-t/.002)) * np.exp(-t/.065)


def can(seconds, pitch):
    return hit(seconds, pitch, "metal")*.5 + tone(seconds, pitch*.49, pitch*.47, .055)*.3


def foley():
    clips = {}
    x = fizz(.48)
    add(x, can(.22, 830), .015, .65)
    add(x, tone(.18, 430, 720, .055), .12, .18)
    clips["join-self"] = x
    clips["join"] = fizz(.32)*.5 + can(.32, 710)*.3
    clips["leave"] = can(.36, 480)*.45 + tone(.36, 350, 220, .07)*.2
    clips["idle"] = tone(.6, 280, 145, .17)*.4 + fizz(.6)*.12
    clips["chat-self"] = can(.13, 880)*.45 + tone(.13, 587.33, 587.33, .025)*.35
    clips["chat"] = can(.16, 730)*.35 + tone(.16, 440, 440, .035)*.3
    clips["bump"] = can(.45, 245) + noise(.45, high=1400)*np.exp(-time(.45)/.012)*.18
    for name, pitches in [("full", [370, 293.66]), ("slow", [440, 370]),
                          ("lost", [587.33, 440, 293.66]), ("back", [293.66, 440, 587.33])]:
        x = np.zeros(round(.55*22050))
        for i, pitch in enumerate(pitches):
            add(x, can(.15, pitch)*.25 + tone(.15, pitch, pitch, .045)*.4, i*.11)
        clips[name] = x
    # A soft, periodic dented-can wobble, aggregated across all nearby reeling cans.
    t = time(2.5)
    envelope = .48 + .22*np.cos(2*np.pi*4*t)
    clips["reel"] = (np.sin(2*np.pi*220*t + 1.2*np.sin(2*np.pi*4*t))*envelope
                       + .16*np.sin(2*np.pi*440*t + .4*np.sin(2*np.pi*4*t)))
    # One bar at the plaza's 96 BPM: a quiet soda-can shaker with tab clicks on the backbeats.
    x = np.zeros(len(t))
    for beat in range(8):
        add(x, fizz(.12), beat*.3125, .28 if beat % 2 else .38)
    for beat in [1, 3]:
        add(x, can(.14, 587.33), beat*.625, .35)
    clips["dance"] = x
    rows = []
    for name, samples in clips.items():
        loop = name in ["dance", "reel"]
        x = np.asarray(samples, dtype=np.float64)
        x -= x.mean()
        if not loop:
            x[:66] *= np.linspace(0, 1, 66)
            x[-min(660, len(x)):] *= np.linspace(1, 0, min(660, len(x)))
        x *= min((.045 if loop else .07)/max(np.sqrt(np.mean(x*x)), 1e-9),
                 .32/max(np.max(np.abs(x)), 1e-9))
        sf.write(OUT/f"{name}.wav", x, 22050, subtype="PCM_16")
        rows.append({"name": name, "loop": loop, "seconds": len(x)/22050,
                     "peak": float(np.max(np.abs(x))), "rms": float(np.sqrt(np.mean(x*x)))})
    return rows


def arrange():
    source = read_score(ROOT/"audio/music/peak-climb.mid")
    notes = []
    for n in source.notes:
        bar = int(n.beat//4)
        # The same harmony and bass; let the melody breathe for half of each eight-bar phrase.
        if n.channel in [0, 1, 2] or n.channel in [3, 4] and bar % 8 < 4:
            notes.append(Note(n.beat, n.length, n.channel, n.key,
                              max(1, round(n.velocity*(.62 if n.channel in [0, 3, 4] else .75)))))
    for bar in range(BARS):
        for beat in [0, 2]:
            notes.append(Note(bar*4+beat, .08, 9, 36, 27))
        for beat in [1, 3]:
            notes.append(Note(bar*4+beat, .07, 9, 37, 22))
        for beat in range(8):
            notes.append(Note(bar*4+beat*.5+(0.07 if beat % 2 else 0), .05, 9, 42, 14))
    return source.ppq, notes


def midi(ppq, notes, repeats):
    events = [(0, b"\xff\x51\x03"+TEMPO.to_bytes(3, "big"))]
    # Soft marimba, pizzicato, tuba, vibraphone, a breath of clarinet, and a very light beat.
    for channel, program, volume in [(0, 12, 73), (1, 45, 56), (2, 58, 69), (3, 11, 49),
                                      (4, 71, 43), (9, 0, 40)]:
        events += [(0, bytes([0xc0|channel, program])), (0, bytes([0xb0|channel, 7, volume])),
                   (0, bytes([0xb0|channel, 10, 52+channel*3]))]
    for repeat in range(repeats):
        for n in notes:
            tick = round((n.beat+repeat*BARS*4)*ppq)
            events += [(tick, bytes([0x90|n.channel, n.key, n.velocity])),
                       (tick+round(n.length*ppq), bytes([0x80|n.channel, n.key, 0]))]
    events.sort(key=lambda e: (e[0], 0 if e[1][0]&0xf0 == 0x80 else 1))
    body, previous = bytearray(), 0
    for tick, message in events:
        body += variable(tick-previous)+message
        previous = tick
    body += variable(max(0, BARS*4*repeats*ppq-previous))+b"\xff\x2f\0"
    return b"MThd"+struct.pack(">IHHH", 6, 0, 1, ppq)+b"MTrk"+struct.pack(">I", len(body))+body


def music(synth, font):
    ppq, notes = arrange()
    (OUT/"plaza.mid").write_bytes(midi(ppq, notes, 1))
    feed, raw = WORK/"plaza-render.mid", WORK/"plaza-render.wav"
    feed.write_bytes(midi(ppq, notes, 3))
    subprocess.run([str(synth), "-ni", "-F", str(raw), "-r", str(RATE), "-o", "synth.chorus.active=0",
                    "-o", "synth.reverb.level=0.13", str(font), str(feed)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    x, _ = sf.read(raw, dtype="float32", always_2d=True)
    period = round(BARS*4*TEMPO/1e6*RATE)
    start = period-round(.04*RATE)
    take = x[start:start+period].copy()
    n = round(.025*RATE)
    t = np.linspace(0, 1, n)[:, None]
    t = t**3*(t*(t*6-15)+10)
    take[:n] = x[start+period:start+period+n]*(1-t)+take[:n]*t
    take -= take.mean(axis=0)
    take *= min(.065/max(np.sqrt(np.mean(take*take)), 1e-9), .6/max(np.max(np.abs(take)), 1e-9))
    master = WORK/"plaza-master.wav"
    sf.write(master, take, RATE, subtype="PCM_24")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(master), "-map_metadata", "-1",
                    "-c:a", "libmp3lame", "-b:a", "112k", "-write_xing", "1", str(OUT/"plaza.mp3")], check=True)
    return {"name": "plaza", "seconds": period/RATE, "bpm": BPM, "bars": BARS, "loop": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fluidsynth", type=Path, required=True)
    parser.add_argument("--soundfont", type=Path, required=True)
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    manifest = {"theme": "Pocket Altitude — Plaza", "key": "D major", "soundfont": "GeneralUser GS 2.0.3",
                "sounds": foley(), "music": music(args.fluidsynth, args.soundfont)}
    (OUT/"manifest.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8", newline="\n")
    print(f"Rendered {len(manifest['sounds'])} effects and the {BPM} BPM plaza loop")


if __name__ == "__main__":
    main()

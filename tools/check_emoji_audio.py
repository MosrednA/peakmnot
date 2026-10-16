"""Check Reaction Run's delivered PCM/AAC, seamless loops and preserved theme."""
import json
from pathlib import Path
import subprocess
import unittest

import numpy as np
import soundfile as sf

from make_downhill_music import read_score

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "audio/emoji"


def decode(path, rate):
    data = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1",
                                    "-ar", str(rate), "pipe:1"])
    return np.frombuffer(data, dtype="<f4")


class EmojiAudio(unittest.TestCase):
    def test_effects(self):
        rows = json.loads((OUT/"manifest.json").read_text())["sounds"]
        self.assertEqual(len(rows), 19)
        for row in rows:
            with self.subTest(name=row["name"]):
                wav, rate = sf.read(OUT/f"{row['name']}.wav")
                aac = decode(OUT/f"{row['name']}.m4a", rate)
                self.assertTrue(np.isfinite(wav).all() and np.isfinite(aac).all())
                self.assertGreater(np.sqrt(np.mean(wav*wav)), .015)
                self.assertLess(np.max(np.abs(wav)), .7)
                self.assertLess(np.max(np.abs(aac)), .9)
                expected = len(wav) + (round(.4*rate) if row["loop"] else 0)
                # ffmpeg emits the AAC's final partial codec frame; the MP4 edit list is sample-accurate in browsers.
                self.assertLess(abs(len(aac)-expected), 1024)
                if row["loop"]:
                    pad = round(.2*rate)
                    aac = aac[pad:pad+len(wav)]
                    self.assertLess(abs(aac[-1]-aac[0]), .08)

    def test_scores(self):
        original = read_score(ROOT/"audio/music/peak-climb.mid")
        run = read_score(OUT/"run.mid")
        self.assertTrue(set(original.notes).issubset(set(run.notes)))
        answer = read_score(OUT/"answer.mid")
        self.assertEqual(answer.notes, read_score(ROOT/"audio/music/peak-summit.mid").notes)
        self.assertEqual(run.tempo, round(60_000_000/112))

    def test_music(self):
        for name in ["run", "answer"]:
            with self.subTest(name=name):
                x = decode(OUT/f"{name}.mp3", 44100)
                self.assertLess(np.max(np.abs(x)), .8)
                self.assertGreater(np.sqrt(np.mean(x*x)), .02)
                if name == "run":
                    self.assertAlmostEqual(len(x)/44100, 128*round(60_000_000/112)/1e6, places=4)
                    self.assertLess(abs(x[-1]-x[0]), .02)
                else:
                    self.assertLess(len(x)/44100, 5)
        shipped = sum(p.stat().st_size for p in OUT.glob("*.m4a")) + sum(p.stat().st_size for p in OUT.glob("*.mp3"))
        self.assertLess(shipped, 1_200_000)


if __name__ == "__main__":
    unittest.main()

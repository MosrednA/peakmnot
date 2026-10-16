"""Check the shipped plaza PCM, AAC lengths and loop seams, and Pocket Altitude's preserved harmony."""
import json
from pathlib import Path
import subprocess
import unittest

import numpy as np
import soundfile as sf

from compress_audio import played
from make_downhill_music import read_score

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/"audio/arena"


class ArenaAudio(unittest.TestCase):
    def test_effects(self):
        rows = json.loads((OUT/"manifest.json").read_text())["sounds"]
        self.assertEqual(len(rows), 13)
        for row in rows:
            with self.subTest(name=row["name"]):
                path = OUT/f"{row['name']}.wav"
                wav, rate = sf.read(path)
                self.assertTrue(np.isfinite(wav).all())
                self.assertGreater(np.sqrt(np.mean(wav*wav)), .015)
                self.assertLess(np.max(np.abs(wav)), .34)
                expected = len(wav)+(round(.4*rate) if row["loop"] else 0)
                self.assertEqual(played(path.with_suffix('.m4a').read_bytes()), (rate, expected))
                raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path.with_suffix('.m4a')),
                                               "-f", "f32le", "-ac", "1", "-ar", str(rate), "pipe:1"])
                aac = np.frombuffer(raw, dtype="<f4")
                self.assertTrue(np.isfinite(aac).all())
                self.assertLess(np.max(np.abs(aac)), .6)
                if row["loop"]:
                    pad = round(.2*rate)
                    aac = aac[pad:pad+len(wav)]
                    self.assertLess(abs(aac[-1]-aac[0]), .04)

    def test_theme(self):
        source = read_score(ROOT/"audio/music/peak-climb.mid")
        plaza = read_score(OUT/"plaza.mid")
        self.assertEqual(plaza.tempo, 625000)
        for channel in [0, 1, 2]:
            expected = {(n.beat, n.length, n.key) for n in source.notes if n.channel == channel}
            actual = {(n.beat, n.length, n.key) for n in plaza.notes if n.channel == channel}
            self.assertEqual(expected, actual)
        self.assertLess(len([n for n in plaza.notes if n.channel == 4]),
                        len([n for n in source.notes if n.channel == 4]))

    def test_music(self):
        raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(OUT/"plaza.mp3"),
                                       "-f", "f32le", "-ac", "2", "-ar", "44100", "pipe:1"])
        x = np.frombuffer(raw, dtype="<f4").reshape(-1, 2)
        self.assertTrue(np.isfinite(x).all())
        self.assertAlmostEqual(len(x)/44100, 80, places=4)
        self.assertLess(np.max(np.abs(x)), .7)
        self.assertGreater(np.sqrt(np.mean(x*x)), .025)
        self.assertLess(np.max(np.abs(x[-1]-x[0])), .02)
        self.assertLess(sum(p.stat().st_size for p in OUT.glob('*.m4a'))+(OUT/'plaza.mp3').stat().st_size, 1_300_000)


if __name__ == "__main__":
    unittest.main()

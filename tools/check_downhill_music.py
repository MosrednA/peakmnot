"""Verify the published arrangement against Pocket Altitude's source scores and decoded music assets."""
import json
import unittest

import numpy as np
import soundfile as sf

from make_downhill_music import OUT, read_score


class DownhillMusic(unittest.TestCase):
    def test_run_keeps_every_original_note_and_harmony(self):
        source = read_score(OUT / "peak-climb.mid")
        downhill = read_score(OUT / "peak-downhill.mid")
        self.assertEqual(downhill.tempo, 500000)
        self.assertEqual(downhill.ppq, source.ppq)
        self.assertTrue(set(source.notes).issubset(set(downhill.notes)))
        self.assertEqual([n for n in source.notes if n.channel == 4], [n for n in downhill.notes if n.channel == 4])
        self.assertGreater(len([n for n in downhill.notes if n.channel in [2, 9]]),
                           len([n for n in source.notes if n.channel in [2, 9]]))

    def test_office_vibraphone_takes_two_sections_of_the_whistle(self):
        data = (OUT / "peak-downhill.mid").read_bytes()
        self.assertIn(bytes([0xc4, 11]), data)
        self.assertIn(bytes([0xc4, 78]), data)
        self.assertIn(bytes([0xc9, 40]), data)  # GM brush kit

    def test_finish_keeps_the_original_summit_answer(self):
        source = read_score(OUT / "peak-summit.mid")
        downhill = read_score(OUT / "peak-downhill-finish.mid")
        self.assertTrue(set(source.notes).issubset(set(downhill.notes)))
        self.assertEqual(downhill.tempo, 500000)

    def test_decoded_music_has_musical_lengths_headroom_and_small_files(self):
        manifest = json.loads((OUT / "downhill-manifest.json").read_text())
        self.assertEqual((manifest["bpm"], manifest["bars"]), (120, 32))
        total = 0
        for asset in manifest["assets"]:
            path = OUT / f"{asset['id']}.mp3"
            samples, rate = sf.read(path, always_2d=True)
            self.assertEqual(rate, 44100)
            self.assertEqual(samples.shape[1], 2)
            self.assertLess(abs(len(samples) / rate - asset["duration"]), .001)
            self.assertGreater(np.sqrt(np.mean(samples * samples)), .03)
            self.assertLess(np.max(np.abs(samples)), .8)
            self.assertLess(abs(np.mean(samples)), .001)
            total += path.stat().st_size
            if asset["loop"]:
                self.assertEqual(asset["duration"], 64)
            else:
                self.assertLess(asset["duration"], 5)
        self.assertLess(total, 1_000_000)


if __name__ == "__main__":
    unittest.main()

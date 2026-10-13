"""Compress the games' sound effects for the browser: each WAV in a folder gets an AAC .m4a next to it, the file the
game loads. The WAVs stay as the masters. See audio/README.md, "Formats".

    python tools/compress_audio.py                          # audio/
    python tools/compress_audio.py audio/downhill           # any folder; its manifest.json says which sounds loop
    python tools/compress_audio.py audio --loop fall        # or name the loops

AAC-LC in an MP4 (.m4a), 48 kbit/s a channel, at the WAV's own rate: every browser decodes it with Web Audio, Safari
on iOS too (it's Apple's own format; Opus only decodes there since iOS 17.4), and the decoders trim the encoder's
delay, so a sound keeps its length to the sample. A loop gets LOOP_PAD seconds of its own other end on both sides
before it's encoded, so the codec's edges land outside the loop; the game cuts them off again after decoding
(unpadLoop in sounds.js). Each file is checked to play for exactly the WAV's length, and only written when its bytes
change, so a run over files that are up to date changes nothing. Needs FFmpeg on the PATH.
"""
import argparse
import json
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOP_PAD = 0.2          # seconds, a whole number of frames at the usual rates; sounds.js has the same number
BITRATE = 48            # kbit/s a channel
SKIP = {"preview", "fall-preview"}      # listening reels, not in the game


def loops_in(folder):
    """The sounds the folder's manifest.json marks as loops ({"sounds": [{"name" or "id": …, "loop": true}]})."""
    manifest = folder / "manifest.json"
    if not manifest.is_file():
        return set()
    sounds = json.loads(manifest.read_text(encoding="utf-8")).get("sounds", [])
    return {s.get("name") or s.get("id") for s in sounds if s.get("loop")}


def padded(source, target, pad):
    """The WAV with `pad` seconds of its end before it and of its start after it, so it wraps into itself."""
    with wave.open(str(source), "rb") as w:
        params, frames = w.getparams(), w.readframes(w.getnframes())
    size = params.sampwidth * params.nchannels
    n = round(pad * params.framerate) * size
    if len(frames) < 2 * n:
        raise ValueError(f"{source.name}: a loop shorter than {2 * pad} s can't be padded")
    with wave.open(str(target), "wb") as w:
        w.setparams(params)
        w.writeframes(frames[-n:] + frames + frames[:n])


def played(data):
    """An .m4a's rate and the frames a browser plays of it: the track's length (mdhd) less the encoder delay that
    its edit list skips. (The edit list's own duration is in milliseconds, too coarse to check.)"""
    def box(data, path):
        i = 0
        while i + 8 <= len(data):
            size, kind = struct.unpack(">I4s", data[i:i + 8])
            if kind == path[0]:
                return data[i + 8:i + size] if len(path) == 1 else box(data[i + 8:i + size], path[1:])
            i += size
        raise ValueError(f"no {path[0].decode()} box in the .m4a")
    mdhd, elst = box(data, [b"moov", b"trak", b"mdia", b"mdhd"]), box(data, [b"moov", b"trak", b"edts", b"elst"])
    rate, length = struct.unpack(">II", mdhd[12:20]) if mdhd[0] == 0 else struct.unpack(">IQ", mdhd[20:32])
    skip = struct.unpack(">i", elst[12:16])[0] if elst[0] == 0 else struct.unpack(">q", elst[16:24])[0]
    return rate, length - skip


def compress(source, loop, scratch):
    """Encode one WAV; True when its .m4a changed."""
    with wave.open(str(source), "rb") as w:
        channels, rate, length = w.getnchannels(), w.getframerate(), w.getnframes()
    feed = source
    if loop:
        feed = scratch / f"{source.stem}.wav"
        padded(source, feed, LOOP_PAD)
    out = scratch / f"{source.stem}.m4a"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(feed), "-map_metadata", "-1", "-c:a", "aac",
                    "-b:a", f"{BITRATE * channels}k", "-movflags", "+faststart", "-fflags", "+bitexact",
                    "-flags:a", "+bitexact", str(out)], check=True)
    data = out.read_bytes()
    expected = length + (2 * round(LOOP_PAD * rate) if loop else 0)
    if played(data) != (rate, expected):
        raise ValueError(f"{source.name}: the .m4a plays {played(data)} (rate, frames), not {(rate, expected)}")
    target = source.with_suffix(".m4a")
    changed = not target.is_file() or target.read_bytes() != data
    if changed:
        target.write_bytes(data)
    return changed


def main(argv=None):
    p = argparse.ArgumentParser(description="Compress a folder's WAV sound effects to .m4a for the games")
    p.add_argument("folders", nargs="*", type=Path, default=[ROOT / "audio"], help="folders of WAVs (audio/)")
    p.add_argument("--loop", action="append", default=[], metavar="NAME", help="a sound that loops (repeatable)")
    args = p.parse_args(argv)
    total = [0, 0]
    with tempfile.TemporaryDirectory() as scratch:
        for folder in args.folders:
            loops = loops_in(folder) | set(args.loop)
            for source in sorted(folder.glob("*.wav")):
                if source.stem in SKIP:
                    continue
                changed = compress(source, source.stem in loops, Path(scratch))
                before, after = source.stat().st_size, source.with_suffix(".m4a").stat().st_size
                total[0] += before
                total[1] += after
                name = source.resolve()
                print(f"{name.relative_to(ROOT).as_posix() if ROOT in name.parents else source}: "
                      f"{before:,} B -> {after:,} B ({after / before:.0%}){' loop' if source.stem in loops else ''}"
                      f"{'' if changed else ', unchanged'}")
    if total[0]:
        print(f"{total[0]:,} B of WAV -> {total[1]:,} B of .m4a ({total[1] / total[0]:.0%})")
    else:
        print("no WAVs found", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Quick start for a new song: approximate data the app can play right away, before the analysis.

Writes, next to the song config's "lyrics" / "audioData" files, the .approx.json fallbacks the app
loads when the aligned data is missing (see app/song.ts):

  * lyrics.approx.json: every word of lyrics.src.js, spread over its line by length (conf 0),
  * audio.approx.json:  a constant-tempo beat grid (--bpm / --first-beat, or a librosa estimate),
    downbeats, sections (the profile's SECTION_BARS, else guessed from gaps between lyric lines),
    rough rms / low envelopes and kick pulses on every beat.

Needs only the standard library plus soundfile (for the duration; ffprobe is the fallback). With
numpy it adds envelopes; with librosa it can estimate the tempo. Run from analysis/:

  SONG=songs/mysong uv run python bootstrap.py --bpm 120 --first-beat 0.52
  python3 bootstrap.py --bpm 120 --first-beat 0.52 --force     # overwrite existing .approx.json

Then preview: cd app && SONG=... bun run dev. The full pipeline (stems, analyze.py, align.py)
replaces these with measured data/*.json later.
"""
import argparse
import json
import math
import re
import subprocess
import sys

import common

P_ = common.PROFILE


def duration():
    try:
        return common.duration()
    except Exception as e:  # soundfile missing or cannot read the format
        try:
            out = subprocess.run(["ffmpeg", "-v", "error", "-i", str(common.AUDIO), "-f", "s16le", "-ac", "1",
                                  "-ar", "48000", "-"], capture_output=True, check=True).stdout
            return len(out) / 2 / 48000
        except (OSError, subprocess.CalledProcessError):
            sys.exit(f"cannot read the duration of {common.AUDIO} ({e}); install soundfile or ffmpeg")


def load_mono(sr):
    """Mix as a numpy array at sr (None if numpy / soundfile are unavailable)."""
    try:
        import numpy as np
        import soundfile as sf
        y, s = sf.read(str(common.AUDIO), dtype="float32", always_2d=True)
    except Exception:
        return None
    y = y.mean(axis=1)
    if s != sr:
        n = int(round(len(y) * sr / s))
        y = np.interp(np.arange(n) * (s / sr), np.arange(len(y)), y).astype(np.float32)
    return y


def estimate_grid(y, sr):
    try:
        import librosa
        import numpy as np
    except ImportError:
        sys.exit("pass --bpm and --first-beat (or install librosa for an estimate)")
    lo, hi = P_.BPM_RANGE
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, start_bpm=(lo + hi) / 2, units="time")
    bpm = float(np.atleast_1d(tempo)[0])
    while bpm < lo:
        bpm *= 2
    while bpm > hi:
        bpm /= 2
    P = 60 / bpm
    # phase: circular mean of the tracked beats on the constant grid
    ph = np.angle(np.mean(np.exp(2j * np.pi * np.asarray(beats) / P)))
    first = (ph / (2 * np.pi) * P) % P
    print(f"estimated {bpm:.2f} BPM, first beat {first:.3f} s (check it; pass --bpm/--first-beat to override)")
    return bpm, first


def envelopes(y, sr, n, fps=100):
    import numpy as np
    hop = sr // fps
    Y = np.fft.rfft(y)
    Y[int(150 * len(y) / sr):] = 0
    low = np.fft.irfft(Y, len(y))

    def env(x):
        x = np.pad(x, (0, max(0, n * hop - len(x))))[: n * hop].reshape(n, hop)
        e = np.sqrt((x.astype(np.float64) ** 2).mean(axis=1))
        e = np.convolve(e, np.ones(5) / 5, mode="same")
        return [round(float(v), 3) for v in np.clip(e / (np.percentile(e, 99) + 1e-9), 0, 1)]
    return {"rms": env(y), "low": env(low)}


def approx_lyrics(lines):
    out = []
    for i, (s, e, text) in enumerate(lines):
        toks = text.split(" ")
        gap = 0.02
        span = max(0.05, e - s - gap * (len(toks) - 1))
        weights = [max(1, len(re.sub(r"\W", "", t))) for t in toks]
        t, words = s, []
        for tok, w in zip(toks, weights):
            d = span * w / sum(weights)
            words.append(dict(w=tok, start=round(t, 3), end=round(t + d, 3), conf=0))
            t += d + gap
        out.append(dict(i=i, text=text, start=words[0]["start"], end=words[-1]["end"], words=words))
    return dict(lines=out, extras=[], notes="approximate: words spread over each line by length (bootstrap.py)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bpm", type=float, help="tempo (constant); omitted: librosa estimate")
    ap.add_argument("--first-beat", type=float, default=None, help="time (s) of the first beat of the grid")
    ap.add_argument("--beats-per-bar", type=int, default=P_.BEATS_PER_BAR)
    ap.add_argument("--first-downbeat-beat", type=int, default=P_.FIRST_DOWNBEAT_BEAT,
                    help="index of the first downbeat in the grid (0 = the first beat)")
    ap.add_argument("--force", action="store_true", help="overwrite existing .approx.json files")
    a = ap.parse_args()

    lyr_out, aud_out = common.approx_of(common.LYRICS_OUT), common.approx_of(common.AUDIO_OUT)
    for p in (lyr_out, aud_out):
        if p.exists() and not a.force:
            sys.exit(f"{p} exists (use --force to overwrite)")
    lines = common.load_lyrics_src()
    for k, (s, e, t) in enumerate(lines):
        if not (isinstance(s, (int, float)) and isinstance(e, (int, float)) and e > s and t.strip()):
            sys.exit(f"{common.LYRICS_SRC}: line {k} needs [start, end, \"text\"] with end > start")

    dur = duration()
    FPS = 100
    sr = 22050
    y = load_mono(sr)
    if a.bpm is None:
        if y is None:
            sys.exit("pass --bpm and --first-beat (no numpy/soundfile for an estimate)")
        bpm, first = estimate_grid(y, sr)
    else:
        bpm, first = a.bpm, a.first_beat if a.first_beat is not None else 0.0
    if not (20 <= bpm <= 400) or a.beats_per_bar < 1:
        sys.exit("unreasonable --bpm / --beats-per-bar")
    P = 60 / bpm
    first %= P
    B, d0 = a.beats_per_bar, a.first_downbeat_beat
    nb = int((dur - first) / P) + 1
    beats = [round(first + k * P, 3) for k in range(nb)]
    downbeats = [beats[k] for k in range(nb) if (k - d0) % B == 0]
    bar_t = lambda k: first + P * (d0 + B * k)

    if P_.SECTION_BARS:
        sections = [dict(name=n, start=round(0.0 if s is None else bar_t(s), 3), end=round(dur if e is None else bar_t(e), 3))
                    for n, s, e in P_.SECTION_BARS]
    else:
        sections = common.auto_sections(lines, downbeats, P, dur)

    n = int(math.ceil(dur * FPS))
    feats = envelopes(y, sr, n, FPS) if y is not None else {}
    doc = dict(duration=round(dur, 3), bpm=round(bpm, 3), beat_period=round(P, 5), time_signature=B, fps=FPS,
               beats=beats, downbeats=downbeats, sections=sections, features=feats,
               onsets={"kick": [[t, 1 if (k - d0) % B == 0 else 0.6] for k, t in enumerate(beats)]},
               notes="approximate: constant beat grid from bootstrap.py; envelopes are rough (mix rms, <150 Hz)")
    common.write_json(aud_out, doc, separators=(",", ":"))
    common.write_json(lyr_out, approx_lyrics(lines), indent=1, ensure_ascii=False)
    print(f"wrote {aud_out}: {bpm:.2f} BPM, {len(beats)} beats, {len(sections)} sections "
          f"({', '.join(s['name'] for s in sections)}){'' if feats else ', no envelopes (numpy/soundfile missing)'}")
    print(f"wrote {lyr_out}: {len(lines)} lines, {sum(len(t.split(' ')) for _, _, t in lines)} words")


if __name__ == "__main__":
    main()

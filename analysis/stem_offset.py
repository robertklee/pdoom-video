"""Measure the stems' time offset against the mix -> STEM_OFFSET_SAMPLES for the analysis profile.

Demucs may decode the mp3 without trimming the encoder delay, so its stems can start a few ms late
relative to the gapless decode (the timeline). This cross-correlates the mix with the sum of the
four raw stems over several windows and prints the lag in samples @ 44.1 kHz; put it in
songs/<song>.py as STEM_OFFSET_SAMPLES (positive = stems are late, that many samples get dropped).

Run:  uv run python stem_offset.py
"""
import common

import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve

SR = 44100
MAX_LAG = 4096
WIN = 10 * SR


def main():
    mix, _ = common.load_mix(SR)
    st = None
    for n in ("vocals", "drums", "bass", "other"):
        y, s = sf.read(common.STEMS / f"{n}.wav", dtype="float32", always_2d=True)
        assert s == SR, f"{n}.wav: expected {SR} Hz, got {s}"
        y = y.mean(axis=1)
        st = y if st is None else st[: len(y)] + y[: len(st)]
    n = min(len(mix), len(st))
    lags = []
    for a in range(SR * 5, n - WIN - MAX_LAG, max(WIN, (n - WIN) // 8)):
        x = mix[a: a + WIN]
        y = st[a: a + WIN + MAX_LAG]          # stems late by L: st[a + L + i] ~ mix[a + i]
        if np.sqrt(np.mean(x ** 2)) < 1e-3:
            continue
        c = fftconvolve(y, x[::-1], mode="valid")   # c[L] = sum_i y[L + i] x[i], L = 0..MAX_LAG
        lags.append(int(np.argmax(c)))
    if not lags:
        raise SystemExit("no loud windows to correlate")
    lag = int(np.median(lags))
    print(f"windows: {lags}")
    print(f"STEM_OFFSET_SAMPLES = {lag}   ({lag / SR * 1000:.1f} ms; current profile: {common.STEM_OFFSET_SAMPLES})")
    if max(lags) - min(lags) > 2:
        print("warning: lag varies between windows; check the stems")


if __name__ == "__main__":
    main()

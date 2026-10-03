"""Measure the Demucs stems' time offset against the gapless decode of the song
by cross-correlation -> song.STEM_OFFSET_SAMPLES.

Demucs can decode an mp3 without trimming the encoder delay, so its stems run
late by a constant number of samples.  The sum of the raw (unshifted) stems is
cross-correlated with the mix in windows spread over the song; the lag should
be the same in every window.

Run (after Demucs, see README):  uv run python stem_offset.py
"""
import common
import numpy as np
import soundfile as sf
from scipy.signal import correlate

SR = 44100
STEMS = ("vocals", "drums", "bass", "other")


def raw_stem_sum():
    total = None
    for n in STEMS:
        y, s = sf.read(common.STEMS / f"{n}.wav", dtype="float32", always_2d=True)
        assert s == SR, f"{n}.wav: {s} Hz, expected {SR}"
        y = y.mean(axis=1)
        if total is None:
            total = y
        else:
            m = min(len(total), len(y))
            total = total[:m] + y[:m]
    return total


def measure(mix, stems, n_win=16, win_s=6.0, max_lag=4096):
    """Lag d (samples) with stems[n + d] ~ mix[n], per window (loud windows only)."""
    L = int(win_s * SR)
    lo, hi = max_lag, min(len(mix), len(stems)) - L - max_lag
    if hi <= lo:
        raise SystemExit("audio too short for the measurement windows")
    starts = np.linspace(lo, hi, n_win).astype(int)
    level = np.sqrt(np.mean(mix ** 2)) + 1e-12
    lags = []
    for a in starts:
        m = mix[a:a + L]
        if np.sqrt(np.mean(m ** 2)) < 0.3 * level:
            continue  # near-silent: no reliable peak
        s = stems[a - max_lag:a + L + max_lag]
        r = correlate(s, m, mode="valid", method="fft")
        lags.append((a / SR, int(np.argmax(r)) - max_lag))
    return lags


def main():
    mix, _ = common.load_mix(SR)
    lags = measure(mix, raw_stem_sum())
    if not lags:
        raise SystemExit("no window loud enough to measure")
    for t, d in lags:
        print(f"  {t:7.2f} s  lag {d:+5d} samples ({d / SR * 1000:+.1f} ms)")
    d = np.array([x[1] for x in lags])
    med = int(np.median(d))
    print(f"median lag {med:+d} samples ({med / SR * 1000:+.2f} ms) @ {SR} Hz, "
          f"spread {d.min():+d}..{d.max():+d} over {len(d)} windows")
    if d.max() - d.min() > 2:
        print("WARNING: the lag is not constant over the song; check the stems")
    print(f"-> song.py: STEM_OFFSET_SAMPLES = {med}   (currently {common.STEM_OFFSET_SAMPLES})")


if __name__ == "__main__":
    main()

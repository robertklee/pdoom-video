"""Deterministic placeholder music bed (numpy + scipy) for a project whose
licensed track has not been delivered yet.

Same tempo and bar structure as the cue sheet in the analysis profile
(PLACEHOLDER_BED = dict(bpm=, bars=, seed=) and SECTION_BARS), so analyze.py
gives the same grid the real bed will, and the edit built on it carries over
when the licensed track replaces the file.  Instrumentation per section name:
intro/outro pads, build + bass and hats, main + kick and snare, lift + arpeggio.

Run:  python placeholder_bed.py --project search      -> manifest audio.music
"""
import common
import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000
# I - V - vi - IV in D major, two bars per chord (MIDI notes)
CHORDS = [(50, 54, 57, 62), (45, 49, 52, 57), (47, 50, 54, 59), (43, 47, 50, 55)]
INSTR = {
    "intro": {"pad"},
    "build": {"pad", "bass", "hat"},
    "main": {"pad", "bass", "hat", "kick", "snare"},
    "lift": {"pad", "bass", "hat", "kick", "snare", "arp"},
    "outro": {"pad"},
}


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def section_of(bar):
    for name, a, b in common.PROFILE.SECTION_BARS or []:
        if (a is None or bar >= a) and (b is None or bar < b):
            return name
    return "main"


def main():
    cfg = common.PROFILE.PLACEHOLDER_BED
    if not cfg:
        raise SystemExit(f"profile '{common.PROFILE.NAME}' has no PLACEHOLDER_BED")
    if common.MUSIC is None:
        raise SystemExit(f"project '{common.PROJECT_ID}' has no audio.music path in its manifest")
    rng = np.random.default_rng(cfg.get("seed", 0))
    P = 60.0 / cfg["bpm"]
    bars = cfg["bars"]
    bar = 4 * P
    total = bars * bar + 2.5
    n = int(total * SR)
    out = np.zeros((2, n), np.float64)

    def add(t0, sig, gain=1.0, pan=0.0):
        i = int(round(t0 * SR))
        if i >= n:
            return
        sig = sig[: n - i]
        out[0, i:i + len(sig)] += sig * gain * np.sqrt(0.5 * (1 - pan))
        out[1, i:i + len(sig)] += sig * gain * np.sqrt(0.5 * (1 + pan))

    def env(length, attack, decay):
        t = np.arange(int(length * SR)) / SR
        return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)

    hp = butter(4, 7000, "high", fs=SR, output="sos")
    bp = butter(2, [900, 5000], "band", fs=SR, output="sos")
    for k in range(bars):
        name = section_of(k)
        ins = INSTR.get(name, INSTR["main"])
        t_bar = k * bar
        chord = CHORDS[(k // 2) % len(CHORDS)]
        if "pad" in ins and k % 2 == 0:
            # 2-bar chord with soft attack and a release tail into the next
            L = 2 * bar + 1.2
            t = np.arange(int(L * SR)) / SR
            amp = np.minimum(1, t / 0.6) * np.clip((L - t) / 1.2, 0, 1)
            if name == "intro" and k == 0:
                amp *= np.minimum(1, t / (2 * bar))
            if name == "outro" and k + 2 >= bars:
                amp *= np.exp(-t / 2.5)
            for j, m in enumerate((chord[0] - 12,) + chord):
                for det, pan in ((-0.0015, -0.6), (0.0015, 0.6)):
                    f = hz(m + 12 if j else m) * (1 + det)
                    sig = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
                    add(t_bar, sig * amp, 0.05, pan)
        for b in range(4):
            tb = t_bar + b * P
            if "kick" in ins:
                L = 0.35
                t = np.arange(int(L * SR)) / SR
                f = 48 + 100 * np.exp(-t / 0.03)
                add(tb, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.12), 0.9)
            if "snare" in ins and b in (1, 3):
                e = env(0.25, 0.001, 0.07)
                noise = sosfilt(bp, rng.standard_normal(len(e)))
                t = np.arange(len(e)) / SR
                add(tb, noise * e * 0.35 + np.sin(2 * np.pi * 190 * t) * env(0.25, 0.001, 0.04) * 0.3, 0.8)
            if "hat" in ins:
                e = env(0.06, 0.0005, 0.018)
                add(tb + P / 2, sosfilt(hp, rng.standard_normal(len(e))) * e, 0.35, 0.3)
            if "bass" in ins:
                for h in range(2):
                    e = env(P / 2, 0.004, 0.18)
                    t = np.arange(len(e)) / SR
                    f = hz(chord[0] - 12)
                    add(tb + h * P / 2, np.tanh(1.6 * np.sin(2 * np.pi * f * t)) * e, 0.32)
            if "arp" in ins:
                for s in range(4):
                    m = chord[(b * 4 + s) % len(chord)] + 24
                    e = env(P / 4 + 0.1, 0.002, 0.07)
                    t = np.arange(len(e)) / SR
                    add(tb + s * P / 4, np.sin(2 * np.pi * hz(m) * t) * e, 0.07, 0.4 if s % 2 else -0.4)
    out *= 10 ** (-1 / 20) / np.abs(out).max()
    import soundfile as sf
    common.MUSIC.parent.mkdir(parents=True, exist_ok=True)
    sf.write(common.MUSIC, out.T.astype(np.float32), SR, subtype="PCM_24")
    print(f"wrote {common.MUSIC.relative_to(common.REPO)}: {cfg['bpm']} BPM, {bars} bars, {total:.2f} s")


if __name__ == "__main__":
    main()

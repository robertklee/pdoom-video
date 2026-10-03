"""Shared paths / cache setup for the analysis scripts, and the active song.

Import this module FIRST (before torch / huggingface / mlx imports) so that all
model downloads land in analysis/.cache/.

The song comes from a song config (song.json at the repo root: the P(doom) video). Pick another
with SONG=<config file or folder holding song.json>, absolute or relative to the repo root; paths
inside the config are relative to its folder (see app/song.ts, which reads the same file). Its
analysis profile (analysis/songs/<name>.py: section map, manual fixes, pronunciations...) is
PROFILE; names it leaves out come from songs/_template.py.
"""
import importlib
import json
import math
import os
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent          # analysis/
PROJECT = ROOT.parent                            # repo root
CACHE = ROOT / ".cache"
for var, sub in [("TORCH_HOME", "torch"), ("HF_HOME", "hf"), ("HF_HUB_CACHE", "hf/hub"),
                 ("XDG_CACHE_HOME", "xdg"), ("HUGGINGFACE_HUB_CACHE", "hf/hub"),
                 ("TRANSFORMERS_CACHE", "hf/transformers"), ("MPLCONFIGDIR", "mpl"),
                 ("NUMBA_CACHE_DIR", "numba"), ("UV_CACHE_DIR", "uv")]:
    os.environ.setdefault(var, str(CACHE / sub))
    (CACHE / sub).mkdir(parents=True, exist_ok=True)


def _load_song(spec):
    f = (PROJECT / (spec or "song.json")).resolve()
    if f.is_dir():
        f = f / "song.json"
    if not f.is_file():
        sys.exit(f"song config not found: {f} (SONG={spec or ''})")
    cfg = json.loads(f.read_text(encoding="utf-8"))
    for k in ("id", "title", "audio", "lyrics", "audioData"):
        if not isinstance(cfg.get(k), str) or not cfg[k]:
            sys.exit(f"{f}: missing \"{k}\"")
    if not all(c.isalnum() or c in "-_" for c in cfg["id"]):
        sys.exit(f"{f}: \"id\" must be letters, digits, - or _")
    d = f.parent

    def path(rel):
        p = (d / rel).resolve()
        if not p.is_relative_to(d):
            sys.exit(f"{f}: \"{rel}\" must be inside the song folder")
        return p
    return cfg, f, path


def _load_profile(name):
    base = importlib.import_module("songs._template")
    if not (ROOT / "songs" / f"{name}.py").is_file():
        print(f"[common] no analysis profile songs/{name}.py: using songs/_template.py defaults", file=sys.stderr)
        mod = base
    else:
        mod = importlib.import_module(f"songs.{name}")
    names = {k: getattr(base, k) for k in dir(base) if not k.startswith("_")}
    names.update({k: getattr(mod, k) for k in dir(mod) if not k.startswith("_")})
    return SimpleNamespace(**names)


SONG, SONG_FILE, song_path = _load_song(os.environ.get("SONG"))
SONG_ID = SONG["id"]
PROFILE = _load_profile(SONG.get("analysis") or SONG_ID)

AUDIO = song_path(SONG["audio"])
LYRICS_SRC = song_path(SONG.get("lyricsSource") or "lyrics.src.js")
LYRICS_OUT = song_path(SONG["lyrics"])          # data/lyrics.json (align.py)
AUDIO_OUT = song_path(SONG["audioData"])        # data/audio.json (analyze.py)
# Demucs names its output folder after the input file
STEMS = ROOT / "stems" / "htdemucs_ft" / AUDIO.stem
# per-song folders; the repo's own song (song.json at the root) keeps the original flat layout
_NS = "" if SONG_FILE == (PROJECT / "song.json").resolve() else SONG_ID
QA = ROOT / "qa" / _NS
WORK = ROOT / "work" / _NS     # intermediate results (whisper json, alignments)
QA.mkdir(parents=True, exist_ok=True)
WORK.mkdir(parents=True, exist_ok=True)


def approx_of(p):
    """data/lyrics.json -> data/lyrics.approx.json (bootstrap.py output, the app's fallback)."""
    return p.with_name(p.name[:-len(".json")] + ".approx.json") if p.name.endswith(".json") else p.with_suffix(".approx.json")


def write_json(p, doc, **kw):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, **kw), encoding="utf-8")


def duration():
    """Length (s) of the gapless decode of the mix: the timeline's time reference."""
    import soundfile as sf
    info = sf.info(str(AUDIO))
    return info.frames / info.samplerate


def load_lyrics_src():
    """Parse lyrics.src.js -> list of (start, end, text)."""
    src = LYRICS_SRC.read_text(encoding="utf-8")
    body = src[src.index("["): src.rindex("]") + 1]
    return [tuple(x) for x in json.loads(body)]


def auto_sections(lines, downbeats, beat_period, duration, gap_bars=0.5, max_bars=8):
    """Sections guessed from the lyrics when the profile has no SECTION_BARS: a new section after
    every gap of >= gap_bars bars between lines, starting on the downbeat of the bar its first line
    starts in (a pickup of < 1 beat counts toward the next bar); sections longer than max_bars are
    split every max_bars bars (a remainder under 2 bars stays with the last piece). Before the first line: intro; after the last line: outro.
    lines: [(start, end, text)]; returns [dict(name, start, end)]."""
    bar = beat_period * 4 if len(downbeats) < 2 else downbeats[1] - downbeats[0]

    def bar_start(t):
        ds = [d for d in downbeats if d <= t + beat_period]
        return ds[-1] if ds else 0.0

    starts = []
    for i, (s, _e, _t) in enumerate(lines):
        if i == 0 or s - lines[i - 1][1] >= gap_bars * bar:
            t = bar_start(s)
            if not starts or t > starts[-1]:
                starts.append(t)
    if starts and starts[0] < bar:   # no room for an intro
        starts[0] = 0.0
    named = [("intro", 0.0)] if not starts or starts[0] > 0 else []
    named += [(f"part{i + 1}", t) for i, t in enumerate(starts)]
    if lines:
        after = [d for d in downbeats if d >= lines[-1][1]]
        if after and after[0] < duration - bar:
            named.append(("outro", after[0]))
    secs = []
    for i, (n, t) in enumerate(named):
        e = named[i + 1][1] if i + 1 < len(named) else duration
        k = 0
        while e - t > 1e-3:
            e1 = e if n == "outro" or e - t < (max_bars + 2) * bar else t + max_bars * bar
            secs.append(dict(name=n if k == 0 else f"{n}{chr(97 + k)}", start=round(t, 3), end=round(e1, 3)))
            t, k = e1, k + 1
    return secs


STEM_OFFSET_SAMPLES = PROFILE.STEM_OFFSET_SAMPLES
STEM_OFFSET_SEC = STEM_OFFSET_SAMPLES / 44100


def load_stem(name, sr=None, mono=True):
    """Load a Demucs stem, time-aligned to the gapless mp3 decode."""
    import soundfile as sf
    import numpy as np
    y, s = sf.read(STEMS / f"{name}.wav", dtype="float32", always_2d=True)
    assert s == 44100
    y = y[STEM_OFFSET_SAMPLES:]
    y = y.mean(axis=1) if mono else y.T
    if sr and sr != s:
        import soxr
        y = soxr.resample(y, s, sr) if mono else np.stack([soxr.resample(c, s, sr) for c in y])
        s = sr
    return y, s


KARAOKE = ROOT / "stems" / "karaoke" / _NS


def load_lead(sr=None, mono=True):
    """Lead vocal only (mel-band-roformer karaoke model run on the mp3; already
    in gapless-mp3 time, no offset)."""
    import soundfile as sf
    import numpy as np
    y, s = sf.read(KARAOKE / "lead.wav", dtype="float32", always_2d=True)
    y = y.mean(axis=1) if mono else y.T
    if sr and sr != s:
        import soxr
        y = soxr.resample(y, s, sr) if mono else np.stack([soxr.resample(c, s, sr) for c in y])
        s = sr
    return y, s


def load_vocal_source(name, sr=None):
    """'vocals' = Demucs vocal stem (mono sum), 'vocL'/'vocR' = its left/right
    channel (choruses are double-tracked and panned L/R, so each channel is
    closer to a single voice), 'lead' = karaoke lead."""
    if name == "lead":
        return load_lead(sr)
    if name in ("vocL", "vocR"):
        y, s = load_stem("vocals", sr=sr, mono=False)
        return y[0 if name == "vocL" else 1], s
    return load_stem("vocals", sr=sr)


def load_mix(sr=44100, mono=True):
    import librosa
    y, s = librosa.load(str(AUDIO), sr=sr, mono=mono)
    return y, s

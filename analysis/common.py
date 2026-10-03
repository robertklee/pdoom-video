"""Shared paths / cache setup for the analysis scripts.

Import this module FIRST (before torch / huggingface / mlx imports) so that all
model downloads land in analysis/.cache/.

Project selection: every script works on one project
(projects/<id>/project.json, default "pdoom") and, for multi-language
projects, one language (default: the first in the manifest).  Choose with
`--project <id> --lang <code>` on any script's command line, or with the
PROJECT / PROJECT_LANG environment variables.  Per-project settings (section
map, tempo range, stem offset, alignment anchors and fixes, ...) live in
analysis/profiles/<profile>.py.
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent          # analysis/
REPO = ROOT.parent                               # repository root
CACHE = ROOT / ".cache"
for var, sub in [("TORCH_HOME", "torch"), ("HF_HOME", "hf"), ("HF_HUB_CACHE", "hf/hub"),
                 ("XDG_CACHE_HOME", "xdg"), ("HUGGINGFACE_HUB_CACHE", "hf/hub"),
                 ("TRANSFORMERS_CACHE", "hf/transformers"), ("MPLCONFIGDIR", "mpl"),
                 ("NUMBA_CACHE_DIR", "numba"), ("UV_CACHE_DIR", "uv")]:
    os.environ.setdefault(var, str(CACHE / sub))
    (CACHE / sub).mkdir(parents=True, exist_ok=True)


def _take_flag(name):
    """Remove `--name value` / `--name=value` from sys.argv; return the value."""
    for i, a in enumerate(sys.argv[1:], 1):
        if a == f"--{name}" and i + 1 < len(sys.argv):
            v = sys.argv[i + 1]
            del sys.argv[i:i + 2]
            return v
        if a.startswith(f"--{name}="):
            del sys.argv[i]
            return a.split("=", 1)[1]
    return None


PROJECT_ID = _take_flag("project") or os.environ.get("PROJECT") or "pdoom"
_mf = REPO / "projects" / PROJECT_ID / "project.json"
if not _mf.exists():
    raise SystemExit(f"unknown project '{PROJECT_ID}' ({_mf} not found)")
MANIFEST = json.loads(_mf.read_text(encoding="utf-8"))
LANGUAGES = [l["code"] for l in MANIFEST.get("languages", [])]
LANG = _take_flag("lang") or os.environ.get("PROJECT_LANG") or (LANGUAGES[0] if LANGUAGES else "en")
if LANGUAGES and LANG not in LANGUAGES:
    raise SystemExit(f"project '{PROJECT_ID}' has no language '{LANG}' (has: {', '.join(LANGUAGES)})")


def repo_path(p):
    """Repo-root-relative manifest path -> absolute Path ({lang} substituted)."""
    return None if not p else REPO / p.replace("{lang}", LANG)


_an = MANIFEST.get("analysis", {})
_au = MANIFEST.get("audio", {})

from profiles import load as _load_profile  # noqa: E402
PROFILE = _load_profile(_an.get("profile", PROJECT_ID), LANG)

MIX = repo_path(_au["mix"])                      # final mix the app plays
MUSIC = repo_path(_au.get("music"))              # separate music bed, if any
VOICE = repo_path(_au.get("voice"))              # separate (clean) voice track, if any
AUDIO = MUSIC or MIX                             # input of analyze.py
STEMS = repo_path(_an.get("stems"))              # Demucs stems of a finished song
LEAD = repo_path(_an.get("lead"))                # karaoke lead-vocal stem
LYRICS_SRC = repo_path(_an.get("script"))        # lyric / voice-over script
LYRICS_OUT = repo_path(MANIFEST["data"]["lyrics"][0])
AUDIO_OUT = repo_path(MANIFEST["data"]["audio"][0])
DATA = LYRICS_OUT.parent
QA = repo_path(_an.get("qa", "analysis/qa"))
WORK = repo_path(_an.get("work", "analysis/work"))  # intermediates (whisper json, alignments)
if LANGUAGES:                                    # alignment intermediates are per language
    QA, WORK = QA / LANG, WORK / LANG
QA.mkdir(parents=True, exist_ok=True)
WORK.mkdir(parents=True, exist_ok=True)
DATA.mkdir(parents=True, exist_ok=True)
AUDIO_OUT.parent.mkdir(parents=True, exist_ok=True)


def strip_markup(s):
    """'*key term*' markup -> plain text."""
    return s.replace("*", "")


def load_script():
    """Voice-over script (JSON): {lang, lines: [{id, text, ...}], ui?, voice?}."""
    if LYRICS_SRC is None or LYRICS_SRC.suffix != ".json":
        raise SystemExit(f"project '{PROJECT_ID}' has no JSON script (analysis.script)")
    doc = json.loads(LYRICS_SRC.read_text(encoding="utf-8"))
    ids = [l["id"] for l in doc["lines"]]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise SystemExit(f"duplicate script line ids: {', '.join(sorted(dup))}")
    return doc


def load_lyrics_src():
    """Lyric lines -> list of (start, end, text).  lyrics.src.js (a song, with
    approximate times) or a JSON voice-over script (times None, *markup*
    removed)."""
    if LYRICS_SRC.suffix == ".json":
        return [(l.get("start"), l.get("end"), " ".join(strip_markup(l["text"]).split()))
                for l in load_script()["lines"]]
    src = LYRICS_SRC.read_text(encoding="utf-8")
    body = src[src.index("["): src.rindex("]") + 1]
    return [tuple(x) for x in json.loads(body)]


# Stems rendered by a separator can be offset against the decode used as the
# time reference (e.g. an mp3's encoder delay); the profile sets the offset.
STEM_OFFSET_SAMPLES = PROFILE.STEM_OFFSET_SAMPLES
STEM_OFFSET_SEC = STEM_OFFSET_SAMPLES / 44100


def _resample(y, s, sr, mono):
    import numpy as np
    if sr and sr != s:
        import soxr
        y = soxr.resample(y, s, sr) if mono else np.stack([soxr.resample(c, s, sr) for c in y])
        s = sr
    return y, s


def load_voice(sr=None, mono=True):
    """The project's clean voice track (no stems needed; already in project time)."""
    import soundfile as sf
    if VOICE is None or not VOICE.exists():
        raise SystemExit(f"no voice track for '{PROJECT_ID}' ({VOICE}); see analysis/voiceover.py")
    y, s = sf.read(VOICE, dtype="float32", always_2d=True)
    y = y.mean(axis=1) if mono else y.T
    return _resample(y, s, sr, mono)


def load_stem(name, sr=None, mono=True):
    """Load a Demucs stem, time-aligned to the gapless mp3 decode.  Projects
    with a separate clean voice track and no stems use it as 'vocals'."""
    import soundfile as sf
    if STEMS is None:
        if name == "vocals" and VOICE is not None:
            return load_voice(sr, mono)
        raise SystemExit(f"project '{PROJECT_ID}' has no stems (stem '{name}' requested)")
    y, s = sf.read(STEMS / f"{name}.wav", dtype="float32", always_2d=True)
    assert s == 44100
    y = y[STEM_OFFSET_SAMPLES:]
    y = y.mean(axis=1) if mono else y.T
    return _resample(y, s, sr, mono)


KARAOKE = LEAD.parent if LEAD else None


def load_lead(sr=None, mono=True):
    """Lead vocal only (mel-band-roformer karaoke model run on the mp3; already
    in gapless-mp3 time, no offset)."""
    import soundfile as sf
    if LEAD is None:
        raise SystemExit(f"project '{PROJECT_ID}' has no lead-vocal stem (analysis.lead)")
    y, s = sf.read(LEAD, dtype="float32", always_2d=True)
    y = y.mean(axis=1) if mono else y.T
    return _resample(y, s, sr, mono)


def load_vocal_source(name, sr=None):
    """'vocals' = Demucs vocal stem (mono sum) or the clean voice track,
    'vocL'/'vocR' = its left/right channel (choruses are double-tracked and
    panned L/R, so each channel is closer to a single voice), 'lead' = karaoke
    lead."""
    if name == "lead":
        return load_lead(sr)
    if name in ("vocL", "vocR"):
        y, s = load_stem("vocals", sr=sr, mono=False)
        return y[0 if name == "vocL" else 1], s
    return load_stem("vocals", sr=sr)


def load_mix(sr=44100, mono=True):
    """The analysis input: the music bed if the project has one, else the mix."""
    import librosa
    y, s = librosa.load(str(AUDIO), sr=sr, mono=mono)
    return y, s

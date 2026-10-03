"""Per-project analysis settings.

A profile is a module analysis/profiles/<name>.py (named by the manifest's
`analysis.profile`).  It overrides any of the DEFAULTS below; a `LANGS` dict
in the profile maps language codes to further overrides, e.g.
LANGS = {"de": dict(PRIMARY="mms", ALTS=())}.
"""
import importlib
from types import SimpleNamespace


def _audio_notes(**k):
    return ("Constant-tempo grid fitted on onset envelopes ({bpm:.3f} BPM, period {P:.5f} s, "
            "first beat {off:.3f} s, first downbeat {first_db:.3f} s; bar k starts at "
            "first_downbeat + k*4*period). Envelopes: 100 fps, 46 ms RMS window, one-pole "
            "smoothing (10 ms attack / 90 ms release), each divided by its 99th percentile and "
            "clipped to 0..1. Onsets [time, strength 0-1]: kick <120 Hz ({kk}), snare 1.5-5 kHz "
            "with a noise tail ({sn}), hat >7 kHz ({hh}).").format(**k)


DEFAULTS = dict(
    # analyze.py ---------------------------------------------------------------
    # (name, first bar, end bar); bar k starts at downbeat k, None = start/end
    # of the audio.  None -> one section over the whole track.
    SECTION_BARS=None,
    TEMPO_RANGE=(80.0, 160.0),     # BPM search range of the beat-grid fit
    DOWNBEAT_BEAT=0,               # index of the first beat that is a downbeat
    PLOT_WINDOWS=None,             # [(t0, t1)] QA plot windows; None -> every 12 s
    audio_notes=_audio_notes,      # f(bpm, off, P, first_db, bar_t, kk, sn, hh) -> str
    # stems ------------------------------------------------------------------
    STEM_OFFSET_SAMPLES=0,         # @ 44.1 kHz, stems -> time reference
    # alignment (ctc_emissions.py / ctcalign.py / align.py) ---------------------
    CTC_MODELS=("mms", "lv60k"),   # lv60k is English-only; mms is multilingual
    EMISSION_SOURCES=("vocals",),  # vocals | lead | vocL | vocR
    PRIMARY="fused",               # emission set of the main path (see ctcalign.emissions)
    ALTS=("mms", "lv60k"),         # alternatives, for agreement-based confidence
    N_FRAMES=None,                 # pad emissions to this many 20 ms frames (None: as computed)
    LINE_WINDOWS={},               # {line: (t_lo, t_hi)}
    ANCHORS={},                    # {(line, token, subword): (t_lo, t_hi)}
    FIX={},                        # {(line, token): dict(start=, end=, syl=[...], conf=)}
    EXTRA_DESC=[],                 # [(t0, t1, description)] of known non-script vocals
    ALIGN_NOTES="CTC forced alignment of the script on the voice track.",
    PRON={},                       # display token -> pronunciation spelling
    PRON_ALT={},                   # alternative pronunciations to test
    WHISPER_PROMPT=None,
    # voiceover.py / placeholder_bed.py ------------------------------------------
    SYLLABLE_RATE=4.2,             # draft timing: spoken syllables per second
    PLACEHOLDER_BED=None,          # dict(bpm=, bars=, seed=) for placeholder_bed.py
)


def load(name, lang="en"):
    try:
        mod = importlib.import_module(f"profiles.{name}")
    except ModuleNotFoundError as e:
        if e.name != f"profiles.{name}":
            raise
        raise SystemExit(f"no analysis profile 'analysis/profiles/{name}.py'")
    p = dict(DEFAULTS)
    p.update({k: getattr(mod, k) for k in dir(mod) if k in DEFAULTS})
    p.update(getattr(mod, "LANGS", {}).get(lang, {}))
    unknown = set(getattr(mod, "LANGS", {}).get(lang, {})) - set(DEFAULTS)
    if unknown:
        raise SystemExit(f"profile '{name}' LANGS['{lang}']: unknown settings {sorted(unknown)}")
    p["NAME"] = name
    return SimpleNamespace(**p)

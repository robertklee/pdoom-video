"""Analysis profile template: copy to songs/<song id>.py for a new song (or name it in the song
config's "analysis" key) and fill it in as you go. Names a profile leaves out fall back to these
defaults, so a new song runs with an empty profile; add fixes only where the QA plots show the
automatic result is wrong.
"""

# ---------------------------------------------------------------------------- audio / stems
# Samples (@ 44.1 kHz) to drop from the start of the Demucs stems so they line up with the gapless
# decode of the mix (mp3 encoder delay). Measure it: `uv run python stem_offset.py`.
STEM_OFFSET_SAMPLES = 0


# ---------------------------------------------------------------------------- music (analyze.py)
# Tempo search range (BPM) of the constant-tempo grid fit. Keep it tight around the song's tempo
# (a range spanning 2x picks half/double time).
BPM_RANGE = (70.0, 180.0)
# Beats per bar, and the beat index (0-based, from the first beat of the grid) of the first downbeat.
# The fit cannot tell bar phase: check the QA plots (drums_pattern / chord changes) and set it.
BEATS_PER_BAR = 4
FIRST_DOWNBEAT_BEAT = 0

# Section map in bars: (name, first bar, end bar), bar k starts at downbeat k; None = song start/end.
# Empty: sections are guessed from the gaps between lyric lines (common.auto_sections).
#   SECTION_BARS = [("intro", None, 1), ("verse1", 1, 9), ("chorus1", 9, 17), ("outro", 17, None)]
SECTION_BARS = []

# analyze.py --plots: time windows (s) of the drums/envelope QA plots (None: 12 s every 20 s)
QA_WINDOWS = None

AUDIO_NOTES = (
    "Constant tempo {bpm:.3f} BPM (period {P:.5f} s), first beat {off:.3f} s, first downbeat "
    "{first_db:.3f} s. Envelopes: 100 fps, normalised 0..1. Onsets from the drums stem: "
    "{kk} kicks, {sn} snares, {hh} hats."
)


def audio_notes(bpm, P, off, first_db, bar_t, kk, sn, hh):
    """Free-text notes stored in audio.json."""
    return AUDIO_NOTES.format(bpm=bpm, P=P, off=off, first_db=first_db, kk=kk, sn=sn, hh=hh)


# ---------------------------------------------------------------------------- lyrics (align.py)
# Per-line time windows (seconds) where the automatic path is ambiguous: {line: (t0, t1)}.
LINE_WINDOWS = {}
# Anchors for the CTC path: (line, token, subword) -> (earliest start, latest end) of its chars.
ANCHORS = {}
# Manual corrections after refinement: (line, token) -> dict(start=..., end=..., syl=[...], conf=...).
FIX = {}
# Known vocals that are not in the lyric text: (t0, t1, description), listed as "extras".
EXTRA_DESC = []
LYRICS_NOTES = "Word timings from CTC forced alignment of the vocal stem (see analysis/align.py)."


# ---------------------------------------------------------------------------- pronunciation (pron.py)
# Display token (as split on spaces, punctuation attached) -> pronunciation spelled in plain letters,
# for acronyms, numbers and odd words:  {"AGI": "ay gee i", "NVDA": "en vee dee ay"}
PRON = {}
PRON_ALT = {}


# ---------------------------------------------------------------------------- whisper (whisper_run.py)
# The lv60k CTC model is English-only; MMS_FA works for other languages (romanised).
LANGUAGE = "en"
# Optional vocabulary hint for Whisper (names and jargon in the lyrics).
WHISPER_PROMPT = None

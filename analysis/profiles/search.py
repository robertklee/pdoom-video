"""Analysis profile: "Acme Search" launch film (voice-over + licensed music bed).

The voice and the music arrive as separate tracks, so there is no stem
separation and no stem offset.  analyze.py runs on the music bed only (beats,
downbeats, sections for snapping cuts); words come from the TTS engine's word
marks or, for a human read, from CTC forced alignment of the clean voice track
(align.py), Whisper being the cross-check.
"""

# -- analyze.py ---------------------------------------------------------------
# Music sections of the bed in bars, from the composer's cue sheet (here: the
# placeholder bed below).  Script lines are pinned to bars in the script itself
# (projects/search/script/<lang>.json, "bar").
SECTION_BARS = [
    ("intro", None, 2),      # pads only
    ("build", 2, 10),        # + hats, bass
    ("main", 10, 18),        # full kit: lands with the results
    ("lift", 18, 22),        # + arpeggio: proof points
    ("outro", 22, None),     # pads ring out under the end card
]
TEMPO_RANGE = (100.0, 120.0)
DOWNBEAT_BEAT = 0


def audio_notes(bpm, off, P, first_db, bar_t, sn, kk, hh):
    return (f"Music bed only (voice is a separate track, mixed and ducked by app/scripts/mix.ts). "
            f"Constant tempo {bpm:.3f} BPM (period {P:.5f} s), first beat {off:.3f} s, first "
            f"downbeat {first_db:.3f} s; bar k starts at first_downbeat + k*4*period. Sections "
            f"from the cue sheet (analysis/profiles/search.py). Envelopes: 100 fps, normalised "
            f"0..1 (rms / low <150 Hz / mid / high >4 kHz of the bed). Onsets from the bed's "
            f"bands: kick {kk}, snare {sn}, hat {hh}.")


# Stand-in for the licensed bed until it is delivered: same tempo and bar
# structure, so the edit (which only reads the analysis) does not change when
# the real track replaces it.
PLACEHOLDER_BED = dict(bpm=110.0, bars=26, seed=11)

# -- alignment (human read; TTS word marks need none of this) -----------------
CTC_MODELS = ("mms", "lv60k")
EMISSION_SOURCES = ("vocals",)
PRIMARY = "fused"            # MMS_FA + LV60K mixture on the clean voice
ALTS = ("mms", "lv60k")
WHISPER_PROMPT = "Acme Search product film: search, filters, semantic, acme.example."
ALIGN_NOTES = ("CTC forced alignment (MMS_FA + wav2vec2 LV60K) of the script on the clean "
               "voice track; Whisper cross-check.")
LANGS = {
    # LV60K is English-only: German aligns on the multilingual MMS_FA alone.
    "de": dict(CTC_MODELS=("mms",), PRIMARY="mms", ALTS=(),
               WHISPER_PROMPT="Acme Search Produktfilm: Suche, Filter, Semantik, acme.example.",
               ALIGN_NOTES="CTC forced alignment (MMS_FA) of the script on the clean voice "
                           "track; Whisper cross-check.",
               PRON={"acme.example/search": "akmee punkt example slash search", "Acme": "akmee"},
               SYLLABLE_RATE=4.6),
}

# How the voice reads tokens that are not plain words.
PRON = {"acme.example/search": "akmee dot example slash search", "Acme": "akmee"}
SYLLABLE_RATE = 4.2

"""Analysis profile of the P(doom) song: everything in the analysis that is specific to this
recording (section map, tempo search range, manual alignment fixes, pronunciations, notes).

A profile is picked by the song config's "analysis" key (see song.json); a new song starts from a
copy of _template.py. The generic pipeline reads these names through common.PROFILE.
"""

# ---------------------------------------------------------------------------- audio / stems
# The Demucs stems were rendered from an mp3 decode that did NOT trim the LAME
# encoder delay (1105 samples @ 48 kHz = 23.0 ms). The gapless decode of the mp3
# (ffmpeg / libsndfile / browsers) is our time reference, so stems are shifted
# earlier by 1015 samples @ 44.1 kHz (measured by cross-correlation, constant
# over the whole song).
STEM_OFFSET_SAMPLES = 1015


# ---------------------------------------------------------------------------- music (analyze.py)
# Tempo search range (BPM) of the constant-tempo grid fit, beats per bar, and the beat index of the
# first downbeat (the grid's bar phase).
BPM_RANGE = (125.0, 138.0)
BEATS_PER_BAR = 4
FIRST_DOWNBEAT_BEAT = 0

# Section map in bars (bar k starts at downbeat k; bar 0 = first downbeat).
# Rule: a section starts on the downbeat of the bar in which its first lyric
# line starts, unless that line starts with a short (< 2 beat) pickup, in which
# case the pickup stays in the previous section.  The choruses all start with
# a ~3-beat pickup "I'm upping my P-" over a bass stop, landing "DOOM" on the
# next downbeat, so the chorus section starts at the pickup bar.
SECTION_BARS = [
    ("intro", None, 1),      # 0 .. bar 1 (1-bar synth intro, pickup "I" at 1.41)
    ("verse1", 1, 9),        # Eb Bb Cm Ab x1 (2 bars each), no drums until bar 7
    ("pre1", 9, 12),         # F F Ab  "ChatGPT, please don't eat me alive"
    ("chorus1", 12, 20),     # pickup/stop bar 12, "DOOM" on bar 13
    ("break1", 20, 21),      # 1-bar turnaround (tail of held "eyes")
    ("verse2", 21, 29),
    ("pre2", 29, 32),        # "Sydney, please let me free" (bass out)
    ("chorus2", 32, 41),     # incl. bar 40 (held "reckoned", pickup "Forward")
    ("verse3", 41, 49),
    ("pre3", 49, 52),        # breakdown: drums + bass out, "Gato, please don't let me go"
    ("chorus3", 52, 60),     # quiet chorus: light drums, no bass
    ("bridge", 60, 68),      # "Just transformers ..." (full band from bar 61)
    ("chorus4", 68, 77),     # final chorus, bar 76 = stop bar ("all for show?")
    ("outro", 77, None),     # full band + "oh" vocals to bar 84 (152.98), then decay
]


# analyze.py --plots: time windows (s) of the drums/envelope QA plots
QA_WINDOWS = [(0, 12), (14, 26), (28, 36), (56, 64), (86, 98), (106, 114), (136, 146), (148, 156.6)]

AUDIO_NOTES = (
    "Timeline = gapless mp3 decode (ffmpeg/libsndfile/browsers); Demucs stems were "
    "shifted -23.0 ms (LAME encoder delay) to match. "
    "Tempo is constant: {bpm:.3f} BPM (period {P:.5f} s), fitted over the whole song on "
    "drum+mix onset envelopes (no drift: per-15 s phase deviation <= 2 ms), phase refined "
    "on kick attack times; first beat {off:.3f} s. The grid is extrapolated through the "
    "drum-less intro/verse1/pre3 and the fade. "
    "Bar phase: the drums play four-on-the-floor kick with snare on beats 2 and 4 "
    "(broadband snare bursts on odd beat indices) and 8th-note off-beat hats, which fixes "
    "the phase up to half a bar; the half-bar ambiguity is resolved by the harmony: the "
    "progression Eb-Bb-Cm-Ab (2 bars per chord, F-F-Ab in the pre-choruses) changes chord "
    "exactly on beat indices = 0 mod 8, and every chorus lands 'DOOM' of 'P(doom)' on a "
    "downbeat (bars 13/33/53/69). First downbeat {first_db:.3f} s; bar k starts "
    "at first_downbeat + k*4*period. "
    "Sections start on downbeats; choruses include their 3-beat pickup bar "
    "('I'm upping my P-' over a bass stop). pre3 (89.3-94.8) is a breakdown with no drums "
    "or bass; chorus3 (94.8-109.3) is a quiet chorus with light drums and no bass; the "
    "full band returns in bar 61 ({b61:.2f} s). chorus4 ends with a stop bar ({b76:.2f}-{b77:.2f} s, "
    "'all for show?'), outro is loud until {b84:.2f} s (drums stop) then decays to silence ~155.5 s. "
    "Envelopes: 100 fps, frame i centred at i/100 s, 46 ms RMS window, one-pole smoothing "
    "(10 ms attack / 90 ms release), each divided by its own 99th percentile and clipped "
    "to 0..1 (linear amplitude). low <150 Hz, mid 150-2000 Hz, high >4 kHz of the full mix; "
    "vocal/drums/bass/other = stem RMS. "
    "Onsets [time, strength 0-1] from the drums stem: kick = attack (steepest rise) of the "
    "<120 Hz band ({kk}); snare = 1.5-5 kHz attacks whose 0.5-5 kHz noise tail 40-120 ms later is in the "
    "loudest local class ({sn}; kick-only in pre1/pre2); hat = >7 kHz attacks not within 40 ms of a snare or 30 ms of a kick ({hh}; mostly 8th off-beats). vocal = note "
    "onsets from the vocal stem (log-mel flux peaks + legato pitch jumps > 0.8 semitone), "
    "including backing vocals / ad-libs."
)


def audio_notes(bpm, P, off, first_db, bar_t, kk, sn, hh):
    """Free-text notes stored in audio.json."""
    return AUDIO_NOTES.format(bpm=bpm, off=off, P=P, first_db=first_db,
                              b61=bar_t(61), b76=bar_t(76), b77=bar_t(77), b84=bar_t(84),
                              sn=sn, kk=kk, hh=hh)


# ---------------------------------------------------------------------------- lyrics (align.py)
# Per-line time windows (seconds) where the automatic path is ambiguous.
LINE_WINDOWS = {}

# ---------------------------------------------------------------------------
# Manual anchors (seconds) for the CTC path, established by inspecting the QA
# plots (spectrogram / pitch / envelopes).  Key: (line, token, subword) ->
# (earliest allowed start, latest allowed end) of that subword's chars.
ANCHORS = {}

# Final manual corrections of word boundaries after refinement, only where the
# plots clearly show the automatic result is wrong.  (line, token) ->
# dict(start=..., end=...)
FIX = {
    # L5 "don't eat me alive": long legato vowels, CTC places eat/alive late /
    # early.  /i:/ of "eat" starts right after the t-release at 20.26; "alive"
    # starts with the pitch drop to the schwa at 21.35 ("-live" at 21.85).
    (5, 3): dict(start=20.27),
    (5, 5): dict(start=21.35),
    # L11 "shinigami eyes": shi-ni-ga-mi then /a/ of "eyes" at 34.73
    (11, 3): dict(start=34.73),
    # L40 final chorus "I'm upping my P(doom)": lead is buried under a
    # sustained backing "ah" pad (122.8-125.8); CTC finds nothing.  Placed from
    # the median-filtered spectrogram + karaoke-lead stem ("doom" /d/ at
    # 125.66 seen by both CTC models on the lead stem), rhythm identical to
    # chorus 3 (95.46 / 95.70 / 96.10 / 96.32).
    (40, 3): dict(start=125.40, syl=[125.66], conf=0.45),
    (40, 0): dict(start=124.52, conf=0.35),
    (40, 1): dict(start=124.78, conf=0.35),
    (40, 2): dict(start=125.20, conf=0.4),
    # Chorus pickups "I'm": strong vocal onset 2.5 beats before the DOOM
    # downbeat in every chorus (the CTC path smears "I'm" over backing vocals).
    (6, 0): dict(start=22.76, conf=0.7),
    (17, 0): dict(start=59.13, conf=0.7),
    (17, 1): dict(start=59.36),
    (28, 0): dict(start=95.47, conf=0.75),
    # "lies," voiced /l/ onset (lv60k / L / R channels agree, onset peak 31.16)
    (10, 4): dict(start=31.14, conf=0.7),
    # "We" / "don't": rest-onset rule fired on reverb tail / breath noise.
    (12, 0): dict(start=38.62),
    (27, 2): dict(start=92.46),
    # "you are" is one long note; vowel change /u/ -> /a/ (spectral centroid
    # 1020 -> 1180 Hz) at 83.93.  CTC models disagree (83.94 mms / 84.58 lv).
    (25, 6): dict(start=83.93, conf=0.5),
    # held notes whose automatic end ran into the next (unlisted) vocal
    (33, 2): dict(end=108.45),
    (45, 4): dict(end=140.55),
}


EXTRA_DESC = [
    # (t0, t1, description) -- identified from QA plots, the karaoke lead stem
    # and Whisper / greedy CTC transcripts of the vocal stem.
    (34.9, 38.3, "backing-vocal tail / 'ah' ad-lib after 'eyes' over the break (chorus 1 end)"),
    (108.5, 110.15, "lead-in before 'Just transformers': Whisper hears a stuttered 'Just, just, just' (low confidence)"),
    (122.4, 125.9, "sustained backing 'ah' pad under 'I'm upping my P(doom)' (final chorus) - lead is buried here"),
    (140.6, 153.5, "outro chant: repeated 'oh' / 'oh-oh' vocal hook (Whisper: 'Oh, oh, oh...') until the drums stop at ~153"),
]


LYRICS_NOTES = (
    "Timeline = gapless mp3 decode (same as data/audio.json); Demucs stems shifted -23 ms "
    "(LAME encoder delay). Method: (1) CTC emissions (20 ms frames) of the Demucs vocal stem "
    "from two acoustic models, torchaudio MMS_FA and wav2vec2-large-lv60k-960h, each on the "
    "mono sum and on the left and right channels (choruses are double-tracked L/R), fused as a "
    "probability mixture; (2) one global constrained Viterbi forced alignment of all 46 lines "
    "over the whole song with a garbage 'star' token between lines to absorb ad-libs; "
    "acronyms/odd words aligned with phonetic spellings (AGI='ay gee i', P(doom)='pee doom', "
    "ChatGPT='chat gee pee tee', NVDA='en vee dee ay', MLP='em el pee', CDR='see dee are', "
    "PTO='pee tee oh', GPU='gee pee you', RLHF='are el aitch eff', One E thirty='one ee thirty', "
    "Neumann's='noymans'); (3) signal refinement per syllable unit on the vocal stem: start moved "
    "to the voice re-entry after a rest, snapped to the nearest spectral-flux onset, or moved back "
    "to the start of s/sh/ch/f/th frication; ends = next word start when legato, else when the "
    "voice drops 15 dB below the word level (held notes keep their full length); (4) "
    "cross-check against mlx-whisper large-v3-turbo word timestamps and the individual "
    "models/channels, plus a mel-roformer karaoke lead-vocal stem for the final chorus; "
    "(5) manual verification of every line on zoomed spectrogram/pitch/onset plots "
    "(analysis/qa/zl_*.png) with ~20 manual corrections (align.py FIX). "
    "conf: 0.35 + agreement of the independent alignments (<=60 ms) + CTC posterior + "
    "Whisper agreement; manual fixes carry their own conf. 'syl' = start/end of each spelled "
    "letter or compound part (AGI, ChatGPT, P(doom), NVDA, MLP, CDR, PTO, GPU, RLHF, "
    "Killswitch, Post-Chinchilla, super-dense, pre-training, self-upgrade). "
    "NVDA pronunciation is ambiguous: 'Nvidia' scores slightly better acoustically than "
    "'en-vee-dee-ay', but the word timing is the same either way (62.54-63.36), so syl uses "
    "the letter split. "
    "Uncertain words: final-chorus 'I'm upping my' (124.5-125.4, buried under a backing pad, "
    "placed by rhythm of the other choruses, +-100 ms); 'are' (83.93, could be 84.58); "
    "'me' (57.14); 'alive' (21.35); 'eat' (20.27); 'Just transformers' region (108.5-110.2 lead-in); "
    "chorus 'I'm' pickups (22.76, 59.13, 95.47) +-50 ms; 'lies,' 31.14. Everything else "
    "is expected within ~30-50 ms at word starts."
)


# ---------------------------------------------------------------------------- pronunciation (pron.py)
# Display token -> pronunciation spelling (plain letters) for the CTC alignment.
PRON = {
    "AGI": "ay gee i",
    "P(doom)": "pee doom", "P(doom),": "pee doom",
    "ChatGPT,": "chat gee pee tee",
    "FOOM": "foom",
    "NVDA": "en vee dee ay",
    "E": "ee",
    "MLP,": "em el pee",
    "CDR": "see dee are",
    "PTO": "pee tee oh",
    "GPU": "gee pee you",
    "RLHF": "are el aitch eff",
    "Killswitch": "kill switch",
    "Neumann's": "noymans",
    "shoggoth's": "shoggoths",
    "Post-Chinchilla,": "post chinchilla",
    "super-dense": "super dense",
    "pre-training": "pre training",
    "self-upgrade": "self upgrade",
    "'cause": "cause",
    "Gato,": "gato",
}

# alternative pronunciations to test (scored by alignment likelihood)
PRON_ALT = {
    "NVDA": ["en vee dee ay", "envidia", "nvidia"],
    "Neumann's": ["noymans", "newmans"],
    "Gato,": ["gato", "gahtoe"],
}


# ---------------------------------------------------------------------------- whisper (whisper_run.py)
LANGUAGE = "en"
WHISPER_PROMPT = ("Song lyrics about AI doom: P(doom), FOOM, shoggoth, shinigami, Chinchilla, "
              "basilisk, Omega Point, RLHF, GPU, CDR, MLP, NVDA, Gato, Sydney, Ilya, Loom.")

"""Voice-over timing -> the project's lyrics.json (word timings, line ids, key
terms and localised UI strings for the app).

The script (projects/<id>/script/<lang>.json) is the source of truth: line ids,
text with *key term* markup, optional bar pins ("bar": first word on that
downbeat of the music analysis) and the on-screen UI strings.  Three ways to
time it:

  draft            estimate word timings from the script (syllables at the
                   profile's SYLLABLE_RATE, punctuation pauses, bar pins), so
                   the edit can be built and reviewed before any voice exists.
  tts <marks>      word timestamps from the TTS engine for the whole voice-over
                   (generic words JSON, Amazon Polly speech marks, ElevenLabs
                   character alignment or Azure word-boundary events).
  clips <dir>      one clip per line (<dir>/<id>.wav, PCM WAV; optional
                   <dir>/<id>.json word marks in any format above): places each
                   clip so its first word lands on its pin, writes the voice
                   track (manifest audio.voice) and the timings.

A human read is recorded to audio.voice and force-aligned instead
(ctc_emissions.py, vocal_feats.py, [whisper_run.py,] align.py).

Run:  python voiceover.py draft --project search --lang de
      python voiceover.py tts marks.json --project search --lang en
      python voiceover.py clips takes/en --project search --lang en
"""
import json
import re
import sys
import wave
from difflib import SequenceMatcher
from pathlib import Path

import common
from pron import fold, pron

PAUSE = {",": 0.16, ";": 0.22, ":": 0.26, "—": 0.22, "–": 0.22, ".": 0.38, "!": 0.38, "?": 0.38, "…": 0.4}
GAP = 0.35   # default silence between lines (s)
LEAD = 1.0   # default first-word time when the first line has no pin (s)


def tokens(text):
    """Script text with *key term* markup -> [(display token, is_key)]."""
    out, inside = [], False
    for raw in text.split():
        chars, key = [], False
        for ch in raw:
            if ch == "*":
                inside = not inside
                continue
            key = key or (inside and ch.isalnum())
            chars.append(ch)
        if chars:
            out.append(("".join(chars), key))
    if inside:
        raise SystemExit(f"unbalanced *key* markup in: {text}")
    return out


def syllables(token):
    """Vowel groups of the spoken form (English: minus a silent final e)."""
    n = 0
    for s in pron(token):
        k = len(re.findall(r"[aeiouy]+", s))
        if common.LANG == "en" and k > 1 and s.endswith("e") and not s.endswith(("le", "ee")):
            k -= 1
        n += max(1, k)
    return max(1, n)


def pause_after(token):
    return PAUSE.get(token.rstrip("\"'’”)»")[-1:], 0.0) if token else 0.0


def norm(t):
    return re.sub(r"[^a-z0-9]", "", fold(t.lower()))


# -- script -------------------------------------------------------------------
def script_tokens():
    script = common.load_script()
    lines = []
    for li, l in enumerate(script["lines"]):
        toks = [dict(li=li, w=w, key=k, syl=syllables(w)) for w, k in tokens(l["text"])]
        if not toks:
            raise SystemExit(f"script line {l['id']} is empty")
        lines.append(toks)
    return script, lines


def speak_time(toks, rate):
    """Estimated speaking time of a line: syllables / rate + inner pauses."""
    return sum(t["syl"] for t in toks) / rate + sum(pause_after(t["w"]) for t in toks[:-1])


def spread(toks, t0, t1, rate, conf):
    """Distribute [t0, t1] over tokens by syllables, keeping punctuation pauses."""
    base = speak_time(toks, rate)
    k = (t1 - t0) / base if base > 0 else 1.0
    t = t0
    for i, w in enumerate(toks):
        w["start"] = t
        w["end"] = t + w["syl"] / rate * k
        w["conf"] = conf
        t = w["end"] + (pause_after(w["w"]) * k if i < len(toks) - 1 else 0.0)


# -- music pins -----------------------------------------------------------------
def bar_times():
    """bar index -> downbeat time from the music analysis (extrapolated past the end)."""
    if not common.AUDIO_OUT.exists():
        return None
    a = json.loads(common.AUDIO_OUT.read_text())
    db, bar = a["downbeats"], 4 * a["beat_period"]
    return lambda k: db[k] if 0 <= k < len(db) else db[0] + k * bar


def place(script, durs):
    """First-word time of every line: after the previous line + gap, and not
    before its pin ("bar" downbeat or "at" seconds)."""
    voice = script.get("voice", {})
    gap, lead = voice.get("gap", GAP), voice.get("lead", LEAD)
    bars = bar_times()
    starts, t = [], lead
    for l, d in zip(script["lines"], durs):
        pin = None
        if "bar" in l:
            if bars is None:
                raise SystemExit(f"line {l['id']} is pinned to bar {l['bar']} but there is no "
                                 f"music analysis ({common.AUDIO_OUT}); run analyze.py first")
            pin = bars(l["bar"])
        elif "at" in l:
            pin = float(l["at"])
        if pin is not None:
            if pin < t - 1e-3:
                print(f"warning: line {l['id']} overruns its pin by {t - pin:.2f} s "
                      f"(starts {t:.2f} instead of {pin:.2f}); shorten the line or move the pin")
            t = max(t, pin)
        starts.append(t)
        t = t + d + gap
    return starts


# -- TTS word marks ----------------------------------------------------------------
def _ticks(v):
    """Azure durations: 100 ns ticks, or 'H:MM:SS.fffffff'."""
    if isinstance(v, str):
        h, m, s = v.split(":")
        return int(h) * 3600 + int(m) * 60 + float(s)
    return v / 1e7


def read_marks(path):
    """Word marks of a TTS engine -> [(word, start, end or None)] in seconds."""
    txt = Path(path).read_text(encoding="utf-8").strip()
    try:
        j = json.loads(txt)
    except json.JSONDecodeError:
        j = [json.loads(x) for x in txt.splitlines() if x.strip()]   # JSON lines
    if isinstance(j, dict) and j.get("type") == "word":               # single Polly mark
        j = [j]
    if isinstance(j, dict):
        al = j.get("alignment") or j.get("normalized_alignment")
        if al and "characters" in al:                                 # ElevenLabs
            out, cur = [], None
            for ch, s, e in zip(al["characters"], al["character_start_times_seconds"],
                                al["character_end_times_seconds"]):
                if ch.isspace():
                    cur = None
                    continue
                if cur is None:
                    cur = [ch, s, e]
                    out.append(cur)
                else:
                    cur[0] += ch
                    cur[2] = e
            return [tuple(x) for x in out]
        j = j.get("words") or j.get("marks") or []
    if not isinstance(j, list) or not j:
        raise SystemExit(f"{path}: no word marks found")
    k = {x.lower().replace("_", ""): x for x in j[0]}
    if "type" in k and "time" in k:                                   # Amazon Polly
        return [(m["value"], m["time"] / 1000, None) for m in j if m.get("type") == "word"]
    if "audiooffset" in k:                                            # Azure word boundaries
        ks = {x.lower().replace("_", ""): x for m in j for x in m}
        out = []
        for m in j:
            bt = str(m.get(ks.get("boundarytype", ""), "Word"))
            if "word" not in bt.lower():
                continue
            s = m[ks["audiooffset"]] / 1e7
            d = m.get(ks.get("duration", ""))
            out.append((m[ks["text"]], s, None if d is None else s + _ticks(d)))
        return out
    wk = next((k[x] for x in ("word", "w", "text", "value") if x in k), None)
    sk = next((k[x] for x in ("start", "starttime", "begin") if x in k), None)
    ek = next((k[x] for x in ("end", "endtime") if x in k), None)
    if wk is None or sk is None:
        raise SystemExit(f"{path}: unknown word-mark format (keys {sorted(j[0])})")
    return [(m[wk], float(m[sk]), None if ek is None else float(m[ek])) for m in j]


def assign(toks, marks, rate):
    """Sequence-align TTS words to script tokens and copy their times.  Tokens
    the engine spoke differently (numbers, URLs) share the span of the words it
    used; tokens it skipped are interpolated."""
    marks = [list(m) for m in marks]
    for i, m in enumerate(marks):                                      # fill missing ends
        if m[2] is None:
            est = syllables(m[0]) / rate + 0.05
            nxt = marks[i + 1][1] if i + 1 < len(marks) else m[1] + est
            m[2] = min(nxt, m[1] + 1.6 * est)
    a, b = [norm(t["w"]) for t in toks], [norm(m[0]) for m in marks]
    for t in toks:
        t.pop("start", None)
    for tag, i1, i2, j1, j2 in SequenceMatcher(a=a, b=b, autojunk=False).get_opcodes():
        if tag == "equal":
            for d in range(i2 - i1):
                toks[i1 + d].update(start=marks[j1 + d][1], end=marks[j1 + d][2], conf=0.95)
        elif tag == "replace":
            spread(toks[i1:i2], marks[j1][1], marks[j2 - 1][2], rate, 0.6)
    i = 0
    while i < len(toks):                                               # interpolate gaps
        if "start" in toks[i]:
            i += 1
            continue
        j = i
        while j < len(toks) and "start" not in toks[j]:
            j += 1
        t0 = toks[i - 1]["end"] if i else (toks[j]["start"] - 0.3 if j < len(toks) else 0.0)
        t1 = toks[j]["start"] if j < len(toks) else t0 + speak_time(toks[i:j], rate)
        spread(toks[i:j], t0, max(t1, t0 + 0.05 * (j - i)), rate, 0.3)
        i = j
    for k in range(1, len(toks)):                                       # monotonic
        toks[k]["start"] = max(toks[k]["start"], toks[k - 1]["start"] + 0.01)
        toks[k - 1]["end"] = min(toks[k - 1]["end"], toks[k]["start"])
        toks[k - 1]["end"] = max(toks[k - 1]["end"], toks[k - 1]["start"] + 0.01)


# -- audio clips (stdlib wave + numpy) -------------------------------------------------
def read_wav(path):
    import numpy as np
    with wave.open(str(path), "rb") as w:
        ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if sw == 2:
        y = np.frombuffer(raw, "<i2").astype(np.float32) / 32768
    elif sw == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3)
        y = ((b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
             << 8 >> 8).astype(np.float32) / 8388608
    elif sw == 4:
        y = np.frombuffer(raw, "<i4").astype(np.float32) / 2147483648
    else:
        raise SystemExit(f"{path}: unsupported {8 * sw}-bit WAV (use 16/24/32-bit PCM)")
    return y.reshape(-1, ch), sr


def speech_span(y, sr, floor_db=-40.0):
    """First / last sample within floor_db of the clip's peak (10 ms frames)."""
    import numpy as np
    m = np.abs(y).max(axis=1)
    hop = max(1, sr // 100)
    fr = np.array([m[i:i + hop].max() for i in range(0, len(m), hop)])
    on = np.where(fr > fr.max() * 10 ** (floor_db / 20))[0]
    if len(on) == 0:
        return 0.0, len(m) / sr
    return on[0] * hop / sr, min(len(m), (on[-1] + 1) * hop) / sr


def write_wav(path, y, sr):
    import numpy as np
    q = (np.clip(y, -1, 1) * 32767).round().astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(y.shape[1])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(q.tobytes())


# -- output -----------------------------------------------------------------------
def write(script, lines, source, notes):
    out = []
    for li, (l, toks) in enumerate(zip(script["lines"], lines)):
        words = []
        for t in toks:
            w = dict(w=t["w"], start=round(t["start"], 3), end=round(t["end"], 3), conf=t["conf"])
            if t["key"]:
                w["key"] = True
            words.append(w)
        out.append(dict(id=l["id"], i=li, text=" ".join(t["w"] for t in toks),
                        start=words[0]["start"], end=words[-1]["end"], words=words))
    doc = dict(lang=script.get("lang", common.LANG), source=source, lines=out,
               ui=script.get("ui", {}), notes=notes)
    common.LYRICS_OUT.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    end = out[-1]["end"]
    print(f"wrote {common.LYRICS_OUT.relative_to(common.REPO)} ({source}): {len(out)} lines, "
          f"{sum(len(l['words']) for l in out)} words, last word ends {end:.2f} s")


def draft():
    script, lines = script_tokens()
    rate = common.PROFILE.SYLLABLE_RATE
    durs = [speak_time(t, rate) for t in lines]
    for toks, s, d in zip(lines, place(script, durs), durs):
        spread(toks, s, s + d, rate, 0.2)
    write(script, lines, "draft",
          f"DRAFT timings estimated from the script ({rate} syllables/s, punctuation pauses, "
          f"bar pins on the music analysis); replace with TTS word marks or a forced "
          f"alignment of the recorded voice before locking the cut.")


def tts(path):
    script, lines = script_tokens()
    rate = common.PROFILE.SYLLABLE_RATE
    flat = [t for toks in lines for t in toks]
    assign(flat, read_marks(path), rate)
    write(script, lines, "tts", f"Word timings from the TTS engine's word marks ({Path(path).name}), "
                                f"mapped onto the script tokens (conf 0.95 exact, 0.6 respelled, "
                                f"0.3 interpolated).")


def clips(folder):
    import numpy as np
    folder = Path(folder)
    script, lines = script_tokens()
    rate = common.PROFILE.SYLLABLE_RATE
    takes, sr0, ch0 = [], None, None
    for l in script["lines"]:
        f = folder / f"{l['id']}.wav"
        if not f.exists():
            raise SystemExit(f"missing clip {f}")
        y, sr = read_wav(f)
        if sr0 is not None and (sr, y.shape[1]) != (sr0, ch0):
            raise SystemExit(f"{f}: {sr} Hz / {y.shape[1]} ch differs from the first clip "
                             f"({sr0} Hz / {ch0} ch); resample the clips to match")
        sr0, ch0 = sr, y.shape[1]
        on, off = speech_span(y, sr)
        mk = folder / f"{l['id']}.json"
        takes.append(dict(y=y, on=on, off=off, marks=read_marks(mk) if mk.exists() else None))
    starts = place(script, [t["off"] - t["on"] for t in takes])
    clip_at = [s - t["on"] for s, t in zip(starts, takes)]
    if min(clip_at) < 0:
        raise SystemExit("the first clip's lead-in silence starts before 0 s; trim it or move the pin")
    music = json.loads(common.AUDIO_OUT.read_text())["duration"] if common.AUDIO_OUT.exists() else 0.0
    total = max(music, max(a + len(t["y"]) / sr0 for a, t in zip(clip_at, takes)) + 0.5)
    out = np.zeros((int(round(total * sr0)), ch0), np.float32)
    for a, t, toks in zip(clip_at, takes, lines):
        i = int(round(a * sr0))
        out[i:i + len(t["y"])] += t["y"]
        if t["marks"]:
            assign(toks, [(w, s + a, None if e is None else e + a) for w, s, e in t["marks"]], rate)
        else:
            spread(toks, a + t["on"], a + t["off"], rate, 0.3)
    if common.VOICE is None:
        raise SystemExit(f"project '{common.PROJECT_ID}' has no audio.voice path in its manifest")
    write_wav(common.VOICE, out, sr0)
    print(f"wrote {common.VOICE.relative_to(common.REPO)} ({total:.2f} s)")
    write(script, lines, "clips", f"Per-line clips from {folder.name}/ placed on the script's bar pins; "
                                  f"word times from each clip's word marks (conf 0.95/0.6/0.3) or "
                                  f"spread over its speech span by syllables (conf 0.3).")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] not in ("draft", "tts", "clips") or (args[0] != "draft" and len(args) < 2):
        raise SystemExit(__doc__)
    {"draft": lambda: draft(), "tts": lambda: tts(args[1]), "clips": lambda: clips(args[1])}[args[0]]()

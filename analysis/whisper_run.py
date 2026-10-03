"""Run mlx-whisper (word timestamps) on the time-corrected vocal stem (or the
project's clean voice track).

Writes work/whisper_<tag>.json. Used as an independent cross-check for the
CTC forced alignment in align.py (optional: align.py runs without it).

Run:  uv run python whisper_run.py [--project <id> --lang <code>] [turbo|large]
"""
import common  # noqa: F401  (sets cache dirs)
import json, sys
import mlx_whisper

MODELS = {
    "turbo": "mlx-community/whisper-large-v3-turbo",
    "large": "mlx-community/whisper-large-v3-mlx",
}

def vocals16k():
    """16 kHz mono vocal source for Whisper (written once into work/)."""
    f = common.WORK / "vocals16k.wav"
    if not f.exists():
        import soundfile as sf
        y, sr = common.load_vocal_source("vocals", sr=16000)
        sf.write(f, y, sr, subtype="PCM_16")
    return f


def run(tag, model, prompt=None):
    res = mlx_whisper.transcribe(
        str(vocals16k()), path_or_hf_repo=model, language=common.LANG,
        word_timestamps=True, condition_on_previous_text=False, initial_prompt=prompt,
        temperature=0.0, no_speech_threshold=None, hallucination_silence_threshold=None,
    )
    out = common.WORK / f"whisper_{tag}.json"
    out.write_text(json.dumps(res, indent=1, default=float))
    for seg in res["segments"]:
        print(f"{seg['start']:7.2f} {seg['end']:7.2f} {seg['text']}")
    return res

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "turbo"
    lyr = " ".join(t for _, _, t in common.load_lyrics_src())
    prompt = common.PROFILE.WHISPER_PROMPT
    run(which, MODELS[which])
    run(which + "_prompt", MODELS[which], prompt)

# Making a video for another song

The method doesn't depend on this song. It comes down to three things:

1. **Turn the audio into data with timestamps**: a beat grid, sections, onsets, loudness envelopes and word timings (`data/audio.json`, `data/lyrics.json`).
2. **Build the edit from those timestamps, never from fixed times.** A scene cut is named by a lyric phrase and snaps to the nearest beat (`cut()` in `app/src/engine/edit.ts`).
3. **Make every frame depend only on time `t`.** The same code then drives the live preview and the offline export with motion blur (the rules in [`ENGINE.md`](ENGINE.md)).

The engine and the pipelines are reusable. The scenes, the P(doom) logic, the hand corrections and the treatment belong to this song.

## What carries over, and what is tied to this song

| Reusable as is | Specific to this song: replace it |
|---|---|
| `app/src/engine/*`: rendering, post-processing, typography, `LineBatch`, `Layer2D`, adaptive motion blur, 4K scaling | `app/src/scenes/*` (the 17 plates, `_motifs.ts`, `_pdoom.ts`) |
| `app/src/engine/edit.ts`: `cut(phrase)` on the beat, `after`, `section`, `entry` | The entries in `app/src/timeline.ts` |
| `app/src/engine/readout.ts`: the optional corner readout (`WordCounter`: a value that steps up each time a word is sung) | The plug-ins in `app/src/project.ts` (here: P(doom)) |
| `app/src/engine/lyrics.ts`, `audio.ts`: data formats and queries | `song.json` (repo root): title, output name, audio and lyrics paths |
| `app/src/templates/karaoke.ts`: a minimal stateless karaoke scene to start from | `app/plates.json` and `app/public/plates/` (the outro's rewind montage) |
| `app/scripts/render.ts`: stills, contact sheets, plates, ffmpeg export | |
| `analysis/*.py`: stems, CTC alignment, Whisper cross-check, beat/section/onset analysis | `analysis/song.py`: section map, tempo range, stem offset, hand fixes, pronunciations, notes |
| [`ENGINE.md`](ENGINE.md): scene rules | [`TREATMENT.md`](TREATMENT.md): palette, fonts, motifs, karaoke rules |

The song-specific settings each live in one place:

- `song.json` names the files. The player, the renderer (audio track, default `out/<name>.mp4`) and the analysis (`analysis/common.py`) all read it.
- `analysis/song.py` holds everything the analysis knows about the song.
- `app/src/project.ts` hands the engine the edit (`timeline.ts`) and the optional plug-ins. The engine itself has no song in it: without a `readout` plug-in the corner readout is simply never drawn.

## Plan A: another song

### 1. Start a copy of the repo

Fork or copy the repo, then clear out this song:

- Point `song.json` at the new files (`title`, `name`, `audio`, `lyrics`; paths relative to the repo root).
- In `app/src/project.ts`, drop the P(doom) readout (or configure a `WordCounter` for a word your song counts).
- Replace `app/src/timeline.ts`'s entries (step 5) and, once nothing references them, delete the old scenes, `app/plates.json` and `app/public/plates/`.
- Delete this song's timing data: `data/lyrics.json`, `data/audio.json` and the two `data/*.approx.json` files. The app, `analysis/common.py`'s beat grid and the QA plots would otherwise keep using them against the new audio.
- Reset `analysis/song.py` (step 3).

The export hook the renderer drives is `window.__export`; renders that must not live-reload use `NO_HMR=1`.

### 2. Put in the new inputs

- The mixed track (`song.json` `audio`; mp3 or wav).
- Line-level lyrics with rough times, in the format of `lyrics/lyrics.src.js` (`song.json` `lyrics`).

**Rights:** you need the rights to the song and its lyrics before you publish anything.

### 3. Regenerate the timing data

All commands run in `analysis/` with [uv](https://docs.astral.sh/uv/). First reset `analysis/song.py`: empty `FIX`, `ANCHORS`, `LINE_WINDOWS` and `EXTRA_DESC`, set `SECTION_BARS = [("song", None, None)]` until you have the real map, and replace `PRON` (pronunciations for words the CTC alphabet can't spell: numbers, names, symbols) and `WHISPER_PROMPT`.

1. **Stems.** Demucs `htdemucs_ft` into `analysis/stems/htdemucs_ft/<audio file stem>/`, e.g. `uv run python -m demucs -n htdemucs_ft -o stems ../audio/<song>.mp3`. Then the lead vocal from a mel-band-roformer karaoke model (audio-separator) as `analysis/stems/karaoke/lead.wav`.
2. **Stem offset.** An mp3's encoder delay can shift the stems against the gapless decode that the player and the export use. Run `uv run python stem_offset.py`: it cross-correlates the sum of the raw stems with the mix in several windows and prints the value for `STEM_OFFSET_SAMPLES` in `song.py`. The windows should agree; if they don't, the offset drifts and needs a closer look. A wav input usually measures 0.
3. **Beat grid and sections.** Set `BPM_RANGE`, `BEATS_PER_BAR` and `FIRST_DOWNBEAT`, then run `uv run python analyze.py --plots`. It writes `data/audio.json` and QA plots into `analysis/qa/`, and prints the fitted tempo (check it against the song) and where the kicks and snares fall in the bar (check the downbeat). Then write the section map in bars (`SECTION_BARS`: bar k starts on downbeat k, `None` = the start or end of the song) and run it again.
4. **Features and alignment.** `uv run python ctc_emissions.py`, `uv run python whisper_run.py`, `uv run python vocal_feats.py`, then `uv run python align.py --plots` (writes `data/lyrics.json` and QA plots, drawn over the beat grid from step 3).
5. **Hand fixes.** Look at the QA plots. Add entries to `FIX`/`ANCHORS` only where the automatic result is clearly wrong: held vowels, vocals buried under the mix, pickups. Rerun `align.py` after each change.
6. **Notes.** Rewrite `AUDIO_NOTES` and `LYRICS_NOTES` in `song.py` (this song's texts still format, but describe the wrong song). They are copied into the JSON files.

**Cost:** the model and stem steps download about 4 GB of weights into `analysis/.cache/`. Run them locally, or as a small job on one short excerpt first, before you run the whole song. Delete the cache afterwards.

**Limits:** the alignment assumes English lyrics (a-z CTC alphabet, Whisper `language="en"`). `whisper_run.py` uses mlx-whisper, which needs Apple silicon. The tempo fit assumes a constant tempo.

The app needs `data/lyrics.json` and `data/audio.json` (it falls back to `data/*.approx.json`, rough hand-made files in the same formats, if they are missing), so run this step before scene work.

### 4. Write a new treatment

Write a new `docs/TREATMENT.md`: the concept, a restrained palette (`app/src/engine/palette.ts`), two to four type voices (fonts in `app/public/fonts/`, `F` in `app/src/engine/type.ts`), the karaoke rules, a few recurring motifs, and one plate per section.

### 5. Write the timeline

In `app/src/timeline.ts`, anchor each scene to a lyric phrase, snapped to the beat:

- `cut('first words of the line', nth)` gives the last beat at or before the first word of the nth matching line.
- `after(q)` gives the downbeat nearest the end of a line, and `section('outro')` the start of an analysed section.
- `entry(id, module, start, end, { params })` makes the entry.

Reuse one module with different `params` for repeated sections, such as the choruses (this video's `hook` module serves all four hooks with `n: 1..4`). The project's `readout` plug-in, if any, goes in `app/src/project.ts`.

### 6. Build the scenes one at a time

- Start from `app/src/templates/karaoke.ts`: a background pass, a `Layer2D` lyric line, and words lit by `Lyrics.wordProgress`. It works as is: `entry('verse1', 'templates/karaoke', b.verse1, b.chorus1)` roughs out the whole edit before any plate exists. Copy it into `app/src/scenes/<name>.ts` to grow it into a plate.
- Iterate with `bun scripts/render.ts stills --t … --only <id>` and `sheet --from … --to … --only <id>` (see [`ENGINE.md`](ENGINE.md)).
- Keep scenes stateless (a pure function of `t`), so adaptive sampling works.

### 7. Export in stages

1. Drafts: `bun scripts/render.ts video --samples 4 --from 40 --to 55 --preset veryfast --out ../out/draft.mp4`, on short ranges.
2. Full 1080p: `bun scripts/render.ts video --samples auto --shutter 0.2` (writes `out/<name>.mp4`).
3. 4K (`--scale 2`), only once the cut is locked: it is the costly step (see the README).

If the outro or another plate shows stills of earlier plates, run `bun scripts/render.ts plates` once the scenes are final. It renders the entries listed in `app/plates.json` (id → time, in order), or every entry at its midpoint if that file doesn't exist.

## Practical notes

- **Rights:** you need licences for the music and lyrics, for the voice (talent, or the TTS/music generator's terms), for the fonts, and for any UI imagery or trademarks that appear on screen.
- **Effort:** expect most of the work to go into the scenes, which are hand-written GLSL and Canvas2D. Rather than writing custom plates every time, build a small library of parametric scene templates in `app/src/templates/` (text slam, typed prompt, chart, card stack, end card) and reuse it across projects. `karaoke.ts` is the first one.
- **Determinism:** keep the rules in [`ENGINE.md`](ENGINE.md): seeded randomness only, no wall-clock time, `render()` fully overwrites its target. Otherwise the preview and the export drift apart.

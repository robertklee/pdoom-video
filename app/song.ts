// The active song (Node/Bun side: vite.config.ts and scripts/render.ts).
//
// A song is described by a JSON config (see song.json at the repo root, the P(doom) video). Pick one
// with the SONG environment variable: a path to the config file or to a folder holding song.json,
// absolute or relative to the repo root. Default: <repo>/song.json. Paths inside the config are
// relative to the config's own folder, so a song can live in a self-contained folder (songs/<id>/).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export interface SongConfig {
  /** Short id: names the analysis work folders and is checked by the renderer. */
  id: string;
  title: string;
  /** The mix the video is cut to (the timeline's time reference). */
  audio: string;
  /** Line-level lyrics with rough times (input to the analysis tools). */
  lyricsSource?: string;
  /** Word-timed lyrics; `<name>.approx.json` next to it is the fallback. */
  lyrics: string;
  /** Music analysis (beats, sections, onsets, envelopes); same `.approx.json` fallback. */
  audioData: string;
  /** Timeline module: app/src/timelines/<timeline>.ts (default 'starter'). */
  timeline?: string;
  /** Analysis profile: analysis/songs/<analysis>.py (default: <id>, else _template). */
  analysis?: string;
}

export interface Song {
  config: SongConfig;
  /** Absolute path of the config file and of its folder (the root of the song's relative paths). */
  file: string;
  dir: string;
  /** Absolute path of a file named in the config. */
  abs: (rel: string) => string;
}

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');

export function loadSong(spec = process.env.SONG): Song {
  let file = path.resolve(REPO_ROOT, spec || 'song.json');
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'song.json');
  if (!existsSync(file)) throw new Error(`song config not found: ${file} (SONG=${spec ?? ''})`);
  const config = JSON.parse(readFileSync(file, 'utf8')) as SongConfig;
  for (const k of ['id', 'title', 'audio', 'lyrics', 'audioData'] as const) {
    if (typeof config[k] !== 'string' || !config[k]) throw new Error(`${file}: missing "${k}"`);
  }
  if (!/^[\w-]+$/.test(config.id)) throw new Error(`${file}: "id" must be letters, digits, - or _`);
  const dir = path.dirname(file);
  const abs = (rel: string) => {
    const p = path.resolve(dir, rel);
    if (path.relative(dir, p).startsWith('..')) throw new Error(`${file}: "${rel}" must be inside the song folder`);
    return p;
  };
  for (const k of ['audio', 'lyrics', 'audioData', 'lyricsSource'] as const) if (config[k]) abs(config[k]!);
  return { config, file, dir, abs };
}

/** `data/lyrics.json` -> `data/lyrics.approx.json`: the quick timing data written by analysis/bootstrap.py. */
export const approxOf = (rel: string) => rel.replace(/\.json$/, '.approx.json');

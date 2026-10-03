// The one song setting shared by the player, the renderer and the analysis pipeline: song.json at
// the repo root names the audio and lyrics files (paths relative to the repo root).
import config from '../../song.json';

export interface SongConfig {
  /** Display title (page title). */
  title: string;
  /** Short name for output files (out/<name>.mp4). */
  name: string;
  /** The mixed track, e.g. audio/pdoom.mp3; the player and the export use it, the analysis decodes it. */
  audio: string;
  /** Line-level lyrics with rough times (analysis input, see analysis/common.py). */
  lyrics: string;
}

export const SONG: SongConfig = config;

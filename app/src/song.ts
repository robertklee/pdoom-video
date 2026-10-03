// The active song, injected by vite.config.ts from the song config (SONG=..., see app/song.ts).
export interface SongInfo {
  id: string;
  title: string;
  /** Timeline module name (src/timelines/<timeline>.ts). */
  timeline: string;
  /** URLs relative to the page. */
  audio: string;
  /** Candidate URLs, first one that exists wins (aligned data, then the .approx.json fallback). */
  lyrics: string[];
  audioData: string[];
}

declare const __SONG__: SongInfo;
export const SONG: SongInfo = __SONG__;

// Edit helpers: build a timeline from the aligned data, never from fixed times. A cut is named by a
// lyric phrase and lands on the beat grid, so the edit follows the data when the alignment is redone
// (data/lyrics.json, data/audio.json). Song-agnostic; a project's timeline.ts uses these.
import type { TimelineEntry } from './engine';
import type { SceneClass } from './scene';
import type { Lyrics } from './lyrics';
import type { AudioData } from './audio';

/** Lazy scene modules, as returned by import.meta.glob (which has to be called from the project's own file). */
export type SceneModules = Record<string, () => Promise<{ default: SceneClass }>>;

/**
 * Resolve a scene module by name: 'hook' -> ./scenes/hook.ts, 'templates/karaoke' -> ./templates/karaoke.ts
 * (paths relative to the file that called import.meta.glob). A missing module only fails that entry.
 */
export function sceneLoader(modules: SceneModules) {
  return (name: string) => () => {
    const key = name.includes('/') ? `./${name}.ts` : `./scenes/${name}.ts`;
    const m = modules[key];
    return m ? m() : Promise.reject(new Error(`scene module not found: ${key.slice(2)}`));
  };
}

export function editTools(ly: Lyrics, au: AudioData, modules: SceneModules) {
  const scene = sceneLoader(modules);
  return {
    /**
     * Cut on the last beat at/before the first word of the nth line matching q (never after the word).
     * `tol` lets a word that starts a hair before its beat still cut on that beat.
     */
    cut(q: string, nth = 0, tol = 0.02) {
      const s = ly.get(q, nth).words[0]!.start;
      return au.timeOfBeat(Math.floor(au.beatAt(s + tol)));
    },
    /** Nearest downbeat to the end of the nth line matching q. */
    after(q: string, nth = 0) {
      const e = ly.get(q, nth).end;
      return au.downbeats.reduce((b, d) => (Math.abs(d - e) < Math.abs(b - e) ? d : b), au.downbeats[0] ?? e);
    },
    /** Start of the first analysed section with this name (data/audio.json), if any. */
    section(name: string, nth = 0): number | undefined {
      return au.sections.filter((x) => x.name === name)[nth]?.start;
    },
    /**
     * A timeline entry: `file` is the scene module (several entries can share one, with different
     * params — e.g. one module for every chorus).
     */
    entry(id: string, file: string, start: number, end: number, extra: Partial<TimelineEntry> = {}): TimelineEntry {
      return { id, load: scene(file), start, end, file, ...extra };
    },
  };
}

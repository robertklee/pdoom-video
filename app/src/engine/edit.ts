// Edit helpers: scene boundaries are anchored to phrases of the timing data and snapped to the music's
// beat grid, never written as fixed times, so the edit follows re-alignment, a revised script or another
// language. A phrase is a script line id ('query.1'), else text that the line contains.
import type { AudioData } from './audio';
import type { Lyrics } from './lyrics';

export interface Edit {
  /** Cut on the last beat at/before the first word of the matching line (never after the word). */
  cut(phrase: string, nth?: number, tol?: number): number;
  /** Nearest downbeat to the end of a line. */
  after(phrase: string, nth?: number): number;
  /** Start of the first word of a line, and end of its last word (no snapping). */
  start(phrase: string, nth?: number): number;
  end(phrase: string, nth?: number): number;
  /** Start of a word (or consecutive words) inside a line: `word('proof.1', 'three times')`. */
  word(phrase: string, words: string, nth?: number): number;
  /**
   * Start of the k-th key term of a line (words marked *like this* in the script). Unlike `word`, it
   * holds in every language: each translation marks its own key terms in the same order.
   */
  key(phrase: string, k?: number, nth?: number): number;
  /** Snap a time to the nearest beat / downbeat. */
  beat(t: number): number;
  downbeat(t: number): number;
}

export function edit(ly: Lyrics, au: AudioData): Edit {
  const downbeat = (t: number) => au.downbeats.reduce((b, d) => (Math.abs(d - t) < Math.abs(b - t) ? d : b), au.downbeats[0] ?? t);
  return {
    cut(q, nth = 0, tol = 0.02) {
      const s = ly.get(q, nth).words[0]!.start;
      return au.timeOfBeat(Math.floor(au.beatAt(s + tol)));
    },
    after: (q, nth = 0) => downbeat(ly.get(q, nth).end),
    start: (q, nth = 0) => ly.get(q, nth).words[0]?.start ?? ly.get(q, nth).start,
    end: (q, nth = 0) => ly.get(q, nth).end,
    word(q, words, nth = 0) {
      const l = ly.get(q, nth);
      const hit = ly.findPhrase(words).find((ws) => ws[0]!.line === l.i);
      if (!hit) throw new Error(`"${words}" not found in line ${l.id ?? l.i}: ${l.text}`);
      return hit[0]!.start;
    },
    key(q, k = 0, nth = 0) {
      const l = ly.get(q, nth);
      const run = ly.keyTerms(l)[k];
      if (!run) throw new Error(`line ${l.id ?? l.i} has no key term #${k}: ${l.text}`);
      return run[0]!.start;
    },
    beat: (t) => au.nearestBeat(t),
    downbeat,
  };
}

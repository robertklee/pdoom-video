// Word-timed lyrics or voice-over script (data/lyrics.json, projects/<id>/data/<lang>/lyrics.json)
// with queries for karaoke and caption rendering. A script's lines carry ids ('proof.1') so the edit
// can anchor to them in every language, its words a `key` flag (the highlighted terms), and the file
// the localised on-screen UI strings (`ui`).
import { smart } from './type';

export interface Word {
  w: string; // display token (punctuation attached, typographic quotes: don’t, ’cause)
  start: number;
  end: number;
  conf?: number;
  syl?: [number, number][];
  /** A key term of the script (marked *like this* in the source): highlighted in captions, cues counters. */
  key?: boolean;
  /** filled in by Lyrics: */
  line: number;
  index: number; // index within line
  gi: number; // global word index
}
export interface Line {
  i: number;
  /** Script line id (voice-over projects): stable across languages and script revisions. */
  id?: string;
  text: string;
  start: number;
  end: number;
  words: Word[];
}

export interface LyricsJSON {
  lines: (Omit<Line, 'words' | 'i'> & { words: Omit<Word, 'line' | 'index' | 'gi'>[] })[] | any[];
  /** Language of the text (BCP 47). */
  lang?: string;
  /** Localised on-screen strings (UI labels, card titles), by key. */
  ui?: Record<string, string>;
}

export class Lyrics {
  lines: Line[];
  words: Word[];
  lang: string;
  private uiStrings: Record<string, string>;
  private ids = new Map<string, Line>();
  constructor(j: LyricsJSON) {
    // display text gets curly apostrophes and quotes (the data keeps the typed ones); mono UI
    // text that wants them straight uses plain()
    this.lines = (j.lines as any[]).map((l, li) => ({
      ...l,
      i: li,
      text: smart(l.text),
      words: (l.words as any[]).map((w, wi) => ({ ...w, w: smart(w.w), line: li, index: wi, gi: 0 })),
    }));
    this.words = this.lines.flatMap((l) => l.words);
    this.words.forEach((w, i) => (w.gi = i));
    for (const l of this.lines) if (l.id) {
      if (this.ids.has(l.id)) throw new Error(`duplicate script line id: ${l.id}`);
      this.ids.set(l.id, l);
    }
    this.lang = j.lang ?? 'en';
    this.uiStrings = j.ui ?? {};
  }

  /** The first of `urls` that serves JSON (the project manifest's data.lyrics). */
  static async load(urls: string[] = ['data/lyrics.json', 'data/lyrics.approx.json']): Promise<Lyrics> {
    for (const url of urls) {
      const r = await fetch(url);
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return new Lyrics(await r.json());
    }
    throw new Error(`no lyrics data found (${urls.join(', ')})`);
  }

  /** The script line with this id, or null. */
  byId(id: string): Line | null {
    return this.ids.get(id) ?? null;
  }
  /** Localised UI string; throws if missing unless a fallback is given (fail loudly while authoring). */
  ui(key: string, fallback?: string): string {
    const s = this.uiStrings[key] ?? fallback;
    if (s === undefined) throw new Error(`ui string not found: ${key} (${this.lang})`);
    return smart(s);
  }
  /** The key terms of a line (consecutive key words joined: 'renewal contracts'). */
  keyTerms(l: Line): Word[][] {
    const out: Word[][] = [];
    let cur: Word[] = [];
    for (const w of l.words) {
      if (w.key) cur.push(w);
      else if (cur.length) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
    return out;
  }

  /** The line being sung at t (or null in gaps). */
  lineAt(t: number): Line | null {
    return this.lines.find((l) => t >= l.start && t < l.end) ?? null;
  }
  /** Most recent line that started at or before t. */
  lastLine(t: number): Line | null {
    let best: Line | null = null;
    for (const l of this.lines) if (l.start <= t) best = l;
    return best;
  }
  nextLine(t: number): Line | null {
    return this.lines.find((l) => l.start > t) ?? null;
  }
  linesIn(t0: number, t1: number): Line[] {
    return this.lines.filter((l) => l.end > t0 && l.start < t1);
  }
  /** Lines whose text includes `s` (case-insensitive, straight or curly quotes). Handy for finding a lyric by content. */
  find(s: string): Line[] {
    const q = fold(s);
    return this.lines.filter((l) => fold(l.text).includes(q));
  }
  /** The line with id `s`, else the nth line containing `s`; throws if missing (fail loudly while authoring). */
  get(s: string, nth = 0): Line {
    const l = (nth === 0 ? this.byId(s) : null) ?? this.find(s)[nth];
    if (!l) throw new Error(`lyric not found: ${s}`);
    return l;
  }
  wordAt(t: number): Word | null {
    return this.words.find((w) => t >= w.start && t < w.end) ?? null;
  }
  lastWord(t: number): Word | null {
    let best: Word | null = null;
    for (const w of this.words) if (w.start <= t) best = w;
    return best;
  }
  /** Words whose normalized text matches (e.g. 'p(doom)'). */
  findWords(s: string): Word[] {
    const q = norm(s);
    return this.words.filter((w) => norm(w.w) === q);
  }
  /** Every occurrence of a phrase as consecutive words ('half a second'), matched like findWords. */
  findPhrase(s: string): Word[][] {
    const q = s.split(/\s+/).map(norm).filter(Boolean);
    if (!q.length) return [];
    const out: Word[][] = [];
    for (let i = 0; i + q.length <= this.words.length; i++) {
      let ok = true;
      for (let k = 0; k < q.length && ok; k++) ok = norm(this.words[i + k]!.w) === q[k];
      if (ok) out.push(this.words.slice(i, i + q.length));
    }
    return out;
  }

  /**
   * Sung progress of a word at time t: 0 before start, 1 after end, linear inside
   * (or piecewise across syllables when available). Use for karaoke wipes.
   */
  static wordProgress(w: Word, t: number): number {
    if (t <= w.start) return 0;
    if (t >= w.end) return 1;
    if (w.syl && w.syl.length > 1) {
      const n = w.syl.length;
      for (let i = 0; i < n; i++) {
        const [a, b] = w.syl[i]!;
        if (t < a) return i / n;
        if (t < b) return (i + (t - a) / Math.max(1e-3, b - a)) / n;
      }
      return 1;
    }
    return (t - w.start) / Math.max(1e-3, w.end - w.start);
  }

  /** Progress through a whole line in characters (0..text.length), for per-glyph wipes. */
  static lineCharProgress(l: Line, t: number): number {
    let chars = 0;
    for (const w of l.words) {
      const p = Lyrics.wordProgress(w, t);
      chars += p * w.w.length;
      if (p < 1) break;
      chars += 1; // the space
    }
    return Math.min(chars, l.text.length);
  }
}

/** Comparison key of a word: lower case, letters (any script), digits and parentheses only. */
export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}()]/gu, '');
const fold = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

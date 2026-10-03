// Captions from the word timings: cue segmentation, SRT/WebVTT export (soft subtitles, platform
// uploads) and the style of the burned-in open captions (silent autoplay), with a WCAG contrast check.
// Pure functions of the timing data, so captions re-time with every re-alignment or language.
import type { Line, Lyrics } from './lyrics';
import type { CaptionRules } from './manifest';

export interface CueWord { w: string; start: number; end: number; key: boolean; row: number }
export interface Cue {
  start: number;
  end: number;
  /** Wrapped text, one entry per caption row. */
  rows: string[];
  words: CueWord[];
  /** Script line id the cue belongs to. */
  lineId?: string;
}

export const DEFAULT_RULES: Required<Omit<CaptionRules, 'burnIn' | 'text' | 'key' | 'plate'>> = {
  maxChars: 42, maxLines: 2, minDur: 1.2, maxDur: 6, hold: 0.4,
};

const BREAK_AFTER = /[,.;:!?…—–]$/;
/** Words ending a clause: a cue that has to split prefers to split after one of these. */
const clauseEnd = (w: string) => BREAK_AFTER.test(w);

/** Split words into at most `maxLines` rows of at most `maxChars` (balanced), or null if they don't fit. */
export function wrap(words: string[], maxChars: number, maxLines: number): string[] | null {
  const text = words.join(' ');
  if (text.length <= maxChars) return [text];
  if (maxLines < 2) return null;
  // two rows: the split that keeps the longer row shortest, preferring a clause break when it costs little
  let best: { rows: string[]; cost: number } | null = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    if (a.length > maxChars) break;
    if (b.length > maxChars) continue;
    const cost = Math.max(a.length, b.length) - (clauseEnd(words[i - 1]!) ? 6 : 0);
    if (!best || cost < best.cost) best = { rows: [a, b], cost };
  }
  if (best || maxLines < 3) return best?.rows ?? null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    if (a.length > maxChars) break;
    const rest = wrap(words.slice(i), maxChars, maxLines - 1);
    if (rest) return [a, ...rest];
  }
  return null;
}

/** Group a line's words into cues that fit the rules, splitting at clause breaks where possible. */
function lineCues(l: Line, r: typeof DEFAULT_RULES): Cue[] {
  const chunks: Line['words'][] = [];
  let cur: Line['words'] = [];
  const fits = (ws: Line['words']) =>
    wrap(ws.map((w) => w.w), r.maxChars, r.maxLines) !== null && ws[ws.length - 1]!.end - ws[0]!.start <= r.maxDur;
  for (const w of l.words) {
    const next = [...cur, w];
    if (!cur.length || fits(next)) { cur = next; continue; }
    // full: split after the last clause break in the second half of the chunk, if there is one
    let k = -1;
    for (let i = cur.length - 1; i >= Math.ceil(cur.length / 2); i--) if (clauseEnd(cur[i - 1]!.w)) { k = i; break; }
    if (k > 0 && fits([...cur.slice(k), w])) { chunks.push(cur.slice(0, k)); cur = [...cur.slice(k), w]; }
    else { chunks.push(cur); cur = [w]; }
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((ws) => {
    const rows = wrap(ws.map((w) => w.w), r.maxChars, r.maxLines) ?? [ws.map((w) => w.w).join(' ')];
    // which row each word lands on (rows are whole words joined by single spaces)
    const rowOf = rows.flatMap((text, ri) => text.split(' ').map(() => ri));
    const words: CueWord[] = ws.map((w, i) => ({ w: w.w, start: w.start, end: w.end, key: !!w.key, row: rowOf[i] ?? rows.length - 1 }));
    return { start: ws[0]!.start, end: ws[ws.length - 1]!.end, rows, words, lineId: l.id };
  });
}

/**
 * Caption cues for the whole script: each cue stays `hold` s after its last word, at least `minDur` s
 * in all, and never overlaps the next cue.
 */
export function buildCues(ly: Lyrics, rules: CaptionRules = {}): Cue[] {
  const r = { ...DEFAULT_RULES, ...stripUndefined(rules) };
  const cues = ly.lines.filter((l) => l.words.length).flatMap((l) => lineCues(l, r));
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!, next = cues[i + 1];
    let end = Math.max(c.end + r.hold, c.start + r.minDur);
    if (next) end = Math.min(end, next.start - 0.04);
    c.end = Math.max(end, c.end);
  }
  return cues;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** 01:02:03,456 (SRT) or 01:02:03.456 (WebVTT). */
export function timestamp(t: number, sep: ',' | '.' = ','): string {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;
}

/** SubRip. `offset` shifts every cue (s), e.g. to caption a clip rendered with --from. */
export function toSRT(cues: Cue[], offset = 0): string {
  return cues
    .filter((c) => c.end + offset > 0)
    .map((c, i) => `${i + 1}\n${timestamp(c.start + offset)} --> ${timestamp(c.end + offset)}\n${c.rows.join('\n')}\n`)
    .join('\n');
}

/** WebVTT; `markKeys` wraps the script's key terms in <b> (players that style cues show them bold). */
export function toVTT(cues: Cue[], o: { offset?: number; markKeys?: boolean; lang?: string } = {}): string {
  const off = o.offset ?? 0;
  const body = cues.filter((c) => c.end + off > 0).map((c) => {
    const rows = o.markKeys ? c.rows.map((_, ri) => markRow(c.words.filter((w) => w.row === ri))) : c.rows;
    return `${timestamp(c.start + off, '.')} --> ${timestamp(c.end + off, '.')}\n${rows.map(escapeVTT).join('\n')}\n`;
  });
  const head = o.lang ? `WEBVTT\nLanguage: ${o.lang}\n` : 'WEBVTT\n';
  return [head, ...body].join('\n');
}

function markRow(ws: CueWord[]) {
  const out: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    const open = w.key && !ws[i - 1]?.key, close = w.key && !ws[i + 1]?.key;
    out.push(`${open ? '\u0001' : ''}${w.w}${close ? '\u0002' : ''}`);
  }
  return out.join(' ');
}
const escapeVTT = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u0001/g, '<b>').replace(/\u0002/g, '</b>');

// ------------------------------------------------------------------ contrast (WCAG 2.x)

const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Relative luminance of an sRGB '#rrggbb'. */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => channel(x / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
/** Contrast ratio of two colours (1..21). WCAG AA asks 4.5 for body text, 3 for large text. */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Resolved colours of the burned-in captions. */
export interface CaptionStyle { text: string; key: string; plate: string; plateAlpha: number }

/** Burn-in colours from the caption rules: palette keys (or literal #hex) resolved against `hex`. */
export function captionStyle(rules: CaptionRules, hex: Record<string, string>): CaptionStyle {
  const col = (k: string | undefined, d: string) => hex[k ?? d] ?? k ?? hex[d]!;
  return { text: col(rules.text, 'bone'), key: col(rules.key, 'signal'), plate: col(rules.plate, 'ink'), plateAlpha: 0.94 };
}

/** Contrast problems of a caption style (empty when the text and key colours pass AA on the plate). */
export function checkContrast(s: CaptionStyle, min = 4.5): string[] {
  const out: string[] = [];
  for (const [name, c] of [['text', s.text], ['key', s.key]] as const) {
    const r = contrast(c, s.plate);
    if (r < min) out.push(`caption ${name} ${c} on plate ${s.plate}: contrast ${r.toFixed(2)} < ${min}`);
  }
  return out;
}

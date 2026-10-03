// Optional HUD readout plug-in: a number in the corner that a project can stage over the edit
// (shown when a scene returns `post.readout > 0`). The engine never creates one: a project hands
// a factory to the Engine (see Project in engine.ts). WordCounter is the usual kind: a value that
// steps up every time a given word is sung (this video's P(doom), see scenes/_pdoom.ts).
import { rgba } from './palette';
import { F, font } from './type';
import type { Lyrics } from './lyrics';
import { clamp, ease, noise1, prog, smoothstep } from './util';

export interface Readout {
  /** Label above the digits (mono caps). */
  label: string;
  /** Value at song time t; 0..1 fills the bar. */
  value(t: number): number;
  /** The digits for a value. */
  format(v: number): string;
  /** 0..1 highlight envelope right after a step (the digits flash in the signal colour). */
  flash?(t: number): number;
}

export interface WordCounterOpts {
  /** The counted word, matched like Lyrics.findWords ('P(doom)'). */
  word: string;
  /** Value before the first hit, and the value after each hit (the last one repeats). */
  initial: number;
  values: number[];
  label: string;
  format?: (v: number) => string;
  /** Seconds after the word's start at which the step lands. */
  delay?: number;
  /** Length of the roll from one value to the next (s). */
  roll?: number;
  /** Share of the gap to the next value it creeps towards before the next hit. */
  creep?: number;
  /** Amplitude of the slow wobble around the value. */
  jitter?: number;
}

/** A value that steps up every time a word is sung (rolls to it, then drifts slowly towards the next). */
export class WordCounter implements Readout {
  steps: { t: number; v: number }[];
  label: string;
  format: (v: number) => string;
  private o: Required<Pick<WordCounterOpts, 'roll' | 'creep' | 'jitter'>>;

  constructor(lyrics: Lyrics, o: WordCounterOpts) {
    const hits = lyrics.findWords(o.word).map((w) => w.start + (o.delay ?? 0.06));
    const last = o.values[o.values.length - 1] ?? o.initial;
    this.steps = [{ t: -1, v: o.initial }, ...hits.map((t, i) => ({ t, v: o.values[i] ?? last }))];
    this.label = o.label;
    this.format = o.format ?? ((v) => v.toFixed(2));
    this.o = { roll: o.roll ?? 0.9, creep: o.creep ?? 0.2, jitter: o.jitter ?? 0.004 };
  }
  /** Value at t with the roll animation of each step and slow drift between steps. */
  value(t: number): number {
    let i = 0;
    while (i + 1 < this.steps.length && this.steps[i + 1]!.t <= t) i++;
    const cur = this.steps[i]!, prev = this.steps[Math.max(0, i - 1)]!;
    const k = i === 0 ? 1 : prog(t, cur.t, cur.t + this.o.roll, ease.outExpo);
    const base = prev.v + (cur.v - prev.v) * k;
    const next = this.steps[i + 1];
    // slow creep toward the next value (never more than `creep` of the gap)
    const creep = next ? (next.v - cur.v) * this.o.creep * smoothstep(cur.t + 1, next.t, t) : 0;
    const jitter = noise1(t * 3.1, 7) * this.o.jitter * (1 - k * 0.5);
    return clamp(base + creep + jitter, 0, 1);
  }
  /** 0..1 flash envelope right after a step. */
  flash(t: number): number {
    let f = 0;
    for (const s of this.steps) if (t >= s.t && s.t > 0) f = Math.max(f, Math.pow(0.5, (t - s.t) / 0.35));
    return f;
  }
  lastStep(t: number) { let s = this.steps[0]!; for (const x of this.steps) if (x.t <= t) s = x; return s; }
}

/**
 * Draw a readout instrument (label, digits, tick bar) anywhere, at any scale, into a Canvas2D
 * context — for plates that stage the value inside their world. (x, y) = left end of the digits'
 * baseline; the label sits above, the bar below. `label`/`digits` are colours, `title` the label text.
 */
export function drawReadout(c: CanvasRenderingContext2D, x: number, y: number, v: number, o: { scale?: number; title?: string; text?: string; digits?: string; label?: string; bar?: boolean } = {}) {
  const k = o.scale ?? 1;
  c.save();
  c.textBaseline = 'alphabetic';
  c.font = font(F.mono(500), 13 * k);
  c.letterSpacing = `${3 * k}px`;
  c.fillStyle = o.label ?? rgba('bone', 0.6);
  c.fillText(o.title ?? '', x, y - 44 * k);
  c.letterSpacing = '0px';
  c.font = font(F.mono(400), 40 * k);
  c.fillStyle = o.digits ?? rgba('bone', 0.92);
  c.fillText(o.text ?? v.toFixed(2), x - 2 * k, y);
  if (o.bar !== false) {
    const bw = 220 * k, by = y + 16 * k;
    c.fillStyle = rgba('bone', 0.18);
    c.fillRect(x, by, bw, Math.max(1, k));
    for (let i = 0; i <= 10; i++) c.fillRect(x + (bw * i) / 10, by - (i % 5 === 0 ? 5 : 3) * k, Math.max(1, k), (i % 5 === 0 ? 5 : 3) * k);
    c.fillStyle = rgba('signal', 1);
    c.fillRect(x, by - k, bw * clamp(v), 3 * k);
  }
  c.restore();
}

// A counter that steps on cue: each step rolls the value up (or down) to a new figure, then creeps
// toward the next one. Steps come from spoken/sung phrases (a word or a script line in the timing
// data) or from keyframes, so the counter re-times itself when the audio is re-aligned.
import type { Lyrics } from './lyrics';
import { clamp, ease, noise1, prog, smoothstep } from './util';

export interface CounterStep { t: number; v: number }

export interface CounterOptions {
  /** Roll time from one value to the next (s). */
  roll?: number;
  /** Easing of the roll. */
  easing?: (x: number) => number;
  /** Share of the gap to the next value crept between steps (0 = hold). */
  creep?: number;
  /** Seconds after a step before the creep starts. */
  creepDelay?: number;
  /** Amplitude of the live jitter (0 = none) and its noise seed. */
  jitter?: number;
  seed?: number;
  /** Clamp range of the value. */
  min?: number;
  max?: number;
  /** Half-life of the flash envelope after a step (s). */
  flashHalfLife?: number;
  /** Text of a value. */
  format?: (v: number) => string;
  /** Label above the digits in the HUD readout. */
  label?: string;
  /** Value at which the readout's bar is full (default 1). */
  barMax?: number;
}

/** A counter: a step function of time with animated transitions. */
export class Counter {
  readonly o: Required<Omit<CounterOptions, 'format' | 'label'>> & Pick<CounterOptions, 'format' | 'label'>;
  constructor(public steps: CounterStep[], opts: CounterOptions = {}) {
    if (!steps.length) throw new Error('Counter needs at least one step (the value before the first cue)');
    this.o = {
      roll: 0.9, easing: ease.outExpo, creep: 0, creepDelay: 1, jitter: 0, seed: 0,
      min: -Infinity, max: Infinity, flashHalfLife: 0.35, barMax: 1, ...opts,
    };
  }

  /**
   * Steps on each occurrence of `phrase` in the timing data, `lead` s after its first word starts:
   * a word ('P(doom)'), a script line id ('proof.1') or a key word of the script. `values[i]` is the
   * value from occurrence i on (the last value repeats); `initial` is the value before the first cue.
   */
  static fromCues(lyrics: Lyrics, phrase: string, initial: number, values: number[], opts: CounterOptions & { lead?: number } = {}) {
    const lead = opts.lead ?? 0.06;
    const hits = cueTimes(lyrics, phrase).map((t) => t + lead);
    return new Counter([{ t: -1, v: initial }, ...hits.map((t, i) => ({ t, v: values[Math.min(i, values.length - 1)] ?? initial }))], opts);
  }

  /** Steps at fixed times: [{ t, v }, ...] (sorted); the value before the first key is `initial`. */
  static fromKeyframes(keys: CounterStep[], initial: number, opts: CounterOptions = {}) {
    return new Counter([{ t: -1, v: initial }, ...[...keys].sort((a, b) => a.t - b.t)], opts);
  }

  /** Value at t with the roll animation of each step and the slow drift between steps. */
  value(t: number): number {
    const o = this.o;
    let i = 0;
    while (i + 1 < this.steps.length && this.steps[i + 1]!.t <= t) i++;
    const cur = this.steps[i]!, prev = this.steps[Math.max(0, i - 1)]!;
    const k = i === 0 ? 1 : prog(t, cur.t, cur.t + o.roll, o.easing);
    const base = prev.v + (cur.v - prev.v) * k;
    const next = this.steps[i + 1];
    const creep = next ? (next.v - cur.v) * o.creep * smoothstep(cur.t + o.creepDelay, next.t, t) : 0;
    const jitter = o.jitter ? noise1(t * 3.1, o.seed) * o.jitter * (1 - k * 0.5) : 0;
    return clamp(base + creep + jitter, o.min, o.max);
  }

  /** 0..1 flash envelope right after a step. */
  flash(t: number): number {
    let f = 0;
    for (const s of this.steps) if (t >= s.t && s.t > 0) f = Math.max(f, Math.pow(0.5, (t - s.t) / this.o.flashHalfLife));
    return f;
  }

  lastStep(t: number) { let s = this.steps[0]!; for (const x of this.steps) if (x.t <= t) s = x; return s; }

  /** Text of the value at t (or of `v`). */
  format(v: number): string { return this.o.format ? this.o.format(v) : String(Math.round(v)); }
  text(t: number) { return this.format(this.value(t)); }
}

/**
 * Start times of a phrase in the timing data: a script line id ('proof.1': its first word), else the
 * words of every occurrence of the phrase (key words of the script match without their markup).
 */
export function cueTimes(lyrics: Lyrics, phrase: string): number[] {
  const line = lyrics.byId(phrase);
  if (line) return [line.words[0]?.start ?? line.start];
  return lyrics.findPhrase(phrase).map((ws) => ws[0]!.start);
}

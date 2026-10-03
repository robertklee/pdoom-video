// Kit of the parametric scene templates: reusable plates for product and explainer films (a scattered
// "problem" field, a typed query, ranked result cards, counters, an end card) that any project's timeline
// places with params. Each template draws one Canvas2D layer over the brand background, lays itself out
// for the output format (16:9, 9:16, 1:1) clear of the burned-in captions, takes its strings from the
// script's localised `ui` table and its timing from script line ids and key terms, and draws the brand
// spark: an HDR glint (the only thing that blooms) that travels from plate to plate.
//
// Determinism (docs/ENGINE.md): every frame is a pure function of t. Templates keep no state between frames.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { HEX, LIN, rgba, type PaletteKey } from '../engine/palette';
import { BURN_IN } from '../engine/project';
import type { Line, Lyrics, Word } from '../engine/lyrics';
import { F, font } from '../engine/type';
import { clamp, ease, prog, TAU } from '../engine/util';

export interface Box { x: number; y: number; w: number; h: number }
export interface P2 { x: number; y: number }
/** A point in frame-relative units (0..1 of the width and of the height): portable across formats. */
export type NPoint = [x: number, y: number];

export type IconKind = 'doc' | 'chat' | 'ticket' | 'mail' | 'sheet' | 'wiki' | 'search';

/** Base of the templates: background, layout box, timing helpers and the spark. */
export abstract class Plate extends Scene {
  protected L = new Layer2D();
  protected glow = new LineBatch(1024, { screen2D: true, blend: 'add' });
  /** Background colour of the plate. */
  protected bg: PaletteKey = 'ink';
  /** Logical frame size, and the layout unit: 1 at 1080 px on the short side. */
  protected get W() { return this.ctx.W; }
  protected get H() { return this.ctx.H; }
  protected get u() { return Math.min(this.ctx.W, this.ctx.H) / 1080; }
  protected get portrait() { return this.ctx.H > this.ctx.W * 1.2; }
  protected get landscape() { return this.ctx.W > this.ctx.H * 1.2; }
  protected get ly(): Lyrics { return this.ctx.lyrics; }

  /** Draw the plate into the 2D context (cleared to the background); add HDR glints to `this.glow`. */
  protected abstract draw(f: Frame, c: CanvasRenderingContext2D): PostOverrides | void;

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    this.L.clear(HEX[this.bg]);
    this.glow.clear();
    const c = this.L.ctx;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    this.backdrop(c, f.t);
    const o = this.draw(f, c) ?? {};
    comp.draw(renderer, this.L.upload(), out, { mode: 'replace' });
    this.glow.render(renderer, out);
    return o;
  }

  override dispose() { this.L.texture.dispose(); }

  // ------------------------------------------------------------------ layout

  /** Title-safe margin (6% of the short side, as the captions use). */
  protected get margin() { return Math.round(Math.min(this.W, this.H) * 0.06); }

  /**
   * The content box: inside the safe margins and above the burned-in captions. A vertical frame also
   * keeps clear of the platforms' top and bottom UI (its captions sit at 78% of the height).
   */
  protected area(): Box {
    const m = this.margin;
    const capTop = this.portrait ? this.H * 0.78 - 140 : this.H - m - 8 - 122;
    const bottom = BURN_IN ? capTop - 24 * this.u : this.portrait ? this.H * 0.78 : this.H - m;
    const top = this.portrait ? Math.max(m, this.H * 0.1) : m;
    return { x: m, y: top, w: this.W - 2 * m, h: bottom - top };
  }

  /** A param as a frame point (frame-relative [x, y]); the default when it is missing. */
  protected npoint(v: unknown, d: NPoint): P2 {
    const p = Array.isArray(v) && v.length === 2 ? (v as NPoint) : d;
    return { x: p[0] * this.W, y: p[1] * this.H };
  }

  /** Faint dot grid, drifting slowly: the "index" texture behind every plate. */
  protected backdrop(c: CanvasRenderingContext2D, t: number) {
    const s = 54 * this.u, off = (t * 6 * this.u) % s, d = 2.4 * this.u;
    c.fillStyle = rgba('graphite', 0.22);
    for (let y = -s + off; y < this.H + s; y += s) for (let x = s / 2; x < this.W; x += s) c.fillRect(x - d / 2, y - d / 2, d, d);
  }

  // ------------------------------------------------------------------ timing

  /** A script line by id (throws if missing: fail loudly while authoring). */
  protected line(id: string): Line { return this.ly.get(id); }
  /** First word start / last word end of a line. */
  protected t0(id: string) { const l = this.line(id); return l.words[0]?.start ?? l.start; }
  protected t1(id: string) { return this.line(id).end; }
  /** The key terms of a line (the script's *marked* words, in order). */
  protected keys(id: string): Word[][] { return this.ly.keyTerms(this.line(id)); }
  /** Start of key term k of a line; `fallback` when the line has fewer key terms. */
  protected keyT(id: string, k: number, fallback?: number): number {
    const run = this.keys(id)[k];
    if (run) return run[0]!.start;
    if (fallback !== undefined) return fallback;
    throw new Error(`${this.ctx.id}: line ${id} has no key term #${k}`);
  }
  /** Localised string (smart quotes); a param names a ui key, or gives literal text as '=text'. */
  protected ui(key: string): string { return key.startsWith('=') ? key.slice(1) : this.ly.ui(key); }
  /** The first beat at or after t, plus n beats. */
  protected beatAfter(t: number, n = 0): number {
    const au = this.ctx.audio;
    return au.timeOfBeat(Math.ceil(au.beatAt(t) - 1e-3) + n);
  }
  /** 0..1 eased entrance from t0 over dur. */
  protected enter(t: number, t0: number, dur = 0.35, fn = ease.outCubic) { return prog(t, t0, t0 + dur, fn); }

  // ------------------------------------------------------------------ the spark

  /**
   * Where the spark is at t: it flies in from `params.sparkIn` over the first `fly` s of the plate,
   * rests on `anchor(t)` (null: the plate hides it), and flies out to `params.sparkOut` over the last
   * `fly` s. A timeline that gives one plate's sparkOut as the next one's sparkIn hands it across the cut.
   */
  protected sparkAt(t: number, anchor: (t: number) => P2 | null, fly = 0.45): P2 | null {
    const { start, end, params } = this.ctx;
    const pin = params.sparkIn ? this.npoint(params.sparkIn, [0.5, 0.5]) : null;
    const pout = params.sparkOut ? this.npoint(params.sparkOut, [0.5, 0.5]) : null;
    const tIn = start + fly, tOut = end - fly;
    if (pout && t >= tOut) {
      const a = anchor(tOut) ?? pin ?? pout;
      return arc(a, pout, ease.inOutCubic(clamp((t - tOut) / fly)));
    }
    if (pin && t < tIn) {
      const a = anchor(tIn) ?? pout ?? pin;
      return arc(pin, a, ease.inOutCubic(clamp((t - start) / fly)));
    }
    return anchor(t);
  }

  /** Draw the spark at its path position with a short trail sampled from the same path; returns the position. */
  protected spark(t: number, anchor: (t: number) => P2 | null, o: { scale?: number; intensity?: number; fly?: number } = {}) {
    const p = this.sparkAt(t, anchor, o.fly);
    if (!p) return null;
    const s = (o.scale ?? 1) * this.u, I = o.intensity ?? 1;
    // trail: earlier positions on the same path (never before the plate's start: the cut hands it over)
    let prev = p;
    for (let i = 1; i <= 8; i++) {
      const q = this.sparkAt(Math.max(this.ctx.start, t - i * 0.014), anchor, o.fly);
      if (!q) break;
      const k = 1 - i / 9;
      if (Math.hypot(q.x - prev.x, q.y - prev.y) > 0.5) this.glow.seg2(prev.x, prev.y, q.x, q.y, 7 * s * k, scaleRGB(LIN.acid, 1.6 * I * k), k);
      prev = q;
    }
    sparkGlyph(this.glow, p.x, p.y, t, s, I);
    return p;
  }
}

/** A gentle arc between two points (the spark never travels in a dead straight line). */
function arc(a: P2, b: P2, k: number): P2 {
  const dx = b.x - a.x, dy = b.y - a.y, bow = Math.sin(k * Math.PI) * 0.18;
  return { x: a.x + dx * k - dy * bow, y: a.y + dy * k + dx * bow };
}

const scaleRGB = (c: [number, number, number], k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];

/** The spark glyph: a four-point glint (acid halo, white-hot core) that turns slowly. 2D LineBatch, additive. */
export function sparkGlyph(lb: LineBatch, x: number, y: number, t: number, s = 1, I = 1) {
  const flick = 0.92 + 0.08 * Math.sin(t * 23.1);
  const a0 = t * 0.6;
  lb.seg2(x, y, x + 0.01, y, 30 * s, scaleRGB(LIN.acid, 0.35 * I), 0.35);
  lb.seg2(x, y, x + 0.01, y, 13 * s, scaleRGB(LIN.acid, 2.2 * I * flick), 0.9);
  lb.seg2(x, y, x + 0.01, y, 5 * s, [5 * I, 4.6 * I, 3.6 * I], 1);
  for (let i = 0; i < 4; i++) {
    const a = a0 + i * (TAU / 4), r = (i % 2 ? 15 : 22) * s;
    for (let j = 0; j < 3; j++) {
      const r0 = r * (j / 3), r1 = r * ((j + 1) / 3);
      lb.seg2(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * r1, y + Math.sin(a) * r1, (3.2 - j) * s, scaleRGB(LIN.acid, 2 * I * flick), 0.9 - j * 0.25);
    }
  }
}

// ------------------------------------------------------------------ drawing helpers

/** The project's font roles at a weight. */
export const fam = {
  display: (wt = 800) => F.brand('display', wt),
  text: (wt = 500) => F.brand('text', wt),
  mono: (wt = 400) => F.brand('mono', wt),
};

/** Rounded rectangle path. */
export function rrect(c: CanvasRenderingContext2D, b: Box, r: number) {
  c.beginPath();
  c.roundRect(b.x, b.y, b.w, b.h, Math.max(0, Math.min(r, b.h / 2, b.w / 2)));
}

/** A card: surface fill and a hairline border. */
export function card(c: CanvasRenderingContext2D, b: Box, u: number, o: { fill?: PaletteKey; stroke?: PaletteKey; strokeA?: number; alpha?: number; r?: number; lw?: number } = {}) {
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  rrect(c, b, (o.r ?? 18) * u);
  c.fillStyle = rgba(o.fill ?? 'ink2');
  c.fill();
  c.lineWidth = (o.lw ?? 1.5) * u;
  c.strokeStyle = rgba(o.stroke ?? 'graphite', o.strokeA ?? 0.9);
  c.stroke();
  c.restore();
}

/** Set a font and return the width of `s`. */
export function textW(c: CanvasRenderingContext2D, s: string, family: string, size: number) {
  c.font = font(family, size);
  return c.measureText(s).width;
}

/** Largest size ≤ max at which `s` fits in maxW (≥ min). */
export function fit(c: CanvasRenderingContext2D, s: string, family: string, maxW: number, max: number, min = 8) {
  const w = textW(c, s, family, max);
  return w <= maxW ? max : Math.max(min, Math.floor((max * maxW) / w));
}

/** `s` cut to fit maxW with an ellipsis (the font must already be set). */
export function ellipsize(c: CanvasRenderingContext2D, s: string, maxW: number) {
  if (c.measureText(s).width <= maxW) return s;
  const chars = Array.from(s);
  let n = chars.length;
  while (n > 1 && c.measureText(chars.slice(0, n).join('') + '…').width > maxW) n--;
  return chars.slice(0, n).join('').trimEnd() + '…';
}

/** Greedy word wrap of `s` into rows no wider than maxW (the font must already be set). Long words stay whole. */
export function wrap(c: CanvasRenderingContext2D, s: string, maxW: number): string[] {
  const rows: string[] = [];
  let cur = '';
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && c.measureText(next).width > maxW) { rows.push(cur); cur = w; } else cur = next;
  }
  if (cur) rows.push(cur);
  return rows;
}

/** Height of a pill of text size `size`. */
export const pillH = (size: number) => size * 1.9;

/** A pill (chip) with a label at (x, y) (top left); returns its width. */
export function pill(c: CanvasRenderingContext2D, x: number, y: number, label: string, size: number, o: { fill?: PaletteKey; fillA?: number; text?: PaletteKey; stroke?: PaletteKey; family?: string; alpha?: number } = {}) {
  const family = o.family ?? fam.text(600);
  const tw = textW(c, label, family, size);
  const h = pillH(size), w = tw + size * 1.6;
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  rrect(c, { x, y, w, h }, h / 2);
  c.fillStyle = rgba(o.fill ?? 'signal', o.fillA ?? 1);
  c.fill();
  if (o.stroke) { c.lineWidth = Math.max(1, size * 0.07); c.strokeStyle = rgba(o.stroke); c.stroke(); }
  c.fillStyle = rgba(o.text ?? 'bone');
  c.font = font(family, size);
  c.fillText(label, x + size * 0.8, y + h / 2 + size * 0.36);
  c.restore();
  return w;
}

/** Simple line icons for content sources, drawn in a square of side s at (x, y). */
export function icon(c: CanvasRenderingContext2D, kind: IconKind, x: number, y: number, s: number, col: PaletteKey = 'ember', alpha = 1) {
  c.save();
  c.globalAlpha *= alpha;
  c.strokeStyle = rgba(col);
  c.fillStyle = rgba(col);
  c.lineWidth = Math.max(1.2, s * 0.08);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const px = (fx: number) => x + fx * s, py = (fy: number) => y + fy * s;
  const poly = (pts: [number, number][], close = true) => {
    c.beginPath();
    pts.forEach(([a, b], i) => (i ? c.lineTo(px(a), py(b)) : c.moveTo(px(a), py(b))));
    if (close) c.closePath();
    c.stroke();
  };
  switch (kind) {
    case 'doc':
      poly([[0.2, 0.08], [0.62, 0.08], [0.82, 0.28], [0.82, 0.92], [0.2, 0.92]]);
      poly([[0.62, 0.08], [0.62, 0.28], [0.82, 0.28]], false);
      for (const fy of [0.48, 0.62, 0.76]) poly([[0.32, fy], [0.7, fy]], false);
      break;
    case 'chat':
      c.beginPath(); c.roundRect(px(0.08), py(0.14), s * 0.84, s * 0.56, s * 0.14); c.stroke();
      poly([[0.26, 0.7], [0.22, 0.9], [0.44, 0.7]], false);
      for (const fx of [0.3, 0.5, 0.7]) { c.beginPath(); c.arc(px(fx), py(0.42), s * 0.045, 0, TAU); c.fill(); }
      break;
    case 'ticket':
      poly([[0.1, 0.22], [0.9, 0.22], [0.9, 0.4], [0.82, 0.5], [0.9, 0.6], [0.9, 0.78], [0.1, 0.78], [0.1, 0.6], [0.18, 0.5], [0.1, 0.4]]);
      for (const fy of [0.32, 0.5, 0.68]) poly([[0.62, fy], [0.62, fy + 0.06]], false);
      break;
    case 'mail':
      poly([[0.08, 0.2], [0.92, 0.2], [0.92, 0.8], [0.08, 0.8]]);
      poly([[0.08, 0.2], [0.5, 0.55], [0.92, 0.2]], false);
      break;
    case 'sheet':
      poly([[0.12, 0.12], [0.88, 0.12], [0.88, 0.88], [0.12, 0.88]]);
      for (const g of [0.37, 0.62]) { poly([[g, 0.12], [g, 0.88]], false); poly([[0.12, g], [0.88, g]], false); }
      break;
    case 'wiki':
      poly([[0.5, 0.2], [0.5, 0.88]], false);
      poly([[0.5, 0.2], [0.1, 0.12], [0.1, 0.8], [0.5, 0.88], [0.9, 0.8], [0.9, 0.12]]);
      break;
    case 'search':
      c.beginPath(); c.arc(px(0.42), py(0.42), s * 0.28, 0, TAU); c.stroke();
      poly([[0.63, 0.63], [0.9, 0.9]], false);
      break;
  }
  c.restore();
}

/** Icon kind of a ui key or string ('frag.chat', 'Email · Legal · Aug 28' …); documents by default. */
export function kindOf(s: string): IconKind {
  const k = s.toLowerCase();
  if (/chat|#/.test(k)) return 'chat';
  if (/ticket/.test(k)) return 'ticket';
  if (/mail|re:/.test(k)) return 'mail';
  if (/sheet|tabelle|xls/.test(k)) return 'sheet';
  if (/wiki/.test(k)) return 'wiki';
  return 'doc';
}

/** Text origin of a search field's rows (x, baseline of row 0) and the row pitch. */
function fieldText(b: Box, size: number, rows: number) {
  const lh = size * 1.3;
  return { tx: b.x + size * 2.25, ty0: b.y + b.h / 2 - ((rows - 1) * lh) / 2 + size * 0.36, lh };
}

/** Where a search field's caret is (after the last character of `rows`); `c.font` is set to the field's font. */
export function fieldCaret(c: CanvasRenderingContext2D, b: Box, rows: string[], size: number): P2 {
  const rs = rows.length ? rows : [''];
  const { tx, ty0, lh } = fieldText(b, size, rs.length);
  c.font = font(fam.text(500), size);
  let r = rs.length - 1;
  while (r > 0 && !rs[r]) r--;
  return { x: tx + c.measureText(rs[r] ?? '').width + size * 0.1, y: ty0 + r * lh - size * 0.34 };
}

/**
 * A search field: rounded box, magnifier, the text in rows (or a placeholder) and a caret. Returns the
 * caret position (after the last character) for the spark to sit on.
 */
export function searchField(c: CanvasRenderingContext2D, b: Box, u: number, o: { rows?: string[]; placeholder?: string; size?: number; caret?: boolean; focus?: number } = {}): P2 {
  const size = o.size ?? 40 * u;
  card(c, b, u, { fill: 'ink2', stroke: 'graphite', r: Math.min(b.h / 2, 28 * u) });
  if (o.focus) {
    c.save();
    c.globalAlpha *= o.focus;
    rrect(c, { x: b.x - 4 * u, y: b.y - 4 * u, w: b.w + 8 * u, h: b.h + 8 * u }, Math.min(b.h / 2 + 4 * u, 32 * u));
    c.lineWidth = 3 * u;
    c.strokeStyle = rgba('signal');
    c.stroke();
    c.restore();
  }
  const rows = o.rows?.length ? o.rows : [''];
  const { tx, ty0, lh } = fieldText(b, size, rows.length);
  const is = size * 1.05;
  icon(c, 'search', b.x + size * 0.7, b.y + b.h / 2 - is / 2, is, 'ash');
  c.font = font(fam.text(500), size);
  const empty = rows.every((r) => !r);
  if (empty && o.placeholder) { c.fillStyle = rgba('ash', 0.85); c.fillText(o.placeholder, tx, ty0); }
  else rows.forEach((r, i) => { c.fillStyle = rgba('bone'); c.fillText(r, tx, ty0 + i * lh); });
  const caret = fieldCaret(c, b, rows, size);
  if (o.caret) { c.fillStyle = rgba('acid'); c.fillRect(caret.x - size * 0.035, caret.y - size * 0.62, Math.max(2, size * 0.07), size * 1.24); }
  return caret;
}

/**
 * Flow layout of pills: rows no wider than maxW, each row centred on cx. Returns the pill boxes (top
 * left, relative to y0) and the total height.
 */
export function flow(c: CanvasRenderingContext2D, labels: string[], size: number, cx: number, y0: number, maxW: number, gap: number, family = fam.text(600)) {
  const ws = labels.map((l) => textW(c, l, family, size) + size * 1.6);
  const rows: number[][] = [[]];
  let rw = 0;
  ws.forEach((w, i) => {
    const cur = rows[rows.length - 1]!;
    if (cur.length && rw + gap + w > maxW) { rows.push([i]); rw = w; } else { cur.push(i); rw += (cur.length > 1 ? gap : 0) + w; }
  });
  const h = pillH(size);
  const out: Box[] = [];
  rows.forEach((r, ri) => {
    const tw = r.reduce((s, i) => s + ws[i]!, 0) + gap * Math.max(0, r.length - 1);
    let x = cx - tw / 2;
    for (const i of r) { out[i] = { x, y: y0 + ri * (h + gap), w: ws[i]!, h }; x += ws[i]! + gap; }
  });
  return { boxes: out, height: rows.length * h + (rows.length - 1) * gap };
}

/**
 * A point that hops between stations: from each key's time it moves from the previous station to its
 * own over `dur` (eased). Before the first key it rests on the first station. A pure function of t.
 */
export function hop(t: number, keys: { t: number; p: P2 }[], dur = 0.25): P2 | null {
  if (!keys.length) return null;
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1]!.t <= t) i++;
  const cur = keys[i]!, prev = keys[Math.max(0, i - 1)]!;
  const k = i === 0 ? 1 : ease.inOutCubic(clamp((t - cur.t) / dur));
  return { x: prev.p.x + (cur.p.x - prev.p.x) * k, y: prev.p.y + (cur.p.y - prev.p.y) * k };
}

/** Locale number format (decimal separator, grouping) for counters. */
export function numberFormat(lang: string, decimals = 0) {
  const nf = new Intl.NumberFormat(lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (v: number) => nf.format(v);
}

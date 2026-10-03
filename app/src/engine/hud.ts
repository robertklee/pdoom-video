// Global overlay: the crop-mark frame and the (normally hidden) corner counter readout (P(doom) in the
// music video), the legacy plate captions, and open captions of the voice-over for projects that burn
// them in. The frame only appears at the bookends: the opening's sheet (the prompt's canvas) and the
// outro's regenerate/loop — the rest of the video runs full-bleed.
import { Layer2D, W, H } from './gl';
import { Counter, type CounterOptions } from './counter';
import type { Cue, CaptionStyle } from './captions';
import { rgba } from './palette';
import { F, font } from './type';
import type { Lyrics } from './lyrics';
import { clamp, ease, hash, lerp, noise1, prog, smoothstep } from './util';

export interface Caption { start: number; end: number; fig: string; text: string }

/** P(doom) steps: each sung "P(doom)" raises the estimate (a Counter cued by the word). */
export class PDoom extends Counter {
  constructor(lyrics: Lyrics) {
    const hits = lyrics.findWords('P(doom)').map((w) => w.start + 0.06);
    const vals = [0.15, 0.42, 0.81, 0.99];
    super([{ t: -1, v: 0.02 }, ...hits.map((t, i) => ({ t, v: vals[i] ?? 0.99 }))], PDOOM);
  }
}

/** Canonical text format of a P(doom) value ('0.15', '0.991'). */
export const formatPDoom = (v: number) => v.toFixed(v >= 0.99 ? 3 : 2);

// roll ~0.9 s, then a slow creep toward the next value (never more than 20% of the gap), a live jitter
const PDOOM: CounterOptions = { roll: 0.9, creep: 0.2, jitter: 0.004, seed: 7, min: 0, max: 1, format: formatPDoom, label: 'P(DOOM)' };

/**
 * Draw the P(doom) instrument (label, digits, tick bar) anywhere, at any scale, into a
 * Canvas2D context — for plates that stage the readout inside their world.
 * (x, y) = left end of the digits' baseline; the label sits above, the bar below.
 */
export function drawReadout(c: CanvasRenderingContext2D, x: number, y: number, v: number, o: { scale?: number; text?: string; digits?: string; label?: string; bar?: boolean } = {}) {
  const k = o.scale ?? 1;
  c.save();
  c.textBaseline = 'alphabetic';
  c.font = font(F.mono(500), 13 * k);
  c.letterSpacing = `${3 * k}px`;
  c.fillStyle = o.label ?? rgba('bone', 0.6);
  c.fillText('P(DOOM)', x, y - 44 * k);
  c.letterSpacing = '0px';
  c.font = font(F.mono(400), 40 * k);
  c.fillStyle = o.digits ?? rgba('bone', 0.92);
  c.fillText(o.text ?? formatPDoom(v), x - 2 * k, y);
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

export interface HudState {
  /** Overrides from the active scene (via post.hud etc.). */
  opacity: number;
  /** 0..1 the crop-mark frame: 1 in place, 0 flown out past the edges (see PostParams.frame). */
  frame: number;
  /** Opacity of the corner counter readout (off by default: P(doom) lives inside the plates). */
  readout: number;
  /** 0..1: the plate is light (bone paper) — draw captions/crop marks in ink. */
  paper: number;
  readoutText?: string; // e.g. 'NaN'
  corruption?: number; // 0..1 glitch the readout
  /** Opacity of the open (burned-in) captions. */
  captions: number;
}

/** Burned-in captions: the cues and their resolved style. */
export interface OpenCaptions { cues: Cue[]; style: CaptionStyle }

export class Hud {
  layer = new Layer2D();
  private ink = false;
  constructor(public counter: Counter | null, public captions: Caption[], public open: OpenCaptions | null = null) {}

  draw(t: number, st: HudState) {
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    if (st.opacity <= 0.001) return L.upload();
    c.globalAlpha = st.opacity;
    this.ink = st.paper > 0.5;
    if (st.frame > 0.001) this.cropMarks(c, st.frame);
    if (st.readout > 0.001 && this.counter) { c.save(); c.globalAlpha *= st.readout; this.readout(c, t, st, this.counter); c.restore(); }
    this.caption(c, t);
    if (this.open && st.captions > 0.001) { c.save(); c.globalAlpha *= st.captions; this.openCaption(c, t, this.open); c.restore(); }
    return L.upload();
  }

  /** Corner marks; as `k` drops they fly out along the diagonals and past the edges. */
  private cropMarks(c: CanvasRenderingContext2D, k: number) {
    const e = ease.inOutCubic(clamp(k));
    c.save();
    c.globalAlpha *= clamp(k * 3);
    c.strokeStyle = this.ink ? rgba('ink', 0.45) : rgba('bone', 0.34);
    c.lineWidth = 1.25;
    const m = lerp(-40, 36, e), l = 22;
    c.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
      c.moveTo(x + sx * l, y + 0.5 * sy); c.lineTo(x, y + 0.5 * sy); c.lineTo(x, y + sy * l);
    }
    c.stroke();
    c.restore();
  }

  private readout(c: CanvasRenderingContext2D, t: number, st: HudState, k: Counter) {
    const v = k.value(t);
    const fl = k.flash(t);
    const x = 64, y = H - 66;
    c.save();
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), 13);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('bone', 0.6);
    c.fillText(k.o.label ?? '', x, y - 44);
    c.letterSpacing = '0px';
    let s = st.readoutText ?? k.format(v);
    if (st.corruption && st.corruption > 0) {
      const glyphs = '01#%?!Ø∞';
      s = Array.from(s).map((ch, i) => (hash(i, Math.floor(t * 20)) < st.corruption! * 0.7 ? glyphs[Math.floor(hash(i, t) * glyphs.length)] : ch)).join('');
    }
    c.font = font(F.mono(400), 40);
    c.fillStyle = fl > 0.02 ? mix('bone', 'signal', Math.min(1, fl * 1.5)) : rgba('bone', 0.92);
    c.fillText(s, x - 2, y);
    // bar with ticks
    const bw = 220, by = y + 16;
    c.fillStyle = rgba('bone', 0.18);
    c.fillRect(x, by, bw, 1);
    for (let i = 0; i <= 10; i++) c.fillRect(x + (bw * i) / 10, by - (i % 5 === 0 ? 5 : 3), 1, i % 5 === 0 ? 5 : 3);
    c.fillStyle = rgba('signal', 1);
    c.fillRect(x, by - 1, bw * clamp(v / k.o.barMax), 3);
    c.restore();
  }

  private caption(c: CanvasRenderingContext2D, t: number) {
    const cap = this.captions.find((k) => t >= k.start && t < k.end);
    if (!cap) return;
    const a = Math.min(smoothstep(cap.start, cap.start + 0.5, t), 1 - smoothstep(cap.end - 0.6, cap.end, t));
    if (a <= 0) return;
    c.save();
    c.globalAlpha *= a;
    const x = W - 64, y = H - 66;
    c.textAlign = 'right';
    c.textBaseline = 'alphabetic';
    c.font = font(F.serif(400, true), 26);
    c.fillStyle = this.ink ? rgba('ink', 0.9) : rgba('bone', 0.85);
    // a soft halo keeps the caption legible over busy plates
    c.shadowColor = rgba('ink', 0.85);
    c.shadowBlur = this.ink ? 0 : 10; // no halo on paper: it reads as a pale patch
    // reveal letters left-to-right quickly
    const n = Math.floor(cap.text.length * prog(t, cap.start, cap.start + 0.8));
    const shown = cap.text.slice(0, n);
    const full = c.measureText(cap.text).width;
    c.textAlign = 'left';
    c.fillText(shown, x - full, y);
    c.font = font(F.mono(500), 13);
    c.letterSpacing = '3px';
    c.fillStyle = this.ink ? rgba('blood', 1) : rgba('signal', 1);
    c.fillText(cap.fig, x - full, y - 34);
    c.restore();
  }

  /**
   * Open captions: the current cue centred low in the frame on an opaque plate (legible over any plate,
   * contrast checked against the plate colour). Key terms turn to the highlight colour as they are spoken;
   * the rest of the cue shows at once, so it can be read ahead of the voice.
   */
  private openCaption(c: CanvasRenderingContext2D, t: number, oc: OpenCaptions) {
    const cue = oc.cues.find((k) => t >= k.start && t < k.end);
    if (!cue) return;
    const a = Math.min(smoothstep(cue.start - 0.08, cue.start + 0.08, t), 1 - smoothstep(cue.end - 0.12, cue.end, t));
    if (a <= 0) return;
    const st = oc.style;
    const portrait = H > W;
    const margin = Math.round(Math.min(W, H) * 0.06);
    // the longest row fits the width; vertical video sits above the platforms' bottom UI (~20% of the height)
    const longest = Math.max(...cue.rows.map((r) => r.length), 1);
    const size = Math.round(Math.min(portrait ? 50 : 44, (W - 2 * margin - 48) / (longest * 0.56)));
    const lh = Math.round(size * 1.32);
    const bottom = portrait ? H * 0.78 : H - margin - 8;
    const fam = F.brand('text', 600);
    c.save();
    c.globalAlpha *= a;
    c.font = font(fam, size);
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    cue.rows.forEach((_, ri) => {
      const ws = cue.words.filter((w) => w.row === ri);
      const space = c.measureText(' ').width;
      const widths = ws.map((w) => c.measureText(w.w).width);
      const tw = widths.reduce((s, x) => s + x, 0) + space * Math.max(0, ws.length - 1);
      const y = bottom - (cue.rows.length - 1 - ri) * lh;
      const px = size * 0.42, py = size * 0.26;
      c.fillStyle = rgbaHex(st.plate, st.plateAlpha);
      roundRect(c, (W - tw) / 2 - px, y - size * 0.98 - py, tw + 2 * px, size * 1.24 + 2 * py, size * 0.22);
      let x = (W - tw) / 2;
      ws.forEach((w, i) => {
        const on = w.key ? smoothstep(w.start - 0.02, w.start + 0.1, t) : 0;
        c.fillStyle = on > 0 ? mixHex(st.text, st.key, on) : st.text;
        c.fillText(w.w, x, y);
        x += widths[i]! + space;
      });
    });
    c.restore();
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
}

function rgbaHex(hex: string, a: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function mixHex(a: string, b: string, k: number) {
  const pa = parseInt(a.replace('#', ''), 16), pb = parseInt(b.replace('#', ''), 16);
  const ch = (n: number, s: number) => (n >> s) & 255;
  return `rgb(${[16, 8, 0].map((s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * k)).join(',')})`;
}

function mix(a: string, b: string, k: number) {
  const pa = rgba(a).match(/\d+/g)!.map(Number), pb = rgba(b).match(/\d+/g)!.map(Number);
  return `rgba(${[0, 1, 2].map((i) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * k)).join(',')},1)`;
}

// TEMPLATE: TYPED — a query typed token by token as it is spoken (the music video's `prompt` pattern).
// The field waits with a placeholder during the intro line, then the query types in step with the voice:
// its characters follow the spoken progress of the line, so the typing re-times itself with the
// alignment and in every language. The line's key terms light up in the query as they are spoken
// (optionally tagged: "Type: Contract"), then the query is submitted on the beat after the line.
// The spark is the cursor.
//
// params:
//   intro?:      line id spoken while the field waits (placeholder, blinking caret)
//   line:        line id the query types with
//   text:        ui key of the query as typed (it need not equal the spoken line)
//   placeholder?: ui key of the placeholder
//   tags?:       ui keys, one tag per key term of `line` (shown above the highlighted term)
//   sparkIn?, sparkOut?: frame points (see Plate.sparkAt)
import type { Frame, PostOverrides } from '../engine/scene';
import { Lyrics } from '../engine/lyrics';
import { rgba } from '../engine/palette';
import { font } from '../engine/type';
import { clamp, ease, fract, smoothstep } from '../engine/util';
import { Plate, fam, fieldCaret, pill, pillH, rrect, searchField, wrap, type Box } from './_kit';

/** Comparison form of a term: lower case, letters/digits/spaces only. */
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default class Typed extends Plate {
  private lay: { box: Box; size: number; rows: string[]; starts: number[] } | null = null;

  private get query() { return this.ui(this.ctx.params.text); }

  /** The field and the query's rows (laid out for the full query, so typing never reflows). */
  private layout(c: CanvasRenderingContext2D) {
    if (this.lay) return this.lay;
    const a = this.area(), u = this.u;
    const w = this.landscape ? Math.min(a.w * 0.84, 1500 * u) : a.w;
    const size = Math.round((this.landscape ? 48 : 44) * u);
    c.font = font(fam.text(500), size);
    const rows = wrap(c, this.query, w - size * 3.2);
    const starts: number[] = [];
    let i = 0;
    for (const r of rows) { const j = this.query.indexOf(r, i); i = j < 0 ? i : j; starts.push(i); i += r.length; }
    const h = rows.length * size * 1.3 + size * 1.5;
    const box = { x: a.x + (a.w - w) / 2, y: a.y + a.h * 0.46 - h / 2, w, h };
    return (this.lay = { box, size, rows, starts });
  }

  /** Characters of the query typed at t: the spoken progress of the line, mapped onto the query. */
  private typed(t: number): number {
    const l = this.line(this.ctx.params.line);
    const p = Lyrics.lineCharProgress(l, t + 0.08) / Math.max(1, l.text.length);
    return Math.round(clamp(p) * Array.from(this.query).length);
  }

  /** The rows as typed at t. */
  private rowsAt(c: CanvasRenderingContext2D, t: number) {
    const L = this.layout(c), n = this.typed(t);
    return L.rows.map((r, i) => r.slice(0, Math.max(0, Math.min(r.length, n - L.starts[i]!))));
  }

  /** When the query is submitted: the beat after the line (and never later than half a second before the cut). */
  private submitT() {
    return Math.min(this.beatAfter(this.t1(this.ctx.params.line) + 0.05), this.ctx.end - 0.5);
  }

  protected draw(f: Frame, c: CanvasRenderingContext2D): PostOverrides {
    const t = f.t, u = this.u, p = this.ctx.params;
    const L = this.layout(c), b = L.box;
    const kIn = this.enter(t, this.ctx.start, 0.4);
    const tq = this.t0(p.line), tSub = this.submitT();
    const n = this.typed(t);
    const rows = this.rowsAt(c, t);
    const sub = smoothstep(tSub, tSub + 0.08, t) * (1 - smoothstep(tSub + 0.1, tSub + 0.5, t));

    c.save();
    c.globalAlpha = kIn;
    c.translate(0, (1 - kIn) * 24 * u);
    // the brand mark sits above the field
    if (this.ctx.assets.has('mark')) {
      const ms = 64 * u;
      this.ctx.assets.draw(c, 'mark', b.x, b.y - ms - 28 * u, ms, ms);
    }
    const blink = fract(f.beat) < 0.5;
    searchField(c, b, u, {
      rows: n > 0 ? rows : [''],
      placeholder: p.placeholder ? this.ui(p.placeholder) : undefined,
      size: L.size,
      caret: t < tSub && (n > 0 && t < this.t1(p.line) ? true : blink),
      focus: 0.35 + 0.65 * smoothstep(tq - 0.4, tq, t) + sub,
    });

    // key terms light up in the query once typed and spoken
    const terms = this.keys(p.line);
    c.font = font(fam.text(500), L.size);
    const lh = L.size * 1.3;
    const ty0 = b.y + b.h / 2 - ((L.rows.length - 1) * lh) / 2 + L.size * 0.36;
    const tx = b.x + L.size * 2.25;
    terms.forEach((run, k) => {
      // the term in the query: its words in order, any punctuation or spacing between them, any case
      const words = run.map((w) => fold(w.w)).filter(Boolean);
      const m = words.length ? new RegExp(words.map(esc).join('[^\\p{L}\\p{N}]+'), 'iu').exec(this.query) : null;
      if (!m) return;
      const at = m.index, end = at + m[0].length;
      const tOn = Math.max(run[run.length - 1]!.end, tq);
      if (n < end || t < tOn) return;
      const on = this.enter(t, tOn, 0.25);
      let tagAt: { x: number; y: number } | null = null;
      for (let ri = 0; ri < L.rows.length; ri++) {
        const r = L.rows[ri]!, s0 = L.starts[ri]!, a0 = Math.max(at, s0), a1 = Math.min(end, s0 + r.length);
        if (a1 <= a0) continue;
        const x0 = tx + c.measureText(r.slice(0, a0 - s0)).width, x1 = tx + c.measureText(r.slice(0, a1 - s0)).width;
        const y = ty0 + ri * lh;
        c.save();
        c.globalAlpha *= on;
        rrect(c, { x: x0 - 6 * u, y: y - L.size * 0.9, w: x1 - x0 + 12 * u, h: L.size * 1.22 }, 8 * u);
        c.fillStyle = rgba('signal', 0.38);
        c.fill();
        c.fillStyle = rgba('ember');
        c.fillText(r.slice(a0 - s0, a1 - s0), x0, y);
        c.fillRect(x0, y + L.size * 0.2, (x1 - x0) * ease.outCubic(on), 3 * u);
        c.restore();
        tagAt ??= { x: x0 - 6 * u, y: y - L.size * 0.9 };
      }
      const tag = (p.tags as string[] | undefined)?.[k];
      if (tag && tagAt) {
        const ts = Math.round(20 * u);
        pill(c, tagAt.x, tagAt.y - pillH(ts) - 8 * u - (1 - on) * 10 * u, this.ui(tag), ts, { fill: 'blood', text: 'bone', alpha: on, family: fam.text(600) });
      }
    });
    c.font = font(fam.text(500), L.size);

    // submit: a "return" key cap pulses at the field's end
    if (t >= tSub - 0.3) {
      const ks = 46 * u, kx = b.x + b.w - ks - 22 * u, ky = b.y + b.h - ks - (b.h - ks) / 2;
      const k = this.enter(t, tSub - 0.3, 0.25);
      c.save();
      c.globalAlpha *= k;
      rrect(c, { x: kx, y: ky, w: ks, h: ks }, 10 * u);
      c.fillStyle = rgba(sub > 0.01 ? 'acid' : 'signal');
      c.fill();
      c.fillStyle = rgba(sub > 0.01 ? 'ink' : 'bone');
      c.font = font(fam.text(700), 30 * u);
      c.textAlign = 'center';
      c.fillText('↵', kx + ks / 2, ky + ks * 0.68);
      c.restore();
    }
    c.restore();

    // the spark is the cursor: it rides the caret, and leaves when the query is submitted
    this.spark(t, (tt) => {
      const cp = fieldCaret(c, L.box, this.typed(tt) > 0 ? this.rowsAt(c, tt) : [''], L.size);
      return { x: cp.x + 4 * u, y: cp.y - L.size * 0.75 + (1 - kIn) * 24 * u };
    }, { intensity: 1 + 0.8 * sub });
    return {};
  }
}

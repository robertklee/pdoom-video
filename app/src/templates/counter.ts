// TEMPLATE: COUNTER — proof points and speed claims as big figures that roll to their value on the
// spoken cue (the engine's Counter, stepped by a line's key term), each with a label and an optional
// comparison: bars that grow one per beat (before → after), or blocks that fill one per beat.
// Numbers use the language's format (0.4 / 0,4). A footnote (the claim's source) sits under them.
//
// params:
//   items: [{
//     line:      line id; the figure enters as the line starts
//     key?:      index of the key term the roll lands on (default 0; the line's start without key terms)
//     from, to:  values before and after the cue;  decimals?: digits after the point
//     unit?:     ui key or '=literal' set after the number ('=×', '=s');  prefix?: the same, before it
//     label:     ui key of the caption under the figure
//     bars?:     [{ v: 0..1, label?: ui key }] comparison bars, the last one in the brand colour
//     blocks?:   number of blocks that fill one per beat after the cue
//   }]
//   note?: ui key of a footnote (source of the claim, "illustrative UI")
//   sparkIn?, sparkOut?: frame points (see Plate.sparkAt)
import type { Frame, PostOverrides } from '../engine/scene';
import { Counter } from '../engine/counter';
import { rgba } from '../engine/palette';
import { font } from '../engine/type';
import { clamp, ease, prog } from '../engine/util';
import { Plate, ellipsize, fam, fit, hop, numberFormat, rrect, wrap, type Box, type P2 } from './_kit';

interface Item {
  line: string; key?: number; from: number; to: number; decimals?: number;
  unit?: string; prefix?: string; label: string;
  bars?: { v: number; label?: string }[]; blocks?: number;
}

export default class CounterPlate extends Plate {
  private counters: Counter[] = [];

  private get items(): Item[] { return this.ctx.params.items ?? []; }

  override init() {
    this.counters = this.items.map((it) => {
      const fmt = numberFormat(this.ly.lang, it.decimals ?? 0);
      return Counter.fromKeyframes([{ t: this.cueT(it), v: it.to }], it.from, { roll: 1.1, easing: ease.outCubic, format: fmt });
    });
  }

  private cueT(it: Item) { return this.keyT(it.line, it.key ?? 0, this.t0(it.line)); }
  private enterT(it: Item) { return Math.max(this.ctx.start, this.t0(it.line) - 0.2); }

  /** The item boxes: side by side on a wide frame, stacked otherwise; the note's line at the bottom. */
  private boxes(): { items: Box[]; note: Box } {
    const a = this.area(), n = Math.max(1, this.items.length), u = this.u;
    const noteH = this.ctx.params.note ? 44 * u : 0;
    const h = a.h - noteH;
    const side = this.landscape && n > 1;
    const items = this.items.map((_, i) => side
      ? { x: a.x + (i * a.w) / n, y: a.y, w: a.w / n, h }
      : { x: a.x, y: a.y + (i * h) / n, w: a.w, h: h / n });
    return { items, note: { x: a.x, y: a.y + h, w: a.w, h: noteH } };
  }

  /** Text pieces of figure i at t. */
  private figure(i: number, t: number) {
    const it = this.items[i]!;
    return { pre: it.prefix ? this.ui(it.prefix) : '', num: this.counters[i]!.text(t), unit: it.unit ? this.ui(it.unit) : '' };
  }

  /** Figure size: the widest text the figure reaches (the larger of from/to) fits the box. */
  private figSize(c: CanvasRenderingContext2D, i: number, b: Box) {
    const it = this.items[i]!, fmt = numberFormat(this.ly.lang, it.decimals ?? 0);
    const wide = [it.from, it.to].map((v) => `${it.prefix ? this.ui(it.prefix) : ''}${fmt(v)}${it.unit ? ' ' + this.ui(it.unit) : ''}`).sort((a, b) => b.length - a.length)[0]!;
    const max = Math.min(b.h * (this.items.length > 1 && !this.landscape ? 0.42 : 0.36), 300 * this.u);
    return fit(c, wide, fam.display(900), b.w * 0.9, max, 40 * this.u);
  }

  /** Where the figure is drawn: its left x, baseline and size (centred in its box, above the label). */
  private figPos(c: CanvasRenderingContext2D, i: number, t: number, b: Box) {
    const size = this.figSize(c, i, b);
    const { pre, num, unit } = this.figure(i, t);
    c.font = font(fam.display(900), size);
    const wn = c.measureText(pre + num).width;
    c.font = font(fam.display(700), size * 0.5);
    const wu = unit ? c.measureText(unit).width + size * 0.12 : 0;
    const x = b.x + (b.w - wn - wu) / 2, y = b.y + b.h * 0.18 + size * 0.8;
    return { x, y, size, wn, wu };
  }

  protected draw(f: Frame, c: CanvasRenderingContext2D): PostOverrides {
    const t = f.t, u = this.u, au = this.ctx.audio;
    const { items: boxes, note } = this.boxes();

    this.items.forEach((it, i) => {
      const b = boxes[i]!, te = this.enterT(it);
      if (t < te) return;
      const k = this.enter(t, te, 0.45);
      const cue = this.cueT(it);
      const flash = this.counters[i]!.flash(t);
      c.save();
      c.globalAlpha *= k;
      c.translate(0, (1 - k) * 40 * u);
      const fp = this.figPos(c, i, t, b);
      const { pre, num, unit } = this.figure(i, t);
      c.font = font(fam.display(900), fp.size);
      c.fillStyle = rgba(t >= cue ? 'bone' : 'ash');
      c.fillText(pre + num, fp.x, fp.y);
      if (unit) {
        c.font = font(fam.display(700), fp.size * 0.5);
        c.fillStyle = rgba('ember');
        c.fillText(unit, fp.x + fp.wn + fp.size * 0.12, fp.y);
      }
      // an underline sweeps in as the figure lands
      c.fillStyle = rgba('signal');
      c.fillRect(fp.x, fp.y + fp.size * 0.16, (fp.wn + fp.wu) * prog(t, cue, cue + 0.5, ease.outCubic), Math.max(3, fp.size * 0.03));

      // the label
      const ls = Math.round(Math.min(34 * u, b.w / 22));
      c.font = font(fam.text(500), ls);
      c.fillStyle = rgba('ash');
      c.textAlign = 'center';
      const rows = wrap(c, this.ui(it.label), b.w * 0.86).slice(0, 2);
      rows.forEach((r, ri) => c.fillText(r, b.x + b.w / 2, fp.y + fp.size * 0.16 + ls * (1.9 + 1.3 * ri)));
      c.textAlign = 'left';
      let y = fp.y + fp.size * 0.16 + ls * (1.9 + 1.3 * rows.length) + 10 * u;

      // comparison bars, one per beat after the cue
      const bw = Math.min(b.w * 0.8, 760 * u), bx = b.x + (b.w - bw) / 2;
      (it.bars ?? []).forEach((bar, j) => {
        const tb = this.beatAfter(cue, j);
        const g = prog(t, tb, tb + 0.5, ease.outCubic);
        const last = j === it.bars!.length - 1;
        const bs = Math.round(20 * u);
        if (bar.label) {
          c.font = font(fam.text(500), bs);
          c.fillStyle = rgba(last ? 'ember' : 'ash', clamp(g * 2));
          c.fillText(ellipsize(c, this.ui(bar.label), bw), bx, y + bs);
          y += bs * 1.4;
        }
        c.fillStyle = rgba('graphite', 0.35);
        rrect(c, { x: bx, y, w: bw, h: 14 * u }, 7 * u); c.fill();
        c.fillStyle = rgba(last ? 'signal' : 'ash');
        rrect(c, { x: bx, y, w: Math.max(0.001, bw * bar.v * g), h: 14 * u }, 7 * u); c.fill();
        y += 14 * u + 16 * u;
      });

      // blocks fill one per beat
      if (it.blocks) {
        const nb = it.blocks, gap = 12 * u, s = Math.min(56 * u, (bw - gap * (nb - 1)) / nb), x0 = b.x + (b.w - (nb * s + (nb - 1) * gap)) / 2;
        const b0 = Math.ceil(au.beatAt(cue) - 1e-3);
        for (let j = 0; j < nb; j++) {
          const on = this.enter(t, au.timeOfBeat(b0 + j * 0.5), 0.2, ease.outBack);
          rrect(c, { x: x0 + j * (s + gap), y: y + 6 * u, w: s, h: s }, 8 * u);
          c.strokeStyle = rgba('graphite');
          c.lineWidth = 1.5 * u;
          c.stroke();
          if (on > 0) {
            const q = s * (1 - 0.25 * (1 - clamp(on)));
            rrect(c, { x: x0 + j * (s + gap) + (s - q) / 2, y: y + 6 * u + (s - q) / 2, w: q, h: q }, 8 * u);
            c.fillStyle = rgba('signal', clamp(on));
            c.fill();
          }
        }
      }
      if (flash > 0.05 && t >= cue) {
        c.globalAlpha *= flash * 0.25;
        c.fillStyle = rgba('signal');
        c.fillRect(b.x, fp.y - fp.size, b.w, fp.size * 1.2);
      }
      c.restore();
    });

    // the footnote
    const nk = this.ctx.params.note as string | undefined;
    if (nk && this.items.length) {
      const k = this.enter(t, this.enterT(this.items[0]!) + 0.3, 0.5);
      const ns = Math.round(20 * u);
      c.font = font(fam.text(400), ns);
      c.fillStyle = rgba('ash', 0.85 * k);
      c.textAlign = 'center';
      c.fillText(ellipsize(c, this.ui(nk), note.w), note.x + note.w / 2, note.y + note.h - ns * 0.4);
      c.textAlign = 'left';
    }

    // the spark sits on the newest figure's shoulder
    const shoulder = (i: number, tt: number): P2 => {
      const b = boxes[i]!, fp = this.figPos(c, i, tt, b);
      const k = this.enter(tt, this.enterT(this.items[i]!), 0.45);
      return { x: fp.x + fp.wn + fp.wu + 14 * u, y: fp.y - fp.size * 0.78 + (1 - k) * 40 * u };
    };
    this.spark(t, (tt) => hop(tt, this.items.map((it, i) => ({ t: this.enterT(it), p: shoulder(i, tt) })), 0.35));
    return {};
  }
}

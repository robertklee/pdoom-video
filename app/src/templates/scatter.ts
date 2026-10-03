// TEMPLATE: SCATTER — the problem plate. Fragments of information (files, threads, tickets …) pop in
// scattered across the frame on the key terms of a line, then a failed search: a query types into a
// field, the first verdict lands ("No results"), the second floods the frame with copies of the
// fragments ("48,213 results"). The spark ignites at the field's caret at the end and hands over.
//
// params:
//   items:   ui keys of the fragments (the icon is guessed from the key and text: chat, ticket, mail …)
//   pop:     line id; item i pops on its key term i, items past the key terms on the following beats
//   search?: { line, query, verdicts: [ui keys] } — the query types in at the line's start, verdict k lands on key term k
//   swarm?:  copies that flood the frame on the last verdict (default 44)
//   sparkOut?: frame point where the spark leaves for the next plate
import type { Frame, PostOverrides } from '../engine/scene';
import { rgba } from '../engine/palette';
import { font } from '../engine/type';
import { clamp, ease, hash, smoothstep } from '../engine/util';
import { Plate, card, ellipsize, fam, fieldCaret, icon, kindOf, searchField, textW, type Box, type P2 } from './_kit';

export default class Scatter extends Plate {
  private get items(): string[] { return this.ctx.params.items ?? []; }

  /** When item i pops: its key term of the `pop` line, else the beats after the last key term. */
  private popT(i: number): number {
    const id = this.ctx.params.pop as string | undefined;
    if (!id) return this.beatAfter(this.ctx.start, i);
    const ks = this.keys(id);
    if (i < ks.length) return ks[i]![0]!.start;
    const last = ks.length ? ks[ks.length - 1]![0]!.start : this.t0(id);
    return this.beatAfter(last + 0.05, i - ks.length + 1);
  }

  /** The chip box of item i: one per cell of a grid over the content area, jittered. */
  private chipBox(c: CanvasRenderingContext2D, i: number, a: Box): Box & { label: string; size: number } {
    const n = Math.max(1, this.items.length);
    const cols = this.landscape ? 3 : 2, rows = Math.ceil(n / cols);
    const cw = a.w / cols, chh = a.h / rows;
    const size = Math.round((this.portrait ? 30 : 27) * this.u);
    const fm = fam.mono(500);
    c.font = font(fm, size);
    const label = ellipsize(c, this.ui(this.items[i]!), cw * 0.92 - size * 3.2);
    const w = textW(c, label, fm, size) + size * 3.2, h = size * 2.6;
    const col = i % cols, row = Math.floor(i / cols);
    const x = a.x + col * cw + hash(i, 7) * Math.max(0, cw - w);
    const y = a.y + row * chh + (0.15 + 0.7 * hash(i, 8)) * Math.max(0, chh - h);
    return { x, y, w, h, label, size };
  }

  private chip(c: CanvasRenderingContext2D, b: Box & { label: string; size: number }, kind: string, alpha: number, k: number, rot: number) {
    c.save();
    c.translate(b.x + b.w / 2, b.y + b.h / 2);
    c.rotate(rot);
    c.scale(k, k);
    c.translate(-b.w / 2, -b.h / 2);
    card(c, { x: 0, y: 0, w: b.w, h: b.h }, this.u, { alpha, r: 14 });
    c.globalAlpha *= alpha;
    icon(c, kindOf(kind), b.size * 0.7, b.h / 2 - b.size * 0.6, b.size * 1.2, 'ember');
    c.font = font(fam.mono(500), b.size);
    c.fillStyle = rgba('bone');
    c.fillText(b.label, b.size * 2.4, b.h / 2 + b.size * 0.36);
    c.restore();
  }

  private searchLayout() {
    const a = this.area();
    const w = Math.min(a.w, 980 * this.u), h = 104 * this.u;
    return { x: a.x + (a.w - w) / 2, y: a.y + a.h * 0.42 - h / 2, w, h };
  }

  protected draw(f: Frame, c: CanvasRenderingContext2D): PostOverrides {
    const t = f.t, a = this.area(), u = this.u;
    const s = this.ctx.params.search as { line: string; query: string; verdicts?: string[] } | undefined;
    const ts = s ? this.t0(s.line) - 0.25 : Infinity;
    const verdictT = (k: number) => (s ? this.keyT(s.line, k, this.t0(s.line) + 0.8 + k) : Infinity);
    const nv = s?.verdicts?.length ?? 0;
    const tFlood = nv ? verdictT(nv - 1) : Infinity;
    const out = smoothstep(this.ctx.end - 0.4, this.ctx.end - 0.05, t);
    const o: PostOverrides = {};

    // the fragments: pop on their cue, drift, dim behind the search
    const dim = 1 - 0.65 * smoothstep(ts, ts + 0.4, t);
    this.items.forEach((key, i) => {
      const tp = this.popT(i);
      if (t < tp) return;
      const b = this.chipBox(c, i, a);
      const k = 0.86 + 0.14 * ease.outBack(clamp((t - tp) / 0.3));
      const drift = { x: Math.sin(t * 0.35 + i * 2.1) * 10 * u, y: Math.cos(t * 0.29 + i * 1.3) * 8 * u };
      const al = clamp((t - tp) / 0.12) * dim * (1 - out);
      this.chip(c, { ...b, x: b.x + drift.x, y: b.y + drift.y }, `${key} ${b.label}`, al, k, (hash(i, 9) - 0.5) * 0.08);
    });

    // the flood: copies of the fragments pour in over a bar after the last verdict
    if (t >= tFlood) {
      const n = (this.ctx.params.swarm as number | undefined) ?? 44;
      for (let j = 0; j < n; j++) {
        const tj = tFlood + hash(j, 21) * 1.6;
        if (t < tj) continue;
        const i = j % Math.max(1, this.items.length);
        const size = Math.round((16 + 8 * hash(j, 22)) * u);
        c.font = font(fam.mono(500), size);
        const label = this.ui(this.items[i]!);
        const w = c.measureText(label).width + size * 3.2, h = size * 2.6;
        const x = hash(j, 23) * (this.W - w * 0.6) - w * 0.2, y = hash(j, 24) * (this.H - h);
        const k = 0.9 + 0.1 * ease.outBack(clamp((t - tj) / 0.25));
        this.chip(c, { x, y: y + (t - tj) * 6 * u, w, h, label, size }, `${this.items[i]} ${label}`, 0.55 * clamp((t - tj) / 0.1) * (1 - out), k, (hash(j, 25) - 0.5) * 0.2);
      }
    }

    // the failed search
    if (s && t >= ts) {
      const b = this.searchLayout();
      const k = this.enter(t, ts, 0.35);
      const q = this.ui(s.query);
      const typed = Array.from(q).slice(0, Math.max(0, Math.floor((t - ts - 0.25) * 16))).join('');
      c.save();
      c.globalAlpha = k;
      c.translate(0, (1 - k) * 30 * u);
      // a plate behind the field keeps it legible over the flood
      c.fillStyle = rgba('ink', 0.85);
      c.fillRect(0, b.y - 40 * u, this.W, b.h + 200 * u);
      searchField(c, b, u, { rows: [typed], size: 40 * u, caret: Math.floor(f.beat * 2) % 2 === 0 || typed.length < q.length, focus: 1 });
      // verdict k on key term k: the latest one replaces the previous
      let v = -1;
      for (let i = 0; i < nv; i++) if (t >= verdictT(i)) v = i;
      if (v >= 0) {
        const tv = verdictT(v), kv = this.enter(t, tv, 0.25, ease.outBack);
        const txt = this.ui(s.verdicts![v]!);
        const size = Math.round(46 * u * (0.9 + 0.1 * kv));
        c.font = font(fam.display(800), size);
        c.fillStyle = rgba(v === nv - 1 ? 'acid' : 'ash');
        c.globalAlpha = k * clamp((t - tv) / 0.08);
        c.textAlign = 'center';
        c.fillText(txt, b.x + b.w / 2, b.y + b.h + 96 * u);
        c.textAlign = 'left';
        if (t - tv < 0.12) o.shake = [Math.sin(t * 90) * 6 * u * (1 - (t - tv) / 0.12), 0];
      }
      c.restore();
    }

    // the spark ignites at the caret and leaves for the next plate
    const tIgn = this.ctx.end - 0.9;
    this.spark(t, (tt): P2 | null => {
      if (!s || tt < tIgn) return null;
      const c0 = fieldCaret(c, this.searchLayout(), [this.ui(s.query)], 40 * u);
      return { x: c0.x, y: c0.y - 30 * u };
    }, { intensity: smoothstep(tIgn, tIgn + 0.3, t) });
    return o;
  }
}

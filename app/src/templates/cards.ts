// TEMPLATE: CARDS — result cards under a search field, in three modes that cut together:
//   rank:     the sources light up across the line, cards arrive one per beat in a rough order, then
//             re-rank on the line's first key term; the top result is marked and the spark lands on it
//   filter:   filter chips pop one per beat from the line's first key term; on the next beat the cards
//             that don't match fold away and the rest close up
//   semantic: related terms branch from the query word, one per beat from the first key term, and link
//             to the cards they matched
//
// params:
//   mode:     'rank' | 'filter' | 'semantic'
//   line:     line id the plate is timed to
//   query:    ui key of the text in the field
//   cards:    ui key prefixes of the cards in ranked order ('card.1' → card.1.title, card.1.meta)
//   order0?:  rank: the cards' first slots (card indices, top to bottom) before the re-rank
//   sources?: rank: icon kinds that light up across the line
//   chips?:   filter: ui keys of the chips;  keep?: indices of the cards that match them
//   terms?:   semantic: ui keys of the related terms;  match?: term index of each card (-1: none)
//   sparkIn?, sparkOut?: frame points (see Plate.sparkAt)
import type { Frame, PostOverrides } from '../engine/scene';
import { rgba } from '../engine/palette';
import { font } from '../engine/type';
import { clamp, ease, lerp, prog, smoothstep } from '../engine/util';
import { Plate, card, ellipsize, fam, fieldCaret, flow, hop, icon, kindOf, pill, searchField, textW, type Box, type IconKind, type P2 } from './_kit';

type Mode = 'rank' | 'filter' | 'semantic';
const SOURCES: IconKind[] = ['doc', 'chat', 'ticket', 'mail', 'sheet', 'wiki'];

interface Lay { bar: Box; size: number; strip: Box; pills: Box[]; slot: (j: number) => number; ch: number; x: number; w: number }

export default class Cards extends Plate {
  private lay: Lay | null = null;
  private get mode(): Mode { return this.ctx.params.mode ?? 'rank'; }
  private get cards(): string[] { return this.ctx.params.cards ?? []; }
  private get pillKeys(): string[] { return (this.mode === 'filter' ? this.ctx.params.chips : this.mode === 'semantic' ? this.ctx.params.terms : null) ?? []; }

  private layout(c: CanvasRenderingContext2D): Lay {
    if (this.lay) return this.lay;
    const a = this.area(), u = this.u;
    const w = this.landscape ? Math.min(a.w * 0.84, 1500 * u) : a.w;
    const x = a.x + (a.w - w) / 2;
    const size = Math.round(34 * u);
    const bar = { x, y: a.y, w, h: 88 * u };
    const top = bar.y + bar.h + 26 * u;
    let pills: Box[] = [], sh = 52 * u;
    if (this.mode !== 'rank') {
      const ps = Math.round((this.mode === 'semantic' ? 28 : 26) * u);
      const lead = this.mode === 'semantic' ? 34 * u : 0; // room for the links from the query word
      const fl = flow(c, this.pillKeys.map((k) => this.label(k)), ps, x + w / 2, top + lead, w, 14 * u);
      pills = fl.boxes;
      sh = lead + fl.height;
    }
    const strip = { x, y: top, w, h: sh };
    const listTop = top + sh + 26 * u, gap = 16 * u, n = Math.max(1, this.cards.length);
    const ch = Math.min(132 * u, (a.y + a.h - listTop - (n - 1) * gap) / n);
    return (this.lay = { bar, size, strip, pills, slot: (j) => listTop + j * (ch + gap), ch, x, w });
  }

  private label(k: string) { return this.mode === 'semantic' ? `≈ ${this.ui(k)}` : this.ui(k); }

  /** When pill k pops: one per beat from the line's first key term. */
  private pillT(k: number) {
    const id = this.ctx.params.line;
    return this.beatAfter(this.keyT(id, 0, this.t0(id) + 0.5), k);
  }
  /** Rank: when the re-rank starts. Filter: when the non-matching cards fold. */
  private rerankT() { const id = this.ctx.params.line; return this.keyT(id, 0, this.t0(id) + 1.5); }
  private foldT() { return this.beatAfter(this.pillT(Math.max(0, this.pillKeys.length - 1)) + 0.05, 1); }

  /** Rank: when card i arrives (one per beat, top slot first). */
  private arrival(i: number) {
    const order0: number[] = this.ctx.params.order0 ?? this.cards.map((_, j) => j);
    return this.beatAfter(this.ctx.start + 0.02, Math.max(0, order0.indexOf(i)));
  }

  /** Card i's y and opacity at t (slots, arrivals, re-rank, folding). */
  private place(i: number, t: number, L: Lay): { y: number; a: number; dx: number; lift: number } {
    const p = this.ctx.params;
    if (this.mode === 'rank') {
      const order0: number[] = p.order0 ?? this.cards.map((_, j) => j);
      const j0 = Math.max(0, order0.indexOf(i));
      const kA = this.enter(t, this.arrival(i), 0.35);
      const tR = this.rerankT() + 0.05 * i;
      const k = prog(t, tR, tR + 0.6, ease.inOutCubic);
      return { y: lerp(L.slot(j0), L.slot(i), k), a: kA, dx: (1 - kA) * 70 * this.u, lift: Math.sin(k * Math.PI) * (j0 !== i ? 1 : 0) };
    }
    if (this.mode === 'filter') {
      const keep: number[] = p.keep ?? this.cards.map((_, j) => j);
      const tF = this.foldT();
      const j = keep.indexOf(i);
      if (j < 0) { const k = this.enter(t, tF, 0.3); return { y: L.slot(i), a: 1 - k, dx: k * 60 * this.u, lift: 0 }; }
      return { y: lerp(L.slot(i), L.slot(j), prog(t, tF + 0.12, tF + 0.6, ease.inOutCubic)), a: 1, dx: 0, lift: 0 };
    }
    return { y: L.slot(i), a: 1, dx: 0, lift: 0 };
  }

  /** The rank badge's centre on card i at t. */
  private badge(i: number, t: number, L: Lay): P2 {
    const pl = this.place(i, t, L);
    return { x: L.x + L.w - L.ch * 0.5 + pl.dx, y: pl.y + L.ch / 2 };
  }

  private drawCard(c: CanvasRenderingContext2D, i: number, t: number, L: Lay, o: { highlight: number; rank: number; num: number; relevance: number; match: string | null; matchOn: number }) {
    const u = this.u, pl = this.place(i, t, L);
    if (pl.a <= 0.003) return;
    const b = { x: L.x + pl.dx, y: pl.y, w: L.w, h: L.ch };
    const key = this.cards[i]!;
    const title = this.ui(`${key}.title`), meta = this.ui(`${key}.meta`);
    c.save();
    c.globalAlpha *= pl.a;
    if (pl.lift > 0) { c.translate(b.x + b.w / 2, b.y + b.h / 2); c.scale(1 + 0.015 * pl.lift, 1 + 0.015 * pl.lift); c.translate(-b.x - b.w / 2, -b.y - b.h / 2); }
    card(c, b, u, { stroke: o.highlight > 0.01 ? 'signal' : 'graphite', lw: 1.5 + 2 * o.highlight, fill: 'ink2' });
    const is = L.ch * 0.4;
    icon(c, kindOf(meta), b.x + L.ch * 0.3, b.y + (b.h - is) / 2, is, 'ember');
    const tx = b.x + L.ch * 0.3 + is + 26 * u;
    const right = this.mode === 'semantic' ? 330 * u : this.mode === 'rank' ? 230 * u : L.ch * 0.7;
    const ts = Math.round(Math.min(32 * u, L.ch * 0.27));
    c.font = font(fam.text(600), ts);
    c.fillStyle = rgba('bone');
    c.fillText(ellipsize(c, title, b.x + b.w - right - tx), tx, b.y + b.h / 2 - ts * 0.15);
    c.font = font(fam.mono(400), Math.round(ts * 0.72));
    c.fillStyle = rgba('ash');
    c.fillText(ellipsize(c, meta, b.x + b.w - right - tx), tx, b.y + b.h / 2 + ts * 0.95);
    // relevance meter
    if (this.mode === 'rank') {
      const mw = 120 * u, mx = b.x + b.w - L.ch - mw, my = b.y + b.h / 2 - 3 * u;
      c.fillStyle = rgba('graphite', 0.6);
      c.fillRect(mx, my, mw, 6 * u);
      c.fillStyle = rgba('ember');
      c.fillRect(mx, my, mw * o.relevance, 6 * u);
    }
    // the rank badge
    if (o.rank > 0.01) {
      const bc = { x: b.x + b.w - L.ch * 0.5, y: b.y + b.h / 2 }, r = L.ch * 0.2 * (0.7 + 0.3 * ease.outBack(o.rank));
      c.globalAlpha *= clamp(o.rank * 1.5);
      c.beginPath();
      c.arc(bc.x, bc.y, r, 0, Math.PI * 2);
      c.fillStyle = rgba(o.num === 1 ? 'signal' : 'graphite');
      c.fill();
      c.fillStyle = rgba('bone');
      c.font = font(fam.text(700), Math.round(r * 1.1));
      c.textAlign = 'center';
      c.fillText(String(o.num), bc.x, bc.y + r * 0.38);
      c.textAlign = 'left';
    }
    // the related term this card matched
    if (o.match && o.matchOn > 0.01) {
      const ps = Math.round(22 * u);
      const w = textW(c, o.match, fam.text(600), ps) + ps * 1.6;
      pill(c, b.x + b.w - w - 24 * u, b.y + (b.h - ps * 1.9) / 2, o.match, ps, { fill: 'blood', text: 'ember', alpha: o.matchOn });
    }
    c.restore();
  }

  protected draw(f: Frame, c: CanvasRenderingContext2D): PostOverrides {
    const t = f.t, u = this.u, p = this.ctx.params, L = this.layout(c);
    const id = p.line as string;
    const q = this.ui(p.query);

    // the field (it carries over from the previous plate: no entrance)
    searchField(c, L.bar, u, { rows: [q], size: L.size, caret: false, focus: 0.5 });

    // the strip under the field
    if (this.mode === 'rank') {
      const kinds: IconKind[] = p.sources ?? SOURCES;
      const s = 40 * u, gap = 30 * u, tw = kinds.length * s + (kinds.length - 1) * gap;
      const b0 = Math.ceil(this.ctx.audio.beatAt(this.t0(id)) - 1e-3);
      kinds.forEach((k, j) => {
        const tj = this.ctx.audio.timeOfBeat(b0 + j * 0.5);
        const on = this.enter(t, tj, 0.2);
        icon(c, k, L.x + (L.w - tw) / 2 + j * (s + gap), L.strip.y + (L.strip.h - s) / 2, s, on > 0.5 ? 'ember' : 'graphite', 0.5 + 0.5 * on);
      });
    } else {
      const caret = fieldCaret(c, L.bar, [q], L.size);
      this.pillKeys.forEach((k, j) => {
        const tp = this.pillT(j), on = this.enter(t, tp, 0.3, ease.outBack);
        if (t < tp) return;
        const b = L.pills[j]!;
        if (this.mode === 'semantic') {
          // a link from the query word to the term, drawn out as it pops
          const e = { x: b.x + b.w / 2, y: b.y };
          const s0 = { x: caret.x - 60 * u, y: L.bar.y + L.bar.h };
          const k2 = clamp((t - tp) / 0.3);
          c.strokeStyle = rgba('signal', 0.8);
          c.lineWidth = 2 * u;
          c.beginPath();
          for (let i = 0; i <= 20 * k2; i++) {
            const s = i / 20, x = lerp(s0.x, e.x, s), y = lerp(s0.y, e.y, ease.inOutQuad(s));
            if (i) c.lineTo(x, y); else c.moveTo(x, y);
          }
          c.stroke();
        }
        c.save();
        c.translate(b.x + b.w / 2, b.y + b.h / 2);
        c.scale(0.8 + 0.2 * on, 0.8 + 0.2 * on);
        pill(c, -b.w / 2, -b.h / 2, this.label(k), Math.round((this.mode === 'semantic' ? 28 : 26) * u), this.mode === 'semantic' ? { fill: 'blood', text: 'ember', alpha: clamp(on) } : { fill: 'signal', alpha: clamp(on) });
        c.restore();
      });
    }

    // the cards
    const tR = this.mode === 'rank' ? this.rerankT() : -Infinity;
    const top = this.mode === 'filter' ? ((p.keep as number[] | undefined)?.[0] ?? 0) : 0;
    const keep: number[] = p.keep ?? this.cards.map((_, i) => i);
    const folded = this.mode === 'filter' && t >= this.foldT() + 0.12;
    const order = this.cards.map((_, i) => i).sort((a, b) => this.place(a, t, L).lift - this.place(b, t, L).lift);
    for (const i of order) {
      const rel = this.mode === 'rank' ? clamp(0.96 - i * 0.18) * this.enter(t, this.arrival(i) + 0.1, 1.2) : 0;
      const rank = this.mode === 'rank' ? this.enter(t, tR + 0.55 + 0.08 * i, 0.3) : this.mode === 'filter' ? 1 : 0;
      const highlight = i === top ? (this.mode === 'rank' ? this.enter(t, tR + 0.6, 0.3) : this.mode === 'filter' ? 1 : 0.35) : 0;
      const m = (p.match as number[] | undefined)?.[i] ?? -1;
      const match = this.mode === 'semantic' && m >= 0 ? this.label(this.pillKeys[m]!) : null;
      const num = folded ? keep.indexOf(i) + 1 : i + 1;
      this.drawCard(c, i, t, L, { highlight, rank, num, relevance: rel, match, matchOn: match ? this.enter(t, this.pillT(m) + 0.15, 0.3) : 0 });
    }

    // the spark: on the field, then the top result (rank), the newest chip (filter) or term (semantic)
    this.spark(t, (tt) => {
      const fieldEnd = fieldCaret(c, L.bar, [q], L.size);
      const home = { x: fieldEnd.x + 6 * u, y: fieldEnd.y - L.size * 0.75 };
      if (this.mode === 'rank') return hop(tt, [{ t: -1, p: home }, { t: tR + 0.5, p: this.badge(0, tt, L) }], 0.4);
      const keys = [{ t: -1, p: this.mode === 'filter' ? this.badge(0, tt, L) : home }];
      this.pillKeys.forEach((_, j) => { const b = L.pills[j]!; keys.push({ t: this.pillT(j), p: { x: b.x + b.w - 6 * u, y: b.y + 4 * u } }); });
      if (this.mode === 'filter') keys.push({ t: this.foldT() + 0.3, p: this.badge(top, tt, L) });
      return hop(tt, keys, 0.25);
    });
    return {};
  }
}

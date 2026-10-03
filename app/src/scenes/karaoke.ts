// Generic word-synced lyric plate: the starting point for a new song (src/timelines/starter.ts uses it
// for every section). Big Archivo lyric, wiped per glyph as each word is sung (unsung dim bone, the word
// being sung signal, sung words bone), the next line previewed small, a section/bar label and a beat
// counter, over a dark field that breathes with the low end and the kicks.
// params: { variant: 0 | 1 | 2 (layout: lower left, centred, upper left), section: label text }
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { F, font, glyphX, measure } from '../engine/type';
import { Lyrics, type Line } from '../engine/lyrics';
import { clamp, ease, prog } from '../engine/util';

const SAFE = 160; // side margin (title-safe is 96)
const MAX_SIZE = 132;
const MIN_SIZE = 64; // below this a line wraps onto two rows
const EARLY = 0.4; // show a line (dim) this long before its first word
const HOLD = 0.8; // keep a finished line up this long if nothing follows

export default class Karaoke extends Scene {
  bg = new FSPass(/* glsl */ `
    uniform float t, low, kick, cx, cy;
    uniform vec3 ink, signal;
    void main() {
      vec2 p = (FRAG_PX - vec2(cx, ${H}.0 - cy)) / ${H}.0; // FRAG_PX is y-up
      float glow = exp(-dot(p, p) * 2.2) * (0.05 + 0.10 * low + 0.12 * kick);
      float n = snoise(vec3(FRAG_PX / 420.0, t * 0.08)) * 0.012;
      fragColor = vec4(ink + signal * glow + n, 1.0);
    }`, { t: { value: 0 }, low: { value: 0 }, kick: { value: 0 }, cx: { value: W / 2 }, cy: { value: H / 2 }, ink: { value: LIN.ink }, signal: { value: LIN.signal } });
  text = new Layer2D();
  family = F.archivo(100, 800);

  /** Rows of words (indices into line.words) and the type size, per line: fixed per line, so nothing reflows. */
  private sets = new Map<number, { rows: number[][]; size: number }>();

  private set(l: Line) {
    let s = this.sets.get(l.i);
    if (s) return s;
    const maxW = W - 2 * SAFE;
    const one = Math.min(MAX_SIZE, (MAX_SIZE * maxW) / Math.max(1, measure(l.text, this.family, MAX_SIZE)));
    if (one >= MIN_SIZE || l.words.length < 2) s = { rows: [l.words.map((_, i) => i)], size: Math.max(one, 40) };
    else {
      // two rows, split where the halves are most even
      let best = 1, bestD = Infinity;
      for (let k = 1; k < l.words.length; k++) {
        const a = l.words.slice(0, k).map((w) => w.w).join(' '), b = l.words.slice(k).map((w) => w.w).join(' ');
        const d = Math.abs(measure(a, this.family, 100) - measure(b, this.family, 100));
        if (d < bestD) { bestD = d; best = k; }
      }
      const rows = [l.words.slice(0, best).map((_, i) => i), l.words.slice(best).map((_, i) => i + best)];
      const widest = Math.max(...rows.map((r) => measure(r.map((i) => l.words[i]!.w).join(' '), this.family, MAX_SIZE)));
      s = { rows, size: Math.max(40, Math.min(MAX_SIZE, (MAX_SIZE * maxW) / widest)) };
    }
    this.sets.set(l.i, s);
    return s;
  }

  /** The line on screen at t: the one being sung, else the next within EARLY, else the last within HOLD. */
  private lineAt(t: number): Line | null {
    const ly = this.ctx.lyrics;
    const cur = ly.lineAt(t);
    if (cur) return cur;
    const next = ly.nextLine(t);
    if (next && next.start - t <= EARLY) return next;
    const last = ly.lastLine(t);
    if (last && t - last.end <= HOLD && (!next || next.start - t > EARLY)) return last;
    return null;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { t } = f;
    const { renderer, comp, lyrics } = this.ctx;
    const variant = (this.ctx.params.variant ?? 0) % 3;
    const section = String(this.ctx.params.section ?? this.ctx.id);
    const centred = variant === 1;
    const baseY = [H * 0.68, H * 0.5, H * 0.36][variant]!;

    const u = this.bg.u;
    u.t!.value = t; u.low!.value = f.a.low; u.kick!.value = f.a.kick;
    u.cx!.value = centred ? W / 2 : W * 0.3; u.cy!.value = baseY;
    this.bg.render(renderer, out);

    const c = this.text.ctx;
    this.text.clear();
    c.textBaseline = 'alphabetic';

    // section / bar label and a 4-step beat counter (top, inside title-safe)
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('ash', 0.7);
    c.fillText(`${section.toUpperCase()} · BAR ${Math.max(1, Math.floor(f.bar) + 1)}`, SAFE, 120);
    c.letterSpacing = '0px';
    const beatInBar = ((Math.floor(f.beat) % 4) + 4) % 4;
    for (let i = 0; i < 4; i++) {
      const on = i === beatInBar ? 1 - 0.6 * f.beatPhase : 0;
      c.fillStyle = on > 0 ? rgba('signal', 0.4 + 0.6 * on) : rgba('graphite', 0.6);
      c.fillRect(W - SAFE - 4 * 22 + i * 22, 108, 14, 14);
    }

    const line = this.lineAt(t);
    if (line) {
      const { rows, size } = this.set(line);
      const lead = size * 1.08;
      const top = baseY - ((rows.length - 1) * lead) / 2;
      // fade in during the anticipation window, out during the hold
      const alpha = Math.min(prog(t, line.start - EARLY, line.start - EARLY + 0.15), 1 - prog(t, line.end + HOLD - 0.25, line.end + HOLD));
      c.font = font(this.family, size);
      const space = measure(' ', this.family, size);
      rows.forEach((row, r) => {
        const rowText = row.map((i) => line.words[i]!.w).join(' ');
        let x = centred ? (W - measure(rowText, this.family, size)) / 2 : SAFE;
        const y = top + r * lead;
        for (const i of row) {
          const w = line.words[i]!;
          const p = Lyrics.wordProgress(w, t);
          const chars = Array.from(w.w);
          const k = Math.round(p * chars.length); // glyphs sung so far
          const lift = p > 0 && p < 1 ? 6 * (1 - ease.outExpo(clamp((t - w.start) / 0.18))) : 0;
          c.fillStyle = rgba('bone', 0.3 * alpha);
          c.fillText(w.w, x, y - lift);
          if (k > 0) {
            c.fillStyle = rgba(p < 1 ? 'signal' : 'bone', alpha);
            c.fillText(chars.slice(0, k).join(''), x, y - lift);
          }
          x += glyphX(w.w, chars.length, this.family, size) + space;
        }
      });

      // next line, small, under the current one
      const next = lyrics.nextLine(line.start + 1e-3);
      if (next && next.start - line.end < 6) {
        c.font = font(F.archivo(100, 300), 34);
        c.fillStyle = rgba('ash', 0.45 * alpha);
        const nx = centred ? (W - measure(next.text, F.archivo(100, 300), 34)) / 2 : SAFE;
        c.fillText(next.text, nx, top + (rows.length - 1) * lead + size * 0.5 + 48);
      }
    }

    comp.draw(renderer, this.text.upload(), out);
    return { bloom: 0.5, grain: 0.045 };
  }
}

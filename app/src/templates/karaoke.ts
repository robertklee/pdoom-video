// Template: a minimal karaoke plate, the starting point for a new song's scenes (docs/NEW_SONG.md).
// A background pass (flat colour plus a soft glow that breathes with the vocal and the kick) and a
// Layer2D with the current lyric line: it shows dim shortly before it is sung, and each word is lit
// left to right as it is sung (Lyrics.wordProgress). Stateless: every frame is a function of t only,
// so adaptive motion blur and seeking need nothing special. Copy it into scenes/ and grow it into a
// plate, or use it as is to rough out the edit before the real plates exist:
//   E('verse1', 'templates/karaoke', b.verse1, b.chorus1, { params: { lit: 'signal' } })
//
// params (all optional): bg, text, lit: palette keys; dim: opacity of the unsung text (raise it on a
//   light bg: alpha blends in linear light); size: max type size (px); width, weight: Archivo axes;
//   lead: seconds a line shows before it is sung; hold: seconds it stays after; glow: 0..1.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LIN, rgba, type PaletteKey } from '../engine/palette';
import { F, font, fitSize, glyphX, measure } from '../engine/type';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { clamp, smoothstep } from '../engine/util';

/** Title-safe margin (px): no type closer to the frame edge. */
const SAFE = 96;

interface Params { bg: PaletteKey; text: PaletteKey; lit: PaletteKey; dim: number; size: number; width: number; weight: number; lead: number; hold: number; glow: number }
const DEFAULTS: Params = { bg: 'ink', text: 'bone', lit: 'signal', dim: 0.32, size: 120, width: 100, weight: 800, lead: 0.4, hold: 0.6, glow: 0.25 };

export default class KaraokeTemplate extends Scene {
  P: Params = { ...DEFAULTS, ...this.ctx.params };
  layer = new Layer2D();
  bg = new FSPass(/* glsl */ `
    uniform vec3 base; uniform vec3 tint; uniform float k;
    void main() {
      vec2 p = (vUv - 0.5) * vec2(${(W / H).toFixed(4)}, 1.0);
      fragColor = vec4(base + tint * k * exp(-dot(p, p) * 4.0), 1.0);
    }`, { base: { value: new THREE.Vector3() }, tint: { value: new THREE.Vector3() }, k: { value: 0 } });

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const P = this.P, t = f.t;

    (this.bg.u.base!.value as THREE.Vector3).set(...LIN[P.bg]);
    (this.bg.u.tint!.value as THREE.Vector3).set(...LIN[P.lit]);
    this.bg.u.k!.value = P.glow * (0.04 + 0.08 * f.a.vocal + 0.1 * f.a.kick);
    this.bg.render(renderer, out);

    const L = this.layer;
    L.clear();
    const shown = this.pick(lyrics, t);
    if (shown) this.drawLine(L.ctx, shown.line, t, shown.alpha);
    comp.draw(renderer, L.upload(), out);
    return { bloom: 0.5, grain: 0.05 };
  }

  /** The line on screen at t: the one being sung, else the next one (within `lead`), else the last one (within `hold`). */
  private pick(lyrics: Lyrics, t: number): { line: Line; alpha: number } | null {
    const { lead, hold } = this.P;
    const cur = lyrics.lineAt(t);
    if (cur) return { line: cur, alpha: 1 };
    const next = lyrics.nextLine(t);
    if (next && next.start - t < lead) return { line: next, alpha: smoothstep(next.start - lead, next.start, t) };
    const last = lyrics.lastLine(t);
    if (last && t < last.end + hold) return { line: last, alpha: 1 - smoothstep(last.end, last.end + hold, t) };
    return null;
  }

  /** The line centred, on one row or split into two balanced rows when it would get too small. */
  private drawLine(c: CanvasRenderingContext2D, line: Line, t: number, alpha: number) {
    const P = this.P, fam = F.archivo(P.width, P.weight), maxW = W - 2 * SAFE;
    const text = (ws: Word[]) => ws.map((w) => w.w).join(' ');
    let rows: Word[][] = [line.words];
    let size = fitSize(text(line.words), fam, maxW, P.size);
    if (size < P.size * 0.7 && line.words.length > 1) {
      // split at the word boundary that balances the two rows' character counts
      let best = 1, bestD = Infinity;
      for (let i = 1; i < line.words.length; i++) {
        const d = Math.abs(text(line.words.slice(0, i)).length - text(line.words.slice(i)).length);
        if (d < bestD) { bestD = d; best = i; }
      }
      rows = [line.words.slice(0, best), line.words.slice(best)];
      size = Math.min(...rows.map((r) => fitSize(text(r), fam, maxW, P.size)));
    }
    const lh = size * 1.05;
    c.save();
    c.globalAlpha = clamp(alpha);
    c.font = font(fam, size);
    c.textBaseline = 'alphabetic';
    rows.forEach((ws, ri) => {
      const s = text(ws);
      const x0 = (W - measure(s, fam, size)) / 2;
      const y = H / 2 + size * 0.36 + (ri - (rows.length - 1) / 2) * lh;
      // the row is set as one kerned run (dim), then re-drawn in colour clipped to each word's sung part
      c.fillStyle = rgba(P.text, P.dim);
      c.fillText(s, x0, y);
      let ci = 0; // char index of the word in the row
      for (const w of ws) {
        const n = Array.from(w.w).length;
        const p = Lyrics.wordProgress(w, t);
        if (p > 0) {
          const a = glyphX(s, ci, fam, size), b = glyphX(s, ci + n, fam, size);
          c.save();
          c.beginPath();
          c.rect(x0 + a - size * 0.04, y - size, (b - a) * p + size * 0.04, size * 1.4);
          c.clip();
          c.fillStyle = rgba(p < 1 ? P.lit : P.text, 1);
          c.fillText(s, x0, y);
          c.restore();
        }
        ci += n + 1;
      }
    });
    c.restore();
  }

  override dispose() {
    this.bg.mat.dispose();
    this.layer.texture.dispose();
  }
}

// TEMPLATE: ENDCARD — logo, tagline and call to action (the music video's `outro` pattern, as a brand
// end card). The spark flies into the mark's own spark, the mark pops on the beat and the wordmark wipes
// in; the tagline lands as the voice reaches it, the call to action and URL with their line, and the
// film fades out over the last seconds of the music.
//
// params:
//   logo:      asset name of the full lockup (mark + wordmark), outlined SVG
//   markBox?:  the mark's square at the lockup's left, as a share of the lockup's width (default: height/width)
//   sparkAt?:  where the mark's own spark sits in that square (0..1, default [0.74, 0.72])
//   line?:     line id of the tagline; it lands at the end of the line's first key term (the brand name)
//   tagline?:  ui key;  cta?: ui key of the button;  url?: ui key;  ctaLine?: line id the button lands with
//   fade?:     seconds of fade to black at the end (default 1.5)
//   sparkIn?:  frame point the spark flies in from
import type { Frame, PostOverrides } from '../engine/scene';
import { rgba } from '../engine/palette';
import { font } from '../engine/type';
import { clamp, ease, fract, smoothstep } from '../engine/util';
import { Plate, fam, fit, pill, pillH, textW, type P2 } from './_kit';

export default class EndCard extends Plate {
  /** The lockup's box, centred in the content area (a little above the middle). */
  private logoBox() {
    const a = this.area(), u = this.u;
    const name = this.ctx.params.logo ?? 'logo';
    const asp = this.ctx.assets.has(name) ? this.ctx.assets.aspect(name) : 5;
    const w = Math.min(a.w * (this.landscape ? 0.6 : 0.9), 1100 * u), h = w / asp;
    return { x: a.x + (a.w - w) / 2, y: a.y + a.h * 0.36 - h / 2, w, h };
  }

  /** When the mark pops: the first beat after the spark has arrived. */
  private markT() { return this.beatAfter(this.ctx.start + 0.4); }

  protected draw(f: Frame, c: CanvasRenderingContext2D): PostOverrides {
    const t = f.t, u = this.u, p = this.ctx.params, a = this.area();
    const lb = this.logoBox();
    const name = p.logo ?? 'logo';
    const mw = (p.markBox ?? lb.h / lb.w) * lb.w; // the mark's square at the lockup's left
    const tM = this.markT();
    const kM = ease.outBack(clamp((t - tM) / 0.35));
    const wipe = ease.inOutCubic(clamp((t - tM - 0.15) / 0.6));

    if (this.ctx.assets.has(name) && t >= tM) {
      // the mark: pops from its centre
      c.save();
      const cx = lb.x + mw / 2, cy = lb.y + lb.h / 2;
      c.translate(cx, cy);
      c.scale(kM, kM);
      c.translate(-cx, -cy);
      c.beginPath();
      c.rect(lb.x - 4 * u, lb.y - 4 * u, mw + 8 * u, lb.h + 8 * u);
      c.clip();
      this.ctx.assets.draw(c, name, lb.x, lb.y, lb.w, lb.h);
      c.restore();
      // the wordmark: wipes in from behind the mark
      if (wipe > 0) {
        c.save();
        c.beginPath();
        c.rect(lb.x + mw, lb.y - 4 * u, (lb.w - mw) * wipe + 4 * u, lb.h + 8 * u);
        c.clip();
        c.translate((1 - wipe) * -30 * u, 0);
        this.ctx.assets.draw(c, name, lb.x, lb.y, lb.w, lb.h);
        c.restore();
      }
    }

    // the tagline, as the voice reaches it
    let y = lb.y + lb.h + 70 * u;
    if (p.tagline) {
      const tl = p.line ? this.keys(p.line)[0] : null;
      const tT = tl ? tl[tl.length - 1]!.end : p.line ? this.t0(p.line) + 0.6 : tM + 0.8;
      const k = this.enter(t, tT, 0.45);
      const s = fit(c, this.ui(p.tagline), fam.display(700), a.w * 0.9, 64 * u);
      if (k > 0) {
        c.font = font(fam.display(700), s);
        c.fillStyle = rgba('bone', k);
        c.textAlign = 'center';
        c.fillText(this.ui(p.tagline), a.x + a.w / 2, y + s * 0.8 + (1 - k) * 20 * u);
        c.textAlign = 'left';
      }
      y += s * 1.4;
    }

    // the call to action and the URL
    if (p.cta || p.url) {
      const tC = p.ctaLine ? this.t0(p.ctaLine) - 0.1 : tM + 2;
      const k = this.enter(t, tC, 0.4, ease.outBack);
      if (t >= tC) {
        const cs = Math.round(32 * u), us = Math.round(30 * u);
        const cta = p.cta ? this.ui(p.cta) : '', url = p.url ? this.ui(p.url) : '';
        const cw = cta ? textW(c, cta, fam.text(700), cs) + cs * 1.6 : 0;
        const uw = url ? textW(c, url, fam.mono(500), us) : 0;
        const stack = cw + uw + 40 * u > a.w;
        const beat = 1 + 0.03 * Math.pow(1 - fract(f.beat), 6) * smoothstep(tC + 1, tC + 1.5, t);
        c.save();
        c.globalAlpha *= clamp(k);
        const x0 = stack ? a.x + (a.w - cw) / 2 : a.x + (a.w - cw - uw - 40 * u) / 2;
        if (cta) {
          c.save();
          c.translate(x0 + cw / 2, y + pillH(cs) / 2);
          c.scale(beat * (0.9 + 0.1 * k), beat * (0.9 + 0.1 * k));
          pill(c, -cw / 2, -pillH(cs) / 2, cta, cs, { fill: 'signal', family: fam.text(700) });
          c.restore();
        }
        if (url) {
          c.font = font(fam.mono(500), us);
          c.fillStyle = rgba('ember');
          const ux = stack ? a.x + (a.w - uw) / 2 : x0 + cw + 40 * u;
          const uy = stack ? y + pillH(cs) + us * 1.6 : y + pillH(cs) / 2 + us * 0.36;
          c.fillText(url, ux, uy);
        }
        c.restore();
      }
    }

    // the spark flies into the mark's own spark, and settles into it
    const sp = (p.sparkAt as [number, number] | undefined) ?? [0.74, 0.72];
    const home: P2 = { x: lb.x + sp[0] * mw, y: lb.y + sp[1] * lb.h };
    this.spark(t, () => home, { scale: 0.9, intensity: 1 - 0.55 * smoothstep(tM, tM + 0.6, t), fly: 0.4 });
    return { fade: smoothstep(this.ctx.end - (p.fade ?? 1.5), this.ctx.end - 0.05, t) };
  }
}

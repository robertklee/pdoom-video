// Image assets (brand logos, product marks, approved UI imagery): SVG or PNG/JPEG files named in the
// project manifest, loaded before the first frame and drawn into Canvas2D layers at any size. An SVG
// is rasterised at the size it is drawn, so a logo stays sharp at 4K. Use outlined SVGs: text inside
// an SVG image cannot use the page's fonts.
import { SCALE } from './scale';

export interface Asset {
  name: string;
  url: string;
  img: HTMLImageElement;
  /** Intrinsic size (SVG: width/height attributes, else the viewBox). */
  w: number;
  h: number;
  svg: boolean;
}

export interface DrawOpts {
  /** Replace every colour of the image with this one (single-colour marks on dark or light plates). */
  tint?: string;
  alpha?: number;
  /** Where the image sits in the box when the aspect ratios differ (0 = left/top, 0.5 = centre, 1 = right/bottom). */
  ax?: number;
  ay?: number;
}

/** Intrinsic size of an SVG document from its width/height attributes (px) or its viewBox. */
export function svgSize(text: string): { w: number; h: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = (k: string) => new RegExp(`\\s${k}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
  const px = (v?: string) => (v && /^\s*[\d.]+\s*(px)?\s*$/.test(v) ? parseFloat(v) : NaN);
  const w = px(attr('width')), h = px(attr('height'));
  if (w > 0 && h > 0) return { w, h };
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb[2]! > 0 && vb[3]! > 0) return { w: vb[2]!, h: vb[3]! };
  return null;
}

export class Assets {
  private items = new Map<string, Asset>();
  private tinted = new Map<string, HTMLCanvasElement>();

  /** Load every asset of a manifest's `assets` map ({ name: repo-root-relative path }). */
  static async load(map: Record<string, string> = {}): Promise<Assets> {
    const a = new Assets();
    await Promise.all(Object.entries(map).map(async ([name, url]) => a.items.set(name, await loadOne(name, url))));
    return a;
  }

  has(name: string) { return this.items.has(name); }
  names() { return [...this.items.keys()]; }

  /** The asset; throws if the manifest doesn't name it (fail loudly while authoring). */
  get(name: string): Asset {
    const a = this.items.get(name);
    if (!a) throw new Error(`asset not found: ${name} (have: ${this.names().join(', ') || 'none'})`);
    return a;
  }

  /** Width / height. */
  aspect(name: string) { const a = this.get(name); return a.w / a.h; }

  /**
   * Draw an asset fitted inside the box (x, y, w, h) in logical px, keeping its aspect ratio.
   * Returns the rectangle it was drawn into.
   */
  draw(c: CanvasRenderingContext2D, name: string, x: number, y: number, w: number, h: number, o: DrawOpts = {}) {
    const a = this.get(name);
    const k = Math.min(w / a.w, h / a.h);
    const dw = a.w * k, dh = a.h * k;
    const dx = x + (w - dw) * (o.ax ?? 0.5), dy = y + (h - dh) * (o.ay ?? 0.5);
    c.save();
    if (o.alpha !== undefined) c.globalAlpha *= o.alpha;
    c.drawImage(o.tint ? this.tint(a, dw, dh, o.tint) : a.img, dx, dy, dw, dh);
    c.restore();
    return { x: dx, y: dy, w: dw, h: dh };
  }

  /** The image recoloured, rasterised at the physical size it is drawn at (cached). */
  private tint(a: Asset, w: number, h: number, colour: string) {
    const pw = Math.max(1, Math.ceil(w * SCALE)), ph = Math.max(1, Math.ceil(h * SCALE));
    const key = `${a.name}|${pw}x${ph}|${colour}`;
    let cv = this.tinted.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = pw; cv.height = ph;
      const c = cv.getContext('2d')!;
      c.drawImage(a.img, 0, 0, pw, ph);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = colour;
      c.fillRect(0, 0, pw, ph);
      if (this.tinted.size > 64) this.tinted.clear();
      this.tinted.set(key, cv);
    }
    return cv;
  }
}

async function loadOne(name: string, url: string): Promise<Asset> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`asset ${name}: ${url} (HTTP ${r.status})`);
  const svg = /\.svg$/i.test(url) || (r.headers.get('content-type') ?? '').includes('svg');
  let src: string, size: { w: number; h: number } | null = null;
  if (svg) {
    const text = await r.text();
    size = svgSize(text);
    if (!size) throw new Error(`asset ${name}: ${url} has no width/height or viewBox`);
    src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  } else {
    src = URL.createObjectURL(await r.blob());
  }
  const img = new Image();
  img.src = src;
  await img.decode();
  return { name, url, img, w: size?.w ?? img.naturalWidth, h: size?.h ?? img.naturalHeight, svg };
}

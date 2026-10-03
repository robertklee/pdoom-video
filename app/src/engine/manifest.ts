// Project manifests: everything that ties the engine to one film lives in projects/<id>/project.json
// (audio, timing data, timeline module, palette, fonts, post defaults, formats, languages, encode
// presets, loudness targets). This module is pure data and helpers, shared by the app (project.ts),
// the export scripts and the tests; it must not touch the DOM or the file system.

/** Output formats. Scenes lay out in these logical px; `?scale=` multiplies the physical size. */
export const FORMATS = {
  '16:9': { w: 1920, h: 1080, name: 'landscape' },
  '9:16': { w: 1080, h: 1920, name: 'vertical' },
  '1:1': { w: 1080, h: 1080, name: 'square' },
} as const;
export type FormatId = keyof typeof FORMATS;

const FORMAT_ALIASES: Record<string, FormatId> = {
  landscape: '16:9', '16x9': '16:9', wide: '16:9',
  vertical: '9:16', portrait: '9:16', '9x16': '9:16', story: '9:16',
  square: '1:1', '1x1': '1:1',
};

/** '16:9' | '9:16' | '1:1' or an alias (landscape, vertical, square, 16x9 ...); null if unknown. */
export function parseFormat(s: string | null | undefined): FormatId | null {
  if (!s) return null;
  const k = s.trim().toLowerCase();
  if (k in FORMATS) return k as FormatId;
  return FORMAT_ALIASES[k] ?? null;
}

/** File-name-safe format tag: '16x9', '9x16', '1x1'. */
export const formatTag = (f: FormatId) => f.replace(':', 'x');

export interface Language {
  /** BCP 47 code used in URLs, paths ({lang}) and caption files. */
  code: string;
  name: string;
  /** ISO 639-2 code for the subtitle/audio stream metadata in the MP4. */
  iso639_2: string;
}

/** A font role (display, text, mono). Either one of the bundled families or licensed brand files. */
export interface FontRole {
  /** Bundled family (app/public/fonts): Archivo (with `width` in %), Cormorant serif or IBM Plex Mono. */
  builtin?: 'archivo' | 'serif' | 'mono';
  width?: number;
  /** Licensed brand font files by weight, repo-root-relative: { "400": "projects/x/brand/fonts/X-Regular.woff2" }. */
  files?: Record<string, string>;
  /** OpenType features to switch on (Canvas2D has no font-feature-settings), e.g. '"tnum" 1'. */
  features?: string;
}

export interface EncodePreset {
  crf: number;
  /** x264 speed preset. */
  preset: string;
  tune?: string;
  /** Extra -x264-params. */
  x264?: string;
  profile?: string;
  /** H.264 level, or 'auto' (4.2 up to 1080p-sized frames, 5.2 above). */
  level?: string;
  /** Keyframe interval in seconds (players and platforms seek and segment on keyframes). */
  gop?: number;
  audioBitrate: string;
  sampleRate?: number;
}

/** Integrated loudness target for a delivery platform (ffmpeg loudnorm: LUFS, dBTP, LU). */
export interface Loudness { I: number; TP: number; LRA: number }

/** Caption rules: segmentation of the word timings into cues, and the burned-in caption style. */
export interface CaptionRules {
  /** Draw open captions into the frame (silent autoplay). Soft subtitles are exported either way. */
  burnIn?: boolean;
  /** Max characters per caption line. */
  maxChars?: number;
  maxLines?: number;
  /** Min/max time on screen per cue (s). */
  minDur?: number;
  maxDur?: number;
  /** Hold after the last word of a cue (s), unless the next cue starts first. */
  hold?: number;
  /** Palette keys: caption text, highlighted key words, and the plate behind them. */
  text?: string;
  key?: string;
  plate?: string;
}

export interface ProjectManifest {
  id: string;
  title: string;
  /** App module exporting makeTimeline (and optionally makeCounter), relative to app/. */
  timeline: string;
  /** Formats the scenes are laid out for; the first is the default. */
  formats: FormatId[];
  /** Languages (each has its own word timings, voice and mix); the first is the default. */
  languages?: Language[];
  /** Repo-root-relative paths; `{lang}` is replaced by the language code. */
  audio: { mix: string; music?: string; voice?: string };
  /** Timing data, first existing file wins (the first one is the analysis output). */
  data: { lyrics: string[]; audio: string[] };
  /** Overrides for the palette keys (ink, ink2, graphite, ash, bone, signal, ember, blood, acid). */
  palette?: Record<string, string>;
  fonts?: { display?: FontRole; text?: FontRole; mono?: FontRole };
  /** Project defaults for the post-processing parameters (see PostParams). */
  post?: Record<string, number>;
  /** Named image assets (SVG/PNG), repo-root-relative: loaded before the first frame (ctx.assets). */
  assets?: Record<string, string>;
  captions?: CaptionRules;
  encode: { default: string; presets: Record<string, EncodePreset> };
  platforms?: Record<string, Loudness>;
  /** Voice + music mix settings (scripts/mix.ts). */
  mix?: { musicGain?: number; duckThreshold?: number; duckRatio?: number; duckAttack?: number; duckRelease?: number };
  /** Representative stills of plates (the P(doom) outro's rewind montage). */
  plates?: { ids: string[]; times?: string; dir: string };
  /** Analysis settings (read by analysis/common.py only). */
  analysis?: Record<string, unknown>;
}

// The whole video lives in a restrained palette: ink, bone, and one signal colour.
// One rare accent (acid, the shrooms moment) — see docs/TREATMENT.md.
// A project's manifest can recolour every key (a brand palette); the keys and their roles stay.
export const DEFAULT_HEX = {
  ink: '#0A0A0B', // background black (slightly warm)
  ink2: '#151517', // raised black (panels, paper-in-the-dark)
  graphite: '#5E5B57', // dim lines, secondary text
  ash: '#9C978F', // mid grey
  bone: '#EEE9DF', // paper white, primary text
  signal: '#FF4D12', // hazard orange: the spark, the fuse, P(doom)
  ember: '#FF8A3D', // hotter, lighter orange for cores/highlights
  blood: '#C21D0B', // deep red-orange for shadows of signal
  acid: '#D8FF3C', // acid: only for the shrooms moment
} as const;

export type PaletteKey = keyof typeof DEFAULT_HEX;

/** A project's palette (sRGB hex): the defaults with its overrides, validated. */
export function projectPalette(m: Pick<ProjectManifest, 'palette'>): Record<PaletteKey, string> {
  const hex: Record<PaletteKey, string> = { ...DEFAULT_HEX };
  for (const [k, v] of Object.entries(m.palette ?? {})) {
    if (!(k in DEFAULT_HEX)) throw new Error(`project palette: unknown key '${k}' (keys: ${Object.keys(DEFAULT_HEX).join(', ')})`);
    if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`project palette: ${k} must be #rrggbb, got '${v}'`);
    hex[k as PaletteKey] = v;
  }
  return hex;
}

export const DEFAULT_LANGUAGE: Language = { code: 'en', name: 'English', iso639_2: 'eng' };

export function languages(m: ProjectManifest): Language[] {
  return m.languages?.length ? m.languages : [DEFAULT_LANGUAGE];
}

/** The requested language if the project has it, else its default. */
export function pickLanguage(m: ProjectManifest, code: string | null | undefined): Language {
  const ls = languages(m);
  return ls.find((l) => l.code === code) ?? ls[0]!;
}

/** The requested format if the project lays out for it, else null. Without a request: the project default. */
export function pickFormat(m: ProjectManifest, requested: string | null | undefined): FormatId | null {
  if (!requested) return m.formats[0] ?? '16:9';
  const f = parseFormat(requested);
  return f && m.formats.includes(f) ? f : null;
}

/** Substitute {lang} in a manifest path. */
export const withLang = (p: string, lang: string) => p.replaceAll('{lang}', lang);

/** H.264 level for a frame size and rate: 4.2 up to 8704 macroblocks a frame (1080p, 1080x1920), else 5.2. */
export function h264Level(w: number, h: number, fps: number): string {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  if (mbs <= 8704 && mbs * fps <= 522240) return '4.2';
  return '5.2';
}

/** ffmpeg video codec args for a preset (after the colour filter chain). */
export function videoArgs(p: EncodePreset, o: { w: number; h: number; fps: number }): string[] {
  const a = ['-c:v', 'libx264', '-preset', p.preset, '-crf', String(p.crf), '-pix_fmt', 'yuv420p'];
  if (p.tune) a.push('-tune', p.tune);
  if (p.profile) a.push('-profile:v', p.profile);
  if (p.level) a.push('-level:v', p.level === 'auto' ? h264Level(o.w, o.h, o.fps) : p.level);
  if (p.gop) a.push('-g', String(Math.round(p.gop * o.fps)));
  if (p.x264) a.push('-x264-params', p.x264);
  return a;
}

/** ffmpeg audio codec args for a preset. */
export function audioArgs(p: EncodePreset): string[] {
  const a = ['-c:a', 'aac', '-b:a', p.audioBitrate];
  if (p.sampleRate) a.push('-ar', String(p.sampleRate));
  return a;
}

/** loudnorm filter for a platform target; with `measured` (first pass JSON) the second, linear pass. */
export function loudnormFilter(l: Loudness, measured?: Record<string, string>): string {
  const base = `loudnorm=I=${l.I}:TP=${l.TP}:LRA=${l.LRA}`;
  if (!measured) return `${base}:print_format=json`;
  return `${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}` +
    `:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=summary`;
}

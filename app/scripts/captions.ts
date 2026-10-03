#!/usr/bin/env bun
// Caption export: SubRip / WebVTT files from a project's word timings, with its caption rules
// (line breaks, minimum / maximum duration, hold), for accessibility and silent autoplay.
//   bun scripts/captions.ts [--project search] [--lang en|all] [--fmt srt|vtt|both] [--out dir]
//                           [--offset -12.5] [--keys] [--check]
//   --lang all     every language of the project (default: the project's first language)
//   --offset s     shift every cue (e.g. -from of a cut-down clip)
//   --keys         mark the script's key terms in the WebVTT (<b>…</b>)
//   --check        print reading-speed / contrast warnings and exit non-zero if any
// Output: <out>/<project>.<lang>.srt|vtt (default out: ../out/captions).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { captionStyle, checkContrast, toSRT, toVTT, type Cue } from '../src/engine/captions';
import { languages, projectPalette } from '../src/engine/manifest';
import { captionCues, language, loadManifest, ROOT } from './lib';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);

const m = loadManifest(opt('project'));
const langArg = opt('lang');
const langs = langArg === 'all' ? languages(m) : [language(m, langArg)];
const fmt = opt('fmt', 'both')!;
if (!['srt', 'vtt', 'both'].includes(fmt)) throw new Error(`--fmt must be srt, vtt or both (got ${fmt})`);
const out = path.resolve(opt('out', path.join(ROOT, 'out', 'captions'))!);
const offset = Number(opt('offset', '0'));
const MAX_CPS = 20; // reading speed above which a cue is flagged (characters per second)

/** Reading-speed problems of a cue list. */
function readingWarnings(cues: Cue[]): string[] {
  return cues.flatMap((c, i) => {
    const chars = c.rows.join(' ').length;
    const cps = chars / (c.end - c.start);
    return cps > MAX_CPS ? [`cue ${i + 1} (${c.start.toFixed(2)} s) reads at ${cps.toFixed(1)} chars/s (> ${MAX_CPS})`] : [];
  });
}

mkdirSync(out, { recursive: true });
const warnings: string[] = [];
warnings.push(...checkContrast(captionStyle(m.captions ?? {}, projectPalette(m))).map((w) => `burn-in style: ${w}`));
for (const l of langs) {
  const cues = captionCues(m, l.code);
  warnings.push(...readingWarnings(cues).map((w) => `${l.code}: ${w}`));
  const base = path.join(out, `${m.id}.${l.code}`);
  if (fmt !== 'vtt') writeFileSync(`${base}.srt`, toSRT(cues, offset));
  if (fmt !== 'srt') writeFileSync(`${base}.vtt`, toVTT(cues, { offset, markKeys: flag('keys'), lang: l.code }));
  console.log(`${m.id}/${l.code}: ${cues.length} cues -> ${path.relative(process.cwd(), base)}.${fmt === 'both' ? '{srt,vtt}' : fmt}`);
}
for (const w of warnings) console.warn(`warning: ${w}`);
if (flag('check') && warnings.length) process.exit(1);

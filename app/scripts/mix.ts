#!/usr/bin/env bun
// Voice + music mix for projects that keep them on separate tracks (manifest audio.voice / audio.music):
// the music bed sits musicGain dB down and is ducked under speech by a side-chain compressor keyed by the
// voice, then both are summed (no normalisation: delivery loudness is set by render --platform).
//   bun scripts/mix.ts --project search [--lang en|all] [--gain -6] [--threshold 0.03] [--ratio 8]
//                      [--attack 40] [--release 450] [--out file.wav]
// Without a voice track yet (draft edit on estimated timings) it writes the music alone, at musicGain,
// so levels do not jump once the voice arrives. Output: the manifest's audio.mix (48 kHz, 24-bit WAV).
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { languages } from '../src/engine/manifest';
import { language, loadManifest, repoPath, ROOT } from './lib';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const num = (k: string, d: number) => { const v = Number(opt(k, String(d))); if (!Number.isFinite(v)) throw new Error(`--${k} must be a number`); return v; };

const m = loadManifest(opt('project'));
if (!m.audio.music) throw new Error(`project '${m.id}' has no separate music track (audio.music); its mix is ${m.audio.mix}`);
const mx = m.mix ?? {};
const gain = num('gain', mx.musicGain ?? -6);
const threshold = num('threshold', mx.duckThreshold ?? 0.03);
const ratio = num('ratio', mx.duckRatio ?? 8);
const attack = num('attack', mx.duckAttack ?? 40);
const release = num('release', mx.duckRelease ?? 450);
const langArg = opt('lang');
const langs = langArg === 'all' ? languages(m) : [language(m, langArg)];
if (opt('out') && langs.length > 1) throw new Error('--out needs a single --lang');

const music = repoPath(m.audio.music, langs[0]!.code);
if (!existsSync(music)) throw new Error(`no music bed at ${path.relative(ROOT, music)} (licensed track, or analysis/placeholder_bed.py)`);
const rel = (p: string) => path.relative(process.cwd(), p);

for (const l of langs) {
  const voice = m.audio.voice ? repoPath(m.audio.voice, l.code) : null;
  const out = path.resolve(opt('out') ?? repoPath(m.audio.mix, l.code));
  mkdirSync(path.dirname(out), { recursive: true });
  const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  let graph: string;
  const inputs = ['-i', music];
  if (voice && existsSync(voice)) {
    inputs.push('-i', voice);
    graph = `[0:a]${fmt},volume=${gain}dB[m];[1:a]${fmt},asplit=2[v][key];` +
      `[m][key]sidechaincompress=threshold=${threshold}:ratio=${ratio}:attack=${attack}:release=${release}[duck];` +
      `[duck][v]amix=inputs=2:duration=longest:normalize=0[out]`;
  } else {
    console.warn(`warning: no voice track for ${l.code} (${voice ? rel(voice) : 'audio.voice not set'}); writing the music bed alone`);
    graph = `[0:a]${fmt},volume=${gain}dB[out]`;
  }
  const args = ['-y', '-v', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_s24le', '-ar', '48000', out];
  const p = Bun.spawnSync(['ffmpeg', ...args], { stdout: 'inherit', stderr: 'inherit' });
  if (p.exitCode !== 0) throw new Error(`ffmpeg failed (${p.exitCode})`);
  console.log(`${m.id}/${l.code}: ${rel(out)} (music ${gain} dB${voice && existsSync(voice) ? `, ducked ${ratio}:1 under the voice` : ''})`);
}

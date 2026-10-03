#!/usr/bin/env bun
// Offline renderer. Drives the app in headless Chrome (?export=1) and either
//   stills:  bun scripts/render.ts stills --t 1.5,23,40.2 [--only id1,id2] [--out dir]
//   sheet:   bun scripts/render.ts sheet --from 20 --to 35 [--n 12] [--cols 4] [--only ids] [--out file.png]   (or --times a,b,c | --cuts)
//   plates:  bun scripts/render.ts plates   (renders one representative JPEG per plate into public/plates/ (used by the outro's rewind), times from plates.json or entry midpoints)
//   perf:    bun scripts/render.ts perf --from 20 --to 25 [--only ids] [--samples 1] [--shutter 0.5]   (avg ms per frame incl. GPU sync and the export's pixel readback)
//   video:   bun scripts/render.ts video [--from 0] [--to 156.65] [--fps 60] [--crf 16] [--x264 aq-mode=3] [--samples 1] [--shutter 0.5] [--out ../out/pdoom.mp4] [--noaudio]
//            --samples N averages N sub-frames per frame over shutter×(1/fps): motion blur + temporal AA;
//            --samples auto picks the count per frame (4, 12, 36, 108 or 324, see Engine.render)
//            --encode <preset> picks an encode preset of the project (default: its manifest's encode.default;
//            --crf/--preset/--x264 override single settings), --platform <name> normalises the loudness to a
//            delivery target of the manifest (two-pass loudnorm), --srt [en,de] muxes caption tracks (mov_text)
//   --project <id> (all modes): the film to render (projects/<id>/project.json, default pdoom);
//            --lang <code> its language, --format 16:9|9:16|1:1 its output format (where the project is laid
//            out for it), --burn on|off burned-in captions (default: the manifest's captions.burnIn)
//   --scale N (all modes): render at N× the format's layout (--scale 2 = true 3840x2160); stills are then saved
//            full-res from the pixel buffer, videos are encoded at the physical size.
// Uses the Vite dev server at --url (default http://localhost:5173); starts a private one if unreachable.
import { chromium, type Page } from 'playwright-core';
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FORMATS, audioArgs, formatTag, loudnormFilter, pickFormat, videoArgs, type EncodePreset } from '../src/engine/manifest';
import { toSRT } from '../src/engine/captions';
import { captionCues, language, loadManifest, repoPath } from './lib';

const argv = process.argv.slice(2);
const mode = argv[0] ?? 'stills';
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
const APP = path.resolve(import.meta.dir, '..');
const SCALE = Math.max(1, Math.round(+opt('scale', '1')!));
const PROJECT = loadManifest(opt('project'));
const LANG = language(PROJECT, opt('lang'));
const FORMAT = pickFormat(PROJECT, opt('format'));
if (!FORMAT) throw new Error(`project '${PROJECT.id}' is not laid out for format '${opt('format')}' (formats: ${PROJECT.formats.join(', ')})`);
const LW = FORMATS[FORMAT].w, LH = FORMATS[FORMAT].h; // logical canvas
const OW = LW * SCALE, OH = LH * SCALE; // output size
const BURN = opt('burn');
if (BURN && BURN !== 'on' && BURN !== 'off') throw new Error('--burn takes on or off');
// --samples N (fixed) or --samples auto [--min-samples 4] [--max-samples 324] [--tol 3] (adaptive, see Engine.render)
const SAMPLES = opt('samples', '1') === 'auto'
  ? { min: +opt('min-samples', '4')!, max: +opt('max-samples', '324')!, tol: +opt('tol', '3')! }
  : +opt('samples', '1')!;
const hist = (h: Record<string, number>) => Object.entries(h).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}:${v}`).join(' ');
const ROOT = path.resolve(APP, '..');

async function reachable(url: string) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

async function ensureServer(): Promise<{ url: string; stop: () => void }> {
  const url = opt('url', 'http://localhost:5173')!;
  if (await reachable(url)) return { url, stop: () => {} };
  const port = 5300 + Math.floor(Math.random() * 500);
  // no live reload: a file saved mid-render must not reload the page
  const proc = Bun.spawn(['bunx', 'vite', '--port', String(port), '--strictPort'], { cwd: APP, stdout: 'ignore', stderr: 'ignore', env: { ...process.env, PDOOM_NO_HMR: '1' } });
  const u = `http://localhost:${port}`;
  for (let i = 0; i < 100 && !(await reachable(u)); i++) await Bun.sleep(100);
  return { url: u, stop: () => proc.kill() };
}

async function openPage(url: string) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !flag('headed'),
    args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const page = await browser.newPage({ viewport: { width: LW, height: LH }, deviceScaleFactor: 1 });
  const logs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const only = opt('only');
  const q = new URLSearchParams({ export: '1' });
  if (PROJECT.id !== 'pdoom') q.set('project', PROJECT.id);
  if (opt('lang')) q.set('lang', LANG.code);
  if (opt('format')) q.set('format', FORMAT!);
  if (BURN) q.set('captions', BURN === 'on' ? '1' : '0');
  if (only) q.set('only', only);
  if (SCALE !== 1) q.set('scale', String(SCALE));
  await page.goto(`${url}/?${q}`);
  await page.waitForFunction(() => (window as any).__pdoom?.ready || (window as any).__pdoom?.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => (window as any).__pdoom.error);
  if (err) throw new Error(`app failed to boot:\n${err}\n${logs.join('\n')}`);
  const size: [number, number] = await page.evaluate(() => [(window as any).__pdoom.width ?? 1920, (window as any).__pdoom.height ?? 1080]);
  if (size[0] !== OW || size[1] !== OH) throw new Error(`app renders ${size[0]}x${size[1]}, expected ${OW}x${OH} (--format ${FORMAT} --scale ${SCALE})`);
  const sceneErrors: string[] = await page.evaluate(() => (window as any).__pdoom.errors);
  if (sceneErrors.length) console.error('SCENE ERRORS:\n' + sceneErrors.join('\n'));
  return { browser, page, logs };
}

async function stills(page: Page, times: number[], outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const t of times) {
    const k: number = await page.evaluate(([t, s, sh]) => (window as any).__pdoom.still(t, s, sh), [t, SAMPLES, +opt('shutter', '0.5')!] as const);
    const f = path.join(outDir, `f_${t.toFixed(2).padStart(7, '0')}.png`);
    if (typeof SAMPLES !== 'number') console.log(`t=${t}: ${k} sub-frames`);
    // at scale > 1 the canvas is shown downscaled on the page: save the full-res pixel buffer instead
    if (SCALE !== 1) await Bun.write(f, Buffer.from(await page.evaluate(() => (window as any).__pdoom.png()), 'base64'));
    else await page.screenshot({ path: f, clip: { x: 0, y: 0, width: LW, height: LH } });
    files.push(f);
  }
  return files;
}

async function sheet(page: Page, times: number[], cols: number, out: string) {
  const dataUrl: string = await page.evaluate(async ({ times, cols, cw, ch }) => {
    const P = (window as any).__pdoom;
    const pad = 4, lab = 18;
    const rows = Math.ceil(times.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * (cw + pad) + pad; cv.height = rows * (ch + lab + pad) + pad;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height);
    const src = document.getElementById('c') as HTMLCanvasElement;
    times.forEach((t: number, i: number) => {
      P.still(t);
      const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + lab + pad);
      c.drawImage(src, x, y + lab, cw, ch);
      c.fillStyle = '#ddd'; c.font = '13px monospace'; c.fillText(`${t.toFixed(2)}s`, x + 2, y + 13);
    });
    return cv.toDataURL('image/png');
  }, { times, cols, cw: LW / 4, ch: LH / 4 }); // quarter-size thumbnails (480x270 at 16:9)
  mkdirSync(path.dirname(out), { recursive: true });
  await Bun.write(out, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

/** The encode preset: the project's (--encode, default its manifest's), with --crf/--preset/--x264 overrides. */
function encodePreset(): EncodePreset {
  const name = opt('encode', PROJECT.encode.default)!;
  const p = PROJECT.encode.presets[name];
  if (!p) throw new Error(`project '${PROJECT.id}' has no encode preset '${name}' (have: ${Object.keys(PROJECT.encode.presets).join(', ')})`);
  return { ...p, ...(opt('crf') ? { crf: +opt('crf')! } : {}), ...(opt('preset') ? { preset: opt('preset')! } : {}), ...(opt('x264') ? { x264: opt('x264')! } : {}) };
}

/** First loudnorm pass over the audio segment: its measured loudness (JSON from ffmpeg's stderr). */
async function measureLoudness(audio: string, from: number, to: number, filter: string): Promise<Record<string, string>> {
  const p = Bun.spawn(['ffmpeg', '-hide_banner', '-nostats', '-ss', String(from), '-t', String(to - from), '-i', audio, '-af', filter, '-f', 'null', '-'], { stdout: 'ignore', stderr: 'pipe' });
  const err = await new Response(p.stderr).text();
  await p.exited;
  const j = /\{[^{}]*"input_i"[^{}]*\}/.exec(err)?.[0];
  if (!j) throw new Error(`loudness measurement failed:\n${err.slice(-2000)}`);
  return JSON.parse(j);
}

/** Caption tracks to mux (--srt [langs]): SRT files for the rendered range, one per language. */
function subtitleTracks(from: number, to: number) {
  if (!flag('srt')) return [];
  const v = opt('srt');
  const codes = v && !v.startsWith('--') ? v.split(',') : [LANG.code];
  const dir = path.join(tmpdir(), `render-srt-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return codes.map((code) => {
    const l = language(PROJECT, code);
    const cues = captionCues(PROJECT, l.code).filter((c) => c.end > from && c.start < to);
    const f = path.join(dir, `${PROJECT.id}.${l.code}.srt`);
    writeFileSync(f, toSRT(cues, -from));
    return { file: f, lang: l, dir };
  });
}

async function video(page: Page, from: number, to: number, fps: number, out: string) {
  mkdirSync(path.dirname(out), { recursive: true });
  const preset = encodePreset();
  const audio = repoPath(PROJECT.audio.mix, LANG.code);
  const withAudio = !flag('noaudio');
  if (withAudio && !existsSync(audio)) throw new Error(`no audio at ${path.relative(ROOT, audio)} (mix it with scripts/mix.ts, or render --noaudio)`);
  const platform = opt('platform');
  const loud = platform ? PROJECT.platforms?.[platform] : undefined;
  if (platform && !loud) throw new Error(`project '${PROJECT.id}' has no platform '${platform}' (have: ${Object.keys(PROJECT.platforms ?? {}).join(', ') || 'none'})`);
  if (loud && !withAudio) throw new Error('--platform normalises the audio: drop --noaudio');
  const subs = subtitleTracks(from, to);
  const args = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${OW}x${OH}`, '-r', String(fps), '-i', 'pipe:0'];
  if (withAudio) args.push('-ss', String(from), '-t', String(to - from), '-i', audio);
  for (const s of subs) args.push('-i', s.file);
  // Frames are sRGB (toSRGB in the final pass): convert with the BT.709 matrix and tag the stream,
  // otherwise ffmpeg converts with BT.601 while players and YouTube decode untagged HD as BT.709.
  // scale tags the matrix and range; primaries and transfer need setparams (the -color_* output flags don't reach the stream).
  args.push('-vf', 'vflip,scale=out_color_matrix=bt709,setparams=color_primaries=bt709:color_trc=bt709', ...videoArgs(preset, { w: OW, h: OH, fps }));
  if (withAudio) {
    if (loud) {
      const measured = await measureLoudness(audio, from, to, loudnormFilter(loud));
      console.log(`loudness ${platform}: measured ${measured.input_i} LUFS, ${measured.input_tp} dBTP -> ${loud.I} LUFS, ${loud.TP} dBTP`);
      // (loudnorm resamples to 192 kHz internally: the output rate must be set)
      args.push('-af', loudnormFilter(loud, measured), ...audioArgs({ sampleRate: 48000, ...preset }));
    } else args.push(...audioArgs(preset));
    args.push('-shortest');
  }
  if (subs.length) {
    args.push('-map', '0:v');
    if (withAudio) args.push('-map', '1:a');
    const s0 = withAudio ? 2 : 1;
    subs.forEach((s, i) => args.push('-map', `${s0 + i}:s`));
    args.push('-c:s', 'mov_text');
    subs.forEach((s, i) => args.push(`-metadata:s:s:${i}`, `language=${s.lang.iso639_2}`, `-metadata:s:s:${i}`, `title=${s.lang.name}`));
  }
  args.push('-movflags', '+faststart', out);
  const ff = Bun.spawn(args, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
  let frames = 0;
  const total = Math.round(to * fps) - Math.round(from * fps);
  const t0 = performance.now();
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response('ws only', { status: 400 }); },
    websocket: {
      maxPayloadLength: Math.max(64 * 1024 * 1024, OW * OH * 4 + 1024),
      async message(ws, msg) {
        ff.stdin.write(msg as Uint8Array);
        await ff.stdin.flush();
        frames++;
        ws.send(String(frames)); // ack: the page keeps at most a few frames ahead of ffmpeg (bounded memory at 4K)
        if (frames % 60 === 0 || frames === total) {
          const el = (performance.now() - t0) / 1000;
          process.stdout.write(`\r${frames}/${total} frames  ${(frames / el).toFixed(1)} fps  eta ${((total - frames) / (frames / el)).toFixed(0)}s   `);
        }
      },
    },
  });
  const used: Record<string, number> = await page.evaluate((o) => (window as any).__pdoom.stream(o), { from, to, fps, ws: `ws://localhost:${server.port}`, samples: SAMPLES, shutter: +opt('shutter', '0.5')!, inflight: 4 });
  // wait for all frames to arrive
  while (frames < total) await Bun.sleep(20);
  ff.stdin.end();
  await ff.exited;
  server.stop();
  if (subs.length) rmSync(subs[0]!.dir, { recursive: true, force: true });
  console.log(`\nwrote ${out} (${frames} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`sub-frames per frame (count:frames): ${hist(used)}`);
}

const { url, stop } = await ensureServer();
const { browser, page, logs } = await openPage(url);
try {
  if (mode === 'gpu') {
    console.log(await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }));
  } else if (mode === 'stills') {
    const times = (opt('t') ?? '0').split(',').map(Number);
    const files = await stills(page, times, opt('out', path.join(ROOT, 'out/stills'))!);
    console.log(files.join('\n'));
  } else if (mode === 'sheet') {
    const from = +opt('from', '0')!, to = +opt('to', '10')!, n = +opt('n', '12')!;
    let times = Array.from({ length: n }, (_, i) => from + ((to - from) * i) / Math.max(1, n - 1));
    if (opt('times')) times = opt('times')!.split(',').map(Number);
    if (flag('cuts')) {
      // 4 frames around every timeline boundary: 2 frames before, 2 after
      const tl: { id: string; start: number }[] = await page.evaluate(() => (window as any).__pdoom.timeline);
      times = tl.slice(1).flatMap((e) => [e.start - 0.1, e.start - 1 / 60, e.start + 1 / 60, e.start + 0.1]);
    }
    const out = opt('out', path.join(ROOT, `out/sheets/sheet_${from}-${to}.png`))!;
    await sheet(page, times, +opt('cols', '4')!, out);
    console.log(out);
  } else if (mode === 'plates') {
    const tl: { id: string; start: number; end: number }[] = await page.evaluate(() => (window as any).__pdoom.timeline);
    if (!PROJECT.plates) throw new Error(`project '${PROJECT.id}' has no plates (manifest: plates.ids, plates.dir)`);
    const figs = PROJECT.plates.ids;
    const times = PROJECT.plates.times ? path.join(ROOT, PROJECT.plates.times) : null;
    const overrides: Record<string, number> = times && existsSync(times) ? await Bun.file(times).json() : {};
    const dir = path.join(ROOT, PROJECT.plates.dir);
    mkdirSync(dir, { recursive: true });
    await page.evaluate(() => { (window as any).__pdoom.engine.hudOff = true; });
    for (let i = 0; i < figs.length; i++) {
      const e = tl.find((x) => x.id === figs[i]);
      if (!e) continue;
      const t = overrides[figs[i]!] ?? (e.start + e.end) / 2;
      await page.evaluate((t) => (window as any).__pdoom.still(t, 4, 0.2), t);
      const f = path.join(dir, `fig${String(i + 1).padStart(2, '0')}.jpg`);
      await page.screenshot({ path: f, type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: LW, height: LH } });
      console.log(f, t.toFixed(2));
    }
  } else if (mode === 'perf') {
    const from = +opt('from', '0')!, to = +opt('to', '5')!;
    const r = await page.evaluate(async ({ from, to, samples, shutter }) => {
      const P = (window as any).__pdoom;
      const ms: number[] = [];
      const buf = new Uint8Array(P.width * P.height * 4);
      P.still(from);
      const used: Record<number, number> = {};
      for (let t = from; t < to; t += 1 / 60) {
        const a = performance.now();
        const k = P.engine.render(t, 1 / 60, false, samples, shutter);
        used[k] = (used[k] ?? 0) + 1;
        await P.engine.readPixelsAsync(buf);
        ms.push(performance.now() - a);
      }
      ms.sort((a, b) => a - b);
      return { n: ms.length, avg: ms.reduce((a, b) => a + b, 0) / ms.length, p50: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1], used };
    }, { from, to, samples: SAMPLES, shutter: +opt('shutter', '0.5')! });
    console.log(`frames ${r.n}  avg ${r.avg.toFixed(1)}ms  p50 ${r.p50.toFixed(1)}  p95 ${r.p95.toFixed(1)}  max ${r.max.toFixed(1)}  sub-frames ${hist(r.used)}`);
  } else if (mode === 'video') {
    const dur: number = await page.evaluate(() => (window as any).__pdoom.duration);
    // out/pdoom.mp4; projects with languages or several formats: out/<id>.<lang>.<16x9>.mp4
    const name = [PROJECT.id, PROJECT.languages ? LANG.code : '', PROJECT.formats.length > 1 ? formatTag(FORMAT) : ''].filter(Boolean).join('.');
    await video(page, +opt('from', '0')!, +opt('to', String(dur))!, +opt('fps', '60')!, path.resolve(opt('out', path.join(ROOT, `out/${name}.mp4`))!));
  }
  if (logs.length) console.error('BROWSER LOG:\n' + logs.slice(0, 40).join('\n'));
} finally {
  await browser.close();
  stop();
}

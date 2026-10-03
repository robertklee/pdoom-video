import { defineConfig, normalizePath, type Plugin } from 'vite';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { approxOf, loadSong, REPO_ROOT } from './song';

// The active song (SONG=..., see song.ts). Restart the dev server after switching songs.
const song = loadSong();
const cfg = song.config;

// Files the app may fetch, served under /song/<path in the config>: the audio and the timing data
// (each with its .approx.json fallback). Nothing else in the song folder is exposed.
const files = new Map<string, string>();
for (const rel of [cfg.audio, cfg.lyrics, approxOf(cfg.lyrics), cfg.audioData, approxOf(cfg.audioData)]) {
  files.set(`/song/${normalizePath(rel)}`, song.abs(rel));
}

// Git can check out directory symlinks as plain files on Windows. Serve the song's files through
// Vite and copy them into builds without using symlinks.
function songAssets(): Plugin {
  return {
    name: 'song-assets',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        let p = '';
        try { p = decodeURIComponent((req.url ?? '').split('?')[0]!); } catch { /* malformed: not ours */ }
        const f = files.get(p);
        if (f && existsSync(f)) req.url = `/@fs/${encodeURI(normalizePath(f))}`;
        next();
      });
    },
    writeBundle(options) {
      if (!options.dir) return;
      for (const [url, f] of files) {
        if (!existsSync(f)) continue;
        const out = path.join(options.dir, url);
        mkdirSync(path.dirname(out), { recursive: true });
        cpSync(f, out);
      }
    },
  };
}

const url = (rel: string) => `song/${normalizePath(rel)}`;

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [songAssets()],
  define: {
    __SONG__: JSON.stringify({
      id: cfg.id,
      title: cfg.title,
      timeline: cfg.timeline ?? 'starter',
      audio: url(cfg.audio),
      lyrics: [url(cfg.lyrics), url(approxOf(cfg.lyrics))],
      audioData: [url(cfg.audioData), url(approxOf(cfg.audioData))],
    }),
  },
  // PDOOM_NO_HMR=1: no live reload (export renders must not reload mid-run when a file changes)
  server: { port: 5173, strictPort: false, hmr: process.env.PDOOM_NO_HMR ? false : undefined, fs: { allow: [REPO_ROOT, song.dir] } },
  resolve: { alias: { '@root': REPO_ROOT } },
  build: { target: 'esnext', assetsInlineLimit: 0 },
});

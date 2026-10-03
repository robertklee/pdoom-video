import { defineConfig, normalizePath, type Plugin } from 'vite';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

/** The song's audio file from song.json (repo-root relative; must stay inside the repo). */
function songAudio(): string {
  const { audio } = JSON.parse(readFileSync(path.join(repoRoot, 'song.json'), 'utf8')) as { audio?: unknown };
  const rel = typeof audio === 'string' ? path.posix.normalize(audio.replaceAll('\\', '/')) : '';
  if (!rel || path.posix.isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error(`song.json: "audio" must be a path inside the repo, got ${JSON.stringify(audio)}`);
  return rel;
}
const audioFile = songAudio();
const dataDir = 'data';

// Git can check out directory symlinks as plain files on Windows. Serve the repo's data/ and the
// song's audio file through Vite and copy them into builds without using symlinks.
function repoAssets(): Plugin {
  const isAsset = (url: string) => {
    let p: string;
    try { p = decodeURIComponent(url.split(/[?#]/)[0]!); } catch { return false; }
    return p.startsWith(`/${dataDir}/`) || p === `/${audioFile}`;
  };
  return {
    name: 'repo-assets',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && isAsset(req.url)) {
          req.url = `/@fs/${encodeURI(normalizePath(repoRoot))}${req.url}`;
        }
        next();
      });
    },
    writeBundle(options) {
      if (!options.dir) return;
      cpSync(path.join(repoRoot, dataDir), path.join(options.dir, dataDir), { recursive: true });
      mkdirSync(path.dirname(path.join(options.dir, audioFile)), { recursive: true });
      cpSync(path.join(repoRoot, audioFile), path.join(options.dir, audioFile));
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [repoAssets()],
  // NO_HMR=1: no live reload (export renders must not reload mid-run when a file changes)
  server: { port: 5173, strictPort: false, hmr: process.env.NO_HMR ? false : undefined, fs: { allow: [repoRoot] } },
  resolve: { alias: { '@root': repoRoot } },
  build: { target: 'esnext', assetsInlineLimit: 0 },
});

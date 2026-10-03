// Project plumbing for the bun scripts (render, captions, mix): manifests, language-specific paths and
// timing data read from the repository, without the browser.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Lyrics } from '../src/engine/lyrics';
import { buildCues, type Cue } from '../src/engine/captions';
import { pickLanguage, withLang, type Language, type ProjectManifest } from '../src/engine/manifest';

export const APP = path.resolve(import.meta.dir, '..');
export const ROOT = path.resolve(APP, '..');
export const DEFAULT_PROJECT = 'pdoom';

/** Ids of the projects in projects/. */
export function projectIds(): string[] {
  const dir = path.join(ROOT, 'projects');
  return existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(path.join(dir, d, 'project.json'))).sort() : [];
}

export function loadManifest(id = DEFAULT_PROJECT): ProjectManifest {
  const f = path.join(ROOT, 'projects', id, 'project.json');
  if (!existsSync(f)) throw new Error(`unknown project '${id}' (have: ${projectIds().join(', ')})`);
  return JSON.parse(readFileSync(f, 'utf8')) as ProjectManifest;
}

/** The language a script asked for (--lang), checked against the project. */
export function language(m: ProjectManifest, code?: string): Language {
  const l = pickLanguage(m, code);
  if (code && l.code !== code) throw new Error(`project '${m.id}' has no language '${code}' (have: ${(m.languages ?? []).map((x) => x.code).join(', ') || 'en'})`);
  return l;
}

/** Absolute path of a manifest path ({lang} substituted). */
export const repoPath = (p: string, lang: string) => path.join(ROOT, withLang(p, lang));

/** The project's word timings for a language (the first data file that exists). */
export function loadLyrics(m: ProjectManifest, lang: string): Lyrics {
  for (const p of m.data.lyrics) {
    const f = repoPath(p, lang);
    if (existsSync(f)) return new Lyrics(JSON.parse(readFileSync(f, 'utf8')));
  }
  throw new Error(`no timing data for ${m.id}/${lang} (${m.data.lyrics.map((p) => withLang(p, lang)).join(', ')})`);
}

/** Caption cues of a language with the project's caption rules. */
export function captionCues(m: ProjectManifest, lang: string): Cue[] {
  return buildCues(loadLyrics(m, lang), m.captions ?? {});
}

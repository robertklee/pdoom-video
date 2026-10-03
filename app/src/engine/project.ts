// The project being rendered: which film (projects/<id>/project.json), in which language and output
// format. Read once from the page URL (?project=, ?lang=, ?format=) so every module (palette, canvas
// size, fonts, data, timeline) sees the same one; the default is the P(doom) music video in 16:9.
import { FORMATS, pickFormat, pickLanguage, withLang, type FormatId, type Language, type ProjectManifest } from './manifest';

const found = import.meta.glob<ProjectManifest>('../../../projects/*/project.json', { eager: true, import: 'default' });
/** Every project in the repository, by id. */
export const PROJECTS: Record<string, ProjectManifest> = Object.fromEntries(Object.values(found).map((m) => [m.id, m]));
export const DEFAULT_PROJECT = 'pdoom';

const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
const problems: string[] = [];

const requested = params.get('project') ?? DEFAULT_PROJECT;
if (!PROJECTS[requested]) problems.push(`unknown project '${requested}' (have: ${Object.keys(PROJECTS).join(', ')})`);
/** The project manifest. */
export const PROJECT: ProjectManifest = PROJECTS[requested] ?? PROJECTS[DEFAULT_PROJECT]!;

const langParam = params.get('lang');
/** Language of the voice/lyrics, captions and on-screen UI strings. */
export const LANG: Language = pickLanguage(PROJECT, langParam);
if (langParam && LANG.code !== langParam) problems.push(`project '${PROJECT.id}' has no language '${langParam}'`);

const fmt = pickFormat(PROJECT, params.get('format'));
if (!fmt) problems.push(`project '${PROJECT.id}' is not laid out for format '${params.get('format')}' (formats: ${PROJECT.formats.join(', ')})`);
/** Output format: the logical canvas size scenes lay out in. */
export const FORMAT: FormatId = fmt ?? PROJECT.formats[0] ?? '16:9';
export const FORMAT_SIZE = FORMATS[FORMAT];

/** Errors in the URL's project selection (unknown project, language or format); the app refuses to boot. */
export const PROJECT_ERRORS: readonly string[] = problems;

/**
 * Burned-in captions: the manifest's captions.burnIn, overridden by ?captions=0 / ?captions=1 (a clean
 * master for platforms that take a caption file, or open captions for silent autoplay).
 */
export const BURN_IN: boolean = params.has('captions') ? params.get('captions') !== '0' : !!PROJECT.captions?.burnIn;

/** Asset URLs of the project for the selected language (repo-root-relative, served by Vite). */
export const PATHS = {
  mix: withLang(PROJECT.audio.mix, LANG.code),
  lyrics: PROJECT.data.lyrics.map((p) => withLang(p, LANG.code)),
  audio: PROJECT.data.audio.map((p) => withLang(p, LANG.code)),
};

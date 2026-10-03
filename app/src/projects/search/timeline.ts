// The edit of the Acme Search launch film. Every boundary is a script line id snapped to the music bed's
// beat grid (never a time or English text), so a re-recorded voice, a revised script or another language
// re-times the film without a re-edit. The plates are the parametric templates of src/templates; their
// strings come from the script's `ui` table, so each language renders its own film.
import type { TimelineEntry } from '../../engine/engine';
import type { SceneClass } from '../../engine/scene';
import type { Lyrics } from '../../engine/lyrics';
import type { AudioData } from '../../engine/audio';
import { edit } from '../../engine/edit';

const modules = import.meta.glob<{ default: SceneClass }>('../../templates/*.ts');
const template = (name: string) => () => {
  const m = modules[`../../templates/${name}.ts`];
  return m ? m() : Promise.reject(new Error(`template not found: templates/${name}.ts`));
};

/** The result cards, in ranked order (ui keys card.N.title / card.N.meta). */
const CARDS = ['card.1', 'card.2', 'card.3', 'card.4'];

/**
 * Where the spark crosses each cut (frame-relative): one plate's sparkOut is the next one's sparkIn,
 * so the brand's spark travels unbroken through the film.
 */
const HANDOFF = {
  query: [0.5, 0.4],
  results: [0.6, 0.14],
  semantic: [0.5, 0.14],
  speed: [0.5, 0.3],
  proof: [0.5, 0.26],
  end: [0.5, 0.36],
} as const;

export function makeTimeline(ly: Lyrics, au: AudioData): TimelineEntry[] {
  const { cut } = edit(ly, au);
  const b = {
    query: cut('query.1'),
    results: cut('results.1'),
    filters: cut('features.filters'),
    semantic: cut('features.semantic'),
    speed: cut('features.speed'),
    proof: cut('proof.1'),
    end: cut('end.1'),
    out: au.duration,
  };
  const E = (id: string, name: string, start: number, end: number, params: Record<string, unknown>): TimelineEntry =>
    ({ id, load: template(name), start, end, params });

  return [
    E('problem', 'scatter', 0, b.query, {
      items: ['frag.doc', 'frag.chat', 'frag.ticket', 'frag.mail', 'frag.sheet', 'frag.wiki'],
      pop: 'problem.1',
      search: { line: 'problem.2', query: 'search.bad', verdicts: ['search.none', 'search.many'] },
      sparkOut: HANDOFF.query,
    }),
    E('query', 'typed', b.query, b.results, {
      intro: 'query.1', line: 'query.2', text: 'query', placeholder: 'placeholder',
      tags: ['chip.type', 'chip.owner'],
      sparkIn: HANDOFF.query, sparkOut: HANDOFF.results,
    }),
    E('results', 'cards', b.results, b.filters, {
      mode: 'rank', line: 'results.1', query: 'query', cards: CARDS, order0: [2, 0, 3, 1],
      sparkIn: HANDOFF.results,
    }),
    E('filters', 'cards', b.filters, b.semantic, {
      mode: 'filter', line: 'features.filters', query: 'query', cards: CARDS,
      chips: ['chip.owner', 'chip.date', 'chip.type'], keep: [0, 1, 3],
      sparkOut: HANDOFF.semantic,
    }),
    E('semantic', 'cards', b.semantic, b.speed, {
      mode: 'semantic', line: 'features.semantic', query: 'sem.query', cards: CARDS,
      terms: ['sem.1', 'sem.2', 'sem.3'], match: [2, 1, -1, 0],
      sparkIn: HANDOFF.semantic, sparkOut: HANDOFF.speed,
    }),
    E('speed', 'counter', b.speed, b.proof, {
      items: [{ line: 'features.speed', from: 4, to: 0.4, decimals: 1, unit: '=s', label: 'speed.label', bars: [{ v: 1, label: 'bar.before' }, { v: 0.1, label: 'bar.after' }] }],
      sparkIn: HANDOFF.speed, sparkOut: HANDOFF.proof,
    }),
    E('proof', 'counter', b.proof, b.end, {
      items: [
        { line: 'proof.1', from: 1, to: 3, unit: '=×', label: 'proof.1.label' },
        { line: 'proof.2', from: 0, to: 5, unit: 'unit.hours', label: 'proof.2.label', blocks: 5 },
      ],
      note: 'proof.note',
      sparkIn: HANDOFF.proof, sparkOut: HANDOFF.end,
    }),
    E('end', 'endcard', b.end, b.out, {
      logo: 'logo', line: 'end.1', tagline: 'tagline', cta: 'cta', url: 'url', ctaLine: 'end.2', fade: 2,
      sparkIn: HANDOFF.end,
    }),
  ];
}

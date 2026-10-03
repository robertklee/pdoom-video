// The edit: which scene plays when. One module per song in src/timelines/<name>.ts, picked by the
// song config's "timeline" (see song.json): `pdoom` is the P(doom) video, `starter` a generic
// karaoke edit for any song.
import type { TimelineEntry } from './engine/engine';
import type { Lyrics } from './engine/lyrics';
import type { AudioData } from './engine/audio';
import { SONG } from './song';

type MakeTimeline = (ly: Lyrics, au: AudioData) => TimelineEntry[];
const timelines = import.meta.glob<{ makeTimeline: MakeTimeline }>(['./timelines/*.ts', '!./timelines/_*.ts'], { eager: true });

export function makeTimeline(ly: Lyrics, au: AudioData): TimelineEntry[] {
  const m = timelines[`./timelines/${SONG.timeline}.ts`];
  if (!m) throw new Error(`timeline not found: src/timelines/${SONG.timeline}.ts (song.json "timeline")`);
  return m.makeTimeline(ly, au);
}

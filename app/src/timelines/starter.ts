// Starter edit for a new song: one `karaoke` entry per analysed section (song.json "timeline": "starter").
// Cuts sit on the section starts (analyze.py and bootstrap.py put them on downbeats), snapped to the
// beat grid. Copy this file to src/timelines/<song>.ts and swap entries for your own scenes, plate by
// plate; anchor new cuts to lyric lines (`ly.get('...')`) as src/timelines/pdoom.ts does.
import type { TimelineEntry } from '../engine/engine';
import type { Lyrics } from '../engine/lyrics';
import type { AudioData } from '../engine/audio';
import { scene } from './_scene';

export function makeTimeline(_ly: Lyrics, au: AudioData): TimelineEntry[] {
  const end = au.duration;
  const snap = (t: number) => au.timeOfBeat(Math.round(au.beatAt(t)));
  const starts = au.sections
    .map((s) => ({ name: s.name, start: s.start <= 0 ? 0 : snap(s.start) }))
    .filter((s) => s.start < end)
    .sort((a, b) => a.start - b.start);
  if (!starts.length || starts[0]!.start > 0) starts.unshift({ name: 'intro', start: 0 });

  const out: TimelineEntry[] = [];
  starts.forEach((s, i) => {
    const e = i + 1 < starts.length ? starts[i + 1]!.start : end;
    if (e - s.start < 0.05) return; // two sections snapped to the same beat
    out.push({
      id: `${s.name}-${out.length + 1}`,
      load: scene('karaoke'),
      start: s.start,
      end: e,
      params: { variant: out.length % 3, section: s.name },
    });
  });
  return out;
}

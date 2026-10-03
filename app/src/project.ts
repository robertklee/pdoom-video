// This video, as the engine sees it: the edit and the optional plug-ins. The engine is
// song-agnostic; song.json (repo root) names the audio and lyrics files, and everything else
// specific to this song is reached from here (timeline.ts -> scenes/*, the P(doom) readout).
import type { Project } from './engine/engine';
import { makeTimeline } from './timeline';
import { PDoom } from './scenes/_pdoom';

export const project: Project = {
  timeline: makeTimeline,
  // corner HUD readout (hidden unless a scene returns post.readout > 0; the plates stage P(doom) themselves)
  readout: (lyrics) => new PDoom(lyrics),
};

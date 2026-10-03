// This video's readout plug-in: P(doom) steps up each time "P(doom)" is sung (0.02 -> 0.15 -> 0.42 ->
// 0.81 -> 0.99), rolling to each new value. Plates stage it inside their worlds; project.ts also
// hands it to the engine for the (normally hidden) corner HUD readout.
import { WordCounter, drawReadout as drawInstrument } from '../engine/readout';
import type { Lyrics } from '../engine/lyrics';

export const formatPDoom = (v: number) => v.toFixed(v >= 0.99 ? 3 : 2);

export class PDoom extends WordCounter {
  constructor(lyrics: Lyrics) {
    super(lyrics, { word: 'P(doom)', label: 'P(DOOM)', initial: 0.02, values: [0.15, 0.42, 0.81, 0.99], format: formatPDoom });
  }
}

/** The P(DOOM) instrument (label, digits, tick bar); see engine/readout.ts drawReadout. */
export function drawReadout(c: CanvasRenderingContext2D, x: number, y: number, v: number, o: { scale?: number; text?: string; digits?: string; label?: string; bar?: boolean } = {}) {
  drawInstrument(c, x, y, v, { ...o, title: 'P(DOOM)', text: o.text ?? formatPDoom(v) });
}

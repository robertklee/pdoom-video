import { hexToLinear } from './util';
import { PROJECT } from './project';
import { projectPalette, type PaletteKey } from './manifest';

// The palette keys and the P(doom) defaults live in manifest.ts (shared with the bun scripts).
export { DEFAULT_HEX, type PaletteKey } from './manifest';

/** The palette of the selected project (sRGB hex). */
export const HEX: Record<PaletteKey, string> = projectPalette(PROJECT);

/** Linear RGB triplets for GL uniforms. */
export const LIN: Record<PaletteKey, [number, number, number]> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/** CSS rgba() for Canvas2D. */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

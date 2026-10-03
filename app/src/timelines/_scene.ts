// Lazy scene loader shared by the timelines.
import type { SceneClass } from '../engine/scene';

// Scene modules are discovered lazily so a missing/broken scene never breaks the build.
const modules = import.meta.glob<{ default: SceneClass }>('../scenes/*.ts');

/** Loader for app/src/scenes/<name>.ts (rejects, and the entry renders black, if it is missing). */
export const scene = (name: string) => () => {
  const m = modules[`../scenes/${name}.ts`];
  return m ? m() : Promise.reject(new Error(`scene module not found: scenes/${name}.ts`));
};

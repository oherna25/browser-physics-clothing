// How many fixed physics steps a drawn frame runs. Plain code with no rendering imports, so the test runs it.
import { LOOP } from './presets.js';

/**
 * Adds the frame's elapsed time `raw` (seconds) to the backlog `acc` and returns the steps to run and the backlog
 * left. `stepMs` is the recent cost of one step. Catch-up steps run only while they fit in LOOP.budget, so a device
 * whose step is slow takes one step a frame: the motion slows, but the frame rate holds and a drag stays responsive.
 * Past one step the backlog is dropped.
 */
export function planSteps(acc, raw, stepMs, loop = LOOP) {
  acc += Math.min(raw, loop.maxDelta);
  const cap = Math.max(1, Math.min(loop.catchUp, Math.floor(loop.budget / Math.max(stepMs, 1e-3))));
  const steps = Math.min(Math.floor(acc / loop.step), cap);
  return { steps, acc: Math.min(acc - steps * loop.step, loop.step) };
}

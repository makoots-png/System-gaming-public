// starter.js: the starter campaign's view half. Answers the one step that writes the whole starter campaign
// (src/core/starter.ts `starterCampaign`), which onboarding writes with its onboarded mark: all of it or none.
import { starterCampaign } from '../core/starter.ts';

/**
 * The step that loads the starter campaign, for `store.apply`.
 * @param {import('./app.ts').App} app
 * @param {import('../core/starter.ts').StarterOptions} [options]
 * @returns {import('../core/save-step.ts').Step<import('../core/save.ts').Save>}
 */
export function starterStep(app, options) {
  const R = app.rules();
  return s => starterCampaign(s, { at: new Date().toISOString(), cap: R.logCap }, R, options);
}

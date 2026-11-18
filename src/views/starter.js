// starter.js: the starter campaign's view half. It makes the pregens' hunters (the store reserves their ids) and rolls
// the gates, and answers the one step that writes the whole campaign (src/core/starter.ts `starterCampaign`), which
// onboarding writes with its onboarded mark: all of it or none.
import { PREGENS, STARTER_GATES, starterCampaign } from '../core/starter.ts';

/**
 * The step that loads the starter campaign, for `store.apply`.
 * @param {import('./app.ts').App['store']} store @param {import('./app.ts').App} app
 * @returns {import('../core/save-step.ts').Step<import('../core/save.ts').Save>}
 */
export function starterStep(store, app) {
  const R = app.rules();
  const hunters = PREGENS.map(p => store.newHunter(p.name));
  const gates = STARTER_GATES.map(g => app.api.gates.roll(g));
  return s => starterCampaign(s, { hunters, gates }, { at: new Date().toISOString(), cap: R.logCap }, R);
}

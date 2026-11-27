// rifthunter-solo-sim.test.ts: Rifthunter (Mythic, ins+ctl) solo simulation checks against all 4 scripted Mythic bosses.
import { describe } from 'bun:test';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../src/core/registry/mythics.ts';
import { runSoloMythic } from './models/fight-sim.ts';
import { SOLO_RUNS, soloRow } from './models/mythic-row.ts';
import { simTest, workBudget } from './models/sim-budget.ts';
import { RIFTHUNTER_SOLO_SPEC, SOLO_MYTHIC_RULES, buildMythicSoloRow } from './fixtures/mythic-hunters.ts';

const SOLO_BUDGET = workBudget(250);

/** Exact recorded solo win baselines for Rifthunter after the Wave 5 B3 ceiling pass. */
const RIFTHUNTER_BASELINES: Readonly<Record<MythicScriptId, number>> = {
  plain: 188,
  'angel-of-the-last-trumpet': 192,
  'zaratan-the-island-that-wakes': 167,
  'the-fourth-rider': 152,
};

describe('Rifthunter solo vs Mythic bosses (200 runs each, 75%..98% via soloRow)', () => {
  const hero = buildMythicSoloRow(RIFTHUNTER_SOLO_SPEC, SOLO_MYTHIC_RULES);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Rifthunter solo vs ${mythicId}`, () => {
      const res = runSoloMythic(hero, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      soloRow({
        className: 'Rifthunter',
        boss: mythicId,
        res,
        baseline: RIFTHUNTER_BASELINES[mythicId],
        tallies: [{ name: 'hookless-mythic', actual: 0, min: 0 }],
      });
    }, SOLO_BUDGET);
  }
});

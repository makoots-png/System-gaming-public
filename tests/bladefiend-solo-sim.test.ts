// bladefiend-solo-sim.test.ts: Bladefiend (Mythic, str+agi) solo simulation checks against all 4 scripted Mythic bosses.
import { describe } from 'bun:test';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../src/core/registry/mythics.ts';
import { runSoloMythic } from './models/fight-sim.ts';
import { SOLO_RUNS, soloRow } from './models/mythic-row.ts';
import { simTest, workBudget } from './models/sim-budget.ts';
import { BLADEFIEND_SOLO_SPEC, SOLO_MYTHIC_RULES, buildMythicSoloRow } from './fixtures/mythic-hunters.ts';

const SOLO_BUDGET = workBudget(250);

/** Exact recorded solo win baselines for Bladefiend after the Wave 5 B3 ceiling pass. */
const BLADEFIEND_BASELINES: Readonly<Record<MythicScriptId, number>> = {
  plain: 193,
  'angel-of-the-last-trumpet': 194,
  'zaratan-the-island-that-wakes': 178,
  'the-fourth-rider': 152,
};

describe('Bladefiend solo vs Mythic bosses (200 runs each, 75%..98% via soloRow)', () => {
  const hero = buildMythicSoloRow(BLADEFIEND_SOLO_SPEC, SOLO_MYTHIC_RULES);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Bladefiend solo vs ${mythicId}`, () => {
      const res = runSoloMythic(hero, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      soloRow({
        className: 'Bladefiend',
        boss: mythicId,
        res,
        baseline: BLADEFIEND_BASELINES[mythicId],
        tallies: [{ name: 'hookless-mythic', actual: 0, min: 0 }],
      });
    }, SOLO_BUDGET);
  }
});

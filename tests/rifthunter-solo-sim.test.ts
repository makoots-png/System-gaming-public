// rifthunter-solo-sim.test.ts: Rifthunter (Mythic, ins+ctl) solo simulation checks against all 4 scripted Mythic bosses.
import { describe, expect } from 'bun:test';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import { runSoloMythic } from './models/fight-sim.ts';
import { simTest, workBudget } from './models/sim-budget.ts';
import { RIFTHUNTER_SOLO_SPEC, SOLO_MYTHIC_RULES, buildMythicSoloRow } from './fixtures/mythic-hunters.ts';

const SOLO_RUNS = 200;
const HARD_FLOOR = 0.75;
const HIGH_DIAGNOSTIC = 0.98;
const SOLO_BUDGET = workBudget(250);

describe('Rifthunter solo vs Mythic bosses (200 runs each, target 75% to 98% aiming near 85%)', () => {
  const hero = buildMythicSoloRow(RIFTHUNTER_SOLO_SPEC, SOLO_MYTHIC_RULES);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Rifthunter solo vs ${mythicId}`, () => {
      const res = runSoloMythic(hero, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const pct = (res.winRate * 100).toFixed(1);
      const se = (res.se * 100).toFixed(1);
      const diag = res.winRate > HIGH_DIAGNOSTIC ? ' [DIAGNOSTIC: >98% hot]' : '';
      console.log(`[solo-mythic] Rifthunter vs ${mythicId}: ${pct}% (${res.wins}/${res.runs}, se ${se}%, mean ${res.meanRounds.toFixed(1)} rounds, ${res.capped} capped)${diag}`);
      expect(res.winRate, `Rifthunter vs ${mythicId} win rate ${pct}% below 75% floor`).toBeGreaterThanOrEqual(HARD_FLOOR);
    }, SOLO_BUDGET);
  }
});

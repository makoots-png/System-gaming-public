// E-rank smoke simulation (PR 6): verifies the real starter party with a freshly offered 0-node E-rank Hemomancer
// (built through claimUniqueClass + hunterRow, never hand-crafted NewRows) fights cleanly through E-rank Goblin Den
// encounters without crashes, illegal commands, or degenerate outcomes.
import { describe, expect } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import { starterCampaign } from '../src/core/starter.ts';
import { claimUniqueClass } from '../src/core/hunter/class-holders.ts';
import { isRefused } from '../src/core/save-step.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { sensible } from '../src/core/combat/policy.ts';
import { seedMonsters, statBlock } from '../src/core/registry/monsters.ts';
import { CLASS_SIGNATURES } from '../src/core/registry/class-powers.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { playFight } from './models/fight-sim.ts';
import type { Policy, SimRow } from './models/fight-sim.ts';
import { simTest, workBudget } from './models/sim-budget.ts';
import { hemomancerPolicy } from './fixtures/mythic-hunters.ts';
import { dev } from './fixtures/ids.ts';

const AT = '2026-11-25T12:00:00.000Z';
const RUNS = 100;

/** Adapts core `sensible` (3-arg TurnPolicy) to `fight-sim.ts` 4-arg Policy. */
const sensiblePolicy: Policy = (f, me, _plan, R) => sensible(f, me, R);

/** Builds the real E-rank starter party: Dolan + Nadia + a freshly offered 0-node E-rank Hemomancer. */
function buildERankStarterParty(): readonly SimRow[] {
  const env = { now: new Date(AT), newDeviceId: () => dev('d-gm'), newDeviceToken: () => 'tok-gm-1234567890' };
  const s0 = starterCampaign(freshSave(env, { onboarded: true }), { at: AT, cap: RULES.logCap }, RULES);
  if (isRefused(s0)) throw new Error(`starterCampaign refused: ${s0.why}`);
  const [dolan, nadia] = s0.hunters;
  if (!dolan || !nadia) throw new Error('starterCampaign must seed Dolan and Nadia');

  // 3rd E-rank party member (level 1, starter vit+pow split) claims Hemomancer at 0 nodes.
  const thirdBase = newHunter(RULES);
  const third = {
    ...thirdBase,
    id: 'h-hemo' as typeof dolan.id,
    name: 'Sora',
    stats: { ...thirdBase.stats, vit: 12, pow: 13 },
  };
  const withThird = { ...s0, hunters: [...s0.hunters, third] };
  const claimed = claimUniqueClass(
    withThird,
    'Hemomancer',
    { kind: 'local', hunterId: third.id },
    { at: AT, room: null, stamp: null, R: RULES, heldLocal: () => false, heldRemote: () => false },
  );
  if (isRefused(claimed)) throw new Error(`claimUniqueClass failed: ${claimed.why}`);
  const hemo = claimed.save.hunters.find(h => h.id === third.id)!;
  expect(hemo.job).toBe('Hemomancer');
  expect(hemo.classes.Hemomancer?.nodes).toEqual([]);

  const hemoRow = hunterRow(hemo, combatantId('hemo'), RULES);
  // Verify all 4 Hemomancer signature actives are wired onto the E-rank 0-node row.
  const expectedSigs = (CLASS_SIGNATURES.Hemomancer?.actives ?? []).map(a => wornAbilityId(a.id));
  expect(expectedSigs.length).toBe(4);
  for (const id of expectedSigs) {
    expect(hemoRow.abilities.some(a => a.id === id), `0-node E-rank Hemomancer has signature ${id}`).toBe(true);
  }

  return [
    { row: hunterRow(dolan, combatantId('dolan'), RULES), policy: sensiblePolicy },
    { row: hunterRow(nadia, combatantId('nadia'), RULES), policy: sensiblePolicy },
    { row: hemoRow, policy: hemomancerPolicy },
  ];
}

function goblinPack(count: number): readonly SimRow[] {
  const gob = seedMonsters(RULES).find(m => m.name === 'Goblin');
  if (!gob) throw new Error('seedMonsters must include Goblin');
  const rows = monsterRows(gob, Array.from({ length: count }, (_, i) => combatantId(`gob-${i + 1}`)), RULES);
  return rows.map(row => ({ row, policy: sensiblePolicy }));
}

function goblinChiefAndGuards(): readonly SimRow[] {
  const chief = statBlock(RULES, 'E', { name: 'Goblin Chief', archetype: 'brute', kind: 'boss' });
  const chiefRow = monsterRows(
    { name: chief.name, rank: 'E', archetype: 'brute', kind: 'boss', tweak: {}, abilities: [], statuses: [] },
    [combatantId('gob-chief')],
    RULES,
  )[0]!;
  return [{ row: chiefRow, policy: sensiblePolicy }, ...goblinPack(2)];
}

describe('E-rank starter party + 0-node Hemomancer smoke sim (PR 6)', () => {
  simTest(
    'E-rank starter party (Brakk, Mira, 0-node Hemomancer) vs 3 E-rank Goblins runs cleanly without crashes or degenerate fights',
    () => {
      const party = buildERankStarterParty();
      const foes = goblinPack(3);
      let wins = 0;
      let totalRounds = 0;
      let hemoActs = 0;
      let capped = 0;
      for (let i = 0; i < RUNS; i++) {
        const rec = playFight({ rows: [...party, ...foes], rules: RULES }, 6100 + i);
        if (rec.winner === 'party') wins++;
        if (rec.capped) capped++;
        totalRounds += rec.rounds;
        hemoActs += Object.values(rec.tally.hemo?.acts ?? {}).reduce((a, b) => a + b, 0);
      }
      const winRate = wins / RUNS;
      const avgRounds = totalRounds / RUNS;
      console.log(`  [E-rank smoke: 3 Goblins] wins=${wins}/${RUNS} (${(winRate * 100).toFixed(1)}%), avgRounds=${avgRounds.toFixed(1)}, hemoActs=${hemoActs}, capped=${capped}`);
      expect(capped).toBe(0);
      expect(winRate).toBeGreaterThanOrEqual(0.5);
      expect(avgRounds).toBeGreaterThanOrEqual(1);
      expect(avgRounds).toBeLessThanOrEqual(20);
      expect(hemoActs).toBeGreaterThan(0);
    },
    workBudget(RUNS),
  );

  simTest(
    'E-rank starter party (Brakk, Mira, 0-node Hemomancer) vs E-rank Goblin Chief boss + 2 Goblins runs cleanly',
    () => {
      const party = buildERankStarterParty();
      const foes = goblinChiefAndGuards();
      let wins = 0;
      let totalRounds = 0;
      let hemoActs = 0;
      let capped = 0;
      for (let i = 0; i < RUNS; i++) {
        const rec = playFight({ rows: [...party, ...foes], rules: RULES }, 6200 + i);
        if (rec.winner === 'party') wins++;
        if (rec.capped) capped++;
        totalRounds += rec.rounds;
        hemoActs += Object.values(rec.tally.hemo?.acts ?? {}).reduce((a, b) => a + b, 0);
      }
      const winRate = wins / RUNS;
      const avgRounds = totalRounds / RUNS;
      console.log(`  [E-rank smoke: Goblin Chief + 2 Goblins] wins=${wins}/${RUNS} (${(winRate * 100).toFixed(1)}%), avgRounds=${avgRounds.toFixed(1)}, hemoActs=${hemoActs}, capped=${capped}`);
      expect(capped).toBe(0);
      expect(winRate).toBeGreaterThan(0);
      expect(avgRounds).toBeGreaterThanOrEqual(1);
      expect(avgRounds).toBeLessThanOrEqual(25);
      expect(hemoActs).toBeGreaterThan(0);
    },
    workBudget(RUNS),
  );
});

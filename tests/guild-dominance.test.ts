// guild-dominance.test.ts: fast port of the economy balance arena's 162-cell guild dominance check (Finding 5)
// and Order C (debtFirst) revive-debt payoff & non-zero kept gold check (Finding 4).
import { describe, expect, test } from 'bun:test';
import { seededSource } from '../src/core/draws.ts';
import {
  GUILD_ARCHETYPES,
  GUILD_GOLD_CUT_MAX,
  GUILD_STANDINGS,
  GUILD_TABLE_PERKS,
  allowedStandings,
  guildGoldStep,
  tableCrystalShare,
  tableGoldCut,
} from '../src/core/hunter/guild.ts';
import type { GuildArchetype, GuildStanding } from '../src/core/hunter/guild.ts';
import { debtStep } from '../src/core/hunter/revive-standing.ts';
import { RANKS, RULES, clearOf, priceBaseOf } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';

type Choice = 'unsigned' | GuildArchetype;
const CHOICES: readonly Choice[] = ['unsigned', ...GUILD_ARCHETYPES];
const PACES = [1, 2, 3] as const;
const DEATH_RATES = [0, 0.05, 0.15] as const;
const CAMPAIGN_SESSIONS = 10;
const SESSIONS_PER_MONTH = 4;

/** Exact E[max(0, Bin(10 * clearsPerSess, pDeath) - 1)]: Death 1 uses Free System Raise, Deaths 2+ use Vault Crystal. */
function expectedVaultUses10Sess(pDeath: number, clearsPerSess: number): number {
  const n = CAMPAIGN_SESSIONS * clearsPerSess;
  return pDeath <= 0 ? 0 : n * pDeath - (1 - Math.pow(1 - pDeath, n));
}

/**
 * Expected value per hunter per session in `priceBase` multiples, ported directly from economy-balance-sim.ts:
 * net clear gold + gate crystal @ Bureau 0.85 + monthly retainer/4 @ 0.85 + E/D signing bonus/10 @ 0.85 + vault cover.
 */
function choiceValuePerSessionPB(
  choice: Choice,
  standing: GuildStanding,
  rank: Rank,
  clearsPerSess: number,
  pDeath: number,
): number | null {
  const cut = choice === 'unsigned' ? 0 : tableGoldCut(choice, standing, rank, RULES);
  const cryShare = choice === 'unsigned' ? RULES.crystal.unsignedShare : tableCrystalShare(choice, standing, RULES);
  if (cut === null || cryShare === null) return null;

  const pb = priceBaseOf(RULES, rank);
  const meanClearPB = clearOf(RULES, rank) / pb;
  const goldPB = clearsPerSess * meanClearPB * (1 - cut);

  const w = RULES.gateSpawn.type;
  const avgTypeMult = (w.normal * 1 + (w.red + w.double) * RULES.crystal.specialMult) / (w.normal + w.red + w.double);
  const crystalPerClearPB = (RULES.crystal.poolBase * avgTypeMult * cryShare) / RULES.gateParty;
  const crystalPB = clearsPerSess * crystalPerClearPB * RULES.crystal.rates.bureau;

  if (choice === 'unsigned') return goldPB + crystalPB;

  const perk = GUILD_TABLE_PERKS[choice];
  const retainerPB = (perk.retainerPB / SESSIONS_PER_MONTH) * RULES.crystal.rates.bureau;
  const vaultUsesPerSess = perk.vaultCover[standing] ? expectedVaultUses10Sess(pDeath, clearsPerSess) / CAMPAIGN_SESSIONS : 0;
  const vaultPB = vaultUsesPerSess * RULES.revivePrices;
  const signPB = rank === 'E' || rank === 'D' ? (perk.signingBonusED / CAMPAIGN_SESSIONS) * RULES.crystal.rates.bureau : 0;
  return goldPB + crystalPB + retainerPB + vaultPB + signPB;
}

describe('economy balance arena checks (Findings 4 and 5)', () => {
  test('162-cell dominance check: 0 pairwise strictly dominated guilds (or Unsigned) and every choice wins real cells', () => {
    const wins: Record<Choice, number> = {
      unsigned: 0,
      ironwake: 0,
      lantern: 0,
      aurelian: 0,
      'ninth-hour': 0,
      redline: 0,
    };
    let cells = 0;

    for (const rank of RANKS) {
      for (const standing of GUILD_STANDINGS) {
        for (const clears of PACES) {
          for (const pDeath of DEATH_RATES) {
            cells++;
            const ranked = CHOICES
              .map(choice => ({ choice, v: choiceValuePerSessionPB(choice, standing, rank, clears, pDeath) }))
              .filter((x): x is { choice: Choice; v: number } => x.v !== null)
              .sort((a, b) => b.v - a.v);
            wins[ranked[0]!.choice]++;
          }
        }
      }
    }
    expect(cells).toBe(162);

    const dominated: string[] = [];
    for (const a of CHOICES) {
      for (const b of CHOICES) {
        if (a === b) continue;
        let allGe = true;
        let anyGt = false;
        for (const rank of RANKS) {
          for (const standing of GUILD_STANDINGS) {
            for (const clears of PACES) {
              for (const pDeath of DEATH_RATES) {
                const va = choiceValuePerSessionPB(a, standing, rank, clears, pDeath);
                const vb = choiceValuePerSessionPB(b, standing, rank, clears, pDeath);
                if (va === null || vb === null) continue;
                if (va + 1e-9 < vb) allGe = false;
                if (va > vb + 1e-9) anyGt = true;
              }
            }
          }
        }
        if (allGe && anyGt) dominated.push(`${a} > ${b}`);
      }
    }

    expect(dominated).toEqual([]);
    for (const choice of CHOICES) {
      expect(wins[choice]).toBeGreaterThan(0);
    }
    // Exact arena report split across 162 cells
    expect(wins).toEqual({
      unsigned: 36,
      ironwake: 44,
      lantern: 23,
      aurelian: 8,
      'ninth-hour': 41,
      redline: 10,
    });
  });

  test('Order C (debtFirst) keeps positive gold on every debt clear and holds revive debt payoff at 4.7 to 5.0 clears across E..S', () => {
    const TRIALS = 1000;
    for (let ri = 0; ri < RANKS.length; ri++) {
      const rank = RANKS[ri]!;
      const [lo, hi] = RULES.loot[rank].gold;
      const initialDebt = Math.round(RULES.reviveDebtPrices[rank] * priceBaseOf(RULES, rank));
      const rand = seededSource(30000 + ri * 97).random;

      let totalClears = 0;
      let zeroKept = 0;
      let conservationErrors = 0;
      const iwRookie = { rank, guild: { archetype: 'ironwake' as const, standing: 'rookie' as const } };

      for (let t = 0; t < TRIALS; t++) {
        let debt = initialDebt;
        let clears = 0;
        let paidSum = 0;
        while (debt > 0 && clears < 50) {
          const gross = lo! + Math.floor(rand() * (hi! - lo! + 1));
          const s = debtStep(debt, { type: 'clearGold', gold: gross }, RULES);
          const gc = guildGoldStep(s.kept, iwRookie, RULES);
          const taken = gc ? gc.taken : 0;
          const finalKept = gc ? gc.kept : s.kept;
          if (s.paid + s.burn + taken + finalKept !== gross) conservationErrors++;
          if (finalKept <= 0) zeroKept++;
          debt = s.debt;
          paidSum += s.paid;
          clears++;
        }
        if (paidSum !== initialDebt) conservationErrors++;
        totalClears += clears;
      }

      const meanClears = totalClears / TRIALS;
      expect(conservationErrors).toBe(0);
      expect(zeroKept).toBe(0);
      expect(meanClears).toBeGreaterThanOrEqual(4.7);
      expect(meanClears).toBeLessThanOrEqual(5.0);

      // Worst-case minimum loot roll across every allowed archetype + standing, plus 90% GM override, always leaves >= 1g
      const worst = debtStep(initialDebt, { type: 'clearGold', gold: lo! }, RULES);
      for (const a of GUILD_ARCHETYPES) {
        for (const s of allowedStandings(a, RULES)) {
          const cut = guildGoldStep(worst.kept, { rank, guild: { archetype: a, standing: s } }, RULES)!;
          expect(cut.kept).toBeGreaterThanOrEqual(1);
          expect(worst.paid + worst.burn + cut.taken + cut.kept).toBe(lo!);
        }
      }
      const maxCut = guildGoldStep(worst.kept, { rank, guild: { archetype: 'aurelian', standing: 'rookie', goldCut: GUILD_GOLD_CUT_MAX } }, RULES)!;
      expect(maxCut.kept).toBeGreaterThanOrEqual(1);
    }
  });
});

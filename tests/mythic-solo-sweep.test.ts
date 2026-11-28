// mythic-solo-sweep.test.ts: zero-fight Wave 5 B6 sweep across all 10 Mythics.
// (a) Derives the 10 Mythic classes directly from BUILT_IN_CLASSES (`rarity === 'mythic'`), so a missing class fails.
// (b) Verifies every Mythic has a MYTHIC_ROSTER spec and passes the shared legality builder.
// (c) Reads the 10x4 matrix of declared soloRow baselines from the 10 per-class sim files and asserts no boss column
//     averages above 95%.
// (d) Runs fail-capable negative self-tests for soloRow, roster coverage, baseline parsing, and boss-column averages.
import { describe, expect, test } from 'bun:test';
import type { ClassNodeId } from '../src/core/ids.ts';
import { BUILT_IN_CLASSES, classDefOf, jobFocus } from '../src/core/registry/jobs.ts';
import { MYTHIC_IDS, PLAIN } from '../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../src/core/registry/mythics.ts';
import { CLASS_ACTIVES_MAX, TREE_SHAPE, canBuyNode, classTreeOf, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { classPowers } from '../src/core/registry/class-powers.ts';
import { keystoneOf } from '../src/core/registry/keystones.ts';
import { heldKeystones } from '../src/core/hunter/sheet.ts';
import { gradeOfSpend, itemSpend, titleSpend } from '../src/core/registry/item-budget.ts';
import { WEAR_LIMIT } from '../src/core/registry/items.ts';
import { wornAbilityId } from '../src/core/registry/abilities.ts';
import { MYTHIC_OFFER_POOL } from '../src/core/hunter/class-offer.ts';
import type { SoloMythicResult } from './models/fight-sim.ts';
import { SOLO_CEILING, SOLO_FLOOR, SOLO_PRESSURE_MIN_FLOOR, SOLO_RUNS, soloRow } from './models/mythic-row.ts';
import { MYTHIC_SOLO_SPECS, SOLO_MYTHIC_RULES, buildMythicSoloHunter, buildMythicSoloRow } from './fixtures/mythic-hunters.ts';
import { MYTHIC_CLASSES, MYTHIC_ROSTER, mythicClassesOf } from './fixtures/mythic-roster.ts';

const ROOT = import.meta.dir + '/..';
/** Maximum allowed average win rate across the 10 Mythics for any single boss column. */
const BOSS_COLUMN_AVG_MAX = 0.95;

type BaselineMatrixRow = {
  readonly className: string;
  readonly baselines: Readonly<Record<MythicScriptId, number>>;
};

/** Verifies every expected Mythic appears once in `roster` and no extra or non-Mythic class sneaks in. */
function checkMythicRosterCoverage(
  expectedMythics: readonly string[],
  roster: readonly { readonly spec: { readonly className: string } }[],
): string[] {
  const errors: string[] = [];
  const expectedSet = new Set(expectedMythics);
  const seen = new Set<string>();
  for (const entry of roster) {
    const cls = entry.spec.className;
    if (seen.has(cls)) errors.push(`duplicate Mythic in MYTHIC_ROSTER: "${cls}"`);
    seen.add(cls);
    if (!expectedSet.has(cls)) errors.push(`unexpected non-Mythic in MYTHIC_ROSTER: "${cls}"`);
  }
  for (const cls of expectedMythics) {
    if (!seen.has(cls)) errors.push(`missing Mythic in MYTHIC_ROSTER: "${cls}"`);
  }
  return errors;
}

/**
 * Extracts the 4-boss baseline object `const ${constName}: Readonly<Record<MythicScriptId, number>> = { ... }` from a
 * solo-sim file and verifies that non-comment code passes `baseline: ${constName}[` to `soloRow(`.
 */
function parseDeclaredBaselines(src: string, constName: string, fileLabel: string): Readonly<Record<MythicScriptId, number>> {
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const declRe = new RegExp(`const\\s+${constName}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\};`);
  const match = declRe.exec(code);
  if (!match) throw new Error(`${fileLabel}: missing baseline table ${constName}`);

  const wiredRe = new RegExp(`\\bsoloRow\\s*\\([\\s\\S]*?baseline\\s*:\\s*${constName}\\s*\\[`);
  if (!wiredRe.test(code)) {
    throw new Error(`${fileLabel}: ${constName} is not passed to soloRow({ baseline: ${constName}[...] })`);
  }

  const body = match[1]!;
  const out = {} as Record<MythicScriptId, number>;
  for (const boss of MYTHIC_IDS) {
    const escaped = boss.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rowRe = new RegExp(`(?:['"]${escaped}['"]|\\b${escaped}\\b)\\s*:\\s*(\\d+)`);
    const m = rowRe.exec(body);
    if (!m) throw new Error(`${fileLabel}: ${constName} missing baseline for ${boss}`);
    const wins = Number(m[1]!);
    if (!Number.isInteger(wins) || wins < 0 || wins > SOLO_RUNS) {
      throw new Error(`${fileLabel}: ${constName}[${boss}] = ${wins} out of 0..${SOLO_RUNS}`);
    }
    out[boss] = wins;
  }
  return out;
}

/** Checks that no boss column in the declared baseline matrix averages above `maxAvg`. */
function checkBossColumnAverages(
  matrix: readonly BaselineMatrixRow[],
  maxAvg = BOSS_COLUMN_AVG_MAX,
  runs = SOLO_RUNS,
): { readonly averages: Readonly<Record<MythicScriptId, number>>; readonly errors: string[] } {
  const errors: string[] = [];
  const averages = {} as Record<MythicScriptId, number>;
  if (matrix.length === 0) {
    errors.push('baseline matrix is empty');
    return { averages, errors };
  }
  const denom = matrix.length * runs;
  for (const boss of MYTHIC_IDS) {
    const totalWins = matrix.reduce((sum, row) => sum + row.baselines[boss], 0);
    const avg = totalWins / denom;
    averages[boss] = avg;
    if (avg > maxAvg) {
      errors.push(
        `boss column "${boss}" averages ${(avg * 100).toFixed(2)}% (${totalWins}/${denom}) > ${(maxAvg * 100).toFixed(1)}% cap`,
      );
    }
  }
  return { averages, errors };
}

describe('Wave 5 B6: 10-Mythic roster coverage and shared legality (zero fights)', () => {
  test('derives all 10 Mythics from BUILT_IN_CLASSES and verifies MYTHIC_ROSTER matches', () => {
    const derived = mythicClassesOf(BUILT_IN_CLASSES);
    expect(derived).toEqual([...MYTHIC_CLASSES]);
    expect(derived).toHaveLength(10);
    expect(derived).toContain('Dawnbringer');
    expect(derived).toContain('Usurper');

    expect(checkMythicRosterCoverage(derived, MYTHIC_ROSTER)).toEqual([]);
    expect(MYTHIC_ROSTER.map(e => e.spec.className).sort()).toEqual([...derived].sort());
    expect(MYTHIC_SOLO_SPECS.map(s => s.className).sort()).toEqual([...derived].sort());
    expect([...MYTHIC_OFFER_POOL].sort()).toEqual([...derived].sort());
  });

  for (const cls of MYTHIC_CLASSES) {
    test(`${cls} has a MYTHIC_ROSTER spec and passes shared tree, title, gear, active, and Confluence legality`, () => {
      const entry = MYTHIC_ROSTER.find(e => e.spec.className === cls);
      expect(entry, `missing MYTHIC_ROSTER entry for ${cls}`).toBeDefined();
      const { spec } = entry!;

      // Stat focus derived from BUILT_IN_CLASSES (no hand-copied stat mismatch)
      const focus = jobFocus(cls);
      expect(focus, `${cls} jobFocus`).not.toBeNull();
      expect(spec.main, `${cls} main stat`).toBe(focus!.main);
      expect(spec.second, `${cls} second stat`).toBe(focus!.second!);

      // Skill tree legality and 32 buyable nodes in purchase order
      const tree = classTreeOf(cls);
      expect(tree, `${cls} tree`).not.toBeNull();
      expect(validateTree(tree!), `${cls} validateTree`).toEqual([]);
      expect(spec.nodes.length, `${cls} buyable node count`).toBe(TREE_SHAPE.mythic.buyable);
      expect(repairNodes(tree!, spec.nodes), `${cls} repairNodes`).toEqual([...spec.nodes]);

      const bought: ClassNodeId[] = [];
      for (const id of spec.nodes) {
        const check = canBuyNode(tree!, bought, id);
        expect(check.ok, `${cls} node ${id} refused`).toBe(true);
        bought.push(id);
      }

      // S-band title within S budget
      const tSpend = titleSpend({ ...spec.title, band: 'S' }, SOLO_MYTHIC_RULES);
      expect(tSpend.points, `${cls} title spend`).toBeLessThanOrEqual(SOLO_MYTHIC_RULES.titleBudget.S);

      // 6 Mythic middle-grade pieces
      const gear = spec.gear(SOLO_MYTHIC_RULES);
      expect(gear.length, `${cls} gear slot count`).toBe(WEAR_LIMIT);
      for (const item of gear) {
        expect(item.rar, `${cls} ${item.name} rarity`).toBe('mythic');
        const spend = itemSpend(item, SOLO_MYTHIC_RULES);
        expect(spend, `${cls} ${item.name} spend`).not.toBeNull();
        expect(
          gradeOfSpend(SOLO_MYTHIC_RULES, 'mythic', spend!.points),
          `${cls} ${item.name} spend ${spend!.points.toFixed(2)} not Mythic middle grade`,
        ).toBe(0);
      }

      // Real Hunter -> hunterRow: capstone worn, 4 actives, armed reaction, and awakened Confluence only where keystones.ts defines one
      const h = buildMythicSoloHunter(spec, SOLO_MYTHIC_RULES);
      const sim = buildMythicSoloRow(spec, SOLO_MYTHIC_RULES);
      const cp = classPowers(h, SOLO_MYTHIC_RULES);
      const ks = heldKeystones(h, SOLO_MYTHIC_RULES);
      expect(h.job).toBe(cls);
      expect(h.jobDone).toBe(cls);
      expect(cp.worn, `${cls} folded worn`).not.toBeNull();
      expect(sim.row.statuses.some(s => s.worn && s.key === cp.worn!.key), `${cls} worn on combat row`).toBe(true);
      expect(cp.actives.length, `${cls} active count`).toBe(CLASS_ACTIVES_MAX);
      for (const a of cp.actives) {
        expect(
          sim.row.abilities.some(x => x.id === wornAbilityId(a.id)),
          `${cls} missing active ${a.name} on combat row`,
        ).toBe(true);
      }
      if (spec.armedReactionId) {
        expect(sim.row.armed?.ability, `${cls} armed reaction`).toBe(spec.armedReactionId);
      }

      const pair = classDefOf(cls)!.pair;
      const confluence = keystoneOf({ tier: 'confluence', pair }, SOLO_MYTHIC_RULES);
      expect(ks.length, `${cls} keystone count`).toBeGreaterThanOrEqual(4);
      expect(ks.some(k => k.keystone.name === confluence.name), `${cls} holds pair Confluence ${confluence.name}`).toBe(true);
      expect(
        ks.some(k => k.awakened !== null),
        `${cls} (${pair}) awakened Confluence presence must match keystones.ts (${confluence.awakened !== null})`,
      ).toBe(confluence.awakened !== null);
    });
  }
});

describe('Wave 5 B6: 10x4 declared soloRow baseline matrix and 95% boss-column cap (zero fights)', () => {
  test('reads all 40 declared baselines from the 10 Mythic solo-sim files and asserts every boss column averages <= 95%', async () => {
    const matrix: BaselineMatrixRow[] = [];
    for (const entry of MYTHIC_ROSTER) {
      const src = await Bun.file(`${ROOT}/${entry.simFile}`).text();
      const baselines = parseDeclaredBaselines(src, entry.baselineConst, entry.simFile);
      for (const boss of MYTHIC_IDS) {
        const rate = baselines[boss] / SOLO_RUNS;
        expect(rate, `${entry.spec.className} vs ${boss} below 75% floor`).toBeGreaterThanOrEqual(SOLO_FLOOR);
        if (boss !== PLAIN) {
          expect(rate, `${entry.spec.className} vs ${boss} above 98% scripted ceiling`).toBeLessThanOrEqual(SOLO_CEILING);
        }
      }
      matrix.push({ className: entry.spec.className, baselines });
    }

    expect(matrix).toHaveLength(10);
    const { averages, errors } = checkBossColumnAverages(matrix, BOSS_COLUMN_AVG_MAX, SOLO_RUNS);
    const summary = MYTHIC_IDS.map(b => `${b}=${(averages[b] * 100).toFixed(2)}%`).join(', ');
    console.log(`[mythic-solo-sweep] 10x4 boss-column averages (cap <=95.0%): ${summary}`);
    expect(errors).toEqual([]);
  });
});

describe('Wave 5 B6: fail-capable negative self-tests (zero fights)', () => {
  const mkRes = (boss: MythicScriptId, wins: number, capped = 0, runs = SOLO_RUNS): SoloMythicResult => {
    const winRate = wins / runs;
    return {
      mythicId: boss,
      runs,
      wins,
      winRate,
      se: Math.sqrt((winRate * (1 - winRate)) / runs),
      meanRounds: 10,
      capped,
    };
  };

  test('soloRow fails loudly on 0.74 winRate, 0.99 scripted boss, capped 1, wins !== baseline, ceiling 1.0 without pressure, and tally below floor', () => {
    // 1. winRate 0.74 (148/200) fails floor
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'zaratan-the-island-that-wakes',
      res: mkRes('zaratan-the-island-that-wakes', 148),
      baseline: 148,
      quiet: true,
    })).toThrow(/below 75% floor/);

    // 2. winRate 0.99 (198/200) on scripted boss fails ceiling
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'angel-of-the-last-trumpet',
      res: mkRes('angel-of-the-last-trumpet', 198),
      baseline: 198,
      quiet: true,
    })).toThrow(/above 98\.0% ceiling/);

    // 3. capped 1 fails
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'the-fourth-rider',
      res: mkRes('the-fourth-rider', 170, 1),
      baseline: 170,
      quiet: true,
    })).toThrow(/had 1 capped fights/);

    // 4. wins !== baseline fails in both directions
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 171),
      baseline: 170,
      quiet: true,
    })).toThrow(/drifted from recorded baseline 170\/200/);
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 169),
      baseline: 170,
      quiet: true,
    })).toThrow(/drifted from recorded baseline 170\/200/);

    // 5. ceiling 1.0 on plain without pressure (and without pressure.exact, and on scripted boss) fails
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 200),
      baseline: 200,
      ceiling: 1.0,
      quiet: true,
    })).toThrow(/requires a pressure floor/);
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'plain',
      res: mkRes('plain', 200),
      baseline: 200,
      ceiling: 1.0,
      pressure: { label: 'hp-drop', minRate: SOLO_PRESSURE_MIN_FLOOR, actual: 0.6 },
      quiet: true,
    })).toThrow(/requires pressure\.exact/);
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'angel-of-the-last-trumpet',
      res: mkRes('angel-of-the-last-trumpet', 200),
      baseline: 200,
      ceiling: 1.0,
      pressure: { label: 'hp-drop', minRate: SOLO_PRESSURE_MIN_FLOOR, actual: 0.6, exact: 0.6 },
      quiet: true,
    })).toThrow(/only allowed on plain/);

    // 6. tally below floor fails
    expect(() => soloRow({
      className: 'Synthetic',
      boss: 'zaratan-the-island-that-wakes',
      res: mkRes('zaratan-the-island-that-wakes', 170),
      baseline: 170,
      tallies: [{ name: 'overheal smites per fight', actual: 0.95, min: 1.0 }],
      quiet: true,
    })).toThrow(/tally "overheal smites per fight" \(0\.95\) below floor 1/);
  });

  test('roster coverage, baseline parser, and 95% boss-column average cap fail loudly on synthetic drift', () => {
    // 7. Missing Mythic in the roster (both removing a real Mythic and adding a synthetic Mythic to BUILT_IN_CLASSES)
    expect(checkMythicRosterCoverage(MYTHIC_CLASSES, MYTHIC_ROSTER.filter(e => e.spec.className !== 'Usurper'))).toEqual([
      'missing Mythic in MYTHIC_ROSTER: "Usurper"',
    ]);
    const withFakeMythic = mythicClassesOf({
      ...BUILT_IN_CLASSES,
      FakeMythic: { rarity: 'mythic' },
    });
    expect(checkMythicRosterCoverage(withFakeMythic, MYTHIC_ROSTER)).toEqual([
      'missing Mythic in MYTHIC_ROSTER: "FakeMythic"',
    ]);

    // 8. Boss column averaging above 95% fails loudly
    const hotMatrix: BaselineMatrixRow[] = MYTHIC_CLASSES.map(className => ({
      className,
      baselines: {
        plain: 180,
        'angel-of-the-last-trumpet': 191, // 95.5% across all 10 Mythics
        'zaratan-the-island-that-wakes': 170,
        'the-fourth-rider': 170,
      },
    }));
    const hot = checkBossColumnAverages(hotMatrix, BOSS_COLUMN_AVG_MAX, SOLO_RUNS);
    expect(hot.averages['angel-of-the-last-trumpet']).toBeCloseTo(0.955, 4);
    expect(hot.errors).toHaveLength(1);
    expect(hot.errors[0]).toContain('angel-of-the-last-trumpet');
    expect(hot.errors[0]).toContain('95.50%');

    // Baseline parser catches missing table, missing boss, and unwired baseline constant
    expect(() => parseDeclaredBaselines('const OTHER = {};', 'FAKE_BASELINES', 'fake.ts')).toThrow(/missing baseline table/);
    expect(() => parseDeclaredBaselines(
      `const FAKE_BASELINES = { plain: 180, 'angel-of-the-last-trumpet': 180, 'zaratan-the-island-that-wakes': 180, 'the-fourth-rider': 180 };`,
      'FAKE_BASELINES',
      'fake.ts',
    )).toThrow(/not passed to soloRow/);
    expect(() => parseDeclaredBaselines(
      `const FAKE_BASELINES = { plain: 180 }; soloRow({ baseline: FAKE_BASELINES[id] });`,
      'FAKE_BASELINES',
      'fake.ts',
    )).toThrow(/missing baseline for angel-of-the-last-trumpet/);
  });
});

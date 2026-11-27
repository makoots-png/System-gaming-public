// The balance rows of the reworked fight: one row per bound of docs/agent-handoff/rw/design.md section 6 (per rank where
// the bound names ranks), each played on the real reducer by tests/models/fight-sim.ts with seeded dice. A row is
// `{ name, setup, runs, measure, low, high, lever }`: a new class or bound is a new row. What each miss means, and every
// number moved, is docs/agent-handoff/rw/sim-log.md.
//
// The noise floor, chosen before the first run. A share p measured over n fights has a standard error of
// sqrt(p * (1 - p) / n). It is largest at p = 0.5, where n = 400 gives sqrt(0.25 / 400) = 0.025, so every share whose
// bound has an edge between 0.25 and 0.75 plays 400 fights. A share bounded near 0 is judged at its edge: at p = 0.10,
// n = 150 gives sqrt(0.09 / 150) = 0.0245; at p = 0.25, n = 300 gives sqrt(0.1875 / 300) = 0.025; at p = 0.05, n = 100
// gives 0.022. A share bounded on both sides near 0 (M1, 0.05 to 0.10) plays 600 fights: sqrt(0.075 * 0.925 / 600) =
// 0.011. A mean (rounds, staggers, casts) prints its own standard error, sd / sqrt(n); a ratio of two means or shares
// prints the delta-method error, r * sqrt((se_a / a)^2 + (se_b / b)^2). A row whose value is within one standard error
// of its edge is printed as "near"; a change to a number is accepted only when it moves a row by more than twice its
// standard error.
//
// How each bound is read, where the design's words leave a choice (section 6 as the lead restated it after round one):
// - "the favoured build wins 60 to 90%": the first build's share of the fights it wins, the mean of two openings played
//   400 times each: the default lines (8 tiles apart) and adjacent (the two side by side, the party's at (0, 2), the
//   foe's at (0, 3)). The mean's standard error is half the root of the sum of the two squared errors. A fight that
//   reaches the 40-round cap is no win.
//   Each opening is printed beside the mean with its own standard error and no bound (the lead's decision 6 of round
//   three).
// - "every build wins 25 to 75% against every other" (E): the three builds of the triangle, one row a pair, read the
//   same way (the second build's share is one minus the first's, as no duel reached the cap).
// - "a pack that can hurt" (the speed party's rows): two normal skirmishers (ranged) and an elite brute.
// - A hunter at 0 HP is dead (the owner, Nov 21: no death saves), so going down and dying are one event, a death, and
//   each bound below is a share of fights in which some hunter dies.
// - "no hunter dying in more than 1 run in 10": a hunter dies in at most 1 pack fight in 10.
// - "at most one hunter down in more than 1 run in 4, a death in under 1 in 20": with down and death one event, the
//   pair cannot both stand; the row keeps the design's bound on a hunter lost, a death in under 1 boss fight in 20.
// - "A mythic should be basically impossible to beat, like 5-10% odds for a party of 3" (the owner, Nov 21; balance plan
//   section 4, M1): the mixed party at S's first level wins 5 to 10% of fights against one mythic alone, one row for
//   each archetype, so the kind holds whatever the body.
// - "front hunter": the first hunter of the party's line, the one the pack reaches first; "goes down" is read as dies.
// - "Fatigue over three fights of 6 rounds": a party of the five builds against two same-rank bosses, ended by the GM at
//   6 rounds, three times, with HP back to full and 55 fatigue back between fights (`RULES.fight.fightRest`) and no mana
//   back. "No build is at its capacity before the third fight" is read as at most 1 dungeon in 20; "the fastest is" as
//   the speed build at its capacity by the end of the third fight in at least half of them.
// - "A cannon casts 2 or 3 major casts a dungeon and none after": the blasts a fresh cannon's mana pays for by the rules'
//   own cost check (`blastsAllowed`), as mana comes back only on a clear. The blasts a careful cannon cast are printed.
// - "A channel of 5 turns completes in N% of tries": of the channels begun, the share released at full charge. The
//   unprotected bound reads only channels begun while the boss aimed at the channeler (a cannon that begins on its first
//   turn under fire); channels begun while it aimed elsewhere are printed.
// - "Staggers in a boss fight: 1 or 2": the mean count of staggers in the party's boss fight.
// - "The best single use with no channel": the mean HP a same-rank tank loses to one use of each build's abilities,
//   reaction roll and crit included, over 400 uses; the row is the largest of them.
// - Penetration's fairness (balance plan section 9, P1 and P2): one build of the mixed party spends one item of its tier's
//   middle budget all on its main stat, on percent or on flat penetration of its pair (the bruiser armor, the cannon
//   magic), the other build on its main stat (`spending`). Each pair is its own row, so a row names the pair that misses.
//   P1 is the paired difference in rounds on the same seeds, at the boss whose thick defence the pair counters: the
//   brute boss (armor) for the armor pair, a warded caster boss (resist) for the magic pair. "More than 25% faster" is
//   the main stat's rounds over the variant's, the larger of the two variants.
// - The party's control (P3): the share of the fight's time the boss's turn was pushed by the tank's stun (a hold of a
//   round, `abilities().stun`, which adds its length to the boss's next turn: timeline.ts `stunned`), a stagger's push apart. No built-in skill holds, so the stun is the plain one. The tank
//   uses it whenever it is ready and the boss acts before the tank's next turn (`controlPolicy`), before a taunt.
import { fightId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { recordSteps, simTest, workBudget } from './models/sim-budget.ts';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { RANKS, RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { difficultyFactor } from '../src/core/gates/difficulty.ts';
import type { DifficultyLevel } from '../src/core/gates/difficulty.ts';
import { gateFoeScale } from '../src/core/gates/party-scale.ts';
import { place } from '../src/core/combat/space.ts';
import { isDamage } from '../src/core/combat/damage-type.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Fight } from '../src/core/combat/fight.ts';
import { diceOf } from '../src/core/formula.ts';
import type { Place } from '../src/core/combat/space.ts';
import { BUILDS, KIT_BUILDS, MONSTER_ABILITY, PLAIN_OF, SIM_RANKS, abilities, answering, blastsAllowed, controlPolicy, geared, gearedAt, hunter, monster, playDungeon, playFight, rng, scripted, scriptsOff, scriptsOn, spending, turnsPolicy, wave2, weaponOrStat, withApex } from './models/fight-sim.ts';
import type { Archetype, FightRecord, KitBuild, PenBuild, PenSpend, Plan, SimRow } from './models/fight-sim.ts';
import { piece, weaponWeight } from '../src/core/registry/items.ts';
import type { ArmorSlot } from '../src/core/registry/items.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import type { GearPiece } from '../src/core/hunter/derive.ts';
import { modified } from '../src/core/combat/effect-ops.ts';
import { MYTHICS, MYTHIC_IDS, omensOf } from '../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../src/core/registry/mythics.ts';
import { ANSWERS, answerOutcome } from '../src/core/combat/mythic.ts';
import type { Answer } from '../src/core/combat/mythic.ts';
import { monsterRows, hunterRow } from '../src/core/combat/rows.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { Status } from '../src/core/combat/effect-ops.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import type { Archetype as MonsterArchetype } from '../src/core/hunter/derive.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { freshSave, makeHunter } from '../src/core/save.ts';
import type { StatPoints } from '../src/core/hunter/progress.ts';
import { earnClass } from '../src/core/hunter/classes.ts';
import { refill } from '../src/core/hunter/vitals.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { DEFAULT_OFFER_POOL } from '../src/core/hunter/class-offer.ts';
import { jobFocus } from '../src/core/registry/jobs.ts';
import type { UniqueClassName } from '../src/core/registry/jobs.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Policy } from './models/fight-sim.ts';
import { HEMO_VESSELS_12, bladefiendPolicy, buildCRankHemomancerRow, hemomancerPolicy, rifthunterPolicy } from './fixtures/mythic-hunters.ts';
import { ACT1_AT, act1BareParty, act1SampleParty, act1WaveFoes, advanceHunter, missionPolicy } from './fixtures/act1.ts';
import { dev } from './fixtures/ids.ts';

// ── the setups ──
const once = <T>(make: () => T): (() => T) => { let v: T | undefined; return () => (v ??= make()); };
const foe = (s: SimRow): SimRow => ({ ...s, row: { ...s.row, side: 'foe' } });
const at = (s: SimRow, p: Place | null): SimRow => ({ ...s, row: { ...s.row, place: p } });
/** Where a duel starts: the default lines, 8 tiles apart, or side by side. */
type Opening = 'lines' | 'adjacent';
const OPENINGS: readonly Opening[] = ['lines', 'adjacent'];
const START: { readonly [O in Opening]: readonly [Place | null, Place | null] } = { lines: [null, null], adjacent: [place(0, 2), place(0, 3)] };
const duel = (a: Archetype, b: Archetype, rank: Rank, opening: Opening = 'lines') => {
  const rows = once(() => [at(hunter(a, rank), START[opening][0]), at(foe(hunter(b, rank, a === b ? `${b}-foe` : b)), START[opening][1])]);
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const pack = (rank: Rank) => [1, 2, 3].map(i => monster(rank, 'brute', 'normal', `brute-${i}`));
/** A pack that can hurt (decision 5): two skirmishers that shoot from range and an elite brute. */
const hurtingPack = (rank: Rank) => [monster(rank, 'brute', 'elite', 'elite'), monster(rank, 'skirmisher', 'normal', 'skirmisher-1'), monster(rank, 'skirmisher', 'normal', 'skirmisher-2')];
const MIXED: readonly Archetype[] = ['tank', 'bruiser', 'cannon'];
const party = (ids: readonly Archetype[], rank: Rank): SimRow[] => ids.map((a, i) => hunter(a, rank, ids.indexOf(a) === i ? a : `${a}-${i}`));
const vsPack = (ids: readonly Archetype[], rank: Rank, tallyDamage = false) => {
  const rows = once(() => [...party(ids, rank), ...pack(rank)]);
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage }, seed)];
};
const vsHurtingPack = (ids: readonly Archetype[], rank: Rank) => {
  const rows = once(() => [...party(ids, rank), ...hurtingPack(rank)]);
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const vsBoss = (ids: readonly Archetype[], rank: Rank, channel: Plan['channel'] = 'none', tallyDamage = false) => {
  const rows = once(() => [...party(ids, rank), monster(rank, 'brute', 'boss', 'boss')]);
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), plan: { channel }, tallyDamage }, seed)];
};
const FIVE: readonly Archetype[] = ['speed', 'tank', 'cannon', 'bruiser', 'support'];
const dungeon = (rank: Rank) => {
  const rows = once(() => [...party(FIVE, rank), monster(rank, 'brute', 'boss', 'boss-1'), monster(rank, 'brute', 'boss', 'boss-2')]);
  return (seed: number): FightRecord[] => playDungeon(() => ({ rows: rows(), endAtRounds: 6, tallyDamage: false }), seed, 3);
};

type Play = (seed: number) => FightRecord[];
const cache = new Map<string, FightRecord[][]>();
/** Every run of a setup, played once and shared by the rows that read it. */
function runsOf(key: string, play: Play, runs: number): FightRecord[][] {
  const k = `${key}/${runs}`;
  if (!cache.has(k)) cache.set(k, Array.from({ length: runs }, (_, i) => play(1 + i)));
  return cache.get(k)!;
}

// ── measures ──
type Measure = { value: number; se: number; note: string };
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: readonly number[]): number => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const share = (xs: readonly boolean[]): Measure => {
  const p = xs.filter(Boolean).length / xs.length;
  return { value: p, se: Math.sqrt(p * (1 - p) / xs.length), note: '' };
};
const avg = (xs: readonly number[]): Measure => ({ value: mean(xs), se: sd(xs) / Math.sqrt(xs.length), note: '' });
const ratio = (a: Measure, b: Measure): Measure => {
  if (a.value === 0 && b.value === 0) return { value: NaN, se: NaN, note: 'neither dies' };
  const r = a.value / b.value;
  return { value: r, se: Math.abs(r) * Math.sqrt((a.se / a.value) ** 2 + (b.se / b.value) ** 2), note: `${fmt(a.value)} over ${fmt(b.value)}` };
};
const fmt = (n: number): string => Number.isFinite(n) ? (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(3)) : Number.isNaN(n) ? 'none' : 'no limit';
const capNote = (runs: FightRecord[][]): string => {
  const c = runs.flat().filter(r => r.capped).length;
  return c ? `${c} fights hit the cap` : '';
};
const wins = (key: string, play: Play, runs: number, side: 'party' | 'foe' = 'party'): Measure => {
  const rs = runsOf(key, play, runs);
  return { ...share(rs.map(r => r[0]!.winner === side)), note: [capNote(rs), `mean ${mean(rs.map(r => r[0]!.rounds)).toFixed(1)} rounds`].filter(Boolean).join('; ') };
};
/**
 * The first build's share of wins, the mean of the two openings (decision 6 of round three: the bound is on the mean).
 * Each opening is printed beside it with its own standard error and no bound: who wins from which distance is for a GM
 * to read, and at the table the party decides the distance.
 */
const bothOpenings = (a: Archetype, b: Archetype, rank: Rank, runs: number): Measure => {
  const ms = OPENINGS.map(o => wins(`${a} v ${b} ${rank} ${o}`, duel(a, b, rank, o), runs));
  return {
    value: mean(ms.map(m => m.value)), se: Math.sqrt(ms.reduce((n, m) => n + m.se ** 2, 0)) / ms.length,
    note: `each opening, no bound: ${OPENINGS.map((o, i) => `${o} ${fmt(ms[i]!.value)} (se ${fmt(ms[i]!.se)}, ${ms[i]!.note})`).join(', ')}`,
  };
};
const rounds = (key: string, play: Play, runs: number, won = false): Measure => {
  const rs = runsOf(key, play, runs).map(r => r[0]!).filter(r => !won || r.winner === 'party');
  return { ...avg(rs.map(r => r.rounds)), note: `${rs.filter(r => r.winner === 'party').length} of ${runs} won` };
};
const anyDead = (key: string, play: Play, runs: number): Measure => share(runsOf(key, play, runs).map(r => r[0]!.dead.length > 0));
/** Of the channels begun (all, or only those begun while the boss aimed at the channeler), the share released at full charge. */
const completes = (key: string, play: Play, runs: number, which: 'all' | 'aimed' | 'elsewhere' = 'all'): Measure => {
  const rs = runsOf(key, play, runs).map(r => r[0]!.channels);
  const of = (c: FightRecord['channels']) => which === 'all' ? [c.begun, c.completed] : which === 'aimed' ? [c.aimed.begun, c.aimed.completed] : [c.begun - c.aimed.begun, c.completed - c.aimed.completed];
  const begun = rs.reduce((n, c) => n + of(c)[0]!, 0), done = rs.reduce((n, c) => n + of(c)[1]!, 0), p = begun ? done / begun : NaN;
  return { value: p, se: Math.sqrt(p * (1 - p) / begun), note: `${begun} channels begun in ${runs} fights, ${rs.reduce((n, c) => n + c.broken, 0)} broken in all` };
};
const frontDead = (key: string, play: Play, runs: number, front: string): Measure => share(runsOf(key, play, runs).map(r => r[0]!.dead.includes(front)));

/** The builds of design section 2 and the status build, before the kits. */
const PLAIN_BUILDS = (Object.keys(BUILDS) as Archetype[]).filter(a => !(KIT_BUILDS as readonly string[]).includes(a));
/** The mean HP a same-rank tank loses to one use, as a share of its max HP, for every ability of `builds` but a channel. */
function bestUse(rank: Rank, uses: number, builds: readonly Archetype[] = PLAIN_BUILDS): Measure {
  const results: { label: string; m: Measure }[] = [];
  for (const a of builds) {
    const user = hunter(a, rank, 'user'), tank = foe(hunter('tank', rank, 'tank'));
    for (const ability of user.row.abilities) {
      // a channel, and a use with a price (Violence spends Pain it holds none of here), are not single uses on a fresh body
      if (ability.channel || ability.prices || !ability.effect || !isDamage(ability.effect.type)) continue;
      const gap = ability.range <= 1 ? 1 : 4;
      const rows = [{ ...user.row, place: place(5, 5) }, { ...tank.row, place: place(5, 5 + gap) }];
      const ctx = { rules: RULES };
      let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('use'), rows, openings: [] }, ctx).fight;
      f = reduce(f, { type: 'start', openings: [{ id: rows[0]!.id, d20: 20, tie: 2 }, { id: rows[1]!.id, d20: 1, tie: 1 }] }, ctx).fight;
      const g = rng(rank.charCodeAt(0) * 1000 + ability.id.length);
      const lost: number[] = [];
      for (let i = 0; i < uses; i++) {
        const running = f as Extract<Fight, { phase: 'running' }>;
        const dice = diceOf(formulaOf(ability, RULES)!).map(d => Array.from({ length: d.count }, () => g.int(1, d.sides)).reduce((x, y) => x + y, 0));
        const aim = ability.aim === 'place' ? running.rows[1]!.place : running.rows[1]!.id;
        const r = reduce(running, { type: 'act', by: running.rows[0]!.id, ability: ability.id, aim, rolls: { dice: { [running.rows[1]!.id]: dice }, react: { [running.rows[1]!.id]: g.int(1, 20) } }, force: true }, ctx);
        recordSteps(1);
        if (r.effects.some(e => e.type === 'refused')) throw new Error(`${a} ${ability.id} refused at ${rank}`);
        const after = r.fight!.rows.find(x => x.id === running.rows[1]!.id)!;
        lost.push((rowHp(running.rows[1]!) - rowHp(after)) / running.rows[1]!.sheet.hpMax);
      }
      results.push({ label: `${a} ${ability.id}`, m: avg(lost) });
    }
  }
  const best = results.sort((x, y) => y.m.value - x.m.value)[0]!;
  return { ...best.m, note: `${best.label}; next ${results[1]!.label} ${fmt(results[1]!.m.value)}` };
}

// ── the rows ──
type Row = { name: string; setup: string; runs: number; measure: () => Measure; low: number; high: number; lever: string };
const RUNS = { even: 400, tenth: 150, quarter: 300, twentieth: 100, mythic: 600 } as const;
/** The triangle's three sides: who should win, against whom (decision 1). */
const SIDES: readonly (readonly [Archetype, Archetype, string])[] = [
  ['speed', 'cannon', 'the builds, the policies, the blast (wind-up, radius, mana)'],
  ['tank', 'speed', 'the builds, the policies, a flat part of armor, the heavy kit'],
  ['cannon', 'tank', 'the heavy kit\'s resist, penetration'],
];
const triangle = (rank: Rank): Row[] => SIDES.map(([a, b, lever]) => ({
  name: `${a} beats ${b} one on one at ${rank}`, setup: `${a} v ${b} ${rank}`, runs: 2 * RUNS.even,
  measure: () => bothOpenings(a, b, rank, RUNS.even), low: 0.6, high: 0.9, lever,
}));
const atE: Row[] = SIDES.map(([a, b]) => ({
  name: `${a} against ${b} wins 25 to 75% at E`, setup: `${a} v ${b} E`, runs: 2 * RUNS.even,
  measure: () => bothOpenings(a, b, 'E', RUNS.even), low: 0.25, high: 0.75, lever: 'creationPoints',
}));
const partyRows = (rank: Rank): Row[] => [
  { name: `the mixed party clears a same-rank pack in 2 to 5 rounds at ${rank}`, setup: `mixed v pack ${rank}`, runs: RUNS.tenth, measure: () => rounds(`mixed v pack ${rank}`, vsPack(MIXED, rank, rank === 'C'), RUNS.tenth), low: 2, high: 5, lever: 'kinds.normal' },
  { name: `a hunter dies in at most 1 pack fight in 10 at ${rank}`, setup: `mixed v pack ${rank}`, runs: RUNS.tenth, measure: () => anyDead(`mixed v pack ${rank}`, vsPack(MIXED, rank, rank === 'C'), RUNS.tenth), low: 0, high: 0.1, lever: 'kinds.normal' },
  { name: `the mixed party beats a same-rank boss in 4 to 8 rounds at ${rank}`, setup: `mixed v boss ${rank}`, runs: RUNS.quarter, measure: () => rounds(`mixed v boss ${rank}`, vsBoss(MIXED, rank), RUNS.quarter), low: 4, high: 8, lever: 'kinds.boss' },
  { name: `a hunter dies in under 1 boss fight in 20 at ${rank}`, setup: `mixed v boss ${rank}`, runs: RUNS.quarter, measure: () => anyDead(`mixed v boss ${rank}`, vsBoss(MIXED, rank), RUNS.quarter), low: 0, high: 0.05, lever: 'kinds.boss' },
  { name: `a boss fight has 1 or 2 staggers at ${rank}`, setup: `mixed v boss ${rank}`, runs: RUNS.quarter, measure: () => avg(runsOf(`mixed v boss ${rank}`, vsBoss(MIXED, rank), RUNS.quarter).map(r => r[0]!.staggers)), low: 1, high: 2, lever: 'kinds.boss.stagger and staggerRegrow' },
  { name: `three speed builds clear a pack that can hurt no faster than the mixed party at ${rank}`, setup: `speed v hurting pack ${rank}`, runs: RUNS.tenth,
    measure: () => ratio(rounds(`speed v hurting pack ${rank}`, vsHurtingPack(['speed', 'speed', 'speed'], rank), RUNS.tenth, true), rounds(`mixed v hurting pack ${rank}`, vsHurtingPack(MIXED, rank), RUNS.tenth, true)), low: 1, high: Infinity, lever: 'cost.quick (the quick share 0.7)' },
  { name: `the speed party's front hunter dies at least twice as often as the mixed party's against a pack that can hurt at ${rank}`, setup: `speed v hurting pack ${rank}`, runs: RUNS.tenth,
    measure: () => ratio(frontDead(`speed v hurting pack ${rank}`, vsHurtingPack(['speed', 'speed', 'speed'], rank), RUNS.tenth, 'speed'), frontDead(`mixed v hurting pack ${rank}`, vsHurtingPack(MIXED, rank), RUNS.tenth, 'tank')), low: 2, high: Infinity, lever: 'cost.quick (the quick share 0.7)' },
];
// ── the kits (kits design 3.2) ──
/** Opponents a kit is weighed against: the triangle's three. */
const TRIANGLE: readonly Archetype[] = ['speed', 'tank', 'cannon'];
const KIT_RUNS = RUNS.even / 2;
/** A kit's share of duels won against `opp` less its plain build's, the mean of the two openings each. */
const kitOverPlain = (kit: KitBuild, opp: Archetype, rank: Rank): Measure => {
  const k = bothOpenings(kit, opp, rank, KIT_RUNS), p = bothOpenings(PLAIN_OF[kit], opp, rank, KIT_RUNS);
  return { value: k.value - p.value, se: Math.sqrt(k.se ** 2 + p.se ** 2), note: `kit ${fmt(k.value)}, plain ${fmt(p.value)}` };
};
const KIT_LEVER: { readonly [K in KitBuild]: string } = { blood: 'kit.examples.blood (share, burst)', mark: 'kit.examples.mark (share, burst)', pain: 'kit.examples.pain (perStack, spendAt)', summoner: 'summonRounds' };
const kitDuels = (rank: Rank): Row[] => (['blood', 'mark', 'pain'] as const).flatMap(kit => TRIANGLE.map((opp): Row => ({
  name: `the ${kit} kit against ${opp} wins within ${RULES.fight.kit.tolerance} of its plain build at ${rank}`, setup: `${kit} v ${opp} ${rank}`, runs: 4 * KIT_RUNS,
  measure: () => kitOverPlain(kit, opp, rank), low: -RULES.fight.kit.tolerance, high: RULES.fight.kit.tolerance, lever: KIT_LEVER[kit],
})));
const BLOOD_PARTY: readonly Archetype[] = ['tank', 'bruiser', 'blood'];
/** Damage to foes per use of one ability of `who` (a threshold it set off counted with it), over every fight of a setup. */
const perUse = (rs: FightRecord[][], who: string, ability: string): number => {
  const t = rs.map(r => r[0]!.tally[who]!);
  return t.reduce((n, x) => n + (x.byAct[ability] ?? 0), 0) / Math.max(1, t.reduce((n, x) => n + (x.acts[ability] ?? 0), 0));
};
const kitRows = (rank: Rank): Row[] => [
  ...kitDuels(rank),
  { name: `a party with the blood kit in place of the cannon beats a same-rank boss in 4 to 8 rounds at ${rank}`, setup: `blood party v boss ${rank}`, runs: RUNS.quarter,
    measure: () => rounds(`blood party v boss ${rank}`, vsBoss(BLOOD_PARTY, rank), RUNS.quarter), low: 4, high: 8, lever: 'kit.scalerStart' },
  { name: `a party with the blood kit in place of the cannon clears a same-rank pack in 2 to 5 rounds at ${rank}`, setup: `blood party v pack ${rank}`, runs: RUNS.tenth,
    measure: () => rounds(`blood party v pack ${rank}`, vsPack(BLOOD_PARTY, rank), RUNS.tenth), low: 2, high: 5, lever: 'kit.scalerStart' },
  { name: `the kits' best single use takes at most 60% of a same-rank tank's HP at ${rank}`, setup: `kits one use ${rank}`, runs: 400,
    measure: () => bestUse(rank, 400, KIT_BUILDS), low: 0, high: 0.6, lever: 'kit.examples' },
];
const KIT_ROWS: readonly Row[] = [
  ...kitRows('C'), ...kitRows('S'),
  { name: 'the mark caster in a pack deals per use at most a blast\'s damage per standard action of time at C', setup: 'mark v pack C', runs: RUNS.tenth,
    measure: () => {
      const mark = runsOf('mark party v pack C', vsPack(['tank', 'bruiser', 'mark'], 'C', true), RUNS.tenth), cannon = runsOf('mixed v pack C', vsPack(MIXED, 'C', true), RUNS.tenth);
      const stroke = perUse(mark, 'mark', 'disaster-stroke'), blast = perUse(cannon, 'cannon', 'blast') / (RULES.fight.cost.heavy / RULES.fight.cost.standard);
      return { value: stroke / blast, se: 0, note: `a stroke ${fmt(stroke)} (its marks' bursts with it), a blast ${fmt(blast)} a standard action` };
    }, low: 0, high: 1, lever: 'kit.examples.mark.burst' },
  { name: 'a party with a summoner beats a same-rank boss in 4 to 8 rounds, its sprite keeping no side up, at C', setup: 'summoner v boss C', runs: RUNS.quarter,
    measure: () => {
      const m = rounds('summoner v boss C', vsBoss(['tank', 'bruiser', 'summoner'], 'C'), RUNS.quarter);
      return { ...m, note: `${m.note}; ${runsOf('summoner v boss C', vsBoss(['tank', 'bruiser', 'summoner'], 'C'), RUNS.quarter).filter(r => r[0]!.capped).length} capped` };
    }, low: 4, high: 8, lever: 'summonRounds' },
  { name: 'the pain kit\'s Violence in a boss fight at C (measured, no bound)', setup: 'pain v boss C', runs: RUNS.quarter,
    measure: () => {
      const rs = runsOf('pain v boss C', vsBoss(['tank', 'pain', 'cannon'], 'C', 'none', true), RUNS.quarter);
      return { ...avg(rs.map(r => r[0]!.tally.pain!.acts.violence ?? 0)), note: `${fmt(perUse(rs, 'pain', 'violence'))} a Violence, ${fmt(perUse(rs, 'pain', 'attack'))} a strike` };
    }, low: 0, high: Infinity, lever: 'kit.examples.pain' },
];

// ── wave 2 (kits design 8.10) ──
const W2 = wave2();
/** A hunter of `a` with an extra ability, armed with it when it is a reaction, a worn status, or another policy. */
const withW2 = (s: SimRow, o: { add?: typeof W2.parry; worn?: ReturnType<typeof W2.bowExpert>; policy?: SimRow['policy'] }): SimRow => ({
  row: { ...s.row, abilities: o.add ? [...s.row.abilities, o.add] : s.row.abilities, statuses: o.worn ? [...s.row.statuses, o.worn] : s.row.statuses,
    ...(o.add?.react ? { armed: { ability: o.add.id, on: null, spent: false } } : {}) },
  policy: o.policy ?? s.policy,
});
const duelOf = (key: string, first: (rank: Rank) => SimRow, b: Archetype, rank: Rank, runs: number): Measure => {
  const ms = OPENINGS.map(o => {
    const rows = once(() => [at(first(rank), START[o][0]), at(foe(hunter(b, rank)), START[o][1])]);
    return wins(`${key} v ${b} ${rank} ${o}`, (seed: number) => [playFight({ rows: rows(), tallyDamage: false }, seed)], runs);
  });
  return { value: mean(ms.map(m => m.value)), se: Math.sqrt(ms.reduce((n, m) => n + m.se ** 2, 0)) / ms.length, note: '' };
};
/** A build with a wave 2 block, less its plain build, the mean of the two openings, against `b` at `rank`. */
const overPlain = (key: string, a: Archetype, first: (rank: Rank) => SimRow, b: Archetype, rank: Rank): Measure => {
  const k = duelOf(key, first, b, rank, KIT_RUNS), p = bothOpenings(a, b, rank, KIT_RUNS);
  return { value: k.value - p.value, se: Math.sqrt(k.se ** 2 + p.se ** 2), note: `with it ${fmt(k.value)}, plain ${fmt(p.value)}` };
};
const parrying = (rank: Rank) => withW2(hunter('speed', rank), { add: W2.parry });
const bowExpert = (rank: Rank) => withW2(hunter('speed', rank), { worn: W2.bowExpert() });
/** The mixed party against a boss that holds a damage-taken curse of +100% all fight: the cap of 1.5, which a boss takes in full as any body (the owner, Nov 21). */
const vsCursedBoss = (rank: Rank) => {
  const rows = once(() => {
    const boss = monster(rank, 'brute', 'boss', 'boss');
    return [...party(MIXED, rank), { ...boss, row: { ...boss.row, statuses: [W2.exposed(100)] } }];
  });
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
/** The mixed party whose bruiser holds Surge and Transfer (its turn given to the cannon), against a boss. */
const vsBossTurns = (rank: Rank) => {
  const rows = once(() => {
    const [tank, bruiser, cannon] = party(MIXED, rank), b = withW2(bruiser!, { add: W2.surge, policy: turnsPolicy });
    return [tank!, { ...b, row: { ...b.row, abilities: [...b.row.abilities, W2.transfer] } }, cannon!, monster(rank, 'brute', 'boss', 'boss')];
  });
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const W2_ROWS: readonly Row[] = [
  ...(['C', 'S'] as const).flatMap(rank => (['tank', 'bruiser'] as const).map((opp): Row => ({
    name: `the speed build with Parry armed all fight against the ${opp} wins within ${RULES.fight.kit.tolerance} of without at ${rank}`, setup: `parry v ${opp} ${rank}`, runs: 4 * KIT_RUNS,
    measure: () => overPlain('parry', 'speed', parrying, opp, rank), low: -RULES.fight.kit.tolerance, high: RULES.fight.kit.tolerance, lever: 'kit.parry',
  }))),
  ...(['C', 'S'] as const).map((rank): Row => ({
    name: `a party beats a same-rank boss that holds a damage-taken curse all fight in 4 to 8 rounds at ${rank}`, setup: `party v cursed boss ${rank}`, runs: RUNS.quarter,
    measure: () => rounds(`party v cursed boss ${rank}`, vsCursedBoss(rank), RUNS.quarter), low: 4, high: 8, lever: 'kit.shareCap and kinds.boss.hp',
  })),
  ...(['C', 'S'] as const).map((rank): Row => ({
    name: `a party with Transfer and an extra action a round beats a same-rank boss in 4 to 8 rounds at ${rank}`, setup: `party with turns v boss ${rank}`, runs: RUNS.quarter,
    measure: () => rounds(`party with turns v boss ${rank}`, vsBossTurns(rank), RUNS.quarter), low: 4, high: 8, lever: 'kit.extraPerRound',
  })),
  ...TRIANGLE.filter(o => o !== 'speed').map((opp): Row => ({
    name: `the speed build with a worn attack edge (Bow Expert) against the ${opp} at C, less without (measured, no bound)`, setup: `bow expert v ${opp} C`, runs: 4 * KIT_RUNS,
    measure: () => overPlain('bow expert', 'speed', bowExpert, opp, 'C'), low: -Infinity, high: Infinity, lever: 'the maker\'s warning (a worn edge is past the tolerance)',
  })),
];

// ── penetration and control against a boss tough by its body (balance plan section 9, rows P1 to P3) ──
/**
 * The fights P1 and P2 read: a same-rank pack of three normal brutes (armor 39/46) for the armor pair, three normal
 * casters (resist 15) for the magic pair (a normal brute's resist 5 caps flat magic pen at 5 while capped percent pen
 * spills leftover budget into Power), a same-rank brute boss (armor 58/69), and a warded caster boss (resist 34).
 */
type PenFight = 'pack' | 'casterPack' | 'boss' | 'warded';
const PEN_FOES: { readonly [F in PenFight]: (rank: Rank) => SimRow[] } = {
  pack,
  casterPack: rank => [1, 2, 3].map(i => monster(rank, 'caster', 'normal', `caster-${i}`)),
  boss: rank => [monster(rank, 'brute', 'boss', 'boss')],
  warded: rank => [monster(rank, 'caster', 'boss', 'boss', RULES, ['warded'])],
};
const PEN_RUNS: { readonly [F in PenFight]: number } = { pack: RUNS.tenth, casterPack: RUNS.tenth, boss: RUNS.quarter, warded: RUNS.quarter };
/**
 * Each build that spends an item on a penetration, the pair it holds, and the boss and pack P1 reads the pair on:
 * the brute pair for the bruiser's armor, and the caster pair for the cannon's magic (matching `itemBudget.penFoe`).
 */
const PAIRS: readonly (readonly [PenBuild, string, PenFight, string, PenFight, string])[] = [
  ['bruiser', 'armor', 'boss', 'boss', 'pack', 'pack'],
  ['cannon', 'magic', 'warded', 'warded caster boss', 'casterPack', 'caster pack'],
];
/** The mixed party with `who` spending one item of its tier's middle budget `spend`'s way and the other build on its main stat. */
const spendKey = (who: PenBuild, spend: PenSpend, fight: PenFight, rank: Rank): string => `spend ${spend === 'main' ? 'main' : `${who} ${spend}`} v ${fight} ${rank}`;
const spendRuns = (who: PenBuild, spend: PenSpend, fight: PenFight, rank: Rank): FightRecord[][] => {
  const rows = once(() => [hunter('tank', rank), spending('bruiser', rank, who === 'bruiser' ? spend : 'main'), spending('cannon', rank, who === 'cannon' ? spend : 'main'), ...PEN_FOES[fight](rank)]);
  return runsOf(spendKey(who, spend, fight, rank), (seed: number) => [playFight({ rows: rows(), tallyDamage: false }, seed)], PEN_RUNS[fight]);
};
/** The rounds `slow` takes over those `fast` takes, fight by fight on the same seeds (the paired difference and its error). */
const roundsOver = (slow: FightRecord[][], fast: FightRecord[][]): Measure => {
  const d = slow.map((r, i) => r[0]!.rounds - fast[i]![0]!.rounds);
  return { ...avg(d), note: `${fmt(mean(slow.map(r => r[0]!.rounds)))} over ${fmt(mean(fast.map(r => r[0]!.rounds)))} rounds` };
};
/** How much faster the quicker penetration clears than the main stat: the main stat's rounds over the variant's, the larger. */
const fasterThanMain = (who: PenBuild, fight: PenFight, rank: Rank): Measure => {
  const rounds = (spend: PenSpend): Measure => avg(spendRuns(who, spend, fight, rank).map(r => r[0]!.rounds));
  const main = rounds('main'), [pct, flat] = [ratio(main, rounds('percent')), ratio(main, rounds('flat'))];
  return { ...(pct.value >= flat.value ? pct : flat), note: `main over percent ${fmt(pct.value)}, over flat ${fmt(flat.value)}` };
};
/** The mixed party whose tank holds a control (a stun of a round, `abilities().stun`) and uses it (`controlPolicy`), against a boss. */
const vsBossControlled = (rank: Rank) => {
  const rows = once(() => {
    const [tank, bruiser, cannon] = party(MIXED, rank);
    return [{ row: { ...tank!.row, abilities: [...tank!.row.abilities, abilities().stun] }, policy: controlPolicy }, bruiser!, cannon!, monster(rank, 'brute', 'boss', 'boss')];
  });
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const PEN_LEVER = 'itemBudget.penFoe, fight.penMax, the kinds\' armor and resist';
const PEN_ROWS: readonly Row[] = (['C', 'S'] as const).flatMap(rank => [
  ...PAIRS.flatMap(([who, pair, boss, bossWords, packFight, packWords]): Row[] => [
    { name: `against a same-rank ${bossWords} the ${who}'s ${pair} penetration clears in fewer rounds as percent than as flat at ${rank}`, setup: spendKey(who, 'flat', boss, rank), runs: 2 * PEN_RUNS[boss],
      measure: () => roundsOver(spendRuns(who, 'flat', boss, rank), spendRuns(who, 'percent', boss, rank)), low: 0, high: Infinity, lever: PEN_LEVER },
    { name: `against a same-rank ${packWords} the ${who}'s ${pair} penetration clears in fewer rounds as flat than as percent at ${rank}`, setup: spendKey(who, 'flat', packFight, rank), runs: 2 * PEN_RUNS[packFight],
      measure: () => roundsOver(spendRuns(who, 'percent', packFight, rank), spendRuns(who, 'flat', packFight, rank)), low: 0, high: Infinity, lever: PEN_LEVER },
    ...([[packFight, packWords], [boss, bossWords]] as const).map(([fight, words]): Row => ({
      name: `neither penetration of the ${who} clears a same-rank ${words} more than 25% faster than its main stat at ${rank}`, setup: spendKey(who, 'main', fight, rank), runs: 3 * PEN_RUNS[fight],
      measure: () => fasterThanMain(who, fight, rank), low: 0, high: 1.25, lever: PEN_LEVER,
    })),
  ]),
  { name: `the party's control takes 10 to 35% of a same-rank boss's turns, stagger counted apart, at ${rank}`, setup: `control v boss ${rank}`, runs: RUNS.quarter,
    measure: () => {
      const rs = runsOf(`control v boss ${rank}`, vsBossControlled(rank), RUNS.quarter).map(r => r[0]!);
      const stuns = rs.reduce((n, r) => n + (r.tally.tank!.acts.stun ?? 0), 0), held = rs.reduce((n, r) => n + (r.held.boss ?? 0), 0);
      return { ...avg(rs.map(r => (r.held.boss ?? 0) / r.ticks)), note: `${fmt(stuns / rs.length)} stuns a fight, each holding ${fmt(held / stuns / RULES.fight.round)} rounds, ${fmt(mean(rs.map(r => r.rounds)))} rounds` };
    }, low: 0.1, high: 0.35, lever: 'the party\'s control (abilities().stun) and Tenacity' },
]);

/** The geared mixed party (six middle items) at S against one same-rank mythic of `archetype` (balance plan section 4, row M1, retuned t157u). */
const gearedPartyOf = (ids: readonly Archetype[], rank: Rank, R = RULES): SimRow[] =>
  ids.map((a, i) => geared(a, rank, ids.indexOf(a) === i ? a : `${a}-${i}`, R));
const vsMythic = (archetype: MonsterArchetype) => {
  const rows = once(() => [...gearedPartyOf(MIXED, 'S'), monster('S', archetype, 'mythic', 'mythic')]);
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const MONSTER_ARCHETYPES = Object.keys(RULES.fight.archetypes) as MonsterArchetype[];


// ── a mythic's script (notes-11-keystones.md, design B.8): rows B1 to B9 ──
// The party is row M1's geared mixed party at S, its tank holding P3's plain stun (`abilities().stun`, which only an omen's
// answer spends: tankPolicy never casts it), each hunter answering a standing omen first (`answering`). Without the stun
// no hunter of the party could land a hold or a root, and the interrupt answer of six omens out of nine would be words.
// Each script plays on its seed's body under scripts on (`scripted`, its HP times the script's `hp`). A row's fights are
// 600 a script, M1's number. Why each bound is what it is: design B.8's table.
const SCRIPTED = scriptsOn();
const answeringParty = (ids: readonly Archetype[], kinds: readonly Answer[]): SimRow[] => gearedPartyOf(ids, 'S', SCRIPTED).map(s =>
  answering(s.row.id === 'tank' ? { ...s, row: { ...s.row, abilities: [...s.row.abilities, abilities(SCRIPTED).stun] } } : s, kinds));
const vsScript = (id: MythicScriptId, kinds: readonly Answer[] = ANSWERS, ids: readonly Archetype[] = MIXED) => {
  const rows = once(() => [...answeringParty(ids, kinds), scripted(id, SCRIPTED)]);
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), rules: SCRIPTED, tallyDamage: false }, seed)];
};
const nameOf = (id: MythicScriptId): string => MYTHICS[id].name;
const B1_KEY = (id: MythicScriptId) => `mixed v ${id} S`;
const b1 = (id: MythicScriptId): FightRecord[] => runsOf(B1_KEY(id), vsScript(id), RUNS.mythic).map(r => r[0]!);
const B4_KEY = (id: MythicScriptId) => `three cannons v ${id} S`;
const THREE_CANNONS: readonly Archetype[] = ['cannon', 'cannon', 'cannon'];
const b4 = (id: MythicScriptId): FightRecord[] => runsOf(B4_KEY(id), vsScript(id, ANSWERS, THREE_CANNONS), RUNS.mythic).map(r => r[0]!);
/** The answer kinds an outcome of the script's data names (B5 bounds each): those of an omen in a phase's rotation whose outcome is not `none`. */
function answersOf(id: MythicScriptId): Answer[] {
  const s = MYTHICS[id], rotated = new Set(s.phases.flatMap(p => p.rotation.flatMap(b => (b.kind === 'omen' ? [b.omen as string] : []))));
  const omens = omensOf(s).filter(([k]) => rotated.has(k)).map(([, o]) => o);
  return ANSWERS.filter(k => omens.some(o => answerOutcome(o, k) !== 'none'));
}
/** The scripts whose phases announce an omen: `plain` announces only its doom, so B3 and B5 skip it. */
const OMENED = MYTHIC_IDS.filter(id => answersOf(id).length > 0);
/**
 * The fights of `rs` in which no phase was skipped (row B2): each phase entered is the one after the last, and every phase
 * before the one the fight ended in had a turn of the mythic's (an announce, an act or a landing). The value is the count
 * of fights that break it.
 */
const skipped = (rs: readonly FightRecord[]): Measure => {
  const bad = rs.filter(r => { const p = r.mythic!.phases; return p.some((x, i) => x.phase !== i || (i < p.length - 1 && x.turns === 0)); });
  return { value: bad.length, se: 0, note: `${rs.length} fights; phases reached ${JSON.stringify(countBy(rs, r => String(r.mythic!.phases.length - 1)))}` };
};
const countBy = <T,>(xs: readonly T[], key: (x: T) => string): Record<string, number> => xs.reduce<Record<string, number>>((o, x) => { const k = key(x); o[k] = (o[k] ?? 0) + 1; return o; }, {});
const median = (xs: readonly number[]): number => { const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
/**
 * Row B7: of the fights the party lost, the share whose first fall came in each phase. The value is the largest share;
 * `floor` reads the least, against its phase's floor (10%, a clock phase 5%), as the share less the floor.
 */
const fallsBy = (id: MythicScriptId): { shares: number[]; n: number } => {
  const lost = b1(id).filter(r => r.winner !== 'party' && r.mythic!.firstFall !== null), n = lost.length;
  return { shares: MYTHICS[id].phases.map((_, i) => lost.filter(r => r.mythic!.firstFall === i).length / n), n };
};
const FALL_FLOOR = (id: MythicScriptId, i: number): number => (MYTHICS[id].phases[i]!.ends === 'clock' ? 0.05 : 0.1);
const fallNote = (id: MythicScriptId): string => { const { shares, n } = fallsBy(id); return `${n} lost fights with a fall; by phase ${shares.map(fmt).join(', ')}`; };
const MULTI = MYTHIC_IDS.filter(id => MYTHICS[id].phases.length > 1);
const HP_LEVER = (id: MythicScriptId) => `MYTHICS['${id}'].hp`;

const SCRIPT_ROWS: readonly Row[] = [
  ...MYTHIC_IDS.map((id): Row => ({
    name: `B1 three hunters at S win 5 to 10% of fights against ${nameOf(id)}`, setup: B1_KEY(id), runs: RUNS.mythic,
    measure: () => wins(B1_KEY(id), vsScript(id), RUNS.mythic), low: 0.05, high: 0.1, lever: HP_LEVER(id),
  })),
  ...MYTHIC_IDS.flatMap((id): Row[] => ([['the mixed party', B1_KEY(id), b1], ['three cannons', B4_KEY(id), b4]] as const).map(([who, key, rs]): Row => ({
    name: `B2 against ${who} ${nameOf(id)} enters every phase in order and takes a turn in each before the next`, setup: key, runs: RUNS.mythic,
    measure: () => skipped(rs(id)), low: 0, high: 0, lever: 'the gate (row-life.ts) and the turn start (fight-turn.ts scriptTurn): a number does not move it',
  }))),
  ...OMENED.map((id): Row => ({
    name: `B3 three hunters who answer no omen win under 1% of fights against ${nameOf(id)}`, setup: `${B1_KEY(id)} answering none`, runs: RUNS.mythic,
    measure: () => wins(`${B1_KEY(id)} answering none`, vsScript(id, []), RUNS.mythic), low: 0, high: 0.01, lever: `the omens' hits and answers of ${id}`,
  })),
  ...MYTHIC_IDS.map((id): Row => ({
    name: `B4 three cannons at S meet every phase of ${nameOf(id)} and win at most 15%`, setup: B4_KEY(id), runs: RUNS.mythic,
    measure: () => wins(B4_KEY(id), vsScript(id, ANSWERS, THREE_CANNONS), RUNS.mythic), low: 0, high: 0.15, lever: `MYTHICS['${id}'] (its bands and clocks)`,
  })),
  ...OMENED.flatMap(id => answersOf(id).map((kind): Row => ({
    name: `B5 three hunters who never answer by ${kind} win at most four fifths of B1's share against ${nameOf(id)}`, setup: `${B1_KEY(id)} without ${kind}`, runs: RUNS.mythic,
    measure: () => ratio(wins(`${B1_KEY(id)} without ${kind}`, vsScript(id, ANSWERS.filter(k => k !== kind)), RUNS.mythic), wins(B1_KEY(id), vsScript(id), RUNS.mythic)),
    low: 0, high: 0.8, lever: `the ${kind} answers of ${id}'s omens`,
  }))),
  ...MYTHIC_IDS.map((id): Row => ({
    name: `B6 no fight against ${nameOf(id)} reaches the 40-round cap`, setup: B1_KEY(id), runs: RUNS.mythic,
    measure: () => ({ value: b1(id).filter(r => r.capped).length, se: 0, note: `${b1(id).filter(r => r.mythic!.enraged !== null).length} of ${RUNS.mythic} reached an enraged turn` }),
    low: 0, high: 0, lever: `${id}'s enraged rotation`,
  })),
  ...MYTHIC_IDS.map((id): Row => ({
    name: `B6 the party wins under 1 in 100 of its fights against ${nameOf(id)} once a doom has landed`, setup: B1_KEY(id), runs: RUNS.mythic,
    measure: () => { const doomed = b1(id).filter(r => r.mythic!.dooms > 0); return { ...share(doomed.map(r => r.winner === 'party')), note: `${doomed.length} of ${RUNS.mythic} fights had a doom land` }; },
    low: 0, high: 0.01, lever: `${id}'s doom (its enraged omen's move)`,
  })),
  ...MULTI.flatMap((id): Row[] => [
    { name: `B7 no phase of ${nameOf(id)} holds over 60% of the first falls in the fights the party loses`, setup: B1_KEY(id), runs: RUNS.mythic,
      measure: () => ({ value: Math.max(...fallsBy(id).shares), se: 0, note: fallNote(id) }), low: 0, high: 0.6, lever: `${id}'s phases (their omens and clocks)` },
    { name: `B7 every phase of ${nameOf(id)} holds at least its floor of the first falls (10%, a clock phase 5%)`, setup: B1_KEY(id), runs: RUNS.mythic,
      measure: () => ({ value: Math.min(...fallsBy(id).shares.map((x, i) => x - FALL_FLOOR(id, i))), se: 0, note: `the least share less its floor; ${fallNote(id)}` }), low: 0, high: Infinity, lever: `${id}'s phases (their omens and clocks)` },
  ]),
  ...MYTHIC_IDS.map((id): Row => ({
    name: `B8 a fight against ${nameOf(id)} lasts 10 to 20 rounds at the median`, setup: B1_KEY(id), runs: RUNS.mythic,
    measure: () => ({ value: median(b1(id).map(r => r.rounds)), se: 0, note: `mean ${fmt(mean(b1(id).map(r => r.rounds)))}` }), low: 10, high: 20, lever: `${id}'s clocks`,
  })),
  ...MYTHIC_IDS.map((id): Row => ({
    name: `B9 no keystone pair of three Focused builds moves the share won against ${nameOf(id)} out of 5 to 10%`, setup: `keystones v ${id}`, runs: 0,
    measure: () => { throw new Error('B9 waits for unit K5'); }, low: 0.05, high: 0.1, lever: 'keystone amounts (registry/keystones.ts)',
  })),
];

// ── gate and boss difficulty slider (the owner, Nov 22, QD row 8; retuned for geared parties, t157u): rows D1 to D5 ──
// Routed through `gateFoeScale` at headcount 3 (pinned to exact 1 / 1) so the difficulty rows certify the real app path.
const vsScaledBoss = (rank: Rank, level: DifficultyLevel, archetype: MonsterArchetype = 'brute') => {
  const rows = once(() => {
    const scale = gateFoeScale('boss', rank, level, 3, RULES, archetype);
    return [...gearedPartyOf(MIXED, rank), monster(rank, archetype, 'boss', 'boss', RULES, [], scale)];
  });
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const vsScaledPack = (rank: Rank, level: DifficultyLevel) => {
  const rows = once(() => {
    const scale = gateFoeScale('normal', rank, level, 3, RULES);
    return [...party(MIXED, rank), ...[1, 2, 3].map(i => monster(rank, 'brute', 'normal', `brute-${i}`, RULES, [], scale))];
  });
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const DIFFICULTY_ROWS: readonly Row[] = [
  ...RANKS.map((rank): Row => ({
    name: `D1 three hunters win 68 to 82% against a difficulty 5 boss at ${rank}`, setup: `mixed v boss d5 ${rank}`, runs: RUNS.quarter,
    measure: () => wins(`mixed v boss d5 ${rank}`, vsScaledBoss(rank, 5), RUNS.quarter), low: 0.68, high: 0.82, lever: 'difficulty.boss[4] and difficulty.rankScale',
  })),
  ...(['E', 'C', 'S'] as const).map((rank): Row => ({
    name: `D2 three hunters win 90 to 99% against a difficulty 1 boss at ${rank}`, setup: `mixed v boss d1 ${rank}`, runs: RUNS.quarter,
    measure: () => wins(`mixed v boss d1 ${rank}`, vsScaledBoss(rank, 1), RUNS.quarter), low: 0.90, high: 0.99, lever: 'difficulty.boss[0] and difficulty.rankScale',
  })),
  ...(['E', 'C', 'S'] as const).map((rank): Row => ({
    name: `D3 three hunters win 1 to 10% against a difficulty 10 boss at ${rank}`, setup: `mixed v boss d10 ${rank}`, runs: RUNS.even,
    measure: () => wins(`mixed v boss d10 ${rank}`, vsScaledBoss(rank, 10), RUNS.even), low: 0.01, high: 0.10, lever: 'difficulty.boss[9], rankScale and rankSpread',
  })),
  { name: 'D4 three hunters win 78 to 92% against a difficulty 3 boss at C', setup: 'mixed v boss d3 C', runs: RUNS.quarter,
    measure: () => wins('mixed v boss d3 C', vsScaledBoss('C', 3), RUNS.quarter), low: 0.78, high: 0.92, lever: 'difficulty.boss[2]' },
  { name: 'D4 three hunters win 39 to 55% against a difficulty 7 boss at C', setup: 'mixed v boss d7 C', runs: RUNS.even,
    measure: () => wins('mixed v boss d7 C', vsScaledBoss('C', 7), RUNS.even), low: 0.39, high: 0.55, lever: 'difficulty.boss[6] and rankSpread.C' },
  { name: 'D4 three hunters win 25 to 41% against a difficulty 8 boss at C', setup: 'mixed v boss d8 C', runs: RUNS.even,
    measure: () => wins('mixed v boss d8 C', vsScaledBoss('C', 8), RUNS.even), low: 0.25, high: 0.41, lever: 'difficulty.boss[7] and rankSpread.C' },
  { name: 'D5 a difficulty 10 pack kills a hunter in at least 20% of fights at C', setup: 'mixed v pack d10 C', runs: RUNS.tenth,
    measure: () => anyDead('mixed v pack d10 C', vsScaledPack('C', 10), RUNS.tenth), low: 0.20, high: 1, lever: 'difficulty.pack[9]' },
];

// ── Worldbreaker, the Strength apex (QD row 32, unit row-32): rows W1 to W3 ──
const worldbreakerParty = (rank: Rank): SimRow[] => party(MIXED, rank).map(s => (s.row.id === 'bruiser' ? withApex(s, 'str', rank) : s));
const gearedWorldbreakerParty = (rank: Rank, R = RULES): SimRow[] => gearedPartyOf(MIXED, rank, R).map(s => (s.row.id === 'bruiser' ? withApex(s, 'str', rank, R) : s));
const vsWorldbreakerPack = (rank: Rank) => {
  const rows = once(() => [...worldbreakerParty(rank), ...pack(rank)]);
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const vsWorldbreakerBossD5 = (rank: Rank) => {
  const rows = once(() => {
    const scale = difficultyFactor('boss', rank, 5, RULES);
    return [...gearedWorldbreakerParty(rank), monster(rank, 'brute', 'boss', 'boss', RULES, [], scale)];
  });
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const vsWorldbreakerScript = (id: MythicScriptId) => {
  const rows = once(() => {
    const partyRows = gearedWorldbreakerParty('S', SCRIPTED).map(s => answering(s.row.id === 'tank' ? { ...s, row: { ...s.row, abilities: [...s.row.abilities, abilities(SCRIPTED).stun] } } : s));
    return [...partyRows, scripted(id, SCRIPTED)];
  });
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), rules: SCRIPTED, tallyDamage: false }, seed)];
};
const WORLDBREAKER_MYTHIC_RUNS = 200;
const WORLDBREAKER_ROWS: readonly Row[] = [
  { name: 'W1 Worldbreaker clears a same-rank pack faster than without it at B', setup: 'worldbreaker v pack B', runs: 2 * RUNS.tenth,
    measure: () => roundsOver(runsOf('mixed v pack B', vsPack(MIXED, 'B'), RUNS.tenth), runsOf('worldbreaker v pack B', vsWorldbreakerPack('B'), RUNS.tenth)),
    low: 0.01, high: 0.5, lever: 'KEYSTONES.apex.str (damage, cooldown)' },
  { name: 'W2 Worldbreaker lifts a party against a difficulty 5 boss inside the apex band (78 to 94%) at B', setup: 'worldbreaker v boss d5 B', runs: RUNS.quarter,
    measure: () => wins('worldbreaker v boss d5 B', vsWorldbreakerBossD5('B'), RUNS.quarter),
    low: 0.78, high: 0.94, lever: 'KEYSTONES.apex.str (damage, stagger share, cooldown)' },
  { name: 'W3 Worldbreaker keeps a party\'s mean win share across mythics inside the apex band (6 to 14%) at S', setup: 'worldbreaker v mythics S', runs: MYTHIC_IDS.length * WORLDBREAKER_MYTHIC_RUNS,
    measure: () => {
      const ms = MYTHIC_IDS.map(id => ({ id, m: wins(`worldbreaker v ${id} S`, vsWorldbreakerScript(id), WORLDBREAKER_MYTHIC_RUNS) }));
      return {
        value: mean(ms.map(x => x.m.value)),
        se: Math.sqrt(ms.reduce((n, x) => n + x.m.se ** 2, 0)) / ms.length,
        note: ms.map(x => `${x.id} ${fmt(x.m.value)}`).join(', '),
      };
    },
    low: 0.06, high: 0.14, lever: 'KEYSTONES.apex.str (damage, stagger share, cooldown)' },
];

// ── heavy armor bulk with a 1d8 weapon worn (R3): adding heavy pieces above carryBase is never a loss ──
const ARMOR_SLOTS: readonly ArmorSlot[] = ['chest', 'legs', 'head', 'feet', 'offhand'];
const SWORD_GEAR: GearPiece = { weight: weaponWeight('1d8'), armor: 0, resist: 0 };
const withGear = (s: SimRow, gear: readonly GearPiece[]): SimRow => {
  if (s.row.origin.kind !== 'hunter') return s;
  const origin = { ...s.row.origin, build: { ...s.row.origin.build, gear } };
  const { sheet } = modified(origin, s.row.statuses, RULES);
  return { ...s, row: { ...s.row, origin, life: { at: 'up' as const, hp: sheet.hpMax } } };
};
const platedTank = (pieces: number, rank: Rank, id: string): SimRow =>
  withGear(hunter('tank', rank, id), [...ARMOR_SLOTS.slice(0, pieces).map(slot => piece('heavy', slot, RULES)), SWORD_GEAR]);
const armedSpeed = (rank: Rank): SimRow =>
  withGear(hunter('speed', rank, 'speed'), [...kitGear('light', RULES), SWORD_GEAR]);
const pairOpenings = (key: string, makeA: () => SimRow, makeB: () => SimRow, runs: number): Measure => {
  const ms = OPENINGS.map(o => {
    const rows = once(() => [at(makeA(), START[o][0]), at(foe(makeB()), START[o][1])]);
    return wins(`${key} ${o}`, (seed: number) => [playFight({ rows: rows(), tallyDamage: false }, seed)], runs);
  });
  return {
    value: mean(ms.map(m => m.value)), se: Math.sqrt(ms.reduce((n, m) => n + m.se ** 2, 0)) / ms.length,
    note: `each opening, no bound: ${OPENINGS.map((o, i) => `${o} ${fmt(ms[i]!.value)} (se ${fmt(ms[i]!.se)}, ${ms[i]!.note})`).join(', ')}`,
  };
};
const BULK_LEVER = 'fight.bulkFull, fight.bulkExp';
const BULK_ROWS: readonly Row[] = SIM_RANKS.flatMap((rank): Row[] => [
  { name: `adding the 4th heavy piece with a 1d8 weapon worn is never a loss at ${rank}`, setup: `4pc v 3pc +1d8 ${rank}`, runs: 2 * RUNS.even,
    measure: () => pairOpenings(`4pc v 3pc +1d8 ${rank}`, () => platedTank(4, rank, 'tank-4'), () => platedTank(3, rank, 'tank-3'), RUNS.even),
    low: 0.5, high: 1, lever: BULK_LEVER },
  { name: `adding the 5th heavy piece with a 1d8 weapon worn is never a loss at ${rank}`, setup: `5pc v 4pc +1d8 ${rank}`, runs: 2 * RUNS.even,
    measure: () => pairOpenings(`5pc v 4pc +1d8 ${rank}`, () => platedTank(5, rank, 'tank-5'), () => platedTank(4, rank, 'tank-4'), RUNS.even),
    low: 0.5, high: 1, lever: BULK_LEVER },
  { name: `full 5-piece plate with a 1d8 weapon worn beats 3-piece plate at ${rank}`, setup: `5pc v 3pc +1d8 ${rank}`, runs: 2 * RUNS.even,
    measure: () => pairOpenings(`5pc v 3pc +1d8 ${rank}`, () => platedTank(5, rank, 'tank-5'), () => platedTank(3, rank, 'tank-3'), RUNS.even),
    low: 0.5, high: 1, lever: BULK_LEVER },
  { name: `full 5-piece plate with a 1d8 weapon worn holds Tank v Speed at ${rank}`, setup: `5pc +1d8 v speed ${rank}`, runs: 2 * RUNS.even,
    measure: () => pairOpenings(`5pc +1d8 v speed ${rank}`, () => platedTank(5, rank, 'tank-5'), () => armedSpeed(rank), RUNS.even),
    low: rank === 'E' ? 0.25 : 0.6, high: rank === 'E' ? 0.75 : 0.9, lever: BULK_LEVER },
]);

// ── six-middle-item party, progression, and weaponDuty parity (BAL-A, boss-retune t157u) ──
const gearedParty = (rank: Rank, R = RULES): SimRow[] => gearedPartyOf(MIXED, rank, R);
const vsPartyAtGearBoss = (rank: Rank, gearRank: Rank | null, level: DifficultyLevel) => {
  const rows = once(() => {
    const scale = difficultyFactor('boss', rank, level, RULES);
    return [...MIXED.map(a => gearedAt(a, rank, gearRank)), monster(rank, 'brute', 'boss', 'boss', RULES, [], scale)];
  });
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const GEARED_RUNS = 200;
const GEARED_ROWS: readonly Row[] = [
  ...(['E', 'C', 'S'] as const).map((rank): Row => ({
    name: `G1 three hunters wearing six middle items win 68 to 82% against a difficulty 5 boss at ${rank}`, setup: `mixed v boss d5 ${rank}`, runs: RUNS.quarter,
    measure: () => wins(`mixed v boss d5 ${rank}`, vsScaledBoss(rank, 5), RUNS.quarter), low: 0.68, high: 0.82, lever: 'difficulty.boss[4] and difficulty.rankScale',
  })),
  ...(['E', 'C', 'S'] as const).map((rank): Row => ({
    name: `G2 three hunters wearing six middle items win 1 to 10% against a difficulty 10 boss at ${rank}`, setup: `mixed v boss d10 ${rank}`, runs: RUNS.even,
    measure: () => wins(`mixed v boss d10 ${rank}`, vsScaledBoss(rank, 10), RUNS.even), low: 0.01, high: 0.10, lever: 'difficulty.boss[9], rankScale and rankSpread',
  })),
  { name: 'G3 three hunters wearing six middle items average 5 to 10% across mythics at S', setup: 'geared v mythics S', runs: MYTHIC_IDS.length * RUNS.mythic,
    measure: () => {
      const ms = MYTHIC_IDS.map(id => ({ id, m: wins(B1_KEY(id), vsScript(id), RUNS.mythic) }));
      return {
        value: mean(ms.map(x => x.m.value)),
        se: Math.sqrt(ms.reduce((n, x) => n + x.m.se ** 2, 0)) / ms.length,
        note: ms.map(x => `${x.id} ${fmt(x.m.value)}`).join(', '),
      };
    },
    low: 0.05, high: 0.10, lever: 'kinds.mythic.{hp, armor} and mythic script HP' },
  { name: 'G4 truly ungeared level 1 starters (0 items) win 30 to 55% against a difficulty 5 boss at E', setup: 'starter-0 v boss d5 E', runs: GEARED_RUNS,
    measure: () => wins('starter-0 v boss d5 E', vsPartyAtGearBoss('E', null, 5), GEARED_RUNS), low: 0.30, high: 0.55, lever: 'difficulty.boss[4] and difficulty.rankScale.E' },
  ...([['C', 'D', 0.20, 0.55], ['S', 'A', 0.25, 0.60]] as const).map(([rank, prev, low, high]): Row => ({
    name: `G4 freshly promoted hunters wearing six ${prev} items win ${Math.round(low * 100)} to ${Math.round(high * 100)}% against a difficulty 5 boss at ${rank}`, setup: `prev6 v boss d5 ${rank}`, runs: GEARED_RUNS,
    measure: () => wins(`prev6 v boss d5 ${rank}`, vsPartyAtGearBoss(rank, prev, 5), GEARED_RUNS), low, high, lever: 'itemBudget.share and difficulty.rankScale',
  })),
  ...(['C', 'S'] as const).flatMap(rank => (['skirmisher', 'caster'] as const).map((arch): Row => ({
    name: `G5 geared hunters win 55 to 90% against a difficulty 5 ${arch} boss at ${rank}`, setup: `geared v ${arch} boss d5 ${rank}`, runs: GEARED_RUNS,
    measure: () => wins(`geared v ${arch} boss d5 ${rank}`, vsScaledBoss(rank, 5, arch), GEARED_RUNS), low: 0.55, high: 0.90, lever: `difficulty.archetypeScale.${arch}`,
  }))),
];
void gearedParty;

const WEAPON_DUTY_SIDE_RUNS = 100;
/** Symmetric 1v1 duel (weapon spend vs main-stat spend): swaps party/foe so speed ties cancel, across both openings. */
const weaponDutyParity = (seat: 'bruiser' | 'speed', rank: Rank): Measure => {
  const wepP = weaponOrStat(seat, rank, 'weapon', `${seat}-w`), statF = foe(weaponOrStat(seat, rank, 'stat', `${seat}-s`));
  const statP = weaponOrStat(seat, rank, 'stat', `${seat}-s`), wepF = foe(weaponOrStat(seat, rank, 'weapon', `${seat}-w`));
  const out: boolean[] = [];
  for (const opening of OPENINGS) {
    const [p1, p2] = START[opening];
    const rA = [at(wepP, p1), at(statF, p2)], rB = [at(statP, p1), at(wepF, p2)];
    for (let s = 1; s <= WEAPON_DUTY_SIDE_RUNS; s++) {
      out.push(playFight({ rows: rA, tallyDamage: false }, s).winner === 'party');
      out.push(playFight({ rows: rB, tallyDamage: false }, s).winner === 'foe');
    }
  }
  return share(out);
};
const WEAPON_DUTY_ROWS: readonly Row[] = (['C', 'S'] as const).flatMap(rank => ([
  { name: `WD1 bruiser spending one middle item on weapon damage vs Strength stays near parity (42 to 65%) at ${rank}`, setup: `weaponDuty bruiser ${rank}`, runs: 4 * WEAPON_DUTY_SIDE_RUNS,
    measure: () => weaponDutyParity('bruiser', rank), low: 0.42, high: 0.65, lever: 'itemBudget.weaponDuty' },
  { name: `WD2 speed spending one middle item on weapon damage vs Agility stays in band (55 to 85%) at ${rank}`, setup: `weaponDuty speed ${rank}`, runs: 4 * WEAPON_DUTY_SIDE_RUNS,
    measure: () => weaponDutyParity('speed', rank), low: 0.55, high: 0.85, lever: 'itemBudget.weaponDuty' },
]));

// ── Grievous Wounds against a regenerating boss (R4, Thornmail retune) ──
const regenBossStatus = (amount: number): Status => ({
  key: statusKey('regen-boss'),
  def: { label: 'Regenerating', desc: 'Heals each round.', ops: [{ op: 'heal', amount: { kind: 'number', value: amount }, when: 'turn' }] },
  source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0),
});
const struckGrievous: Status = {
  key: statusKey('thorn-gw'),
  def: {
    label: 'Grievous thorns', desc: 'Applies Grievous Wounds when struck.', ops: [],
    triggers: [{ on: 'struck', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'applyStatus', key: statusKey('grievous'), def: BUILT_IN_STATUSES.grievous, duration: tick(2 * RULES.fight.round) }] }],
  },
  source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0),
};
const vsRegenBoss = (withGrievous: boolean) => {
  const rows = once(() => {
    const [tank, bruiser, cannon] = party(MIXED, 'S');
    const tankRow: SimRow = withGrievous ? { ...tank!, row: { ...tank!.row, statuses: [...tank!.row.statuses, struckGrievous] } } : tank!;
    const boss = monster('S', 'brute', 'boss', 'boss');
    return [tankRow, bruiser!, cannon!, { ...boss, row: { ...boss.row, statuses: [...boss.row.statuses, regenBossStatus(25)] } }];
  });
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const GRIEVOUS_ROWS: readonly Row[] = [
  { name: 'GW1 a tank applying Grievous Wounds on struck clears a regenerating boss faster at S', setup: 'grievous v regen boss S', runs: 2 * RUNS.tenth,
    measure: () => ratio(rounds('plain v regen boss S', vsRegenBoss(false), RUNS.tenth), rounds('grievous v regen boss S', vsRegenBoss(true), RUNS.tenth)),
    low: 1.02, high: 1.25, lever: 'BUILT_IN_STATUSES.grievous and kit.shareCap' },
];

// ── Hemomancer Crimson Vessels at C-rank (PR C, t186u; rank-rescaled extract-rank, t194u+t195u) ──
// A C-rank Mythic Hemomancer at 0/120 vessels already lifts a geared 3-hunter party to ~94.3% vs a classless-calibrated
// diff-5 C boss (D1: 68–82%), so CV1 bounds both the 27/120 (3 C-elites, +3/+3/+3) win-rate ceiling (<=98%) and the
// paired uplift over 0/120 (-2 pp to +6 pp). Recorded BEFORE (12/24) and AFTER (27/120): 0.943 -> 0.957 (+1.3 pp).
const vsHemoPartyBossD5C = (withVessels: boolean) => {
  const rows = once(() => {
    const scale = difficultyFactor('boss', 'C', 5, RULES);
    return [
      geared('tank', 'C'),
      geared('bruiser', 'C'),
      buildCRankHemomancerRow(withVessels ? HEMO_VESSELS_12 : [], RULES),
      monster('C', 'brute', 'boss', 'boss', RULES, [], scale),
    ];
  });
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), tallyDamage: false }, seed)];
};
const VESSEL_ROWS: readonly Row[] = [
  {
    name: 'CV1 a C-rank party with a 27/120 Crimson Vessels Hemomancer stays within +6 pp of 0/120 and under 98% against a difficulty 5 C boss',
    setup: 'hemo-27 v hemo-0 party boss d5 C',
    runs: 2 * RUNS.quarter,
    measure: () => {
      const before = wins('hemo-0 party v boss d5 C', vsHemoPartyBossD5C(false), RUNS.quarter);
      const after = wins('hemo-27 party v boss d5 C', vsHemoPartyBossD5C(true), RUNS.quarter);
      expect(after.value).toBeGreaterThanOrEqual(0.75);
      expect(after.value).toBeLessThanOrEqual(0.98);
      return {
        value: after.value - before.value,
        se: Math.sqrt(before.se ** 2 + after.se ** 2),
        note: `before 0/120 ${fmt(before.value)} (${before.note}), after 27/120 ${fmt(after.value)} (${after.note})`,
      };
    },
    low: -0.02,
    high: 0.06,
    lever: 'blood-vessels.ts vesselBonus',
  },
];

const ROWS: readonly Row[] = [
  ...triangle('C'), ...triangle('S'), ...atE,
  ...partyRows('C'), ...partyRows('S'),
  ...MONSTER_ARCHETYPES.map((a): Row => ({
    name: `three hunters at S win 5 to 10% of fights against a same-rank ${a} mythic`, setup: `mixed v ${a} mythic S`, runs: RUNS.mythic,
    measure: () => wins(`mixed v ${a} mythic S`, vsMythic(a), RUNS.mythic), low: 0.05, high: 0.1, lever: a === 'brute' ? 'kinds.mythic.hp' : `archetypes.${a} (hp, power)`,
  })),
  { name: 'no build is at its fatigue capacity before the third fight at C', setup: 'dungeon C', runs: RUNS.twentieth,
    measure: () => share(runsOf('dungeon C', dungeon('C'), RUNS.twentieth).map(d => d.slice(0, 2).some(r => Object.values(r.tally).some(t => t.fatigueMax > 0 && t.fatigue >= t.fatigueMax)))), low: 0, high: 0.05, lever: 'fightRest' },
  { name: 'the speed build reaches its fatigue capacity in the third fight at C', setup: 'dungeon C', runs: RUNS.twentieth,
    measure: () => share(runsOf('dungeon C', dungeon('C'), RUNS.twentieth).map(d => { const t = d[2]!.tally.speed!; return t.fatigue >= t.fatigueMax; })), low: 0.5, high: 1, lever: 'fightRest' },
  { name: 'a cannon\'s mana allows 2 or 3 blasts a dungeon at C', setup: 'cannon C', runs: 1,
    measure: () => ({ value: blastsAllowed('C'), se: 0, note: `E ${blastsAllowed('E')}, S ${blastsAllowed('S')}` }), low: 2, high: 3, lever: 'manaBase, manaCap and abilityKinds.blast.mana' },
  { name: 'blasts a careful cannon casts in a dungeon at C (measured, no bound)', setup: 'dungeon C', runs: RUNS.twentieth,
    measure: () => {
      const ds = runsOf('dungeon C', dungeon('C'), RUNS.twentieth);
      const m = avg(ds.map(d => d.reduce((n, r) => n + (r.tally.cannon!.acts.blast ?? 0), 0)));
      return { ...m, note: `mana for another left in ${fmt(share(ds.map(d => d[2]!.tally.cannon!.mana >= RULES.fight.abilityKinds.blast.mana)).value)} of dungeons; it never blasts an ally` };
    }, low: 0, high: Infinity, lever: 'the policy (friendly fire stays)' },
  { name: 'a channel begun while the boss aims at the channeler completes in 10 to 25% of tries at C', setup: 'channel under fire C', runs: RUNS.quarter,
    measure: () => completes('channel under fire C', vsBoss(['bruiser', 'speed', 'cannon'], 'C', 'aimed'), RUNS.quarter, 'aimed'), low: 0.1, high: 0.25, lever: 'holdBase' },
  { name: 'a channel begun while the boss aims elsewhere completes at C (measured, no bound)', setup: 'channel, no taunt C', runs: RUNS.quarter,
    measure: () => completes('channel, no taunt C', vsBoss(['bruiser', 'speed', 'cannon'], 'C', 'safe'), RUNS.quarter, 'elsewhere'), low: 0, high: 1, lever: 'the threat table' },
  { name: 'a channel behind a taunting tank completes in over half of boss fights at C', setup: 'channel, taunt C', runs: RUNS.even,
    measure: () => completes('channel, taunt C', vsBoss(['tank', 'bruiser', 'cannon'], 'C', 'safe'), RUNS.even), low: 0.5, high: 1, lever: 'holdBase' },
  ...(['E', 'C', 'S'] as const).map((rank): Row => ({
    name: `the best single use takes at most 60% of a same-rank tank's HP at ${rank}`, setup: `one use ${rank}`, runs: 400,
    measure: () => bestUse(rank, 400), low: 0, high: 0.6, lever: 'cost.heavy (the heavy share 1.5) and critSizeCap',
  })),
  { name: 'a status build against a tank at C (measured, no bound)', setup: 'status v tank C', runs: RUNS.even, measure: () => wins('status v tank C', duel('status', 'tank', 'C'), RUNS.even), low: 0, high: 1, lever: 'per-round damage meets armor and resist (R6)' },
  ...KIT_ROWS,
  ...W2_ROWS,
  ...PEN_ROWS,
  ...SCRIPT_ROWS,
  ...DIFFICULTY_ROWS,
  ...WORLDBREAKER_ROWS,
  ...BULK_ROWS,
  ...GEARED_ROWS,
  ...WEAPON_DUTY_ROWS,
  ...GRIEVOUS_ROWS,
  ...VESSEL_ROWS,
];

/**
 * The rows outside their bound, with the value measured: each stays `todo` until a change in RULES.fight brings it inside
 * (docs/agent-handoff/rw/sim-log.md says why each misses). The rule calls are the lead's. Before MY5 there were none: P3
 * came inside when a stun began to add its length to the turn (sim-log.md, balance unit 6). MY5's are design B.8's rows
 * that a reducer rule or a party with keystones must bring inside.
 */
const OPEN: Readonly<Record<string, string>> = {
  // Design B.8's rows a script's `hp` cannot hold and its words did not (sim-log.md, MY5, says what each would need).
  ...Object.fromEntries(MYTHIC_IDS.map(id => [`B9 no keystone pair of three Focused builds moves the share won against ${nameOf(id)} out of 5 to 10%`,
    'not measured: unit K4 puts keystones on a row and K5 builds the Focused parties and K5\'s own rows, which B9 shares'])),
};

// ── one test per row: the row is measured inside its test, so a bun timeout or the per-test times name the row ──
const inside = (r: Row, m: Measure): boolean => m.value >= r.low && m.value <= r.high;
const edge = (r: Row, m: Measure): string => inside(r, m) && Math.min(m.value - r.low, r.high - m.value) < m.se ? ' near' : '';
// Every row in this file runs through `simTest` from `tests/models/sim-budget.ts` (deterministic work
// counts + wall hang guard `WALL_TIMEOUT_MS = 600_000`), enforced by `tests/lint.test.ts`.
describe('the reworked fight holds the bounds of design section 6', () => {
  simTest('every open row names a row of the table', () => {
    expect(Object.keys(OPEN).filter(name => !ROWS.some(r => r.name === name))).toEqual([]);
  }, workBudget(0));
  for (const row of ROWS) {
    const open = OPEN[row.name];
    if (open) { test.todo(`${row.name} (${open})`); continue; }
    simTest(row.name, () => {
      const m = row.measure();
      const bound = `${fmt(row.low)} to ${fmt(row.high)}`;
      console.log(`  ${inside(row, m) ? 'in ' : 'OUT'}${edge(row, m)}  ${row.name}: ${fmt(m.value)} (se ${fmt(m.se)}, ${row.runs} runs), bound ${bound}, lever ${row.lever}${m.note ? `; ${m.note}` : ''}`);
      expect(m.value).toBeGreaterThanOrEqual(row.low);
      expect(m.value).toBeLessThanOrEqual(row.high);
    }, row.runs > 1500 ? workBudget(row.runs) : undefined);
  }
});

describe('every build and monster plays a fight to its end', () => {
  for (const rank of SIM_RANKS) {
    for (const a of Object.keys(BUILDS) as Archetype[]) {
      simTest(`a ${a} hunter at ${rank} fights a same-rank elite brute until one side is down`, () => {
        const r = playFight({ rows: [hunter(a, rank), monster(rank, 'brute', 'elite', 'elite')], tallyDamage: false }, 1);
        expect(r.capped).toBe(false);
        expect(r.winner).not.toBeNull();
      }, workBudget(1));
    }
    for (const m of Object.keys(MONSTER_ABILITY) as (keyof typeof MONSTER_ABILITY)[]) {
      simTest(`a normal ${m} at ${rank} fights a same-rank bruiser until one side is down`, () => {
        const r = playFight({ rows: [hunter('bruiser', rank), monster(rank, m, 'normal', m)], tallyDamage: false }, 2);
        expect(r.capped).toBe(false);
        expect(r.winner).not.toBeNull();
      }, workBudget(1));
    }
  }
});

describe('a mythic\'s script stays out of the fights it is not in (design B.8)', () => {
  /**
   * When a table turns `fight.mythic.scripts` off, no seed mythic made under those rules holds a standing, and row M1's
   * fight, every hunter answering omens, is the same fight seed by seed, since with no standing there is no omen to answer.
   */
  simTest('with mythic phases off the old rows are unchanged', () => {
    const OFF = scriptsOff();
    for (const m of seedMonsters(OFF).filter(x => x.kind === 'mythic')) expect([m.name, monsterRows(m, [combatantId('m')], OFF)[0]!.mythic]).toEqual([m.name, null]);
    const m1 = (answer: boolean) => {
      const rows = [...party(MIXED, 'S').map(s => (answer ? answering(s) : s)), monster('S', 'brute', 'mythic', 'mythic')];
      return (seed: number): FightRecord => playFight({ rows, rules: OFF, tallyDamage: false }, seed);
    };
    const yes = m1(true), no = m1(false);
    for (let seed = 1; seed <= 40; seed++) expect(yes(seed), `seed ${seed}`).toEqual(no(seed));
  }, workBudget(80));
});

// ── what the GM's fudge does to a mythic (notes-8-fudge.md section 4) ──
/**
 * The mixed party at S against a same-rank brute mythic, the hunters weighted +0 to +5 (the table stops at +5, not a
 * bound), 600 fights each from the seeds of row M1. Printed so the GM's question "what does +2 do to a mythic" has a row.
 * Asserted: the win rate does not fall as the weight rises (a higher face is never worse for the hunters), and at 0 it is
 * the ruling's 5 to 10%. A weight moves a d20 by a tenth of its faces at +2, so a step of +1 is 5 points of every hit and
 * crit roll, far over the noise of 600 fights (se 0.011 at p = 0.075).
 */
const FUDGE_STEPS = [0, 1, 2, 3, 4, 5] as const;
const weightedMythic = (n: number) => {
  const rows = once(() => [...gearedPartyOf(MIXED, 'S'), monster('S', 'brute', 'mythic', 'mythic')]);
  const fudge = { sides: { party: n, foe: 0 }, rows: {}, forced: {} };
  return (seed: number): FightRecord[] => [playFight({ rows: rows(), fudge, tallyDamage: false }, seed)];
};

describe('the GM\'s fudge on a party of 3 against a mythic', () => {
  simTest('the win rate does not fall as the hunters\' weight rises, and at 0 it is 5 to 10%', () => {
    const rates = FUDGE_STEPS.map(n => ({ n, m: wins(`mixed v brute mythic S fudge +${n}`, weightedMythic(n), RUNS.mythic) }));
    console.log(['  hunters  win rate (se)', ...rates.map(({ n, m }) => `  +${n}       ${(100 * m.value).toFixed(1)}% (${(100 * m.se).toFixed(1)})  ${m.note}`)].join('\n'));
    expect(rates[0]!.m.value).toBeGreaterThanOrEqual(0.05);
    expect(rates[0]!.m.value).toBeLessThanOrEqual(0.1);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!.m.value, `+${rates[i]!.n} against +${rates[i - 1]!.n}`).toBeGreaterThanOrEqual(rates[i - 1]!.m.value);
  }, workBudget(FUDGE_STEPS.length * RUNS.mythic));
});

// ── Act 1 "The Empty Seat" balance simulation (U6): Wave 1 & Wave 2 across 1..6 players, plus Level 3 Mythic/Epic E-rank checks ──
const ACT1_RUNS = 100;

type Act1Summary = { readonly winRate: number; readonly deathRate: number; readonly meanRounds: number; readonly capped: number };
function runAct1Setup(key: string, makeRows: () => SimRow[], runs: number): Act1Summary {
  const rows = once(makeRows);
  const rs = runsOf(key, (seed: number) => [playFight({ rows: rows(), tallyDamage: false }, seed)], runs).map(r => r[0]!);
  return {
    winRate: rs.filter(r => r.winner === 'party').length / runs,
    deathRate: rs.filter(r => r.dead.length > 0).length / runs,
    meanRounds: mean(rs.map(r => r.rounds)),
    capped: rs.filter(r => r.capped).length,
  };
}

/** Builds a real Level 3 E-rank hunter holding 0-node offered unique class `cls` through `earnClass` + `hunterRow`. */
function buildLevel3ClassRow(cls: UniqueClassName, id: string): SimRow {
  const env = { now: new Date(ACT1_AT), newDeviceId: () => dev('d-l3'), newDeviceToken: () => 'tok-l3-1234567890' };
  const s = freshSave(env, { onboarded: true });
  const made = makeHunter({ seq: 500, settings: s.settings }, cls, RULES, new Date(ACT1_AT));
  const statsByClass: Partial<Record<UniqueClassName, StatPoints>> = {
    Hemomancer: { pow: 10, vit: 8 },
    Bladefiend: { str: 10, agi: 8 },
    Rifthunter: { ins: 10, ctl: 8 },
    Seraph: { pre: 10, dis: 8 },
    Ironclad: { vit: 10, dis: 8 },
    Stormcaller: { pow: 10, agi: 8 },
  };
  const focus = jobFocus(cls);
  const derivedStats: StatPoints = focus
    ? { [focus.main]: 10, ...(focus.second ? { [focus.second]: 8 } : {}) }
    : { str: 10, vit: 8 };
  const level3 = advanceHunter(made.hunter, 3, statsByClass[cls] ?? derivedStats);
  const earned = earnClass(level3, cls, { at: ACT1_AT, R: RULES });
  if (isRefused(earned)) throw new Error(`earnClass(${cls}) refused: ${earned.why}`);
  const filled = { ...earned, ...refill(earned, hunterSheet(earned, RULES).sheet) };
  const policyByClass: Partial<Record<UniqueClassName, Policy>> = {
    Hemomancer: hemomancerPolicy,
    Bladefiend: bladefiendPolicy,
    Rifthunter: rifthunterPolicy,
  };
  return { row: hunterRow(filled, combatantId(id), RULES), policy: policyByClass[cls] ?? missionPolicy };
}

const ACT1_STEP_BUDGET = workBudget(ACT1_RUNS, ACT1_RUNS * 250);

// Act 1 "The Empty Seat" Wave 1 & Wave 2 balance bounds (Neon, U6):
// Wave 1 (Cannery Tunnels, Lv.1; Goblin Chief tuned to normal, Wave 1 trimmed to 1 Goblin + 1 Shaman + 1 Chief at 3-4p)
// clears without a death in most runs for 4p (sample ~4% deaths, bare+2 potions ~15% deaths) and >=95% win across 2-6p.
// Wave 2 (Stone Hall, Lv.2; Head Usher + Ushers) clears >=90% across 2-6p with <=25% deaths at 4p.
describe('Act 1 "The Empty Seat" Wave 1 and Wave 2 balance (1 to 6 players, sample and bare + 2 potions)', () => {
  for (const kind of ['sample', 'bare'] as const) {
    for (const wave of [1, 2] as const) {
      const level = wave;
      for (const players of [1, 2, 3, 4, 5, 6] as const) {
        simTest(`Act 1 Wave ${wave} (${kind}, ${players}p, Lv.${level}) runs cleanly`, () => {
          const partyRows = () => (kind === 'sample' ? act1SampleParty(players, level) : act1BareParty(players, level));
          const res = runAct1Setup(`act1-w${wave}-${kind}-${players}p`, () => [...partyRows(), ...act1WaveFoes(wave, players)], ACT1_RUNS);
          console.log(`  [Act 1 W${wave} ${kind.padEnd(6)} ${players}p Lv.${level}] win=${(res.winRate * 100).toFixed(1)}%, deaths=${(res.deathRate * 100).toFixed(1)}%, rounds=${res.meanRounds.toFixed(1)}, capped=${res.capped}`);
          expect(res.capped).toBe(0);
          expect(res.meanRounds).toBeGreaterThanOrEqual(1);
          expect(res.meanRounds).toBeLessThanOrEqual(25);
          if (wave === 1 && players === 1) {
            expect(res.winRate).toBeGreaterThanOrEqual(kind === 'sample' ? 0.90 : 0.55);
          }
          if (wave === 1 && players >= 2) {
            expect(res.winRate).toBeGreaterThanOrEqual(0.95);
            expect(res.deathRate).toBeLessThanOrEqual(0.45);
          }
          if (wave === 1 && players === 4) {
            expect(res.deathRate).toBeLessThanOrEqual(kind === 'sample' ? 0.20 : 0.30);
          }
          if (wave === 2) {
            expect(res.winRate).toBeGreaterThanOrEqual(0.90);
            if (players === 4) expect(res.deathRate).toBeLessThanOrEqual(0.25);
          }
        }, ACT1_STEP_BUDGET);
      }
    }
  }
});

describe('Act 1 Level 3 Mythic and Epic E-rank checks (0 tree nodes)', () => {
  for (const cls of DEFAULT_OFFER_POOL) {
    simTest(`Level 3 ${cls} (0 nodes) with E-rank allies clears an E-rank pack cleanly`, () => {
      const makeRows = () => [
        buildLevel3ClassRow(cls, cls.toLowerCase()),
        ...act1SampleParty(2, 2).map((s, i) => ({ ...s, row: { ...s.row, id: combatantId(`ally-${i + 1}`) } })),
        ...pack('E'),
      ];
      const res = runAct1Setup(`act1-l3-${cls}-pack`, makeRows, ACT1_RUNS);
      console.log(`  [Act 1 Lv.3 ${cls.padEnd(11)} + 2 allies vs E pack] win=${(res.winRate * 100).toFixed(1)}%, deaths=${(res.deathRate * 100).toFixed(1)}%, rounds=${res.meanRounds.toFixed(1)}, capped=${res.capped}`);
      expect(res.capped).toBe(0);
      expect(res.winRate).toBeGreaterThanOrEqual(0.95);
      expect(res.meanRounds).toBeGreaterThanOrEqual(1);
      expect(res.meanRounds).toBeLessThanOrEqual(15);
    }, ACT1_STEP_BUDGET);
  }

  simTest('Level 3 party (3 Mythics + 1 Epic, 0 nodes) clears an E-rank pack and difficulty-5 E-rank boss cleanly', () => {
    const party4 = () => [
      buildLevel3ClassRow('Hemomancer', 'hemo'),
      buildLevel3ClassRow('Bladefiend', 'blade'),
      buildLevel3ClassRow('Rifthunter', 'rift'),
      buildLevel3ClassRow('Seraph', 'seraph'),
    ];
    const packRes = runAct1Setup('act1-l3-party4-epack', () => [...party4(), ...pack('E')], ACT1_RUNS);
    const bossD5Scale = difficultyFactor('boss', 'E', 5, RULES);
    const bossD5Res = runAct1Setup('act1-l3-party4-eboss-d5', () => [...party4(), monster('E', 'brute', 'boss', 'boss-d5', RULES, [], bossD5Scale)], ACT1_RUNS);
    const bossD10Scale = difficultyFactor('boss', 'E', 10, RULES);
    const bossD10Res = runAct1Setup('act1-l3-party4-eboss-d10', () => [...party4(), monster('E', 'brute', 'boss', 'boss-d10', RULES, [], bossD10Scale)], ACT1_RUNS);
    console.log(`  [Act 1 Lv.3 3M+1E vs E pack]      win=${(packRes.winRate * 100).toFixed(1)}%, deaths=${(packRes.deathRate * 100).toFixed(1)}%, rounds=${packRes.meanRounds.toFixed(1)}, capped=${packRes.capped}`);
    console.log(`  [Act 1 Lv.3 3M+1E vs E boss d5]   win=${(bossD5Res.winRate * 100).toFixed(1)}%, deaths=${(bossD5Res.deathRate * 100).toFixed(1)}%, rounds=${bossD5Res.meanRounds.toFixed(1)}, capped=${bossD5Res.capped}`);
    console.log(`  [Act 1 Lv.3 3M+1E vs E boss d10]  win=${(bossD10Res.winRate * 100).toFixed(1)}%, deaths=${(bossD10Res.deathRate * 100).toFixed(1)}%, rounds=${bossD10Res.meanRounds.toFixed(1)}, capped=${bossD10Res.capped}`);
    expect(packRes.capped).toBe(0);
    expect(bossD5Res.capped).toBe(0);
    expect(bossD10Res.capped).toBe(0);
    expect(packRes.winRate).toBeGreaterThanOrEqual(0.95);
    expect(bossD5Res.winRate).toBeGreaterThanOrEqual(0.9);
  }, workBudget(3 * ACT1_RUNS, 3 * ACT1_RUNS * 250));
});

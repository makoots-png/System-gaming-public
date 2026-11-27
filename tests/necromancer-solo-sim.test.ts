// necromancer-solo-sim.test.ts: Necromancer (Mythic, pre+pow) solo-army simulation checks against all 4 scripted Mythic bosses.
// Fixture: S-rank level 70 Necromancer (2:1 pre+pow, 32-node legal tree, King of Shadows S-band title, 6-slot Mythic
// middle-grade gear, awakened Shadowbound Confluence + Marks + Sovereign Apex) fielding 4 S-rank shadows (1 Knight,
// 1 Elite, 2 Normal) running `monsterPolicy`, with 40 summon mana deducted from the starting bar.
// Target: 4 gating rows vs MYTHIC_IDS at 75% to 98% aiming ~85% (hero must finish up to win), plus 1 reported
// non-gating row (boss + 4 S-rank normals) exercising Arise and Reform.
//
// Recorded BEFORE / AFTER rows for branch `extract-rank` (rank-driven shadow/risen scaling: rankHp S=1.2, rankDealt S=1.0):
//   - plain:                        BEFORE 100.0% (200/200, 6.3r) -> AFTER 100.0% (200/200, 6.3r) [unscripted boss]
//   - angel-of-the-last-trumpet:    BEFORE  95.0% (190/200, 12.5r) -> AFTER  96.5% (193/200, 12.5r)
//   - zaratan-the-island-that-wakes:BEFORE  76.0% (152/200, 15.0r) -> AFTER  77.0% (154/200, 15.0r)
//   - the-fourth-rider:             BEFORE  81.5% (163/200, 10.5r) -> AFTER  84.0% (168/200, 10.4r)
//   - plain + 4 S normals (adds):   BEFORE 100.0% (100/100, 7.5r, 4 Arise casts) -> AFTER 100.0% (100/100, 7.5r, 4 Arise casts)
import { describe, expect } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import type { Hunter, Item, Shadow, Title } from '../src/core/save.ts';
import { parseClassNodeId, parseSaveId } from '../src/core/ids.ts';
import type { ClassNodeId, ItemId, ShadowId, TitleId } from '../src/core/ids.ts';
import { pointsAt, split } from '../src/core/hunter/derive.ts';
import type { Archetype, Kit } from '../src/core/hunter/derive.ts';
import { earnClass } from '../src/core/hunter/classes.ts';
import { heldKeystones, hunterSheet } from '../src/core/hunter/sheet.ts';
import { armyCap } from '../src/core/hunter/shadows.ts';
import { lifeAfter } from '../src/core/hunter/vitals.ts';
import { isRefused } from '../src/core/save-step.ts';
import { WEAR_LIMIT, piece } from '../src/core/registry/items.ts';
import type { ArmorSlot, ItemBonus } from '../src/core/registry/items.ts';
import type { HeldItem } from '../src/core/registry/item-book.ts';
import { gradeOfSpend, itemSpend, titleSpend } from '../src/core/registry/item-budget.ts';
import { ATTACK_ID, wornAbilityId } from '../src/core/registry/abilities.ts';
import { MYTHIC_IDS } from '../src/core/registry/mythics.ts';
import { CLASS_ACTIVES_MAX, TREE_SHAPE, canBuyNode, classTreeOf, repairNodes, validateTree } from '../src/core/registry/class-trees.ts';
import { classPowers } from '../src/core/registry/class-powers.ts';
import { NECROMANCER_TREE } from '../src/core/registry/class-necromancer.ts';
import { hunterRow, monsterRows, shadowRow, shadowSheet } from '../src/core/combat/rows.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { Body } from '../src/core/combat/effect-ops.ts';
import { isUp, rowHp } from '../src/core/combat/row-hp.ts';
import { placeOf, usable as canUse } from '../src/core/combat/resolve.ts';
import { harmful, warded } from '../src/core/combat/standing.ts';
import { dist } from '../src/core/combat/space.ts';
import { spotOf, stepAway, stepToward } from '../src/core/combat/fight-view.ts';
import { taunter } from '../src/core/combat/threat.ts';
import { canRiseFor, riseBonus } from '../src/core/combat/rise.ts';
import { isMinionOf, isRisen, isTimedSummon } from '../src/core/combat/summons.ts';
import { shadowFieldCap } from '../src/core/combat/fight-types.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Running } from '../src/core/combat/fight.ts';
import { needs } from '../src/core/combat/resolve.ts';
import { weightsFor } from '../src/core/combat/fudge.ts';
import { drawNeeds, seededSource } from '../src/core/draws.ts';
import { fightId } from '../src/core/ids.ts';
import { place } from '../src/core/combat/space.ts';
import { monsterPolicy, playFight, runSoloMythicArmy, scripted } from './models/fight-sim.ts';
import type { Policy, SimRow } from './models/fight-sim.ts';
import { simTest, workBudget } from './models/sim-budget.ts';
import { SOLO_MYTHIC_RULES } from './fixtures/mythic-hunters.ts';

const AT = '2026-11-26T12:00:00.000Z';
const SOLO_RUNS = 200;
const ADDS_RUNS = 100;
const HARD_FLOOR = 0.75;
const HIGH_DIAGNOSTIC = 0.98;
const SOLO_BUDGET = workBudget(250);

const itemId = (s: string): ItemId => parseSaveId<'i'>(s)!;
const titleId = (s: string): TitleId => parseSaveId<'t'>(s)!;
const shadowIdOf = (s: string): ShadowId => parseSaveId<'sh'>(s)!;
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

const NECRO_ARISE_ID = wornAbilityId(abilityId('necro-arise'));
const NECRO_DOMAIN_ID = wornAbilityId(abilityId('necro-domain'));
const NECRO_AUTHORITY_ID = wornAbilityId(abilityId('necro-authority'));
const NECRO_EXCHANGE_ID = wornAbilityId(abilityId('necro-exchange'));
const CALL_SHADOW_ID = wornAbilityId(abilityId('keystone-call-shadow'));
const KEY_DOMAIN_BASE = statusKey('necro-domain-aura');
const KEY_DOMAIN_UP = statusKey('necro-domain-aura-ii');

/** Canonical 32 buyable nodes for Necromancer (Greater Arise, Imperial Domain, Phantom Exchange, Endless Arise, Walking Domain, Abyssal Thrift, Shadow Monarch). */
const NECRO_CANONICAL_FORKS = ['necro-a5-l', 'necro-b5-l', 'necro-c5-l', 'necro-a7-l', 'necro-b7-l', 'necro-c7-l'] as const;
const NECRO_CANONICAL_NODES: readonly ClassNodeId[] = NECROMANCER_TREE.nodes
  .filter(n => !n.forkGroup || (NECRO_CANONICAL_FORKS as readonly string[]).includes(n.id))
  .map(n => nid(n.id));

const NECRO_TITLE: Title = {
  id: titleId('t4'),
  name: 'King of Shadows',
  desc: 'Leads a shadow army.',
  bonus: { pow: 5 },
};

function makeArmor(id: string, name: string, slot: ArmorSlot, kit: Kit, bonus: ItemBonus, R: Rules): Item {
  const p = piece(kit, slot, R);
  return {
    id: itemId(id), name, rar: 'mythic', type: 'armor', slot, qty: 1, dice: '', bonus,
    desc: '', armor: p.armor, resist: p.resist, weight: p.weight,
  };
}

function makeWeapon(id: string, name: string, dice: string, bonus: ItemBonus): Item {
  return {
    id: itemId(id), name, rar: 'mythic', type: 'weapon', slot: 'weapon', qty: 1, dice, attack: 'strike', bonus,
    desc: '', armor: 0, resist: 0,
  };
}

function necroGear(R: Rules): readonly Item[] {
  return [
    makeWeapon('i31', 'Monarch Scepter', '1d6', { pre: 14, pow: 4 }),
    makeArmor('i32', 'Shadow Mantle', 'chest', 'light', { pre: 12, pow: 6 }, R),
    makeArmor('i33', 'Umbral Trousers', 'legs', 'light', { pre: 10, pow: 8 }, R),
    makeArmor('i34', 'Crown of Ash', 'head', 'light', { pre: 12, pow: 6 }, R),
    makeArmor('i35', 'Nightstep Boots', 'feet', 'light', { pre: 10, pow: 8 }, R),
    makeArmor('i36', 'Obsidian Signet', 'offhand', 'light', { pre: 12, pow: 6 }, R),
  ];
}

function makeShadow(id: string, name: string, grade: Shadow['grade'], archetype: Archetype, R: Rules): Shadow {
  const base = { id: shadowIdOf(id), name, monster: null, rank: 'S' as const, archetype, grade, hp: 1, summoned: true, notes: '' };
  return { ...base, hp: shadowSheet(base, R).hpMax };
}

function buildNecroArmy(R: Rules = SOLO_MYTHIC_RULES): { hunter: Hunter; hero: SimRow; shadows: SimRow[]; summonCost: number } {
  const base = newHunter(R);
  const level = R.rankLevels.S;
  const stats = split('pre', 'pow', pointsAt(level, R), R);
  const gear = necroGear(R);
  const items = gear.map(({ id, qty, ...item }): HeldItem => ({ kind: 'adhoc', id, qty, item }));
  const equipped: Record<string, ItemId | null> = { ...base.equipped };
  for (const it of gear) if (it.slot) equipped[it.slot] = it.id;

  const shadows: Shadow[] = [
    makeShadow('sh1', 'Igris', 'Knight', 'brute', R),
    makeShadow('sh2', 'Iron', 'Elite', 'skirmisher', R),
    makeShadow('sh3', 'Shadow Guard A', 'Normal', 'brute', R),
    makeShadow('sh4', 'Shadow Mage B', 'Normal', 'caster', R),
  ];

  const pre: Hunter = {
    ...base,
    name: 'Necromancer',
    rank: 'S',
    level,
    stats,
    titles: [NECRO_TITLE],
    titleId: NECRO_TITLE.id,
    items,
    equipped,
    shadows,
  };
  const earned = earnClass(pre, 'Necromancer', { at: AT, R });
  if (isRefused(earned)) throw new Error(`earnClass(Necromancer) refused: ${earned.why}`);

  const withNodes: Hunter = {
    ...earned,
    classes: {
      ...earned.classes,
      Necromancer: { ...earned.classes.Necromancer!, nodes: [...NECRO_CANONICAL_NODES] },
    },
  };
  const { sheet } = hunterSheet(withNodes, R);
  const summonCost = shadows.reduce((sum, s) => sum + R.shadow.summonMp[s.rank], 0);
  const ready: Hunter = {
    ...withNodes,
    life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000),
    mana: Math.max(0, sheet.manaMax - summonCost),
  };

  const heroId = combatantId('hero');
  const hero: SimRow = { row: hunterRow(ready, heroId, R), policy: necromancerPolicy };
  const shadowRows: SimRow[] = shadows.map((s, idx) => ({
    row: shadowRow(s, ready.id, heroId, combatantId(`sh-${idx + 1}`), R),
    policy: monsterPolicy,
  }));
  return { hunter: ready, hero, shadows: shadowRows, summonCost };
}

/**
 * Necromancer solo-army combat policy. Opens Domain of the Monarch and Call Shadow, raises fallen adds with Arise,
 * uses Ruler's Authority for AoE stagger/damage while keeping mana reserve for Undying Legion reforms, uses Shadow
 * Exchange defensively for shield + kiting when threatened in melee, and holds mid-range inside aura distance.
 */
const necromancerPolicy: Policy = (f, me, _plan, R) => {
  const foes = f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side));
  if (!foes.length) return { type: 'pass' };
  const t = taunter(me);
  const forced = t ? foes.find(b => b.id === t.by) : undefined;
  const target: Body = forced ?? [...foes].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place))[0]!;

  const find = (id: string) => me.abilities.find(a => a.id === id);
  const fits = (a: ReturnType<typeof find>, aim: Body['id'] | Body['place']): boolean =>
    !!a && canUse(a, me, f.rows, aim, f.grid, f.now, R, f.fog);

  const hpRatio = me.sheet.hpMax > 0 ? rowHp(me) / me.sheet.hpMax : 1;
  const hasShield = !!me.shield && me.shield.until > f.now && me.shield.amount > 0;
  const hasDomain = me.statuses.some(s => (s.key === KEY_DOMAIN_BASE || s.key === KEY_DOMAIN_UP) && (s.until === null || s.until > f.now));
  const targetInvuln = target.statuses.some(s => s.def.ops.some(o => o.op === 'invulnerable'));
  const bossOmenActive = !!target.mythic && target.mythic.at !== 'calm';
  const d = dist(me.place, target.place);

  // 1. Open or refresh Domain of the Monarch once a vulnerable foe is within 5 tiles (or Walking Domain when vulnerable)
  const domain = find(NECRO_DOMAIN_ID);
  if (domain && !hasDomain && !targetInvuln && (d <= 5 || domain.zone?.around !== null) && fits(domain, me.id)) {
    return { type: 'act', ability: domain, aim: me.id };
  }

  // 2. Call Shadow (free awakened Shadowbound summon) when under timed summon cap
  const callShadow = find(CALL_SHADOW_ID);
  const timedCount = f.rows.filter(r => isTimedSummon(r) && r.owner === me.id && isUp(r)).length;
  if (callShadow && timedCount < R.fight.kit.summons && fits(callShadow, me.id)) {
    return { type: 'act', ability: callShadow, aim: me.id };
  }

  // 3. Raise fallen normal/elite corpses with Arise when under maxRisen and keeping reform mana reserve
  const arise = find(NECRO_ARISE_ID);
  if (arise?.raise && me.mana >= 22) {
    const risenCount = f.rows.filter(r => isRisen(r) && r.owner === me.id && isUp(r)).length;
    if (risenCount < arise.raise.maxRisen) {
      const corpse = f.rows
        .filter(r => canRiseFor(r, f.rows, arise.raise!) && fits(arise, r.id))
        .sort((a, b) => Number(b.origin.kind === 'monster' && b.origin.monsterKind === 'elite') - Number(a.origin.kind === 'monster' && a.origin.monsterKind === 'elite')
          || dist(me.place, a.place) - dist(me.place, b.place))[0];
      if (corpse) return { type: 'act', ability: arise, aim: corpse.id };
    }
  }

  // 4. Shadow Exchange for 15% max HP shield when an omen stands, pressed in melee, or hurt without a shield.
  // Prefer a minion outside harmful zones and farthest from the boss (never swapping directly onto a targeted omen tile).
  const exchange = find(NECRO_EXCHANGE_ID);
  if (exchange && me.sheet.stride > 0 && !hasShield && (bossOmenActive || d <= 2 || hpRatio < 0.8)) {
    const omenAt = target.mythic && target.mythic.at !== 'calm' ? placeOf(target.mythic.aim, f.rows) : null;
    const minions = f.rows
      .filter(r => isMinionOf(r, me.id) && isUp(r) && r.sheet.stride > 0 && fits(exchange, r.id)
        && (!omenAt || dist(r.place, omenAt) > 0))
      .sort((a, b) => Number(a.statuses.some(s => s.zone !== undefined && harmful(s.def))) - Number(b.statuses.some(s => s.zone !== undefined && harmful(s.def)))
        || dist(b.place, target.place) - dist(a.place, target.place));
    if (minions[0] && (dist(minions[0].place, target.place) >= 2 || d <= 2 || bossOmenActive)) {
      return { type: 'act', ability: exchange, aim: minions[0].id };
    }
  }

  // 5. Ruler's Authority for arcane burst + stagger on a vulnerable foe
  const authority = find(NECRO_AUTHORITY_ID);
  if (authority && !targetInvuln && fits(authority, target.place)) {
    return { type: 'act', ability: authority, aim: target.place };
  }

  // 6. Keep mid-range (3..5 tiles): inside aura and Authority reach, outside melee cleave
  if (d <= 2) {
    const away = stepAway(f.rows.map(spotOf), me.id, target.id, me.sheet.stride, f.grid);
    if (away && dist(away.place, target.place) <= 5) return { type: 'move', to: away.place };
  }
  if (d > 5) {
    const closer = stepToward(f.rows.map(spotOf), me.id, target.id, me.sheet.stride, f.grid);
    if (closer) return { type: 'move', to: closer.place };
  }

  // 7. Basic attack only if already adjacent to a vulnerable foe, else hold aura position
  const attack = find(ATTACK_ID);
  if (!targetInvuln && fits(attack, target.id)) return { type: 'act', ability: attack!, aim: target.id };
  return { type: 'pass' };
};

describe('Necromancer solo-army fixture legality under shipped rules', () => {
  simTest('Necromancer fixture passes tree legality, S-band title, Mythic middle-grade gear, 40 summon mana deduction, and shadow caps', () => {
    const tree = classTreeOf('Necromancer');
    expect(tree).not.toBeNull();
    expect(validateTree(tree!)).toEqual([]);
    expect(NECRO_CANONICAL_NODES.length).toBe(TREE_SHAPE.mythic.buyable);
    expect(repairNodes(tree!, NECRO_CANONICAL_NODES)).toEqual([...NECRO_CANONICAL_NODES]);

    const bought: ClassNodeId[] = [];
    for (const id of NECRO_CANONICAL_NODES) {
      const check = canBuyNode(tree!, bought, id);
      expect(check.ok, `Necromancer node ${id} refused`).toBe(true);
      bought.push(id);
    }

    const tSpend = titleSpend({ ...NECRO_TITLE, band: 'S' }, SOLO_MYTHIC_RULES);
    expect(tSpend.points).toBeLessThanOrEqual(SOLO_MYTHIC_RULES.titleBudget.S);

    const gear = necroGear(SOLO_MYTHIC_RULES);
    expect(gear.length).toBe(WEAR_LIMIT);
    for (const item of gear) {
      expect(item.rar).toBe('mythic');
      const spend = itemSpend(item, SOLO_MYTHIC_RULES);
      expect(spend).not.toBeNull();
      expect(gradeOfSpend(SOLO_MYTHIC_RULES, 'mythic', spend!.points), `${item.name} not Mythic middle grade`).toBe(0);
    }

    const { hunter, hero, shadows, summonCost } = buildNecroArmy(SOLO_MYTHIC_RULES);
    const cp = classPowers(hunter, SOLO_MYTHIC_RULES);
    const ks = heldKeystones(hunter, SOLO_MYTHIC_RULES);
    const { sheet } = hunterSheet(hunter, SOLO_MYTHIC_RULES);
    expect(summonCost).toBe(40);
    expect(hero.row.mana).toBe(sheet.manaMax - 40);
    expect(hero.row.mana).toBeGreaterThanOrEqual(71);
    expect(shadows.length).toBe(4);
    expect(shadows.length).toBeLessThanOrEqual(shadowFieldCap(armyCap(hunter, SOLO_MYTHIC_RULES)));
    expect(cp.worn?.key).toBe(statusKey('necro-shadow-monarch'));
    expect(cp.actives.length).toBe(CLASS_ACTIVES_MAX);
    expect(ks.some(k => k.awakened !== null)).toBe(true);
  }, workBudget(0));
});

describe('Necromancer solo-army vs Mythic bosses (4 gating rows, target 75% to 98% aiming ~85%)', () => {
  const { hero, shadows } = buildNecroArmy(SOLO_MYTHIC_RULES);

  for (const mythicId of MYTHIC_IDS) {
    simTest(`Necromancer solo-army vs ${mythicId}`, () => {
      const res = runSoloMythicArmy(hero, shadows, mythicId, SOLO_RUNS, SOLO_MYTHIC_RULES);
      const pct = (res.winRate * 100).toFixed(1);
      const se = (res.se * 100).toFixed(1);
      const diag = res.winRate > HIGH_DIAGNOSTIC ? ' [DIAGNOSTIC: >98% hot]' : '';
      console.log(`[solo-mythic-army] Necromancer vs ${mythicId}: ${pct}% (${res.wins}/${res.runs}, se ${se}%, mean ${res.meanRounds.toFixed(1)} rounds, ${res.capped} capped)${diag}`);
      expect(res.winRate, `Necromancer vs ${mythicId} win rate ${pct}% below 75% floor`).toBeGreaterThanOrEqual(HARD_FLOOR);
    }, SOLO_BUDGET);
  }

  simTest('Necromancer solo-army reported row: plain Mythic boss + 4 S-rank normal adds (exercises Arise and Reform)', () => {
    const adds: SimRow[] = monsterRows(
      { name: 'Cultist', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] },
      [combatantId('add-1'), combatantId('add-2'), combatantId('add-3'), combatantId('add-4')],
      SOLO_MYTHIC_RULES,
    ).map(row => ({ row, policy: monsterPolicy }));

    const res = runSoloMythicArmy(hero, shadows, 'plain', ADDS_RUNS, SOLO_MYTHIC_RULES, adds);
    // Spot-check one seeded play to verify Arise is actively cast against fallen adds
    const probe = playFight({ rows: [hero, ...shadows, scripted('plain', SOLO_MYTHIC_RULES), ...adds], rules: SOLO_MYTHIC_RULES, tallyDamage: false }, 1);
    const ariseCasts = probe.tally.hero?.acts[NECRO_ARISE_ID] ?? 0;
    console.log(`[solo-mythic-army:adds] Necromancer vs plain + 4 S normals: ${(res.winRate * 100).toFixed(1)}% (${res.wins}/${res.runs}, mean ${res.meanRounds.toFixed(1)} rounds, ${res.capped} capped, probe Arise casts: ${ariseCasts})`);
    expect(res.capped).toBe(0);
  }, SOLO_BUDGET);

  simTest('PR A: GM Adjust roll is strictly monotonic on PR 3 Necromancer Arise fixture and respects nat 20/1 bounds and fudge isolation', () => {
    const arise = hero.row.abilities.find(a => a.id === NECRO_ARISE_ID)!;
    const dummy = monsterRows({ name: 'Cultist', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('c-dead')], SOLO_MYTHIC_RULES)[0]!;
    const anchor = monsterRows({ name: 'Anchor', rank: 'S', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], statuses: [] }, [combatantId('c-live')], SOLO_MYTHIC_RULES)[0]!;
    const heroReady = { ...hero.row, place: place(2, 2), mana: 200 };
    const deadRow = { ...dummy, place: place(4, 2), life: { at: 'dead' as const } };
    const liveRow = { ...anchor, place: place(10, 10) };

    const baseSetup = reduce(null, { type: 'add', fightId: fightId('f-adj-sim'), rows: [heroReady, deadRow, liveRow], openings: [] }, { rules: SOLO_MYTHIC_RULES }).fight!;
    const started = reduce(baseSetup, { type: 'start', openings: [{ id: heroReady.id, d20: 20, tie: 3 }, { id: deadRow.id, d20: 1, tie: 2 }, { id: liveRow.id, d20: 1, tie: 1 }] }, { rules: SOLO_MYTHIC_RULES }).fight as Running;
    // Also set hidden fight fudge (+5 party) to verify Arise ignores hidden fudge while honoring Adjust roll
    const fudged = reduce(started, { type: 'fudge', set: { kind: 'weight', scope: { kind: 'side', side: 'party' }, n: 5 } }, { rules: SOLO_MYTHIC_RULES }).fight as Running;

    const u = fudged.rows.find(r => r.id === heroReady.id)!;
    const bonus = riseBonus(u, arise.raise!, SOLO_MYTHIC_RULES);
    // Center riseDc at bonus + 11 (zeroing dcRank) so unadjusted Arise passes on 11..20 (50%), -10 passes only on nat 20 (5%), +10 passes on 2..20 (95%)
    const simRules: Rules = {
      ...SOLO_MYTHIC_RULES,
      shadow: {
        ...SOLO_MYTHIC_RULES.shadow,
        dcBase: bonus + 11,
        dcRank: { E: 0, D: 0, C: 0, B: 0, A: 0, S: 0 },
      },
    };
    const TRIALS = 200;

    const rateAt = (adj: number): number => {
      const rng = seededSource(1001 + adj + 20);
      let wins = 0;
      for (let i = 0; i < TRIALS; i++) {
        const fAdj = adj === 0 ? fudged : reduce(fudged, { type: 'adjustRoll', id: deadRow.id, n: adj }, { rules: simRules }).fight as Running;
        const n = needs(arise, u, fAdj.rows, deadRow.id, fAdj.grid, fAdj.now, simRules);
        const rolls = drawNeeds(n, rng.random, weightsFor(fAdj, u.id, n));
        const res = reduce(fAdj, { type: 'act', by: u.id, ability: arise.id, aim: deadRow.id, rolls }, { rules: simRules }).fight as Running;
        if (res.rows.some(isRisen)) wins++;
        expect(res.rows.find(r => r.id === deadRow.id)?.adjust).toBeUndefined();
      }
      return wins / TRIALS;
    };

    const low = rateAt(-10), mid = rateAt(0), high = rateAt(10);
    console.log(`[arise-adjust-sim] Necromancer Arise pass rate (${TRIALS} trials each): -10=${(low * 100).toFixed(1)}%, 0=${(mid * 100).toFixed(1)}%, +10=${(high * 100).toFixed(1)}%`);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(low).toBeGreaterThanOrEqual(0.01);
    expect(low).toBeLessThan(0.15);
    expect(high).toBeGreaterThan(0.85);
    expect(high).toBeLessThanOrEqual(0.99);
  }, workBudget(0));
});

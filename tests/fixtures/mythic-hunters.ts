// mythic-hunters.ts: reusable solo-Mythic hunter fixtures built as real Hunters through `hunterRow` (never hand-crafted
// NewRows) for PR 2 (Hemomancer) and PR 4+ (Bladefiend, Rifthunter, etc.). Every fixture uses S-rank level 70 stats
// split 2:1, a 32-node legal Mythic skill tree, an S-band title within titleBudget.S, and 6-slot Mythic middle-grade
// gear verified via itemSpend / gradeOfSpend.
import { RULES } from '../../src/core/rules.ts';
import type { Rules } from '../../src/core/rules.ts';
import { newHunter } from '../../src/core/save.ts';
import type { Hunter, Item, Title } from '../../src/core/save.ts';
import { parseClassNodeId, parseSaveId } from '../../src/core/ids.ts';
import type { ClassNodeId, ItemId, TitleId } from '../../src/core/ids.ts';
import type { StatKey } from '../../src/core/stats.ts';
import { pointsAt, split } from '../../src/core/hunter/derive.ts';
import type { Kit } from '../../src/core/hunter/derive.ts';
import { earnClass } from '../../src/core/hunter/classes.ts';
import type { BloodVessel } from '../../src/core/hunter/blood-vessels.ts';
import { hunterSheet } from '../../src/core/hunter/sheet.ts';
import { lifeAfter } from '../../src/core/hunter/vitals.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { piece, WEAR_LIMIT } from '../../src/core/registry/items.ts';
import type { ArmorSlot, ItemBonus } from '../../src/core/registry/items.ts';
import { middleBudget } from '../../src/core/registry/item-budget.ts';
import type { ClassName } from '../../src/core/registry/jobs.ts';
import type { HeldItem } from '../../src/core/registry/item-book.ts';
import { ATTACK_ID, wornAbilityId } from '../../src/core/registry/abilities.ts';
import { HEMOMANCER_TREE } from '../../src/core/registry/class-hemomancer.ts';
import { NECROMANCER_TREE } from '../../src/core/registry/class-necromancer.ts';
import { BLADEFIEND_TREE } from '../../src/core/registry/class-bladefiend.ts';
import { RIFTHUNTER_TREE } from '../../src/core/registry/class-rifthunter.ts';
import { STARFORGER_SOLO_SPEC } from './starforger-solo.ts';
import { NULLWEAVER_SOLO_SPEC } from './nullweaver-solo.ts';
import { DREADNOUGHT_SOLO_SPEC } from './dreadnought-solo.ts';
import { GODFIST_SOLO_SPEC } from './godfist-solo.ts';
import { DAWNBRINGER_SOLO_SPEC } from './dawnbringer-solo.ts';
import { USURPER_SOLO_SPEC } from './usurper-solo.ts';
import { hunterRow } from '../../src/core/combat/rows.ts';
import { abilityId, combatantId } from '../../src/core/combat/ability-types.ts';
import type { AbilityId } from '../../src/core/combat/ability-types.ts';
import { statusKey } from '../../src/core/combat/effect-ops.ts';
import type { Body } from '../../src/core/combat/effect-ops.ts';
import { isUp, rowHp } from '../../src/core/combat/row-hp.ts';
import { usable as canUse } from '../../src/core/combat/resolve.ts';
import { warded } from '../../src/core/combat/standing.ts';
import { dist, place } from '../../src/core/combat/space.ts';
import type { Place } from '../../src/core/combat/space.ts';
import { spotOf, stepToward } from '../../src/core/combat/fight-view.ts';
import { taunter } from '../../src/core/combat/threat.ts';
import { withKeystones } from './keystone-rules.ts';
import { scriptsOn } from '../models/fight-sim.ts';
import type { Policy, SimRow } from '../models/fight-sim.ts';

const AT = '2026-11-25T12:00:00.000Z';
const itemId = (s: string): ItemId => parseSaveId<'i'>(s)!;
const titleId = (s: string): TitleId => parseSaveId<'t'>(s)!;
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

/** Shipped rules with both mythic scripts and keystones enabled for Mythic solo-sim checks. */
export const SOLO_MYTHIC_RULES: Rules = withKeystones(scriptsOn(RULES));

/** Spec describing one Mythic-class solo-sim hunter build. */
export type MythicSoloSpec = {
  readonly className: ClassName;
  readonly main: StatKey;
  readonly second: StatKey;
  readonly kit: Kit;
  /** Canonical 32 buyable node ids in valid purchase order. */
  readonly nodes: readonly ClassNodeId[];
  readonly title: Title;
  readonly gear: (R: Rules) => readonly Item[];
  readonly policy: Policy;
  /** Optional class reaction ability armed at fight start (e.g. Bladefiend's Judgment Parry). */
  readonly armedReactionId?: AbilityId;
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

/** Builds a real S-rank level 70 Hunter from `spec` with full HP/mana, all 32 class nodes bought, and optional Crimson Vessels. */
export function buildMythicSoloHunter(
  spec: MythicSoloSpec,
  R: Rules = SOLO_MYTHIC_RULES,
  opts?: { readonly vessels?: readonly BloodVessel[] },
): Hunter {
  const base = newHunter(R);
  const level = R.rankLevels.S;
  const stats = split(spec.main, spec.second, pointsAt(level, R), R);
  const gear = [...spec.gear(R)];
  const items = gear.map(({ id, qty, ...item }): HeldItem => ({ kind: 'adhoc', id, qty, item }));
  const equipped: Record<string, ItemId | null> = { ...base.equipped };
  for (const it of gear) if (it.slot) equipped[it.slot] = it.id;

  const pre: Hunter = {
    ...base,
    name: spec.className,
    rank: 'S',
    level,
    stats,
    titles: [spec.title],
    titleId: spec.title.id,
    items,
    equipped,
  };
  const earned = earnClass(pre, spec.className, { at: AT, R });
  if (isRefused(earned)) throw new Error(`earnClass(${spec.className}) refused: ${earned.why}`);

  const withNodes: Hunter = {
    ...earned,
    classes: {
      ...earned.classes,
      [spec.className]: {
        ...earned.classes[spec.className]!,
        nodes: [...spec.nodes],
        ...(opts?.vessels?.length ? { vessels: [...opts.vessels] } : {}),
      },
    },
  };
  const { sheet } = hunterSheet(withNodes, R);
  // Large heal amount clamped by hunterRow's `lifeAfter(..., maxChanged, postWornHpMax)` to full post-worn HP.
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

/** Converts `spec` into a `SimRow` through the real `hunterRow` builder. */
export function buildMythicSoloRow(
  spec: MythicSoloSpec,
  R: Rules = SOLO_MYTHIC_RULES,
  opts?: { readonly vessels?: readonly BloodVessel[] },
): SimRow {
  const h = buildMythicSoloHunter(spec, R, opts);
  const baseRow = hunterRow(h, combatantId('hero'), R);
  const row = spec.armedReactionId
    ? { ...baseRow, armed: { ability: spec.armedReactionId, on: null, spent: false } }
    : baseRow;
  return { row, policy: spec.policy };
}

/** Canonical Crimson Vessel tiers for Hemomancer balance sims: 27/120 (3 C-elites), 84/120 (3 S-normals), 120/120 (3 S-bosses). */
export const HEMO_VESSELS_12: readonly BloodVessel[] = [
  { name: 'Orc Elite A', rank: 'C', kind: 'elite', at: AT },
  { name: 'Orc Elite B', rank: 'C', kind: 'elite', at: AT },
  { name: 'Orc Elite C', rank: 'C', kind: 'elite', at: AT },
];
export const HEMO_VESSELS_18: readonly BloodVessel[] = [
  { name: 'Jeju Ant A', rank: 'S', kind: 'normal', at: AT },
  { name: 'Jeju Ant B', rank: 'S', kind: 'normal', at: AT },
  { name: 'Jeju Ant C', rank: 'S', kind: 'normal', at: AT },
];
export const HEMO_VESSELS_24: readonly BloodVessel[] = [
  { name: 'Ant King', rank: 'S', kind: 'boss', at: AT },
  { name: 'Ice Monarch', rank: 'S', kind: 'boss', at: AT },
  { name: 'Beast Monarch', rank: 'S', kind: 'boss', at: AT },
];

/**
 * Builds a C-rank geared Hemomancer (0 tree nodes, 6 C-rank middle-budget light pieces matching `geared`, optional
 * Crimson Vessels) through the real `hunterRow` builder for C-rank party balance checks in `fight-sim.test.ts`.
 */
export function buildCRankHemomancerRow(
  vessels: readonly BloodVessel[] = HEMO_VESSELS_12,
  R: Rules = RULES,
  id = 'hemomancer',
): SimRow {
  const base = newHunter(R);
  const level = R.rankLevels.C;
  const stats = split('pow', 'vit', pointsAt(level, R), R);
  const total = WEAR_LIMIT * middleBudget(R, 'C');
  const big = Math.round(total * R.fight.mainShare);
  const small = Math.round(total - big);
  const slots: readonly ArmorSlot[] = ['chest', 'legs', 'head', 'feet', 'offhand'];
  const gear: Item[] = [
    {
      id: itemId('i31'), name: 'C-Rank Focus', rar: 'rare', type: 'weapon', slot: 'weapon', qty: 1, dice: '1d6',
      attack: 'strike', bonus: { pow: big, vit: small }, desc: '', armor: 0, resist: 0,
    },
    ...slots.map((slot, idx): Item => {
      const p = piece('light', slot, R);
      return {
        id: itemId(`i${32 + idx}`), name: `C-Rank ${slot}`, rar: 'rare', type: 'armor', slot, qty: 1, dice: '',
        bonus: {}, desc: '', armor: p.armor, resist: p.resist, weight: p.weight,
      };
    }),
  ];
  const items = gear.map(({ id: gid, qty, ...item }): HeldItem => ({ kind: 'adhoc', id: gid, qty, item }));
  const equipped: Record<string, ItemId | null> = { ...base.equipped };
  for (const it of gear) if (it.slot) equipped[it.slot] = it.id;

  const pre: Hunter = { ...base, name: 'Hemomancer', rank: 'C', level, stats, items, equipped };
  const earned = earnClass(pre, 'Hemomancer', { at: AT, R });
  if (isRefused(earned)) throw new Error(`earnClass(Hemomancer) refused: ${earned.why}`);
  const withVessels: Hunter = {
    ...earned,
    classes: {
      ...earned.classes,
      Hemomancer: { ...earned.classes.Hemomancer!, ...(vessels.length ? { vessels: [...vessels] } : {}) },
    },
  };
  const { sheet } = hunterSheet(withVessels, R);
  const full = { ...withVessels, life: lifeAfter(withVessels.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
  return { row: hunterRow(full, combatantId(id), R), policy: hemomancerPolicy };
}

// ── Hemomancer (Mythic, vit+pow) solo spec & policy ──

const HEMO_TRANSFUSION_ID = wornAbilityId(abilityId('hemo-transfusion'));
const HEMO_POOL_ID = wornAbilityId(abilityId('hemo-sanguine-pool'));
const HEMO_TIDES_ID = wornAbilityId(abilityId('hemo-tides-of-blood'));
const HEMO_PLAGUE_ID = wornAbilityId(abilityId('hemo-hemoplague'));
const CATACLYSM_ID = wornAbilityId(abilityId('keystone-cataclysm'));

const KEY_FRENZY = statusKey('hemo-crimson-frenzy');
const KEY_PLAGUE = statusKey('hemo-hemoplague');
const KEY_PLAGUE_UP = statusKey('hemo-hemoplague-ii');

/** Canonical 32 buyable nodes for Hemomancer (Exsanguinate, Riptide, Virulent Strain, Reaper Thirst, Blood Frenzy, Titanbane, Lord of Blood). */
export const HEMO_CANONICAL_FORKS = ['hemo-a5-l', 'hemo-b5-l', 'hemo-c5-l', 'hemo-a7-l', 'hemo-b7-l', 'hemo-c7-l'] as const;
export const HEMO_CANONICAL_NODES: readonly ClassNodeId[] = HEMOMANCER_TREE.nodes
  .filter(n => !n.forkGroup || (HEMO_CANONICAL_FORKS as readonly string[]).includes(n.id))
  .map(n => nid(n.id));

/**
 * Hemomancer solo combat policy. Uses `resolve.ts`'s full `usable` (HP prices, uses, gates, range, cooldown) so no
 * refused command is ever emitted. Intended to be wrapped in `answering(...)` for mythic omens.
 */
export const hemomancerPolicy: Policy = (f, me, _plan, R) => {
  if (me.channel?.state === 'holding') {
    const a = me.abilities.find(x => x.id === me.channel!.ability);
    const max = a?.channel?.max ?? R.fight.channelMax;
    return me.channel.charge >= max ? { type: 'release' } : { type: 'pass' };
  }
  const foes = f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side));
  if (!foes.length) return { type: 'pass' };
  const t = taunter(me);
  const forced = t ? foes.find(b => b.id === t.by) : undefined;
  const target: Body = forced ?? [...foes].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place))[0]!;

  const find = (id: string) => me.abilities.find(a => a.id === id);
  const fits = (a: ReturnType<typeof find>, aim: Body['id'] | Body['place']): boolean =>
    !!a && canUse(a, me, f.rows, aim, f.grid, f.now, R, f.fog);

  const hpRatio = me.sheet.hpMax > 0 ? rowHp(me) / me.sheet.hpMax : 1;
  const hasFrenzy = me.statuses.some(s => s.key === KEY_FRENZY);
  const targetPlagued = target.statuses.some(s => s.key === KEY_PLAGUE || s.key === KEY_PLAGUE_UP);
  const bossOmenActive = !!target.mythic && target.mythic.at !== 'calm';
  const wardFree = !(me.warded ?? []).includes('untargetable');

  // 1. Open or refresh Hemoplague for +20% damage taken and detonation heal
  const plague = find(HEMO_PLAGUE_ID);
  if (!targetPlagued && fits(plague, target.place)) return { type: 'act', ability: plague!, aim: target.place };

  // 2. Spend Apex Cataclysm when in range (ideally under Hemoplague amp)
  const cataclysm = find(CATACLYSM_ID);
  if (fits(cataclysm, target.place)) return { type: 'act', ability: cataclysm!, aim: target.place };

  // 3. Fire empowered Transfusion (Crimson Frenzy) or emergency heal Transfusion
  const transfusion = find(HEMO_TRANSFUSION_ID);
  if ((hasFrenzy || hpRatio < 0.7) && fits(transfusion, target.id)) return { type: 'act', ability: transfusion!, aim: target.id };

  // 4. Sanguine Pool: untargetable ward against standing omen or close-range aura burst when healthy
  const pool = find(HEMO_POOL_ID);
  if (wardFree && bossOmenActive && hpRatio > 0.3 && fits(pool, me.id)) {
    return { type: 'act', ability: pool!, aim: me.id };
  }

  // 5. Tides of Blood when foe stands inside self-centered radius 3
  const tides = find(HEMO_TIDES_ID);
  if (dist(me.place, target.place) <= 3 && hpRatio > 0.25 && fits(tides, me.place)) {
    return { type: 'act', ability: tides!, aim: me.place };
  }

  // 6. Standard Transfusion when ready
  if (fits(transfusion, target.id)) return { type: 'act', ability: transfusion!, aim: target.id };

  // 7. Sanguine Pool as close-range speed + aura burst when healthy
  if (dist(me.place, target.place) <= 2 && hpRatio > 0.5 && fits(pool, me.id)) {
    return { type: 'act', ability: pool!, aim: me.id };
  }

  // 8. Close to radius 3 so Tides of Blood and Sanguine Pool reach, or basic attack if adjacent
  const attack = find(ATTACK_ID);
  if (fits(attack, target.id)) return { type: 'act', ability: attack!, aim: target.id };
  const to = stepToward(f.rows.map(spotOf), me.id, target.id, me.sheet.stride, f.grid);
  return to ? { type: 'move', to: to.place } : { type: 'pass' };
};

export const HEMOMANCER_SOLO_SPEC: MythicSoloSpec = {
  className: 'Hemomancer',
  main: 'pow',
  second: 'vit',
  kit: 'light',
  nodes: HEMO_CANONICAL_NODES,
  title: {
    id: titleId('t1'),
    name: 'Blood Sovereign',
    desc: 'Master of the crimson arts.',
    bonus: { pow: 3, vit: 2 },
  },
  gear: R => [
    makeWeapon('i1', 'Crimson Focus', '1d6', { pow: 14, vit: 4 }),
    makeArmor('i2', 'Sanguine Vestments', 'chest', 'light', { pow: 12, vit: 6 }, R),
    makeArmor('i3', 'Bloodwoven Trousers', 'legs', 'light', { pow: 10, vit: 8 }, R),
    makeArmor('i4', 'Crimson Circlet', 'head', 'light', { pow: 12, vit: 6 }, R),
    makeArmor('i5', 'Veinwalker Boots', 'feet', 'light', { pow: 10, vit: 8 }, R),
    makeArmor('i6', 'Blood Chalice', 'offhand', 'light', { pow: 12, vit: 6 }, R),
  ],
  policy: hemomancerPolicy,
};

// ── Bladefiend (Mythic, str+agi) solo spec & policy ──

const BF_SLASH_ID = wornAbilityId(abilityId('bf-keen-slash'));
const BF_PARRY_ID = wornAbilityId(abilityId('bf-deflecting-edge'));
const BF_GALE_ID = wornAbilityId(abilityId('bf-rending-gale'));
const BF_CUTS_ID = wornAbilityId(abilityId('bf-hundred-cuts'));
const SHATTER_ID = wornAbilityId(abilityId('keystone-shatter'));

/** Canonical 32 buyable nodes for Bladefiend (Mirror Riposte, Razor Wind, Severing Arc, Unscathed Form, Phantom Footwork, Finishing Stroke, Sword Saint). */
export const BF_CANONICAL_FORKS = ['bf-a5-l', 'bf-b5-l', 'bf-c5-l', 'bf-a7-l', 'bf-b7-l', 'bf-c7-l'] as const;
export const BF_CANONICAL_NODES: readonly ClassNodeId[] = BLADEFIEND_TREE.nodes
  .filter(n => !n.forkGroup || (BF_CANONICAL_FORKS as readonly string[]).includes(n.id))
  .map(n => nid(n.id));

/** Bladefiend solo combat policy. Intended to be wrapped in `answering(...)` for mythic omens. */
export const bladefiendPolicy: Policy = (f, me, _plan, R) => {
  const foes = f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side));
  if (!foes.length) return { type: 'pass' };
  const t = taunter(me);
  const forced = t ? foes.find(b => b.id === t.by) : undefined;
  const target: Body = forced ?? [...foes].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place))[0]!;

  const find = (id: string) => me.abilities.find(a => a.id === id);
  const fits = (a: ReturnType<typeof find>, aim: Body['id'] | Body['place']): boolean =>
    !!a && canUse(a, me, f.rows, aim, f.grid, f.now, R, f.fog);

  // 1. Hundred Cuts for high burst + Deep Sever bleed
  const cuts = find(BF_CUTS_ID);
  if (fits(cuts, target.id)) return { type: 'act', ability: cuts!, aim: target.id };

  // 2. Rending Gale for stagger + slow + heavy cleave
  const gale = find(BF_GALE_ID);
  if (fits(gale, target.id)) return { type: 'act', ability: gale!, aim: target.id };

  // 3. Worldbreaker Shatter when adjacent
  const shatter = find(SHATTER_ID);
  if (fits(shatter, target.id)) return { type: 'act', ability: shatter!, aim: target.id };

  // 4. Keen Slash quick strike (range 2)
  const slash = find(BF_SLASH_ID);
  if (fits(slash, target.id)) return { type: 'act', ability: slash!, aim: target.id };

  // 5. Fallback basic strike or close distance
  const attack = find(ATTACK_ID);
  if (fits(attack, target.id)) return { type: 'act', ability: attack!, aim: target.id };
  const to = stepToward(f.rows.map(spotOf), me.id, target.id, me.sheet.stride, f.grid);
  return to ? { type: 'move', to: to.place } : { type: 'pass' };
};

export const BLADEFIEND_SOLO_SPEC: MythicSoloSpec = {
  className: 'Bladefiend',
  main: 'str',
  second: 'agi',
  kit: 'medium',
  nodes: BF_CANONICAL_NODES,
  title: {
    id: titleId('t2'),
    name: 'Blade Monarch',
    desc: 'Master of the severing sword.',
    bonus: { str: 3, agi: 2 },
  },
  gear: R => [
    makeWeapon('i11', 'Ashforged Katana', '1d8', { str: 14, agi: 4 }),
    makeArmor('i12', 'Gale Hauberk', 'chest', 'medium', { str: 12, agi: 6 }, R),
    makeArmor('i13', 'Tempest Greaves', 'legs', 'medium', { str: 10, agi: 8 }, R),
    makeArmor('i14', 'Demon Mask', 'head', 'medium', { str: 12, agi: 6 }, R),
    makeArmor('i15', 'Flash Boots', 'feet', 'medium', { str: 10, agi: 8 }, R),
    makeArmor('i16', 'Steel Scabbard', 'offhand', 'medium', { str: 12, agi: 6 }, R),
  ],
  policy: bladefiendPolicy,
  armedReactionId: BF_PARRY_ID,
};

// ── Rifthunter (Mythic, ins+ctl) solo spec & policy ──

const RH_BOLT_ID = wornAbilityId(abilityId('rh-rift-bolt'));
const RH_STEP_ID = wornAbilityId(abilityId('rh-rift-step'));
const RH_TETHER_ID = wornAbilityId(abilityId('rh-rift-tether'));
const RH_VERDICT_ID = wornAbilityId(abilityId('rh-fourth-verdict'));

const KEY_RH_FOURTH = statusKey('rh-fourth-echo');
const KEY_RH_TETHERED = statusKey('rh-tethered');
const KEY_RH_TETHERED_UP = statusKey('rh-tethered-ii');

/** Canonical 32 buyable nodes for Rifthunter (Piercing Round, Phase Slip, Rift Piercer, Opening Volley, Rift Velocity, Behemoth Hunter, Rift Monarch). */
export const RH_CANONICAL_FORKS = ['rh-a5-l', 'rh-b5-l', 'rh-c5-l', 'rh-a7-l', 'rh-b7-l', 'rh-c7-l'] as const;
export const RH_CANONICAL_NODES: readonly ClassNodeId[] = RIFTHUNTER_TREE.nodes
  .filter(n => !n.forkGroup || (RH_CANONICAL_FORKS as readonly string[]).includes(n.id))
  .map(n => nid(n.id));

/** Picks a legal Rift Step blink destination within range 5 that keeps ideal kiting distance (5..7 tiles) from `target`. */
function bestBlinkTile(
  step: NonNullable<ReturnType<Body['abilities']['find']>>,
  me: Body,
  target: Body,
  rows: readonly Body[],
  grid: Parameters<typeof canUse>[4],
  now: Parameters<typeof canUse>[5],
  R: Rules,
  fog: Parameters<typeof canUse>[7],
): Place | null {
  let best: Place | null = null;
  let bestScore = -Infinity;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const p = place(x, y);
      if (p.x === me.place.x && p.y === me.place.y) continue;
      if (dist(me.place, p) > 5) continue;
      if (!canUse(step, me, rows, p, grid, now, R, fog)) continue;
      const d = dist(p, target.place);
      // Prefer standing 5..7 tiles away (outside melee, comfortably inside range-8 Rift Bolt / Tether)
      const score = d <= 8 ? 20 - Math.abs(d - 6) : 10 - d;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return best;
}

/** Rifthunter solo combat policy. Intended to be wrapped in `answering(...)` for mythic omens. */
export const rifthunterPolicy: Policy = (f, me, _plan, R) => {
  const foes = f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side));
  if (!foes.length) return { type: 'pass' };
  const t = taunter(me);
  const forced = t ? foes.find(b => b.id === t.by) : undefined;
  const target: Body = forced ?? [...foes].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place))[0]!;

  const find = (id: string) => me.abilities.find(a => a.id === id);
  const fits = (a: ReturnType<typeof find>, aim: Body['id'] | Body['place']): boolean =>
    !!a && canUse(a, me, f.rows, aim, f.grid, f.now, R, f.fog);

  const fourthReady = me.statuses.some(s => s.key === KEY_RH_FOURTH);
  const targetTethered = target.statuses.some(s => s.key === KEY_RH_TETHERED || s.key === KEY_RH_TETHERED_UP);
  const d = dist(me.place, target.place);

  // 1. Rift Step blink: reposition away when boss closes within 3 tiles (or buff Phase Edge before big volley)
  const step = find(RH_STEP_ID);
  if (step && (d <= 3 || fourthReady)) {
    const dest = bestBlinkTile(step, me, target, f.rows, f.grid, f.now, R, f.fog);
    if (dest) return { type: 'act', ability: step, aim: dest };
  }

  // 2. Fire Fourth Verdict on 4th-shot guaranteed crit
  const verdict = find(RH_VERDICT_ID);
  if (fourthReady && fits(verdict, target.id)) return { type: 'act', ability: verdict!, aim: target.id };

  // 3. Apply Rift Tether when target is not tethered (1-round root + burst window)
  const tether = find(RH_TETHER_ID);
  if (!targetTethered && !fourthReady && fits(tether, target.id)) return { type: 'act', ability: tether!, aim: target.id };

  // 4. Fire Fourth Verdict off cooldown for stagger + mark + burst
  if (fits(verdict, target.id)) return { type: 'act', ability: verdict!, aim: target.id };

  // 5. Rift Bolt bread-and-butter precision shot
  const bolt = find(RH_BOLT_ID);
  if (fits(bolt, target.id)) return { type: 'act', ability: bolt!, aim: target.id };

  // 6. Close into range if needed
  const attack = find(ATTACK_ID);
  if (fits(attack, target.id)) return { type: 'act', ability: attack!, aim: target.id };
  const to = stepToward(f.rows.map(spotOf), me.id, target.id, me.sheet.stride, f.grid);
  return to ? { type: 'move', to: to.place } : { type: 'pass' };
};

export const RIFTHUNTER_SOLO_SPEC: MythicSoloSpec = {
  className: 'Rifthunter',
  main: 'ins',
  second: 'ctl',
  kit: 'light',
  nodes: RH_CANONICAL_NODES,
  title: {
    id: titleId('t3'),
    name: 'Fourth Chamber',
    desc: 'Unerring hunter across the rift.',
    bonus: { ins: 3, ctl: 2 },
  },
  gear: R => [
    makeWeapon('i21', 'Rift Carbine', '1d8', { ins: 14, ctl: 4 }),
    makeArmor('i22', 'Rift Coat', 'chest', 'light', { ins: 12, ctl: 6 }, R),
    makeArmor('i23', 'Strider Leggings', 'legs', 'light', { ins: 10, ctl: 8 }, R),
    makeArmor('i24', 'Sight Visor', 'head', 'light', { ins: 12, ctl: 6 }, R),
    makeArmor('i25', 'Phase Boots', 'feet', 'light', { ins: 10, ctl: 8 }, R),
    makeArmor('i26', 'Rift Quiver', 'offhand', 'light', { ins: 12, ctl: 6 }, R),
  ],
  policy: rifthunterPolicy,
};

// ── Necromancer (Mythic, pre+pow) solo spec (solo-army combat policy lives in tests/necromancer-solo-sim.test.ts) ──

/** Canonical 32 buyable nodes for Necromancer (Greater Arise, Imperial Domain, Phantom Exchange, Endless Arise, Walking Domain, Abyssal Thrift, Shadow Monarch). */
export const NECRO_CANONICAL_FORKS = ['necro-a5-l', 'necro-b5-l', 'necro-c5-l', 'necro-a7-l', 'necro-b7-l', 'necro-c7-l'] as const;
export const NECRO_CANONICAL_NODES: readonly ClassNodeId[] = NECROMANCER_TREE.nodes
  .filter(n => !n.forkGroup || (NECRO_CANONICAL_FORKS as readonly string[]).includes(n.id))
  .map(n => nid(n.id));

export const NECROMANCER_SOLO_SPEC: MythicSoloSpec = {
  className: 'Necromancer',
  main: 'pre',
  second: 'pow',
  kit: 'light',
  nodes: NECRO_CANONICAL_NODES,
  title: {
    id: titleId('t4'),
    name: 'King of Shadows',
    desc: 'Leads a shadow army.',
    bonus: { pow: 5 },
  },
  gear: R => [
    makeWeapon('i31', 'Monarch Scepter', '1d6', { pre: 14, pow: 4 }),
    makeArmor('i32', 'Shadow Mantle', 'chest', 'light', { pre: 12, pow: 6 }, R),
    makeArmor('i33', 'Umbral Trousers', 'legs', 'light', { pre: 10, pow: 8 }, R),
    makeArmor('i34', 'Crown of Ash', 'head', 'light', { pre: 12, pow: 6 }, R),
    makeArmor('i35', 'Nightstep Boots', 'feet', 'light', { pre: 10, pow: 8 }, R),
    makeArmor('i36', 'Obsidian Signet', 'offhand', 'light', { pre: 12, pow: 6 }, R),
  ],
  policy: () => ({ type: 'pass' }),
};

export { STARFORGER_SOLO_SPEC, NULLWEAVER_SOLO_SPEC, DREADNOUGHT_SOLO_SPEC, GODFIST_SOLO_SPEC, DAWNBRINGER_SOLO_SPEC, USURPER_SOLO_SPEC };

/** All shipped Mythic-class solo specs verified by `tests/mythic-solo-sim.test.ts`. */
export const MYTHIC_SOLO_SPECS: readonly MythicSoloSpec[] = [
  HEMOMANCER_SOLO_SPEC,
  NECROMANCER_SOLO_SPEC,
  STARFORGER_SOLO_SPEC,
  DREADNOUGHT_SOLO_SPEC,
  BLADEFIEND_SOLO_SPEC,
  RIFTHUNTER_SOLO_SPEC,
  NULLWEAVER_SOLO_SPEC,
  GODFIST_SOLO_SPEC,
  DAWNBRINGER_SOLO_SPEC,
  USURPER_SOLO_SPEC,
];

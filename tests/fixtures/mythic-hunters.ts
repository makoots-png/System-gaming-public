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
import { hunterSheet } from '../../src/core/hunter/sheet.ts';
import { lifeAfter } from '../../src/core/hunter/vitals.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { piece } from '../../src/core/registry/items.ts';
import type { ArmorSlot, ItemBonus } from '../../src/core/registry/items.ts';
import type { ClassName } from '../../src/core/registry/jobs.ts';
import { ATTACK_ID, wornAbilityId } from '../../src/core/registry/abilities.ts';
import { HEMOMANCER_TREE } from '../../src/core/registry/class-hemomancer.ts';
import { hunterRow } from '../../src/core/combat/rows.ts';
import { abilityId, combatantId } from '../../src/core/combat/ability-types.ts';
import { statusKey } from '../../src/core/combat/effect-ops.ts';
import type { Body } from '../../src/core/combat/effect-ops.ts';
import { isUp, rowHp } from '../../src/core/combat/row-hp.ts';
import { usable as canUse } from '../../src/core/combat/resolve.ts';
import { warded } from '../../src/core/combat/standing.ts';
import { dist } from '../../src/core/combat/space.ts';
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

/** Builds a real S-rank level 70 Hunter from `spec` with full HP/mana and all 32 class nodes bought. */
export function buildMythicSoloHunter(spec: MythicSoloSpec, R: Rules = SOLO_MYTHIC_RULES): Hunter {
  const base = newHunter(R);
  const level = R.rankLevels.S;
  const stats = split(spec.main, spec.second, pointsAt(level, R), R);
  const items = [...spec.gear(R)];
  const equipped: Record<string, ItemId | null> = { ...base.equipped };
  for (const it of items) if (it.slot) equipped[it.slot] = it.id;

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
      [spec.className]: { ...earned.classes[spec.className]!, nodes: [...spec.nodes] },
    },
  };
  const { sheet } = hunterSheet(withNodes, R);
  // Large heal amount clamped by hunterRow's `lifeAfter(..., maxChanged, postWornHpMax)` to full post-worn HP.
  return { ...withNodes, life: lifeAfter(withNodes.life, { type: 'heal', amount: 100_000 }, 100_000), mana: sheet.manaMax };
}

/** Converts `spec` into a `SimRow` through the real `hunterRow` builder. */
export function buildMythicSoloRow(spec: MythicSoloSpec, R: Rules = SOLO_MYTHIC_RULES): SimRow {
  const h = buildMythicSoloHunter(spec, R);
  return { row: hunterRow(h, combatantId('hero'), R), policy: spec.policy };
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

/** All shipped Mythic-class solo specs verified by `tests/mythic-solo-sim.test.ts`. */
export const MYTHIC_SOLO_SPECS: readonly MythicSoloSpec[] = [HEMOMANCER_SOLO_SPEC];

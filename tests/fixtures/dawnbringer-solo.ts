// dawnbringer-solo.ts: Dawnbringer (Mythic, dis+pre) solo-sim hunter spec and combat policy.
// Built as a real S-rank level 70 Hunter through `buildMythicSoloRow` (from mythic-hunters.ts) with 2:1 dis+pre stats,
// 32 canonical legal Mythic tree nodes, S-band title within titleBudget.S, 6 Mythic middle-grade light pieces, and
// armed lethal reaction Last Light.
import type { Rules } from '../../src/core/rules.ts';
import type { Item } from '../../src/core/save.ts';
import { parseClassNodeId, parseSaveId } from '../../src/core/ids.ts';
import type { ClassNodeId, ItemId, TitleId } from '../../src/core/ids.ts';
import type { Kit } from '../../src/core/hunter/derive.ts';
import { piece } from '../../src/core/registry/items.ts';
import type { ArmorSlot, ItemBonus } from '../../src/core/registry/items.ts';
import { ATTACK_ID, wornAbilityId } from '../../src/core/registry/abilities.ts';
import { DAWNBRINGER_TREE } from '../../src/core/registry/class-dawnbringer.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { statusKey } from '../../src/core/combat/effect-ops.ts';
import type { Body } from '../../src/core/combat/effect-ops.ts';
import { isUp, rowHp } from '../../src/core/combat/row-hp.ts';
import { usable as canUse } from '../../src/core/combat/resolve.ts';
import { warded } from '../../src/core/combat/standing.ts';
import { dist } from '../../src/core/combat/space.ts';
import { spotOf, stepToward } from '../../src/core/combat/fight-view.ts';
import { taunter } from '../../src/core/combat/threat.ts';
import type { Policy } from '../models/fight-sim.ts';
import type { MythicSoloSpec } from './mythic-hunters.ts';

const itemId = (s: string): ItemId => parseSaveId<'i'>(s)!;
const titleId = (s: string): TitleId => parseSaveId<'t'>(s)!;
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

export const DAWNBRINGER_SUNLANCE_ID = wornAbilityId(abilityId('dawn-sunlance'));
export const DAWNBRINGER_BENEDICTION_ID = wornAbilityId(abilityId('dawn-benediction'));
export const DAWNBRINGER_WARD_ID = wornAbilityId(abilityId('dawn-daybreak-ward'));
export const DAWNBRINGER_LAST_LIGHT_ID = wornAbilityId(abilityId('dawn-last-light'));

export const KEY_DAWN_ASCENSION = statusKey('dawn-ascension');
export const KEY_DAWN_SAFEGUARD = statusKey('dawn-safeguard');
const KEY_DAWN_SUNBLIND = statusKey('dawn-sunblind');

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

/**
 * Canonical 32 buyable nodes for Dawnbringer (Blazing Lance, Overflowing Grace, Solstice Ward, Radiant Breaker,
 * Phoenix Rebuke, Sunlit Bulwark, Avatar of Dawn).
 */
export const DAWNBRINGER_CANONICAL_FORKS = [
  'dawn-a5-l', 'dawn-b5-l', 'dawn-c5-l',
  'dawn-a7-r', 'dawn-b7-r', 'dawn-c7-l',
] as const;

export const DAWNBRINGER_CANONICAL_NODES: readonly ClassNodeId[] = DAWNBRINGER_TREE.nodes
  .filter(n => !n.forkGroup || (DAWNBRINGER_CANONICAL_FORKS as readonly string[]).includes(n.id))
  .map(n => nid(n.id));

/**
 * Dawnbringer solo combat policy. Weaves Benediction (cleanse, heal, and Hook H2 overheal smite within 6 tiles),
 * Daybreak Ward (shield + Dawn Safeguard), and Sunlance (Ascension-scaled solar curse + stagger) to reach Ascension 3
 * quickly while pressing Radiant Breaker damage. Intended to be wrapped in `answering(...)` for mythic omens.
 */
export const dawnbringerPolicy: Policy = (f, me, _plan, R) => {
  const find = (id: string) => me.abilities.find(a => a.id === id);
  const fits = (a: ReturnType<typeof find>, aim: Body['id'] | Body['place']): boolean =>
    !!a && canUse(a, me, f.rows, aim, f.grid, f.now, R, f.fog);

  const hpRatio = me.sheet.hpMax > 0 ? rowHp(me) / me.sheet.hpMax : 1;
  const shieldAmount = me.shield && me.shield.until > f.now ? me.shield.amount : 0;
  const shieldRatio = me.sheet.hpMax > 0 ? shieldAmount / me.sheet.hpMax : 0;
  const ascStacks = me.statuses.find(s => s.key === KEY_DAWN_ASCENSION)?.stacks ?? 0;

  const benediction = find(DAWNBRINGER_BENEDICTION_ID);
  const ward = find(DAWNBRINGER_WARD_ID);
  const sunlance = find(DAWNBRINGER_SUNLANCE_ID);

  const foes = f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side));
  if (!foes.length) {
    if (hpRatio < 0.85 && fits(benediction, me.id)) return { type: 'act', ability: benediction!, aim: me.id };
    if (shieldRatio < 0.15 && fits(ward, me.id)) return { type: 'act', ability: ward!, aim: me.id };
    if (ascStacks < 3 && fits(benediction, me.id)) return { type: 'act', ability: benediction!, aim: me.id };
    return { type: 'pass' };
  }

  const t = taunter(me);
  const forced = t ? foes.find(b => b.id === t.by) : undefined;
  const target: Body = forced ?? [...foes].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place))[0]!;
  const d = dist(me.place, target.place);
  const targetBlinded = target.statuses.some(s => s.key === KEY_DAWN_SUNBLIND);

  // 1. Emergency heal when HP dips below 55%
  if (hpRatio < 0.55 && fits(benediction, me.id)) {
    return { type: 'act', ability: benediction!, aim: me.id };
  }

  // 2. Daybreak Ward when shield is low and HP is under pressure (`answering()` already handles shield omens)
  if (shieldRatio < 0.12 && hpRatio < 0.50 && fits(ward, me.id)) {
    return { type: 'act', ability: ward!, aim: me.id };
  }

  // 3. Weave Benediction in overheal-smite range (<= 6 tiles) while climbing Ascension or once Sunblind is active
  if (d <= 6 && (ascStacks < 3 || (targetBlinded && hpRatio >= 0.85)) && fits(benediction, me.id)) {
    return { type: 'act', ability: benediction!, aim: me.id };
  }

  // 4. Primary offense: Sunlance (range 4..7 with Ascension)
  if (fits(sunlance, target.id)) {
    return { type: 'act', ability: sunlance!, aim: target.id };
  }

  // 5. Close into Sunlance / overheal-smite range
  const to = stepToward(f.rows.map(spotOf), me.id, target.id, me.sheet.stride, f.grid);
  if (to) return { type: 'move', to: to.place };

  // 6. Fallbacks if boxed in
  if (shieldRatio < 0.12 && fits(ward, me.id)) return { type: 'act', ability: ward!, aim: me.id };
  if (fits(benediction, me.id)) return { type: 'act', ability: benediction!, aim: me.id };
  const attack = find(ATTACK_ID);
  if (fits(attack, target.id)) return { type: 'act', ability: attack!, aim: target.id };
  return { type: 'pass' };
};

export const DAWNBRINGER_SOLO_SPEC: MythicSoloSpec = {
  className: 'Dawnbringer',
  main: 'dis',
  second: 'pre',
  kit: 'light',
  nodes: DAWNBRINGER_CANONICAL_NODES,
  title: {
    id: titleId('t8'),
    name: 'Herald of Dawn',
    desc: 'Bearer of solar light and unbroken vows.',
    bonus: { dis: 5 },
  },
  gear: R => [
    makeWeapon('i71', 'Dawnfire Scepter', '1d6', { dis: 14, pre: 4 }),
    makeArmor('i72', 'Sunwoven Vestments', 'chest', 'light', { dis: 12, pre: 6 }, R),
    makeArmor('i73', 'Daybreak Leggings', 'legs', 'light', { dis: 10, pre: 8 }, R),
    makeArmor('i74', 'Solar Circlet', 'head', 'light', { dis: 12, pre: 6 }, R),
    makeArmor('i75', 'Horizon Sandals', 'feet', 'light', { dis: 10, pre: 8 }, R),
    makeArmor('i76', 'Censer of First Light', 'offhand', 'light', { dis: 12, pre: 6 }, R),
  ],
  policy: dawnbringerPolicy,
  armedReactionId: DAWNBRINGER_LAST_LIGHT_ID,
};

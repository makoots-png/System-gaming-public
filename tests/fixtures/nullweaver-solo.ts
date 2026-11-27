// nullweaver-solo.ts: Nullweaver (Mythic, ins+pow) solo-sim hunter spec and combat policy.
// Built as a real S-rank level 70 Hunter through `buildMythicSoloRow` (from mythic-hunters.ts) with 2:1 ins+pow stats,
// 32 canonical legal Mythic tree nodes, S-band title within titleBudget.S, 6 Mythic middle-grade light pieces, and
// Null Aegis armed at fight start.
import type { Rules } from '../../src/core/rules.ts';
import type { Item } from '../../src/core/save.ts';
import { parseClassNodeId, parseSaveId } from '../../src/core/ids.ts';
import type { ClassNodeId, ItemId, TitleId } from '../../src/core/ids.ts';
import type { Kit } from '../../src/core/hunter/derive.ts';
import { piece } from '../../src/core/registry/items.ts';
import type { ArmorSlot, ItemBonus } from '../../src/core/registry/items.ts';
import { ATTACK_ID, wornAbilityId } from '../../src/core/registry/abilities.ts';
import { NULLWEAVER_TREE } from '../../src/core/registry/class-nullweaver.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import type { Body } from '../../src/core/combat/effect-ops.ts';
import { isUp, rowHp } from '../../src/core/combat/row-hp.ts';
import { usable as canUse } from '../../src/core/combat/resolve.ts';
import { warded } from '../../src/core/combat/standing.ts';
import { dist, reachable } from '../../src/core/combat/space.ts';
import { spotOf, stepToward } from '../../src/core/combat/fight-view.ts';
import { taunter } from '../../src/core/combat/threat.ts';
import { zonesErased } from '../../src/core/combat/zones.ts';
import type { Policy } from '../models/fight-sim.ts';
import type { MythicSoloSpec } from './mythic-hunters.ts';

const itemId = (s: string): ItemId => parseSaveId<'i'>(s)!;
const titleId = (s: string): TitleId => parseSaveId<'t'>(s)!;
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

export const NULLWEAVER_UNRAVEL_ID = wornAbilityId(abilityId('null-unravel'));
export const NULLWEAVER_SEVER_ID = wornAbilityId(abilityId('null-sever-magic'));
export const NULLWEAVER_ERASE_ID = wornAbilityId(abilityId('null-erase-field'));
export const NULLWEAVER_AEGIS_ID = wornAbilityId(abilityId('null-aegis'));

const ERASE_PROBE = { act: 'erase' as const, name: null, by: 1 };

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
 * Canonical 32 buyable nodes for Nullweaver (Fraying Weave, Total Purge, Sanctuary Negate, Cascade Collapse,
 * Null Horizon, Void Bulwark, Weaver of the Null).
 */
export const NULLWEAVER_CANONICAL_FORKS = [
  'null-a5-l', 'null-b5-l', 'null-c5-l',
  'null-a7-l', 'null-b7-l', 'null-c7-l',
] as const;

export const NULLWEAVER_CANONICAL_NODES: readonly ClassNodeId[] = NULLWEAVER_TREE.nodes
  .filter(n => !n.forkGroup || (NULLWEAVER_CANONICAL_FORKS as readonly string[]).includes(n.id))
  .map(n => nid(n.id));

/**
 * Nullweaver solo combat policy. Prioritizes Erase Field whenever a foe-owned zone is on the ground (even while a
 * boss is submerged/untargetable, such as Zaratan's The Dive), weaves Sever Magic for stagger and damage reduction,
 * and stacks Unraveled via Unravel to trigger 4-stack threshold bursts. Intended to be wrapped in `answering(...)`.
 */
export const nullweaverPolicy: Policy = (f, me, _plan, R) => {
  const find = (id: string) => me.abilities.find(a => a.id === id);
  const fits = (a: ReturnType<typeof find>, aim: Body['id'] | Body['place']): boolean =>
    !!a && canUse(a, me, f.rows, aim, f.grid, f.now, R, f.fog);

  const erase = find(NULLWEAVER_ERASE_ID);
  const hasFoeZone = zonesErased(f.zones, me.side, ERASE_PROBE, me.place, f.rows, f.grid, f.now, R).erased.length > 0;

  const foes = f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side));
  if (!foes.length) {
    // Even while a boss is untargetable (e.g. Zaratan's The Dive), Erase Field can clear flooded boss zones and trigger Null Echo.
    if (hasFoeZone && fits(erase, me.place)) {
      return { type: 'act', ability: erase!, aim: me.place };
    }
    return { type: 'pass' };
  }
  const t = taunter(me);
  const forced = t ? foes.find(b => b.id === t.by) : undefined;
  const target: Body = forced ?? [...foes].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place) || rowHp(a) - rowHp(b))[0]!;

  // 0. If a melee-only foe is rooted (by Silenced Thread) within 2 tiles, step back out of its reach while staying in range 8
  const rooted = target.statuses.some(s => s.def.ops.some(o => o.op === 'root'));
  const meleeOnly = target.abilities.length > 0 && target.abilities.every(a => a.range <= 2);
  if (rooted && meleeOnly && dist(me.place, target.place) <= 2) {
    const others = f.rows.filter(r => r.id !== me.id && (isUp(r) || r.kind === 'hunter')).map(r => r.place);
    const step = reachable(me.place, me.sheet.stride, f.grid, others)
      .filter(r => r.steps > 0 && dist(r.place, target.place) >= 3 && dist(r.place, target.place) <= 8)
      .sort((a, b) => a.steps - b.steps || dist(b.place, target.place) - dist(a.place, target.place))[0];
    if (step) return { type: 'move', to: step.place };
  }

  // 1. Erase Field on cooldown at the target (erases up to 2 foe fields, applies 2 Unraveled stacks + stagger + Null Echo)
  if (fits(erase, target.place)) {
    return { type: 'act', ability: erase!, aim: target.place };
  }

  // 2. Sever Magic for quick-action stagger, Silenced Thread (-15% dealt + root), and helpful-buff dispel
  const sever = find(NULLWEAVER_SEVER_ID);
  if (fits(sever, target.id)) {
    return { type: 'act', ability: sever!, aim: target.id };
  }

  // 3. Unravel bread-and-butter curse (2 stacks of Unraveled with Fraying Weave toward 4-stack burst)
  const unravel = find(NULLWEAVER_UNRAVEL_ID);
  if (fits(unravel, target.id)) {
    return { type: 'act', ability: unravel!, aim: target.id };
  }

  // 4. Fallback: clear a foe zone from self if boss is out of range, basic attack, or step closer
  if (hasFoeZone && fits(erase, me.place)) {
    return { type: 'act', ability: erase!, aim: me.place };
  }
  const attack = find(ATTACK_ID);
  if (fits(attack, target.id)) return { type: 'act', ability: attack!, aim: target.id };
  const to = stepToward(f.rows.map(spotOf), me.id, target.id, me.sheet.stride, f.grid);
  return to ? { type: 'move', to: to.place } : { type: 'pass' };
};

export const NULLWEAVER_SOLO_SPEC: MythicSoloSpec = {
  className: 'Nullweaver',
  main: 'ins',
  second: 'pow',
  kit: 'light',
  nodes: NULLWEAVER_CANONICAL_NODES,
  title: {
    id: titleId('t7'),
    name: 'Threadcutter',
    desc: 'Cuts spells and fields out of the air.',
    bonus: { ins: 5 },
  },
  gear: R => [
    makeWeapon('i61', 'Nullweave Staff', '1d6', { ins: 14, pow: 4 }),
    makeArmor('i62', 'Unmaking Mantle', 'chest', 'light', { ins: 12, pow: 6 }, R),
    makeArmor('i63', 'Threadbare Greaves', 'legs', 'light', { ins: 10, pow: 8 }, R),
    makeArmor('i64', 'Void-Sight Hood', 'head', 'light', { ins: 12, pow: 6 }, R),
    makeArmor('i65', 'Silent Treads', 'feet', 'light', { ins: 10, pow: 8 }, R),
    makeArmor('i66', 'Severed Spindle', 'offhand', 'light', { ins: 12, pow: 6 }, R),
  ],
  policy: nullweaverPolicy,
  armedReactionId: NULLWEAVER_AEGIS_ID,
};

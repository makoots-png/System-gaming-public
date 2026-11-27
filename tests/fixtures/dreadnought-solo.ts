// dreadnought-solo.ts: Dreadnought (Mythic, vit+dis) solo-sim hunter spec and combat policy.
// Built as a real S-rank level 70 Hunter through `buildMythicSoloRow` (from mythic-hunters.ts) with 2:1 vit+dis stats,
// 32 canonical legal Mythic tree nodes, S-band title within titleBudget.S, and 6 Mythic middle-grade heavy pieces.
import type { Rules } from '../../src/core/rules.ts';
import type { Item } from '../../src/core/save.ts';
import { parseClassNodeId, parseSaveId } from '../../src/core/ids.ts';
import type { ClassNodeId, ItemId, TitleId } from '../../src/core/ids.ts';
import type { Kit } from '../../src/core/hunter/derive.ts';
import { piece } from '../../src/core/registry/items.ts';
import type { ArmorSlot, ItemBonus } from '../../src/core/registry/items.ts';
import { ATTACK_ID, wornAbilityId } from '../../src/core/registry/abilities.ts';
import { bandOf, mythicScriptOf } from '../../src/core/registry/mythics.ts';
import { DREADNOUGHT_TREE } from '../../src/core/registry/class-dreadnought.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { statusKey } from '../../src/core/combat/effect-ops.ts';
import type { Body } from '../../src/core/combat/effect-ops.ts';
import { isUp, rowHp } from '../../src/core/combat/row-hp.ts';
import { usable as canUse } from '../../src/core/combat/resolve.ts';
import { holds, warded } from '../../src/core/combat/standing.ts';
import { dist, reachable } from '../../src/core/combat/space.ts';
import { spotOf, stepToward } from '../../src/core/combat/fight-view.ts';
import { taunter } from '../../src/core/combat/threat.ts';
import { zoneTiles } from '../../src/core/combat/zones.ts';
import type { Policy } from '../models/fight-sim.ts';
import type { MythicSoloSpec } from './mythic-hunters.ts';

const itemId = (s: string): ItemId => parseSaveId<'i'>(s)!;
const titleId = (s: string): TitleId => parseSaveId<'t'>(s)!;
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

export const DREADNOUGHT_BROADSIDE_ID = wornAbilityId(abilityId('dread-broadside'));
export const DREADNOUGHT_BULKHEAD_ID = wornAbilityId(abilityId('dread-bulkhead'));
export const DREADNOUGHT_SHOCKWAVE_ID = wornAbilityId(abilityId('dread-shockwave'));
export const DREADNOUGHT_ALL_OUT_ID = wornAbilityId(abilityId('dread-all-out'));

export const KEY_DREAD_WRATH = statusKey('dread-wrath');
export const KEY_DREAD_SEALED = statusKey('dread-sealed');
const KEY_ALL_OUT_SET = new Set([
  statusKey('dread-all-out'),
  statusKey('dread-all-out-overdrive'),
  statusKey('dread-all-out-siege'),
]);

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
 * Canonical 32 buyable nodes for Dreadnought (Bastion Bulkhead, Breaching Broadside, Lockdown Wave,
 * Titan Plate, Breaker Core, Overdrive Core, Colossus Hull).
 */
export const DREADNOUGHT_CANONICAL_FORKS = [
  'dread-a5-l', 'dread-b5-r', 'dread-c5-r',
  'dread-a7-l', 'dread-b7-r', 'dread-c7-l',
] as const;

export const DREADNOUGHT_CANONICAL_NODES: readonly ClassNodeId[] = DREADNOUGHT_TREE.nodes
  .filter(n => !n.forkGroup || (DREADNOUGHT_CANONICAL_FORKS as readonly string[]).includes(n.id))
  .map(n => nid(n.id));

/**
 * Dreadnought solo combat policy. Avoids hostile ground zones when closing or while a foe is invulnerable / phase-gated,
 * interrupts interruptible omens with Lockdown Wave, opens All-Out at 8+ Wrath in melee reach, and weaves Bulkhead,
 * Shockwave, and Broadside. Intended to be wrapped in `answering(...)` for mythic omens.
 */
export const dreadnoughtPolicy: Policy = (f, me, _plan, R) => {
  const find = (id: string) => me.abilities.find(a => a.id === id);
  const fits = (a: ReturnType<typeof find>, aim: Body['id'] | Body['place']): boolean =>
    !!a && canUse(a, me, f.rows, aim, f.grid, f.now, R, f.fog);

  const hpRatio = me.sheet.hpMax > 0 ? rowHp(me) / me.sheet.hpMax : 1;
  const shieldAmount = me.shield && me.shield.until > f.now ? me.shield.amount : 0;
  const shieldRatio = me.sheet.hpMax > 0 ? shieldAmount / me.sheet.hpMax : 0;
  const wrath = me.statuses.find(s => s.key === KEY_DREAD_WRATH)?.stacks ?? 0;
  const inAllOut = me.statuses.some(s => KEY_ALL_OUT_SET.has(s.key));

  // Track tiles covered by hostile zones (e.g. slowing floods or plague wakes).
  const hazardKeys = new Set<string>();
  for (const z of f.zones) {
    if (z.spares === me.side) continue;
    for (const p of zoneTiles(z, f.rows, f.grid, f.now, R)) hazardKeys.add(`${p.x},${p.y}`);
  }
  const standingInHazard = hazardKeys.has(`${me.place.x},${me.place.y}`);

  const bulkhead = find(DREADNOUGHT_BULKHEAD_ID);
  const foes = f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side));
  const t = taunter(me);
  const forced = t ? foes.find(b => b.id === t.by) : undefined;
  const target: Body | undefined = forced ?? [...foes].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place) || rowHp(a) - rowHp(b))[0];

  const atGate = !!target?.mythic && (() => {
    const gate = bandOf(mythicScriptOf(target.mythic.script), target.mythic.phase).gate;
    return gate > 0 && rowHp(target) <= Math.ceil(gate * target.sheet.hpMax);
  })();
  const untouchable = !target || holds(target, 'invulnerable') || target.statuses.some(s => s.key === statusKey('mythic-under-the-waves')) || atGate;
  const others = f.rows.filter(r => r.id !== me.id && (isUp(r) || r.kind === 'hunter')).map(r => r.place);

  // 0. While a foe cannot be damaged (invulnerable or phase-gated), step onto clean ground away from its melee ring and raise Bulkhead.
  if (untouchable) {
    if (me.sheet.stride > 0 && target && (standingInHazard || dist(me.place, target.place) <= 3)) {
      const reach = reachable(me.place, me.sheet.stride, f.grid, others).filter(r => r.steps > 0);
      const clean = reach
        .filter(r => !hazardKeys.has(`${r.place.x},${r.place.y}`))
        .sort((a, b) => dist(b.place, target.place) - dist(a.place, target.place) || a.steps - b.steps)[0];
      if (clean && (standingInHazard || dist(clean.place, target.place) > dist(me.place, target.place))) {
        return { type: 'move', to: clean.place };
      }
    }
    if (shieldRatio < 0.12 && fits(bulkhead, me.id)) {
      return { type: 'act', ability: bulkhead!, aim: me.id };
    }
    return { type: 'pass' };
  }

  // 1. If standing on a hostile zone during combat, sidestep to a clean melee tile if one is reachable.
  if (standingInHazard && me.sheet.stride > 0) {
    const reach = reachable(me.place, me.sheet.stride, f.grid, others).filter(r => r.steps > 0);
    const dryMelee = reach
      .filter(r => !hazardKeys.has(`${r.place.x},${r.place.y}`) && dist(r.place, target.place) <= 1)
      .sort((a, b) => a.steps - b.steps)[0];
    if (dryMelee) return { type: 'move', to: dryMelee.place };
  }

  const d = dist(me.place, target.place);
  const bossOmenActive = !!target.mythic && target.mythic.at !== 'calm';
  const omenInterruptible = bossOmenActive
    && !!target.mythic
    && (mythicScriptOf(target.mythic.script).omens[target.mythic.omen]?.interrupt.by.length ?? 0) > 0;
  const hasSafeguard = holds(me, 'safeguard');

  // 2. Interrupt an interruptible omen with Lockdown Wave if Shockwave carries hold and reaches.
  const shockwave = find(DREADNOUGHT_SHOCKWAVE_ID);
  const shockHolds = !!shockwave?.ops.some(op => op.op === 'applyStatus' && op.def.ops.some(x => x.op === 'hold'));
  if (shockHolds && omenInterruptible && d <= 2 && fits(shockwave, target.place)) {
    return { type: 'act', ability: shockwave!, aim: target.place };
  }

  // 3. Open All-Out when close to the boss with 8+ Wrath banked (or 5+ in a low-HP emergency).
  const allOut = find(DREADNOUGHT_ALL_OUT_ID);
  if (!inAllOut && d <= 2 && (wrath >= 8 || (wrath >= 5 && hpRatio < 0.25)) && fits(allOut, me.id)) {
    return { type: 'act', ability: allOut!, aim: me.id };
  }

  // 4. Raise Bulkhead when closing in under mid-range fire (blocks opening roots), or when hurt / facing an active omen.
  if (shieldRatio < 0.10 && ((d >= 2 && d <= 8 && !hasSafeguard) || hpRatio < 0.72 || bossOmenActive) && fits(bulkhead, me.id)) {
    return { type: 'act', ability: bulkhead!, aim: me.id };
  }

  // 5. Broadside bread-and-butter melee strike (scales with armor, resist, and Wrath; spends 1 Wrath on hit).
  const broadside = find(DREADNOUGHT_BROADSIDE_ID);
  if (fits(broadside, target.id)) {
    return { type: 'act', ability: broadside!, aim: target.id };
  }

  // 6. Shockwave at range 2 while closing in.
  if (d === 2 && fits(shockwave, target.place)) {
    return { type: 'act', ability: shockwave!, aim: target.place };
  }

  // 7. Fallback: basic attack if adjacent, or advance toward the boss preferring clean tiles.
  const attack = find(ATTACK_ID);
  if (fits(attack, target.id)) return { type: 'act', ability: attack!, aim: target.id };
  if (me.sheet.stride > 0) {
    const reach = reachable(me.place, me.sheet.stride, f.grid, others).filter(r => r.steps > 0);
    const cleanStep = reach
      .filter(r => !hazardKeys.has(`${r.place.x},${r.place.y}`) && dist(r.place, target.place) < d)
      .sort((a, b) => dist(a.place, target.place) - dist(b.place, target.place) || a.steps - b.steps)[0];
    if (cleanStep) return { type: 'move', to: cleanStep.place };
  }
  const to = stepToward(f.rows.map(spotOf), me.id, target.id, me.sheet.stride, f.grid);
  return to ? { type: 'move', to: to.place } : { type: 'pass' };
};

export const DREADNOUGHT_SOLO_SPEC: MythicSoloSpec = {
  className: 'Dreadnought',
  main: 'vit',
  second: 'dis',
  kit: 'heavy',
  nodes: DREADNOUGHT_CANONICAL_NODES,
  title: {
    id: titleId('t7'),
    name: 'Iron Colossus',
    desc: 'Unbreakable siege hull that turns every blow into Wrath.',
    bonus: { vit: 5 },
  },
  gear: R => [
    makeWeapon('i61', 'Siege Ram', '1d8', { vit: 14, dis: 4 }),
    makeArmor('i62', 'Dreadnought Cuirass', 'chest', 'heavy', { vit: 12, dis: 6 }, R),
    makeArmor('i63', 'Bulkhead Greaves', 'legs', 'heavy', { vit: 10, dis: 8 }, R),
    makeArmor('i64', 'Siege Helm', 'head', 'heavy', { vit: 12, dis: 6 }, R),
    makeArmor('i65', 'Anchor Sabatons', 'feet', 'heavy', { vit: 10, dis: 8 }, R),
    makeArmor('i66', 'Hull Buckler', 'offhand', 'heavy', { vit: 12, dis: 6 }, R),
  ],
  policy: dreadnoughtPolicy,
};

// starforger-solo.ts: Starforger (Mythic, pow+ctl) solo-sim hunter spec and combat policy.
// Built as a real S-rank level 70 Hunter through `buildMythicSoloRow` (from mythic-hunters.ts) with 2:1 pow+ctl stats,
// 32 canonical legal Mythic tree nodes, S-band title within titleBudget.S, and 6 Mythic middle-grade light pieces.
import type { Rules } from '../../src/core/rules.ts';
import type { Item } from '../../src/core/save.ts';
import { parseClassNodeId, parseSaveId } from '../../src/core/ids.ts';
import type { ClassNodeId, ItemId, TitleId } from '../../src/core/ids.ts';
import type { Kit } from '../../src/core/hunter/derive.ts';
import { piece } from '../../src/core/registry/items.ts';
import type { ArmorSlot, ItemBonus } from '../../src/core/registry/items.ts';
import { ATTACK_ID, wornAbilityId } from '../../src/core/registry/abilities.ts';
import { STARFORGER_TREE } from '../../src/core/registry/class-starforger.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { statusKey } from '../../src/core/combat/effect-ops.ts';
import type { Body } from '../../src/core/combat/effect-ops.ts';
import { isUp, rowHp } from '../../src/core/combat/row-hp.ts';
import { usable as canUse } from '../../src/core/combat/resolve.ts';
import { warded } from '../../src/core/combat/standing.ts';
import { dist } from '../../src/core/combat/space.ts';
import { spotOf, stepToward } from '../../src/core/combat/fight-view.ts';
import { taunter } from '../../src/core/combat/threat.ts';
import { pricedZones } from '../../src/core/combat/zones.ts';
import type { Policy } from '../models/fight-sim.ts';
import type { MythicSoloSpec } from './mythic-hunters.ts';

const itemId = (s: string): ItemId => parseSaveId<'i'>(s)!;
const titleId = (s: string): TitleId => parseSaveId<'t'>(s)!;
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

export const STARFORGER_STARFORGE_ID = wornAbilityId(abilityId('star-starforge'));
export const STARFORGER_SNARE_ID = wornAbilityId(abilityId('star-gravity-snare'));
export const STARFORGER_AEGIS_ID = wornAbilityId(abilityId('star-astral-aegis'));
export const STARFORGER_SUPERNOVA_ID = wornAbilityId(abilityId('star-supernova'));
const CATACLYSM_ID = wornAbilityId(abilityId('keystone-cataclysm'));

const KEY_STARLIT = statusKey('star-starlit');
const KEY_STARWARD = statusKey('star-starward');
const STAR_PRICE = { name: 'Star', take: 'all' } as const;

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
 * Canonical 32 buyable nodes for Starforger (Pulsar Core, Orbital Pull, Radiant Bastion, Solar Cascade, Event Horizon,
 * Dawn Renewal, Celestial Architect).
 */
export const STARFORGER_CANONICAL_FORKS = [
  'star-a5-r', 'star-b5-l', 'star-c5-l',
  'star-a7-r', 'star-b7-l', 'star-c7-l',
] as const;

export const STARFORGER_CANONICAL_NODES: readonly ClassNodeId[] = STARFORGER_TREE.nodes
  .filter(n => !n.forkGroup || (STARFORGER_CANONICAL_FORKS as readonly string[]).includes(n.id))
  .map(n => nid(n.id));

/**
 * Starforger solo combat policy. Checks active `Star` zones via `pricedZones` before casting Supernova because
 * `resolve.ts`'s `usable` does not check zone prices (refusal is in `fight.ts:actWith` and `play.ts` throws on refusal).
 * Intended to be wrapped in `answering(...)` for mythic omens.
 */
export const starforgerPolicy: Policy = (f, me, _plan, R) => {
  const find = (id: string) => me.abilities.find(a => a.id === id);
  const fits = (a: ReturnType<typeof find>, aim: Body['id'] | Body['place']): boolean =>
    !!a && canUse(a, me, f.rows, aim, f.grid, f.now, R, f.fog);

  const hpRatio = me.sheet.hpMax > 0 ? rowHp(me) / me.sheet.hpMax : 1;
  const shieldAmount = me.shield && me.shield.until > f.now ? me.shield.amount : 0;
  const shieldRatio = me.sheet.hpMax > 0 ? shieldAmount / me.sheet.hpMax : 0;
  const foes = f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side));
  if (!foes.length) {
    // Still cast Astral Aegis when a boss is submerged / untargetable (e.g. Zaratan's The Dive)
    const aegis = find(STARFORGER_AEGIS_ID);
    if ((shieldRatio < 0.15 || hpRatio < 0.85) && fits(aegis, me.id)) {
      return { type: 'act', ability: aegis!, aim: me.id };
    }
    return { type: 'pass' };
  }
  const t = taunter(me);
  const forced = t ? foes.find(b => b.id === t.by) : undefined;
  const target: Body = forced ?? [...foes].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place))[0]!;

  const targetHpRatio = target.sheet.hpMax > 0 ? rowHp(target) / target.sheet.hpMax : 1;
  const bossOmenActive = !!target.mythic && target.mythic.at !== 'calm';
  const targetStarlit = target.statuses.some(s => s.key === KEY_STARLIT);
  const heldStars = pricedZones(f.zones, me.id, STAR_PRICE, target.place, f.rows, f.grid, f.now, R);

  const hasStarward = me.statuses.some(s => s.key === KEY_STARWARD);

  // 1. Astral Aegis when injured or when Starward (safeguard + 15% dealt + shield) is down and shield is low
  const aegis = find(STARFORGER_AEGIS_ID);
  if ((hpRatio < 0.70 || !hasStarward) && shieldRatio < 0.16 && fits(aegis, me.id)) {
    return { type: 'act', ability: aegis!, aim: me.id };
  }

  // 2. Supernova when holding 2+ active Star zones (or 1+ Star on a low-HP finisher)
  const supernova = find(STARFORGER_SUPERNOVA_ID);
  if (
    heldStars.length > 0
    && (heldStars.length >= 2 || targetHpRatio <= 0.25)
    && fits(supernova, target.place)
  ) {
    return { type: 'act', ability: supernova!, aim: target.place };
  }

  // 3. Cast Starforge to lay Star zones toward the next Supernova
  const starforge = find(STARFORGER_STARFORGE_ID);
  if (heldStars.length < R.fight.kit.zonesPerOwner && fits(starforge, target.place)) {
    return { type: 'act', ability: starforge!, aim: target.place };
  }

  // 4. Spend Apex Cataclysm when no Stars are at risk of eviction
  const cataclysm = find(CATACLYSM_ID);
  if (heldStars.length === 0 && fits(cataclysm, target.place)) {
    return { type: 'act', ability: cataclysm!, aim: target.place };
  }

  // 5. Apply Gravity Snare when target lacks Starlit or while Starforge/Supernova cool down
  const snare = find(STARFORGER_SNARE_ID);
  if ((!targetStarlit || !bossOmenActive) && fits(snare, target.id)) {
    return { type: 'act', ability: snare!, aim: target.id };
  }

  // 6. Fallback: Astral Aegis for Starward buff if unshielded, Starforge, basic attack, or step toward target
  if (shieldRatio < 0.1 && fits(aegis, me.id)) return { type: 'act', ability: aegis!, aim: me.id };
  if (fits(starforge, target.place)) return { type: 'act', ability: starforge!, aim: target.place };
  const attack = find(ATTACK_ID);
  if (fits(attack, target.id)) return { type: 'act', ability: attack!, aim: target.id };
  const to = stepToward(f.rows.map(spotOf), me.id, target.id, me.sheet.stride, f.grid);
  return to ? { type: 'move', to: to.place } : { type: 'pass' };
};

export const STARFORGER_SOLO_SPEC: MythicSoloSpec = {
  className: 'Starforger',
  main: 'pow',
  second: 'ctl',
  kit: 'light',
  nodes: STARFORGER_CANONICAL_NODES,
  title: {
    id: titleId('t6'),
    name: 'Astral Forgemaster',
    desc: 'Forges stars in the dark between gates.',
    bonus: { pow: 5 },
  },
  gear: R => [
    makeWeapon('i51', 'Starloom Staff', '1d6', { pow: 14, ctl: 4 }),
    makeArmor('i52', 'Nebula Robes', 'chest', 'light', { pow: 12, ctl: 6 }, R),
    makeArmor('i53', 'Orbit Greaves', 'legs', 'light', { pow: 10, ctl: 8 }, R),
    makeArmor('i54', 'Corona Diadem', 'head', 'light', { pow: 12, ctl: 6 }, R),
    makeArmor('i55', 'Eclipse Treads', 'feet', 'light', { pow: 10, ctl: 8 }, R),
    makeArmor('i56', 'Astrolabe Focus', 'offhand', 'light', { pow: 12, ctl: 6 }, R),
  ],
  policy: starforgerPolicy,
};

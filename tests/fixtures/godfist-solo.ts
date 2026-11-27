// godfist-solo.ts: Godfist (Mythic, str+dis) solo-sim hunter spec and combat policy.
// Built as a real S-rank level 70 Hunter through `buildMythicSoloRow` (from mythic-hunters.ts) with 2:1 str+dis stats,
// 32 canonical legal Mythic tree nodes, S-band title within titleBudget.S, 6 Mythic middle-grade medium pieces, and
// Qi Guard armed at fight start.
import type { Rules } from '../../src/core/rules.ts';
import type { Item } from '../../src/core/save.ts';
import { parseClassNodeId, parseSaveId } from '../../src/core/ids.ts';
import type { ClassNodeId, ItemId, TitleId } from '../../src/core/ids.ts';
import type { Kit } from '../../src/core/hunter/derive.ts';
import { piece } from '../../src/core/registry/items.ts';
import type { ArmorSlot, ItemBonus } from '../../src/core/registry/items.ts';
import { ATTACK_ID, wornAbilityId } from '../../src/core/registry/abilities.ts';
import { GODFIST_TREE } from '../../src/core/registry/class-godfist.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { statusKey } from '../../src/core/combat/effect-ops.ts';
import type { Body } from '../../src/core/combat/effect-ops.ts';
import type { Running } from '../../src/core/combat/fight-types.ts';
import { isUp, rowHp } from '../../src/core/combat/row-hp.ts';
import { usable as canUse } from '../../src/core/combat/resolve.ts';
import { harmful, holds, warded } from '../../src/core/combat/standing.ts';
import { dist, reachable } from '../../src/core/combat/space.ts';
import type { Place } from '../../src/core/combat/space.ts';
import { spotOf, stepToward } from '../../src/core/combat/fight-view.ts';
import { taunter } from '../../src/core/combat/threat.ts';
import { zoneTiles } from '../../src/core/combat/zones.ts';
import type { Policy } from '../models/fight-sim.ts';
import type { MythicSoloSpec } from './mythic-hunters.ts';

const itemId = (s: string): ItemId => parseSaveId<'i'>(s)!;
const titleId = (s: string): TitleId => parseSaveId<'t'>(s)!;
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

export const GODFIST_KNUCKLE_ID = wornAbilityId(abilityId('god-knuckle-rush'));
export const GODFIST_SUPLEX_ID = wornAbilityId(abilityId('god-heavenly-suplex'));
export const GODFIST_QI_GUARD_ID = wornAbilityId(abilityId('god-qi-guard'));
export const GODFIST_WORLDSPLITTER_ID = wornAbilityId(abilityId('god-worldsplitter'));
const SHATTER_ID = wornAbilityId(abilityId('keystone-shatter'));

export const GODFIST_GRIT_KEY = statusKey('god-grit');

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
 * Canonical 32 buyable nodes for Godfist (Counter Palm, Shatter Blow, Mountain Drop, Mountain Stance,
 * Flurry Rush, Worldbreaker Edge, Shattering Fist).
 */
export const GODFIST_CANONICAL_FORKS = [
  'god-a5-r', 'god-b5-l', 'god-c5-l',
  'god-a7-l', 'god-b7-l', 'god-c7-l',
] as const;

export const GODFIST_CANONICAL_NODES: readonly ClassNodeId[] = GODFIST_TREE.nodes
  .filter(n => !n.forkGroup || (GODFIST_CANONICAL_FORKS as readonly string[]).includes(n.id))
  .map(n => nid(n.id));

/** Whether tile `p` sits inside a harmful foe-owned or map hazard zone that affects `me`. */
export function isHazardTile(f: Running, me: Body, p: Place, R: Rules): boolean {
  for (const z of f.zones) {
    if (z.spares === me.side || z.owner === me.id) continue;
    if (!harmful({ ops: z.ops })) continue;
    if (zoneTiles(z, f.rows, f.grid, f.now, R).some(t => t.x === p.x && t.y === p.y)) return true;
  }
  return false;
}

/**
 * Godfist solo combat policy. Relies on armed Qi Guard for incoming strikes/omens, avoids swapping directly onto
 * harmful boss hazard tiles with Heavenly Suplex, saves cooldowns/fatigue during invulnerable clock phases (such as
 * Zaratan's The Dive), spends Grit through Worldsplitter for burst + shield, and keeps pressure up with Shatter and
 * Knuckle Rush. Intended to be wrapped in `answering(...)`.
 */
export const godfistPolicy: Policy = (f, me, _plan, R) => {
  const foes = f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side));
  if (!foes.length) return { type: 'pass' };
  const t = taunter(me);
  const forced = t ? foes.find(b => b.id === t.by) : undefined;
  const target: Body = forced ?? [...foes].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place) || rowHp(a) - rowHp(b))[0]!;

  // While a foe is invulnerable or submerged (visible row status, no boss script read), step off hazard tiles and wait.
  if (holds(target, 'invulnerable') || target.statuses.some(s => s.key === statusKey('mythic-under-the-waves'))) {
    if (me.sheet.stride > 0) {
      const others = f.rows.filter(r => r.id !== me.id && (isUp(r) || r.kind === 'hunter')).map(r => r.place);
      if (isHazardTile(f, me, me.place, R) || dist(me.place, target.place) <= 2) {
        const safe = reachable(me.place, me.sheet.stride, f.grid, others)
          .filter(r => r.steps > 0 && !isHazardTile(f, me, r.place, R) && dist(r.place, target.place) >= 3)
          .sort((a, b) => a.steps - b.steps || dist(a.place, target.place) - dist(b.place, target.place))[0]
          ?? reachable(me.place, me.sheet.stride, f.grid, others)
            .filter(r => r.steps > 0 && !isHazardTile(f, me, r.place, R))
            .sort((a, b) => dist(b.place, target.place) - dist(a.place, target.place) || a.steps - b.steps)[0];
        if (safe) return { type: 'move', to: safe.place };
      }
    }
    return { type: 'pass' };
  }

  const find = (id: string) => me.abilities.find(a => a.id === id);
  const fits = (a: ReturnType<typeof find>, aim: Body['id'] | Body['place']): boolean =>
    !!a && canUse(a, me, f.rows, aim, f.grid, f.now, R, f.fog);

  const grit = me.statuses.find(s => s.key === GODFIST_GRIT_KEY)?.stacks ?? 0;

  // 1. Spend Grit via Worldsplitter for burst + Grit-to-shield conversion when holding Grit.
  const worldsplitter = find(GODFIST_WORLDSPLITTER_ID);
  if (grit > 0 && fits(worldsplitter, target.id)) {
    return { type: 'act', ability: worldsplitter!, aim: target.id };
  }

  // 2. Heavenly Suplex when adjacent and target's tile is not a harmful boss hazard.
  const suplex = find(GODFIST_SUPLEX_ID);
  const suplexSafe = me.sheet.stride > 0 && !isHazardTile(f, me, target.place, R);
  if (suplexSafe && fits(suplex, target.id)) {
    return { type: 'act', ability: suplex!, aim: target.id };
  }

  // 4. Knuckle Rush quick strike (handles both single-target and Thunder Clap radius-2 cleave) — faster and stronger than Shatter.
  const knuckle = find(GODFIST_KNUCKLE_ID);
  if (knuckle) {
    const kAim = knuckle.aim === 'place' ? me.place : target.id;
    if (fits(knuckle, kAim)) return { type: 'act', ability: knuckle, aim: kAim };
  }

  // 5. Worldbreaker Apex Shatter when adjacent and ready.
  const shatter = find(SHATTER_ID);
  if (fits(shatter, target.id)) {
    return { type: 'act', ability: shatter!, aim: target.id };
  }

  // 6. Basic attack fallback or close distance.
  const attack = find(ATTACK_ID);
  if (fits(attack, target.id)) return { type: 'act', ability: attack!, aim: target.id };
  const to = stepToward(f.rows.map(spotOf), me.id, target.id, me.sheet.stride, f.grid);
  return to ? { type: 'move', to: to.place } : { type: 'pass' };
};

export const GODFIST_SOLO_SPEC: MythicSoloSpec = {
  className: 'Godfist',
  main: 'str',
  second: 'dis',
  kit: 'medium',
  nodes: GODFIST_CANONICAL_NODES,
  title: {
    id: titleId('t8'),
    name: 'Heavenly Fist',
    desc: 'Unarmed master of grit and throws.',
    bonus: { str: 5 },
  },
  gear: R => [
    makeWeapon('i71', 'Ironwood Handwraps', '1d8', { str: 14, dis: 4 }),
    makeArmor('i72', 'Mountain Gi', 'chest', 'medium', { str: 12, dis: 6 }, R),
    makeArmor('i73', 'Stance Legwraps', 'legs', 'medium', { str: 10, dis: 8 }, R),
    makeArmor('i74', 'Calm Headband', 'head', 'medium', { str: 12, dis: 6 }, R),
    makeArmor('i75', 'Earthstep Sandals', 'feet', 'medium', { str: 10, dis: 8 }, R),
    makeArmor('i76', 'Heavy Bracers', 'offhand', 'medium', { str: 12, dis: 6 }, R),
  ],
  policy: godfistPolicy,
  armedReactionId: GODFIST_QI_GUARD_ID,
};

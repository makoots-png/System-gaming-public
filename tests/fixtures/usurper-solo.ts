// usurper-solo.ts: Usurper (Mythic, agi+pow) solo-sim hunter spec and combat policy.
// Built as a real S-rank level 70 Hunter through `buildMythicSoloRow` (from mythic-hunters.ts) with 2:1 agi+pow stats,
// 32 canonical legal Mythic tree nodes, S-band title within titleBudget.S, and 6 Mythic middle-grade light pieces.
import type { Rules } from '../../src/core/rules.ts';
import type { Item } from '../../src/core/save.ts';
import { parseClassNodeId, parseSaveId } from '../../src/core/ids.ts';
import type { ClassNodeId, ItemId, TitleId } from '../../src/core/ids.ts';
import type { Kit } from '../../src/core/hunter/derive.ts';
import { piece } from '../../src/core/registry/items.ts';
import type { ArmorSlot, ItemBonus } from '../../src/core/registry/items.ts';
import { ATTACK_ID, wornAbilityId } from '../../src/core/registry/abilities.ts';
import { USURPER_TREE } from '../../src/core/registry/class-usurper.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import type { Body } from '../../src/core/combat/effect-ops.ts';
import { isUp, rowHp } from '../../src/core/combat/row-hp.ts';
import { gateOf } from '../../src/core/combat/mythic.ts';
import { rangeFor, usable as canUse } from '../../src/core/combat/resolve.ts';
import { warded } from '../../src/core/combat/standing.ts';
import { dist, place } from '../../src/core/combat/space.ts';
import type { Place } from '../../src/core/combat/space.ts';
import { spotOf, stepToward } from '../../src/core/combat/fight-view.ts';
import { taunter } from '../../src/core/combat/threat.ts';
import type { Policy } from '../models/fight-sim.ts';
import type { MythicSoloSpec } from './mythic-hunters.ts';

const itemId = (s: string): ItemId => parseSaveId<'i'>(s)!;
const titleId = (s: string): TitleId => parseSaveId<'t'>(s)!;
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

export const USURPER_COUP_ID = wornAbilityId(abilityId('usurp-coup'));
export const USURPER_HIJACK_ID = wornAbilityId(abilityId('usurp-hijack'));
export const USURPER_SIPHON_ID = wornAbilityId(abilityId('usurp-siphon-mandate'));
export const USURPER_VIGOR_ID = wornAbilityId(abilityId('usurp-stolen-vigor'));

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
 * Canonical 32 buyable nodes for Usurper (Phantom Coup, Grand Hijack, Imperial Siphon, Sovereign Vigor,
 * Regicide Edge, Phantom Bulwark, Crown of Stolen Power).
 */
export const USURPER_CANONICAL_FORKS = [
  'usurp-a5-l', 'usurp-b5-l', 'usurp-c5-l',
  'usurp-a7-l', 'usurp-b7-r', 'usurp-c7-l',
] as const;

export const USURPER_CANONICAL_NODES: readonly ClassNodeId[] = USURPER_TREE.nodes
  .filter(n => !n.forkGroup || (USURPER_CANONICAL_FORKS as readonly string[]).includes(n.id))
  .map(n => nid(n.id));

/** Picks a legal blink tile within `coup`'s range whose radius-1 blast catches `target`. */
function bestCoupTile(
  coup: NonNullable<ReturnType<Body['abilities']['find']>>,
  me: Body,
  target: Body,
  f: Parameters<Policy>[0],
  R: Rules,
): Place | null {
  if (me.sheet.stride <= 0) return null;
  const maxRange = rangeFor(coup, me, R);
  let best: Place | null = null;
  let bestScore = -Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = target.place.x + dx;
      const y = target.place.y + dy;
      if (x < 0 || y < 0 || x >= f.grid.w || y >= f.grid.h) continue;
      const p = place(x, y);
      if (dist(me.place, p) > maxRange) continue;
      if (!canUse(coup, me, f.rows, p, f.grid, f.now, R, f.fog)) continue;
      // Prefer tiles outside foe-owned hazard zones, then closer to current position.
      const inFoeZone = f.zones.some(z => z.owner !== null && z.spares !== me.side
        && z.ground.kind === 'around' && z.ground.anchor.kind === 'place'
        && dist(p, z.ground.anchor.at) <= z.ground.radius);
      const score = (inFoeZone ? -20 : 0) - dist(me.place, p);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return best;
}

/**
 * Boss-agnostic Usurper solo combat policy (reads zero boss script names or phase numbers).
 * Prioritizes Hijack whenever a standing omen is active, tops off Stolen Vigor at HP gates or when hurt, weaves Coup
 * and Siphon Mandate on cooldown, and uses Hijack on calm turns once a foe is past opening HP or mana is low.
 * Intended to be wrapped in `answering(...)`.
 */
export const usurperPolicy: Policy = (f, me, _plan, R) => {
  const find = (id: string) => me.abilities.find(a => a.id === id);
  const fits = (a: ReturnType<typeof find>, aim: Body['id'] | Body['place']): boolean =>
    !!a && canUse(a, me, f.rows, aim, f.grid, f.now, R, f.fog);

  const hpRatio = me.sheet.hpMax > 0 ? rowHp(me) / me.sheet.hpMax : 1;
  const shieldAmount = me.shield && me.shield.until > f.now ? me.shield.amount : 0;
  const shieldRatio = me.sheet.hpMax > 0 ? shieldAmount / me.sheet.hpMax : 0;
  const vigor = find(USURPER_VIGOR_ID);

  const foes = f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side));
  if (!foes.length) {
    if ((hpRatio < 0.85 || shieldRatio < 0.15) && fits(vigor, me.id)) {
      return { type: 'act', ability: vigor!, aim: me.id };
    }
    return { type: 'pass' };
  }
  const t = taunter(me);
  const forced = t ? foes.find(b => b.id === t.by) : undefined;
  const target: Body = forced ?? [...foes].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place) || rowHp(a) - rowHp(b))[0]!;

  // 0. General phase-gate check: when a mythic foe sits at its phase HP gate, top off defense instead of wasting cooldowns.
  const atPhaseGate = !!target.mythic && gateOf(target) > 0 && rowHp(target) <= gateOf(target);
  if (atPhaseGate) {
    if ((hpRatio < 0.85 || shieldRatio < 0.14) && fits(vigor, me.id)) {
      return { type: 'act', ability: vigor!, aim: me.id };
    }
    return { type: 'pass' };
  }

  // 1. Hijack immediately when a standing omen is active (copies the omen move + 60% refund + heal).
  const bossOmenActive = !!target.mythic && target.mythic.at !== 'calm';
  const hijack = find(USURPER_HIJACK_ID);
  if (bossOmenActive && fits(hijack, target.id)) {
    return { type: 'act', ability: hijack!, aim: target.id };
  }

  // 2. Stolen Vigor when injured or unshielded under a standing omen.
  if ((hpRatio < 0.62 || (bossOmenActive && shieldRatio < 0.10 && hpRatio < 0.85)) && fits(vigor, me.id)) {
    return { type: 'act', ability: vigor!, aim: me.id };
  }

  // 3. Coup blink strike on cooldown onto an adjacent free tile for Usurped / Phantom Usurped.
  const coup = find(USURPER_COUP_ID);
  if (coup) {
    const dest = bestCoupTile(coup, me, target, f, R);
    if (dest) return { type: 'act', ability: coup, aim: dest };
  }

  // 4. Siphon Mandate on cooldown for quick stagger, helpful-buff dispel, and Broken Crown.
  const siphon = find(USURPER_SIPHON_ID);
  if (fits(siphon, target.id)) {
    return { type: 'act', ability: siphon!, aim: target.id };
  }

  // 5. Weave Hijack on calm turns once Coup and Siphon Mandate are cooling down when hurt, low on mana, or closing out a foe.
  const targetHpRatio = target.sheet.hpMax > 0 ? rowHp(target) / target.sheet.hpMax : 1;
  if ((hpRatio < 0.68 || me.mana < me.sheet.manaMax * 0.45 || targetHpRatio < 0.42) && fits(hijack, target.id)) {
    return { type: 'act', ability: hijack!, aim: target.id };
  }

  // 6. Fallback: Stolen Vigor if injured and unshielded, basic attack, or close distance.
  if (hpRatio < 0.70 && shieldRatio < 0.10 && fits(vigor, me.id)) {
    return { type: 'act', ability: vigor!, aim: me.id };
  }
  const attack = find(ATTACK_ID);
  if (fits(attack, target.id)) return { type: 'act', ability: attack!, aim: target.id };
  const to = stepToward(f.rows.map(spotOf), me.id, target.id, me.sheet.stride, f.grid);
  return to ? { type: 'move', to: to.place } : { type: 'pass' };
};

export const USURPER_SOLO_SPEC: MythicSoloSpec = {
  className: 'Usurper',
  main: 'agi',
  second: 'pow',
  kit: 'light',
  nodes: USURPER_CANONICAL_NODES,
  title: {
    id: titleId('t8'),
    name: 'Throne Thief',
    desc: 'Steals the power of monarchs.',
    bonus: { agi: 5 },
  },
  gear: R => [
    makeWeapon('i71', 'Usurper Blade', '1d6', { agi: 14, pow: 4 }),
    makeArmor('i72', 'Regicide Coat', 'chest', 'light', { agi: 12, pow: 6 }, R),
    makeArmor('i73', 'Phantom Greaves', 'legs', 'light', { agi: 10, pow: 8 }, R),
    makeArmor('i74', 'Borrowed Diadem', 'head', 'light', { agi: 12, pow: 6 }, R),
    makeArmor('i75', 'Coup Striders', 'feet', 'light', { agi: 10, pow: 8 }, R),
    makeArmor('i76', 'Stolen Signet', 'offhand', 'light', { agi: 12, pow: 6 }, R),
  ],
  policy: usurperPolicy,
};

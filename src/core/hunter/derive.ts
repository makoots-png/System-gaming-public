// derive.ts: one `Sheet` of derived numbers for any combatant, from its stats, level and gear (docs/agent-handoff/rw/design.md
// sections 2.2 to 2.4). A hunter, a monster and a shadow go through the same formulas; a monster is a hunter of its rank's
// first level. Pure; the rule numbers come in as `DeriveRules`. A new derived number is a field of `Sheet`, its label in
// `SHEET_LABELS` (the typecheck asks), its formula here, its reason in design.md section 2.2 and its row in
// tests/derive.test.ts. A formula may then name it with no change to src/core/formula.ts.

import type { Rank, Rules } from '../rules.ts';
import { above, baseStats, capped, eff } from '../stats.ts';
import type { StatKey, Stats } from '../stats.ts';
import { tiles } from '../combat/space.ts';
import type { Tiles } from '../combat/space.ts';
import type { Brand } from '../ids.ts';

/** A share from 0 to 1, such as the part of armor ignored. */
export type Share = Brand<number, 'Share'>;
export const share = (n: number): Share => n as Share;

/** Every number the fight reads from a combatant's body, gear and level (design 2.2). */
export type Sheet = {
  readonly hpMax: number;
  readonly manaMax: number;
  readonly fatigueMax: number;
  /** The weight the body carries before it slows. */
  readonly carry: number;
  /** The weight of the gear worn. */
  readonly weight: number;
  /** After load and statuses, clamped to the rules' speed range. */
  readonly speed: number;
  /** Tiles a round, not a whole number: a dodge uses it as a rate. */
  readonly move: number;
  /** The most tiles one move command walks. */
  readonly stride: Tiles;
  readonly armor: number;
  readonly resist: number;
  /** The part of the target's armor or resist ignored. */
  readonly pen: Share;
  /** Armor or resist ignored after `pen`, from gear only. */
  readonly penFlat: number;
  /** Physical, magical and support power: what a damage, heal or shield formula reads. */
  readonly phys: number;
  readonly mag: number;
  readonly sup: number;
  /** The target's side of the reaction roll. */
  readonly react: number;
  /** The user's side of the reaction roll. */
  readonly aim: number;
  /** Takes the place of `react` against a use with no travel. */
  readonly will: number;
  /** How many low faces of the target's reaction d20 make a crit, 1 to 6. */
  readonly critFaces: number;
  /** A crit multiplies the damage by this, 1.5 to 2. */
  readonly critSize: number;
  /** Added to the opening d20. */
  readonly opening: number;
  /** Shortens a control status on this body; potency lengthens one this body applies. */
  readonly tenacity: number;
  readonly potency: number;
  /** Multiplies the threat this body's damage makes. */
  readonly threat: number;
  /** A single hit of `hold * hpMax` breaks this body's channel. */
  readonly hold: Share;
  /** The part of an ability's fatigue and mana cost taken off. */
  readonly costCut: Share;
  /** How many shadows this body can keep. */
  readonly shadows: number;
};
/** A number of a sheet (`hpMax`, `armor`, `speed`...). Not a room's `SheetKey` (src/core/ids.ts). */
export type SheetNumber = keyof Sheet;

/** Each derived number's name on a screen, in the order the sheet shows them. */
export const SHEET_LABELS: { readonly [K in SheetNumber]: string } = {
  hpMax: 'Max HP', manaMax: 'Max mana', fatigueMax: 'Fatigue capacity', carry: 'Carry', weight: 'Gear weight',
  speed: 'Speed', move: 'Move (tiles a round)', stride: 'Stride (tiles a turn)', armor: 'Armor', resist: 'Resist',
  pen: 'Penetration (share)', penFlat: 'Penetration (flat)', phys: 'Physical power', mag: 'Magical power', sup: 'Support power', react: 'Reaction',
  aim: 'Accuracy', will: 'Will', critFaces: 'Crit faces (of d20)', critSize: 'Crit size', opening: 'Opening bonus',
  tenacity: 'Tenacity', potency: 'Potency', threat: 'Threat multiplier', hold: 'Channel hold (share of max HP)',
  costCut: 'Cost cut (share)', shadows: 'Shadow capacity',
};

/** What one worn item adds to the kit (design 2.3). Neck and rings weigh 0. `penFlat` is armor or resist the wearer's hits ignore. */
export type GearPiece = { readonly weight: number; readonly armor: number; readonly resist: number; readonly penFlat?: number };

/**
 * Bonuses from perks: a stat key adds to that stat before its curve, a `Sheet` key adds to that number where it is worked
 * out, before anything that reads it and before it is rounded or clamped.
 */
export type Bonus = Partial<Readonly<Record<StatKey | SheetNumber, number>>>;

/** A hunter's body as `sheetOf` reads it. `stats` holds the points spent; `perks` the summed bonuses of the open perks. */
export type SheetBasis = {
  readonly stats: Stats;
  readonly level: number;
  readonly gear: readonly GearPiece[];
  readonly perks: Bonus;
};

/**
 * What a status does to a sheet (the `stat` and `speed` ops of design 3.3). A stat change adds to the stat; a speed change
 * is a signed percent of the speed before the clamp. Unit 8 turns a combatant's statuses into this list.
 */
export type StatusMod = { readonly op: 'stat'; readonly key: StatKey; readonly amount: number } | { readonly op: 'speed'; readonly pct: number };

/** A monster's 2:1 stat split and kit (design 2.4). */
export type Archetype = 'brute' | 'skirmisher' | 'caster';
export type Kit = keyof Rules['fight']['kits'];
export type MonsterKind = keyof Rules['fight']['kinds'];

/** The rule numbers this module reads. */
export type DeriveRules = Pick<Rules, 'fight' | 'rankLevels' | 'pointsPerLevel'>;

/** Each archetype's main and second stat and its kit (design 2.4). */
export const ARCHETYPES: { readonly [A in Archetype]: { readonly main: StatKey; readonly second: StatKey; readonly kit: Kit } } = {
  brute: { main: 'str', second: 'vit', kit: 'medium' },
  skirmisher: { main: 'agi', second: 'str', kit: 'light' },
  caster: { main: 'pow', second: 'ctl', kit: 'light' },
};

/** A kit as gear: one piece that weighs and protects what the kit does. */
export const kitGear = (kit: Kit, R: DeriveRules): GearPiece[] => [R.fight.kits[kit]];

/** The points a body has to spend at `level`: the creation points, then the points of every level after the first. */
export const pointsAt = (level: number, R: DeriveRules): number => R.fight.creationPoints + R.pointsPerLevel * (level - 1);

/** Every stat at its base, with `points` split 2:1 between `main` and `second` (the main takes the rounded `mainShare`). */
export function split(main: StatKey, second: StatKey, points: number, R: DeriveRules): Stats {
  const stats: Record<StatKey, number> = { ...baseStats(R.fight) };
  const big = Math.round(points * R.fight.mainShare);
  stats[main] += big;
  stats[second] += points - big;
  return stats;
}

/** What a monster's kind multiplies; a hunter's body is 1 and 1. */
type Factors = { readonly hp: number; readonly power: number };
const HUNTER: Factors = { hp: 1, power: 1 };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// Design 2.2, in the order the numbers read each other: weight and carry give the load, the load and Agility the speed,
// the speed the move. Crit faces, crit size, the opening bonus and the cost cut never fall below their base. However far
// perks lower them (an item's, a title's, the GM's `hpAdj` and `manaAdj`), max HP and fatigue capacity stay at 1 or
// more and max mana at 0 or more: a body with no HP to hold could not be up (vitals.ts), one with no capacity would be
// collapsed at rest.
function derive(stats: Stats, level: number, gear: readonly GearPiece[], perks: Bonus, mods: readonly StatusMod[], f: Factors, R: DeriveRules): Sheet {
  const F = R.fight;
  const b = (k: StatKey | SheetNumber): number => perks[k] ?? 0;
  const statMod = (k: StatKey): number => mods.reduce((s, m) => m.op === 'stat' && m.key === k ? s + m.amount : s, 0);
  const speedPct = mods.reduce((s, m) => m.op === 'speed' ? s + m.pct : s, 0);
  const score = (k: StatKey): number => stats[k] + b(k) + statMod(k);
  const e = (k: StatKey): number => eff(score(k), F);
  const x = (k: StatKey): number => above(score(k), F);
  const c = (k: StatKey, cap: number): number => capped(x(k), cap, F);
  const up = (k: StatKey, cap: number): number => capped(Math.max(0, x(k)), cap, F);
  const total = (k: keyof GearPiece): number => gear.reduce((s, g) => s + (g[k] ?? 0), 0);

  const weight = total('weight') + b('weight');
  const carry = F.carryBase + c('str', F.carryCap) + b('carry');
  // Strength lifts weight but does not shrink plate: what a base body could not carry at all (weight over `carryBase`)
  // is bulk, and slows any wearer `bulkSlow` a point, never more than the full load's slow.
  const bulk = Math.min(F.loadSlow, F.bulkSlow * Math.max(0, weight - F.carryBase));
  const load = 1 - Math.max(bulk, F.loadSlow * clamp((weight / carry - F.freeLoad) / (1 - F.freeLoad), 0, 1));
  const speed = Math.round(clamp(((F.speedBase + c('agi', F.speedCap)) * load + b('speed')) * (1 + speedPct / 100), F.speedMin, F.speedMax));
  const move = F.moveBase * speed / 100 + b('move');
  return {
    hpMax: Math.max(1, Math.round(f.hp * (1 + (level - 1) / F.growthDiv) * F.hpBase * (1 + c('vit', F.hpVitCap)) + b('hpMax'))),
    manaMax: Math.max(0, Math.round(F.manaBase + c('pow', F.manaCap) + b('manaMax'))),
    fatigueMax: Math.max(1, Math.round(F.fatigueBase + c('vit', F.fatigueCap) + b('fatigueMax'))),
    carry: Math.round(carry),
    weight,
    speed,
    move,
    stride: tiles(Math.max(1, Math.ceil(move * F.strideShare + b('stride')))),
    armor: Math.round(total('armor') + c('vit', F.armorVitCap) + b('armor')),
    resist: Math.round(total('resist') + c('dis', F.resistDisCap) + b('resist')),
    pen: share(c('ctl', F.penCap) + b('pen')),
    penFlat: total('penFlat') + b('penFlat'),
    phys: f.power * F.powerK * e('str') + b('phys'),
    mag: f.power * F.powerK * e('pow') + b('mag'),
    sup: f.power * F.powerK * e('pre') + b('sup'),
    react: F.statBase + x('ins') + F.reactAgi * x('agi') + b('react'),
    aim: e('ctl') + b('aim'),
    will: e('dis') + b('will'),
    critFaces: 1 + Math.round(up('ins', F.critFacesCap) + b('critFaces')),
    critSize: F.critSizeBase + up('ctl', F.critSizeCap) + b('critSize'),
    opening: Math.min(F.openCap, Math.round(F.openK * Math.max(0, x('ins')) + b('opening'))),
    tenacity: c('dis', F.tenacityCap) + b('tenacity'),
    potency: c('ctl', F.potencyCap) + b('potency'),
    threat: 1 + c('pre', F.threatCap) + b('threat'),
    hold: share(F.holdBase + c('dis', F.holdCap) + b('hold')),
    costCut: share(up('ctl', F.costCutCap) + b('costCut')),
    shadows: Math.floor(e('pre') * F.shadowPerEff + b('shadows')),
  };
}

/** A hunter's sheet. `mods` are what its statuses do to it. */
export const sheetOf = (build: SheetBasis, R: DeriveRules, mods: readonly StatusMod[] = []): Sheet =>
  derive(build.stats, build.level, build.gear, build.perks, mods, HUNTER, R);

/**
 * What a monster's seed changes on its archetype's body (design 2.4): `hp` multiplies its max HP after its kind's factor,
 * and `stats` adds points to named stats before their curves, as a hunter's spent points do. It carries no armor.
 */
export type Tweak = { readonly hp: number; readonly stats: Partial<Readonly<Record<StatKey, number>>> };
/** The tweak of a monster its seed leaves as its archetype makes it. */
export const NO_TWEAK: Tweak = { hp: 1, stats: {} };

/** A monster's stats: its rank's points split 2:1 by its archetype, plus its seed's tweak. */
export function monsterStats(rank: Rank, archetype: Archetype, R: DeriveRules, tweak: Tweak = NO_TWEAK): Stats {
  const a = ARCHETYPES[archetype], s: Record<StatKey, number> = { ...split(a.main, a.second, pointsAt(R.rankLevels[rank], R), R) };
  for (const [k, n] of Object.entries(tweak.stats) as [StatKey, number][]) s[k] += n;
  return s;
}

/**
 * A monster's sheet: a hunter of its rank's first level with its points split 2:1 by its archetype and its seed's
 * tweak, no perks, in its archetype's kit, its max HP and powers times its kind's factors and its max HP times the
 * tweak's. A shadow's sheet is the sheet of the monster it was extracted from.
 */
export function monsterSheet(rank: Rank, archetype: Archetype, kind: MonsterKind, R: DeriveRules, mods: readonly StatusMod[] = [], tweak: Tweak = NO_TWEAK): Sheet {
  const k = R.fight.kinds[kind];
  return derive(monsterStats(rank, archetype, R, tweak), R.rankLevels[rank], kitGear(ARCHETYPES[archetype].kit, R), {}, mods, { hp: k.hp * tweak.hp, power: k.power }, R);
}

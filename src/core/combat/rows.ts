// rows.ts: the fight row of a hunter on this phone, a hunter on another phone, a monster and a shadow
// (docs/agent-handoff/rw/m2-plan.md section 4.2, unit P5). Each maker answers a `NewRow` for the fight's `add` command:
// its origin, its abilities, its HP, mana and fatigue, its XP and the statuses it starts with. Pure, and no check: a
// hunter comes from the save, a remote sheet from `parseSheetHunter`, a monster from `parseMonster`. The fight works out
// the rest (its stats, sheet, speed and place). A new kind of row is a maker here with its cases in tests/rows.test.ts.

import type { IconKey } from '../registry/icons.ts';
import { rankIdx } from '../rules.ts';
import type { Rules } from '../rules.ts';
import type { Rank } from '../rules.ts';
import type { ShadowGrade } from '../save.ts';
import type { StatKey } from '../stats.ts';
import { diceOf, mean as meanOf } from '../formula.ts';
import { ARCHETYPES, kitGear, NO_TWEAK, pointsAt, split } from '../hunter/derive.ts';
import type { Archetype, Bonus, SheetBasis, MonsterKind, Sheet } from '../hunter/derive.ts';
import { buildOf } from '../hunter/sheet.ts';
import type { SheetHunter, SheetItem, SheetRules } from '../hunter/sheet.ts';
import { lifeAfter } from '../hunter/vitals.ts';
import type { Life } from '../hunter/vitals.ts';
import { TIER_BUDGET } from '../registry/paths.ts';
import { ARCHETYPE_ATTACKS, itemAbility, weaponAttack } from '../registry/abilities.ts';
import { monsterXp } from '../registry/monsters.ts';
import type { Weapon } from '../registry/abilities.ts';
import { formulaOf } from '../registry/ability-kinds.ts';
import type { KindRules } from '../registry/ability-kinds.ts';
import { openGrid, place } from './space.ts';
import type { Place } from './space.ts';
import { tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import { combatantId, hunterId } from './ability-types.ts';
import { parseSaveId } from '../ids.ts';
import type { HunterRef, SheetKey } from '../ids.ts';
import type { Ability, CombatantId, Summon } from './ability-types.ts';
import { freeStatusKey, modified, shadowId, statusKey, statusOn, statusShield, TYPE_MAX } from './effect-ops.ts';
import { RANKS } from '../rules.ts';
import { itemSource } from '../effects.ts';
import type { Body, Op, Origin, SheetStatus, Shield, Stagger, Status, StatusDef } from './effect-ops.ts';
import { resolve } from './resolve.ts';
import { usesGates } from './uses.ts';
import { MAX_ABILITIES, MAX_STATUSES, NAME_MAX } from './fight-types.ts';
import type { NewRow } from './fight-types.ts';

/** The rule numbers a row reads: the hunter's sheet and the kinds of the abilities it is given. */
export type RowRules = SheetRules & KindRules;
/** The statuses a monster may start with, by key: the built-ins with the GM's laid over them (`rulesOf`). */
export type StatusDefs = Readonly<Partial<Record<string, StatusDef>>>;

/** A skill as a row reads it: an active one may have a fight ability (Arise has none in M2), a passive one a bonus. */
export type RowSkill = { readonly type: 'active'; readonly ability: Ability | null } | { readonly type: 'passive'; readonly bonus: Bonus; readonly worn?: StatusDef };
/**
 * An item as a row reads it: a worn weapon is one with `attack` and `dice`; a consumable in the bag that goes to another
 * (`target: 'other'`) is an ability the hunter takes into the fight.
 */
export type RowItem = SheetItem & {
  readonly name: string; readonly dice?: string; readonly attack?: Weapon['attack'];
  readonly type?: string; readonly rar?: string; readonly qty?: number; readonly target?: 'other'; readonly effects?: readonly Op[];
  readonly worn?: StatusDef;
};
/** The fields of a schema 4 hunter a row reads, on this phone or from a parsed remote sheet. */
export type RowHunter = Omit<SheetHunter, 'skills' | 'items' | 'conditions' | 'titles'> & {
  /** Each title's bonus, and its worn status (on the row while it is the active title). */
  readonly titles: readonly { readonly id: string; readonly bonus: SheetHunter['titles'][number]['bonus']; readonly worn?: StatusDef }[];
  readonly id: string;
  readonly name: string;
  readonly life: Life;
  readonly mana: number;
  readonly skills: readonly RowSkill[];
  readonly items: readonly RowItem[];
  readonly conditions: readonly SheetStatus[];
  /** The uses spent this long rest of each ability limited a rest (`Vitals.used`, kits table 2.3); absent, none. */
  readonly used?: Readonly<Record<string, number>>;
};
/** The fields of a schema 4 monster a row reads. A start status's def is looked up by its key. */
export type RowMonster = {
  readonly name: string;
  readonly rank: Rank;
  readonly archetype: Archetype;
  readonly kind: MonsterKind;
  /** Its type ("Beast"), which a kill's fact names; absent or empty: none. */
  readonly type?: string;
  /** The picture a GM picked for it (`Monster.icon`); absent: its default (icon-defaults.ts `monsterIcon`). */
  readonly icon?: IconKey;
  readonly tweak: { readonly hp?: number; readonly stats?: Partial<Readonly<Record<StatKey, number>>> };
  readonly abilities: readonly Ability[];
  /** Absent: the rule's for its rank and kind (`monsterXp`). */
  readonly xp?: number;
  readonly statuses: readonly { readonly key: string; readonly rounds: number | null; readonly stacks?: number }[];
};
/** The fields of a schema 4 shadow a row reads. */
export type RowShadow = { readonly id: string; readonly name: string; readonly rank: Rank; readonly archetype: Archetype; readonly grade: ShadowGrade; readonly hp: number };

/** A shadow's body by its grade (m2-plan section 1.2): its max HP and power are the monster kind's. */
export const SHADOW_KINDS: { readonly [G in ShadowGrade]: MonsterKind } = {
  Normal: 'normal', Elite: 'elite', Knight: 'elite', 'Elite Knight': 'elite', Commander: 'boss', Marshal: 'boss',
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const cut = (name: string): string => name.slice(0, NAME_MAX);
/** A, B, ..., Z, AA, AB: the letter of the `i`th body of a pack. */
const letter = (i: number): string => (i >= 26 ? letter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
/** When a new row's statuses start: its joining. The fight's `add` moves them to the fight's now (fight.ts `joined`). */
const JOINS = tick(0);
/** A status that starts at `now` and lasts `rounds` (null until removed), with `stacks` if its def stacks. */
const starting = (key: string, def: StatusDef, source: Status['source'], rounds: number | null, now: Tick, R: RowRules, stacks = 1): Status => statusOn(def, {
  key: statusKey(key), source, until: rounds === null ? null : tick(now + Math.round(rounds * R.fight.round)), since: now, settledAt: now,
}, stacks);
/** The first ability of each id, at most `MAX_ABILITIES`: a second with the same id could never be chosen. */
function distinct(list: readonly Ability[]): Ability[] {
  const out: Ability[] = [];
  for (const a of list) if (out.length < MAX_ABILITIES && !out.some(b => b.id === a.id)) out.push(a);
  return out;
}

// ── hunters ──

/**
 * The worn weapon's attack, then each active skill's ability in the skill list's order, then each consumable in the bag
 * that does something in a fight (`itemAbility`), on its user or on another, in the bag's order.
 */
export function hunterAbilities(h: Pick<RowHunter, 'items' | 'equipped' | 'skills'>, R: KindRules): Ability[] {
  const w = h.items.find(i => i.id === h.equipped['weapon']);
  const weapon: Weapon | null = w?.attack !== undefined && w.dice !== undefined ? { name: w.name, dice: w.dice, attack: w.attack } : null;
  const thrown = h.items.flatMap(i => {
    // a bag item is spent by its id, so one whose id does not read as an item's (a player's sheet keeps ids as sent) is no use in a fight
    const id = parseSaveId<'i'>(i.id);
    const a = id !== null && i.type === 'consumable' && (i.qty ?? 0) > 0 ? itemAbility({ id, name: i.name, rar: i.rar ?? 'common', target: i.target === 'other' ? 'other' : 'self', effects: i.effects ?? [] }, R) : null;
    return a ? [a] : [];
  });
  return distinct([weaponAttack(weapon, R), ...h.skills.flatMap(s => (s.type === 'active' && s.ability ? [s.ability] : [])), ...thrown]);
}

/**
 * The worn statuses of a hunter (kits design 1.3.2): each passive skill's, at the hunter's rank with the row as its
 * source, then the active title's (feature 1's notes 17.14), the same way, then each worn item's (in a slot), at the
 * item's rarity with the row as its source (item-stats 6.3: its threshold and end read the wearer, and it is the
 * wearer's act), in the slots' order. Each lasts until removed, under a
 * key made from its label that no condition and no other worn status holds, and is never written back (`worn`).
 */
function wornStatuses(h: RowHunter, id: CombatantId, taken: readonly string[], now: Tick, R: RowRules): Status[] {
  const keys = new Set(taken), out: Status[] = [];
  const put = (def: StatusDef, source: Status['source']): void => {
    const key = freeStatusKey(def.label, k => keys.has(k));
    keys.add(key);
    out.push(statusOn(def, { key, source, until: null, since: now, settledAt: now, worn: true }));
  };
  for (const s of h.skills) if (s.type === 'passive' && s.worn) put(s.worn, { id, tier: rankIdx(h.rank) });
  const title = h.titles.find(t => t.id === h.titleId);
  if (title && title.worn) put(title.worn, { id, tier: rankIdx(h.rank) });
  const worn = new Set(Object.values(h.equipped));
  for (const i of h.items) if (i.worn && worn.has(i.id)) put(i.worn, { id, tier: itemSource({ rar: i.rar ?? 'common' }).tier });
  return out;
}

/**
 * A hunter's row: its build from `buildOf`, its conditions as statuses from its joining (tick 0; the fight's `add` moves
 * them to the fight's now) for the rounds each has left, then its
 * worn statuses, its life as the sheet holds it (a dead hunter joins dead), and its mana and fatigue as the sheet holds
 * them, each within the maximum its statuses leave. Each worn status's `shield` ops land as it is put on (`statusShield`,
 * the row as user and target, `shieldLife` rounds from its joining); a condition's shield landed when it was put on.
 */
function partyRow(h: RowHunter, id: CombatantId, holder: HunterRef, R: RowRules): NewRow {
  const now = JOINS, origin: Origin = { kind: 'hunter', build: buildOf(h, R) };
  const kept = h.conditions.slice(0, MAX_STATUSES).map(c => starting(c.key, c.def, c.source, c.rounds, now, R, c.stacks));
  const statuses = [...kept, ...wornStatuses(h, id, kept.map(s => s.key), now, R)].slice(0, MAX_STATUSES);
  const { stats, sheet } = modified(origin, statuses, R), abilities = hunterAbilities(h, R), self = { stats, sheet };
  const shield = statuses.filter(s => s.worn).reduce<Shield | null>((held, s) => statusShield(s.def, { shield: held, statuses }, { user: self, target: self, charge: 0 }, now, null, R), null);
  // an ability limited a rest starts the fight with the uses its sheet has spent since the last long rest (table 2.3)
  const used = Object.fromEntries(abilities.filter(a => usesGates(a).some(g => g.per === 'rest') && (h.used?.[a.id] ?? 0) > 0).map(a => [a.id, h.used![a.id]!]));
  return {
    id, name: cut(h.name), side: 'party', kind: 'hunter', origin, tier: rankIdx(h.rank), place: null,
    life: lifeAfter(h.life, { type: 'maxChanged' }, sheet.hpMax), mana: clamp(h.mana, 0, sheet.manaMax), fatigue: clamp(h.fatigue, 0, sheet.fatigueMax),
    shield, stagger: null, channel: null, threat: null, statuses, readyAt: {}, abilities, intent: null, holder, xp: 0,
    ...(Object.keys(used).length ? { used } : {}),
  };
}

/** A hunter on this phone: the fight writes its HP, mana, fatigue and statuses back with `vitals`. */
export const hunterRow = (h: RowHunter, id: CombatantId, R: RowRules): NewRow =>
  partyRow(h, id, { kind: 'local', hunterId: hunterId(h.id) }, R);

/** A hunter on another phone, from the sheet it pushed: the fight writes back to room key `key` with `sendRemote`. */
export const remoteRow = (sheet: RowHunter, key: SheetKey, id: CombatantId, R: RowRules): NewRow =>
  partyRow(sheet, id, { kind: 'remote', remote: key }, R);

// ── monsters ──

/** The highest face of the reaction d20: never a crit, so the yardstick is a plain hit. */
const NO_CRIT = 20;

/**
 * A same-rank hit (design 4.3, the yardstick of the stagger bar): a brute's build as a hunter of the rank's first level,
 * every perk of its tiers on its main stat, in its kit, striking a same-rank normal brute at average dice, through
 * `resolve`. tests/models/fight-sim.ts measures the same hit for the simulation.
 */
export function sameRankHit(rank: Rank, R: RowRules): number {
  const a = ARCHETYPES.brute, level = R.rankLevels[rank];
  const points = split(a.main, a.second, pointsAt(level, R), R);
  const perks = TIER_BUDGET.slice(0, rankIdx(rank) + 1).reduce((s, v) => s + v, 0);
  const build: SheetBasis = { stats: { ...points, [a.main]: points[a.main] + perks }, level, gear: kitGear(a.kit, R), perks: {} };
  const strike = ARCHETYPE_ATTACKS.brute(R);
  const standing = (id: string, side: Body['side'], origin: Origin, at: Place) => {
    const { stats, sheet } = modified(origin, [], R);
    return {
      id: combatantId(id), name: id, side, origin, tier: rankIdx(rank), stats, sheet, place: at, life: { at: 'up', hp: sheet.hpMax } as const, mana: sheet.manaMax,
      fatigue: 0, shield: null, stagger: null, channel: null, statuses: [], readyAt: {}, abilities: [strike], intent: null, holder: null, at: tick(0), speed: sheet.speed, tie: 0,
    };
  };
  const u: Body = { ...standing('u', 'party', { kind: 'hunter', build }, place(0, 0)), kind: 'hunter', threat: null, xp: 0 };
  const t: Body = { ...standing('t', 'foe', { kind: 'monster', name: 't', rank, archetype: 'brute', monsterKind: 'normal', tweak: NO_TWEAK }, place(1, 0)), kind: 'monster', threat: {}, xp: 0 };
  const mean = diceOf(formulaOf(strike, R)!).map(meanOf);
  const r = resolve(strike, u, [u, t], t.id, openGrid(R.fight.grid.w, R.fight.grid.h), { dice: { [t.id]: mean }, react: { [t.id]: NO_CRIT } }, tick(0), R);
  return r.ok ? r.outcomes[0]?.dealt ?? 0 : 0;
}

/** The stagger bar of a monster of this kind and rank: its kind's number of same-rank hits, or none (design 4.3). */
export function staggerOf(rank: Rank, kind: MonsterKind, R: RowRules): Stagger | null {
  const bar = R.fight.kinds[kind].stagger;
  if (bar <= 0) return null;
  const hit = sameRankHit(rank, R);
  return { fill: 0, max: bar * hit, hit };
}

/**
 * One row of monster `m` for each id: named `m.name` alone, or with a letter each in a pack ("Goblin A"). Each has the
 * archetype's attack first and then its own abilities, full HP and mana for its sheet, its XP, a threat table, its
 * kind's stagger bar, and its start statuses from its joining (as a hunter's), the row itself the source at its rank's tier. A start status
 * whose key `R.conditions` does not hold is left out.
 */
export function monsterRows(m: RowMonster, ids: readonly CombatantId[], R: RowRules & Pick<Rules, 'rankTable'> & { readonly conditions: StatusDefs }): NewRow[] {
  const now = JOINS;
  const origin: Origin = { kind: 'monster', name: cut(m.name), rank: m.rank, archetype: m.archetype, monsterKind: m.kind, tweak: { hp: m.tweak.hp ?? NO_TWEAK.hp, stats: m.tweak.stats ?? NO_TWEAK.stats }, ...(m.type ? { type: m.type.slice(0, TYPE_MAX) } : {}), ...(m.icon ? { icon: m.icon } : {}) };
  const tier = rankIdx(m.rank), stagger = staggerOf(m.rank, m.kind, R), abilities = distinct([ARCHETYPE_ATTACKS[m.archetype](R), ...m.abilities]);
  return ids.map((id, i) => {
    const suffix = ids.length === 1 ? '' : ` ${letter(i)}`;
    const statuses = m.statuses.flatMap(s => {
      const def = Object.hasOwn(R.conditions, s.key) ? R.conditions[s.key] : undefined;
      return def ? [starting(s.key, def, { id, tier }, s.rounds, now, R, s.stacks)] : [];
    }).slice(0, MAX_STATUSES);
    const { sheet } = modified(origin, statuses, R);
    return {
      id, name: m.name.slice(0, NAME_MAX - suffix.length) + suffix, side: 'foe', kind: 'monster', origin, tier, place: null,
      life: { at: 'up', hp: sheet.hpMax }, mana: sheet.manaMax, fatigue: 0, shield: null, stagger, channel: null, threat: {}, statuses, readyAt: {}, abilities,
      intent: null, holder: null, xp: monsterXp(m, R),
    };
  });
}

// ── shadows ──

const shadowOrigin = (s: Pick<RowShadow, 'name' | 'rank' | 'archetype' | 'grade'>): Origin =>
  ({ kind: 'monster', name: cut(s.name), rank: s.rank, archetype: s.archetype, monsterKind: SHADOW_KINDS[s.grade], tweak: NO_TWEAK });

/** A shadow's sheet out of a fight, as its row starts with it: its max HP is the one its hunter's Shadows panel shows. */
export const shadowSheet = (s: Pick<RowShadow, 'name' | 'rank' | 'archetype' | 'grade'>, R: RowRules): Sheet => modified(shadowOrigin(s), [], R).sheet;

/**
 * A shadow of hunter `owner` on this phone: the body of the monster it was, at its rank and archetype with its grade's
 * kind, the archetype's attack, its HP as its hunter keeps it (dead at 0), written back with `shadowHp`. It holds no statuses and,
 * being on the party's side, no threat table and no stagger bar.
 */
export function shadowRow(s: RowShadow, owner: string, id: CombatantId, R: RowRules): NewRow {
  const origin = shadowOrigin(s);
  const { sheet } = modified(origin, [], R);
  return {
    id, name: cut(s.name), side: 'party', kind: 'shadow', origin, tier: rankIdx(s.rank), place: null,
    life: s.hp >= 1 ? { at: 'up', hp: clamp(s.hp, 1, sheet.hpMax) } : { at: 'dead' }, mana: sheet.manaMax, fatigue: 0, shield: null, stagger: null, channel: null, threat: null, statuses: [],
    readyAt: {}, abilities: distinct([ARCHETYPE_ATTACKS[s.archetype](R)]), intent: null, holder: { kind: 'shadow', hunterId: hunterId(owner), shadowId: shadowId(s.id) }, xp: 0,
  };
}

// ── summons ──

/**
 * A timed summon of `user` (kits design 1.9, rule 18d): a normal monster's body of the summon's archetype at the user's
 * rank, its archetype's attack, full HP and mana, on the user's side, owned by the user and leaving at `now` plus its
 * rounds. Its starting statuses come from `R.conditions` by key (one the rules do not hold is left out), the summon
 * itself their source. It keeps a threat table on the foes' side, as a monster does, and holds no sheet, so it writes
 * nothing back and gives no XP.
 */
export function summonRow(user: Pick<Body, 'id' | 'side' | 'tier'>, s: Summon, id: CombatantId, now: Tick, R: RowRules & { readonly conditions: StatusDefs }): NewRow {
  const rank = RANKS[Math.max(0, Math.min(RANKS.length - 1, user.tier))]!;
  const origin: Origin = { kind: 'monster', name: cut(s.name), rank, archetype: s.archetype, monsterKind: 'normal', tweak: NO_TWEAK };
  const rounds = Math.max(1, Math.min(R.fight.kit.summonRounds, s.rounds));
  const statuses = s.statuses.flatMap(x => {
    const def = Object.hasOwn(R.conditions, x.key) ? R.conditions[x.key] : undefined;
    return def ? [starting(x.key, def, { id, tier: user.tier }, x.rounds, now, R)] : [];
  }).slice(0, MAX_STATUSES);
  const { sheet } = modified(origin, statuses, R);
  return {
    id, name: cut(s.name), side: user.side, kind: 'summon', origin, tier: user.tier, place: null, life: { at: 'up', hp: sheet.hpMax }, mana: sheet.manaMax, fatigue: 0,
    shield: null, stagger: null, channel: null, threat: user.side === 'foe' ? {} : null, statuses, readyAt: {}, abilities: distinct([ARCHETYPE_ATTACKS[s.archetype](R)]),
    intent: null, holder: null, xp: 0, owner: user.id, until: tick(now + Math.round(rounds * R.fight.round)),
  };
}

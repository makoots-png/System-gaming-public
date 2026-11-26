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
import { diceOf, FORMULA_PARTS, mean as meanOf, parseFormula, partsOf } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { ARCHETYPES, kitGear, NO_TWEAK, pointsAt, referenceBonus, split } from '../hunter/derive.ts';
import type { Archetype, Bonus, SheetBasis, MonsterKind, MonsterTrait, Sheet, Tweak } from '../hunter/derive.ts';
import { buildOf, heldKeystones } from '../hunter/sheet.ts';
import type { SheetHunter, SheetItem, SheetRules } from '../hunter/sheet.ts';
import { lifeAfter } from '../hunter/vitals.ts';
import type { Life } from '../hunter/vitals.ts';
import { ARCHETYPE_ATTACKS, itemAbility, weaponAttack, wornAbilityId } from '../registry/abilities.ts';
import { classPowers } from '../registry/class-powers.ts';
import { scalerText, scalersOf } from '../registry/scalers.ts';
import type { Scaler } from '../registry/scalers.ts';
import type { Powers } from '../registry/powers.ts';
import { monsterScript, monsterXp, tweakOfMonster } from '../registry/monsters.ts';
import { mythicScriptOf } from '../registry/mythics.ts';
import type { MythicScriptId } from '../registry/mythics.ts';
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
import { isDamage, typed } from './damage-type.ts';
import { resolve } from './resolve.ts';
import { usesGates } from './uses.ts';
import { mythicStart } from './mythic.ts';
import { MAX_ABILITIES, MAX_STATUSES, NAME_MAX } from './fight-types.ts';
import type { NewRow } from './fight-types.ts';

/** The rule numbers a row reads: the hunter's sheet, the kinds of the abilities it is given, and rarities (for rank-capped consumables). */
export type RowRules = SheetRules & KindRules & Pick<Rules, 'rarities'>;
/** The statuses a monster may start with, by key: the built-ins with the GM's laid over them (`rulesOf`). */
export type StatusDefs = Readonly<Partial<Record<string, StatusDef>>>;

/** A skill as a row reads it: an active one may have a fight ability (Arise has none in M2), a passive one a bonus. */
export type RowSkill = { readonly type: 'active'; readonly ability: Ability | null } | { readonly type: 'passive'; readonly bonus: Bonus; readonly worn?: StatusDef };
/**
 * An item as a row reads it: a worn weapon is one with `attack` and `dice`; a consumable in the bag that goes to another
 * (`target: 'other'`) is an ability the hunter takes into the fight; a worn one gives its powers (`heldPowers`).
 */
export type RowItem = SheetItem & {
  readonly name: string; readonly dice?: string; readonly attack?: Weapon['attack']; readonly finesse?: true; readonly damageType?: Weapon['damageType'];
  readonly type?: string; readonly rar?: string; readonly qty?: number; readonly target?: 'other'; readonly effects?: readonly Op[]; readonly rankCap?: true;
} & Readonly<Powers>;
/** The fields of a schema 4 hunter a row reads, on this phone or from a parsed remote sheet. */
export type RowHunter = Omit<SheetHunter, 'skills' | 'items' | 'conditions' | 'titles'> & {
  /** Each title's bonus, and its powers (in the fight while it is the active title, `heldPowers`). */
  readonly titles: readonly ({ readonly id: string; readonly bonus: SheetHunter['titles'][number]['bonus'] } & Readonly<Powers>)[];
  readonly id: string;
  readonly name: string;
  readonly life: Life;
  readonly mana: number;
  readonly skills: readonly RowSkill[];
  readonly items: readonly RowItem[];
  readonly conditions: readonly SheetStatus[];
  /** The uses spent this gate of each ability limited a gate (`Vitals.used`, kits table 2.3); absent, none. */
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
  /** Its seed's tweak (derive.ts `Tweak`), an absent part as `NO_TWEAK` has it; only a solo run's fight sets `dealt`. */
  readonly tweak: { readonly hp?: number; readonly dealt?: number; readonly stats?: Partial<Readonly<Record<StatKey, number>>>; readonly traits?: readonly MonsterTrait[] };
  readonly abilities: readonly Ability[];
  /** Absent: the rule's for its rank and kind (`monsterXp`). */
  readonly xp?: number;
  readonly statuses: readonly { readonly key: string; readonly rounds: number | null; readonly stacks?: number }[];
  /** A mythic's script (`Monster.script`); a mythic without one plays `plain` (`monsterScript`). */
  readonly script?: MythicScriptId;
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
/** The first ability of each id, at most `MAX_ABILITIES`, stamped with `typed(a, R)` so learned by-value copies follow GM overrides. */
function distinct(list: readonly Ability[], R: RowRules): Ability[] {
  const out: Ability[] = [];
  for (const a of list) if (out.length < MAX_ABILITIES && !out.some(b => b.id === a.id)) out.push(typed(a, R));
  return out;
}

// ── hunters ──

/** What a hunter holds that gives powers in a fight, with the tier its worn status's source reads (`heldPowers`). */
type Held = { readonly powers: Readonly<Powers>; readonly tier: number };
/**
 * The one place a row reads what a hunter's held things give in a fight (item-stats 6.1): the active title's powers at
 * the hunter's rank, then each worn item's (in a slot) at its rarity's tier, in the slots' order, then each keystone it
 * holds (`heldKeystones`) at the hunter's rank, a confluence's awakened powers after it. Another title and an item in
 * the bag give none.
 */
export function heldPowers(h: RowHunter, R: RowRules): Held[] {
  const title = h.titles.find(t => t.id === h.titleId);
  const worn = Object.values(h.equipped).flatMap(id => h.items.find(i => i.id === id) ?? []);
  const tier = rankIdx(h.rank);
  const keystones = heldKeystones(h, R).flatMap(({ keystone, awakened }) => [{ powers: keystone, tier }, ...(awakened ? [{ powers: awakened, tier }] : [])]);
  return [...(title ? [{ powers: title, tier }] : []), ...worn.map(i => ({ powers: i, tier: itemSource({ rar: i.rar ?? 'common' }).tier })), ...keystones];
}

/** A worn item as a `Weapon` when it has both `attack` and `dice`; passed through whole so weapon fields flow without re-listing. */
const asWeapon = (i: RowItem | undefined): Weapon | null =>
  (i && i.attack !== undefined && i.dice !== undefined ? i as RowItem & Weapon : null);

/** Folded class powers for `h`, or null when `h` has no class locker. */
const activeClassPowers = (h: RowHunter, R: RowRules) =>
  (h.classes ? classPowers({ job: h.job ?? null, jobDone: h.jobDone ?? null, classes: h.classes }, R) : null);

/**
 * Multiplies a damaging ability's resolved formula by `1 * (1 + s1 + ...)` for class tree scalers (up to
 * `R.fight.kit.scalers`, emitting the `core * base * (1 + ...)` shape that `scalersOf` reads back cleanly, within
 * `FORMULA_PARTS`). Abilities that already carry scalers or non-damaging abilities are left unchanged.
 */
function withClassScalers(a: Ability, scalers: readonly Scaler[], R: RowRules): Ability {
  const cap = R.fight.kit.scalers;
  if (scalers.length === 0 || cap <= 0 || !a.effect || !isDamage(a.effect.type)) return a;
  const base = formulaOf(a, R);
  if (!base || scalersOf(base, R)) return a;
  let mult: Formula = { kind: 'number', value: 1 };
  for (const s of scalers.slice(0, cap)) {
    const parsed = parseFormula(scalerText(s, R), R);
    if (!parsed.ok) continue;
    mult = { kind: 'binary', op: '+', left: mult, right: parsed.formula };
  }
  if (mult.kind === 'number') return a;
  const scaledBase: Formula = { kind: 'binary', op: '*', left: base, right: { kind: 'number', value: 1 } };
  const combined: Formula = { kind: 'binary', op: '*', left: scaledBase, right: mult };
  if (partsOf(combined) > FORMULA_PARTS) return a;
  return { ...a, effect: { type: a.effect.type, by: 'hand', formula: combined } };
}

/**
 * The worn weapon's attack, then each active class ability (`classPowers`) as `wornAbilityId` of its id (placed ahead
 * of skills and consumables so core class abilities are never truncated by `MAX_ABILITIES`), then each active skill's
 * ability, then held actives (`heldPowers`), then each consumable in the bag (`itemAbility`). Class tree scalers apply
 * to non-consumable damaging abilities.
 */
export function hunterAbilities(h: RowHunter, R: RowRules): Ability[] {
  const weapon = asWeapon(h.items.find(i => i.id === h.equipped['weapon']));
  const thrown = h.items.flatMap(i => {
    // a bag item is spent by its id, so one whose id does not read as an item's (a player's sheet keeps ids as sent) is no use in a fight
    const id = parseSaveId<'i'>(i.id);
    const a = id !== null && i.type === 'consumable' && (i.qty ?? 0) > 0
      ? itemAbility({ id, name: i.name, rar: i.rar ?? 'common', target: i.target === 'other' ? 'other' : 'self', effects: i.effects ?? [], ...(i.rankCap ? { rankCap: true as const } : {}) }, R)
      : null;
    return a ? [a] : [];
  });
  const held = heldPowers(h, R).flatMap(({ powers: { active } }): Ability[] => {
    if (!active) return [];
    const { item: _never, ...own } = active;
    return [{ ...own, id: wornAbilityId(active.id) }];
  });
  const cp = activeClassPowers(h, R);
  const classActives: Ability[] = (cp?.actives ?? []).map(a => {
    const { item: _never, ...own } = a;
    return { ...own, id: wornAbilityId(a.id) };
  });
  const scalers = cp?.scalers ?? [];
  const core = [weaponAttack(weapon, R), ...classActives, ...h.skills.flatMap(s => (s.type === 'active' && s.ability ? [s.ability] : [])), ...held];
  const scaled = scalers.length ? core.map(a => withClassScalers(a, scalers, R)) : core;
  return distinct([...scaled, ...thrown], R);
}

/** A worn status of `def` from `source`, preferring `preferredKey` when free, else a key made from its label. */
function wornOn(def: StatusDef, source: Status['source'], keys: Set<string>, now: Tick, preferredKey?: Status['key']): Status {
  const key = preferredKey && !keys.has(preferredKey) ? preferredKey : freeStatusKey(def.label, k => keys.has(k));
  keys.add(key);
  return statusOn(def, { key, source, until: null, since: now, settledAt: now, worn: true });
}

/**
 * The worn statuses of a hunter (kits design 1.3.2): each passive skill's, at the hunter's rank with the row as its
 * source, then each held thing's `worn` (`heldPowers`: the active title's at the hunter's rank, feature 1's notes 17.14,
 * then each worn item's at the item's rarity, then its keystones), then the active awakened class's worn status
 * (`classPowers`, preferring its registry key for 0-byte fight-doc lookup), the row its source. Each lasts until removed
 * and is never written back (`worn`).
 */
function wornStatuses(h: RowHunter, id: CombatantId, taken: readonly string[], now: Tick, R: RowRules): Status[] {
  const keys = new Set(taken), out: Status[] = [];
  const put = (def: StatusDef, source: Status['source'], preferredKey?: Status['key']): void => { out.push(wornOn(def, source, keys, now, preferredKey)); };
  const tier = rankIdx(h.rank);
  for (const s of h.skills) if (s.type === 'passive' && s.worn) put(s.worn, { id, tier });
  for (const { powers, tier: heldTier } of heldPowers(h, R)) if (powers.worn) put(powers.worn, { id, tier: heldTier });
  const cp = activeClassPowers(h, R);
  if (cp?.worn) put(cp.worn.def, { id, tier }, cp.worn.key);
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
  const shield = statuses.filter(s => s.worn).reduce<Shield | null>((held, s) => statusShield(s.def, { shield: held, statuses }, { user: self, target: self, charge: 0 }, null, now, null, R), null);
  // an ability limited a gate starts the fight with the uses its sheet has spent since the last Clear (table 2.3)
  const used = Object.fromEntries(abilities.filter(a => usesGates(a).some(g => g.per === 'gate') && (h.used?.[a.id] ?? 0) > 0).map(a => [a.id, h.used![a.id]!]));
  return {
    id, name: cut(h.name), side: 'party', kind: 'hunter', origin, tier: rankIdx(h.rank), place: null,
    life: lifeAfter(h.life, { type: 'maxChanged' }, sheet.hpMax), mana: clamp(h.mana, 0, sheet.manaMax), fatigue: clamp(h.fatigue, 0, sheet.fatigueMax),
    shield, stagger: null, channel: null, threat: null, statuses, readyAt: {}, abilities, intent: null, holder, xp: 0, mythic: null,
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

/** The body a stagger bar is measured on: the monster that holds it. */
export type BarBody = { readonly rank: Rank; readonly archetype: Archetype; readonly kind: MonsterKind; readonly tweak: Tweak };

/**
 * A same-rank hit (design 4.3, the yardstick of the stagger bar): a brute's build as a hunter of the rank's first level,
 * every perk of its tiers on its main stat, in its kit, striking `on` at average dice, through `resolve`. It is measured
 * on the body that holds the bar, so a bar of 4 hits is 4 hits on that body whatever its kind's and traits' armor: on a
 * same-rank normal brute an S boss's bar (armor 1.5 times) took more than 4 of the hits that land on the boss, so it
 * staggered later than its kind's number says (sim-log.md, balance unit 4). tests/models/fight-sim.ts measures the same
 * hit for the simulation.
 */
export function sameRankHit(on: BarBody, R: RowRules): number {
  const rank = on.rank, a = ARCHETYPES.brute, level = R.rankLevels[rank];
  const points = split(a.main, a.second, pointsAt(level, R), R);
  const bonus = referenceBonus(rank);
  const build: SheetBasis = { stats: { ...points, [a.main]: points[a.main] + bonus }, level, gear: kitGear(a.kit, R), perks: {} };
  const strike = ARCHETYPE_ATTACKS.brute(R);
  const standing = (id: string, side: Body['side'], origin: Origin, at: Place) => {
    const { stats, sheet } = modified(origin, [], R);
    return {
      id: combatantId(id), name: id, side, origin, tier: rankIdx(rank), stats, sheet, place: at, life: { at: 'up', hp: sheet.hpMax } as const, mana: sheet.manaMax,
      fatigue: 0, shield: null, stagger: null, channel: null, statuses: [], readyAt: {}, abilities: [strike], intent: null, holder: null, at: tick(0), speed: sheet.speed, tie: 0,
    };
  };
  const u: Body = { ...standing('u', 'party', { kind: 'hunter', build }, place(0, 0)), kind: 'hunter', threat: null, xp: 0, mythic: null };
  const t: Body = { ...standing('t', 'foe', { kind: 'monster', name: 't', rank, archetype: on.archetype, monsterKind: on.kind, tweak: on.tweak }, place(1, 0)), kind: 'monster', threat: {}, xp: 0, mythic: null };
  const mean = diceOf(formulaOf(strike, R)!).map(meanOf);
  const r = resolve(strike, u, [u, t], t.id, openGrid(R.fight.grid.w, R.fight.grid.h), { dice: { [t.id]: mean }, react: { [t.id]: NO_CRIT } }, tick(0), R);
  return r.ok ? r.outcomes[0]?.dealt ?? 0 : 0;
}

/** The stagger bar of a monster: its kind's number of same-rank hits on its own body, or none (design 4.3). */
export function staggerOf(on: BarBody, R: RowRules): Stagger | null {
  const bar = R.fight.kinds[on.kind].stagger;
  if (bar <= 0) return null;
  const hit = sameRankHit(on, R);
  return { fill: 0, max: bar * hit, hit };
}

/**
 * One row of monster `m` for each id: named `m.name` alone, or with a letter each in a pack ("Goblin A"). Each has the
 * archetype's attack first and then its own abilities, full HP and mana for its sheet, its XP, a threat table, its
 * kind's stagger bar, and its start statuses from its joining (as a hunter's), the row itself the source at its rank's tier. A start status
 * whose key `R.conditions` does not hold is left out. Monsters of every kind (normal, elite, boss, mythic) hold no
 * keystones (the owner, Nov 22, questionable-decisions row 21): only hunters and future hunter-like enemy NPCs earn them.
 *
 * A mythic, while `fight.mythic.scripts` is on, plays its script (design B.3): it starts calm in its first phase
 * (`mythicStart`), its max HP its seed's times the script's `hp` (the one place that factor is applied), its bar that
 * phase's share of its kind's, wearing that phase's statuses after its start statuses (one whose key a start status holds
 * is left out). With the switch off, and on every other monster, its standing is null and its HP its seed's.
 */
export function monsterRows(m: RowMonster, ids: readonly CombatantId[], R: RowRules & Pick<Rules, 'rankTable'> & { readonly conditions: StatusDefs }): NewRow[] {
  const now = JOINS;
  const script = R.fight.mythic.scripts ? monsterScript(m) : null, first = script === null ? null : mythicScriptOf(script).phases[0];
  const seeded = tweakOfMonster(m.tweak), tweak = script === null ? seeded : { ...seeded, hp: seeded.hp * mythicScriptOf(script).hp };
  const origin: Origin = { kind: 'monster', name: cut(m.name), rank: m.rank, archetype: m.archetype, monsterKind: m.kind, tweak, ...(m.type ? { type: m.type.slice(0, TYPE_MAX) } : {}), ...(m.icon ? { icon: m.icon } : {}) };
  const bar = staggerOf({ rank: m.rank, archetype: m.archetype, kind: m.kind, tweak }, R);
  const tier = rankIdx(m.rank), stagger = bar && first ? { ...bar, max: bar.max * first.bar } : bar;
  const abilities = distinct([ARCHETYPE_ATTACKS[m.archetype](R), ...m.abilities], R);
  return ids.map((id, i) => {
    const suffix = ids.length === 1 ? '' : ` ${letter(i)}`;
    const own = m.statuses.flatMap(s => {
      const def = Object.hasOwn(R.conditions, s.key) ? R.conditions[s.key] : undefined;
      return def ? [starting(s.key, def, { id, tier }, s.rounds, now, R, s.stacks)] : [];
    });
    const worn = (first?.worn ?? []).filter(w => !own.some(s => s.key === w.key)).map(w => starting(w.key, w.def, { id, tier }, null, now, R));
    const statuses = [...own, ...worn].slice(0, MAX_STATUSES);
    const { sheet } = modified(origin, statuses, R);
    return {
      id, name: m.name.slice(0, NAME_MAX - suffix.length) + suffix, side: 'foe', kind: 'monster', origin, tier, place: null,
      life: { at: 'up', hp: sheet.hpMax }, mana: sheet.manaMax, fatigue: 0, shield: null, stagger, channel: null, threat: {}, statuses, readyAt: {}, abilities,
      intent: null, holder: null, xp: monsterXp(m, R), mythic: mythicStart(script, now),
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
    readyAt: {}, abilities: distinct([ARCHETYPE_ATTACKS[s.archetype](R)], R), intent: null, holder: { kind: 'shadow', hunterId: hunterId(owner), shadowId: shadowId(s.id) }, xp: 0, mythic: null,
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
    shield: null, stagger: null, channel: null, threat: user.side === 'foe' ? {} : null, statuses, readyAt: {}, abilities: distinct([ARCHETYPE_ATTACKS[s.archetype](R)], R),
    intent: null, holder: null, xp: 0, mythic: null, owner: user.id, until: tick(now + Math.round(rounds * R.fight.round)),
  };
}

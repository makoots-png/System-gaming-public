// status-refs.ts: every place a status key sits in the GM's content, walked by one function for each kind of thing. A
// walk takes a thing and a function of a key, and gives the thing back with each key it holds replaced by that function's
// answer. A pack (pack.ts) runs the same walk twice: `namedIn` lists the statuses a thing names, so a shared thing
// arrives with them, and `rekeyed` writes a thing with each key a merge renamed, so it names them under their new keys.
// One walk for both, so the list and the renaming cannot disagree. Pure.
// The typecheck holds each walk whole. A union's walk is a switch that ends in `satisfies never`, so a new member needs
// its case. An object's walk is a table (`fields`) with a row for each of its fields: a walk, or `none` where the field's
// type can hold no `StatusKey` (`HoldsKey`). A new field, op, formula, trigger or price that can hold a status key fails
// the typecheck here until its row or case says how it is walked. Its case in tests/pack.test.ts ("a status named
// anywhere in a shared thing travels with it") shows it travels.
import type { Ability, AbilityEffect, AbilityGate, Price, Summon } from './combat/ability-types.ts';
import { statusKey } from './combat/effect-ops.ts';
import type { End, LandOp, Op, StackRule, StatusDef, StatusKey, Threshold, Tiered, Tiers } from './combat/effect-ops.ts';
import type { BearerEvent, Need, Party, Trigger } from './combat/triggers.ts';
import type { MapZone, BattleMap } from './registry/maps.ts';
import type { ZoneSpec } from './combat/zones.ts';
import type { Formula } from './formula.ts';
import type { FeatDef } from './hunter/feats.ts';
import type { ItemTemplate } from './registry/items.ts';
import type { Loot, MonsterTemplate, StartStatus } from './registry/monsters.ts';
import type { SkillTemplate } from './registry/skills.ts';
import type { RewardBundle, RewardStatus, RewardTitle, Rewards } from './rewards.ts';
import type { Chapter, ChapterQuest, StoryTemplate } from './story/story.ts';

/** What a walk does at each status key: the key to write there. */
export type KeyFn = (key: StatusKey) => StatusKey;
/** A thing given back with each status key in it replaced by `f`'s answer. Never changes its input. */
export type Walk<T> = (x: T, f: KeyFn) => T;

/** The status keys `x` names, added to `out`. */
export function namedIn<T>(walk: Walk<T>, x: T, out: Set<StatusKey>): void {
  walk(x, key => { out.add(key); return key; });
}
/** `x` with each status key `map` holds replaced by its new key. */
export const rekeyed = <T>(walk: Walk<T>, x: T, map: ReadonlyMap<string, StatusKey>): T => walk(x, key => map.get(key) ?? key);

// ── the typecheck's proof that a field holds no status key ──
/** Types a status key sits in, named so `HoldsKey` stops at them (an op holds a def, which holds ops; a formula holds formulas). */
type Keyed = StatusKey | Op | LandOp | Formula | StatusDef | Trigger;
/** Whether a status key can sit anywhere inside `T`: true, false, or boolean for a union of both. */
type HoldsKey<T> = [T] extends [never] ? false
  : T extends Keyed ? true
  : T extends string | number | boolean | null | undefined ? false
  : T extends readonly (infer E)[] ? HoldsKey<E>
  : T extends object ? (true extends { [K in keyof T]-?: HoldsKey<T[K]> }[keyof T] ? true : false)
  : false;
/** The row of a field whose type holds no status key. */
const none = 'none';
/** A row for each field of `T`: its walk, or `none`, which the typecheck allows only where the field can hold no status key. */
type Fields<T> = { readonly [K in keyof T]-?: true extends HoldsKey<T[K]> ? Walk<NonNullable<T[K]>> : typeof none | Walk<NonNullable<T[K]>> };

/** The walk of an object by its table: each field with a walk is walked, unless absent or null; the rest are kept. */
function fields<T extends object>(table: Fields<T>): <X extends T>(x: X, f: KeyFn) => X {
  // Each row's walk takes its own field's type; the loop reads them as one list, so it holds them as walks of unknown.
  const walks = Object.entries(table).filter(([, w]) => w !== none) as [string, Walk<unknown>][];
  return (x, f) => {
    const out = { ...x } as Record<string, unknown>;
    for (const [k, walk] of walks) { const v = out[k]; if (v !== undefined && v !== null) out[k] = walk(v, f); }
    return out as typeof x;
  };
}
const list = <T>(walk: Walk<T>) => (xs: readonly T[], f: KeyFn): T[] => xs.map(x => walk(x, f));
const key: Walk<StatusKey> = (k, f) => f(k);

// ── formulas and ops ──
function formula(x: Formula, f: KeyFn): Formula {
  switch (x.kind) {
    case 'stacks': case 'field': case 'held': return { ...x, key: f(x.key) };
    case 'negate': case 'fn': return { ...x, arg: formula(x.arg, f) };
    case 'binary': case 'min': case 'max': return { ...x, left: formula(x.left, f), right: formula(x.right, f) };
    case 'number': case 'dice': case 'stat': case 'sheet': case 'charge': case 'missing': case 'count': return x;
    default: return x satisfies never;
  }
}
const isTiers = (v: Tiered<Formula>): v is Tiers<Formula> => Array.isArray(v);
function tiered(x: Tiered<Formula>, f: KeyFn): Tiered<Formula> {
  if (!isTiers(x)) return formula(x, f);
  const [a, b, c, d, e, g] = x;
  return [formula(a, f), formula(b, f), formula(c, f), formula(d, f), formula(e, f), formula(g, f)];
}
function opWalk(o: Op | LandOp, f: KeyFn): Op | LandOp {
  switch (o.op) {
    case 'damage': case 'heal': case 'mana': case 'fatigue': return { ...o, amount: tiered(o.amount, f) };
    case 'shield': return { ...o, amount: formula(o.amount, f) };
    case 'applyStatus': return { ...o, key: f(o.key), def: statusDef(o.def, f) };
    case 'cureStatus': return { ...o, key: f(o.key) };
    case 'move': return { ...o, key: o.key === 'harmful' || o.key === 'event' ? o.key : f(o.key), as: o.as === null ? null : f(o.as) };
    case 'note': case 'speed': case 'delay': case 'hold': case 'root': case 'taunt': case 'threat': case 'channel': case 'staggerRate':
    case 'stat': case 'refund': case 'aura': case 'spread': case 'sheet': case 'share': case 'untargetable': case 'invulnerable':
    case 'safeguard': case 'edge': case 'boost': case 'hidden': case 'alert': case 'shove': case 'hasten': case 'extra': case 'guard':
    case 'negate': case 'dispel': return o;
    default: return o satisfies never;
  }
}
/** An op walked. Each case keeps the op's kind and its other fields, so an op comes back as the kind of op it went in as. */
const op = <O extends Op | LandOp>(o: O, f: KeyFn): O => opWalk(o, f) as O;
const ops = <O extends Op | LandOp>(xs: readonly O[], f: KeyFn): O[] => xs.map(o => op(o, f));

// ── a status def and its triggers ──
function need(n: Need, f: KeyFn): Need {
  switch (n.kind) {
    case 'holds': return { ...n, key: f(n.key) };
    case 'inside': return n;
    default: return n satisfies never;
  }
}
type On<E extends Trigger['on']> = Extract<Trigger, { readonly on: E }>;
const TRIGGER_PARTS = { limit: none, ops, need, on: none, to: none } as const;
const partyTrigger = fields<On<Party>>({ ...TRIGGER_PARTS, tag: none });
const aloneTrigger = fields<On<Exclude<BearerEvent, Party>>>(TRIGGER_PARTS);
const statusTrigger = fields<On<'statusGained' | 'statusEnded'>>({ ...TRIGGER_PARTS, key });
const usedTrigger = fields<On<'used'>>({ ...TRIGGER_PARTS, tag: none });
function trigger(t: Trigger, f: KeyFn): Trigger {
  switch (t.on) {
    case 'hitDealt': case 'struck': case 'critDealt': case 'critTaken': case 'kill': case 'avoided': return partyTrigger(t, f);
    case 'turnStart': case 'turnEnd': case 'moved': case 'down': return aloneTrigger(t, f);
    case 'statusGained': case 'statusEnded': return statusTrigger(t, f);
    case 'used': return usedTrigger(t, f);
    default: return t satisfies never;
  }
}
function thresholdAt(at: Threshold['at'], f: KeyFn): Threshold['at'] {
  switch (at.kind) {
    case 'count': return at;
    case 'formula': return { ...at, formula: formula(at.formula, f) };
    default: return at satisfies never;
  }
}
const threshold = fields<Threshold>({ at: thresholdAt, to: none, ops, then: none });
const stackRule = fields<StackRule>({ cap: none, leave: none, keep: none, threshold });
const end = fields<End>({ ops, cleanse: none });
/** A status def: its ops, its triggers, its stack's threshold and its end. */
export const statusDef: Walk<StatusDef> = fields<StatusDef>({ label: none, desc: none, color: none, ops, triggers: list(trigger), end, stack: stackRule });

// ── an ability ──
function effect(e: AbilityEffect, f: KeyFn): AbilityEffect {
  switch (e.by) {
    case 'rule': return e;
    case 'hand': return { ...e, formula: formula(e.formula, f) };
    default: return e satisfies never;
  }
}
function price(p: Price, f: KeyFn): Price {
  switch (p.kind) {
    case 'stacks': return { ...p, key: f(p.key) };
    case 'hp': case 'zone': return p;
    default: return p satisfies never;
  }
}
function gate(g: AbilityGate, f: KeyFn): AbilityGate {
  switch (g.kind) {
    case 'holds': return { ...g, key: f(g.key) };
    case 'uses': case 'inside': return g;
    default: return g satisfies never;
  }
}
const zoneSpec = fields<ZoneSpec>({ name: none, duration: none, ops, endsWithOwner: none, around: none, grow: none, upkeep: none, end: ops, triggers: list(trigger) });
const summon = fields<Summon>({ name: none, archetype: none, rounds: none, statuses: list(fields<Summon['statuses'][number]>({ key, rounds: none })) });
const ability = fields<Ability>({
  id: none, name: none, kind: none, cost: none, aim: none, range: none, shape: none, delivery: none, foesOnly: none, effect, ops, channel: none,
  zone: zoneSpec, tags: none, prices: list(price), gates: list(gate), summon, move: none, react: none, zoneAct: none, item: none,
});

// ── the GM's things ──
/** An item: what its use does and the status it puts on while worn. */
export const item: Walk<ItemTemplate> = fields<ItemTemplate>({
  name: none, rar: none, grade: none, type: none, slot: none, qty: none, dice: none, bonus: none, value: none, weight: none, desc: none, armor: none,
  resist: none, attack: none, penFlat: none, effects: ops, target: none, tell: none, worn: statusDef, revive: none,
});
const SKILL_PARTS = { name: none, level: none, label: none, desc: none, type: none } as const;
const activeSkill = fields<Extract<SkillTemplate, { type: 'active' }>>({ ...SKILL_PARTS, ability });
const passiveSkill = fields<Extract<SkillTemplate, { type: 'passive' }>>({ ...SKILL_PARTS, bonus: none, worn: statusDef });
/** A skill: an active one's ability, a passive one's worn status. */
export function skill(k: SkillTemplate, f: KeyFn): SkillTemplate {
  switch (k.type) {
    case 'active': return activeSkill(k, f);
    case 'passive': return passiveSkill(k, f);
    default: return k satisfies never;
  }
}
const rewardStatus = fields<RewardStatus>({ key, rounds: none, def: statusDef });
const rewardTitle = fields<RewardTitle>({ name: none, desc: none, bonus: none, key: none, replaces: none, worn: statusDef });
const rewards = fields<Rewards>({
  xp: none, points: none, gold: none, items: list(item), title: rewardTitle, job: none, skills: list(skill), statuses: list(rewardStatus), boons: none,
});
/** A reward bundle without its id. */
export const bundle: Walk<Omit<RewardBundle, 'id'>> = fields<Omit<RewardBundle, 'id'>>({ name: none, rewards, window: none });
/** A monster's starting status. Its key is typed as text (registry/monsters.ts); its parser keeps only a status key there. */
const startStatus = fields<StartStatus>({ key: (k, f) => f(statusKey(k)), rounds: none, stacks: none });
const loot = fields<Loot>({ gold: none, items: list(item) });
/** A monster: its abilities, its starting statuses and its loot. */
export const monster: Walk<MonsterTemplate> = fields<MonsterTemplate>({
  name: none, rank: none, type: none, archetype: none, kind: none, tweak: none, abilities: list(ability), notes: none, xp: none,
  extractable: none, desc: none, statuses: list(startStatus), loot, auto: none, placeholder: none,
});
const mapZone = fields<MapZone>({
  id: none, name: none, ground: none, owner: none, spares: none, tier: none, until: none, endsWithOwner: none, ops, upkeep: none, end: ops,
  triggers: list(trigger), laid: none, paid: none,
});
/** A battle map without its id: its zones. */
export const battleMap: Walk<Omit<BattleMap, 'id'>> = fields<Omit<BattleMap, 'id'>>({
  name: none, w: none, h: none, tiles: none, zones: list(mapZone), starts: none, sight: none, fog: none,
});
/** A feat: its reward. */
export const feat: Walk<FeatDef> = fields<FeatDef>({ name: none, window: none, desc: none, show: none, rule: none, rewards, off: none });
const quest = fields<ChapterQuest>({ kind: none, title: none, desc: none, objectives: none, rewards, onFail: rewards, dueHours: none, penaltyText: none });
const chapter = fields<Chapter>({ name: none, words: none, rewards, quest, note: none });
/** A story without its id: each chapter's reward and its quest's rewards. */
export const story: Walk<StoryTemplate> = fields<StoryTemplate>({ name: none, when: none, for: none, chapters: list(chapter) });

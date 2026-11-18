// ability-kinds.ts: the five kinds of ability and what each fills in when the maker starts one (docs/agent-handoff/rw/
// design.md section 3.3), and the recommended formula the maker builds from what the GM ticks (sections 3.3 and 4.1). The
// GM may change every field; `abilityOf` fills the rest. A kind's numbers are rules (`RULES.fight.abilityKinds`), so a GM
// override reaches them; this file holds each kind's form and reads them. A new kind is a member of `AbilityKind`, its row
// in `KINDS` and its numbers in `RULES.fight.abilityKinds` (the typecheck asks for both); tests/ability-kinds.test.ts
// checks every row's formulas parse.

import type { Rank, Rules } from '../rules.ts';
import { STAT_KEYS } from '../stats.ts';
import type { StatKey, Stats } from '../stats.ts';
import { kitGear, monsterSheet, monsterStats, pointsAt, sheetOf, split } from '../hunter/derive.ts';
import type { DeriveRules, Sheet, SheetNumber } from '../hunter/derive.ts';
import { average, parseFormula, printFormula } from '../formula.ts';
import { afterDefence } from '../combat/land.ts';
import type { Formula } from '../formula.ts';
import { percent, tiles } from '../combat/space.ts';
import type { Shape, Tiles } from '../combat/space.ts';
import { paceCost, roundsOf, tick } from '../combat/timeline.ts';
import type { Cost, Pace, Tick } from '../combat/timeline.ts';
import type { Ability, AbilityEffect, AbilityId, AbilityKind, Delivery, AbilityGate, AbilityEffectType, Gap, Price, RuleTicks } from '../combat/ability-types.ts';
import { baseOf, bounded, FAMILY, scalerLine, scalersOf, scalerText, suggestScaler } from './scalers.ts';
import type { Scaler, ScalerName } from './scalers.ts';

/** The rule numbers this file reads: the paces' costs, the channel's ticks and the dice limits. */
export type KindRules = Pick<Rules, 'fight' | 'dice'>;

/** What a kind fills in. `dice` and `power` make its formula: `dice + power * phys` (or `mag`, or `sup`). */
export type KindDefaults = {
  readonly pace: Pace;
  readonly fatigue: number;
  readonly mana: number;
  readonly cooldown: Tick;
  readonly aim: Ability['aim'];
  readonly range: Tiles;
  readonly shape: Shape;
  readonly delivery: Delivery;
  readonly foesOnly: boolean;
  readonly type: AbilityEffect['type'];
  readonly dice: string | null;
  readonly power: number;
};

/** Each kind's numbers in the rules (`RULES.fight.abilityKinds`): what a GM override may change. */
type KindNumbers = KindRules['fight']['abilityKinds'];
/** What a kind is, apart from its numbers: its pace, aim, damage type and formula, and its shape and delivery from its numbers. */
type KindForm<N> = {
  readonly pace: Pace;
  readonly aim: Ability['aim'];
  readonly foesOnly: boolean;
  readonly type: AbilityEffect['type'];
  readonly dice: string | null;
  readonly power: number;
  readonly shape: (n: N, R: KindRules) => Shape;
  readonly delivery: (n: N) => Delivery;
};

/**
 * Each kind's form. The numbers (wind-ups, travel, ranges, radius and ring, fatigue and mana, cooldowns) and the reason
 * for each are `RULES.fight.abilityKinds`; the cost's share of the damage budget is `RULES.fight.cost`.
 */
export const KINDS: { readonly [K in AbilityKind]: KindForm<KindNumbers[K]> } = {
  strike: {
    pace: 'standard', aim: 'foe', foesOnly: true, type: 'physical', dice: '1d8', power: 1,
    shape: n => ({ kind: 'touch', reach: tiles(n.range) }), delivery: n => ({ kind: 'travel', windup: tick(n.windup), speed: 'instant' }),
  },
  shot: {
    pace: 'quick', aim: 'foe', foesOnly: true, type: 'physical', dice: '1d8', power: 1,
    shape: () => ({ kind: 'line', width: tiles(0), pierce: false }), delivery: n => ({ kind: 'travel', windup: tick(n.windup), speed: n.travel }),
  },
  blast: {
    pace: 'heavy', aim: 'place', foesOnly: false, type: 'magical', dice: '2d8', power: 1,
    shape: (n, R) => ({ kind: 'radius', radius: tiles(n.radius), ring: { outer: tiles(n.ring), share: percent(R.fight.ringShare * 100) } }),
    delivery: n => ({ kind: 'travel', windup: tick(n.windup), speed: 'instant' }),
  },
  curse: {
    pace: 'standard', aim: 'foe', foesOnly: true, type: 'magical', dice: '1d8', power: 1,
    shape: n => ({ kind: 'touch', reach: tiles(n.range) }), delivery: () => ({ kind: 'direct' }),
  },
  // The shield is sup * 1.5: 1.45 to 2.05 same-rank hits (table 4.6).
  support: {
    pace: 'standard', aim: 'ally', foesOnly: false, type: 'shield', dice: null, power: 1.5,
    shape: n => ({ kind: 'touch', reach: tiles(n.range) }), delivery: () => ({ kind: 'sure' }),
  },
};

/** A kind's defaults under these rules: its form with its numbers filled in. */
export function kindDefaults<K extends AbilityKind>(kind: K, R: KindRules): KindDefaults {
  const form = KINDS[kind] as KindForm<KindNumbers[K]>, n = R.fight.abilityKinds[kind];
  return {
    pace: form.pace, fatigue: n.fatigue, mana: n.mana, cooldown: tick(n.cooldown), aim: form.aim, range: tiles(n.range),
    shape: form.shape(n, R), delivery: form.delivery(n), foesOnly: form.foesOnly, type: form.type, dice: form.dice, power: form.power,
  };
}

/**
 * The power a formula of each type reads, the stat that power grows with (`mine`, which a gap also compares), and the
 * target's stat a gap compares it with.
 */
const POWER: { readonly [T in AbilityEffect['type']]: { readonly power: SheetNumber; readonly mine: StatKey; readonly theirs: StatKey } } = {
  physical: { power: 'phys', mine: 'str', theirs: 'vit' },
  magical: { power: 'mag', mine: 'pow', theirs: 'dis' },
  heal: { power: 'sup', mine: 'pre', theirs: 'dis' },
  shield: { power: 'sup', mine: 'pre', theirs: 'dis' },
};
/** The stat the power of a type grows with: Strength for physical damage, Power for magical, Presence for a heal or a shield. */
export const powerStat = (type: AbilityEffect['type']): StatKey => POWER[type].mine;

export type { Gap };
export const gapOf = (type: AbilityEffect['type']): Gap => ({ mine: POWER[type].mine, theirs: POWER[type].theirs, per: 0.1, cap: 1 });
/**
 * What is wrong with a gap the GM set, or null. A gap must have a cap above 0: uncapped it is nothing between equals and
 * a one-shot against a mismatch, and stat-lowering widens it (combat-rework-notes.md, "Abilities and stats"). Its
 * bonus a point must be above 0, or the tick does nothing.
 */
export function checkGap(g: Gap): string | null {
  if (g.mine === g.theirs) return 'Pick two different stats for the gap.';
  if (!(Number.isFinite(g.per) && g.per > 0)) return 'The bonus a point of gap must be above 0%.';
  if (!(Number.isFinite(g.cap) && g.cap > 0)) return 'A gap needs a cap above 0%: without one it is nothing between equals and a one-shot against a mismatch.';
  return null;
}

/**
 * What the maker's recommendation reads: the rule's ticks (`RuleTicks`: the scale, a gap, the scalers, each scaler
 * multiplying the damage by `1 + its bonus` with the rest cut by `baseOf` so the use keeps its plain budget), and the
 * effect's type, the time it takes (its share of the damage budget) and its channel, which an ability holds itself.
 */
export type Ticks = RuleTicks & { readonly type: AbilityEffectType; readonly pace: Pace; readonly channel: 'linear' | 'exponential' | null };
/** The rule's own part of the maker's ticks, as an effect by the rule keeps it. */
export const ruleTicks = (t: Ticks): RuleTicks => ({ scale: t.scale, gap: t.gap, scalers: t.scalers });
/** A kind's ticks: it grows with the power of its type (or of `type`), at the kind's pace, with no gap, channel or scaler. */
export const defaultTicks = (kind: AbilityKind, type: AbilityEffect['type'] = KINDS[kind].type): Ticks =>
  ({ scale: POWER[type].mine, type, pace: KINDS[kind].pace, gap: null, channel: null, scalers: [] });
/**
 * The scaler the maker suggests for `kind` when the GM ticks `name` (kits design 8.0, table 8.0.2): its start and scale,
 * which the GM may type over; `recommended` cuts the base to match whatever they hold.
 */
export const suggestedScaler = (kind: AbilityKind, name: ScalerName, R: KindRules): Scaler => suggestScaler(kind, name, R);
/** The family's names and labels, in the order the maker offers them. */
export const SCALER_CHOICES: readonly { readonly name: ScalerName; readonly label: string }[] = (Object.keys(FAMILY) as ScalerName[]).map(name => ({ name, label: FAMILY[name].label }));

/**
 * The term a scaled formula adds for `stat`. The type's own stat is its power (`phys` is 0.6 times the curve of Strength,
 * design 2.2); any other stat gets the same curve written out, `6 * (ins / 10)^0.8`, so a point of Instinct buys what a
 * point of Strength buys in `phys` and no stat is the cheap one to scale with.
 */
function scaleTerm(stat: StatKey, type: AbilityEffect['type'], R: KindRules): string {
  const F = R.fight;
  return stat === POWER[type].mine ? POWER[type].power : `${F.powerK * F.statBase} * (${stat} / ${F.statBase})^${F.effExp}`;
}

/**
 * The recommended formula of a kind with these ticks, as the text the maker shows and its tree. The cost's share of the
 * damage budget multiplies it (a quick ability 0.7 of a standard one, a heavy one 1.5), so no cost is strictly better.
 */
export function recommended(kind: AbilityKind, ticks: Ticks, R: KindRules): { text: string; formula: Formula } {
  const k = KINDS[kind], F = R.fight;
  const scaled = ticks.scale === null ? null : scaleTerm(ticks.scale, ticks.type, R);
  const term = scaled === null ? null : k.power === 1 ? scaled : `${k.power} * ${scaled}`;
  let text = term === null ? (k.dice ?? '0') : k.dice === null ? term : `${k.dice} + ${term}`;
  const share = F.cost[ticks.pace] / F.cost.standard;
  if (share !== 1) text = `${share} * (${text})`;
  const g = ticks.gap;
  if (g) text = `(${text}) * (1 + min(${g.cap}, max(0, ${g.per} * (${g.mine} - target.${g.theirs}))))`;
  if (ticks.channel === 'linear') text = `(${text}) * (1 + ${F.channelLin} * charge)`;
  if (ticks.channel === 'exponential') text = `(${text}) * ${F.channelExp} ^ charge`;
  const scalers = ticks.scalers.slice(0, F.kit.scalers).map(s => bounded(s, R));
  if (scalers.length) text = `(${text}) * ${baseOf(scalers, kind, R)} * (1 + ${scalers.map(s => scalerText(s, R)).join(' + ')})`;
  const parsed = parseFormula(text, R);
  if ('error' in parsed) throw new Error(`The recommended formula of ${kind} does not parse: ${parsed.error}`);
  return { text: printFormula(parsed.formula), formula: parsed.formula };
}

const PACES: readonly Pace[] = ['quick', 'standard', 'heavy'];
/** The time an action of `pace` takes, and the pace of an ability's time (a time no pace has reads as standard). */
export const paceTime = (pace: Pace, R: KindRules): Cost => paceCost(pace, R.fight);
export const paceOf = (time: Cost, R: KindRules): Pace => PACES.find(p => paceCost(p, R.fight) === time) ?? 'standard';
/**
 * The maker's ticks of an effect by the rule: its own, with the type, the pace of the ability's time and its channel.
 * Null for an effect typed by hand, or none.
 */
export function ticksOf(a: Pick<Ability, 'effect' | 'cost' | 'channel'>, R: KindRules): Ticks | null {
  const e = a.effect;
  if (!e || e.by !== 'rule') return null;
  const { scale, gap, scalers } = e.ticks;
  return { scale, gap, scalers, type: e.type, pace: paceOf(a.cost.time, R), channel: a.channel ? a.channel.growth : null };
}
/**
 * The formula a use of `a` is worked out with, the one place an effect by the rule becomes a formula: its kind's
 * recommendation of its ticks with the rules as they are now, or the formula typed by hand. Null with no effect.
 */
export function formulaOf(a: Pick<Ability, 'kind' | 'effect' | 'cost' | 'channel'>, R: KindRules): Formula | null {
  const e = a.effect;
  if (!e) return null;
  return e.by === 'hand' ? e.formula : recommended(a.kind, ticksOf(a, R)!, R).formula;
}

const tilesWord = (n: number): string => `${n} tile${n === 1 ? '' : 's'}`;
const roundsWord = (ticks: number, R: KindRules): string => { const n = roundsOf(ticks, R, 'near'); return `${n} round${n === 1 ? '' : 's'}`; };
/**
 * What an ability reaches and how it is avoided, in sentences a GM reads (design 3.1 rules 7 and 8): its shape and
 * range, then whether a target can move out of it in the time it takes to land, resists it with Discipline, or cannot
 * avoid it; then its channel. An ability on an ally or on the user is not avoided.
 */
export function describeAbility(a: Pick<Ability, 'kind' | 'cost' | 'aim' | 'range' | 'shape' | 'delivery' | 'channel' | 'zone' | 'prices' | 'gates' | 'tags' | 'summon' | 'move' | 'react' | 'zoneAct'> & { readonly effect: Ability['effect']; readonly ops?: Ability['ops'] }, R: KindRules): string[] {
  const s = a.shape, out: string[] = [];
  if (s.kind === 'self' || a.aim === 'self') out.push('Affects the user.');
  else if (s.kind === 'touch') out.push(`Hits one ${a.aim === 'ally' ? 'ally' : 'target'} up to ${tilesWord(a.range)} away.`);
  else if (s.kind === 'line') out.push(`A line ${tilesWord(1 + 2 * s.width)} wide to a point up to ${tilesWord(a.range)} away, ${s.pierce ? 'through everyone on it' : 'stopping at the first body'}.`);
  else out.push(`Hits everyone within ${tilesWord(s.radius)} of a point up to ${tilesWord(a.range)} away${s.ring ? `, and ${s.ring.share}% in a ring out to ${tilesWord(s.ring.outer)}` : ''}.`);
  const d = a.delivery;
  if (a.aim === 'ally' || a.aim === 'self') out.push('An ally does not avoid it.');
  else if (d.kind === 'sure') out.push('Cannot be avoided.');
  else if (d.kind === 'direct') out.push('Resisted by Discipline: nothing travels, so the target\'s Will meets the user\'s Aim.');
  else out.push(`Can be dodged: it lands ${roundsWord(d.windup, R)} after it is used${d.speed === 'instant' ? '' : `, then flies ${d.speed} tiles a round`}, and the target moves as far as its speed allows in that time.`);
  if (a.channel) {
    const F = R.fight;
    const grows = a.channel.growth === 'linear' ? `by ${F.channelLin * 100}% of its base a turn` : `${F.channelExp} times a turn`;
    out.push(`Can be channeled: it grows ${grows}, up to a charge of ${a.channel.max}; a stun, a root, a taunt or a hard hit fires it early at ${F.breakShare * 100}% of its charge.`);
  }
  if (a.zone) {
    const z = a.zone, grows = z.grow && (z.around !== null || s.kind === 'radius')
      ? `, growing ${tilesWord(z.grow.step)} a round to ${tilesWord(Math.min(z.grow.cap, R.fight.fieldRadiusMax))} out` : '';
    const lasts = `${z.duration === null ? '' : ` for ${roundsWord(z.duration, R)}`}${grows}`;
    out.push(z.around === null
      ? `Leaves ${z.name} where it lands${lasts}${z.endsWithOwner ? ', gone when its user goes down' : ''}: it acts on whoever stands in it.`
      : `Leaves ${z.name} around its user${lasts}, ${tilesWord(Math.min(z.around, R.fight.fieldRadiusMax))} out. It moves with the user, ends when the user goes down, and acts on whoever stands in it.`);
  }
  const f = formulaOf(a, R);
  if (f) for (const sc of scalersOf(f, R)?.scalers ?? []) out.push(scalerLine(sc, R));
  return [...out, ...kitLines(a, R)];
}
const priceLine = (p: Price): string => {
  if (p.kind === 'hp') return `Costs ${p.amount.kind === 'flat' ? `${p.amount.n} HP` : `${Math.round(p.amount.share * 100)}% of your max HP`}. Refused at that HP or less.`;
  if (p.kind === 'stacks') return `Costs ${p.take.kind === 'all' ? 'all' : p.take.n} ${p.key} ${p.from === 'self' ? 'of yours' : 'from each target'}.`;
  return `Ends ${p.take === 'one' ? 'one' : 'all'} of your ${p.name ?? 'fields'}.`;
};
const gateLine = (g: AbilityGate): string => g.kind === 'uses' ? `${g.n} use${g.n === 1 ? '' : 's'} a ${g.per}.` : g.kind === 'inside' ? `Only inside your ${g.zone}.`
  : `Only while ${g.on === 'self' ? 'you hold' : 'the target holds'} ${g.atLeast > 1 ? `${g.atLeast} ` : ''}${g.key}.`;
const WHEN_TEXT: { readonly [W in NonNullable<Ability['react']>['when']]: string } = {
  before: 'before a foe\'s use lands on you', lethal: 'before a hit would take you to 0', after: 'after a foe\'s use lands on you', turn: 'before the turn of the body you name',
};
/** Wave 2's parts of an ability in words (kits design 8.12): a blink or a swap, a reaction, a zone act. */
function wave2Lines(a: Pick<Ability, 'range' | 'move' | 'react' | 'zoneAct'> & { readonly ops?: Ability['ops'] }, R: KindRules): string[] {
  const out: string[] = [];
  if (a.move?.kind === 'blink') out.push(`Blinks to a tile you see within ${tilesWord(Math.min(a.range, R.fight.kit.blinkMax))}.`);
  if (a.move?.kind === 'swap') out.push('Swaps places with the body it is aimed at.');
  if (a.react) {
    const guard = a.ops?.find(o => o.op === 'guard'), negate = a.ops?.some(o => o.op === 'negate');
    const who = a.react.reach > 0 && a.react.when !== 'turn' ? ` (or an ally within ${tilesWord(a.react.reach)})` : '';
    const what = guard && guard.op === 'guard' ? `, take ${Math.round(guard.share * 100)}% off a strike` : negate ? ', the use does nothing more' : '';
    out.push(`Reaction: ${WHEN_TEXT[a.react.when]}${who}${what}. Its time comes off your next turn.`);
  }
  if (a.zoneAct) out.push(a.zoneAct.act === 'shift' ? `Moves your ${a.zoneAct.name ?? 'zone'} up to ${tilesWord(a.zoneAct.by)} toward where it is aimed.` : `Widens your ${a.zoneAct.name ?? 'zone'} by ${tilesWord(a.zoneAct.by)}.`);
  return out;
}
/** An ability's kit parts in words (kits design 5.1): its prices, its gates, its tags and its summon, then wave 2's. */
function kitLines(a: Pick<Ability, 'prices' | 'gates' | 'tags' | 'summon' | 'range' | 'move' | 'react' | 'zoneAct'> & { readonly ops?: Ability['ops'] }, R: KindRules): string[] {
  const out = [...(a.prices ?? []).map(priceLine), ...(a.gates ?? []).map(gateLine), ...wave2Lines(a, R)];
  if (a.tags?.length) out.push(`Tags: ${a.tags.join(', ')}.`);
  const m = a.summon;
  if (m) out.push(`Summons a ${m.name} (${m.archetype}, your rank) for ${m.rounds} round${m.rounds === 1 ? '' : 's'}. ${R.fight.kit.summons} at most.`);
  return out;
}

/** What the maker's preview reads: the rules of a sample body's sheet as well as a kind's. */
export type SampleRules = KindRules & DeriveRules;
/**
 * A sample body at `rank` (the level that rank starts at) whose points go 2:1 to `main` and Vitality (Strength when
 * `main` is Vitality), in the medium kit: a hunter built for what the formula reads.
 */
export function sampleBody(rank: Rank, main: StatKey, R: SampleRules): { stats: Stats; sheet: Sheet } {
  const level = R.rankLevels[rank], stats = split(main, main === 'vit' ? 'str' : 'vit', pointsAt(level, R), R);
  return { stats, sheet: sheetOf({ stats, level, gear: kitGear('medium', R), perks: {} }, R) };
}
/** The ranks the maker's preview reads a formula at: the first, the middle and the last. */
export const PREVIEW_RANKS: readonly Rank[] = ['E', 'C', 'S'];
/**
 * A formula's average at ranks E, C and S, as the maker's preview shows it: used by a sample body that scales with
 * `main` on a normal brute of the same rank, the monster a GM meets most, with no charge. A damage type also gives what
 * is left after the brute's Armor or Resist (`dealt`, rule 12).
 */
export function averages(formula: Formula, type: AbilityEffect['type'] | null, main: StatKey, R: SampleRules): { rank: Rank; average: number; dealt: number | null }[] {
  return PREVIEW_RANKS.map(rank => {
    const user = sampleBody(rank, main, R), sheet = monsterSheet(rank, 'brute', 'normal', R);
    const target = { stats: monsterStats(rank, 'brute', R), sheet };
    const avg = average(formula, { user, target, charge: 0 });
    const dealt = type === 'physical' || type === 'magical' ? afterDefence(avg, type, user.sheet, sheet, R) : null;
    return { rank, average: avg, dealt };
  });
}

/** What a caller gives `abilityOf`: an id and a name, the ticks, and any field it sets itself. */
export type AbilityInput = { readonly id: AbilityId; readonly name: string; readonly ticks?: Partial<Ticks> }
  & Partial<Pick<Ability, 'cost' | 'aim' | 'range' | 'shape' | 'delivery' | 'foesOnly' | 'effect' | 'ops' | 'zone'>>;

/**
 * An ability of `kind` with every field the input leaves out filled from the kind's defaults. The effect is the
 * recommended formula of the ticks unless the input gives its own, which sets the "edited" mark.
 */
export function abilityOf(kind: AbilityKind, input: AbilityInput, R: KindRules): Ability {
  const k = kindDefaults(kind, R), ticks: Ticks = { ...defaultTicks(kind, input.ticks?.type), ...input.ticks };
  const effect: AbilityEffect | null = input.effect !== undefined ? input.effect : { type: ticks.type, by: 'rule', ticks: ruleTicks(ticks) };
  return {
    id: input.id, name: input.name, kind,
    cost: input.cost ?? { fatigue: k.fatigue, mana: k.mana, time: paceCost(ticks.pace, R.fight), cooldown: k.cooldown },
    aim: input.aim ?? k.aim, range: input.range ?? k.range, shape: input.shape ?? k.shape, delivery: input.delivery ?? k.delivery,
    foesOnly: input.foesOnly ?? k.foesOnly, effect, ops: input.ops ?? [],
    channel: ticks.channel === null ? null : { growth: ticks.channel, max: R.fight.channelMax },
    ...(input.zone ? { zone: input.zone } : {}),
  };
}

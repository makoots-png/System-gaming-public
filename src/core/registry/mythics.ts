// mythics.ts: every mythic's script, one row of `MYTHICS` each (notes-11-keystones.md, design B.6), and the pure readers
// of a script that need no fight: a phase's band of HP (`bandOf`), which of its acts a monster lacks (`scriptFits`) and
// an omen's move as an ability (`mythicMove`). A mythic monster names its script (`Monster.script`, monsters.ts); one
// that names none plays `plain`. Nothing here is read by a fight until unit MY3, and `RULES.fight.mythic.scripts` is
// off until MY5.
// To add a mythic: a row of `MYTHICS` (its key is its id), its seed's `script` naming the key, and one test in
// tests/mythics.test.ts that states its shape from its own words. Every other check loops over `MYTHICS`.
import type { Rank } from '../rules.ts';
import { average } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { kitGear, monsterSheet, monsterStats, pointsAt, sheetOf, split } from '../hunter/derive.ts';
import type { Archetype, DeriveRules, MonsterKind, Tweak } from '../hunter/derive.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability, AbilityEffect } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { UseOp } from '../combat/effect-ops.ts';
import { GRID_SIDE, percent, tiles } from '../combat/space.ts';
import type { Shape } from '../combat/space.ts';
import { paceCost, tick } from '../combat/timeline.ts';
import type { GatePhase, MoveKey, MythicMove, MythicScript, MythicStatus, Omen, OmenKey } from '../combat/mythic-types.ts';
import { abilityOf, defaultTicks, kindDefaults, recommended } from './ability-kinds.ts';
import type { MonsterRules } from './abilities.ts';
import { SAMPLE_WEARER } from './items.ts';

/**
 * A script as written, its move and omen keys plain words the compiler checks against each other, as the registry
 * stores it: the one place the keys become `MoveKey` and `OmenKey`.
 */
const mythicScript = <M extends string, O extends string>(s: MythicScript<M, O>): MythicScript => s as unknown as MythicScript;
/** A normal turn of a rotation. */
const act = { kind: 'act' } as const;
/** A rotation's beat that announces omen `o`. */
const omen = <O extends string>(o: O): { readonly kind: 'omen'; readonly omen: O } => ({ kind: 'omen', omen: o });

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** A phase's haste: it acts `pct`% faster. */
const drawn = (pct: number, name: string): MythicStatus => ({ key: statusKey(`mythic-${slug(name)}`), def: { label: name, desc: `Acts ${pct}% faster.`, ops: [{ op: 'speed', pct }] } });
/** A phase's fury: it deals `pct`% more damage. */
const fury = (pct: number, name: string): MythicStatus => ({ key: statusKey(`mythic-${slug(name)}`), def: { label: name, desc: `Deals ${pct}% more damage.`, ops: [{ op: 'share', on: 'dealt', pct }] } });
/** Put on itself by each doom that lands, so the next lands harder: a fight past its clock ends. */
const CRESCENDO: MythicStatus = {
  key: statusKey('mythic-crescendo'), def: {
    label: 'Crescendo', desc: 'Each stack: 50% more damage.', ops: [{ op: 'share', on: 'dealt', pct: 50 }],
    stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight', threshold: null },
  },
};
/** Zaratan's shell, worn on the Shore and again once the Island Wakes. */
const SHELL: MythicStatus = { key: statusKey('mythic-shell'), def: { label: 'Shell of a Thousand Years', desc: '30 more armor.', ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 30 } }] } };

/** Every script, by its id. `plain` is the script of a mythic that names none. */
export const MYTHICS = {
  // Today's mythic with a clock: one phase from full HP, the 14 rounds row M1's fight lasts, then Overwhelm, which
  // nothing answers, every other turn. So every mythic a GM makes plays a script and row B1 measures it.
  plain: mythicScript({
    name: 'A Mythic', hp: 1,
    shape: 'Its own fight with a clock: once the clock runs out it overwhelms the whole field every other turn, harder each time.',
    moves: {
      overwhelm: { name: 'Overwhelm', kind: 'blast', type: 'physical', reach: 'field', range: 0, hits: 1.2, sure: true, applies: null, leaves: null, self: CRESCENDO },
    },
    omens: {
      overwhelm: { name: 'Overwhelm', full: 'overwhelm', weak: null, aim: 'all', interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: null },
    },
    phases: [
      { name: 'The Fight', line: 'It fights as it always has, and its clock is running.', from: 1, ends: 'gate', clock: 14, worn: [], bar: 1, acts: 'every', rotation: [act] },
    ],
    enraged: [omen('overwhelm')],
  }),

  // "The fight should be a countdown to one note that ends it, with no way to survive the note."
  'angel-of-the-last-trumpet': mythicScript({
    name: 'The Angel of the Last Trumpet', hp: 0.85,
    shape: 'A countdown: every phase is short, and when a clock runs out the Final Note comes every other turn.',
    moves: {
      'stars-fall': { name: 'Stars Fall', kind: 'blast', type: 'magical', reach: 2, range: 12, hits: 0.55, sure: false,
        applies: { status: 'burning', rounds: 2 }, leaves: { name: 'Fallen stars', rounds: 2, status: 'burning' }, self: null },
      'weighed': { name: 'Weighed and Found Wanting', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 0.35, sure: false,
        applies: { status: 'paralyzed', rounds: 2 }, leaves: null, self: null },
      'found-wanting': { name: 'Found Wanting', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 0.2, sure: false,
        applies: { status: 'slowed', rounds: 2 }, leaves: null, self: null },
      'first-breath': { name: 'The First Breath', kind: 'blast', type: 'magical', reach: 4, range: 0, hits: 0.7, sure: false,
        applies: { status: 'prone', rounds: 1 }, leaves: null, self: null },
      'half-breath': { name: 'Half a Breath', kind: 'blast', type: 'magical', reach: 4, range: 0, hits: 0.35, sure: false,
        applies: null, leaves: null, self: null },
      'final-note': { name: 'The Final Note', kind: 'blast', type: 'magical', reach: 'field', range: 0, hits: 1.6, sure: true,
        applies: { status: 'stunned', rounds: 1 }, leaves: null, self: CRESCENDO },
      'broken-note': { name: 'The Broken Note', kind: 'blast', type: 'magical', reach: 'field', range: 0, hits: 0.7, sure: true,
        applies: null, leaves: null, self: CRESCENDO },
    },
    omens: {
      stars: { name: 'Stars Fall', full: 'stars-fall', weak: null, aim: 'crowd',
        interrupt: { by: [], outcome: 'none' }, stagger: 'cancel', burst: null },
      weighed: { name: 'Weighed and Found Wanting', full: 'weighed', weak: 'found-wanting', aim: 'threat',
        interrupt: { by: ['hold', 'root'], outcome: 'cancel' }, stagger: 'none', burst: { share: 0.05, outcome: 'weaken' } },
      breath: { name: 'The First Breath', full: 'first-breath', weak: 'half-breath', aim: 'self',
        interrupt: { by: ['hold'], outcome: 'weaken' }, stagger: 'cancel', burst: { share: 0.06, outcome: 'weaken' } },
      note: { name: 'The Final Note', full: 'final-note', weak: 'broken-note', aim: 'all',
        interrupt: { by: [], outcome: 'none' }, stagger: 'weaken', burst: null },
    },
    phases: [
      { name: 'The Trumpet Raised', line: 'It lifts the trumpet. Each phase is short: when a clock runs out, the Final Note begins.',
        from: 1, ends: 'gate', clock: 5, worn: [], bar: 1,
        acts: ['Roll Up the Sky', 'Appointed Hour'], rotation: [act, omen('stars'), act, omen('weighed')] },
      { name: 'The First Breath', line: 'It draws breath. It is faster, and the note is closer.',
        from: 0.65, ends: 'gate', clock: 4, worn: [drawn(20, 'Drawn Breath')], bar: 1.25,
        acts: ['Roll Up the Sky', 'Appointed Hour'], rotation: [omen('breath'), act, omen('weighed'), act] },
      { name: 'The Note', line: 'The trumpet sounds. Break its stagger bar to make the note smaller.',
        from: 0.3, ends: 'gate', clock: 3, worn: [drawn(20, 'Drawn Breath'), fury(25, 'Last Hour')], bar: 0.75,
        acts: ['Roll Up the Sky'], rotation: [act, omen('note')] },
    ],
    enraged: [omen('note')],
  }),

  // "The hunters stand on it, so it should be able to end the fight by going under."
  'zaratan-the-island-that-wakes': mythicScript({
    name: 'Zaratan, the Island That Wakes', hp: 0.9,
    shape: 'The ground: each Sinking floods tiles for the rest of the fight, and in the Dive it can only be survived.',
    moves: {
      'sinking': { name: 'Sinking of the Shore', kind: 'blast', type: 'physical', reach: 3, range: 10, hits: 0.5, sure: false,
        applies: { status: 'prone', rounds: 1 }, leaves: { name: 'Rising sea', rounds: 20, status: 'slowed' }, self: null },
      'rising': { name: 'The Sea Rises', kind: 'blast', type: 'physical', reach: 2, range: 16, hits: 0.4, sure: false,
        applies: null, leaves: { name: 'Rising sea', rounds: 20, status: 'slowed' }, self: null },
      'trench': { name: 'Breath of the Deep Trench', kind: 'blast', type: 'magical', reach: 2, range: 16, hits: 0.75, sure: false,
        applies: { status: 'stunned', rounds: 1 }, leaves: null, self: null },
      'spray': { name: 'Spray of the Trench', kind: 'blast', type: 'magical', reach: 2, range: 16, hits: 0.35, sure: false,
        applies: null, leaves: null, self: null },
      'go-under': { name: 'It Goes Under', kind: 'blast', type: 'physical', reach: 'field', range: 0, hits: 1.4, sure: true,
        applies: { status: 'prone', rounds: 1 }, leaves: null, self: CRESCENDO },
    },
    omens: {
      sinking: { name: 'Sinking of the Shore', full: 'sinking', weak: null, aim: 'crowd',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: null },
      rising: { name: 'The Sea Rises', full: 'rising', weak: null, aim: 'crowd',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: null },
      trench: { name: 'Breath of the Deep Trench', full: 'trench', weak: 'spray', aim: 'farthest',
        interrupt: { by: ['hold', 'root', 'taunt'], outcome: 'cancel' }, stagger: 'weaken', burst: { share: 0.06, outcome: 'weaken' } },
      under: { name: 'It Goes Under', full: 'go-under', weak: null, aim: 'all',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: null },
    },
    phases: [
      { name: 'The Shore', line: 'The island stirs. Where it sinks, the sea stays.',
        from: 1, ends: 'gate', clock: 6, bar: 1, worn: [SHELL],
        acts: ['Jaws Like a Harbour', 'Shell of a Thousand Years'], rotation: [act, act, omen('sinking')] },
      { name: 'The Dive', line: 'It dives. Damage does not reach it under the waves. Survive, and keep off the rising sea.',
        ends: 'clock', clock: 3, worn: [], bar: 1,
        acts: [], rotation: [omen('rising')] },
      { name: 'The Island Wakes', line: 'It surfaces, awake. The shore is smaller now.',
        from: 0.55, ends: 'gate', clock: 7, bar: 1, worn: [SHELL, fury(20, 'Waking')],
        acts: ['Jaws Like a Harbour', 'Shell of a Thousand Years'], rotation: [act, omen('trench'), act, omen('sinking')] },
    ],
    enraged: [omen('under')],
  }),

  // "A hunter he names should die unless something outside the rules prevents it."
  'the-fourth-rider': mythicScript({
    name: 'The Fourth Rider', hp: 0.85,
    shape: 'The names: he marks one hunter at a time to die, and the party saves them or loses them.',
    moves: {
      'named': { name: 'Named in the Book', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 1.1, sure: true,
        applies: null, leaves: null, self: null },
      'struck': { name: 'Struck from the Book', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 0.45, sure: true,
        applies: { status: 'frightened', rounds: 2 }, leaves: null, self: null },
      'pale-wake': { name: 'Pale Wake', kind: 'blast', type: 'magical', reach: 2, range: 12, hits: 0.3, sure: false,
        applies: { status: 'plague', rounds: 3 }, leaves: { name: 'Pale wake', rounds: 3, status: 'plague' }, self: null },
      'all-end': { name: 'All Things End', kind: 'blast', type: 'magical', reach: 'field', range: 0, hits: 0.55, sure: true,
        applies: { status: 'frightened', rounds: 2 }, leaves: null, self: null },
      'not-all': { name: 'Not Yet, Not All', kind: 'blast', type: 'magical', reach: 'field', range: 0, hits: 0.25, sure: true,
        applies: null, leaves: null, self: null },
      'reaping': { name: 'The Reaping', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 2.5, sure: true,
        applies: null, leaves: null, self: CRESCENDO },
    },
    omens: {
      named: { name: 'Named in the Book', full: 'named', weak: 'struck', aim: 'weakest',
        interrupt: { by: ['hold', 'root'], outcome: 'cancel' }, stagger: 'cancel', burst: { share: 0.05, outcome: 'weaken' } },
      wake: { name: 'Pale Wake', full: 'pale-wake', weak: null, aim: 'crowd',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: null },
      allEnd: { name: 'All Things End', full: 'all-end', weak: 'not-all', aim: 'all',
        interrupt: { by: ['hold'], outcome: 'cancel' }, stagger: 'weaken', burst: { share: 0.08, outcome: 'weaken' } },
      reaping: { name: 'The Reaping', full: 'reaping', weak: null, aim: 'weakest',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: null },
    },
    phases: [
      { name: 'The Pale Horse', line: 'He opens the book. The one he names will die unless the party stops him.',
        from: 1, ends: 'gate', clock: 5, worn: [], bar: 1,
        acts: ['Reaping Stroke', 'Not Yet'], rotation: [act, omen('named'), act] },
      { name: 'The Book Opens', line: 'He is never late, and he is faster now.',
        from: 0.7, ends: 'gate', clock: 5, worn: [drawn(15, 'Never Late')], bar: 1,
        acts: ['Reaping Stroke', 'Not Yet'], rotation: [omen('named'), act, omen('wake')] },
      { name: 'All Things End', line: 'The last page. Every name is in it.',
        from: 0.35, ends: 'gate', clock: 4, worn: [drawn(15, 'Never Late'), fury(20, 'The Last Page')], bar: 0.75,
        acts: ['Reaping Stroke'], rotation: [omen('named'), omen('allEnd')] },
    ],
    enraged: [omen('reaping')],
  }),
} as const satisfies Readonly<Record<string, MythicScript>>;

/** A script's id: a key of `MYTHICS`, so a seed that names a script the registry lacks does not compile. */
export type MythicScriptId = keyof typeof MYTHICS;
/** The script a mythic plays when it names none (a GM's own mythic, an old save). */
export const PLAIN: MythicScriptId = 'plain';
/** Every script's id, in the registry's order. */
export const MYTHIC_IDS = Object.keys(MYTHICS) as MythicScriptId[];
/** Whether `v` is the id of a script in the registry: the one check a script named in outside data passes. */
export const isMythicScriptId = (v: unknown): v is MythicScriptId => typeof v === 'string' && Object.hasOwn(MYTHICS, v);
/** The script of id `id`. */
export const mythicScriptOf = (id: MythicScriptId): MythicScript => MYTHICS[id];
/** A script's moves with their keys, in the order it writes them. */
export const movesOf = (s: MythicScript): readonly (readonly [MoveKey, MythicMove])[] => Object.entries(s.moves) as [MoveKey, MythicMove][];
/** A script's omens with their keys, in the order it writes them. */
export const omensOf = (s: MythicScript): readonly (readonly [OmenKey, Omen])[] => Object.entries(s.omens) as [OmenKey, Omen][];

/**
 * The band of max HP phase `i` holds, as shares: `from`, where it begins, and `gate`, the HP it cannot be pushed below,
 * which is the next gate phase's `from` (0 when none follows, so the last phase ends at 0 HP). A clock phase holds no
 * band: it begins at its gate.
 */
export function bandOf(s: MythicScript, i: number): { readonly from: number; readonly gate: number } {
  const next = s.phases.slice(i + 1).find((p): p is GatePhase => p.ends === 'gate');
  const gate = next?.from ?? 0, p = s.phases[i];
  return { from: p?.ends === 'gate' ? p.from : gate, gate };
}

/**
 * The names a script's phases give their act beats that `monster` holds no ability of, each once, in the script's
 * order: none when the script fits it. The bestiary maker refuses to save a mythic whose script does not fit.
 */
export function scriptFits(s: MythicScript, monster: { readonly abilities: readonly { readonly name: string }[] }): string[] {
  const held = new Set(monster.abilities.map(a => a.name));
  const named = s.phases.flatMap(p => (p.acts === 'every' ? [] : p.acts));
  return [...new Set(named)].filter(n => !held.has(n));
}

/**
 * The max HP of the sample hunter (the item maker's `SAMPLE_WEARER` build, in its kit) at the first level of `rank`:
 * what a move's `hits` is a share of, at rank S.
 */
export function sampleHp(rank: Rank, R: DeriveRules): number {
  const level = R.rankLevels[rank], stats = split(SAMPLE_WEARER.main, SAMPLE_WEARER.second, pointsAt(level, R), R);
  return sheetOf({ stats, level, gear: kitGear(SAMPLE_WEARER.kit, R), perks: {} }, R).hpMax;
}

/** The body a move is sized on: the mythic that lands it, as its rank, archetype, kind and tweak make it. */
export type MythicBody = { readonly rank: Rank; readonly archetype: Archetype; readonly kind: MonsterKind; readonly tweak: Tweak };
/** The rules a move reads: its kind's numbers, the built-in statuses it applies, and the mythic's sheet. */
export type MythicRules = MonsterRules & DeriveRules;
/**
 * The reach of a `field` move: the farthest apart two tiles of the largest map are (space.ts `dist` on a side of
 * `GRID_SIDE`'s most), so it covers every tile from wherever the mythic stands.
 */
const FIELD_REACH = tiles(GRID_SIDE[1] + Math.floor(GRID_SIDE[1] / 2));
/** Three significant figures: a move's factor as a GM reads it in its formula, within half a percent of the rule's. */
const FIGURES = 3;

/**
 * The move under key `key` as the ability `body` lands it (design B.3, "Why `hits` and not a formula"): its kind's
 * recommended formula for its damage type, times `hits × sampleHp(S) / kindHit`, where `kindHit` is that formula's mean
 * on `body`; so at mean dice it deals `hits` of the sample S hunter's max HP before armor and resist. Its id is
 * `mythic-<key>`. Its time is `mythic.turnPace` (the landing takes the mythic's turn); it costs no fatigue or mana and
 * has no cooldown, since the omen already said when it comes. It never lands on its own side. A `sure` move cannot be
 * avoided; any other is dodged or resisted as its kind is. Its `self` status is the landing's, not the ability's (MY4).
 */
export function mythicMove(key: MoveKey, move: MythicMove, body: MythicBody, R: MythicRules): Ability {
  const k = kindDefaults(move.kind, R), own = recommended(move.kind, defaultTicks(move.kind, move.type), R).formula;
  const self = { stats: monsterStats(body.rank, body.archetype, R, body.tweak), sheet: monsterSheet(body.rank, body.archetype, body.kind, R, [], body.tweak) };
  const kindHit = average(own, { user: self, target: self, charge: 0 });
  const factor = Number((move.hits * sampleHp('S', R) / kindHit).toPrecision(FIGURES));
  const formula: Formula = { kind: 'binary', op: '*', left: { kind: 'number', value: factor }, right: own };
  const effect: AbilityEffect | null = move.hits > 0 ? { type: move.type, by: 'hand', formula } : null;
  const ops: UseOp[] = move.applies
    ? [{ op: 'applyStatus', key: statusKey(move.applies.status), def: R.conditions[move.applies.status], duration: tick(move.applies.rounds * R.fight.round) }]
    : [];
  const n = R.fight.abilityKinds.blast;
  const shape: Shape = move.kind === 'shot' ? k.shape
    : move.kind !== 'blast' ? { kind: 'touch', reach: tiles(move.range) }
    : move.reach === 'field' ? { kind: 'radius', radius: FIELD_REACH, ring: null }
    : { kind: 'radius', radius: tiles(move.reach), ring: { outer: tiles(move.reach + n.ring - n.radius), share: percent(R.fight.ringShare * 100) } };
  const zone = move.leaves && { name: move.leaves.name, duration: tick(move.leaves.rounds * R.fight.round), ops: R.conditions[move.leaves.status].ops, endsWithOwner: false, around: null, grow: null };
  return abilityOf(move.kind, {
    id: abilityId(`mythic-${key}`), name: move.name, effect, ops, shape, range: tiles(move.range),
    delivery: move.sure ? { kind: 'sure' } : k.delivery, foesOnly: true,
    cost: { fatigue: 0, mana: 0, time: paceCost(R.fight.mythic.turnPace, R.fight), cooldown: tick(0) },
    ...(zone ? { zone } : {}),
  }, R);
}

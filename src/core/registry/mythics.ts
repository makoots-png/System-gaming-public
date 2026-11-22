// mythics.ts: every mythic's script, one row of `MYTHICS` each (notes-11-keystones.md, design B.6), and the pure readers
// of a script that need no fight: a phase's band of HP (`bandOf`) and which of its acts a monster lacks (`scriptFits`).
// It imports types only, so any module of a fight may read it (row-life.ts reads a gate, fight-parse.ts a stored
// standing); an omen's move as an ability is registry/mythic-moves.ts. A mythic monster names its script
// (`Monster.script`, monsters.ts); one that names none plays `plain`. `RULES.fight.mythic.scripts` is off until MY7.
// To add a mythic: a row of `MYTHICS` (its key is its id), its seed's `script` naming the key, and one test in
// tests/mythics.test.ts that states its shape from its own words. Every other check loops over `MYTHICS`.
import type { StatusKey } from '../combat/effect-ops.ts';
import type { Formula } from '../formula.ts';
import type { GatePhase, MoveKey, MythicMove, MythicScript, MythicStatus, Omen, OmenKey } from '../combat/mythic-types.ts';

/**
 * A script as written, its move and omen keys plain words the compiler checks against each other, as the registry
 * stores it: the one place the keys become `MoveKey` and `OmenKey`.
 */
const mythicScript = <M extends string, O extends string>(s: MythicScript<M, O>): MythicScript => s as unknown as MythicScript;
/**
 * A phase's or a move's status key, branded here as `mythicScript` brands the move keys, so this data module imports no
 * value and sits under every module of a fight that reads it (combat/row-life.ts reads a gate through it).
 */
const statusKey = (s: string): StatusKey => s as StatusKey;
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
/** Half of the gap from a body's `from` to its `to`, read on its bare sheet: the amount that moves `from` to their mean. */
const halfGap = (from: 'armor' | 'resist', to: 'armor' | 'resist'): Formula => ({
  kind: 'binary', op: '/', right: { kind: 'number', value: 2 },
  left: { kind: 'binary', op: '-', left: { kind: 'sheet', whose: 'target', key: to }, right: { kind: 'sheet', whose: 'target', key: from } },
});
/**
 * A mythic's guard has no gap: its armor and resist are each the mean of the two, the same sum. Worn by every phase of a
 * script whose body splits its guard: a brute's medium kit and Vitality give a brute mythic armor 92 and resist 10 at S,
 * so three cannons' bolts kept 0.92 of their damage where the mixed party's blades kept 0.50, and filled a stagger bar
 * sized on a blade's hit (rows.ts `sameRankHit`) twice as fast: three cannons won 0.38 of their fights against plain and
 * 0.66 against Zaratan, the mixed party 0.07 (row B4, sim-log.md "Mythic balance"). A caster's or a skirmisher's body
 * (armor 20, resist 30) has no such gap.
 */
const EVEN_GUARD: MythicStatus = {
  key: statusKey('mythic-even-guard'), def: {
    label: 'Even Guard', desc: 'Its armor and resist are each the mean of the two: no one kind of harm finds a gap.',
    ops: [{ op: 'sheet', key: 'armor', amount: halfGap('armor', 'resist') }, { op: 'sheet', key: 'resist', amount: halfGap('resist', 'armor') }],
  },
};
/**
 * Zaratan's Dive: no hit fills its bar, as no damage reaches its HP (a clock phase). Without it three cannons broke the
 * bar under the waves every other round and the Sea Rises never landed on them (row B4, sim-log.md "Mythic balance").
 */
const UNDER_THE_WAVES: MythicStatus = { key: statusKey('mythic-under-the-waves'), def: { label: 'Under the Waves', desc: 'No hit fills its bar.', ops: [{ op: 'staggerRate', pct: -100 }] } };
/** Zaratan's shell, worn on the Shore and again once the Island Wakes. */
const SHELL: MythicStatus = { key: statusKey('mythic-shell'), def: { label: 'Shell of a Thousand Years', desc: '30 more armor.', ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: 30 } }] } };

/** Every script, by its id. `plain` is the script of a mythic that names none. */
export const MYTHICS = {
  // Today's mythic with a clock: one phase from full HP, the 14 rounds row M1's fight lasts, then Overwhelm, which
  // nothing answers, every other turn. So every mythic a GM makes plays a script and row B1 measures it. Its body is
  // any a GM makes, so it wears the even guard: on a brute's its `hp` fell from 1.03 to 0.98 to keep B1 (sim-log.md,
  // "Mythic balance").
  plain: mythicScript({
    name: 'A Mythic', hp: 0.98,
    shape: 'Its own fight with a clock: once the clock runs out it overwhelms the whole field every other turn, harder each time.',
    moves: {
      overwhelm: { name: 'Overwhelm', kind: 'blast', type: 'physical', reach: 'field', range: 0, hits: 1.2, sure: true, applies: null, leaves: null, self: CRESCENDO },
    },
    omens: {
      overwhelm: { name: 'Overwhelm', full: 'overwhelm', weak: null, aim: 'all', interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: 'none', shield: 'none', step: 'none' },
    },
    phases: [
      { name: 'The Fight', line: 'It fights as it always has, and its clock is running.', from: 1, ends: 'gate', clock: 14, worn: [EVEN_GUARD], bar: 1, acts: 'every', rotation: [act] },
    ],
    enraged: [omen('overwhelm')],
  }),

  // "The fight should be a countdown to one note that ends it, with no way to survive the note."
  'angel-of-the-last-trumpet': mythicScript({
    name: 'The Angel of the Last Trumpet', hp: 1,
    shape: 'A countdown: every phase is short, and when a clock runs out the Final Note comes every other turn.',
    moves: {
      // 1.0 at the farthest, not 0.55 at the crowd: the walk in stepped off the crowd's tile, and at 0.55 a party that
      // never stepped won 0.83 of the share of one that did (row B5, sim-log.md MY5 fifth pass)
      'stars-fall': { name: 'Stars Fall', kind: 'blast', type: 'magical', reach: 2, range: 12, hits: 1, sure: false,
        applies: { status: 'burning', rounds: 2 }, leaves: { name: 'Fallen stars', rounds: 2, status: 'burning' }, self: null },
      // 1.2, not 0.35: a shield on the hunter it names cancels it, so its hit is the cost of no shield, as the Sinking's
      // is of not stepping off. At 0.35 three cannons, who hold no shield, lost little to it and won 0.17 of their
      // fights (row B4); at 1.2 0.093, and the mixed party, who shields it, as before (sim-log.md, "Mythic balance")
      'weighed': { name: 'Weighed and Found Wanting', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 1.2, sure: false,
        applies: { status: 'paralyzed', rounds: 2 }, leaves: null, self: null },
      'found-wanting': { name: 'Found Wanting', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 0.2, sure: false,
        applies: { status: 'slowed', rounds: 2 }, leaves: null, self: null },
      'first-breath': { name: 'The First Breath', kind: 'blast', type: 'magical', reach: 4, range: 0, hits: 0.7, sure: false,
        applies: { status: 'prone', rounds: 1 }, leaves: null, self: null },
      'half-breath': { name: 'Half a Breath', kind: 'blast', type: 'magical', reach: 4, range: 0, hits: 0.35, sure: false,
        applies: null, leaves: null, self: null },
      'final-note': { name: 'The Final Note', kind: 'blast', type: 'magical', reach: 'field', range: 0, hits: 1.6, sure: true,
        applies: { status: 'stunned', rounds: 1 }, leaves: null, self: CRESCENDO },
      // 1.2, not B.6's 0.7: a party that broke the bar at every note outlived the clock (row B6, sim-log.md MY5)
      'broken-note': { name: 'The Broken Note', kind: 'blast', type: 'magical', reach: 'field', range: 0, hits: 1.2, sure: true,
        applies: null, leaves: null, self: CRESCENDO },
    },
    omens: {
      stars: { name: 'Stars Fall', full: 'stars-fall', weak: null, aim: 'farthest',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: 'none', shield: 'none', step: 'cancel' },
      weighed: { name: 'Weighed and Found Wanting', full: 'weighed', weak: 'found-wanting', aim: 'threat',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: 'none', shield: 'cancel', step: 'none' },
      breath: { name: 'The First Breath', full: 'first-breath', weak: 'half-breath', aim: 'self',
        interrupt: { by: ['hold'], outcome: 'weaken' }, stagger: 'none', burst: 'none', shield: 'none', step: 'none' },
      note: { name: 'The Final Note', full: 'final-note', weak: 'broken-note', aim: 'all',
        interrupt: { by: ['hold'], outcome: 'weaken' }, stagger: 'none', burst: 'none', shield: 'none', step: 'none' },
    },
    phases: [
      { name: 'The Trumpet Raised', line: 'It lifts the trumpet. Each phase is short: when a clock runs out, the Final Note begins.',
        from: 1, ends: 'gate', clock: 4, worn: [], bar: 1,
        acts: ['Roll Up the Sky', 'Appointed Hour'], rotation: [act, omen('weighed'), act, omen('stars')] },
      { name: 'The First Breath', line: 'It draws breath. It is faster, and the note is closer.',
        from: 0.65, ends: 'gate', clock: 4, worn: [drawn(20, 'Drawn Breath')], bar: 1.25,
        acts: ['Roll Up the Sky', 'Appointed Hour'], rotation: [omen('breath'), act, omen('weighed'), act] },
      { name: 'The Note', line: 'The trumpet sounds. Hold it still before the note to make the note smaller.',
        from: 0.3, ends: 'gate', clock: 2, worn: [drawn(20, 'Drawn Breath'), fury(25, 'Last Hour')], bar: 0.75,
        acts: ['Roll Up the Sky'], rotation: [act, omen('note')] },
    ],
    enraged: [omen('note')],
  }),

  // "The hunters stand on it, so it should be able to end the fight by going under."
  'zaratan-the-island-that-wakes': mythicScript({
    name: 'Zaratan, the Island That Wakes', hp: 0.92,
    shape: 'The ground: each Sinking floods tiles for the rest of the fight, and in the Dive it can only be survived.',
    moves: {
      // 1.0, not 0.5: leaving the tile it aims at cancels it (decision 43), so it is the cost of not answering, and at 0.5
      // the party that answered no omen won 0.027 of its fights against 0.070 (sim-log.md, MY5 fifth pass)
      'sinking': { name: 'Sinking of the Shore', kind: 'blast', type: 'physical', reach: 3, range: 10, hits: 1, sure: false,
        applies: { status: 'prone', rounds: 1 }, leaves: { name: 'Rising sea', rounds: 20, status: 'slowed' }, self: null },
      // 0.8 at the weakest, not 0.4 at the crowd: every hunter stepped out of the crowd's tile, and the Dive held 0.007 of
      // the first falls (row B7, sim-log.md MY5 second pass)
      'rising': { name: 'The Sea Rises', kind: 'blast', type: 'physical', reach: 2, range: 16, hits: 0.8, sure: false,
        applies: null, leaves: { name: 'Rising sea', rounds: 20, status: 'slowed' }, self: null },
      // 1.2, not 0.75, for the same reason as the Sinking: a step off its tile weakens it, and a stun cancels it
      'trench': { name: 'Breath of the Deep Trench', kind: 'blast', type: 'magical', reach: 2, range: 16, hits: 1.2, sure: false,
        applies: { status: 'stunned', rounds: 1 }, leaves: null, self: null },
      'spray': { name: 'Spray of the Trench', kind: 'blast', type: 'magical', reach: 2, range: 16, hits: 0.35, sure: false,
        applies: null, leaves: null, self: null },
      'go-under': { name: 'It Goes Under', kind: 'blast', type: 'physical', reach: 'field', range: 0, hits: 1.4, sure: true,
        applies: { status: 'prone', rounds: 1 }, leaves: null, self: CRESCENDO },
    },
    omens: {
      sinking: { name: 'Sinking of the Shore', full: 'sinking', weak: null, aim: 'crowd',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: 'none', shield: 'none', step: 'cancel' },
      rising: { name: 'The Sea Rises', full: 'rising', weak: null, aim: 'weakest',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: 'none', shield: 'none', step: 'none' },
      trench: { name: 'Breath of the Deep Trench', full: 'trench', weak: 'spray', aim: 'farthest',
        interrupt: { by: ['hold', 'root'], outcome: 'cancel' }, stagger: 'none', burst: 'none', shield: 'none', step: 'weaken' },
      under: { name: 'It Goes Under', full: 'go-under', weak: null, aim: 'all',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: 'none', shield: 'none', step: 'none' },
    },
    phases: [
      // The Trench on the Shore's second beat, its clock 5 to 4: the stun is the tank's, and the tank is most often dead by
      // the Island Wakes, so a Trench there met the stun 0.09 times a fight (row B5, 1.08 of B1); here 0.6. An answered
      // Trench buys the Shore 3 rounds (`answerTime`), so its clock is a round shorter (sim-log.md, "Mythic balance").
      { name: 'The Shore', line: 'The island stirs. Where it sinks, the sea stays.',
        from: 1, ends: 'gate', clock: 4, bar: 1, worn: [EVEN_GUARD, SHELL],
        acts: ['Jaws Like a Harbour', 'Shell of a Thousand Years'], rotation: [act, omen('trench'), act, omen('sinking')] },
      { name: 'The Dive', line: 'It dives. Damage does not reach it under the waves. Survive, and keep off the rising sea.',
        ends: 'clock', clock: 4, worn: [EVEN_GUARD, UNDER_THE_WAVES], bar: 1,
        acts: [], rotation: [omen('rising')] },
      { name: 'The Island Wakes', line: 'It surfaces, awake. The shore is smaller now.',
        from: 0.55, ends: 'gate', clock: 5, bar: 1, worn: [EVEN_GUARD, SHELL, fury(20, 'Waking')],
        acts: ['Jaws Like a Harbour', 'Shell of a Thousand Years'], rotation: [act, omen('trench'), act, omen('sinking')] },
    ],
    enraged: [omen('under')],
  }),

  // "A hunter he names should die unless something outside the rules prevents it."
  'the-fourth-rider': mythicScript({
    name: 'The Fourth Rider', hp: 0.78,
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
      // Every name, not B.6's one: a doom that took one hunter a landing left the other two time to win (row B6, sim-log.md MY5)
      'reaping': { name: 'The Reaping', kind: 'blast', type: 'magical', reach: 'field', range: 0, hits: 2.5, sure: true,
        applies: null, leaves: null, self: CRESCENDO },
    },
    omens: {
      named: { name: 'Named in the Book', full: 'named', weak: 'struck', aim: 'weakest',
        interrupt: { by: ['hold', 'root'], outcome: 'cancel' }, stagger: 'none', burst: 'none', shield: 'cancel', step: 'none' },
      wake: { name: 'Pale Wake', full: 'pale-wake', weak: null, aim: 'crowd',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: 'none', shield: 'none', step: 'none' },
      allEnd: { name: 'All Things End', full: 'all-end', weak: 'not-all', aim: 'all',
        interrupt: { by: ['hold'], outcome: 'cancel' }, stagger: 'none', burst: 'none', shield: 'none', step: 'none' },
      reaping: { name: 'The Reaping', full: 'reaping', weak: null, aim: 'all',
        interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: 'none', shield: 'none', step: 'none' },
    },
    phases: [
      { name: 'The Pale Horse', line: 'He opens the book. The one he names will die unless the party stops him.',
        from: 1, ends: 'gate', clock: 5, worn: [], bar: 1,
        acts: ['Reaping Stroke', 'Not Yet'], rotation: [act, omen('named'), act] },
      { name: 'The Book Opens', line: 'He is never late, and he is faster now.',
        from: 0.55, ends: 'gate', clock: 3, worn: [drawn(15, 'Never Late')], bar: 1,
        acts: ['Reaping Stroke', 'Not Yet'], rotation: [omen('named'), act, omen('wake')] },
      { name: 'All Things End', line: 'The last page. Every name is in it.',
        from: 0.35, ends: 'gate', clock: 3, worn: [drawn(15, 'Never Late'), fury(20, 'The Last Page')], bar: 0.75,
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

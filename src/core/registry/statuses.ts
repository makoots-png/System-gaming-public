// statuses.ts: the built-in statuses, one typed table of `StatusDef`s (src/core/combat/effect-ops.ts). rules.ts serves
// it as RULES.conditions, and a GM's status of the same key in the library replaces one. To add a status: add an entry
// here and run `bun run test` (tests/statuses.test.ts checks every entry).
import type { Formula } from '../formula.ts';
import type { StatusDef, Tiers } from '../combat/effect-ops.ts';
import type { StateChip } from '../hunter/chips.ts';
import { WAYS_BACK } from '../hunter/vitals.ts';

// The old statuses restated by docs/agent-handoff/rw/m2-plan.md section 3.1. A list of six is the number at each tier of
// the source, E D C B A S. The old d20 modifier of N, the source's rank bonus (2 3 4 5 6 8), becomes 4N points on the
// stat the d20 now reads: the reaction edge is a quarter of the gap (design 3.1 rule 8a), so 4 points move the die by
// about one face, the weight the old +1 had. Attacks read Accuracy (Control), checks and fear read Will (Discipline).
const dice = (count: number, sides: number): Formula => ({ kind: 'dice', count, sides });
const num = (value: number): Formula => ({ kind: 'number', value });
const each = <T>(...v: Tiers<T>): Tiers<T> => v;
/** 4N of the old modifier at each tier: 4 times 2, 3, 4, 5, 6, 8. */
const FOUR_N = each(num(-8), num(-12), num(-16), num(-20), num(-24), num(-32));
/** The old damage modifier N (-1 -3 -5 -9 -13 -19) as stat points: power is 0.6 * eff, so round(N / 0.6). */
const DAMAGE_N = each(num(-2), num(-5), num(-8), num(-15), num(-22), num(-32));

const STATUSES = {
  bleeding: { label: 'Bleeding', desc: 'Takes physical damage every round.', ops: [
    { op: 'damage', type: 'physical', when: 'turn', amount: each(dice(1, 4), dice(1, 6), dice(2, 6), dice(2, 8), dice(3, 8), dice(4, 8)) },
  ] },
  burning: { label: 'Burning', desc: 'Takes magical damage every round.', ops: [
    { op: 'damage', type: 'magical', when: 'turn', amount: each(dice(1, 6), dice(2, 6), dice(3, 8), dice(4, 10), dice(5, 12), dice(7, 12)) },
  ] },
  poisoned: { label: 'Poisoned', desc: 'Takes magical damage every round and has lower Control, so its Accuracy drops.', ops: [
    { op: 'damage', type: 'magical', when: 'turn', amount: each(dice(1, 4), dice(1, 4), dice(1, 6), dice(1, 8), dice(1, 10), dice(1, 12)) },
    { op: 'stat', key: 'ctl', amount: FOUR_N },
  ] },
  paralyzed: { label: 'Paralyzed', desc: 'Cannot move or act.', ops: [{ op: 'hold' }, { op: 'root' }] },
  stunned: { label: 'Stunned', desc: 'Cannot act.', ops: [{ op: 'hold' }] },
  frightened: { label: 'Frightened', desc: 'Has lower Discipline, so its Will drops.', ops: [{ op: 'stat', key: 'dis', amount: FOUR_N }] },
  blinded: { label: 'Blinded', desc: 'Has much lower Control, so its Accuracy drops.', ops: [{ op: 'stat', key: 'ctl', amount: each(num(-16), num(-24), num(-32), num(-40), num(-48), num(-64)) }] },
  slowed: { label: 'Slowed', desc: 'Moves and acts more slowly.', ops: [{ op: 'speed', pct: each(-20, -25, -30, -35, -40, -50) }] },
  hasted: { label: 'Hasted', desc: 'Moves and acts faster, and sometimes gets part of an action back.', ops: [
    { op: 'speed', pct: each(20, 25, 30, 35, 40, 50) },
    { op: 'refund', pct: 50, chance: 25 },
  ] },
  // The two built-in hides (docs/agent-handoff/features/notes-7-stealth.md section 5): one level per rank, E to S. Level 0
  // is not a hide's level (standing.ts `HideLevel`: everyone's sight starts at 0), so rank E hides at 1, as the parser
  // reads a 0 (fight-parse.ts `hideLevelOf`). Invisible differs only in where it may start: in a foe's sight too.
  invisible: { label: 'Invisible', desc: 'Hidden even in plain view. Being hurt, being revealed or dealing damage ends it.', ops: [
    { op: 'hidden', level: [1, 1, 2, 3, 4, 5], start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } },
  ] },
  prone: { label: 'Prone', desc: 'Has lower Agility, so its Reaction drops.', ops: [{ op: 'stat', key: 'agi', amount: FOUR_N }] },
  restrained: { label: 'Restrained', desc: 'Cannot move, and has lower Control, so its Accuracy drops.', ops: [{ op: 'root' }, { op: 'stat', key: 'ctl', amount: FOUR_N }] },
  stealth: { label: 'Stealth', desc: 'Hidden out of every foe\'s sight. Being hurt, being revealed or dealing damage ends it.', ops: [
    { op: 'hidden', level: [1, 1, 2, 3, 4, 5], start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } },
  ] },
  bloodlust: { label: 'Bloodlust', desc: 'Has lower Discipline, Strength and Power, so its Will drops and its hits do less damage.', ops: [
    { op: 'stat', key: 'dis', amount: FOUR_N },
    { op: 'stat', key: 'str', amount: DAMAGE_N },
    { op: 'stat', key: 'pow', amount: DAMAGE_N },
  ] },
  // A seed's old "Regeneration: N HP per round" (plan 3.2), a start status: the Gate Troll's 10 at B and Beru's 25 at S,
  // and the ranks between about 1.6 times the one before.
  regenerating: { label: 'Regenerating', desc: 'Heals every round.', ops: [
    { op: 'heal', when: 'turn', amount: each(num(2), num(4), num(6), num(10), num(15), num(25)) },
  ] },
  // A monster's sickness that passes on (design 4.8): Poisoned's damage a round without its aim penalty, and a spread of
  // 1, so a body next to the bearer resists it or catches it once a round of holding it, and never twice in a fight.
  plague: { label: 'Plague', desc: 'Takes magical damage every round. Anyone next to the bearer who fails to resist it gets it too, at most once a fight.', ops: [
    { op: 'damage', type: 'magical', when: 'turn', amount: each(dice(1, 4), dice(1, 4), dice(1, 6), dice(1, 8), dice(1, 10), dice(1, 12)) },
    { op: 'spread', range: 1 },
  ] },
} satisfies Record<string, StatusDef>;

/** The key of a built-in status. A status key of any status, the GM's too, is `StatusKey` (src/core/combat/effect-ops.ts). */
export type BuiltInStatus = keyof typeof STATUSES;
/** Every built-in status by key, in the order the pickers list them. */
export const BUILT_IN_STATUSES: Readonly<Record<BuiltInStatus, StatusDef>> = STATUSES;
export const STATUS_KEYS = Object.keys(STATUSES) as BuiltInStatus[];

/**
 * The chips a hunter's state draws (src/core/hunter/chips.ts, `chipsOf`): their label and description. They are not
 * statuses: no picker offers them, and a room message or combat command that adds or removes one is refused.
 */
export const STATE_CHIP_DEFS: Readonly<Record<StateChip, StatusDef>> = {
  down: { label: 'Down', desc: 'At 0 HP a hunter is down and makes death saves. Three successes make it stable, three failures are fatal.', ops: [] },
  dead: { label: 'Dead', desc: `Three failed death saves. ${WAYS_BACK} brings the hunter back.`, ops: [] },
  exhausted: { label: 'Exhausted', desc: 'Collapsed: cannot act until a long rest.', ops: [] },
  penalized: { label: 'Penalized', desc: 'Daily Quest failed: -2 to all checks until the Penalty Zone quest is done.', ops: [] },
};

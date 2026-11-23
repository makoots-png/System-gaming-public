// dc-pick.ts: the Dice view's quick check difficulty (DC), one machine (audit SMX-views-13). The view opens on the same
// choice for every hunter (`defaulted`, `DC_DEFAULT`), and a pick in its select makes the choice the player's (`chosen`). A choice is
// a rank and a level of the rules' rank table, or no DC, never a number: the DC is read from the table at the roll, so
// a pick keeps its rank and level when the GM changes the table, and two levels with one number stay two choices.
// src/views/dice.js keeps one value and moves it only by `dcPickStep`.
import { RANKS } from './rules.ts';
import type { Rank, Rules } from './rules.ts';

/** A level of a rank's check DCs, its index in `rankTable[rank].dc`. */
export type DcLevel = 0 | 1 | 2;
const LEVELS = [0, 1, 2] as const satisfies readonly DcLevel[];
/** Each level's words, by its index. */
export const DC_LEVEL_WORDS = ['Easy', 'Standard', 'Hard'] as const;
/** A choice of the select: a rank's level, or no DC (the check is rolled with no DC, as a plain roll). */
export type DcKey = `${Rank}:${DcLevel}` | 'none';
/** The select's options by rank, in the order it lists them. */
export const DC_GROUPS: readonly { readonly rank: Rank; readonly keys: readonly DcKey[] }[] = RANKS.map(rank => ({ rank, keys: LEVELS.map(l => `${rank}:${l}` as const) }));
/** Every choice, no DC first: the select's values, read back through `oneOf`. */
export const DC_KEYS: readonly DcKey[] = ['none', ...DC_GROUPS.flatMap(g => g.keys)];

/** The quick check's DC: the one default until a pick, then the pick. */
export type DcPick = { readonly at: 'defaulted' } | { readonly at: 'chosen'; readonly key: DcKey };
export const DC_PICK_STATES = ['defaulted', 'chosen'] as const satisfies readonly DcPick['at'][];
/**
 * The choice a Dice view opens on, the same for every hunter: rank E at Standard. The owner (Nov 22, SMX-views-13.1): "Same
 * for everyone, but more impressive feats should require higher rolls", so the number is how hard the thing is, picked
 * in the select, and a hunter's rank helps through its bonus, not through the number.
 */
export const DC_DEFAULT: Exclude<DcKey, 'none'> = 'E:1';
/** A Dice view's DC as it opens. */
export const DC_START: DcPick = { at: 'defaulted' };

/** What moves the DC: a choice made in the select. Nothing else does: the hunter's rank does not (SMX-views-13.1). */
export type DcPickEvent = { readonly kind: 'picked'; readonly key: DcKey };
export const DC_PICK_EVENTS = ['picked'] as const satisfies readonly DcPickEvent['kind'][];

type Cell<S extends DcPick['at'], K extends DcPickEvent['kind']> = (s: Extract<DcPick, { at: S }>, e: Extract<DcPickEvent, { kind: K }>) => DcPick;
/** What each event does from each state; a cell that answers its state unchanged is a move that changes nothing. */
const TABLE: { readonly [S in DcPick['at']]: { readonly [K in DcPickEvent['kind']]: Cell<S, K> } } = {
  defaulted: {
    picked: (_, e) => ({ at: 'chosen', key: e.key }),
  },
  chosen: {
    picked: (s, e) => (s.key === e.key ? s : { at: 'chosen', key: e.key }),
  },
};

/** The DC after `e`; the same value when `e` changes nothing, so a caller draws only a change. */
export function dcPickStep(s: DcPick, e: DcPickEvent): DcPick {
  const row = TABLE[s.at] as { readonly [K in DcPickEvent['kind']]: (s: DcPick, e: DcPickEvent) => DcPick };
  return row[e.kind](s, e);
}

/** The choice the select shows: a defaulted DC is `DC_DEFAULT`. */
export const dcKeyOf = (s: DcPick): DcKey => (s.at === 'defaulted' ? DC_DEFAULT : s.key);

const rankLevel = (key: Exclude<DcKey, 'none'>): { rank: Rank; level: DcLevel } => {
  const [rank, level] = key.split(':') as [Rank, `${DcLevel}`];
  return { rank, level: Number(level) as DcLevel };
};
/** The number a choice stands for in `table`; null for no DC. */
const numberOf = (key: DcKey, table: Rules['rankTable']): number | null => {
  if (key === 'none') return null;
  const { rank, level } = rankLevel(key);
  return table[rank].dc[level]!;
};
/** The DC a check is rolled against, read from `table` now; null for no DC. */
export const dcOf = (s: DcPick, table: Rules['rankTable']): number | null => numberOf(dcKeyOf(s), table);
/** A choice's words in the select, its number read from `table`. */
export function dcWords(key: DcKey, table: Rules['rankTable']): string {
  if (key === 'none') return 'No DC (roll only)';
  const { rank, level } = rankLevel(key);
  return `${rank} ${DC_LEVEL_WORDS[level]} (DC ${numberOf(key, table)})`;
}

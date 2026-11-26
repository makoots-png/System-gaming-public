// quest-rights.ts: what this phone may do to a quest on its hunter. Pure. The quests view asks here before it draws
// Edit, Delete and an objective's minus and plus, and again before it acts on a tap.
// A player in a room keeps what the GM gave them as given: a quest the GM sent, or a Job Change step (the GM issues the
// chain over the `chain` message). Alone, a phone is its own GM. Whether the tied Penalty Zone quest may be deleted is
// the penalty's question (`canDeleteQuest` in penalty.ts); the view asks both.
import type { Role, Seat } from '../role.ts';
import type { Quest, QuestKind } from '../save.ts';
import type { JobChain } from './job-chain.ts';
import { chainStepsOf } from '../registry/jobs.ts';

/**
 * The kinds the GM's quest forms offer: every kind but the Penalty Zone's, which only the penalty issues. In the order a
 * form lists them.
 */
export const GM_QUEST_KINDS = ['side', 'main', 'urgent', 'job', 'daily'] as const satisfies readonly QuestKind[];
/** The kinds a player makes for their own hunter: no Job Change (the GM's chain issues those) and no penalty. */
export const PLAYER_QUEST_KINDS = ['side', 'main', 'daily', 'urgent'] as const satisfies readonly QuestKind[];
/**
 * The kinds a quest form offers the GM's or a player's form (the form's role, `app.isGM()`). A quest being edited keeps
 * its kind on offer (a Penalty Zone quest stays one; a player's quest of a GM kind stays so).
 */
export function questKindsFor(role: Role, editing: Pick<Quest, 'kind'> | null): QuestKind[] {
  const kinds: QuestKind[] = role === 'player' ? [...PLAYER_QUEST_KINDS] : [...GM_QUEST_KINDS];
  return editing && !kinds.includes(editing.kind) ? [...kinds, editing.kind] : kinds;
}

/** Whether the GM issued this quest: one the GM sent, or a step of a Job Change chain. */
export const gmIssued = (q: Pick<Quest, 'from' | 'chainId'>): boolean => q.from === 'gm' || !!q.chainId;

/** May a phone in this seat edit or delete this quest? Alone or the GM any; a player in a room none the GM issued. */
export const mayChangeQuest = (q: Pick<Quest, 'from' | 'chainId'>, seat: Seat): boolean => seat !== 'player' || !gmIssued(q);

/** Whether a phone in this seat tells the GM of this quest's progress: a player in a room, of a quest the GM sent. */
export const reportsProgress = (q: Pick<Quest, 'from'>, seat: Seat): boolean => seat === 'player' && q.from === 'gm';

/** Whether the System counts this quest's objectives: the open step of a Job Change chain that asks for a level. */
export function systemCounts(q: Pick<Quest, 'id' | 'chainId'>, chain: JobChain | null): boolean {
  if (!q.chainId || !chain || chain.id !== q.chainId || chain.questId !== q.id) return false;
  return chainStepsOf(chain.job)[(chain.step - 1) as 0 | 1 | 2].goal === 'level';
}
/**
 * Who completes a quest, read from its objectives (feature 1's notes 17.14): `system` when every one is counted from the
 * hunter's facts, `hand` when none is (or it has none), `mixed` when some are.
 */
export const QUEST_COMPLETERS = ['system', 'hand', 'mixed'] as const;
export type QuestCompleter = (typeof QUEST_COMPLETERS)[number];
export function completerOf(q: Pick<Quest, 'objectives'>): QuestCompleter {
  const n = q.objectives.filter(o => o.count).length;
  return n === 0 ? 'hand' : n === q.objectives.length ? 'system' : 'mixed';
}
/**
 * What each completer gives a quest. `button`: a Complete button on its card. `counted`: the System completes it in the
 * write whose fact fills its last objective (noticed.ts `countQuests`). A hand-ticked row of a `mixed` quest that fills
 * last asks "Complete quest?" (quests.js `setProgress`).
 */
export const COMPLETER: { readonly [C in QuestCompleter]: { readonly button: boolean; readonly counted: boolean } } = {
  system: { button: false, counted: true },
  hand: { button: true, counted: false },
  // SMX-gates-4.1: a quest with any hand-ticked objective keeps its Complete button (the owner, Nov 22: "Yes."), so a
  // cancelled "Complete quest?" is not left to a minus and a plus
  mixed: { button: true, counted: true },
};

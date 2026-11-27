// fudge.ts: the GM's hidden weight on a fight's dice (docs/agent-handoff/features/notes-8-fudge.md section 2). Its
// shape is `Fudge` (fight-types.ts), held by a fight in setup and running; `fudgeStep` is its one writer, called by the
// fight's `fudge` command, by a row that leaves and by the forces a command's dice read (fight.ts). It has no states, so
// no machine: each event sets a value. Its readers work out the weight of each die a draw makes (`weightsFor`,
// `openingWeights`, `settleWeights`), which the GM's phone (src/edge/roll.ts) and the odds engine (play.ts) draw with.
import type { CombatantId } from './ability-types.ts';
import type { Body, StatusKey } from './effect-ops.ts';
import { pendingKey } from './fight-types.ts';
import type { Command, Fight, ForcedFace, Fudge, FudgeSet, Running, Setup } from './fight-types.ts';
import type { Needs } from './resolve.ts';
import { NO_WEIGHTS } from '../draws.ts';
import type { NeedWeights, Weight } from '../draws.ts';
import { atTier } from './op-amount.ts';
import { diceOf } from '../formula.ts';

/** A new fight's weight: 0 for both sides, no row's own, no forced roll. */
export const NO_FUDGE: Fudge = { sides: { party: 0, foe: 0 }, rows: {}, forced: {} };

/**
 * What changes a fight's weight: the GM's `fudge` command, row `id` leaving the fight (its weight and force go with it),
 * or the forces of rows `ids` read by a command's dice (`forcesRead`), each spent by the one roll that read it.
 */
export type FudgeEvent = FudgeSet | { readonly kind: 'left'; readonly id: CombatantId } | { readonly kind: 'spent'; readonly ids: readonly CombatantId[] };

const without = <V>(rec: Readonly<Record<CombatantId, V>>, id: CombatantId): Record<CombatantId, V> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => k !== id)) as Record<CombatantId, V>;

/**
 * The weight after `e`. A weight or a force is set, never added, and a row's weight of 0 or a force of null leaves no
 * entry. What is set already answers `f` itself, so a caller can tell nothing changed.
 */
export function fudgeStep(f: Fudge, e: FudgeEvent): Fudge {
  switch (e.kind) {
    case 'weight': {
      const s = e.scope;
      if (s.kind === 'side') return f.sides[s.side] === e.n ? f : { ...f, sides: { ...f.sides, [s.side]: e.n } };
      if ((f.rows[s.id] ?? 0) === e.n) return f;
      return { ...f, rows: e.n === 0 ? without(f.rows, s.id) : { ...f.rows, [s.id]: e.n } };
    }
    case 'force':
      if ((f.forced[e.id] ?? null) === e.face) return f;
      return { ...f, forced: e.face === null ? without(f.forced, e.id) : { ...f.forced, [e.id]: e.face } };
    case 'left':
      return e.id in f.rows || e.id in f.forced ? { ...f, rows: without(f.rows, e.id), forced: without(f.forced, e.id) } : f;
    case 'spent':
      return e.ids.some(id => id in f.forced) ? { ...f, forced: e.ids.reduce((left, id) => without(left, id), f.forced) } : f;
  }
}

// ── what the dice read (unit 4): the one reader of a fight's weights for a draw ──

/** Row `b`'s weight: its side's plus its own, in faces. Plus means the dice fall its way. */
export const fudgeOf = (f: Fudge, b: Pick<Body, 'id' | 'side'>): number => f.sides[b.side] + (f.rows[b.id] ?? 0);

/** A forced face read from the other side of the die: the face that is best for a row is the worst for the one it hinders. */
const flipped = (face: ForcedFace | undefined): ForcedFace | null => (face === undefined ? null : face === 20 ? 1 : 20);

/**
 * One d20 that helps `helped` and may hinder `hindered` (notes-8-fudge.md section 2, the one rule): high faces good for
 * the helped body. A force on either sets the face, a forced 20 as well as the die can read for its row and so the
 * other way round for the hindered row; two forces that ask different faces cancel, and the die reads its weight,
 * `fudge(helped) − fudge(hindered)`.
 */
function d20For(f: Fudge, helped: Pick<Body, 'id' | 'side'>, hindered: Pick<Body, 'id' | 'side'> | null): Weight {
  const mine = f.forced[helped.id] ?? null, theirs = hindered ? flipped(f.forced[hindered.id]) : null;
  const face = mine !== null && theirs !== null && mine !== theirs ? null : mine ?? theirs;
  return face !== null ? { forced: face } : fudgeOf(f, helped) - (hindered ? fudgeOf(f, hindered) : 0);
}
/** A d20 whose low faces are good for the row it helps (a refund's): its weight and its forced face read the other way. */
const lowGood = (w: Weight): Weight => (typeof w === 'number' ? 0 - w : { forced: w.forced === 20 ? 1 : 20 });

/**
 * The weights of the dice `needs` asks for a use by row `by` (section 2's table): each target's reaction d20 and its
 * second helps the target and hinders the user; the dice on a body of the other side help the user and hinder the
 * target, on a body of the user's side they help the user alone; the refund's d20 helps the user on its low faces. A
 * held die is not weighted, and a force touches no damage die. A row the fight lacks reads 0.
 */
export function weightsFor(f: Setup | Running, by: CombatantId, needs: Needs): NeedWeights {
  const rows = new Map(f.rows.map(b => [b.id, b] as const)), u = rows.get(by), w = f.fudge;
  if (!u) return NO_WEIGHTS;
  const dice: Record<CombatantId, number> = {}, react: Record<CombatantId, Weight> = {};
  for (const id of Object.keys(needs.dice) as CombatantId[]) {
    // Arise's trailing d20 is governed solely by visible per-corpse Adjust roll, never hidden fight fudge
    if (needs.raise) continue;
    const t = rows.get(id);
    if (t) dice[id] = fudgeOf(w, u) - (t.side === u.side ? 0 : fudgeOf(w, t));
  }
  for (const id of needs.react) { const t = rows.get(id); if (t) react[id] = d20For(w, t, u); }
  return { dice, react, refund: lowGood(d20For(w, u, null)) };
}

/** The weight of each opening d20 of `rows` (the d1000 for the tie is not weighted): its own row's, which it helps alone. */
export const openingWeights = (f: Setup | Running, rows: readonly Pick<Body, 'id' | 'side'>[]): Record<CombatantId, Weight> =>
  Object.fromEntries(rows.map(b => [b.id, d20For(f.fudge, b, null)]));

/**
 * The weight of each term of the dice the pending entry of row `id` under `key` waits for (fight.ts `owed`), in order: a
 * per-round op's dice hinder their bearer when they take (damage, fatigue) and help it when they give (heal, mana, a
 * shield); a passing status's resist d20 helps the body it passes to. None when nothing waits there (a fight not running).
 */
export function settleWeights(f: Fight | null, id: CombatantId, key: StatusKey): Weight[] {
  if (f?.phase !== 'running') return [];
  const p = f.pending.find(x => x.id === id && pendingKey(x) === key), w = f.fudge;
  if (!p) return [];
  if ('spread' in p) return p.spread.targets.map(t => { const b = f.rows.find(r => r.id === t); return b ? d20For(w, b, null) : 0; });
  const b = f.rows.find(r => r.id === id);
  const n = b ? fudgeOf(w, b) : 0, takes = p.due.op.op === 'damage' || p.due.op.op === 'fatigue';
  return diceOf(atTier(p.due.op.amount, p.due.tier)).map(() => (takes ? -n : n));
}

/**
 * The rows whose forced face the d20s `cmd` carries read, on the fight `f` it was sent to: each row an opening is for, a
 * use's user when it carries a reaction d20 or a refund's, each target whose reaction d20 it carries, each body a
 * passing status's resist d20s are for. The reducer spends them once the command is taken (`spent`), so a force is one
 * roll's; two forces that cancelled on one die are both spent.
 */
export function forcesRead(f: Setup | Running, cmd: Command): CombatantId[] {
  const forced = (id: CombatantId): boolean => id in f.fudge.forced;
  switch (cmd.type) {
    case 'start': case 'add': return cmd.openings.map(o => o.id).filter(forced);
    case 'act': case 'release': {
      const targets = Object.keys(cmd.rolls.react) as CombatantId[];
      const user = targets.length > 0 || cmd.rolls.refund !== undefined ? [cmd.by] : [];
      return [...new Set([...user, ...targets])].filter(forced);
    }
    case 'settle': {
      if (f.phase !== 'running') return [];
      const p = f.pending.find(x => x.id === cmd.id && pendingKey(x) === cmd.key);
      return p && 'spread' in p ? p.spread.targets.filter(forced) : [];
    }
    default: return [];
  }
}

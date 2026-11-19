// fight-channel.ts: a channel's machine (docs/agent-handoff/rw/design.md section 4.1) as one table. The reducer in
// fight.ts begins, grows, releases and drops a channel (with fight-turn.ts), and `broken` in land.ts is its one break
// (rule 17), whatever lands it: a use's hit or op, a trigger's, a reaction's, a shove. A new
// event is a member of `ChannelEvent` and its cell in every row of `TABLE` (the typecheck asks), with a test in
// tests/fight.test.ts and its arrow in scripts/charts/channel.ts.
import type { Place } from './space.ts';
import type { AbilityId, CombatantId } from './ability-types.ts';
import type { Channel } from './effect-ops.ts';

/** A row with no channel is `none`; the rest are the stored states. */
export const CHANNEL_STATES = ['none', 'holding', 'broken', 'fired'] as const;
export type ChannelState = (typeof CHANNEL_STATES)[number];

/**
 * What can happen to a channel. `begin`: its user acts with a channel ability, paying the cost and prices once (`spent`, the stacks a price took). `grow`: its user's
 * turn starts, one charge a turn up to `max`. `release`: it goes off, at its charge. `interrupt`: a hit of at least its
 * hold or a hold, root or taunt lands, so its charge is cut by `share` (rounded down) and it waits to go off at once.
 * `drop`: its user acts, moves or goes down, and it ends without going off.
 */
export type ChannelEvent =
  | { readonly type: 'begin'; readonly ability: AbilityId; readonly aim: Place | CombatantId; readonly spent: number }
  | { readonly type: 'grow'; readonly max: number }
  | { readonly type: 'release' }
  | { readonly type: 'interrupt'; readonly share: number }
  | { readonly type: 'drop' };
export type ChannelEventType = ChannelEvent['type'];
export const CHANNEL_EVENTS = ['begin', 'grow', 'release', 'interrupt', 'drop'] as const satisfies readonly ChannelEventType[];

type Step<T extends ChannelEventType> = (c: Channel | null, e: Extract<ChannelEvent, { type: T }>) => Channel | null;
/** For one state: what each event does there. `null` means the event does not apply, and the channel stays as it is. */
type Row = { readonly [T in ChannelEventType]: Step<T> | null };

const begin: Step<'begin'> = (_c, e) => ({ ability: e.ability, aim: e.aim, charge: 0, spent: e.spent, state: 'holding' });
const grow: Step<'grow'> = (c, e) => c && { ...c, charge: Math.min(c.charge + 1, e.max) };
const fire: Step<'release'> = c => c && { ...c, state: 'fired' };
const interrupt: Step<'interrupt'> = (c, e) => c && { ...c, charge: Math.floor(c.charge * e.share), state: 'broken' };
const drop: Step<'drop'> = () => null;

const TABLE: { readonly [S in ChannelState]: Row } = {
  none: { begin, grow: null, release: null, interrupt: null, drop: null },
  holding: { begin: null, grow, release: fire, interrupt, drop },
  broken: { begin: null, grow: null, release: fire, interrupt: null, drop },
  fired: { begin, grow: null, release: null, interrupt: null, drop: null },
};

export const channelState = (c: Channel | null): ChannelState => c?.state ?? 'none';

/** The channel after `event`. The same channel when the event does not apply in its state. Never changes its input. */
export function channelStep(c: Channel | null, event: ChannelEvent): Channel | null {
  // The table's type pairs each key with the step for that event, so the step for `event.type` takes `event`.
  const step = TABLE[channelState(c)][event.type] as Step<ChannelEventType> | null;
  return step ? step(c, event as never) : c;
}

/** Whether `type` applies to a channel in this state. */
export const channelCan = (c: Channel | null, type: ChannelEventType): boolean => TABLE[channelState(c)][type] !== null;

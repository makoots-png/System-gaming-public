// onboarding.ts: the first-run window, one table (docs/state-machines.md, "First-run setup"): the steps of setup, what
// a step's tap has under way, and the ? guide that shares the window. Pure: the view draws the state, sends the events,
// carries out the writes and the effects.
//
// The app opens setup (`start`) on `welcome`, or on `invite` when it was opened from a room's invite link and a room
// server is there. Each window of src/views/onboard.js is a state; each button is an event. Setup ends on a first step of
// its own: Hunter created for a player (`hunterCreated`), Campaign ready for a GM (`campaignReady`), each with the role's
// next steps (src/core/first-run.ts). The save is marked onboarded (settings.ts `onboarded`) on the one transition that
// leaves the setup steps, in the same write as what that choice changes (the seed hunter made the player's own, the
// starter campaign): a reload before it starts over, a reload after it (on the confirmation too) does not.
//
// Before, the window kept three more states beside its step (audit SMX-views-12): the invite's `failed` flag, the
// buttons' `disabled` while a check or a create was out, and the focus to give back hung on the overlay (`_trigger`).
// Skip went on to the Room page when its write was refused, and a refused Join turned the invite into a blank Try again.
// Now each is a sub-state here, a write the save refused is an event (`refused`) each state answers, and closing
// Campaign ready while its Create room is out answers an effect that cancels the create.
import type { TapKind } from './sync/taps.ts';

export const ONBOARD_STEPS = ['shut', 'quickstart', 'welcome', 'role', 'invite', 'player', 'gm', 'hunterCreated', 'campaignReady'] as const;
/**
 * `shut`: no window (before setup, after it, between reads of the ? guide). `quickstart`: the ? guide. `welcome`: the
 * System's "Accept?". `role`: Player or GM. `invite`: join the room of the invite link with a name. `player`: name the
 * hunter, a job, a room code. `gm`: the starter campaign or a blank one. `hunterCreated`: the player's confirmation and
 * next steps. `campaignReady`: the GM's confirmation, what a room is, and the offer to create one.
 */
export type OnboardStep = (typeof ONBOARD_STEPS)[number];

/** Why the invite's or the player's room check found no room to join: no answer, or no such room. */
export type OnboardingMiss = Extract<TapKind, 'net' | 'notfound'>;
/**
 * The invite's Join. `fresh`: not tapped. `checking`: its first check of the room is out. `failed`: the last check
 * found no room (`why`); the button reads Try again and other options reads Continue without a room. `retrying`: a check
 * after a failure is out (`why`: the failure before it, which a refused write goes back to).
 */
export type OnboardingJoin =
  | { readonly is: 'fresh' }
  | { readonly is: 'checking' }
  | { readonly is: 'failed'; readonly why: OnboardingMiss }
  | { readonly is: 'retrying'; readonly why: OnboardingMiss };
/** Name your hunter's Begin: `ready`, or `checking` the typed room code before it begins. */
export type OnboardingBegin = 'ready' | 'checking';
/** Campaign ready's Create room. `idle`: not tapped (or not offered). `creating`: the create is out. `failed`: it failed (`why`). */
export type OnboardingCreate =
  | { readonly is: 'idle' }
  | { readonly is: 'creating' }
  | { readonly is: 'failed'; readonly why: TapKind };

/** The window. `B`: what had the focus as the ? guide opened, given back as it closes; the core only carries it. */
export type OnboardingAt<B> =
  | { readonly at: 'shut' | 'welcome' | 'role' | 'gm' | 'hunterCreated' }
  | { readonly at: 'quickstart'; readonly back: B }
  | { readonly at: 'invite'; readonly join: OnboardingJoin }
  | { readonly at: 'player'; readonly begin: OnboardingBegin }
  | { readonly at: 'campaignReady'; readonly create: OnboardingCreate };

/**
 * `start`: the app is ready and the save is not onboarded. `help`: the ? button. `gotIt`: the ? guide's Got it, Skip or
 * Escape. `accept`: Yes (or the fourth No). `player`, `gm`: the role. `back`: Back. `skip`: Skip, or Escape on a setup
 * step. `more`: the invite's other options (or Continue without a room, or Escape). `try`: a Join or a Begin with a room
 * code checks the room. `missed`: that check found no room. `joined`: the invite's room is there. `begun`: the player's
 * Begin (with no code, or the code's room there). `refused`: the save refused the write of the tap just made. `starter`,
 * `blank`: the GM's campaign. `sheet`: Open my sheet (or Escape). `join`: Hunter created's Join a room. `create`: Create
 * room. `created`, `createFailed`: its answer. `later`: Campaign ready's Later or Continue (or Escape).
 */
export type OnboardingEvent<B> =
  | { readonly type: 'start'; readonly invited: boolean }
  | { readonly type: 'help'; readonly back: B }
  | { readonly type: 'missed'; readonly why: OnboardingMiss }
  | { readonly type: 'createFailed'; readonly why: TapKind }
  | { readonly type: 'gotIt' | 'accept' | 'player' | 'gm' | 'back' | 'skip' | 'more' | 'try' | 'joined' | 'begun' | 'refused' | 'starter' | 'blank' | 'sheet' | 'join' | 'create' | 'created' | 'later' };
type Type = OnboardingEvent<unknown>['type'];
export const ONBOARD_EVENTS = ['start', 'help', 'gotIt', 'accept', 'player', 'gm', 'back', 'skip', 'more', 'try', 'missed', 'joined', 'begun', 'refused', 'starter', 'blank', 'sheet', 'join', 'create', 'created', 'createFailed', 'later'] as const satisfies readonly Type[];

/** `dropInvite`: forget the invite link's room. `cancelCreate`: stop the create under way. `focus`: give the focus back to `back`. */
export type OnboardingFx<B> = { readonly type: 'dropInvite' } | { readonly type: 'cancelCreate' } | { readonly type: 'focus'; readonly back: B };
/** A transition: the next state, whether its write marks the save onboarded, and what the view carries out. */
export type Onboarded<B> = { readonly to: OnboardingAt<B>; readonly marks: boolean; readonly fx: readonly OnboardingFx<B>[] };

type Move = { readonly to: OnboardingAt<unknown>; readonly fx: readonly OnboardingFx<unknown>[] };
type Cell<S extends OnboardStep, E extends Type> =
  ((s: Extract<OnboardingAt<unknown>, { at: S }>, e: Extract<OnboardingEvent<unknown>, { type: E }>) => Move | null) | null;
type Table = { readonly [S in OnboardStep]: { readonly [E in Type]: Cell<S, E> } };

const NONE = { start: null, help: null, gotIt: null, accept: null, player: null, gm: null, back: null, skip: null, more: null, try: null, missed: null, joined: null, begun: null, refused: null, starter: null, blank: null, sheet: null, join: null, create: null, created: null, createFailed: null, later: null } as const;
const to = (s: OnboardingAt<unknown>, ...fx: OnboardingFx<unknown>[]): Move => ({ to: s, fx });
const SHUT = to({ at: 'shut' }), WELCOME = to({ at: 'welcome' }), ROLE = to({ at: 'role' }), HUNTER_CREATED = to({ at: 'hunterCreated' });
const invite = (join: OnboardingJoin): Move => to({ at: 'invite', join });
const player = (begin: OnboardingBegin): Move => to({ at: 'player', begin });
const campaign = (create: OnboardingCreate): Move => to({ at: 'campaignReady', create });
const tried = (j: OnboardingJoin): j is Extract<OnboardingJoin, { why: OnboardingMiss }> => j.is === 'failed' || j.is === 'retrying';
const out = (j: OnboardingJoin): boolean => j.is === 'checking' || j.is === 'retrying';

/** What each event does in each state; null where it does not apply (a stale tap, a second tap while one is out, a late answer). The typecheck asks for every cell. */
const TABLE: Table = {
  shut: { ...NONE, start: (_, e) => (e.invited ? invite({ is: 'fresh' }) : WELCOME), help: (_, e) => to({ at: 'quickstart', back: e.back }) },
  quickstart: { ...NONE, gotIt: s => to({ at: 'shut' }, { type: 'focus', back: s.back }) },
  welcome: { ...NONE, accept: () => ROLE, skip: () => SHUT },
  role: { ...NONE, player: () => player('ready'), gm: () => to({ at: 'gm' }), skip: () => SHUT },
  invite: {
    ...NONE,
    // after a failure the button reads Continue without a room: the invite is dropped, so nothing offers it again
    more: s => (tried(s.join) ? to({ at: 'welcome' }, { type: 'dropInvite' }) : WELCOME),
    try: s => (s.join.is === 'fresh' ? invite({ is: 'checking' }) : s.join.is === 'failed' ? invite({ is: 'retrying', why: s.join.why }) : null),
    missed: (s, e) => (out(s.join) ? invite({ is: 'failed', why: e.why }) : null),
    joined: s => (out(s.join) ? HUNTER_CREATED : null),
    refused: s => (s.join.is === 'checking' ? invite({ is: 'fresh' }) : s.join.is === 'retrying' ? invite({ is: 'failed', why: s.join.why }) : null),
  },
  player: {
    ...NONE, back: () => ROLE, skip: () => SHUT, begun: () => HUNTER_CREATED,
    try: s => (s.begin === 'ready' ? player('checking') : null),
    missed: s => (s.begin === 'checking' ? player('ready') : null),
    refused: s => (s.begin === 'checking' ? player('ready') : null),
  },
  gm: { ...NONE, back: () => ROLE, starter: () => campaign({ is: 'idle' }), blank: () => campaign({ is: 'idle' }), skip: () => SHUT },
  hunterCreated: { ...NONE, sheet: () => SHUT, join: () => SHUT },
  campaignReady: {
    ...NONE,
    create: s => (s.create.is === 'creating' ? null : campaign({ is: 'creating' })),
    created: s => (s.create.is === 'creating' ? SHUT : null),
    createFailed: (s, e) => (s.create.is === 'creating' ? campaign({ is: 'failed', why: e.why }) : null),
    later: s => (s.create.is === 'creating' ? to({ at: 'shut' }, { type: 'cancelCreate' }) : SHUT),
  },
};

/** The steps of setup: leaving them marks the save onboarded. */
const SETUP: ReadonlySet<OnboardStep> = new Set(['welcome', 'role', 'invite', 'player', 'gm']);

/** The transition `e` makes from `s`, or null when it does not apply there. */
export function onboardStep<B>(s: OnboardingAt<B>, e: OnboardingEvent<B>): Onboarded<B> | null {
  // The table's type pairs each state with its own cells and each cell with its own event, so the cell for `s.at` and
  // `e.type` takes them. The cells only carry `B`, so the table for `unknown` is the table for every `B`.
  const cell = (TABLE[s.at] as { readonly [E in Type]: ((s: OnboardingAt<B>, e: OnboardingEvent<B>) => Move | null) | null })[e.type];
  const m = cell === null ? null : cell(s, e);
  if (m === null) return null;
  return { to: m.to as OnboardingAt<B>, marks: SETUP.has(s.at) && !SETUP.has(m.to.at), fx: m.fx as readonly OnboardingFx<B>[] };
}

/** What the invite's Join shows: busy while a check is out; Try again and Continue without a room once one failed; the last failure's kind while it shows. */
export const joinShows = (j: OnboardingJoin): { busy: boolean; tried: boolean; why: OnboardingMiss | null } =>
  ({ busy: out(j), tried: tried(j), why: j.is === 'failed' ? j.why : null });
/** What Create room shows: busy while the create is out; why it failed while that shows. */
export const createShows = (c: OnboardingCreate): { busy: boolean; why: TapKind | null } =>
  ({ busy: c.is === 'creating', why: c.is === 'failed' ? c.why : null });

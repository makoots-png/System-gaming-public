// onboarding.ts: the steps of first-run setup, one table (docs/state-machines.md, "First-run setup"). A new install
// opens on `welcome`, or on `invite` when it was opened from a room's invite link and a room server is there. Each
// window of src/views/onboard.js is a state; each button is an event. Setup ends on a first step of its own: Hunter
// created for a player (`hunterCreated`), Campaign ready for a GM (`campaignReady`), each with the role's next steps
// (src/core/first-run.ts). The save is marked onboarded (settings.ts `onboarded`) on the one transition that leaves the
// setup steps, in the same write as what that choice changes (the seed hunter made the player's own, the starter
// campaign): a reload before it starts over, a reload after it (on the confirmation too) does not.
// Pure: the view draws the state, sends the events and carries out the writes.

export const ONBOARD_STEPS = ['welcome', 'role', 'invite', 'player', 'gm', 'hunterCreated', 'campaignReady', 'done'] as const;
/**
 * `welcome`: the System's "Accept?". `role`: Player or GM. `invite`: join the room of the invite link with a name.
 * `player`: name the hunter, a job, a room code. `gm`: the starter campaign or a blank one. `hunterCreated`: the
 * player's confirmation and next steps. `campaignReady`: the GM's confirmation, what a room is, and the offer to create
 * one. `done`: no window.
 */
export type OnboardStep = (typeof ONBOARD_STEPS)[number];
export const ONBOARD_EVENTS = ['accept', 'player', 'gm', 'back', 'skip', 'more', 'joined', 'begun', 'starter', 'blank', 'sheet', 'join', 'later', 'created'] as const;
/**
 * `accept`: Yes (or the fourth No). `player`, `gm`: the role. `back`: Back. `skip`: Skip, or Escape on a setup step.
 * `more`: "other options" on the invite. `joined`: the invite's Join found the room. `begun`: the player's Begin.
 * `starter`, `blank`: the GM's campaign. `sheet`: Hunter created's Open my sheet (or Escape). `join`: its Join a room.
 * `later`: Campaign ready's Later or Continue (or Escape). `created`: its Create room made the room.
 */
export type OnboardEvent = (typeof ONBOARD_EVENTS)[number];

const NONE = { accept: null, player: null, gm: null, back: null, skip: null, more: null, joined: null, begun: null, starter: null, blank: null, sheet: null, join: null, later: null, created: null } as const;

/** Each step's answer to each event: the next step, or null where the event does not apply. The typecheck asks for every cell. */
export const TABLE: { readonly [S in OnboardStep]: { readonly [E in OnboardEvent]: OnboardStep | null } } = {
  welcome: { ...NONE, accept: 'role', skip: 'done' },
  role: { ...NONE, player: 'player', gm: 'gm', skip: 'done' },
  invite: { ...NONE, more: 'welcome', joined: 'hunterCreated' },
  player: { ...NONE, back: 'role', begun: 'hunterCreated', skip: 'done' },
  gm: { ...NONE, back: 'role', starter: 'campaignReady', blank: 'campaignReady', skip: 'done' },
  hunterCreated: { ...NONE, sheet: 'done', join: 'done' },
  campaignReady: { ...NONE, later: 'done', created: 'done' },
  done: NONE,
};

/** The steps after setup: reaching one from a setup step marks the save onboarded. */
const AFTER: ReadonlySet<OnboardStep> = new Set(['hunterCreated', 'campaignReady', 'done']);

/** Where first-run setup opens: the invite when the app was opened from a room's invite link and a room server is there. */
export const firstStep = (o: { invited: boolean }): OnboardStep => (o.invited ? 'invite' : 'welcome');

/** A transition: the next step, and whether this write marks the save onboarded. */
export type Onboarded = { to: OnboardStep; marks: boolean };
/** The step `event` leads to from `at`, or null when it does not apply there (a stale tap, a second Join). */
export function onboardStep(at: OnboardStep, event: OnboardEvent): Onboarded | null {
  const to = TABLE[at][event];
  return to === null ? null : { to, marks: AFTER.has(to) && !AFTER.has(at) };
}

// The chart of first-run setup (src/core/onboarding.ts), walked with every event (tests/models/onboarding-events.ts).
import { ONBOARD_STEPS, onboardStep } from '../../src/core/onboarding.ts';
import type { OnboardEvent, OnboardStep } from '../../src/core/onboarding.ts';
import { STARTS, WALK_EVENTS } from '../../tests/models/onboarding-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** Each step's window, by its title. */
const LABEL: { readonly [S in OnboardStep]: string } = {
  welcome: 'Welcome (Accept?)', role: 'Who are you?', invite: 'Join a room (invite link)', player: 'Name your hunter',
  gm: 'Run the game (starter or blank)', hunterCreated: 'Hunter created (next steps, onboarded)',
  campaignReady: 'Campaign ready (next steps, onboarded)', done: 'Setup over (onboarded)',
};

const WORDS: { readonly [E in OnboardEvent]: string } = {
  accept: 'Yes', player: 'I\'m a Player', gm: 'I\'m the GM', back: 'Back', skip: 'Skip or Escape', more: 'other options',
  joined: 'Join (the room is there)', begun: 'Begin', starter: 'Load starter campaign', blank: 'Blank',
  sheet: 'Open my sheet or Escape', join: 'Join a room', later: 'Later, Continue or Escape', created: 'Create room',
};

export const onboarding = machine<OnboardStep, OnboardEvent>({
  name: 'First-run setup',
  walked: `Every step reachable from Welcome and from an invite link under the ${WALK_EVENTS.length} events of tests/models/onboarding-events.ts, breadth first.`,
  walk: () => bfs(STARTS, s => WALK_EVENTS.flatMap(event => { const t = onboardStep(s, event); return t ? [{ event, to: t.to }] : []; }), s => s),
  kinds: ONBOARD_STEPS,
  kindsOf: s => [s],
  views: [{
    title: 'First-run setup, from a new install to the app',
    note: 'An arrow marked "(marks)" writes the onboarded mark in the same write as the choice it makes (the seed hunter made the player\'s own, the starter campaign); a reload before it starts setup over, a reload after it does not. Hunter created and Campaign ready list the role\'s next steps (src/core/first-run.ts); Campaign ready offers Create room only with a room server and no invite pending, else its one button is Continue. The quick start (the ? key) is a window of its own, not a step here.',
    hides: '',
    state: s => LABEL[s],
    step: (e, from) => { const t = onboardStep(from, e); return `${WORDS[e]}${t && t.marks ? ' (marks)' : ''}`; },
  }],
  where: [
    ['The steps and events', '`OnboardStep`, `OnboardEvent` and `TABLE` in `src/core/onboarding.ts`'],
    ['What changes it', '`onboardStep(at, event)`; `firstStep` for where it opens'],
    ['Who calls it', '`go` in `src/views/onboard.js`, started by the app\'s `ready` event'],
    ['The test to copy', '`tests/onboarding.test.ts`; the walk\'s events are in `tests/models/onboarding-events.ts`'],
    ['The recipe', 'AGENTS.md, "A state or event of the ... machine"'],
  ],
});

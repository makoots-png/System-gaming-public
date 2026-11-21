// The chart of the first-run window (src/core/onboarding.ts), walked with every event (tests/models/onboarding-events.ts).
import { ONBOARD_STEPS, onboardStep } from '../../src/core/onboarding.ts';
import type { OnboardingAt, OnboardingEvent } from '../../src/core/onboarding.ts';
import { STARTS, WALK_EVENTS } from '../../tests/models/onboarding-events.ts';
import { bfs, machine } from '../statecharts.ts';

type At = OnboardingAt<string>;
type Ev = OnboardingEvent<string>;

/** Each window by its title, and inside it what its tap has under way. A failure of either kind looks the same but for its words. */
function label(s: At): string | readonly string[] {
  switch (s.at) {
    case 'shut': return 'No window';
    case 'quickstart': return 'How it works (the ? guide)';
    case 'welcome': return 'Welcome (Accept?)';
    case 'role': return 'Who are you?';
    case 'invite': return ['Join a room (invite link)', { fresh: 'Join', checking: 'Checking the room', failed: 'No room: Try again', retrying: 'Checking again' }[s.join.is]];
    case 'player': return ['Name your hunter', s.begin === 'ready' ? 'Begin' : 'Checking the room code'];
    case 'gm': return 'Run the game (starter or blank)';
    case 'hunterCreated': return 'Hunter created (next steps, onboarded)';
    case 'campaignReady': return ['Campaign ready (next steps, onboarded)', { idle: 'Create room or Later', creating: 'Creating the room', failed: 'Create failed: why, try again' }[s.create.is]];
  }
}

function words(e: Ev, from: At): string {
  const failedOnce = from.at === 'invite' && (from.join.is === 'failed' || from.join.is === 'retrying');
  switch (e.type) {
    case 'start': return e.invited ? 'the app opens from an invite link' : 'the app opens, not onboarded';
    case 'help': return 'the ? button';
    case 'gotIt': return 'Got it, Skip or Escape';
    case 'accept': return 'Yes';
    case 'player': return 'I\'m a Player';
    case 'gm': return 'I\'m the GM';
    case 'back': return 'Back';
    case 'skip': return 'Skip or Escape';
    case 'more': return failedOnce ? 'Continue without a room or Escape (drops the invite)' : 'other options or Escape';
    case 'try': return from.at === 'invite' ? 'Join' : 'Begin with a room code';
    case 'missed': return 'no room, or no answer';
    case 'joined': return 'the room is there';
    case 'begun': return from.at === 'player' && from.begin === 'checking' ? 'the room is there' : 'Begin';
    case 'refused': return 'the save refuses the write';
    case 'starter': return 'Load starter campaign';
    case 'blank': return 'Blank';
    case 'sheet': return 'Open my sheet or Escape';
    case 'join': return 'Join a room';
    case 'create': return 'Create room';
    case 'created': return 'the room is made';
    case 'createFailed': return 'the create fails';
    case 'later': return from.at === 'campaignReady' && from.create.is === 'creating' ? 'Later or Escape (cancels the create)' : 'Later, Continue or Escape';
  }
}

export const onboarding = machine<At, Ev>({
  name: 'First-run setup',
  walked: `Every state reachable from no window under the ${WALK_EVENTS.length} events of tests/models/onboarding-events.ts, breadth first.`,
  walk: () => bfs(STARTS, s => WALK_EVENTS.flatMap(event => { const t = onboardStep(s, event); return t ? [{ event, to: t.to }] : []; }), s => JSON.stringify(s)),
  kinds: ONBOARD_STEPS,
  kindsOf: s => [s.at],
  views: [{
    title: 'The first-run window, from a new install to the app, and the ? guide',
    note: 'An arrow marked "(marks)" writes the onboarded mark in the same write as the choice it makes (the seed hunter made the player\'s own, the starter campaign); a reload before it starts setup over, a reload after it does not. A write the save refuses (a tab that cannot save) keeps the step: Skip and Begin stay where they were, and a Join under way goes back to how it was before the tap. A second tap while a check or a create is out, and an answer that comes after its window went, change nothing. Hunter created and Campaign ready list the role\'s next steps (src/core/first-run.ts); Campaign ready offers Create room only with a room server and no invite pending, else its one button is Continue. Why a check or a create failed (no answer, no such room) is in the words, not in the chart.',
    hides: '',
    state: label,
    step: (e, from) => { const t = onboardStep(from, e); return `${words(e, from)}${t && t.marks ? ' (marks)' : ''}`; },
  }],
  where: [
    ['The states and events', '`OnboardingAt`, `OnboardingEvent` and `TABLE` in `src/core/onboarding.ts`; the sub-states `OnboardingJoin`, `OnboardingBegin`, `OnboardingCreate`'],
    ['What changes it', '`onboardStep(at, event)`; `joinShows` and `createShows` for what a tap under way shows'],
    ['Who calls it', '`go` in `src/views/onboard.js`, started by the app\'s `ready` event and the ? button'],
    ['The test to copy', '`tests/onboarding.test.ts`; the walk\'s events are in `tests/models/onboarding-events.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});

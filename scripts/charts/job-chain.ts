// The chart of a hunter's Job Change chain (src/core/hunter/job-chain.ts), walked with the moves of the walk in
// tests/job-chain.test.ts.
import type { ChainEvent, ChainStatus } from '../../src/core/hunter/job-chain.ts';
import { BUILT_IN_JOBS, CHAIN_LEVEL } from '../../src/core/registry/jobs.ts';
import { WALK_MOVES, play } from '../../tests/models/job-chain-events.ts';
import type { ChainHunter } from '../../tests/models/job-chain-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** A hunter has no chain, or one that is running or failed. */
type ChainKind = 'none' | ChainStatus;
/** The words of the Quests tab: the step quest's card while it runs, the failed chain's card when it fails. */
const LABEL: { readonly [K in ChainKind]: string } = { none: 'No Job Change', active: 'Job Change running', failed: 'Job Change failed' };
const KINDS = Object.keys(LABEL) as ChainKind[];
const kindOf = (s: ChainHunter): ChainKind => s.chain?.status ?? 'none';

/** The walk's chain is a Fighter's; every job has the same three steps today. */
const STEPS = BUILT_IN_JOBS.Fighter.steps;

function state(s: ChainHunter): string | readonly string[] {
  const c = s.chain;
  if (!c) return LABEL.none;
  return c.status === 'active' ? [LABEL.active, STEPS[c.step - 1]!.title] : [LABEL.failed, `at step ${c.step} of 3`];
}

function step(e: ChainEvent, from: ChainHunter, to: ChainHunter): string {
  switch (e.type) {
    case 'issued': return 'the GM issues a Job Change';
    case 'stepCompleted':
      if (!to.chain) return 'step 3 is completed, and the hunter takes the job';
      return from.chain?.step === 1 ? `the hunter reaches level ${CHAIN_LEVEL}, and step 1 completes` : 'the step\'s quest is completed';
    case 'stepFailed': return 'the step\'s quest fails or is deleted';
    case 'reissued': return 'the GM taps Reissue';
    case 'abandoned': return 'the GM taps Abandon';
    case 'levelChanged': throw new Error(`a level change moved a chain from ${kindOf(from)} to ${kindOf(to)}, which the chart has no label for`);
  }
}

/** The ids are left out of the key: a step reads only the chain's job, step and status, its quest's status and the level. */
const key = (s: ChainHunter): string =>
  JSON.stringify({ chain: s.chain && { job: s.chain.job, step: s.chain.step, status: s.chain.status, quest: s.quests.get(s.chain.questId) ?? 'gone' }, level: s.level });

export const jobChain = machine<ChainHunter, ChainEvent>({
  name: 'A Job Change chain',
  walked: `Every chain reachable from a level 1 hunter with no chain under the ${WALK_MOVES.length} moves of the walk in tests/job-chain.test.ts (tests/models/job-chain-events.ts), breadth first, with the ids left out of what makes two states the same.`,
  walk: () => bfs<ChainHunter, ChainEvent>(
    [{ chain: null, quests: new Map(), level: 1, n: 1 }],
    s => WALK_MOVES.map(move => { const { event, next } = play(s, move); return { event, to: next }; }),
    key,
  ),
  kinds: KINDS,
  kindsOf: s => [kindOf(s)],
  views: [{
    title: 'A Job Change, from issued to the new job',
    note: 'The chart shows the Quests tab: the card of the open step\'s quest while the chain runs, and the failed chain\'s card when a step fails. A level change moves step 1\'s progress and, at level 10, completes its quest, which is the arrow from step 1 to step 2; a hunter already at level 10 when the GM issues the chain goes through step 1 at once. A failed step goes to the failed card at that step, and Reissue restarts the chain there with a new quest; issuing a new Job Change instead starts again at step 1. Only the GM issues, reissues and abandons; a player\'s Reissue or Abandon is refused, and so is a second chain while one runs. Completing step 1 by hand below level 10 is refused. The chart leaves out the job (every job has the same three steps today) and the hunter\'s level.',
    hides: '',
    state,
    step,
  }],
  where: [
    ['The state', '`JobChain` (`id`, `job`, `step`, `status`, `questId`) or none, in `src/core/hunter/job-chain.ts`; each job\'s steps in `src/core/registry/jobs.ts`'],
    ['What changes it', '`chainAfter(chain, event)` and its `TABLE`; `canReissue(chain)` for the failed card\'s buttons'],
    ['Who calls it', '`chainStep` and `chainEvent` in `src/views/quests.js` (issue, Complete, Fail, Delete, Reissue, Abandon, and the `level` event `src/views/hunter.js` sends)'],
    ['The test to copy', '`tests/job-chain.test.ts`; the walk\'s moves are in `tests/models/job-chain-events.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "To add a job"'],
  ],
});

// The chart of a feat on a hunter (src/core/hunter/feats.ts `featStep`, feature 1's notes 5.5), walked with the events
// of tests/models/feat-events.ts for a feat that earns at 2, under each rule of when it is shown.
import { FEAT_STATES, featStep, startOf } from '../../src/core/hunter/feats.ts';
import type { FeatDef, FeatEvent, FeatState, Show } from '../../src/core/hunter/feats.ts';
import { newRewards } from '../../src/core/rewards.ts';
import { parseDayKey } from '../../src/core/day.ts';
import { FEAT_WALK } from '../../tests/models/feat-events.ts';
import { bfs, machine } from '../statecharts.ts';

const SHOWS: readonly Show[] = [{ at: 'start' }, { at: 'count', n: 1 }, { at: 'feat', key: 'early-riser' as never }, { at: 'never' }];
const defOf = (show: Show): FeatDef => ({ name: 'A feat', window: 'A FEAT', desc: '', show, rule: { on: 'kill', where: [], measure: { of: 'facts' }, within: 'row', reach: 2, also: [] }, rewards: newRewards() });
type S = { readonly show: Show; readonly f: FeatState };
const NOW = { at: '2026-11-18T10:00:00.000Z', day: parseDayKey('2026-11-18')! };
const SHOW_WORDS = (s: Show): string => (s.at === 'start' ? 'Shown from the start' : s.at === 'count' ? 'Shown at a count of 1' : s.at === 'feat' ? 'Shown after another feat' : 'Hidden until earned');

function step(e: FeatEvent): string {
  switch (e.type) {
    case 'counted': return `a fact counts it to ${e.count.n}${e.also ? '' : ', its state tests failing'}`;
    case 'broke': return 'a fact breaks its row';
    case 'unlocked': return 'the feat it waits on is earned';
  }
}

export const feat = machine<S, FeatEvent>({
  name: 'A feat on a hunter',
  walked: `Every state reachable from each feat's start, for a feat earned at a count of 2 under each of its 4 rules of when it is shown, under the ${FEAT_WALK.length} events of tests/models/feat-events.ts, breadth first.`,
  walk: () => bfs(SHOWS.map(show => ({ show, f: startOf(defOf(show)) })), s => FEAT_WALK.flatMap(event => { const r = featStep(s.f, event, defOf(s.show), NOW); return r ? [{ event, to: { show: s.show, f: r.state } }] : []; }), s => JSON.stringify(s)),
  kinds: FEAT_STATES,
  kindsOf: s => [s.f.at],
  views: [{
    title: 'A feat, earned at 2, by when it is shown',
    note: 'The notice step (src/core/hunter/noticed.ts) moves a feat by each fact its count takes. Earned is final: nothing moves it, so a feat is earned once and the notice loop ends. A hidden feat is shown by its count or by another feat earned; one hidden until earned is never shown before. A count in a row starts again at 0 when a fact of its kind fails its tests.',
    hides: '',
    state: s => [SHOW_WORDS(s.show), s.f.at === 'earned' ? 'Earned' : `${s.f.at === 'shown' ? 'Shown' : 'Hidden'}, ${s.f.n} of 2`],
    step,
  }],
  where: [
    ['The union', '`FeatState` in `src/core/hunter/chronicle.ts`, `FeatEvent`, `FEAT_STATES` in `src/core/hunter/feats.ts`'],
    ['What changes it', '`featStep(state, event, def, now)` and its `TABLE`; a count moves by `countStep` (`src/core/hunter/counts.ts`)'],
    ['Who calls it', '`noticed` in `src/core/hunter/noticed.ts`, at the end of every `store.apply`'],
    ['The test to copy', '`tests/feats.test.ts`; the walk\'s events are in `tests/models/feat-events.ts`'],
    ['The recipe', 'docs/guide/feats-stories.md, "A built-in feat"'],
  ],
});

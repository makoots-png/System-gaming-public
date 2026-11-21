// The chart of a feat on a hunter (src/core/hunter/feats.ts `featStep`, feature 1's notes 5.5), walked with the events
// of tests/models/feat-events.ts for a feat that earns at 2, under each rule of when it is shown.
import { FEAT_STATES, featStep, startOf } from '../../src/core/hunter/feats.ts';
import type { FeatDef, FeatEvent, FeatState, Show } from '../../src/core/hunter/feats.ts';
import { newRewards } from '../../src/core/rewards.ts';
import { parseDayKey } from '../../src/core/day.ts';
import { FEAT_WALK, INBOX_WALK } from '../../tests/models/feat-events.ts';
import type { InboxWrite } from '../../tests/models/feat-events.ts';
import { INBOX_STATES, noticed } from '../../src/core/hunter/noticed.ts';
import type { InboxState } from '../../src/core/hunter/noticed.ts';
import { record } from '../../src/core/hunter/chronicle.ts';
import { RULES } from '../../src/core/rules.ts';
import { freshSave, newHunter } from '../../src/core/save.ts';
import type { Save } from '../../src/core/save.ts';
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
    case 'again': return `a fact leaves its count at ${e.count.n}${e.also ? ', its state tests now holding' : ''}`;
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
    note: 'The notice step (src/core/hunter/noticed.ts) moves a feat by each fact its count takes. Earned is final: nothing moves it, so a feat is earned once and the notice loop ends. A hidden feat is shown by its count or by another feat earned; one hidden until earned is never shown before. A count in a row starts again at 0, with no values seen, when a fact of its kind fails its tests. Two rows wait on a ruling and are drawn as the app behaves today: a fact that leaves a full count as it was moves nothing, even when its state tests now hold (SMX-gates-6.1, `AGAIN`), and the feat it waits on earned shows a feat hidden until earned (SMX-gates-6.2, `UNLOCKED_TO`; the notice step sends that event only to a feat shown after another).',
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

// The chart of a hunter's inbox between two writes (src/core/hunter/noticed.ts `INBOX`), walked with the real notice
// step on a save of one hunter under the writes of tests/models/feat-events.ts.
const INBOX_NOW = { at: NOW.at, today: NOW.day, session: 4, R: RULES, feats: [] };
const inboxStart = (): Save => {
  const s = freshSave({ now: new Date(NOW.at), newDeviceToken: () => 'chart-device-token-0123456789abcd', newDeviceId: () => 'd-chart' as never }, { onboarded: true });
  return { ...s, hunters: [{ ...newHunter(RULES), id: 'h1' as never, name: 'Mira' }] };
};
const inboxOf = (s: Save): InboxState => (s.hunters[0]!.chronicle.inbox.length ? 'waiting' : 'empty');
const INBOX_WORDS: { readonly [S in InboxState]: string } = { empty: 'Empty', waiting: 'Facts waiting, each stamped by the write it happened in' };
export const inbox = machine<Save, InboxWrite>({
  name: 'A hunter\'s inbox of facts',
  walked: `Every inbox reachable from a hunter with none, under the ${INBOX_WALK.length} writes of tests/models/feat-events.ts (a fact recorded or not, a fight holding the hunter or not), two writes deep, breadth first.`,
  walk: () => bfs([inboxStart()], s => INBOX_WALK.map(event => ({ event, to: noticed(event.records ? { ...s, hunters: s.hunters.map(h => record(h, { kind: 'roll', natural: 20 })) } : s, () => ({ ...INBOX_NOW, held: () => event.held })) })), s => JSON.stringify(s.hunters[0]!.chronicle.inbox), 2),
  kinds: INBOX_STATES,
  kindsOf: s => [inboxOf(s)],
  views: [{
    title: 'A hunter\'s inbox, between two writes',
    note: 'A fact is recorded in the write of the thing it tells and moved at that write\'s end. A fight holding the hunter keeps it waiting, stamped with that write\'s moment; a write in which no fight holds the hunter takes every fact, oldest first. A waiting fact is taken with the stamp of the write that frees it, as the app does today: whether it keeps its own day waits on the owner\'s ruling (SMX-rules-9.1), and that ruling is the cell `INBOX.waiting.free`.',
    hides: '',
    state: s => INBOX_WORDS[inboxOf(s)],
    step: e => `a write${e.records ? ' records a fact' : ''}${e.held ? ', a fight holding the hunter' : ', no fight holding the hunter'}`,
  }],
  where: [
    ['The union', '`InboxFact` in `src/core/hunter/chronicle.ts`; `InboxAt`, `InboxState`, `INBOX_STATES` in `src/core/hunter/noticed.ts`'],
    ['What changes it', '`record` (chronicle.ts) appends; `noticed` moves each fact by `INBOX` at the end of the write'],
    ['Who calls it', '`store.apply` in `src/edge/store.ts`, at the end of every write; sync.ts\'s release write (`released`)'],
    ['The test to copy', '`tests/chronicle.test.ts`, "a fact in a hunter\'s inbox"; the walk\'s writes are in `tests/models/feat-events.ts`'],
    ['The recipe', 'docs/guide/feats-stories.md, "A fact the System remembers"'],
  ],
});

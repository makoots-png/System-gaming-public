// A story on the table (src/core/story/run.ts): its machine cell by cell, the stale tap refused by the count of opens
// (ruling 1), who a chapter goes to, the one write of a move, the save's bounds, and the proof that nothing but the GM's
// tap moves a story (notes-1-stories.md 3.4, point 7).
import { describe, expect, test } from 'bun:test';
import { ENDED_KEPT, OPENED_MAX, RUNNING_MAX, keptRuns, nextChapter, parseStoryRun, runStep, storyMove, whoFor } from '../src/core/story/run.ts';
import type { MoveCtx, MoveRoom, RunEvent, StoryRun, Who } from '../src/core/story/run.ts';
import { CHAPTER_MAX, chapterSize } from '../src/core/story/story.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { Chapter, Story } from '../src/core/story/story.ts';
import { worstChapter } from './fixtures/worst-chapter.ts';
import type { SheetKey } from '../src/core/protocol.ts';
import { EXAMPLE_STORIES } from '../src/core/registry/stories.ts';
import { removeStory } from '../src/core/library.ts';
import { freshSave, newHunter, parseSaveValue } from '../src/core/save.ts';
import type { Hunter, ParseEnv, Save } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { newRewards } from '../src/core/rewards.ts';
import { TOLD, isRefused, refuse } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { dayKey } from '../src/core/day.ts';
import { seedId } from '../src/core/ids.ts';
import type { HunterRef, MonsterId } from '../src/core/ids.ts';
import { record } from '../src/core/hunter/chronicle.ts';
import { noticed } from '../src/core/hunter/noticed.ts';
import type { FeatDef, FeatKey } from '../src/core/hunter/feats.ts';
import { finishQuest } from '../src/core/hunter/grant.ts';
import { rollover } from '../src/core/hunter/quests.ts';
import { soloTick } from '../src/core/gates/solo.ts';
import { personalGateId } from '../src/core/gates/personal.ts';
import { advanceDay, sessionStarted } from '../src/core/gates/world.ts';
import { fightId, reduce } from '../src/core/combat/fight.ts';
import { fought } from '../src/core/combat/fight-save.ts';
import { hunterRow } from '../src/core/combat/rows.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import type { Command, NewRow } from '../src/core/combat/fight-types.ts';
import { appliedOnce } from '../src/core/applied.ts';
import { parseEvent, EVENT_TYPES } from '../src/core/protocol.ts';
import { applyRoomEvent } from '../src/edge/room-events.ts';
import type { ApplyDeps } from '../src/edge/room-events.ts';
import { EID, VALID } from './fixtures/payloads.ts';
import { STORY_WALK, WALK_STORY } from './models/story-events.ts';
import { day, dev, hid, qid, room, srid, stid } from './fixtures/ids.ts';

const sk = (s: string): SheetKey => s as SheetKey;

const AT = '2026-11-19T10:00:00.000Z', TODAY = dayKey(new Date(AT), 0), DAY = { at: AT, today: TODAY, R: RULES };
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm') };
const CTX: MoveCtx = { day: DAY, vitals: () => 'sheet', room: null };
const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
/** The wager (registry/stories.ts) in the library: chapter 2 takes 1 ability point, chapter 3 gives 5 and a title. */
const WAGER: Story = { ...EXAMPLE_STORIES[0]!.story, id: stid('st1') };
const R1 = srid('sr1');
const ref = (id: string): HunterRef => ({ kind: 'local', hunterId: hid(id) });
const MIRA = ref('h1'), BRAKK = ref('h2'), KAI = ref('h3'), GONE = ref('h9');
/** The GM alone with Mira (h1) and Brakk (h2), each with 5 ability points to spend, and the wager in the library. */
function gm(...more: Hunter[]): Save {
  const s = freshSave(ENV, { onboarded: true }), pts = newHunter(RULES).bonusPoints + 5;
  const hunters = [{ ...s.hunters[0]!, id: hid('h1'), name: 'Mira', bonusPoints: pts }, { ...newHunter(RULES), id: hid('h2'), name: 'Brakk', bonusPoints: pts }, ...more];
  return { ...s, hunters, library: { ...s.library, stories: [WAGER] } };
}
const turnOn = (who: Who, to: HunterRef[], id = R1): RunEvent => ({ type: 'turnOn', id, story: WAGER.id, who, to, at: AT, session: 3 });
const open = (chapter: number, seen: number, to: HunterRef[]): RunEvent => ({ type: 'open', chapter, seen, to, at: AT, session: 4 });
const end = (seen: number): RunEvent => ({ type: 'end', seen, at: AT, session: 5 });
const FOR_BRAKK: Who = { at: 'hunters', refs: [BRAKK] };
/** A run of the wager for Brakk, at chapter 1 with one open. */
const onFor = (who: Who = FOR_BRAKK, to: HunterRef[] = [BRAKK]): StoryRun => ok(runStep(null, turnOn(who, to), WAGER)).run;
const points = (s: Save, id: string) => s.hunters.find(h => h.id === id)!.bonusPoints;

describe('the machine, cell by cell', () => {
  test('no run: turning on opens chapter 1 for the hunters given, with one open counted; an open or an end has no run to move', () => {
    const r = ok(runStep(null, turnOn(FOR_BRAKK, [BRAKK]), WAGER));
    expect(r.run).toEqual({ id: R1, story: WAGER.id, name: 'The wager', who: FOR_BRAKK, state: { at: 'running', chapter: 0 }, opens: 1, opened: [{ chapter: 0, to: [BRAKK], at: AT, session: 3 }] });
    expect(r.fx).toEqual({ type: 'deliver', chapter: 0, to: [BRAKK] });
    expect(runStep(null, turnOn(FOR_BRAKK, []), WAGER)).toEqual({ ok: false, why: 'nobody' });
    expect(runStep(null, turnOn(FOR_BRAKK, [BRAKK]), null)).toEqual({ ok: false, why: 'no-story' });
    expect(runStep(null, open(1, 1, [BRAKK]), WAGER)).toEqual({ ok: false, why: 'no-run' });
    expect(runStep(null, end(1), WAGER)).toEqual({ ok: false, why: 'no-run' });
  });

  test('running: an open moves the run to the chapter opened, the next, the same again or an earlier one, and counts it', () => {
    const at3 = ok(runStep(onFor(), open(2, 1, [BRAKK]), WAGER));
    expect([at3.run.state, at3.run.opens, at3.run.opened.at(-1), at3.fx]).toEqual([{ at: 'running', chapter: 2 }, 2, { chapter: 2, to: [BRAKK], at: AT, session: 4 }, { type: 'deliver', chapter: 2, to: [BRAKK] }]);
    const again = ok(runStep(at3.run, open(2, 2, [BRAKK]), WAGER));
    expect([again.run.state.chapter, again.run.opens, again.run.opened.length]).toEqual([2, 3, 3]);
    const back = ok(runStep(again.run, open(0, 3, [BRAKK]), WAGER));
    expect([back.run.state.chapter, back.run.opens]).toEqual([0, 4]);
  });

  test('running: an open drawn before the last one, of a chapter the story no longer has, for nobody or of a deleted story is refused; a second turn-on of the run is refused', () => {
    const run = onFor();
    expect(runStep(run, open(1, 0, [BRAKK]), WAGER)).toEqual({ ok: false, why: 'moved' });
    expect(runStep(run, open(4, 1, [BRAKK]), WAGER)).toEqual({ ok: false, why: 'no-chapter' });
    expect(runStep(run, open(-1, 1, [BRAKK]), WAGER)).toEqual({ ok: false, why: 'no-chapter' });
    expect(runStep(run, open(3, 1, [BRAKK]), { ...WAGER, chapters: WAGER.chapters.slice(0, 2) }), 'cut to two chapters in the Workshop').toEqual({ ok: false, why: 'no-chapter' });
    expect(runStep(run, open(1, 1, []), WAGER)).toEqual({ ok: false, why: 'nobody' });
    expect(runStep(run, open(1, 1, [BRAKK]), null)).toEqual({ ok: false, why: 'no-story' });
    expect(runStep(run, turnOn(FOR_BRAKK, [BRAKK]), WAGER)).toEqual({ ok: false, why: 'running' });
  });

  test('running: End ends the run at the chapter it is at; an End tapped before the last open is refused', () => {
    const at2 = ok(runStep(onFor(), open(1, 1, [BRAKK]), WAGER)).run;
    expect(ok(runStep(at2, end(2), WAGER))).toEqual({ run: { ...at2, state: { at: 'ended', chapter: 1, endedAt: AT, session: 5 } }, fx: null });
    expect(runStep(at2, end(1), WAGER)).toEqual({ ok: false, why: 'moved' });
  });

  test('ended: nothing moves it', () => {
    const ended = ok(runStep(onFor(), end(1), WAGER)).run;
    for (const e of [turnOn(FOR_BRAKK, [BRAKK]), open(1, 1, [BRAKK]), end(1)]) expect(runStep(ended, e, WAGER)).toEqual({ ok: false, why: 'ended' });
  });

  test('the next chapter is the one after the run\'s, and none at the last', () => {
    expect(nextChapter(onFor(), WAGER)).toBe(1);
    expect(nextChapter(ok(runStep(onFor(), open(3, 1, [BRAKK]), WAGER)).run, WAGER)).toBeNull();
  });
});

describe('a walk of the GM\'s taps (tests/models/story-events.ts, the chart\'s events)', () => {
  test('over 2,000 taps the count of opens grows by one at each open and never falls, and the opens kept stay within their bound', () => {
    let run: StoryRun | null = null, seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let i = 0; i < 2000; i++) {
      const e = STORY_WALK[rand(STORY_WALK.length)]!(run), r = runStep(run, e, WALK_STORY);
      if (isRefused(r)) continue;
      if (run) expect(r.run.opens).toBe(run.opens + (e.type === 'open' ? 1 : 0));
      expect(r.run.opened.length).toBeLessThanOrEqual(OPENED_MAX);
      run = r.run.state.at === 'ended' && rand(2) ? null : r.run;
    }
  });
});

describe('a stale tap writes nothing (ruling 1: the count of opens)', () => {
  test('the same open of the next chapter sent twice gives it once', () => {
    const s0 = ok(storyMove(gm(), R1, turnOn(FOR_BRAKK, [BRAKK]), CTX)).save;
    const first = ok(storyMove(s0, R1, open(1, 1, [BRAKK]), CTX));
    expect(storyMove(first.save, R1, open(1, 1, [BRAKK]), CTX)).toEqual({ ok: false, why: 'moved' });
    expect(points(first.save, 'h2')).toBe(points(s0, 'h2') - 1);
  });

  test('the same open of the chapter it is at sent twice gives it once; opened again on purpose, it is given again', () => {
    const s0 = ok(storyMove(ok(storyMove(gm(), R1, turnOn(FOR_BRAKK, [BRAKK]), CTX)).save, R1, open(1, 1, [BRAKK]), CTX)).save;
    const again = ok(storyMove(s0, R1, open(1, 2, [BRAKK]), CTX));
    expect(storyMove(again.save, R1, open(1, 2, [BRAKK]), CTX)).toEqual({ ok: false, why: 'moved' });
    expect([points(again.save, 'h2'), again.run.opens]).toEqual([points(s0, 'h2') - 1, 3]);
    expect(ok(storyMove(again.save, R1, open(1, 3, [BRAKK]), CTX)).run.opens).toBe(4);
  });

  test('an End held under Undo while the story is opened again does not end it', () => {
    const s0 = ok(storyMove(gm(), R1, turnOn(FOR_BRAKK, [BRAKK]), CTX)).save;
    const held = s0.storyRuns[0]!.opens, s1 = ok(storyMove(s0, R1, open(1, held, [BRAKK]), CTX)).save;
    expect(storyMove(s1, R1, end(held), CTX)).toEqual({ ok: false, why: 'moved' });
    expect(s1.storyRuns[0]!.state).toEqual({ at: 'running', chapter: 1 });
  });
});

describe('who a chapter goes to', () => {
  test('a late joiner is ticked alone for the chapter the table had; a chapter nobody had ticks everyone at the table', () => {
    const run = onFor({ at: 'table' }, [MIRA, BRAKK]);
    expect(whoFor(run, 0, [MIRA, BRAKK, KAI])).toEqual([KAI]);
    expect(whoFor(run, 1, [MIRA, BRAKK, KAI])).toEqual([MIRA, BRAKK, KAI]);
  });

  test('a chapter every one of them has had (the stake taken again) ticks all of them again', () => {
    expect(whoFor(onFor(), 0, [MIRA, BRAKK])).toEqual([BRAKK]);
  });

  test('a run for chosen hunters ticks only its hunters at the table, so one removed is not ticked', () => {
    const run = onFor({ at: 'hunters', refs: [BRAKK, GONE] }, [BRAKK]);
    expect(whoFor(run, 1, [MIRA, BRAKK])).toEqual([BRAKK]);
    expect(whoFor(run, 1, [MIRA])).toEqual([]);
  });

  test('a hunter ticked for a chosen run joins it, so the next chapters tick it too', () => {
    const run = ok(runStep(onFor(), open(1, 1, [BRAKK, MIRA]), WAGER)).run;
    expect(run.who).toEqual({ at: 'hunters', refs: [BRAKK, MIRA] });
    expect(whoFor(run, 2, [MIRA, BRAKK])).toEqual([MIRA, BRAKK]);
  });

  test('a hunter picked who is not at the table is skipped and said, the rest get it, and Opened holds who got it; with none left it is refused', () => {
    const m = ok(storyMove(gm(), R1, turnOn({ at: 'hunters', refs: [BRAKK, GONE] }, [BRAKK, GONE]), CTX));
    expect([m.skipped, m.granted.map(g => g.hid), m.run.opened[0]!.to]).toEqual([[GONE], ['h2'], [BRAKK]]);
    expect(storyMove(m.save, R1, open(1, 1, [GONE]), CTX)).toEqual({ ok: false, why: 'nobody' });
  });
});

describe('a move is one write', () => {
  test('turned on for Brakk: the run, chapter 1\'s fact on Brakk alone and one line of the log', () => {
    const m = ok(storyMove(gm(), R1, turnOn(FOR_BRAKK, [BRAKK]), CTX));
    expect(m.save.storyRuns).toEqual([m.run]);
    expect(m.save.hunters.map(h => h.chronicle.inbox)).toEqual([[], [{ kind: 'chapter', title: WAGER.chapters[0]!.words.title, line: WAGER.chapters[0]!.words.line }]]);
    expect(m.save.log[0]).toMatchObject({ kind: 'story', hunterId: null, title: 'The wager', text: 'Turned on for Brakk. Chapter 1 (The bet) opened for Brakk.' });
    expect(m.granted[0]!.g.window).toMatchObject({ tag: '! Story', title: WAGER.chapters[0]!.words.title, body: WAGER.chapters[0]!.words.line });
  });

  test('chapter 2 opened for Brakk takes the stake from Brakk alone and says so; End writes the run and its line and gives nothing', () => {
    const s0 = ok(storyMove(gm(), R1, turnOn(FOR_BRAKK, [BRAKK]), CTX)).save;
    const m = ok(storyMove(s0, R1, open(1, 1, [BRAKK]), CTX));
    expect([points(m.save, 'h1'), points(m.save, 'h2')]).toEqual([points(s0, 'h1'), points(s0, 'h2') - 1]);
    expect(m.granted[0]!.g.window.lines).toEqual(['Loses 1 ability point']);
    expect(m.save.log[0]).toMatchObject({ kind: 'story', title: 'The wager', text: 'Chapter 2 (The runs) opened for Brakk.' });
    const e = ok(storyMove(m.save, R1, end(2), CTX));
    expect([e.granted, e.save.hunters, e.save.log[0]!.text]).toEqual([[], m.save.hunters, 'Ended at chapter 2.']);
  });

  test('a turn-on with the most stories running is refused and writes nothing; an ended one past the kept is dropped, oldest first', () => {
    let s = gm();
    for (let i = 0; i < RUNNING_MAX; i++) s = ok(storyMove(s, srid(`sr${i + 1}`), turnOn({ at: 'table' }, [MIRA], srid(`sr${i + 1}`)), CTX)).save;
    expect(storyMove(s, srid('sr99'), turnOn({ at: 'table' }, [MIRA], srid('sr99')), CTX)).toEqual({ ok: false, why: 'full' });
    const ended = (n: number): StoryRun => ({ ...onFor(), id: srid(`sr${100 + n}`), state: { at: 'ended', chapter: 0, endedAt: AT, session: n } });
    const runs = [onFor(), ...Array.from({ length: ENDED_KEPT + 1 }, (_, n) => ended(n))];
    expect(keptRuns(runs).map(r => r.id)).toEqual([R1, ...runs.slice(2).map(r => r.id)]);
  });
});

describe('a move in the GM\'s room (unit 4)', () => {
  const KAI_KEY = sk('d-player1:h1'), LIN_KEY = sk('d-player2:h1');
  const KAI_P: HunterRef = { kind: 'remote', remote: KAI_KEY }, LIN_P: HunterRef = { kind: 'remote', remote: LIN_KEY };
  const ROOM: MoveRoom = { code: room('ABC234'), sheets: [{ key: KAI_KEY, data: { name: 'Kai', rank: 'B' } }, { key: LIN_KEY, data: { name: 'Lin', rank: 'E' } }], onRow: () => false, stamp: { device: 'd-gm', now: Date.parse(AT), rand: 0.25 } };
  const IN_ROOM: MoveCtx = { ...CTX, room: ROOM };
  /** The chapter messages in the outbox, in order. */
  const posted = (s: Save) => (s.settings.sync.outbox ?? []).flatMap(x => (x.letter.kind === 'event' && x.letter.event.type === 'chapter' ? [x.letter.event.payload] : []));
  /** The GM's save with the wager's chapter 1 swapped for `c`. */
  const withFirst = (c: Chapter): Save => { const s = gm(); return { ...s, library: { ...s.library, stories: [{ ...WAGER, chapters: [c, ...WAGER.chapters.slice(1)] }] } }; };

  test('a chapter opened for a player\'s hunter is posted once, in the move\'s write, with what the GM\'s own hunters get and the quest due from the open', () => {
    const quest: Chapter['quest'] = { kind: 'side', title: 'Find it', desc: '', objectives: [{ label: 'Find the foe', target: 1, progress: 0 }], rewards: newRewards(), onFail: newRewards(), dueHours: 48, penaltyText: '' };
    const c = { ...WAGER.chapters[0]!, quest }, e = turnOn({ at: 'hunters', refs: [KAI_P, MIRA] }, [KAI_P, MIRA]), m = ok(storyMove(withFirst(c), R1, e, IN_ROOM));
    const [p, ...more] = posted(m.save);
    expect([more, p!.to, p!.words, p!.rewards, p!.quest?.dueAt, m.posted]).toEqual([[], [KAI_KEY], c.words, c.rewards, '2026-11-21T10:00:00.000Z', [KAI_KEY]]);
    expect(m.save.hunters[0]!.quests.find(q => q.title === 'Find it')!.dueAt, 'Mira\'s copy falls due at the same moment').toBe('2026-11-21T10:00:00.000Z');
    expect(m.save.log[0]).toMatchObject({ kind: 'story', text: 'Turned on for Kai and Mira. Chapter 1 (The bet) opened for Kai and Mira.' });
    expect(ok(storyMove(withFirst(c), R1, e, IN_ROOM)).save.settings.sync.outbox, 'the step read twice, as grantWrite reads it, posts the same message').toEqual(m.save.settings.sync.outbox);
  });

  test('with no room no player\'s hunter is at the table: one picked is skipped, and nothing is posted', () => {
    const m = ok(storyMove(gm(), R1, turnOn({ at: 'hunters', refs: [KAI_P, BRAKK] }, [KAI_P, BRAKK]), CTX));
    expect([m.skipped, m.posted, posted(m.save)]).toEqual([[KAI_P], [], []]);
  });

  test('a chapter past CHAPTER_MAX is refused for a player\'s hunter and writes nothing; for this phone\'s hunters alone it opens', () => {
    const big = worstChapter(), over = { ...big, words: { ...big.words, line: `${big.words.line}a` } };
    expect(chapterSize(over)).toBe(CHAPTER_MAX + 1);
    const s = withFirst(over);
    expect(storyMove(s, R1, turnOn({ at: 'table' }, [MIRA, KAI_P]), IN_ROOM)).toEqual({ ok: false, why: 'too-large' });
    expect(ok(storyMove(s, R1, turnOn({ at: 'table' }, [MIRA]), IN_ROOM)).granted.map(g => g.hid)).toEqual(['h1']);
    expect(ok(storyMove(withFirst(big), R1, turnOn({ at: 'table' }, [KAI_P]), IN_ROOM)).posted, 'the largest chapter the maker saves still goes').toEqual([KAI_KEY]);
  });

  test('a player\'s hunter on a row of this phone\'s fight gets the chapter without its statuses, which are handed to its row; the others get it whole', () => {
    const c = { ...WAGER.chapters[0]!, rewards: { ...newRewards(), gold: 10, statuses: [{ key: statusKey('hasted'), rounds: 3 }] } };
    const m = ok(storyMove(withFirst(c), R1, turnOn({ at: 'table' }, [KAI_P, LIN_P]), { ...CTX, room: { ...ROOM, onRow: k => k === KAI_KEY } }));
    const [lin, kai] = posted(m.save);
    expect([lin!.to, lin!.rewards.statuses.length, lin!.rewards.gold, kai!.to, kai!.rewards.statuses, kai!.rewards.gold]).toEqual([[LIN_KEY], 1, 10, [KAI_KEY], [], 10]);
    expect(lin!.eid).not.toBe(kai!.eid);
    expect(m.onRow, 'Kai is rank B, the fourth rank, so the GM\'s source is tier 3').toEqual([{ who: { key: KAI_KEY }, statuses: [{ key: statusKey('hasted'), rounds: 3, source: { id: null, tier: 3 } }], refill: false }]);
  });
});

describe('the save keeps its runs', () => {
  test('a run reads back whole; one naming no story or no state is dropped; a count of opens below the opens kept is raised', () => {
    const s = ok(storyMove(gm(), R1, turnOn(FOR_BRAKK, [BRAKK]), CTX)).save;
    const back = parseSaveValue(JSON.parse(JSON.stringify({ ...s, storyRuns: [...s.storyRuns, { id: 'sr7', story: 7, state: { at: 'running', chapter: 0 } }, { id: 'sr8', story: 'st1' }] })), ENV);
    expect(back.kind === 'save' && back.save.storyRuns).toEqual(s.storyRuns);
    const { id: _id, ...run } = s.storyRuns[0]!;
    expect(parseStoryRun({ ...run, opens: 0 })?.opens).toBe(1);
    expect(parseStoryRun({ ...run, opened: Array.from({ length: OPENED_MAX + 5 }, (_, i) => ({ chapter: 0, to: [BRAKK], at: AT, session: i })) })?.opened.length).toBe(OPENED_MAX);
  });

  test('a story with a running run is not deleted from the library; once ended, it is', () => {
    const s = ok(storyMove(gm(), R1, turnOn(FOR_BRAKK, [BRAKK]), CTX)).save;
    expect(removeStory(s, WAGER.id)).toEqual({ ok: false, why: 'running' });
    const done = ok(storyMove(s, R1, end(1), CTX)).save;
    expect(ok(removeStory(done, WAGER.id)).library.stories).toEqual([]);
  });
});

describe('only the GM\'s tap moves a story', () => {
  test('a running story stays where it is through everything but the GM\'s tap: the notice step, quests done and failed, the day\'s rollover, a personal gate\'s tick, a new session or day, a fight\'s end, and every room message', () => {
    const base = ok(storyMove(gm(), R1, turnOn(FOR_BRAKK, [BRAKK]), CTX)).save, runs = base.storyRuns;
    const same = (s: Pick<Save, 'storyRuns'>) => expect(s.storyRuns).toBe(runs);

    const up: FeatDef = { name: 'Up', window: 'UP', desc: '', show: { at: 'start' }, rule: { on: 'level', where: [], measure: { of: 'facts' }, within: 'ever', reach: 1, also: [] }, rewards: { ...newRewards(), gold: 5 } };
    const facts = { ...base, hunters: base.hunters.map(h => (h.id === 'h1' ? record(h, { kind: 'level', level: 2 }) : h)) };
    const n = noticed(facts, () => ({ at: AT, today: TODAY, session: 4, held: () => false, R: RULES, feats: [['up' as FeatKey, up]] }));
    expect(n.hunters[0]!.gold, 'the feat was earned').toBe(base.hunters[0]!.gold + 5);
    same(n);

    const quest = { id: qid('q50'), kind: 'urgent' as const, title: 'Hold the bridge', desc: '', objectives: [], rewards: newRewards(), status: 'active' as const, issuedAt: AT, doneAt: null, dueAt: '2026-11-19T09:00:00.000Z', from: 'gm' as const, penaltyText: '', onFail: newRewards() };
    const withQuest = { ...base, hunters: base.hunters.map(h => (h.id === 'h2' ? { ...h, quests: [...h.quests, quest] } : h)) };
    same(ok(finishQuest(withQuest, 'h2', 'q50', { ...DAY, vitals: 'sheet' })).save);
    const failed = rollover(withQuest, { today: TODAY, at: AT, nowMs: Date.parse(AT), gm: true });
    expect(failed.save.hunters[1]!.quests.find(q => q.id === 'q50')!.status, 'the quest failed').toBe('failed');
    same(failed.save);
    same(rollover(base, { today: day('2026-11-22'), at: '2026-11-22T10:00:00.000Z', nowMs: Date.parse('2026-11-22T10:00:00.000Z'), gm: true }).save);
    const gate = { id: personalGateId(1), name: 'Goblin Warren', rank: 'E' as const, monsters: [{ monsterId: seedId<'m'>('goblin') as MonsterId, count: 1 }], at: '2026-11-18T08:00:00.000Z', closesAt: '2026-11-19T08:00:00.000Z' };
    const closing = { ...base, hunters: base.hunters.map(h => (h.id === 'h2' ? { ...h, solo: { clock: { at: 'off' as const }, gates: [gate] } } : h)) };
    same(ok(soloTick(closing, { now: new Date(AT), R: RULES, gm: true, seed: 1 })).save);
    same(ok(sessionStarted(base, false, { at: AT, cap: RULES.logCap })).save);
    same(ok(advanceDay(base, 2, { at: AT, cap: RULES.logCap })).save);

    let s = base;
    const run = (cmd: Command) => { const r = reduce(s.fight, cmd, { rules: RULES }); s = ok(fought(s, r, { links: null, room: null, totals: [], stamp: { at: AT, cap: RULES.logCap } }, RULES)); };
    const c1 = combatantId('c1'), c2 = combatantId('c2');
    run({ type: 'add', fightId: fightId('f1'), rows: [hunterRow(base.hunters[1]!, c1, RULES), { ...hunterRow({ ...newHunter(RULES), id: 'x', name: 'Goblin' }, c2, RULES), kind: 'monster', side: 'foe', holder: null, threat: {}, name: 'Goblin', xp: 60 } as NewRow], openings: [] });
    run({ type: 'start', openings: [{ id: c1, d20: 20, tie: 0 }, { id: c2, d20: 5, tie: 0 }] });
    run({ type: 'end' });
    expect(s.fight?.phase, 'the fight ended').toBe('ended');
    same(s);

    const player: ParseEnv = { ...ENV, newDeviceId: () => dev('d-player1') };
    let phone: Save = { ...base, settings: freshSave(player, { onboarded: true }).settings };
    const deps: ApplyDeps = {
      store: { get: () => phone },
      once: (eid, step) => { const next = appliedOnce(eid, step)(phone); if (isRefused(next)) return false; phone = next; return true; },
      rules: () => RULES, now: () => AT, today: () => TODAY,
      toast: () => {}, system: () => {},
      hunter: { fightOf: () => null, granted: (_hid, g) => ({ lines: g.lines, levelup: g.levelup, popup: null }), gmHolds: () => refuse(TOLD) },
      stepsDone: () => {}, coinRuled: () => {},
    };
    for (const [i, type] of EVENT_TYPES.entries()) {
      // each message under its own id; an offer's end keeps the id its offer gives it (ids.ts `endIdOf`), which its reader checks
      const raw = VALID[type][0], ev = parseEvent(type, raw.eid === EID ? { ...raw, eid: `d-gm1-e${i}` } : raw);
      if (!ev) throw new Error(`the ${type} payload did not parse`);
      applyRoomEvent(ev, deps);
      expect(phone.storyRuns, type).toBe(runs);
    }
    expect(phone.settings.sync.applied?.length, 'the messages that change a hunter landed').toBeGreaterThan(5);
  });
});

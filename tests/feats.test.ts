// Feats (src/core/hunter/feats.ts), their counts (counts.ts), the built-ins (registry/feats.ts) and the notice step that
// earns them (noticed.ts): each expected value written from the rule.
import { afterEach, describe, expect, test } from 'bun:test';
import { RULES, rulesOf } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Hunter, ParseEnv, Save } from '../src/core/save.ts';
import { dayKey, parseDayKey } from '../src/core/day.ts';
import { parseChronicle, record } from '../src/core/hunter/chronicle.ts';
import { FACT_KINDS } from '../src/core/hunter/facts.ts';
import type { Fact, FactStamp } from '../src/core/hunter/facts.ts';
import { NO_COUNT, countStep, markOf, measureFields, measuresFor, parseCount } from '../src/core/hunter/counts.ts';
import type { FactCount, Counted } from '../src/core/hunter/counts.ts';
import { FEAT_STATES, TABLE, afterChoices, featNews, featStep, featsDoc, featsFor, freeFeatKey, parseFeat, progressLine, startOf } from '../src/core/hunter/feats.ts';
import { parseFeatKey } from '../src/core/ids.ts';
import { seededSource } from '../src/core/draws.ts';
import { DOCS, DOC_MAX } from '../src/core/protocol.ts';
import type { FeatBook, FeatDef, FeatKey, FeatState } from '../src/core/hunter/feats.ts';
import { noticed } from '../src/core/hunter/noticed.ts';
import type { NoticeCtx } from '../src/core/hunter/noticed.ts';
import { BUILT_IN_FEATS } from '../src/core/registry/feats.ts';
import { newRewards } from '../src/core/rewards.ts';
import { FEAT_WALK } from './models/feat-events.ts';
import { dev, hid } from './fixtures/ids.ts';

const AT = '2026-11-18T10:00:00.000Z', TODAY = dayKey(new Date(AT), 0), NOW = { at: AT, day: TODAY };
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-me') };
const H1 = hid('h1');
const mira = (h: Partial<Hunter> = {}): Hunter => ({ ...newHunter(RULES), id: H1, name: 'Mira', ...h });
const saveOf = (h: Hunter): Save => ({ ...freshSave(ENV, { onboarded: true }), hunters: [h] });
const book = (...keys: string[]): FeatBook => BUILT_IN_FEATS.filter(([k]) => keys.includes(k));
const ctx = (feats: FeatBook, c: Partial<NoticeCtx> = {}): NoticeCtx => ({ at: AT, today: TODAY, session: 4, held: () => false, R: RULES, feats, ...c });
/** One write that records `facts` on Mira, noticed with `c`. */
const write = (s: Save, facts: readonly Fact[], c: NoticeCtx): Save => noticed({ ...s, hunters: s.hunters.map(h => record(h, ...facts)) }, () => c);
const me = (s: Save): Hunter => s.hunters[0]!;
const fight = (o: Partial<Extract<Fact, { kind: 'fight' }>> = {}): Fact => ({
  kind: 'fight', outcome: 'won', rounds: 4, up: true, downs: 0, low: 60, endPct: 80, exactOne: false, struck: 2, hits: 3, crits: 0, critRun: 0, avoided: 0, dealt: 30, taken: 10,
  healed: 0, raised: 0, hexes: 0, kills: 1, bosses: 0, turnKills: 1, items: 0, allies: 1, alliesDown: 0, sideUp: 2, foes: 1, foeTop: 0, bossTop: null, gate: '', names: 'Wolf', ...o,
});
const solo = (o: Partial<Extract<Fact, { kind: 'solo' }>> = {}): Fact => ({ kind: 'solo', outcome: 'won', name: 'Den', rank: 'E', above: 0, rounds: 4, endPct: 60, life: 'up', personal: true, ...o });
const kill = (type: string): Fact => ({ kind: 'kill', monster: 'X', rank: 'E', type, mkind: 'normal', above: 0, hpPct: 50, payback: false, where: 'fight' });
const killOf = (monster: string, rank: 'E' | 'D'): Fact => ({ kind: 'kill', monster, rank, type: 'Humanoid', mkind: 'normal', above: 0, hpPct: 50, payback: false, where: 'fight' });
const state = (s: Save, key: string) => me(s).chronicle.feats[key];

describe('a count and its window (table 5.6)', () => {
  const STAMP: FactStamp = { at: AT, day: TODAY, session: 4 };
  const c = (within: FactCount['within'], measure: FactCount['measure'] = { of: 'facts' }): FactCount => ({ on: 'fight', where: [{ field: 'outcome', op: '=', value: 'won' }], measure, within });
  test('a fact of another kind changes nothing; one that fails its tests leaves an ever count and breaks a row', () => {
    expect(countStep({ n: 3, mark: '' }, kill('Beast'), c('ever'), '')).toBeNull();
    const lost = fight({ outcome: 'lost' }), three = { n: 3, mark: '' };
    expect(countStep(three, lost, c('ever'), '')).toEqual({ to: 'same' });
    expect(countStep(three, lost, c('row'), '')).toEqual({ to: 'broke', count: { n: 0, mark: '' } });
    expect(countStep(three, lost, c('session'), 's4')).toEqual({ to: 'same' });
  });
  test('a broken row forgets the values it saw, so a different-values count in a row counts them again (SMX-rules-9.2)', () => {
    const d: FactCount = { on: 'kill', where: [{ field: 'rank', op: '=', value: 'E' }], measure: { of: 'distinct', field: 'monster' }, within: 'row' };
    expect(countStep({ n: 1, mark: '', vals: ['goblin'] }, killOf('Orc', 'D'), d, '')).toEqual({ to: 'broke', count: { n: 0, mark: '' } });
    expect(countStep({ n: 0, mark: '' }, killOf('Goblin', 'E'), d, '')).toEqual({ to: 'moved', count: { n: 1, mark: '', vals: ['goblin'] } });
  });
  test('a passing fact adds in its window and starts a new window again', () => {
    expect(countStep({ n: 3, mark: 's4' }, fight(), c('session'), 's4')).toEqual({ to: 'moved', count: { n: 4, mark: 's4' } });
    expect(countStep({ n: 3, mark: 's3' }, fight(), c('session'), 's4')).toEqual({ to: 'moved', count: { n: 1, mark: 's4' } });
    expect(['ever', 'row', 'session', 'day', 'rest'].map(w => markOf(w as FactCount['within'], STAMP, 2))).toEqual(['', '', 's4', TODAY, 'r2']);
  });
  test('a sum adds the field, a distinct count each new value once, a max the highest seen', () => {
    expect(countStep({ n: 5, mark: '' }, fight({ healed: 12 }), c('ever', { of: 'sum', field: 'healed' }), '')).toEqual({ to: 'moved', count: { n: 17, mark: '' } });
    const d: FactCount = { on: 'kill', where: [], measure: { of: 'distinct', field: 'type' }, within: 'ever' };
    const one: Counted = { n: 1, mark: '', vals: ['beast'] };
    expect(countStep(NO_COUNT, kill('Beast'), d, '')).toEqual({ to: 'moved', count: one });
    expect(countStep(one, kill('beast'), d, ''), 'a value seen leaves the count as it was').toEqual({ to: 'same' });
    expect(countStep({ n: 4, mark: '' }, fight({ rounds: 9 }), c('ever', { of: 'max', field: 'rounds' }), '')).toEqual({ to: 'moved', count: { n: 9, mark: '' } });
  });
  test('the parser refuses a test of a field the kind lacks, an op its field cannot take, or a value that does not read', () => {
    expect(parseCount({ on: 'kill', where: [{ field: 'type', op: '=', value: 'Beast' }] })).toEqual({ on: 'kill', where: [{ field: 'type', op: '=', value: 'Beast' }], measure: { of: 'facts' }, within: 'ever' });
    expect(parseCount({ on: 'kill', where: [{ field: 'healed', op: '>=', value: 1 }] })).toBeNull();
    expect(parseCount({ on: 'kill', where: [{ field: 'type', op: '>=', value: 'Beast' }] })).toBeNull();
    expect(parseCount({ on: 'kill', where: [{ field: 'rank', op: '>=', value: 'Z' }] })).toBeNull();
    expect(parseCount({ on: 'nope', where: [] })).toBeNull();
    expect(parseCount({ on: 'kill', measure: { of: 'sum', field: 'type' } })).toBeNull();
  });
  test('a kind with no number field takes each time and different values only; every measure a kind takes reads back with each field it offers', () => {
    const noNumber = ['closed', 'quest', 'rank', 'title', 'feat', 'given', 'chapter', 'coin', 'rest', 'used', 'shadow'];
    for (const kind of FACT_KINDS) {
      expect([kind, measuresFor(kind)]).toEqual([kind, noNumber.includes(kind) ? ['facts', 'distinct'] : ['facts', 'sum', 'distinct', 'max']]);
      for (const of of measuresFor(kind)) {
        if (of === 'facts') continue;
        const fields = measureFields(kind, of);
        expect(fields.length).toBeGreaterThan(0);
        for (const field of fields) expect(parseCount({ on: kind, measure: { of, field } })?.measure).toEqual({ of, field });
      }
    }
    expect(measureFields('quest', 'distinct')).toEqual(['end', 'qkind', 'from', 'title']);
    expect(measureFields('gate', 'sum')).toEqual(['above', 'toBreak']);
    expect(parseCount({ on: 'quest', measure: { of: 'sum', field: 'title' } })).toBeNull();
  });
});

describe('a feat on a hunter, cell by cell', () => {
  const def = (show: FeatDef['show']): FeatDef => ({ name: 'F', window: 'F', desc: '', show, rule: { on: 'kill', where: [], measure: { of: 'facts' }, within: 'row', reach: 2, also: [] }, rewards: newRewards() });
  test('every state against every event: where each goes and what it tells, the refused cells too', () => {
    const after = def({ at: 'feat', key: 'x' as FeatKey });
    const from: { readonly [S in (typeof FEAT_STATES)[number]]: FeatState } = { hidden: { at: 'hidden', n: 1, mark: '' }, shown: { at: 'shown', n: 1, mark: '' }, earned: { at: 'earned', on: AT, day: TODAY, name: 'F' } };
    const earned = { state: { at: 'earned', on: AT, day: TODAY, name: 'F' }, fx: 'earned' };
    const expected: { readonly [S in (typeof FEAT_STATES)[number]]: readonly unknown[] } = {
      // counted 1, counted 2 with its state tests, counted 2 without, broke, unlocked, a fact that left a full count as it was
      hidden: [{ state: { at: 'hidden', n: 1, mark: '' }, fx: null }, earned, { state: { at: 'hidden', n: 2, mark: '' }, fx: null }, { state: { at: 'hidden', n: 0, mark: '' }, fx: null }, { state: { at: 'shown', n: 1, mark: '' }, fx: 'shown' }, null],
      shown: [{ state: { at: 'shown', n: 1, mark: '' }, fx: null }, earned, { state: { at: 'shown', n: 2, mark: '' }, fx: null }, { state: { at: 'shown', n: 0, mark: '' }, fx: null }, { state: { at: 'shown', n: 1, mark: '' }, fx: null }, null],
      earned: [null, null, null, null, null, null],
    };
    expect(FEAT_WALK.map(e => e.type)).toEqual(['counted', 'counted', 'counted', 'broke', 'unlocked', 'again']);
    for (const s of FEAT_STATES) expect([s, FEAT_WALK.map(e => featStep(from[s], e, after, NOW))]).toEqual([s, expected[s]]);
  });
  test('a full count whose state tests now hold is left as it is by a fact that does not move it, as the app does today (SMX-gates-6.1 waits on its ruling)', () => {
    expect(TABLE.hidden.again).toBeNull();
    expect(TABLE.shown.again).toBeNull();
  });
  test('a feat hidden until earned is shown when it is unlocked, as the app does today (SMX-gates-6.2 waits on the "never show" ruling)', () => {
    const never = def({ at: 'never' });
    expect(featStep(startOf(never), { type: 'unlocked' }, never, NOW)).toEqual({ state: { at: 'shown', n: 0, mark: '' }, fx: 'shown' });
  });
  test('earned at its reach when its state tests hold; shown at its count; a broken row back to 0; shown when the feat it waits on is earned', () => {
    const hidden = startOf(def({ at: 'never' }));
    expect(featStep(hidden, FEAT_WALK[1]!, def({ at: 'never' }), NOW)).toEqual({ state: { at: 'earned', on: AT, day: TODAY, name: 'F' }, fx: 'earned' });
    expect(featStep(hidden, FEAT_WALK[2]!, def({ at: 'never' }), NOW)).toEqual({ state: { at: 'hidden', n: 2, mark: '' }, fx: null });
    expect(featStep(hidden, FEAT_WALK[0]!, def({ at: 'count', n: 1 }), NOW)).toEqual({ state: { at: 'shown', n: 1, mark: '' }, fx: 'shown' });
    expect(featStep({ at: 'shown', n: 1, mark: '' }, FEAT_WALK[3]!, def({ at: 'start' }), NOW)?.state).toEqual({ at: 'shown', n: 0, mark: '' });
    expect(featStep(hidden, FEAT_WALK[4]!, def({ at: 'feat', key: 'x' as FeatKey }), NOW)?.fx).toBe('shown');
    expect(featStep({ at: 'earned', on: AT, day: TODAY, name: 'F' }, FEAT_WALK[1]!, def({ at: 'start' }), NOW)).toBeNull();
  });
});

describe('the built-in feats', () => {
  test('each has its own key and reads back whole through the parser', () => {
    expect(new Set(BUILT_IN_FEATS.map(([k]) => k)).size).toBe(BUILT_IN_FEATS.length);
    for (const [k, d] of BUILT_IN_FEATS) {
      expect(parseFeat(JSON.parse(JSON.stringify(d))), k).toEqual(d);
      expect(d.window, k).toBe(d.window.toUpperCase());
      for (const t of [d.name, d.window, d.desc]) expect(t, `${k}: no exclamation mark, em dash or semicolon`).not.toMatch(/[!—;]/);
    }
  });
  test('In and Out\'s title says its rule: a gate of the hunter\'s rank or higher, cleared alone in three rounds or fewer', () => {
    const d = BUILT_IN_FEATS.find(([k]) => k === 'in-and-out')![1];
    expect(d.rule.where).toEqual([{ field: 'outcome', op: '=', value: 'won' }, { field: 'rounds', op: '<=', value: 3 }, { field: 'above', op: '>=', value: 0 }]);
    expect(d.rewards.title?.desc).toBe('Cleared a gate of your rank or higher alone in three rounds or fewer.');
  });
  test('a GM\'s switch turns them all off; an edit takes a built-in\'s place; a turned-off one is left out; the GM\'s own come after, by key', () => {
    const off = rulesOf({ feats: { on: false } });
    expect(featsFor(off, BUILT_IN_FEATS, {})).toEqual([]);
    const edited = { ...BUILT_IN_FEATS[0]![1], name: 'Edited' }, own = { ...BUILT_IN_FEATS[1]![1], name: 'Mine' };
    const b = featsFor(RULES, BUILT_IN_FEATS, { [BUILT_IN_FEATS[0]![0]]: edited, [BUILT_IN_FEATS[2]![0]]: { ...BUILT_IN_FEATS[2]![1], off: true }, 'zz-mine': own });
    expect(b[0]).toEqual([BUILT_IN_FEATS[0]![0], edited]);
    expect(b.some(([k]) => k === BUILT_IN_FEATS[2]![0])).toBe(false);
    expect(b[b.length - 1]).toEqual(['zz-mine', own]);
  });
});

describe('the feats a feat may be shown after (the maker\'s After another feat)', () => {
  test('the built-ins as the library changed them, then the GM\'s own; not the feat itself, not one turned off; a key no feat holds kept and named by its key', () => {
    const [k0, d0] = BUILT_IN_FEATS[0]!, [k1, d1] = BUILT_IN_FEATS[1]!, [k2] = BUILT_IN_FEATS[2]!;
    const library = { [k0]: { ...d0, name: 'Renamed' }, [k1]: { ...d1, off: true as const }, 'zz-mine': { ...d0, name: 'Mine' }, 'zz-off': { ...d0, name: 'Paused', off: true as const } };
    const list = afterChoices(BUILT_IN_FEATS, library, k2, null);
    expect(list[0]).toEqual([k0, 'Renamed']);
    expect(list.map(([k]) => k)).not.toContain(k1);
    expect(list.map(([k]) => k)).not.toContain(k2);
    expect(list.map(([k]) => k)).not.toContain('zz-off');
    expect(list[list.length - 1]).toEqual(['zz-mine', 'Mine']);
    expect(list).toHaveLength(BUILT_IN_FEATS.length - 2 + 1);
    expect(afterChoices(BUILT_IN_FEATS, library, k2, 'gone-feat' as FeatKey).at(-1)).toEqual(['gone-feat', 'gone-feat']);
    expect(afterChoices(BUILT_IN_FEATS, library, k2, k1).at(-1)).toEqual([k1, k1]);
    expect(afterChoices(BUILT_IN_FEATS, library, k2, k0)).toEqual(list);
  });
});

describe('the day a feat was earned', () => {
  const zone = process.env.TZ;
  afterEach(() => { process.env.TZ = zone; });
  test('a feat earned at 19:30 in Los Angeles reads as earned that day there, not on the next day of its UTC time', () => {
    process.env.TZ = 'America/Los_Angeles';
    const at = '2026-11-20T03:30:00.000Z', s = write(saveOf(mira()), [fight({ endPct: 4 })], ctx(book('threads-end'), { at, today: dayKey(new Date(at), 0) }));
    expect(progressLine(book('threads-end')[0]![1], state(s, 'threads-end')!)).toBe('Earned 2026-11-19.');
    expect(me(s).chronicle.facts.find(f => f.kind === 'feat')?.day).toBe(parseDayKey('2026-11-19')!);
  });
  test('an earned feat kept before its day was stored takes the local day of its time, once, at the load', () => {
    process.env.TZ = 'America/Los_Angeles';
    const c = parseChronicle({ feats: { 'threads-end': { at: 'earned', on: '2026-11-20T03:30:00.000Z', name: 'Thread\'s End' } } });
    expect(c.feats['threads-end']).toEqual({ at: 'earned', on: '2026-11-20T03:30:00.000Z', day: '2026-11-19', name: 'Thread\'s End' });
  });
});

describe('the System notices, in the write of the fact', () => {
  test('Thread\'s End: a won fight ended at 4% of max HP, never down, earns it and its title in the same write, with a feat fact kept', () => {
    const s = write(saveOf(mira()), [fight({ endPct: 4 })], ctx(book('threads-end')));
    expect(state(s, 'threads-end')).toEqual({ at: 'earned', on: AT, day: TODAY, name: 'Thread\'s End' });
    expect(me(s).titles.map(t => t.name)).toContain('Still Standing');
    expect(me(s).chronicle.facts.map(f => f.kind)).toEqual(['fight', 'feat', 'title']);
    expect(me(s).chronicle.tally.feats).toBe(1);
    expect(me(s).chronicle.inbox).toEqual([]);
  });
  test('Clean Sheet counts won fights in a row: a fight it went down in starts the row again', () => {
    let s = saveOf(mira());
    for (let i = 0; i < 9; i++) s = write(s, [fight()], ctx(book('clean-sheet')));
    s = write(s, [fight({ downs: 1 })], ctx(book('clean-sheet')));
    expect(state(s, 'clean-sheet')).toEqual({ at: 'hidden', n: 0, mark: '' });
    for (let i = 0; i < 10; i++) s = write(s, [fight()], ctx(book('clean-sheet')));
    expect(state(s, 'clean-sheet')?.at).toBe('earned');
  });
  test('Marathoner counts runs won between two long rests; The Dice Are Watching counts 1s in one session', () => {
    let s = saveOf(mira());
    s = write(s, [solo(), solo(), { kind: 'rest', long: true }, solo()], ctx(book('marathoner')));
    expect(state(s, 'marathoner')).toEqual({ at: 'hidden', n: 1, mark: 'r1' });
    s = write(s, [solo(), solo()], ctx(book('marathoner')));
    expect(state(s, 'marathoner')?.at).toBe('earned');
    let d = saveOf(mira());
    d = write(d, [{ kind: 'roll', natural: 1 }, { kind: 'roll', natural: 1 }], ctx(book('dice-are-watching'), { session: 3 }));
    d = write(d, [{ kind: 'roll', natural: 1 }], ctx(book('dice-are-watching'), { session: 4 }));
    expect(state(d, 'dice-are-watching')).toEqual({ at: 'hidden', n: 1, mark: 's4' });
  });
  test('Field Naturalist counts different monster types once each', () => {
    const s = write(saveOf(mira()), ['Beast', 'beast', 'Insect', 'Demon', 'Giant', 'Construct'].map(kill), ctx(book('field-naturalist')));
    expect(state(s, 'field-naturalist')?.at).toBe('earned');
    expect(me(s).bonusPoints).toBe(mira().bonusPoints + 1);
  });
  test('a state test waits: a feat whose count is past its reach earns at the first counted fact its test holds at', () => {
    const lvl: FeatDef = { name: 'Fine Print', window: 'NOT ONE FALL', desc: '', show: { at: 'never' }, rule: { on: 'level', where: [{ field: 'level', op: '>=', value: 2 }], measure: { of: 'facts' }, within: 'ever', reach: 1, also: [{ of: 'gold', op: '>=', value: 100 }] }, rewards: newRewards() };
    const b: FeatBook = [['fine-print' as FeatKey, lvl]];
    let s = write(saveOf(mira({ gold: 0 })), [{ kind: 'level', level: 2 }], ctx(b));
    expect(state(s, 'fine-print')).toEqual({ at: 'hidden', n: 1, mark: '' });
    s = { ...s, hunters: [{ ...me(s), gold: 100 }] };
    s = write(s, [{ kind: 'level', level: 3 }], ctx(b));
    expect(state(s, 'fine-print')?.at).toBe('earned');
  });
  test('a different-monsters feat in a row counts again from nothing once its row breaks (SMX-rules-9.2)', () => {
    const variety: FeatDef = { name: 'Variety', window: 'V', desc: '', show: { at: 'start' }, rule: { on: 'kill', where: [{ field: 'rank', op: '=', value: 'E' }], measure: { of: 'distinct', field: 'monster' }, within: 'row', reach: 2, also: [] }, rewards: newRewards() };
    const b: FeatBook = [['variety' as FeatKey, variety]];
    let s = write(saveOf(mira()), [killOf('Goblin', 'E')], ctx(b));
    expect(state(s, 'variety')).toEqual({ at: 'shown', n: 1, mark: '', vals: ['goblin'] });
    s = write(s, [killOf('Orc', 'D')], ctx(b));
    expect(state(s, 'variety'), 'an Orc of rank D breaks the row').toEqual({ at: 'shown', n: 0, mark: '' });
    s = write(s, [killOf('Goblin', 'E')], ctx(b));
    expect(state(s, 'variety'), 'the Goblin starts the new row').toEqual({ at: 'shown', n: 1, mark: '', vals: ['goblin'] });
    s = write(s, [killOf('Wolf', 'E')], ctx(b));
    expect(state(s, 'variety')?.at).toBe('earned');
  });
  test('a full different-values count whose state test comes to hold is not earned by a value it saw, as today; a new value earns it (SMX-gates-6.1 waits)', () => {
    const rich: FeatDef = { name: 'Rich Hunter', window: 'R', desc: '', show: { at: 'never' }, rule: { on: 'kill', where: [], measure: { of: 'distinct', field: 'monster' }, within: 'ever', reach: 1, also: [{ of: 'gold', op: '>=', value: 500 }] }, rewards: newRewards() };
    const b: FeatBook = [['rich-hunter' as FeatKey, rich]];
    let s = write(saveOf(mira({ gold: 0 })), [killOf('Goblin', 'E')], ctx(b));
    expect(state(s, 'rich-hunter')).toEqual({ at: 'hidden', n: 1, mark: '', vals: ['goblin'] });
    s = { ...s, hunters: [{ ...me(s), gold: 1000 }] };
    s = write(s, [killOf('Goblin', 'E')], ctx(b));
    expect(state(s, 'rich-hunter'), 'the row full × its test now holding moves nothing today').toEqual({ at: 'hidden', n: 1, mark: '', vals: ['goblin'] });
    s = write(s, [killOf('Wolf', 'E')], ctx(b));
    expect(state(s, 'rich-hunter')?.at).toBe('earned');
  });
  test('a kill a fight held over midnight counts in the day of the write that frees it, as today (SMX-rules-9.1 waits on the day ruling)', () => {
    const twice: FeatDef = { name: 'Two Today', window: 'T', desc: '', show: { at: 'never' }, rule: { on: 'kill', where: [], measure: { of: 'facts' }, within: 'day', reach: 2, also: [] }, rewards: newRewards() };
    const b: FeatBook = [['two-today' as FeatKey, twice]];
    const late = '2026-11-18T12:00:00.000Z', next = '2026-11-19T12:00:00.000Z', day1 = dayKey(new Date(late), 0), day2 = dayKey(new Date(next), 0);
    const held = write(saveOf(mira()), [kill('Beast')], ctx(b, { at: late, today: day1, held: () => true }));
    expect(me(held).chronicle.inbox, 'the kill is stamped with the day it happened').toEqual([{ ...kill('Beast'), at: late, day: day1, session: 4 }]);
    const s = write(held, [kill('Beast')], ctx(b, { at: next, today: day2 }));
    expect(state(s, 'two-today'), 'one kill on each day, both counted in the day of the write that frees them').toEqual({ at: 'earned', on: next, day: day2, name: 'Two Today' });
  });
  test('a feat is earned once: the same facts noticed again in a later write move nothing, and its reward is not given twice', () => {
    let s = write(saveOf(mira()), [solo()], ctx(book('alone-once')));
    const titles = me(s).titles.length;
    s = write(s, [solo()], ctx(book('alone-once')));
    expect(me(s).titles.length).toBe(titles);
    expect(me(s).chronicle.tally.feats).toBe(1);
  });
  test('a chain of feats that each count the last one\'s feat fact ends with every feat earned once', () => {
    const chain = (i: number): FeatDef => ({ name: `Chain ${i}`, window: 'C', desc: '', show: { at: 'never' }, rule: { on: 'feat', where: [], measure: { of: 'facts' }, within: 'ever', reach: i, also: [] }, rewards: newRewards() });
    const b: FeatBook = [['first' as FeatKey, { ...chain(1), rule: { ...chain(1).rule, on: 'roll' } }], ...[1, 2, 3].map(i => [`chain-${i}` as FeatKey, chain(i)] as const)];
    const s = write(saveOf(mira()), [{ kind: 'roll', natural: 20 }], ctx(b));
    expect(Object.values(me(s).chronicle.feats).map(f => f.at)).toEqual(['earned', 'earned', 'earned', 'earned']);
    expect(me(s).chronicle.tally.feats).toBe(4);
  });
  test('Iron Routine is shown once Early Riser is earned; a held hunter\'s facts wait for the write that frees it', () => {
    const b = book('early-riser', 'iron-routine');
    const held = write(saveOf(mira()), [{ kind: 'daily', streak: 7 }], ctx(b, { held: () => true }));
    expect(me(held).chronicle.inbox).toHaveLength(1);
    const s = noticed(held, () => ctx(b));
    expect(state(s, 'early-riser')?.at).toBe('earned');
    expect(state(s, 'iron-routine')).toEqual({ at: 'shown', n: 0, mark: '' });
    expect(progressLine(b[1]![1], state(s, 'iron-routine')!)).toBe('Dailies: 0 of 1.');
    expect(featNews(me(s).chronicle.feats, [])).toEqual(['early-riser']);
    expect(featNews(me(s).chronicle.feats, ['early-riser'])).toEqual([]);
  });
});

describe('the GM\'s feats on the players\' phones (the room\'s feats doc)', () => {
  test('a library of 100 feats, each with a reward of 20 items, fills the doc within DOC_MAX and names the ones left out; the doc reads back whole', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ name: `Potion ${i}`, rar: 'common', type: 'consumable', qty: 1, desc: 'x'.repeat(200) }));
    const big: FeatDef = parseFeat({ ...BUILT_IN_FEATS[0]![1], rewards: { ...newRewards(), items } })!;
    const lib = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`gm-${String(i).padStart(3, '0')}`, { ...big, name: `Feat ${i}` }]));
    const { doc, left } = featsDoc(lib, DOC_MAX);
    const size = JSON.stringify(doc).length;
    console.log(`the feats doc: ${Object.keys(doc.feats).length} feats in ${size} characters, ${left.length} left out`);
    expect(size).toBeLessThanOrEqual(DOC_MAX);
    expect(Object.keys(doc.feats).length + left.length).toBe(100);
    expect(left.length).toBeGreaterThan(0);
    expect(DOCS.feats(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
});

describe('a GM\'s new feat gets a key of its own', () => {
  const ALPHABET = ['a', 'Z', '7', ' ', '-', '_', '.', '\'', 'é', 'ß', 'İ', 'Ω', '日', '\u0301', '\u{1F525}', '\t', '/', '%'];
  test('for names of any characters and length, with taken keys, the key reads as a feat\'s key and is not taken', () => {
    const { random } = seededSource(7);
    const pick = (n: number) => Math.floor(random() * n);
    for (let i = 0; i < 2000; i++) {
      const name = Array.from({ length: pick(90) }, () => ALPHABET[pick(ALPHABET.length)]).join('');
      const first = freeFeatKey(name, () => false);
      const taken = new Set([first, ...Array.from({ length: pick(12) }, (_, n) => `${first}-${n + 2}`)]);
      const k = freeFeatKey(name, x => taken.has(x));
      expect(parseFeatKey(first), JSON.stringify(name)).toBe(first);
      expect(parseFeatKey(k), JSON.stringify(name)).toBe(k);
      expect(taken.has(k), JSON.stringify(name)).toBe(false);
    }
  });
  test('a long name whose first hundred thousand numbered keys are taken still gets a key within 40 characters', () => {
    const name = 'An Extremely Long Feat Name For A Table That Makes Many';
    const first = freeFeatKey(name, () => false);
    const taken = new Set([first, ...Array.from({ length: 100_000 }, (_, n) => `${first}-${n + 2}`)]);
    const k = freeFeatKey(name, x => taken.has(x));
    expect(parseFeatKey(k)).toBe(k);
    expect(taken.has(k)).toBe(false);
  });
});

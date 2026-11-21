import { describe, expect, test } from 'bun:test';
import { ONBOARD_STEPS, createShows, joinShows, onboardStep } from '../src/core/onboarding.ts';
import type { Onboarded, OnboardingAt, OnboardingEvent } from '../src/core/onboarding.ts';
import { BACK, STARTS, WALK_EVENTS } from './models/onboarding-events.ts';

type At = OnboardingAt<string>;
type Ev = OnboardingEvent<string>;

/** A state as the table below names it: the window, then its sub-state. */
function nameOf(s: At): string {
  switch (s.at) {
    case 'invite': return `invite ${s.join.is}${'why' in s.join ? `(${s.join.why})` : ''}`;
    case 'player': return `player ${s.begin}`;
    case 'campaignReady': return `campaignReady ${s.create.is}${'why' in s.create ? `(${s.create.why})` : ''}`;
    case 'quickstart': return `quickstart(${s.back})`;
    default: return s.at;
  }
}
/** An event as the table below names it: its type, then what it carries that a step tells apart. */
const eventName = (e: Ev): string => e.type === 'start' ? (e.invited ? 'start invited' : 'start') : 'why' in e ? `${e.type}(${e.why})` : e.type;
/** A transition as the table below writes it: the next state, " marks" when it marks the save onboarded, and each effect after a "+". */
const cellOf = (t: Onboarded<string> | null): string | null => t === null ? null
  : [nameOf(t.to), ...(t.marks ? ['marks'] : []), ...t.fx.map(f => `+${f.type === 'focus' ? `focus(${f.back})` : f.type}`)].join(' ');

/** One state of each window and each sub-state (a failure of each kind where the kind is kept). */
const STATES: readonly At[] = [
  { at: 'shut' }, { at: 'quickstart', back: BACK }, { at: 'welcome' }, { at: 'role' },
  { at: 'invite', join: { is: 'fresh' } }, { at: 'invite', join: { is: 'checking' } },
  { at: 'invite', join: { is: 'failed', why: 'net' } }, { at: 'invite', join: { is: 'retrying', why: 'notfound' } },
  { at: 'player', begin: 'ready' }, { at: 'player', begin: 'checking' }, { at: 'gm' }, { at: 'hunterCreated' },
  { at: 'campaignReady', create: { is: 'idle' } }, { at: 'campaignReady', create: { is: 'creating' } },
  { at: 'campaignReady', create: { is: 'failed', why: 'net' } },
];

/**
 * The rule, written out: each state's events that lead somewhere. Every other cell is refused (null). "marks": the
 * write marks the save onboarded (it leaves the setup steps). "+dropInvite": other options after a failed Join drops the
 * invite (its button reads Continue without a room). "+cancelCreate": closing Campaign ready while its Create room is
 * under way. "+focus": the ? guide gives the focus back to what had it.
 */
const SPEC: { readonly [state: string]: { readonly [event: string]: string } } = {
  'shut': { 'start': 'welcome', 'start invited': 'invite fresh', 'help': `quickstart(${BACK})` },
  [`quickstart(${BACK})`]: { gotIt: `shut +focus(${BACK})` },
  'welcome': { accept: 'role', skip: 'shut marks' },
  'role': { player: 'player ready', gm: 'gm', skip: 'shut marks' },
  'invite fresh': { more: 'welcome', try: 'invite checking' },
  'invite checking': { 'more': 'welcome', 'missed(net)': 'invite failed(net)', 'missed(notfound)': 'invite failed(notfound)', 'joined': 'hunterCreated marks', 'refused': 'invite fresh' },
  'invite failed(net)': { more: 'welcome +dropInvite', try: 'invite retrying(net)' },
  'invite retrying(notfound)': { 'more': 'welcome +dropInvite', 'missed(net)': 'invite failed(net)', 'missed(notfound)': 'invite failed(notfound)', 'joined': 'hunterCreated marks', 'refused': 'invite failed(notfound)' },
  'player ready': { back: 'role', skip: 'shut marks', try: 'player checking', begun: 'hunterCreated marks' },
  'player checking': { 'back': 'role', 'skip': 'shut marks', 'missed(net)': 'player ready', 'missed(notfound)': 'player ready', 'begun': 'hunterCreated marks', 'refused': 'player ready' },
  'gm': { back: 'role', starter: 'campaignReady idle marks', blank: 'campaignReady idle marks', skip: 'shut marks' },
  'hunterCreated': { sheet: 'shut', join: 'shut' },
  'campaignReady idle': { create: 'campaignReady creating', later: 'shut' },
  'campaignReady creating': { 'created': 'shut', 'createFailed(net)': 'campaignReady failed(net)', 'later': 'shut +cancelCreate' },
  'campaignReady failed(net)': { create: 'campaignReady creating', later: 'shut' },
};

const run = (from: At, events: readonly Ev[]): At => events.reduce<At>((s, e) => {
  const t = onboardStep(s, e);
  if (!t) throw new Error(`${eventName(e)} refused on ${nameOf(s)}`);
  return t.to;
}, from);
const SHUT: At = { at: 'shut' };

describe('first-run setup and the quick start', () => {
  test('the table has a row for every state and the walk reaches every window', () => {
    expect(STATES.map(nameOf).sort()).toEqual(Object.keys(SPEC).sort());
    expect([...new Set(STATES.map(s => s.at))].sort()).toEqual([...ONBOARD_STEPS].sort());
  });
  for (const s of STATES) {
    test(`${nameOf(s)} answers each event as the table says, the refused ones with null`, () => {
      for (const e of WALK_EVENTS) expect({ e: eventName(e), cell: cellOf(onboardStep(s, e)) }).toEqual({ e: eventName(e), cell: SPEC[nameOf(s)]![eventName(e)] ?? null });
    });
  }

  test('the app opens setup on Welcome, and on the invite when it came from a room\'s invite link', () => {
    expect(run(SHUT, [{ type: 'start', invited: false }])).toEqual({ at: 'welcome' });
    expect(run(SHUT, [{ type: 'start', invited: true }])).toEqual({ at: 'invite', join: { is: 'fresh' } });
  });

  test('the player\'s path ends on Hunter created and the GM\'s on Campaign ready, then the window shuts', () => {
    const start: Ev = { type: 'start', invited: false };
    expect(run(SHUT, [start, { type: 'accept' }, { type: 'player' }, { type: 'begun' }, { type: 'sheet' }])).toEqual(SHUT);
    expect(run(SHUT, [start, { type: 'accept' }, { type: 'player' }, { type: 'try' }, { type: 'begun' }])).toEqual({ at: 'hunterCreated' });
    expect(run(SHUT, [start, { type: 'accept' }, { type: 'gm' }, { type: 'starter' }])).toEqual({ at: 'campaignReady', create: { is: 'idle' } });
    expect(run(SHUT, [{ type: 'start', invited: true }, { type: 'try' }, { type: 'joined' }])).toEqual({ at: 'hunterCreated' });
  });

  test('every way from the start to a shut window marks the save onboarded exactly once', () => {
    const key = (s: At) => JSON.stringify(s);
    const ways: { path: string[]; marks: number }[] = [];
    const walk = (s: At, path: string[], seen: Set<string>, marks: number): void => {
      if (s.at === 'shut' && path.length > 1) { ways.push({ path, marks }); return; }
      for (const e of WALK_EVENTS) {
        const t = onboardStep(s, e);
        if (!t || seen.has(key(t.to)) || e.type === 'help') continue;
        walk(t.to, [...path, `${eventName(e)}>${nameOf(t.to)}`], new Set([...seen, key(t.to)]), marks + (t.marks ? 1 : 0));
      }
    };
    walk(SHUT, ['shut'], new Set(), 0);
    expect(ways.length).toBeGreaterThan(20);
    for (const w of ways) expect(w).toEqual({ path: w.path, marks: 1 });
  });

  test('the quick start never marks the save and opens only over no other window', () => {
    for (const s of STATES) expect({ s: nameOf(s), opens: onboardStep(s, { type: 'help', back: BACK }) !== null }).toEqual({ s: nameOf(s), opens: s.at === 'shut' });
    expect(onboardStep({ at: 'quickstart', back: BACK }, { type: 'start', invited: false })).toBeNull();
  });

  test('a write the save refused keeps each step where it was, and puts a Join or a Begin under way back as it was before the tap', () => {
    for (const s of STATES) {
      const t = onboardStep(s, { type: 'refused' });
      if (t === null) continue;
      expect(t.marks).toBe(false);
      expect(t.to.at).toBe(s.at);
    }
    for (const at of ['welcome', 'role', 'gm'] as const) expect(onboardStep({ at }, { type: 'refused' })).toBeNull();
    expect(onboardStep({ at: 'player', begin: 'ready' }, { type: 'refused' })).toBeNull();
    expect(run({ at: 'invite', join: { is: 'fresh' } }, [{ type: 'try' }, { type: 'refused' }])).toEqual({ at: 'invite', join: { is: 'fresh' } });
    expect(run({ at: 'invite', join: { is: 'failed', why: 'notfound' } }, [{ type: 'try' }, { type: 'refused' }])).toEqual({ at: 'invite', join: { is: 'failed', why: 'notfound' } });
  });

  test('a Join, a Begin or a Create room under way takes no second tap', () => {
    expect(onboardStep({ at: 'invite', join: { is: 'checking' } }, { type: 'try' })).toBeNull();
    expect(onboardStep({ at: 'invite', join: { is: 'retrying', why: 'net' } }, { type: 'try' })).toBeNull();
    expect(onboardStep({ at: 'player', begin: 'checking' }, { type: 'try' })).toBeNull();
    expect(onboardStep({ at: 'campaignReady', create: { is: 'creating' } }, { type: 'create' })).toBeNull();
  });

  test('closing Campaign ready while its Create room is under way cancels the create, and its late answer is stale', () => {
    const creating: At = { at: 'campaignReady', create: { is: 'creating' } };
    expect(onboardStep(creating, { type: 'later' })).toEqual({ to: SHUT, marks: false, fx: [{ type: 'cancelCreate' }] });
    expect(onboardStep(SHUT, { type: 'created' })).toBeNull();
    expect(onboardStep(SHUT, { type: 'createFailed', why: 'net' })).toBeNull();
    expect(onboardStep({ at: 'campaignReady', create: { is: 'idle' } }, { type: 'later' })).toEqual({ to: SHUT, marks: false, fx: [] });
  });

  test('a check that answers after the player backed out of its window is stale', () => {
    expect(onboardStep({ at: 'welcome' }, { type: 'joined' })).toBeNull();
    expect(onboardStep({ at: 'welcome' }, { type: 'missed', why: 'net' })).toBeNull();
    expect(onboardStep({ at: 'role' }, { type: 'begun' })).toBeNull();
    expect(onboardStep(SHUT, { type: 'begun' })).toBeNull();
  });

  test('the invite\'s Join shows Try again and Continue without a room from its first failure on, and is busy while a check is out', () => {
    expect(joinShows({ is: 'fresh' })).toEqual({ busy: false, tried: false, why: null });
    expect(joinShows({ is: 'checking' })).toEqual({ busy: true, tried: false, why: null });
    expect(joinShows({ is: 'failed', why: 'notfound' })).toEqual({ busy: false, tried: true, why: 'notfound' });
    expect(joinShows({ is: 'retrying', why: 'notfound' })).toEqual({ busy: true, tried: true, why: null });
  });

  test('Create room is busy while under way and says why it failed', () => {
    expect(createShows({ is: 'idle' })).toEqual({ busy: false, why: null });
    expect(createShows({ is: 'creating' })).toEqual({ busy: true, why: null });
    expect(createShows({ is: 'failed', why: 'busy' })).toEqual({ busy: false, why: 'busy' });
  });

  test('a shut window can always open again, and every window can reach shut', () => {
    const reach = (from: At): Set<string> => {
      const seen = new Set([JSON.stringify(from)]), todo = [from];
      for (let s = todo.pop(); s; s = todo.pop()) for (const e of WALK_EVENTS) {
        const t = onboardStep(s, e), k = t && JSON.stringify(t.to);
        if (t && k && !seen.has(k)) { seen.add(k); todo.push(t.to); }
      }
      return seen;
    };
    for (const s of STATES) expect({ s: nameOf(s), shuts: reach(s).has(JSON.stringify(SHUT)) }).toEqual({ s: nameOf(s), shuts: true });
    expect(STARTS).toEqual([SHUT]);
  });
});

import { describe, expect, test } from 'bun:test';
import { ONBOARD_EVENTS, ONBOARD_STEPS, TABLE, firstStep, onboardStep } from '../src/core/onboarding.ts';
import type { OnboardEvent, OnboardStep } from '../src/core/onboarding.ts';
import { STARTS, WALK_EVENTS } from './models/onboarding-events.ts';

/** Every path from a start to `done` without a loop, with how many of its transitions marked the save onboarded. */
function paths(): { path: string[]; marks: number }[] {
  const out: { path: string[]; marks: number }[] = [];
  const walk = (at: OnboardStep, path: string[], seen: Set<OnboardStep>, marks: number): void => {
    if (at === 'done') { out.push({ path, marks }); return; }
    for (const e of WALK_EVENTS) {
      const t = onboardStep(at, e);
      if (!t || seen.has(t.to)) continue;
      walk(t.to, [...path, `${e}>${t.to}`], new Set([...seen, t.to]), marks + (t.marks ? 1 : 0));
    }
  };
  for (const s of STARTS) walk(s, [s], new Set([s]), 0);
  return out;
}

/** The brief's table, written out: each step's events that lead somewhere. Every other cell is null. */
const SPEC: { readonly [S in OnboardStep]: Partial<Record<OnboardEvent, OnboardStep>> } = {
  welcome: { accept: 'role', skip: 'done' },
  role: { player: 'player', gm: 'gm', skip: 'done' },
  invite: { more: 'welcome', joined: 'hunterCreated' },
  player: { back: 'role', begun: 'hunterCreated', skip: 'done' },
  gm: { back: 'role', starter: 'campaignReady', blank: 'campaignReady', skip: 'done' },
  hunterCreated: { sheet: 'done', join: 'done' },
  campaignReady: { later: 'done', created: 'done' },
  done: {},
};
const SETUP: readonly OnboardStep[] = ['welcome', 'role', 'invite', 'player', 'gm'];

describe('first-run setup', () => {
  test('a new install opens on Welcome, and on the invite when it came from a room\'s invite link', () => {
    expect(firstStep({ invited: false })).toBe('welcome');
    expect(firstStep({ invited: true })).toBe('invite');
  });
  for (const s of ONBOARD_STEPS) {
    test(`${s} answers each event as the table says`, () => {
      for (const e of ONBOARD_EVENTS) expect({ e, to: onboardStep(s, e)?.to ?? null }).toEqual({ e, to: SPEC[s][e] ?? null });
    });
  }
  test('the player\'s path: Yes, I\'m a Player, Begin ends on Hunter created; the GM\'s: Yes, I\'m the GM, a campaign ends on Campaign ready', () => {
    const run = (start: OnboardStep, events: OnboardEvent[]) => events.reduce<OnboardStep>((at, e) => onboardStep(at, e)!.to, start);
    expect(run('welcome', ['accept', 'player', 'begun'])).toBe('hunterCreated');
    expect(run('invite', ['joined'])).toBe('hunterCreated');
    expect(run('welcome', ['accept', 'gm', 'starter'])).toBe('campaignReady');
    expect(run('welcome', ['accept', 'gm', 'blank'])).toBe('campaignReady');
    expect(run('welcome', ['accept', 'player', 'begun', 'sheet'])).toBe('done');
    expect(run('welcome', ['accept', 'gm', 'blank', 'later'])).toBe('done');
    expect(run('invite', ['more', 'skip'])).toBe('done');
  });
  test('every way through marks the save onboarded exactly once', () => {
    const all = paths();
    expect(all.length).toBeGreaterThan(5);
    for (const p of all) expect({ path: p.path, marks: p.marks }).toEqual({ path: p.path, marks: 1 });
  });
  test('the save is marked as the confirmation opens, so a reload on Hunter created or Campaign ready does not start over', () => {
    expect(onboardStep('player', 'begun')).toEqual({ to: 'hunterCreated', marks: true });
    expect(onboardStep('invite', 'joined')).toEqual({ to: 'hunterCreated', marks: true });
    expect(onboardStep('gm', 'starter')).toEqual({ to: 'campaignReady', marks: true });
    expect(onboardStep('gm', 'blank')).toEqual({ to: 'campaignReady', marks: true });
    for (const e of ['sheet', 'join'] as const) expect(onboardStep('hunterCreated', e)).toEqual({ to: 'done', marks: false });
    for (const e of ['later', 'created'] as const) expect(onboardStep('campaignReady', e)).toEqual({ to: 'done', marks: false });
  });
  test('Skip ends setup at once from every setup step that offers it, and marks the save', () => {
    for (const s of SETUP) if (s !== 'invite') expect(onboardStep(s, 'skip')).toEqual({ to: 'done', marks: true });
    expect(onboardStep('invite', 'skip')).toBeNull();
  });
  test('Back and other options never mark the save', () => {
    for (const s of ONBOARD_STEPS) for (const e of ['back', 'more'] as const) expect(onboardStep(s, e)?.marks ?? false).toBe(false);
  });
  test('setup can always be finished: done is reached from every step, and done answers nothing', () => {
    for (const s of ONBOARD_STEPS) {
      let frontier = new Set<OnboardStep>([s]);
      for (let i = 0; i < ONBOARD_STEPS.length; i++) frontier = new Set([...frontier, ...[...frontier].flatMap(f => ONBOARD_EVENTS.map(e => TABLE[f][e]).filter((x): x is OnboardStep => x !== null))]);
      expect(frontier.has('done')).toBe(true);
    }
    for (const e of ONBOARD_EVENTS) expect(onboardStep('done', e)).toBeNull();
  });
  test('a stale event (a second Join, a Back on Welcome, a Create room after Open my sheet) is answered with null', () => {
    expect(onboardStep('done', 'joined')).toBeNull();
    expect(onboardStep('hunterCreated', 'joined')).toBeNull();
    expect(onboardStep('welcome', 'back')).toBeNull();
    expect(onboardStep('hunterCreated', 'created')).toBeNull();
    expect(onboardStep('campaignReady', 'sheet')).toBeNull();
  });
});

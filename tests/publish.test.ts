// The GM's room doc publisher (src/core/sync/publish.ts): each cell, and a walk of random changes, timers, answers and
// leaves against an edge that counts the puts out, built from the rule: at most one put of a doc is out in a stretch of
// the link, the doc as it was at the last change is put after that change, and nothing of a stretch the link left moves
// the doc in the next.
import { describe, expect, test } from 'bun:test';
import { PUBLISH_EVENTS, PUBLISH_IDLE, PUBLISH_STATES, publishStep, publishWait } from '../src/core/sync/publish.ts';
import type { Publish, PublishAt, PublishEffect, PublishEvent, PublishEventType, PutAnswer } from '../src/core/sync/publish.ts';
import type { Gen } from '../src/core/sync/link.ts';

const G = 3 as Gen, G2 = 4 as Gen;
function run(state: Publish = PUBLISH_IDLE) {
  let fx: readonly PublishEffect[] = [];
  const api = {
    get state(): Publish { return state; },
    get fx(): readonly PublishEffect[] { return fx; },
    on(e: PublishEvent) { const r = publishStep(state, e); state = r.state; fx = r.effects; return api; },
    changed(gen: Gen = G) { return api.on({ type: 'changed', gen }); },
    due(gen: Gen = G) { return api.on({ type: 'due', gen }); },
    answered(put: PutAnswer, gen: Gen = G) { return api.on({ type: 'answered', gen, put }); },
    left() { return api.on({ type: 'left' }); },
  };
  return api;
}
/** The doc in state `at`, its put (or its timer) of stretch `G`. */
const at = (s: PublishAt, tooBig = false): Publish => (s === 'idle' ? { at: s, tooBig } : { at: s, gen: G, tooBig });
const event = (type: PublishEventType, gen: Gen = G): PublishEvent => (type === 'left' ? { type } : type === 'answered' ? { type, gen, put: 'stored' } : { type, gen });

describe('the table: every state against every event', () => {
  // what the chart in docs/state-machines.md draws; a blank cell keeps the state and asks nothing
  const CELLS: Record<PublishAt, Partial<Record<PublishEventType, PublishAt>>> = {
    idle: { changed: 'waiting', left: 'idle' },
    waiting: { due: 'sending', left: 'idle' },
    sending: { changed: 'sendingStale', answered: 'idle', left: 'idle' },
    sendingStale: { answered: 'waiting', left: 'idle' },
  };
  for (const from of PUBLISH_STATES) {
    for (const type of PUBLISH_EVENTS) {
      const to = CELLS[from][type];
      test(`${from} on ${type}: ${to ?? 'stays'}`, () => {
        const r = publishStep(at(from), event(type));
        if (to === undefined) expect(r).toEqual({ state: at(from), effects: [] });
        else expect(r.state.at).toBe(to);
      });
    }
  }
  for (const from of PUBLISH_STATES.filter(s => s !== 'idle')) {
    test(`${from}: a change, a timer or an answer of another stretch of the link moves nothing`, () => {
      for (const type of ['changed', 'due', 'answered'] as const) expect(publishStep(at(from), event(type, G2))).toEqual({ state: at(from), effects: [] });
    });
  }
  test('nothing due: a change of any stretch starts the wait in that stretch', () => {
    expect(publishStep(PUBLISH_IDLE, { type: 'changed', gen: G2 })).toEqual({ state: { at: 'waiting', gen: G2, tooBig: false }, effects: [{ type: 'setTimer', gen: G2 }] });
  });
});

describe('one put of a doc at a time', () => {
  test('a change sets the timer, and the timer puts the doc, both in the stretch of the change', () => {
    const r = run().changed();
    expect([r.state, r.fx]).toEqual([{ at: 'waiting', gen: G, tooBig: false }, [{ type: 'setTimer', gen: G }]]);
    r.due();
    expect([r.state, r.fx]).toEqual([{ at: 'sending', gen: G, tooBig: false }, [{ type: 'put', gen: G }]]);
    r.answered('stored');
    expect([r.state, r.fx]).toEqual([PUBLISH_IDLE, []]);
  });
  test('more changes while the timer runs put once', () => {
    const r = run().changed().changed().changed();
    expect([r.state.at, r.fx]).toEqual(['waiting', []]);
  });
  test('a change while the put is out puts nothing beside it: once it is answered, the timer is set again', () => {
    const r = run().changed().due().changed();
    expect([r.state.at, r.fx]).toEqual(['sendingStale', []]);
    r.changed().due();
    expect([r.state.at, r.fx]).toEqual(['sendingStale', []]);
    for (const put of ['stored', 'failed', 'unsent', 'tooBig'] as const) {
      const s = run().changed().due().changed().answered(put);
      expect([s.state.at, s.fx.filter(x => x.type !== 'status')]).toEqual(['waiting', [{ type: 'setTimer', gen: G }]]);
    }
  });
  test('the fight doc follows a change in 200 ms, every other doc in 800 ms', () => {
    expect([publishWait('fight'), publishWait('world'), publishWait('rules'), publishWait('codex'), publishWait('solo'), publishWait('feats')]).toEqual([200, 800, 800, 800, 800, 800]);
  });
});

describe('the GM leaves the room, or switches to another, with a put out (SMX-sync-3.1, 3.3)', () => {
  test('the doc is idle at once, so the next room has it put at its first change, not after the old put\'s 20 s', () => {
    for (const from of ['waiting', 'sending', 'sendingStale'] as const) {
      const r = run(at(from)).left();
      expect([r.state, r.fx]).toEqual([PUBLISH_IDLE, []]);
      r.changed(G2).due(G2);
      expect([r.state, r.fx]).toEqual([{ at: 'sending', gen: G2, tooBig: false }, [{ type: 'put', gen: G2 }]]);
    }
  });
  test('the old room\'s refusal as too big, heard after the next room\'s put went out, moves nothing: no second put, no mark', () => {
    const r = run().changed().due().left().changed(G2).due(G2).answered('tooBig', G);
    expect([r.state, r.fx]).toEqual([{ at: 'sending', gen: G2, tooBig: false }, []]);
    r.answered('stored', G2);
    expect(r.state).toEqual(PUBLISH_IDLE);
  });
  test('the old room\'s timer, firing after a change in the next room, does not cut the next room\'s wait short', () => {
    const r = run().changed().left().changed(G2).due(G);
    expect([r.state, r.fx]).toEqual([{ at: 'waiting', gen: G2, tooBig: false }, []]);
  });
});

describe('a doc the room refused as too big', () => {
  test('is marked until the room takes one, and the pill hears each change of the mark; a put with no answer keeps it', () => {
    const r = run().changed().due().answered('tooBig');
    expect([r.state, r.fx]).toEqual([{ at: 'idle', tooBig: true }, [{ type: 'status' }]]);
    r.changed().due().answered('failed');
    expect([r.state, r.fx]).toEqual([{ at: 'idle', tooBig: true }, []]);
    r.changed().due().answered('stored');
    expect([r.state, r.fx]).toEqual([{ at: 'idle', tooBig: false }, [{ type: 'status' }]]);
  });
  test('then closed, so there is no doc to put (or the room holds it as it is): the mark clears (SMX-sync-3.2)', () => {
    const r = run().changed().due().answered('tooBig').changed().due().answered('unsent');
    expect([r.state, r.fx]).toEqual([{ at: 'idle', tooBig: false }, [{ type: 'status' }]]);
  });
  test('the GM leaves the room: the mark clears with it, and the pill hears it', () => {
    const r = run().changed().due().answered('tooBig').left();
    expect([r.state, r.fx]).toEqual([PUBLISH_IDLE, [{ type: 'status' }]]);
    const s = run().changed().due().answered('tooBig').changed().left();
    expect([s.state, s.fx]).toEqual([PUBLISH_IDLE, [{ type: 'status' }]]);
  });
});

describe('random changes, timers, answers and leaves', () => {
  test('never two puts out in a stretch, an old stretch\'s answer moves nothing, and every change is followed by a put built after it', () => {
    let seed = 7;
    const rand = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let walk = 0; walk < 300; walk++) {
      let state: Publish = PUBLISH_IDLE, gen = 1 as Gen, timers: Gen[] = [], out: Gen[] = [], version = 0, built = -1, putVersions: number[] = [];
      const carry = (effects: readonly PublishEffect[]): void => {
        for (const fx of effects) {
          if (fx.type === 'setTimer') timers = [...timers, fx.gen];
          if (fx.type === 'put') {
            expect(fx.gen, `walk ${walk}: a put goes out in the stretch the link is in`).toBe(gen);
            expect(out.filter(g => g === gen), `walk ${walk}: one put out in a stretch`).toEqual([]);
            out = [...out, fx.gen]; built = version; putVersions = [...putVersions, version];
          }
        }
      };
      const on = (e: PublishEvent): void => { const r = publishStep(state, e); state = r.state; carry(r.effects); };
      const take = <T>(xs: T[], i: number): [T, T[]] => [xs[i]!, xs.filter((_, j) => j !== i)];
      for (let i = 0; i < 40; i++) {
        const pick = rand(4);
        if (pick === 0) { version++; on({ type: 'changed', gen }); }
        else if (pick === 1 && timers.length) { const [g, rest] = take(timers, rand(timers.length)); timers = rest; on({ type: 'due', gen: g }); }
        else if (pick === 2 && out.length) { const [g, rest] = take(out, rand(out.length)); out = rest; on({ type: 'answered', gen: g, put: (['stored', 'tooBig', 'failed', 'unsent'] as const)[rand(4)]! }); }
        else if (pick === 3 && rand(4) === 0) { gen = (gen + 1) as Gen; on({ type: 'left' }); expect(state, `walk ${walk}: leaving the stretch leaves nothing due and no mark`).toEqual(PUBLISH_IDLE); version = 0; built = -1; on({ type: 'changed', gen }); version++; }
      }
      while (timers.length || out.length) {
        if (out.length) { const [g, rest] = take(out, 0); out = rest; on({ type: 'answered', gen: g, put: 'stored' }); }
        else { const [g, rest] = take(timers, 0); timers = rest; on({ type: 'due', gen: g }); }
      }
      expect(state.at).toBe('idle');
      if (version > 0) expect(built, `walk ${walk}: the last put was built after the last change (puts ${putVersions.join(',')})`).toBe(version);
    }
  });
});

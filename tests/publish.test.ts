// The GM's room doc publisher (src/core/sync/publish.ts): each cell, and a walk of random changes, timers and answers
// against an edge that counts the puts out, built from the rule: at most one put of a doc is out at a time, and the doc
// as it was at the last change is put after that change.
import { describe, expect, test } from 'bun:test';
import { PUBLISH_IDLE, PUBLISH_STATES, TABLE, publishStep, publishWait } from '../src/core/sync/publish.ts';
import type { Publish, PublishEffect, PublishEvent, PutAnswer } from '../src/core/sync/publish.ts';
import type { Gen } from '../src/core/sync/link.ts';

const G = 3 as Gen;
function run(state: Publish = PUBLISH_IDLE) {
  let fx: readonly PublishEffect[] = [];
  const api = {
    get state(): Publish { return state; },
    get fx(): readonly PublishEffect[] { return fx; },
    on(e: PublishEvent) { const r = publishStep(state, e); state = r.state; fx = r.effects; return api; },
    changed() { return api.on({ type: 'changed' }); },
    due() { return api.on({ type: 'due' }); },
    answered(put: PutAnswer, gen: Gen = G) { return api.on({ type: 'answered', gen, put }); },
  };
  return api;
}

describe('one put of a doc at a time', () => {
  test('a change sets the timer, and the timer puts the doc', () => {
    const r = run().changed();
    expect([r.state.at, r.fx]).toEqual(['waiting', [{ type: 'setTimer' }]]);
    r.due();
    expect([r.state.at, r.fx]).toEqual(['sending', [{ type: 'put' }]]);
    r.answered('stored');
    expect([r.state.at, r.fx]).toEqual(['idle', []]);
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
      expect([s.state.at, s.fx.filter(x => x.type !== 'status')]).toEqual(['waiting', [{ type: 'setTimer' }]]);
    }
  });
  test('the fight doc follows a change in 200 ms, every other doc in 800 ms', () => {
    expect([publishWait('fight'), publishWait('world'), publishWait('rules'), publishWait('codex'), publishWait('solo'), publishWait('feats')]).toEqual([200, 800, 800, 800, 800, 800]);
  });
  test('every state has a cell for every event', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...PUBLISH_STATES].sort());
  });
});

describe('a doc the room refused as too big', () => {
  test('is marked with the stretch of the link it was refused in until the room takes one, and the pill hears each change', () => {
    const r = run().changed().due().answered('tooBig');
    expect([r.state, r.fx]).toEqual([{ at: 'idle', tooBig: G }, [{ type: 'status' }]]);
    r.changed().due().answered('failed');
    expect([r.state, r.fx]).toEqual([{ at: 'idle', tooBig: G }, []]);
    r.changed().due().answered('unsent');
    expect(r.state.tooBig).toBe(G);
    r.changed().due().answered('stored');
    expect([r.state, r.fx]).toEqual([{ at: 'idle', tooBig: null }, [{ type: 'status' }]]);
  });
});

describe('random changes, timers and answers', () => {
  test('never two puts out, and every change is followed by a put built after it', () => {
    let seed = 7;
    const rand = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let walk = 0; walk < 300; walk++) {
      let state: Publish = PUBLISH_IDLE, timer = false, out = 0, version = 0, built = -1, putVersions: number[] = [];
      const carry = (effects: readonly PublishEffect[]): void => {
        for (const fx of effects) {
          if (fx.type === 'setTimer') timer = true;
          if (fx.type === 'put') { out++; built = version; putVersions = [...putVersions, version]; expect(out).toBe(1); }
        }
      };
      const on = (e: PublishEvent): void => { const r = publishStep(state, e); state = r.state; carry(r.effects); };
      for (let i = 0; i < 40; i++) {
        const pick = rand(3);
        if (pick === 0) { version++; on({ type: 'changed' }); }
        else if (pick === 1 && timer) { timer = false; on({ type: 'due' }); }
        else if (pick === 2 && out > 0) { out--; on({ type: 'answered', gen: G, put: (['stored', 'tooBig', 'failed', 'unsent'] as const)[rand(4)]! }); }
      }
      while (timer || out > 0) {
        if (out > 0) { out--; on({ type: 'answered', gen: G, put: 'stored' }); }
        else { timer = false; on({ type: 'due' }); }
      }
      expect(state.at).toBe('idle');
      if (version > 0) expect(built, `walk ${walk}: the last put was built after the last change (puts ${putVersions.join(',')})`).toBe(version);
    }
  });
});

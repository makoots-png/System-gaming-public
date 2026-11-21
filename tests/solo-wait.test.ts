// A player's won run of a room's solo gate until the GM's phone answers it (src/core/gates/solo-wait.ts,
// notes-2-solo.md section 5): what the player sees comes from the run and the outbox, every cell of the machine, and a
// random walk of runs, sends, refusals, answers and a room gone in which no run is ever answered twice.
import { describe, expect, test } from 'bun:test';
import { freshSave } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import { RUNS_MAX, WAIT_EVENTS, WAIT_STATES, mayDismiss, parseRuns, runAnswered, runDismissed, runPosted, runTaken, runsGone, shownOf, waitStep, waitWords, waitingGates } from '../src/core/gates/solo-wait.ts';
import type { WaitingRun } from '../src/core/gates/solo-wait.ts';
import { post, step } from '../src/core/sync/outbox.ts';
import type { Outbox } from '../src/core/sync/outbox.ts';
import { newEvent } from '../src/core/protocol.ts';
import type { EventId, RoomEvent } from '../src/core/protocol.ts';
import { dev, room } from './fixtures/ids.ts';

const AT = '2026-11-18T10:00:00.000Z', ROOM = room('ABCD23'), OTHER = room('WXYZ45');
const save0 = (): Save => freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-p1') }, { onboarded: true });
const runEvent = (n: number): RoomEvent => newEvent('soloRun', { by: 'd-p1:h1' as never, gate: `g${n}` as never, name: 'Kai', outcome: 'won', rounds: 4, life: 'up' }, { device: 'd-p1', now: Date.parse(AT) + n, rand: 0.5 })!;
const run = (ev: RoomEvent, r = ROOM): WaitingRun => ({ run: ev.payload.eid, room: r, hid: 'h1' as never, gate: (ev.type === 'soloRun' ? ev.payload.gate : 'g0') as never, name: 'Den', at: AT, state: 'posted' });
/** The save with run `ev` posted: its letter in the outbox and the run waiting, as `soloRan` writes them. */
const posted = (s: Save, ev: RoomEvent, r = ROOM): Save => {
  const box = post(s.settings.sync.outbox ?? [], r, { kind: 'event', event: ev }).box;
  return runPosted({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, outbox: box } } }, run(ev, r));
};
const withBox = (s: Save, f: (b: Outbox) => Outbox): Save => ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, outbox: f(s.settings.sync.outbox ?? []) } } });
const shown = (s: Save) => (s.settings.sync.runs ?? []).map(w => [w.gate, shownOf(w, s.settings.sync.outbox ?? []).state]);

describe('what the player sees of a waiting run', () => {
  const ev = runEvent(1);
  test('posted while its letter waits or is on its way; taken once the room took it; lost when the room refused it or it was let go', () => {
    let s = posted(save0(), ev);
    expect(shown(s)).toEqual([['g1', 'posted']]);
    s = withBox(s, b => step(b, ev.payload.eid, { type: 'send' }));
    expect(shown(s)).toEqual([['g1', 'posted']]);
    const taken = withBox(runTaken(s, ev.payload.eid), b => step(b, ev.payload.eid, { type: 'sent' }));
    expect(shown(taken)).toEqual([['g1', 'taken']]);
    expect(waitWords(taken.settings.sync.runs![0]!, [])).toBe('Cleared. Waiting for the GM\'s phone to pay it.');
    const refused = withBox(s, b => step(b, ev.payload.eid, { type: 'refused', why: 'bad event' }));
    expect(shown(refused)).toEqual([['g1', 'lost']]);
    expect(shownOf(refused.settings.sync.runs![0]!, refused.settings.sync.outbox!).why).toBe('refused');
    const dropped = withBox(s, b => step(b, ev.payload.eid, { type: 'drop' }));
    expect(shownOf(dropped.settings.sync.runs![0]!, dropped.settings.sync.outbox!)).toEqual({ state: 'lost', why: 'dropped' });
    expect(waitWords(runsGone(taken, ROOM).settings.sync.runs![0]!, [])).toBe('The room is gone, so the run paid nothing. Its cost stays.');
  });

  test('the gates with a run waiting, by room and hunter: a lost run no longer holds its gate', () => {
    const s = posted(posted(save0(), runEvent(1)), runEvent(2), OTHER);
    expect(waitingGates(s, ROOM, 'h1')).toEqual(['g1']);
    expect(waitingGates(withBox(s, b => step(b, runEvent(1).payload.eid, { type: 'drop' })), ROOM, 'h1')).toEqual([]);
  });
});

describe('the machine', () => {
  // Each shown state against each event, the refused cells too: what the player sees next (`stays` where the event does
  // not apply, `end` where the run leaves the list). The rule: the room's taking moves only a posted run; an answer
  // closes a run still waiting; a room gone loses a run still waiting; the player puts away a lost run, or stops waiting
  // for one the room took (SMX-gates-2.4: a GM's phone that missed it would hold it, and its gate, for good).
  const EXPECTED = {
    posted: { taken: 'taken', answered: 'end', roomGone: 'lost', dismiss: 'stays' },
    taken: { taken: 'stays', answered: 'end', roomGone: 'lost', dismiss: 'end' },
    lost: { taken: 'stays', answered: 'stays', roomGone: 'stays', dismiss: 'end' },
  } as const;
  /** A run in shown state `st`, with the outbox it is read with. */
  const at = (st: (typeof WAIT_STATES)[number]): { w: WaitingRun; box: Outbox } => {
    const ev = runEvent(1), s = posted(save0(), ev), w = s.settings.sync.runs![0]!, box = s.settings.sync.outbox!;
    return st === 'posted' ? { w, box } : st === 'taken' ? { w: { ...w, state: 'taken' }, box: [] } : { w, box: [] };
  };
  test('every state answers every event as the rule says, the refused cells too', () => {
    for (const st of WAIT_STATES) for (const e of WAIT_EVENTS) {
      const { w, box } = at(st);
      expect(shownOf(w, box).state, st).toBe(st);
      const out = waitStep(w, box, { type: e });
      const seen = out === 'end' ? 'end' : out === w ? 'stays' : shownOf(out, box).state;
      expect(`${st} × ${e}: ${seen}`).toBe(`${st} × ${e}: ${EXPECTED[st][e]}`);
    }
  });

  test('an answer closes a posted or taken run; a lost one waits only for the player to put it away', () => {
    const ev = runEvent(1), s = posted(save0(), ev), id = ev.payload.eid;
    expect(ok<Save>(runAnswered(s, id)).settings.sync.runs).toEqual([]);
    expect(ok<Save>(runAnswered(withBox(runTaken(withBox(s, b => step(b, id, { type: 'send' })), id), b => step(b, id, { type: 'sent' })), id)).settings.sync.runs).toEqual([]);
    const lost = runsGone(s, ROOM);
    expect(runAnswered(lost, id)).toEqual({ ok: false, why: 'no-run' });
    expect(runDismissed(s, id), 'a run whose letter is still on its way is not put away').toEqual({ ok: false, why: 'no-run' });
    expect(ok<Save>(runDismissed(lost, id)).settings.sync.runs).toEqual([]);
    expect(runAnswered(save0(), id), 'no run, no answer').toEqual({ ok: false, why: 'no-run' });
  });

  // SMX-gates-2.4: the room took the run, and the GM's phone never pays it (a read-only GM tab, a GM who cleared the
  // gate by hand). The player stops waiting: the gate is free to run again, and an answer that comes after pays nothing.
  test('a run the room took and the GM\'s phone never answers can be put away; its gate is free again and a late answer pays nothing', () => {
    const ev = runEvent(1), id = ev.payload.eid;
    const sending = withBox(posted(save0(), ev), b => step(b, id, { type: 'send' }));
    const taken = withBox(runTaken(sending, id), b => step(b, id, { type: 'sent' }));
    expect(shown(taken)).toEqual([['g1', 'taken']]);
    expect(waitingGates(taken, ROOM, 'h1'), 'the gate is held while the run waits').toEqual(['g1']);
    expect(mayDismiss(taken.settings.sync.runs![0]!, [])).toBe(true);
    expect(mayDismiss(sending.settings.sync.runs![0]!, sending.settings.sync.outbox!), 'a run on its way waits for the room').toBe(false);
    const away = ok<Save>(runDismissed(taken, id));
    expect(away.settings.sync.runs).toEqual([]);
    expect(waitingGates(away, ROOM, 'h1')).toEqual([]);
    expect(runAnswered(away, id), 'the answer after pays nothing').toEqual({ ok: false, why: 'no-run' });
  });

  test('a room gone loses only its own runs', () => {
    const s = runsGone(posted(posted(save0(), runEvent(1)), runEvent(2), OTHER), ROOM);
    expect(shown(s)).toEqual([['g1', 'lost'], ['g2', 'posted']]);
  });

  test('one run per id, and at most RUNS_MAX: past it the oldest lost run goes first', () => {
    let s = save0();
    for (let i = 1; i <= RUNS_MAX; i++) s = posted(s, runEvent(i));
    expect(posted(s, runEvent(1)).settings.sync.runs).toHaveLength(RUNS_MAX);
    const lostThird = withBox(s, b => step(b, runEvent(3).payload.eid, { type: 'drop' }));
    const more = posted(lostThird, runEvent(99));
    expect(more.settings.sync.runs!.map(w => w.gate)).not.toContain('g3');
    expect(more.settings.sync.runs).toHaveLength(RUNS_MAX);
  });

  test('stored runs are read whole or dropped', () => {
    const w = run(runEvent(1));
    expect(parseRuns([w, { ...w, run: 'has space' }, { ...w, state: 'paid' }, w, 'x'])).toEqual([w]);
    expect(parseRuns(null)).toEqual([]);
  });

  // Random sends, refusals, drops, answers (some twice), rooms gone and dismissals: an answer closes a run at most once,
  // and a run is never answered after it is lost or put away.
  test('a random walk never answers a run twice', () => {
    let seed = 7;
    const rand = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let walk = 0; walk < 200; walk++) {
      let s = save0();
      const paid = new Map<EventId, number>(), events = [1, 2, 3].map(runEvent), made = new Set<EventId>();
      for (let k = 0; k < 40; k++) {
        const ev = events[rand(3)]!, id = ev.payload.eid, box = s.settings.sync.outbox ?? [];
        switch (rand(7)) {
          case 0: if (!made.has(id)) { made.add(id); s = posted(s, ev); } break; // a run is written once, with a fresh id
          case 1: if (box.some(e => e.id === id && e.at === 'queued')) s = withBox(s, b => step(b, id, { type: 'send' })); break;
          case 2: if (box.some(e => e.id === id && e.at === 'sending')) s = withBox(runTaken(s, id), b => step(b, id, { type: 'sent' })); break; // as sync.ts: heard, then the box
          case 3: s = withBox(s, b => step(b, id, rand(2) ? { type: 'drop' } : { type: 'refused', why: 'no' })); break;
          case 4: { const r = runAnswered(s, id); if (!isRefused(r)) { s = r; paid.set(id, (paid.get(id) ?? 0) + 1); } break; }
          case 5: s = runsGone(s, ROOM); break;
          case 6: { const r = runDismissed(s, id); if (!isRefused(r)) s = r; break; }
        }
        for (const w of s.settings.sync.runs ?? []) expect(waitStep(w, s.settings.sync.outbox ?? [], { type: 'taken' }) === 'end').toBe(false);
      }
      for (const n of paid.values()) expect(n).toBe(1);
    }
  });
});

function ok<T>(r: T | { ok: false; why: string }): T { if (isRefused(r as never)) throw new Error('refused'); return r as T; }

// The System's clock for one hunter (src/core/gates/solo.ts `soloTick`, personal.ts) and a player's won run waiting for
// the GM's answer (src/core/gates/solo-wait.ts), each with every event of its life, walked by the state charts
// (scripts/charts/solo.ts); tests/statecharts.test.ts checks each walk reaches every state. tests/solo.test.ts and
// tests/solo-wait.test.ts check the cells.
import { RULES } from '../../src/core/rules.ts';
import type { Rules } from '../../src/core/rules.ts';
import { freshSave, newHunter } from '../../src/core/save.ts';
import type { Hunter, Save } from '../../src/core/save.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { soloTick } from '../../src/core/gates/solo.ts';
import { newEvent } from '../../src/core/protocol.ts';
import type { RoomCode } from '../../src/core/protocol.ts';
import { post, step } from '../../src/core/sync/outbox.ts';
import type { Outbox } from '../../src/core/sync/outbox.ts';
import { runAnswered, runDismissed, runPosted, runTaken, runsGone } from '../../src/core/gates/solo-wait.ts';

const T0 = Date.parse('2026-11-18T10:00:00.000Z'), HOUR = 3600e3;
const fresh = (): Save => freshSave({ now: new Date(T0), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => 'd-chart' as never }, { onboarded: true });

// ── the clock ──
/** One hunter's clock and gates at a moment, with the personal gates' switch as the rules hold it. */
export type ClockWorld = { readonly save: Save; readonly now: number; readonly personal: boolean };
export type ClockEvent = { readonly type: 'time'; readonly hours: number } | { readonly type: 'switch'; readonly personal: boolean } | { readonly type: 'die' } | { readonly type: 'revive' };
export const CLOCK_START: ClockWorld = { save: { ...fresh(), hunters: [{ ...newHunter(RULES), id: 'h1' as never, name: 'Mira' }] }, now: T0, personal: true };
/** Time passes (a tick at the next wake: an hour, a spawn's hours, a day and more), the GM's switch, a death and a revive. */
export const CLOCK_EVENTS: readonly ClockEvent[] = [
  { type: 'time', hours: 0 }, { type: 'time', hours: 8 }, { type: 'time', hours: 30 }, { type: 'switch', personal: false }, { type: 'switch', personal: true },
  { type: 'die' }, { type: 'revive' },
];
const life = (w: ClockWorld, l: Hunter['life']): Save => ({ ...w.save, hunters: w.save.hunters.map(h => ({ ...h, life: l })) });
/** The world after `e`: the change, then the tick the one timer runs (its dice from a fixed seed). */
export function clockStep(w: ClockWorld, e: ClockEvent): ClockWorld {
  const moved: ClockWorld = e.type === 'time' ? { ...w, now: w.now + e.hours * HOUR } : e.type === 'switch' ? { ...w, personal: e.personal }
    : { ...w, save: life(w, e.type === 'die' ? { at: 'dead' } : { at: 'up', hp: 1 }) };
  const R: Rules = { ...RULES, solo: { ...RULES.solo, personal: moved.personal } };
  const t = soloTick(moved.save, { now: new Date(moved.now), R, gm: false, seed: 7 });
  return isRefused(t) ? moved : { ...moved, save: t.save };
}
/** What makes two clock worlds the same: the clock, the next spawn from now, the gates held, the hunter's life, the switch. */
export const clockKey = (w: ClockWorld): string => {
  const h = w.save.hunters[0]!, c = h.solo.clock;
  return JSON.stringify([c.at, c.at === 'on' ? Math.round((Date.parse(c.next) - w.now) / HOUR) : null, h.solo.gates.length, h.life.at, w.personal]);
};

// ── the waiting run ──
const ROOM = 'ABCD23' as RoomCode;
const EVENT = newEvent('soloRun', { by: 'd-chart:h1' as never, gate: 'g1' as never, name: 'Mira', outcome: 'won', rounds: 4, life: 'up' }, { device: 'd-chart', now: T0, rand: 0.5 })!;
const RUN = EVENT.payload.eid;
/** A player's save with nothing waiting, or the run waiting with its letter, or the run gone (answered or put away). */
export type WaitWorld = Save;
export type WaitModelEvent = { readonly type: 'send' | 'sent' | 'failed' | 'refused' | 'drop' | 'answered' | 'roomGone' | 'dismiss' };
const withBox = (s: Save, f: (b: Outbox) => Outbox): Save => ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, outbox: f(s.settings.sync.outbox ?? []) } } });
/** The run just written by `soloRan`: its letter queued in the outbox, the run posted. */
export const WAIT_START: WaitWorld = runPosted(withBox(fresh(), b => post(b, ROOM, { kind: 'event', event: EVENT }).box),
  { run: RUN, room: ROOM, hid: 'h1' as never, gate: 'g1' as never, name: 'Den', at: new Date(T0).toISOString(), state: 'posted' });
export const WAIT_EVENTS: readonly WaitModelEvent[] = ['send', 'sent', 'failed', 'refused', 'drop', 'answered', 'roomGone', 'dismiss'].map(type => ({ type } as WaitModelEvent));
/** The save after `e`, as sync.ts and the appliers write it: the room's `sent` heard as the run taken before the letter leaves. */
export function waitModelStep(s: WaitWorld, e: WaitModelEvent): WaitWorld {
  const keep = <X>(x: X | { ok: false }): WaitWorld => (isRefused(x as never) ? s : (x as unknown as WaitWorld));
  const t = e.type;
  switch (t) {
    case 'send': case 'failed': case 'drop': return withBox(s, b => step(b, RUN, { type: t }));
    case 'refused': return withBox(s, b => step(b, RUN, { type: 'refused', why: 'bad event' }));
    case 'sent': return (s.settings.sync.outbox ?? []).some(x => x.id === RUN && x.at === 'sending') ? withBox(runTaken(s, RUN), b => step(b, RUN, { type: 'sent' })) : s;
    case 'answered': return keep(runAnswered(s, RUN));
    case 'roomGone': return runsGone(s, ROOM);
    case 'dismiss': return keep(runDismissed(s, RUN));
  }
}

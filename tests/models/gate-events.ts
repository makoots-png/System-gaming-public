// The Goblin Den and the events of a gate's short lives. Shared by tests/gate.test.ts and the state charts
// (scripts/charts/gate.ts), so both walk the same events.
import { GATE_STATUSES } from '../../src/core/gates/gate.ts';
import type { Gate, GateEvent, GateId, GateStatus, MonsterId } from '../../src/core/gates/gate.ts';
import { NO_PRESET } from '../../src/core/gates/preset.ts';

export const gid = (s: string): GateId => s as GateId;
export const mid = (s: string): MonsterId => s as MonsterId;

/** Three goblins and a hobgoblin boss: 3 x 25 + 75 = 150 XP. It breaks on day 5. */
export const fields = () => ({
  id: gid('g-den'), name: 'Goblin Den', rank: 'E' as const, type: 'normal' as const, breakDay: 5,
  monsters: [{ monsterId: mid('m-goblin'), count: 3 }], bossId: mid('m-hob'), notes: '', createdDay: 1, xpPaid: 0, mapId: null, fought: [] as string[], solo: false, preset: NO_PRESET,
});
/** The den in `status`. A cleared den was cleared on day 2. */
export function den(status: GateStatus, xpPaid = 0): Gate {
  return status === 'cleared' ? { ...fields(), xpPaid, status, clearedDay: 2 } : { ...fields(), xpPaid, status };
}

/** 13 events: a day before and after the den's break day, the GM's edit to each status, and a payment and a refused one. */
export const WALK_EVENTS: GateEvent[] = [
  { type: 'enter' }, { type: 'fightStarted' }, { type: 'dayAdvanced', day: 3 }, { type: 'dayAdvanced', day: 9 }, { type: 'clear', day: 7 },
  { type: 'close' }, ...GATE_STATUSES.map((status): GateEvent => ({ type: 'gmSet', status, day: 8 })), { type: 'paid', xp: 60 }, { type: 'paid', xp: -60 },
];

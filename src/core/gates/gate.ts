// gate.ts: what a gate is, the one table of how its status changes, and the one rule for its XP. Pure.
// The gates view (src/views/gates.js) and the fight's end (src/views/combat.js) change a gate only through `transition`.
// The save repair reads a stored gate through `parseGate`.
import { RANKS } from '../rules.ts';
import { oneOf } from '../one-of.ts';
import type { Rank } from '../rules.ts';
import type { GateId, MapId, MonsterId } from '../ids.ts';
import { mapId } from '../registry/maps.ts';

// ── ids ──
export type { GateId, MonsterId };

// ── the gate ──
export const GATE_TYPES = ['normal', 'red', 'double', 'break'] as const;
/** The types a spawn may give a gate (a GM's spawn, the roll, the GM view's form): a `break` gate comes from a story, not a spawn. */
export const SPAWN_TYPES = ['normal', 'red', 'double'] as const satisfies readonly (typeof GATE_TYPES)[number][];
export const GATE_STATUSES = ['detected', 'raiding', 'cleared', 'broken', 'closed'] as const;
export type GateType = (typeof GATE_TYPES)[number];
export type GateStatus = (typeof GATE_STATUSES)[number];

/** One line of a gate's roster: `count` of one bestiary monster. */
export type GateMonster = { monsterId: MonsterId; count: number };
/** What every gate has. `xpPaid` is all the XP this gate has paid out: fights in it that awarded XP, and its Clear. */
export type GateFields = {
  id: GateId; name: string; rank: Rank; type: GateType; breakDay: number; monsters: GateMonster[]; bossId: MonsterId | null;
  notes: string; createdDay: number; xpPaid: number;
  /** The battle map its fights are fought on (an id in the GM's `library.maps`), or null for the open arena. */
  mapId: MapId | null;
  /**
   * Who fought its last fight that was settled (`settleEncounter`, pay.ts): local hunter ids and players' sheet keys.
   * Its Clear offers them first. Kept on the gate, so a reload keeps it.
   */
  fought: string[];
  /** Open to solo runs: a hunter may enter it alone (gates/solo.ts), the GM's mark in the edit form. */
  solo: boolean;
};
/** Only a cleared gate has the day it was cleared. */
export type Gate =
  | (GateFields & { status: Exclude<GateStatus, 'cleared'> })
  | (GateFields & { status: 'cleared'; clearedDay: number });

/** A detected gate on day 1 with nothing in it. The save repair fills a stored gate from it. */
export const newGate = (): Gate => ({
  id: 'g0' as GateId, name: '', rank: 'E', type: 'normal', status: 'detected', breakDay: 1, monsters: [], bossId: null, notes: '',
  createdDay: 1, xpPaid: 0, mapId: null, fought: [], solo: false,
});

// ── events ──
/**
 * What can happen to a gate. `day` is the world day it happened on. `gmSet` is the GM's edit form, which may set any
 * status. `paid` is XP paid out because of this gate: a fight in it, or its Clear.
 */
export type GateEvent =
  | { type: 'enter' }
  | { type: 'fightStarted' }
  | { type: 'dayAdvanced'; day: number }
  | { type: 'clear'; day: number }
  | { type: 'close' }
  | { type: 'gmSet'; status: GateStatus; day: number }
  | { type: 'paid'; xp: number };
export type GateEventType = GateEvent['type'];

// ── the table ──
type Step<T extends GateEventType> = (gate: Gate, event: Extract<GateEvent, { type: T }>) => Gate;
/** For one status: what each event does there. `null` means the event does not apply, and the gate stays as it is. */
type Row = { readonly [T in GateEventType]: Step<T> | null };

/** Every field but the status and the cleared day. */
const fieldsOf = (gate: Gate): GateFields => ({
  id: gate.id, name: gate.name, rank: gate.rank, type: gate.type, breakDay: gate.breakDay, monsters: gate.monsters, bossId: gate.bossId,
  notes: gate.notes, createdDay: gate.createdDay, xpPaid: gate.xpPaid, mapId: gate.mapId, fought: gate.fought, solo: gate.solo,
});
/** Leaving cleared drops the cleared day. Entering it stamps the day. */
const uncleared = (gate: Gate, status: Exclude<GateStatus, 'cleared'>): Gate => ({ ...fieldsOf(gate), status });
const cleared = (gate: Gate, day: number): Gate => ({ ...fieldsOf(gate), status: 'cleared', clearedDay: day });

/** A step that does not read its event. */
type Plain = (gate: Gate) => Gate;
const to = (status: Exclude<GateStatus, 'cleared'>): Plain => gate => uncleared(gate, status);
const stay: Plain = gate => gate;
const breaks: Step<'dayAdvanced'> = (gate, e) => (e.day >= gate.breakDay ? uncleared(gate, 'broken') : gate);
const clears: Step<'clear'> = (gate, e) => cleared(gate, e.day);
/** The GM may set any status. Setting the one the gate has changes nothing, so a cleared gate keeps its day. */
const gmSet: Step<'gmSet'> = (gate, e) => {
  if (e.status === gate.status) return gate;
  return e.status === 'cleared' ? cleared(gate, e.day) : uncleared(gate, e.status);
};
/** What a gate has paid only goes up. */
const paid: Step<'paid'> = (gate, e) => (Number.isFinite(e.xp) && e.xp > 0 ? { ...gate, xpPaid: gate.xpPaid + Math.trunc(e.xp) } : gate);

const TABLE: { readonly [S in GateStatus]: Row } = {
  detected: { enter: to('raiding'), fightStarted: to('raiding'), dayAdvanced: breaks, clear: clears, close: to('closed'), gmSet, paid },
  raiding: { enter: null, fightStarted: stay, dayAdvanced: breaks, clear: clears, close: to('closed'), gmSet, paid },
  broken: { enter: null, fightStarted: stay, dayAdvanced: null, clear: clears, close: to('closed'), gmSet, paid },
  cleared: { enter: null, fightStarted: null, dayAdvanced: null, clear: null, close: null, gmSet, paid },
  closed: { enter: null, fightStarted: null, dayAdvanced: null, clear: null, close: null, gmSet, paid },
};

/** The gate after `event`. The same gate when the event does not apply in its status. Never changes its input. */
export function transition(gate: Gate, event: GateEvent): Gate {
  // The table's type pairs each key with the step for that event, so the step for `event.type` takes `event`.
  const step = TABLE[gate.status][event.type] as Step<GateEventType> | null;
  return step ? step(gate, event as never) : gate;
}

/** Whether `event` applies to a gate in this status: what a view asks before it shows the button. */
export const can = (gate: { status: GateStatus }, type: GateEventType): boolean => TABLE[gate.status][type] !== null;

// ── XP. One payer rule: nothing here reads a gate's status. ──
/** A monster's XP from the bestiary, 0 for one it does not have. */
export type XpOf = (id: MonsterId) => number;

/** The roster's XP: each monster times its count, plus the boss. What one hunter gets for the whole gate with the split off. */
export function gateXp(gate: Pick<GateFields, 'monsters' | 'bossId'>, xpOf: XpOf): number {
  const roster = gate.monsters.reduce((sum, m) => sum + xpOf(m.monsterId) * m.count, 0);
  return roster + (gate.bossId ? xpOf(gate.bossId) : 0);
}
/** What the gate still owes: its XP less what it has paid, never below 0. Its Clear pays this. */
export const xpDue = (gate: Gate, xpOf: XpOf): number => Math.max(0, gateXp(gate, xpOf) - gate.xpPaid);
/**
 * What a fight that ends pays: a fight with no gate pays its own XP. A fight in a gate pays its own XP while the gate
 * still owes anything, and nothing once the gate owes nothing (its Clear or an earlier fight paid it).
 */
export const fightAward = (gate: Gate | null, fightXp: number, xpOf: XpOf): number => (!gate || xpDue(gate, xpOf) > 0 ? fightXp : 0);

// ── the boundary ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);
// Where a plain string becomes a gate or monster id. Nothing else in core makes one.
/** A gate id from a stored gate or a fight's link to it; null for an empty or too long one. */
export const parseGateId = (v: unknown): GateId | null => id(v) as GateId | null;
/** A monster id from a stored gate or the GM's edit form; null for an empty or too long one. */
export const monsterId = (v: unknown): MonsterId | null => id(v) as MonsterId | null;
/** A whole number of at least `lo`, or `d` when `v` is not a number. */
const int = (v: unknown, lo: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.trunc(v)) : d);
const text = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '');

/** Bounds for junk only. The spawner makes a handful of lines with counts under 10; the edit form allows `MONSTER_BOUNDS.copies` per line. */
const MAX_LINES = 50, MAX_COUNT = 999;

/**
 * The gate in `value`, bounded, or null when it is not one (not an object, or no id). Keys a gate does not have are
 * dropped. A cleared gate without a day takes the day it was created. Any other status drops a stored cleared day.
 */
/** At most this many fighters are kept on a gate: a fight's party is far smaller. */
const MAX_FOUGHT = 30;
export function parseGate(value: unknown): Gate | null {
  if (!isObj(value)) return null;
  const gid = parseGateId(value.id); if (!gid) return null;
  const d = newGate();
  const monsters: GateMonster[] = [];
  for (const raw of Array.isArray(value.monsters) ? value.monsters : []) {
    if (monsters.length >= MAX_LINES) break;
    const mid = isObj(raw) ? monsterId(raw.monsterId) : null;
    if (mid) monsters.push({ monsterId: mid, count: Math.min(MAX_COUNT, int(raw.count, 1, 1)) });
  }
  const createdDay = int(value.createdDay, 1, d.createdDay);
  const fields: GateFields = {
    id: gid, name: text(value.name, 60), rank: oneOf(value.rank, RANKS, 'E'), type: oneOf(value.type, GATE_TYPES, 'normal'),
    breakDay: int(value.breakDay, 0, d.breakDay), monsters, bossId: monsterId(value.bossId), notes: text(value.notes, 500), createdDay,
    xpPaid: int(value.xpPaid, 0, 0),
    mapId: typeof value.mapId === 'string' && value.mapId.length > 0 && value.mapId.length <= 40 ? mapId(value.mapId) : null,
    fought: Array.isArray(value.fought) ? value.fought.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80).slice(0, MAX_FOUGHT) : [],
    solo: value.solo === true,
  };
  const status = oneOf(value.status, GATE_STATUSES, 'detected');
  return status === 'cleared' ? { ...fields, status, clearedDay: int(value.clearedDay, 1, createdDay) } : { ...fields, status };
}

// ── a gate's countdown, as the GM and a player read it (implicit audit 3, G2) ──
/** How many days before its break a gate still open reads as soon. */
export const SOON_DAYS = 2;
/** A gate's countdown: its words and its tone (`over` past its day or broken, `soon` within `SOON_DAYS`, else none). */
export type Countdown = { readonly words: string; readonly tone: 'over' | 'soon' | null };
/** The one countdown of a gate on `day`, read by the GM's card and a player's: a cleared or closed gate says so, whatever its day. */
export function countdown(g: Pick<GateFields, 'breakDay'> & ({ status: Exclude<GateStatus, 'cleared'> } | { status: 'cleared'; clearedDay: number }), day: number): Countdown {
  const left = g.breakDay - day, open = g.status === 'detected' || g.status === 'raiding';
  const words = g.status === 'cleared' ? `Cleared on day ${g.clearedDay}` : g.status === 'closed' ? 'Gate closed' : g.status === 'broken' ? `Broke on day ${g.breakDay}. Monsters are loose`
    : left <= 0 ? 'Breaks today' : `Breaks in ${left} day${left === 1 ? '' : 's'}`;
  return { words, tone: g.status === 'broken' || (open && left <= 0) ? 'over' : open && left <= SOON_DAYS ? 'soon' : null };
}

// ── a gate as others see it (the room's world doc, protocol.ts `WorldGate`) ──
/** A gate's fields that a player sees, with its status: a cleared one with the day it was cleared. */
export type ShownGate = Pick<GateFields, 'id' | 'name' | 'rank' | 'type' | 'breakDay'> & ({ status: Exclude<GateStatus, 'cleared'> } | { status: 'cleared'; clearedDay: number });
/** `base` with `status`, and the cleared day for a cleared one (null for another reads as day 0): the one maker of a shown gate. */
export const shownGate = (base: Pick<GateFields, 'id' | 'name' | 'rank' | 'type' | 'breakDay'>, status: GateStatus, clearedDay: number | null): ShownGate =>
  status === 'cleared' ? { ...base, status, clearedDay: clearedDay ?? 0 } : { ...base, status };
/** Gate `g` as the world doc shows it, its name cut to `nameMax`. */
export const shownOf = (g: Gate, nameMax: number): ShownGate =>
  shownGate({ id: g.id, name: g.name.slice(0, nameMax), rank: g.rank, type: g.type, breakDay: g.breakDay }, g.status, g.status === 'cleared' ? g.clearedDay : null);

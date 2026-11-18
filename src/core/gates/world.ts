// world.ts: the world's day and the save's list of gates (`save.world`, `save.gates`), with the session log line each
// change writes. A gate's status and its XP paid change only through `transition` (gate.ts); these steps find the gate,
// run its event and log what happened. The gates view (gates.js) and the fight's end (combat.js) change the world only
// through these, with `store.apply`. Pure: the caller passes the time (`Stamp`), the rolled gate and the monsters made
// for it, the XP and loot already worked out. A step that changes nothing is refused (`missing`, `unchanged`).
import { can, shownOf, transition } from './gate.ts';
import type { ShownGate } from './gate.ts';
import type { Gate, GateEvent, GateMonster, GateStatus, GateType, MonsterId } from './gate.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { told } from '../session-log.ts';
import { WORLD_GATES, WORLD_NAME_MAX } from '../protocol.ts';
import type { WorldDoc } from '../protocol.ts';
import type { Stamp } from '../session-log.ts';
import type { Monster, Rank, Save } from '../save.ts';

/** The parts of the save a world step reads and writes. */
export type WorldParts = Pick<Save, 'world' | 'gates' | 'monsters' | 'log' | 'seq' | 'library'>;
export type WorldWhy = 'missing' | 'unchanged';
type Next<S> = S | Refused<WorldWhy>;

const gateLine = (title: string, text: string) => ({ kind: 'gate' as const, hunterId: null, title, text });

/** `event` on gate `id`: the save with the gate after it and what `line` says of it, or refused when nothing changed. */
function onGate<S extends WorldParts>(save: S, id: string, event: GateEvent, stamp: Stamp, line: ((g: Gate) => [string, string]) | null): Next<S> {
  const at = save.gates.findIndex(g => g.id === id);
  if (at < 0) return refuse('missing');
  const before = save.gates[at]!, after = transition(before, event);
  if (after === before) return refuse('unchanged');
  const next = { ...save, gates: save.gates.map((g, i) => (i === at ? after : g)) };
  return line ? told(next, stamp, gateLine(...line(after))) : next;
}

/** A spawned gate first in the list, with the monsters made for it (a rank the bestiary lacks) added to the save's. */
export function spawnGate<S extends WorldParts>(save: S, gate: Gate, made: readonly Monster[], stamp: Stamp): S {
  const next = { ...save, gates: [gate, ...save.gates], monsters: [...save.monsters, ...made] };
  return told(next, stamp, gateLine('Gate detected', `${gate.rank}-rank ${gate.type} gate "${gate.name}" appeared. It breaks on day ${gate.breakDay}.`));
}

/** What a move of the world day did: the save after it, the day it reached, the days it moved (never under day 1), the gates that broke. */
export type DayMoved<S> = { save: S; day: number; by: number; broke: Gate[] };
/** The "World day" line's words: what the move did. */
export const dayMovedText = (by: number, day: number): string => (by > 0 ? `Day advanced by ${by} to ${day}.` : `Day moved back by ${-by} to ${day}.`);

/**
 * The world day moved by `n` (never under day 1) and logged as it moved, then each gate whose break day it reaches
 * broken and logged. A move that leaves the day where it was (0 days, or back from day 1) is refused.
 */
export function advanceDay<S extends WorldParts>(save: S, n: number, stamp: Stamp): Next<DayMoved<S>> {
  const day = Math.max(1, save.world.day + (Math.trunc(n) || 0)), by = day - save.world.day, broke: Gate[] = [];
  if (!by) return refuse('unchanged');
  let next: S = told({ ...save, world: { ...save.world, day } }, stamp, gateLine('World day', dayMovedText(by, day)));
  for (const g of save.gates) {
    const r = onGate(next, g.id, { type: 'dayAdvanced', day }, stamp, x => ['DUNGEON BREAK', `${x.rank}-rank gate "${x.name}" has broken on day ${day}.`]);
    if ('ok' in r) continue;
    next = r;
    broke.push(next.gates.find(x => x.id === g.id)!);
  }
  return { save: next, day, by, broke };
}

/**
 * The GM starts a session: the save's count of sessions goes up by one and the world day by one (`advanceDay`, with its
 * breaks), and the session's line says its number, whether the backup taken just before was kept (`backup`), and the day.
 */
export function sessionStarted<S extends WorldParts>(save: S, backup: boolean, stamp: Stamp): Next<DayMoved<S> & { session: number }> {
  const moved = advanceDay(save, 1, stamp);
  if ('ok' in moved) return moved;
  const session = save.world.session + 1;
  const text = `${backup ? 'A backup was saved.' : 'No backup: this browser refused to store it.'} World day ${moved.day}.`;
  const next = told({ ...moved.save, world: { ...moved.save.world, session } }, stamp, { kind: 'system', hunterId: null, title: `Session ${session} began`, text });
  return { ...moved, save: next, session };
}

/** The party enters gate `id`. */
export const enterGate = <S extends WorldParts>(save: S, id: string, stamp: Stamp): Next<S> =>
  onGate(save, id, { type: 'enter' }, stamp, g => ['Gate entered', `The party entered "${g.name}".`]);

/** A hunter entered gate `id` alone (gates/solo.ts): a detected gate is raided from now; the run's own line tells of it. */
export const enteredAlone = <S extends WorldParts>(save: S, id: string, stamp: Stamp): Next<S> => onGate(save, id, { type: 'enter' }, stamp, null);

/** A fight starts inside gate `id`. A gate already raided or broken stays as it is, and the start is still logged. */
export function gateFightStarted<S extends WorldParts>(save: S, id: string, stamp: Stamp): Next<S> {
  const g = save.gates.find(x => x.id === id);
  if (!g) return refuse('missing');
  const r = onGate(save, id, { type: 'fightStarted' }, stamp, null), next = 'ok' in r ? save : r;
  return told(next, stamp, gateLine('Fight started', `Fighting inside "${g.name}" (${g.rank}-rank).`));
}

/** The GM closes gate `id`. */
export const closeGate = <S extends WorldParts>(save: S, id: string, stamp: Stamp): Next<S> =>
  onGate(save, id, { type: 'close' }, stamp, g => ['Gate closed', `"${g.name}" was closed.`]);

/** Gate `id` taken out of the list. */
export function deleteGate<S extends WorldParts>(save: S, id: string): Next<S> {
  if (!save.gates.some(g => g.id === id)) return refuse('missing');
  return { ...save, gates: save.gates.filter(g => g.id !== id) };
}

/** What the GM's edit form gives: each field as read from the form, the status the GM picked. */
export type GateEdit = {
  name: string; rank: Rank; type: GateType; breakDay: number; monsters: GateMonster[]; bossId: MonsterId | null; notes: string;
  mapId: string | null; status: GateStatus; solo: boolean;
};
/** The GM's edit of gate `id`: an empty name or a break day of 0 keeps the old one, a break day under 1 is day 1, a map the library lacks none. */
export function editGate<S extends WorldParts>(save: S, id: string, edit: GateEdit): Next<S> {
  const at = save.gates.findIndex(g => g.id === id);
  if (at < 0) return refuse('missing');
  const old = save.gates[at]!;
  const fields: Gate = {
    ...old, name: edit.name.trim().slice(0, 60) || old.name, rank: edit.rank, type: edit.type, breakDay: Math.max(1, Math.trunc(edit.breakDay) || old.breakDay),
    monsters: edit.monsters, bossId: edit.bossId, notes: edit.notes.trim().slice(0, 500),
    mapId: save.library.maps.find(m => m.id === edit.mapId)?.id ?? null, solo: edit.solo,
  };
  const set = transition(fields, { type: 'gmSet', status: edit.status, day: save.world.day });
  return { ...save, gates: save.gates.map((g, i) => (i === at ? set : g)) };
}

/** What a Clear pays, as gates.js worked it out: the XP and gold each payee gets, the items, the payees' names. */
export type ClearPay = { due: number; xp: number; gold: number; items: string[]; payees: string[] };
/** Gate `id` cleared on today's world day; when anyone is paid, the XP it still owed counts as paid. */
export function clearGate<S extends WorldParts>(save: S, id: string, pay: ClearPay, stamp: Stamp): Next<S> {
  const g = save.gates.find(x => x.id === id);
  if (!g) return refuse('missing');
  const cleared = onGate(save, id, { type: 'clear', day: save.world.day }, stamp, null);
  let next = 'ok' in cleared ? save : cleared;
  if (pay.payees.length) { const paid = onGate(next, id, { type: 'paid', xp: pay.due }, stamp, null); if (!('ok' in paid)) next = paid; }
  return told(next, stamp, gateLine('GATE CLEARED', `${g.rank}-rank gate "${g.name}" cleared. ${pay.payees.join(', ') || 'No one'} rewarded: +${pay.xp} XP, ${pay.gold} gold${pay.items.length ? `, ${pay.items.join(', ')}` : ''}.`));
}

/** A fight in gate `gateId` ended: its awarded XP (0 when none) counts as paid, and the end is logged as a combat line. */
export function encounterEnded<S extends WorldParts>(save: S, end: { gateId: string | null; paid: number; text: string }, stamp: Stamp): S {
  const paid = end.gateId && end.paid > 0 ? onGate(save, end.gateId, { type: 'paid', xp: end.paid }, stamp, null) : save;
  const next = 'ok' in paid ? save : paid;
  return told(next, stamp, { kind: 'combat', hunterId: null, title: 'Fight ended', text: end.text });
}

/** A gate of the room's world doc (protocol.ts `DOCS.world`): what another GM phone published. */
export type WorldDocGate = { id: string; name: string; rank: Rank; type: GateType; status: GateStatus; breakDay: number };
/**
 * Another GM phone's world merged in: the day is the later of the two, a gate both have takes the doc's name, rank,
 * type, break day and status, and a gate only the doc has is added (`fresh`, read by `parseGate`). Nothing is deleted.
 */
export function mergeWorld<S extends WorldParts>(save: S, doc: { day: number; gates: readonly WorldDocGate[] }, fresh: (g: WorldDocGate, day: number) => Gate | null): S {
  const day = Math.max(save.world.day, doc.day);
  let gates = save.gates;
  for (const g of doc.gates) {
    const at = gates.findIndex(x => x.id === g.id);
    if (at < 0) { const made = fresh(g, day); if (made) gates = [...gates, made]; continue; }
    const named: Gate = { ...gates[at]!, name: g.name, rank: g.rank, type: g.type, breakDay: g.breakDay };
    const set = transition(named, { type: 'gmSet', status: g.status, day });
    gates = gates.map((x, i) => (i === at ? set : x));
  }
  return { ...save, world: { ...save.world, day }, gates };
}

// ── the room's world doc (implicit audit 3, G1) ──
/**
 * The world doc the GM's phone publishes (protocol.ts `DOCS.world`): the day and the gates players see, the ones still to
 * be cleared first, then the rest in their order, at most `WORLD_GATES`, each name cut to `WORLD_NAME_MAX`; a cleared
 * gate with its day, and `solo` on each gate of `solo` (the ids the room's solo doc holds, gates/solo.ts `soloDoc`). Within
 * the doc's bounds, so the reader takes it whole.
 */
export function worldDoc(save: Pick<Save, 'gates'>, day: number, solo: ReadonlySet<string>, session: number): WorldDoc {
  return { day, session, gates: worldOrder(save.gates).map(g => (solo.has(g.id) ? { ...shownOf(g, WORLD_NAME_MAX), solo: true as const } : shownOf(g, WORLD_NAME_MAX))) };
}
/** The gates the world doc carries, in its order: the ones still to be cleared first, then the rest, at most `WORLD_GATES`. */
export function worldOrder(gates: readonly Gate[]): Gate[] {
  const later = (g: Gate): number => (can(g, 'clear') ? 0 : 1);
  return gates.map((g, i) => ({ g, i })).sort((a, b) => later(a.g) - later(b.g) || a.i - b.i).slice(0, WORLD_GATES).map(({ g }) => g);
}

// ── a player's gate news (implicit audit 2, N7) ──
/** The gates a player's phone has told of in a room, the ones that appeared and the ones that broke, newest last (at most `TOLD_MAX` each). */
export type GateTold = { readonly ids: readonly string[]; readonly broken: readonly string[] };
export const TOLD_MAX = 200;
/** One piece of gate news: a gate appeared, or a gate broke. */
export type GateNews = { readonly kind: 'appeared' | 'broke'; readonly gate: ShownGate };
/** A stored told record, or null when it is not one (a first sight). */
export function parseGateTold(v: unknown): GateTold | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { ids?: unknown; broken?: unknown }, list = (x: unknown): string[] | null => (Array.isArray(x) && x.every(i => typeof i === 'string') ? x : null);
  const ids = list(o.ids), broken = list(o.broken);
  return ids && broken ? { ids, broken } : null;
}
/**
 * What a player's phone has to tell of the room's gates (`told` as it stored it, null at a first sight): at most 3 gates
 * that appeared (not already broken) and 3 that broke, none told yet. A first sight takes every gate as told, so joining
 * a room replays nothing: it answers no news and the record to store.
 */
export function gateNews(told: GateTold | null, gates: readonly ShownGate[]): { told: GateTold; news: GateNews[] } {
  if (!told) return { told: { ids: gates.map(g => g.id).slice(-TOLD_MAX), broken: gates.filter(g => g.status === 'broken').map(g => g.id).slice(-TOLD_MAX) }, news: [] };
  const appeared = gates.filter(g => g.status !== 'broken' && !told.ids.includes(g.id)).slice(0, 3).map((gate): GateNews => ({ kind: 'appeared', gate }));
  const broke = gates.filter(g => g.status === 'broken' && !told.broken.includes(g.id)).slice(0, 3).map((gate): GateNews => ({ kind: 'broke', gate }));
  return { told, news: [...appeared, ...broke] };
}
/** The record once `n` was shown and answered: its gate told as appeared, and as broken when it broke. */
export function toldGate(told: GateTold, n: GateNews): GateTold {
  const add = (list: readonly string[]) => [...list.filter(id => id !== n.gate.id), n.gate.id].slice(-TOLD_MAX);
  return { ids: add(told.ids), broken: n.kind === 'broke' ? add(told.broken) : told.broken };
}

/**
 * What the world list says when it holds no gate. Beside the solo section above it (personal gates on, or a gate open to
 * solo runs) it names the world's list, so a personal gate shown above is not contradicted by "the world is quiet"
 * (lead-look-2-solo.md, finding 4). `gm`: the GM's tools show (the spawn form is above).
 */
export const worldEmptyWords = (gm: boolean, soloShown: boolean): string =>
  soloShown ? (gm ? 'No world gates. Spawn one above.' : 'No world gates.') : gm ? 'No active gates. Spawn one above.' : 'No gates detected. The world is quiet.';

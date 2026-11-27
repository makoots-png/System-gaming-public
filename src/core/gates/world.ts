// world.ts: the world's day and the save's list of gates (`save.world`, `save.gates`), with the session log line each
// change writes. A gate's status and its XP paid change only through `transition` (gate.ts); these steps find the gate,
// run its event and log what happened. The world day moves only by `dayStep`, and every change of the day or of a
// break day runs the one break check, `BREAK_CHECK` (SMX-gates-7). The gates view (gates.js) and the fight's end (combat.js) change the world only
// through these, with `store.apply`. Pure: the caller passes the time (`Stamp`), the rolled gate and the monsters made
// for it, the XP and loot already worked out. A step that changes nothing is refused (`missing`, `unchanged`).
import { can, shownOf, transition } from './gate.ts';
import type { Gate, GateEvent, GateMonster, GateNpc, GateStatus, GateType, MonsterId } from './gate.ts';
import { withDifficulty } from './difficulty.ts';
import type { DifficultyEvent } from './difficulty.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused, Step } from '../save-step.ts';
import { fought } from '../combat/fight-save.ts';
import type { Beside } from '../combat/fight-save.ts';
import type { Result } from '../combat/fight-types.ts';
import type { Rules } from '../rules.ts';
import { told } from '../session-log.ts';
import { compareTimes } from '../day.ts';
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

// ── the world day (SMX-gates-7): one number, moved only by `dayStep`, and the one break check every change runs ──
/** What moves the world day: the GM moves it by `by` days (a session's start by one), or another GM phone's world doc says `day`. */
export type WorldDayEvent = { readonly type: 'moved'; readonly by: number } | { readonly type: 'merged'; readonly day: number };
/** What changed the world for its gates: the day moved forward or back, another GM phone's world merged in, the GM edited a gate. */
export type WorldChange = 'forward' | 'back' | 'merged' | 'edited';
/** What a change does to a gate still open on or past its break day: break it, or leave it as it is. */
export type WorldBreakCheck = 'break' | 'keep';
/** An open gate: nobody in it (`detected`), or a party in it (`raiding`, entered or fighting). */
export type OpenGate = Extract<GateStatus, 'detected' | 'raiding'>;
/**
 * The break check of each change, by whether anybody is in the gate: the one table every writer of the day or a break
 * day runs (`checkBreaks`). The owner, Nov 22 (SMX-gates-7.1, 7.2): "Yes can see a worlds day backwards, and no it doesn't
 * break if someone is in it. If not, yes."
 */
export const BREAK_CHECK: { readonly [C in WorldChange]: { readonly [S in OpenGate]: WorldBreakCheck } } = {
  forward: { detected: 'break', raiding: 'break' },
  // 7.1: the GM may set the day back; a move back leaves every gate as it is, one broken or cleared on a later day too
  back: { detected: 'keep', raiding: 'keep' },
  // 7.2: an edit (the GM's, or another GM phone's world merged in) that leaves a gate past its break day breaks it at
  // once when nobody is in it, and not while a party is
  merged: { detected: 'break', raiding: 'keep' },
  edited: { detected: 'break', raiding: 'keep' },
};

/**
 * The world day after `e` on day `day`, and the change it is; null when the day stays where it was (0 days, back from
 * day 1, a doc's day not later than this phone's). A move never goes under day 1; a doc never moves the day back.
 */
export function dayStep(day: number, e: WorldDayEvent): { day: number; change: Exclude<WorldChange, 'edited'> } | null {
  const next = e.type === 'moved' ? Math.max(1, day + (Math.trunc(e.by) || 0)) : Math.max(day, Math.trunc(e.day) || 0);
  if (next === day) return null;
  return { day: next, change: e.type === 'merged' ? 'merged' : next > day ? 'forward' : 'back' };
}

/**
 * The gates after `change` on the save's world day: each open gate on or past its break day whose cell of `BREAK_CHECK`
 * (its change, whether anybody is in it) breaks is broken and logged. Answers the gates it broke.
 */
export function checkBreaks<S extends WorldParts>(save: S, change: WorldChange, stamp: Stamp): { save: S; broke: Gate[] } {
  const day = save.world.day, broke: Gate[] = [];
  let next = save;
  for (const g of save.gates) {
    if ((g.status !== 'detected' && g.status !== 'raiding') || BREAK_CHECK[change][g.status] === 'keep') continue;
    const r = onGate(next, g.id, { type: 'dayAdvanced', day }, stamp, x => ['DUNGEON BREAK', `${x.rank}-rank gate "${x.name}" has broken on day ${day}.`]);
    if (isRefused(r)) continue;
    next = r;
    broke.push(next.gates.find(x => x.id === g.id)!);
  }
  return { save: next, broke };
}

/** What a move of the world day did: the save after it, the day it reached, the days it moved (never under day 1), the gates that broke. */
export type DayMoved<S> = { save: S; day: number; by: number; broke: Gate[] };
/** The "World day" line's words: what the move did. */
export const dayMovedText = (by: number, day: number): string => (by > 0 ? `Day advanced by ${by} to ${day}.` : `Day moved back by ${-by} to ${day}.`);

/**
 * The world day moved by `n` (`dayStep`) and logged as it moved, then its break check (`checkBreaks`). A move that
 * leaves the day where it was (0 days, or back from day 1) is refused.
 */
export function advanceDay<S extends WorldParts>(save: S, n: number, stamp: Stamp): Next<DayMoved<S>> {
  const moved = dayStep(save.world.day, { type: 'moved', by: n });
  if (!moved) return refuse('unchanged');
  const by = moved.day - save.world.day;
  const logged = told({ ...save, world: { ...save.world, day: moved.day } }, stamp, gateLine('World day', dayMovedText(by, moved.day)));
  return { ...checkBreaks(logged, moved.change, stamp), day: moved.day, by };
}

/**
 * The GM starts a session: the save's count of sessions goes up by one and the world day by one (`advanceDay`, with its
 * breaks), and the session's line says its number, whether the backup taken just before was kept (`backup`), and the day.
 */
export function sessionStarted<S extends WorldParts>(save: S, backup: boolean, stamp: Stamp): Next<DayMoved<S> & { session: number }> {
  const moved = advanceDay(save, 1, stamp);
  if ('ok' in moved) return moved;
  const session = save.world.session + 1;
  const text = `${backup ? 'A backup was saved.' : 'No backup was saved because this browser blocked storage.'} World day ${moved.day}.`;
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
/** What a fight command writes beside the fight, with the time stamp for a gate's start line (`gateFought`). */
export type GateBeside = Beside & { readonly stamp: Stamp };
/**
 * One fight command written with its gate mark (`fought` in combat/fight-save.ts, then `gateFightStarted` when the
 * links name a gate, before `b.also`). combat.js `send` is its one caller, through `store.apply`.
 */
export function gateFought(save: Save, r: Result, b: GateBeside, R: Rules): Save | Refused {
  const { stamp, ...beside } = b, gate = beside.links?.gate;
  const also: Step<Save> | null = gate
    ? s => { const g = gateFightStarted(s, gate, stamp); const next = isRefused(g) ? s : g; return beside.also ? beside.also(next) : next; }
    : beside.also ?? null;
  return fought(save, r, { ...beside, also }, R);
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
  name: string; rank: Rank; type: GateType; breakDay: number; monsters: GateMonster[]; bossId: MonsterId | null; npcs?: GateNpc[]; notes: string;
  mapId: string | null; status: GateStatus; solo: boolean;
  difficultyEvents?: readonly DifficultyEvent[];
};
/**
 * The GM's edit of gate `id`: an empty name or a break day of 0 keeps the old one, a break day under 1 is day 1, a map
 * the library lacks none. Then difficulty events (with `bossRemoved` when `bossId` is cleared), status, and the break
 * check of an edit (`BREAK_CHECK.edited`).
 */
export function editGate<S extends WorldParts>(save: S, id: string, edit: GateEdit, stamp: Stamp): Next<S> {
  const at = save.gates.findIndex(g => g.id === id);
  if (at < 0) return refuse('missing');
  const old = save.gates[at]!;
  const fields: Gate = {
    ...old, name: edit.name.trim().slice(0, 60) || old.name, rank: edit.rank, type: edit.type, breakDay: Math.max(1, Math.trunc(edit.breakDay) || old.breakDay),
    monsters: edit.monsters, bossId: edit.bossId, npcs: edit.npcs ?? old.npcs, notes: edit.notes.trim().slice(0, 500),
    mapId: save.library.maps.find(m => m.id === edit.mapId)?.id ?? null, solo: edit.solo,
  };
  const diffEvents: DifficultyEvent[] = [
    ...(edit.difficultyEvents ?? []),
    ...(edit.bossId === null ? [{ type: 'bossRemoved' as const }] : []),
  ];
  const withDiff = diffEvents.length ? withDifficulty(fields, diffEvents) : fields;
  const set = transition(withDiff, { type: 'gmSet', status: edit.status, day: save.world.day });
  return checkBreaks({ ...save, gates: save.gates.map((g, i) => (i === at ? set : g)) }, 'edited', stamp).save;
}

/** What a Clear pays, as gates.js worked it out: the XP, gold and mana crystal each payee gets, the items, the payees' names. */
export type ClearPay = { due: number; xp: number; gold: number; crystal?: number; items: string[]; payees: string[] };
/**
 * Gate `id` cleared on today's world day; when anyone is paid, the XP it still owed counts as paid. A gate the Clear does
 * not apply to (cleared already, or closed: gate.ts `TABLE`) is refused (`unchanged`), so a second Clear pays nobody.
 */
export function clearGate<S extends WorldParts>(save: S, id: string, pay: ClearPay, stamp: Stamp): Next<S> {
  const g = save.gates.find(x => x.id === id);
  if (!g) return refuse('missing');
  const cleared = onGate(save, id, { type: 'clear', day: save.world.day }, stamp, null);
  if (isRefused(cleared)) return cleared;
  const next = pay.payees.length && pay.due > 0 ? onGate(cleared, id, { type: 'paid', xp: pay.due }, stamp, null) : cleared;
  if (isRefused(next)) return next;
  const crystal = pay.crystal ? `, ${pay.crystal} mana crystal` : '';
  return told(next, stamp, gateLine('GATE CLEARED', `${g.rank}-rank gate "${g.name}" cleared. ${pay.payees.join(', ') || 'No one'} rewarded: +${pay.xp} XP, ${pay.gold} gold${crystal}${pay.items.length ? `, ${pay.items.join(', ')}` : ''}.`));
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
 * Another GM phone's world merged in: the day is the later of the two (`dayStep` `merged`), a gate both have takes the
 * doc's name, rank, type, break day and status, and a gate only the doc has is added (`fresh`, read by `parseGate`).
 * Nothing is deleted. Then the break check of a merge (`BREAK_CHECK.merged`).
 */
export function mergeWorld<S extends WorldParts>(save: S, doc: { day: number; gates: readonly WorldDocGate[] }, fresh: (g: WorldDocGate, day: number) => Gate | null, stamp: Stamp): S {
  const day = dayStep(save.world.day, { type: 'merged', day: doc.day })?.day ?? save.world.day;
  let gates = save.gates;
  for (const g of doc.gates) {
    const at = gates.findIndex(x => x.id === g.id);
    if (at < 0) { const made = fresh(g, day); if (made) gates = [...gates, made]; continue; }
    const named: Gate = { ...gates[at]!, name: g.name, rank: g.rank, type: g.type, breakDay: g.breakDay };
    const set = transition(named, { type: 'gmSet', status: g.status, day });
    gates = gates.map((x, i) => (i === at ? set : x));
  }
  return checkBreaks({ ...save, world: { ...save.world, day }, gates }, 'merged', stamp).save;
}

/** A room's world doc as a GM phone merged it: when it was written and by which phone. */
export type WorldDocStamp = { readonly at: string; readonly from: string };
/**
 * Whether another GM phone's world doc is one this phone has not merged (`last`, null for none in this room): written
 * later, or in the same millisecond by another phone, so two GM phones writing at once lose neither (SMX-gates-7.3a).
 */
export function worldDocUnmerged(doc: WorldDocStamp, last: WorldDocStamp | null): boolean {
  const later = compareTimes(doc.at, last ? last.at : '');
  return later > 0 || (later === 0 && last !== null && doc.from !== last.from);
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

/**
 * What the world list says when it holds no gate. Beside the solo section above it (personal gates on, or a gate open to
 * solo runs) it names the world's list, so a personal gate shown above is not contradicted by "the world is quiet"
 * (lead-look-2-solo.md, finding 4). `gm`: the GM's tools show (the spawn form is above).
 */
export const worldEmptyWords = (gm: boolean, soloShown: boolean): string =>
  soloShown ? (gm ? 'No world gates. Spawn one above.' : 'No world gates.') : gm ? 'No active gates. Spawn one above.' : 'No gates detected.';

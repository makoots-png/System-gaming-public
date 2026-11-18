// fight-save.ts: what one fight command writes to the save, as one step (implicit audit row 13): the fight the reducer
// answered, what it came from (`fightRefs`), each write-back the reducer asked for on this phone (a hunter's totals
// through `sheetEdit`, a shadow's HP), each player's totals put in the outbox, and a gate's mark when the command starts
// that gate's fight (row 85). combat.js `send` is its one caller, through `store.apply`, so a command is written whole
// or not at all, and a tab that may not write refuses the fight as it refuses the rest. What reaches outside the save
// comes after the write, from what was written: the outbox's send, the news, and the dice the fight still waits for
// (`owed` in fight.ts), which a reload reads from the stored fight again.
//
// An item used in the fight leaves its bag in the same write as the use (implicit audit 2, N1, and 3, C1): an `act` of
// an item's ability by a hunter's row (`itemSpent`) takes one from this phone's hunter, or posts the room's `spent` to
// the player whose hunter it is, whose phone takes it then. A use the fight refuses writes nothing, so it costs nothing.
//
// A grant to a hunter this phone's fight holds (an award, a quest's reward, XP) puts what the sheet does not hold while
// the fight does (grant.ts `Granted.fight`) on the hunter's row in the grant's own write: `heldCommands` are the fight's
// commands for those parts, reduced as one (fight.ts `reduceAll`) and written by `fought` with the grant's step as its
// `also` (combat.js `held`, hunter.js `grantWrite`). The reward is paid with its statuses on the rows, or not at all.
import { rowFacts } from './fight-facts.ts';
import { record } from '../hunter/chronicle.ts';
import type { Save } from '../save.ts';
import type { Rules } from '../rules.ts';
import type { Command, Effect, Ended, Fight, Result } from './fight-types.ts';
import { statusKey } from './effect-ops.ts';
import type { StatusDef } from './effect-ops.ts';
import { grantLines, newRewards } from '../rewards.ts';
import { statusGrant } from './fight-view.ts';
import type { StatusIn } from '../hunter/conditions.ts';
import { isStateChip } from '../hunter/chips.ts';
import type { Seat } from '../role.ts';
import type { RoomCode, RoomEvent } from '../protocol.ts';
import type { Stamp } from '../session-log.ts';
import { atHunter, isRefused, refuse } from '../save-step.ts';
import type { Refused, Step } from '../save-step.ts';
import { sheetEdit } from '../hunter/grant.ts';
import { setShadowHp } from '../hunter/shadows.ts';
import { gateFightStarted } from '../gates/world.ts';
import { atOutbox, post } from '../sync/outbox.ts';
import { spendItem } from '../hunter/use.ts';
import { itemOfAbility } from '../registry/abilities.ts';
import { parseSaveId } from '../ids.ts';
import type { GateId, HunterId, ItemId, MonsterId, SheetKey } from '../ids.ts';
import type { CombatantId } from './ability-types.ts';

/** What a command links the fight to when it is taken: the gate it was started from, each new monster row's bestiary entry. */
export type Links = { readonly gate?: GateId | null; readonly monsters?: Readonly<Record<CombatantId, MonsterId>> };
/** A player's totals as the room event the view made for them, posted under `key` so only the latest waits. */
export type Totals = { readonly key: string; readonly event: RoomEvent };
/** Whose bag an item used in the fight leaves: a hunter of this phone, or a player's hunter by its room key. */
export type ItemSpent = { readonly item: ItemId } & ({ readonly kind: 'local'; readonly hunterId: HunterId } | { readonly kind: 'remote'; readonly remote: SheetKey });
/** An item the command uses up, as `fought` writes it: taken from this phone's hunter, or the `spent` the view made for the player. */
export type Spending = { readonly kind: 'local'; readonly hunterId: HunterId; readonly item: ItemId } | { readonly kind: 'remote'; readonly event: RoomEvent };

/**
 * The item command `cmd` uses up in fight `f`: an `act` of an item's ability (src/core/registry/abilities.ts
 * `itemAbility`) by a row a hunter holds, on this phone or a player's. Null for any other command, or a row of no hunter.
 */
export function itemSpent(f: Fight | null, cmd: Command): ItemSpent | null {
  if (!f || cmd.type !== 'act') return null;
  const row = f.rows.find(r => r.id === cmd.by), a = row?.abilities.find(x => x.id === cmd.ability);
  const item = a ? itemOfAbility(a) : null, h = row?.holder;
  if (!item || !h) return null;
  return h.kind === 'local' ? { kind: 'local', hunterId: h.hunterId, item } : h.kind === 'remote' ? { kind: 'remote', remote: h.remote, item } : null;
}
/**
 * What a command writes beside the fight: its links (null for none), the room the players' totals go to (null when
 * this phone is in none), those totals (one for each `sendRemote` effect), the time of a gate's log line, and `also`, a
 * step of another module the command's write carries (a shadow risen from a corpse joins its army), or none.
 */
export type Beside = {
  readonly links: Links | null; readonly room: RoomCode | null; readonly totals: readonly Totals[]; readonly stamp: Stamp;
  readonly also?: Step<Save> | null;
  /** The item the command uses up (`itemSpent`), or none. */
  readonly spent?: Spending | null;
  /** The `shadow` message for a player's hunter whose extraction this command records raised one (shadows.js), or none. */
  readonly risen?: RoomEvent | null;
};

/** One write-back of `fx` on this phone's save; a hunter or shadow no longer here, or a write its state refuses, is left. */
function wroteBack(save: Save, fx: Effect, R: Rules): Save {
  const next = fx.type === 'vitals'
    ? atHunter(fx.hunterId, h => sheetEdit(h, { type: 'totals', hp: fx.hp, mana: fx.mana, fatigue: fx.fatigue, statuses: fx.statuses, used: fx.used ?? {} }, R))(save)
    : fx.type === 'shadowHp' ? atHunter(fx.hunterId, h => setShadowHp(h, fx.shadowId, fx.hp))(save) : save;
  return isRefused(next) ? save : next;
}

/**
 * The save after the reducer's answer `r` to the save's fight: the fight, its links merged into what it came from (no
 * fight, no links), the write-backs, the item spent, the players' totals posted, the gate marked as fought (its log
 * line with it) when the links name one, the `shadow` message of a shadow risen for a player's hunter, then `also`. A
 * refused command changes nothing (`refused`), and so does a refused `also`, an item this phone's hunter no longer holds
 * (`no-item`), or a risen shadow with no room to send it to (`no-room`); the caller tells the command's reason from `r`.
 */
export function fought(save: Save, r: Result, b: Beside, R: Rules): Save | Refused {
  if (r.effects.some(x => x.type === 'refused')) return refuse('refused');
  const { fightRefs: was, ...rest } = save;
  let s: Save = { ...rest, fight: r.fight };
  if (r.fight) {
    const refs = was ?? { gate: null, monsters: {} }, l = b.links;
    s.fightRefs = l ? { gate: l.gate !== undefined ? l.gate : refs.gate, monsters: { ...refs.monsters, ...(l.monsters ?? {}) } } : refs;
  }
  for (const fx of r.effects) s = wroteBack(s, fx, R);
  // the fight ended: each hunter of this phone in it remembers it (fight-facts.ts), in this write, so the store notices it here
  if (r.fight?.phase === 'ended' && r.effects.some(x => x.type === 'ended')) s = foughtFacts(s, r.fight);
  const sp = b.spent, room = b.room;
  if (sp?.kind === 'local') { const t = atHunter(sp.hunterId, h => spendItem(h, sp.item, R))(s); if (isRefused(t)) return t; s = t; }
  if (room && sp?.kind === 'remote') s = atOutbox(box => post(box, room, { kind: 'event', event: sp.event }).box)(s);
  // a shadow that rose for a player's hunter reaches it only through the room: with no room the outcome is not kept either
  if (b.risen) { if (!room) return refuse('no-room'); const ev = b.risen; s = atOutbox(box => post(box, room, { kind: 'event', event: ev }).box)(s); }
  if (room && b.totals.length) s = atOutbox(box => b.totals.reduce((x, t) => post(x, room, { kind: 'event', event: t.event }, t.key).box, box))(s);
  const gate = b.links?.gate;
  if (gate) { const g = gateFightStarted(s, gate, b.stamp); if (!isRefused(g)) s = g; }
  return b.also ? b.also(s) : s;
}

/** `save` with each local hunter row of the ended fight `f` given its facts (`rowFacts`): the gate it came from by name. */
function foughtFacts(save: Save, f: Ended): Save {
  const gid = save.fightRefs?.gate ?? null, gate = gid ? save.gates.find(g => g.id === gid)?.name ?? '' : '';
  let s = save;
  for (const row of f.rows) {
    const holder = row.holder;
    if (row.kind !== 'hunter' || holder?.kind !== 'local') continue;
    s = { ...s, hunters: s.hunters.map(h => (h.id === holder.hunterId ? record(h, ...rowFacts(f, row.id, h.rank, gate)) : h)) };
  }
  return s;
}

// ── a grant's parts on the rows of the hunters it pays (close audit, V2's last row) ──
/** What a grant hands to the fight for row `cid` (grant.ts `Granted.fight`): the statuses to put on it, and a level-up's refill. */
export type HeldParts = { readonly cid: CombatantId; readonly statuses: readonly StatusIn[]; readonly refill: boolean };
/** The statuses of a grant a row takes: each with its def (its own, else the rules' under its key), never a state chip. */
export function rowStatuses(list: readonly StatusIn[], R: { readonly conditions: Readonly<Record<string, StatusDef>> }): (StatusIn & { readonly def: StatusDef })[] {
  return list.flatMap(s => { const def = s.def ?? R.conditions[s.key]; return def && !isStateChip(s.key) ? [{ ...s, def }] : []; });
}
/** The reward window's lines for the statuses a row took (`rowStatuses`), written with the grant (hunter.js `settle`). */
export const heldLines = (list: readonly StatusIn[], R: Rules): string[] =>
  grantLines(R, { ...newRewards(), statuses: rowStatuses(list, R).map(s => ({ key: statusKey(s.key), rounds: s.rounds ?? null, def: s.def })) });
/**
 * The fight's commands that put `parts` on their rows of `f`: a `status` for each status the row takes (`rowStatuses`)
 * from the GM at the status's source tier, then a refill as an `adjust` up to the row's maxima when it is below them.
 */
export function heldCommands(f: Fight | null, parts: readonly HeldParts[], R: Rules): Command[] {
  return parts.flatMap(p => {
    const row = f?.rows.find(r => r.id === p.cid);
    const statuses = rowStatuses(p.statuses, R).map((s): Command => ({ type: 'status', id: p.cid, add: statusGrant(s.key, s.def, s.rounds ?? null, s.source?.tier ?? 0, R) }));
    const low = row && (row.hp < row.sheet.hpMax || row.mana < row.sheet.manaMax);
    return p.refill && row && low ? [...statuses, { type: 'adjust', id: p.cid, hp: row.sheet.hpMax - row.hp, mana: row.sheet.manaMax - row.mana }] : statuses;
  });
}

// ── who a fight holds (implicit audit 3, CU1) ──
/** Whom a question is about: a hunter of this phone, or a player's hunter by its sheet key. */
export type Held = { readonly hid: string } | { readonly key: string };
/** What a player's phone reads of the GM's fight: the room's fight doc, as `DOCS.fight` parsed it. */
export type TableDoc = { readonly ended: boolean; readonly active?: boolean; readonly rows?: readonly { readonly key?: string | null }[] };
/**
 * Where a hunter's HP, mana, fatigue and statuses live while a fight holds it, the one answer to "is this hunter in a
 * fight": a row of this phone's fight, set up or running (`row`, its id), a row of the GM's running fight read on a
 * player's phone (`gm`: the room's fight doc has a row under `key`, this phone's sheet key for the hunter), or its
 * sheet (null). A hunter of this phone that no row holds is not in a fight, whoever else this phone's fight holds.
 */
export function fightHold(fight: Fight | null, who: Held, room: { readonly seat: Seat; readonly doc: TableDoc | null; readonly key: string | null }): { readonly at: 'row'; readonly cid: CombatantId } | { readonly at: 'gm' } | null {
  if (fight && fight.phase !== 'ended') {
    const r = fight.rows.find(x => ('key' in who ? x.holder?.kind === 'remote' && x.holder.remote === who.key : x.holder?.kind === 'local' && x.holder.hunterId === who.hid));
    if (r) return { at: 'row', cid: r.id };
  }
  const d = room.doc;
  return 'hid' in who && room.seat === 'player' && room.key !== null && d && !d.ended && d.active && d.rows?.some(r => r.key === room.key) ? { at: 'gm' } : null;
}

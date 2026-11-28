// fight-parse.ts: the one reader of a stored or received fight (docs/agent-handoff/rw/design.md section 5). Everything is
// bounded, every choice goes through its list, a place must be a walkable tile of the fight's grid, and a formula tree is
// read node by node, at most `FORMULA_PARTS` parts. A row's stats, sheet and speed are not read: they are worked out
// again from its origin and statuses, as the reducer keeps them. XP banked and summed may pass a row's bound, so it is
// read up to the largest safe whole number. The reducer trusts what this answers. A new field of `Fight` or `Body` gets
// its line here (a field of one kind of row in its kind's reader, `OWN`) and its value in the round trip of
// tests/fight-model.test.ts.
import { RANKS } from '../rules.ts';
import type { Rules } from '../rules.ts';
import { oneOf } from '../one-of.ts';
import { isIconKey } from '../registry/icons.ts';
import type { NpcSkill } from '../registry/npcs.ts';
import { STAT_KEYS } from '../stats.ts';
import { SHEET_LABELS } from '../hunter/derive.ts';
import type { Archetype, Bonus, GearPiece, MonsterKind, MonsterTrait, SheetNumber, Tweak } from '../hunter/derive.ts';
import { bareRefusal, COUNT_NAMES, diceModsOf, FNS, FORMULA_PARTS } from '../formula.ts';
import { withinSize } from '../size.ts';
import type { BinaryOp, Formula } from '../formula.ts';
import { TERRAIN, TERRAINS, percent, place, tiles } from './space.ts';
import type { Grid, Place, Shape } from './space.ts';
import { cost, tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import { DAMAGE_TYPES } from './damage-type.ts';
import { abilityId, combatantId, hunterId, REACT_WHEN, tag, USURP_AMP_MIN } from './ability-types.ts';
import { fightId, parseSaveId, parseSheetKey } from '../ids.ts';
import type { Ability, AbilityEffect, AbilityId, CombatantId, Delivery, AbilityGate, Gap, Price, RiseSpec, RuleTicks, Summon, Tag, UsurpSpec } from './ability-types.ts';
import { bounded } from '../registry/scalers.ts';
import { isUp } from './row-hp.ts';
import { amountOp, AURA_ON, DISPEL_KINDS, HIDE_STARTS, REACH_ON, STEALTH_ENDS, isStatusKey, LAND_USE_OPS, reactionMayHold, modified, shadowId, SHARE_ON, statusKey, statusOn, TYPE_MAX, isUseOp } from './effect-ops.ts';
import { isFormulaKey, isStacking, SHEET_OP_KEYS } from './op-amount.ts';
import { sheetOpCap } from './standing.ts';
import type { HeldDieId } from './standing.ts';
import type { Rolls } from './resolve.ts';
import { asLevel } from './sight-levels.ts';
import { parseLife } from '../hunter/vitals.ts';
import { parseLevel } from '../hunter/level.ts';
import type {
  Body, Channel, CombatantKind, Due, End, Holder, HunterRow, Intent, LandOp, MonsterRow, Op, Origin, Reach, ShadowRow, SheetStatus, StackRule, Stagger, Status,
  StatusDef, StatusKey, StealthEnds, SummonRow, ThreatTable, Threshold, Tiered, UseOp,
} from './effect-ops.ts';
import type { FoeLife } from './row-life.ts';
import { ALONE_EVENTS, BEARER_EVENTS, PARTY_EVENTS } from './triggers.ts';
import type { Limit, Need, Trigger, Trip } from './triggers.ts';
import { ABILITY_DESC_MAX, FORCED_FACES, LOG_CAP, LOG_LINE_MAX, MAX_ABILITIES, MAX_PENDING, MAX_ROWS, MAX_SPREAD, MAX_STATUSES, NAME_MAX, PHASES, STATUS_DESC_MAX } from './fight-types.ts';
import type { DodgeWait, DueTurn, Fight, Fog, ForcedFace, Fudge, HeldUse, LogLine, Summary } from './fight-types.ts';
import { clampGrievousOps, isGrievousKey } from './grievous.ts';
import type { Extraction } from './extraction.ts';
import { isMythicScriptId, mythicScriptOf } from '../registry/mythics.ts';
import type { BarAt, MythicStanding, OmenKey } from './mythic-types.ts';
import { NO_TALLY } from './row-tally.ts';
import type { Kill, RowTally } from './row-tally.ts';
import { MAX_ZONE_TILES, MAX_ZONES, ZONE_NAME_MAX, zoneId } from './zones.ts';
import type { Anchor, Ground, Growth, Zone, ZoneSpec } from './zones.ts';

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max: number): string | null => typeof v === 'string' && v.length <= max ? v : null;
const idText = (v: unknown): string | null => typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null;
const num = (v: unknown, lo: number, hi: number): number | null => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
const whole = (v: unknown, lo: number, hi: number): number | null => { const n = num(v, lo, hi); return n !== null && Number.isInteger(n) ? n : null; };
const BIG = 1e9;
const tickOf = (v: unknown): Tick | null => { const n = whole(v, 0, BIG); return n === null ? null : tick(n); };
const bool = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
/**
 * A row's tally as stored (row-tally.ts): each number in its bound, a field that does not read left out (it reads as
 * none), its kills and the rows that downed it at most `MAX_ROWS` each. Absent when nothing reads.
 */
function tallyRead(v: unknown): Partial<RowTally> | undefined {
  if (!isObj(v)) return undefined;
  const out: { -readonly [K in keyof RowTally]?: RowTally[K] } = {};
  for (const k of ['hits', 'crits', 'critRun', 'critRunMax', 'struck', 'avoided', 'dealt', 'taken', 'healed', 'hexes', 'downs', 'turns', 'items'] as const) {
    const n = whole(v[k], 0, BIG); if (n !== null && n !== NO_TALLY[k]) out[k] = n;
  }
  const low = whole(v.low, 0, 100); if (low !== null && low !== NO_TALLY.low) out.low = low;
  if (v.exactOne === true) out.exactOne = true;
  if (Array.isArray(v.kills)) {
    const kills = v.kills.slice(0, MAX_ROWS).flatMap((x): Kill[] => {
      const o = isObj(x) ? x : {}, row = idText(o.row), hpPct = whole(o.hpPct, 0, 100), turn = whole(o.turn, 0, BIG);
      return row && hpPct !== null && turn !== null ? [{ row: combatantId(row), hpPct, turn }] : [];
    });
    if (kills.length) out.kills = kills;
  }
  if (Array.isArray(v.downedBy)) {
    const by = v.downedBy.slice(0, MAX_ROWS).flatMap(x => { const id = idText(x); return id ? [combatantId(id)] : []; });
    if (by.length) out.downedBy = by;
  }
  return Object.keys(out).length ? out : undefined;
}
/** A whole number of a kit rule's range (kits design table 1.1): one past it is clamped, one that is not a number takes `lo`. */
const clamped = (v: unknown, lo: number, hi: number): number => typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : lo;
/** Every entry must read, or the whole list is refused: a list that silently loses an entry is a different thing. */
function all<T>(v: unknown, max: number, read: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: T[] = [];
  for (const x of v) { const r = read(x); if (r === null) return null; out.push(r); }
  return out;
}

// ── the map ──
function gridOf(v: unknown): Grid | null {
  if (!isObj(v)) return null;
  const w = whole(v.w, 1, 64), h = whole(v.h, 1, 64);
  if (w === null || h === null) return null;
  if (v.tiles === null) return { w, h, tiles: null };
  const t = all(v.tiles, w * h, x => oneOf(x, TERRAINS, null));
  return t && t.length === w * h ? { w, h, tiles: t } : null;
}
function placeOn(v: unknown, grid: Grid): Place | null {
  if (!isObj(v)) return null;
  const x = whole(v.x, 0, grid.w - 1), y = whole(v.y, 0, grid.h - 1);
  if (x === null || y === null || !TERRAIN[grid.tiles?.[y * grid.w + x] ?? 'floor'].walk) return null;
  return place(x, y);
}
/** Any tile of the grid, a wall too. */
function tileOn(v: unknown, grid: Grid): Place | null {
  if (!isObj(v)) return null;
  const x = whole(v.x, 0, grid.w - 1), y = whole(v.y, 0, grid.h - 1);
  return x === null || y === null ? null : place(x, y);
}
/** The fog on a grid: a sight of 1 to 128 tiles and one '0' or '1' a tile. */
function fogOn(v: unknown, grid: Grid): Fog | null | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  const sight = whole(v.sight, 1, 128), seen = typeof v.seen === 'string' && v.seen.length === grid.w * grid.h && /^[01]*$/.test(v.seen) ? v.seen : null;
  return sight === null || seen === null ? undefined : { sight: tiles(sight), seen };
}
/**
 * A zone on `grid` (zones.ts), or null when it is not one: an id of 1 to 40 characters, a name of at most 40, 1 to
 * `MAX_ZONE_TILES` tiles of the grid, an owner (a row's id or null), the side it spares or null, a tier 0 to 5, an end
 * or null, whether it ends with its owner, and at most 12 status ops that each read.
 */
export function parseZone(v: unknown, grid: Grid, R: Rules): Zone | null {
  if (!isObj(v)) return null;
  const id = typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 40 ? v.id : null, name = text(v.name, ZONE_NAME_MAX);
  const ground = groundOf(v.ground, grid), owner = v.owner === null ? null : idText(v.owner);
  const spares = v.spares === null ? null : oneOf(v.spares, SIDES, undefined), tier = whole(v.tier, 0, 5);
  const until = v.until === null ? null : tickOf(v.until), ends = bool(v.endsWithOwner), ops = all(v.ops, 12, x => opOf(x, R, 0));
  const kit = zoneKitOf(v, R);
  const minionsOnly = v.minionsOnly === undefined ? undefined : v.minionsOnly === true ? true as const : null;
  if (!id || !name || !ground || (v.owner !== null && owner === null) || spares === undefined || tier === null
    || (v.until !== null && until === null) || ends === null || !ops || !kit || minionsOnly === null) return null;
  const laid = v.laid === undefined ? undefined : tickOf(v.laid), paid = v.paid === undefined ? undefined : tickOf(v.paid);
  if (laid === null || paid === null) return null;
  return {
    id: zoneId(id), name, ground, owner: owner === null ? null : combatantId(owner), spares, ...(minionsOnly ? { minionsOnly } : {}), tier, until, endsWithOwner: ends, ops, ...kit,
    ...(laid === undefined ? {} : { laid }), ...(paid === undefined ? {} : { paid }),
  };
}
/**
 * A zone's or a zone spec's kit parts (kits design 1.8), each left out when absent: an upkeep (fatigue and mana a round,
 * 0 to `hpFlat` each), its end's first `triggerOps` land ops, and its first `kit.triggers` triggers. Null when one is there and does not read.
 */
function zoneKitOf(v: Rec, R: Rules): Pick<Zone, 'upkeep' | 'end' | 'triggers'> | null {
  const K = R.fight.kit;
  const upkeep = v.upkeep === undefined ? undefined : isObj(v.upkeep) ? { fatigue: clamped(v.upkeep.fatigue, 0, K.hpFlat), mana: clamped(v.upkeep.mana, 0, K.hpFlat) } : null;
  const end = v.end === undefined ? undefined : landOpsOf(v.end, R, 0);
  const triggers = v.triggers === undefined ? undefined : all(Array.isArray(v.triggers) ? v.triggers.slice(0, K.triggers) : null, K.triggers, x => triggerOf(x, R, 0));
  if (upkeep === null || end === null || triggers === null) return null;
  return { ...(upkeep ? { upkeep } : {}), ...(end ? { end } : {}), ...(triggers ? { triggers } : {}) };
}
/**
 * A zone's ground (zones.ts `Ground`): 1 to `MAX_ZONE_TILES` tiles of the grid, or a radius of 0 to 64 around a tile of
 * the grid or a row's id (with the key of the status it comes from, or null), growing (`growOf`) or not (null, or left out).
 */
function groundOf(v: unknown, grid: Grid): Ground | null {
  if (!isObj(v)) return null;
  if (v.kind === 'tiles') { const list = all(v.tiles, MAX_ZONE_TILES, x => tileOn(x, grid)); return list && list.length ? { kind: 'tiles', tiles: list } : null; }
  if (v.kind !== 'around' || !isObj(v.anchor)) return null;
  const radius = tileCount(v.radius), a = v.anchor;
  let anchor: Anchor | null = null;
  if (a.kind === 'place') { const at = tileOn(a.at, grid); anchor = at && { kind: 'place', at }; }
  if (a.kind === 'body') {
    const body = idText(a.id), status = a.status === null ? null : idText(a.status);
    anchor = body && (status !== null || a.status === null) ? { kind: 'body', id: combatantId(body), status: status === null ? null : statusKey(status) } : null;
  }
  const grow = v.grow === null ? null : growOf(v.grow);
  return radius === null || !anchor || grow === undefined ? null : { kind: 'around', anchor, radius, grow };
}
/** A field's growth: a step of 1 to 64 tiles a round, a cap of 0 to 64, and when it was laid; undefined when it does not read. */
function growOf(v: unknown): Growth | undefined {
  if (!isObj(v)) return undefined;
  const step = whole(v.step, 1, 64), cap = whole(v.cap, 0, 64), from = tickOf(v.from);
  return step === null || cap === null || from === null ? undefined : { step: tiles(step), cap: tiles(cap), from };
}
/**
 * What an ability leaves: a name of 1 to 40 characters, an end or null, at most 12 ops, whether it ends with its owner,
 * where it lies (`around`: null where it lands, or an aura's radius of 1 to 64 around its user), and how it grows
 * (`grow`: a step and a cap of 1 to 64 tiles, or null).
 */
function zoneSpecOf(v: unknown, R: Rules): ZoneSpec | null {
  if (!isObj(v)) return null;
  const name = text(v.name, ZONE_NAME_MAX), duration = v.duration === null ? null : tickOf(v.duration), ops = all(v.ops, 12, x => opOf(x, R, 0)), ends = bool(v.endsWithOwner);
  const around = v.around === null ? null : whole(v.around, 1, 64);
  const g = isObj(v.grow) ? v.grow : null, step = g && whole(g.step, 1, 64), cap = g && whole(g.cap, 1, 64);
  const kit = zoneKitOf(v, R);
  if (!name || (v.duration !== null && duration === null) || !ops || ends === null || (around === null && v.around !== null)
    || (v.grow !== null && (step === null || cap === null)) || !kit) return null;
  return { name, duration, ops, endsWithOwner: ends, around: around === null ? null : tiles(around), grow: step && cap ? { step: tiles(step), cap: tiles(cap) } : null, ...kit };
}
/** An aim: a row's id, or any tile of the grid, a wall too. */
const aimOn = (v: unknown, grid: Grid): Place | CombatantId | null => {
  const id = idText(v);
  if (id !== null) return combatantId(id);
  if (!isObj(v)) return null;
  const x = whole(v.x, 0, grid.w - 1), y = whole(v.y, 0, grid.h - 1);
  return x === null || y === null ? null : place(x, y);
};

// ── a formula, node by node ──
const OPS: readonly BinaryOp[] = ['+', '-', '*', '/', '^'];
const SHEET_KEYS = Object.keys(SHEET_LABELS) as SheetNumber[];
const WHOSE = ['user', 'target'] as const;
/** A formula from outside data, or null: every node reads, and it holds at most `FORMULA_PARTS` parts (formula.ts `partsOf`). */
const formulaOf = (v: unknown, R: Rules): Formula | null => formulaPart(v, R, { left: FORMULA_PARTS });
/** One node and what is under it, each part taken from `budget`; null at the first part past it, so no more is walked. */
function formulaPart(v: unknown, R: Rules, budget: { left: number }): Formula | null {
  if (!isObj(v) || --budget.left < 0) return null;
  const sub = (x: unknown): Formula | null => formulaPart(x, R, budget);
  switch (v.kind) {
    case 'number': { const value = num(v.value, -BIG, BIG); return value === null ? null : { kind: 'number', value }; }
    case 'dice': {
      const count = whole(v.count, 1, R.dice.maxDice), sides = whole(v.sides, 2, R.dice.maxSides);
      if (count === null || sides === null) return null;
      const mods = diceModsOf(v.mods, count, sides);
      if (mods === null) return null;
      budget.left -= mods?.reroll?.on.length ?? 0;
      if (budget.left < 0) return null;
      return mods === undefined ? { kind: 'dice', count, sides } : { kind: 'dice', count, sides, mods };
    }
    case 'stat': { const whose = oneOf(v.whose, WHOSE, null), key = oneOf(v.key, STAT_KEYS, null); return whose && key ? { kind: 'stat', whose, key } : null; }
    case 'sheet': { const whose = oneOf(v.whose, WHOSE, null), key = oneOf(v.key, SHEET_KEYS, null); return whose && key ? { kind: 'sheet', whose, key } : null; }
    case 'charge': return { kind: 'charge' };
    case 'stacks': { const whose = oneOf(v.whose, WHOSE, null); return whose && isStatusKey(v.key) ? { kind: 'stacks', whose, key: v.key } : null; }
    case 'field': case 'held': return isStatusKey(v.key) ? { kind: v.kind, key: v.key } : null;
    case 'missing': { const whose = oneOf(v.whose, WHOSE, null); return whose && { kind: 'missing', whose }; }
    case 'count': { const name = oneOf(v.name, COUNT_NAMES, null); return name && { kind: 'count', name }; }
    case 'negate': { const arg = sub(v.arg); return arg && { kind: 'negate', arg }; }
    case 'binary': {
      const op = oneOf(v.op, OPS, null), left = sub(v.left), right = sub(v.right);
      return op && left && right ? { kind: 'binary', op, left, right } : null;
    }
    case 'min': case 'max': { const left = sub(v.left), right = sub(v.right); return left && right ? { kind: v.kind, left, right } : null; }
    case 'fn': { const fn = oneOf(v.fn, FNS, null), arg = sub(v.arg); return fn && arg ? { kind: 'fn', fn, arg } : null; }
    default: return null;
  }
}

// ── ops, statuses, abilities ──
function tiered<T>(v: unknown, read: (x: unknown) => T | null): Tiered<T> | null {
  if (!Array.isArray(v)) return read(v);
  const t = all(v, 6, read);
  return t && t.length === 6 ? t as unknown as Tiered<T> : null;
}
const WHEN = ['use', 'turn'] as const;
const when = (v: Rec): { when?: 'use' | 'turn' } | null => v.when === undefined ? {} : (w => w ? { when: w } : null)(oneOf(v.when, WHEN, null));
const anyNum = (x: unknown): number | null => num(x, -BIG, BIG);
function opOf(v: unknown, R: Rules, depth: number): Op | null {
  if (!isObj(v)) return null;
  const formula = (x: unknown): Formula | null => formulaOf(x, R);
  switch (v.op) {
    case 'damage': { const type = oneOf(v.type, DAMAGE_TYPES, null), amount = tiered(v.amount, formula), w = when(v); return type && amount && w ? { op: 'damage', type, amount, ...w } : null; }
    case 'heal': case 'mana': case 'fatigue': { const amount = tiered(v.amount, formula), w = when(v); return amount && w ? { op: v.op, amount, ...w } : null; }
    case 'applyStatus': {
      const key = idText(v.key), def = depth < 3 ? defOf(v.def, R, depth + 1, key ?? undefined) : null;
      const duration = v.duration === null ? null : tiered(v.duration, tickOf);
      if (!key || !def || (duration === null && v.duration !== null)) return null;
      return {
        op: 'applyStatus', key: statusKey(key), def, duration,
        ...(v.stacks === undefined ? {} : { stacks: clamped(v.stacks, 1, R.fight.kit.stackAdd) }),
        ...(v.follow === true ? { follow: true as const } : {}),
      };
    }
    case 'cureStatus': {
      const key = idText(v.key);
      if (!key) return null;
      return v.stacks === undefined ? { op: 'cureStatus', key: statusKey(key) } : { op: 'cureStatus', key: statusKey(key), stacks: clamped(v.stacks, 1, R.fight.kit.stackAdd) };
    }
    case 'note': { const t = text(v.text, 200); return t === null ? null : { op: 'note', text: t }; }
    case 'speed': { const pct = tiered(v.pct, x => num(x, -100, 1000)); return pct === null ? null : { op: 'speed', pct }; }
    case 'delay': { const ticks = tiered(v.ticks, tickOf); return ticks === null ? null : { op: 'delay', ticks }; }
    case 'hold': case 'root': case 'taunt': return { op: v.op };
    case 'threat': { const amount = tiered(v.amount, anyNum); return amount === null ? null : { op: 'threat', amount }; }
    case 'shield': { const amount = formula(v.amount); return amount ? { op: 'shield', amount } : null; }
    case 'channel': { const mode = oneOf(v.mode, ['protect', 'break'] as const, null); return mode ? { op: 'channel', mode } : null; }
    case 'staggerRate': { const pct = tiered(v.pct, anyNum); return pct === null ? null : { op: 'staggerRate', pct }; }
    case 'stat': { const key = oneOf(v.key, STAT_KEYS, null), amount = tiered(v.amount, x => bareFormulaOf(x, R, BIG)); return key && amount !== null ? { op: 'stat', key, amount } : null; }
    case 'refund': { const pct = tiered(v.pct, x => num(x, 0, 100)), chance = num(v.chance, 0, 100); return pct !== null && chance !== null ? { op: 'refund', pct, chance } : null; }
    case 'spread': { const range = whole(v.range, 1, 64); return range === null ? null : { op: 'spread', range }; }
    case 'aura': { const radius = whole(v.radius, 1, 64), on = oneOf(v.on, AURA_ON, null); return radius !== null && on ? { op: 'aura', radius, on } : null; }
    default: return wave2Op(v, R);
  }
}
/**
 * A lasting change's amount (a `stat` op's, or a `sheet` op's of `SHEET_FORMULA_KEYS`, item-stats.md 6.2): a plain number,
 * read as a number formula held within `cap` either way (a hunter's saved worn items keep their numbers), or a formula
 * that reads only its bearer's own numbers (formula.ts `bareRefusal`); null for anything else.
 */
function bareFormulaOf(v: unknown, R: Rules, cap: number): Formula | null {
  const f = typeof v === 'number' ? (Number.isFinite(v) ? { kind: 'number', value: v } as const : null) : formulaOf(v, R);
  if (!f || bareRefusal(f) !== null) return null;
  return f.kind === 'number' ? { kind: 'number', value: Math.max(-cap, Math.min(cap, f.value)) } : f;
}
/** A number held within `lo` to `hi` (kits table 8.1: one past a bound is clamped, as the kits' whole numbers are); null when it is not a number. */
const within = (v: unknown, lo: number, hi: number): number | null => typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null;
const EDGE_SIDES = ['attack', 'defend'] as const;
/**
 * An op of wave 2 (kits design 8.1 to 8.6), each number clamped to its rule (table 8.1): a sheet op's amount to its key's
 * bound, a share to plus or minus 100%, a held die to d2 to `boostSides`, a shove to 1 to `shoveMax` tiles, a move's take
 * to 1 to `stackCap` or all, a hasten's and a guard's share to 0 to 1.
 */
function wave2Op(v: Rec, R: Rules): Op | null {
  const K = R.fight.kit, F = R.fight;
  switch (v.op) {
    case 'sheet': {
      const key = oneOf(v.key, SHEET_OP_KEYS, null);
      if (!key) return null;
      const cap = sheetOpCap(key, R);
      if (isFormulaKey(key)) { const amount = tiered(v.amount, x => bareFormulaOf(x, R, cap)); return amount === null ? null : { op: 'sheet', key, amount }; }
      const amount = tiered(v.amount, x => within(x, -cap, cap));
      return amount === null ? null : { op: 'sheet', key, amount };
    }
    case 'share': { const on = oneOf(v.on, SHARE_ON, null), pct = tiered(v.pct, x => within(x, -100, 100)); return on && pct !== null ? { op: 'share', on, pct } : null; }
    case 'untargetable': case 'invulnerable': case 'safeguard': case 'alert': case 'extra': case 'negate': case 'reveal': return { op: v.op };
    case 'hidden': return { op: 'hidden', level: tiered(v.level, x => (isNum(x) ? asLevel(x) : null)) ?? HIDE_DEFAULT.level, start: oneOf(v.start, HIDE_STARTS, HIDE_DEFAULT.start), ends: stealthEndsOf(v.ends) };
    case 'stayHidden': { const on = oneOf(v.on, STEALTH_ENDS, null); return on && { op: 'stayHidden', on }; }
    case 'edge': {
      const side = oneOf(v.side, EDGE_SIDES, null), keep = oneOf(v.keep, ['better', 'worse'] as const, null), t = v.tag === null ? null : tagOf(v.tag, R), spend = bool(v.spend);
      return side && keep && (t !== null || v.tag === null) && spend !== null ? { op: 'edge', side, keep, tag: t, spend } : null;
    }
    case 'boost': {
      const side = oneOf(v.side, EDGE_SIDES, null), d = isObj(v.die) ? v.die : null;
      const die = d?.kind === 'die' ? { kind: 'die', sides: clamped(d.sides, 2, K.boostSides) } as const : d?.kind === 'face' ? { kind: 'face', n: clamped(d.n, 1, K.boostSides) } as const : null;
      return side && die ? { op: 'boost', side, die } : null;
    }
    case 'shove': {
      const dir = oneOf(v.dir, ['away', 'toward'] as const, null), from = oneOf(v.from, ['user', 'aim'] as const, null);
      return dir && from ? { op: 'shove', dir, from, tiles: clamped(v.tiles, 1, K.shoveMax) } : null;
    }
    case 'move': {
      const key = v.key === 'harmful' || v.key === 'event' ? v.key : isStatusKey(v.key) ? v.key : null, from = oneOf(v.from, ['user', 'target'] as const, null);
      const as = v.as === null || v.as === undefined ? null : isStatusKey(v.as) ? v.as : undefined;
      return key && from && as !== undefined ? { op: 'move', key, take: v.take === 'all' ? 'all' : clamped(v.take, 1, K.stackCap), from, as } : null;
    }
    case 'hasten': case 'guard': { const share = within(v.share, 0, 1); return share === null ? null : { op: v.op, share }; }
    case 'dispel': {
      const which = oneOf(v.which, ['first', 'all'] as const, null);
      const kind = v.kind === undefined ? 'harmful' : oneOf(v.kind, DISPEL_KINDS, null);
      return which && kind ? (kind === 'helpful' ? { op: 'dispel', which, kind } : { op: 'dispel', which }) : null;
    }
    // keystones A.7: a share of a bar above 0, held at `staggerOpMax`; an echo's radius a whole number of tiles, held at the widest field
    case 'stagger': { const share = isNum(v.share) && v.share > 0 ? Math.min(v.share, K.staggerOpMax) : null; return share === null ? null : { op: 'stagger', share }; }
    case 'echo': { const radius = whole(v.radius, 1, BIG); return radius === null ? null : { op: 'echo', radius: Math.min(radius, F.fieldRadiusMax) }; }
    default: return null;
  }
}
/**
 * A hidden op's fields when none is written, or one is wrong (docs/agent-handoff/features/notes-7-stealth.md section 2):
 * the kits' Stealth as built. Level 0, which hides from a plain sight of 0 (sight.ts `perceives`); only out of sight; every end.
 */
const HIDE_DEFAULT = { level: 0, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } } as const satisfies Pick<Extract<Op, { op: 'hidden' }>, 'level' | 'start' | 'ends'>;
/** Which of the three events end a hide: each one written true or false as written, any other its default (true); a key not of the three is dropped. */
const stealthEndsOf = (v: unknown): StealthEnds => {
  const o = isObj(v) ? v : {};
  return { hurt: bool(o.hurt) ?? HIDE_DEFAULT.ends.hurt, revealed: bool(o.revealed) ?? HIDE_DEFAULT.ends.revealed, dealt: bool(o.dealt) ?? HIDE_DEFAULT.ends.dealt };
};
const useOpOf = (v: unknown, R: Rules): UseOp | null => { const o = opOf(v, R, 0); return o && isUseOp(o) ? o : null; };
const COLOR_RE = /^#[0-9a-f]{6}$/i;
function defOf(v: unknown, R: Rules, depth: number, key?: string): StatusDef | null {
  if (!isObj(v)) return null;
  const label = text(v.label, NAME_MAX), desc = text(v.desc, STATUS_DESC_MAX), rawOps = all(v.ops, 12, x => opOf(x, R, depth));
  if (v.color !== undefined && !(typeof v.color === 'string' && COLOR_RE.test(v.color))) return null;
  if (label === null || desc === null || !rawOps) return null;
  // Keyed Grievous Wounds clamps negative healed shares to -GRIEVOUS_MAX; unkeyed parseStatusDef falls back to the label.
  const ops = (key !== undefined ? isGrievousKey(key) : label === 'Grievous Wounds') ? clampGrievousOps(rawOps) : rawOps;
  const K = R.fight.kit;
  const triggers = v.triggers === undefined ? undefined : all(Array.isArray(v.triggers) ? v.triggers.slice(0, K.triggers) : null, K.triggers, x => triggerOf(x, R, depth));
  const end = v.end === undefined ? undefined : endOf(v.end, R, depth);
  if (triggers === null || end === null) return null;
  const plain = {
    label, desc, ops, ...(typeof v.color === 'string' ? { color: v.color.toLowerCase() } : {}), ...(isIconKey(v.icon) ? { icon: v.icon } : {}), ...(triggers ? { triggers } : {}), ...(end ? { end } : {}),
  };
  if (v.stack === undefined) return plain;
  const stack = stackRuleOf(v.stack, R, depth);
  return stack ? { ...plain, stack } : null;
}
// ── the kits' blocks (kits design 1.1 to 1.6, table 1.1) ──
const LEAVES = ['never', 'round', 'event'] as const;
const KEEPS = ['fight', 'sheet'] as const;
const THENS = ['spend', 'keep'] as const;
const REFORM_SHARE_MIN = 0.01;
/** Where a threshold, a trigger or an end lands: the bearer, or an area of 1 to `fieldRadiusMax` tiles reaching a side. */
function reachOf(v: unknown, R: Rules): Reach | null {
  if (!isObj(v)) return null;
  if (v.kind === 'bearer') return { kind: 'bearer' };
  const on = oneOf(v.on, REACH_ON, null), radius = tiles(clamped(v.radius, 1, R.fight.fieldRadiusMax));
  if (v.kind === 'most') return on && v.of === 'hp' ? { kind: 'most', of: 'hp', radius, on } : null;
  return v.kind === 'area' && on ? { kind: 'area', radius, on } : null;
}
/** What a threshold, a trigger or an end lands (effect-ops.ts `LandOp`): a use op that lands alone (a reveal and a stagger among them), a hit or a heal, an echo, time back (`refund`, 1 to 100%), or reforming a fallen minion (`reform`). */
function landOpOf(v: unknown, R: Rules, depth: number): LandOp | null {
  if (isObj(v) && v.op === 'refund') { const pct = num(v.pct, 1, 100); return pct === null ? null : { op: 'refund', pct }; }
  if (isObj(v) && v.op === 'reform') {
    const hpShare = num(v.hpShare, REFORM_SHARE_MIN, 1), mana = whole(v.mana, 0, R.fight.kit.hpFlat);
    return hpShare === null || mana === null ? null : { op: 'reform', hpShare, mana };
  }
  const o = opOf(v, R, depth);
  if (!o) return null;
  if (o.op === 'applyStatus' && isObj(v) && v.stacksBy !== undefined) {
    const stacksBy = formulaOf(v.stacksBy, R);
    return stacksBy ? { ...o, stacksBy } : null;
  }
  return o.op === 'damage' || o.op === 'heal' || o.op === 'echo' || oneOf(o.op, LAND_USE_OPS, null) ? o as LandOp : null;
}
const landOpsOf = (v: unknown, R: Rules, depth: number): LandOp[] | null =>
  Array.isArray(v) ? all(v.slice(0, R.fight.kit.triggerOps), R.fight.kit.triggerOps, x => landOpOf(x, R, depth)) : null;
/** A delayed effect (kits design 1.6): its first `triggerOps` ops, each of which must read, and what a cure does. */
function endOf(v: unknown, R: Rules, depth: number): End | null {
  if (!isObj(v)) return null;
  const ops = landOpsOf(v.ops, R, depth), cleanse = oneOf(v.cleanse, ['cancel', 'land'] as const, null);
  if (!ops || !cleanse) return null;
  const sourceHealShare = v.sourceHealShare === undefined ? undefined : within(v.sourceHealShare, 0, 2);
  if (sourceHealShare === null) return null;
  return sourceHealShare !== undefined && sourceHealShare > 0 ? { ops, cleanse, sourceHealShare } : { ops, cleanse };
}
/** A GM's word on an ability: lower-case letters, digits and hyphens, at most `tagLength`. */
const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const tagOf = (v: unknown, R: Rules): Tag | null => typeof v === 'string' && v.length <= R.fight.kit.tagLength && TAG_RE.test(v) ? tag(v) : null;
/** How often a trigger fires: each, once a round, or `n` a fight (clamped to 1 to `fightUses`). */
function limitOf(v: unknown, R: Rules): Limit | null {
  if (!isObj(v)) return null;
  if (v.kind === 'each' || v.kind === 'round') return { kind: v.kind };
  return v.kind === 'fight' ? { kind: 'fight', n: clamped(v.n, 1, R.fight.kit.fightUses) } : null;
}
const TRIGGER_ONS = [...BEARER_EVENTS, 'statusGained', 'statusEnded', 'used'] as const;
/**
 * A trigger (kits design 1.3): its event, its limit, where it lands (`self`, `other` only on an event with another body,
 * or a reach) and its first `triggerOps` ops. A hit, a crit, a kill or an avoid may name a tag (or null); a status gained
 * or ended names its key; an ability used names its tag. One with a refund fires once a round at most (design 1.3.8):
 * `each` reads as `round`.
 */
function triggerOf(v: unknown, R: Rules, depth: number): Trigger | null {
  if (!isObj(v)) return null;
  const on = oneOf(v.on, TRIGGER_ONS, null), limit0 = limitOf(v.limit, R), ops = landOpsOf(v.ops, R, depth);
  const to: Trigger['to'] | null = v.to === 'self' || v.to === 'other' ? v.to : reachOf(v.to, R);
  const need = v.need === undefined ? undefined : needOf(v.need, R);
  if (!on || !limit0 || !ops || !to || need === null) return null;
  const limit: Limit = limit0.kind === 'each' && ops.some(o => o.op === 'refund') ? { kind: 'round' } : limit0;
  const t = triggerOn(v, on, to, limit, ops, R);
  return t && need ? { ...t, need } : t;
}
/** A trigger's condition on where (kits design 8.8): a status key it holds, or a zone's name it stands in. */
function needOf(v: unknown, R: Rules): Need | null {
  if (!isObj(v)) return null;
  if (v.kind === 'holds') return isStatusKey(v.key) ? { kind: 'holds', key: v.key } : null;
  const zone = v.kind === 'inside' ? text(v.zone, ZONE_NAME_MAX) : null;
  return zone ? { kind: 'inside', zone } : null;
}
function triggerOn(v: Rec, on: (typeof TRIGGER_ONS)[number], to: Trigger['to'], limit: Limit, ops: LandOp[], R: Rules): Trigger | null {
  const party = oneOf(on, PARTY_EVENTS, null);
  if (party) { const t = v.tag === null ? null : tagOf(v.tag, R); return t === null && v.tag !== null ? null : { on: party, tag: t, to, limit, ops }; }
  if (to === 'other') return null;
  if (on === 'statusGained' || on === 'statusEnded') return isStatusKey(v.key) ? { on, key: v.key, to, limit, ops } : null;
  if (on === 'used') { const t = tagOf(v.tag, R); return t ? { on, tag: t, to, limit, ops } : null; }
  const self = oneOf(on, ALONE_EVENTS, null);
  return self && { on: self, to, limit, ops };
}

/**
 * A stacking status's rule: a cap clamped to 1 to `stackCap`, how stacks leave (an event from `BEARER_EVENTS`), whose
 * count it is, and a threshold or null. A threshold's count is clamped to 1 to the cap; its formula reads like any
 * other; it keeps its first `triggerOps` ops, each of which must read.
 */
function stackRuleOf(v: unknown, R: Rules, depth: number): StackRule | null {
  if (!isObj(v) || !isObj(v.leave)) return null;
  const K = R.fight.kit, cap = clamped(v.cap, 1, K.stackCap), leaveKind = oneOf(v.leave.kind, LEAVES, null), keep = oneOf(v.keep, KEEPS, null);
  let leave: StackRule['leave'] | null = null;
  if (leaveKind === 'event') { const event = oneOf(v.leave.event, BEARER_EVENTS, null); leave = event && { kind: 'event', event }; }
  else if (leaveKind) leave = { kind: leaveKind };
  if (!leave || !keep) return null;
  if (v.threshold === null || v.threshold === undefined) return { cap, leave, keep, threshold: null };
  const t = v.threshold;
  if (!isObj(t) || !isObj(t.at) || !Array.isArray(t.ops)) return null;
  const then = oneOf(t.then, THENS, null), to = reachOf(t.to, R), ops = all(t.ops.slice(0, K.triggerOps), K.triggerOps, x => landOpOf(x, R, depth));
  let at: Threshold['at'] | null = null;
  if (t.at.kind === 'count') at = { kind: 'count', n: clamped(t.at.n, 1, cap) };
  if (t.at.kind === 'formula') { const formula = formulaOf(t.at.formula, R); at = formula && { kind: 'formula', formula }; }
  return then && to && ops && at ? { cap, leave, keep, threshold: { at, to, ops, then } } : null;
}
/**
 * A status def from outside data (the GM's library in a save, a pack, a reward, a room message), or null when it is not
 * one: a label of at most 60 characters, a description of at most 500, at most 12 ops that each read, a colour `#rrggbb`
 * or none, and a stack rule (`stackRuleOf`) or none. An `applyStatus` op's own def is read three levels deep at most.
 * A def past a status's size (size.ts `THING_MAX.status`) is refused whole.
 */
export const parseStatusDef = (v: unknown, R: Rules, key?: string): StatusDef | null => { const def = defOf(v, R, 0, key); return def && withinSize('status', def) ? def : null; };
/** Whether `v` reads as a status def and is refused only for its size: what holds it (an item, a skill) is then refused whole. */
export const statusTooLarge = (v: unknown, R: Rules, key?: string): boolean => { const def = defOf(v, R, 0, key); return def !== null && !withinSize('status', def); };
/** One op from outside data (an item's effects in a save, a pack, a form), read as a status's op is. */
export const parseOp = (v: unknown, R: Rules): Op | null => opOf(v, R, 0);
/** One land op from outside data (a trigger's, threshold's, or end's op in a save, a pack, or a form). */
export const parseLandOp = (v: unknown, R: Rules): LandOp | null => landOpOf(v, R, 0);
/** A status's key, def and source, which a fight's status and a sheet's share. */
function keyDefSource(v: unknown, R: Rules): Pick<Status, 'key' | 'def' | 'source'> | null {
  if (!isObj(v) || !isObj(v.source)) return null;
  const key = idText(v.key), def = key ? parseStatusDef(v.def, R, key) : null, srcId = v.source.id === null ? null : idText(v.source.id), tier = whole(v.source.tier, 0, 5);
  if (!key || !def || (v.source.id !== null && srcId === null) || tier === null) return null;
  return { key: statusKey(key), def, source: { id: srcId === null ? null : combatantId(srcId), tier } };
}
function statusOf(v: unknown, R: Rules): Status | null {
  const base = keyDefSource(v, R);
  if (!base || !isObj(v)) return null;
  const until = v.until === null ? null : tickOf(v.until), since = tickOf(v.since), settledAt = tickOf(v.settledAt);
  const zone = v.zone === undefined ? undefined : typeof v.zone === 'string' && v.zone.length > 0 && v.zone.length <= 40 ? zoneId(v.zone) : null;
  if ((v.until !== null && until === null) || since === null || settledAt === null || zone === null) return null;
  const fields = { key: base.key, source: base.source, until, since, settledAt, ...(zone === undefined ? {} : { zone }), ...(v.worn === true ? { worn: true as const } : {}), ...(v.owed === true ? { owed: true as const } : {}) };
  return statusOn(base.def, fields, clamped(v.stacks, 1, R.fight.kit.stackCap));
}
/**
 * A status as a hunter's sheet keeps it (a condition in a save, a status a room message carries), or null when it is
 * not one: a key, a def that reads, a source (an id or null, a tier 0 to 5) and the rounds left, 0 or more, or null
 * for one that lasts until removed.
 */
export function parseSheetStatus(v: unknown, R: Rules): SheetStatus | null {
  const base = keyDefSource(v, R);
  if (!base || !isObj(v)) return null;
  const rounds = v.rounds === null ? null : num(v.rounds, 0, BIG);
  if (rounds === null && v.rounds !== null) return null;
  return isStacking(base.def) ? { ...base, rounds, stacks: clamped(v.stacks, 1, base.def.stack.cap) } : { ...base, rounds };
}

const KINDS = ['strike', 'shot', 'blast', 'curse', 'support'] as const;
const AIMS = ['foe', 'ally', 'self', 'place', 'corpse'] as const;
const RAISE_BONUS_MAX = 30;
const tileCount = (v: unknown) => { const n = whole(v, 0, 64); return n === null ? null : tiles(n); };
function shapeOf(v: unknown): Shape | null {
  if (!isObj(v)) return null;
  switch (v.kind) {
    case 'self': return { kind: 'self' };
    case 'touch': { const reach = tileCount(v.reach); return reach === null ? null : { kind: 'touch', reach }; }
    case 'line': { const width = tileCount(v.width), pierce = bool(v.pierce); return width === null || pierce === null ? null : { kind: 'line', width, pierce }; }
    case 'radius': {
      const radius = tileCount(v.radius);
      if (radius === null) return null;
      if (v.ring === null) return { kind: 'radius', radius, ring: null };
      const outer = isObj(v.ring) ? tileCount(v.ring.outer) : null, share = isObj(v.ring) ? num(v.ring.share, 0, 100) : null;
      return outer === null || share === null ? null : { kind: 'radius', radius, ring: { outer, share: percent(share) } };
    }
    default: return null;
  }
}
function deliveryOf(v: unknown): Delivery | null {
  if (!isObj(v)) return null;
  if (v.kind === 'direct' || v.kind === 'sure') return { kind: v.kind };
  if (v.kind !== 'travel') return null;
  const windup = tickOf(v.windup), speed = v.speed === 'instant' ? 'instant' : num(v.speed, 1, 1000);
  return windup === null || speed === null ? null : { kind: 'travel', windup, speed };
}
const EFFECT_TYPES = [...DAMAGE_TYPES, 'heal', 'shield'] as const;
/**
 * An ability's effect: by the rule (`by: 'rule'` with the ticks it is worked out from) or by hand (`by: 'hand'` with its
 * formula).
 */
function effectOf(v: Rec, R: Rules): AbilityEffect | null {
  const type = oneOf(v.type, EFFECT_TYPES, null);
  if (!type) return null;
  if (v.by === 'rule') { const ticks = ruleTicksOf(v.ticks, R); return ticks ? { type, by: 'rule', ticks } : null; }
  if (v.by !== 'hand') return null;
  const formula = formulaOf(v.formula, R);
  return formula ? { type, by: 'hand', formula } : null;
}
const MEASURES = ['target', 'user', 'maxPair', 'hpPair'] as const;
/** A rule's ticks: a scale (a stat, or null), a gap (two different stats, a bonus a point and a cap above 0, or null), and its scalers, each kept within its bounds (`bounded`). */
function ruleTicksOf(v: unknown, R: Rules): RuleTicks | null {
  if (!isObj(v)) return null;
  const scale = v.scale === null ? null : oneOf(v.scale, STAT_KEYS, null);
  if (scale === null && v.scale !== null) return null;
  const gap = v.gap === null ? null : gapRead(v.gap);
  if (gap === null && v.gap !== null) return null;
  const scalers = all(v.scalers, R.fight.kit.scalers, x => {
    if (!isObj(x)) return null;
    const measure = oneOf(x.measure, MEASURES, null), dir = oneOf(x.dir, ['under', 'over'] as const, null);
    return measure && dir && isNum(x.start) && isNum(x.scale) ? bounded({ measure, dir, start: x.start, scale: x.scale }, R) : null;
  });
  return scalers ? { scale, gap, scalers } : null;
}
function gapRead(v: unknown): Gap | null {
  if (!isObj(v)) return null;
  const mine = oneOf(v.mine, STAT_KEYS, null), theirs = oneOf(v.theirs, STAT_KEYS, null);
  return mine && theirs && mine !== theirs && isNum(v.per) && v.per > 0 && isNum(v.cap) && v.cap > 0 ? { mine, theirs, per: v.per, cap: v.cap } : null;
}
function abilityOf(v: unknown, R: Rules): Ability | null {
  if (!isObj(v) || !isObj(v.cost)) return null;
  const id = idText(v.id), name = text(v.name, NAME_MAX), desc = v.desc === undefined ? undefined : text(v.desc, ABILITY_DESC_MAX);
  const kind = oneOf(v.kind, KINDS, null), aim = oneOf(v.aim, AIMS, null);
  const fatigue = num(v.cost.fatigue, 0, 1000), mana = num(v.cost.mana, 0, 1000), time = num(v.cost.time, 1, 1000), cooldown = tickOf(v.cost.cooldown);
  const range = tileCount(v.range), shape = shapeOf(v.shape), delivery = deliveryOf(v.delivery), foesOnly = bool(v.foesOnly);
  const ops = all(v.ops, 12, x => useOpOf(x, R));
  let effect: AbilityEffect | null = null;
  if (v.effect !== null) {
    const e = isObj(v.effect) ? effectOf(v.effect, R) : null;
    if (!e) return null;
    effect = e;
  }
  let channel: Ability['channel'] = null;
  if (v.channel !== null) {
    const growth = isObj(v.channel) ? oneOf(v.channel.growth, ['linear', 'exponential'] as const, null) : null;
    const max = isObj(v.channel) ? whole(v.channel.max, 1, R.fight.channelMax) : null;
    if (!growth || max === null) return null;
    channel = { growth, max };
  }
  const zone = v.zone === undefined ? undefined : zoneSpecOf(v.zone, R), K = R.fight.kit;
  const tags = v.tags === undefined ? undefined : all(v.tags, K.tags, x => tagOf(x, R));
  const prices = v.prices === undefined ? undefined : all(v.prices, K.prices, x => priceOf(x, R));
  const gates = v.gates === undefined ? undefined : all(v.gates, K.gates, x => gateOf(x, R));
  const summon = v.summon === undefined ? undefined : summonOf(v.summon, R);
  const raise = v.raise === undefined ? undefined : raiseOf(v.raise);
  const usurp = v.usurp === undefined ? undefined : usurpOf(v.usurp, R);
  const w2 = abilityWave2(v, R), item = v.item === undefined ? undefined : parseSaveId<'i'>(v.item);
  const maxTier = v.maxTier === undefined ? undefined : whole(v.maxTier, 0, RANKS.length - 1);
  if (!id || name === null || desc === null || !kind || !aim || fatigue === null || mana === null || time === null || cooldown === null || range === null
    || !shape || !delivery || foesOnly === null || !ops || zone === null || tags === null || prices === null || gates === null || summon === null || raise === null || usurp === null || !w2 || item === null || maxTier === null) return null;
  if (w2.react && !ops.every(reactionMayHold)) return null;
  if (w2.react && usurp) return null;
  if (w2.move && channel) return null;
  const trimmedDesc = desc?.trim();
  return {
    id: abilityId(id), name, ...(trimmedDesc ? { desc: trimmedDesc } : {}), kind, cost: { fatigue, mana, time: cost(time), cooldown }, aim, range, shape, delivery, foesOnly, effect, ops,
    channel, ...(zone ? { zone } : {}), ...(tags ? { tags } : {}), ...(prices ? { prices } : {}), ...(gates ? { gates } : {}),
    ...(summon ? { summon } : {}), ...(raise ? { raise } : {}), ...(usurp ? { usurp } : {}), ...w2, ...(item ? { item } : {}), ...(maxTier === undefined ? {} : { maxTier }),
  };
}
/** Corpse-raising spec (Arise): check bonus, risen cap per caster, and elite corpse cap per fight. */
function raiseOf(v: unknown): RiseSpec | null {
  if (!isObj(v)) return null;
  const bonus = whole(v.bonus, 0, RAISE_BONUS_MAX), maxRisen = whole(v.maxRisen, 1, MAX_ROWS), elitePerFight = whole(v.elitePerFight, 0, MAX_ROWS);
  return bonus === null || maxRisen === null || elitePerFight === null ? null : { bonus, maxRisen, elitePerFight };
}
/** Proactive ability copy spec (Wave 5 Hook H3): `amp` clamped to `USURP_AMP_MIN`..`kit.critSizeMax`. */
function usurpOf(v: unknown, R: Rules): UsurpSpec | null {
  if (!isObj(v)) return null;
  const amp = within(v.amp, USURP_AMP_MIN, R.fight.kit.critSizeMax);
  return amp === null ? null : { amp };
}
/**
 * An ability's wave 2 parts (kits design 8.3 to 8.5), each left out when absent: a blink or a swap (optionally
 * restricted to `only: 'shadow' | 'minion'`); a reaction's moment and its reach (0 to `fieldRadiusMax` tiles); a zone act (shift
 * by 1 to `zoneMove`, grow by 1 to `zoneGrow`, erase by 1 to `zonesPerOwner`, a zone name or null for any). Null when one is there and does not read.
 */
function abilityWave2(v: Rec, R: Rules): Pick<Ability, 'move' | 'react' | 'zoneAct'> | null {
  const K = R.fight.kit;
  const moveKind = isObj(v.move) ? oneOf(v.move.kind, ['blink', 'swap'] as const, null) : null;
  const moveOnly = isObj(v.move) && v.move.only !== undefined ? oneOf(v.move.only, ['shadow', 'minion'] as const, null) : undefined;
  const move: Ability['move'] | null = v.move === undefined ? undefined
    : moveKind === 'blink' && moveOnly === undefined ? { kind: 'blink' }
    : moveKind === 'swap' && moveOnly !== null ? (moveOnly ? { kind: 'swap', only: moveOnly } : { kind: 'swap' })
    : null;
  const when = isObj(v.react) ? oneOf(v.react.when, REACT_WHEN, null) : null;
  const react = v.react === undefined ? undefined : isObj(v.react) && when ? { when, reach: tiles(clamped(v.react.reach, 0, R.fight.fieldRadiusMax)) } : null;
  const act = isObj(v.zoneAct) ? oneOf(v.zoneAct.act, ['shift', 'grow', 'erase'] as const, null) : null;
  const zName = isObj(v.zoneAct) ? (v.zoneAct.name === null ? null : text(v.zoneAct.name, ZONE_NAME_MAX)) : null;
  const zoneAct = v.zoneAct === undefined ? undefined : isObj(v.zoneAct) && act && (zName !== null || v.zoneAct.name === null)
    ? { act, name: zName, by: clamped(v.zoneAct.by, 1, act === 'shift' ? K.zoneMove : act === 'grow' ? K.zoneGrow : K.zonesPerOwner) } : null;
  if (move === null || react === null || zoneAct === null) return null;
  return { ...(move ? { move } : {}), ...(react ? { react } : {}), ...(zoneAct ? { zoneAct } : {}) };
}
/**
 * An extra cost (kits design 1.4): HP, flat (1 to `hpFlat`) or a share (`hpShareMin` to `hpShare`); stacks of a status
 * key, from the user or each target, `n` (1 to `stackCap`) or all; or the user's zones of a name (or any), one or all.
 */
function priceOf(v: unknown, R: Rules): Price | null {
  if (!isObj(v)) return null;
  const K = R.fight.kit;
  if (v.kind === 'hp' && isObj(v.amount)) {
    if (v.amount.kind === 'flat') return { kind: 'hp', amount: { kind: 'flat', n: clamped(v.amount.n, 1, K.hpFlat) } };
    const share = typeof v.amount.share === 'number' && Number.isFinite(v.amount.share) ? Math.max(K.hpShareMin, Math.min(K.hpShare, v.amount.share)) : null;
    return v.amount.kind === 'share' && share !== null ? { kind: 'hp', amount: { kind: 'share', share } } : null;
  }
  if (v.kind === 'stacks' && isObj(v.take)) {
    const from = oneOf(v.from, ['self', 'target'] as const, null);
    const take = v.take.kind === 'all' ? { kind: 'all' } as const : v.take.kind === 'n' ? { kind: 'n', n: clamped(v.take.n, 1, K.stackCap) } as const : null;
    return isStatusKey(v.key) && from && take ? { kind: 'stacks', key: v.key, from, take } : null;
  }
  if (v.kind === 'zone') {
    const name = v.name === null ? null : text(v.name, ZONE_NAME_MAX), take = oneOf(v.take, ['one', 'all'] as const, null);
    return (name !== null || v.name === null) && take ? { kind: 'zone', name, take } : null;
  }
  return null;
}
/** A condition (kits design 1.4): a status key held on the user or the target, at least 1 to `stackCap` stacks; or uses, 1 to `fightUses` a fight or a gate. */
function gateOf(v: unknown, R: Rules): AbilityGate | null {
  if (!isObj(v)) return null;
  const K = R.fight.kit;
  if (v.kind === 'holds') { const on = oneOf(v.on, ['self', 'target'] as const, null); return isStatusKey(v.key) && on ? { kind: 'holds', key: v.key, on, atLeast: clamped(v.atLeast, 1, K.stackCap) } : null; }
  if (v.kind === 'uses') { const per = oneOf(v.per, ['fight', 'gate'] as const, null); return per ? { kind: 'uses', per, n: clamped(v.n, 1, K.fightUses) } : null; }
  if (v.kind === 'inside') { const zone = text(v.zone, ZONE_NAME_MAX); return zone ? { kind: 'inside', zone } : null; }
  return null;
}
/** A timed summon (kits design 1.9): a name, an archetype, 1 to `summonRounds` rounds, and at most `MAX_STATUSES` starting statuses (a key and rounds). */
function summonOf(v: unknown, R: Rules): Summon | null {
  if (!isObj(v)) return null;
  const name = text(v.name, NAME_MAX), archetype = oneOf(v.archetype, ARCHETYPE_LIST, null);
  const statuses = all(v.statuses, MAX_STATUSES, x => isObj(x) && isStatusKey(x.key) ? { key: x.key, rounds: clamped(x.rounds, 1, R.fight.kit.summonRounds) } : null);
  return name && archetype && statuses ? { name, archetype, rounds: clamped(v.rounds, 1, R.fight.kit.summonRounds), statuses } : null;
}
/**
 * An ability from outside data (a skill or a monster in a save, a pack, a form), read as a fight row's is, except that
 * it is never a bag item's use: an `item` it claims is dropped, so no skill or monster spends an item (implicit audit 2, N16).
 */
function abilityRead(v: unknown, R: Rules): Ability | null {
  const a = abilityOf(v, R);
  if (!a || (a.item === undefined && a.maxTier === undefined)) return a;
  const { item: _item, maxTier: _maxTier, ...own } = a;
  return own;
}
/** `abilityRead`, with an ability past its size (size.ts `THING_MAX.ability`) refused whole. */
export function parseAbility(v: unknown, R: Rules): Ability | null { const a = abilityRead(v, R); return a && withinSize('ability', a) ? a : null; }
/** Whether `v` reads as an ability and is refused only for its size: a skill that is this ability is then refused whole. */
export const abilityTooLarge = (v: unknown, R: Rules): boolean => { const a = abilityRead(v, R); return a !== null && !withinSize('ability', a); };

// ── a row ──
const ARCHETYPE_LIST: readonly Archetype[] = ['brute', 'skirmisher', 'caster'];
const MONSTER_KINDS = (R: Rules) => Object.keys(R.fight.kinds) as MonsterKind[];
const MONSTER_TRAITS = (R: Rules) => Object.keys(R.fight.traits) as MonsterTrait[];
/** A seed's tweak: an HP factor above 0 and at most 100 (edited HP times difficulty), a dealt factor up to 100, points added to named stats, and the traits of `R.fight.traits` it names, each once. */
function tweakOf(v: unknown, R: Rules): Tweak | null {
  if (!isObj(v) || !isObj(v.stats) || !Array.isArray(v.traits)) return null;
  const hp = num(v.hp, 0, 100), dealt = num(v.dealt, 0, 100), stats: Partial<Record<(typeof STAT_KEYS)[number], number>> = {}, traits: MonsterTrait[] = [];
  for (const [k, x] of Object.entries(v.stats)) { const key = oneOf(k, STAT_KEYS, null), n = num(x, -10000, 10000); if (!key || n === null) return null; stats[key] = n; }
  for (const t of v.traits) { const trait = oneOf(t, MONSTER_TRAITS(R), null); if (!trait || traits.includes(trait)) return null; traits.push(trait); }
  return hp === null || hp === 0 || dealt === null ? null : { hp, dealt, stats, traits };
}
function originOf(v: unknown, R: Rules): Origin | null {
  if (!isObj(v)) return null;
  if (v.kind === 'monster') {
    const rank = oneOf(v.rank, RANKS, null), archetype = oneOf(v.archetype, ARCHETYPE_LIST, null), monsterKind = oneOf(v.monsterKind, MONSTER_KINDS(R), null);
    const tweak = tweakOf(v.tweak, R), name = text(v.name, NAME_MAX);
    const type = typeof v.type === 'string' && v.type ? v.type.slice(0, TYPE_MAX) : null;
    return name !== null && rank && archetype && monsterKind && tweak ? { kind: 'monster', name, rank, archetype, monsterKind, tweak, ...(type ? { type } : {}), ...(isIconKey(v.icon) ? { icon: v.icon } : {}) } : null;
  }
  if (v.kind !== 'hunter' || !isObj(v.build) || !isObj(v.build.stats) || !isObj(v.build.perks)) return null;
  const b = v.build, statsIn = b.stats as Rec, perksIn = b.perks as Rec;
  const stats = Object.fromEntries(STAT_KEYS.map(k => [k, num(statsIn[k], 0, 10000)]));
  if (Object.values(stats).some(x => x === null)) return null;
  const level = parseLevel(b.level);
  const gear = all(b.gear, 12, (g): GearPiece | null => {
    if (!isObj(g)) return null;
    const weight = num(g.weight, 0, 1000), armor = num(g.armor, 0, 10000), resist = num(g.resist, 0, 10000);
    if (weight === null || armor === null || resist === null) return null;
    return { weight, armor, resist };
  });
  const keys = [...STAT_KEYS, ...SHEET_KEYS] as string[];
  const perks: Rec = {};
  for (const [k, x] of Object.entries(perksIn)) { const n = num(x, -10000, 10000); if (!keys.includes(k) || n === null) return null; perks[k] = n; }
  if (level === null || !gear) return null;
  return { kind: 'hunter', build: { stats: stats as Record<(typeof STAT_KEYS)[number], number>, level, gear, perks: perks as Bonus } };
}
function holderOf(v: unknown): Holder | null | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  if (v.kind === 'local') { const h = idText(v.hunterId); return h ? { kind: 'local', hunterId: hunterId(h) } : undefined; }
  if (v.kind === 'remote') { const k = parseSheetKey(v.remote); return k ? { kind: 'remote', remote: k } : undefined; }
  if (v.kind === 'shadow') {
    const h = idText(v.hunterId), s = idText(v.shadowId);
    return h && s ? { kind: 'shadow', hunterId: hunterId(h), shadowId: shadowId(s) } : undefined;
  }
  if (v.kind === 'remoteShadow') {
    const k = parseSheetKey(v.remote), s = idText(v.shadowId);
    return k && s ? { kind: 'remoteShadow', remote: k, shadowId: shadowId(s) } : undefined;
  }
  return undefined;
}
function idRecord<K extends string, T>(v: unknown, max: number, read: (x: unknown) => T | null, brandOf: (s: string) => K): Readonly<Record<K, T>> | null {
  if (!isObj(v) || Object.keys(v).length > max) return null;
  const out = {} as Record<K, T>;
  for (const [k, x] of Object.entries(v)) { const r = read(x); if (r === null || !idText(k)) return null; out[brandOf(k)] = r; }
  return out;
}
const SIDES = ['party', 'foe'] as const;
const BODY_KINDS = ['hunter', 'monster', 'shadow', 'summon'] as const;
const CHANNEL_STATES = ['holding', 'broken', 'fired'] as const;
/**
 * A life of any row but a hunter's (row-life.ts `FoeLife`): up at 1 to its maximum HP, or dead. A hunter's is read as a
 * sheet stores it (vitals.ts `parseLife`). Null when it reads as neither: a fight stored before rows held their life (an
 * `hp` number) reads as no fight, and its hunters keep their sheets.
 */
function foeLifeOf(v: unknown, hpMax: number): FoeLife | null {
  if (!isObj(v)) return null;
  if (v.at === 'dead') return { at: 'dead' };
  const hp = v.at === 'up' ? whole(v.hp, 1, BIG) : null;
  return hp === null ? null : { at: 'up', hp: Math.min(hp, Math.max(1, hpMax)) };
}
/** A stored stagger bar (design 4.3), or null for none; undefined when it does not read. */
function staggerOf(v: unknown): Stagger | null | undefined {
  if (v === null) return null;
  const s = isObj(v) ? v : {}, fill = num(s.fill, 0, BIG), max = num(s.max, 0, BIG), hit = num(s.hit, 0, BIG);
  if (fill === null || max === null || hit === null) return undefined;
  const until = s.until === undefined ? null : tickOf(s.until);
  return until === null ? { fill, max, hit } : { fill, max, hit, until };
}
/** A stored intent (design 4.5), or null for none; undefined when it does not read. */
function intentOf(v: unknown, grid: Grid): Intent | null | undefined {
  if (v === null) return null;
  const i = isObj(v) ? v : {}, ability = idText(i.ability), aim = aimOn(i.aim, grid);
  return ability && aim ? { ability: abilityId(ability), aim, revealed: i.revealed === true } : undefined;
}
const MYTHIC_AT = ['calm', 'omen', 'faltering'] as const;
/**
 * A stored mythic standing (design B.3), or null for none; undefined when it does not read: its script is one the
 * registry holds, its phase one of the script's, an omen standing one of the script's (a faltering one an omen that can
 * be weakened) aimed at a row or a tile of the grid.
 */
function mythicOf(v: unknown, grid: Grid): MythicStanding | null | undefined {
  if (v === null) return null;
  const m = isObj(v) ? v : {}, at = oneOf(m.at, MYTHIC_AT, null), script = isMythicScriptId(m.script) ? m.script : null;
  if (!at || !script) return undefined;
  const s = mythicScriptOf(script), phase = whole(m.phase, 0, s.phases.length - 1), beat = whole(m.beat, 0, BIG), since = tickOf(m.since);
  if (phase === null || beat === null || since === null) return undefined;
  if (at === 'calm') return { at, script, phase, beat, since };
  const key = typeof m.omen === 'string' && Object.hasOwn(s.omens, m.omen) ? m.omen as OmenKey : null;
  const aim = aimOn(m.aim, grid), hpAt = whole(m.hpAt, 0, BIG), barAt = barAtOf(m.barAt);
  if (!key || !aim || hpAt === null || barAt === undefined || (at === 'faltering' && s.omens[key]!.weak === null)) return undefined;
  return { at, script, phase, beat, since, omen: key, aim, hpAt, barAt };
}
/** A stored omen's bar as it found it (decision 42), or null for none; undefined when it does not read. */
function barAtOf(v: unknown): BarAt | null | undefined {
  if (v === null) return null;
  const b = isObj(v) ? v : {}, fill = num(b.fill, 0, BIG), max = num(b.max, 0, BIG);
  return fill === null || max === null ? undefined : { fill, max };
}
/** A stored threat table, or null for none; undefined when it does not read. */
const threatOf = (v: unknown): ThreatTable | null | undefined => v === null ? null : idRecord<CombatantId, number>(v, MAX_ROWS, x => num(x, 0, BIG), combatantId) ?? undefined;
/** What a row's own fields read against: the stored row, its grid and its maximum HP. */
type OwnIn = { readonly v: Rec; readonly grid: Grid; readonly hpMax: number };
/** The fields of another kind a kind holds as null (`HunterRow` and the rest, effect-ops.ts): each must be stored as null. */
const NULLS = (v: Rec, keys: readonly ('holder' | 'threat' | 'stagger' | 'intent' | 'mythic')[]): boolean => keys.every(k => v[k] === null);
/** The fields of another kind a kind holds absent: each must be absent from the stored row. */
const ABSENT = (v: Rec, keys: readonly ('moved' | 'extractBonus' | 'npc' | 'owner' | 'until' | 'extraction' | 'rose' | 'adjust' | 'force' | 'bled')[]): boolean => keys.every(k => v[k] === undefined);
/** The fields a row's kind decides (effect-ops.ts `HunterRow` and the rest), one kind's at a time. */
type OwnKey = 'kind' | 'life' | 'holder' | 'threat' | 'stagger' | 'intent' | 'xp' | 'mythic' | 'moved' | 'extractBonus' | 'npc' | 'owner' | 'until' | 'extraction' | 'rose' | 'adjust' | 'force' | 'bled';
type OwnOf = Pick<HunterRow, OwnKey> | Pick<MonsterRow, OwnKey> | Pick<ShadowRow, OwnKey> | Pick<SummonRow, OwnKey>;
/**
 * A row's own fields, read by its kind (SMX-rules-8): each kind reads its own and requires another kind's to be null or
 * absent, so a stored row that holds a field of another kind (a hunter's stagger bar, a live monster's holder, a summon
 * with no owner) does not read, and neither does its fight. Its life is read by its kind too: a hunter's as a sheet
 * stores it, the rest's by `foeLifeOf`.
 */
const OWN: { readonly [K in CombatantKind]: (o: OwnIn) => OwnOf | null } = {
  hunter: ({ v, hpMax }) => {
    const holder = holderOf(v.holder), life = parseLife(v.life, Math.max(1, hpMax));
    const moved = v.moved === undefined ? undefined : whole(v.moved, 1, BIG);
    const extractBonus = v.extractBonus === undefined ? undefined : whole(v.extractBonus, 1, 5);
    let npc: HunterRow['npc'] | null = undefined;
    if (v.npc !== undefined) {
      if (!isObj(v.npc)) return null;
      const skill = whole(v.npc.skill, 1, 5);
      if (skill === null) return null;
      npc = { skill: skill as NpcSkill };
    }
    const xp = npc ? whole(v.xp, 0, BIG) : (v.xp === 0 ? 0 : null);
    const stagger = npc && v.side === 'foe' ? staggerOf(v.stagger) : (v.stagger === null ? null : undefined);
    if (holder === undefined || holder?.kind === 'shadow' || holder?.kind === 'remoteShadow' || !life || xp === null || stagger === undefined || moved === null || extractBonus === null) return null;
    if (npc && holder !== null) return null;
    if (!NULLS(v, ['threat', 'intent', 'mythic']) || !ABSENT(v, ['owner', 'until', 'extraction', 'rose', 'adjust', 'force', 'bled'])) return null;
    return {
      kind: 'hunter', life, holder, threat: null, stagger, intent: null, xp, mythic: null,
      ...(moved === undefined ? {} : { moved }), ...(extractBonus === undefined ? {} : { extractBonus }),
      ...(npc ? { npc } : {}),
    };
  },
  monster: ({ v, grid, hpMax }) => {
    const life = foeLifeOf(v.life, hpMax), threat = threatOf(v.threat), stagger = staggerOf(v.stagger);
    const intent = intentOf(v.intent, grid), xp = whole(v.xp, 0, BIG), extraction = v.extraction === undefined ? undefined : extractionOf(v.extraction);
    const mythic = mythicOf(v.mythic, grid), rose = v.rose === undefined ? undefined : v.rose === true ? true as const : null;
    const rawAdjust = v.adjust === undefined ? undefined : (typeof v.adjust === 'number' && Number.isSafeInteger(v.adjust) ? v.adjust : null);
    const adjust = rawAdjust === 0 ? null : rawAdjust;
    const force = v.force === undefined ? undefined : oneOf(v.force, FORCED_FACES, null);
    const bled = v.bled === undefined ? undefined : v.bled === true ? true as const : null;
    if (!life || !threat || stagger === undefined || intent === undefined || xp === null || extraction === null || mythic === undefined || rose === null || adjust === null || force === null || bled === null) return null;
    if (!NULLS(v, ['holder']) || !ABSENT(v, ['moved', 'extractBonus', 'npc', 'owner', 'until'])) return null;
    return { kind: 'monster', life, holder: null, threat, stagger, intent, xp, mythic, ...(extraction === undefined ? {} : { extraction }), ...(rose ? { rose } : {}), ...(adjust === undefined ? {} : { adjust }), ...(force === undefined ? {} : { force }), ...(bled ? { bled } : {}) };
  },
  shadow: ({ v, hpMax }) => {
    const life = foeLifeOf(v.life, hpMax), read = holderOf(v.holder), owner = idText(v.owner);
    const holder = read === null ? null : read?.kind === 'shadow' || read?.kind === 'remoteShadow' ? read : undefined;
    if (!life || holder === undefined || !owner || v.xp !== 0) return null;
    if (!NULLS(v, ['threat', 'stagger', 'intent', 'mythic']) || !ABSENT(v, ['moved', 'extractBonus', 'npc', 'until', 'extraction', 'rose', 'adjust', 'force', 'bled'])) return null;
    return { kind: 'shadow', life, holder, threat: null, stagger: null, intent: null, xp: 0, mythic: null, owner: combatantId(owner) };
  },
  summon: ({ v, hpMax }) => {
    const life = foeLifeOf(v.life, hpMax), threat = threatOf(v.threat), owner = idText(v.owner);
    const until = v.until === null ? null : tickOf(v.until);
    const rose = v.rose === undefined ? undefined : idText(v.rose);
    if (!life || threat === undefined || !owner || (v.until !== null && until === null) || rose === null || v.xp !== 0) return null;
    if ((until === null) !== (rose !== undefined)) return null;
    if (!NULLS(v, ['holder', 'stagger', 'intent', 'mythic']) || !ABSENT(v, ['moved', 'extractBonus', 'npc', 'extraction', 'adjust', 'force', 'bled'])) return null;
    return { kind: 'summon', life, holder: null, threat, stagger: null, intent: null, xp: 0, mythic: null, owner: combatantId(owner), until, ...(rose !== undefined ? { rose: combatantId(rose) } : {}) };
  },
};
function rowOf(v: unknown, grid: Grid, R: Rules): Body | null {
  if (!isObj(v)) return null;
  const id = idText(v.id), name = text(v.name, NAME_MAX), side = oneOf(v.side, SIDES, null), kind = oneOf(v.kind, BODY_KINDS, null);
  const origin = originOf(v.origin, R), tier = whole(v.tier, 0, 5), at = tickOf(v.at), tie = num(v.tie, -BIG, BIG);
  const statuses = all(v.statuses, MAX_STATUSES, x => statusOf(x, R)), abilities = all(v.abilities, MAX_ABILITIES, x => abilityOf(x, R));
  const where = tileOn(v.place, grid);
  if (!id || name === null || !side || !kind || !origin || tier === null || at === null || tie === null || !statuses || !abilities || !where) return null;
  const { stats, sheet } = modified(origin, statuses, R);
  const own = OWN[kind]({ v, grid, hpMax: sheet.hpMax });
  // a maximum worked out from today's rules may be lower than when the row was stored (a GM lowered a rule): the row
  // keeps at most its maximum, as a stack keeps at most its cap, and the fight still reads
  const upTo = (x: unknown, max: number): number | null => { const n = num(x, 0, BIG); return n === null ? null : Math.min(n, max); };
  const mana = upTo(v.mana, sheet.manaMax), fatigue = upTo(v.fatigue, sheet.fatigueMax);
  const readyAt = idRecord<AbilityId, Tick>(v.readyAt, MAX_ABILITIES, tickOf, abilityId);
  let shield: Body['shield'] = null, channel: Channel | null = null;
  if (v.shield !== null) {
    const amount = isObj(v.shield) ? num(v.shield.amount, 0, BIG) : null, until = isObj(v.shield) ? tickOf(v.shield.until) : null;
    if (amount === null || until === null) return null;
    shield = { amount, until };
  }
  if (v.channel !== null) {
    const c = isObj(v.channel) ? v.channel : {}, ability = idText(c.ability), aim = aimOn(c.aim, grid);
    const charge = whole(c.charge, 0, R.fight.channelMax), spent = whole(c.spent, 0, BIG), state = oneOf(c.state, CHANNEL_STATES, null);
    if (!ability || !aim || charge === null || spent === null || !state) return null;
    channel = { ability: abilityId(ability), aim, charge, spent, state };
  }
  const tally = v.tally === undefined ? undefined : tallyRead(v.tally);
  const used = v.used === undefined ? undefined : idRecord<AbilityId, number>(v.used, MAX_ABILITIES, x => whole(x, 0, R.fight.kit.fightUses), abilityId);
  if (used === null) return null;
  const trips = v.trips === undefined ? undefined : idRecord<string, Trip>(v.trips, MAX_STATUSES * R.fight.kit.triggers, tripOf, k => k);
  const warded = v.warded === undefined ? undefined : all(v.warded, 2, x => oneOf(x, ['untargetable', 'invulnerable'] as const, null));
  const ex = isObj(v.extras) ? v.extras : null, exRound = ex && whole(ex.round, 0, BIG), exN = ex && whole(ex.n, 1, BIG);
  const extras = v.extras === undefined ? undefined : exRound !== null && exN !== null ? { round: exRound, n: exN } : null, hastened = v.hastened === undefined ? undefined : v.hastened === true ? true : null;
  const ar = isObj(v.armed) ? v.armed : null, arAbility = ar && idText(ar.ability), arOn = ar && (ar.on === null ? null : idText(ar.on)), arSpent = ar && bool(ar.spent);
  const armed = v.armed === undefined ? undefined : ar && arAbility && (arOn !== null || ar.on === null) && arSpent !== null
    ? { ability: abilityId(arAbility), on: arOn === null ? null : combatantId(arOn), spent: arSpent } : null;
  if (warded === null || extras === null || hastened === null || armed === null) return null;
  if (own === null || mana === null || fatigue === null || !readyAt || trips === null) return null;
  // a body on the map stands where a body may; a monster or shadow at 0 is gone from it, and a wall may since cover its tile
  if ((own.life.at === 'up' || own.kind === 'hunter') && !placeOn(where, grid)) return null;
  return {
    id: combatantId(id), name, side, origin, tier, stats, sheet, place: where, mana, fatigue, shield, channel,
    statuses, readyAt, abilities, at, speed: sheet.speed, tie, ...(trips ? { trips } : {}), ...(tally ? { tally } : {}), ...(used === undefined ? {} : { used }),
    ...(warded === undefined ? {} : { warded }), ...(extras === undefined ? {} : { extras }), ...(hastened ? { hastened } : {}), ...(armed ? { armed } : {}),
    ...own,
  };
}
/** A corpse's extraction (extraction.ts): open with the attempts made (a rule lowered since leaves it none left), or gone and why. */
function extractionOf(v: unknown): Extraction | null {
  if (!isObj(v)) return null;
  if (v.at === 'open') { const tried = whole(v.tried, 1, BIG); return tried === null ? null : { at: 'open', tried }; }
  const why = v.at === 'gone' ? oneOf(v.why, ['risen', 'crumbled', 'spent'] as const, null) : null;
  return why ? { at: 'gone', why } : null;
}
/** Where a trigger stands against its limit (triggers.ts `Trip`). */
function tripOf(v: unknown): Trip | null {
  if (!isObj(v)) return null;
  if (v.at === 'ready' || v.at === 'spent') return { at: v.at };
  if (v.at === 'tripped') { const round = whole(v.round, 0, BIG); return round === null ? null : { at: 'tripped', round }; }
  if (v.at === 'counting') { const k = whole(v.k, 1, BIG); return k === null ? null : { at: 'counting', k }; }
  return null;
}

function pendingOf(v: unknown, R: Rules): DueTurn | null {
  if (isObj(v) && isObj(v.spread)) {
    const id = idText(v.id), p = v.spread, key = idText(p.key), base = keyDefSource({ key: p.status, def: p.def, source: p.source }, R);
    const length = p.length === null ? null : tickOf(p.length), aim = num(p.aim, -BIG, BIG), targets = all(p.targets, MAX_ROWS, idText);
    if (!id || !key || !base || (p.length !== null && length === null) || aim === null || !targets) return null;
    return { id: combatantId(id), spread: { key: statusKey(key), status: base.key, def: base.def, source: base.source, length, aim, targets: targets.map(combatantId) } };
  }
  if (!isObj(v) || !isObj(v.due)) return null;
  const id = idText(v.id), d = v.due, key = idText(d.key), op = opOf(d.op, R, 0), tier = whole(d.tier, 0, 5);
  const before = num(d.before, 0, BIG), share = num(d.share, 0, BIG);
  const sourceId = d.sourceId === undefined ? undefined : idText(d.sourceId);
  if (!id || !key || !op || !amountOp(op) || tier === null || before === null || share === null || sourceId === null) return null;
  const due: Due = { key: statusKey(key), op, tier, before, share, stacks: clamped(d.stacks, 1, R.fight.kit.stackCap), ...(sourceId !== undefined ? { sourceId: combatantId(sourceId) } : {}) };
  return { id: combatantId(id), due };
}
function summaryOf(v: unknown): Summary | null {
  if (!isObj(v)) return null;
  const rounds = num(v.rounds, 0, BIG), winner = v.winner === null ? null : oneOf(v.winner, SIDES, undefined), down = all(v.down, MAX_ROWS, idText);
  const xp = whole(v.xp, 0, Number.MAX_SAFE_INTEGER);
  if (rounds === null || winner === undefined || !down || xp === null) return null;
  let rested: Record<CombatantId, number> | undefined;
  if (v.rested !== undefined) {
    if (!isObj(v.rested)) return null;
    const entries = Object.entries(v.rested);
    if (entries.length > MAX_ROWS) return null;
    const out: Record<CombatantId, number> = {};
    for (const [k, raw] of entries) {
      const id = idText(k), n = num(raw, 0, BIG);
      if (!id || n === null || n <= 0) return null;
      out[combatantId(id)] = n;
    }
    if (entries.length) rested = out;
  }
  return { rounds, winner, down: down.map(combatantId), xp, ...(rested ? { rested } : {}) };
}

/** Who has held each spreading status: at most `MAX_SPREAD` keys, each with at most `MAX_ROWS` row ids. */
function hadOf(v: unknown): Fight['had'] | null {
  if (!isObj(v) || Object.keys(v).length > MAX_SPREAD) return null;
  const out: Record<StatusKey, CombatantId[]> = {};
  for (const [k, ids] of Object.entries(v)) { const list = all(ids, MAX_ROWS, idText); if (!idText(k) || !list) return null; out[statusKey(k)] = list.map(combatantId); }
  return out;
}

/**
 * The GM's weight on a fight in setup or running (notes-8-fudge.md section 2). Null when malformed, a weight is not a
 * whole number, a forced face is not 1 or 20, or it names a row the fight lacks. A row's weight of 0 leaves no entry,
 * as `fudgeStep` leaves none.
 */
function fudgeOf(v: unknown, rows: readonly Body[]): Fudge | null {
  if (!isObj(v) || !isObj(v.sides) || !isObj(v.rows) || !isObj(v.forced)) return null;
  const weight = (n: unknown): number | null => typeof n === 'number' && Number.isSafeInteger(n) ? n : null;
  const party = weight(v.sides.party), foe = weight(v.sides.foe), ids = new Set<string>(rows.map(r => r.id));
  if (party === null || foe === null) return null;
  const own: Record<CombatantId, number> = {}, forced: Record<CombatantId, ForcedFace> = {};
  for (const [k, n] of Object.entries(v.rows)) {
    const w = weight(n);
    if (!ids.has(k) || w === null) return null;
    if (w !== 0) own[combatantId(k)] = w;
  }
  for (const [k, face] of Object.entries(v.forced)) {
    const f = oneOf(face, FORCED_FACES, null);
    if (!ids.has(k) || f === null) return null;
    forced[combatantId(k)] = f;
  }
  return { sides: { party, foe }, rows: own, forced };
}

const MAX_ROLL_DICE = 20;
const KEY_MAX = 80;
/** Bounded rolls of a held use (`Rolls`), keeping optional maps absent when omitted so round-trips stay lossless. */
function rollsOf(v: unknown): Rolls | null {
  if (!isObj(v) || !isObj(v.dice) || !isObj(v.react)) return null;
  const diceEntries = Object.entries(v.dice), reactEntries = Object.entries(v.react);
  if (diceEntries.length > MAX_ROWS || reactEntries.length > MAX_ROWS) return null;
  const dice: Record<CombatantId, number[]> = {}, react: Record<CombatantId, number> = {};
  for (const [k, list] of diceEntries) {
    const id = idText(k), nums = all(list, MAX_ROLL_DICE, x => whole(x, -BIG, BIG));
    if (!id || !nums) return null;
    dice[combatantId(id)] = nums;
  }
  for (const [k, n] of reactEntries) {
    const id = idText(k), d = whole(n, -BIG, BIG);
    if (!id || d === null) return null;
    react[combatantId(id)] = d;
  }
  const refund = v.refund === undefined ? undefined : whole(v.refund, -BIG, BIG);
  if (refund === null) return null;
  let second: Record<CombatantId, number> | undefined;
  if (v.second !== undefined) {
    if (!isObj(v.second) || Object.keys(v.second).length > MAX_ROWS) return null;
    second = {};
    for (const [k, n] of Object.entries(v.second)) {
      const id = idText(k), d = whole(n, -BIG, BIG);
      if (!id || d === null) return null;
      second[combatantId(id)] = d;
    }
  }
  let boost: Record<HeldDieId, number> | undefined;
  if (v.boost !== undefined) {
    if (!isObj(v.boost) || Object.keys(v.boost).length > MAX_ROWS * MAX_STATUSES) return null;
    boost = {};
    for (const [k, n] of Object.entries(v.boost)) {
      const id = text(k, KEY_MAX), d = whole(n, -BIG, BIG);
      if (!id || d === null) return null;
      boost[id as HeldDieId] = d;
    }
  }
  return { dice, react, ...(refund !== undefined ? { refund } : {}), ...(second !== undefined ? { second } : {}), ...(boost !== undefined ? { boost } : {}) };
}
/** A held `act` or `release` command inside an open `DodgeWait`. */
function heldUseOf(v: unknown, grid: Grid, ids: ReadonlySet<string>): HeldUse | null {
  if (!isObj(v)) return null;
  const by = idText(v.by), rolls = rollsOf(v.rolls);
  if (!by || !ids.has(by) || !rolls) return null;
  if (v.type === 'release') return { type: 'release', by: combatantId(by), rolls };
  if (v.type !== 'act') return null;
  const ability = idText(v.ability), aim = aimOn(v.aim, grid);
  if (!ability || !aim || (typeof aim === 'string' && !ids.has(aim))) return null;
  const force = v.force === undefined ? undefined : bool(v.force);
  if (force === null) return null;
  return { type: 'act', by: combatantId(by), ability: abilityId(ability), aim, rolls, ...(force !== undefined ? { force } : {}) };
}
/** An open `DodgeWait` on a running fight, or null when malformed. */
function dodgeOf(v: unknown, grid: Grid, rows: readonly Body[]): DodgeWait | null {
  if (!isObj(v) || !isObj(v.to)) return null;
  const ids = new Set<string>(rows.map(r => r.id)), n = whole(v.n, 1, BIG), use = heldUseOf(v.use, grid, ids);
  const toEntries = Object.entries(v.to);
  if (n === null || !use || toEntries.length > MAX_ROWS) return null;
  const to: Record<CombatantId, Place> = {};
  for (const [k, p] of toEntries) {
    const at = tileOn(p, grid);
    if (!ids.has(k) || !at) return null;
    to[combatantId(k)] = at;
  }
  return { n, use, to };
}

/** A log line: its words, optional player-safe `table` words, and the ids of the rows (at most `MAX_ROWS`) and zones (`MAX_ZONES`) it is about. */
function logLineOf(v: unknown): LogLine | null {
  if (!isObj(v)) return null;
  const words = text(v.text, LOG_LINE_MAX), rows = all(v.rows, MAX_ROWS, idText), zones = all(v.zones, MAX_ZONES, idText);
  const table = v.table === undefined ? undefined : text(v.table, LOG_LINE_MAX);
  if (words === null || !rows || !zones || table === null) return null;
  return table === undefined
    ? { text: words, rows: rows.map(combatantId), zones: zones.map(zoneId) }
    : { text: words, rows: rows.map(combatantId), zones: zones.map(zoneId), table };
}

/**
 * The fight in `raw`, or null when it is not one: an unknown phase, a bad map, a row that does not read, two rows with
 * one id, two up rows on one tile, or a running fight whose current row is missing. Keys a fight does not have are dropped.
 */
export function parseFight(raw: unknown, R: Rules): Fight | null {
  if (!isObj(raw)) return null;
  const id = idText(raw.id), phase = oneOf(raw.phase, PHASES, null), grid = gridOf(raw.grid);
  const log = all(raw.log, LOG_CAP, logLineOf), banked = whole(raw.banked, 0, Number.MAX_SAFE_INTEGER);
  if (!id || !phase || !grid || !log || banked === null) return null;
  const rows = all(raw.rows, MAX_ROWS, x => rowOf(x, grid, R));
  if (!rows || new Set(rows.map(r => r.id)).size !== rows.length) return null;
  if (rows.some(r => r.kind === 'shadow' && !rows.some(o => o.id === r.owner && o.kind === 'hunter'))) return null;
  const tiles = rows.filter(r => isUp(r) || r.kind === 'hunter').map(r => `${r.place.x},${r.place.y}`);
  if (new Set(tiles).size !== tiles.length) return null;
  const zones = all(raw.zones, MAX_ZONES, x => parseZone(x, grid, R)), fog = fogOn(raw.fog, grid);
  if (!zones || fog === undefined || new Set(zones.map(z => z.id)).size !== zones.length) return null;
  const had = hadOf(raw.had);
  if (!had) return null;
  const shared = { id: fightId(id), grid, zones, fog, rows, log, banked, had };
  if (phase === 'ended') {
    const now = tickOf(raw.now), summary = summaryOf(raw.summary);
    const sizedFor = raw.sizedFor === undefined ? undefined : num(raw.sizedFor, 1, 200);
    return now !== null && summary && sizedFor !== null ? { phase, ...shared, now, summary, ...(sizedFor !== undefined ? { sizedFor } : {}) } : null;
  }
  const fudge = fudgeOf(raw.fudge, rows);
  if (!fudge) return null;
  if (phase === 'setup') {
    const partyScaled = raw.partyScaled === undefined ? undefined : raw.partyScaled === true ? true as const : null;
    return partyScaled === null ? null : { phase, ...shared, fudge, ...(partyScaled ? { partyScaled } : {}) };
  }
  const now = tickOf(raw.now);
  if (now === null) return null;
  const currentId = idText(raw.currentId), pending = all(raw.pending, MAX_PENDING, x => pendingOf(x, R));
  if (!currentId || !rows.some(r => r.id === currentId) || !pending) return null;
  const dodges = raw.dodges === undefined ? undefined : whole(raw.dodges, 0, BIG);
  const dodge = raw.dodge === undefined ? undefined : dodgeOf(raw.dodge, grid, rows);
  const sizedFor = raw.sizedFor === undefined ? undefined : num(raw.sizedFor, 1, 200);
  if (dodges === null || dodge === null || sizedFor === null) return null;
  if (dodge && (pending.length > 0 || (dodges !== undefined && dodges < dodge.n))) return null;
  return {
    phase, ...shared, now, currentId: combatantId(currentId), pending, fudge,
    ...(dodges !== undefined ? { dodges } : {}), ...(dodge ? { dodge } : {}), ...(sizedFor !== undefined ? { sizedFor } : {}),
  };
}

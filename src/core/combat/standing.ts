// standing.ts: whether a status counts at all (its own life, SMX-rules-2: `statusStep`, `counts`), and what a body's
// statuses say of it in a use, for the ops of wave 2 (docs/agent-handoff/kits/design.md 8.1 and 8.2): the sheet changes
// a `sheet` op makes after `derive`, the faces a foe crits it on (`exposed`), the tiles its
// ranges gain, the shares of rule 11c (damage dealt and taken, heals received), and whether a status is harmful. Pure
// reads: nothing here changes a body. resolve.ts, land.ts, fight-turn.ts and effect-ops.ts `modified` call it. A new
// reading of a wave 2 op is a function here with a case in tests/effect-ops.test.ts ("wave 2's sheet and share ops").
// The levels a sight or a stealth is read at (`LEVELS`) are here, below sight.ts, which asks this file what a body holds.

import type { Sheet } from '../hunter/derive.ts';
import type { Rules } from '../rules.ts';
import { atTier, countOn, SHEET_ADD_KEYS, SHEET_LEVEL_KEYS } from './op-amount.ts';
import { rowHp } from './row-hp.ts';
import type { Body, HideStart, ShareOn, SheetOpKey, Status, StatusDef, StatusKey, StealthEnd, StealthEnds } from './effect-ops.ts';
import type { Ability, CombatantId } from './ability-types.ts';
import type { Id } from '../ids.ts';

/** The rule numbers this file reads. */
export type StandingRules = Pick<Rules, 'fight'>;

// ── a status's own life on its bearer (SMX-rules-2) ──
/**
 * A status's life on one bearer: gone (not on it), active (its time runs), or owed (its time ran out, and it stays on
 * its row only for its bearer's settle: the per-round ops not paid to its end, and its `end`, kits table 2.2). Every
 * reader of a body's statuses asks `counts`, so none can forget the end of a status's time.
 */
export const STATUS_LIVES = ['gone', 'active', 'owed'] as const;
export type StatusLife = (typeof STATUS_LIVES)[number];
/**
 * What moves it: a land (effect-ops.ts `applyStatus`: a use, a land op, a spread, a move or the GM put it on), `runs`
 * when its end, the later of two, is still ahead; fight time moving (fight-turn.ts `advance`), `past` when its end is
 * at or behind the new now and `owes` when its settle still has a per-round span or an end for its bearer; its bearer's
 * settle (effect-ops.ts `settle`), `past` as for time; a cure, a dispel or a spend that takes it whole.
 */
export type StatusEvent =
  | { readonly type: 'land'; readonly runs: boolean }
  | { readonly type: 'time'; readonly past: boolean; readonly owes: boolean }
  | { readonly type: 'settle'; readonly past: boolean }
  | { readonly type: 'taken' };
type StatusStepFn<E extends StatusEvent['type']> = (e: Extract<StatusEvent, { type: E }>) => StatusLife;
const takenOff = (): StatusLife => 'gone';
/**
 * The table of SMX-rules-2. `null`: the event does not apply there, and the life stays as it is. An owed status put on
 * again with an end ahead runs again (its owed span is still paid from where it was paid to). The decay of a stacking
 * status's count is the stack machine's (stacks.ts), read by the settle after this table says the status stays.
 */
const STATUS_TABLE: { readonly [S in StatusLife]: { readonly [E in StatusEvent['type']]: StatusStepFn<E> | null } } = {
  gone: { land: e => (e.runs ? 'active' : 'owed'), time: null, settle: null, taken: null },
  active: { land: null, time: e => (!e.past ? 'active' : e.owes ? 'owed' : 'gone'), settle: e => (e.past ? 'gone' : 'active'), taken: takenOff },
  owed: { land: e => (e.runs ? 'active' : 'owed'), time: e => (e.owes ? 'owed' : 'gone'), settle: takenOff, taken: takenOff },
};
/** Where a status's life is after `e`. */
export function statusStep(life: StatusLife, e: StatusEvent): StatusLife {
  const step = STATUS_TABLE[life][e.type] as ((e: StatusEvent) => StatusLife) | null;
  return step ? step(e) : life;
}
/** The life of a status on a row: owed once its mark is set (`Status.owed`), else active. */
export const statusLife = (s: Pick<Status, 'owed'>): Exclude<StatusLife, 'gone'> => (s.owed ? 'owed' : 'active');
/** Whether a status on a row counts for every reader of its ops (its standing, its sheet, its wards and dice), by its life. */
const STATUS_COUNTS: { readonly [L in Exclude<StatusLife, 'gone'>]: boolean } = {
  active: true,
  // SMX-rules-2.1 waits on the owner's ruling: whether a status whose time ran out still counts on other bodies' turns until
  // its bearer's settle. Built as the hunt proposes and as the readers that checked its time did (a hold, a channel's
  // protection, a taunt, the formulas' stacks, the fight's card): it does not. A ruling that it does is `owed: true`.
  owed: false,
};
/** Whether status `s` counts for every reader of its ops. */
export const counts = (s: Pick<Status, 'owed'>): boolean => STATUS_COUNTS[statusLife(s)];
/** The statuses of a list that count (`counts`). */
export const counting = <S extends Pick<Status, 'owed'>>(list: readonly S[]): S[] => list.filter(counts);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ── levels: a body's sight and a hidden body's stealth (docs/agent-handoff/features/notes-7-stealth.md section 2) ──
/**
 * The levels of sight and stealth, one per rank E to S, so a level can follow its source's rank as every tiered number
 * does. Not a hunter's level (hunter/level.ts). A level past 5 cannot be written.
 */
export const LEVELS = [0, 1, 2, 3, 4, 5] as const;
/** A sight or stealth level, 0 to 5 (`LEVELS`). */
export type Level = (typeof LEVELS)[number];
/**
 * A level a hidden op may hold, 1 to 5. Not 0: a body's sight starts at `fight.stealth.sightBase` (0) and a body is hidden
 * only from a lower sight (the owner's ruling 1), so a hide at 0 would hide from nobody.
 */
export type HideLevel = Exclude<Level, 0>;
/** The levels a hidden op may hold, lowest first: every level but 0. */
export const HIDE_LEVELS: readonly HideLevel[] = LEVELS.filter((l): l is HideLevel => l !== 0);
/** A number read into a level: rounded down, under 0 is 0, past 5 is 5, not a number is 0. */
export const asLevel = (n: number): Level => LEVELS[clamp(Math.floor(n), 0, LEVELS.length - 1)] ?? LEVELS[0];

/** A sheet number a `sheet` op adds to (op-amount.ts `SHEET_ADD_KEYS`). */
type SheetAddKey = (typeof SHEET_ADD_KEYS)[number];
/** A sheet level a `sheet` op raises (op-amount.ts `SHEET_LEVEL_KEYS`). */
type SheetLevelKey = (typeof SHEET_LEVEL_KEYS)[number];
const isAddKey = (k: SheetOpKey): k is SheetAddKey => (SHEET_ADD_KEYS as readonly SheetOpKey[]).includes(k);
/** The `sheet` ops of a body's statuses that count on a number that adds, summed by key at each source's tier and per stack (ops of one key add, as `stat` ops do). */
export function sheetAdds(statuses: readonly Status[]): Readonly<Record<SheetAddKey, number>> {
  const out = Object.fromEntries(SHEET_ADD_KEYS.map(k => [k, 0])) as Record<SheetAddKey, number>;
  for (const s of counting(statuses)) for (const o of s.def.ops) if (o.op === 'sheet' && isAddKey(o.key)) out[o.key] += atTier(o.amount, s.source.tier) * countOn(s);
  return out;
}
/**
 * The `sheet` ops of a body's statuses that count on a level, by key: the highest of them at its source's tier, or null
 * with none. Sources of a level do not add (the owner's ruling 8), so neither do a status's stacks: a level is not a
 * per-stack amount.
 */
export function sheetLevels(statuses: readonly Status[]): Readonly<Record<SheetLevelKey, Level | null>> {
  const out = Object.fromEntries(SHEET_LEVEL_KEYS.map(k => [k, null])) as Record<SheetLevelKey, Level | null>;
  for (const s of counting(statuses)) for (const o of s.def.ops) if (o.op === 'sheet' && !isAddKey(o.key)) {
    const level = asLevel(atTier(o.amount, s.source.tier)), was = out[o.key];
    out[o.key] = was === null ? level : asLevel(Math.max(was, level));
  }
  return out;
}
/**
 * A sheet after its statuses' `sheet` ops (kits design 8.1): armor and resist at 0 or more, pen to `penCap`, crit faces
 * to `kit.critFacesMax`, crit size within `critSizeBase` and `kit.critSizeMax`, the cost cut to `kit.costCutMax`. A cap
 * the body's own sheet already passes (a perk) holds it there: an op never lowers a number past what the body had.
 * The sight level is the highest of the body's own and its sight ops (`sheetLevels`), so an op never lowers it either.
 * With no `sheet` op the sheet is the one `derive` made.
 */
export function withSheetOps(sheet: Sheet, statuses: readonly Status[], R: StandingRules): Sheet {
  if (!counting(statuses).some(s => s.def.ops.some(o => o.op === 'sheet'))) return sheet;
  const a = sheetAdds(statuses), l = sheetLevels(statuses), F = R.fight, K = F.kit;
  const up = (v: number, add: number, lo: number, hi: number): number => (add === 0 ? v : clamp(v + add, Math.min(lo, v), Math.max(hi, v)));
  return {
    ...sheet,
    armor: Math.max(0, sheet.armor + a.armor), resist: Math.max(0, sheet.resist + a.resist),
    pen: up(sheet.pen, a.pen, 0, F.penCap) as Sheet['pen'],
    critFaces: up(sheet.critFaces, Math.trunc(a.critFaces), 1, K.critFacesMax),
    critSize: up(sheet.critSize, a.critSize, F.critSizeBase, K.critSizeMax),
    costCut: up(sheet.costCut, a.costCut, 0, K.costCutMax) as Sheet['costCut'],
    sight: l.sight === null ? sheet.sight : asLevel(Math.max(sheet.sight, l.sight)),
  };
}
/** The crit faces any attacker gains against `b`: its `exposed` ops summed, rounded down, at least 0 (Vision: 0.5 a stack). */
export const exposedOf = (b: Pick<Body, 'statuses'>): number => Math.max(0, Math.floor(sheetAdds(b.statuses).exposed + 1e-9));
/**
 * The crit faces of `user`'s use against `target`: the user's own, and the target's exposed faces, together at most
 * `kit.critFacesMax` (design 2.2's 30%). With nothing exposed it is the user's own.
 */
export function critFacesAgainst(user: Pick<Body, 'sheet'>, target: Pick<Body, 'statuses'>, R: StandingRules): number {
  const e = exposedOf(target);
  return e === 0 ? user.sheet.critFaces : Math.min(Math.max(user.sheet.critFaces, R.fight.kit.critFacesMax), user.sheet.critFaces + e);
}
/** The tiles a body's statuses add to its ranges of 2 or more (kits design 8.1), within `kit.rangeAdd` either way; a touch's 1 never changes. */
export function rangeWith(range: number, b: Partial<Pick<Body, 'statuses'>>, R: StandingRules): number {
  if (range < 2 || !b.statuses) return range;
  const add = clamp(Math.trunc(sheetAdds(b.statuses).range), -R.fight.kit.rangeAdd, R.fight.kit.rangeAdd);
  return Math.max(1, range + add);
}

/**
 * A body's shares of one kind (rule 11c), each a multiplier: of its `share` ops on `on`, the strongest increase (`up`,
 * 1 or more) and the strongest decrease (`down`, 0 to 1), as the speed ops of `modsOf` keep them. 1 and 1 when it has none.
 */
function sharesOf(b: Pick<Body, 'statuses'>, on: ShareOn): { readonly up: number; readonly down: number } {
  let up = 0, down = 0;
  for (const s of counting(b.statuses)) for (const o of s.def.ops) if (o.op === 'share' && o.on === on) {
    const pct = atTier(o.pct, s.source.tier) * countOn(s);
    up = Math.max(up, pct); down = Math.min(down, pct);
  }
  return { up: 1 + up / 100, down: 1 + Math.max(-100, down) / 100 };
}
/** A body's share of one kind (rule 11c): its strongest increase and its strongest decrease multiply (`sharesOf`). */
export function shareOf(b: Pick<Body, 'statuses'>, on: ShareOn): number {
  const s = sharesOf(b, on);
  return s.up * s.down;
}
/** A product of shares held within `kit.shareCap` of 1, and on an elite or a boss the part above 1 times its kind's control factor (8.1). */
function capped(x: number, target: Pick<Body, 'kind' | 'origin'>, R: StandingRules): number {
  const c = R.fight.kit.shareCap, v = clamp(x, 1 - c, 1 + c);
  const factor = target.kind === 'monster' && target.origin.kind === 'monster' ? R.fight.kinds[target.origin.monsterKind].control : 1;
  return v > 1 ? 1 + (v - 1) * factor : v;
}
/** Rule 11c: what a hit is multiplied by, from the dealt share of whoever deals it and `target`'s taken share. */
const hitShare = (dealt: number, target: Pick<Body, 'statuses' | 'kind' | 'origin'>, R: StandingRules): number => capped(dealt * shareOf(target, 'taken'), target, R);
/** Rule 11c: what a hit from `user` (null: a status's own per-round damage) on `target` is multiplied by. */
export const damageShare = (user: Pick<Body, 'statuses'> | null, target: Pick<Body, 'statuses' | 'kind' | 'origin'>, R: StandingRules): number =>
  hitShare(user ? shareOf(user, 'dealt') : 1, target, R);
/**
 * Rule 11c for an ambush (resolve.ts `ambushes`): what a use's hit from hiding on a target that does not perceive its
 * user is multiplied by. The rules' `stealth.ambush` is one more of the user's dealt increases, of which only the
 * strongest applies (notes-7-stealth.md section 2), so a dealt buff and an ambush do not compound; the product stays
 * within `kit.shareCap`, and on an elite or a boss its part above 1 is times the kind's control factor, as every share's.
 */
export const ambushShare = (user: Pick<Body, 'statuses'>, target: Pick<Body, 'statuses' | 'kind' | 'origin'>, R: StandingRules): number => {
  const s = sharesOf(user, 'dealt');
  return hitShare(Math.max(s.up, R.fight.stealth.ambush) * s.down, target, R);
};
/** Rule 11c: what a heal `target` gets is multiplied by, a per-round one too. */
export const healShare = (target: Pick<Body, 'statuses' | 'kind' | 'origin'>, R: StandingRules): number => capped(shareOf(target, 'healed'), target, R);

// ── the wards and stealth (kits design 8.1 and 8.7) ──
/** The ops a body's standing reads by name: a ward, stealth, being alert. */
export type Flag = 'untargetable' | 'invulnerable' | 'safeguard' | 'hidden' | 'alert';
/** Whether one of `b`'s statuses that count has the op `flag`. */
export const holds = (b: Pick<Body, 'statuses'>, flag: Flag): boolean => counting(b.statuses).some(s => s.def.ops.some(o => o.op === flag));
/**
 * Whether a body of `side` may not aim at `b` nor catch it in a shape: `b` is of the other side and untargetable (8.1).
 * A hidden body is not warded: whom a use may pick is the sight rule's (sight.ts `perceivedBy`), and a shape catches it.
 */
export const warded = (b: Pick<Body, 'statuses' | 'side'>, side: Body['side']): boolean => b.side !== side && holds(b, 'untargetable');
/** The two wards a body takes once a fight (kits design 8.1, the row's `warded`). */
export type Ward = 'untargetable' | 'invulnerable';
export const WARDS: readonly Ward[] = ['untargetable', 'invulnerable'];
export const wardsOf = (def: Pick<StatusDef, 'ops'>): Ward[] => WARDS.filter(w => def.ops.some(o => o.op === w));
/**
 * What a status landing on `t` from a body of `from` becomes (kits design 8.1): nothing when `t` holds a safeguard and it
 * is harmful from the other side, or when it carries a ward `t` has had this fight; else it lands, and a ward or a
 * safeguard lasts `kit.wardRounds` at most. `from` null is the GM or an item, which no safeguard stops.
 */
export function admitted(t: Pick<Body, 'statuses' | 'side' | 'warded'>, def: Pick<StatusDef, 'ops'>, from: Body['side'] | null, until: number | null, now: number, R: StandingRules): { readonly ok: boolean; readonly until: number | null; readonly why?: 'safeguard' | 'warded' } {
  if (from !== null && from !== t.side && holds(t, 'safeguard') && harmful(def)) return { ok: false, until, why: 'safeguard' };
  const wards = wardsOf(def);
  // table 8.9.5: a ward that lands on a body that had it this fight stays spent
  if (wards.some(w => t.warded?.includes(w) && wardStep('spent', { type: 'lands' }) === 'spent')) return { ok: false, until, why: 'warded' };
  if (!wards.length && !def.ops.some(o => o.op === 'safeguard')) return { ok: true, until };
  const most = now + R.fight.kit.wardRounds * R.fight.round;
  return { ok: true, until: until === null ? most : Math.min(until, most) };
}
/** The wards `t` has had this fight once `def` landed on it. */
export const markWards = (warded: Body['warded'], def: Pick<StatusDef, 'ops'>): Body['warded'] => {
  const add = wardsOf(def).filter(w => !warded?.includes(w));
  return add.length ? [...(warded ?? []), ...add] : warded;
};
/** HP damage on `t` after an invulnerable ward: never under 1 while it holds (a shield absorbed first). */
export const wardedDamage = (t: Pick<Body, 'statuses' | 'life'>, damage: number): number =>
  holds(t, 'invulnerable') && rowHp(t) >= 1 ? Math.min(damage, rowHp(t) - 1) : damage;

// ── the machines of wave 2 that live on a status (kits design 8.9: tables 8.9.2, 8.9.4 and 8.9.5) ──
/** An edge or a held die on its bearer (table 8.9.2): absent, or held at `n` (its stacks, 1 for a plain status). */
export const EDGE_STATES = ['absent', 'held'] as const;
export type EdgeHold = { readonly at: 'absent' } | { readonly at: 'held'; readonly n: number };
/** It lands with `k`; a die it reaches is rolled (`spend`: it spends, as a held die always does); its time ends, a cure, the fight's end. */
export type EdgeEvent = { readonly type: 'lands'; readonly k: number } | { readonly type: 'reached'; readonly spend: boolean } | { readonly type: 'ends' };
type EdgeStepFn<E extends EdgeEvent['type']> = (h: EdgeHold, e: Extract<EdgeEvent, { type: E }>) => EdgeHold;
const heldAt = (h: EdgeHold): number => (h.at === 'held' ? h.n : 0);
/** Table 8.9.2. A die it reaches, cancelled by an opposite edge or not, spends one when it spends; a worn one holds. `null`: nothing changes. */
const EDGE_TABLE: { readonly [S in EdgeHold['at']]: { readonly [E in EdgeEvent['type']]: EdgeStepFn<E> | null } } = {
  absent: { lands: (_h, e) => ({ at: 'held', n: e.k }), reached: null, ends: null },
  held: { lands: (h, e) => ({ at: 'held', n: heldAt(h) + e.k }), reached: (h, e) => (!e.spend ? h : heldAt(h) > 1 ? { at: 'held', n: heldAt(h) - 1 } : { at: 'absent' }), ends: () => ({ at: 'absent' }) },
};
export function edgeStep(h: EdgeHold, e: EdgeEvent): EdgeHold {
  const step = EDGE_TABLE[h.at][e.type] as EdgeStepFn<EdgeEvent['type']> | null;
  return step ? step(h, e as never) : h;
}

// ── stealth on its bearer (docs/agent-handoff/features/notes-7-stealth.md section 4, with the owner's rulings) ──
/** One hide: a hidden status that counts on its bearer, its level at its source's tier, and which events end it. */
export type Hide = { readonly key: StatusKey; readonly level: HideLevel; readonly ends: StealthEnds };
/**
 * A body as the stealth machine reads it: its hides, and the events its `stayHidden` ops keep from ending any of them.
 * Derived from its statuses (`stealthOf`) and never stored: the statuses are the machine's storage, so a hide's time, a
 * cure or a dispel ends one with no stealth code.
 */
export type Stealth = { readonly hides: readonly Hide[]; readonly kept: ReadonlySet<StealthEnd> };
/** Where a body's stealth is: seen (no hide), or hidden at the highest level of its hides (`stealthLevel`). */
export const STEALTH_STATES = ['seen', 'hidden'] as const;
export type StealthState = (typeof STEALTH_STATES)[number];
export const stealthState = (s: Stealth): StealthState => (s.hides.length ? 'hidden' : 'seen');
/** The level a body hides at: the highest of its hides, or null when it is seen. */
export const stealthLevel = (s: Stealth): HideLevel | null => (s.hides.length ? Math.max(...s.hides.map(h => h.level)) as HideLevel : null);
/**
 * What moves it: a hide put on (`start` its op's, `watched` whether a foe that is up has the body's tile in sight; the
 * fight raises it before a use that hides its user, fight.ts `act`), and the owner's three ends: its bearer loses HP
 * (`hurt`, fight-turn.ts `consequences`), it is revealed (`revealed`: a `reveal` op lands on it, or a foe's use catches
 * it without picking it, the owner's ruling 2; a foe beside it does not, ruling 4), or a use or a reaction of its own deals HP damage to the
 * other side (`dealt`, fight.ts `landed` and fight-react.ts `react`, ruling 6).
 */
export type StealthEvent =
  | { readonly type: 'hide'; readonly hide: Hide; readonly start: HideStart; readonly watched: boolean }
  | { readonly type: 'hurt' } | { readonly type: 'revealed' } | { readonly type: 'dealt' };
/** One of the three events that may end a hide. */
export type StealthEndEvent = Extract<StealthEvent, { readonly type: StealthEnd }>;
/** Whether event `e` ends a hide of `ends` on a bearer whose `stayHidden` ops keep `kept`. */
export const endsOn = (ends: StealthEnds, kept: ReadonlySet<StealthEnd>, e: StealthEnd): boolean => ends[e] && !kept.has(e);
type StealthStepFn<E extends StealthEvent['type']> = (s: Stealth, e: Extract<StealthEvent, { type: E }>) => Stealth;
/** A hide put on: one instance a key (as effect-ops.ts `applyStatus` keeps), so the body hides at the higher level of the two. */
const hidden: StealthStepFn<'hide'> = (s, e) => {
  const was = s.hides.find(h => h.key === e.hide.key);
  return was && was.level >= e.hide.level ? s : { ...s, hides: [...s.hides.filter(h => h !== was), e.hide] };
};
/** Each hide the event ends goes; the rest stay, and the body hides at the highest of them, or is seen with none. */
const ended = (s: Stealth, e: StealthEndEvent): Stealth => {
  const left = s.hides.filter(h => !endsOn(h.ends, s.kept, e.type));
  return left.length === s.hides.length ? s : { ...s, hides: left };
};
/**
 * The stealth machine. A body that is seen hides when its hide may start anywhere or no foe watches it; else it stays
 * seen, and a use that hides its user is refused (`seen`). A body seen again may hide again at once. `null`: the event
 * does not apply there, and nothing changes. A hide's time and a cure are the status's own life (`statusStep`).
 */
const STEALTH_TABLE: { readonly [S in StealthState]: { readonly [E in StealthEvent['type']]: StealthStepFn<E> | null } } = {
  seen: { hide: (s, e) => (e.start === 'anywhere' || !e.watched ? hidden(s, e) : s), hurt: null, revealed: null, dealt: null },
  hidden: { hide: hidden, hurt: ended, revealed: ended, dealt: ended },
};
/** Where a body's stealth is after `e`. Never changes its input. */
export function stealthStep(s: Stealth, e: StealthEvent): Stealth {
  const step = STEALTH_TABLE[stealthState(s)][e.type] as StealthStepFn<StealthEvent['type']> | null;
  return step ? step(s, e as never) : s;
}
/** The hide a status of `def` under `key` makes at `tier`: its hidden ops' highest level, ended by an event any of them ends on; null when it has none. */
export function hideOf(key: StatusKey, def: Pick<StatusDef, 'ops'>, tier: number): Hide | null {
  const ops = def.ops.flatMap(o => (o.op === 'hidden' ? [o] : []));
  if (!ops.length) return null;
  const level = Math.max(...ops.map(o => atTier(o.level, tier))) as HideLevel;
  return { key, level, ends: { hurt: ops.some(o => o.ends.hurt), revealed: ops.some(o => o.ends.revealed), dealt: ops.some(o => o.ends.dealt) } };
}
/** Whether a use of `a` hides a body: it puts a status with a `hidden` op on (kits design 8.7). */
export const hides = (a: Pick<Ability, 'ops'>): boolean => a.ops.some(o => o.op === 'applyStatus' && o.def.ops.some(x => x.op === 'hidden'));
/**
 * Whether a status of `def` under `key`, put on at `tier` on `b`, may land as far as its hides go: the stealth machine's
 * `hide` on `b`'s stealth leaves it hidden for each of its hidden ops' starts, `watched` whether a foe that is up has `b`
 * in sight (sight.ts `watched`). A status with no hidden op hides nothing and may land.
 */
export function hideStarts(b: Pick<Body, 'statuses'>, key: StatusKey, def: Pick<StatusDef, 'ops'>, tier: number, watched: boolean): boolean {
  const hide = hideOf(key, def, tier);
  if (hide === null) return true;
  const s = stealthOf(b);
  return def.ops.every(o => o.op !== 'hidden' || stealthState(stealthStep(s, { type: 'hide', hide, start: o.start, watched })) === 'hidden');
}
/** A body's stealth, read from its statuses that count (`counts`): their hides, and the ends their `stayHidden` ops keep. */
export function stealthOf(b: Pick<Body, 'statuses'>): Stealth {
  const live = counting(b.statuses);
  return {
    hides: live.flatMap(s => { const h = hideOf(s.key, s.def, s.source.tier); return h ? [h] : []; }),
    kept: new Set(live.flatMap(s => s.def.ops.flatMap(o => (o.op === 'stayHidden' ? [o.on] : [])))),
  };
}

/** A ward on its bearer (table 8.9.5): never had, held (warded), or spent for the fight. */
export const WARD_STATES = ['never', 'warded', 'spent'] as const;
export type WardState = (typeof WARD_STATES)[number];
/** A ward lands; its bearer acts on a foe (untargetable); a hit would take it under 1 (invulnerable); a round passes or a cure. */
export type WardEvent = { readonly type: 'lands' } | { readonly type: 'acts' } | { readonly type: 'lethal' } | { readonly type: 'ends' };
/** Table 8.9.5: a second landing in a fight does nothing (and logs it). `null`: nothing changes. */
const WARD_TABLE: { readonly [S in WardState]: { readonly [E in WardEvent['type']]: WardState | null } } = {
  never: { lands: 'warded', acts: null, lethal: null, ends: null },
  warded: { lands: 'warded', acts: 'spent', lethal: 'warded', ends: 'spent' },
  spent: { lands: 'spent', acts: null, lethal: null, ends: null },
};
export const wardStep = (s: WardState, e: WardEvent): WardState => WARD_TABLE[s][e.type] ?? s;

// ── advantage and held dice (kits design 8.2, rule 7b, table 8.9.2) ──
/** A status that reached a die and spends a stack for it: its bearer and key. */
export type Spent = { readonly id: CombatantId; readonly key: StatusKey };
/**
 * The edge on `target`'s reaction d20 against `user`'s use of `a` (rule 7b): `kh` keeps the higher of two (the defender's
 * advantage), `kl` the lower (the attacker's), null one die. The user's attack edges (only one whose tag the ability
 * has, when it names one) and the target's defend edges; an edge and its opposite cancel, and two of one kind do not
 * add. Hiding gives none: a hit from hiding is an ambush, rule 11c (the owner's ruling 3, `ambushShare`). `spent`: every
 * edge with `spend` that reached the die, cancelled or not.
 */
export function edgeOn(a: Pick<Ability, 'tags'>, user: Pick<Body, 'id' | 'statuses'>, target: Pick<Body, 'id' | 'statuses'>): { readonly cut: 'kh' | 'kl' | null; readonly spent: readonly Spent[] } {
  const ways = new Set<'kh' | 'kl'>(), spent: Spent[] = [];
  const reach = (b: Pick<Body, 'id' | 'statuses'>, side: 'attack' | 'defend') => {
    for (const s of counting(b.statuses)) for (const o of s.def.ops) {
      if (o.op !== 'edge' || o.side !== side || (side === 'attack' && o.tag !== null && !(a.tags ?? []).includes(o.tag))) continue;
      // better for its bearer: the attacker's target keeps the lower face, the defender keeps the higher
      ways.add((o.keep === 'better') === (side === 'defend') ? 'kh' : 'kl');
      if (o.spend && !spent.some(x => x.id === b.id && x.key === s.key)) spent.push({ id: b.id, key: s.key });
    }
  };
  reach(user, 'attack');
  reach(target, 'defend');
  return { cut: ways.size === 1 ? [...ways][0]! : null, spent };
}
/**
 * One held die (kits design 8.2): the `boost` op at index `op` of the status `key` on the body `bearer`. A body holds one
 * status a key, so it names one die however many a body holds: a use asks for each by it (`Needs.boost`) and reads each
 * roll by it (`Rolls.boost`), so several held dice on one body each roll and stack (the owner, Nov 20).
 */
export type HeldDieId = Id<'HeldDieId'>;
export const heldDieId = (bearer: CombatantId, key: StatusKey, op: number): HeldDieId => `${bearer}/${key}/${op}` as HeldDieId;
/** A held die that reaches a die: its id, its bearer and status, the side it moves and its die to roll or fixed face. */
export type HeldDie = {
  readonly held: HeldDieId; readonly id: CombatantId; readonly key: StatusKey; readonly side: 'attack' | 'defend';
  readonly die: { readonly kind: 'die'; readonly sides: number } | { readonly kind: 'face'; readonly n: number };
};
/** The held dice that reach a die: the user's attack boosts and the target's defend boosts, each a die to roll or a fixed face. */
export function boostsOn(user: Pick<Body, 'id' | 'statuses'>, target: Pick<Body, 'id' | 'statuses'>): HeldDie[] {
  const of = (b: Pick<Body, 'id' | 'statuses'>, side: 'attack' | 'defend'): HeldDie[] =>
    counting(b.statuses).flatMap(s => s.def.ops.flatMap((o, i) => o.op === 'boost' && o.side === side ? [{ held: heldDieId(b.id, s.key, i), id: b.id, key: s.key, side, die: o.die }] : []));
  return [...of(user, 'attack'), ...of(target, 'defend')];
}

/**
 * Whether a status is harmful (kits design 8.1): one rule for a safeguard, a dispel and a move of `harmful`. Its ops hurt
 * (damage) or hold back (a root, a hold, a slow, a stat lowered, a `sheet` op that lowers or raises `exposed`, a `share`
 * that raises damage taken or lowers damage dealt or heals received), as `zoneTone` draws a zone.
 */
export function harmful(def: Pick<StatusDef, 'ops'>): boolean {
  const first = (v: number | readonly number[]): number => (typeof v === 'number' ? v : v[0]!);
  return def.ops.some(o => o.op === 'damage' || o.op === 'root' || o.op === 'hold' || o.op === 'taunt'
    || (o.op === 'speed' && first(o.pct) < 0) || (o.op === 'stat' && first(o.amount) < 0)
    || (o.op === 'sheet' && (o.key === 'exposed' ? first(o.amount) > 0 : first(o.amount) < 0))
    || (o.op === 'share' && (o.on === 'taken' ? first(o.pct) > 0 : first(o.pct) < 0)));
}

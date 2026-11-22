// solo.ts: a solo run and a hunter's personal gates (docs/agent-handoff/features/notes-2-solo.md). Pure.
//
// A run is one play of the odds engine (odds.ts, play.ts) of one hunter, as its row joins a fight, against a gate's
// monsters, with a seed the edge drew: no fight is shown and none is stored. What the play left on the hunter's row is
// written to its sheet through the writers each part already has (`sheetEdit`'s totals,
// `spendItem`, `setShadowHp`), and the gate is paid as a Clear pays (`settleClear`, `grant`, `gateXp`, `xpDue`), a world
// gate's as a Clear for a party of one (pay.ts `shareEach`), in one step for `store.apply` (`soloRan`): all of it or none. The outcome is the engine's `RunOutcome`: `won` the gate is
// cleared, `lost` the hunter fell, `stalled` a retreat at the time cap.
//
// A personal gate is the System's, on its hunter (`Hunter.solo`): a clock (off, or on with the next spawn's time) and
// the gates it opened, each with built-in monsters and a closing time. `soloTick` opens and closes them for the time
// that passed; `soloWake` is its term of the one timer (quests.ts `nextWake`).
import { killFacts } from '../combat/fight-facts.ts';
import { RANKS, rankIdx, withStatuses } from '../rules.ts';
import { record } from '../hunter/chronicle.ts';
import type { Fact } from '../hunter/facts.ts';
import { hunterSheet } from '../hunter/sheet.ts';
import type { Rank, Rules } from '../rules.ts';
import { dueAt } from '../day.ts';
import type { GateId, HunterId, MonsterId, PersonalGateId, ShadowId } from '../ids.ts';
import type { Hunter, Save } from '../save.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { told } from '../session-log.ts';
import type { Said, Stamp } from '../session-log.ts';
import { grant, idsFrom, noteFacts, sheetEdit } from '../hunter/grant.ts';
import type { Day, Granted } from '../hunter/grant.ts';
import { spendItem } from '../hunter/use.ts';
import { setShadowHp } from '../hunter/shadows.ts';
import { WAYS_BACK, hpOf, manaOf } from '../hunter/vitals.ts';
import type { LifeState, Maxima, Vitals } from '../hunter/vitals.ts';
import { newRewards } from '../rewards.ts';
import type { ItemTemplate } from '../registry/items.ts';
import { monsterXp, parseMonster, seedMonsters, tweakOfMonster } from '../registry/monsters.ts';
import type { Monster, MonsterTemplate } from '../registry/monsters.ts';
import type { StatusDef } from '../combat/effect-ops.ts';
import { combatantId } from '../combat/ability-types.ts';
import type { CombatantId } from '../combat/ability-types.ts';
import { fightId, reduce } from '../combat/fight.ts';
import type { NewRow, Setup } from '../combat/fight-types.ts';
import { hunterRow, monsterRows, shadowRow } from '../combat/rows.ts';
import type { RowMonster } from '../combat/rows.ts';
import { CAP_ROUNDS } from '../combat/play.ts';
import { fateLine, wonLine } from '../combat/odds.ts';
import type { OddsRead, RunEnd, RunOutcome, Weighed } from '../combat/odds.ts';
import { seededSource } from '../draws.ts';
import { can, gateXp, xpDue } from './gate.ts';
import type { Gate, GateMonster } from './gate.ts';
import { rollGate, soloRank } from './spawn.ts';
import type { SpawnMonster } from './spawn.ts';
import { enteredAlone, worldOrder } from './world.ts';
import { gateFact, settleClear, shareEach } from './pay.ts';
import type { Seat } from '../role.ts';
import { WORLD_NAME_MAX } from '../protocol.ts';
import type { EventBody, EventId, EventStamp, RoomCode, RoomEvent, SheetKey, SoloDoc, SoloRefused, SoloRunPayload, WorldDoc } from '../protocol.ts';
import { atOutbox, post } from '../sync/outbox.ts';
import { runPosted } from './solo-wait.ts';
import { soloTracked } from './personal.ts';
import type { PersonalGate } from './personal.ts';

// ── the clock ──
/** The built-in monsters a personal gate is drawn from: the seeds, as the spawn roll reads them. Normal ones only (no elite, no boss). */
const spawnable = (seeds: readonly Monster[]): SpawnMonster[] =>
  seeds.filter(m => m.kind === 'normal').map(m => ({ id: m.id, rank: m.rank, type: m.type, name: m.name }));

/**
 * `rank`, or the nearest rank below it whose seeds hold a normal monster, else the nearest above: the seeds have no
 * normal S monster (only bosses), so an S hunter's same-rank gate is an A gate.
 */
export function pooled(rank: Rank, pool: readonly SpawnMonster[]): Rank {
  const at = RANKS.indexOf(rank), has = (r: Rank): boolean => pool.some(m => m.rank === r);
  for (let i = at; i >= 0; i--) if (has(RANKS[i]!)) return RANKS[i]!;
  for (let i = at + 1; i < RANKS.length; i++) if (has(RANKS[i]!)) return RANKS[i]!;
  return rank;
}

/**
 * The pack of the even gate: the first gate after a hunter's clock turns on is one normal monster of its own rank, the
 * fight the pregens clear in 95 to 99% of plays (notes-2-solo.md section 16), so a new hunter's first gate is not one
 * it cannot clear (lead-look-2-solo.md, finding 1). The roll by `ranks` and `pack` starts with the second.
 */
const EVEN_PACK: readonly [number, number] = [1, 1];

/** What a tick reads besides the save: the time, the rules (the room's switch laid over), the phone's seat, the edge's seed. */
export type TickCtx = { readonly now: Date; readonly R: Rules; readonly gm: boolean; readonly seed: number };
/** What a tick did: the next save, and the gates it opened, by hunter, in order (each is news). */
export type Ticked<S> = { readonly save: S; readonly opened: readonly { readonly hid: HunterId; readonly gate: PersonalGate }[] };

/**
 * Every hunter's personal gates brought to `now`: the gates whose time has come close, and, while the clock may run
 * (`R.solo.personal` and `soloTracked`), each spawn due since the clock's next time, in order: at a spawn time `t` the
 * gates closed by `t` leave, and a gate opens when the hunter holds fewer than `held` and it would still be open at
 * `now`. A clock off that may run is turned on with a spawn at `now`, the even gate (`EVEN_PACK` at the hunter's own
 * rank); a clock on that may not run is turned off. The dice
 * come from `seededSource(seed)`, the ids from the save's `seq`. Refused (`unchanged`) when nothing changed.
 */
export function soloTick<S extends Pick<Save, 'hunters' | 'seq'>>(save: S, o: TickCtx): Ticked<S> | Refused<'unchanged'> {
  const S = o.R.solo, nowMs = o.now.getTime(), src = seededSource(o.seed), ids = idsFrom(save.seq);
  const pool = spawnable(seedMonsters(o.R)), opened: { hid: HunterId; gate: PersonalGate }[] = [];
  let changed = false;
  /** A gate opened at `t`: the even gate (one monster of the hunter's own rank) when `even`, else rolled by `ranks` and `pack`. */
  const open = (h: Hunter, t: number, even: boolean): PersonalGate | null => {
    const rank = pooled(even ? h.rank : soloRank(h.rank, S.ranks, src.random), pool);
    const r = rollGate(o.R, { rank, type: 'normal', pack: even ? EVEN_PACK : [S.pack[0]!, S.pack[1]!], boss: false }, pool, src.random);
    const monsters = r.pack.flatMap(p => (p.monsterId ? [{ monsterId: p.monsterId as MonsterId, count: p.count }] : []));
    if (!monsters.length) return null;
    const at = new Date(t).toISOString();
    return { id: ids.next('pg'), name: r.name, rank: r.rank, monsters, at, closesAt: dueAt(S.stays, new Date(t)) ?? at };
  };
  const hunters = save.hunters.map(h => {
    const runs = S.personal && soloTracked(h, o.gm);
    let gates = h.solo.gates, clock = h.solo.clock;
    const closeBy = (t: number): void => { const kept = gates.filter(g => Date.parse(g.closesAt) > t); if (kept.length !== gates.length) gates = kept; };
    // the clock turned on by this tick (a new hunter, one revived, the switch turned on) opens the even gate first
    let even = false;
    if (!runs) { if (clock.at === 'on') clock = { at: 'off' }; }
    else {
      if (clock.at === 'off') { clock = { at: 'on', next: o.now.toISOString() }; even = true; }
      const H = S.hours * 3600e3, stays = S.stays * 3600e3;
      let t = Date.parse(clock.next);
      // a spawn whose gate would have closed before now is never made: the walk starts at the first one still open now
      if (t <= nowMs) t += Math.max(0, Math.ceil((nowMs - stays - t) / H)) * H;
      while (t <= nowMs) {
        closeBy(t);
        if (gates.length < S.held && t + stays > nowMs) { const g = open(h, t, even); if (g) { gates = [...gates, g]; opened.push({ hid: h.id, gate: g }); even = false; } }
        t += H;
      }
      const next = new Date(t).toISOString();
      if (next !== clock.next) clock = { at: 'on', next };
    }
    closeBy(nowMs);
    if (gates === h.solo.gates && clock === h.solo.clock) return h;
    changed = true;
    // a gate that closed with its time is a fact of the chronicle (a tick only closes gates; a run's clear is soloRan's)
    const closed = h.solo.gates.filter(g => !gates.includes(g)).map((g): Fact => ({ kind: 'closed', name: g.name, rank: g.rank }));
    return record({ ...h, solo: { clock, gates } }, ...closed);
  });
  if (!changed) return refuse('unchanged');
  return { save: { ...save, seq: ids.seq(), hunters }, opened };
}

// ── a run ──
/** Where a solo gate is: one of the hunter's own, or a gate of the world list (this phone's, or the room's by its doc). */
export type SoloGate = { readonly kind: 'personal'; readonly id: PersonalGateId } | { readonly kind: 'world'; readonly id: GateId };
/**
 * Where a run of a world gate settles: on this phone (`local`: alone, or the GM's own hunter), or in room `room` by the
 * GM's phone (a player's). A run records it as it starts (`SoloRun.route`) and is settled by it: two gates of one id,
 * the phone's own and a room's, are two gates (audit SMX-gates-2.1).
 */
export type SoloRoute = 'local' | { readonly room: RoomCode };
/** The one rule of where a world gate's run settles, by the seat (role.ts) and the room this phone is in. */
export const soloRoute = (seat: Seat, room: RoomCode | null): SoloRoute => (seat === 'player' && room ? { room } : 'local');
const sameRoute = (a: SoloRoute, b: SoloRoute): boolean => (a === 'local' || b === 'local' ? a === b : a.room === b.room);

/** Why a run may not start or be written. */
export type SoloRefusal =
  | 'no-hunter' | 'fight' | 'dead' | 'collapsed' | 'gone' | 'closed' | 'not-solo' | 'off' | 'not-played' | 'waiting' | 'empty' | 'changed' | 'moved';
/** What a refused run says, to the player who tapped (copy-tasks.md: why, and the way out). */
export const SOLO_REFUSAL_WORDS: { readonly [R in SoloRefusal]: string } = {
  'no-hunter': 'This hunter is no longer on this phone.',
  fight: 'A fight holds this hunter. Finish it first.',
  dead: `This hunter is dead. ${WAYS_BACK} brings it back.`,
  collapsed: 'This hunter has collapsed from fatigue. Rest first.',
  gone: 'This gate is gone.',
  closed: 'This gate has closed.',
  'not-solo': 'The GM has not opened this gate to solo runs.',
  off: 'Personal gates are off.',
  'not-played': 'Only the hunter you play in this room can enter its gates.',
  waiting: 'Your run here is waiting for the GM\'s answer.',
  empty: 'This gate has no monsters.',
  changed: 'Your hunter changed while the run played, so the run paid nothing. Enter again.',
  moved: 'This phone joined or left a room while the run played, so the run paid nothing. Enter again.',
};

/** What a run is played against: the gate's name and rank, its monsters as rows read them, each with its count, and the statuses they name. */
export type SoloTarget = {
  readonly gate: SoloGate; readonly name: string; readonly rank: Rank; readonly boss: boolean;
  readonly monsters: readonly { readonly id: MonsterId; readonly monster: RowMonster; readonly count: number }[];
  /** The statuses the monsters name that the rules may lack (a room's GM statuses); laid over `conditions` for this fight only. */
  readonly statuses: Readonly<Record<string, StatusDef>>;
};

/** What `soloReady` reads besides the save: the rules, where a world gate's run settles now, whether a fight holds the hunter, the time, the room's own reads. */
export type ReadyCtx = {
  readonly R: Rules; readonly route: SoloRoute; readonly held: boolean; readonly nowMs: number;
  /** A player in a room: the hunter it plays there (sync `bound()`), and the room's solo gates as its docs give them. */
  readonly bound?: HunterId | null;
  readonly room?: { readonly targets: readonly SoloTarget[]; readonly waiting: readonly GateId[] } | null;
};

const roster = (list: readonly GateMonster[], bossId: MonsterId | null, find: (id: MonsterId) => Monster | null): SoloTarget['monsters'] => {
  const out: { id: MonsterId; monster: Monster; count: number }[] = [];
  for (const m of list) { const x = find(m.monsterId); if (x) out.push({ id: m.monsterId, monster: x, count: m.count }); }
  const boss = bossId ? find(bossId) : null;
  if (boss && bossId) out.push({ id: bossId, monster: boss, count: 1 });
  return out;
};

/**
 * Whether hunter `hid` may run gate `gate` now, and what it is played against: the hunter (not gone, not held by a
 * fight, up, not collapsed), then the gate (there, open, solo; a personal gate while personal gates are on; a room's
 * gate only by the hunter this phone plays there, and not while a run of it waits). A Penalized hunter may enter
 * (notes-2-solo.md 9). Run before the play and again inside the write.
 */
export function soloReady(save: Pick<Save, 'hunters' | 'gates' | 'monsters'>, hid: string, gate: SoloGate, c: ReadyCtx): { readonly h: Hunter; readonly target: SoloTarget } | Refused<SoloRefusal> {
  const h = save.hunters.find(x => x.id === hid);
  if (!h) return refuse('no-hunter');
  if (c.held) return refuse('fight');
  if (h.life.at === 'dead') return refuse('dead');
  if (h.collapsed) return refuse('collapsed');
  const seeds = seedMonsters(c.R);
  if (gate.kind === 'personal') {
    if (!c.R.solo.personal) return refuse('off');
    const g = h.solo.gates.find(x => x.id === gate.id);
    if (!g) return refuse('gone');
    if (Date.parse(g.closesAt) <= c.nowMs) return refuse('closed');
    const monsters = roster(g.monsters, null, id => seeds.find(m => m.id === id) ?? null);
    return monsters.length ? { h, target: { gate, name: g.name, rank: g.rank, boss: false, monsters, statuses: {} } } : refuse('empty');
  }
  if (c.route !== 'local') {
    if (c.bound !== h.id) return refuse('not-played');
    const t = c.room?.targets.find(x => x.gate.kind === 'world' && x.gate.id === gate.id);
    if (!t) return refuse('not-solo');
    if (c.room?.waiting.includes(gate.id)) return refuse('waiting');
    return t.monsters.length ? { h, target: t } : refuse('empty');
  }
  const g = save.gates.find(x => x.id === gate.id);
  if (!g) return refuse('gone');
  if (!can(g, 'clear')) return refuse('closed');
  if (!g.solo) return refuse('not-solo');
  const all = [...seeds, ...save.monsters];
  const monsters = roster(g.monsters, g.bossId, id => all.find(m => m.id === id) ?? null);
  return monsters.length ? { h, target: { gate, name: g.name, rank: g.rank, boss: g.bossId !== null, monsters, statuses: {} } } : refuse('empty');
}

/** The parts of a hunter a row is built from, as one string: another string means the hunter changed since a run began. */
export const soloKey = (h: Hunter): string => JSON.stringify([h.life, h.mana, h.fatigue, h.collapsed, h.used, h.conditions, h.items, h.equipped, h.skills, h.stats, h.pending, h.level, h.rank, h.shadows, h.titleId, h.build]);

/** The fight a run plays with the rules it plays by (`Weighed`: the card's odds take this value too), and how its rows map back to the sheet. */
export type SoloFight = Weighed & { readonly fight: Setup; readonly hunter: CombatantId; readonly shadows: Readonly<Record<CombatantId, ShadowId>> };
/**
 * Monster `m` as a solo run meets it (`RULES.solo.autoHarder`, whose comment has the reason): its tweak's HP factor and
 * the damage of each hit it deals (`Tweak.dealt`) each times the rule's square root, so their product, the fight's
 * difficulty, is the rule. Its XP, loot, speed, armor and stagger bar stay the table's.
 */
const harder = (m: RowMonster, R: Pick<Rules, 'solo'>): RowMonster => {
  const each = Math.sqrt(R.solo.autoHarder), t = tweakOfMonster(m.tweak);
  return { ...m, tweak: { hp: t.hp * each, dealt: t.dealt * each, stats: t.stats, traits: t.traits } };
};
/**
 * The fight of hunter `h` against `t`, in setup, made by the reducer's own `add` on the open arena: the hunter's row
 * (`hunterRow`), a row for each summoned shadow, then each roster line's monsters (`monsterRows`) made harder by the
 * rule (`harder`), with the target's statuses over the rules' for this fight only (`R` of the answer: the run plays by
 * it). The one builder of a solo fight: the odds a gate's card shows play this value, the fight with its rules
 * (`OddsApi.paintSolo` takes no other rules), and so does the run. Null when the reducer refuses it.
 */
export function soloFight(h: Hunter, t: SoloTarget, R0: Rules): SoloFight | null {
  const R = withStatuses(R0, t.statuses);
  const me = combatantId('solo-h'), shadows: Record<CombatantId, ShadowId> = {};
  const rows: NewRow[] = [hunterRow(h, me, R)];
  h.shadows.filter(s => s.summoned).forEach((s, i) => { const id = combatantId(`solo-s${i}`); shadows[id] = s.id; rows.push(shadowRow(s, h.id, id, R)); });
  t.monsters.forEach((m, i) => rows.push(...monsterRows(harder(m.monster, R), Array.from({ length: m.count }, (_, k) => combatantId(`solo-m${i}-${k}`)), R)));
  const r = reduce(null, { type: 'add', fightId: fightId('solo'), rows, openings: [] }, { rules: R });
  return r.fight?.phase === 'setup' ? { fight: r.fight, hunter: me, shadows, R } : null;
}

/**
 * One run as played: its end (`odds.ts` `RunEnd`, the engine asked for one play), the rows of the sheet, the key of the
 * hunter it was played from, and where it settles, as the phone stood when it started (`ReadyCtx.route` then).
 */
export type SoloRun = {
  readonly end: RunEnd; readonly hunter: CombatantId; readonly shadows: Readonly<Record<CombatantId, ShadowId>>; readonly from: string; readonly route: SoloRoute;
};
/** The loot the view rolled before the write (`rollLoot`), paid only when the run cleared. */
export type SoloLoot = { readonly gold: number; readonly items: readonly ItemTemplate[] };

/**
 * Hunter `h` as the run left it, through the writer each part has: the row's totals (`sheetEdit`: the row's life,
 * mana, fatigue with its collapse, the statuses a sheet keeps, the uses spent this rest), each item it used up
 * (`spendItem`), each shadow's HP (`setShadowHp`).
 */
export function ranOn(h: Hunter, run: SoloRun, R: Rules): Hunter {
  const row = run.end.party[run.hunter];
  if (!row?.lifeLeft) return h;
  // a part its writer refuses (an item no longer held) leaves the hunter as it was
  const kept = (was: Hunter, next: Hunter | Refused): Hunter => (isRefused(next) ? was : next);
  let x = kept(h, sheetEdit(h, { type: 'totals', life: row.lifeLeft, mana: row.mana, fatigue: row.fatigue, statuses: row.statuses, used: row.used }, R));
  for (const sp of run.end.spent) if (sp.by === run.hunter) x = kept(x, spendItem(x, sp.item, R));
  for (const [cid, sid] of Object.entries(run.shadows)) { const e = run.end.party[cid as CombatantId]; if (e) x = kept(x, setShadowHp(x, sid, e.hp)); }
  return x;
}

/** The words of a run's outcome for one hunter: the System window's title and the log's verb. */
export const OUTCOME_WORDS: { readonly [O in RunOutcome]: { readonly title: string; readonly did: string } } = {
  won: { title: 'GATE CLEARED', did: 'cleared' },
  lost: { title: 'RUN FAILED', did: 'fell in' },
  stalled: { title: 'RETREAT', did: `retreated from` },
};
const LIFE_WORDS: { readonly [L in LifeState]: string } = { up: '', dead: ' and died' };
/** The session log's line of a run: who, what, which gate, how long, and how the hunter came out. */
export function runLine(name: string, gate: { readonly name: string; readonly rank: Rank }, outcome: RunOutcome, rounds: number, life: LifeState, hunterId: HunterId | null): Said {
  const r = Math.max(1, Math.round(rounds)), when = outcome === 'stalled' ? ` after ${CAP_ROUNDS} rounds` : ` in ${r} round${r === 1 ? '' : 's'}`;
  return { kind: 'gate', hunterId, title: 'Solo run', text: `${name} ${OUTCOME_WORDS[outcome].did} "${gate.name}" (${gate.rank}-rank) alone${when}${LIFE_WORDS[life]}.` };
}

/** What a run's write did, for its window. */
export type Ran = {
  readonly save: Save; readonly outcome: RunOutcome; readonly before: Vitals; readonly after: Vitals; readonly granted: Granted | null; readonly xp: number;
};
/**
 * What `soloRan` reads besides the save: the moment and the readiness context as the phone stands at the write; for a
 * player's run of a room's gate the `soloRun` message the view made from `soloRunBody` (its id is the run's).
 */
export type RanCtx = { readonly day: Day; readonly ready: ReadyCtx; readonly event?: RoomEvent | null };

const vitalsOf = (h: Hunter): Vitals => ({ life: h.life, mana: h.mana, fatigue: h.fatigue, collapsed: h.collapsed, used: h.used });

/**
 * Hunter `hid`'s run `run` of `gate` written, in one step: the run's log line, the hunter as the play left it (`ranOn`),
 * then the gate: a personal gate cleared leaves the list and pays its roster's XP (`gateXp`) and `loot` (`grant`); a
 * world gate cleared on this phone is its Clear for this one hunter (`settleClear`, its XP due and `loot`); a world gate
 * the hunter fell in or retreated from is entered when detected (`enteredAlone`). Refused whole when a world gate's run
 * no longer has the route it started on (`moved`: the phone joined or left a room), the run may no longer be written
 * (`soloReady`), or the hunter changed since the run began (`changed`). A run in a room (`run.route`) writes nothing of
 * the gate: its `soloRun` message goes in that room's outbox and a won run waits for the GM's answer (`runPosted`);
 * refused (`no-room`) without that message.
 */
export function soloRan(save: Save, hid: string, gate: SoloGate, run: SoloRun, loot: SoloLoot, c: RanCtx): Ran | Refused<SoloRefusal | 'unchanged' | 'missing' | 'no-hunter' | 'no-room'> {
  if (gate.kind === 'world' && !sameRoute(run.route, c.ready.route)) return refuse('moved');
  const R = c.day.R, ready = soloReady(save, hid, gate, c.ready);
  if (isRefused(ready)) return ready;
  const { h, target } = ready;
  if (soloKey(h) !== run.from) return refuse('changed');
  const outcome = run.end.outcome, stamp: Stamp = { at: c.day.at, cap: R.logCap };
  // the run's end ends the gate for the hunter, cleared or not: its rests a gate start again (rests.ts `gateLeft`)
  const ended = ranOn(h, run, R), left = sheetEdit(ended, { type: 'gateLeft' }, R), ran = isRefused(left) ? ended : left;
  const max = hunterSheet(ran, R).sheet.hpMax, above = rankIdx(target.rank) - rankIdx(h.rank);
  // the run's end is a fact of the chronicle (chronicle.ts), and a personal gate cleared a gate's, which gives everything
  // back (grant.ts `noteFacts`; a world gate's is its Clear's, settleClear in pay.ts)
  const after = noteFacts(ran, [{
    kind: 'solo', outcome, name: target.name, rank: target.rank, above, rounds: Math.round(run.end.rounds),
    endPct: max > 0 ? Math.round(100 * hpOf(ran.life, max) / max) : 0, life: ran.life.at, personal: gate.kind === 'personal',
  }, ...killFacts(run.end.party[run.hunter]?.kills ?? [], h.rank, 'solo'),
  ...(gate.kind === 'personal' && outcome === 'won' ? [gateFact(target, h.rank, null)] : [])], R);
  let s: Save = told({ ...save, hunters: save.hunters.map(x => (x.id === h.id ? after : x)) }, stamp,
    runLine(h.name, target, outcome, run.end.rounds, after.life.at, h.id));
  const rewards = (xp: number, gold: number) => ({ ...newRewards(), xp, gold, items: [...loot.items] });
  let granted: Granted | null = null, xp = 0;
  if (gate.kind === 'personal') {
    if (outcome === 'won') {
      const g = h.solo.gates.find(x => x.id === gate.id)!, seeds = seedMonsters(R);
      xp = gateXp({ monsters: [...g.monsters], bossId: null }, id => { const m = seeds.find(x => x.id === id); return m ? monsterXp(m, R) : 0; });
      s = { ...s, hunters: s.hunters.map(x => (x.id === h.id ? { ...x, solo: { ...x.solo, gates: x.solo.gates.filter(y => y.id !== gate.id) } } : x)) };
      const g2 = grant(s, h.id, rewards(xp, loot.gold), null, { ...c.day, vitals: 'sheet' });
      if (isRefused(g2)) return g2;
      s = g2.save; granted = g2;
    }
  } else if (run.route === 'local') {
    if (outcome === 'won') {
      // the gate's Clear for a party of one: its whole pot of XP due and gold rolled (pay.ts `shareEach`, n = 1)
      const g = save.gates.find(x => x.id === gate.id)!, all = [...seedMonsters(R), ...save.monsters];
      const due = xpDue(g, id => { const m = all.find(x => x.id === id); return m ? monsterXp(m, R) : 0; }), gold = shareEach(loot.gold, 1, R.gateParty);
      xp = shareEach(due, 1, R.gateParty);
      const pay = { due, xp, gold, items: loot.items.map(i => i.name), payees: [h.name] };
      const settled = settleClear(s, gate.id, pay, [{ hid: h.id, rewards: rewards(xp, gold) }], null, c.day);
      if (isRefused(settled)) return settled;
      s = settled.save; granted = settled.granted[0]?.g ?? null;
    } else {
      const entered = enteredAlone(s, gate.id, stamp);
      if (!isRefused(entered)) s = entered;
    }
  } else {
    // a player's run of a room's gate: its message to the GM's phone, and a won run waits for the answer (solo-wait.ts)
    const code = run.route.room, ev = c.event;
    if (!ev || ev.type !== 'soloRun' || ev.payload.gate !== gate.id || ev.payload.outcome !== outcome) return refuse('no-room');
    s = atOutbox(b => post(b, code, { kind: 'event', event: ev }).box)(s);
    if (outcome === 'won') s = runPosted(s, { run: ev.payload.eid, room: code, hid: h.id, gate: gate.id, name: target.name, at: c.day.at, state: 'posted' });
  }
  return { save: s, outcome, before: vitalsOf(h), after: vitalsOf(s.hunters.find(x => x.id === h.id) ?? after), granted, xp };
}


/** The `soloRun` body of hunter `h`'s run of `t` (the view makes the event, its id the run's): what the GM's phone acts on. */
export function soloRunBody(h: Hunter, run: SoloRun, t: SoloTarget, by: SheetKey, R: Rules): EventBody<'soloRun'> | null {
  if (t.gate.kind !== 'world') return null;
  return { by, gate: t.gate.id, name: h.name.slice(0, 60), outcome: run.end.outcome, rounds: Math.round(run.end.rounds * 10) / 10, life: ranOn(h, run, R).life.at };
}

// ── the room: a world gate marked solo (notes-2-solo.md section 4) ──
/** A monster as the solo doc carries it: as `parseMonster` reads it, its text fields (notes, description) and loot left out. */
const docMonster = (m: Monster): MonsterTemplate => {
  const { auto: _auto, placeholder: _placeholder, ...fight } = parseMonster({ ...m, notes: [], desc: '', loot: { gold: 0, items: [] } })!;
  return fight;
};
/** The statuses a monster names by key at its start, as the GM's rules hold them. */
const namedStatuses = (m: Monster, R: Rules): Record<string, StatusDef> =>
  Object.fromEntries(m.statuses.flatMap(x => { const defs: Readonly<Record<string, StatusDef>> = R.conditions; return Object.hasOwn(defs, x.key) ? [[x.key, defs[x.key]!]] : []; }));

/**
 * The room's solo doc as the GM's phone publishes it: the gates of the world doc open to solo runs that can still be
 * cleared, in its order, each with its roster as monster keys and counts (its boss last); each monster once, by value;
 * and the statuses those monsters name. A gate is added whole while the doc's JSON stays within `max` (`DOC_MAX`);
 * the gates left out are answered, so the world doc marks solo only what this doc holds and the GM's card says why.
 */
export function soloDoc(save: Pick<Save, 'gates' | 'monsters'>, R: Rules, max: number): { readonly doc: SoloDoc; readonly left: readonly GateId[] } {
  const all = [...seedMonsters(R), ...save.monsters], left: GateId[] = [];
  let doc: SoloDoc = { gates: [], monsters: {}, statuses: {} };
  for (const g of worldOrder(save.gates)) {
    if (!g.solo || !can(g, 'clear')) continue;
    const lines = [...g.monsters.map(m => ({ m: m.monsterId as string, n: m.count })), ...(g.bossId ? [{ m: g.bossId as string, n: 1 }] : [])];
    const found = lines.flatMap(l => { const m = all.find(x => x.id === l.m); return m ? [m] : []; });
    const next: SoloDoc = {
      gates: [...doc.gates, { id: g.id, name: g.name.slice(0, WORLD_NAME_MAX), rank: g.rank, boss: g.bossId !== null, lines }],
      monsters: { ...doc.monsters, ...Object.fromEntries(found.map(m => [m.id, docMonster(m)])) },
      statuses: Object.assign({}, doc.statuses, ...found.map(m => namedStatuses(m, R))),
    };
    if (JSON.stringify(next).length <= max) doc = next; else left.push(g.id);
  }
  return { doc, left };
}

/**
 * The room's solo gates as a player's phone plays them: each gate the world doc marks solo and that can still be
 * cleared, with its roster from the solo doc (a line whose monster the doc lacks is left out) and the doc's statuses.
 */
export function soloTargets(world: WorldDoc | null, doc: SoloDoc | null): SoloTarget[] {
  if (!world || !doc) return [];
  return world.gates.flatMap(w => {
    const g = doc.gates.find(x => x.id === w.id);
    if (!w.solo || !g || !can(w, 'clear')) return [];
    const monsters = g.lines.flatMap(l => { const m = doc.monsters[l.m]; return m ? [{ id: l.m as MonsterId, monster: m, count: l.n }] : []; });
    return [{ gate: { kind: 'world' as const, id: g.id }, name: g.name, rank: g.rank, boss: g.boss, monsters, statuses: doc.statuses }];
  });
}

/**
 * What the GM's phone does with a player's run: pay a won run whose gate it can still clear, refuse one it cannot, or
 * note a lost or stalled one. A paid run is the gate's Clear for a party of one: `due` the XP the gate owes, `xp` the
 * hunter's share of it, and `party` the rule (`gateParty`) its gold roll is shared by when it is rolled (`shareEach`).
 */
export type SoloPlan = { readonly kind: 'paid'; readonly due: number; readonly xp: number; readonly party: number } | { readonly kind: 'refused'; readonly why: SoloRefused } | { readonly kind: 'report' };
/** The GM's gate as a player's run finds it: gone, cleared, closed (no Clear possible), still clearable but no longer open to solo runs, or open to them. */
export const SOLO_GATE_FOUND = ['gone', 'cleared', 'closed', 'notSolo', 'open'] as const;
export type SoloGateFound = (typeof SOLO_GATE_FOUND)[number];
/** What the GM's phone does with a run: pay it as the gate's Clear, answer it refused with why, or only note it. */
type PlanCell = 'pay' | 'report' | SoloRefused;
/** Each gate as the run finds it, against each outcome of the run: every cell. */
export const PLAN_TABLE: { readonly [G in SoloGateFound]: { readonly [O in RunOutcome]: PlanCell } } = {
  gone: { won: 'gone', lost: 'report', stalled: 'report' },
  cleared: { won: 'taken', lost: 'report', stalled: 'report' },
  closed: { won: 'closed', lost: 'report', stalled: 'report' },
  // SMX-gates-2.2: a run a player started before the GM took the gate out of solo runs still counts (the owner, Nov 22:
  // "Yes that run still counts"): a won run is paid, and a lost or stalled run enters it (`soloTaken`).
  notSolo: { won: 'pay', lost: 'report', stalled: 'report' },
  // SMX-gates-2.3: ruled yes (the owner, Nov 22, rule d: a solo clear's rewards wait for the GM's edit and approval); written
  // as a unit, not built (notes-9-rulings-1122.md, ruling 20), so `pay` still pays at once.
  open: { won: 'pay', lost: 'report', stalled: 'report' },
};
const gateFound = (g: Gate | undefined): SoloGateFound =>
  (!g ? 'gone' : !can(g, 'clear') ? (g.status === 'cleared' ? 'cleared' : 'closed') : g.solo ? 'open' : 'notSolo');
/** The plan for run `p` on the GM's save as it stands (`PLAN_TABLE`): the one rule, asked again inside the write (`soloTaken`). */
export function soloPlan(save: Pick<Save, 'gates' | 'monsters'>, p: SoloRunPayload, R: Rules): SoloPlan {
  const g = save.gates.find(x => x.id === p.gate), cell = PLAN_TABLE[gateFound(g)][p.outcome];
  if (cell === 'report') return { kind: 'report' };
  if (cell !== 'pay') return { kind: 'refused', why: cell };
  // the table pays only a gate it found (open or notSolo)
  const all = [...seedMonsters(R), ...save.monsters], due = xpDue(g!, id => { const m = all.find(x => x.id === id); return m ? monsterXp(m, R) : 0; });
  return { kind: 'paid', due, xp: shareEach(due, 1, R.gateParty), party: R.gateParty };
}
/** The `soloAnswer` body for run `p` under `plan` with the loot rolled: null for a report, which needs none. */
export function soloAnswerBody(save: Pick<Save, 'gates'>, run: EventId, p: SoloRunPayload, plan: SoloPlan, loot: SoloLoot): EventBody<'soloAnswer'> | null {
  const name = save.gates.find(x => x.id === p.gate)?.name.slice(0, WORLD_NAME_MAX) ?? '';
  const base = { to: [p.by] as [SheetKey], run, gate: p.gate, name };
  if (plan.kind === 'paid') return { ...base, verdict: 'paid', rewards: { ...newRewards(), xp: plan.xp, gold: shareEach(loot.gold, 1, plan.party), items: [...loot.items] } };
  return plan.kind === 'refused' ? { ...base, verdict: 'refused', why: plan.why } : null;
}

/**
 * What `soloTaken` reads besides the save: the moment; the room it answers in, with the stamp of the messages it makes;
 * the rank of the run's hunter as the GM's phone sees it (its pushed sheet), null when it has none.
 */
export type TakenCtx = { readonly day: Day; readonly room: { readonly code: RoomCode; readonly stamp: EventStamp } | null; readonly rank: Rank | null };
/**
 * A player's run `p` taken on the GM's phone, in one write (once by its event id, sync.ts `once`): the run's line; a
 * won run whose gate can still be cleared is that gate's Clear for that one hunter (`settleClear`: its answer posted
 * with the reward, then its gate fact); one it cannot clear is answered refused; a lost or stalled run enters a detected
 * gate. Refused (`changed`) when the plan the answer was made from no longer holds, and (`no-room`) with no room to answer in.
 */
export function soloTaken(save: Save, p: SoloRunPayload, plan: SoloPlan, answer: RoomEvent | null, loot: SoloLoot, c: TakenCtx): Save | Refused<'changed' | 'no-room' | 'missing' | 'unchanged'> {
  const R = c.day.R, now = soloPlan(save, p, R), stamp: Stamp = { at: c.day.at, cap: R.logCap };
  if (JSON.stringify(now) !== JSON.stringify(plan)) return refuse('changed');
  const s = told(save, stamp, takenLine(save, p, plan));
  if (plan.kind === 'report') { const e = enteredAlone(s, p.gate, stamp); return isRefused(e) ? s : e; }
  if (!c.room || !answer) return refuse('no-room');
  const room = c.room;
  if (plan.kind === 'refused') return atOutbox(b => post(b, room.code, { kind: 'event', event: answer }).box)(s);
  const pay = { due: plan.due, xp: plan.xp, gold: shareEach(loot.gold, 1, plan.party), items: loot.items.map(i => i.name), payees: [p.name || 'A hunter'] };
  const settled = settleClear(s, p.gate, pay, [], { ...room, players: [{ key: p.by, rank: c.rank, pays: answer }] }, c.day);
  return isRefused(settled) ? settled : settled.save;
}
/** The GM's log line (and toast) of a player's run: the run's line, and why a won run was not paid. */
export function takenLine(save: Pick<Save, 'gates'>, p: SoloRunPayload, plan: SoloPlan): Said {
  const g = save.gates.find(x => x.id === p.gate);
  const said = runLine(p.name || 'A hunter', g ?? { name: 'a gate', rank: 'E' }, p.outcome, p.rounds, p.life, null);
  return plan.kind === 'refused' ? { ...said, text: `${said.text} ${REFUSED_LINE[plan.why]}` } : said;
}
/** The GM's log's words for a won run its phone did not pay. */
const REFUSED_LINE: { readonly [W in SoloRefused]: string } = {
  taken: 'Someone cleared it first, so the run paid nothing.', closed: 'The gate closed first, so the run paid nothing.', gone: 'The gate was gone, so the run paid nothing.',
};
/** What the player's window says of a refused run (the answer's `why`). */
export const REFUSED_WORDS: { readonly [W in SoloRefused]: string } = {
  taken: 'Another hunter cleared this gate first. Your run\'s cost stays.',
  closed: 'The GM closed this gate first. Your run\'s cost stays.',
  gone: 'This gate is gone. Your run\'s cost stays.',
};

// ── the words a player reads (copy-tasks.md: the System's voice in a window's tag and title only) ──
const span = (s: { readonly low: number; readonly high: number }): string => (s.low === s.high ? `${s.low}` : `${s.low} to ${s.high}`);
/** What the Gates view says of solo runs: its sections, its control, its run's count, its notes. */
export const SOLO_WORDS = {
  personal: 'Personal gates',
  room: 'Solo gates',
  enter: 'Enter alone',
  confirm: 'ENTER ALONE?',
  notNow: 'Not now',
  running: (round: number, moves: number): string => `Round ${round}, ${moves} move${moves === 1 ? '' : 's'} played`,
  open: 'Open to solo runs',
  tooBig: 'Too many monsters to send to players. Open fewer gates to solo runs, or give this one fewer of your own monsters.',
  none: 'No personal gate is open. The System opens one every few hours.',
  dismiss: 'Dismiss',
  switch: 'Personal gates',
  every: 'Hours between gates',
} as const;
/** The lines of a personal gate's news window ("A GATE HAS APPEARED"): its rank, that it is entered alone, when it closes. */
export const personalNews = (g: Pick<PersonalGate, 'rank' | 'closesAt'>, nowMs: number): string[] => [`Rank: ${g.rank}`, 'A personal gate: enter it alone.', `${closesIn(g, nowMs)}.`];
/** When a personal gate closes, from `nowMs`: in hours, or in minutes in its last hour. */
export function closesIn(g: Pick<PersonalGate, 'closesAt'>, nowMs: number): string {
  const ms = Date.parse(g.closesAt) - nowMs;
  if (ms <= 0) return 'Closed';
  const h = Math.floor(ms / 3600e3), m = Math.max(1, Math.ceil(ms / 60e3));
  return h >= 1 ? `Closes in ${h} hour${h === 1 ? '' : 's'}` : `Closes in ${m} minute${m === 1 ? '' : 's'}`;
}
/**
 * The confirm window's lines from the odds of the hunter's row (`read.party[0]`): the chance to clear, the HP it likely
 * leaves, the chance to come out down or dead, and that the run is one more play, not the odds.
 */
export function soloConfirmLines(read: OddsRead): string[] {
  const me = read.party[0];
  const lines = [wonLine(read, 'alone')];
  if (me) {
    lines.push(`HP left: ${span(me.hp)} of ${me.hpMax}, most often ${me.hp.mid}.`);
    lines.push(fateLine(me));
  }
  lines.push(`The odds are ${read.of} plays. Your run is one more, and it can go better or worse.`);
  return lines;
}
/** What a run cost, line by line: HP, mana and fatigue before and after, and how the hunter came out. */
export function runCostLines(before: Vitals, after: Vitals, m: Maxima): string[] {
  const out = [`HP ${hpOf(before.life, m.hpMax)} to ${hpOf(after.life, m.hpMax)} of ${m.hpMax}`, `Mana ${manaOf(before, m)} to ${manaOf(after, m)} of ${m.manaMax}`,
    `Fatigue ${Math.min(before.fatigue, m.fatigueMax)} to ${Math.min(after.fatigue, m.fatigueMax)} of ${m.fatigueMax}`];
  if (after.life.at === 'dead') out.push(`You died. ${WAYS_BACK} brings you back.`);
  if (after.collapsed && !before.collapsed) out.push('You have collapsed from exhaustion.');
  return out;
}
/** The room's personal gates' switch and hours set by the GM (`rulesOverrides.solo`), as one step for `store.apply`. */
export const soloRuleSet = <S extends Pick<Save, 'rulesOverrides'>>(save: S, patch: { personal?: boolean; hours?: number }): S => {
  const was = save.rulesOverrides.solo, solo = was !== null && typeof was === 'object' && !Array.isArray(was) ? was as Record<string, unknown> : {};
  return { ...save, rulesOverrides: { ...save.rulesOverrides, solo: { ...solo, ...patch } } };
};

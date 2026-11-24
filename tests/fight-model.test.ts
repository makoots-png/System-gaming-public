// A model test of the reworked fight (src/core/combat/fight.ts): 2,500 seeded fights of random legal and illegal commands
// over a mixed party and pack on a map with walls, with the invariants below checked after every command. A failure
// prints the seed and the commands up to it. The fights are in tests/models/fight-play.ts, which the charts play too.
import { fightId } from '../src/core/ids.ts';
import { tallyOf } from '../src/core/combat/row-tally.ts';
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { TERRAIN } from '../src/core/combat/space.ts';
import { modified, onSheet, perRound } from '../src/core/combat/effect-ops.ts';
import { stacked } from '../src/core/combat/op-amount.ts';
import type { Status } from '../src/core/combat/effect-ops.ts';
import { hpPrice } from '../src/core/combat/charge.ts';
import { needs } from '../src/core/combat/resolve.ts';
import { usesGates } from '../src/core/combat/uses.ts';
import { fire, raised } from '../src/core/combat/triggers.ts';
import type { Raised, Trigger } from '../src/core/combat/triggers.ts';
import { MAX_ZONES, standsIn, zoneTiles } from '../src/core/combat/zones.ts';
import { held, partyView } from '../src/core/combat/fight-turn.ts';
import { isUp, rowHp } from '../src/core/combat/row-hp.ts';
import { hpOf } from '../src/core/hunter/vitals.ts';
import { alive } from '../src/core/combat/land.ts';
import { boostsOn, counts, edgeOn, exposedOf, hides, holds, rangeWith, shareOf, stealthOf, stealthState, warded, wardedDamage } from '../src/core/combat/standing.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { perceivedBy } from '../src/core/combat/sight.ts';
import { parseFight } from '../src/core/combat/fight-parse.ts';
import { dodgeAsk, MAX_SPREAD, owed, reduce, runningState } from '../src/core/combat/fight.ts';
import { omenMove, omenNeeds } from '../src/core/combat/fight-turn.ts';
import { gateOf, scriptOf } from '../src/core/combat/mythic.ts';
import type { Command, Effect, Fight } from '../src/core/combat/fight.ts';
import { place } from '../src/core/combat/space.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { CombatantId } from '../src/core/combat/ability-types.ts';
import type { Rolls } from '../src/core/combat/resolve.ts';
import { GRID, ROSTER, SEEDS, ctx, lengthOf, randomCommand, rng } from './models/fight-play.ts';

const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); }
  return v;
};
const json = (v: unknown): string => JSON.stringify(v);
/** Deep equality of JSON-like values, ignoring key order. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b), ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  return ka.length === kb.length && ka.every(k => Object.hasOwn(rb, k) && same(ra[k], rb[k]));
}

/**
 * What the model remembers between commands: per status instance, the ticks its rollSettle effects paid for; per row a
 * sheet holds, what that sheet was last told (its HP, mana, fatigue and status keys, from the row as it joined and then
 * from each write-back).
 */
type Told = { hp: number; mana: number; fatigue: number; keys: string };
type Memory = {
  fightId: string | null; settled: Map<string, number>; since: Map<string, number>; told: Map<string, Told>;
  reacted: Map<string, number>; wards: Map<string, number>; triggers: Map<string, number>; parsedTriggers: number;
};
const fresh = (): Memory => ({
  fightId: null, settled: new Map(), since: new Map(), told: new Map(), reacted: new Map(), wards: new Map(), triggers: new Map(), parsedTriggers: 0,
});
/** Log lines added by the command that took `before` to `after`, oldest first. Matches `before.log[0]` by object identity (`logged` spreads `...f.log` without cloning). */
function freshLogs(before: Fight | null, after: Fight): string[] {
  if (!before || before.id !== after.id || !before.log.length) return after.log.map(l => l.text).reverse();
  const at = after.log.indexOf(before.log[0]!);
  return (at < 0 ? after.log : after.log.slice(0, at)).map(l => l.text).reverse();
}
/** A sheet's status keys: a zone's hold is the ground's, and a fight's count or a delayed effect the fight's (`onSheet`): neither reaches a sheet. */
const keysOf = (list: readonly { key: string; zone?: string }[]): string => list.filter(s => s.zone === undefined).map(s => s.key).sort().join(',');
const sheetKeysOf = (list: readonly Status[]): string => keysOf(list.filter(onSheet));

/** A row's sheet must have heard of every change of its HP, mana, fatigue and statuses (a shadow's sheet, of its HP). */
function toldWrong(after: Fight, effects: readonly Effect[], mem: Memory): string | null {
  for (const r of after.rows) if (r.holder && !mem.told.has(r.id)) mem.told.set(r.id, { hp: rowHp(r), mana: r.mana, fatigue: r.fatigue, keys: sheetKeysOf(r.statuses) });
  for (const e of effects) {
    const r = after.rows.find(x => x.holder && (
      e.type === 'vitals' ? x.holder.kind === 'local' && x.holder.hunterId === e.hunterId
        : e.type === 'sendRemote' ? x.holder.kind === 'remote' && x.holder.remote === e.remote
          : e.type === 'shadowHp' && x.holder.kind === 'shadow' && x.holder.shadowId === e.shadowId));
    if (!r) continue;
    const was = mem.told.get(r.id)!;
    mem.told.set(r.id, e.type === 'shadowHp' ? { ...was, hp: e.hp } : e.type === 'vitals' || e.type === 'sendRemote'
      ? { hp: hpOf(e.life, Infinity), mana: e.mana, fatigue: e.fatigue, keys: keysOf(e.statuses) } : was);
  }
  for (const r of after.rows) {
    if (!r.holder) continue;
    const t = mem.told.get(r.id)!;
    const now: Told = r.holder.kind === 'shadow' ? { ...t, hp: rowHp(r) } : { hp: rowHp(r), mana: r.mana, fatigue: r.fatigue, keys: sheetKeysOf(r.statuses) };
    if (json(now) !== json(t)) return `${r.id}'s sheet was last told ${json(t)} but the row holds ${json(now)}`;
  }
  return null;
}

/** What is wrong after `cmd` took `before` to `after`, or null. */
function check(before: Fight | null, cmd: Command, after: Fight | null, effects: readonly Effect[], mem: Memory): string | null {
  const refused = effects.some(e => e.type === 'refused');
  if (effects.length && effects.every(e => e.type === 'refused') && after !== before && json(after) !== json(before)) return 'a refused command changed the fight';
  const deadAct = deadActWrong(before, cmd, after, effects, refused);
  if (deadAct) return deadAct;
  if (!after) return null;
  if (after.id !== mem.fightId) { mem.fightId = after.id; mem.settled.clear(); mem.since.clear(); mem.told.clear(); mem.reacted.clear(); mem.wards.clear(); mem.triggers.clear(); }
  const rose = roseWrong(before, cmd, after, refused);
  if (rose) return rose;
  if (after.phase === 'running' && after.dodge) {
    if (runningState(after).at !== 'dodging') return 'fight with open dodge is not in dodging state';
    if (owed(after).length > 0 || after.pending.length > 0) return 'fight in dodging state still owes dice';
    if ((after.dodges ?? 0) < after.dodge.n || after.dodge.n < 1) return `dodge counter ${after.dodges} lags behind prompt ${after.dodge.n}`;
    const ask = dodgeAsk(after, RULES);
    if (!ask || ask.tiles.length < 2) return 'open dodge wait has fewer than two legal tiles';
    const who = after.rows.find(r => r.id === ask.who);
    if (!who || who.kind !== 'hunter' || !isUp(who) || Object.hasOwn(after.dodge.to, ask.who)) return `open dodge asks invalid target ${ask.who}`;
  }
  const told = toldWrong(after, effects, mem);
  if (told) return told;
  const ids = after.rows.map(r => r.id);
  if (new Set(ids).size !== ids.length) return 'two rows share an id';
  const tiles = new Set<string>();
  for (const r of after.rows) {
    const s = r.sheet;
    if (rowHp(r) < 0 || rowHp(r) > s.hpMax) return `${r.id} has HP ${rowHp(r)} of ${s.hpMax}`;
    if (r.mana < 0 || r.mana > s.manaMax) return `${r.id} has mana ${r.mana} of ${s.manaMax}`;
    if (r.fatigue < 0 || r.fatigue > s.fatigueMax) return `${r.id} has fatigue ${r.fatigue} of ${s.fatigueMax}`;
    const { x, y } = r.place;
    if (x < 0 || y < 0 || x >= after.grid.w || y >= after.grid.h) return `${r.id} stands off the grid at ${x},${y}`;
    // a monster or shadow at 0 is gone from the map, and a painted wall may cover where it fell
    if (alive(r) && !TERRAIN[after.grid.tiles?.[y * after.grid.w + x] ?? 'floor'].walk) return `${r.id} stands on ${after.grid.tiles?.[y * after.grid.w + x]} at ${x},${y}`;
    if (alive(r)) { if (tiles.has(`${x},${y}`)) return `two bodies stand on ${x},${y}`; tiles.add(`${x},${y}`); }
    const max = r.abilities.find(a => a.id === r.channel?.ability)?.channel?.max ?? RULES.fight.channelMax;
    if (r.channel && (r.channel.charge < 0 || r.channel.charge > max)) return `${r.id}'s channel has charge ${r.channel.charge} of ${max}`;
  }
  const fresh = freshLogs(before, after);
  const expired = expiredStatusWrong(before, cmd, after, effects, mem, fresh, refused);
  if (expired) return expired;
  if (before && 'now' in before && 'now' in after && before.id === after.id && after.now < before.now) return `now went back from ${before.now} to ${after.now}`;
  if (after.fog && after.phase !== 'ended') {
    const lit = partyView(after)!, missed = [...lit].find(i => after.fog!.seen[i] !== '1');
    if (missed !== undefined) return `the party sees tile ${missed} but the fog has not marked it seen`;
  }
  if (after.phase === 'ended' && 'fudge' in after) return 'an ended fight still holds the GM\'s fudge';
  if (after.phase !== 'ended') for (const id of [...Object.keys(after.fudge.rows), ...Object.keys(after.fudge.forced)]) if (!after.rows.some(r => r.id === id)) return `the fudge names ${id}, not in the fight`;
  if (after.phase === 'running') {
    const gone = after.zones.find(z => z.until !== null && z.until <= after.now);
    if (gone) return `${gone.id} ended at ${gone.until} and is still on the ground at ${after.now}`;
    for (const r of after.rows.filter(x => rowHp(x) > 0 || x.kind === 'hunter')) for (const z of after.zones) {
      const open = r.statuses.filter(s => s.zone === z.id && s.until === null).length, inside = standsIn(z, zoneTiles(z, after.rows, after.grid, after.now, RULES), r) ? 1 : 0;
      if (open !== inside) return `${r.id} holds ${open} open holds on ${z.id} and ${inside ? 'stands' : 'does not stand'} in it`;
    }
    for (const z of after.zones) {
      const g = z.ground, a = g.kind === 'around' && g.anchor.kind === 'body' ? g.anchor : null, b = a && after.rows.find(r => r.id === a.id);
      if (a && !(b && isUp(b))) return `the aura ${z.id} is on the ground around ${a.id}, who is not up`;
      if (a?.status && !b!.statuses.some(s => s.key === a.status && s.zone === undefined && s.def.ops.some(o => o.op === 'aura'))) return `the aura ${z.id} stays after ${a.id} lost ${a.status}`;
    }
    for (const r of after.rows) for (const s of r.statuses) {
      if (s.zone !== undefined || !s.def.ops.some(o => o.op === 'spread')) continue;
      const list = after.had[s.key];
      if (Object.keys(after.had).length < MAX_SPREAD && !list?.includes(r.id)) return `${r.id} holds the spreading ${s.key} and is not on its list`;
      const was = before?.rows.find(x => x.id === r.id);
      if (cmd.type === 'settle' && before?.had[s.key]?.includes(r.id) && !was?.statuses.some(x => x.key === s.key)) return `${r.id} caught ${s.key} again`;
    }
    if (Object.keys(after.had).length > MAX_SPREAD) return `the fight lists ${Object.keys(after.had).length} spreading statuses`;
    for (const [k, ids] of Object.entries(after.had)) if (ids.some(id => !after.rows.some(r => r.id === id))) return `${k}'s list names a row not in the fight`;
    if (after.zones.length < MAX_ZONES) for (const r of after.rows.filter(isUp)) for (const s of r.statuses) {
      const lasts = s.zone === undefined && (s.until === null || s.until > after.now) && s.def.ops.some(o => o.op === 'aura');
      const has = after.zones.some(z => z.ground.kind === 'around' && z.ground.anchor.kind === 'body' && z.ground.anchor.id === r.id && z.ground.anchor.status === s.key);
      if (lasts && !has) return `${r.id} bears ${s.key}, which gives off an aura, and none is on the ground`;
    }
  }
  const tally = tallyWrong(before, after);
  if (tally) return tally;
  const kits = kitsWrong(before, cmd, after, effects);
  if (kits) return kits;
  const wave2 = wave2Wrong(before, cmd, after, effects, mem, fresh, refused);
  if (wave2) return wave2;
  const asked = askedWrong(before, cmd, effects);
  if (asked) return asked;
  const scripted = mythicWrong(before, cmd, after, effects);
  if (scripted) return scripted;
  if (after.phase === 'running') {
    for (const side of ['party', 'foe'] as const) if (!after.rows.some(r => r.side === side && isUp(r) && r.kind !== 'summon')) return `the ${side} side has only summons up, or none, and the fight runs on`;
    const cur = after.rows.find(r => r.id === after.currentId);
    if (!cur) return `the current row ${after.currentId} is not in the fight`;
    if (!isUp(cur)) return `the current row ${cur.id} is down`;
    if (held(cur, after.now)) return `the current row ${cur.id} is held`;
    if (cur.at !== after.now) return `the current row ${cur.id} waits to ${cur.at}, not now ${after.now}`;
    const early = after.rows.find(r => isUp(r) && !held(r, after.now) && r.at < after.now);
    if (early) return `${early.id} is up at ${early.at}, before now ${after.now}`;
  }
  const stored = JSON.parse(json(after));
  if (!same(parseFight(stored, RULES), stored)) return 'parseFight does not give the same fight back';
  return null;
}

/**
 * A row's tally (row-tally.ts): no count goes down over a command, its lowest HP share never rises, a row other than a
 * hunter keeps only its kills, and every kill names a foe of the fight on the other side as it is counted. A kill keeps
 * its row's id after the GM removes that row (fight-facts.ts `killsSeen` reads only the rows still there; a turn's count
 * keeps it): seed 1269 removed a hunter a wolf had killed, which the same commands did at 62d87ff too.
 */
function tallyWrong(before: Fight | null, after: Fight): string | null {
  const COUNTS = ['hits', 'crits', 'critRunMax', 'struck', 'avoided', 'dealt', 'taken', 'healed', 'hexes', 'downs', 'turns', 'items'] as const;
  for (const r of after.rows) {
    const t = tallyOf(r), was = before?.rows.find(x => x.id === r.id);
    if (r.kind !== 'hunter' && r.tally && Object.keys(r.tally).some(k => k !== 'kills')) return `${r.id}, not a hunter, keeps ${Object.keys(r.tally).join(', ')}`;
    const held = was ? tallyOf(was).kills.length : 0;
    for (const k of t.kills.slice(held)) { const foe = [...after.rows, ...(before?.rows ?? [])].find(x => x.id === k.row); if (!foe || foe.side === r.side) return `${r.id} counts a kill of ${k.row}, not a foe in the fight`; }
    if (!was) continue;
    const w = tallyOf(was);
    for (const k of COUNTS) if (t[k] < w[k]) return `${r.id}'s ${k} went from ${w[k]} to ${t[k]}`;
    if (t.low > w.low) return `${r.id}'s lowest HP share rose from ${w.low} to ${t.low}`;
    if (t.kills.length < w.kills.length || t.downedBy.length < w.downedBy.length) return `${r.id} lost a kill or a fall`;
  }
  return null;
}

/**
 * The kits' invariants (kits design 3.1 and 3.2): no count past its cap; an owner holds at most `summons` summons, each
 * on its owner's side for at most `summonRounds`, and at most `zonesPerOwner` zones; no limited ability past its uses;
 * an HP price never takes its user to 0 (a use with one that went through had more HP than the price); and no row ends a
 * command holding damage no batch of triggers has read (`hurtFrom`, triggers.ts `readHurt`), so no fall under the low
 * share is missed or left for a later command.
 */
function kitsWrong(before: Fight | null, cmd: Command, after: Fight, effects: readonly Effect[]): string | null {
  const K = RULES.fight.kit;
  for (const r of after.rows) {
    if (r.hurtFrom !== undefined) return `${r.id} ends ${cmd.type} holding damage from ${r.hurtFrom} HP no trigger read`;
    for (const s of r.statuses) if (stacked(s) && (s.stacks < 1 || s.stacks > s.def.stack.cap)) return `${r.id} holds ${s.stacks} of ${s.key}, cap ${s.def.stack.cap}`;
    const summons = after.rows.filter(x => x.kind === 'summon' && x.owner === r.id);
    if (summons.length > K.summons) return `${r.id} holds ${summons.length} summons`;
    if (summons.some(x => x.side !== r.side || x.until === undefined || x.until - ('now' in after ? after.now : 0) > K.summonRounds * RULES.fight.round)) return `${r.id} holds a summon off its side or past its rounds`;
    const zones = after.zones.filter(z => z.owner === r.id && !(z.ground.kind === 'around' && z.ground.anchor.kind === 'body' && z.ground.anchor.status !== null));
    if (zones.length > K.zonesPerOwner) return `${r.id} holds ${zones.length} zones`;
    for (const a of r.abilities) for (const g of usesGates(a)) if ((r.used?.[a.id] ?? 0) > K.fightUses || (g.per === 'fight' && (r.used?.[a.id] ?? 0) > g.n)) return `${r.id} spent ${r.used?.[a.id]} of ${a.id}, ${g.n} a ${g.per}`;
    // a corpse's extraction (extraction.ts): a monster's only, and open only with an attempt left
    const e = r.extraction, was = before?.rows.find(x => x.id === r.id)?.extraction;
    if (e && (r.kind !== 'monster' || (e.at === 'open' && (e.tried < 1 || e.tried >= RULES.shadow.maxAttempts)))) return `${r.id} holds the extraction ${json(e)}`;
    if (was && was.at === 'gone' && json(e) !== json(was)) return `${r.id}'s spent corpse took another attempt`;
  }
  if (cmd.type === 'act' && before && !effects.some(e => e.type === 'refused')) {
    const u = before.rows.find(r => r.id === cmd.by), a = u?.abilities.find(x => x.id === cmd.ability);
    for (const p of a?.prices ?? []) if (p.kind === 'hp' && u && rowHp(u) <= hpPrice(p, u.sheet.hpMax)) return `${u.id} paid an HP price of ${hpPrice(p, u.sheet.hpMax)} at ${rowHp(u)} HP`;
  }
  return null;
}

/**
 * Wave 2's invariants (kits design 8.10): a reaction never fires twice between two of its reactor's turns; a foe that is
 * untargetable, or that the user's side does not perceive (sight.ts `perceivedBy`), is never a use's aim; a ward reaches
 * a body once a fight; no turn that moved is set before the next tick; no body takes more than `extraPerRound` extra
 * actions in a round. (A forced move never ending on a wall, a pit or a body is the place checks of `check`, which every
 * command meets.)
 */
function wave2Wrong(before: Fight | null, cmd: Command, after: Fight, effects: readonly Effect[], mem: Memory, fresh: readonly string[], refused: boolean): string | null {
  for (const line of fresh) for (const r of after.rows) {
    if (line.endsWith(`: ${r.name}'s turn.`)) mem.reacted.set(r.id, 0);
    const n = line.split(`${r.name} reacts with `).length - 1;
    if (n > 0) { const k = (mem.reacted.get(r.id) ?? 0) + n; mem.reacted.set(r.id, k); if (k > 1) return `${r.id} reacted ${k} times between two of its turns`; }
  }
  // a landing that fizzled is no use (design B.3): an omen aimed at a body that is now warded or hidden finds no one
  if (cmd.type === 'act' && before && !refused && effects.some(e => e.type === 'used' && e.by === cmd.by) && typeof cmd.aim === 'string') {
    const u = before.rows.find(r => r.id === cmd.by), t = before.rows.find(r => r.id === cmd.aim);
    if (u && t && (warded(t, u.side) || !perceivedBy(u.side, t, before))) return `${u.id} used ${cmd.ability} on ${t.id}, which is untargetable to it or which its side does not perceive`;
  }
  for (const r of after.rows) {
    const was = before?.rows.find(x => x.id === r.id);
    for (const w of ['untargetable', 'invulnerable'] as const) {
      const now = r.statuses.filter(s => s.def.ops.some(o => o.op === w)).map(s => s.key), then = was?.statuses.filter(s => s.def.ops.some(o => o.op === w)).map(s => s.key) ?? [];
      if (now.some(k => !then.includes(k))) { const k = `${r.id}|${w}`, c = (mem.wards.get(k) ?? 0) + 1; mem.wards.set(k, c); if (c > 1) return `${r.id} was ${w} ${c} times in a fight`; }
    }
    if ((r.extras?.n ?? 0) > RULES.fight.kit.extraPerRound) return `${r.id} took ${r.extras!.n} extra actions in a round`;
    if (before && 'now' in before && before.phase === 'running' && was && isUp(was) && isUp(r) && r.at !== was.at && r.at < before.now + 1 && !(after.phase === 'running' && after.currentId === r.id && r.at === after.now)) {
      return `${r.id}'s turn moved to ${r.at}, before the next tick after ${before.now}`;
    }
  }
  return null;
}

/**
 * A use or a channel's release that brings every die `needs` (resolve.ts) asked of the fight before it is never refused
 * for a roll: the dice asked are the dice the use reads (audit BUG-rules-2 and BUG-rules-4).
 */
function askedWrong(before: Fight | null, cmd: Command, effects: readonly Effect[]): string | null {
  if (before?.phase !== 'running' || (cmd.type !== 'act' && cmd.type !== 'release') || !effects.some(e => e.type === 'refused' && e.reason === 'needsRoll')) return null;
  const u = before.rows.find(r => r.id === cmd.by), c = u?.channel;
  // a mythic's landing asks the dice of its omen's move, which is not on its row (`omenMove`, `omenNeeds`)
  const omen = u && cmd.type === 'act' ? omenMove(u, RULES) : null, lands = omen?.ability.id === (cmd.type === 'act' ? cmd.ability : null);
  const a = lands ? omen!.ability : u?.abilities.find(x => x.id === (cmd.type === 'act' ? cmd.ability : c?.ability)), aim = cmd.type === 'act' ? cmd.aim : c?.aim;
  if (!u || !a || aim === undefined) return null;
  const n = lands ? omenNeeds(before, u, RULES)! : needs(a, u, before.rows, aim, before.grid, before.now, RULES), r = cmd.rolls;
  const brought = n.react.every(id => r.react[id] !== undefined) && Object.entries(n.dice).every(([id, ds]) => (r.dice[id as CombatantId]?.length ?? 0) >= ds.length)
    && (!n.refund || r.refund !== undefined) && (n.second ?? []).every(id => r.second?.[id] !== undefined) && (n.boost ?? []).every(b => r.boost?.[b.id] !== undefined);
  return brought ? `${cmd.by}'s ${cmd.type} brought every die needs asked for and was refused for a roll` : null;
}

/**
 * A mythic's invariants (notes-11-keystones.md, design B.3 and B.4): a standing (only a monster's row holds one, which
 * the types keep) is at a phase of its script, an omen standing being one of its script's and a weakened one one that can weaken; while an omen stands it
 * announces no intent of its own; its phase never goes back; no command takes its HP below its gate (the life's writer
 * holds it there; a GM's Next phase brings it to its new phase's start, which is above the new gate); and a fight in
 * `landing` is on the turn of the mythic whose omen stands.
 */
function mythicWrong(before: Fight | null, cmd: Command, after: Fight, effects: readonly Effect[]): string | null {
  for (const r of after.rows) {
    const s = r.mythic, was = before?.rows.find(x => x.id === r.id);
    if (!s) { if (was?.mythic) return `${r.id} lost its standing to ${cmd.type}`; continue; }
    const script = scriptOf(s);
    if (!script.phases[s.phase]) return `${r.id} stands in phase ${s.phase} of a script of ${script.phases.length}`;
    if (s.at !== 'calm') {
      const o = script.omens[s.omen];
      if (!o || (s.at === 'faltering' && o.weak === null)) return `${r.id} stands ${s.at} on ${s.omen}`;
      if (r.intent) return `${r.id} announces an intent while its omen stands`;
    }
    if (was?.mythic && s.phase < was.mythic.phase) return `${r.id} went back from phase ${was.mythic.phase} to ${s.phase}`;
    if (was && rowHp(r) < rowHp(was) && rowHp(r) < gateOf(r)) return `${cmd.type} took ${r.id} to ${rowHp(r)} HP, under its gate of ${gateOf(r)}`;
  }
  if (after.phase === 'running') {
    const st = runningState(after), cur = after.rows.find(r => r.id === after.currentId);
    const due = !!cur?.mythic && cur.mythic.at !== 'calm' && st.at !== 'owing' && st.at !== 'dodging';
    if (due !== (st.at === 'landing')) return `the fight is ${st.at} on ${after.currentId}'s turn, whose standing is ${cur?.mythic?.at ?? 'none'}`;
  }
  if (effects.some(e => e.type === 'omenAnswered') && !before?.rows.some(r => r.mythic && r.mythic.at !== 'calm')) return 'an omen was answered while none stood';
  return null;
}

/**
 * Invariant 1: no row rises from dead outside a revive path.
 * In src/core/combat/, rowLifeAfter (row-life.ts) is the single life writer, and fight.ts `revive` is the only
 * command that sends `{ type: 'revive' }` (both TABLE.dead in vitals.ts and FOE_TABLE.dead in row-life.ts accept
 * only `revive`). Any dead row that is up after another command, or any other row that rises during `revive`, fails.
 */
function roseWrong(before: Fight | null, cmd: Command, after: Fight, refused: boolean): string | null {
  for (const r of after.rows) if (isUp(r) !== (rowHp(r) > 0)) return `${r.id} has inconsistent life state and HP ${rowHp(r)}`;
  if (!before || before.id !== after.id) return null;
  if (!refused && cmd.type === 'revive') {
    const target = before.rows.find(x => x.id === cmd.id);
    if (!target || isUp(target)) return `revive landed on ${cmd.id}, which was not dead`;
  }
  for (const r of after.rows) {
    const was = before.rows.find(x => x.id === r.id);
    if (!was || isUp(was) || !isUp(r)) continue;
    if (refused || cmd.type !== 'revive' || cmd.id !== r.id) return `${r.id} rose from dead on ${cmd.type} without a revive command`;
  }
  return null;
}

const DEAD_ACTOR_CMDS = new Set<Command['type']>(['act', 'move', 'endTurn', 'release', 'arm', 'setIntent', 'mythic']);
const DEAD_TARGET_FX = new Set<Effect['type']>(['crit', 'burst', 'staggered', 'moved', 'turnStarted']);
/**
 * Invariant 2: no act targets or runs from a dead row outside an explicit revive or shadow extraction.
 * Allowed dead-target paths in src/core/combat/: `revive` (fight.ts:545), `extract` on a dead monster (fight.ts:736),
 * and a mythic `landing` turn whose omen target died before landing, which fizzles with no `used` effect (fight.ts:625).
 * Guards ce1c6ada (heal on a dead hunter), 6fc6b2e8 (downed reactor armed), and area acts hitting a dead hunter.
 */
function deadActWrong(before: Fight | null, cmd: Command, after: Fight | null, effects: readonly Effect[], refused: boolean): string | null {
  if (before && !refused && 'by' in cmd && DEAD_ACTOR_CMDS.has(cmd.type)) {
    const by = before.rows.find(r => r.id === cmd.by);
    if (by && !isUp(by)) return `${by.id}, dead, landed ${cmd.type}`;
  }
  if (after) {
    for (const r of after.rows) if (!isUp(r) && r.armed) return `dead row ${r.id} still has an armed reaction`;
  }
  if (before && cmd.type === 'act' && typeof cmd.aim === 'string') {
    const t = before.rows.find(r => r.id === cmd.aim);
    if (t && !isUp(t)) {
      if (effects.some(e => e.type === 'used' && e.by === cmd.by)) return `${cmd.by} landed ${cmd.ability} on dead target ${t.id}`;
      if (effects.some(e => e.type === 'channel' && e.id === cmd.by && e.state === 'holding')) return `${cmd.by} began channeling ${cmd.ability} on dead target ${t.id}`;
      const st = before.phase === 'running' ? runningState(before) : null;
      const fizzle = st?.at === 'landing' && st.id === cmd.by;
      if (!refused && !fizzle) return `${cmd.by}'s act on dead target ${t.id} was not refused`;
    }
  }
  if (before && after && before.id === after.id && !refused && (cmd.type === 'act' || cmd.type === 'release' || cmd.type === 'dodge')) {
    for (const was of before.rows) {
      if (isUp(was)) continue;
      const badFx = effects.find(e => 'id' in e && e.id === was.id && (DEAD_TARGET_FX.has(e.type) || (e.type === 'channel' && e.state !== null)));
      if (badFx) return `${cmd.type} emitted ${badFx.type} on already-dead row ${was.id}`;
      const now = after.rows.find(x => x.id === was.id);
      if (!now) continue;
      if (now.place.x !== was.place.x || now.place.y !== was.place.y) return `${cmd.type} moved already-dead row ${was.id} from ${was.place.x},${was.place.y} to ${now.place.x},${now.place.y}`;
      const touched = now.statuses.find(s => {
        if (s.zone !== undefined) return false;
        const prev = was.statuses.find(x => x.key === s.key);
        if (!prev) return true;
        return (s.stacks ?? 1) > (prev.stacks ?? 1) || (prev.until !== null && (s.until === null || s.until > prev.until));
      });
      if (touched) return `${cmd.type} applied or extended ${touched.key} on already-dead row ${was.id}`;
    }
  }
  return null;
}

const WARD_FLAGS = ['untargetable', 'invulnerable', 'safeguard', 'hidden', 'alert'] as const;
const SHARE_ONS = ['dealt', 'taken', 'healed', 'shielded'] as const;
/**
 * Invariant 3: an expired status does nothing. Once a status runs out (duration, uses, or a broken ward), it pays no
 * tick, ward, modifier, or trigger. Reuses `mem.settled` and `mem.since` for tick accounting and `fresh` for trigger
 * logs. Guards c77cf322 (expired owed status still counting for wards, modifiers, dice, or triggers).
 */
function expiredStatusWrong(
  before: Fight | null, cmd: Command, after: Fight, effects: readonly Effect[], mem: Memory, fresh: readonly string[], refused: boolean,
): string | null {
  const now = after.phase === 'setup' ? tick(0) : after.now;
  const paid = new Map<string, number>();
  for (const e of effects) if (e.type === 'rollSettle') { const k = `${e.id}|${e.key}`; paid.set(k, (paid.get(k) ?? 0) + e.share * RULES.fight.round); }
  const seenKeys = new Set<string>();
  for (const r of after.rows) for (const s of r.statuses.filter(x => x.def.ops.some(perRound))) {
    const k = `${r.id}|${s.key}`;
    seenKeys.add(k);
    if (s.until !== null && s.settledAt > s.until) return `${r.id}'s ${s.key} settled to ${s.settledAt}, past its end ${s.until}`;
    const total = (mem.since.get(k) === s.since ? mem.settled.get(k) ?? 0 : 0) + (paid.get(k) ?? 0);
    mem.since.set(k, s.since); mem.settled.set(k, total);
    if (Math.abs(total - (s.settledAt - s.since)) > 1e-6) return `${r.id}'s ${s.key} settled for ${total} ticks over a span of ${s.settledAt - s.since}`;
    if (s.until !== null && total > (s.until - s.since) + 1e-6) return `${r.id}'s ${s.key} paid ${total} ticks over a duration of ${s.until - s.since}`;
  }
  for (const [k, ticks] of paid) {
    if (seenKeys.has(k) || k.endsWith('-in') || k.endsWith('-spread')) continue;
    const sep = k.indexOf('|'), rowId = k.slice(0, sep), key = k.slice(sep + 1);
    const sBefore = before?.rows.find(x => x.id === rowId)?.statuses.find(x => x.key === key);
    if (sBefore) {
      if (sBefore.until !== null && sBefore.settledAt >= sBefore.until) return `${rowId}'s expired ${key} paid ${ticks} ticks after settling to ${sBefore.until}`;
      const total = (mem.since.get(k) === sBefore.since ? mem.settled.get(k) ?? 0 : 0) + ticks;
      mem.since.set(k, sBefore.since); mem.settled.set(k, total);
      if (sBefore.until !== null && total > (sBefore.until - sBefore.since) + 1e-6) return `${rowId}'s expired ${key} paid ${total} ticks over a duration of ${sBefore.until - sBefore.since}`;
    } else if (!key.startsWith('zone-')) {
      const rowName = (after.rows.find(x => x.id === rowId) ?? before?.rows.find(x => x.id === rowId))?.name;
      if (!rowName || !fresh.some(l => l.includes(`${rowName}: `) && l.includes(' ends.'))) {
        return `${rowId}'s absent status ${key} paid ${ticks} ticks`;
      }
    }
  }
  if (after.phase === 'running') {
    for (const r of after.rows) {
      if (r.shield && r.shield.until <= after.now) return `${r.id} has an expired shield (until ${r.shield.until}) at ${after.now}`;
      for (const s of r.statuses) {
        if (s.until !== null && s.settledAt > s.until) return `${r.id}'s ${s.key} settled to ${s.settledAt}, past its end ${s.until}`;
        if (s.owed && (s.until === null || s.until > after.now)) return `${r.id}'s ${s.key} is marked owed before its end`;
        if (s.until !== null && s.until <= after.now) {
          if (s.zone === undefined) {
            if (!s.owed) return `${r.id}'s expired ${s.key} (until ${s.until}) is still active at ${after.now}`;
            if (counts(s)) return `${r.id}'s expired ${s.key} still counts at ${after.now}`;
            const owes = (s.settledAt < s.until && s.def.ops.some(perRound)) || s.def.end !== undefined;
            if (!owes) return `${r.id}'s expired ${s.key} owes nothing and stays on the row at ${after.now}`;
          } else {
            if (s.settledAt >= s.until || !s.def.ops.some(perRound) || !s.def.ops.every(perRound)) {
              return `${r.id}'s closed zone hold ${s.key} has active ops or nothing owed at ${after.now}`;
            }
          }
        }
      }
    }
    for (const z of after.zones) {
      const g = z.ground, a = g.kind === 'around' && g.anchor.kind === 'body' ? g.anchor : null, b = a && after.rows.find(r => r.id === a.id);
      if (a?.status && b && !b.statuses.some(s => s.key === a.status && s.zone === undefined && counts(s) && (s.until === null || s.until > after.now))) {
        return `aura ${z.id} stays on the ground after ${a.id}'s ${a.status} expired`;
      }
    }
  }
  for (const r of after.rows) {
    const was = before?.rows.find(x => x.id === r.id);
    const hasExpired = r.statuses.some(s => s.owed || (s.until !== null && s.until <= now));
    const statusLeft = !!was && was.statuses.some(s => !r.statuses.some(x => x.key === s.key && x.since === s.since));
    if (hasExpired || statusLeft) {
      const active = r.statuses.filter(s => !s.owed && (s.until === null || s.until > now));
      const m = modified(r.origin, active, RULES);
      if (!same(r.stats, m.stats) || !same(r.sheet, m.sheet) || r.speed !== m.sheet.speed) return `${r.id}'s stats or sheet still reflect an expired status`;
      if (hasExpired) {
        const stripped = { ...r, statuses: active };
        for (const f of WARD_FLAGS) if (holds(r, f) !== holds(stripped, f)) return `${r.id}'s expired status still grants ${f}`;
        if (held(r, now) !== held(stripped, now)) return `${r.id}'s expired status still stuns it`;
        if (wardedDamage(r, rowHp(r)) !== wardedDamage(stripped, rowHp(stripped))) return `${r.id}'s expired invulnerable ward still blocks lethal damage`;
        if (stealthState(stealthOf(r)) !== stealthState(stealthOf(stripped))) return `${r.id}'s expired status still grants stealth`;
        for (const on of SHARE_ONS) if (shareOf(r, on) !== shareOf(stripped, on)) return `${r.id}'s expired status still alters its ${on} share`;
        if (exposedOf(r) !== exposedOf(stripped) || rangeWith(10, r, RULES) !== rangeWith(10, stripped, RULES)) return `${r.id}'s expired status still alters exposed or range`;
        if (edgeOn([], r, stripped).cut !== edgeOn([], stripped, stripped).cut || edgeOn([], stripped, r).cut !== edgeOn([], stripped, stripped).cut) return `${r.id}'s expired status still grants an edge`;
        if (boostsOn(r, stripped).length !== boostsOn(stripped, stripped).length || boostsOn(stripped, r).length !== boostsOn(stripped, stripped).length) return `${r.id}'s expired status still grants a held die`;
      }
    }
    const beforeNow = before && 'now' in before ? before.now : tick(0);
    for (const [tk, trip] of Object.entries(r.trips ?? {})) {
      const wasTrip = was?.trips?.[tk];
      if (wasTrip?.at === 'spent' && trip.at !== 'spent') return `${r.id}'s spent trigger ${tk} reset to ${trip.at}`;
      if (wasTrip?.at === 'tripped' && trip.at === 'tripped' && trip.round < wasTrip.round) return `${r.id}'s trigger ${tk} round moved back from ${wasTrip.round} to ${trip.round}`;
      const hash = tk.lastIndexOf('#'), sk = tk.slice(0, hash), idx = Number(tk.slice(hash + 1));
      const sBefore = was?.statuses.find(s => s.key === sk), sAfter = r.statuses.find(s => s.key === sk);
      if (json(trip) !== json(wasTrip)) {
        if (!sBefore && !sAfter) return `${r.id}'s absent status ${sk} updated trigger ${tk}`;
        if (sBefore && (sBefore.owed || (sBefore.until !== null && sBefore.until <= beforeNow)) && (!sAfter || sAfter.since === sBefore.since)) {
          return `${r.id}'s expired status ${sk} updated trigger ${tk}`;
        }
      }
      if (trip.at === 'counting') {
        const lim = (sAfter ?? sBefore)?.def.triggers?.[idx]?.limit;
        if (lim?.kind === 'fight' && (trip.k < 1 || trip.k >= lim.n)) return `${r.id}'s trigger ${tk} counted ${trip.k} of ${lim.n}`;
      }
    }
  }
  if (before && !refused && (cmd.type === 'act' || cmd.type === 'release') && effects.some(e => e.type === 'used' && e.by === cmd.by)) {
    const uBefore = before.rows.find(r => r.id === cmd.by), uAfter = after.rows.find(r => r.id === cmd.by);
    const omen = uBefore && cmd.type === 'act' ? omenMove(uBefore, RULES) : null;
    const aid = cmd.type === 'act' ? cmd.ability : uBefore?.channel?.ability;
    const a = omen?.ability.id === aid ? omen!.ability : uBefore?.abilities.find(x => x.id === aid);
    if (uBefore && uAfter && a && (a.aim === 'foe' || a.aim === 'place') && !hides(a) && holds(uBefore, 'untargetable') && holds(uAfter, 'untargetable')) {
      return `${uAfter.id}'s untargetable ward stayed active after acting with ${a.id}`;
    }
  }
  const beforeNow = before && 'now' in before ? before.now : tick(0);
  for (const line of fresh) {
    const m = /^R(\d+): Then: (.+)\.$/.exec(line);
    if (!m || m[2]!.includes(' reacts with ')) continue;
    const logRound = m[1]!, parts = m[2]!.replace(/ \([^)]*\)/g, '').split(', ');
    for (const part of parts) {
      const sep = part.indexOf("'s ");
      if (sep < 0) continue;
      const name = part.slice(0, sep), label = part.slice(sep + 3);
      const matches = after.rows.filter(x => x.name === name);
      if (matches.length !== 1) continue;
      const r = matches[0]!, was = before?.rows.find(x => x.id === r.id);
      const sBefore = was?.statuses.find(x => x.def.label === label), sAfter = r.statuses.find(x => x.def.label === label);
      mem.parsedTriggers++;
      if (!sBefore && !sAfter) return `${r.id}'s absent status ${label} fired a trigger`;
      if (sBefore && (sBefore.owed || (sBefore.until !== null && sBefore.until <= beforeNow)) && (!sAfter || sAfter.since === sBefore.since)) {
        return `${r.id}'s expired status ${sBefore.key} fired a trigger`;
      }
      const s = sAfter ?? sBefore!, trs = s.def.triggers ?? [];
      if (trs.length && trs.every(t => t.limit.kind === 'fight')) {
        const cap = trs.reduce((sum, t) => sum + (t.limit.kind === 'fight' ? t.limit.n : 0), 0);
        const tk = `${r.id}|${s.key}`, n = (mem.triggers.get(tk) ?? 0) + 1;
        mem.triggers.set(tk, n);
        if (n > cap) return `${r.id}'s spent trigger ${s.key} fired ${n} times (limit ${cap})`;
      }
      if (trs.length && trs.every(t => t.limit.kind === 'round')) {
        const tk = `${r.id}|${s.key}|R${logRound}`, n = (mem.triggers.get(tk) ?? 0) + 1;
        mem.triggers.set(tk, n);
        if (n > trs.length) return `${r.id}'s round-limited trigger ${s.key} fired ${n} times in round ${logRound}`;
      }
    }
  }
  return null;
}

type Failure = { seed: number; at: number; problem: string; commands: Command[] };
/**
 * Plays one seed; answers its first failure with the commands up to it. The fight and the command are frozen deep, so a
 * reducer that writes to its input throws (modules are strict) and is reported.
 */
function runSeed(seed: number, tally: Map<string, number>): Failure | null {
  const g = rng(seed), mem = fresh(), commands: Command[] = [];
  let fight: Fight | null = null, n = 0;
  const next = (): string => `x${seed}-${n++}`;
  for (let i = 0; i < lengthOf(seed); i++) {
    const cmd = randomCommand(g, fight, next);
    commands.push(cmd);
    const before: Fight | null = deepFreeze<Fight | null>(fight);
    let out: { fight: Fight | null; effects: readonly Effect[] } | null = null;
    try { out = reduce(before, deepFreeze(cmd), ctx); } catch (err) { return { seed, at: i, problem: `threw ${String(err)}`, commands }; }
    const problem = check(before, cmd, out.fight, out.effects, mem);
    if (problem) return { seed, at: i, problem, commands };
    for (const e of out.effects) tally.set(e.type, (tally.get(e.type) ?? 0) + 1);
    for (const e of out.effects) if (e.type === 'rollSettle' && e.key.endsWith('-spread')) tally.set('spread', (tally.get('spread') ?? 0) + 1);
    // the kits' blocks, by the lines they log
    const fresh = out.fight && out.fight !== before ? out.fight.log.slice(0, 8) : [];
    for (const [k, re] of KIT_LINES) if (fresh.some(l => re.test(l.text))) tally.set(k, (tally.get(k) ?? 0) + 1);
    if (before?.phase !== out.fight?.phase) tally.set(`${before?.phase ?? 'none'}>${out.fight?.phase ?? 'none'}`, 1);
    fight = out.fight;
  }
  if (mem.parsedTriggers > 0) tally.set('triggerParsed', (tally.get('triggerParsed') ?? 0) + mem.parsedTriggers);
  return null;
}

/** Plays fixed commands with the same checks; answers the first problem and the last fight. */
export function replay(commands: readonly Command[]): { problem: string | null; fight: Fight | null; effects: Effect[] } {
  const mem = fresh(), all: Effect[] = [];
  let fight: Fight | null = null;
  for (const [i, cmd] of commands.entries()) {
    const out = reduce(fight, cmd, ctx);
    all.push(...out.effects);
    const problem = check(fight, cmd, out.fight, out.effects, mem);
    if (problem) return { problem: `command ${i + 1}: ${problem}`, fight: out.fight, effects: all };
    fight = out.fight;
  }
  return { problem: null, fight, effects: all };
}

/** The whole roster on the map, and a start where `first` rolls 20 and everyone else 1. */
const opening = (first: string): Command[] => [
  { type: 'add', fightId: fightId('f-replay'), rows: ROSTER, openings: [], grid: GRID },
  { type: 'start', openings: ROSTER.map(r => ({ id: r.id, d20: r.id === first ? 20 : 1, tie: 0 })) },
];
const rolls = (dice: Record<string, number[]>, react: Record<string, number>): Rolls => ({ dice: dice as Rolls['dice'], react: react as Rolls['react'] });
const cid = combatantId;

describe('what random play found', () => {
  // Seed 19: Mira's snare weakens the Ogre's Vitality, which lowers its max HP, and its HP stayed above the new max.
  test('a status that lowers a full monster\'s max HP leaves its bar full at the new max, not over it', () => {
    const r = replay([...opening('c-mira'), { type: 'act', by: cid('c-mira'), ability: abilityId('snare'), aim: cid('c-ogre'), rolls: rolls({ 'c-ogre': [4] }, { 'c-ogre': 2 }) }]);
    expect(r.problem).toBeNull();
    const ogre = r.fight!.rows.find(x => x.id === 'c-ogre')!, fresh = ROSTER.find(x => x.id === 'c-ogre')!;
    expect(ogre.statuses.map(x => x.key)).toContain('weakened');
    expect(rowHp(ogre)).toBe(ogre.sheet.hpMax);
    expect(rowHp(ogre)).toBeLessThan(rowHp(fresh));
  });

  // Seed 89: Sela began a channel aimed at a tile past the map's edge; the fight then could not be read back, so it could
  // not be stored or shared.
  test('a channel aimed past the edge of the map is refused, and the fight can still be stored', () => {
    const r = replay([...opening('c-sela'), { type: 'act', by: cid('c-sela'), ability: abilityId('charge'), aim: place(-1, 10), rolls: rolls({}, {}) }]);
    expect(r.problem).toBeNull();
    expect(r.effects.at(-1)).toEqual({ type: 'refused', reason: 'offGrid' });
  });

  // Seed 596: the GM made a wolf stun the hunter whose turn it was; the turn stayed with the stunned hunter.
  test('a hunter stunned by the GM on its own turn loses that turn, and its next one starts when the stun ends', () => {
    const r = replay([...opening('c-brakk'), { type: 'act', by: cid('c-w1'), ability: abilityId('howl'), aim: cid('c-brakk'), rolls: rolls({ 'c-brakk': [3] }, { 'c-brakk': 2 }), force: true }]);
    expect(r.problem).toBeNull();
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const started = r.effects.flatMap(e => e.type === 'turnStarted' ? [[e.id, e.now]] : []);
    expect(started[0]).toEqual([cid('c-brakk'), 0]);
    expect(started.at(-1)![1]).toBeGreaterThan(0);
  });
  // Seed 1269: a wolf killed Mira and the GM removed her; the wolf's kill kept her id, which the model read as no foe.
  test('a monster\'s kill of a hunter the GM then removes stays counted, and the fight plays on', () => {
    const mira = ROSTER.find(x => x.id === 'c-mira')!, hp = modified(mira.origin, [], RULES).sheet.hpMax;
    const r = replay([...opening('c-w2'), { type: 'adjust', id: cid('c-mira'), hp: 1 - hp },
      { type: 'act', by: cid('c-w2'), ability: abilityId('plague-bite'), aim: cid('c-mira'), rolls: rolls({ 'c-mira': [7] }, { 'c-mira': 15 }), force: true },
      { type: 'remove', id: cid('c-mira') }]);
    expect(r.problem).toBeNull();
    expect(tallyOf(r.fight!.rows.find(x => x.id === 'c-w2')!).kills.map(k => k.row)).toEqual([cid('c-mira')]);
  });

  // Seed 227 and seed 2032: an area blast over a dead hunter caught the corpse in `catchable` and let it dodge and move tiles.
  test('an area blast over a dead hunter leaves the dead hunter unmoved and unaffected', () => {
    const sela = ROSTER.find(x => x.id === 'c-sela')!, hp = modified(sela.origin, [], RULES).sheet.hpMax;
    const setup = replay([...opening('c-shade'), { type: 'adjust', id: cid('c-sela'), hp: -hp }]);
    expect(setup.problem).toBeNull();
    const deadSela = setup.fight!.rows.find(x => x.id === 'c-sela')!;
    const r = replay([
      ...opening('c-shade'),
      { type: 'adjust', id: cid('c-sela'), hp: -hp },
      { type: 'place', id: cid('c-shade'), to: place(deadSela.place.x, deadSela.place.y + 2) },
      { type: 'act', by: cid('c-shade'), ability: abilityId('blast'), aim: deadSela.place, rolls: rolls({}, {}) },
    ]);
    expect(r.problem).toBeNull();
    const afterSela = r.fight!.rows.find(x => x.id === 'c-sela')!;
    expect(afterSela.place).toEqual(deadSela.place);
    expect(r.effects.filter(e => 'id' in e && e.id === cid('c-sela') && (e.type === 'moved' || e.type === 'crit'))).toEqual([]);
  });
});

/**
 * What each kits block logs, so random play shows it reached each (kits design 3.2). An extraction is reached by design: the GM fells a
 * monster before an end and tries its corpse (tests/models/fight-play.ts), in 80 of the 2,500 seeds (Nov 22); by chance it was 1.
 */
const KIT_LINES: readonly (readonly [string, RegExp])[] = [
  ['trigger', /^R\d+: Then: /], ['extraction', /: The extraction of .+ fails|rises as a shadow|corpse is destroyed/], ['threshold', /Resonance goes off/], ['delayed end', /Hemoplague lands/], ['zone upkeep lapse or end', /Boundary ends/],
  ['summon', /calls Sprite/], ['summon leaves', /Sprite (leaves|fades)/], ['zone price', /uses shatter/], ['stack price', /uses violence/], ['hp price', /uses pact/],
];

describe('every trigger chain stops (kits design 1.3.7, 3.1)', () => {
  /** A pool of triggers that feed each other: a hit answered by a hit, a stack on a hit or a stack, a kill that refunds. */
  const POOL: readonly Trigger[] = [
    { on: 'struck', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'damage', type: 'physical', amount: { kind: 'number', value: 3 }, when: 'use' }] },
    { on: 'hitDealt', tag: null, to: 'self', limit: { kind: 'each' }, ops: [{ op: 'applyStatus', key: 'echo' as never, def: { label: 'Echo', desc: '', ops: [], stack: { cap: 20, leave: { kind: 'never' }, keep: 'fight', threshold: null } }, duration: null }] },
    { on: 'statusGained', key: 'echo' as never, to: { kind: 'area', radius: 3 as never, on: 'all' }, limit: { kind: 'each' }, ops: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 1 }, when: 'use' }] },
    { on: 'kill', tag: null, to: 'self', limit: { kind: 'round' }, ops: [{ op: 'refund', pct: 100 }] },
    { on: 'struck', tag: null, to: 'self', limit: { kind: 'fight', n: 3 }, ops: [{ op: 'applyStatus', key: 'echo' as never, def: { label: 'Echo', desc: '', ops: [], stack: { cap: 20, leave: { kind: 'never' }, keep: 'fight', threshold: null } }, duration: null, stacks: 2 }] },
  ];
  test('2,000 random tables of feeding triggers never fire past depth 2 or 16 times for one batch of events', () => {
    const roster = ROSTER.slice(0, 6), problems: string[] = [];
    for (let seed = 1; seed <= 2000 && problems.length < 3; seed++) {
      const g = rng(seed);
      const bodies = roster.map((r, i) => {
        const statuses = Array.from({ length: g.int(0, 4) }, (_, k) => ({ key: `t${k}`, def: { label: `T${k}`, desc: '', ops: [], triggers: Array.from({ length: g.int(1, 4) }, () => g.pick(POOL)) }, source: { id: null, tier: 1 }, until: null, since: 0, settledAt: 0 })) as never as Status[];
        const m = modified(r.origin, statuses, RULES);
        return { ...r, ...m, statuses, place: { x: i % 3, y: Math.floor(i / 3) }, at: 0, speed: m.sheet.speed, tie: 0 };
      }) as never as Parameters<typeof fire>[0];
      const events: Raised[] = Array.from({ length: g.int(1, 6) }, () => { const a = g.pick(bodies), b = g.pick(bodies); return raised(a.id, g.pick(['struck', 'hitDealt', 'kill'] as const), b.id); });
      const r = fire(bodies, events, 0 as never, RULES);
      if (r.fires > RULES.fight.kit.fires || r.deepest > RULES.fight.kit.depth) problems.push(`seed ${seed}: ${r.fires} fired, deepest ${r.deepest}`);
      for (const b of r.bodies) if (rowHp(b) < 0 || rowHp(b) > b.sheet.hpMax || b.statuses.some(s => stacked(s) && s.stacks > s.def.stack.cap)) problems.push(`seed ${seed}: ${b.id} out of bounds`);
    }
    expect(problems).toEqual([]);
  });
});

describe('the reworked fight under random play', () => {
  test('2,500 seeded fights keep every invariant after every command', () => {
    const failures: string[] = [], tally = new Map<string, number>();
    for (let seed = 1; seed <= SEEDS && failures.length < 3; seed++) {
      const r = runSeed(seed, tally);
      if (r) failures.push(`seed ${r.seed}, command ${r.at + 1}: ${r.problem}\n${r.commands.slice(-6).map(c => json(c).slice(0, 300)).join('\n')}`);
    }
    expect(failures).toEqual([]);
    // a mythic's phase change and omen (Nov 22: 98 and 38 in the 2,500 seeds; an answer met once and a landing a few times, too rare to count on)
    for (const seen of ['turnStarted', 'rollSettle', 'vitals', 'sendRemote', 'shadowHp', 'moved', 'channel', 'staggered', 'crit', 'defeated', 'ended', 'refused', 'phased', 'omen', 'dodgeAsked',
      'none>setup', 'setup>running', 'running>ended', 'ended>none', 'spread', 'triggerParsed', ...KIT_LINES.map(([k]) => k)]) {
      expect(tally.get(seen) ?? 0, `random play reaches ${seen}`).toBeGreaterThan(0);
    }
  // A compute budget, not a wait: the test asserts no time. Measured Nov 19 on the lead's 4-core box after its restart:
  // 107 s alone at a88b73b0 and at 59c13117, 111 s at 37e0d68f (so the day's code did not slow it), and past 120 s inside
  // the whole unit run, which refused a push of notes. A faster box runs it in about half that.
  // Inside the whole run with four workers (scripts/ci.ts), three runs on Nov 19: 103, 98 and 102 s. The budget is 300 s,
  // over twice the slowest.
  }, 300_000);
});

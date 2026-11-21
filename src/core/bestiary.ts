// bestiary.ts: the GM's own monsters (`save.monsters`) and the codex (`save.codex`, `save.codexSeen`): which monsters
// this campaign has beaten, how often and when, and the ones a player's phone learned from the room's codex doc; and
// that doc as the GM's phone publishes it (`codexDoc`). The bestiary view (bestiary.js) changes them only through these
// steps, with `store.apply`. Pure: the caller passes the time, the id a new monster gets, and the monster as
// `parseMonster` (registry/monsters.ts) gave it.
import { CODEX_DOC_ENTRIES, DOC_MAX } from './protocol.ts';
import type { CodexDoc, CodexDocEntry as DocEntry } from './protocol.ts';
import { CODEX_SEEN_MAX } from './save.ts';
import type { MonsterId } from './ids.ts';
import type { CombatantId } from './combat/ability-types.ts';
import type { CodexEntry, CodexInfo, Monster, Rank, Save } from './save.ts';
import { refuse } from './save-step.ts';
import type { Refused } from './save-step.ts';
import { compareTimes } from './day.ts';
import { oneOf } from './one-of.ts';
import { RANKS } from './rules.ts';
import type { Id } from './ids.ts';

/** The parts of the save the bestiary's steps read and write. */
export type BestiaryParts = Pick<Save, 'monsters' | 'codex' | 'codexSeen'>;

// ── the codex's keys and which entry is a monster's ──
/**
 * A codex entry's key: a monster kind, the same on every phone of a room (the GM's codex doc carries it), so it is made
 * from what every phone has: the kind's name and its rank (`goblin|E`). The one maker is `codexKey`.
 */
export type CodexKey = Id<'CodexKey'>;
/** The codex key of the monster kind named `name` (a monster's own name, a fight row's `Origin.name`) at `rank`; a rank that is not one is E. */
export const codexKey = (name: string, rank: string): CodexKey =>
  `${name.trim().toLowerCase().replace(/\s+/g, ' ')}|${oneOf(rank, RANKS, 'E')}` as CodexKey;
/**
 * The codex entry of bestiary monster `m`: the one that names it by id; else the one of its kind (`codexKey`), unless
 * that one names another monster still in the bestiary (`held`). A player's entry from the room names no monster of
 * this phone, so it is found by its kind.
 */
export function recordOf(codex: Readonly<Record<string, CodexEntry>>, m: Pick<Monster, 'id' | 'name' | 'rank'>, held: (id: string) => boolean): CodexEntry | null {
  const byId = Object.values(codex).find(r => r.monsterId === m.id);
  if (byId) return byId;
  const r = codex[codexKey(m.name, m.rank)];
  return r && !(r.monsterId && r.monsterId !== m.id && held(r.monsterId)) ? r : null;
}
/** The key of `m`'s codex entry: the entry that names it by id, else the key of its kind. */
export function recordKeyOf(codex: Readonly<Record<string, CodexEntry>>, m: Pick<Monster, 'id' | 'name' | 'rank'>): CodexKey {
  const byId = Object.keys(codex).find(k => codex[k]!.monsterId === m.id);
  return byId ? (byId as CodexKey) : codexKey(m.name, m.rank);
}
/** The monster a defeat of kind `key` counts for: the one its entry names, else the first of that kind; null when the bestiary has none. */
export function monsterOfKind<M extends Pick<Monster, 'id' | 'name' | 'rank'>>(codex: Readonly<Record<string, CodexEntry>>, monsters: readonly M[], key: CodexKey): M | null {
  const named = codex[key]?.monsterId;
  return (named ? monsters.find(m => m.id === named) : undefined) ?? monsters.find(m => codexKey(m.name, m.rank) === key) ?? null;
}
/**
 * What a player in a room sees of the bestiary: the monsters the codex records (`known`), how many it does not, and
 * the room's entries no monster of this phone stands for (each with its key, to show from the entry's own numbers).
 */
export function playerShelf<M extends Pick<Monster, 'id' | 'name' | 'rank'>>(codex: Readonly<Record<string, CodexEntry>>, monsters: readonly M[]): { known: M[]; unknown: number; roomOnly: [CodexKey, CodexEntry & { info: CodexInfo }][] } {
  const held = (id: string): boolean => monsters.some(m => m.id === id);
  const known = monsters.filter(m => recordOf(codex, m, held));
  const have = new Set<string>(known.map(m => codexKey(m.name, m.rank)));
  const roomOnly = Object.entries(codex).flatMap(([k, r]): [CodexKey, CodexEntry & { info: CodexInfo }][] => (r.room && r.info && !have.has(k) ? [[k as CodexKey, { ...r, info: r.info }]] : []));
  return { known, unknown: monsters.length - known.length, roomOnly };
}

/** A monster saved: it replaces the one with its id, else it is added. */
export function saveMonster<S extends BestiaryParts>(save: S, m: Monster): S {
  const at = save.monsters.findIndex(x => x.id === m.id);
  return { ...save, monsters: at >= 0 ? save.monsters.map((x, i) => (i === at ? m : x)) : [...save.monsters, m] };
}

/** Monster `id` taken out; a codex entry that named it keeps its kills and names no monster. */
export function removeMonster<S extends BestiaryParts>(save: S, id: string): S | Refused<'missing'> {
  if (!save.monsters.some(m => m.id === id)) return refuse('missing');
  const codex = Object.fromEntries(Object.entries(save.codex).map(([k, r]) => [k, r.monsterId === id ? { ...r, monsterId: null } : r]));
  return { ...save, monsters: save.monsters.filter(m => m.id !== id), codex };
}

/** One defeat: the fight's row id (each row counts once), the codex key and what the entry shows. */
export type Defeat = { bodyId: CombatantId; key: CodexKey; name: string; rank: Rank; monsterId: MonsterId; at: string };
/**
 * A defeat counted: the entry's kills go up by one, its last time is now, its first time stays unless it came from the
 * room (a player's copy of the GM's count), and the row is remembered (at most `CODEX_SEEN_MAX`) so it counts once.
 * `made`: a monster the bestiary lacked, made from the row, added in the same step (its id is the defeat's
 * `monsterId`), so the codex never names a monster the save does not hold. A row counted already is refused, and
 * nothing is added.
 */
export function recordDefeat<S extends BestiaryParts>(save: S, d: Defeat, made: Monster | null = null): S | Refused<'counted'> {
  if (save.codexSeen.includes(d.bodyId)) return refuse('counted');
  const old = save.codex[d.key], held = made ? saveMonster(save, made) : save;
  const rec: CodexEntry = { name: d.name, rank: d.rank, kills: (old ? old.kills : 0) + 1, firstAt: old && old.firstAt && !old.room ? old.firstAt : d.at, lastAt: d.at, monsterId: d.monsterId };
  return { ...held, codex: { ...save.codex, [d.key]: rec }, codexSeen: [...save.codexSeen, d.bodyId].slice(-CODEX_SEEN_MAX) };
}

/**
 * The room's codex doc as the GM's phone publishes it: this campaign's own entries (not those its phone read from the
 * room), the latest defeat first, each with the body `info` gives for it, as many as `DOCS.codex` reads and as fit in
 * `max` characters of JSON (the room's `DOC_MAX`, which the server and `putDoc` check). Null while the campaign has
 * beaten nothing of its own.
 */
export function codexDoc(codex: Readonly<Record<string, CodexEntry>>, info: (key: string, rec: CodexEntry) => CodexInfo, at: string, max: number = DOC_MAX): CodexDoc | null {
  const own = Object.entries(codex).filter(([, r]) => !r.room).sort(([, a], [, b]) => compareTimes(b.lastAt, a.lastAt));
  const entries: DocEntry[] = [];
  // `{"at":…,"entries":[e1,e2]}`: each entry adds its own JSON and, after the first, one comma
  let size = JSON.stringify({ at, entries: [] }).length;
  for (const [key, r] of own.slice(0, CODEX_DOC_ENTRIES)) {
    const e: DocEntry = { key, name: r.name, rank: r.rank, ...info(key, r), kills: r.kills, firstAt: r.firstAt };
    const grown = size + JSON.stringify(e).length + (entries.length ? 1 : 0);
    if (grown > max) break;
    entries.push(e); size = grown;
  }
  return entries.length ? { at, entries } : null;
}

/**
 * The room's codex doc laid over a player's phone's codex: an entry this phone lacks is added, and one it has from the
 * room (`room`) is replaced when the room's kills differ; this phone's own entries stay. Each laid entry is marked
 * `room`, names no monster of this phone and was last seen when the doc was written. Answers the codex and the entries
 * this phone did not have (`fresh`, for the unlock news); `save` is the same object when nothing changed.
 */
export function codexFromRoom<S extends BestiaryParts>(save: S, doc: CodexDoc): { save: S; fresh: CodexEntry[] } {
  const laid: Record<string, CodexEntry> = {}, fresh: CodexEntry[] = [];
  for (const e of doc.entries) {
    const o = save.codex[e.key];
    if (o && !(o.room && o.kills !== e.kills)) continue;
    const r: CodexEntry = { name: e.name, rank: e.rank, kills: e.kills, firstAt: e.firstAt, lastAt: doc.at || e.firstAt, monsterId: null, room: true,
      info: { hpMax: e.hpMax, armor: e.armor, resist: e.resist, speed: e.speed, abilities: e.abilities, ...(e.icon ? { icon: e.icon } : {}) } };
    laid[e.key] = r;
    if (!o) fresh.push(r);
  }
  return Object.keys(laid).length ? { save: { ...save, codex: { ...save.codex, ...laid } }, fresh } : { save, fresh };
}

/**
 * Monster `srcId` merged into `dstId`: the source's codex entry (`srcKey`) is added into the destination's (`dstKey`):
 * kills summed, the earliest first time, the latest last time, the destination's name and id; then the source monster
 * is taken out. With no source entry, the destination's entry (or none) is pointed at the destination.
 */
export function mergeMonsters<S extends BestiaryParts>(save: S, m: { srcId: MonsterId; srcKey: string | null; dst: { id: MonsterId; name: string; rank: Rank }; dstKey: string }): S {
  const codex = { ...save.codex }, s = m.srcKey ? codex[m.srcKey] : undefined, o = codex[m.dstKey];
  if (s && m.srcKey !== m.dstKey) {
    const o2 = o || { name: m.dst.name, rank: m.dst.rank, kills: 0, firstAt: s.firstAt, lastAt: s.lastAt, monsterId: null };
    codex[m.dstKey] = {
      ...o2, name: m.dst.name, kills: o2.kills + s.kills, firstAt: [o2.firstAt, s.firstAt].filter(Boolean).sort(compareTimes)[0] || s.firstAt,
      lastAt: [o2.lastAt, s.lastAt].filter(Boolean).sort(compareTimes).pop()!, monsterId: m.dst.id,
    };
    delete codex[m.srcKey!];
  } else if (o) codex[m.dstKey] = { ...o, monsterId: m.dst.id };
  else if (s && m.srcKey) codex[m.srcKey] = { ...s, monsterId: m.dst.id };
  return { ...save, codex, monsters: save.monsters.filter(x => x.id !== m.srcId) };
}

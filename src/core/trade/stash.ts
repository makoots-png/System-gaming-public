// stash.ts: the party stash, gold and items the table shares, kept on the GM's save (`Save.stash`) and published to the
// room as the `stash` doc. Pure. Design: notes-5-trade.md section 3; what was built: features/notes-5-trade-build.md.
//
// Who writes it: the GM's phone alone. A hunter of the GM's phone, or of a phone alone, puts and takes in one write
// (`stashPut`, `stashTake`: `stashRoute` is `here`). A player in a room asks the GM's phone (`stashAsked`): the ask is a
// letter in the outbox and a waiting ask in the save (sync/asked.ts, kind `stash`), a put's goods aside in that ask. The
// GM's phone answers each ask once, in the order the room's pages bring them (`stashTaken`: the stash changed, the answer
// posted and a log line, one write), so two takes of the last potion give it once. The player's phone lands the answer
// once, only while its ask waits (`stashLanded`). So every unit of goods is in one place: a bag, a put's ask, a message in
// the room, or the stash.
import { DOC_MAX, STASH_LINES, newEvent } from '../protocol.ts';
import type { EventBody, EventStamp, SheetKey, StashAnswerPayload, StashAskPayload, StashDoc, StashRefusal } from '../protocol.ts';
import { grantDefs, grantOf, parseHeldItem, resolveDef, resolveItem, withGrantDefs } from '../registry/item-book.ts';
import type { HeldItem, ItemDefData, ItemGrant } from '../registry/item-book.ts';
import { newEquipped } from '../hunter/hunter.ts';
import { takeItems } from '../hunter/inventory.ts';
import type { BagRules } from '../hunter/inventory.ts';
import { heardStep } from '../item-refs.ts';
import { isCustomItemDefId } from '../ids.ts';
import type { ItemDefId } from '../ids.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { parseSaveId, saveId, sheetKeyOf } from '../ids.ts';
import type { EventId, HunterId, ItemId, RoomCode } from '../ids.ts';
import { atOutbox, post } from '../sync/outbox.ts';
import { askAnswered, askDismissed, askPosted, askSent, askedOf, holdsGoods, shownOf } from '../sync/asked.ts';
import type { Asked } from '../sync/asked.ts';
import { told } from '../session-log.ts';
import type { Stamp } from '../session-log.ts';
import type { Seat } from '../role.ts';
import type { Save } from '../save.ts';
import { GOODS_GOLD_MAX, OFFER_REFUSAL_WORDS, goodsWords, noGoods, received, setAside } from './goods.ts';
import type { BagPick, Goods, Shortfall, StashAsk } from './goods.ts';

/** The party's stash: gold, and bag lines stacking as a bag's do. On the GM's save; `NO_STASH` in a new one. */
export type Stash = { readonly gold: number; readonly items: readonly HeldItem[] };
export const NO_STASH: Stash = { gold: 0, items: [] };
/** Where a stash change is written: on this phone (alone, or the GM's), or asked of the GM's phone (a player in a room). */
export const stashRoute = (seat: Seat): 'here' | 'room' => (seat === 'player' ? 'room' : 'here');
/** At most this many stash asks of one phone wait at once; one more is refused (`too-many`) until one is answered. */
export const STASH_WAITING = 10;

/** The custom defs the stash's references read under `R`, by id: what a phone without the GM's library needs to read them. */
function stashDefs(st: Stash, R: BagRules): Record<ItemDefId, ItemDefData> {
  const out: Record<ItemDefId, ItemDefData> = {};
  for (const i of st.items) if (i.kind === 'ref' && isCustomItemDefId(i.defId) && !Object.hasOwn(out, i.defId)) { const d = resolveDef(i.defId, R); if (d) out[i.defId] = d; }
  return out;
}
/** The doc players read: the stash's lines with their ids (a take names it), and the custom defs they read (`stashDefs`). */
export const stashDoc = (st: Stash, R: BagRules): StashDoc => ({ gold: st.gold, items: st.items.map(i => ({ ...i })), defs: stashDefs(st, R) });
/** Whether the stash can be published whole: at most `STASH_LINES` lines, gold within the goods' bound, its doc within `DOC_MAX`. */
export const stashFits = (st: Stash, R: BagRules): boolean =>
  st.items.length <= STASH_LINES && st.gold <= GOODS_GOLD_MAX && JSON.stringify(stashDoc(st, R)).length <= DOC_MAX;

// ── the stash's own moves ──
/**
 * The stash as a bag nothing is worn from, so a put stacks and a take splits exactly as a hunter's bag does (inventory.ts
 * `putItem`, `takeItems`). It wears nothing, so no wear's `TABLE` is asked: its slots are all empty and stay so.
 */
const bagOf = (st: Stash) => { const equipped = newEquipped(); return { gold: st.gold, items: [...st.items], equipped }; };
const stashOf = (b: { readonly gold: number; readonly items: readonly HeldItem[] }): Stash => ({ gold: b.gold, items: b.items });
/**
 * Goods into the stash, each line under a new id from `ids` (or joining its stack); refused `full` when the stash would
 * no longer fit. The defs the goods carry count toward its doc: `R` reads them as `heardStep` will keep them.
 */
function keptIn(st: Stash, goods: Goods, ids: () => ItemId, R: BagRules): Stash | Refused<'full'> {
  const Rg = withDefs(R, grantDefs(goods.items.map(l => l.item)));
  const next = stashOf(received(bagOf(st), goods, ids, Rg));
  return stashFits(next, Rg) ? next : refuse('full');
}
/** `R` with `defs` under its own item defs, for reading goods whose defs are not yet heard. */
const withDefs = (R: BagRules, defs: Readonly<Record<ItemDefId, ItemDefData>>): BagRules =>
  (Object.keys(defs).length ? { ...R, items: { ...defs, ...R.items } } : R);
/** The save with the defs `goods` carry heard (item-refs.ts `heardStep`), after the goods have landed in it. */
const heardGoods = (save: Save, goods: Goods, fillOnly = false): Save =>
  heardStep(save, grantDefs(goods.items.map(l => l.item)), { fillOnly });
/** What a take or a gold ask moves out of the stash, and the stash without it; refused `gone` (no such line) or `short`, with what the stash holds. */
type Given = { readonly stash: Stash; readonly goods: Goods };
type Short = Refused<'gone' | 'short'> & { readonly have: number };
function givenOut(st: Stash, ask: Exclude<StashAsk, { kind: 'put' }>, R: BagRules): Given | Short {
  if (ask.kind === 'gold') return st.gold < ask.gold ? { ...refuse('short'), have: st.gold } : { stash: { ...st, gold: st.gold - ask.gold }, goods: { gold: ask.gold, items: [] } };
  const line = st.items.find(i => i.id === ask.item);
  if (!line) return { ...refuse('gone'), have: 0 };
  if (line.qty < ask.qty) return { ...refuse('short'), have: line.qty };
  const out = takeItems(bagOf(st), line.id, ask.qty);
  if (isRefused(out)) return { ...refuse('gone'), have: 0 };
  return { stash: stashOf(out), goods: { gold: 0, items: [{ from: line.id, item: grantOf(line, ask.qty, R) }] } };
}
/** A counter over the save's `seq` for new ids (`saveId`), and the seq it reached. */
function idsOn(save: Save): { readonly next: () => ItemId; readonly seq: () => number } {
  let seq = save.seq;
  return { next: () => saveId('i', ++seq), seq: () => seq };
}
/** The save with `goods` given to its hunter `hid` (none to a hunter no longer there), each new item id from the save's seq. */
function givenTo(save: Save, hid: HunterId, goods: Goods, R: BagRules, fillOnly = false): Save {
  if (noGoods(goods) || !save.hunters.some(h => h.id === hid)) return save;
  const Rg = withDefs(R, grantDefs(goods.items.map(l => l.item)));
  const ids = idsOn(save), hunters = save.hunters.map(h => (h.id === hid ? received(h, goods, ids.next, Rg) : h));
  return heardGoods({ ...save, seq: ids.seq(), hunters }, goods, fillOnly);
}

// ── the words (notes-5-trade.md section 7) ──
/** Why a stash tap was refused on this phone: the offer's reasons that apply, the stash's own, or too many asks waiting. */
export const STASH_TAP_WHYS = ['off', 'fight', 'no-item', 'worn', 'few', 'poor', 'empty', 'too-large', 'too-many', 'no-room', 'not-played', 'no-hunter', 'gone', 'short', 'full'] as const;
export type StashTapWhy = (typeof STASH_TAP_WHYS)[number];
export type StashTapRefused = Refused<StashTapWhy> & { readonly short?: Shortfall; readonly have?: number };
const NO_SHORT: Shortfall = { name: '', have: 0, need: 0 };
const lineWords = (name: string, n: number): string => (n === 1 ? `1 ${name}` : `${name} × ${n}`);
/** What a refused answer says, for the thing asked (`name`, or gold) and what the stash held (`have`). */
export const STASH_REFUSAL_WORDS: { readonly [W in StashRefusal]: (name: string, have: number) => string } = {
  gone: name => `The stash has no ${name} left.`,
  short: (name, have) => (name === 'gold' ? `The stash has ${have} gold, less than you asked for.` : `The stash has ${lineWords(name, have)}, fewer than you asked for.`),
  full: () => 'The stash is full. Take something out of it first.',
  off: () => OFFER_REFUSAL_WORDS.off(NO_SHORT),
};
/** The words of a refused tap. */
export function stashTapWords(r: StashTapRefused, name: string): string {
  switch (r.why) {
    case 'gone': case 'short': case 'full': return STASH_REFUSAL_WORDS[r.why](name, r.have ?? 0);
    case 'too-many': return `You have ${STASH_WAITING} stash requests pending. Wait for one to finish first.`;
    case 'too-large': return 'Too many items to send at once. Put in fewer.';
    case 'no-room': return 'The party stash requires a room. Join a room with the room button at the top.';
    case 'not-played': return 'Only the hunter you play in this room can use the party stash.';
    case 'empty': return 'Select at least one item or some gold to put in.';
    default: return OFFER_REFUSAL_WORDS[r.why](r.short ?? NO_SHORT);
  }
}
/** What an ask asks, in words: "2 Healing Potions" style, by the goods' or the line's name. */
const askWords = (ask: StashAsk): string =>
  ask.kind === 'put' ? goodsWords(ask.goods) : ask.kind === 'gold' ? `${ask.gold} gold` : lineWords(ask.name, ask.qty);
/** The name an answer's words use for what was asked: the line's name, or gold. */
const askName = (ask: StashAsk): string => (ask.kind === 'take' ? ask.name : ask.kind === 'gold' ? 'gold' : goodsWords(ask.goods));
const STASH_REFUSAL_REASON: { readonly [W in StashRefusal]: string } = { gone: 'out of stock', short: 'not enough left', full: 'stash full', off: 'trading off' };
export const STASH_WORDS = {
  title: 'Party stash', chip: 'Party stash', put: 'Put in the stash', hint: 'Anyone in the room can take it out.',
  gold: (n: number): string => `Gold: ${n}`, takeTitle: (name: string): string => `Take ${name}`,
  howMany: (n: number): string => `How many? The stash has ${n}.`, howMuch: (n: number): string => `How much? The stash has ${n} gold.`, empty: 'The stash is empty.', take: 'Take', takeGold: 'Take gold', remove: 'Remove', undo: 'Undo',
  asOf: (time: string): string => `Updated ${time}.`, order: 'Stash requests are processed in the order they arrive.',
  waiting: 'Pending requests', waitingLine: 'Waiting for the GM\'s device to process this.',
  stranded: 'The room server did not confirm this request, so it may already be in the stash. Check the stash first.',
  refused: 'This request did not reach the room server.', takeBack: 'Take back', putAway: 'Dismiss',
  askLine: (w: Asked): string => (w.kind === 'stash' ? (w.ask.kind === 'put' ? `Put in: ${askWords(w.ask)}.` : `Take: ${askWords(w.ask)}.`) : ''),
  kept: (goods: Goods): string => `In the stash: ${goodsWords(goods)}.`,
  given: (goods: Goods): string => `From the stash: ${goodsWords(goods)}.`,
  back: (goods: Goods): string => ` Back in your bag: ${goodsWords(goods)}.`,
  putLog: (who: string, goods: Goods): string => `${who} put ${goodsWords(goods)} in the stash.`,
  takeLog: (who: string, goods: Goods): string => `${who} took ${goodsWords(goods)} from the stash.`,
  refusedLog: (who: string, ask: StashAsk, why: StashRefusal): string => `${who} could not ${ask.kind === 'put' ? `put ${askWords(ask)} in` : `take ${askWords(ask)} from`} the stash (${STASH_REFUSAL_REASON[why]}).`,
  removed: (it: { readonly name: string; readonly qty: number }): string => `You removed ${lineWords(it.name, it.qty)} from the stash.`,
  removedGone: 'This item is no longer in the stash.',
  summary: (lines: number): string => (lines ? `Stash: ${lines} item${lines === 1 ? '' : 's'}` : ''),
} as const;

// ── here: one write on this phone ──
/** What the caller knows that the save does not: the trading switch as this phone reads it, and whether a fight holds the hunter. */
export type StashGate = { readonly on: boolean; readonly held: boolean };
const logged = (save: Save, at: Stamp, text: string): Save => told(save, at, { kind: 'trade', hunterId: null, title: 'Party stash', text });
/**
 * Hunter `hid` of this phone puts what `pick` takes into the stash: `setAside` on the hunter, the goods kept in the
 * stash, a log line, one write. Refused with trading off (`off`), while a fight holds it (`fight`), for goods `setAside`
 * refuses, and when the stash would no longer fit (`full`).
 */
export function stashPut(save: Save, hid: HunterId, pick: BagPick, gate: StashGate, at: Stamp, R: BagRules): Save | StashTapRefused {
  const h = save.hunters.find(x => x.id === hid);
  if (!h) return refuse('no-hunter');
  if (!gate.on) return refuse('off');
  if (gate.held) return refuse('fight');
  const aside = setAside(h, pick, R);
  if ('ok' in aside) return aside;
  const ids = idsOn(save), stash = keptIn(save.stash, aside.goods, ids.next, R);
  if (isRefused(stash)) return stash;
  return logged(heardGoods({ ...save, seq: ids.seq(), stash, hunters: save.hunters.map(x => (x.id === hid ? aside.hunter : x)) }, aside.goods), at, STASH_WORDS.putLog(h.name, aside.goods));
}
/** Hunter `hid` of this phone takes what `ask` names from the stash: the goods given, a log line, one write. Refused `off`, `fight`, `gone` or `short`. */
export function stashTake(save: Save, hid: HunterId, ask: Exclude<StashAsk, { kind: 'put' }>, gate: StashGate, at: Stamp, R: BagRules): Save | StashTapRefused {
  const h = save.hunters.find(x => x.id === hid);
  if (!h) return refuse('no-hunter');
  if (!gate.on) return refuse('off');
  if (gate.held) return refuse('fight');
  const out = givenOut(save.stash, ask, R);
  if ('ok' in out) return out;
  return logged(heardStep(givenTo({ ...save, stash: out.stash }, hid, out.goods, R)), at, STASH_WORDS.takeLog(h.name, out.goods));
}
/** The GM's hand edit: line `item` out of the stash whole, logged. Refused `gone` when the stash holds no such line. */
export function stashRemove(save: Save, item: ItemId, at: Stamp, R: BagRules): Save | Refused<'gone'> {
  const it = save.stash.items.find(i => i.id === item);
  if (!it) return refuse('gone');
  return logged(heardStep({ ...save, stash: { ...save.stash, items: save.stash.items.filter(i => i !== it) } }), at, STASH_WORDS.removed(resolveItem(it, R)));
}
/** Grants as goods with throwaway bag ids, each custom item with its def under `R` (item-book.ts `withGrantDefs`). */
const goodsOf = (items: readonly ItemGrant[], R: BagRules): Goods =>
  ({ gold: 0, items: withGrantDefs(items, R).map((item, i) => ({ from: saveId('i', i + 1), item })) });
/** Whether `items` fit into `st` without exceeding `STASH_LINES` or `DOC_MAX` under ids minted from `seq`. */
export function stashCanHold(st: Stash, seq: number, items: readonly ItemGrant[], R: BagRules): boolean {
  if (!items.length) return true;
  let n = seq;
  return !isRefused(keptIn(st, goodsOf(items, R), () => saveId('i', ++n), R));
}
/**
 * Deposits `items` directly into the party stash (such as unpicked items from a gate's clear preset), stacking as a
 * bag does under fresh ids from `save.seq`, logged with `reason`. Refused `full` when the stash would no longer fit.
 */
export function stashDeposit(save: Save, items: readonly ItemGrant[], at: Stamp, reason: string, R: BagRules): Save | Refused<'full'> {
  if (!items.length) return save;
  const goods = goodsOf(items, R);
  const ids = idsOn(save), stash = keptIn(save.stash, goods, ids.next, R);
  if (isRefused(stash)) return stash;
  return logged(heardGoods({ ...save, seq: ids.seq(), stash }, goods), at, `${reason}: ${goodsWords(goods)}.`);
}

// ── room: a player's ask, the GM's phone's answer, its landing ──
/** What a player picks to ask of the stash: goods from its bag to put in, `qty` of a line, or gold. */
export type StashPick = { readonly kind: 'put'; readonly pick: BagPick } | Exclude<StashAsk, { kind: 'put' }>;
/**
 * Hunter `hid`, the one this phone plays in its room, asks the GM's phone: a put's goods set aside in the ask, the
 * `stashAsk` letter in the box and the ask waiting (sync/asked.ts), one write. Refused out of a room (`no-room`), for a
 * hunter this phone does not play there (`not-played`), with trading off, while a fight holds it, past `STASH_WAITING`
 * asks (`too-many`), for goods `setAside` refuses, or past the message's size (`too-large`).
 */
export function stashAsked(save: Save, a: { readonly hid: HunterId; readonly want: StashPick; readonly at: string; readonly stamp: EventStamp; readonly R: BagRules } & StashGate): Save | StashTapRefused {
  const room = save.settings.sync.room, h = save.hunters.find(x => x.id === a.hid);
  if (!room) return refuse('no-room');
  if (!h) return refuse('no-hunter');
  if (save.settings.sync.boundHunterId !== a.hid) return refuse('not-played');
  if (!a.on) return refuse('off');
  if (a.held) return refuse('fight');
  if (askedOf(save).filter(w => w.kind === 'stash').length >= STASH_WAITING) return refuse('too-many');
  let s = save, ask: StashAsk;
  if (a.want.kind === 'put') {
    const aside = setAside(h, a.want.pick, a.R);
    if ('ok' in aside) return aside;
    s = { ...s, hunters: s.hunters.map(x => (x.id === a.hid ? aside.hunter : x)) };
    ask = { kind: 'put', goods: aside.goods };
  } else ask = a.want;
  const ev = newEvent('stashAsk', { by: sheetKeyOf(save.settings.deviceId, a.hid), name: h.name, ask }, a.stamp);
  if (!ev || ev.type !== 'stashAsk') return refuse('too-large');
  s = atOutbox(box => post(box, room, { kind: 'event', event: ev }).box)(s);
  return askPosted(s, { id: ev.payload.eid, room, hid: a.hid, at: a.at, state: 'posted', sent: false, kind: 'stash', ask: ev.payload.ask });
}

/** What the GM's phone needs beside the save to answer: the switch as its rules hold it, the room, the answer's stamp, the log's. */
export type AnswerCtx = { readonly on: boolean; readonly room: RoomCode; readonly stamp: EventStamp; readonly log: Stamp; readonly R: BagRules };
/** The GM's answer to `p` on stash `st`: the stash after it, the answer's body, and the log's line. */
function answerOf(st: Stash, seq: number, p: StashAskPayload, on: boolean, R: BagRules): { readonly stash: Stash; readonly seq: number; readonly body: EventBody<'stashAnswer'>; readonly line: string } {
  const ask = p.ask, who = p.name || 'A hunter', base = { to: [p.by] as [SheetKey], ask: p.eid };
  const refused = (why: StashRefusal, have: number) => ({ stash: st, seq, body: { ...base, verdict: 'refused' as const, why, have }, line: STASH_WORDS.refusedLog(who, ask, why) });
  if (!on) return refused('off', 0);
  if (ask.kind === 'put') {
    let n = seq;
    const stash = keptIn(st, ask.goods, () => saveId('i', ++n), R);
    return isRefused(stash) ? refused('full', st.items.length) : { stash, seq: n, body: { ...base, verdict: 'kept' as const }, line: STASH_WORDS.putLog(who, ask.goods) };
  }
  const out = givenOut(st, ask, R);
  return 'ok' in out ? refused(out.why, out.have) : { stash: out.stash, seq, body: { ...base, verdict: 'given' as const, goods: out.goods }, line: STASH_WORDS.takeLog(who, out.goods) };
}
/**
 * The GM's phone takes a player's stash ask, in one write: the stash changed, the `stashAnswer` letter in the box to the
 * asking hunter, and a log line. A put is kept, or refused `off` or `full` (its goods go back on the player's phone); a
 * take or gold ask is given, or refused `off`, `gone` (no such line) or `short` (fewer than asked: the answer never gives
 * less than asked without saying so). Taken once per ask by the caller (`sync.once`), in the order the room's pages bring them.
 */
export function stashTaken(save: Save, p: StashAskPayload, c: AnswerCtx): Save | Refused<'too-large'> {
  const a = answerOf(save.stash, save.seq, p, c.on, c.R), ev = newEvent('stashAnswer', a.body, c.stamp);
  if (!ev) return refuse('too-large');
  const kept = p.ask.kind === 'put' && a.body.verdict === 'kept' ? heardGoods({ ...save, seq: a.seq, stash: a.stash }, p.ask.goods) : heardStep({ ...save, seq: a.seq, stash: a.stash });
  return logged(atOutbox(box => post(box, c.room, { kind: 'event', event: ev }).box)(kept), c.log, a.line);
}

/** What a landed answer did, for its toast. */
export type StashLanded = { readonly save: Save; readonly text: string };
/**
 * The GM's phone's answer to this phone's stash ask, landed in one write with the event's id (room-events.ts): the ask
 * leaves the list; kept, a put's goods are the stash's now; given, the goods go to the hunter; refused, a put's goods
 * come back and a take moves nothing. Refused (`no-ask`) when no ask of that id waits, so a second answer or a replay
 * lands nothing.
 */
export function stashLanded(save: Save, p: StashAnswerPayload, R: BagRules, held = false): StashLanded | Refused<'no-ask'> {
  const w = askedOf(save).find(x => x.id === p.ask);
  const closed = askAnswered(save, p.ask);
  if (isRefused(closed) || !w || w.kind !== 'stash') return refuse('no-ask');
  switch (p.verdict) {
    case 'kept': return { save: heardStep(closed), text: STASH_WORDS.kept(w.ask.kind === 'put' ? w.ask.goods : { gold: 0, items: [] }) };
    case 'given': return { save: givenTo(closed, w.hid, p.goods, R, held), text: STASH_WORDS.given(p.goods) };
    case 'refused': {
      const why = STASH_REFUSAL_WORDS[p.why](askName(w.ask), p.have);
      return w.ask.kind === 'put' ? { save: givenTo(closed, w.hid, w.ask.goods, R, held), text: why + STASH_WORDS.back(w.ask.goods) } : { save: closed, text: why };
    }
  }
}

// ── what the box hears, and the player's put away ──
/**
 * The step the store runs after every step (store.ts `apply`, after offer.ts `lettersKept`): each ask follows its letter
 * in the box. A letter on its way was sent (`askSent`): the write that put it on its way is this one, and from then on
 * the room may hold the ask. A put whose letter never went out and is no longer queued or on its way was let go, so the
 * room never had it: whichever writer let it go (a full outbox, the room gone), its goods come back and it leaves the
 * list in that same write. A put sent and then lost stays, stranded (`stranded`). A second run changes nothing.
 */
export function asksKept(save: Save, R: BagRules): Save {
  const box = save.settings.sync.outbox ?? [];
  let s = save;
  for (const w of askedOf(save)) {
    const at = box.find(e => e.id === w.id)?.at;
    if (at === 'sending') s = askSent(s, w.id);
    else if (holdsGoods(w) && !w.sent && at !== 'queued') { const back = stashDismissed(s, w.id, R); if (!isRefused(back)) s = back; }
  }
  return s;
}
/**
 * Whether stash ask `w` is a stranded put: sent once and lost (let go, refused, or its room gone), so the room may hold it
 * and Take back asks first. A put lost before it was sent is never stranded: `asksKept` gave its goods back already.
 */
export const stranded = (w: Asked, box: Parameters<typeof shownOf>[1]): boolean => holdsGoods(w) && w.sent && shownOf(w, box).state === 'lost';
/** Lost stash ask `id` put away: a put's goods come back (`asksKept`, or Take back after `stranded`'s window), a take is let go. Refused (`no-ask`) where it does not apply. */
export function stashDismissed(save: Save, id: EventId, R: BagRules): Save | Refused<'no-ask'> {
  const w = askedOf(save).find(x => x.id === id);
  const out = askDismissed(save, id);
  if (isRefused(out) || !w || w.kind !== 'stash') return isRefused(out) ? out : refuse('no-ask');
  return w.ask.kind === 'put' ? givenTo(out, w.hid, w.ask.goods, R) : out;
}

// ── the save's reader ──
/** The stored stash: gold from 0 to the goods' bound, each line read by `parseHeldItem`, one per id, at most `STASH_LINES`. */
export function parseStash(v: unknown): Stash {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return NO_STASH;
  const o = v as Record<string, unknown>, gold = typeof o.gold === 'number' && Number.isFinite(o.gold) ? Math.max(0, Math.min(GOODS_GOLD_MAX, Math.trunc(o.gold))) : 0;
  const items: HeldItem[] = [];
  for (const raw of Array.isArray(o.items) ? o.items : []) {
    const it = parseHeldItem(raw);
    if (it && !items.some(x => x.id === it.id) && items.length < STASH_LINES) items.push(it);
  }
  return { gold, items };
}

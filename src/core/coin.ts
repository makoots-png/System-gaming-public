// coin.ts: the coin call (docs/agent-handoff/later-phases/coin-notes.md). On a natural 1 or 20 of a check outside a fight
// the player calls heads or tails. In a room the GM's phone picks the side the coin lands on and keeps it: the player's
// phone hears only that the GM ruled, and the GM says the outcome at the table (the owner, Nov 21, for-the-owner.md Open 5).
// Alone, a true flip lands it. This file holds the rule for when a roll calls the coin, the one table of a coin's life,
// the side the GM's phone keeps and the message it sends, what a landing means, the GM's window for the calls (`CoinPrompt`, its own table), and the parsers of a stored coin. Pure:
// the die and the flip are rolled in src/edge/roll.ts.
// src/views/coin.js changes a coin only through `transition` (or `stepCoin`, which calls it), in the save steps at the
// end of the list section (`coinRolled`, `coinCalled`, `coinRuled`, `callTaken`, `callRuled`) given to `store.apply`.
import { oneOf } from './one-of.ts';
import { refuse } from './save-step.ts';
import type { Seat } from './role.ts';
import type { Refused } from './save-step.ts';
import { told } from './session-log.ts';
import type { Stamp } from './session-log.ts';
import type { Save } from './save.ts';
import { parseHunterRef } from './ids.ts';
import type { HunterRef, Id } from './ids.ts';
import type { RollKind } from './roll.ts';
import { record } from './hunter/chronicle.ts';

// ── the words of the game ──
export const SIDES = ['heads', 'tails'] as const;
export type CoinSide = (typeof SIDES)[number];
/** The two naturals that call the coin. */
export const FACES = [1, 20] as const;
export type CoinNatural = (typeof FACES)[number];
/** What the GM taps: the call was right, it was wrong, or a true flip decides. Only the GM's phone ever holds one. */
export const RULINGS = ['right', 'wrong', 'coin'] as const;
export type Ruling = (typeof RULINGS)[number];

/** A roll that called the coin, unique in a room: the rolling phone's device id and its roll log id. Made only by `rollId`. */
export type RollId = Id<'RollId'>;
const ROLL_ID_RE = /^[\w.:-]{1,80}$/;
/** The roll id in `v`, or null when it is not one (not a string, empty, too long, or a character outside letters, digits and `_.:-`). */
export const rollId = (v: unknown): RollId | null => (typeof v === 'string' && ROLL_ID_RE.test(v) ? (v as RollId) : null);
/** The id of a roll this phone made: its device id and the roll's id in its roll log. */
export const newRollId = (device: string, roll: string): RollId | null => rollId(`${device}:${roll}`);

// ── when a roll calls the coin ──
/** What the coin's rule reads of a roll. `kind`: what the roll was for (src/core/roll.ts). */
export type RollFacts = {
  kind: RollKind;
  /** The expression as rolled, such as `1d20+3`. */
  expr: string;
  /** The d20 kept, when the roll had a single d20; else null. */
  natural: number | null;
  /** The hunter has a row in a running fight. */
  inFight: boolean;
};
/** One d20 and flat numbers, nothing else: `d20`, `1d20+3`, `1d20-1+2`. */
const PLAIN_D20 = /^1?d20([+-]\d+)*$/i;
/**
 * The one rule: a roll calls the coin when its d20 shows a natural 1 or 20, it is a check (a stat check, or a Dice view
 * roll of one d20 and flat numbers), and the hunter is not in a running fight. A death save, an extraction and the
 * fight's d20 are true rolls.
 */
export function isCoinRoll(r: RollFacts): r is RollFacts & { natural: CoinNatural } {
  if (r.inFight || (r.natural !== 1 && r.natural !== 20)) return false;
  return r.kind === 'check' || (r.kind === 'die' && PLAIN_D20.test(r.expr.replace(/\s+/g, '')));
}
/** Who picks the side: a player's phone in a room waits for the GM; a phone alone, or the GM's own, flips. */
export const decider = (seat: Seat): 'gm' | 'flip' => (seat === 'player' ? 'gm' : 'flip');

// ── the coin ──
export const COIN_STATES = ['uncalled', 'called', 'ruled', 'landed'] as const;
export type CoinState = (typeof COIN_STATES)[number];
/**
 * What every coin has: the roll's id, the hunter who rolled (one of this phone's on a player's coin, the caller's sheet key
 * on a call the GM holds), the hunter's name, what the roll was for and the natural it showed.
 */
export type CoinFields = { id: RollId; hunter: HunterRef; who: string; what: string; face: CoinNatural };
/**
 * A coin. `uncalled`: the die showed its natural and the player has not picked. `called`: the player picked `call` and
 * the coin is in the air. `ruled`: a player's coin in a room that the GM has ruled; the side stays on the GM's phone, so
 * this coin holds none. `landed`: it shows `side` (a coin flipped alone or on the GM's own phone, and the GM's held
 * calls). Nothing in a coin says how its side was chosen.
 */
export type Coin =
  | (CoinFields & { at: 'uncalled' })
  | (CoinFields & { at: 'called'; call: CoinSide })
  | (CoinFields & { at: 'ruled'; call: CoinSide })
  | (CoinFields & { at: 'landed'; call: CoinSide; side: CoinSide });

/** What can happen to a coin: the player calls a side, the GM's ruling arrives with no side, or it lands on a side. */
export type CoinEvent = { type: 'call'; side: CoinSide } | { type: 'ruled' } | { type: 'land'; side: CoinSide };
export type CoinEventType = CoinEvent['type'];

// ── the table ──
type Step<T extends CoinEventType> = (coin: Coin, event: Extract<CoinEvent, { type: T }>) => Coin;
/** For one state: what each event does there. `null`: it does not apply, and the coin stays as it is. */
type Row = { readonly [T in CoinEventType]: Step<T> | null };

const fieldsOf = (c: Coin): CoinFields => ({ id: c.id, hunter: c.hunter, who: c.who, what: c.what, face: c.face });
const calls: Step<'call'> = (c, e) => ({ ...fieldsOf(c), at: 'called', call: e.side });
/** Only a called coin lands or is ruled, so the call is there to keep. */
const lands: Step<'land'> = (c, e) => (c.at === 'called' ? { ...fieldsOf(c), at: 'landed', call: c.call, side: e.side } : c);
const rules: Step<'ruled'> = c => (c.at === 'called' ? { ...fieldsOf(c), at: 'ruled', call: c.call } : c);

/**
 * A second call is refused: the side a player picked is the one the GM was told. A landing or a ruling before the call
 * cannot come (the GM's phone answers a call), and a second one is refused: the first answer stands, whatever arrives after it.
 */
const TABLE: { readonly [S in CoinState]: Row } = {
  uncalled: { call: calls, ruled: null, land: null },
  called: { call: null, ruled: rules, land: lands },
  ruled: { call: null, ruled: null, land: null },
  landed: { call: null, ruled: null, land: null },
};

/** The coin after `event`. The same coin when the event does not apply in its state. Never changes its input. */
export function transition(coin: Coin, event: CoinEvent): Coin {
  // The table's type pairs each key with the step for that event, so the step for `event.type` takes `event`.
  const step = TABLE[coin.at][event.type] as Step<CoinEventType> | null;
  return step ? step(coin, event as never) : coin;
}
/** Whether `type` applies to a coin in this state. */
export const can = (coin: { at: CoinState }, type: CoinEventType): boolean => TABLE[coin.at][type] !== null;

// ── the GM's answer and what it means ──
export const otherSide = (s: CoinSide): CoinSide => (s === 'heads' ? 'tails' : 'heads');
/** The side a true flip shows for a number in [0, 1) (src/edge/roll.ts `flip` passes its random number). */
export const sideOf = (r: number): CoinSide => (r < 0.5 ? 'heads' : 'tails');
/**
 * The side the GM's phone keeps for a call: the called side when the GM rules Right, the other when Wrong, the flip's side
 * when the coin decides. It never leaves the GM's phone (`landingOf`).
 */
export function landing(call: CoinSide, ruling: Ruling, flip: CoinSide): CoinSide {
  switch (ruling) {
    case 'right': return call;
    case 'wrong': return otherSide(call);
    case 'coin': return flip;
  }
}
/**
 * What the GM's phone sends once it has ruled a call: the roll, and nothing else (the `coinLand` room message without its
 * id). No side and no ruling, so the player's phone cannot show where the coin landed or whether the call was right.
 */
export type LandingBody = { roll: RollId };
/** The message the GM's phone sends for a call it has ruled, whatever the ruling and the side. */
export const landingOf = (coin: CoinFields): LandingBody => ({ roll: coin.id });
export const VERDICTS =['critSuccess', 'success', 'saved', 'critFailure'] as const;
export type Verdict = (typeof VERDICTS)[number];
/** The words the app shows for a landing. The GM narrates the rest; no number changes by it. */
export const VERDICT_WORDS: { readonly [V in Verdict]: string } = {
  critSuccess: 'Critical success', success: 'Success', saved: 'Saved', critFailure: 'Critical failure',
};
/** On a 20 a right call is a critical success and a wrong one a success; on a 1 a right call is saved and a wrong one a critical failure. */
export function verdict(face: CoinNatural, called: CoinSide, landed: CoinSide): Verdict {
  const right = called === landed;
  return face === 20 ? (right ? 'critSuccess' : 'success') : right ? 'saved' : 'critFailure';
}

/** A side as the app writes it. */
export const SIDE_WORDS: { readonly [S in CoinSide]: string } = { heads: 'Heads', tails: 'Tails' };
/**
 * What a phone shows for a coin: the question before the call, "In the air" until it lands, "Flipped" once the GM ruled
 * (the GM says the rest at the table), then what a landing means.
 */
export function coinWords(c: Coin): string {
  switch (c.at) {
    case 'uncalled': return 'Heads or tails?';
    case 'called': return 'In the air';
    case 'ruled': return 'Flipped';
    case 'landed': return VERDICT_WORDS[verdict(c.face, c.call, c.side)];
  }
}

// ── a phone's list of coins ──
/** Coins a phone keeps: each list keeps its newest. A landed or ruled coin stays so a replayed call or answer finds it and changes nothing. */
export const COINS_MAX = 40;
/** `coins` with `coin` at the end, unless a coin of that roll is there already (then `coins` itself). The oldest go past `COINS_MAX`. */
export function addCoin(coins: readonly Coin[], coin: Coin): readonly Coin[] {
  if (coins.some(c => c.id === coin.id)) return coins;
  return [...coins, coin].slice(-COINS_MAX);
}
/** `coins` with the coin of roll `id` after `event`; `coins` itself when there is no such coin or the event does not apply. */
export function stepCoin(coins: readonly Coin[], id: RollId, event: CoinEvent): readonly Coin[] {
  const i = coins.findIndex(c => c.id === id);
  if (i < 0) return coins;
  const next = transition(coins[i]!, event);
  return next === coins[i] ? coins : coins.map((c, k) => (k === i ? next : c));
}
/** The GM's calls after a player's call arrives: the call is added once per roll. A call for a roll already held changes nothing. */
export function takeCall(calls: readonly Coin[], c: CoinFields & { call: CoinSide }): readonly Coin[] {
  return stepCoin(addCoin(calls, { id: c.id, hunter: c.hunter, who: c.who, what: c.what, face: c.face, at: 'uncalled' }), c.id, { type: 'call', side: c.call });
}
/** The coin of roll `id` in `coins`, or null. */
export const coinOf = (coins: readonly Coin[], id: RollId): Coin | null => coins.find(c => c.id === id) ?? null;
/** Whether the coin has its answer: it landed on a side, or the GM ruled it. */
export const isSettled = (c: Coin): c is Coin & { at: 'ruled' | 'landed' } => c.at === 'ruled' || c.at === 'landed';
/** The coins not yet landed or ruled, oldest first: the player's coins in the air, the calls the GM has still to answer. */
export const inAir = (coins: readonly Coin[]): Coin[] => coins.filter(c => !isSettled(c));

// ── the save's coins and calls, as store.apply steps ──
/** The parts of the save a coin step reads and writes: a player's `coins`, the GM's `calls`, the session log. */
export type CoinSave = Pick<Save, 'coins' | 'calls' | 'log' | 'seq' | 'hunters'>;
/** Why a coin step changed nothing: no coin of that roll, or not in the state the step needs (a replay, a stale tap). */
export type CoinWhy = 'missing' | 'not-now';
type Next<S> = S | Refused<CoinWhy>;
/** The GM's three answers in the session log's ruling line. */
export const RULING_WORDS: { readonly [R in Ruling]: string } = { right: 'Right', wrong: 'Wrong', coin: 'Let the coin decide' };
const line = (title: string, text: string) => ({ kind: 'system' as const, hunterId: null, title, text });
const landedLine = (c: Coin & { at: 'landed' }) => line(`Coin: ${c.who} called ${SIDE_WORDS[c.call]}`, `Natural ${c.face} for ${c.what}. The coin landed ${SIDE_WORDS[c.side]}: ${coinWords(c)}.`);
/** `coins` after `event` on roll `id`, or why not: the coin must be `at` before. */
function stepAt(coins: readonly Coin[], id: RollId, at: CoinState, event: CoinEvent): readonly Coin[] | Refused<CoinWhy> {
  const c = coinOf(coins, id);
  if (!c) return refuse('missing');
  return c.at === at ? stepCoin(coins, id, event) : refuse('not-now');
}
const landedOf = (coins: readonly Coin[], id: RollId): (Coin & { at: 'landed' }) | null => { const c = coinOf(coins, id); return c && c.at === 'landed' ? c : null; };
/**
 * A coin this phone's hunter called has landed: whether the call was right is a fact of its chronicle (chronicle.ts). A
 * coin the GM ruled in a room records nothing: this phone does not know the side.
 */
function coinFact<S extends CoinSave>(save: S, c: Coin & { at: 'landed' }): S {
  const who = c.hunter;
  return who.kind === 'local' ? { ...save, hunters: save.hunters.map(h => (h.id === who.hunterId ? record(h, { kind: 'coin', won: c.call === c.side }) : h)) } : save;
}

/** A player's roll that calls the coin: its coin, uncalled, in the player's list (once per roll). */
export const coinRolled = <S extends CoinSave>(save: S, coin: Coin): S => ({ ...save, coins: addCoin(save.coins, coin) });
/**
 * The player calls `side` on an uncalled coin. Alone (`landOn` is a true flip's side) it lands in the same step and
 * the landing is logged; in a room it waits for the GM (`landOn` null).
 */
export function coinCalled<S extends CoinSave>(save: S, id: RollId, side: CoinSide, landOn: CoinSide | null, stamp: Stamp): Next<S> {
  const called = stepAt(save.coins, id, 'uncalled', { type: 'call', side });
  if ('ok' in called) return called;
  if (!landOn) return { ...save, coins: called };
  const coins = stepCoin(called, id, { type: 'land', side: landOn }), c = landedOf(coins, id);
  return c ? told(coinFact({ ...save, coins }, c), stamp, landedLine(c)) : { ...save, coins };
}
/** The GM's ruling reaches the player: a called coin is ruled, with no side, and the log says the GM flipped it. */
export function coinRuled<S extends CoinSave>(save: S, id: RollId, stamp: Stamp): Next<S> {
  const coins = stepAt(save.coins, id, 'called', { type: 'ruled' });
  if ('ok' in coins) return coins;
  const c = coinOf(coins, id);
  return c && c.at === 'ruled' ? told({ ...save, coins }, stamp, line(`Coin: ${c.who} called ${SIDE_WORDS[c.call]}`, `Natural ${c.face} for ${c.what}. The GM flipped the coin.`)) : { ...save, coins };
}
/** A player's call reaches the GM: held once per roll; a call for a roll the GM holds already is refused. */
export function callTaken<S extends CoinSave>(save: S, call: CoinFields & { call: CoinSide }): Next<S> {
  if (coinOf(save.calls, call.id)) return refuse('not-now');
  return { ...save, calls: takeCall(save.calls, call) };
}
/** The GM rules a held call: it lands on `side` (`landing` of the ruling and a flip) and the ruling is logged. */
export function callRuled<S extends CoinSave>(save: S, id: RollId, ruling: Ruling, side: CoinSide, stamp: Stamp): Next<S> {
  const calls = stepAt(save.calls, id, 'called', { type: 'land', side });
  if ('ok' in calls) return calls;
  const c = landedOf(calls, id);
  if (!c) return { ...save, calls };
  return told({ ...save, calls }, stamp, line(`Coin: ${c.who} called ${SIDE_WORDS[c.call]}`, `Natural ${c.face} for ${c.what}. Ruled ${RULING_WORDS[ruling]}: the coin landed ${SIDE_WORDS[c.side]}.`));
}

// ── the GM's window for the calls (audit SMX-views-7) ──
/** Calls the GM put off, in the order put off; never empty. */
export type CoinPromptIds = readonly [RollId, ...RollId[]];
/**
 * The GM's phone's window for the calls in the air. `idle`: no window and none put off. `asking`: the window of call `id`
 * is on screen, `later` the calls put off before it. `deferred`: no window, and the GM put off `ids`; a change of the
 * save does not ask them again, a tap on one in the coin card does. Kept by src/views/coin.js for the page, so a new
 * page asks each call again.
 */
export type CoinPrompt =
  | { readonly at: 'idle' }
  | { readonly at: 'asking'; readonly id: RollId; readonly later: readonly RollId[] }
  | { readonly at: 'deferred'; readonly ids: CoinPromptIds };
export const COIN_PROMPT_STATES = ['idle', 'asking', 'deferred'] as const satisfies readonly CoinPrompt['at'][];
/** No window and nothing put off: the GM's phone starts so on each page. */
export const COIN_PROMPT_IDLE: CoinPrompt = { at: 'idle' };
/**
 * What moves the prompt. `seen`: the save changed, and `open` are the calls still to rule, oldest first (none on a phone
 * that is not the GM's). `ruled`: the GM's ruling was written. `putOff`: the window closed with no ruling written (Later,
 * Escape, a tap beside it, or a ruling the save refused). `reopen`: the GM taps call `id` in the coin card.
 */
export type CoinPromptEvent =
  | { readonly type: 'seen'; readonly open: readonly RollId[] }
  | { readonly type: 'ruled' }
  | { readonly type: 'putOff' }
  | { readonly type: 'reopen'; readonly id: RollId };
export const COIN_PROMPT_EVENTS = ['seen', 'ruled', 'putOff', 'reopen'] as const satisfies readonly CoinPromptEvent['type'][];

/** Nothing on screen: `ids` put off, or idle when there are none. */
function waiting(ids: readonly RollId[]): CoinPrompt {
  const [first, ...rest] = ids;
  return first === undefined ? COIN_PROMPT_IDLE : { at: 'deferred', ids: [first, ...rest] };
}
/** No window on screen and the save changed: the put-off calls still open stay put off, and the oldest other open call is asked. */
function askOldest(putOff: readonly RollId[], open: readonly RollId[]): CoinPrompt {
  const kept = putOff.filter(id => open.includes(id)), next = open.find(id => !kept.includes(id));
  return next === undefined ? waiting(kept) : { at: 'asking', id: next, later: kept };
}
type PromptCell<S extends CoinPrompt['at'], T extends CoinPromptEvent['type']> =
  (s: Extract<CoinPrompt, { at: S }>, e: Extract<CoinPromptEvent, { type: T }>) => CoinPrompt;
/**
 * What each event does in each state; a cell that answers its state unchanged changes nothing. One window at a time: an
 * open window stays on screen whatever the save does (the GM answers it), and a tap on a put-off call waits until it closes.
 */
const PROMPT_TABLE: { readonly [S in CoinPrompt['at']]: { readonly [T in CoinPromptEvent['type']]: PromptCell<S, T> } } = {
  idle: {
    seen: (_, e) => askOldest([], e.open),
    ruled: s => s,
    putOff: s => s,
    reopen: s => s,
  },
  asking: {
    seen: (s, e) => ({ ...s, later: s.later.filter(id => e.open.includes(id)) }),
    ruled: s => waiting(s.later),
    putOff: s => waiting([...s.later, s.id]),
    reopen: s => s,
  },
  deferred: {
    seen: (s, e) => askOldest(s.ids, e.open),
    ruled: s => s,
    putOff: s => s,
    reopen: (s, e) => (s.ids.includes(e.id) ? { at: 'asking', id: e.id, later: s.ids.filter(id => id !== e.id) } : s),
  },
};
const samePrompt = (a: CoinPrompt, b: CoinPrompt): boolean => JSON.stringify(a) === JSON.stringify(b);
/** The prompt after `e`; the same value when `e` changes nothing, so the view opens a window only on entering `asking`. */
export function coinPromptStep(s: CoinPrompt, e: CoinPromptEvent): CoinPrompt {
  const row = PROMPT_TABLE[s.at] as { readonly [T in CoinPromptEvent['type']]: (s: CoinPrompt, e: CoinPromptEvent) => CoinPrompt };
  const next = row[e.type](s, e);
  return samePrompt(next, s) ? s : next;
}
/** The calls the GM put off, in the order put off: the coin card offers each. */
export const coinPromptPutOff = (s: CoinPrompt): readonly RollId[] => (s.at === 'asking' ? s.later : s.at === 'deferred' ? s.ids : []);

// ── the boundary ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '');
/** The longest hunter name and roll label a coin keeps (the room message's bounds). */
export const COIN_TEXT_MAX = 60;
/** A face from outside data: 1 or 20, else null. */
export const faceOf = (v: unknown): CoinNatural | null => (v === 1 || v === 20 ? v : null);
/** A stored coin, or null when it has no roll id, no hunter, no face of 1 or 20, or a call or side that is not one. */
export function parseCoin(v: unknown): Coin | null {
  if (!isObj(v)) return null;
  const id = rollId(v.id), face = faceOf(v.face), hunter = parseHunterRef(v.hunter);
  if (!id || !face || !hunter) return null;
  const fields: CoinFields = { id, hunter, who: text(v.who, COIN_TEXT_MAX), what: text(v.what, COIN_TEXT_MAX), face };
  const at = oneOf(v.at, COIN_STATES, null), call = oneOf(v.call, SIDES, null), side = oneOf(v.side, SIDES, null);
  if (at === 'uncalled') return { ...fields, at };
  if ((at === 'called' || at === 'ruled') && call) return { ...fields, at, call };
  if (at === 'landed' && call && side) return { ...fields, at, call, side };
  return null;
}
/** A stored list of coins: each read by `parseCoin` (a bad one dropped, a repeated roll id kept once), the newest `COINS_MAX`. */
export function parseCoins(v: unknown): Coin[] {
  let out: readonly Coin[] = [];
  for (const raw of Array.isArray(v) ? v : []) { const c = parseCoin(raw); if (c) out = addCoin(out, c); }
  return [...out];
}

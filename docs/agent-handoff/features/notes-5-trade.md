Goal: players at one table hand each other items and gold, share a party stash, say something to the GM that the others do not see, and hold an objective the others do not know, each from their own phone. Problem: every room message today runs between one player's phone and the GM's, every phone in a room downloads every message and every sheet, and nothing settles a change that two phones must both make. Smallest change that meets it: an offer whose one end the room takes once (the end's event id is made from the offer's id, so the server's rule "an event id is taken once" decides every race), with each side's goods put aside in its own save until that phone reads the end; a party stash kept on the GM's save as the world list is, asked of by message and answered by the GM's phone as a solo run is; and a poll answer the server cuts for each phone (a sealed message reaches only the GM and the hunters it names, another player's sheet reaches a player only as its face), which the private word and the secret quest both stand on.

# Notes: feature 5, players deal with each other

Status: design for the lead's review. No code. Nothing was run: other helpers build and test on this box.

## 0. What I read, and what the code says today

Read in full: the brief (`brief-5-trade.md`), `.claude/skills/poteto-mode/SKILL.md`, `docs/agent-handoff/START-HERE.md`, `docs/agent-handoff/helper-rules.md`, `AGENTS.md` (all of it), `features/plan.md`, `features/notes-2-solo.md`, `features/notes-1-stories.md` (sections 1 to 5, 8, 9 and 11), `docs/agent-handoff/copy-tasks.md`, the skills `statechart`, `principle-model-the-domain`, `principle-foundational-thinking`, `principle-make-operations-idempotent`, `principle-separate-before-serializing-shared-state`, `principle-boundary-discipline`, `principle-experience-first`, `principle-type-system-discipline`, `principle-subtract-before-you-add`, `unslop`. The code, at 50f5eaec: `src/core/protocol.ts`, `src/core/room-server.ts`, `server.ts`, `src/core/sync/outbox.ts`, `src/core/applied.ts`, `src/edge/room-events.ts`, `src/edge/sync.ts` (its network, link and apply parts), `src/core/gates/solo-wait.ts`, `src/core/hunter/inventory.ts`, `src/core/hunter/quests.ts` (its first half), `src/core/hunter/quest-rights.ts`, `src/core/ids.ts` (the id parsers), `src/core/registry/items.ts` (`Item`, `ITEM_BOUNDS`), `tests/models/room-world.ts` (its phones, its moves, its effect runner), and the Bag panel and nav of `src/views/inventory.js`, `src/app.js`, `src/views/gm.js` (its sections).

What the code holds that decides this design (each read, not run):

- **Every phone in a room downloads everything.** `GET /api/rooms/:code` answers every event after the cursor and every sheet whole, to anyone who knows the code (server.ts, the `parts.length === 2` route). Only `presence` is held back from a player. The player's phone throws the other sheets away (`remoteSheets` answers `[]` unless the phone is the room's GM, sync.ts), but they are in its memory and on its network. So today nothing a player sends is private from the table, and a quest the GM issues to one hunter reaches every phone twice: as the `quest` event, and inside that hunter's pushed sheet.
- **An event id is taken once per room.** `addEvent` (both stores) answers an id the room already holds with the stored event's seq and stores nothing; Postgres holds it with a unique index on `(room, eid)` under the room's row lock. Event ids are `[\w-]{1,40}` (`parseEventId`), made by `newEvent` as the device id cut short, `-`, then the time and four random characters in base 36.
- **The room orders events.** Seqs are taken under the room's row lock; a phone reads pages of 200 after its cursor, in seq order.
- **A phone never applies its own events.** sync.ts `apply` skips `ev.from === dev` ("our own sends echo back"). Only a player's phone runs `APPLIERS`; the GM's phone hears events through `sync:event`.
- **A join skips the room's history.** The link's `head` call pages the whole history from seq 0 to find the cursor and drops the events (sync.ts, `case 'head'`). A reload keeps the stored cursor; a join, a rejoin after a removal and the GM's reopen go through `head`. So a message posted to a player while its phone was out of the room is never applied after it rejoins. This is true of awards and solo answers today; section 1.9 says what this design does about it for the messages it adds, and section 8 lists it as a finding.
- **Room docs are the GM's.** The server refuses a doc put without the GM key; `_kicked` is the server's own.
- **What a phone owes the room is the outbox** (`settings.sync.outbox`): one entry per id, sent in order after each good poll, kept until the room takes it (`sent`) or nothing will (`dropped`). sync.ts's `boxDo` already runs a `heard` step on the save in the same write as a box step, which the solo runs use to mark a run taken before its letter leaves the box.
- **"Applied once" is a ring of 200 ids** (`applied.ts`), enough for a replay from the last page, not for a re-read of history. A message whose land must never repeat across a re-read needs a record of its own in the save. The solo runs have one: the waiting run, by the run's id (`solo-wait.ts`).
- **The nearest thing built** is a solo run of a room's gate (notes-2-solo sections 4 and 5): the player's claim (`soloRun`, `ownSheet`), the GM's phone's single-writer decision (`soloTaken` through `sync.once`), its answer (`soloAnswer`, `gmOnly`), and the player's waiting record whose `lost` state is read from the outbox's own evidence.
- **A hunter's bag and gold** have one writer, its own phone's save: `putItem` (stacks what can stack), `takeItems`, `removeItem` (also empties its slot), `addGold`, `equip`. A worn item is in `equipped` by id. An item is at most `ITEM_BOUNDS` (a name of 60, a description of 500, 12 effects) plus a worn status def. No item has a "quest item" mark: the game has no such thing.
- **The GM's tab polls while hidden only when it may notify** (`hiddenWait`, every 30 s); otherwise a hidden page's poll waits for the page to show. A design that needs the GM's phone for every trade stalls whenever the GM looks at another tab.

## 1. A trade: two hunters on two phones, both or neither

### 1.1 What can go wrong

A trade moves goods out of hunter A (on phone A) and into hunter B (on phone B), and for a sale or a swap the other way too. Each hunter has one writer: its own phone. No single write can change both. So "both or neither" cannot come from one write. It has to come from one decision that both phones read, with each phone's half following from that decision alone.

| Case | What breaks if nothing is designed for it | What must hold |
|---|---|---|
| A phone offline | A's half is written, B's waits; or B accepts while A takes the offer back offline | Each half waits for its phone; the race has one winner both phones agree on |
| A reload between two parts | The item left A's bag but no message went; or the message went and the bag did not change | Every part a phone does is one write; the letter is in the outbox in the write that takes the goods |
| The same offer accepted twice | B gets the item twice | One acceptance counts, on every phone |
| An item used, sold or worn after it was offered | A sells the sword and B still gets it | An offered item is out of the bag until the offer ends |
| A player removed from the room | A's phone stops reading the room while B accepts | The offer's end waits in the room until A's phone reads it again |
| The room gone | Goods half moved and nobody can learn the other half | The system never doubles; what it cannot know it says, and leaves to the player and the GM |
| Accept and take back at once | Both phones believe they won | One end wins, chosen by one actor |
| A lost answer, then a resend | The server stores two acceptances | A resend is the same message (the event id) |
| A third phone posts an "accept" | Junk settles a trade | An end that does not fit its offer settles nothing, the same way on every phone |

### 1.2 What is shared, and what is not

By `principle-separate-before-serializing-shared-state`: the bags are not shared. A's bag is written only by A's phone, B's only by B's. The goods in flight are not shared either: they travel by value in a message, and only one phone lands each message. The one thing two actors write is the decision: "this offer ended, and how". That is the only place serialization is needed, and the design puts it in the one place both phones' messages meet and that already serializes: the room's event log, with its rule that an id is taken once.

### 1.3 Four ways to settle, weighed

| | (a) The GM's phone settles | (b) The server settles | (c) The two phones, the giver decides | (d) The two phones, the room holds the one end |
|---|---|---|---|---|
| How | Offer and accept are claims; the GM's phone reads them in seq order, decides once (`sync.once`), and posts a `gmOnly` answer that each phone lands, as `soloTaken` does | The server parses trade messages, keeps each offer's state in its store, refuses an accept after a take back, and answers who won | The giver's goods go aside at the offer. B's accept is a request. A's phone decides (give or take back) in one write of its own save, and posts the give, which B lands | Goods go aside on the side that gives them. Every end of an offer (accept, refuse, take back, the GM's stop) carries one event id made from the offer's id. The room keeps the first and answers any later one with the first's seq, storing nothing. Each phone reads that one end and writes its own half |
| The decider | The GM's phone (a single writer) | The server | Phone A (a single writer) | The room's existing id rule (a compare and set the server already does) |
| Who must be online for a trade to finish | Both players and the GM's phone, whose hidden tab may not poll at all | Both players | B waits for A's phone to come back before it gets anything | Each phone needs only the room. B gets the item when B's own phone reads the end, whether A's phone is open or not |
| What the server must know | Nothing new | Each offer, each hunter's goods in it, a state per offer, a refusal per kind of message. It stores sheets today and keeps no room state of its own (a lint holds server.ts to that) | Nothing new | Nothing new: the end's id rule is checked by the message's reader, which the server already runs (`parseEvent`) |
| A swap (goods both ways) | Both sides aside until the GM answers | As (a) with the server | B's side must wait aside for A's phone, and B cannot take it back without racing A's give | B's side goes aside at B's accept and comes back the moment the end is anything else |
| The room gone mid-trade | Neither side can know whether the GM's answer went out | Neither side can know | A knows its own decision; B's goods in flight are lost | Neither side can know if it never read the end (1.10) |
| Extra parts | A GM handler, a GM record per offer, an answer message | A server module, a store table, a lock per offer | A give message, a second round trip | One id rule (`endIdOf`), the fold that reads ends, own echoes read |

(a) puts a third device into every trade between two players, and that device's tab is often hidden at the table. (b) adds domain logic and state to the server that (d) gets from a rule it already has. (c) makes B wait for A's phone, and a swap needs B's goods held hostage to A's phone. **Picked (d).** It is the only one where a trade finishes as soon as each phone reads the room, with no new server code and no third party. The GM is not needed to settle, and still sees every offer and may stop any (section 2), because a stop is one more kind of end.

What (d) asks of the rest of the app, each answered below: an offer's id must leave room for the end's suffix (1.4); each phone must read the end even when it posted it, so the fold reads own echoes (1.9); a phone that joins must read the ends of its open offers from the history its `head` already downloads (1.9); and the room gone is the one case no design can settle, so it is said plainly (1.10).

### 1.4 The data shape

```ts
// src/core/ids.ts
/** An offer: its event id. Made by `offerEvent` with two characters to spare, never ending in '-e' (parseOfferId refuses it). */
export type OfferId = Id<'Offer'>;
export const parseOfferId: (v: unknown) => OfferId | null;
/** The one event id every end of offer `o` carries, so the room takes one end (server.ts `addEvent`). */
export const endIdOf = (o: OfferId): EventId => `${o}-e` as EventId;

// src/core/trade/goods.ts: what a hunter hands over. Pure.
/** Gold and items by value, each item with its count. */
export type Goods = { readonly gold: number; readonly items: readonly ItemTemplate[] };
/** A choice from a bag by id and count, and gold: what the Give window picked from this hunter, or what an offer asks of the other. */
export type Pick = { readonly gold: number; readonly items: readonly { readonly id: ItemId; readonly qty: number }[] };
export const NO_GOODS: Goods;
/** At most this many item lines in one offer's goods or asks. */
export const GOODS_LINES = 8;
/** The longest offer or end, in bytes of its payload's JSON in UTF-8 (`goodsSize`), leaving 16 KiB of the server's 64 KiB body. */
export const OFFER_MAX = 49_152;
/** The goods `pick` takes out of hunter `h`, and the hunter without them (`takeItems`, gold within what it holds). */
export function setAside(h: Hunter, pick: Pick): { hunter: Hunter; goods: Goods } | Refused<'no-item' | 'worn' | 'poor' | 'empty' | 'too-large'>;
/** Goods put into hunter `h`: each item through `putItem` (stacking), new ids from `ids`, the gold through `addGold`. */
export function received(h: Hunter, goods: Goods, ids: () => ItemId): Hunter;
/** Whether goods carried by an accept are exactly what the offer asked: the same ids and counts, the same gold. */
export function fits(asked: Pick, goods: Goods & { readonly ids: readonly ItemId[] }): boolean;

// src/core/trade/offer.ts: an offer, its one end, and each phone's record of it. Pure.
export type Offer = {
  readonly id: OfferId; readonly room: RoomCode; readonly by: SheetKey; readonly to: SheetKey;
  /** The names the two phones showed, for words on a third phone and the GM's log. */
  readonly names: { readonly by: string; readonly to: string };
  readonly gives: Goods; readonly asks: Pick; readonly at: string;
};
export const END_HOWS = ['accept', 'refuse', 'withdraw', 'stop'] as const;
/** An offer's end as the room holds it: how, by whom (null for the GM's stop), and what an accept carries (the asked goods). */
export type End = { readonly how: (typeof END_HOWS)[number]; readonly by: SheetKey | null; readonly gives: Goods & { readonly ids: readonly ItemId[] } };
export const OUTCOMES = ['settled', 'refused', 'withdrawn', 'stopped', 'void'] as const;
export type Outcome = (typeof OUTCOMES)[number];
/** The one rule every phone reads: how offer `o` came out, given its one end. */
export function outcomeOf(o: Offer, e: End): Outcome;
```

`outcomeOf`, row by row (the test's table, written from this rule):

| End | Holds when | Outcome |
|---|---|---|
| accept | `by` is the offer's `to`, and `fits(o.asks, e.gives)` | settled |
| refuse | `by` is the offer's `to` | refused |
| withdraw | `by` is the offer's `by` | withdrawn |
| stop | always (only the GM key can post it, the server's `gmOnly`) | stopped |
| anything else (an accept by a third hunter, an accept carrying other goods) | | void |

Every outcome but settled sends the goods back where they came from. A void end is an end: it uses the offer's one slot, so a junk end cancels an offer and moves nothing. No phone can turn a void into a gain.

Each phone's record of an offer, in its save beside the outbox and the waiting runs (`settings.sync.offers`, room plumbing):

```ts
/** How far this phone heard its own letter go: still in the box and never sent, sent at least once, taken by the room. */
export type Heard = 'queued' | 'tried' | 'taken';
/** The giver's side. The goods are aside from the offer's write until the end is read. */
export type GiverAt =
  | { readonly at: 'posting'; readonly heard: 'queued' | 'tried' }   // the offer's letter is in the outbox
  | { readonly at: 'open' }                                         // the room has the offer
  | { readonly at: 'withdrawing'; readonly heard: Heard }           // this phone posted the end 'withdraw'
  | { readonly at: 'stranded' };                                    // the room is gone and this phone never read an end
/** The taker's side. */
export type TakerAt =
  | { readonly at: 'offered' }
  | { readonly at: 'accepting'; readonly heard: Heard; readonly aside: Goods & { readonly ids: readonly ItemId[] } }  // the asked goods are aside
  | { readonly at: 'refusing'; readonly heard: Heard }
  | { readonly at: 'stranded'; readonly aside: Goods & { readonly ids: readonly ItemId[] } };
/** The GM's phone: every offer of the room, to show it and stop it. */
export type WatchAt = { readonly at: 'open' } | { readonly at: 'stopping'; readonly heard: Heard };
export type OfferRecord = { readonly offer: Offer } & (
  | { readonly side: 'giver'; readonly hid: HunterId; readonly aside: Goods; readonly state: GiverAt }
  | { readonly side: 'taker'; readonly hid: HunterId; readonly state: TakerAt }
  | { readonly side: 'gm'; readonly state: WatchAt });
/** Records a phone keeps: its hunter's open offers (`OFFERS_OPEN`, 10, refused past it), offers to it (20, the oldest offered one let go), and on the GM's phone every open offer (60). */
```

`heard` is stored evidence, as the waiting run's `taken` is: the room's 2xx is the only proof the room has a letter, and "sent at least once" is the only proof it might. It decides what a refused or let-go letter and a room gone mean (1.6). The aside goods live in the record, by value, so the proof of 1.8 can count every item in exactly one place: a bag, an aside, or a message in the room.

The room messages, by the recipe "A room message":

```ts
// protocol.ts
/** Hunter `by` offers hunter `to[0]` the goods `gives`, asking `asks` back (gold, and items of its bag by id). Its id is the offer's. */
export type OfferPayload = Base & { by: SheetKey; to: [SheetKey]; names: { by: string; to: string }; gives: Goods; asks: Pick };
// DEFS.offer: { gmOnly: false, ownSheet: true }. Reader: eid by parseOfferId; `to` exactly one key, not `by`; names text(60);
//   gives: gold int(0, 1e9), items listOf(GOODS_LINES, parseItem with qty 1 to ITEM_BOUNDS.qty), at least one thing;
//   asks: gold int(0, 1e9), items listOf(GOODS_LINES, { id: parseSaveId<'i'>, qty int(1, ITEM_BOUNDS.qty) }); the payload
//   over OFFER_MAX refused. Applier: null (the fold reads it, 1.9).
/** The end of offer `offer`, by one of its two hunters: accept (carrying the asked goods by value), refuse or withdraw. */
export type OfferEndPayload = Base & { by: SheetKey; to: [SheetKey]; offer: OfferId; how: 'accept' | 'refuse' | 'withdraw'; gives: Goods & { ids: ItemId[] } };
// DEFS.offerEnd: { gmOnly: false, ownSheet: true }. Reader: offer by parseOfferId; eid must equal endIdOf(offer), else the
//   whole event is refused, so the server never stores a mismatched end; gives as above (empty unless accept). Applier: null.
/** The GM stops offer `offer`. Its id is the offer's end id, so it races an accept and a withdraw for the one slot. */
export type OfferStopPayload = Base & { to: SheetKey[]; offer: OfferId };
// DEFS.offerStop: { gmOnly: true, ownSheet: false }. Reader: as offerEnd's id rule; `to` the two hunters. Applier: null.
```

Three messages, not one with a `how` that includes stop, because the server's `DEFS` flags are per type: an end by a hunter is `ownSheet` (only that hunter's phone may post it), a stop is `gmOnly`.

### 1.5 The offer in the room: one machine everyone agrees on

The room's view of an offer, drawn first. The reader is anyone at the table. The room makes this machine trivial: its only branch is which end the room took first.

```
                    the giver offers (the room takes the offer)
      (no offer) -----------------------------------------------> Open
                                                                    |
     the first end the room takes, and only that one:               |
       the taker accepts and it fits --------------------------->  Settled
       the taker refuses ---------------------------------------->  Refused
       the giver takes it back ---------------------------------->  Withdrawn
       the GM stops it ------------------------------------------>  Stopped
       an end that does not fit the offer ----------------------->  Void
                                                                    (every end state is final)
```

| State | an end arrives (the room's first end id for this offer) | a later end arrives |
|---|---|---|
| Open | the state `outcomeOf` names | cannot happen: the room answers it with the first's seq and stores nothing |
| any end state | cannot happen | cannot happen |

This table is held by the server's `addEvent`, not by app code: there is no second end to arrive. Its test is in `tests/server-rooms.test.ts` ("an offer ends once"): an accept stored, then a withdraw with the same id posted by the other phone answers the accept's seq, and the room's events hold one end. The same test runs on Postgres under `DATABASE_URL` (the existing pair of stores).

### 1.6 Each phone's record: the charts, then the tables

A phone does not know the room's state until it reads the end. Each phone's record is a machine over what that phone knows. Events: the player's taps; `tried` and `taken` raised by sync.ts in the write that steps the letter in the box (`boxDo`'s `heard`, as the solo runs do); `unsent`, from the box's own evidence (the record's letter is no longer queued or on its way and was never taken: the solo runs' rule); `end`, the offer's one end, read from the room; `roomGone`, the link's `gone`; `takeBack`, the player's tap on a stranded record.

Who raises `unsent`: many writers can let a letter go (a full box in any core step that posts drops its oldest queued letter, `rebound`, sync.ts's sends). The solo runs read "lost" from the box without a write, because a lost run gives nothing back. An offer's goods must come back in a write. So `lettersKept(save)` (offer.ts) is a step the store runs after every step, as it runs `noticed`: it steps `unsent` on each record whose letter was never sent and is no longer in the box. Whichever writer let the letter go, the goods come back in that same write. Its test: "a full outbox that lets an offer's letter go gives the potion back in the same write".

The giver:

```
   the player taps Offer to Mira (goods aside, letter in the box)
 ----------------------------------------------------------------> Posting (never sent)
 Posting (never sent) --sent once--> Posting (tried) --the room took it--> Open
 Posting (never sent) --Take back, or the letter let go, or the room gone--> [ended: goods back]
 Posting (tried) --Take back--> Withdrawing
 Open --Take back--> Withdrawing
 Posting (tried), Open, Withdrawing --the end is read: settled--> [ended: goods gone, the asked goods gained]
 Posting (tried), Open, Withdrawing --the end is read: refused, withdrawn, stopped, void--> [ended: goods back]
 Posting (tried), Open, Withdrawing --the room gone--> Stranded
 Withdrawing --its letter let go--> Open                       (Take back may be tapped again: the same id)
 Stranded --the player takes it back, after a window that says why--> [ended: goods back]
```

| Giver | Take back (tap) | tried | taken | unsent | end | roomGone | takeBack (stranded) |
|---|---|---|---|---|---|---|---|
| posting, queued | ended, goods back, the letter dropped from the box | posting, tried | open | ended, goods back | null (the room never had it) | ended, goods back | null |
| posting, tried | withdrawing, queued: the end letter posted after the offer's | null | open | null (the room may have it: G stays aside, an end will tell) | ended by `outcomeOf` | stranded | null |
| open | withdrawing, queued | null | null | null | ended by `outcomeOf` | stranded | null |
| withdrawing | null | withdrawing, tried (from queued) | withdrawing, taken | open (from queued or tried: the room may still have the end, and Take back may post the same id again) | ended by `outcomeOf` | stranded | null |
| stranded | null | null | null | null | ended by `outcomeOf` (only if the room comes back, which a gone room does not) | null | ended, goods back |

"Ended by `outcomeOf`": settled drops the aside goods and gives the hunter the end's goods (the asked things, by value, through `received`); every other outcome gives the aside goods back through `received`. In the same write, any letter of this record still queued is dropped from the box (a withdraw that lost the race has nothing left to say).

Why `posting, tried` meets `unsent` with null and not "goods back": a letter refused after it was sent once may have been stored by the first send (an answer lost, then a resend refused). Only a letter that never left the box is provably not in the room. The way out of that state is Take back, which posts the end `withdraw` under the offer's end id: if the room never had the offer, the withdraw is stored and read, and the outcome is withdrawn; if it did, the withdraw races the taker's accept for the one slot. Take back works whether or not the phone knows the room has the offer. That is why the giver needs no "lost" state while the room lives.

The taker:

```
 the offer is read (to this phone's hunter) ----------------> Offered
 Offered --Accept (the asked goods aside, letter in the box)--> Accepting
 Offered --Refuse (letter in the box)--> Refusing
 Offered, Refusing --the end is read--> [ended: nothing moves; told how it ended]
 Accepting --the end is read: settled by this accept--> [ended: the offer's goods gained, the aside gone]
 Accepting --the end is read: anything else--> [ended: the aside back]
 Accepting (never sent) --its letter let go--> Offered (the aside back)
 Accepting (never sent) --the room gone--> [ended: the aside back]
 Accepting (sent once or taken) --the room gone--> Stranded
 Stranded --the player takes it back, after the window--> [ended: the aside back]
```

| Taker | Accept (tap) | Refuse (tap) | tried | taken | unsent | end | roomGone | takeBack |
|---|---|---|---|---|---|---|---|---|
| offered | accepting, queued, the asked goods aside (`setAside`; refused `no-item` when the asked item is gone, `worn`, `poor`) | refusing, queued | null | null | null | ended, told | ended | null |
| accepting | null | null | from queued: tried | taken | from queued: offered, the aside back; from tried: null (the room may hold this accept as the end) | settled: gained, aside gone; else: aside back | from queued: ended, aside back; else: stranded | null |
| refusing | null | null | from queued: tried | taken | from queued: offered; from tried: null | ended, told | ended (nothing aside) | null |
| stranded | null | null | null | null | null | as accepting | null | ended, aside back |

"Settled by this accept": `outcomeOf` is settled. An accept stored is always this phone's, since the end's `by` must be the offer's `to`, which is this hunter's key, whose device only this phone can post for (the server's `ownSheet`).

An accepting taker cannot take its accept back. Its accept may already be the room's end. While the room lives, a stuck accept (the giver's phone gone for good, the letter refused after a try) ends when the giver takes the offer back or the GM stops it (section 2): every open offer has a way to end that needs neither the giver's phone nor luck.

The GM's phone keeps a record of every offer it reads: open, then stopping after its Stop (heard as above), and ended when the end is read. It never holds goods.

Every cell above is in the tables `GIVER`, `TAKER` and `WATCH` in `offer.ts` (the typecheck asks for every cell, as for every machine); `recordStep(record, event)` answers the next record or `ended` with what to move, or the record itself where the cell is null.

### 1.7 Who sends each event, and what each writes in one write

| What happens | Who | The one write |
|---|---|---|
| Offer to Mira | The giver's phone, its bound hunter (`ownSheet`) | `setAside` on the hunter, the giver's record (posting, queued), the `offer` letter in the outbox, through `store.apply` |
| Give to Eldrin (a hunter on the same phone) | This phone | `handOver(save, from, to, pick, ids)`: `setAside` on one, `received` on the other, one write, no message and no record (section 6) |
| Accept | The taker's phone | `setAside` of the asked goods (when it asks any), the record to accepting, the `offerEnd` accept letter (its id `endIdOf`) |
| Refuse | The taker's phone | The record to refusing, the `offerEnd` refuse letter |
| Take back | The giver's phone | Posting and never sent: the goods back and the letter dropped. Else the record to withdrawing and the `offerEnd` withdraw letter |
| Stop | The GM's phone (`gmOnly`) | The GM's record to stopping, the `offerStop` letter, held two seconds under Undo first (the recipe "A write a stray tap should be able to stop") |
| tried, taken | sync.ts, the box's one writer | In the write that steps the letter (`boxDo`'s `heard`) |
| The end read | sync.ts, on every poll page and on a join's history | The fold (1.9): each record's step, its goods moved, its leftover letters dropped, the GM's log line, in the same write as the page's cursor |
| roomGone | sync.ts, where the link's `gone` refuses the room's letters | Each record of that room stepped, in the same write as the box's `roomGone` |
| Take back, stranded | The player, after the window | The aside back |

Every write is all or nothing (`store.apply` of one step on the whole save, `both(...)` to chain). A refusal is a union with its words (`OfferRefusal`, section 7): `off`, `fight` (a fight holds the hunter: `fightHold`, as solo runs), `no-item`, `worn`, `poor`, `empty`, `too-large`, `too-many` (`OFFERS_OPEN`), `not-open` (a second tap), `no-room`, `not-played` (only the hunter this phone plays in the room trades there, sync's `bound()`).

### 1.8 The proof: never doubled, never lost

Let G be what offer X gives (by value in the `offer` message) and A what it asks (by value in an accept). Write every place a unit of G can be: B1 the giver's bag, the giver's record of X (its aside), the room (inside the `offer` message, which no phone owns), B2 the taker's bag.

1. **G leaves B1 only into the aside, in one write** (the offer's write). `setAside` and the record are one `store.apply`; the letter is in the box in that write. A reload before the write leaves nothing; after it, the box sends the letter (`reloaded` queues one on its way again), and the room takes its id once.
2. **G leaves the aside in exactly three ways:** back to B1 when the giver's record ends with an outcome other than settled; gone when it ends settled; back to B1 on the player's Take back of a stranded record (the room gone, 1.10).
3. **B2 gains G in exactly one way:** the taker's record ends settled. A taker that never accepted cannot end settled (its record was never accepting, and settled needs the end's `by` to be its key, which only its phone can post for).
4. **Both phones read the same end.** The room holds at most one event with the id `endIdOf(X)` (1.5), the end reader refuses an event whose id is not its offer's end id, so a phone that reads "the end of X" reads that one event. `outcomeOf` is a pure function of the offer and the end, so the two phones compute the same outcome.
5. **So G is never in B1 and B2 at once.** B1 gets G back only on a non-settled outcome; B2 gains G only on settled; both read one outcome (4). The one exception is the player's explicit Take back of a stranded record, which only a gone room allows (1.10).
6. **G is never lost while the room lives.** If the outcome is settled, the giver's record drops G and the taker's record gains it, each when its phone reads the end. Between the two, G is in the room (the `offer` message), and the end proves whose it is. Each phone reads every end of its open records: on a poll, the fold reads the whole page, its own events included (1.9); after a join, the fold reads the history the join downloads (1.9). Neither half can be refused: the goods are aside already, and `received` cannot fail (a bag has no cap, gold has no ceiling but the reader's).
7. **A is the mirror of G** with the roles swapped: it leaves B2 into the taker's aside at the accept's write; the giver gains A from the end's own copy only when the outcome is settled, which needs that very accept to be the end; the taker's aside comes back on any other outcome.
8. **Gold is the same as items.** `setAside` takes gold within what the hunter holds; the aside holds the number; `received` adds it.
9. **Idempotent.** Every move happens in the write that ends the record, and an ended record leaves the save. A second read of the same end finds no record and moves nothing. The fold reads a page as a batch keyed by ids (1.9), so a page read twice, or out of order, or an end read in a later page, ends each record once. A resend of any letter is the same id: the room stores it once (`addEvent`), the box keeps one entry per id (`post`).

The interleavings, each walked through the tables:

| Interleaving | The room's end | The giver ends | The taker ends | Conserved |
|---|---|---|---|---|
| B accepts; later A reads it | accept | settled: G gone, A gained | settled: G gained, A gone | yes |
| B accepts and A takes back at the same moment | whichever the room took first | the same outcome | the same outcome | yes |
| B accepts offline, A takes back offline, both send later | whichever reached the room first | the same | the same | yes |
| B double taps Accept | one accept (the second tap is refused `not-open`; a second letter would be the same id) | settled once | settled once | yes |
| The answer to A's offer is lost, A resends | the offer once | as the end says | as the end says | yes |
| The answer to B's accept is lost, B resends | the accept once (or the end that was first) | as the end says | as the end says | yes |
| A reload between the tap and the send, the send and the answer, the answer and the poll | unchanged | the box resends the same id; the record waits | the same | yes |
| A is removed, B accepts, A rejoins later | accept | settled, read from the history its join downloads | settled at once | yes, and G is B's from B's read on |
| B is removed while offered | none until A takes back or the GM stops | back | ended (on its next read) | yes |
| The GM stops while B accepts | whichever came first | the same | the same | yes |
| B's asked item was sold before Accept | none from B (Accept refused at the tap, `no-item`) | open | offered | yes |
| A third phone posts an accept with X's end id | that junk end (void) | back | ended, nothing moved | yes |
| A's hunter is deleted with X open | as it comes | the record ends on its read; goods back go to no hunter (deleted with the rest of its bag) | as the end says | yes: a deleted hunter's things are deleted |
| B's hunter is deleted while accepting | as it comes | as the end says | goods for no hunter | yes, as above |
| Two GM phones stop at once | one stop (one id) | stopped | stopped | yes |
| A fight holds A or B | Offer and Accept refused (`fight`); a take back, a refuse and the read of an end are not | | | yes |
| The room is gone with X posted and never sent | none | back (provably never in the room) | no record | yes |
| The room is gone with X taken and no end read | unknown | stranded | stranded or none | never doubled by the app; section 1.10 |

The room model (`tests/models/room-world.ts`, run by `tests/room-system-model.test.ts`) gains this, with two players:

- **The phones' hunters** become a bag of numbered tokens and a gold count each, with the offer records beside the outbox in `PhoneSave` (the model reduces a hunter to what changes, as it does today).
- **Moves:** `offer` (player 1 offers player 2 a token, asking 5 gold or nothing), `accept`, `refuse`, `withdraw` (player 1's Take back), `stop` (the GM), joined with the existing ones: a reload of any phone, a lost answer, a resend, a removal and Allow back (whose rejoin runs the join's history fold), the room gone. The exhaustive run keeps one move per way of posting; an end is a new way (its id is derived), so `accept` and `withdraw` both stay in the exhaustive run, and the random walks carry the rest.
- **Rules held after every move:**
  1. No token is in two places at once among the bags and the asides of all phones (never doubled).
  2. Gold in all bags and asides never exceeds the starting total.
  3. Every offer has at most one end in the server's store.
  4. A giver's and a taker's records that both ended read the same outcome.
- **Rules held at rest** (every phone live, every box empty, every phone caught up to the room's last seq): every token is in exactly one bag and no aside is left, and the gold total equals the start, unless a record is stranded (only after the room gone, a move the walk may make, and then rule 1 still holds).
- **One scenario, by name:** "an accept and a take back sent at once: whichever the room took decides, on both phones", with both orders.

### 1.9 Reading the end: every page, own echoes, a join's history

The fold is one pure step, `offersSeen(save, events, from, me, R)` in `offer.ts`. It reads a list of stored events (a poll page, or a join's history) as a batch:

- the offers in the batch, and the ends in the batch, keyed by offer id;
- for each record the save holds: its end, if the batch has one, steps it (`recordStep` with `end`);
- for each offer in the batch with no end in the batch, addressed to one of this phone's hunters: a taker record (offered) when the save has none; on the GM's phone, a watch record for every such offer;
- an offer and its end in the same batch create nothing on a taker's phone (nothing of the taker's moved), and on the GM's phone are logged when `from` is `poll` (a new trade the GM must see) and left alone when `from` is `history` (an old one it already logged or never watched).

It answers the next save and what to tell (a toast per ended record). It never throws on a parsed event, a rule the test's random walk checks, because sync.ts moves the cursor past whatever it read.

Where it runs, all in sync.ts:

- **On every good poll**, over `r.events` whole, the phone's own events included. sync.ts skips its own echoes for the appliers and `sync:event` (`ev.from === dev`); the fold is not an applier and must read them, since a phone learns that its own accept or take back won only by reading it as the end. This is a separate call beside `applyHeld`, in the same `apply` effect, written in the same `store.apply` as the page's cursor so a reload cannot keep one without the other. (Today the cursor is written by the link's `save` effect and the appliers by their own writes, in the same task; the store flushes them together. The unit writes the cursor and the fold in one step and tests "a reload between the cursor and the fold".)
- **On a join's head**, over the history pages it already downloads. The head call collects the events of the three offer types from every page (it drops the rest as it does today) and hands them to the fold with `from: 'history'`, once the join is live. This is what ends an offer for a giver who was removed and came back, and shows a player the offers made to it while it was out.

A finding, not fixed here: the same history skip loses every other message posted to a player while its phone was out of the room (an award, a solo answer, a quest). Messages guarded only by the applied ring cannot be read again from history (a ring of 200 cannot tell an old award from a new one). A message whose land is guarded by a record of its own (an offer's end; a solo answer, guarded by its waiting run; a stash answer, section 3) can be. Section 8 proposes the rule for the lead: the join's history fold also reads answers to this phone's waiting asks.

The memory store (no `DATABASE_URL`) keeps the last 2000 events of a room, so on it a join's history can miss an old end and the record stays open until the GM stops the offer or the giver takes it back. Postgres, which the deploy uses, keeps every event while the room lives.

### 1.10 The edges: the room gone, a removal, a reload, two GM phones

**The room gone.** A room is gone 30 days after anyone last used it. A record whose letter never left the box ends with its goods back: the room never had it. A record the room may have (posting after a try, open, withdrawing, accepting after a try) becomes stranded, because no phone can now learn the end, and both ways out are wrong in one case each: giving the goods back doubles them if the other side accepted and read it before the room went; keeping them aside loses them if nobody did. The app never chooses the doubling on its own. A stranded record keeps its goods aside, shows them, and offers Take back behind a window that says what the app cannot know ("The room closed before this offer ended, so the app cannot tell whether Mira accepted. If she did, she has the Healing Potion too. The GM's session log shows every trade that ended."). The GM's phone logged every end it read, so the GM can answer. A player alone can already give its hunter anything (a phone alone is its own GM), so Take back gives a player in a gone room no power it lacked. for-the-owner line and question 3.

**A removal.** A removed phone leaves the room and stops reading it. Its offers stay open in the room: the taker may still accept (and has the goods at once), the GM may stop them. The giver's record waits and is ended by the join's history fold when the phone is allowed back. A giver who never comes back keeps its aside until then. The GM's Remove window says so in one line ("Brakk's open offers stay put aside until Brakk is back in the room. Stop them first to give Brakk's things back on its next visit.").

**A reload.** No two parts (1.7). The box resends; `heard` is in the save; the fold reads the page again and finds no record to end twice.

**Two GM phones.** Each watches every offer from the log; a stop from both is one stop (one id). Nothing else of a trade is on a GM phone.

### 1.11 What the GM's phone and a third player's phone hold

A third player's phone downloads offers and ends (they are not sealed, section 4) and keeps no record of offers that are not its hunter's. The GM's phone keeps a watch record per open offer and writes one session log line per end it reads on a poll ("Brakk gave Mira 1 Healing Potion for 20 gold.", "Mira refused Brakk's offer.", "Brakk took back an offer to Mira.", "You stopped Brakk's offer to Mira."), with the new log kind `trade`.

## 2. Who may see and stop a trade

### 2.1 The GM's part, weighed

| | (a) A log line only | (b) Sees every open offer, may stop any, and a log line per end | (c) Approves every trade |
|---|---|---|---|
| What the GM does | Reads the session log after the fact | Reads the open offers in the GM view, taps Stop on one, reads each end in the log | Taps Allow on each accepted offer before it settles |
| What it costs | Nothing new | One `gmOnly` message whose id is the offer's end id, so it races an accept for the one slot (1.4) | The accept stops being an end and becomes a request; the GM's Allow becomes the end. Every trade waits for the GM's phone, whose hidden tab may not poll |
| A stuck offer (the giver's phone gone for good) | Stays open | The GM stops it and the goods go back on each side's next read | The GM refuses it |

**Picked (b).** Stop is the one control that ends any open offer without the giver's phone, which the record tables lean on (1.6), and it costs one message type and no change to the machine. (c) brings back the third device that 1.3 removed; question 1 asks the owner whether he wants it, and the design takes it as a fourth kind of end if he does (the accept would carry the asked goods aside as now, and only the GM's Allow, under the same end id, would settle).

### 2.2 The switch for the table

`RULES.trade = { on: true }`, overridden in `rulesOverrides.trade` (a reader in `READERS`, `overrides.ts`) and carried to players' phones in the room's `rules` doc as `RoomRules.trade: { on: boolean }` (a doc without it reads on, as `feats` does), laid over their rules by `withRoomRules`. Its control is a `.seg` (On, Off) at the head of the GM view's "Trades and stash" section, written by `tradeRuleSet` into `rulesOverrides.trade` as `soloRuleSet` writes the solo switch.

Off refuses, at the tap on each phone, a new offer, an accept, a put and a take (`off`). It never refuses a take back, a refuse, a stop or the read of an end, which only send things back or finish what the room already decided. The fold never reads the switch: a phone that read the switch as on a moment before the GM turned it off may still post an accept, and that accept, if it is the end, settles. The switch is "as each phone last read the rules doc", and the words say so ("Trading is off for this table."). The stash's answers read the switch exactly, because the GM's phone decides there (3.4).

### 2.3 What may be given

- **A worn item** cannot be given. Give shows only on an unworn row; `setAside` refuses `worn` ("Take off the Iron Sword to give it."); a face lists unworn lines only, so an ask names nothing worn, and an asked item worn since is refused at Accept with the same words.
- **A quest item** does not exist in the game: no item carries such a mark. If one is added, it is a field of `Item`, its reader in `parseItem`, and one more refusal of `setAside`.
- **An item that revives** (the Resurrection Crystal) may be given, sold to a player and put in the stash. A trade moves it and never makes one, so the GM's count of crystals holds; the Association still never buys one back (`sellable`). for-the-owner line and question 2.
- **Gold.** An offer gives at most the gold its hunter holds at the offer's write (it goes aside) and at most 1e9 (the reader's bound, the reward's); it asks 0 to 1e9, and the taker must hold the asked gold at Accept (`poor`).
- **A stack.** The Give window's count, 1 to the stack's count; `setAside` takes that many (`takeItems`).
- **A hunter a fight holds** neither offers, accepts, puts nor takes (`fight`, by `fightHold`, as for a solo run), because the fight's row was built from its bag and may spend an item of it.
- **A down or dead hunter** may offer and accept: the rules bar nothing for life, and a downed hunter's friend being handed its potion is the table's business. for-the-owner line.
- **The GM's own hunters** do not trade with players' hunters in a room in this design. Players see the room's hunters as faces of pushed sheets (4.1), and a GM phone pushes none. The GM gives with the Award form as today. The GM's hunters hand over among themselves (one write, section 6) and use the stash directly.

## 3. The party stash

### 3.1 Whose save holds it

| | (a) The GM's save, published as a doc | (b) The server | (c) One hunter | (d) The room's log, as offers |
|---|---|---|---|---|
| What it is | `Save.stash` on the GM's save, like the world list; the `stash` doc published for players; a put or a take is an ask the GM's phone answers in seq order, as a solo run is | A stash table in the store, a lock per take, a record of each take's id to answer a resend | A hunter the party agrees carries the things: putting in is an offer to that hunter | Each put a lot in the log, each take an end with the lot's end id; every phone folds the stash from the log |
| Two players take the last potion | The GM's phone takes the asks in seq order: the first is given, the second refused | The lock | Two offers from that hunter, one accept each | One end per lot |
| Needs the GM's phone | For each put and take to finish | No | No | No |
| Survives a new room, a campaign file | Yes: it is the campaign's | No | It leaves with that player | No: it dies with the room and a late joiner must fold the whole history |
| What the server must know | Nothing new | A domain and its state | Nothing new | Nothing new |

The stash is campaign state, as the world's gates and the stories are: it belongs to the table's game, not to the room that carries messages this week, and the GM must be able to see and tidy it. (d) loses it when the room closes and keeps no copy in the campaign file; (b) puts a domain in the server; (c) hands the party's things to one player's phone. **Picked (a).** Its cost is that a put and a take wait for the GM's phone, which at the table is open; 3.5 says what a player sees meanwhile.

### 3.2 The data shape

```ts
// src/core/trade/stash.ts. Pure.
/** The party's stash: gold and items (stacking as a bag does), on the GM's save. Save.stash, default { gold: 0, items: [] }. */
export type Stash = { readonly gold: number; readonly items: readonly Item[] };
/** Item lines the stash holds at most; a put past it is refused (`full`). Set by unit 5's measurement against DOC_MAX. */
export const STASH_LINES = 40;
/** What a player asks of the stash: to put goods in (they wait aside), to take `qty` of a line, or to take gold. */
export type StashAsk =
  | { readonly kind: 'put'; readonly goods: Goods }
  | { readonly kind: 'take'; readonly item: ItemId; readonly qty: number; readonly name: string }
  | { readonly kind: 'gold'; readonly gold: number };
export const STASH_REFUSALS = ['gone', 'short', 'full', 'off'] as const;
/** Where a stash change is written: this phone (alone, the GM's own hunters) or asked of the GM's phone (a player in a room). */
export const stashRoute = (seat: Seat): 'here' | 'room' => (seat === 'player' ? 'room' : 'here');
/** Here: goods from a hunter into the stash, one write (`setAside`, then `putItem` and `addGold` on the stash). */
export function stashPut(save: Save, hid: HunterId, pick: Pick, ids: () => ItemId): Save | Refused<OfferRefusal | 'full'>;
/** Here: what an ask takes, from the stash into a hunter, one write. */
export function stashTake(save: Save, hid: HunterId, ask: Exclude<StashAsk, { kind: 'put' }>, ids: () => ItemId): Save | Refused<StashRefusal>;
/** The GM's phone: a player's ask taken in one write (the stash changed, the answer's body, a log line), or refused with why. */
export function stashTaken(save: Save, ask: StashAskPayload, R: Rules, day: Day): { save: Save; answer: EventBody<'stashAnswer'> };
/** The doc players read: the stash by value, within DOC_MAX. */
export function stashDoc(save: Save): StashDoc;

// protocol.ts
export type StashAskPayload = Base & { by: SheetKey; name: string; ask: StashAsk };
// DEFS.stashAsk: { gmOnly: false, ownSheet: true }. Reader: goods as an offer's; qty int(1, ITEM_BOUNDS.qty); gold int(1, 1e9). Applier: null.
export type StashAnswerPayload = Base & { to: [SheetKey]; ask: EventId }
  & ({ verdict: 'kept' } | { verdict: 'given'; goods: Goods } | { verdict: 'refused'; why: (typeof STASH_REFUSALS)[number] });
// DEFS.stashAnswer: { gmOnly: true, ownSheet: false }. Applier: once, a `land` (3.3).
export type StashDoc = { gold: number; items: Item[] };   // Docs.stash, DOCS.stash (each line by parseItem), WIRES.stash
```

The doc's size: unit 5 builds the worst stash (`STASH_LINES` lines of the largest item `ITEM_BOUNDS` allows, 12 effects, a worn status of the largest def, a description of 500) and checks it under `DOC_MAX`; if it is over, `STASH_LINES` comes down and these notes say to what. The test prints it by part, as the doc tests do.

### 3.3 A player's ask waits, as a solo run waits

A player's ask is a claim the GM's phone answers once, which is exactly the solo run's waiting record. Two copies of that machine would be the red flag "two ways to do one thing". So unit 5 first moves `src/core/gates/solo-wait.ts` into `src/core/sync/asked.ts`: one record of "a letter waiting for the GM's phone's answer", with what it asks as a union.

```ts
// src/core/sync/asked.ts (was gates/solo-wait.ts; its callers moved and the old module deleted in the same step)
export type Asked = {
  readonly id: EventId; readonly room: RoomCode; readonly hid: HunterId; readonly at: string;
  readonly state: 'posted' | 'taken' | 'gone';            // stored, as the solo runs' today
  readonly sent: boolean;                                 // its letter went out at least once (raised with `tried`, 1.6)
} & ({ readonly kind: 'solo'; readonly gate: GateId; readonly name: string } | { readonly kind: 'stash'; readonly ask: StashAsk });
// settings.sync.asked (was settings.sync.runs), at most ASKED_MAX (20)
```

The stored states, the shown states and the table stay the solo runs' (posted, taken, lost; taken, answered, roomGone, dismiss), with one rule added for an ask that holds goods (a put). A put whose letter was never sent and is no longer in the box gives its goods back and leaves the list, in the write that let the letter go (the store's every-write step of 1.6, which covers asks too). A put lost after a send, or caught by the room gone, keeps its goods aside and shows Take back behind a window ("The room did not take this, so the app cannot tell whether the stash has it. Look at the stash first."), the policy of a stranded offer (1.10). A solo run's lost changes nothing: it holds no goods.

An answer lands once (`APPLIERS.stashAnswer`, `once: true`), and only while its ask waits (`askAnswered` refuses `no-ask` otherwise, as `runAnswered` does), so a second GM phone's answer or a replay gives nothing:

- `kept`: the put's aside goods leave the record (they are the stash's now); a toast "In the stash: 2 Healing Potions."
- `given`: `received` gives the goods to the hunter; a toast "From the stash: 1 Healing Potion."
- `refused`: a put's goods come back; a take moves nothing; a toast with the refusal's words.

The fallback, if the lead would rather not touch the solo runs in this feature: a second module with the same table for stash asks. It costs a second chart and a second set of the same cells.

### 3.4 The GM's phone answers

On `sync:event`, the GM's view module (`src/views/trade.js`, section 6) runs `app.api.sync.once(eid, step)` with `stashTaken`, the recipe "A use the GM should hear of": in the order the room's pages bring them, in one write each, the stash changed, the answer posted to the box, and a log line of kind `trade` ("Mira put 2 Healing Potions in the stash.", "Eldrin took 1 Healing Potion from the stash."). Then the doc follows (the publishers of sync.ts, `PUBLISH_MS`).

- A put: refused `off` when trading is off, `full` past `STASH_LINES`; else kept.
- A take: refused `off`; `gone` when the stash holds no line of that id; `short` when it holds fewer than asked (the player asks again for what is there; the answer never gives less than asked without saying so); else given.
- Gold: refused `off`; `short` when the stash holds less; else given.

### 3.5 Two players take the last potion, and the GM's phone away

Two asks for the last Healing Potion reach the room in some order. The GM's phone takes them in that order: the first is given it, the second is refused `gone` ("The stash has no Healing Potion left."). Each answer lands once on its own phone. No phone ever shows the potion as its own before its answer.

While the GM's phone is away, the stash reads as the doc last published, with its time ("The stash as of 21:04. Puts and takes wait for the GM's phone."). Put and Take still work and wait, each with its line ("Waiting for the GM's phone."); a put's goods sit aside meanwhile, shown in the Bag's stash tab under "Waiting". Nothing is promised: a take may be refused when the GM's phone answers, and the line says so before the tap ("The GM's phone answers in the order asks arrive.").

### 3.6 Is a stash a trade with the stash as the other side?

The put fits a part of the offer: goods aside until one decider answers. The take does not: the stash is not a hunter, its phone is the GM's and no party's, and no phone holds a bag the taker chose from with an end it could race. One machine would bend the offer's "two hunters, one end in the room" into "a hunter and a keeper that answers". So the stash shares the goods (`Goods`, `setAside`, `received`) with the offer and the waiting ask with the solo runs, and not the offer's machine. What it shares is shared by module, not by copy.

### 3.7 The GM and the stash

The GM view's "Trades and stash" section lists the stash (its gold and lines) with Remove on each line (the GM's hand edit, `stashRemove`, held two seconds under Undo; the line is gone and logged). The GM's own hunters put and take in one write (`stashRoute` is `here`). A GM alone keeps a stash in the save, and the hunters on the phone put and take directly. Putting a fight's dropped loot straight into the stash is not in this feature (the GM awards it to a hunter, who puts it in); a later recipe line.

The room gone takes nothing from the stash: it is on the GM's save, and the next room publishes it again. Asks in flight follow 3.3.

## 4. A private word to the GM

### 4.1 The room's view for each phone (what 4 and 5 both stand on)

Today a player's phone downloads every event and every sheet (section 0). A message "only the GM's phone lands" would still sit in every player's phone and network. Three ways:

| | (a) The server cuts each poll for its viewer | (b) Encrypted to the GM | (c) Nothing; the screen hides it |
|---|---|---|---|
| How | A sealed event reaches the GM and the phones of the hunters it names; another player's sheet reaches a player only as its face | The GM's phone makes a key pair; players encrypt to its public key (WebCrypto in the edge); a doc carries the key | The player's app does not show it |
| Hidden from other players' phones | Yes: never downloaded | Yes: unreadable | No |
| Hidden from the server's database | No | Yes | No |
| What it costs | One pure function in protocol.ts, three lines in server.ts, the device token on a poll | Key making, a key doc, a lost key loses every word, and sheets (the secret quest inside one) still need (a) or their own encryption | Nothing, and it hides nothing |

**Picked (a).** It is the only one that also keeps the secret quest out of other players' phones without encrypting sheets, and it is a filter on the way out with no state.

```ts
// protocol.ts
/** Who asks for the room: the GM (its key), a phone proven by its device token, or anyone who knows the code. */
export type Viewer = { readonly kind: 'gm' } | { readonly kind: 'phone'; readonly device: DeviceId } | { readonly kind: 'anyone' };
/** Whether a viewer gets a stored event: the GM every one; a sealed one only the phones of its `by` and `to` hunters; any other, everyone. */
export function servedTo(ev: RoomEvent, v: Viewer): boolean;
/** A sheet as a viewer gets it: whole to the GM and to the phone it belongs to; to anyone else its face. */
export function sheetFor(key: SheetKey, sheet: RoomSheet, v: Viewer): RoomSheet;
/** A hunter as the other players see it in the room: who it is, and its bag's unworn lines (what an offer may ask for). */
export type Face = { readonly face: { readonly name: string; readonly level: number; readonly job: string | null; readonly bag: readonly FaceLine[] } };
export type FaceLine = { readonly id: ItemId; readonly name: string; readonly qty: number; readonly rar: Rarity };
// RoomSheet = PushedSheet | Tombstone | Face (parseSheet reads all three); a face holds at most FACE_LINES (40) lines.
// EventDef gains `sealed: (p) => boolean`: `word` and `wordBack` always; `quest` and `questUpdate` when the quest is secret; else never.
```

server.ts, in the poll route: the viewer is the GM when the key answers; else a phone when the query's `d` and the `X-Device-Token` header hash to that device's owner (`owner(code, d)`, the binding a sheet push makes); else anyone. The answer's events are `page.events.filter(e => servedTo(e, viewer))`, with `next` and `more` taken from the page before the filter, so a phone's cursor passes a sealed event it did not get and leaves no gap; its sheets go through `sheetFor`. No state: the lint "server.ts keeps no room state of its own" holds. One owner read more per player poll. sync.ts's `fetchApi` sends the token on a player's poll too (today only with a body).

A player's phone loses nothing it used: it never read another player's sheet (`remoteSheets` is the GM's only) and never applied an event not for its hunters. It gains the faces, which the Give window reads (section 6).

### 4.2 The messages

```ts
/** A player's private word to the GM. Sealed: only the GM's phones and the sender's phone get it. */
export type WordPayload = Base & { by: SheetKey; name: string; text: string };
// DEFS.word: { gmOnly: false, ownSheet: true, sealed: always }. Reader: name text(60), text filled(WORD_MAX). Applier: null.
/** The GM's answer to word `re`, for its hunter only. Sealed. */
export type WordBackPayload = Base & { to: [SheetKey]; re: EventId; text: string };
// DEFS.wordBack: { gmOnly: true, ownSheet: false, sealed: always }. Applier: once, a `land` into the thread, and a window.
/** The longest word or answer: a few sentences typed on a phone, as long as a quest's description. */
export const WORD_MAX = 500;
```

### 4.3 Where the GM reads it and answers

A GM view section, "Words from players", right after the Party board, open by default while a word is unread, with the head summary "2 new". Each word is a line: the hunter's name, the time, the text, and "Answer". Answer opens a field under it and "Send answer". A word is a session log line of the new kind `word`, written once by its id on the GM's phone (`sync.once`, the recipe "A use the GM should hear of"); an answer is a line of kind `answer` in the answer's own write (`wordAnswered`: the line and the `wordBack` letter, one write). The section reads the log's word lines after the device pref `wordsSeen`, as "Reward uses" reads `usesSeen`. A hidden GM page is notified by `src/edge/notify.ts` as for a use ("Mira sent you a word.").

### 4.4 What the player sees

The Room view gains a section "Word to the GM": a text field, "Send to the GM", and the thread under it: this hunter's words and the GM's answers in this room, newest last, at most 20 (`settings.sync.words`: id, room, hid, time, text, `from: 'me' | 'gm'`; a repair line). A word the player sent reads "Sent." or "Waiting for the room." from the outbox (`postNews`). An answer opens a window once ("! GM", title "FROM THE GM", the text) and joins the thread.

### 4.5 What "private" means

Hidden, and from whom:

- Another player's phone never downloads a word or an answer, so it is in no other player's storage, memory or network traffic.
- A player who looks at the GM's screen sees what is on it. The app cannot help that.

Not hidden:

- Every phone that holds the room's GM key gets every word: that is who it is for.
- The server stores it as plain JSON in its database for the room's life (30 days after the room's last use; on the memory store, among the room's last 2000 events). Whoever runs the server can read it. It is not encrypted.
- The GM's session log keeps it, so it is in the GM's campaign file, its daily backup and any copy the GM exports.
- The sender's phone keeps its thread.

The Room view's section says it in one line: "Only the GM sees these. The room's server stores them."

## 5. A secret objective

### 5.1 What exists, and what is missing for it to be secret

The GM's `quest` message already goes to the hunters the GM picks; the player's phone lands it as a quest from the GM, which the player may not edit or delete (`mayChangeQuest`) and whose progress and end it reports (`questUpdate`, `reportsProgress`); its reward is paid on the player's phone when it is completed. What is missing:

1. The `quest` event reaches every phone in the room (section 0).
2. The quest sits in its hunter's pushed sheet, which reaches every phone.
3. Each `questUpdate` reaches every phone.
4. Issue quest can pick several hunters, and the event names each of them.
5. Nothing tells the player it is secret, so the player cannot keep it so at the table.

### 5.2 A quest with one more field

| | (a) A field of the quest | (b) A thing of its own | (c) Hidden on the player's screen only |
|---|---|---|---|
| What it is | `Quest.secret`, and the seal of 4.1 on its two messages | A `Secret` with its own message, list, progress and reward | The quest card hides it from a glance |
| Reuses | The quest's machine, rights, progress reports, due time, reward, the issue form | Nothing; each of those again | Everything, and hides nothing on the wire |

**Picked (a).** Points 1 and 3 are the seal (`quest` and `questUpdate` are sealed when the quest is secret); point 2 is the faces (4.1: another player gets a sheet only as its face, which holds no quests); points 4 and 5 are below.

- `Quest.secret: boolean`, default false in the quest's factory (`questOf`), kept only for a quest from the GM, a repair line; `QuestOffer.secret`. The reader refuses a secret quest whose `to` names more than one hunter: a secret objective is one hunter's.
- `QuestUpdatePayload.secret`, copied from the quest by the player's phone, so the update is sealed too.
- Issue quest (gm.js, on the one quest builder story unit 2 made) gains a box, "Secret: only this hunter and you see it"; ticked, the hunter picker takes one hunter.
- The player's quest card shows a chip "Secret" and the line "Only you and the GM see this quest."
- The GM's list of the players' quests (quests.js) and its session log lines mark it "(secret)".

Its reward is the quest's own, given as any quest's on completion. It ends as any GM quest ends: completed, failed or past its due time, and the GM reads the end in the sealed `questUpdate`. The others learn nothing from the app: the quest, its progress, its end and its reward land only on the hunter's own phone, and a title the reward gives is on a sheet only the GM and that phone get whole. If the GM wants the table to know, the System broadcast is there. Question 4 asks the owner whether the app should tell the table when a secret objective ends.

A story's chapter (`chapter`, stories unit 4) is still downloaded by every phone; the seal could cover it later with one line of `DEFS`. Not in this feature.

## 6. The players' use at 360 and 390 px, counted in taps

### 6.1 Where each thing lives

On a player's phone, everything about goods stays in the Bag (the Status view's Bag panel), where the goods already are:

- **The Bag's tabs** become Items, Offers, Stash, Shop (a `.seg` of four one-word buttons; Offers shows its count when something waits, "Offers (1)").
- **Give** on each unworn item's row, and **Give gold** on the gold line. Both open the Give window.
- **The Give window** (`app.api.trade.give(hid, pick)`, a new module `src/views/trade.js`): "How many" for a stack; "To", one chip a hunter (the room's other hunters from their faces, marked "In the room"; this phone's other hunters, marked "On this phone") and one chip "Party stash"; for a room hunter, a folded group "Ask in return" with "Gold" and that hunter's unworn bag lines as chips; Cancel left and the action right, its label following the choice ("Offer to Mira", "Give to Eldrin", "Put in the stash"). One window for an offer, a hand over on the same phone and a put, because the player's question is the same ("who gets this?").
- **The Offers tab**: "Offers to you" (each with what it gives and asks, Accept and Refuse) and "Your offers" (each with its state line and Take back).
- **The Stash tab**: the stash as the doc shows it, with its time, Take on each line and Take gold; under "Waiting", this hunter's asks.
- **An offer arriving** is a toast, not a window ("Brakk offers you 1 Healing Potion. See your Bag, under Offers."): it needs no answer now, and a window would cover a fight's turn (A4).
- **The Room view** gains "Word to the GM": the field, Send to the GM, the thread.
- **A quest card** shows the Secret chip.

On the GM's phone, two sections of the GM view, right after the Party board: "Words from players" and "Trades and stash" (open offers with Stop, the Trading switch, the stash with Remove). Both are drawn by their own modules (`src/views/words.js`, `src/views/trade.js`), so gm.js gains two section shells and two calls. The Make row stays five buttons.

### 6.2 The counts

From the Status view with the Bag panel on screen; one tap more from another view (the Status tab). Typing, and the tap that puts the cursor in a field, are not counted. Scrolling is not a tap.

| Task | Taps | The taps |
|---|---|---|
| Offer an item to another hunter | 3 | Give on its row; Mira; Offer to Mira |
| The same, for a price in gold | 4 | Give; Mira; Ask in return; Offer to Mira (the gold typed) |
| The same, for one of Mira's items | 5 | Give; Mira; Ask in return; her Iron Shield; Offer to Mira |
| Offer gold | 3 | Give gold; Mira; Offer to Mira (the amount typed) |
| Accept | 2 | Offers; Accept. An offer that asks something back is held two seconds under Undo after the tap, with no third tap |
| Refuse | 2 | Offers; Refuse |
| Take an offer back | 2 | Offers; Take back |
| Give to a hunter on the same phone | 3 | Give; Eldrin; Give to Eldrin |
| Put an item in the stash | 3 | Give; Party stash; Put in the stash. A phone alone with one hunter: 2 (the stash is the only choice and is picked) |
| Take one out of the stash | 2 | Stash; Take. From a stack of more than one: 3 (Stash; Take; Take, the window's count preset to 1). Gold: 3 (Stash; Take gold; Take, the amount typed) |
| Send the GM a private word | 2 | The room button at the top; Send to the GM (the word typed) |
| Read the GM's answer | 1 | The window opens by itself; OK |

The GM, with the GM view open and the section open:

| Task | Taps | The taps |
|---|---|---|
| See every open offer and the stash | 0 | The section lists them |
| Stop an offer | 1 | Stop, held two seconds under Undo |
| Turn trading off or on | 1 | Off (or On) |
| Remove a stash line | 1 | Remove, held two seconds under Undo |
| Read a word | 0 | The section shows it, open while a word is unread |
| Answer a word | 2 | Answer; Send answer (the answer typed) |
| Issue a secret quest | today's taps and 1 | The Secret box |

Accept is one tap after the tab because the offer's line already says what each side gives; a confirm would ask the same thing twice. An exchange gives something away, so its write is held under Undo (the recipe "A write a stray tap should be able to stop"), as Give… on the GM's board is. A gift's accept gives nothing away and is written at once. An offer is sent at once: the Give window was its look before the tap, and Take back undoes it while it is open.

At 360 and 390 px the flows are the same. What changes at 360: the four Bag tabs are about 80 px each and fit; the Give window's hunter chips wrap to a second line with three or more hunters; the item row gains a fifth control (Use, Equip, Sell, Give and the remove mark). The unit adds a case to `tests/e2e/look.e2e.ts` at both widths: the row fits without sideways scroll and every control is 44 px; if the row does not fit at 360, Sell and Give move into the item's detail under its name (`app.api.detail`) and the counts above gain one tap. Each new screen is a step in `scripts/ui-shots.ts` (the Give window with Ask in return open, the Offers tab with one of each state, the Stash tab with a waiting put, the Room view's thread, the GM's two sections).

## 7. Words

Every label, hint, window and refusal below is plain and literal (`copy-tasks.md`, Plain first). A unit that adds a line runs `humanizer` and `unslop` on it, and the lead reads it second before the push. Names are the glossary's: hunter, bag, gold, GM, room, quest, stash. New rows for the glossary, in unit 4's commit: "A hunter's goods handed to another through the room: offer (Offer to Mira, Accept, Refuse, Take back); not trade request, proposal"; "The party's shared goods: the stash, the party stash (Put in the stash, Take); not vault, bank, shared inventory"; "A player's private message to the GM: a word to the GM (Send to the GM, Words from players); not message, DM, whisper"; "A quest only its hunter and the GM see: a secret quest (Secret); not hidden quest".

| Where | Words |
|---|---|
| The Bag's tabs | "Items", "Offers", "Stash", "Shop"; with a count "Offers (2)" |
| The Bag's rows | "Give" (aria "Give Healing Potion"); the gold line "Give gold" |
| The Give window | tag "Trade"; title "Give Healing Potion" / "Give gold"; "How many" with "You have 3."; "Gold" with "You have 150 gold."; "To"; a chip's second line "In the room" / "On this phone"; the chip "Party stash"; "Ask in return"; its "Gold"; "From Mira's bag"; the hint for an offer "Mira accepts or refuses. Your things wait aside until then."; the hint for the stash "Anyone in the room can take it out."; buttons "Cancel", "Offer to Mira", "Give to Eldrin", "Put in the stash" |
| An offer arriving (toast) | tag "Trade"; "Brakk offers you 1 Healing Potion. See your Bag, under Offers." |
| The Offers tab | "Offers to you"; "Your offers"; "No offers."; an offer's line "Brakk offers 1 Healing Potion" then " for 20 gold." / " for your Iron Shield." / "."; buttons "Accept", "Refuse", "Take back"; an exchange's held toast "You give 20 gold for 1 Healing Potion." with "Undo" |
| Your offer's state line | posting "Waiting for the room."; open "Waiting for Mira."; withdrawing "Taking back. If Mira accepts first, it is hers."; stranded "The room closed before this offer ended." |
| Your answer's state line | accepting "Accepted. Waiting for the room."; refusing "Refused. Waiting for the room."; stranded "The room closed before your answer was settled." |
| A stranded record's window | tag "Trade"; title "Take back?"; giver: "The room closed before this offer ended, so the app cannot tell whether Mira accepted. If she did, she has the Healing Potion too. The GM's session log shows every trade that ended."; taker: "The room closed before your answer was settled, so the app cannot tell whether Brakk got your 20 gold. The GM's session log shows every trade that ended."; buttons "Cancel", "Take back" |
| An end, the giver's toast | settled "Mira accepted. You gave 1 Healing Potion and got 20 gold."; refused "Mira refused your offer. The Healing Potion is back in your bag."; withdrawn "You took back your offer. The Healing Potion is back in your bag."; stopped "The GM stopped your offer to Mira. The Healing Potion is back in your bag."; void "Your offer to Mira ended without a trade. The Healing Potion is back in your bag." |
| An end, the taker's toast | settled "You got 1 Healing Potion from Brakk and gave 20 gold."; withdrawn "Brakk took back the offer of 1 Healing Potion."; the same, after this phone accepted "Brakk took back the offer before your answer reached the room. Your 20 gold is back."; stopped "The GM stopped Brakk's offer."; refused "You refused Brakk's offer."; void "Brakk's offer ended without a trade." |
| Refusals (`OFFER_REFUSAL_WORDS`) | off "Trading is off for this table."; fight "A fight holds this hunter. Finish it first."; no-item "You no longer have the Iron Shield."; worn "Take off the Iron Sword to give it."; poor "You have 15 gold. This needs 20."; empty "Pick something to give."; too-large "These items are too large to send in one offer. Give fewer."; too-many "You have 10 offers waiting. Take one back first."; not-open "This offer has already been answered."; no-room "Offers need a room. Join one with the room button at the top."; not-played "Only the hunter you play in this room can trade there." |
| The Stash tab | "Party stash"; "As of 21:04."; "Puts and takes wait for the GM's phone." (while the GM's phone is away); "The GM's phone answers in the order asks arrive."; "Gold: 120"; a line "Healing Potion × 3" with "Take"; "Take gold"; "The stash is empty."; "Waiting"; a waiting ask "Waiting for the GM's phone."; a stranded put "The room did not take this, so the app cannot tell whether the stash has it. Look at the stash first." with "Take back" |
| The take window | title "Take Healing Potion" / "Take gold"; "How many" with "The stash has 3." / "How much" with "The stash has 120 gold."; buttons "Cancel", "Take" |
| A stash answer (toast) | kept "In the stash: 2 Healing Potions."; given "From the stash: 1 Healing Potion."; gone "The stash has no Healing Potion left."; short "The stash has 1 Healing Potion, fewer than you asked for."; full "The stash is full. It holds 40 kinds of item."; off "Trading is off for this table."; after a refused put, a second sentence "Your Healing Potion is back in your bag." |
| GM view, "Trades and stash" | head summary "3 open · stash: 5 kinds"; "Trading" with "On", "Off"; "Open offers"; a line "Brakk offers Mira 1 Healing Potion for 20 gold." with "Stop"; "No open offers."; Stop's toast "Stopped Brakk's offer to Mira." with "Undo"; "Party stash"; "Gold: 120"; a line with "Remove"; Remove's toast "Removed 3 Healing Potions from the stash." with "Undo"; "The stash is empty." |
| The GM's session log (kind `trade`) | "Brakk gave Mira 1 Healing Potion for 20 gold."; "Mira refused Brakk's offer."; "Brakk took back an offer to Mira."; "You stopped Brakk's offer to Mira."; "Brakk's offer to Mira ended without a trade."; "Mira put 2 Healing Potions in the stash."; "Eldrin took 1 Healing Potion from the stash."; "You removed 3 Healing Potions from the stash." |
| The GM's Remove from room window (room.js), one line more when the hunter has open offers | "Brakk's open offers stay put aside until Brakk is back in the room. Stop them first to give Brakk's things back on its next visit." |
| The Room view, "Word to the GM" | "Word to the GM"; "Only the GM sees these. The room's server stores them."; "Your word"; "Send to the GM"; "Nothing sent yet."; a thread line "You, 21:04" / "GM, 21:06"; "Sent." / "Waiting for the room."; refusals "Words to the GM need a room." and "Write something first." |
| The GM's answer (window) | tag "! GM"; title "FROM THE GM"; body the answer |
| GM view, "Words from players" | "Words from players"; head summary "2 new"; a line "Mira, 21:04"; "Answer"; "Your answer"; "Send answer"; "Sent to Mira."; "No words yet."; the notification "Mira sent you a word." |
| The GM's session log (kinds `word`, `answer`) | "Mira: (the word)"; "You to Mira: (the answer)" |
| A secret quest | Issue quest's box "Secret: only this hunter and you see it"; refusal "A secret quest goes to one hunter."; the quest card's chip "Secret" and line "Only you and the GM see this quest."; the GM's marks "(secret)" |

## 8. The cut into units, the guide's rows, the charts, and the owner's part

Each unit is whole with its tests and leaves the app working; each closes with its AGENTS.md rows, `bun run deps -- --write`, and `bun run charts` where a machine changed. The order puts the hardest proof first (units 1 and 2: the trade's settle, in core and then in the room model), then what the screens stand on (unit 3), then the screens.

### Unit 1: goods, the offer, its one end, each phone's record (core only)

- Files: `src/core/ids.ts` (`OfferId`, `parseOfferId`, `endIdOf`); new `src/core/trade/goods.ts` (`Goods`, `Pick`, `setAside`, `received`, `fits`, `handOver`, `goodsSize`, `GOODS_LINES`, `OFFER_MAX`, `OfferRefusal` and its words); new `src/core/trade/offer.ts` (`Offer`, `End`, `outcomeOf`, `OfferRecord` and its three state unions, `GIVER`, `TAKER`, `WATCH`, `recordStep`, `offersSeen`, `lettersKept`, the toasts' and the log's words); `src/core/protocol.ts` (`offer`, `offerEnd`, `offerStop` with their readers and the end id rule; `offerEvent`, `newEvent` with room for the suffix); `src/core/save.ts` (`settings.sync.offers`, its parser and repair line); `src/edge/room-events.ts` (the three appliers `null`, with the comment that the fold reads them).
- Tests: `tests/offer.test.ts` (new): `outcomeOf`'s table of 1.4 written from the rule; every cell of the three tables; "an offer and its end in one page create nothing on a taker's phone"; "a page read twice ends each record once"; a random walk of two phones' records against a fake room log (one end per offer, ends taken in random order, pages read in random splits, reloads, room gone), checking rules 1 to 4 of 1.8 after every step and the rest rule at its end. `tests/goods.test.ts` (new): `setAside` and `received` round trip (the whole hunter compared, the recipe "A control that undoes another"), a worn item refused, a stack split, gold within what is held, `goodsSize` of known bytes and its bound. `tests/protocol.test.ts`: the three payloads in `VALID`, a case per bound, "an end whose id is not its offer's end id is refused", the worst offer by part against `OFFER_MAX`. `tests/server-rooms.test.ts`: "an offer ends once: a withdraw with the accept's id answers the accept's seq and the room holds one end" (both stores), "only the giver may post its offer", "a stop needs the GM key".
- Measures, before it lands: the largest item `ITEM_BOUNDS` and the effect parser allow, as JSON in UTF-8; `GOODS_LINES` of it with the payload's wrapper must be under `OFFER_MAX`. Written before it runs: if eight lines do not fit, `GOODS_LINES` comes down to what fits, and these notes say to what.
- Deletes: nothing.

### Unit 2: the room settles a trade (sync.ts and the room model)

- Files: `src/edge/sync.ts`: the fold on every good poll over the whole page, own echoes included, in the same write as the cursor; the join's head collects the three types from its history pages and folds them once live (`from: 'history'`); `boxDo`'s `heard` raises `tried` and `taken` on the offer records; the link's `gone` steps the room's records; a record's leftover letters dropped in its ending write. `src/edge/store.ts`: `store.apply` runs `lettersKept` after every step, beside `noticed` (1.6). `tests/models/room-world.ts`: two players' token bags and gold, the offer records, the moves and rules of 1.8; `tests/room-system-model.test.ts`: the rules, the rest rule, and the race scenario by name.
- Tests: the model's; `tests/offer.test.ts` "a reload between the cursor and the fold reads the page again and moves nothing twice".
- The app works: nothing draws offers yet; a test posts them through `app.api.sync`.
- Deletes: nothing.

### Unit 3: the room's view for each phone (faces and sealed messages)

- Files: `src/core/protocol.ts` (`Viewer`, `servedTo`, `sheetFor`, `Face`, `FaceLine`, `FACE_LINES`, `RoomSheet` with faces, `parseSheet`, `EventDef.sealed`); `server.ts` (the viewer from the key or the device token, the filter, `next` and `more` from the unfiltered page); `src/edge/sync.ts` (the token on a player's poll; the faces kept for the Give window: `sync.faces()`); `src/core/api.ts`.
- Tests: `tests/server-rooms.test.ts`: "a player's poll carries other players' sheets as faces and its own whole", "a sealed message reaches the GM and its hunter's phone and no other", "a poll without a proven device gets faces and no sealed message", "the cursor passes a sealed message a phone did not get"; `tests/protocol.test.ts` (`servedTo` and `sheetFor` per viewer, a face's bounds); the room model still passes (the GM reads whole sheets).
- Deletes: nothing.

### Unit 4: trading on screen

- Files: new `src/views/trade.js` (`app.api.trade`: the Give window, the Bag's Offers tab, the GM's "Trades and stash" section without the stash, Stop, the switch) in `MODULES`; `src/views/inventory.js` (Give, Give gold, the tabs); `src/views/gm.js` (the section shell in `ORDER`, `PLAN2`, `PLAN3`); `src/views/room.js` (the Remove window's line); `src/core/rules.ts` and `overrides.ts` (`RULES.trade`, its reader); `protocol.ts` (`RoomRules.trade`); `src/core/hunter/build.ts` (`withRoomRules` reads it); `src/core/save.ts` (`LOG_KINDS` gains `trade`); `src/core/api.ts`; `scripts/ui-shots.ts`; `copy-tasks.md` (the glossary rows).
- Tests: `tests/e2e/trade.e2e.ts` (new): "Brakk offers Mira a Healing Potion and Mira accepts: it leaves his bag and lands in hers"; "an offer for 20 gold moves the gold the other way"; "Mira takes a potion for her Iron Shield"; "an accept and a take back at once: one wins, on both phones"; "the GM stops an offer and the potion goes back"; "with trading off, Give offers no hunter in the room"; "a reload between the offer and the room keeps the potion aside and sends it once"; "Mira's phone offline accepts later and gets it"; "Brakk gives Eldrin a potion on the same phone in one tap more"; the GM's log lines. `tests/e2e/look.e2e.ts`: the Bag's row with Give and the four tabs at 360 and 390; the Give window with Ask in return open. `tests/rules.test.ts`, `tests/overrides.test.ts`, `tests/build.test.ts` for the switch.
- Deletes: nothing.

### Unit 5: the party stash

- First step: `src/core/gates/solo-wait.ts` becomes `src/core/sync/asked.ts` (`Asked` with its two kinds, `settings.sync.runs` becomes `settings.sync.asked`), every caller moved (sync.ts, room-events.ts, gates.js, solo.ts, the room model, `scripts/charts/solo.ts`), the old module deleted; the solo tests pass unchanged in what they check.
- Files: new `src/core/trade/stash.ts` (`Stash`, `StashAsk`, `stashPut`, `stashTake`, `stashTaken`, `stashRemove`, `stashDoc`, `stashRoute`, `STASH_LINES`, the refusals' words); `save.ts` (`Save.stash`, its default and repair); `protocol.ts` (`stashAsk`, `stashAnswer`, the `stash` doc, its reader and the size arithmetic); `room-events.ts` (`stashAnswer` land); `sync.ts` (the doc's publisher); `trade.js` (the Stash tab, the GM's stash list and Remove, the GM's `stashAsk` handler); `scripts/charts/` (the asked machine's chart under its new name).
- Tests: `tests/stash.test.ts` (new): put and take round trip on a phone alone; the GM's answers in order ("two takes of the last potion: the first given, the second refused gone"); each refusal; a put lost before a try comes back, after a try is stranded. `tests/asked.test.ts` (the solo-wait tests moved, plus the put's rule). `tests/protocol.test.ts` ("the worst-case stash doc on the wire"). `tests/applied.test.ts` ("a stash answer lands once, only while its ask waits"). The room model: the moves "put", "take", the GM's answer, and the rule "a stash line is given at most once". `tests/e2e/stash.e2e.ts` (new): "Mira puts two potions in the stash and Eldrin takes one"; "two players take the last potion: one gets it, the other is told"; "with the GM's phone away, a take waits and is answered when it is back"; "the GM removes a line".
- Measures: the worst stash doc against `DOC_MAX` (3.2), before the cap is trusted.
- Deletes: `src/core/gates/solo-wait.ts`.

### Unit 6: a private word to the GM

- Files: `protocol.ts` (`word`, `wordBack`, sealed); new `src/views/words.js` (the Room view's section, the GM's section, `wordsSeen`) in `MODULES`; `room.js` and `gm.js` (the shells); `save.ts` (`settings.sync.words`, `LOG_KINDS` gains `word` and `answer`); `room-events.ts` (`wordBack` land); `src/edge/notify.ts` (the word's notification).
- Tests: `tests/protocol.test.ts`, `tests/server-rooms.test.ts` ("a word reaches the GM and not the other player"); `tests/applied.test.ts` ("an answer lands once in the thread"); `tests/e2e/words.e2e.ts` (new): "Mira sends the GM a word and the GM answers; Brakk's phone never holds either" (read from Brakk's save and from the requests its page made).
- Deletes: nothing.

### Unit 7: a secret objective

- Files: `save.ts` (`Quest.secret`, default and repair); `quests.ts` (`questOf` keeps it from the GM only); `protocol.ts` (`QuestOffer.secret`, the one-hunter rule, `questUpdate.secret`, the seal); `gm.js` (the box on Issue quest); `quests.js` (the chip, the GM's mark).
- Tests: `tests/quests.test.ts`, `tests/save.test.ts`, `tests/protocol.test.ts` (a secret quest to two hunters refused); `tests/server-rooms.test.ts` ("a secret quest and its progress reach only its hunter and the GM"); `tests/e2e/quest-secret.e2e.ts` (new): "the GM gives Mira a secret quest: Mira sees it marked Secret, Brakk's phone never receives it, and the GM reads Mira's progress".
- Deletes: nothing.

### The rows for AGENTS.md

| Question | The one place | Test to copy |
|---|---|---|
| What a hunter hands over (gold, items by value), taking it out of a bag and putting it in, a hand over on one phone | `src/core/trade/goods.ts` (`Goods`, `Pick`, `setAside`, `received`, `fits`, `handOver`, `goodsSize`, `OFFER_MAX`) | `tests/goods.test.ts` |
| An offer between two hunters in a room: its one end (the room takes one event id per offer, `endIdOf`), how it came out (`outcomeOf`), each phone's record of it (the giver's, the taker's, the GM's) and the goods aside in it | `src/core/trade/offer.ts` (`Offer`, `End`, `outcomeOf`, `OfferRecord`, `GIVER`, `TAKER`, `WATCH`, `recordStep`, `offersSeen`), the save's `settings.sync.offers`; the messages `offer`, `offerEnd`, `offerStop` (`protocol.ts`); read by the fold in sync.ts on every page, own events included, and from a join's history; notes `docs/agent-handoff/features/notes-5-trade.md` | `tests/offer.test.ts`, `tests/server-rooms.test.ts` ("an offer ends once"), `tests/room-system-model.test.ts` |
| Trading on screen: the Give window, the Bag's Offers tab, the GM's Trades and stash section, Stop, the switch | `src/views/trade.js` (`app.api.trade`); `RULES.trade`, `RoomRules.trade` | `tests/e2e/trade.e2e.ts` |
| The party stash: what it holds, a put and a take, the GM's phone's answer, the doc players read | `src/core/trade/stash.ts` (`Stash`, `StashAsk`, `stashPut`, `stashTake`, `stashTaken`, `stashRemove`, `stashDoc`, `stashRoute`); `Save.stash`; `stashAsk`, `stashAnswer`, the `stash` doc | `tests/stash.test.ts`, `tests/e2e/stash.e2e.ts` |
| A letter waiting for the GM's phone's answer (a solo run's, a stash ask's) | `src/core/sync/asked.ts` (was solo-wait.ts), `settings.sync.asked` | `tests/asked.test.ts` |
| What each phone gets of the room: a sealed message only the GM and its hunters, another player's sheet only as its face | `servedTo`, `sheetFor`, `Face`, `EventDef.sealed` in `protocol.ts`; the viewer in server.ts's poll route | `tests/server-rooms.test.ts` |
| A private word to the GM and its answer | `word`, `wordBack` (sealed); `src/views/words.js`; the GM's log kinds `word` and `answer`; `settings.sync.words` | `tests/e2e/words.e2e.ts` |
| A secret quest | `Quest.secret`, `QuestOffer.secret`, the seal on `quest` and `questUpdate` | `tests/e2e/quest-secret.e2e.ts` |

Recipe lines: "A room message" gains "a message only the GM and the hunters it names may get is `sealed` in its `DEFS` entry (`servedTo`), with a case in `tests/server-rooms.test.ts`"; a new recipe, "A message that ends another once": "its id is made from the other's (`endIdOf`), its reader refuses any other id, so the room keeps the first; each phone reads it by a fold guarded by a record of its own, never by the applied ring". The machines' list gains the offer in the room, the giver's and the taker's records (`trade/offer.ts`), and renames the solo run waiting to a letter waiting for the GM's answer (`sync/asked.ts`).

### The charts

Sections 1.5 and 1.6 are drawn by hand, because the `statechart` skill's TLC run needs the network and this phase runs nothing. Unit 1's `scripts/charts/trade.ts` draws three machines from the real `recordStep` with walk events in `tests/models/trade-events.ts` (an offer, an accept, a refuse, a take back, a stop, tried, taken, a letter let go, a room gone, a take back of a stranded record), each an entry in `MACHINES`: "An offer in the room" (Open and its five ends), "The giver's side of an offer" and "The taker's side of an offer". Refused steps stay in their state and are not drawn. Unit 5 renames the solo run's chart.

### A finding for the lead (read, not run)

A join pages the room's whole history and drops it (sync.ts, `case 'head'`), so every message posted to a player while its phone was out of the room is never applied after it rejoins: an award, a quest, a solo answer. The solo runs' waiting record stays "taken" for good in that case. This design reads the history for offers (1.9) because their land is guarded by a record. Proposed, as its own unit for the lead to place: the head's history fold also reads answers to this phone's waiting asks (solo and stash), which the asked record guards; messages guarded only by the applied ring stay as they are, and the Room view says on rejoin that messages sent while away are not delivered, until a fix with a record per message is designed.

### For `for-the-owner.md` (each written by the unit that lands it)

- Players trade through the room without the GM's phone: an offer finishes as soon as each phone reads the room. The GM sees every open offer, can stop any, and reads each trade in the session log. He would say "I approve every trade" to make each wait for his tap.
- Trading has an On and Off switch for the table, in the GM view.
- A Resurrection Crystal can be given, sold to another player and put in the stash. It moves; it is never made. He would say "crystals cannot be traded" to stop it.
- A down or dead hunter can still give and receive.
- If the room closes before an offer ends, the app cannot tell whether the other player accepted. The player can take the things back after a window that says so, and the GM's log shows what happened. He would say "never give back" to make the things stay put aside.
- The party stash belongs to the campaign (the GM's save), not to the room, so a new room keeps it. Taking out waits for the GM's phone, first come first served.
- The GM's own hunters do not trade with players' hunters in a room; the Award form gives them things as today.
- A private word is seen by the GM only, among the people at the table. The room's server stores it unencrypted, and the GM's session log and campaign file keep it.
- A secret quest goes to one hunter. Nobody else at the table is told anything by the app, even when it ends. He would say "tell the table when a secret quest ends" to change it.

### Questions only the owner can answer, with the default taken meanwhile

1. Should the GM approve each trade before it happens? Default: no. The GM sees each open offer, can stop it, and reads each trade in the log.
2. May a Resurrection Crystal be traded and put in the stash? Default: yes.
3. When the room closes with an offer unfinished, may the player take the things back, knowing the other player might have them too? Default: yes, after a window that says so.
4. When a secret quest ends, should the app tell the rest of the table? Default: no.
5. Should the GM be able to put a fight's loot straight into the stash? Default: not in this feature; the GM awards it to a hunter, who puts it in.

## 9. Decision trail, and the principles read

### 9.1 Decision trail (`show-me-your-work`, kept here since this phase writes one file)

| # | Decision | Why | Evidence |
|---|---|---|---|
| 1 | A trade is settled by one end per offer that the room takes once, its id made from the offer's | Each bag has one writer; the only shared write is the decision, and the room already serializes event ids | 1.2, 1.3; server.ts `addEvent`, the unique index `(room, eid)` |
| 2 | Not the GM's phone, not the server, not the giver's phone | A third device in every two-player trade, its hidden tab may not poll; domain state in the server; the taker waiting on the giver's phone | 1.3; link.ts `hiddenWait` |
| 3 | Goods go aside in the giving phone's record, by value, from the tap's write until its phone reads the end | An offered item cannot be sold, used or worn; every unit of goods has one place to be counted | 1.4, 1.8 |
| 4 | Every outcome but settled sends goods back; a junk end is void | One rule on every phone; a junk end can cancel and never gain | 1.4 `outcomeOf` |
| 5 | The end's reader refuses an id that is not its offer's end id | The server never stores a mismatched end, so "the end of X" is one event | 1.4 |
| 6 | `heard` (queued, tried, taken) is stored on the record | Only a letter never sent is provably not in the room; it decides "goods back" against "wait" | 1.6; outbox.ts, solo-wait.ts's evidence rule |
| 6b | A never-sent letter let go gives its goods back in the write that let it go, by a step the store runs after every step (`lettersKept`) | Many writers can drop a letter; the solo runs read "lost" without a write because nothing comes back, and goods must | 1.6; store.ts runs `noticed` the same way |
| 7 | Take back works whether or not the room has the offer | It posts the end id either way; the room's one slot decides | 1.6 |
| 8 | An accept cannot be taken back; Stop is the way out of a stuck one | The accept may already be the end | 1.6, 2.1 |
| 9 | The fold reads own echoes, a page as a batch, in the cursor's write | A phone learns its own end won only by reading it; a batch keyed by ids is safe to read twice | 1.9; sync.ts `apply` |
| 10 | A join reads the offers' history its head already downloads | A removed giver ends its offers on its return; the head pages all history and drops it today | 1.9; sync.ts `case 'head'` |
| 11 | The room gone strands what the app cannot know; Take back behind a window | Two generals: no design can know; the app never chooses the doubling, the player may, told why | 1.10 |
| 12 | The GM sees, stops and reads; no approval by default | Stop ends any stuck offer; approval brings back the third device | 2.1; question 1 |
| 13 | The switch gates taps, never the fold | Docs are not ordered with events; two phones could read it differently | 2.2 |
| 14 | The stash is on the GM's save, asked of and answered by the GM's phone | It is campaign state like the world list; one writer; survives a new room | 3.1 |
| 15 | The solo runs' waiting record becomes "a letter waiting for the GM's answer", with a stash kind | One machine for one kind of wait | 3.3 |
| 16 | The stash shares goods and the waiting ask, not the offer's machine | The stash is no hunter and its phone no party | 3.6 |
| 17 | The server cuts each poll for its viewer: sealed messages, faces | A private word and a secret quest are otherwise in every phone; a filter with no state | 4.1 |
| 18 | Faces carry the bag's unworn lines | An offer may ask for one of the other's items | 4.1, 1.4 `Pick` |
| 19 | A private word is a session log line on the GM's phone and a short thread on the player's | The log is the GM's record and travels with the campaign; "Reward uses" is the pattern | 4.3, 4.4 |
| 20 | A secret objective is a quest with one more field and the seal | Everything else a quest does is reused | 5.2 |
| 21 | Everything about goods lives in the Bag; one Give window for an offer, a hand over and a put | The player's question is "who gets this"; one place to look | 6.1 |
| 22 | Accept is one tap; an exchange's accept is held under Undo; an offer is sent at once | The line already says what each side gives; Take back undoes an offer | 6.2 |
| 23 | Units: core, the room, the view per viewer, the screens, the stash, words, secret | The hardest proof first, then what the screens stand on | 8 |

### 9.2 Principles read, and the choice each changed

- `principle-separate-before-serializing-shared-state`: the first question of the design. The bags stay unshared (one writer each); the goods travel by value in messages one phone lands; the one shared write, the decision, is serialized structurally by the room's unique event id instead of by a lock or a third phone. It removed variant (a) and (b) of 1.3 as defaults.
- `principle-foundational-thinking`: "what happens if another actor modifies this concurrently?" asked of the bag, the decision, the stash and the switch; the answer made the stash a single-writer thing on the GM's save and kept the switch out of the fold. Data shapes first: sections 1.4 and 3.2 before any table.
- `principle-make-operations-idempotent`: every move happens in the write that ends its record, so a repeat finds nothing; the fold reads a page as a set keyed by ids; `heard` is stored evidence that stays true wherever a write stopped, which decides "back" against "wait" without guessing.
- `principle-model-the-domain`: each side's record is a union with a table, not flags; the outcome is a pure function of an offer and its one end; the room's machine is drawn even though the room makes it trivial, so a reader sees why there is no race; the waiting ask is one machine for two kinds.
- `principle-type-system-discipline`: `OfferId` is its own id, made and read by its own parser, and the end id is derived from it, never typed by hand; the stores of goods (`Goods` by value, `Pick` by reference) are two types for two meanings.
- `principle-boundary-discipline`: the end id rule is in the end's reader, which the server already runs, so a mismatched end never enters the room; the poll's cut per viewer happens at the server's edge in one pure function; the fold trusts parsed events.
- `principle-experience-first`: a trade between two players never waits for a third device; Accept is one tap; the offer arriving is a toast and not a window; the stash says how old it is when the GM's phone is away; the room-gone window says plainly what the app cannot know.
- `principle-subtract-before-you-add`: no new server code for the settle, no expiry (an open offer waits; Take back and Stop end it), no partial takes of a stash line, no approval by default, no second waiting machine (the solo one is widened), no encryption.
- `statechart`: its TLC run needs the network and this phase runs nothing, so 1.5 and 1.6 are drawn by hand with every cell; unit 1 draws them from the real step.
- `show-me-your-work`: the trail above, as a table in these notes (the repo's notes keep theirs so) and not a separate TSV, since this phase writes one file. The skill's cross-model review of the trail is the lead's to order: a helper starts no helpers.
- `unslop`: these notes and every line of section 7, written plain; section 7 still needs the second reader `copy-tasks.md` asks for, in the unit that adds each line.
- `poteto-mode`: the first line, the data shape first, variants weighed on paper (four in 1.3 and 3.1, three in 2.1, 4.1 and 5.2), contested choices flagged in the reply.

## 10. The lead's rulings (Nov 19)

The design is approved: a trade settles on the room's one end (1.3 d), with the goods aside on the giving phone from the tap's write and each phone writing its own half when it reads the end; the stash on the GM's save, answered by the GM's phone, with `solo-wait.ts` widened into one waiting machine (3); the room's view cut for each viewer by a pure function and no server state (4.1 a); a private word as two sealed messages (4.2); a secret objective as a quest with one more field (5.2); the tap counts of 6.2. The five questions keep their defaults and go to the owner in `for-the-owner.md`; none blocks a unit.

Changes and additions, each to be built as written here:

1. **An offer and its end are sealed** to the GM and the phones of the offer's two hunters (`sealed` on `offer`, `offerEnd`; the GM's `offerStop` reaches the same two). As designed, every phone in the room downloads every offer, so a third phone knows an open offer's id and can post an end under it for a hunter of its own; the server takes it (its `by` is its own sheet), `outcomeOf` reads it as Void, and the offer is ended for both players with the goods back. Nothing is doubled or lost, but a third phone can end any trade. Sealed, a third phone never learns the id. `tests/server-rooms.test.ts`: "a third player's phone gets neither an offer between two others nor its end". The Void outcome stays, since a phone that is one of the two can still send an end that does not fit.
2. **Order of units: 1, 3, 2, 4, 5, 6, 7.** The room's view (unit 3) lands before the room settles a trade (unit 2), so no build has unsealed offers in a room.
3. **The finding of section 8 is a fault today and gets its own unit before unit 2**, "unit 0: what a phone missed while it was out of the room". A join drops the room's history, so an award, a quest or a solo answer sent while a player's phone was out is never applied. Its helper writes the design first, in these notes (section 11), and hands it to the lead before any code: what a rejoining phone should land from the history and what it must not (a message already applied before it left; a message older than its own last cursor; a fight's `vitals` that a later one replaced), by what guard each is landed once (the applied ring holds a bounded number of ids: say what happens past it), and its cases in the room model. Until it lands nothing new says "sent while you were away is lost": the fault is fixed, not described.
4. **What a face shows.** A face carries each hunter's unworn bag lines so an offer can ask for an item. That shows every player the others' bags. It stays, as a question for the owner with this default; the GM's switch for trading turns the bag lines off with it (a table with trading off sends faces without bags).
5. **Take back after the room is gone** stays behind its window. Its words are read by the lead before the push.
6. **Each unit hands back to the lead** before the next starts. Unit 1's measurement (the largest goods against `OFFER_MAX`) is written into these notes with its numbers. The trade helper works in the worktree `/home/user/sg-trade`, local branch `trade`, by the same rules as the stories build (`brief-1-stories.md`, "The build"), with port 3360.

## 11. Unit 0: what a phone missed while it was out of the room (design, for the lead's review)

Goal: a message the room holds for a phone is landed on that phone once, whether or not the phone was in the room when
it was sent. Problem: a join reads the room's head and starts its cursor at the room's last seq, so whatever came while
the phone was out is skipped for good. Smallest change: the phone remembers, per room, the seq it had read up to when
it went out, and a join resumes reading from there through the one path every message already takes.

### 11.1 The fault, read in the code (not run)

The link's `head` call pages the whole history and keeps only its end (sync.ts `case 'head'`); `headed` makes the link
live at that end (link.ts `joining`). A reload does not go through it: the save keeps `room` and `cursor`, and `boot`
polls on from the cursor. Every other way back does, and each loses what came meanwhile:

| Way out and back | What the save keeps | What is skipped |
|---|---|---|
| A reload, the app closed, offline | `room`, `cursor` | nothing |
| Leave, then Join or the one-tap return | `room` null, `cursor` 0 (`stored`, idle) | everything from the leave to the join |
| Removed by the GM, then Allow back and Rejoin | the same (idle, `last.why` removed) | everything from the removal to the rejoin, and anything in flight at the removal |
| Into another room and back | the same | everything while in the other room |
| The GM's phone leaves its room and reopens it | the same, with the key in the ring | every player message meanwhile: a solo run never answered, a told use never logged, a coin call never held |

So a player's phone loses an award, a quest, an HP or status change, a vitals, a shadow, a chain step, noted facts and
a solo answer (whose waiting run then stays "taken" for good); the GM's phone loses players' claims it must answer.

### 11.2 What it must answer (ruling 3)

What a rejoining phone lands: every message for it after the last one it read in that room, in the room's order. What
it must not land: a message it read before it left (applied, refused or held), a message older than its own last cursor,
and a `vitals` a later one replaced. By what guard each lands once, and what happens past the applied ring's 200 ids.
Its cases in the room model.

### 11.3 Four ways, weighed

| | (a) A history fold beside the poll | (b) A record of every message landed | (c) The server keeps each phone's place | (d) The phone keeps its place, a join resumes from it |
|---|---|---|---|---|
| How | The head collects the history after a floor and a second path lands it (the fold of 1.9, widened to every type) | Each landed id kept for the room's life (a set per room in the save); a join re-reads the history from 0 and lands what the set lacks | The store keeps the last seq each proven device read; a head answers it, the join resumes there | At each way out, the save keeps the room's cursor (`seen[code]`); a join's head checks the key and the removal as today, and the link goes live at that cursor instead of the room's end |
| Lands through | A second path beside `applyHeld`: two ways to land one message | The appliers, with a second guard | The appliers, page by page, as live | The appliers, page by page, as live |
| Guard against twice | The floor and the ring | The set (unbounded: a 30-day room of awards grows the save) | The server's seq | The cursor (a seq is read once) and the ring for a page read twice |
| Order (`vitals`) | Must be rebuilt by the fold | Must be rebuilt | Kept | Kept: pages in seq order, as live |
| New state | A floor per room on the phone | A set per room | A store table and a write per poll (server.ts keeps none today; the lint holds it to the store) | A floor per room on the phone, written only when the phone goes out |
| Unit 2's join history fold (1.9) | Is this | Still needed | Not needed | Not needed: a returning giver reads its offer's end on its catch-up pages |

(a) is a second way to land a message, and must rebuild ordering and every applier's guard; (b) grows without bound and
still needs order; (c) puts a write in every poll and room state in the server for what the phone already knows (it
wrote the cursor). **Picked (d).** It changes where a join starts and nothing about how a message lands: the catch-up
is ordinary polling from an older cursor, with `more` making the link poll again at once (link.ts `polled`).

### 11.4 The data shape

```ts
// src/core/save.ts, room plumbing beside the cursor
/** Where this phone stopped reading each room it left: the room's cursor at the way out, and when (server time). */
export type Seen = Readonly<Record<RoomCode, { readonly seq: number; readonly at: string }>>;
// settings.sync.seen, default {}; a repair line drops an entry older than ROOM_TTL_MS and keeps at most SEEN_MAX (100)
```

Written in one place: the link's `save` effect (`linkSaved`), in the write that takes `room` from a code to null or to
another code, with the cursor the link held (`seen[old] = { seq: cursor, at }`). Removed when the link goes live in that
room again (the cursor carries on from there). A room gone (`gone`) drops its entry: nothing will be read from it.

Why entries expire with the room's life: a room lives 30 days after its last use (`ROOM_TTL_MS`), and this phone's last
poll was a use, so while an entry is younger than 30 days its code names the same room. Older, the room may be gone and
its code taken by a new room, whose seqs start again at 1; the entry is dropped. 100 is a bound for junk: a phone in a
new room every day for 30 days holds 30.

The link: `join` carries `from: number | null` (the save's `seen[code].seq`, read by sync.ts as it reads the GM key);
`Joining` keeps it; `headed` goes live at `from` when `from` is not null and not past the head's end, else at the end.
A first join, a forgotten room or an entry past the end (cannot happen while entries expire, guarded anyway) starts at the
end as today: no message for this phone can be in a room it was never in, because every key a message names is a sheet
key this phone pushed.

### 11.5 What lands, what does not, and the guard of each

| Message | Lands on the catch-up? | Guard |
|---|---|---|
| One sent while the phone was out, for its hunters (award, quest, hp, status, spent, revive, chain, shadow, noted) | Yes, in seq order, by its applier, exactly as live | The cursor: each seq after `from` is read once; the applied ring for a page read twice |
| One it read before it left (applied, refused by its applier, or held) | No | Its seq is at or before `from`, so it is never read again; a held one stays in `settings.sync.held` and is retried as today |
| One older than its own last cursor | No | The same: `from` is that cursor |
| A `vitals` a later one replaced | Lands, then the later one lands over it in the same catch-up | Seq order, as live; the hunter ends with the last totals. One exception, a finding read in the code and not run: a held (thrown) `vitals` is retried after newer pages and would put old totals back. Unit 0 drops a held `vitals` when a newer one for the same hunter lands (`unhold` by hunter) |
| A solo answer | Yes | Its waiting run (`runAnswered`), as live; the run no longer stays "taken" |
| The offer's end, its offer (unit 2) | Read by the fold on the catch-up pages | The record (1.9); the separate join history fold is no longer needed |
| A System window, a coin's landing | Yes | A window has no guard and needs none (once per seq); a landing goes to the coin table, which takes the first |
| On the GM's phone: a solo run, a told use, a coin call, a player's fight move | Yes, through `sync:event` as live | `sync.once` and its ring for the first three; a fight move by `onTurn` against the doc's `at`, which refuses a stale one |

Past the ring's 200 ids: the ring is not the guard of the catch-up. The cursor is, and it is written per page. The ring
covers a page read twice (a reload between a page's lands and its cursor write), and a page is at most `ROOM_PAGE` (200)
events. It can fall short in one case: a page of 200 lands plus held retries recording ids in the same reload window.
Unit 2 writes the cursor in the same write as the page's fold; unit 0 does the same for the appliers' lands (the page's
lands and its cursor in one `store.apply`), and then the ring is a second guard and never the only one.

The memory store (no `DATABASE_URL`) keeps a room's last 2,000 events: a phone away for longer than that resumes after
a gap and misses what fell off. Postgres, which the deploy uses, keeps every event while the room lives. Said in the
AGENTS.md row, not to the player.

### 11.6 What the player sees on the catch-up

Live, each message tells as it lands (a window for an award or a System message, a toast for HP). After a long absence
that is a cascade of windows. Proposed: while the link reads pages at or before the head's end (`catchingUp`, known
from the head), the appliers' tells are gathered and shown once as one window, "WHILE YOU WERE AWAY", a line each
("The GM gave Mira 120 XP.", "Quest: The Den (from the GM)."). Live tells are unchanged. Contested: the lead may prefer
each message's own window, which costs nothing to build.

### 11.7 The room model's cases

`tests/models/room-world.ts` gains `seen` in `PhoneSave` and the link's `from`; its `save` copies `linkSaved`'s new line.
Moves it has today cover the ways out (leave, removal and Allow back, the GM's reopen, another room). The rules:

1. At rest, every once-message to a player's key in a room is in that phone's ledger exactly once, from the phone's
   first join in that room, not only from its last (today's rule starts at `stretch.from`, the last join).
2. At rest, every solo run a player posted in a room the GM's phone is live in is answered exactly once.
3. A phone's hunter after a catch-up holds the totals of the last `vitals` to it (a new reduced counter in the model).
4. Never: a message landed twice (the ledger above 1) across any reload during a catch-up.

Scenarios by name: "an award sent while Mira's phone was out of the room lands once when she joins again", "a solo run
claimed while the GM's phone was away is answered when the GM opens the room again", "a reload in the middle of a
catch-up lands nothing twice".

### 11.8 The unit

- Files: `src/core/save.ts` (`Seen`, `settings.sync.seen`, its repair), `src/core/sync/bind.ts` (`linkSaved` writes and
  clears an entry), `src/core/sync/link.ts` (`from` on `join` and `Joining`, `headed` goes live at it; its chart),
  `src/edge/sync.ts` (reads `seen` for a join; the page's lands and its cursor in one write; the catch-up's gathered tells),
  `src/edge/room-events.ts` (a held `vitals` dropped by a newer one), `tests/models/room-world.ts`.
- Tests: `tests/link.test.ts` (a join with a floor goes live at it; one past the end at the end), `tests/bind.test.ts`
  (each way out writes the entry, a join clears it, a gone room drops it), `tests/save.test.ts` (the repair drops an
  entry older than 30 days), `tests/applied.test.ts` (a held `vitals` dropped by a newer one), the room model's rules and
  scenarios, and `tests/e2e/room-sync.e2e.ts` "an award the GM sent while the player had left lands when the player
  joins again" through the UI.
- Deletes: nothing in unit 0; unit 2 then needs no join history fold (1.9's second bullet), which shortens it.
- Before unit 2, as ruling 3 orders.

### 11.9 Choices the lead should look at

1. (d) over (a): the join resumes from where the phone stopped, instead of a fold of the history. It also removes the
   second way unit 2 had planned to read an offer's end.
2. A room a phone was never in, or forgot (past 30 days), starts at its end, as today. Argued safe above (no message can
   name a key this phone never pushed); the lead may want the head's history checked for this device's keys instead.
3. The catch-up's tells gathered into one window (11.6).
4. The ring stays 200 and is a second guard only, once the page's lands and its cursor are one write.

## 12. The build

### 12.1 Unit 1: goods, the offer, its one end, each phone's record (core only)

Goal of the unit: the pure core of a trade, proved by tests, before anything reaches a screen or the room's sync. The problem it solves: two hunters on two phones must both change or neither, and that rule has to hold in code a reader can run, not only in these notes. Smallest change: `src/core/trade/goods.ts` and `src/core/trade/offer.ts`, the three messages and their readers in `protocol.ts`, the records in the save, the appliers `null`, and the walk of section 1.8 in `tests/offer.test.ts`. Nothing in sync.ts, server.ts or a view.

Read for this unit, besides what the design read: the leaf skills `principle-model-the-domain`, `principle-type-system-discipline`, `principle-boundary-discipline`, `principle-make-operations-idempotent`, `principle-test-behavior-not-implementation`, `principle-explain-the-number`; `src/core/combat/fight-parse.ts` (the op, status and formula readers an item's effects go through), `server.ts`'s event route, `scripts/charts/solo.ts` and `tests/models/solo-events.ts` (the chart to copy).

What the design left open, and how it is decided (before the code):

1. **Goods carry each line's source id.** The design had `Goods & { ids: ItemId[] }` for an accept: two lists that must stay the same length. Instead one shape for every goods: `Goods = { gold, items: { from: ItemId, item: ItemTemplate }[] }`, `from` the id the line had in the giving bag. An offer's goods carry the giver's ids too (harmless: a face shows bag ids in unit 3 anyway). `fits` compares the asked ids and counts with the lines' `from` and `qty`. `principle-type-system-discipline`: the illegal state (lists of two lengths) is gone.
2. **`Pick` is `BagPick`.** TypeScript's own `Pick<T, K>` is used across the code (`protocol.ts` uses it), so a type of that name would shadow it. A pick's line also carries the item's `name` as the chooser saw it: an ask names an item of the other's bag, and the taker's phone must say "You no longer have the Iron Shield." when it is gone, and the GM's line must name it.
3. **An id ending in `-e` belongs to an offer's end only.** As designed, any message could be posted under `X-e` (a `roll`, say) by a phone that knows offer X; the room would keep it under the end's id, every real end of X would then be answered with that roll's seq, and X could never end: the goods would stay aside for good. So every reader refuses an id that ends in `-e` (`isEndId`, ids.ts), the end readers require exactly `endIdOf(offer)`, and `newEvent` makes ids of at most 38 characters (`OFFER_ID_MAX`) that end in four random characters, so no id it makes is refused. Test: "a message of any other type under an end's id is refused".
4. **Goods are read strictly.** Other readers drop a bad list entry and clamp a number. A goods line that does not read, more than `GOODS_LINES` lines, two lines from one bag id, or gold that is not a whole number from 0 to `GOODS_GOLD_MAX` (1e9) refuses the whole message: a dropped line would be goods the giver put aside and the taker never gets. The giver's aside is the parsed message's goods, not the bag's copy, so what is aside and what the room holds are one value.
5. **One `takeBack` event.** The design's giver table had "Take back (tap)" and "takeBack (stranded)" as two columns; they differ only by row, so they are one event (posting before a send, a stranded record: the goods back; posting after a send, open: withdrawing).
6. **States are flat rows.** `posting-queued`, `posting-tried`, `open`, `withdrawing-queued`, `withdrawing-tried`, `withdrawing-taken`, `stranded` for the giver; `offered`, `accepting-queued|tried|taken`, `refusing-queued|tried|taken`, `stranded` for the taker; `open`, `stopping-queued|tried|taken` for the GM's phone. Each table row is one stored state, so `GIVER`, `TAKER` and `WATCH` have a cell for every row and event and the typecheck asks for all. The taker's aside is a field only of the rows that hold one (accepting, stranded), by the union.
7. **A cell is a row, a close, or null.** A close says why the record ended: `end` (read the end's outcome, `outcomeOf`), `recalled` (taken back before its letter was sent), `unsent` (its letter let go before a send), `gone` (the room closed), `reclaimed` (a stranded record taken back). One rule moves the goods: a record closed `settled` drops its aside and gains the other side's goods; every other close gives its aside back. A taker that goes back to `offered` (its never-sent accept let go) gives its aside back, because `offered` holds none.
8. **Which letter a heard event is about.** A giver has two letters (the offer, then the withdraw). `tried`, `taken` and `unsent` step a record only for its current letter: the offer's id while posting, the end's id while withdrawing, accepting, refusing or stopping. The box sends one letter of a room at a time in order, so the offer's letter is settled before the end's leaves.
9. **The fold reads the giver's own offer as taken.** An offer read in a page proves the room has it, the same evidence as `taken`, so a posting record steps to `open` (useful after a lost answer and a reload).
10. **The tap steps are in this unit.** `offerPosted`, `offerAnswered`, `offerTakenBack` and `offerStopped` are the one writes of 1.7 (the hunter, the record and the letter). The walk needs them, and unit 4 calls them. They take `{ on, held }` from the caller: the trading switch is unit 4's (`RULES.trade`), and whether a fight holds the hunter is `fightHold` with the room's doc, which the view reads (`app.api.hunter.fightOf`). The rule (refuse `off` and `fight`) is in core.
11. **Refusal words with their numbers.** `OFFER_REFUSAL_WORDS` are functions of a `Shortfall` (`{ name, have, need }`), so "You have 15 gold. This needs 20." and "You no longer have the Iron Shield." come from the refusal itself. Two refusals added: `few` (holds fewer of an item than an ask names: "You have 1 Healing Potion. This needs 2.") and `no-hunter`.
12. **The GM's log lines are answered, not written.** The log kind `trade` is unit 4's (`LOG_KINDS` in save.ts), so `offersSeen` answers what ended and the words (`OfferNews`), and the write of the log line is unit 2's (in the fold's write).
13. **`sealed` (ruling 1).** `EventDef` gains an optional `sealed?: (p) => boolean`; absent is never. `offer`, `offerEnd` and `offerStop` are sealed always, and `isSealed(ev)` reads the mark. The server does not read it yet: unit 3's `servedTo` must, and until unit 3 lands nothing posts an offer (no view, no sync). It is optional so that the stories branch's new `DEFS` entry merges without a change; unit 3 may make it required once both branches are in. The stop's `to` is exactly the offer's two hunters, so the seal reaches the same two phones.
14. **Record caps.** A hunter's giver records: `OFFERS_OPEN` (10), past it `too-many`. A hunter's taker records: 20; past it the oldest `offered` one is let go (it holds nothing), and with none to let go the new offer is not kept (it stays open in the room; Stop or Take back ends it). The GM's phone: 60 watch records, the oldest open one let go. The save's reader drops no record for a count (a giver's record holds goods); it drops a record that does not read.
15. **Words of goods.** "1 Healing Potion" for one, "Healing Potion × 3" for more (no plural of a name the GM typed), "20 gold"; "Back in your bag: 1 Healing Potion." in place of the design's "The Healing Potion is back in your bag.", which needs a verb that agrees with a count. For the lead's second reading.

The measurement (ruling 6), written before it runs. The question: do `GOODS_LINES` (8) lines of the largest item fit `OFFER_MAX` (49,152 bytes)? What I expect from reading the parsers: the effect parser does not bound an item's size. A formula may nest 40 deep as a binary tree (`formulaOf`), an `applyStatus` op carries a whole status def three levels deep, each def 12 ops; one item read by `parseItem` can be megabytes. So no count of lines is safe, and the only true bound is the byte cap, which the reader checks and `setAside` refuses (`too-large`). What the test measures and prints: (a) the largest built-in item; (b) an item at its typed bounds (every text field full of three-byte characters, the largest bonus, 12 effects of a flat op, a worn status with 12 flat ops); (c) the same with every character one JSON writes as six bytes (`\u0001`); (d) an item using the parser's nesting. Decision: `GOODS_LINES` stays 8 when 8 lines of (b) and an ask of 8 lines with full names fit `OFFER_MAX`; else it comes down to what fits. (c) and (d) are refused `too-large` and the notes say how many fit.

### 12.2 Unit 1: what was built, the tests, the measurement

Built (branch `trade`, commits after ad09399c):

- `src/core/ids.ts`: `OfferId`, `parseOfferId` (at most `OFFER_ID_MAX`, 38, never an end id), `endIdOf`, `isEndId`, `END_SUFFIX`.
- `src/core/trade/goods.ts`: `Goods` and `GoodsLine` (by value, with the bag id each line left), `BagPick` and `PickLine`, `setAside`, `received`, `fits`, `handOver`, the strict readers `parseGoods` and `parseBagPick`, `goodsSize`, `OFFER_MAX` (49,152), `GOODS_LINES` (8), `GOODS_GOLD_MAX` (1e9), `OFFERS_OPEN` (10), `OfferRefusal`, `OFFER_REFUSAL_WORDS` and `refusalWords`, `goodsWords`, `pickWords`.
- `src/core/protocol.ts`: `offer`, `offerEnd`, `offerStop` (payloads, readers, `EVENTS` entries), `END_HOWS`, `endEvent`, `isSealed` and the optional `EventDef.sealed`; every other reader refuses an end id (`plainEid` in `base`); `newEvent` makes ids of at most 38 characters.
- `src/core/trade/offer.ts`: `Offer`, `OfferEnd`, `outcomeOf`, `endOf`, `offerOf`; the rows, `GIVER`, `TAKER`, `WATCH`, `recordStep`; the taps `offerPosted`, `offerAnswered`, `offerTakenBack`, `offerStopped`; `offersHeard`, `lettersKept`, `offersGone`; the fold `offersSeen`; `parseOffers`; the words (`offeredLine`, `gmLine`, `closeNews`, `STATE_WORDS`). The box is written only through `atOutbox` (the lint "only src/edge/sync.ts writes the save's outbox").
- `src/core/save.ts`: `settings.sync.offers` and its repair line. `src/edge/room-events.ts`: the three appliers null (`OFFER_FOLD_READS`, with why).
- `scripts/charts/trade.ts`, `tests/models/trade-events.ts`: four charts in `MACHINES` ("An offer in the room", the giver's, the taker's, the GM's record). The design named three; the GM's record is a machine with a table too, so it is drawn.
- AGENTS.md: the two rows (goods, the offer), the recipe "A message that ends another once", the machines' list.

Found while building, and decided:

1. **A take back refused by the room could never be sent again.** The walk found it (seeds 51, 58, 72, 90 left a giver's record open at rest). The box keeps one entry per id and `post` ignores an id it holds, refused entries included, so after a withdraw was refused (`withdrawing-tried`, unsent, back to `open`), Take back posted the same end id into a box that already held it, the record read its letter as let go at once, and went back to `open`: a loop the player could never leave. Fix where it starts: a tap that posts an end puts a refused letter of the same id away first (`posted` in offer.ts). Test: "a take back whose letter the room refused can be tapped again, and the second letter goes out". The same holds for the GM's Stop. Other messages post a new id each time, so they never meet it.
2. **Rule 1 of 1.8 as worded fails in the design's own in-flight state.** "No token is in two places among the bags and the asides" counts a settled exchange twice in the moment between the taker's read and the giver's (point 6 of 1.8 says the goods are the room's then). The walk checks the precise rule: no token in two places among the bags and the asides that no settled end in the room has given away, plus a fifth rule: a token's last settled move names the side it left, and that side's bag never holds it again until a later settled offer moves it back. The design's "rule 1 still holds" after the room is gone is also not true once a player takes back a stranded record whose offer the other side had settled (1.10 accepts that); the walk leaves those goods out of the rules and counts them.
3. **The walk's coverage was checked by breaking the code.** Each of these mutations makes tests fail: settled also giving the aside back (56 failures), `posting-tried` or `accepting-tried` giving goods back on `unsent` (17, 13), `open`, `posting-tried`, `accepting-tried`, `accepting-taken` or `withdrawing-taken` giving goods back on the room gone instead of stranding (each caught by the room-gone walks, once those walks closed the room after step 60 at 5% a step), the fold skipping its own echoes (124), a take back by anyone withdrawing (1, the outcome table).

What unit 3 must add (ruling 1): `servedTo(ev, viewer)` reads `isSealed(ev)` and, for a sealed event, serves it to the GM and to the phones of `payload.by` and every key of `payload.to` (an offer: `by`, `to[0]`; an end: `by`, `to[0]`; a stop: its two `to`). `EventDef.sealed` is optional so the stories branch's new `DEFS` entry merges as it is; once both branches are in, unit 3 may make it required (absent then fails the typecheck). The server test "a third player's phone gets neither an offer between two others nor its end" is unit 3's.

What unit 2 must know:

- `offersHeard(save, letterId, 'tried')` in the write that steps a letter to sending, and `'taken'` in the write that steps it sent, before the letter leaves the box (as `runTaken`); a heard event for a letter that is not a record's current one changes nothing.
- The store runs `lettersKept` after every step, beside `noticed`; it is idempotent.
- `offersSeen` over each poll page whole, own events included, in the same write as the cursor; and once over a join's history pages (the three types) with `from: 'history'`. Its `news` are toasts on a player's phone and log lines on the GM's (`kind: 'log'`); the log kind `trade` is unit 4's in the plan, so unit 2 either adds it to `LOG_KINDS` or holds the GM's lines until unit 4. A page must never be read after a newer one: re-reading an older page could make an ended offer's taker record again (`offered`), and an accept from it would never read an end. Writing the cursor and the fold in one write keeps that from happening.
- The link's `gone`: `offersGone` (its `closed` say what came back), the outbox's `roomGone`, and `lettersKept`, in one write.
- The walk of `tests/offer.test.ts` is the model to lift into `tests/models/room-world.ts`: its fake room, its `send` (ok, lost, failed, refused after a stored send or not, hang), `poll` (pages of 1 to 4, a cursor write lost), removal and the history fold, a junk end, the room gone, and its rules and rest rule.

The measurement (ruling 6). Run in `tests/protocol.test.ts` ("the worst offers by part against the byte cap"), which prints it; the numbers are bytes of JSON in UTF-8, deterministic (one run is the measurement: nothing in it varies). What limits each is its text and its effects; the cap is the server's 64 KiB body less 16 KiB.

| What | Bytes | Lines of it under `OFFER_MAX` (49,152) |
|---|---|---|
| The request's wrapper around a payload | 80 | |
| The rest of the worst offer: ids, names of 60 three-byte characters, gold, 8 asks of 60 three-byte names | 2,344 | |
| The largest built-in item (Elixir of Life) | 268 | 8 (the whole offer 4,703) |
| An item at its typed bounds (every text full of three-byte characters, all ten bonuses, 12 effects and a worn status of 12 ops, each op six tiers of dice) | 10,840 (name 182, desc 1,502, effects 3,505, worn 5,214) | 4 |
| The same with 12 notes of 200 three-byte characters as effects and as worn ops | 18,808 | 2 |
| One item using the parser's nesting (an `applyStatus` whose def holds 12 more, each with 12 notes) | 110,589 | 0 |

The decision written before the run was: `GOODS_LINES` stays 8 when 8 lines of the typed item fit, else it comes down to what fits. By that rule it would come down to 4, or to 2 with notes. I did not follow it, and say so for the lead: the rule assumed a largest item exists, and it does not (the last row; a formula may nest 40 deep, so far larger still). Cutting lines to 2 would not make "any lines of any items fit" true (one nested item does not fit alone) and would cut every ordinary trade (eight different potions are 4,703 bytes, a tenth of the cap). So the bound is bytes: the reader refuses an offer or an end over `OFFER_MAX`, `setAside` refuses `too-large` before the tap's write ("These items are too large to send in one offer. Give fewer."), and `GOODS_LINES` stays 8 as a reader's bound for junk. The test pins the claims: 8 lines of the largest built-in item fit in under a quarter of the cap, at least 4 of the typed worst fit, a nested item alone does not, and the reader takes the largest offer under the cap and refuses one line more. This is contested; if the lead wants "an offer of 8 never refused for size", the way is a bound on an item's size in `parseItem` (which would also bound a sheet and a pack), not fewer lines.

The checks (their last lines are in the reply): `bun run typecheck`; `bun run test`; `bun run charts` and `bun run deps -- --write` (committed). No browser test: the unit has no screen.

Principles that changed a choice: `principle-type-system-discipline` (one goods shape with the source id per line, not two lists of one length; flat rows so every cell is typed; `OfferId` and the end id from one maker); `principle-boundary-discipline` (goods read strictly at the reader; the end id rule in the reader the server runs, and every other reader refusing an end id); `principle-make-operations-idempotent` (every move in the write that ends its record; `lettersKept` and the fold safe to run twice; the re-post of a refused end); `principle-model-the-domain` (the three tables, the close as data, one rule for what moves); `principle-test-behavior-not-implementation` (the walk asserts conservation and agreement, not calls; each test was shown to fail on a broken rule); `principle-explain-the-number` (the measurement's limiter named per row, and the decision rule's premise tested rather than followed); `principle-attack-the-premise` (the GOODS_LINES rule shared one premise, "a largest item exists"; it was written down and tested by the nested row before any cut of lines, and the evidence refuted it).

Decision trail (unit 1):

| # | Decision | Why | Evidence |
|---|---|---|---|
| U1.1 | Goods lines carry their bag id; `BagPick` lines carry a name | Two lists of one length are an illegal state; words need the name of a gone item | 12.1 items 1 and 2 |
| U1.2 | An id ending `-e` is an end's only | Otherwise any message under `X-e` blocks offer X's end forever | `tests/protocol.test.ts` "a message of any other type under an offer's end id" |
| U1.3 | Goods read strictly | A dropped line is goods lost | `tests/goods.test.ts` |
| U1.4 | One Take back event; flat rows; closes as data | Fewer columns, every cell typed | `tests/offer.test.ts` "every cell" |
| U1.5 | A re-post of an end puts its refused letter away | The walk found a take back that could never be sent again | the walk, seeds 51, 58, 72, 90 |
| U1.6 | The walk's rule 1 over asides no settled end gave away | The design's wording fails in its own in-flight state | 12.2 item 2 |
| U1.7 | `GOODS_LINES` stays 8; bytes are the bound | No largest item exists; fewer lines would not make the guarantee true | the measurement table |
| U1.8 | `sealed` optional on `EventDef` | The stories branch adds a `DEFS` entry; a required field would break its merge | 12.1 item 13 |
| U1.9 | The GM's record is charted too | It is a machine with a table | `scripts/charts/trade.ts` |

### 12.3 Task A: a formula's size (before the code)

Goal: a bound on what one item or status from outside data can hold, starting where a formula is read. Problem: the
formula reader bounds depth and not size. Smallest change: one bound on a formula's parts, kept by both readers.

**The cause, read in the code.** A formula has two readers. The maker's text parser (`parseFormula`, formula.ts) bounds
nothing: not its depth, not its nodes. The tree reader (`formulaOf`, fight-parse.ts), which every item, status, ability
and fight from a save, a pack or a room message goes through, bounds depth at 40 and nothing else. So:

1. A tree from outside data of depth 40 can hold 2^41 nodes, and a single dice node can carry 3 × sides reroll points
   (3,000 on a d1000, about 57 KB in one node). Neither is counted.
2. The two readers disagree. The maker takes `1+1+...+1` with 41 pluses (83 characters, depth 41) or `-` written 45
   times before a number; the save keeps the tree; at the next load `formulaOf` refuses it, and the item silently loses
   that effect (`parseItem` drops an op that does not read) or the status is dropped. Found by reading, proved by the
   test below before the fix.

**The bound, weighed.**

| | A node count (parts) | A text length (printed) |
|---|---|---|
| What it counts | Each node of the tree, and each reroll face of a dice term (the one part of a node that is a list) | `printFormula(f).length` |
| Same rule in both readers | Yes: counted while the tree reader walks (it stops at the first part past the bound) and on the parser's tree | Yes, but the tree reader must print every formula it reads |
| Bytes it allows | At most about 95 bytes of JSON a part (measured below) | A printed character is up to about 35 bytes of JSON (`-` is a whole `negate` node) |
| The largest formula the app ships | 89 parts | 403 characters, over the maker's own 200-character field |

The largest formula the app ships is a rule formula (ability-kinds.ts `recommended`): measured over every kind, every
type, a stat that is and one that is not the type's power, with and without a gap, every pair of the eight scalers,
every pace and every channel (105,120 formulas), the largest is 89 parts and 403 characters (a quick strike scaled by
Agility with a gap, a linear channel and two Underdog scalers). Every built-in item, status, kit example and monster
ability holds 19 parts or fewer. So a text length would have to admit 403 characters, about 14 KB of JSON at its worst,
to keep what the maker writes by rule; the same formulas are 89 parts. **Picked: parts.**

The number: `FORMULA_PARTS = 200`. A part needs at least one character, so a formula typed in the makers' longest field
(200 characters: the ability's formula and the threshold's; an op's amount is 60) has at most 200 parts, measured on
the worst texts (`-` 199 times then `1` is 200 parts, `1+1+...` of 199 characters is 199). 200 is the largest the makers
can write, and over twice the largest the app writes by rule. So the bound refuses nothing any maker or built-in makes;
it refuses only a tree from outside data that no maker could have written. The depth bound of 40 goes: 200 parts bound
the depth at 200, and keeping 40 is what made the readers disagree.

One rule, `partsOf(f) <= FORMULA_PARTS`, kept in two places: the tree reader counts as it reads (a budget passed down,
so a wide tree from a 64 KB message is not walked past part 201), and `parseFormula` refuses a tree past it with words.
Every reader of outside data that can hold a formula reaches it through `formulaOf`: an item's effects and worn status
(`parseOp`, `parseStatusDef`), a library status, a reward, a pack, a skill's ability (`parseAbility`), a fight (`parseFight`),
a room message's status (`parseSheetStatus`).

**What a save with one reads.** A GM's library can hold today a tree of more than 200 parts only from outside data (a
pack, a room message or a hand-edited save), since no maker writes one. Such a tree is refused where it is read, as a
tree of depth 41 is today: an item keeps its name and its other effects and loses that op, a status def or an ability
with it is dropped. Nothing throws (the test loads such a save).

### 12.4 Task A: what was built, the tests, the numbers

Built: `FORMULA_PARTS` (200) and `partsOf` in formula.ts; `parseFormula` refuses a tree past it ("The formula has 201
parts, and a formula has at most 200. Each number, die, name, sign and face rolled again is a part."); the tree reader
(fight-parse.ts `formulaOf`, now `formulaPart` under it) takes each part from one budget and stops at the first part past
it. The depth bound of 40 is gone.

Tests: `tests/formula.test.ts`, "a formula's size": every rule formula (5 kinds, 4 types, 8 stats, 64 pairs of scalers,
with a gap, a quick pace and a linear channel: 10,240) fits in under half the bound; the worst 200-character texts parse;
a formula the maker took (60 pluses deep, and `-` 199 times) reads back through `parseOp` and `parseStatusDef` as it
was; a tree of 200 parts reads and one of 201 is refused, as a negate chain and as one die rolled again on 200 faces, and
the parser refuses 201 with its words. The second and third tests fail on the code before the fix (shown by putting the
old reader back: 2 fail). `tests/save.test.ts`: a library item whose effect holds 201 parts opens with its name and its
other effect, nothing thrown. `tests/protocol.test.ts`: the sizes below, printed by part.

The numbers (bytes of JSON in UTF-8, deterministic, one run; the limiter of each is named):

| What | Bytes | What limits it |
|---|---|---|
| The largest formula the readers take | 17,890 | 100 dice terms at their largest (100 dice of 1,000 sides, each with an explode, a keep and a success point) under 99 `+` nodes and a `floor`; 200 parts |
| One op of six tiers of it (a damage op) | 107,404 | six formulas a tier |
| A status def of 12 such ops | 1,290,588 | 12 ops a def |
| A status def with applyStatus defs three deep under it, 12 ops each | 2,230,797,348 at least | 12^3 defs; triggers, an end and a threshold nest too (48 ops a def), so the true largest is larger |
| An item with 12 such effects and such a worn status | 4,461,594,689 at least | 12 effects and the worn status |

Before the bound the largest formula had no size at all (2^41 nodes, or 3,000 reroll faces in one die). Now it has one,
but it does not bring an item near the caps: one op of six tiers of the largest formula (107,404) is over `OFFER_MAX`
(49,152), `SHEET_MAX` (32,768) and `DOC_MAX` (62,000) alone. Unit 1's table: lines of the worst item that fit
`OFFER_MAX` stay 0, and the worst item is now a number (over 4 GB) instead of none. The rows of the table built from
typed bounds without nesting (4 lines of the flat item, 2 of the noted one) do not change: their formulas were one part.

What this says, for the lead: the formula was one of three causes of an item without a size, and the smallest. The
others multiply: six tiers in an amount, 12 ops in a def, and defs nested three deep under a status (48 ops each with
triggers, an end and a threshold). No bound on a formula alone brings an item under a cap: a formula of one part still
leaves 12^4 ops under one item. The bound that does is bytes at the reader of an item and of a status def (`parseItem`,
`parseStatusDef`), refused past a size chosen from the caps; unit 1 named it and left it. It is not in this task. In
practice what one item can be is held today by what carries it: a room message is at most 64 KB, a sheet 32 KB, a doc
62 KB, a save what the phone's storage takes, so an oversized item is refused on the way out (a sheet past `SHEET_MAX` is
"too big", an award past 64 KB is 413), never read whole by another phone.

Principles: `principle-fix-root-causes` (the two readers disagreeing was the fault; one bound kept by both fixes it, and
the depth bound that caused the disagreement is removed rather than copied into the parser); `principle-explain-the-number`
(the bound comes from two measured limits, the makers' field and the largest rule formula, and the sizes name what
limits each); `principle-attack-the-premise` (the premise "a formula bound bounds an item" was tested by the composition
and is false; said above instead of picking a smaller number that would not change it).

### 12.5 Unit 3: the room's view for each phone (before the code)

Goal of the unit: each phone gets of the room only what is for it, so a trade (ruling 1), a private word and a secret
quest can stand on it. Problem: today every phone that knows the code downloads every event and every sheet whole.
Smallest change: one pure cut in protocol.ts (`servedTo`, `sheetFor`), the viewer worked out in server.ts's poll route
with no state, the token sent on a player's poll, and the faces read by sync.ts from the poll it already keeps.

Read for this unit besides the design's list: `tests/lint.test.ts` (server.ts keeps no module-level `let`, `Map` or
`Set`; sync.ts keeps only the `let`s the list at its top names, and adds none here), `tests/models/room-world.ts` (its
`ask` and `http` copy sync.ts's requests), `tests/server-rooms.test.ts`.

What the design left open, and how it is decided:

1. **A stored sheet and a served sheet are two types.** The design had `RoomSheet = PushedSheet | Tombstone | Face`,
   read by `parseSheet`. That reader is also the one the server runs on a push, so a phone could push a face as its
   sheet. Instead `RoomSheet` stays what the store holds (pushed or tombstone) and `ServedSheet = RoomSheet | Face` is
   what a poll answers, read by `parseServedSheet` inside `parseRoomState` only. A push of a face is refused as a bad
   sheet. (`principle-type-system-discipline`: the store cannot hold a face.)
2. **The bag lines are the caller's part (ruling 4).** `faceOf(hunter, { bags })` and `sheetFor(key, sheet, viewer,
   { bags })`. A face's `bag` is its unworn lines, or `null` when the caller leaves them out: `[]` is an empty bag, `null`
   is "this table does not show bags", so the Give window (unit 4) can tell the two apart. server.ts passes `bags: true`
   until unit 4 reads the trading switch from the rules doc there.
3. **A phone is proven from its first request.** The design took the device's owner from "the binding a sheet push
   makes". But a phone that has not pushed is unbound: a new join's first polls, and a rejoin after a removal (the removal
   releases the binding). Its polls would be served as anyone's, and the cursor would pass the sealed messages to its
   hunter for good (a giver allowed back would never read the end of its own offer). So the poll binds the device to its
   token as a write does (first token wins, the same rule as `mayWriteFor`, which now calls the same step), and the head
   carries `d` and the token too, since units 0 and 2 read its history. Binding on a read gives nothing a write did not
   already give: anyone who knows a device id could post an event as it before its first write, today.
4. **Who a sealed event names.** Its `by` and every key of its `to`. A phone gets it when one of those keys is its own
   device's. A sealed event naming no hunter reaches the GM only.
5. **`sealed` stays optional.** The stories branch's new `DEFS` entry has not landed in the tree (no `chapter` in
   protocol.ts), so ruling 12.1 item 13 still holds.
6. **What a face holds.** Name (60), level, job, and at most `FACE_LINES` (40) unworn bag lines in bag order: id, name,
   count, rarity. A face is built by the server and read by a phone; a line that does not read is dropped, as every
   list of the poll answer is.
7. **`sync.faces()` waits for its reader.** The design put it in this unit. Built, it had no caller, and the lint
   "every registered app.api member is used by some module" refused it as dead code. It is one line over `shown`
   (which sync.ts already keeps), so unit 4 adds it with the Give window that reads it. The faces reach the phone in
   this unit (`RoomState.sheets` holds them, `sync:sheets` carries them); only the accessor waits.
8. **The GM's phone is unchanged.** It gets every event and every sheet whole, as today; `remoteSheets` narrows to
   pushed sheets as it narrowed out tombstones.

### 12.6 Unit 3: what was built, the tests, the checks

Built:

- `src/core/protocol.ts`: `RoomViewer`, `HunterFace` and `FaceLine` (`FACE_LINES`, 40), `ServedSheet`, `hunterFace(h,
  { bags })`, `sheetFor`, `servedTo`, `parseServedSheet`; `RoomState.sheets` holds served sheets. `Viewer` and `Face`
  were taken (space.ts, formula.ts), and the lint "a type name is exported by one module" refused a second of each.
- `server.ts`: `proven` (the token bound to the device on its first request, poll or write; `mayWriteFor` is the GM's
  key or `proven`), the viewer in the poll route, the events filtered by `servedTo` with `next` and `more` from the
  page before the filter, the sheets through `sheetFor` with `FACE_BAGS` (`bags: true` until unit 4). No module state.
- `src/edge/sync.ts`: `fetchApi`'s `prove`; the poll and the head send `d` and the token. `remoteSheets` narrows to
  pushed sheets. `tests/models/room-world.ts` copies both (`Http.prove`, `serve`) and its `probe` reads each room with
  the GM key its create answered (`World.keys`), so the rules see the room whole once sealed messages are in it.
- AGENTS.md: the row "What each phone gets of the room", the room server row (`proven`), the offer row (sealed), the
  recipe line of a room message (`sealed`).

Tests: `tests/server-rooms.test.ts`, "what each phone gets of the room": a player's poll carries its own sheet whole and
the others as faces (a worn sword is not on the face, the potions are); the GM's poll carries every sheet whole and
every message; an offer and its end reach Kai's and Mira's phones; "a third player's phone gets neither an offer between
two others nor its end" (ruling 1); a poll with no device, or with another phone's token, gets faces and no sealed
message; the cursor passes a sealed message a phone did not get; a phone that has pushed nothing gets what is sealed to
its hunter from its first poll, and its token holds the device from then on; a face pushed as a sheet is refused.
Shown to fail on the code without the filter (3 fail) and without the binding on a poll (1 fails). The tests that read
what the room stores now read it with the GM key. `tests/protocol.test.ts`: `servedTo` and `sheetFor` for each viewer,
a face's bounds and its bags left out (`null`) against an empty bag (`[]`), the face reader. Two browser tests read
stored sheets through the room API with no key; they now read as the GM (`gmRoomHeaders` in `tests/e2e/helpers.ts`).

Checks: `bun run typecheck`; `bun run test` (4071 pass, 3 skip, 0 fail); `bun run deps -- --write` (committed); the
room model's exhaustive walk and random walks pass; the build handshake is unchanged (`tests/server-handshake.test.ts`
passes untouched). Browser: room-sync, room-sync-fixes, room-view, reward-room, table-turn, solo, feats-room and
table-session (changed here): 58 passed. No chart changed (no machine).

The size of a poll: a face is at most about 10 KB (40 lines of a 60-character name in three-byte characters), against a
whole sheet of up to 32 KB today, so a player's poll in a full room is smaller than before.

Principles: `principle-type-system-discipline` (the stored and the served sheet are two types; the bag lines left out
are `null`, not an empty list); `principle-boundary-discipline` (the cut is one pure function the server's edge calls;
nothing inside reads the viewer again); `principle-fix-root-causes` (an unbound phone losing sealed messages was fixed
where the binding is made, not by a retry of the history later); `principle-subtract-before-you-add` (`sync.faces()`
left to the unit that reads it).

### 12.7 Ruling 3: three faults, each at its cause

Read for this step besides the design's list: `principle-fix-root-causes`, `principle-test-behavior-not-implementation`,
`tests/lint.test.ts`, `src/edge/room-events.ts` (`applyAll`), `src/core/applied.ts`, `src/core/formula.ts` (the parser),
the makers' formula fields (`maker.js`, `kit-parts.js`), `server.ts` (`memoryStore`, the event route).

**(a) A held `vitals` that a newer one replaced.** Where it starts: the GM's phone already knows that a fight's totals for
one hunter stand for one thing (combat.js posted each under the outbox key `vitals <sheet key>`, so only the latest
waits), but a player's phone did not: `hold` kept every message that threw, and `applyAll` tried the held ones before each
page, so an older total that threw once landed after a newer one had and put the old numbers back. One rule now says
what a message stands for, in the message's own definition: `EventDef.standsFor` (protocol.ts), set on `vitals`
(`vitals <sheet key>`), read by `standsFor(ev)`. Both sides read it: `fought` (fight-save.ts) posts a player's totals
under it, so combat.js no longer writes the key, and a player's phone lets a held message go once a newer one of its key
comes (`replaced` in applied.ts): `applyAll` drops a held one that the page stands in for before it tries anything, an
event of the page drops one held earlier in the same page, and `hold` keeps one per key. Totals for two hunters are two
keys. Tests (`tests/applied.test.ts`, "totals that threw on this phone and are held"): an older total held, a newer
one lands, and once the phone could apply the older one the hunter keeps the newer numbers and only the newer id is
recorded; a newer total that throws too takes the older one's place; two hunters' totals are two things. The first two
fail on the code before the fix (shown by making `replaced` a no-op: 2 fail).

**(b) The formula field that cannot hold a rule formula.** Where it starts: the field had a length of its own
(`maxlength="200"` on the ability's formula and the Stacks formula, `maxlength="60"` on every op's amount), a second
bound beside the parser's `FORMULA_PARTS`, and smaller than what the app writes into it: a rule formula prints to 403
characters, a status from a pack can carry an amount of any of its 200 parts. A browser keeps a value longer than
`maxlength` but takes no key that adds to it, so the GM could only delete. Decided: the fields have no length of their
own; the parser is the one judge, by `FORMULA_PARTS`. The length had one other job, read in the code and not written
anywhere: it kept the parser's recursion short. Without it a pasted text could be any length, and the parser walks one
level a bracket and one a sign, and `partsOf` one a node of a left-deep chain (`1+1+...`). So the parser now counts
before it reads (`tooBig`): each token but a bracket and a comma is one part of the tree, so more than 200 such tokens
is refused with the parts' words ("The formula has more than 200 parts, ..."), and brackets more than 200 deep are
refused with their own ("The brackets at character 201 are 201 deep. A formula has at most 200 parts, so it needs at most
200 brackets inside each other."). That second rule follows from the first: what `printFormula` writes of a tree of 200
parts nests at most 200 brackets, one for each node on the way down, so it refuses nothing the app prints. The two
refusals of too many parts (before the read, and after it with the faces rolled again counted) are one sentence now
(`TOO_MANY_PARTS`): the old one gave the count ("201 parts"), which the count before the read cannot give exactly. The
Dice view's typed roll keeps its 200 characters: nothing the app wrote is ever put in it. Tests: `tests/formula.test.ts`,
"whatever the app prints of a formula the readers take reads back the same, however long its text" (a chain 99 brackets
deep, 100 `target.stacks(...)` of a 40-character key printed to 5,797 characters, and the 403-character quick linear
rule formula, the largest the rule writes: each reads back to the same tree), and "a text pasted into a formula field that no formula needs is refused
with its words, never walked" (a million brackets, a million pluses). The second fails on the code before the fix with
"Maximum call stack size exceeded". `tests/e2e/makers.e2e.ts`, "a formula field holds whatever the maker writes in it":
the skill maker builds the rule formula of a strike scaled by Agility with a gap and two scalers (more than 200
characters), the GM types " + 1" at its end through the keyboard, and the library holds it; a status's damage of 77
characters typed key by key is kept whole.

**(c) The memory store's gap past 2,000 events.** What a phone met there, read in the code and shown by the test below
on the old store: the memory store (no `DATABASE_URL`) kept a room's last 2,000 events and spliced off the older ones.

1. A phone whose cursor was older than the oldest kept event read the oldest kept page as if it followed on, with no word
   of a gap: every message that fell off was never landed (an award, a quest, a solo answer, whose waiting run then
   stays "taken"), and on the GM's phone every claim that fell off was never answered. A phone meets this after a
   reload, an app closed or a phone offline while 2,000 events came: a long fight at a table of four writes several
   events a use (a cast, the totals of each row it hit, a spent item), so a few hours is enough.
2. The store found a repeated event id only among the kept 2,000 (`r.events.find`). An outbox resend whose first copy
   had fallen off was stored again under a new seq, and a phone whose applied ring (200 ids) no longer held the id
   landed it twice. So the gap did not only lose messages; it could double one.
3. The same breaks unit 1's proof of a trade: the rule "an offer has one end" is "the room takes one event id once",
   and past the gap a second end is stored and a giver who never read the first takes the goods back while the taker has
   them.

Whether unit 0 makes it worse: no. Today a rejoin starts at the room's end and skips everything; with unit 0 it resumes
at its cursor and meets the same gap a reload meets today, so it loses at most what fell off instead of everything. But
unit 0's rule ("every message lands exactly once from a phone's first join") is false on a store that forgets, so the
gap is fixed before unit 0. Where it starts: the memory store broke the store's contract, which Postgres keeps (every
event of a live room, an id taken once for the room's life). Fixed there: the memory store forgets no event (`events[i]`
has seq i + 1, read by index; `ids` answers a repeated id), and past `MEM_EVENTS` it stores no more: `addEvent` answers
null and the route answers 413 `room full`. A sender's outbox reads a 413 as refused and tells the player ("The room did
not take an award (room full)."); nothing is lost without a word. `MEM_EVENTS` is 20,000, ten times the old window, and a
guess, not a measurement: it bounds only the process's memory, and the deploy's Postgres has no such bound. Tests
(`tests/server-rooms.test.ts`, "a room keeps every message it took"): an award, then 2,000 messages, and a phone reading
from the start reads the award first and a resend of it answers seq 1 (both stores); a memory room at `MEM_EVENTS`
refuses one more with `room full`, still answers a resend of its first message with seq 1, and holds all 20,000. Both
fail on the old store (2 fail).

Principles: `principle-fix-root-causes` (each fix is where the fault started: a message's meaning in its definition, the
field's second bound removed and the parser made the one judge, the store's contract), `principle-test-behavior-not-implementation`
(each test drives what a phone, a GM or a store's caller sees, and each was shown to fail on the old code),
`principle-subtract-before-you-add` (combat.js and two tests no longer write the totals' key; the fields lose a bound).

### 12.8 Ruling 2: a byte cap where an item, a status and an ability are read (the plan, before the run)

Goal: one item, one status or one ability from outside data has a largest size, so what carries it (an offer, a sheet,
a doc) can be sized from it. Problem (12.4): the bounds of fields multiply to gigabytes. Smallest change: a size in
bytes, checked once where each of the three is read, with the words a maker shows.

**Where a def from outside data is read** (read in the code): a status def at `parseStatusDef` (the library, a pack, a
reward's status, a skill's and an item's worn status, the fight doc's and the solo doc's tables) and at `keyDefSource`
(a sheet's condition, the `status` and `vitals` messages, a fight's row); an op's own def under an item's effects
(`parseOp` in `parseItem`) and under an ability's ops (`parseAbility`: a skill, a monster's abilities, a fight's row).
So three things are capped: a status def (both readers), an item whole, an ability whole. A monster holds no def of
its own (its statuses are keys); a reward, a feat's reward and a chapter hold items, status defs and skills, each read
by one of the three capped readers, so each is bounded by its counts times the caps and needs no fourth number.

**The unit**: bytes of the thing's JSON in UTF-8 as its reader gives it back (`bytesOf`, the offer's `goodsSize`), since
the server's body bound is bytes. `SHEET_MAX` and `DOC_MAX` count characters, never more than the bytes.

**The decision, written before the measurement runs** (nothing in it varies: one run is the measurement):

- `ITEM_MAX` is the largest whole KiB such that `GOODS_LINES` (8) items at the cap, with the worst rest of an offer
  (2,344 bytes, 12.2) and the request's wrapper (80), fit the server's 64 KiB body. By arithmetic that is 7 KiB (7,168):
  8 x (7,168 + 27 for a line's wrapper) + 2,344 + 80 = 59,984. The number that would change it: the largest item the
  app ships. If it is over a quarter of the cap (1,792), the cap stays and `GOODS_LINES` comes down instead, to what
  fits at four times that item.
- `STATUS_MAX` is 4 KiB (4,096), so an item or a skill can hold one status at the cap and still have 3 KiB of its own.
  The number that would change it: the largest status def the app ships (built-in statuses, the kit examples, the
  bundles). Over a quarter of the cap (1,024), `STATUS_MAX` becomes four times it, rounded up to a KiB, and `ITEM_MAX`
  must then still exceed it by 1 KiB or the plan is wrong and is rewritten.
- `ABILITY_MAX` is the item's cap (7,168): an ability and an item are peers, each up to 12 ops and one status of its
  own. The number that would change it: the largest ability the app ships (the built-in abilities, every built-in
  monster's, the kit examples'). Over a quarter of the cap, it becomes four times it, rounded up to a KiB.
- What is expected to be refused: an item a GM fills to every typed bound (12.2's row: 10,840 bytes with three-byte
  text, 12 effects by rank and a worn status of 12 ops by rank) is over the cap. The maker says so with the two numbers.
- `OFFER_MAX` then follows: the worst offer of 8 items at the cap, measured by the test, rounded up to a KiB.
- `SHEET_MAX` (32,768 characters): the test measures a new hunter's pushed sheet and says how many items at the cap it
  then holds. Expected: 4. At the edge today the push is refused before it is sent (`sendSheet` counts the sheet against
  `SHEET_MAX`, the push machine's `refused: too-large`) and the pill says the sheet is too big; the hunter stays whole on
  its own phone. That stays: a bag has no cap of its own in this step.

A thing over its cap is refused whole: the reader answers null (an item, a status, an ability; a skill whose ability or
worn status is over is refused as a skill, since it is that ability). A maker checks the form with the same rule before
it saves and shows the words (`tooLarge`).

### 12.9 Ruling 2: the measurement, what was built, the numbers

The measurement (one run; nothing in it varies), printed by `tests/size.test.ts` and `tests/protocol.test.ts`:

| What | Bytes | Against the plan's quarter |
|---|---|---|
| The largest item the app ships (The Punchline, a bundle's item with a worn status) | 502 | under 1,792: `ITEM_MAX` stays 7,168 and `GOODS_LINES` 8 |
| The largest status def the app ships (Resonance, a kit example) | 1,035 | over 1,024, so by the plan's rule the cap is four times it up to a KiB: 5,120, not 4,096 |
| The largest ability the app ships (Fester, a kit example) | 1,804 | over 1,792, so by the plan's rule: 8,192, not 7,168 |

So the sizes are **an item 7,168 bytes, a status 5,120, an ability 8,192** (`THING_MAX` in `src/core/size.ts`). The plan's
check holds: an item holds one status at its size and 2 KiB of its own. Two of the three numbers moved from the plan's
first guess because the shipped kit examples were 11 and 12 bytes over the quarter; the rule was followed as written.

What follows from them:

| What | Number | How |
|---|---|---|
| The worst offer: 8 items at the size, names and 8 asks of 60 three-byte characters | 59,903 bytes (items 8 x 7,168, a line's wrapper 27, the rest 2,344) | built by the test from an item of exactly 7,168 bytes |
| `OFFER_MAX` | 60,416 (59 KiB; it was 49,152) | the worst offer up to a KiB; with the request's wrapper (80) 60,496, under the server's 65,536 |
| Lines of the worst item an offer holds | 8 (it was 0 for a nested item, 2 to 4 for a typed one) | an offer of items the readers take is never refused for its size; `too-large` stays for more than 8 lines or too much gold |
| `SHEET_MAX` (32,768 characters) | a new hunter's pushed sheet is 1,262 characters; it then holds 4 items at the size, and a fifth is over | the test builds both and reads the four back whole |
| The fight doc's table of defs (`DOC_DEFS_MAX`, 6,000 characters) | one status at the size fits it | asserted; the worst-case fight doc and solo doc tests pass unchanged (their rows and defs were built-in ones) |
| A reward at its counts (20 items, 8 statuses, 8 skills) | at most about 249,856 bytes | finite now; still over one request's body: see "found" below |

At the sheet's edge nothing changed: a sheet past `SHEET_MAX` is refused before it is sent (`sendSheet`, the push's
`refused: too-large`), the pill says so, and the hunter is whole on its own phone. A bag has no cap of its own.

Built: `src/core/size.ts` (`bytesOf`, `THING_MAX`, `withinSize`, `tooLarge`); `parseStatusDef` and the reader of a
sheet's condition (`keyDefSource`) refuse a def past a status's size; `parseAbility` an ability past its; `parseItem` an
item past its, or whose worn status is past a status's. Refused whole means null, never the thing without the part that
made it large: an item is not kept without its worn status, a skill is not kept without its ability (`parseSkill`
answers null; before, an ability that did not read left a skill with none), a reward's status is not kept as a key
without its def. A part that does not read for another reason is still left out as before. The makers check the form
with `tooLarge` before they save and show its words: the item maker (the worn status first, then the item), the status
maker, the skill maker (its ability, or a passive's worn status). `goodsSize` is `bytesOf`.

Decided here, not in the ruling:

1. Three caps, not one a holder. A monster, a reward, a feat's reward and a chapter hold no def of their own: each
   holds items, status defs and abilities read by the three capped readers, so each is bounded by its counts times the
   caps. A fourth and fifth number would be a second bound on the same bytes.
2. A monster's ability past the size is left out of the monster, as one that does not read is today; the monster is
   kept. A skill is refused whole because a skill is its ability; a monster is not one of its eleven.
3. The size is of the thing as its reader gives it back, not of the raw input (which may carry keys the reader drops).

The new words, for the lead's second read (each through `humanizer` and `unslop`; numbers exact, the way out last):

- "This item is too large to save. It takes 9,120 bytes, and an item holds at most 7,168. Remove an effect, or make its worn status smaller."
- "This status is too large to save. It takes 7,440 bytes, and a status holds at most 5,120. Remove an effect, or one of the things that happen when it stacks, triggers or ends."
- "This skill's ability is too large to save. It takes 9,011 bytes, and an ability holds at most 8,192. Remove an effect."

"Bytes" is the literal unit and the only exact one; the lead may prefer another word for a GM.

Tests: `tests/size.test.ts` (a status under the size reads and the same with more ops is refused at each of its three
readers; an item refused whole, by its own size and by its worn status's; an ability and its skill; the words; everything
shipped at most a quarter of its size, found by walking every built-in registry; a save whose library holds an item over
the size opens without it and keeps the rest). `tests/protocol.test.ts`: the worst offer by part, the largest things
against what carries them, the sheet of four items. `tests/goods.test.ts`: eight items at the size are put aside for one
offer. `tests/e2e/makers.e2e.ts`: a status of 12 notes of 200 three-byte characters is refused with the words, and saved
once five are removed. With `withinSize` made always true, 6 of these fail.

Found, not fixed (for the lead):

- **A save that already holds a thing over a size loses it at load, without a word.** No maker could write a status
  over 5,120 bytes without 12 long notes or by-rank ops in most rows, and nothing shipped is near, but an item a GM
  filled to every bound (10,840 bytes, 12.2) is dropped from a library or a bag when the save is next read. The hunter
  survives; the item does not. If that is not acceptable, the way is a one-time note at load that names what was left
  out, as a damaged fight is told (`fightLost`).
- **A reward can still be larger than one request.** 20 items at the size are 143 KB. The room answers 413 and the GM is
  told the room did not take the award; a quest holding such a reward sits in a save. A cap on a whole reward (under
  the body, or under `CHAPTER_MAX`, which the stories branch has) would close it.
- **The makers' form and its reader can differ by a few bytes** (the form is measured before the reader runs). A form
  that passes `tooLarge` and whose read-back is over would be refused by the reader with "This status cannot be saved."
  in the status maker and saved as nothing in the item maker. Not seen; the reader only drops keys.

Principles: `principle-explain-the-number` (the decision and the number that would change it were committed before the
run, and two caps moved by the rule), `principle-boundary-discipline` (the size is checked where each thing is read, once),
`principle-type-system-discipline` (one table of sizes keyed by kind, so a fourth kind is one entry and its words).

### 12.10 Unit 0: what a phone missed while it was out of the room (what was built, and what was decided)

Built as section 11 designs it and ruling 1 of section 13 approves.

- `src/core/sync/seen.ts` (new): `RoomPlaces` (11.4 named it `Seen`, which trade/offer.ts already exports), `SEEN_MAX` (100), `seenKept`, `seenWithout`, `seenFrom` (null past a room's
  30 days), `parseSeen`. `settings.sync.seen` in save.ts with its repair line. Its own module, not bind.ts as 11.8 had
  it: save.ts reads it at load, and bind.ts imports party.ts, which imports the save.
- `linkSaved` (bind.ts) takes the server's time and, in the write that takes the phone out of a room (to none or to
  another), keeps that room's cursor; the place goes when the phone is in the room again and when the room is gone (a
  poll's `gone`, a join that finds it gone, a GM's ring `gone`).
- link.ts: `join` and `Joining` carry `from`; `headed` goes live at it when it is not past the room's end, else at the
  end. No state was added, so the link's chart is unchanged (`bun run charts` wrote the same file).
- room-events.ts: `landAll(save, held, events, app, appOf)` folds a page over a save (each land with its id through
  `appliedOnce`, the held events first, a throw held) and answers the save, the held list and the tells; it replaces
  `applyAll`, which wrote an event at a time. `applyRoomEvent` stays for one event (the model and the tests use it).
  `awayDeps(app, lines)` is the app a message tells through when it was sent while the phone was out.
- sync.ts: `joining(code, key)` reads the place for all three joins (Join, the GM's reopen, Rejoin after a removal);
  `runLink` hands a poll page's `save` to its `apply`; `landPage` writes the cursor, the page's lands and the held list
  in one `store.apply('sync-page')`, then runs the tells and opens the one window. No new `let` (the lint's list is
  unchanged).
- tests/models/room-world.ts copies each: `seen` in `PhoneSave`, `save`'s lines of `linkSaved`, `joining`, the page's
  cursor written with its lands, and `first` (bookkeeping: the cursor a phone first went live in a room with).

Decided here, not in the design:

1. **A message is "sent while away" when the room took it before this phone's join** (`ev.at` before the save's
   `joinedAt`, both the server's time). 11.6 had the link know that it was catching up (pages at or before the head's
   end). The message's own time needs no link state, and it survives a reload in the middle of a catch-up: the pages
   read after the reload are still told as away. A "Play as" rebind also moves `joinedAt`, so a message that reaches
   the room in the seconds before a rebind is told in the away window; it was for the hunter the phone no longer plays.
2. **One window a page, not one a catch-up.** A page is at most 200 events, so an absence of fewer than 200 room
   events is one window. A longer one is a window for each page that held something for this phone. Gathering lines
   across pages would keep them in memory between writes, and a reload between two pages would lose the lines of
   lands already written. Nothing is lost this way.
3. **What a tell does besides telling still happens**: a grant's level-up window and its Job Change steps, a coin's
   landing, the toast that the GM's fight holds the hunter. Only the message's own window or toast becomes a line.
4. **The tells run after the page's write**, in the room's order. Before, each ran after its own event's write; a
   System window (which writes nothing) now also waits for the page.
5. **The model's rule covers seven kinds** (award, status, chain, vitals, spent, shadow, noted), from the phone's first
   join in the room, and the GM's rules (a told use logged once, a coin call held) from the GM's first. It held on
   the first run, on 2,000 random walks and the 16,386 sequences of three moves.
6. **The GM's phone resumes too**, as 11.1's last row asks: its `sync:event` handlers hear what players sent while it
   was out. It has no away window: each handler tells in its own way (a feed line, a log line).

The words, for the lead's second read:

- The window: tag "! System", title "WHILE YOU WERE AWAY", body "These were sent while this phone was out of the room."
- A line a message: an award "Reward: REWARD RECEIVED. +30 XP. +12 gold" (a bundle's own title in its place); a quest
  "Quest: The Den. GOAL: Clear it."; a System message "Notification: A storm is coming. Take cover."; an HP change as
  its toast reads, "+10 fatigue · A long march"; a status "Burning: 3d8 magical damage a round · 3 rounds". Each is the
  window's tag without its "!", its title, then its body and lines joined with full stops. The upper-case titles are
  the System's voice inside a line of a body, which Plain first keeps to tags and titles: the lead may want "Reward:
  +30 XP, +12 gold" with no title.

Tests: `tests/bind.test.ts` (each way out keeps the cursor with the time; a page's cursor keeps none; back in the room
the place goes; a gone room keeps none; 30 days to the millisecond; the cap and the reader), `tests/link.test.ts` (a
join back goes live at its place and polls from it; a place past the end starts at the end; the GM's reopen),
`tests/save.test.ts` (the repair), `tests/applied.test.ts` ("a page of the room lands as one change": every message on
the answered save before anything is told; a page landed again gives nothing twice; away messages as lines with the
hunter given each), `tests/room-system-model.test.ts` (the rule from the first join, and four scenarios by name: the
award sent while Mira was out, a status across a removal and Allow back, a solo run claimed while the GM's phone was
away, a reload in the middle of a catch-up), `tests/e2e/room-sync.e2e.ts` ("a player who left the room and came back
gets the award the GM sent meanwhile, once, told in one window": through the Room view's Leave and one-tap Rejoin, then
a reload and a second leave and join give nothing twice). With `headed` going live at the room's end again, 4 model
tests (three scenarios and the exhaustive walk) and 2 link tests fail.

What unit 2 must know:

- A returning phone reads its offers' ends on its catch-up pages. There is no join history fold to build (1.9's second
  bullet is gone).
- `landPage` is where the fold goes: call `offersSeen` over the page whole (own echoes included: `apply` skips them
  before `landPage`, so pass the unfiltered `r.events` beside `fresh`) inside the `sync-page` step, after `linkWritten`
  and beside `landAll`, so the cursor, the lands and the fold are one write. Its news are tells: push them on the
  page's tells, or as away lines when the event's `at` is before `joinedAt`.
- The GM's phone runs no appliers; its page write is the cursor alone today. The GM's watch records go in the same step.
- `standsFor` (12.7) is the place to say that an end stands for its offer, should a held end ever need replacing.
- The memory store keeps every event now (12.7), so "an offer has one end" holds on it as on Postgres.

Found outside the unit (not fixed):

- **The head still pages the room's whole history** to find its end (sync.ts `case 'head'`), though a join with a
  place needs only the end to compare with. A room of 20,000 events is 100 requests at a join. The server could
  answer the end alone (`?head=1`); not in this unit.
- **`room-sync.e2e.ts`'s first test waits 8 seconds and 1.5 seconds on fixed timers** ("a reload on the player applies
  nothing twice"), against the rule "wait on what the player sees". The new case waits on a later message instead.
- **`seen` is cleared by nothing when a save is replaced** (an import, a restore): the places are the old save's, and a
  restored save's own are kept. An import of another phone's save carries that phone's places; they only move where a
  join starts, and a place past a room's end starts at the end.

Principles: `principle-make-operations-idempotent` (a page is one write, so "read again" is the only other outcome of a
reload, and the ids on the save make a second read land nothing), `principle-fix-root-causes` (the join's start was the
fault, so the fix is where a join starts and nothing about how a message lands), `principle-subtract-before-you-add`
(no link state for the catch-up; `applyAll` replaced, not kept beside `landAll`), `principle-test-behavior-not-implementation`
(the model's rule is what a player has after any interleaving; each new test was shown to fail on the old join).

### 12.11 Unit 2: the room settles a trade (what was built, what was built differently, and why)

Goal of the unit: an offer posted on one phone and answered on another settles both sheets once, whatever the links do,
also on a phone that was out of the room and catches up. Built on unit 0 (ruling 1 of 13): there is no fold of a join's
history; a returning phone reads its offers' ends on its catch-up pages.

Who writes what (each one writer, each in one write):

| What | Its one writer | In which write |
|---|---|---|
| The goods aside and the record at a tap | the core taps (`offerPosted`, `offerAnswered`, `offerTakenBack`, `offerStopped`), through `store.apply`, then `app.api.sync.flush()` (as a solo run posts) | the tap's |
| A record's `tried` (its letter left once) and `unsent` (its letter let go before a send) | `lettersKept`, which the store runs on every write's answer (store.ts `apply`, before `noticed`) | the write that put the letter on its way or let it go |
| A record's `taken` | sync.ts `answered` (`letterTaken`, beside `runTaken`) | the write that takes the letter out of the box |
| The end read: each record's step, its goods moved, its letters dropped, the GM's log line (kind `trade`) | sync.ts `landPage` (`offersSeen` over the page whole, own echoes included) | the page's write, with its cursor and the appliers' lands |
| The room gone | sync.ts `notice` 'gone' (`offersGone`) | the write that refuses the room's letters |

Built differently from the design, each the choice with the fewest new concepts:

1. **`tried` is read from the box, not raised by `boxDo`.** The letter is put on its way inside `flush`'s write, where
   the entry to send is picked; raising `tried` there needed a third hook on `boxDo`. A letter `sending` in the box is
   exactly "it left once", so `lettersKept`, which already follows each record's letter after every write, reads it. One
   reader of "what the box did to my letter" instead of two. `offersHeard` became `letterTaken` (taken only: a letter the
   room took leaves the box as one let go does, so taken cannot be read from the box).
2. **No history mode in the fold.** `offersSeen` lost its `from` argument (ruling 1): a GM phone back in the room logs a
   trade that ended while it was out, as every message lands once from a phone's first join.
3. **No new API.** The taps are core steps a view writes with `store.apply` and then `app.api.sync.flush()`, the way a
   solo run posts. Unit 4 passes the gate (`on`: true until its switch; `held`: `fightHold`).
4. **News carry their offer id** (`OfferNews.offer`), so sync.ts tells a trade that ended while the phone was out as a
   line of the away window ("Trade: ...") and any other as a toast tagged Trade.
5. **The log kind `trade` is added now** (`LOG_KINDS`): the fold writes the GM's line in the page's write.
6. **The exhaustive run stays with one player**: a trade needs two, and three phones at depth 3 is far past its time
   budget. The trade is walked by 300 random walks from two live players that prefer a trade's taps, and named tests.

Found while building, and fixed at its cause:

- **A phone back after a removal lost every sealed message sent while it was out.** A removal frees the device's slot
  (owner.ts); the join's catch-up polls come before the sheet push binds it again, so those polls are not proven, the
  server filtered the sealed offers and ends out, and the cursor passed them. Found by the model ("a giver removed with
  its offer open reads the accept once"). Fix: `servedPage` (protocol.ts), the server's page for a viewer: a poll that
  names a device it is not proven for stops just before the first sealed event naming that device, with no `more`; the
  phone reads it on a later poll, proven. The same held for every sealed message, not only a trade's.

Found, not fixed (outside the unit):

- **A removed player can come back onto the GM's roster** when its sheet changes while its removal is unheard and more
  than the server's 20 s removal window passes before its push (the trade walks, seed 76: a removal, an offer whose
  letter's answer is lost, so the clock passes 20 s, then the push of the changed sheet is taken). Any sheet change does
  it (an edit too); a trade makes one likelier. The trade walks leave the removal out; the removal's window is the room
  server's.
- **A phone away from a room for more than 30 days** starts at the room's end (`seenFrom`), so an open record of that
  room never reads its end. The 30 days guard against a code naming another room; the records then wait for Take back,
  whose letter the room answers with the first end's seq, and the record waits as `withdrawing-taken` for good.

The five leftovers the trail names for this unit (decisions.tsv, Nov 19 13:20Z):

1. **The away window's lines carried an upper-case System title inside a body line.** Fixed: `lineOf` (room-events.ts)
   leaves out a title in the System's upper case ("Reward: +30 XP. +12 gold"); a title of other words (a quest's name,
   the GM's own) stays. A quest's line keeps its window's "GOAL:" label, which is the window's line as it shows it.
2. **`seen` is not cleared when a save is imported or restored.** Read, not a fault today: `seen` is a phone field
   (`SYNC_OWNER` in save.ts, with `applied`, `held`, `runs` and `offers`), so `keepPhone` keeps this phone's places
   across every swap and never takes a file's (save.test.ts, the swap case). A place only says where this phone stopped
   reading; the applied ring, also the phone's, keeps a second read from landing twice. Nothing changed.
3. **A "Play as" rebind moves `joinedAt`.** Read, not a fault: `playAs` keeps `joined` (bind.ts, "The join stays",
   SMX-sync-2.2; bind.test.ts asserts it); only a join's head writes it (`bindJoin`). Nothing changed.
4. **The first test of room-sync.e2e.ts waited on fixed timers.** Fixed: it waits for the link to be live after the
   reload and for a later message from the GM to land, after which every earlier one has been read again. The five tests
   of the file pass (`E2E_PORT=3360`, 1.1 m).
5. **A save holding a thing over its cap loses it at load without a word.** Not done; stopped here for time. What it
   needs: each reader that drops a thing for its size (`parseItem`, `parseStatusDef`, `parseAbility`) counted where a
   save is read, a `LoadNotice` for it ("Some things in this save are larger than the app now keeps..."), and the stored
   text kept in the backups as the other notices do. Only a thing made before the caps (Nov 19) can be over them.

Tests: `tests/offer.test.ts` (the history cases rewritten as a catch-up page; news carry their offer),
`tests/room-system-model.test.ts` ("a trade between two players": an offer settled through a lost answer and a reload
of each phone; an accept and a take back sent at once, both orders; a giver removed and allowed back; 300 walks from two
live players that keep every rule of 1.8 after each move and at rest, and reach settled, refused, withdrawn and
stopped), `tests/server-rooms.test.ts` ("a phone back after a removal polls before its sheet binds it again"),
`tests/applied.test.ts` (the away line). The exhaustive run is unchanged at 16,385 sequences (a copy of the base gave
the same count). The room messages' size bound is unchanged: no message was added.

Principles that changed a choice: `principle-fix-root-causes` (the lost sealed message was fixed where the cursor
passes it, in the server's page, not by a refetch on the phone); `principle-subtract-before-you-add` (the fold's history
mode and `offersHeard`'s `tried` went, no new API); `principle-make-operations-idempotent` (each move in the write
that ends its record; the model reads every page twice through its reloads); `principle-test-behavior-not-implementation`
(the model's rules are what the players hold, checked against what the real server stored).

## 13. The lead's rulings after units 1 and 3 (Nov 19)

1. **Unit 0's design (section 11) is approved**: the save keeps the cursor a phone had when it left a room (`seen[code]`, 30 days), a join goes live at that cursor through the normal appliers, a page's lands and its cursor are one write, and the model's rule is that every message lands exactly once from a phone's first join. It replaces unit 2's separate fold of a join's history: unit 2 is built on it. A room never visited still starts at its end. The messages a phone caught up on are told in one window; its words are the lead's to read before the push.
2. **The size of an item and a status is bounded in bytes where they are read**, as the next step before unit 0. Task A measured that the bounds of fields multiply (tiers, 12 ops a def, defs nested 3 deep) to gigabytes, so no count of parts bounds a thing. One byte cap each in `parseItem` and `parseStatusDef` (and what else holds a def from outside data: a skill, a monster, a reward, a feat's reward, a chapter), the number explained from the largest thing the app ships and the room's bounds it must fit (`SHEET_MAX` for a hunter's whole bag is the binding one: say how many worst items a sheet then holds and what the app does at the edge today), a thing over it refused whole with words the maker shows, and the worst-case tests of the docs and the sheet rebuilt on it. `OFFER_MAX` then follows from the item's cap times `GOODS_LINES`.
3. **Three faults found outside the tasks are fixed, each at its cause with a test, before unit 0**: a held `vitals` retried after a newer one landed restores old totals (room-events.ts `hold`, `applyAll`: a held message that a newer one of its key replaced must not land); the formula field's 200 characters cannot hold a rule formula of 403, so a GM who opens one can only delete (one bound for what the field takes and what the parser reads: `FORMULA_PARTS`); the memory store's gap past 2,000 events is written down with what a phone meets there and whether unit 0's cursor makes it worse, and fixed if a phone can lose a message by it.
4. **Order from here**: the three of ruling 3, ruling 2, unit 0, unit 2, unit 4, unit 5, unit 6, unit 7. Each hands back to the lead.

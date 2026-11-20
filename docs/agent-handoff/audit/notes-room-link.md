# The room link unit: the design

Goal (the owner's words): fix the problem, not the symptoms; every state explicit; when it breaks, where and how to fix it shows at a glance. This unit covers BUG-sync-4, BUG-sync-5, BUG-sync-7, SM-sync-5 and BUG-sync-2 of `docs/audit/2026-11-20-neon-reaudit.md`, and the two leftovers of `notes-dead-row.md` section 10. Written at `d432c1e` (branch `room-link`). No source file was changed.

## 1. The findings

How each was reproduced. "Ran": a throwaway test at `d432c1e` (deleted; the code of each is in its unit below as the failing test to write first). "Read": followed through the code; the audit's own browser run is cited.

1. **BUG-sync-4** (ran). Steps: a player posts a roll; the room expires while the POST is out; the poll answers 404 `no such room`; the POST then times out, or the tab reloads. Shows: the entry is still `sending` after `roomGone`, then `queued` again after `failed` or `reloaded`, for a room that no longer exists; it holds an `OUTBOX_MAX` slot for good. Run output: `after roomGone: ["sending"]`, `after failed: ["queued"]`, `after reload: ["queued"]`. First wrong place: `src/edge/sync.ts:653` (`flush`) writes "this page has a request out" (`send`, state `sending`) into the save, which outlives the page and the room; `src/core/sync/outbox.ts:119` then has to skip that state, and `sync.ts:675-680` (`deliver`) sends through `call` with no signal, so the link's `abort { gen }` never reaches it and its answer lands after the room is gone.
2. **BUG-sync-7** (read; the audit ran it in `tests/e2e/proof-sync-browser.e2e.ts`, not in the repo now). Steps: a player's tab turns read-only (another tab saved while it had a change waiting, or a newer app wrote the save) while in a room; the GM sends 50 gold; the player rolls. Shows: no gold, no window; the next poll asks `?after=` past the award; the roll answers `{ ok: false, why: 'noRoom' }`. First wrong place: `src/core/sync/link.ts:382` moves `cursor` in the link the moment a page arrives, before anyone knows the save took the page; `sync.ts:480` (`landPage`) then gets `read-only` from `store.apply` and `sync.ts:487` returns without a word. `sync.ts:640` turns the same refusal into `noRoom`.
3. **SM-sync-5** (read). `src/edge/store.ts:266-268` and the store chart's note (`scripts/charts/store.ts:51`, drawn into `docs/state-machines.md:1510`) say the link's bookkeeping still changes memory in a read-only tab through `store.update`. Nothing calls `store.update` but `store.apply` itself (`store.ts:295`), and `apply` refuses every step there (`store.ts:285`). The claim is the design BUG-sync-7 assumed.
4. **BUG-sync-5** (ran). Steps: live in room A as a player, call `app.api.sync.rejoinGM('A', key)` (the UI hides that form while in a room, `room.js:347`). Shows: the tap fails as `busy`. Run output: `reduce(playerInA, join A with KEY_A)` answers the same state and no effects. First wrong place: `link.ts:399` compares the room's code only; a phone's place in a room is its code and its role (the key).
5. **BUG-sync-2** (ran). Steps: load or import a save where two hunters each hold item `i50`, equipped. Shows: on the first load the second hunter's item is renamed `i101` and its weapon slot still says `i50`; the next repair empties the slot. Run output: `first load: item i101 equipped i50`, `second repair: equipped null`. First wrong place: `src/core/hunter/hunter.ts:225` checks `equipped` (and `:203` `titleId`, `:240-247` loadouts) against ids that `src/core/save.ts:414` renames later, after every hunter was walked.
6. **Leftover 1, a join from a stale sheet** (reproduced by the dead-row unit: `tests/e2e/table-turn.e2e.ts:290`, `test.fixme`). Steps: the GM's phone is offline; the player takes 999 damage on their own sheet (dying); the GM adds the player's hunter to a fight; the GM's phone comes back. Shows: the row joins up at 45 HP and its first `vitals` stands the player's dying sheet up. First wrong place: `src/views/combat.js:1029` builds the row from `remoteSheets()`, the last poll the GM's phone read, with nothing saying how old it is.
7. **Leftover 2, a death and a Revive in one update** (ran: `bun test --todo tests/applied.test.ts -t "a death then"` fails; expected `died, save` then `raised, gm`, received one `raised, fight`). Steps: the GM's room is away; a player's row dies, then the GM taps Revive; the room comes back. Shows: the player's Chronicle records one raise "by the fight" and no death. First wrong place: the `vitals` message carries a level (the totals) and, implied by the change between two levels, the moves of a life (`grant.ts:319` `fightHow` infers them). `post` with `standsFor` (`fight-save.ts:116`, `protocol.ts:442`) is right for a level and loses the moves.

## 2. The shared causes

**Cause A: one fact held in two places, and one copy moves without the other.**
1. "A message is on its way" is a fact about one page's open request. It is held in the save (`at: 'sending'`, shared by tabs, kept across reloads and across the room's end) and in an untracked promise. The save's copy lies after a reload (hence `reloaded`) and after the room ends (hence the skip in `roomGone`); the promise outlives the link stretch. BUG-sync-4.
2. "Where this phone stopped reading the room" is held in the link (`Live.cursor`) and in the save (`settings.sync.cursor`). The link moves its copy without knowing whether the save can move. In a read-only tab it cannot, and the link carries on as if it had. BUG-sync-7, SM-sync-5 (the doc that said a third path kept them together).
3. An item's id is held by the item and by the references to it (`equipped`, `titleId`, loadouts). The repair checks the references, then changes the id. BUG-sync-2.

**Cause B: a level and a move travel as one thing.** A life's moves (fell, a save made or failed, stable, died, raised) are events; HP, mana, statuses are levels. The `vitals` message carries both, and the receiver infers the moves from the change of level. Folding two levels into one (the outbox's `standsFor`, the held list's `replaced`) is right for levels and drops moves. Leftover 2. Leftover 1 is the same seam at the join: the row's first life is a copy of a level read at an unknown time.

BUG-sync-5 stands apart: an identity (the room and the role) checked by half.

## 3. The design

### 3.1 The outbox: the save holds what is owed, the page holds what is on its way

```ts
// src/core/sync/outbox.ts (the save's part)
export type Entry = Base & ({ readonly at: 'queued' } | { readonly at: 'refused'; readonly why: string });
export const ENTRY_EVENTS = ['sent', 'failed', 'refused', 'drop'] as const;     // `send` and `reload` deleted
const TABLE = {
  queued:  { sent: 'sent', failed: 'queued', refused: 'refused', drop: 'dropped' },
  refused: { sent: null,   failed: null,     refused: null,      drop: 'dropped' },
};
// The page's part: the one message of the live room on its way from this page, for the link stretch that sent it.
export type Sender = { readonly at: 'idle' } | { readonly at: 'sending'; readonly gen: Gen; readonly id: string };
/** What to send now: the oldest queued entry of `room`, when this stretch has none on its way. */
export function nextSend(box: Outbox, room: RoomCode, gen: Gen, s: Sender): Entry | null;
/** Messages of `room` wait and this stretch has none on its way (the pill's `waiting`). */
export function stalled(box: Outbox, room: RoomCode | null, gen: Gen, s: Sender): boolean;
```

1. `sync.ts` keeps `let sender: Sender` (named in the file's state list and the lint). A `Sender` of another gen than the link's counts as idle: that stretch ended and its `abort { gen }` aborted its request.
2. `deliver` goes through `fetchApi` with `track(gen).signal`, like every other request of a stretch. Its answer is stepped on the box by entry id whatever the gen: `sent` and `refused` are true facts about the room, and `failed` on a `queued` entry changes nothing. A late answer can no longer put an entry back in a queue, because there is no `sending` to go back from.
3. `roomGone` refuses every queued entry of the room. There is no other state left to skip.
4. Deleted: the `sending` row of the table, `send`, `reload`, `reloaded`, the boot write `outbox-reload` (`sync.ts:957`), and the room model's line that replays it (`tests/models/room-world.ts:149`).
5. What changes for a player: nothing on a good day. A message whose answer was lost is sent again at the next good poll, as today; the room takes an event id once (`server.ts` `addEvent` answers the held seq) and a tombstone is a put, so two tabs or a reload sending one entry twice make one message.
6. Invariants afterwards. Model (`tests/room-system-model.test.ts`): the check at line 66 moves from the save to the page: "a page's `Sender` is `sending` exactly when one box request of its stretch is out"; and new: "no entry is queued for a room the server deleted once the phone has heard it gone". Type: `Entry['at']` has no `sending`, so no code can write one.

### 3.2 The link: a read-only tab is a state of the link

```ts
// src/core/sync/link.ts
/** This tab may not change its save (store-life.ts `readOnly`): the link holds no room, asks nothing and writes nothing. */
export type ReadOnly = { at: 'readOnly'; gen: Gen };
export type Link = LinkOff | Idle | Creating | Joining | Live | Upgrading | ReadOnly;
// events: { type: 'readOnly' }      raised by sync.ts when the store turns read-only
//         'replaced'                already raised when an import, restore or reset makes the tab ready: it leaves ReadOnly
// BootInput gains `writable: boolean`; a tab that opens read-only boots in ReadOnly.
```

| From | `readOnly` | `replaced` | `upgrade` | any other |
|---|---|---|---|---|
| idle, creating, joining, live | ReadOnly (the state's `exit`: abort, clear the timer, `linkLost` to the push; a tap out is told `readOnly`) | as today | as today | as today |
| ReadOnly | same | live in the save's room, or idle (`replaced` as from idle) | upgrading | same, no effects |
| off, upgrading | same | as today | as today | as today |

1. `stored(ReadOnly)` is null, so the link writes nothing while read-only, and the save's `cursor` stays where the last landed page left it. Back to ready, the link starts from the save's room and cursor, so the GM's award lands then.
2. `connection` gains `'readOnly'`; the pill says "This tab cannot save, so it is out of the room." `TapKind` gains `readOnly`. `Posting`'s `why` gains `readOnly`; `postLetter` answers it before it asks for the room, and `postNews` answers `readOnly`, which each view words ("This tab cannot save. Nothing was sent.").
3. `store.update` leaves the public store (its body moves into `apply`), so no code can write around the read-only rule; the comment at `store.ts:266` and the chart note at `scripts/charts/store.ts:51` lose the false claim.
4. A refused write in `sync.ts` (`landPage`, `save`, `boxDo`) is no longer silent: `reported('sync', ...)` names the step and the refusal. With the link in ReadOnly there is no legitimate refusal left, so a report is a bug, seen at once.
5. Invariant: the exhaustive link model (`tests/sync-model.test.ts`) adds "from ReadOnly, no event answers a `request` or a `save` effect" and "a live link never sits with a read-only store".

### 3.3 Joining the room the phone is in (BUG-sync-5)

`link.ts:399` becomes: the same code and the same key is the same place (`same`); anything else begins a join. `attempt.ts` `taken`: a join tap the link answered `same` because it is already live there, as that role, answers `ok` with the role (today `busy`). No shape change.

### 3.4 The repair: ids first, references after (BUG-sync-2)

1. `RepairRun.bad` entries carry their owner: `[o, prefix, owner: Hunter | null]` (`src/core/repair.ts`).
2. `fixHunter` stops at shapes. A new `fixRefs(h, renamed: ReadonlyMap<string, string>)` in `hunter.ts` checks `equipped`, `titleId`, loadout slots and the penalty's and chain's quest ids, reading a reference through `renamed` first. `renamed` holds, for one hunter, each old id that hunter no longer holds and the one new id its renamed object took.
3. `repairSave` (`save.ts:414`) renames, then runs `fixRefs` for every hunter. `parseSheetHunter` runs `fixRefs` with an empty map (it keeps malformed ids). The starter hunter is made after the rename from the new `seq`, so its ids cannot collide; it stays where it is.
4. Invariant: a property test in `tests/save.test.ts`: for any save, `repairSave(repairSave(x))` equals `repairSave(x)` (a second repair changes nothing).

### 3.5 A life's moves travel as moves (leftover 2)

```ts
// src/core/protocol.ts: a new event, no `standsFor` (each stands for itself)
lifeMoved: { to: [SheetKey]; news: LifeNews['kind']; how: LifeHow; reason: string }   // fell | saved | failed | stable | died | raised
// src/core/combat: a row's life step that moves it answers an effect { type: 'lifeMoved', row, news, how }
```

1. The fight's `life` command and damage that drops a row answer `lifeMoved` from `row-life.ts`, where the move is known (no inference).
2. `fought` (`fight-save.ts`) posts a remote row's `lifeMoved` before its totals, in the same write. A local row's write-back records the fact from the effect.
3. `vitals` keeps `standsFor`: a newer total takes an older one's place in the outbox and in the held list, which is right for levels. Its applier writes the totals (the life's state among them) and records and tells nothing of the life. `lifeMoved`'s applier records the fact and tells the toast, and writes no life, so a held one tried late records a true fact late and puts no old level back.
4. `grant.ts`: the `totals` edit records no life fact; `fightHow` is deleted; a new edit records a fight's move as told.
5. Invariant: the room model gains "after the outbox drains, a player's Chronicle holds every life move the GM's fight made for that hunter, once each, in order".

### 3.6 The join reads a fresh sheet (leftover 1), default (a) of the dead-row note

`remoteSheets()` entries gain `fresh: boolean`: read in this link stretch by a poll while `health` is `ok`. `combat.js` adds a player's hunter only from a fresh sheet; otherwise it says "Kai's sheet is from before the room went away. Add Kai when the room answers." What stays open: a fall in the last poll before the join (5 s, 3 s in a fight). Closing it is (b) of the dead-row note, a new fight command that seats a row's life again from a newer sheet. Decision 1 below.

### Files of the other helpers

3.1 to 3.4 and 3.6 touch none of `src/core/combat/**`, `src/core/rules.ts`, `src/core/hunter/grant.ts`. 3.5 touches `src/core/combat/row-life.ts`, the fight's effect type, `src/core/combat/fight-save.ts` and `src/core/hunter/grant.ts`: build it after both helpers have merged.

## 4. The build

Each unit starts with its failing test, ends with `bun run test` (and the browser files named) under `flock /tmp/box.lock`, and is one commit.

1. **U1, the outbox without `sending` in the save (Opus).** Failing first: `outbox.test.ts` "a roll on its way when its room is gone is refused, and the send's late answer leaves it refused"; the room model's "no entry queued for a room heard gone". Files: `src/core/sync/outbox.ts`, `src/edge/sync.ts`, `tests/outbox.test.ts`, `tests/models/room-world.ts`, `tests/models/solo-events.ts`, `tests/room-system-model.test.ts`, `tests/lint.test.ts` (the new `let`), `scripts/charts/outbox.ts`, `docs/state-machines.md` (`bun run charts`), `docs/guide/room-sync.md` (the outbox row). About 250 lines. Browser: `room-sync.e2e.ts`, `phone.e2e.ts`, `solo.e2e.ts`.
2. **U2, the read-only link (Opus).** Failing first: `link.test.ts` "a read-only tab's link leaves the room, asks nothing and writes nothing, and reads on from the saved cursor once the tab is ready"; a browser test in `room-sync.e2e.ts` from the audit's proof: "a read-only tab says it cannot follow the room, and shows the GM's 50 gold once a restore makes it ready". Files: `src/core/sync/link.ts`, `attempt.ts`, `taps.ts`, `connection.ts`, `src/core/api.ts`, `src/edge/sync.ts`, `src/edge/store.ts`, `scripts/charts/link.ts`, `scripts/charts/store.ts`, `tests/link.test.ts`, `tests/models/sync-world.ts`, `tests/sync-model.test.ts`, charts. About 300 lines.
3. **U3, the views word `readOnly` (Sonnet).** `src/views/combat.js`, `gm.js`, `quests.js`, `room-pill.ts`: each `postNews` switch and the pill's words gain the case; the typecheck lists every place (`GOES` and the words are `Record`s over the union). Check: `bun run test`, `room-view.e2e.ts` and `gates-quests-dailies.e2e.ts`. Under 60 lines.
4. **U4, joining the room the phone is in (Sonnet).** Failing first: `link.test.ts` "a player who rejoins their room as its GM opens it as GM"; `attempt.test.ts` "a join of the room the phone is in, as the same role, answers that role". Files: `link.ts`, `attempt.ts`, the two tests. Under 50 lines.
5. **U5, ids before references in the repair (Opus).** Failing first: `save.test.ts` "two hunters that share an item id each keep their weapon equipped, through two repairs" (the run in 1.5), and the second-repair property. Files: `src/core/repair.ts`, `src/core/hunter/hunter.ts`, `src/core/save.ts`, `tests/save.test.ts`. About 120 lines.
6. **U6, a life's moves as their own messages (Opus; after the combat and grant helpers merge).** Two commits. U6a, core: the `lifeMoved` effect from `row-life.ts`, the local write-back records it, `grant.ts` drops `fightHow`; failing first, a `fight-save.test.ts` case "a local hunter who dies and is revived in two commands records a death and the GM's revive". U6b, the room: `protocol.ts` event and its `VALID` case, `room-events.ts` appliers, `fight-save.ts` posting, `combat.js` building it; failing first, the `applied.test.ts` todo turned on (rewritten for two kinds of message) and the room model's invariant. About 300 lines in all. Browser: `table-turn.e2e.ts`, `fight-vitals.e2e.ts`, `character.e2e.ts`.
7. **U7, the join reads a fresh sheet (Sonnet; after decision 1).** Files: `src/edge/sync.ts` (`fresh`), `src/core/api.ts` (`RemoteSheet`), `src/views/combat.js`, `tests/e2e/table-turn.e2e.ts` (the fixme becomes: the add is refused while the room is away; after it answers, the row joins dying). Under 80 lines.

Order: U1 and U2 share `sync.ts`, so U1 then U2; U3 needs U2; U4 and U5 stand alone and can go beside them; U6 waits for the other helpers; U7 waits for the owner.

## 5. The owner's decisions

1. **May the GM add a player's hunter to a fight while the room is away?** Default: no. The add says the sheet is from before the room went away, and works once the room answers. Yes means building (b) of the dead-row note: a fight command that seats a row's life again from a newer sheet, and the player's phone told a life it then takes back.
2. **What a read-only tab shows of the room.** Default: it leaves the room and says why; the tab that can save follows it, and a restore or import brings this one back. The other way: it keeps showing the room's docs (the fight, the map) without landing anything or moving its cursor. That is a second, read-only kind of being in a room, and more to build and test.

## Principles that changed a choice

1. `principle-fix-root-causes`: the audit's fix for BUG-sync-4 adds `sending` to `roomGone`'s filter. That is the place it surfaced. The fault is a page's request written into the save, so `sending` leaves the save and the skip has nothing left to skip.
2. `principle-model-the-domain`: the read-only tab is a state of the link with its row in the table, not a `store.readOnly` check in each of `landPage`, `postLetter`, `save` and `flush`.
3. `principle-foundational-thinking`: two tabs share the save, and `sending` in it was their only coordination. Making the send idempotent (it already is at the server) rather than shared lets each page hold its own `Sender`.

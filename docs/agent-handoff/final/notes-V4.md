# V4: one player, one name, one target

Goal: a player's hunter is one name on every screen and one target in every picker, a failed tap reads one way, and
the room's bounds (its code's alphabet, its largest sheet, how long a removal lasts) are each written once. Problem:
pickers wrote 'l:'/'r:' prefixes, views guarded a parsed sheet again with their own defaults and cuts, a failed tap's
kind was a bare string worded four ways, and the code alphabet, the sheet bound and the removal window were copies.
Smallest change: party.ts `pickables`, the guards deleted, sync/taps.ts, and the bounds in ids.ts, protocol.ts and
room-server.ts.

## Inventory (code at 9c2ada6)

| Row | Verdict | Where |
|---|---|---|
| 57 | still true | quests.js:153, 159 (the Job Change picker), skills.js:227, 233-234 (the skill giver) and :302, combat.js:970, 1120 (the fight's hunter select) |
| N8 | still true | gates.js:119, 311; gm.js:227-228, 279, 314; quests.js:370, 446; skills.js:227; custom.js:267-282; sync.ts:868 (the roster) |
| N9 | still true, one kind more | sync.ts:101-117 (`TapError.kind: string`), room.js:187, 199, 226, 233, gm.js:723, onboard.js:163, 209, 250; the typecheck found `busy`, raised by `begin` and worded nowhere |
| RM1 | still true | ids.ts:21, invite.ts:5, room.js:6 and its words at 358, onboard.js:101, server.ts:41 |
| SV1 | still true | server.ts:364 `SHEET_MAX`; a 413 reached the pill as `notSent` |
| SV2 | still true | server.ts:333-343 pruned `_kicked` by `REMOVED_MS` beside room-server.ts `keptOut` |

## The rows

**57.** Cause: a control's value carried a prefix to tell a hunter id from a sheet key, cut off again in each reader.
Change: party.ts `pickables(hunters, sheets)` lists them with the id a control carries (a hunter id or a sheet key,
which never look alike) and `pickedRef(list, id)` reads one back. Lint: "a picker carries a hunter by its id or sheet
key". Test: party.test.ts. Commits 2a2b83a, 3351ea1 (skills.js, combat.js).

**N8.** Cause: a parsed sheet (protocol.ts reads it as a `Hunter`, a name of 1 to 60 characters) was guarded again.
Change: the views read `r.data.name` and the parsed build, rank and objectives as they are; `sheetName(sheets, key,
none)` is the one fallback for a key with no sheet. Lint: "a view reads a player's sheet as the room's parser left it"
(views and edge). Commits 2a2b83a, b46c094 (gates.js), 3351ea1.

**N9.** Cause: the kind was a string and each view had its words. Change: src/core/sync/taps.ts `TapKind` (badcode,
notfound, keyRefused, removed, busy, replaced, net) and `tapWords(kind, code)`; `TapError` carries a `TapKind` only (no
HTTP status); the Room view, the GM view and onboarding read the one table. The GM view no longer says "Could not reach
the server" for another tab's takeover. Test: party.test.ts "why a tap failed". Commit 2a2b83a.

**RM1.** Change: ids.ts `CODE_CHARS`, `CODE_LEN`, `CODE_LEFT_OUT`, and the regex built from them; invite.ts, both views
and server.ts read them, and the words "no 0, 1, I or O" are built from `CODE_LEFT_OUT`. Test: invite.test.ts.
Commit ff2fe57.

**SV1.** Change: protocol.ts `SHEET_MAX` (server.ts reads it); sync.ts counts the push's JSON before it sends and refuses
it as `too-large` itself; connection.ts `sheetTooBig` with its words on the pill and the Room view (copy-tasks.md).
Tests: server-rooms.test.ts (a push of exactly `SHEET_MAX` is taken, one more refused), push.test.ts (too large reads
as `sheetTooBig`, a full room still as `notSent`). Commit c52c836.

**SV2.** Change: room-server.ts `kickedAfter(old, key, name, now)`; server.ts writes what it answers. Test:
room-server.test.ts. Commit 0c4f027.

Lines in Lane A's files: gates.js (b46c094: two payee names), skills.js and combat.js (3351ea1: `pickables`).

Principles: boundary-discipline (a parsed sheet is trusted inside; the guards were deleted, not unified);
type-system-discipline (`TapKind` as a union the compiler checks: it found `busy`).

Left: combat.js:877 reads a remote sheet's data for the identity badge with an `|| {}` guard (Lane A's file, V10's
rows); sync.ts recentKicks keeps 'Hunter' for a removed player whose name the doc does not hold, which is a key with no
sheet.

# V12: this phone's identity out of the save's files

Goal: a campaign file never carries this phone's identity, and a file brought in never takes it over. Problem: the
device id and its secret token for the sheets this phone writes live in the save; the export deleted only the GM keys,
and an import, a restore or a reset replaced the whole save. Smallest change: one export function that leaves the
identity out, and the one place a save is swapped in keeping this phone's.

## Inventory (code at 11b1e6a)

| Row | Verdict | Where |
|---|---|---|
| IO1 | still true | io.js:248-251 (the export deletes `gmKey` and `gmKeys` only); store.ts:220 `replace` (import, restore and reset swap the whole save in); save.ts:555-557 (the repair makes an id and a token only when the save has none) |

## The row

**IO1.** Cause: what a phone is to the room is a field of the save, so every copy of the save is a copy of the phone.
Change: save.ts `exportedSave(save, withKeys)` is the campaign as a file: no `deviceId`, no `deviceToken`, and the GM
keys only when "Include GM key" is on; io.js's Export writes it. save.ts `keepPhone(save, mine)` gives a save swapped in
this phone's id and token; store.ts `replace` (the one path of an import, a restore and a reset) applies it, so a reset
keeps the phone too (it made a new identity before, which the room saw as a new phone). `store.exportJSON`, which no
view uses now, is deleted (customization.e2e.ts reads the save instead). Tests: save.test.ts "this phone's identity
stays on this phone" (the file has neither field, keys only when asked; a swapped-in save keeps mine; a file read
back on another phone is that phone); save.e2e.ts (the exported file has no device id, token or GM key; the second
phone that imports it keeps its own id and token).

Variants weighed: moving the id and token to device memory (`store.device`) is the deeper move, but every reader of
`settings.deviceId` (the room's keys, `targets`, the link, the tests' fixtures) would change with it, and a backup kept
on this phone is this phone's anyway; the two places a save crosses the phone's edge are the export and the swap, and
both are now one function each.

Principles: boundary-discipline (the file is the boundary: what crosses it is decided once, on the way out and on the
way in).

Left: a lint that a campaign file is written only through `exportedSave`: io.js is its one writer today.

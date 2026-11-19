# Notes: the phone's sync fields and the campaign's (audit BUG-sync-3, AW-sync-1)

## The finding

`settings.sync` mixes two owners. A campaign file carried this phone's outbox, held events, applied ring, seen
places, waiting runs, offers, its bind and `serverOk`; a save swapped in (import, restore, reset) brought the other
save's copies of all of them and threw this phone's away. `keepGmKey` gave the phone its own key only when the file was
of the phone's room, so a file of another room replaced the whole ring of GM keys.

Reproduced in `tests/save.test.ts` ("the phone's sync fields and the campaign's") before the change.

## The rule

The room knows a phone by its device id and token, and a hunter on it by that device id and the hunter's id (a sheet
key, `dev:h1`). What the room addressed to this phone, or what this phone owes the room under that identity, is the
phone's: it means nothing on another phone (the room refuses a letter `by` another device's sheet with 403, and a
sealed or addressed message never reaches it), and it is still owed or still guards this phone after any swap. What
the campaign is, and which room it plays in, is the campaign's.

Each field of `SyncSettings` has its owner in `SYNC_OWNER` (`src/core/save.ts`), so a new field does not typecheck
until it is given one. `exportedSave` writes only the campaign's fields (and the keys when asked); `keepPhone` takes
the campaign's fields from the save swapped in and the phone's from this phone, and merges the keys.

| Field | Owner | Why |
|---|---|---|
| `room` | campaign | The room the campaign plays in. A file moves the phone into its room (`tests/e2e/room-sync-fixes.e2e.ts`, "replacing the campaign with a file from another room"); the link reads it after a swap (`replaced` in `link.ts`). |
| `cursor` | campaign | How far into that room the campaign's log and hunters reach. It is the room's cursor, so it goes where `room` goes. A rewind (a restore of an older backup) re-reads events; the phone's `applied` ring keeps each from landing twice. |
| `lastRoom` | campaign | The room the campaign was last in and why it left. The link reads it with `room` after a swap. |
| `boundHunterId` | campaign | Which of the campaign's hunters plays in the room: an id of its own hunters, repaired to one of them at read. After a swap into a room the link's head binds the active hunter anyway (`bindJoin`). |
| `gmKey` | key | The GM key of `room`. A credential of a phone: in a file only with "Include GM key". After a swap it is the key this phone holds for the campaign's room, else the file's. |
| `gmKeys` | key | The ring of this phone's GM keys. In a file only when asked; a swap merges the file's into the ring and never replaces it: the phone's own key wins for a room both hold, and under the cap (`KEYS_MAX`) the file's go first. |
| `deviceToken` | phone | This phone's secret for its sheets. |
| `serverOk` | phone | Whether this phone has reached the server: what the boot reads of this phone's network, not of a campaign. |
| `joinedAt` | phone | When this phone's hunter joined its room, read against the room's removal of this phone's sheet key. Another phone's join time would judge this phone's removal wrongly. |
| `outbox` | phone | Letters signed by this phone's sheet keys, each for its room. Another phone's would be refused; this phone's are still owed after a swap. |
| `held` | phone | Events addressed to this phone's sheets that did not land yet. |
| `applied` | phone | The ids of events that landed on this phone, so a re-read lands nothing twice ("lands once from the phone's first join"). Kept across a swap, a rewound cursor re-reads without landing again. |
| `runs` | phone | This phone's won solo runs waiting for the GM's answer, addressed to this phone's sheet. |
| `offers` | phone | This phone's records of the room's offers; the sealed ends reach only the phones of the hunters named, so another phone would never close them. The goods aside go to the hunter of the record's id when the end is read: to the room, that hunter is this device and that id, whatever the save swapped in holds under it. |
| `seen` | phone | Where this phone stopped reading each room it went out of. |

`settings.deviceId` is the phone's too (outside `sync`), as before.

## Choices and what they cost

- `keepGmKey` is gone: the key rule is part of `keepPhone`, which runs on every swap (import, restore, reset). So a
  restore of a backup also merges the backup's ring. A key the ring dropped since (a gone room) comes back; the next
  rejoin of that room drops it again. Judged acceptable over a second rule for one kind of swap.
- A swap that moves the phone to another room does not keep the old room's place in `seen`, as a leave does
  (`linkSaved`). It did not before either. Doing it here would make `keepPhone` a second writer of `seen`. A follow-up:
  run the swap's room move through `linkSaved`.

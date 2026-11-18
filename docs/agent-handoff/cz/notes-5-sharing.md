# Notes: unit 5, sharing custom content

Principles read: boundary discipline, idempotent operations, test behaviour, unslop. Started at a90b98b.

## Step 1: core

- `src/core/pack.ts`: `packOf(save, savedAt, kind?, id?)` makes the pack doc (everything, one kind, one entry; plus every library status its entries name, followed through statuses that name statuses). `parsePack(unknown)` answers the typed pack and, per kind, kept, unreadable (the parser refused it) and over (past the cap). `mergePack(target, pack, mode)` answers the new library, monsters and seq and, per kind, added, renamed, replaced and full. Statuses merge first; Add's renamed keys are rewritten in the pack's own items, skills, bundles, monsters and status defs.
- tests/pack.test.ts: 20 tests. Checked by hand that dropping the key rewrite fails the Add test, and that a Replace that pushes instead of overwriting fails three.
- `bun run test`: 1653 pass. Commit 1.

## Step 2: export

- `src/edge/pack-code.ts`: `makeCode` and `readCode`. A code is `HS1.` + base64url of deflate-raw JSON + `.` + CRC-32 of the base64url text (8 hex). `readCode` ignores white space and text around the code, refuses a code that is cut or has a character changed (`damaged`), past 5 MB, or on a browser without CompressionStream (`unsupported`). tests/pack-code.test.ts: 4 tests.
- io.js: a "Custom content" section in the Data view with "Share custom content" (`app.api.share.open`): a list window (Everything, then each kind that has entries, with counts), then "Share as" (Save a file, Show a code). The file is `hunter-library-YYYY-MM-DD.json`; the code window has the code in a read-only text box and "Copy code" (the room card's pattern: `navigator.clipboard.writeText`, the button says Copied; on failure the box is selected and it says "Select and copy").
- workshop.js: "Share custom content" at the top (same `share.open`) and "Share" on every library row (`share.entry(kind, id)`), a code holding that entry and the statuses it names.
- `ShareApi` in api.ts. `bun run test`: 1657 pass. Commit 2.

## Step 3: import

- io.js: the file picker reads a file whose `kind` is 'library' with `parsePack`; "Paste a code" (a text box and Read code) reads one with `readCode` then `parsePack`. Both open "Import custom content": a line per kind it holds ("Items: 1"), a line per refusal ("Refused: 3 items that could not be read", "Refused: 300 items past the 200 a share holds"), and Cancel, Replace, Add. Then `store.backupNow('pre-import')` and one `store.update` that runs `mergePack` and writes the library, the monsters and seq. A toast says how many were added and replaced; a warning window lists what did not fit. A code that cannot be read says why in a "Code not read" window and changes nothing (the pasted text stays in the box).
- A campaign file's preview has a "Custom content: …" line when its library or monsters hold any; after "Add hunters to party", "Bring its custom content too?" offers Skip, Replace, Add, the same path.
- `PACK_KINDS` is in the Workshop's order (statuses, items, skills, monsters, rewards), so the preview lines and the summary read in that order.
- `bun run test`: 1657 pass. Commit 3.

## Step 4: browser tests

- `tests/e2e/sharing.e2e.ts`, 6 tests on a 390 px phone: the code for everything copied (clipboard read back) and pasted on a fresh phone (preview lines, Add, a `pre-import` backup, the five in its Workshop, Brakk's Frost Bomb puts "Frostbite · 2r" on a goblin there); the same code again with Add ("… 2", the copied item and monster name `frostbite-2`) and with Replace (nothing new); a code with one changed character ("Code not read", the library and the backups unchanged); one item shared from the Workshop (Statuses 1, Items 1); a library file saved from the Workshop's Share custom content, imported through the file picker; a campaign file's Add hunters offering its custom content.
- The GM's phone in these tests has its gates and their generated monsters removed in setup: the starter campaign rolls its gates, and a rank without a bestiary monster makes one, so the count of monsters varies. The fresh phone's checks compare what a merge appended.
- Code size: everything with one of each kind (the test's five, a monster with one ability and a bundle with a boon) is 821 characters (1220 of JSON); one item with its status 368; one status 209; one monster with its status 503.
- One run: 6 passed (47 s), first run after the kind order fix.
- Commit 4.

## Decided by the helper

- A code ends with `.` and the CRC-32 (8 hex) of its base64url text. deflate-raw has no check of its own, so a changed character could inflate to other valid JSON; the check refuses it. The CRC is hand-written: `crypto.subtle` is missing on a plain-http LAN address.
- `readCode` ignores white space and text around the code, so a code wrapped or quoted by a chat app still reads.
- The pack's lists hold no ids; the statuses keep their keys. Empty parts are left out of the doc, which keeps codes short.
- A pack holds at most the library's cap of each kind (200); entries past it are counted "over" and named in the preview. A save has no cap on monsters, so a merge stops adding monsters at 200 (`PACK_CAP.monsters`, in pack.ts, not in `LIMITS`, since the save repair does not prune them).
- Add renames a status when its key is in the library or is a built-in's, or its label (any case) is one a library or built-in status has: "Poisoned 2" under `poisoned-2`. A pack's changed built-in therefore arrives under Add as a copy, and under Replace as the change to that built-in.
- Add renames an item, skill, bundle or monster when its name is taken, exactly as written. Replace matches by exact name and overwrites the first match, keeping its id.
- When a status does not fit (library full), an imported item naming it keeps its op as written; the status is counted and named in "Some did not fit", but its def is not copied into the op.
- The Data view and the Workshop share through one flow, `app.api.share` in io.js (`open` and `entry`). The Workshop's top button opens the same two windows.
- The clipboard: the room card's pattern copied (writeText, the button says "Copied"; on failure the box is selected and it says "Select and copy"). room.js has no shared helper to call, and moving its `flash` out was outside the brief's files.
- A campaign file's custom content is offered after its hunters are added, in a second window with Skip, Replace and Add; it takes its own backup, so that import is two updates (the hunters, then the content), each after a backup.
- A status with a bad op is kept with that op dropped (what `sanitizeDef` does); only an entry the parser returns null for counts as refused.
- The renamed copy's suffix is " 2", as the brief says; the Workshop's Duplicate keeps "(copy)".

## Unsure

- An imported campaign's old `rulesOverrides.conditions` (statuses of a much older app) are not brought by "Add hunters"; `campaignPack` reads `library` and `monsters` only.
- Add by name is case-sensitive ("frost bomb" and "Frost Bomb" are both kept); statuses compare labels without case, as `slug` does.
- A merge of 200 entries runs a `findIndex` per entry over a list of at most 200: no measurable cost, not measured.

## Step 5: checks and AGENTS.md

- `bun run test`: 1657 pass, 0 fail. `bun run deps -- --write` left the map as the commits wrote it. No machine changed, so no chart.
- Browser, one run (9.5 min), first run, no pause seen: character, combat-turns, makers, reward-room, room-sync-fixes, room-view, save: 77 passed. sharing: 6 passed in step 4.
- AGENTS.md: a "Where things live" row for a pack (pack.ts, pack-code.ts, the Data view and the Workshop's Share; tests/pack.test.ts, tests/pack-code.test.ts, sharing.e2e.ts), and a recipe line for a new kind of custom content.
- copy-tasks.md: a section for unit 5.
- Commit 5.

# Brief: sharing custom content (customization, unit 5)

One helper (Opus, heavy-writer), in the main tree, on branch `claude/zen-pasteur-ov4cgd`. No other helper writes while you work. Earlier units are merged; read their notes in `docs/agent-handoff/cz/`.

Run `bun install` once. Read first: `AGENTS.md`, `docs/agent-handoff/helper-rules.md`, `docs/agent-handoff/cz/design.md` (section "Sharing"), `docs/agent-handoff/cz/inventory.md` section 8, `src/views/io.js`. Principle skills: `principle-boundary-discipline`, `principle-make-operations-idempotent`, `principle-test-behavior-not-implementation`, and `unslop`.

Commit after every numbered step (name the files, plain messages, no AI attribution, no Co-Authored-By). This overrides the "do not commit" line of your built-in rules. Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3243 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-cz5`. Never run `playwright install`. Rerun a file once before reading anything into one failure.

Notes file (append a line after each commit): `docs/agent-handoff/cz/notes-5-sharing.md`.

## Why (the owner's goal)

He is optimizing for customizability, and a GM's custom statuses, items, skills, enemies and reward bundles are work worth keeping. Today they leave a phone only inside a whole-campaign file, and importing with "Add" drops them. A GM must move their content to another phone or campaign, all of it, one kind or one entry, without replacing the campaign there.

## The decided model

A pack is `{ schema: 3, kind: 'library', savedAt, library: { statuses, items, skills, rewards }, monsters }`, any part of which may be missing. It is read by one pure function in core that runs each entry through its kind's parser and answers the typed pack plus a count per kind of what it kept and dropped. A pack is merged into a save by one pure function with a mode per call: Add keeps both (an entry whose key or name exists gets a number suffix, "Frostbite 2"; a status's key is re-slugged with it) and Replace overwrites the entry with the same key (statuses) or the same name (items, skills, bundles, monsters). The caps of each list hold after a merge; what does not fit is counted and reported, never silently dropped. A code is the pack as JSON, compressed with `CompressionStream('deflate-raw')` and written as base64url with the prefix `HS1.`; reading it reverses that. Compression lives in the view or edge (a browser API); the core functions take and give plain objects.

## Steps

Each step: tests first, then the change, then `bun run test`, then commit.

1. **Core** (`src/core/pack.ts`): `parsePack(unknown)` and `mergePack(save, pack, mode)`, pure. `tests/pack.test.ts`: round trip of one of each kind; hostile input (wrong types, a status with a bad op, 500 items); Add renames and keeps both; Replace overwrites by key or name; merging the same pack twice with Replace changes nothing the second time; the caps; a status an imported item or skill applies by key arrives with it when the pack holds it, and when the pack does not hold it the item's op is kept (the op may carry its own `def`).
2. **Export** in `io.js` (the Data view) and from the Workshop: "Share custom content" with a choice of everything or one kind, as a file (`hunter-library-YYYY-MM-DD.json`) or a code (shown in a text box with Copy; use the clipboard helper the room invite uses). Each Workshop entry gets "Share" for that one entry (a pack holding it, and the statuses its effects name), as a code. When a pack holds a skill, item or monster whose effects name a custom status, the export includes that status so the pack stands alone.
3. **Import** in `io.js`: the existing file picker recognises a pack (`kind: 'library'`) and a new "Paste a code" box takes a code. Both show a preview (how many of each kind, how many refused and why) and offer Add or Replace, then back up the save as the other imports do, and merge through `mergePack` inside one store update. The existing "Add hunters" import of a campaign file also offers to bring that file's custom content (its `library` and `monsters`) through the same path, so Add no longer drops it.
4. **Browser tests** in a new `tests/e2e/sharing.e2e.ts` (copy `tests/e2e/save.e2e.ts`): a GM with one custom status, item, skill, enemy and bundle copies the code for everything; a second phone (a fresh context) pastes it, sees the preview counts, taps Add, and its Workshop lists all five and the item's status works in a fight there; pasting it again with Add makes "… 2" copies and with Replace makes none; a code with a damaged character is refused with a message and changes nothing; one entry shared from the Workshop arrives alone with the status it needs; a file export imports the same way.
5. `bun run test`, `bun run deps -- --write`, the e2e files that touch the Data view. `AGENTS.md`: a row in "Where things live" for a pack (`src/core/pack.ts`, `tests/pack.test.ts`) and one sentence in the recipe for a new kind of custom content: its parser, its home in `library`, its line in `parsePack` and `mergePack`, its Workshop section.

## Rules

- Nothing is imported that its parser did not give back.
- An import is one store update after a backup, so a failure leaves the save as it was.
- A code holds no room key, no GM key and no hunter.
- No new dependency.
- Words go to `docs/agent-handoff/copy-tasks.md`.
- If a step needs a decision the design does not make, choose the smaller option, write it in the notes under "Decided by the helper", and go on.

## Done means

`bun run test` passes and the browser files pass. Final reply under 200 words: the commit range, the counts, the size of a typical code in characters, what you decided yourself, anything unsure.

If you are still going after about 70 minutes of work, commit what passes, write exactly where you are in the notes, and reply.

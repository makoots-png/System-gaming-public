# Brief: wire the save parser into the store (M2 unit 4b)

Final (fourth phase 3 lead, Nov 12). Read `docs/agent-handoff/helper-rules.md` first. Where this brief and the rules
differ, this brief wins.

You work in your own git worktree (your current directory), on your own branch. The worktree may start at `main`:
if `git log -1` is not the commit named in your prompt, run `git reset --hard <that commit>` on your own branch first.
Run `bun install`. Commit after each step below (plain messages, no AI attribution lines, no `.claude/`). Do not push.
Do not touch `the repo root` itself.

Port: `E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --output=/tmp/pw-store`.

Notes file (append after each commit): `docs/agent-handoff/p3/notes-store-wiring.md`.

## Why

`src/core/save.ts` defines what a save is and parses one: `parseSave(text, env)`, `parseSaveValue`, `repairSave`,
`freshSave`, `starterHunter`, `dailyQuest`, `newHunter(R)`, `rulesOf`, `LIMITS`, `SCHEMA = 3`, the one-way migration
from v2 and v1. Read its exports and `tests/save.test.ts` first. `src/edge/store.js` still has its own copy of the
shape, the repair and the migration. Two copies drift. After this unit the store only does storage, backups, notices,
prefs and subscriptions, and asks core for everything about the shape.

It also fixes bug 3 (`docs/agent-handoff/p3/bugs-found.md`): a stored save that is valid JSON but not a save
(`{"foo":1}`, `[]`, a schema 2 object whose `hunters` is not a list) is silently replaced by a starter hunter. The
parser now answers `invalid`. The store must keep the raw text in the backups and tell the player.

## Design (decided)

Core decides, the edge acts, as in `src/core/upgrade.ts` and `src/edge/upgrade.ts`.

### Step 1: the load decision, pure, in `src/core/save.ts`, tested in `tests/save.test.ts`

```ts
export type Stored = { v3: string | null; v2: string | null; v1: string | null };   // the text under each storage key
export type Loaded = {
  save: Save;
  readOnly: boolean;                                   // a newer app wrote it: never overwrite
  freshInstall: boolean;                               // nothing was stored at all
  backup: { reason: string; data: string } | null;     // raw text the edge must put in the backups before it writes
  notice: 'newer' | 'unreadable' | null;               // the edge owns the words
};
export function loadSave(stored: Stored, env: ParseEnv): Loaded;
```

Rules, first match wins:
- `v3` present: `parseSave`. `save` → use it. `newer` → its save, `readOnly: true`, notice `newer`. `invalid` →
  backup `{ reason: 'unreadable', data: v3 }`, notice `unreadable`, `freshSave(env, { onboarded: true })`.
- else `v2` present: `save` → backup `{ reason: 'before the update', data: v2 }`, use the migrated save. `invalid` →
  as above with the v2 text. (A `newer` answer cannot come from the v2 key in practice; treat it as for v3.)
- else `v1` present: same as v2 (the parser dispatches to the v1 migration).
- else: `freshSave(env, { onboarded: false })`, `freshInstall: true`.

An unreadable newer key never falls through to an older key: the older text is from before the newer one existed.

Write the tests first (one `test` per rule above, named for what the player gets, plus: an unreadable v3 does not
fall back to a readable v2; a v2 save in a fight and a room loads with hunters, no fight, no room and a backup of the
old text). Commit.

### Step 2: `src/edge/store.js` becomes `src/edge/store.ts`, strict

- Update the imports in `src/app.js`, `src/views/custom.js` (it imports `LIMITS`: point it at `../core/save.ts`) and
  the lazy import in `src/views/ui.js`. Update the file names in `tests/lint.test.ts` (`mayRead` list) if needed.
- The `store` API the views use does not change: `get, update, id, active, hunter, newHunter, backupNow, backups,
  restore, exportJSON, importJSON, reset, subscribe, prefs, setPrefs, freshInstall, saveOk, readOnly, notify,
  notices`.
- Delete from the store everything `save.ts` owns: the `*Ex()` examples, `fixVal`/`fixObj` for saves, `normalize`,
  `migrateV1`, `v1Defaults`, `freshState`, `starterHunter`, `dailyQuest`, `parseAny`, the enum lists. No second copy.
  Prefs (`prefsEx`, `fixPrefs`) are device-only and stay in the store with their own small typed repair.
- Keys: `hunter-system-v3` (read and write), `hunter-system-v2` and `hunter-system-v1` (read once by `loadSave`,
  never written or removed).
- `load()`: read the three keys, call `loadSave`, push `backup` if any, set `readOnly`, `freshInstall` and the notice
  text (keep today's two sentences for `newer` and `unreadable`), then persist under the v3 key unless read-only.
- `store.update(fn)`: run `fn`, then `repairSave(state, env())`, persist, emit, as today. `repairSave` repairs in
  place and returns the same object. `store.get()` keeps returning the current save.
- `env()`: `{ now: new Date(), newDeviceId: <the store's existing random id maker> }`.
- `store.newHunter(name)`: `newHunter(rulesOf(state.rulesOverrides))` from core plus id, name, the daily quest
  (`dailyQuest`) and `daily.lastCheckedKey`, as today. `store.active()` with no hunters uses `starterHunter`.
- `importJSON` and `restore` use `parseSave`. Errors as today: `not-json` → "File is not valid JSON.",
  `not-an-object` → "Save data must be a JSON object.", `not-a-save` → "This does not look like a Hunter System
  save.", `newer` → "This save is from a newer version of the app." An imported or restored old save is migrated.
- The `storage` event listener watches the v3 key and uses `parseSave`; anything but `kind: 'save'` is ignored.
- `bindState` in `src/core/rules.js` stays as it is (M3 removes the global).
- The view modules are untyped JS and mutate the save freely inside `store.update`. Type `update` as
  `<T>(fn: (save: Save) => T, reason?: string) => T`. Do not add `any` to make a view happy: views are not checked.

`bun run test`. Commit.

### Step 3: browser tests (write each first and see it fail where it can fail)

`tests/e2e/save.e2e.ts`:
- Remove the `fixme` on "a save of the wrong shape warns the player and keeps the old text in the backups". It seeds
  a bad v2 text with no v3. Add the same check for a bad text under the v3 key.
- The v1 and main-save tests keep seeding the OLD keys (that is the migration under test) and then also check that
  the v3 key holds a schema 3 save and the old key is unchanged.
- New: "a phone that was in a fight and a room before the update opens with its hunters, no fight and no room".
  Seed a v2 save with an encounter and `settings.sync.room`.
- New: "a save from a newer app opens read-only and is not overwritten" (schema 99 under the v3 key, change
  something through the UI, reload, the stored text is unchanged). Check first whether an existing test covers it,
  and if one does, move it to the v3 key.

`tests/e2e/room-onboarding.e2e.ts`: `SAVE_KEY` becomes the v3 key. `grep -rn "hunter-system-v" tests` for the rest.
Check `seed` and `pinTo` in `tests/e2e/helpers.ts`: tests that seed a current save for setup should use the v3 key
with a schema 3 save, tests about migration keep the old keys.

Commit after each file passes.

## Done means

- `bun run test` passes.
- `tests/e2e/save.e2e.ts`, `room-onboarding.e2e.ts`, `pwa.e2e.ts`, `room-sync.e2e.ts`, `character.e2e.ts`,
  `customization.e2e.ts` and `upgrade.e2e.ts` pass, one file per run. A failure during a box pause is not a result:
  rerun that file once.
- One mutation check per new or un-fixme'd browser test and per `loadSave` rule, listed in the notes.
- `grep -rn "normalize\|migrateV1\|parseAny" src` is empty, and `hunter-system-v2` appears in `src` only as the key
  constant `load()` reads.
- Everything committed on your branch. Final reply under 200 words: worktree path, branch, commits, last line of each
  command, anything unsure.

Stop and write notes if you are still going after 60 minutes of work.

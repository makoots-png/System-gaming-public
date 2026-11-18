# Brief: save types, parser and one-way migration (M2 unit 4a)

Read `docs/agent-handoff/helper-rules.md` first. Where this brief and the rules differ, this brief wins.

You work in your own git worktree (your current directory), on your own branch. Run `bun install` there first. Commit there in small units as you go (plain commit messages, no AI attribution lines, no `.claude/`). Do not push. Do not touch `the repo root` itself.

The worktree may start at `main`: if `git log -1` is not the commit your prompt names, run `git reset --hard <that commit>` on your own branch first.

A first helper died before writing anything. Its field search survives in `docs/agent-handoff/p3/save-fields-beyond-examples.md` (paths there point into a worktree that no longer exists; read them as paths under `src/`). Verify the entries you use with grep. Do not redo the search and do not start helpers of your own.

Notes file (write as you go, small increments): `docs/agent-handoff/p3/notes-save-parser.md`.

This task is pure TypeScript plus bun tests. You do not need a browser. Do not wire the new module into the app: `src/edge/store.js` stays as it is. The next unit does the wiring.

## Why

`src/edge/store.js` holds the save shape only as example objects, repairs the whole save in place on every update (`normalize`), and mixes that with localStorage. The owner wants one typed place that defines what a save is, a parser at the boundary, and a one-way migration from old saves. Later milestones change the shape of encounters, gates and hunters, and each will edit this one module.

Bug 3 (`docs/agent-handoff/p3/bugs-found.md`): a save that is valid JSON but the wrong shape (for example `{"foo":1}` or `[]`) is silently replaced by a starter hunter. The parser must answer "this is not a save" so the edge can keep the raw text.

## What to build

`src/core/save.ts`, strict TypeScript, pure: no localStorage, no `Date.now()`, no `new Date()` without an argument, no `Math.random()`. It may import `src/core/rules.js` and `src/core/effects.js` as they are (they are untyped JS, so give the imports you use a small typed wrapper inside `save.ts` or a `.d.ts` next to them, whichever is less code; do not convert those files).

### Types

Exported types for the whole save: `Save`, `Settings`, `SyncSettings`, `World`, `Hunter`, `Stats`, `Condition`, `Quest`, `Objective`, `Rewards`, `Skill`, `Item`, `Loadout`, `Title`, `Shadow`, `Monster`, `Gate`, `Encounter`, `Combatant`, `LogEntry`, `RollEntry`, and string-literal unions for every enum (`Rank`, `QuestKind`, `QuestStatus`, `ItemType`, `ShadowGrade`, `GateType`, `GateStatus`, `LogKind`, `Mode`, `CombatantKind`). Take the fields from the `*Ex()` example objects and `normalize()` in `store.js`, and add the fields other modules write that the examples miss. Find those with grep (for example `settings.sync` gets `gmKey`, `gmKeys`, `keyed`, `lastRoom`, `boundHunterId`, `deviceToken`, `joinedAt`, `forgetQueue`; quests get `chainId`, `step`, `chainJob`; skills get `perk`; items get `effects`). List every field you added this way in the notes with the file and line that writes it. Fields you cannot type yet stay `unknown`, never `any`.

Decided since the field search: `SyncSettings` has no `keyed` and no `gmKeyLoose`. Another unit removes both from the
client (every room has a GM key now, and the migration drops the room link, so no loose key can exist). `fromV2`
resets `sync` anyway.

Every entity has a default factory typed by its interface (`const newHunter = (): Hunter => ({...})`), so adding a field to a type without a default fails to compile.

### Parser

```ts
export const SCHEMA = 3;

export type ParseEnv = { now: Date; newDeviceId: () => string };

export type Parsed =
  | { kind: 'save'; save: Save; migratedFrom: 1 | 2 | null }
  | { kind: 'newer'; schema: number; save: Save }      // written by a newer app: the edge opens it read-only
  | { kind: 'invalid'; reason: 'not-json' | 'not-an-object' | 'not-a-save' };

export function parseSave(text: string, env: ParseEnv): Parsed;
export function parseSaveValue(value: unknown, env: ParseEnv): Parsed;   // same, for an already parsed value
export function repairSave(save: Save, env: ParseEnv): Save;             // what store.update runs after a mutation
export function freshSave(env: ParseEnv, options: { onboarded: boolean }): Save;
```

Dispatch in `parseSaveValue`:
- not an object: `invalid`
- `schema` is a number above 3: `newer` (best-effort parse of the rest, as today)
- `schema === 3`: parse as the current shape
- `schema === 2`, or no `schema` and `hunters` is an array: `fromV2`, then parse. `migratedFrom: 2`
- v1 shape (the test `store.js` `parseAny` uses: `stats` is an object, or it has `name` or `quests`): `fromV1`, then parse. `migratedFrom: 1`
- anything else: `invalid` with `not-a-save`

`fromV2` is the one-way migration. It keeps everything about the campaign: hunters, world, gates, monsters, library, lootTables, shop, rulesOverrides, log, rolls, and from settings `mode`, `activeHunterId`, `dailyResetHour`, `onboarded`, `sound`, `deviceId`. It drops the running fight (`encounter` becomes `null`) and the room link (`settings.sync` goes back to its defaults). Reason: the owner said old rooms and fights do not need to survive, and both shapes change in later milestones. `fromV1` is today's `migrateV1`.

Parsing the current shape keeps today's `normalize` behaviour exactly (same defaults, clamps, enum fallbacks, id repair, `seq` rule, `perkSkill`, caps), ported to typed code. Keep the "fill by example, keep unknown keys" mechanism: the untyped view modules still stash fields the types do not know, and dropping them would break the app. Say so in one comment at the top of the parser. `repairSave` is the same repair run on an already typed save, and must be idempotent: `repairSave(repairSave(s))` deep-equals `repairSave(s)`.

`normalize` reads `rules()` (global state) for `logCap` and `rollCap`. Use `rulesOf(save.rulesOverrides)` instead so the parser depends only on its input.

## Tests: `tests/save.test.ts` (write them first)

Fixtures are in `tests/fixtures/saves/` (`main-gm-starter.json`, `main-player.json`, `main-export.json`, `v1-save.json`). Use a fixed `env`.

- each v2 fixture parses as `kind: 'save'`, `migratedFrom: 2`, and every hunter keeps name, level, xp, rank, stats, hp, mp, gold, items, skills, quests, titles, build and loadouts (compare against the fixture, not against a snapshot of the output)
- a v2 save with a running encounter and a room link comes out with `encounter: null` and default `sync`, and its hunters intact
- the v1 fixture parses with `migratedFrom: 1` and the same hunter that today's `migrateV1` produces (name, level, hpMax through `hpAdj`, quests, skills, items)
- a current save round-trips: `parseSaveValue(JSON.parse(JSON.stringify(save)))` deep-equals `save`, `migratedFrom: null`
- `repairSave` is idempotent on every fixture
- not JSON, `[]`, `"text"`, `42`, `null`, `{}` and `{"foo":1}` are `invalid` with the right reason
- `schema: 99` is `newer`
- hostile input does not throw and comes out bounded: a 10,000-entry `hunters` array of junk, `hunters: [null, 3, "x"]`, a hunter whose `stats` is a string, `__proto__` and `constructor` keys in the save and in a hunter, a name of 100,000 characters, `NaN`/`Infinity`/negative numbers written as strings in number fields, duplicate ids, an `activeHunterId` that does not exist
- unknown keys on the save and on a hunter survive a parse (pins the decision above)
- one compile-time check kept as a comment-free type test: a `Hunter` literal missing a field does not compile (`// @ts-expect-error` on the line)

For five of the behaviours above, do a mutation check (break the parser, see the test fail, restore) and list them in the notes.

## Done means

- `bun run test` passes (typecheck, bun tests, lint checks in `tests/lint.test.ts`).
- Everything committed on your branch.
- Final reply under 200 words: branch name, commits, the last line of `bun run test`, the count of fields you added beyond the examples, anything unsure.

Stop and write notes if you are still going after 60 minutes of work.

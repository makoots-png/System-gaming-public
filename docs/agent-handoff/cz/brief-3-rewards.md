# Brief: rewards, boons, bundles, and telling the GM when one is used (customization, unit 3)

One helper (Opus, heavy-writer), in the main tree, on branch `claude/zen-pasteur-ov4cgd`. No other helper writes while you work. Units 1 and 2 are merged (`cz/notes-1-homes.md`, `cz/notes-2-skills.md`): `parseItem`, `parseSkill`, `parseMonster`, `Outcome`, `outcomesOf`, the `use` command.

Run `bun install` once. Read first: `AGENTS.md` (the recipes "A room message" and "A field of a saved thing"), `docs/agent-handoff/helper-rules.md`, `docs/agent-handoff/cz/design.md` (sections "Rewards", "Use reaches the GM", "The remote Job Change chain"), `docs/agent-handoff/cz/inventory.md` (sections 5, 6, 7 and 9), the two notes files, the room charts in `docs/state-machines.md`. Principle skills: `principle-model-the-domain`, `principle-boundary-discipline`, `principle-make-operations-idempotent`, `principle-migrate-callers-then-delete-legacy-apis`, `principle-test-behavior-not-implementation`, `principle-explain-the-number`, and `unslop`.

Commit after every numbered step (name the files, plain messages, no AI attribution, no Co-Authored-By). This overrides the "do not commit" line of your built-in rules. Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3243 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-cz3`. Never run `playwright install`. Rerun a file once before reading anything into one failure.

Notes file (append a line after each commit): `docs/agent-handoff/cz/notes-3-rewards.md`.

## Why (the owner's goal)

"...custom rewards... and ways to notify me when players have used rewards." Today a reward holds XP, gold, points, items, a title by name and a job. It cannot hold a status, a skill or a text reward the GM honours at the table, and nothing a player uses reliably reaches the GM: a flat potion sends nothing, and the Table feed keeps 20 rows until the tab closes. This unit makes the reward type hold those things and makes a use arrive at the GM once, in a log that lasts. The reward editor's screens come in unit 4; here the forms get only what a test needs.

## The decided model (from `design.md`)

```ts
// Rewards (save.ts) = xp, points, gold, items, job, and:
title: { name: string; desc: string; bonus: Bonus } | null;   // replaces titleName
skills: Skill[];                                                // at most 8
statuses: { key: string; rounds: number | null; def?: StatusDef }[];   // at most 8
boons: { name: string; text: string }[];                        // at most 8; name 60, text 200
// A hunter holds: boons: Boon[]  ({ id, name, text, at }), at most 50.
// Item gains: tell?: true.
// library.rewards: { id, name, rewards: Rewards }[]  (at most 200, name 60).
// A player's room message:
used: { by, what: 'item' | 'skill' | 'boon', name, text, target: 'self' | 'other', outcomes: Outcome[], tell: boolean }
// A GM-only room message:
chain: { to, job, kind: 'issue' | 'reissue' | 'abandon' }
```

## Steps

Each step: tests first, then the change, then `bun run test`, then commit.

1. **`parseRewards` in core** (a new `src/core/rewards.ts`, or beside `Rewards` if imports allow; say which): one function from unknown input to `Rewards`, with the room bounds `givenRewards` has today for xp, gold and points (negative allowed: a GM may take away), items through `parseItem` (at most 20), and the four new fields. Migrate and delete `givenRewards` (`protocol.ts`), `cleanRewards` (`quests.js`) and the reward lines of the save repair. The quest form keeps its own floor of 0 by clamping what it reads from its inputs before the parser, if a test pins it. `titleName` goes everywhere: a sender resolves a built-in title's `desc` and `bonus` from its own rules by name when it builds the reward, and the receiver takes the title as carried. An award's `build` stays as it is. Tests in a new `tests/rewards.test.ts`: round trip, hostile input, each bound, the daily template's rewards pass unchanged.
2. **`applyRewards` applies the new fields** (`src/views/hunter.js`): the title as carried; each skill added to the hunter through `parseSkill` (a skill with the same name replaces); each status through the hunter's `applyStatus` path with `gmSource` at the hunter's own rank; each boon added to `hunters[].boons` with a fresh id and the time. `Boon` and `boons` in `save.ts` with the repair (cap 50, oldest dropped) and a case in `tests/save.test.ts`. The reward window lists the new lines (words to `copy-tasks.md`). A browser test in `tests/e2e/` (copy the file that tests an award in a room): a GM's award carrying a custom title with +2 STR, a skill, a status and a boon reaches a player's phone; the player's sheet shows the title's bonus, the skill, the status chip and the boon. For the GM side of that test, send the award through the store or the API if the Award form cannot build it yet (unit 4 builds the form); say so in the test's name.
3. **Bundles**: `library.rewards` in the save through `parseRewards`, with a case in `tests/save.test.ts`. No UI in this unit beyond an API pair on the module that owns rewards (`bundles.list`, `bundles.save`, `bundles.remove`), typed in `src/core/api.ts`, with a caller: the Award form gets a plain select "Bundle" that fills its fields from a saved bundle, and a "Save as bundle" button that asks a name. Keep it plain; unit 4 replaces the form.
4. **The `used` message** (the recipe "A room message"): its payload and `DEFS` entry in `protocol.ts` with a bounded reader (name 60, text 200, at most 8 outcomes, each outcome read by one `parseOutcome` exported from `src/core/combat/use.ts`), not GM-only, applier `null` on a player's phone. The server's "the sender owns this sheet" check is a line per type in `server.ts`: move it into `DEFS` as a flag (for example `ownSheet: true`) that `roll`, `questUpdate` and `used` set, and have the server read the flag. Tests: `VALID` and a case per bound in `tests/protocol.test.ts`; in `tests/server-rooms.test.ts` a phone that does not hold the sheet is refused for all three types.
5. **A player's phone sends `used`** (`src/views/inventory.js`, `src/views/skills.js`, `src/views/table.js`): when a boon is redeemed (always, `tell: true`); when an item with `tell` is used; when an item or a skill with `target: 'other'` and effects is used (outcomes rolled on the player's phone with `outcomesOf` at the item's rarity or the hunter's rank). It replaces the `item` and `skill` kinds of the `roll` message: delete `sendItemRoll` and the name-and-description regex that guessed `dmg`, and the skill-roll matching in `table.js`, once nothing needs them (a skill's plain `dice` roll still travels as a `roll` of kind dice or whatever the dice view sends for any roll; check and say in the notes). A boon gets a Redeem button on the sheet where titles are listed (plain; unit 4 styles it): a confirm, then the boon is removed and `used` is sent. Out of a room, nothing is sent and step 6's log line is written locally.
6. **The GM's phone receives it** (where `questUpdate` is handled today): a Table feed row "Who used What" with the outcome summary; for `target: 'other'`, the row's "Apply to…" picks a combatant and sends the `use` command with `by` the player's combatant (refused with a toast when the player is not in the fight). With `tell`: a log line of a new kind `use` (add it to the log's kinds in `save.ts` and to the Session log's filter in `gm.js`), "Mira used Boon: Free resurrection" with the text, and a toast. The log line is written at most once per event id: find how the GM's phone keeps `questUpdate` from being written twice across a reload or a repeated poll, use the same mechanism, and if there is none, add the event id to the place `src/core/applied.ts` owns and say so. Solo: the same log line, written by the phone that used it.
7. **The room model** (`tests/models/room-world.ts`, `tests/room-system-model.test.ts`): a player move "use a told item" whose `used` must appear in the GM's log exactly once over every interleaving, reloads and repeated polls included. Break the once-guard by hand to see the model fail, restore it, and say in the notes that you did.
8. **Notifications** (a new `src/edge/notify.ts`; the pure decision in core if there is one): the GM view gets a button "Notify me when a player uses a reward" that calls `Notification.requestPermission()` and shows the state (granted, denied, not supported). On a `used` with `tell`, when permission is granted and the page is hidden, show a notification through the service worker registration (`registration.showNotification`) with the same words as the log line, tag it with the event id so it shows once, and add a `notificationclick` handler in `src/sw.js` that focuses the app. A GM's hidden page polls every 30 s while permission is granted and the phone is the GM of a live room (today a hidden page does not poll): put the interval in the link machine or beside the existing poll waits, wherever the other waits are decided, with a test in the file that tests those waits, and the chart note updated by `bun run charts`. 30 s because one request is small and browsers slow a hidden page's timers to about one a minute anyway; a locked phone gets nothing until it is opened, when the feed and the log catch up. Browser test: grant the permission in the Playwright context, hide the page (dispatch `visibilitychange` with a stubbed `visibilityState`, as an existing test does if one does; otherwise stub `registration.showNotification` and assert the call), a player redeems a boon, and the GM's phone asks for one notification with the boon's name. A second test: without permission no notification is asked for and the log line still appears.
9. **The `chain` message** (inventory section 9 lists the files): GM-only, `once: true`, applied through `quests.issueJobChain` and the chain machine's reissue and abandon events. `pickChain` in `quests.js` offers remote sheets too and sends it. `job` is read by `isJobName`. Tests as the recipe says (`VALID`, bounds, the GM-only refusal, a GM move in the room model), and a browser test: the GM issues a Job Change to a player in a room and the player's Quests view shows step 1.
10. `bun run test`, `bun run deps -- --write`, `bun run charts`, then every browser file that touches rooms, rewards, quests, inventory or the table: `grep -l "room\|award\|quest\|inventory\|table" tests/e2e/*.e2e.ts` and run each. `AGENTS.md`: rows in "Where things live" for a reward (`parseRewards`), a use reaching the GM (`used`, the log kind, `notify.ts`), and the room-message recipe's line on `ownSheet`.

## Rules

- A use is told once. Every write on the GM's side is keyed by the event id.
- No reward a GM gives is applied twice on a player's phone (the `award` applier is already `once`; keep it so).
- The player's phone is not trusted for more than it is today: `used` is a report, and the GM chooses to apply it.
- Core stays pure. `src/edge/sync.ts` keeps to the state it names at its top (`tests/lint.test.ts`); the hidden poll is a wait, decided where waits are decided.
- No new dependency. No push service.
- If a step needs a decision the design does not make, choose the smaller option, write it in the notes under "Decided by the helper", and go on.

## Done means

`bun run test` passes and the browser files of step 10 pass. Final reply under 200 words: the commit range, the counts, how the once-guard works in one sentence, what you decided yourself, anything unsure.

If you are still going after about 90 minutes of work, commit what passes, write exactly where you are in the notes, and reply.

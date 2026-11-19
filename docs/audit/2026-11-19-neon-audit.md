# Neon architecture, state-machine and bug audit of systemgaming

- **Date:** 19 November 2026 (Atlantic/Stanley, UTC-3).
- **Audited commit:** `a11b6a5d5c50868ba813968e4a44d1b069c7c1a6` (`origin/main` after [PR #38](https://github.com/the-owner/systemgaming/pull/38), "Go live: first-run clarity, odds, solo runs, the Resurrection Crystal, awards for roleplay and feats", merged 19 November 2026 12:01 (UTC-3)).
- **How it was produced:** Gemini 4 Neon high (`gemini-4-neon-high`) through the Antigravity CLI (`agy -p --mode plan`), in four read-only lanes run in parallel. Each lane first read the pstack skills in `.claude/skills/` and the architecture docs (`AGENTS.md`, `docs/guide/*`, `docs/state-machines.md`, `docs/dependency-map.md`, decisions.tsv, handoff docs). The audit ran against a detached, read-only worktree (off-repo; not this tree). No file was changed, committed or pushed during the audit. No Anthropic key was used.
  - **rules:** combat, hunter and rule math (818 s)
  - **sync:** server, sync, save and store, edge, trade (851 s, including one resume)
  - **views:** `src/views` and `app.js` (910 s)
  - **gates:** gates, story, registry, packs, scripts, tests, and the dependency direction across `src` (659 s)

  Wall clock was about 19 minutes, 12:07 to 12:26 (UTC-3). There were no quota or rate-limit errors. First tries on each lane died quickly when a chained shell command was auto-denied; they were relaunched (or resumed) with one simple command per call. Token use per lane was roughly 0.6–0.8M in, 65–90k out, 28–51k thinking, 4.7–5.4M cache read.
- **Count:** 154 findings in total: 28 implicit state machines (SM), 41 architectural weaknesses (AW) and 85 bugs (BUG). After orchestrator severity changes: 38 high, 88 medium and 28 low. The bugs alone are 19 high, 48 medium and 18 low.
- **Repo context Neon was told about:** the repo already models about 35 machines explicitly (`docs/state-machines.md` is generated from the reducers) and enforces core purity and single-writer rules by lint. Most of the implicit machines Neon found are therefore in `src/edge/sync.ts`, the loose-JS views and the server's DB lifecycle, not in core.

## How to read the findings (verification status)

Twenty claims were checked against the code at their file:line. The other 134 were not independently re-checked.

- **Proven:** checked against the code and reproduced with a throwaway test (the tests are not in the repo). Treat as a fact.
- **Confirmed:** checked against the code at the cited file:line. The code is real; impact may have been adjusted downward. Treat as a fact about the code, with the notes in the verification table.
- **Unchecked:** not independently re-checked. These are **leads, not facts**. Confirm before fixing.

The severity column of the combined list is the orchestrator's corrected value, with Neon's original in brackets where it changed. Neon was right about where every one of the 20 checked claims sits in the code. It was wrong or overstated about the **impact** of 13 of them, mostly by calling a bounded or self-healing issue high. One is effectively wrong in practice: BUG-sync-5 is a real core quirk, but the UI cannot reach it. One is a design decision, not a bug: BUG-gates-2 (Stealth and Invisible do nothing in a fight; a test pins that on purpose).

## Same problem, more than one finding

Some findings are the same root cause listed more than once. Fix the root, not each row separately:

- **Double pay and the stale Clear panel are one fix.** BUG-gates-1 (`clearGate` swallows the gate's refusal, so a cleared gate can be paid out again) and SM-gates-3 (the Clear panel stays open on a cleared gate) are one problem: the stale panel is how a GM reaches the double pay. Fix them together. Add a test that a second `settleClear` is refused.
- **Ignored save refusals (about 8 findings) are one lint rule.** Views ignore a refusal from `store.apply`. That covers AW-views-1 and BUG-views-5, -6, -7, plus the refusal swallowed in core by BUG-gates-1, and similar rows later in the list. A lint rule that an `Applied` result must be read would close the whole class. The repo already adds one lint rule when a bug class shows up twice.
- **Bytes-versus-characters size cap (four findings).** UTF-16 `.length` is checked in one place and UTF-8 bytes on the server in another, so non-English documents can be rejected. Reported as BUG-sync-9, BUG-gates-6, BUG-rules-17 and AW-rules-6. One shared UTF-8 byte measure in core, edge and server closes all four.

## ALL findings, one list ordered by importance

Sorted by severity after my checks, then confirmed ahead of unchecked, then by Neon's in-lane rank. The ID prefix tells you the lane: rules, sync, views or gates. File paths in the rules lane are relative to `src/core/combat/` or `src/core/hunter/` when no folder is given.

| # | ID | Sev | File:line | Problem | Fix | Checked |
|---:|---|---|---|---|---|---|
| 1 | BUG-gates-1 | high | src/core/gates/world.ts:122-129 | `clearGate` swallows `onGate` `'unchanged'` refusal so `settleClear` double-pays cleared/closed gates | Return `cleared` immediately when `isRefused(cleared)` | CONFIRMED (proven) |
| 2 | BUG-views-2 | high | src/views/table.js:340-345 | Players can never arm `when: 'turn'` reactions (`table.js` sends `on: null`, `combat.js:355` skips `armRow`, `fight.ts:343` refuses) | Route `sync:event` `arm` through `armRow` and prompt players for `on` on `turn` reactions | CONFIRMED (read) |
| 3 | BUG-sync-3 | high | src/core/save.ts:715-735 | `exportedSave`/`keepPhone` leak phone-local sync fields and `keepGmKey` wipes `gmKeys` | Strip/reset all phone-local sync fields on export/import and merge `gmKeys` | CONFIRMED (read) |
| 4 | BUG-gates-4 | high | src/core/registry/abilities.ts:200 | `itemAbility` hardcodes wave-1 `USE_OPS` and silently drops all 7 wave-2 `UseOp`s | Share an exhaustive `USE_OPS` list with `effect-ops.ts` and `fight-parse.ts` | CONFIRMED (proven) |
| 5 | BUG-views-7 | high | src/views/quests.js:250-256 | `quests.js` `fail()` treats refused `{ ok: false, why }` as truthy and still reports quest failure to GM | Check `!r//'why' in r` before `sendUpdate` in `fail()` | CONFIRMED (read) |
| 6 | BUG-views-1 | high | src/views/detail.js:60-67 | `detail.close()` removes `.dt` imperatively without redrawing, poisoning 7 caller HTML caches so panels cannot reopen on 3rd tap | Call stored `redraw()` from `detail.close()` and percent-encode `idOf` |  |
| 7 | BUG-rules-3 | high | fight.ts:368-389 | Channel `release` and `landOne` skip broken-channel charge halving; `release` drops zone prices, shoved immunity, stealth reveal, summons, reactions, and `used` | Unify `act`/`release` via `commitUse()` and replace `broken()` with `interruptChannel()`. |  |
| 8 | BUG-views-3 | high | src/views/combat.js:1020 | Reviving a dead remote hunter from Combat card sends `vitals` (`setHp`) instead of `revive`, leaving them `dead` on their phone | Post room `revive` event in the same write as `adjust` when reviving a remote hunter |  |
| 9 | AW-rules-2 | high | fight.ts:191-247 | Duplicated ability-resolution pipelines (`act` vs `release`, `resolve.ts` vs `land.ts`) cause systemic rule drift | Extract shared `commitUse()` in `fight.ts` and shared op-landing helpers in `land.ts`. |  |
| 10 | AW-sync-1 | high | src/core/save.ts:187-206 | Portable campaign saves conflate device-scoped sync queues, cursors, and keys | Separate `PhoneSyncFields` structurally from portable campaign save data |  |
| 11 | BUG-views-4 | high | src/views/map-maker.js:148 | `Save as a new map` calls `shell.done(save())`, closing the dialog and losing all unsaved edits when `save()` fails and returns `undefined` | Guard `shell.done(v)` with `if (v !== undefined)` in `maker.js:883` and pass `asNew` as an arg |  |
| 12 | BUG-rules-2 | high | fight.ts:213-216 | Stale pre-reaction `user` passed to `resolve()`, and `before` reactions granting `edge`/`boost` refuse the use with `needsRoll` (throwing in `play.ts`) | Re-read `u` from `before.rows` and include or constrain `before`-reaction dice in `needs()`. |  |
| 13 | BUG-sync-6 | high | server.ts:342-346 | `setRemoved` and `PUT /sheets/:key` have read-modify-write races on `_kicked` and `ROOM_SHEETS` | Wrap `_kicked` updates and sheet capacity checks in Postgres `FOR UPDATE` transactions |  |
| 14 | BUG-gates-5 | high | src/core/pack.ts:83-108,220-259 | `pack.ts` misses status keys in `zone`, `prices`, `gates`, `summon`, `move`, `Trigger`, `Formula`, reward defs, and map zones | Use one exhaustive status-key collector and rekey mapper across all kit structures |  |
| 15 | BUG-views-5 | high | src/views/io.js:108-115 | Importing a library pack or share code in a read-only tab throws unhandled `TypeError` on `report === null` | Check `store.apply` `.ok` and `report` before summarizing import counts |  |
| 16 | AW-rules-3 | high | resolve.ts:532-542 | Pre-rolled `needs()` contract conflicts with mid-use mutations (`blink` and `before` reactions) | Simulate post-blink `from` in `needs()` and align `before`-reaction dice contract. |  |
| 17 | AW-sync-2 | high | server.ts:251-267 | Every player `PUT /sheets/:key` fetches and parses the entire room board | Add narrow `getKicked` and transactional `putSheetIfAllowed` store methods |  |
| 18 | AW-gates-1 | high | src/edge/room-pill.ts:5, src/edge/sync.ts:38 | `edge -> views` layer cycle unblocked by `deps.test.ts` and DOM view `room-pill.ts` misplaced in `edge/` | Move `App` host type to `core/`, move `room-pill.ts` to `views/`, assert zero layer breaks in `deps.test.ts` |  |
| 19 | BUG-views-6 | high | src/views/coin.js:154-162 | `coin.js` `rule()` ignores read-only `store.apply` refusal, still sends `coinLand`, and loops infinitely with new random flips | Check `store.apply(...).ok` before `sendLanding` and abort re-asking on refusal |  |
| 20 | BUG-rules-4 | high | resolve.ts:532-542 | `landUse` and `beforeReactions` compute `needs()` from pre-blink `user` instead of post-blink `from`, causing `needsRoll` or auto-caught hits | Pass post-blink `from` to `needs()` and compute post-blink `from` inside `needs()`. |  |
| 21 | AW-gates-2 | high | src/core/save.ts:15,32, src/core/combat/effect-ops.ts:23 | Three runtime value import cycles inside `src/core/` hidden by `deps.ts` merging type/value imports | Track value vs type imports in `deps.ts`, extract leaf helpers (`op-helpers.ts`, `hunter-parse.ts`), ban core value cycles |  |
| 22 | BUG-rules-5 | high | fight-turn.ts:384-391 | `startTurn` crashes (`who!` undefined) if `grounded` downs last combatant, and `turnReaction` skips `consequences` (dropping write-backs) | Run `overIf()` after `grounded()` and wrap `turnReaction` in `consequences()`. | PATH CONFIRMED, not reproduced |
| 23 | SM-sync-3 | high | src/edge/sync.ts:744-795 | GM doc publisher uses three parallel maps with no explicit `putting` state | Model per-doc publishing in a pure core reducer `src/core/sync/publish.ts` |  |
| 24 | AW-gates-9 | high | tests/world.test.ts:126, tests/pack.test.ts:180 | High-risk test gaps across gate re-clearing, built-in stealth, solo overrides/non-solo/UTF-8, wave-2 items, and kit packs | Add regression tests for all 7 identified risk gaps |  |
| 25 | BUG-views-8 | high | src/views/map.js:286-289 | `map.mount()` leaks `window` `resize` listeners/`IntersectionObserver` on remount and keeps stale pan/zoom/gesture/zone state across fights | Return `destroy()` from `map.mount()` and reset map/gesture/choice state on `!input` or fight change |  |
| 26 | SM-gates-1 | high | src/views/gates.js:258-302,514 | `enterAlone` has no in-flight phase lock; concurrent clicks or `renderSolo()` DOM replace breaks live runs | Model solo run UI phase explicitly in a state union and disable button/render progress from state |  |
| 27 | AW-views-1 | high | src/views/gm.js:471-476 | Systemic unchecked or misattributed `store.apply` read-only refusals across ~18 view files | Audit all `store.apply` callers, distinguish `'read-only'` from domain errors, and lint unused results |  |
| 28 | BUG-rules-7 | high | derive.ts:162-164 | Negative `hpAdj`/perks produce `hpMax <= 0` or `fatigueMax <= 0`, violating `Life` invariants and crashing `fight-doc.ts:band` | Clamp `hpMax >= 1`, `manaMax >= 0`, `fatigueMax >= 0` in `derive()` and `setMaximum()`. |  |
| 29 | AW-gates-3 | high | src/core/qr.js:1, tsconfig.views.json:4-8 | `src/core/qr.js` is completely untypechecked and `dom.d.ts` index signatures hide view type bugs | Convert `qr.js` to strict `qr.ts` and narrow `dom.d.ts` / migrate critical views to `.ts` |  |
| 30 | AW-views-3 | high | src/views/detail.js:60-67 | Imperative DOM removal in `detail.js` violates `patch.ts`/`dataset.sig`/`_h` render cache contracts | Make `detail.js` drive all DOM updates through caller `redraw()` callbacks |  |
| 31 | BUG-rules-8 | high | fight-save.ts:154-155 | `heldCommands` revives a dead hunter's fight row on level-up refill and uses pre-status maxima | Skip HP refill for dead hunters and compute refill deltas after applying statuses. |  |
| 32 | SM-views-2 | high | src/views/detail.js:28-69 | Detail disclosure state is split across `detail.js` `open`, caller caches, and `map.js` `mapDt` | Consolidate open state + `redraw` in `detail.js` with per-instance map list keys |  |
| 33 | SM-sync-5 | high | docs/state-machines.md:1382 | `StoreLife` `readOnly` bookkeeping doc disagrees with `sync.ts` calling `store.apply` | Align `StoreLife`, `sync.ts`, and `docs/state-machines.md` on one explicit `readOnly` rule |  |
| 34 | SM-views-3 | high | src/views/map.js:742-772 | Battle map mount/active/idle/unmount lifecycle is unmodeled and violates `gesture`/`choose` teardown invariants | Add explicit `reset()` on `!input`/fight-ID change and `destroy()` on unmount |  |
| 35 | SM-views-1 | high | src/views/ui.js:126-316 | Modal queue/stack and held-toast lifecycle split across `stack[]`, `refreshCur`, timers, and DOM expandos | Model modal stack/queue in a pure state reducer and replace toast expandos with a `Map` |  |
| 36 | AW-sync-4 | high | src/edge/sync.ts:1-944 | `sync.ts` is a 944-line god module mixing HTTP, reducers, UI dialogs, URLs, and dead code | Remove dead helpers and split HTTP, doc publishing, and UI prompts out of `sync.ts` |  |
| 37 | AW-views-2 | high | tsconfig.views.json:1-15 | All 38 `.js` views and `src/app.js` run under loose TS (`strictNullChecks: false`), hiding null derefs and ignored results | Incrementally enable `strictNullChecks` / migrate views to `.ts` and remove DOM expandos |  |
| 38 | SM-sync-2 | high | src/edge/sync.ts:556-581 | Create/Join `attempt` is an implicit multi-phase machine with nullable fields | Replace `Attempt` with a typed discriminated union transitioned inside `drain()` |  |
| 39 | BUG-sync-1 | med (Neon: high) | src/core/save-step.ts:76-87 | `writeInto` mutates nested arrays of retained non-`id` elements when prepending/shifting | Skip index-pairing `target[i]` when `target[i]` is kept elsewhere in `next` | CONFIRMED (proven), severity lowered |
| 40 | AW-rules-1 | med (Neon: high) | overrides.ts:162 | Only `solo.*` rules have numeric domain bounds at the override boundary | Define a complete typed `BOUNDS` table in `overrides.ts` with test coverage for all `RULES` leaves. | CONFIRMED (read), severity lowered |
| 41 | BUG-gates-3 | med (Neon: high) | src/core/gates/solo.ts:243 | `soloFight` spreads `t.statuses` before `R0.conditions`, overwriting GM-edited built-in statuses | Reverse spread to `{ ...R0.conditions, ...t.statuses }` | CONFIRMED (read), severity lowered |
| 42 | BUG-sync-8 | med (Neon: high) | src/edge/sync.ts:744-795 | Overlapping `putDoc` requests race out of order and overwrite newer server and local docs | Serialize `putDoc` per doc with an explicit in-flight/dirty publisher machine | CONFIRMED (read), severity lowered |
| 43 | BUG-rules-6 | med (Neon: high) | land.ts:168 | `landOps` `move` op runs `crossed()` and emits `statusGained` on the giver instead of receiver when `op.from === 'target'` | Use `holder = op.from === 'user' ? m.target : m.user` for `crossed()` and `gained` attribution. | CONFIRMED (read), severity lowered |
| 44 | BUG-sync-4 | med (Neon: high) | src/core/sync/outbox.ts:119 | `roomGone` skips `sending` entries and `deliver` is untracked, leaving zombie queued items | Drop both `queued` and `sending` entries in `roomGone` and abort `deliver` via `track(gen)` | CONFIRMED (read), severity lowered |
| 45 | AW-sync-3 | med (Neon: high) | src/edge/rules.ts:32-38 | `rules()` runs `JSON.stringify` over overrides and custom statuses on every call | Cache `rules()` by monotonic store/room revision counter instead of `JSON.stringify` | CONFIRMED (read), severity lowered |
| 46 | BUG-rules-1 | med (Neon: high) | overrides.ts:162 | Unbounded numeric GM overrides cause div-by-zero, `NaN`, level-9999 jump, and `standOdds` OOM | Add explicit numeric `BOUNDS` for every leaf in `parseOverrides` and cap `standOdds` sides. | PARTLY RIGHT, severity lowered |
| 47 | BUG-sync-2 | med (Neon: high) | src/core/save.ts:523-566 | `repairSave` validates hunter refs before renaming `run.bad` IDs, causing dangling refs | Rename `run.bad` IDs and remap references before validating hunter links | PARTLY RIGHT, severity lowered |
| 48 | BUG-gates-2 | med (Neon: high) | src/core/registry/statuses.ts:41-44 | Built-in `invisible` and `stealth` have `ops: []`, making built-in `Stealth` skill inert in combat | Set `ops: [{ op: 'hidden' }]` on both and update stale M2 tests | PARTLY RIGHT: a design gap, not an accident |
| 49 | BUG-sync-7 | med (Neon: high) | src/edge/sync.ts:465-472 | `landPage` drops polled events in `readOnly` tabs while `link.cursor` advances | Pause `Link` in `readOnly` tabs or add an explicit in-memory bookkeeping write path | PARTLY RIGHT, severity lowered |
| 50 | BUG-gates-6 | med | src/core/gates/solo.ts:391, server.ts:379,486 | `DOC_MAX` checked in UTF-16 `.length` while `MAX_BODY` is checked in UTF-8 bytes, causing 413s on non-ASCII docs | Measure `DOC_MAX` and `SHEET_MAX` with UTF-8 `bytesOf` (`src/core/size.ts:9`) everywhere |  |
| 51 | SM-rules-2 | med | fight.ts:631-662 | `Running` fight mixes "awaiting owed dice/releases" with "ready for turn command" and strands `broken` channels on downed rows | Guard turn commands while `owed(f)` is non-empty (or split `Running` sub-phase) and clear `channel` on 0 HP. |  |
| 52 | BUG-gates-7 | med | src/core/gates/solo.ts:413-420 | `soloPlan` never checks `g.solo`, letting stale/forged `soloRun` events clear non-solo gates | Refuse in `soloPlan` when `!g.solo` |  |
| 53 | SM-rules-5 | med | effect-ops.ts:286 | Direct `broken()` mutation bypasses `channelStep` interrupt charge halving | Delete `broken()` and route every channel break through `interruptChannel(b, R)`. |  |
| 54 | BUG-gates-8 | med | src/core/gates/solo.ts:320,444, src/edge/room-events.ts:193-208 | Room world solo clears never record `{ kind: 'gate' }` chronicle facts, breaking gate-count feats | Send `gateFact` with `soloAnswer` (or `noted`) and record it in `landSoloAnswer` |  |
| 55 | BUG-rules-12 | med | map-view.ts:541 | `taunted`, `aims`, and `aimFocus` ignore `sheet: range` status modifiers and `blinkMax` | Share one `effectiveRange()` helper across `taunted`, `ready`, `aims`, and `aimFocus`. |  |
| 56 | BUG-gates-9 | med | src/core/pack.ts:297-301 | `mergeNamed` matches names case-sensitively, creating collisions that `library.ts` `saveEntry` later rejects | Compare normalized lowercase trimmed names in `mergeNamed` |  |
| 57 | AW-rules-4 | med | fight-view.ts:252 | Range legality duplicated across `resolve.ts`, `fight-view.ts`, and `map-view.ts` without status range bonus | Carry `rangeAdd` on `Spot`/`MapBody` and delegate to `effectiveRange()` in `resolve.ts`. |  |
| 58 | BUG-gates-10 | med | src/core/gates/solo.ts:370-371 | `namedStatuses` in `soloDoc` omits custom statuses referenced by monster `summon.statuses` / `move` ops | Reuse shared transitive `monsterKeys` collector in `namedStatuses` |  |
| 59 | BUG-views-9 | med | src/views/ui.js:221-241 | Queued `system` window opens visually above `openWindow` while behind in `stack[]`, misrouting `Escape`/`Tab`; thrown `show()` wedges stack | Move `system` entry to top of `stack` on dequeue and push only after `show()` succeeds |  |
| 60 | BUG-rules-13 | med | land.ts:171-179 | `landOps` emits `statusGained` on refused statuses, `landOne` `dispel` misses `cureLands`, `channel: break` bypasses `protect`, `eventsOf` misses `dispel`/`move` | Return `put` and `detonated` from `landOne`, call `channelBreaks()`, and diff statuses in `eventsOf`. |  |
| 61 | BUG-sync-10 | med | src/edge/upgrade.ts:36-59 | `upgrade.ts` re-arms `quiet` timer after `reloading` and misses `registration.waiting` | Queue re-entrant events in `send()` and check `registration.installing \/\/registration.waiting` |  |
| 62 | SM-gates-3 | med | src/views/gates.js:160-176,538 | Frozen `openPanel` allows stale `Clear` form on cleared gates; strict `>` timestamp check can drop merges | Auto-close `'clear'` panel when `!can(g, 'clear')` and merge by content diff or revision |  |
| 63 | BUG-views-10 | med | src/views/hunter.js:253-267 | `deleteHunter` posts room tombstone before replacement prompt and `store.apply`, and deletes even on Cancel | Abort on prompt Cancel, check `store.apply().ok`, then call `sync.forget` and toast |  |
| 64 | BUG-rules-14 | med | fight.ts:244-246 | `afterReactions` misses `tallied`/`triggered` (dropping counterattack kills/damage) and charges a second reactor on a dead attacker | Check `alive(map.get(by)!)` in `afterReactions` and record reaction outcomes in `tallied`/`triggered`. |  |
| 65 | BUG-sync-9 | med | server.ts:379 | `SHEET_MAX`/`DOC_MAX` check UTF-16 `.length` while `MAX_BODY` enforces UTF-8 bytes | Measure `SHEET_MAX` and `DOC_MAX` with UTF-8 `bytesOf` in server, edge, and core |  |
| 66 | SM-gates-2 | med | src/views/gates.js:182-227 | Gate news queue split across raw `personal-told` array, `asking` Set, and 3-item cap that stalls overflow alerts | Unify gate news queue with typed parser and drain remaining batch after modal dismissal |  |
| 67 | BUG-views-11 | med | src/views/uses.js:75 | `uses.cast` builds target list with `openGrid` instead of `docGround(t.doc).grid`, ignoring walls and LOS | Pass `docGround(t.doc).grid` to `aims(...)` in `uses.js:75` |  |
| 68 | BUG-rules-15 | med | resolve.ts:421-422 | Multiple die-based `boost` statuses on one body collide by `CombatantId` in `needs()` and `keptFace()` | Key `boost` rolls by `${id}:${key}` instead of `id` alone. |  |
| 69 | BUG-sync-11 | med | src/core/sync/link.ts:424-441 | Leaving a room leaves `settings.sync.gmKey` populated even after `forgetKey` | Clear `gmKey: null` when `room` becomes `null` and when `ringGone` forgets the key |  |
| 70 | SM-gates-4 | med | scripts/charts/solo.ts:19-21, docs/state-machines.md:1474-1475 | Chart claims `"a gate at once"` on `Off, 3 gates open -> On, 3 gates open` where `soloTick` spawns none | Condition arrow label on `to.gates.length > from.gates.length` and re-run `bun run charts` |  |
| 71 | BUG-views-12 | med | src/views/skills.js:321-325 | Skill `Lv +` toast reads pre-upgrade `s.level`, always showing old level and never `(MAX)` | Read upgraded skill level (or `s.level + 1`) after `onSkills(...).ok` |  |
| 72 | BUG-rules-16 | med | rulesref.js:136 | Rules page reads dead `RULES.dailyRewardPoints` and prints 5× wrong item sell value (`baseValue * mult`) | Remove `dailyRewardPoints` and compute Rules page sell values via `priceOf()`/`sellPrice()`. |  |
| 73 | AW-sync-9 | med | server.ts:360-366 | `GET` polls do TOFU device binding and targeted `system` whispers broadcast to all players | Bind device tokens only on `PUT /sheets/:key` and seal targeted `system` whispers server-side |  |
| 74 | AW-gates-6 | med | src/core/registry/monsters.ts:234-252, src/core/story/story.ts:130 | Duplicated UTF-8 helpers and missing `THING_MAX.monster` / `abilityTooLarge` whole-monster refusal | Standardize on `size.ts` `bytesOf` and add `THING_MAX.monster` enforcement |  |
| 75 | BUG-views-13 | med | src/views/combat.js:1035-1037 | Cancelling or blocking Shadow Extraction in Combat view toasts `"Extraction of X failed."` | Return a discriminated extraction outcome and toast failure only on `'failed'` |  |
| 76 | AW-rules-5 | med | rulesref.js:199-200 | `rulesref.js` hand-computes rule formulas instead of calling core functions | Move rule-derived table values into `rules-text.ts` using core pricing/reward helpers. |  |
| 77 | BUG-sync-12 | med | src/edge/sync.ts:569-578 | Failed `join-new-hunter` binds existing hunter and failed `setActive` aborts undo removal | Reject join when `addHunter` fails and guard `prevActive` existence during undo |  |
| 78 | AW-gates-4 | med | src/core/registry/maps.ts:17, src/core/gates/gate.ts:44,132,163 | Unvalidated `mapId` cast exported publicly and inconsistent ID validation/fabrication in `gate.ts`/`pack.ts` | Export validated `parseMapId` and use `saveId` / shared ID parsers consistently |  |
| 79 | BUG-views-14 | med | src/views/maker.js:811 | `buildAbility` `input` listener ignores `[data-zend-fx]`, leaving zone-end error banner stuck after button clicks | Call `draw()` when `input` originates inside `[data-zend-fx]` or `[data-zone-fx]` |  |
| 80 | BUG-rules-17 | med | bestiary.ts:103 | UTF-16 `.length` checks against `DOC_MAX` let non-ASCII docs exceed `server.ts` 64 KiB UTF-8 `MAX_BODY` (HTTP 413) | Measure all room docs with UTF-8 `bytesOf()` from `size.ts`. |  |
| 81 | BUG-sync-13 | med | src/edge/sync.ts:440-447 | `switchTo` moves `joinedAt` to `srvNow()`, triggering false `WHILE YOU WERE AWAY` modals | Track `boundAt` separately from `joinedAt` so `switchTo` does not move `joinedAt` |  |
| 82 | BUG-views-15 | med | src/views/quests.js:344-400 | Switching active hunter while inline quest Edit form is open creates duplicates or traps GM on hidden `[data-who]` | Reset/hide the inline quest form when `store.active().id` changes |  |
| 83 | AW-rules-6 | med | protocol.ts:629 | Unit mismatch between UTF-16 `DOC_MAX` checks and UTF-8 `MAX_BODY` enforcement | Standardize client doc builders, `protocol.ts`, and `server.ts:486` on `bytesOf()`. |  |
| 84 | BUG-sync-14 | med | src/edge/store.ts:200-203 | `schedule()` never cancels its 1000 ms fallback timer, causing pre-paint flushes | Store and cancel both `rAF` and fallback timer handles on flush or leave |  |
| 85 | AW-gates-5 | med | src/core/library.ts:45, src/views/map-maker.js:174 | `map-maker.js` uses `saveById`, bypassing `namedLike` uniqueness and causing name ambiguity in packs | Route `map-maker.js` through `saveEntry` and keep `saveById` private to `library.ts` |  |
| 86 | BUG-views-16 | med | src/views/table.js:230 | Player List HUD/Desktop Kit consumables bypass `hold` double-submit guard, and `'dropped'` outbox events never release `hold` | Route consumable casts through `sent(e, ...)` and release `hold` on `o.at === 'dropped'` |  |
| 87 | BUG-rules-18 | med | fight-parse.ts:654 | `parseFight` caps hunter origin level at 200 while `MAX_LEVEL` is 9999, deleting fights on reload | Replace literal `200` with `MAX_LEVEL` from `progress.ts`. |  |
| 88 | AW-sync-8 | med | server.ts:184-200 | Postgres boot runs full-table `UPDATE` migrations every start and CI skips Postgres | Gate backfills with a migration version table and run Postgres tests in CI |  |
| 89 | AW-gates-8 | med | tests/lint.test.ts:1023-1055, scripts/deps.ts:150-240 | Regex/brace scanners in `deps.ts` and `lint.test.ts` miss AST semantics despite `typescript` devDependency | Parse files with `ts.createSourceFile` in a shared tooling helper |  |
| 90 | BUG-views-17 | med | src/views/story-maker.js:158-160 | `story-maker.js` `save()` only validates `quest.check()` on the currently open chapter | Validate every chapter's quest data in `save()` regardless of accordion state |  |
| 91 | BUG-rules-9 | med | inventory.ts:68-71 | `editItem` keeps an edited item worn in its old slot (and/or stacked `qty > 1`) when its slot changes | Unwear `itemId` in `editItem` when the new slot is incompatible or `qty > 1`. |  |
| 92 | AW-sync-7 | med | src/edge/store.ts:269-295 | Every `store.apply` runs full-tree `writeInto` plus full `repairSave`, while keeping unknown keys | Separate load-time repair from hot-path writes and tighten strict sync record parsing |  |
| 93 | BUG-views-18 | med | src/views/rulesref.js:249 | Rules view cache omits room `rules` doc (stale for players) and line 187 hardcodes `(minimum 5)` instead of `R.shadow.dcMin` | Include `app.rules()` in `rulesref.js` `sig` and interpolate `R.shadow.dcMin` |  |
| 94 | BUG-rules-10 | med | noticed.ts:75 | `distinct` + `within: 'row'` feats fail to clear `vals` on `'broke'`, poisoning future streaks | Drop `vals` on `'broke'` in `noticed.ts` and `feats.ts`. |  |
| 95 | SM-sync-1 | med | server.ts:295-320 | Server DB lifecycle keeps `closed` and `retry` flags outside `Db<S>` | Add explicit `closed` state and `close` event/effects to `src/core/room-server.ts` |  |
| 96 | BUG-views-19 | med | src/views/gm.js:471-476 | `gm.js` pops broadcast before `gmWrite` and reports success on read-only refusals in `doSpawn`, `typedHp`, and roll tables | Write before popping broadcast and gate all GM success messages on write `.ok` |  |
| 97 | BUG-rules-11 | med | feats.ts:77 | `featStep` unlocks `show: { at: 'never' }` feats to `shown`, contradicting `docs/state-machines.md:1644` | Guard `TABLE.hidden.unlocked` on `c.def.show.at === 'feat'`. |  |
| 98 | SM-sync-6 | med | src/edge/sync.ts:602-616 | Recursive `showRemoved` modal retries forever on `notFound` or `replaced` with wrong message | Exit retry modal on `notFound`/`replaced` and guard against campaign/room changes |  |
| 99 | BUG-views-20 | med | src/views/combat.js:870-883 | `combat.js` captures stale `fight()` across `await` in `setIntent`/`useAbility` and ignores refusal in `addparty`/`applyAmount`/`startFlow` | Re-read `fight()` after `await` and check return values of `add()` and `adjust()` |  |
| 100 | SM-rules-1 | med | feats.ts:73-85 | Feat statechart permits `unlocked` on "Hidden until earned" feats, disagreeing with its own prose | Guard `unlocked` in `TABLE.hidden` and regenerate `docs/state-machines.md`. |  |
| 101 | BUG-sync-15 | med | src/edge/store.ts:104 | `loadUnkept` says save could not open when only a corrupt fight was dropped | Add distinct copy/reason for `fightUnkept` when campaign opened without its fight |  |
| 102 | BUG-views-21 | med | src/views/gates.js:258-302 | `enterAlone` allows double solo run, `onboard.js:181` permanently disables Join on failure, `custom.js:72` shares mutable `pick` | Add in-flight guard to `enterAlone`, restore `joinBtn` on failure, make `pick` local, check `LO.swap` `.ok` |  |
| 103 | BUG-rules-19 | med | effect-ops.ts:539-545 | `settle()` moves a stacking status with `leave: 'round'` and `end` to `spent` on its final round, suppressing delayed `end` detonation | Check time expiry (`until <= now`) before `leave: 'round'` decay in `settle()`. |  |
| 104 | BUG-sync-16 | med | src/app.js:119-166 | `app.js` mounts views and panels whose `when()` predicate already threw | Transition directly to `failed` when `when()` throws instead of calling `mountPart` |  |
| 105 | SM-views-4 | med | src/views/table.js:217-230 | Player turn `hold` state has inconsistent entry points and missing release transitions | Funnel all turn actions through one `free/posting/waiting` state machine |  |
| 106 | SM-rules-6 | med | standing.ts:174-194 | `standing.ts` reads `b.statuses` without expiry checks and `settle` mixes `spent` vs `expired` lifecycles | Fix expiry precedence in `settle()` and enforce `live(b, now)` or non-expired status invariant. |  |
| 107 | SM-sync-4 | med | src/app.js:114-158 | View/panel lifecycle mutates untyped `state` strings alongside ad-hoc render flags | Type `PartState` transitions explicitly and evaluate `when()` once per render pass |  |
| 108 | SM-views-6 | med | src/views/quests.js:297-400 | Inline quest form mode spread across `editId`, `f.hidden`, `who.hidden`, and `autoTitle` | Replace with explicit `closed/new(hid)/edit(hid, qid)` state |  |
| 109 | BUG-rules-20 | med | grant.ts:301-302 | `sheetEdit` `put`/`drop` skips `fitted()`, leaving HP/mana/fatigue above lowered maxima | Wrap `putCondition` and `dropCondition` in `fitted(..., R)`. |  |
| 110 | AW-sync-5 | med | src/edge/sync.ts:38 | `src/edge/sync.ts` and `room-pill.ts` invert layers by importing `src/views/app.ts` | Extract `SyncHost`/`PillHost` interfaces into `src/edge/` and enforce via lint test |  |
| 111 | SM-views-9 | med | src/views/maker.js:883-919 | Maker shell `done()`, `map-maker.js` `asNew`, and lazy `zendFx` sentinel permit inconsistent form states | Guard `done(v)`, pass `asNew` explicitly, and sync `zendErr` on `zendFx` edits |  |
| 112 | BUG-rules-21 | med | grant.ts:183 | `grant` and `finishQuest` bypass `sheetEdit` on `refill`, dropping `life: raised` facts and reporting `refill: true` on dead hunters | Route refills through `sheetEdit(..., { kind: 'refill' }, R)` and gate `refilled` on `life.at !== 'dead'`. |  |
| 113 | AW-sync-6 | med | src/core/ids.ts:108-110 | Boundary validation is duplicated with diverging regexes and unchecked casts | Centralize `parseSheetKey`/`deviceOf` in `sync.ts` and validate prefixes/IDs in `core` |  |
| 114 | SM-views-8 | med | src/views/onboard.js:157-229 | Invite sub-step uses local `failed` boolean and imperative button disabling outside `onboard.ts` | Model invite sub-step as `ready/joining/retry(err)` with single render function |  |
| 115 | AW-rules-7 | med | build.ts:55-60 | Inconsistent boundary authority and write-back across hunter core modules (`choosePath`, `editQuest`, `stepShadow`, `grant`) | Enforce role/inFight checks and Chronicle recording inside core functions consistently. |  |
| 116 | AW-sync-10 | med | src/app.js:233-265 | `src/app.js` is untyped loose JS carrying dead `app.api.*` optional-chaining fallbacks | Remove dead optional guards and migrate `src/app.js` to strict `src/app.ts` |  |
| 117 | SM-views-7 | med | src/views/room.js:62 | Room lobby mutable `view` bag and unguarded async `gmrelease`/`gmallow` handlers race on fast taps | Use explicit lobby check/join state and disable GM seat buttons while in flight |  |
| 118 | SM-rules-3 | med | effect-ops.ts:291-321 | Flat `Body` record with 15+ optional fields allows cross-kind illegal states (e.g. ownerless summon, hunter with extraction) | Refactor `Body` into a discriminated union by `kind` and validate arms in `fight-parse.ts`. |  |
| 119 | SM-views-5 | med | src/app.js:110-173 | View/panel `state` mounts a panel even if its `when()` threw before marking it `'failed'` | Evaluate `when()` before `mountPart()` on first visit |  |
| 120 | SM-rules-4 | med | noticed.ts:7-14 | Untyped Chronicle inbox holds unstamped facts during fights and stamps them at drain time (wrong day/session/rest window) | Stamp facts at `record()` time and model inbox drain state explicitly. |  |
| 121 | AW-views-6 | med | src/views/maker.js:1006-1010 | Global `document.body` `MutationObserver` scans every app DOM mutation; `option.hidden` fails on mobile pickers | Scope `searchable()` to makers and detach/re-attach `<option>` nodes instead of `option.hidden` |  |
| 122 | AW-rules-8 | med | map-view.ts:1-773 | God-file coupling in `map-view.ts` (773L), `fight.ts` (699L), `fight-parse.ts` (828L), `resolve.ts` (652L), `formula.ts` (652L) | Split `map-choice.ts`/`hotbar.ts` from `map-view.ts` and move reaction/summon helpers out of `fight.ts`. |  |
| 123 | AW-views-4 | med | src/views/combat.js:1-1246 | Seven 640-to-1246-line god view files mix CSS, templates, async dialogs, and sync handlers | Extract focused helpers from `maker.js`, `combat.js`, and `gm.js` |  |
| 124 | AW-views-5 | med | src/views/rulesref.js:44-59 | Duplicated `canon()` (5x), `flash()` (2x), `guard()`, `highest()`, and view-resident `parseQuick()` | Consolidate shared helpers in `src/core/` and `src/views/ui.js` |  |
| 125 | AW-views-7 | med | docs/dependency-map.md:14 | `src/edge/sync.ts` and `src/edge/room-pill.ts` import `App` from `src/views/app.ts` | Move edge-facing `App` types out of `src/views/` and lint `edge -> views` imports |  |
| 126 | AW-views-8 | med | src/views/odds-box.js:28 | Unbounded view Maps (`boxes`, `barsWas`, `picks`, `amounts`), unscoped `table-feed`, and uncollected `store.device` keys | Prune view Maps on render/clear, scope `table-feed` by room, clean up device keys on hunter delete |  |
| 127 | AW-gates-7 | low (Neon: med) | scripts/publish-clean.ts:23 | CLI arg `out` interpolated directly into `sh -c` double-quoted string | Spawn `git archive` and `tar` with argv arrays (no shell string interpolation) | CONFIRMED (read), severity lowered |
| 128 | BUG-gates-13 | low | src/core/qr.js:105-106 | `qrSvg` accepts `opts` but calls `qrMatrix(text)` without passing `opts` (drops `mask`) | Pass `opts` through: `qrMatrix(text, opts)` | CONFIRMED (read) |
| 129 | BUG-sync-5 | low (Neon: high) | src/core/sync/link.ts:399 | `link` `join` ignores `event.key !== link.key`, breaking GM rejoin in current room with `busy` | Check `event.code === link.code && event.key === link.key` before returning `same(link)` | WRONG IN PRACTICE, severity lowered |
| 130 | BUG-gates-11 | low | src/views/gates.js:309 | GM room solo clear hardcodes boss loot (`lootOf(g.rank, true)`) even when `g.bossId === null` | Pass `g.bossId !== null` to match local solo clear at L288 |  |
| 131 | BUG-gates-12 | low | src/core/registry/worth.ts:331-336 | `wornWorth` ignores `def.stack` and `def.end` without reporting them in `Worth.unweighed` | Record `def.end` and `def.stack` in `at.miss` (or weigh them) in `wornWorth` |  |
| 132 | SM-gates-5 | low | scripts/ci.ts:32-65 | CI stall watchdog and `proc.exited` share mutable `pauses` flag with timer-race retry risk | Use an explicit `'running' \/'stalled' \/'exited'` phase variable |  |
| 133 | BUG-sync-17 | low | src/core/ids.ts:31-136 | `parseSaveId<K>` ignores `K`, `sheetKeyOf` can exceed 40 chars, `releaseSheet` rejects non-`d-` | Enforce prefix `K` in `parseSaveId`, cap `DeviceId` length, and use `parseSheetKey` |  |
| 134 | BUG-sync-18 | low | src/core/save.ts:576-601 | `sync.cursor` is unclamped, `setAside` allows duplicate IDs, `protocol.ts` loosens `feats.on`/casts | Clamp `cursor`, reject duplicate `line.id` in `setAside`, and tighten `protocol.ts` |  |
| 135 | AW-sync-11 | low | src/edge/sync.ts:511-520 | `sendSheet` runs 4 JSON serialize/parse passes and `room-world.ts` hand-copies `sync.ts` | Serialize sheet payload once and run model tests against the extracted edge runner |  |
| 136 | BUG-rules-22 | low | formula.ts:179-181 | Keyed formula names (`stacks`, `field`, `held`) are case-sensitive despite doc claiming case-insensitivity | Match keyed prefixes case-insensitively and lowercase the matched key kind. |  |
| 137 | AW-sync-12 | low | src/edge/store.ts:32 | `randId` and `sync.ts:739` use `Math.random()` instead of `crypto.getRandomValues` | Use `crypto.getRandomValues` in `randId` and `cryptoRandom()` in `sync.ts:739` |  |
| 138 | BUG-rules-23 | low | standing.ts:201-207 | `harmful()` checks only tier 0 (`v[0]`) and omits positive `fatigue`, `delay`, `channel: break`, and `edge(worse)` | Evaluate all tiers (or source tier) and include `fatigue > 0`, `delay > 0`, `channel: break`, `edge(worse)`. |  |
| 139 | BUG-rules-24 | low | progress.ts:107-109 | `setPoints` lacks `Number.isFinite`/`Math.trunc` guard, letting `NaN` corrupt `bonusPoints` | Validate `Number.isFinite(n)` and truncate before computing `bonusPoints`. |  |
| 140 | BUG-rules-25 | low | day.ts:13 | `parseDayKey` accepts impossible dates like `9999-99-99`, causing `dayGap` to return `NaN` | Validate parsed UTC year/month/day round-trip inside `parseDayKey()`. |  |
| 141 | AW-views-9 | low | src/views/shadows.js:46-78 | Stale entity/index captures across `await` and missing in-flight guards in secondary views | Re-read fresh state after `await` and add in-flight guards |  |
| 142 | BUG-rules-26 | low | bestiary.ts:143 | `mergeMonsters` returns `lastAt: undefined` via `.pop()!` when both `lastAt` values are empty | Replace `.pop()!` with `.pop() ?? ''`. |  |
| 143 | SM-views-10 | low | src/views/story-maker.js:49-53 | Story accordion lazy validation and Dice `dcInit`/`isOpen` flags permit stale UI states | Validate all chapters on save and key Dice DC init by `{ hid, rank }` |  |
| 144 | BUG-rules-27 | low | inventory.ts:22 | `stackKey` omits `desc`, `attack`, `penFlat`, silently merging distinct slotless items and dropping descriptions | Add `desc`, `attack`, and `penFlat` to `stackKey()`. |  |
| 145 | BUG-views-22 | low | src/views/map.js:481-489 | Multiple mounted `map.js` instances collide on hardcoded `'map'` key in `detail.js` | Give each `map.mount()` instance its own unique detail list key |  |
| 146 | BUG-rules-28 | low | imported.ts:26-44 | `withImportedHunters` does not remap `h.used`, `shadow.monster`, or `jobChain.id` | Remap `h.used` via skill map, allocate fresh `jobChain.id`, and reconcile `shadow.monster`. |  |
| 147 | BUG-views-23 | low | src/views/inventory.js:218-266 | Stale/async edge bugs in `table-feed`, `shadows.js` notes blur, `inventory.js` shop index/0g sell, `stories.js` double-end, `dice.js` DC, `bestiary.js` IDs | Scope feed by room, redraw on notes blur, use IDs not indices, deduplicate held end-story toasts |  |
| 148 | BUG-rules-29 | low | counts.ts:77 | `distinct` feat counter evicts values past `VALS_MAX = 200` while allowing `reach` up to `1e6` | Cap `distinct` feat `reach` at `VALS_MAX` (200) in `parseFeat()`. |  |
| 149 | BUG-views-24 | low | src/views/motion.ts:288-303 | Edge defects in `app.js` panel mount-on-throw, `room.js` QR sizing, `quest-fields.js` invalid date, `workshop.js` fold index, `motion.ts` div-by-0 | Guard `when()` before mount, size QR on open, check `isNaN(date)`, key folds, guard `dur <= 0` |  |
| 150 | BUG-rules-30 | low | chronicle.ts:113 | `chronicle.ts`, `chronicle-view.ts`, and `feats.ts` use non-antisymmetric `<` timestamp comparators | Replace raw string `<` comparators with `compareTimes()` from `day.ts`. |  |
| 151 | AW-rules-9 | low | day.ts:60-62 | Multiple hunter modules bypass canonical `compareTimes()` in `day.ts` | Standardize timestamp sorting on `compareTimes()` and add a lint rule if needed. |  |
| 152 | AW-rules-10 | low | sheet.ts:191-196 | `derive.ts` and `sheet.ts` do not enforce `hpMax >= 1` and non-negative `manaMax`/`fatigueMax` | Clamp maxima in `derive.ts` and `sheet.ts:setMaximum`. |  |
| 153 | AW-rules-11 | low | rewards.ts:127-129 | Unbranded `string` ID in `saveBundle()`, hardcoded `200` level cap in `fight-parse.ts`, incomplete ID remapping in `imported.ts` | Brand `BundleId`, share `MAX_LEVEL`, and complete `imported.ts` remapping. |  |
| 154 | SM-rules-7 | low | record.ts:26-38 | Rank promotion vs level demotion has no explicit eligibility/mismatch state | Add `rankStanding(h, R)` helper to make ready/above-level states explicit. |  |

## Per-category detail and where to start

By kind: 28 implicit state machines, 41 architectural weaknesses, 85 bugs. By severity after the checks: 38 high, 88 medium, 28 low.

The sections below are the orchestrator's starting order and the things all four lanes said to leave alone. The verbatim lane reports (rules, sync, views, gates) follow the verification table, with each finding's longer write-up.

## Top 10 to fix first (merged from the four lanes and my checks)

1. **BUG-gates-1 + SM-gates-3: a Clear can pay twice.** `clearGate` swallows the gate's refusal (`world.ts:126`), and a frozen Clear panel can still be submitted (`gates.js:160-176`). Proven: gold 20 became 40 and xpPaid 150 became 300. Fix: return the refusal and redraw the panel after a clear.
2. **BUG-gates-4: a consumable whose effects are only new ops (dispel, hasten and the other 5) can't be used in a fight.** Proven. Fix: one exhaustive `USE_OPS`, exported from effect-ops.ts and used in both places.
3. **BUG-views-2: players can't arm turn reactions.** `table.js:343` always sends `on: null`, and `fight.ts:343` refuses that. Fix: ask the player for the target, or route the arm through `armRow`.
4. **BUG-sync-3 + AW-sync-1: a campaign export carries this phone's sync state, and an import wipes the GM keyring.** The keyring is lost when the file's room differs from the phone's. Fix: split the phone-scoped sync fields out of the portable save, and merge `gmKeys` on import.
5. **AW-views-1 / BUG-views-5, -6, -7: views ignore a refusal from `store.apply`.** For example, a refused quest fail still reports to the GM. Fix: check `.ok` at every call, and add a lint rule.
6. **BUG-rules-5: the fight can crash at a turn's start.** If a zone's end downs the last body, `startTurn` reads `who!` (`fight-turn.ts:388-390`). Fix: run `overIf` after `grounded`.
7. **BUG-rules-3 + AW-rules-2: channel release has its own resolution pipeline beside `act`**, and it skips charge halving, prices and reveals. Not verified by me. Fix: one `commitUse`.
8. **SM-sync-3 + BUG-sync-8: the GM's doc publisher can have two PUTs for the same doc in flight at once.** Players may briefly see a stale fight until the next poll. Fix: a small publish reducer (idle, waiting, sending, sending-dirty) shaped like push.ts.
9. **BUG-sync-1: `writeInto` index-pairs elements that have no id**, which can corrupt a kept element's nested arrays. Proven, but no current step triggers it. Fix: never index-pair against an element that is still live in `next`, and add a regression test.
10. **BUG-views-1 / SM-views-2: the detail disclosure is closed imperatively**, which poisons callers' render caches (`detail.js:60-67`). Not verified by me. Fix: close by redrawing.

## What to protect (all four lanes agree)
- Reducers with explicit transition tables, and charts generated from them (`docs/state-machines.md`, `scripts/statecharts.ts`, `tests/statecharts.test.ts`).
- `tests/lint.test.ts`: core purity, single writer per piece of state, no swallowed catch, edge state inventories.
- Fight odds and solo simulation run on the real `reduce()` with seeded dice (`play.ts`, `odds.ts`), not a second engine.
- `fight-doc.ts` keeps hidden foes and unrevealed intents secret, and fight-save.ts writes back in one step.
- Store life backs up before load and refuses to overwrite unreadable or newer saves (`store-life.ts`, `edge/store.ts`). The service worker installs all or nothing (`sw.js:14-34`).
- The outbox's per-entry machine and event-id idempotency (`outbox.ts`), and refusal words keyed by their union types.

## Verification by the orchestrator (20 claims checked against the code)

I checked 20 claims at their file:line. I proved 3 with throwaway bun tests outside the repo (not checked in). Neon was right about where every one of the 20 is in the code. It was wrong or overstated about the **impact** of 13 of them, mostly by calling a bounded or self-healing issue high. 1 is effectively wrong: BUG-sync-5 is a real core quirk, but the UI cannot reach it. 1 is a design decision, not a bug: BUG-gates-2. The severity column of the combined list shows my corrected value, with Neon's original in brackets.

| ID | Verdict | Notes |
|---|---|---|
| BUG-gates-1 | CONFIRMED (proven) | Throwaway test: second settleClear on a cleared gate is not refused; hunter gold 20 -> 40, xpPaid 150 -> 300. Reachable from a stale Clear panel (SM-gates-3). |
| BUG-gates-4 | CONFIRMED (proven) | Throwaway test: a consumable with only dispel or hasten parses, then itemAbility returns null (abilities.ts:200 lists only wave-1 ops; fight-parse.ts:317 has all 16). |
| BUG-sync-3 | CONFIRMED (read) | save.ts:715-717 strips only deviceId/deviceToken/keys; keepGmKey (save.ts:729-734) returns the file as is when rooms differ, so the phone's gmKeys ring is replaced by the file's. |
| BUG-views-2 | CONFIRMED (read) | table.js:343 always posts on:null; fight.ts:343 refuses a when:turn reaction with on===null (noTarget). Did not check whether the player UI lists turn reactions at all. |
| BUG-views-7 | CONFIRMED (read) | questApply returns the Refused object (quests.js:102), which is truthy, so fail() still calls sendUpdate. |
| BUG-rules-5 | PATH CONFIRMED, not reproduced | fight-turn.ts:388-390: grounded() can land zone ends (damage) and then `who!` is read with no overIf; crash if the last up body drops. |
| BUG-sync-1 | CONFIRMED (proven), severity lowered | Throwaway test: writeInto({s:[A]}, {s:[B,A]}) leaves A.def.ops equal to B's. Latent: I found no current step that inserts before a kept id-less element (rolls/log/gates have ids; dropStatus keeps objects). |
| BUG-sync-2 | PARTLY RIGHT, severity lowered | Only a malformed id that a reference also uses dangles (save.ts:543 checks before save.ts:668 renames); a duplicate id keeps the first holder's id. Needs a corrupted save. |
| BUG-sync-4 | CONFIRMED (read), severity lowered | roomGone filters at===queued only (outbox.ts:119). Bounded: OUTBOX_MAX 100 evicts, and a 404 answer to the in-flight send refuses it itself. |
| BUG-sync-5 | WRONG IN PRACTICE, severity lowered | link.ts:399 does ignore the key, but the lobby with "Rejoin as GM" is hidden while in a room (room.js:347), so the UI cannot reach it. |
| BUG-sync-7 | PARTLY RIGHT, severity lowered | The doc mismatch is real (state-machines.md:1382 vs store.ts:285), but the save's cursor is not written either, so the events are polled again after the reload a read-only tab needs. Not permanent loss. |
| BUG-sync-8 | CONFIRMED (read), severity lowered | No in-flight guard per doc (sync.ts:767-772, 784). Self-heals: publishNow compares with the room's doc on the next poll or change and puts again. |
| BUG-rules-6 | CONFIRMED (read), severity lowered | land.ts:168 runs crossed() and records gained on t=m.target, which is the giver when op.from==='target' (land.ts:233,244). Only steal-style moves. |
| BUG-rules-1 | PARTLY RIGHT, severity lowered | overrides.ts:162 accepts any finite number. Only the GM can set overrides, so it is self-inflicted bad input rather than an exploit. |
| AW-rules-1 | CONFIRMED (read), severity lowered | Same evidence as BUG-rules-1. |
| BUG-gates-2 | PARTLY RIGHT: a design gap, not an accident | tests/statuses.test.ts:123-125 pins "Invisible and Stealth do nothing the fight counts" on purpose. That test predates the kits' hidden op, so the built-in Stealth skill really does nothing in a fight. It needs a decision, not a blind fix. |
| BUG-gates-3 | CONFIRMED (read), severity lowered | solo.ts:243 lets the player's built-ins win; the player's rules carry only their own library statuses (edge/rules.ts:35-36), so a GM-edited built-in is lost in a solo fight. Niche. |
| BUG-gates-13 | CONFIRMED (read) | qr.js:106 calls qrMatrix(text) without opts. |
| AW-gates-7 | CONFIRMED (read), severity lowered | publish-clean.ts:9,23 puts argv[2] into sh -c, but that is the developer's own path argument. |
| AW-sync-3 | CONFIRMED (read), severity lowered | edge/rules.ts:35 stringifies overrides, library statuses and room rules on every rules() call. It is a cost, not a correctness bug. |

**What Neon missed or got scattered, from what I saw:**
- BUG-gates-1 (double pay) and SM-gates-3 (a frozen Clear panel on a gate that is already cleared) are one problem: the stale panel is how a GM reaches the double pay. Fix them together. Add a test that a second `settleClear` is refused.
- Several lanes report the same root problem: views ignore a refusal from `store.apply`. That covers AW-views-1 and BUG-views-5, -6, -7, plus the refusal swallowed in core by BUG-gates-1. A lint rule that an `Applied` result must be read would close the whole class. The repo already has one lint rule per bug class.
- Two lanes report the UTF-16 length versus UTF-8 byte cap mismatch separately (BUG-sync-9 and BUG-gates-6). It is one fix.
- I did not independently re-audit the 134 claims I didn't check. Treat every unchecked claim as a lead to confirm, not a fact.

---

# Neon lane report: rules (verbatim)

### Goal and Review Lens

The goal of this audit is a read-only architectural, state-machine, and defect review of the game rules core in `systemgaming` (`a11b6a5d`, post-PR #38), covering `src/core/combat/`, `src/core/hunter/`, and the 19 core rule/utility modules in `src/core/`, with rule math checked against [docs/guide/combat.md](docs/guide/combat.md), [docs/guide/hunters.md](docs/guide/hunters.md), [rules-text.ts](src/core/rules-text.ts), and [rulesref.js](src/views/rulesref.js).

Every review decision followed the `pstack` skills in `.claude/skills/`:

- **Domain modeling** (`principle-model-the-domain`, `statechart`): I checked whether every runtime phase and entity kind is represented by a closed discriminated union and transition table, and checked existing tables against [docs/state-machines.md](docs/state-machines.md) to flag only unmodeled machines or code-vs-doc divergences.
- **Boundary discipline and foundational thinking** (`principle-boundary-discipline`, `principle-foundational-thinking`, `principle-type-system-discipline`, `typescript-best-practices`): I traced every boundary parser (`overrides.ts`, `fight-parse.ts`, `day.ts`, `save.ts`) to see what illegal values still reach core math, and looked for root structural splits (such as `act` vs `release` and `resolve.ts` vs `land.ts`) rather than listing isolated symptoms.
- **Shared-state serialization and idempotency** (`principle-separate-before-serializing-shared-state`, `principle-make-operations-idempotent`): I checked write-back ordering (`startTurn`, `fought`, `heldCommands`, `noticed`) for stale snapshots, dropped updates, and non-idempotent side effects.
- **Blast radius and reader load** (`blast-radius`, `architect`, `principle-minimize-reader-load`, `poteto-mode`): Every finding includes its blast radius or sequenced fix units, grounded strictly in `file:line` evidence.

---

### (A) Implicit State Machines

All 24+ machines already documented in [docs/state-machines.md](docs/state-machines.md) were checked and are NOT re-reported below except where code disagrees with the chart or bypasses the modeled table.

#### SM-rules-1: Feat visibility machine disagrees with `docs/state-machines.md` ("Hidden until earned")
- **Evidence**: [feats.ts](src/core/hunter/feats.ts#L73-L85), [noticed.ts](src/core/hunter/noticed.ts#L87-L90), [docs/state-machines.md](docs/state-machines.md#L1608-L1644)
- **Implemented states and transitions**: `hidden | shown | earned` with events `counted`, `broke`, `unlocked`. In `TABLE.hidden.unlocked` ([feats.ts](src/core/hunter/feats.ts#L77)), `s => ({ state: { ...s, at: 'shown' }, fx: 'shown' })` unconditionally transitions any `hidden` feat to `shown` without checking `c.def.show.at === 'feat'`.
- **Illegal states representable**: A feat configured with `show: { at: 'never' }` ("Hidden until earned") transitions to `shown` if given `{ type: 'unlocked' }`. [docs/state-machines.md](docs/state-machines.md#L1608-L1637) renders this illegal transition in the generated chart while its own prose at [docs/state-machines.md](docs/state-machines.md#L1644) states "one hidden until earned is never shown before."
- **Bug / race risk**: Only caller discipline in [noticed.ts](src/core/hunter/noticed.ts#L88) prevents revealing secret feats. Any future caller or test dispatching `unlocked` breaks secrecy.
- **Proposed explicit model**: Guard `TABLE.hidden.unlocked` on `c.def.show.at === 'feat'` (returning `{ state: s, fx: null }` otherwise), or split `hidden` into `secret` (`show.at === 'never'`, `unlocked: null`) and `locked` (`show.at === 'feat' | 'count'`).
- **Blast radius**: Low (2 files: [feats.ts](src/core/hunter/feats.ts), [scripts/charts/feats.ts](scripts/charts/feats.ts), plus regenerating [docs/state-machines.md](docs/state-machines.md)).

#### SM-rules-2: Running fight "awaiting owed dice/releases" vs "ready for turn command" sub-phase
- **Evidence**: [fight-types.ts](src/core/combat/fight-types.ts#L56-L78), [fight.ts](src/core/combat/fight.ts#L631-L662), [play.ts](src/core/combat/play.ts#L62-L78)
- **Implemented states and transitions**: `Running` holds `currentId`, `now`, `pending: DueTurn[]`, and `rows` (some of which may hold `channel.state === 'broken'`). `owed(f)` ([fight.ts](src/core/combat/fight.ts#L656-L662)) derives an implicit "blocking work" queue from `f.pending` and `f.rows.filter(r => r.channel?.state === 'broken' && isUp(r))`. However, `TABLE.running` ([fight.ts](src/core/combat/fight.ts#L631-L634)) permits `act`, `move`, `endTurn`, `add`, `remove`, `adjust`, `status`, and `end` while `owed(f)` is non-empty.
- **Illegal states representable**:
  1. A turn advances via `act`/`move`/`endTurn` while `pending` per-round damage or spreads from the previous turn remain unpaid, leaving stale `DueTurn` items whose `id` may already be down or removed.
  2. A combatant with `channel.state === 'broken'` goes down before `release` runs; `owed(f)` filters `isUp(r)` ([fight.ts](src/core/combat/fight.ts#L660)), leaving `channel.state === 'broken'` stuck on the downed row until it is healed and unexpectedly fires rounds later.
- **Bug / race risk**: Any view or player room command arriving between a command and `payOwed()` (or after a reload) can interleave turn commands with unpaid `settle`/`release` ops.
- **Proposed explicit model**: Split `Running` into two discriminated phases (`{ phase: 'running'; sub: 'owed'; queue: readonly OwedItem[] }` accepting only `settle`, `release`, `end`, `clear`, and `{ phase: 'running'; sub: 'turn' }` accepting turn commands), or reject turn commands in `actor()` whenever `owed(f).length > 0` and clear `channel` when a row hits 0 HP.
- **Blast radius**: Medium ([fight-types.ts](src/core/combat/fight-types.ts), [fight.ts](src/core/combat/fight.ts), [fight-turn.ts](src/core/combat/fight-turn.ts), [fight-parse.ts](src/core/combat/fight-parse.ts), [play.ts](src/core/combat/play.ts), `combat.js`).

#### SM-rules-3: Polymorphic `Body` kind/lifecycle flattened into 15+ optional/nullable fields
- **Evidence**: [effect-ops.ts](src/core/combat/effect-ops.ts#L291-L321), [rows.ts](src/core/combat/rows.ts#L64-L215), [fight-parse.ts](src/core/combat/fight-parse.ts#L688-L750), [summons.ts](src/core/combat/summons.ts#L39-L48), [map-view.ts](src/core/combat/map-view.ts#L101)
- **Implemented states and transitions**: `Body` uses `kind: 'hunter' | 'monster' | 'shadow' | 'summon'` on one flat object carrying `holder`, `origin`, `threat`, `stagger`, `intent`, `extraction`, `xp`, `owner`, `until`, `tally`, `used`, `trips`, `warded`, `extras`, `hastened`, `armed`, `channel`. Neither TypeScript types nor `rowOf()` ([fight-parse.ts](src/core/combat/fight-parse.ts#L688-L750)) enforce which fields belong to which `kind`.
- **Illegal states representable**:
  1. `kind: 'summon'` with `owner: undefined` (parses cleanly; `map-view.ts:101` silently uses `b.owner ?? b.id`; `summons.ts:39` dismisses it on next sweep).
  2. `kind: 'hunter'` with `origin.kind === 'monster'`, `extraction`, `stagger`, or `intent`.
  3. `kind: 'monster'` with `holder: { kind: 'local', ... }` or `owner`.
  4. `extraction` present on a monster with `hp > 0`.
- **Bug / race risk**: Callers defensively check overlapping flags (`b.threat ? monsterChoice : partyChoice` in [policy.ts](src/core/combat/policy.ts#L135), `b.kind === 'hunter'` vs `b.holder !== null`, `isSummon` vs `b.owner`) which drift whenever a new body kind or rule is added.
- **Proposed explicit model**: Discriminated union `Body = HunterBody | MonsterBody | ShadowBody | SummonBody` sharing a `BaseBody`, with `rowOf()` validating the kind-specific arm.
- **Blast radius**: High (touches most of `src/core/combat/` and `tests/`). Sequence as a mechanical type refactor after fixing logic bugs.

#### SM-rules-4: Chronicle inbox "held during fight vs drained" machine is untyped and time-shifts facts
- **Evidence**: [chronicle.ts](src/core/hunter/chronicle.ts#L25-L39), [noticed.ts](src/core/hunter/noticed.ts#L7-L14), [noticed.ts](src/core/hunter/noticed.ts#L64-L76), [noticed.ts](src/core/hunter/noticed.ts#L105-L127)
- **Implemented states and transitions**: The file header at [noticed.ts](src/core/hunter/noticed.ts#L7-L14) documents a two-state machine ("waiting in the inbox while a fight holds the hunter, drained once free"), but `Chronicle.inbox` is a plain array of unstamped `Fact[]` and is absent from [docs/state-machines.md](docs/state-machines.md).
- **Illegal states representable**: Facts recorded before a long rest, day rollover, or session change while the hunter is held in a fight wait unstamped in `inbox`, then are stamped with `stamp` at drain time ([noticed.ts](src/core/hunter/noticed.ts#L66,L73)). A `longRest` or day boundary occurring before drain assigns the fact to the wrong `day`/`session`/`longRest` window.
- **Bug / race risk**: Feat windows (`within: 'day' | 'session' | 'longRest'`) misclassify held facts; any write path that forgets to run `noticed()` leaves facts stranded in `inbox`.
- **Proposed explicit model**: Stamp facts with `FactStamp` (or at least `day` and `session`) when enqueued in `record()`, and model inbox drain as an explicit `InboxState` (`idle` vs `held`) with a documented transition in [docs/state-machines.md](docs/state-machines.md).
- **Blast radius**: Medium ([chronicle.ts](src/core/hunter/chronicle.ts), [noticed.ts](src/core/hunter/noticed.ts), callers of `record()`).

#### SM-rules-5: Channel `interrupt` transition bypassed by direct `broken()` mutations
- **Evidence**: [fight-channel.ts](src/core/combat/fight-channel.ts#L45-L53), [effect-ops.ts](src/core/combat/effect-ops.ts#L286), [resolve.ts](src/core/combat/resolve.ts#L584,L629), [land.ts](src/core/combat/land.ts#L265,L276), [fight.ts](src/core/combat/fight.ts#L224-L226,L384)
- **Implemented states and transitions**: `fight-channel.ts` defines the explicit machine (`holding` + `interrupt` -> `broken` with charge halved by `share`). However, `broken()` in [effect-ops.ts](src/core/combat/effect-ops.ts#L286) mutates `state: 'broken'` directly without changing `charge`. Only `act` ([fight.ts](src/core/combat/fight.ts#L224-L226)) post-scans rows to call `channelStep(was, { type: 'interrupt', share: R.fight.breakShare })`.
- **Illegal states representable**: A `Channel` in `state: 'broken'` with unhalved `charge` (e.g. `charge: 4` instead of `2`) whenever broken by `release` ([fight.ts](src/core/combat/fight.ts#L384)), a trigger, a threshold, a delayed end, a zone end, or a reaction ([land.ts](src/core/combat/land.ts#L265,L276)).
- **Bug / race risk**: Directly causes **BUG-rules-3** (broken channels fire at full charge instead of half charge).
- **Proposed explicit model**: Delete `broken()` in [effect-ops.ts](src/core/combat/effect-ops.ts#L286) and pass `R.fight.breakShare` to a single helper `interruptChannel(b, R)` backed by `channelStep(b.channel, { type: 'interrupt', share: R.fight.breakShare })`.
- **Blast radius**: Low (4 files: [effect-ops.ts](src/core/combat/effect-ops.ts), [resolve.ts](src/core/combat/resolve.ts), [land.ts](src/core/combat/land.ts), [fight.ts](src/core/combat/fight.ts)).

#### SM-rules-6: Status expiry vs `b.statuses` direct reads and stacking-delayed `spent` vs `expired` clash
- **Evidence**: [effect-ops.ts](src/core/combat/effect-ops.ts#L533-L553), [standing.ts](src/core/combat/standing.ts#L20,L65,L87,L177,L192), [resolve.ts](src/core/combat/resolve.ts#L455-L465)
- **Implemented states and transitions**: Statuses carry `until: Tick | null`, optional `zone?: ZoneId`, optional `stack`, and optional `end` (delayed effect). In `settle()` ([effect-ops.ts](src/core/combat/effect-ops.ts#L539-L545)), `leave: 'round'` decrements stacks before checking time expiry. Meanwhile, `standing.ts` helpers (`sheetAdds`, `shareOf`, `holds`, `edgeOn`, `boostsOn`) iterate `b.statuses` directly without checking `s.until === null || s.until > now`.
- **Illegal states representable**:
  1. A stacking status with both `leave: 'round'` and `end` (delayed effect) on its final round + final stack moves to `spent` instead of `expired` ([effect-ops.ts](src/core/combat/effect-ops.ts#L540-L544)), skipping `end` detonation (**BUG-rules-19**).
  2. Any caller querying `standing.ts` with a timestamp `now` before `advance()` prunes expired statuses reads expired buffs/debuffs/edges/boosts as active.
- **Bug / race risk**: Silent suppression of delayed effects on stacking statuses; stale status modifiers if `now` advances before `advance()` runs.
- **Proposed explicit model**: Check `timeExpired` before `leave: 'round'` in `settle()` (so time expiration always enters `expired` and triggers `end`), and either pass `now` (using `live(b, now)`) into `standing.ts` or document and enforce that `Body.statuses` never holds expired entries outside `advance()`.
- **Blast radius**: Low ([effect-ops.ts](src/core/combat/effect-ops.ts), [standing.ts](src/core/combat/standing.ts)).

#### SM-rules-7: Hunter rank promotion vs level demotion has no explicit eligibility state
- **Evidence**: [progress.ts](src/core/hunter/progress.ts#L70-L98), [sheet.ts](src/core/hunter/sheet.ts#L72-L81), [record.ts](src/core/hunter/record.ts#L21-L38)
- **Implemented states and transitions**: `rank` and `level` evolve independently. `nextRank()` ([sheet.ts](src/core/hunter/sheet.ts#L72-L81)) checks only whether `h.level >= R.rankLevels[RANKS[i + 1]]`. `reevaluate()` ([record.ts](src/core/hunter/record.ts#L26-L38)) advances one rank at a time. `gainXp` / `setLevel` can reduce `level` below `R.rankLevels[h.rank]` without touching `h.rank`.
- **Illegal states representable**: A hunter at rank `A` and level `1` (after GM level edit or negative XP) still keeps `rankBonus['A']` (+6) and open build tiers for rank `A` (`tiersOpen` in [build.ts](src/core/hunter/build.ts#L22)). A hunter jumping from level 1 to level 40 must be re-evaluated five separate times.
- **Bug / race risk**: Low in normal play, confusing on GM level corrections.
- **Proposed explicit model**: Add a pure helper `rankStanding(h, R): { at: 'current' } | { at: 'ready'; to: Rank } | { at: 'above-level'; floor: number }` so views and GM edits surface rank/level mismatches explicitly.
- **Blast radius**: Low ([sheet.ts](src/core/hunter/sheet.ts), [record.ts](src/core/hunter/record.ts)).

---

### (B) Architectural Weaknesses

#### AW-rules-1: Unbounded numeric GM rule overrides bypass domain invariants (Severity: high)
- **Evidence**: [overrides.ts](src/core/overrides.ts#L123-L125), [overrides.ts](src/core/overrides.ts#L162-L163), [rules.ts](src/core/rules.ts#L14-L387)
- **Problem**: `parseOverrides` validates only `solo.*` with numeric bounds (`whole(1, ...)`). Every other numeric leaf in `RULES` (including `xpPerLevel`, `streakBonusEvery`, `dice.maxSides`, `fight.round`, `fight.speedMin`, `fight.statBase`, `fight.half`, `fight.armorK`, `fight.growthDiv`) accepts any finite number, including `0`, negative numbers, and `1e9`. This directly enables **BUG-rules-1** (division by zero, `NaN`, infinite-like level jump to 9999, OOM in `standOdds`).
- **Concrete fix**:
  1. Add a typed `BOUNDS` table in [overrides.ts](src/core/overrides.ts) covering every numeric leaf in `RULES` (with positivity constraints `>= 1` or `> 0` for divisors, `min <= max` invariants for pairs like `speedMin <= speedMax`, and hard caps on `dice.maxCount`/`dice.maxSides`).
  2. Add a test in `tests/overrides.test.ts` verifying every numeric leaf in `RULES` has an explicit bound and rejects `0`, `-1`, and `1e9` where unsafe.

#### AW-rules-2: Duplicated ability-resolution pipelines (`act` vs `release`, and `resolve.ts:landOps` vs `land.ts:landOps`/`landOne`) (Severity: high)
- **Evidence**: [fight.ts](src/core/combat/fight.ts#L191-L247), [fight.ts](src/core/combat/fight.ts#L368-L389), [resolve.ts](src/core/combat/resolve.ts#L307-L358), [land.ts](src/core/combat/land.ts#L155-L284)
- **Problem**: `act` and `release` duplicate the post-`landUse` pipeline (channel interrupt halving, zone prices, leftZone, zoneEnds, summoned, zoneActed, forced-move `pushedIn`, stealth `uncovered`, reactions, `tallied`, `triggered`, `used` effect). Similarly, `resolve.ts:landOps` and `land.ts:landOps`/`landOne` duplicate `cureStatus`, `dispel`, `channel`, `move`, and `applyStatus` handling. Almost every combat logic defect found in this audit (**BUG-rules-3, BUG-rules-6, BUG-rules-13**) lives in the drift between these duplicates.
- **Concrete fix**:
  1. Extract a single `commitUse(f, a, u, at, resolved, ...)` helper in [fight.ts](src/core/combat/fight.ts) called by both `act` and `release`.
  2. Unify `dispel`, `cureStatus` (`cureLands` detonation), `channel: break` (`channelBreaks` + `interruptChannel`), and `move` (`holder` + `gained`/`ended` tracking) into shared helpers in [land.ts](src/core/combat/land.ts) used by both `resolve.ts` and `land.ts`.

#### AW-rules-3: Pre-rolled dice contract (`needs()` before `reduce()`) breaks on mid-use state changes (Severity: high)
- **Evidence**: [fight.ts](src/core/combat/fight.ts#L213-L216), [fight.ts](src/core/combat/fight.ts#L282), [resolve.ts](src/core/combat/resolve.ts#L416-L429), [resolve.ts](src/core/combat/resolve.ts#L532-L542), [play.ts](src/core/combat/play.ts#L58-L59)
- **Problem**: Because `src/core` is pure and dice arrive upfront in `cmd.rolls`, the caller asks `needs(a, u, rows, aim, ...)` BEFORE `reduce()` runs. Two mechanics mutate the target set or dice requirements during `act` before `landUse` validates `rolls`: `blink` moves `user` to `at` before `whoIsIn` (**BUG-rules-4**), and `beforeReactions` can add `edge`/`boost` statuses to a target (**BUG-rules-2**).
- **Concrete fix**:
  1. In [resolve.ts](src/core/combat/resolve.ts), make `needs()` simulate the post-blink position (`a.move?.kind === 'blink' ? { ...user, place: at } : user`) so `needs()`, `beforeReactions()`, and `landUse()` all inspect the exact same target set.
  2. For `before` reactions that grant `edge`/`boost`, either have `needs()` inspect armed `before` reactors (or disallow `edge`/`boost` ops on `before` reactions in `fight-parse.ts` with a clear rule), or introduce an `owed` roll step for reaction-added dice.

#### AW-rules-4: Range legality duplicated across `resolve.ts`, `fight-view.ts`, and `map-view.ts` (Severity: med)
- **Evidence**: [resolve.ts](src/core/combat/resolve.ts#L100), [resolve.ts](src/core/combat/resolve.ts#L178-L181), [resolve.ts](src/core/combat/resolve.ts#L499), [fight-view.ts](src/core/combat/fight-view.ts#L222,L252), [map-view.ts](src/core/combat/map-view.ts#L37-L52,L541,L548,L558)
- **Problem**: `resolve.ts` computes effective range via `rangeFor(a, user, R)` and caps blink abilities at `R.fight.kit.blinkMax`, while `Spot` (`fight-view.ts`) and `MapBody` (`map-view.ts`) omit status range bonuses and `blinkMax`. Even inside `resolve.ts`, `taunted()` ([resolve.ts](src/core/combat/resolve.ts#L100)) uses raw `a.range` instead of `rangeFor`.
- **Concrete fix**:
  1. Export one `effectiveRange(a, rangeAdd, R)` helper in [resolve.ts](src/core/combat/resolve.ts) that applies both `rangeAdd` (when `a.range >= 2`) and `blinkMax` (when `a.move?.kind === 'blink'`).
  2. Carry `rangeAdd: number` on `Spot` / `MapBody` (and `FightDocRow` for the active player row) so `taunted`, `ready`, `aims`, and `aimFocus` all call the same function.

#### AW-rules-5: Rules reference duplicates rule math and reads a dead rule key (Severity: med)
- **Evidence**: [rules.ts](src/core/rules.ts#L11,L19), [rulesref.js](src/views/rulesref.js#L136,L158,L199-L200), [registry/items.ts](src/core/registry/items.ts#L152), [inventory.ts](src/core/hunter/inventory.ts#L38-L41)
- **Problem**: `RULES.dailyRewardPoints` is never read by any gameplay code (which reads `DAILY_REWARDS.points` / `R.dailyTemplate.rewards.points`), and [rulesref.js](src/views/rulesref.js#L199-L200) computes item sell values as `R.baseValue * v.mult` instead of calling `sellPrice()` / `priceOf()`, disagreeing by 5× (**BUG-rules-16**).
- **Concrete fix**:
  1. Remove `RULES.dailyRewardPoints` (or derive `DAILY_REWARDS.points` from it) and update [rulesref.js](src/views/rulesref.js#L136) to read `R.dailyTemplate.rewards.points`.
  2. Move the loot/sell-price formatting sentence into [rules-text.ts](src/core/rules-text.ts) calling `priceOf()` and `sellPrice()`.

#### AW-rules-6: UTF-16 `.length` doc budgets mismatch `server.ts` UTF-8 `MAX_BODY` byte cap (Severity: med)
- **Evidence**: [size.ts](src/core/size.ts#L16), [bestiary.ts](src/core/bestiary.ts#L103,L106), [feats.ts](src/core/hunter/feats.ts#L204,L206), [fight-doc.ts](src/core/combat/fight-doc.ts#L403), [protocol.ts](src/core/protocol.ts#L629,L892), [server.ts](server.ts#L379,L486)
- **Problem**: `size.ts` already provides `bytesOf()` (`TextEncoder`), yet all room doc builders (`codexDoc`, `featsDoc`, `fightWire`) and `protocol.ts:soloDocOf` measure `JSON.stringify(...).length` (UTF-16 code units) against `DOC_MAX = 62000`, while `server.ts:379` rejects requests over `MAX_BODY = 65536` UTF-8 bytes.
- **Concrete fix**:
  1. Measure doc size with `bytesOf(JSON.stringify(...))` from [size.ts](src/core/size.ts#L16) in [bestiary.ts](src/core/bestiary.ts), [feats.ts](src/core/hunter/feats.ts), [fight-doc.ts](src/core/combat/fight-doc.ts), [protocol.ts](src/core/protocol.ts), and [server.ts](server.ts#L486).
  2. Add a multi-byte UTF-8 test case (CJK / emoji / `—`) to `tests/protocol.test.ts`.

#### AW-rules-7: Boundary authority and write-back asymmetry across `src/core/hunter/` (Severity: med)
- **Evidence**: [build.ts](src/core/hunter/build.ts#L55-L60), [quests.ts](src/core/hunter/quests.ts#L102-L120), [grant.ts](src/core/hunter/grant.ts#L183,L248,L301-L302), [shadows.ts](src/core/hunter/shadows.ts#L65-L90), [shadows.js](src/views/shadows.js#L90-L99)
- **Problem**: Core commands inconsistently enforce domain rules:
  - `pickPerk` and `respec` in [build.ts](src/core/hunter/build.ts#L62-L89) enforce `buildsOn(R)` and `playerPick`, whereas `choosePath` ([build.ts](src/core/hunter/build.ts#L55-L60)) accepts any `gm` flag without checking `inFight` or seat.
  - `deleteQuest` checks quest permissions, whereas `editQuest` ([quests.ts](src/core/hunter/quests.ts#L102-L120)) does not enforce `quest-rights.ts`.
  - `stepShadow` ([shadows.ts](src/core/hunter/shadows.ts#L65-L90)) does not own summon mana cost, pushing mana deduction coordination into [shadows.js](src/views/shadows.js#L95-L96).
  - `grant` and `finishQuest` call `refill()` directly instead of `sheetEdit()`, dropping Chronicle `life: raised` facts (**BUG-rules-21**), and `sheetEdit` `put`/`drop` skips `fitted()` (**BUG-rules-20**).
- **Concrete fix**:
  1. Route `grant`/`finishQuest` refills through `sheetEdit(..., { kind: 'refill' }, R)` and add `fitted(..., R)` to `sheetEdit` `put`/`drop`.
  2. Pass role/inFight checks into `choosePath` and `editQuest` so views cannot bypass core authority rules.

#### AW-rules-8: High-coupling / god-file pressure in core combat modules (Severity: med)
- **Evidence**: [fight-parse.ts](src/core/combat/fight-parse.ts) (828 lines), [map-view.ts](src/core/combat/map-view.ts) (773 lines), [fight.ts](src/core/combat/fight.ts) (699 lines), [resolve.ts](src/core/combat/resolve.ts) (652 lines), [formula.ts](src/core/formula.ts) (652 lines)
- **Problem**: Multiple unrelated responsibilities live together: [map-view.ts](src/core/combat/map-view.ts) mixes polygon outlining (`outline`), label placement (`platesOf`), scene projection (`mapScene`), UI selection state machine (`choose`), and hotbar layout (`hotbar`); [fight.ts](src/core/combat/fight.ts) mixes reducer dispatch, reaction orchestration, summon placement, stealth sight checks, and fog exploration.
- **Concrete fix**:
  1. Split `choose` + `hotbar` out of [map-view.ts](src/core/combat/map-view.ts) into `map-choice.ts` and `hotbar.ts` (zero behavior change).
  2. Move `beforeReactions`/`afterReactions` into [fight-react.ts](src/core/combat/fight-react.ts) and `summoned` into [summons.ts](src/core/combat/summons.ts).

#### AW-rules-9: Non-canonical timestamp comparisons and non-antisymmetric sort comparators (Severity: low)
- **Evidence**: [day.ts](src/core/day.ts#L13,L60-L62), [chronicle.ts](src/core/hunter/chronicle.ts#L113), [chronicle-view.ts](src/core/hunter/chronicle-view.ts#L112,L152), [feats.ts](src/core/hunter/feats.ts#L144)
- **Problem**: [day.ts](src/core/day.ts#L60-L62) defines `compareTimes()` as the canonical timestamp comparator, yet `chronicle.ts`, `chronicle-view.ts`, and `feats.ts` compare ISO strings with `<` and return `1` on equal timestamps (`a < b ? -1 : 1`), violating JS `Array.prototype.sort` antisymmetry.
- **Concrete fix**: Replace raw string comparisons in those three files with `compareTimes(a, b)` from [day.ts](src/core/day.ts#L60-L62).

#### AW-rules-10: `derive.ts` and `sheet.ts` do not clamp vital maxima (`hpMax >= 1`, `manaMax >= 0`, `fatigueMax >= 0`) (Severity: low)
- **Evidence**: [derive.ts](src/core/hunter/derive.ts#L162-L164), [sheet.ts](src/core/hunter/sheet.ts#L191-L196), [save.ts](src/core/save.ts#L504)
- **Problem**: `derive()` lets negative `hpAdj` or negative item/title perks drive `hpMax <= 0`, `manaMax < 0`, or `fatigueMax <= 0`. `setMaximum()` ([sheet.ts](src/core/hunter/sheet.ts#L191-L196)) also allows setting `hpMax` to `0` (`Math.max(0, ...)`). Downstream modules assume `hpMax >= 1` and `fatigueMax >= 1` (**BUG-rules-7**).
- **Concrete fix**: Clamp `hpMax` to `Math.max(1, ...)` and `manaMax`/`fatigueMax` to `Math.max(0, ...)` in [derive.ts](src/core/hunter/derive.ts#L162-L164), clamp `setMaximum` for `'hpMax'` to `>= 1` in [sheet.ts](src/core/hunter/sheet.ts#L193), and guard `fatigueMax === 0` in [vitals.ts](src/core/hunter/vitals.ts#L152).

#### AW-rules-11: Boundary type/limit inconsistencies (`BundleId`, `imported.ts`, `level <= 200` vs `MAX_LEVEL = 9999`) (Severity: low)
- **Evidence**: [rewards.ts](src/core/rewards.ts#L127-L129), [imported.ts](src/core/hunter/imported.ts#L26-L44), [fight-parse.ts](src/core/combat/fight-parse.ts#L654), [progress.ts](src/core/hunter/progress.ts#L24)
- **Problem**: `saveBundle()` accepts unbranded `string` instead of `BundleId`; `withImportedHunters()` manually remaps entity lists and misses `h.used`, `shadow.monster`, and `jobChain.id` (**BUG-rules-28**); `fight-parse.ts` hardcodes hunter origin `level <= 200` instead of importing `MAX_LEVEL` (**BUG-rules-18**).
- **Concrete fix**: Brand `BundleId` in `saveBundle()`, import `MAX_LEVEL` in [fight-parse.ts](src/core/combat/fight-parse.ts#L654), and remap `h.used` / `jobChain.id` / `shadow.monster` in [imported.ts](src/core/hunter/imported.ts).

---

### (D) Bugs

#### BUG-rules-1: Unbounded numeric GM rule overrides crash or corrupt core math and OOM `standOdds` (Severity: high)
- **Evidence**: [overrides.ts](src/core/overrides.ts#L162-L163), [progress.ts](src/core/hunter/progress.ts#L74-L76), [stats.ts](src/core/stats.ts#L36,L45), [timeline.ts](src/core/combat/timeline.ts#L38,L77,L94), [formula.ts](src/core/formula.ts#L623), [quests.ts](src/core/hunter/quests.ts#L224)
- **Repro**:
  1. Set override `{ xpPerLevel: 0 }` and award 1 XP: `gainXp()` ([progress.ts](src/core/hunter/progress.ts#L74)) loops `level` straight to `MAX_LEVEL` (9999).
  2. Set `{ fight: { round: 0 } }` or `{ fight: { speedMin: 0 } }`: `timeline.ts:38,94` produces `NaN`/`Infinity` ticks and rounds.
  3. Set `{ fight: { half: 0 } }` or `{ fight: { statBase: 0 } }`: `capped()` and `eff()` in [stats.ts](src/core/stats.ts#L36,L45) return `NaN`/`Infinity`, poisoning every derived sheet stat.
  4. Set `{ dice: { maxSides: 1e9 } }` and parse `1d1000000000kh1`: `standOdds()` ([formula.ts](src/core/formula.ts#L623)) allocates `Array.from({ length: 1e9 })` and OOMs.
  5. Set `{ streakBonusEvery: 0 }` and complete all dailies: `streak % 0` ([quests.ts](src/core/hunter/quests.ts#L224)) evaluates `NaN`.
- **Suggested fix**: Add explicit min/max bounds for all numeric rules in [overrides.ts](src/core/overrides.ts) and clamp `standOdds` side limit independently in [formula.ts](src/core/formula.ts#L623).

#### BUG-rules-2: Stale pre-reaction `user` passed into `resolve()`, and `before` reactions granting `edge`/`boost` refuse the use (and crash `play.ts`) (Severity: high)
- **Evidence**: [fight.ts](src/core/combat/fight.ts#L213-L216), [resolve.ts](src/core/combat/resolve.ts#L537-L545), [play.ts](src/core/combat/play.ts#L54,L58-L59)
- **Repro**:
  1. Target `T` arms a `before` reaction that applies a defensive `edge` (`keep: 'better', side: 'defend'`) or `boost` (`side: 'defend', die: { kind: 'die', sides: 4 }`) status to `T`.
  2. Attacker `U` rolls `needs(a, U, rows, T.id, ...)` (which sees no `edge`/`boost` yet, so `rolls.second` and `rolls.boost` are empty) and sends `{ type: 'act', by: U.id, ... }`.
  3. `beforeReactions()` fires `T`'s reaction and adds the `edge`/`boost` to `before.rows`.
  4. `resolve(a, u, before.rows, ...)` ([fight.ts](src/core/combat/fight.ts#L215)) passes stale pre-reaction `u` (overwriting any change `before.rows` had on `u` at [resolve.ts](src/core/combat/resolve.ts#L545)) AND calls `needs(a, u, before.rows, ...)`, which now demands `rolls.second[T.id]` or `rolls.boost[T.id]`. `landUse` returns `{ ok: false, reason: 'needsRoll' }`, aborting the action (and throwing an uncaught `Error` in [play.ts](src/core/combat/play.ts#L54)).
- **Suggested fix**: Re-read `const uNow = before.rows.find(b => b.id === u.id)!` before calling `resolve()`. For `before` reactions granting `edge`/`boost`, either include armed `before` reactions' edges/boosts in `needs()` or forbid `edge`/`boost` on `before` reactions at parse time.

#### BUG-rules-3: Channel `release` and `landOne` skip charge-halving on broken channels; `release` drops zone prices, forced-move immunity, stealth reveal, summons, zoneAct, reactions, and item `used` (Severity: high)
- **Evidence**: [fight.ts](src/core/combat/fight.ts#L201-L209), [fight.ts](src/core/combat/fight.ts#L219-L246), [fight.ts](src/core/combat/fight.ts#L368-L389), [land.ts](src/core/combat/land.ts#L265,L276)
- **Repro**:
  1. Combatant `A` releases a channeled ability that deals >= `hold * hpMax` damage (or has `channel: break`) to channeling combatant `B` (charge 4). `resolve.ts:584` calls `broken()` without halving charge, and `release` ([fight.ts](src/core/combat/fight.ts#L384)) omits the `channelStep(was, { type: 'interrupt', share: R.fight.breakShare })` pass that `act` runs at [fight.ts](src/core/combat/fight.ts#L224-L226). `B`'s broken channel then fires at charge 4 instead of 2. The exact same omission occurs when `landOne` ([land.ts](src/core/combat/land.ts#L265,L276)) breaks a channel inside a trigger, threshold, delayed end, zone end, or reaction.
  2. Combatant `A` casts a channeled ability with a `zone` price (`prices: [{ kind: 'zone', ... }]`): `act` checks `pricedZones` at line 202, returns early at line 208 without consuming the zone, and `release` never consumes it either. The zone is kept for free.
  3. Combatant `A` releases a channeled ability that shoves/swaps a target into a hazard zone: `release` does not pass `r.shoved` to `after()` at line 388, so the shoved target wrongly takes on-entry zone damage.
  4. `release` also skips `uncovered` (a hidden caster stays hidden after firing a channeled attack), `summoned`, `zoneActed`, `beforeReactions`/`afterReactions`, and `{ type: 'used', by, ability }` (so a channeled item ability never spends the bag item).
- **Suggested fix**: Unify channel interruption into `interruptChannel(b, R)` using `channelStep`, consume zone prices on channel begin (matching HP/mana/stack prices), and extract a shared `commitUse()` helper used by both `act` and `release`.

#### BUG-rules-4: `landUse()` and `beforeReactions()` compute `needs()` from pre-blink `user` instead of post-blink `from` (Severity: high)
- **Evidence**: [resolve.ts](src/core/combat/resolve.ts#L532-L542), [fight.ts](src/core/combat/fight.ts#L282), [resolve.ts](src/core/combat/resolve.ts#L209)
- **Repro**:
  1. Create a blink ability (`move: { kind: 'blink' }`, `aim: 'place'`, `shape: { kind: 'radius', radius: 1 }`, `delivery: { kind: 'travel', ... }`).
  2. Stand at `(0,0)` next to foe `F1` at `(1,0)`, and blink to `(4,0)` next to foe `F2` at `(5,0)`.
  3. `needs(a, user, ...)` ([resolve.ts](src/core/combat/resolve.ts#L418)) evaluates `whoIsIn` from pre-blink `user` at `(0,0)` (if shape depends on user position, e.g. `line` or `touch`, it hits different bodies than from `(4,0)`).
  4. In `landUse` ([resolve.ts](src/core/combat/resolve.ts#L535-L537)), `whoIsIn` runs from post-blink `from` while `needs` runs from pre-blink `user`. For any target in post-blink shape but not pre-blink shape, `rolls.react[t.id]` is `undefined`, and `whereItEnds` ([resolve.ts](src/core/combat/resolve.ts#L209)) treats `d20 === undefined` as auto-`caught` with no dodge roll! Conversely, targets in pre-blink shape but not post-blink shape cause a false `'needsRoll'` refusal if not rolled.
- **Suggested fix**: Compute the post-blink position `from` inside `needs()` (when `a.move?.kind === 'blink'`) and pass `from` (not `user`) to `needs()` on [resolve.ts](src/core/combat/resolve.ts#L537).

#### BUG-rules-5: `startTurn` can crash (`who!` is `undefined`) after `grounded()`, and `turnReaction` skips `consequences()` (losing write-backs) (Severity: high)
- **Evidence**: [fight-turn.ts](src/core/combat/fight-turn.ts#L384-L391)
- **Repro**:
  1. **Crash**: Two weakened combatants stand in a zone whose `end` expires at `first.at` during `grounded(time.fight, ctx, fx)` ([fight-turn.ts](src/core/combat/fight-turn.ts#L388)), downing every remaining up combatant. Line 389 immediately executes `const who = next(g.rows.filter(isUp))!` without calling `overIf()` first. `who` is `undefined`, and line 391 (`timeUp(who, g.now)`) throws `TypeError: Cannot read properties of undefined`.
  2. **Lost write-backs**: Combatant `R` (a local or remote hunter) has a `turn` reaction armed on `first` that spends mana/fatigue/HP or consumes a status/use. At [fight-turn.ts](src/core/combat/fight-turn.ts#L384-L385), `turnReaction` mutates `map`, updates `g.rows`, and executes `continue` without calling `consequences()`. On the next iteration, `before = g.rows` already contains `R`'s post-reaction state, so `writeBack()` never sees the diff and never writes `R`'s spent mana/HP/fatigue/statuses to its sheet or remote player.
- **Suggested fix**: Wrap `turnReaction`'s update in `consequences(g.rows, updated, ctx, fx)` before `continue`, and run `const done = overIf(g, fx, R); if (done) return done;` right after `grounded()` on line 388 before selecting `who`.

#### BUG-rules-6: `landOps` `move` op attributes threshold crossing and `statusGained` to the giver instead of the receiver when `op.from === 'target'` (Severity: high)
- **Evidence**: [land.ts](src/core/combat/land.ts#L164-L169), [land.ts](src/core/combat/land.ts#L182), compare with [resolve.ts](src/core/combat/resolve.ts#L590)
- **Repro**:
  1. Give a trigger, delayed end, threshold, or reaction an op `{ op: 'move', from: 'target', key: 'mark', take: 2 }` (stealing 2 stacks of `mark` from `target` to `user`).
  2. In [land.ts](src/core/combat/land.ts#L168), `moved()` returns `m.user` (the receiver who gained stacks) and `m.target` (the giver who lost stacks).
  3. Line 168 checks `crossed(t, m.gained, m.before, m.k, now, R)` on `t` (`m.target`, the giver!) instead of `m.user` (the receiver), so the threshold never fires on the receiver and can misfire on the giver.
  4. Line 168 pushes `m.gained` onto `gained`, which line 182 attaches to `target: t.id` (the giver), emitting `statusGained` on the body that LOST the status instead of the body that gained it.
- **Suggested fix**: Mirror [resolve.ts](src/core/combat/resolve.ts#L590): select `const holder = op.from === 'user' ? m.target : m.user` for `crossed()`, and emit `gained` on `holder.id` (returning a separate receiver entry when `holder.id !== t.id`).

#### BUG-rules-7: `hpMax <= 0` / `fatigueMax <= 0` violates `Life` invariants and crashes `fight-doc.ts:band` (Severity: high)
- **Evidence**: [derive.ts](src/core/hunter/derive.ts#L162-L164), [sheet.ts](src/core/hunter/sheet.ts#L191-L196), [vitals.ts](src/core/hunter/vitals.ts#L52,L58,L152), [fight-doc.ts](src/core/combat/fight-doc.ts#L58-L62)
- **Repro**:
  1. GM sets a hunter's max HP to 0 via `setMaximum(h, 'hpMax', 0, R)` ([sheet.ts](src/core/hunter/sheet.ts#L193) allows `>= 0`), or gives negative `hpMax` perks/titles so `hpMax <= 0`.
  2. In [vitals.ts](src/core/hunter/vitals.ts#L52,L58), `at(1, 0)` returns `{ at: 'up', hp: 1 }` while `hpOf(life, 0)` returns `0`, putting the hunter in the illegal state "up at 0 HP."
  3. If `hpMax < 0` and `hp > 0`, `hp / hpMax < 0`, so `band(hp, hpMax)` ([fight-doc.ts](src/core/combat/fight-doc.ts#L61)) finds no entry in `CUTS` (`[0.75, 0.5, 0.25, 0]`) and throws `TypeError` on `undefined![0]`.
  4. If negative perks reduce `fatigueMax <= 0`, `fatiguePast(0, 0, ...)` ([vitals.ts](src/core/hunter/vitals.ts#L152)) returns `true` at 0 fatigue, permanently collapsing the hunter.
- **Suggested fix**: Clamp `hpMax >= 1` and `manaMax >= 0`, `fatigueMax >= 0` in [derive.ts](src/core/hunter/derive.ts#L162-L164), clamp `setMaximum` for `hpMax` to `>= 1`, and guard `if (hpMax <= 0) return 'down'` in `band()`.

#### BUG-rules-8: `heldCommands` revives a dead hunter's fight row on level-up refill and uses stale pre-status maxima (Severity: high)
- **Evidence**: [fight-save.ts](src/core/combat/fight-save.ts#L150-L157)
- **Repro**:
  1. A hunter dies in a fight (`row.hp === 0`, sheet `life.at === 'dead'`), and the GM grants XP that levels the hunter up while the fight still holds them (`p.refill === true`).
  2. `heldCommands()` ([fight-save.ts](src/core/combat/fight-save.ts#L154-L155)) checks only `row.hp < row.sheet.hpMax` and emits `{ type: 'adjust', id: p.cid, hp: row.sheet.hpMax - row.hp, ... }`.
  3. The fight row heals to full HP and stands back up, while `lifeAfter` on the hunter's sheet refuses HP changes on a `dead` hunter ([vitals.ts](src/core/hunter/vitals.ts#L101)), desyncing the fight row (alive at full HP) from the sheet (dead).
  4. Additionally, if `p.statuses` in the same batch changes `vit`/`pow`/`hpMax`/`manaMax`, line 155 computes `row.sheet.hpMax - row.hp` from the pre-status `row` instead of the post-status maxima.
- **Suggested fix**: Check `ctx.life(hid)?.at !== 'dead'` (or `row.hp > 0` / explicit sheet life check) before emitting HP refill in `heldCommands()`, and add a dedicated `refill` fight command (or compute post-status maxima in `heldCommands`) so refill applies after statuses.

#### BUG-rules-9: `editItem` leaves gear equipped in the wrong slot (or stacked `qty > 1`) when its slot changes (Severity: med)
- **Evidence**: [inventory.ts](src/core/hunter/inventory.ts#L68-L71)
- **Repro**:
  1. Hunter equips an item `i1` with `slot: 'weapon'` (so `h.equipped.weapon === 'i1'`).
  2. GM edits `i1` via `editItem(h, 'i1', { ...i1, slot: 'chest', qty: 3 })`.
  3. Line 70 checks `equipped: it.slot ? h.equipped : unwear(h.equipped, itemId)`. Because `it.slot` is truthy (`'chest'`), `i1` remains equipped in `h.equipped.weapon` with `qty: 3`.
- **Suggested fix**: In `editItem`, unwear `itemId` whenever `it.slot` changed to a slot incompatible with its currently worn slot (allowing `ring1`/`ring2` equivalence) or whenever `it.qty > 1`.

#### BUG-rules-10: `distinct` + `within: 'row'` feats do not clear `vals` on `'broke'`, permanently poisoning the next streak (Severity: med)
- **Evidence**: [noticed.ts](src/core/hunter/noticed.ts#L72-L76), [feats.ts](src/core/hunter/feats.ts#L76,L81)
- **Repro**:
  1. Define a feat with `measure: { of: 'distinct', field: 'monster' }`, `within: 'row'`, `reach: 3`, and a `where` test.
  2. Hunter kills Goblin, then Orc (`n: 2, vals: ['Goblin', 'Orc']`), then a fact fails `where` so `countStep` returns `'broke'`.
  3. [noticed.ts](src/core/hunter/noticed.ts#L75) constructs `{ type: 'broke', count: { ...from, n: 0 } }` (keeping `vals: ['Goblin', 'Orc']`), and [feats.ts](src/core/hunter/feats.ts#L76) spreads `...e.count`.
  4. In the new streak, killing Goblin or Orc again is ignored as already in `vals`, so the streak can never recount them.
- **Suggested fix**: On `'broke'`, reset to `{ n: 0, mark: from.mark }` (dropping `vals`) in both [noticed.ts](src/core/hunter/noticed.ts#L75) and [feats.ts](src/core/hunter/feats.ts#L76,L81).

#### BUG-rules-11: `featStep` unlocks `show: { at: 'never' }` feats to `shown`, contradicting `docs/state-machines.md` (Severity: med)
- **Evidence**: [feats.ts](src/core/hunter/feats.ts#L77), [docs/state-machines.md](docs/state-machines.md#L1608-L1644)
- **Repro**: Call `featStep(startOf(secretFeat), { type: 'unlocked' }, secretFeat, now)` where `secretFeat.show = { at: 'never' }`. It returns `{ state: { at: 'shown', ... }, fx: 'shown' }` instead of staying `hidden`.
- **Suggested fix**: In `TABLE.hidden.unlocked` ([feats.ts](src/core/hunter/feats.ts#L77)), check `c.def.show.at === 'feat' ? { state: { ...s, at: 'shown' }, fx: 'shown' } : { state: s, fx: null }`.

#### BUG-rules-12: `taunted`, `aims`, and `aimFocus` ignore `sheet: range` status modifiers and `blinkMax` (Severity: med)
- **Evidence**: [resolve.ts](src/core/combat/resolve.ts#L100,L499), [fight-view.ts](src/core/combat/fight-view.ts#L252), [map-view.ts](src/core/combat/map-view.ts#L541,L548,L558)
- **Repro**:
  1. Give a hunter a `+2 range` status (`sheet: 'range'`) and a shot with base `range: 4`. On the battle map, `aimFocus` ([map-view.ts](src/core/combat/map-view.ts#L541,L558)) and `aims` ([fight-view.ts](src/core/combat/fight-view.ts#L252)) use raw `a.range` (4), so targets at distance 5 or 6 cannot be tapped (`tapOn` returns `{ kind: 'refuse', reason: 'range' }`), making the range buff unusable on the map.
  2. If that hunter is taunted by a foe at distance 5, `taunted()` ([resolve.ts](src/core/combat/resolve.ts#L100)) checks `inRange(a, user, taunter.place)` (base range 4 -> false) and allows the hunter to ignore the taunt and shoot another foe at distance 4.
  3. Conversely, a blink ability with `range: 10` (`blinkMax: 6`) highlights tiles at distance 7–10 as legal on the map (`ok: true`), then `ready()` ([resolve.ts](src/core/combat/resolve.ts#L499)) refuses them with `'range'`.
- **Suggested fix**: Use a single `effectiveRange` helper (incorporating both `rangeFor` and `blinkMax`) across `taunted`, `ready`, `aims`, and `aimFocus`.

#### BUG-rules-13: `landOps` reports refused statuses as `gained`, `landOne` `dispel` misses `cureLands` and `channel: break` ignores `channel: protect`, and `eventsOf` misses `dispel`/`move` events (Severity: med)
- **Evidence**: [land.ts](src/core/combat/land.ts#L171-L179,L276,L278), [triggers.ts](src/core/combat/triggers.ts#L111-L112), [resolve.ts](src/core/combat/resolve.ts#L586-L596)
- **Repro**:
  1. Target `T` holds `safeguard` (or already spent `warded`). A trigger/reaction applies a harmful/warded status via `landOps`: `landStatus` returns `put: false`, which `landOne` drops, and [land.ts](src/core/combat/land.ts#L174) unconditionally runs `gained.push(op.key)`, firing `statusGained` triggers for a status that never landed.
  2. Target `T` holds a delayed bomb (`end` with `cleanse: 'land'`). A trigger/reaction runs `{ op: 'dispel', which: 'harmful' }`: `landOne` ([land.ts](src/core/combat/land.ts#L278)) strips the bomb without detonating it (unlike [resolve.ts](src/core/combat/resolve.ts#L343)) and never populates `cured`.
  3. Target `T` holds `channel: protect` while channeling. A trigger/reaction runs `{ op: 'channel', mode: 'break' }`: `landOne` ([land.ts](src/core/combat/land.ts#L276)) breaks the channel without calling `channelBreaks()`, bypassing `channel: protect`.
  4. In [land.ts](src/core/combat/land.ts#L177), `cureStatus` looks up `gone` in `rows.get(id)!` (pre-loop snapshot) instead of `t` before the cure; if an earlier op in the same `ops` list applied and then a later op cured a `cleanse: 'land'` status, `gone` is `undefined` and detonation is skipped.
  5. In [triggers.ts](src/core/combat/triggers.ts#L111-L112), `eventsOf` checks only `op.op === 'cureStatus'` for `statusEnded` (missing `dispel` and `move`), and [resolve.ts](src/core/combat/resolve.ts#L586-L596) never adds `move`-transferred statuses to `outcome.statuses` (missing `statusGained`).
- **Suggested fix**: Return `put: boolean` and `detonated: Status[]` from `landOne`, call `channelBreaks()` in `landOne`'s `channel` case, diff `before` vs `after` statuses in `eventsOf` for `statusEnded`, and record `move`-transferred keys on outcomes.

#### BUG-rules-14: `afterReactions` runs after `tallied`/`triggered` and wastes a second reactor's resources on an already-downed attacker (Severity: med)
- **Evidence**: [fight.ts](src/core/combat/fight.ts#L244-L246,L321), [fight-react.ts](src/core/combat/fight-react.ts#L100-L111)
- **Repro**:
  1. Hunter `H` arms an `after` counterattack reaction. Monster `M` attacks `H`; `H`'s `after` reaction kills `M`. Because `afterReactions` runs at line 246 AFTER `tallied` (line 244) and `triggered` (line 245), `H` gets zero credit for the kill or damage in `RowTally` (no `kill` fact in Chronicle, `kills` formula stays 0) and no `kill`/`down`/`struck` triggers fire.
  2. Two allies `A1` and `A2` both arm `after` reactions protecting `T`. `A1`'s reaction reduces attacker `M` to 0 HP. In [fight.ts](src/core/combat/fight.ts#L321), `!map.get(by)` is still false (the downed row is still in `map`), so `A2` calls `fireReaction()`, pays its mana/fatigue/cooldown/uses/turn-time, logs `"A2 reacts..."`, and deals nothing because `landOps` skips `!alive(t)`.
- **Suggested fix**: Check `!alive(map.get(by)!)` in [fight.ts](src/core/combat/fight.ts#L321), and feed `afterReactions` outcomes into `tallied` and `triggered` (or unify reaction damage recording with `consequences`).

#### BUG-rules-15: Multiple die-based `boost` statuses on the same combatant collide by `CombatantId` in `needs()` and `keptFace()` (Severity: med)
- **Evidence**: [resolve.ts](src/core/combat/resolve.ts#L421-L422), [resolve.ts](src/core/combat/resolve.ts#L441-L443)
- **Repro**:
  1. Give attacker `U` two separate statuses with `boost` (`side: 'attack'`): status `bless` (`+1d4`) and status `focus` (`+1d8`).
  2. `needs()` ([resolve.ts](src/core/combat/resolve.ts#L422)) deduplicates `boost` by `x.id === b.id`, so only `1d4` is requested and rolled into `rolls.boost[U.id]`.
  3. `keptFace()` ([resolve.ts](src/core/combat/resolve.ts#L441-L443)) loops over both statuses and subtracts `rolls.boost[U.id]` TWICE (using the `d4` roll for both `bless` and `focus`), while `spendEdges()` consumes both statuses.
- **Suggested fix**: Key `Needs.boost` and `Rolls.boost` by `${b.id}:${b.key}` (or `{ id, key, sides }`) instead of `b.id` alone.

#### BUG-rules-16: Rules page disagrees with core gameplay on daily points and item sell value (5× off) (Severity: med)
- **Evidence**: [rules.ts](src/core/rules.ts#L11,L19), [rulesref.js](src/views/rulesref.js#L136,L158,L199-L200), [registry/items.ts](src/core/registry/items.ts#L152), [inventory.ts](src/core/hunter/inventory.ts#L38-L41)
- **Repro**:
  1. Override `RULES.dailyRewardPoints = 5`. [rulesref.js](src/views/rulesref.js#L136) displays "+5", while line 158 displays "1 point" and completing dailies grants only 1 point (`DAILY_REWARDS.points`).
  2. Open Rules -> Loot and rarity ([rulesref.js](src/views/rulesref.js#L199-L200)): it states "Sell value = base 10 gold × tier multiplier" (Common = **10 gold**). In actual gameplay, an unpriced common item has `priceOf(R, 'common') = 10 * 1 * 10 = 100` gold ([registry/items.ts](src/core/registry/items.ts#L152)), and `sellPrice()` ([inventory.ts](src/core/hunter/inventory.ts#L38-L41)) pays half = **50 gold** (5× what the Rules page claims).
- **Suggested fix**: Eliminate `dailyRewardPoints` (read `R.dailyTemplate.rewards.points` everywhere) and compute the Rules page Loot table via `priceOf(R, k)` and `sellPrice({ rar: k }, R)`.

#### BUG-rules-17: Room doc builders measure UTF-16 `.length` against `DOC_MAX`, causing non-ASCII docs to fail `server.ts` HTTP 413 (Severity: med)
- **Evidence**: [bestiary.ts](src/core/bestiary.ts#L103,L106), [feats.ts](src/core/hunter/feats.ts#L204,L206), [fight-doc.ts](src/core/combat/fight-doc.ts#L403), [server.ts](server.ts#L379,L486)
- **Repro**: Build a codex, feats, or fight doc containing CJK, Cyrillic, accented Latin, or symbol text (`—`, `×`) totaling 40,000 UTF-16 characters (~100,000 UTF-8 bytes). Client builders pass `<= DOC_MAX (62000)` on `.length`, then `PUT /api/rooms/:code/sheets/_...` hits `new TextEncoder().encode(text).length > 65536` ([server.ts](server.ts#L379)) and fails with `413 too large`, permanently stalling doc sync.
- **Suggested fix**: Use `bytesOf()` ([size.ts](src/core/size.ts#L16)) for all doc size checks in core and server.

#### BUG-rules-18: `parseFight` caps hunter origin level at 200 while `MAX_LEVEL` is 9999, deleting running fights on reload (Severity: med)
- **Evidence**: [fight-parse.ts](src/core/combat/fight-parse.ts#L654), [progress.ts](src/core/hunter/progress.ts#L24), [save.ts](src/core/save.ts#L501,L646)
- **Repro**: Set a hunter to level 201 (valid via `setLevel` and `save.ts`, which allow up to `MAX_LEVEL = 9999`), start a fight with that hunter, and reload the page. `originOf()` ([fight-parse.ts](src/core/combat/fight-parse.ts#L654)) calls `whole(b.level, 1, 200)` -> `null`, causing `parseFight()` to return `null` and `save.ts:646` to drop the entire fight (`fightLost: true`).
- **Suggested fix**: Replace `200` with `MAX_LEVEL` imported from [progress.ts](src/core/hunter/progress.ts#L24).

#### BUG-rules-19: `settle()` suppresses delayed `end` detonation on a stacking status whose last stack and final round expire together (Severity: med)
- **Evidence**: [effect-ops.ts](src/core/combat/effect-ops.ts#L539-L545)
- **Repro**: Apply a stacking status with `stack: { max: 3, leave: 'round', ... }` and `end: { ops: [damage], cleanse: 'none' }` at 1 stack and 1 round remaining (`until <= now`). At turn start, `settle()` runs `stackStep(..., { type: 'round' })` first (lines 539–544), which returns `{ at: 'absent' }`, pushes the status into `spent`, and executes `continue` before line 545 (`if (s.until !== null && s.until <= now)`). Because `settleRow` detonates delayed effects only from `expired`, the delayed `end` effect never fires.
- **Suggested fix**: Check time expiration (`s.until !== null && s.until <= now`) before `leave: 'round'` stack decay in [effect-ops.ts](src/core/combat/effect-ops.ts#L539-L546).

#### BUG-rules-20: `sheetEdit` `put`/`drop` skips `fitted()`, leaving HP/mana/fatigue above reduced maxima (Severity: med)
- **Evidence**: [grant.ts](src/core/hunter/grant.ts#L301-L302)
- **Repro**: Hunter at full HP wears a status adding `+10 vit` or `+50 hpMax`. GM removes the status via `sheetEdit(h, { kind: 'drop', key }, R)`. `life.hp` remains above the hunter's new lower `hpMax` until some unrelated action calls `fitted()`.
- **Suggested fix**: Wrap `putCondition` and `dropCondition` results in `fitted(..., R)` on [grant.ts](src/core/hunter/grant.ts#L301-L302).

#### BUG-rules-21: `grant` and `finishQuest` bypass `sheetEdit` on `refill`, dropping `life: raised` facts and setting `levelup.refill = true` on dead hunters (Severity: med)
- **Evidence**: [grant.ts](src/core/hunter/grant.ts#L183-L185,L248), [vitals.ts](src/core/hunter/vitals.ts#L171)
- **Repro**:
  1. A `dying` or `stable` hunter completes all dailies (or levels up from a reward) outside a fight. `grant.ts:183` / `248` calls `refill()` directly, raising the hunter to `up` without recording the Chronicle `{ kind: 'life', news: 'raised' }` fact that `sheetEdit` records at [grant.ts](src/core/hunter/grant.ts#L285).
  2. A `dead` hunter levels up outside a fight: `refill()` leaves `life` as `dead` (refilling mana only), yet `grant.ts:183,185` reports `levelup.refill = true`, showing "HP and mana restored" on a dead hunter.
- **Suggested fix**: Route both refills through `sheetEdit(h, { kind: 'refill' }, R)` and set `refilled = h.life.at !== 'dead'` (or check whether `life`/mana actually refilled).

#### BUG-rules-22: Keyed formula names (`stacks(...)`, `field(...)`, `held(...)`) are case-sensitive despite doc claiming case-insensitivity (Severity: low)
- **Evidence**: [formula.ts](src/core/formula.ts#L164,L179-L181,L330-L331)
- **Repro**: Call `parseFormula('STACKS(bleed) * 2')` or `parseFormula('Target.stacks(bleed)')`. Although the comment at line 164 states "case-insensitive," the `TOKEN` regex lacks the `i` flag on `((?:target\.)?(?:stacks|field|held))`, so uppercase/mixed-case keyed names fail to parse.
- **Suggested fix**: Match `((?:target\.)?(?:stacks|field|held))` case-insensitively and normalize the prefix with `.toLowerCase()`.

#### BUG-rules-23: `harmful()` inspects only tier 0 (`v[0]`) of tiered ops and omits `fatigue`, `delay`, `channel: break`, and `edge(worse)` (Severity: low)
- **Evidence**: [standing.ts](src/core/combat/standing.ts#L201-L207)
- **Repro**: Create a tiered debuff with `{ op: 'stat', key: 'str', amount: [0, -2, -4, -6, -8, -10] }` (0 at E-rank, negative at D+): `harmful()` reads `v[0] === 0`, returns `false`, and lets it bypass `safeguard` and ignore `dispel('harmful')`. Similarly, statuses that only inflict `fatigue > 0`, `delay > 0`, `channel: break`, or `edge(keep: 'worse')` return `harmful() === false`.
- **Suggested fix**: Accept optional `tier` (or check `.some(n => n < 0)` / `.some(n => n > 0)` across all tiers when tier is unknown) and classify positive `fatigue`, positive `delay`, `channel: break`, and `edge(keep: 'worse')` as harmful.

#### BUG-rules-24: `setPoints` lacks `Number.isFinite`/`Math.trunc` guard (Severity: low)
- **Evidence**: [progress.ts](src/core/hunter/progress.ts#L107-L109)
- **Repro**: Call `setPoints(h, NaN, R)` or `setPoints(h, 2.7, R)`. `bonusPoints` becomes `NaN` (or fractional `2.7`), corrupting `available()` and stats.
- **Suggested fix**: Guard with `const target = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : available(p, R);`.

#### BUG-rules-25: `parseDayKey` accepts impossible calendar dates like `9999-99-99`, yielding `NaN` in `dayGap` (Severity: low)
- **Evidence**: [day.ts](src/core/day.ts#L13-L25)
- **Repro**: `parseDayKey('9999-99-99')` passes `/^\d{4}-\d{2}-\d{2}$/` and returns `'9999-99-99' as DayKey`. Passing it to `dayGap('2026-01-01', '9999-99-99')` calls `Date.parse('9999-99-99T00:00:00Z')` -> `NaN`.
- **Suggested fix**: Verify `Number.isFinite(Date.parse(s + 'T00:00:00Z'))` and round-trip the UTC date components (`y, m, d`) inside `parseDayKey()` so `2026-02-31` and `9999-99-99` return `null`.

#### BUG-rules-26: `mergeMonsters` produces `lastAt: undefined` via `.pop()!` when both records have empty `lastAt` (Severity: low)
- **Evidence**: [bestiary.ts](src/core/bestiary.ts#L143)
- **Repro**: Call `mergeMonsters` on two codex records where both `lastAt` are `''`. `[a.lastAt, b.lastAt].filter(Boolean).sort().pop()!` evaluates to `undefined`, violating `CodexEntry.lastAt: string`.
- **Suggested fix**: Replace `.pop()!` with `.pop() ?? ''`.

#### BUG-rules-27: `stackKey` omits `desc`, `attack`, `penFlat`, silently merging distinct slotless items and losing description (Severity: low)
- **Evidence**: [inventory.ts](src/core/hunter/inventory.ts#L22)
- **Repro**: Put two slotless items with the same name/rarity/type/effects but different `desc` (e.g. two distinct quest keys or notes) into a hunter's bag via `putItem()`. They merge into one stack and the second item's `desc` is permanently lost.
- **Suggested fix**: Include `i.desc`, `i.attack ?? ''`, and `i.penFlat ?? 0` in `stackKey()`.

#### BUG-rules-28: `withImportedHunters` does not remap `h.used`, `shadow.monster`, or `jobChain.id` (Severity: low)
- **Evidence**: [imported.ts](src/core/hunter/imported.ts#L26-L44)
- **Repro**: Import a hunter whose `h.used` keys reference old skill IDs (`s1`), whose `jobChain.id` (`jc1`) collides with an existing hunter's `jc1`, or whose `shadow.monster` references a bestiary ID from another campaign. `withImportedHunters()` remaps `skills` to new IDs (`s42`) but leaves `h.used` keyed by `s1`, resetting rest-limited skill uses and leaving `jobChain.id` colliding across hunters.
- **Suggested fix**: Remap `h.used` keys using the skill ID map (`s1 -> s42`), allocate a fresh `jc` ID for `jobChain.id` (and update `q.chainId`), and clear or verify `shadow.monster` against the target save's bestiary.

#### BUG-rules-29: `distinct` feat counter evicts values past `VALS_MAX = 200` while allowing `reach` up to `1e6` (Severity: low)
- **Evidence**: [counts.ts](src/core/hunter/counts.ts#L77-L79), [feats.ts](src/core/hunter/feats.ts#L156,L168)
- **Repro**: A GM creates a `distinct` feat with `reach: 250`. After 200 distinct values, `vals` slices to the last 200 entries; encountering the 1st value again is no longer found in `vals` and increments `n` to 201 (double-counting).
- **Suggested fix**: Cap `reach` for `measure.of === 'distinct'` to `VALS_MAX` (200) in `parseFeat()` ([feats.ts](src/core/hunter/feats.ts#L168)).

#### BUG-rules-30: `chronicle.ts`, `chronicle-view.ts`, and `feats.ts` use non-antisymmetric `<` timestamp comparators (Severity: low)
- **Evidence**: [chronicle.ts](src/core/hunter/chronicle.ts#L113), [chronicle-view.ts](src/core/hunter/chronicle-view.ts#L112,L152), [feats.ts](src/core/hunter/feats.ts#L144)
- **Repro**: Two entries with identical `at`/`on` timestamps (or equivalent timestamps with different UTC offsets, e.g. `+00:00` vs `Z`) compare `a < b ? -1 : 1`, returning `1` for `(a, b)` AND `1` for `(b, a)`, breaking sort stability/order and disagreeing with `day.ts:compareTimes`.
- **Suggested fix**: Use `compareTimes(a, b)` from [day.ts](src/core/day.ts#L60-L62).

---

### (E) All Findings Ordered by Importance

1. **BUG-rules-1** | high | [overrides.ts:162](src/core/overrides.ts#L162) | Unbounded numeric GM overrides cause div-by-zero, `NaN`, level-9999 jump, and `standOdds` OOM | Add explicit numeric `BOUNDS` for every leaf in `parseOverrides` and cap `standOdds` sides.
2. **AW-rules-1** | high | [overrides.ts:162](src/core/overrides.ts#L162) | Only `solo.*` rules have numeric domain bounds at the override boundary | Define a complete typed `BOUNDS` table in `overrides.ts` with test coverage for all `RULES` leaves.
3. **BUG-rules-3** | high | [fight.ts:368-389](src/core/combat/fight.ts#L368-L389) | Channel `release` and `landOne` skip broken-channel charge halving; `release` drops zone prices, shoved immunity, stealth reveal, summons, reactions, and `used` | Unify `act`/`release` via `commitUse()` and replace `broken()` with `interruptChannel()`.
4. **AW-rules-2** | high | [fight.ts:191-247](src/core/combat/fight.ts#L191-L247) | Duplicated ability-resolution pipelines (`act` vs `release`, `resolve.ts` vs `land.ts`) cause systemic rule drift | Extract shared `commitUse()` in `fight.ts` and shared op-landing helpers in `land.ts`.
5. **BUG-rules-2** | high | [fight.ts:213-216](src/core/combat/fight.ts#L213-L216) | Stale pre-reaction `user` passed to `resolve()`, and `before` reactions granting `edge`/`boost` refuse the use with `needsRoll` (throwing in `play.ts`) | Re-read `u` from `before.rows` and include or constrain `before`-reaction dice in `needs()`.
6. **AW-rules-3** | high | [resolve.ts:532-542](src/core/combat/resolve.ts#L532-L542) | Pre-rolled `needs()` contract conflicts with mid-use mutations (`blink` and `before` reactions) | Simulate post-blink `from` in `needs()` and align `before`-reaction dice contract.
7. **BUG-rules-4** | high | [resolve.ts:532-542](src/core/combat/resolve.ts#L532-L542) | `landUse` and `beforeReactions` compute `needs()` from pre-blink `user` instead of post-blink `from`, causing `needsRoll` or auto-caught hits | Pass post-blink `from` to `needs()` and compute post-blink `from` inside `needs()`.
8. **BUG-rules-5** | high | [fight-turn.ts:384-391](src/core/combat/fight-turn.ts#L384-L391) | `startTurn` crashes (`who!` undefined) if `grounded` downs last combatant, and `turnReaction` skips `consequences` (dropping write-backs) | Run `overIf()` after `grounded()` and wrap `turnReaction` in `consequences()`.
9. **BUG-rules-6** | high | [land.ts:168](src/core/combat/land.ts#L168) | `landOps` `move` op runs `crossed()` and emits `statusGained` on the giver instead of receiver when `op.from === 'target'` | Use `holder = op.from === 'user' ? m.target : m.user` for `crossed()` and `gained` attribution.
10. **BUG-rules-7** | high | [derive.ts:162-164](src/core/hunter/derive.ts#L162-L164) | Negative `hpAdj`/perks produce `hpMax <= 0` or `fatigueMax <= 0`, violating `Life` invariants and crashing `fight-doc.ts:band` | Clamp `hpMax >= 1`, `manaMax >= 0`, `fatigueMax >= 0` in `derive()` and `setMaximum()`.
11. **BUG-rules-8** | high | [fight-save.ts:154-155](src/core/combat/fight-save.ts#L154-L155) | `heldCommands` revives a dead hunter's fight row on level-up refill and uses pre-status maxima | Skip HP refill for dead hunters and compute refill deltas after applying statuses.
12. **SM-rules-2** | med | [fight.ts:631-662](src/core/combat/fight.ts#L631-L662) | `Running` fight mixes "awaiting owed dice/releases" with "ready for turn command" and strands `broken` channels on downed rows | Guard turn commands while `owed(f)` is non-empty (or split `Running` sub-phase) and clear `channel` on 0 HP.
13. **SM-rules-5** | med | [effect-ops.ts:286](src/core/combat/effect-ops.ts#L286) | Direct `broken()` mutation bypasses `channelStep` interrupt charge halving | Delete `broken()` and route every channel break through `interruptChannel(b, R)`.
14. **BUG-rules-12** | med | [map-view.ts:541](src/core/combat/map-view.ts#L541) | `taunted`, `aims`, and `aimFocus` ignore `sheet: range` status modifiers and `blinkMax` | Share one `effectiveRange()` helper across `taunted`, `ready`, `aims`, and `aimFocus`.
15. **AW-rules-4** | med | [fight-view.ts:252](src/core/combat/fight-view.ts#L252) | Range legality duplicated across `resolve.ts`, `fight-view.ts`, and `map-view.ts` without status range bonus | Carry `rangeAdd` on `Spot`/`MapBody` and delegate to `effectiveRange()` in `resolve.ts`.
16. **BUG-rules-13** | med | [land.ts:171-179](src/core/combat/land.ts#L171-L179) | `landOps` emits `statusGained` on refused statuses, `landOne` `dispel` misses `cureLands`, `channel: break` bypasses `protect`, `eventsOf` misses `dispel`/`move` | Return `put` and `detonated` from `landOne`, call `channelBreaks()`, and diff statuses in `eventsOf`.
17. **BUG-rules-14** | med | [fight.ts:244-246](src/core/combat/fight.ts#L244-L246) | `afterReactions` misses `tallied`/`triggered` (dropping counterattack kills/damage) and charges a second reactor on a dead attacker | Check `alive(map.get(by)!)` in `afterReactions` and record reaction outcomes in `tallied`/`triggered`.
18. **BUG-rules-15** | med | [resolve.ts:421-422](src/core/combat/resolve.ts#L421-L422) | Multiple die-based `boost` statuses on one body collide by `CombatantId` in `needs()` and `keptFace()` | Key `boost` rolls by `${id}:${key}` instead of `id` alone.
19. **BUG-rules-16** | med | [rulesref.js:136](src/views/rulesref.js#L136) | Rules page reads dead `RULES.dailyRewardPoints` and prints 5× wrong item sell value (`baseValue * mult`) | Remove `dailyRewardPoints` and compute Rules page sell values via `priceOf()`/`sellPrice()`.
20. **AW-rules-5** | med | [rulesref.js:199-200](src/views/rulesref.js#L199-L200) | `rulesref.js` hand-computes rule formulas instead of calling core functions | Move rule-derived table values into `rules-text.ts` using core pricing/reward helpers.
21. **BUG-rules-17** | med | [bestiary.ts:103](src/core/bestiary.ts#L103) | UTF-16 `.length` checks against `DOC_MAX` let non-ASCII docs exceed `server.ts` 64 KiB UTF-8 `MAX_BODY` (HTTP 413) | Measure all room docs with UTF-8 `bytesOf()` from `size.ts`.
22. **AW-rules-6** | med | [protocol.ts:629](src/core/protocol.ts#L629) | Unit mismatch between UTF-16 `DOC_MAX` checks and UTF-8 `MAX_BODY` enforcement | Standardize client doc builders, `protocol.ts`, and `server.ts:486` on `bytesOf()`.
23. **BUG-rules-18** | med | [fight-parse.ts:654](src/core/combat/fight-parse.ts#L654) | `parseFight` caps hunter origin level at 200 while `MAX_LEVEL` is 9999, deleting fights on reload | Replace literal `200` with `MAX_LEVEL` from `progress.ts`.
24. **BUG-rules-9** | med | [inventory.ts:68-71](src/core/hunter/inventory.ts#L68-L71) | `editItem` keeps an edited item worn in its old slot (and/or stacked `qty > 1`) when its slot changes | Unwear `itemId` in `editItem` when the new slot is incompatible or `qty > 1`.
25. **BUG-rules-10** | med | [noticed.ts:75](src/core/hunter/noticed.ts#L75) | `distinct` + `within: 'row'` feats fail to clear `vals` on `'broke'`, poisoning future streaks | Drop `vals` on `'broke'` in `noticed.ts` and `feats.ts`.
26. **BUG-rules-11** | med | [feats.ts:77](src/core/hunter/feats.ts#L77) | `featStep` unlocks `show: { at: 'never' }` feats to `shown`, contradicting `docs/state-machines.md:1644` | Guard `TABLE.hidden.unlocked` on `c.def.show.at === 'feat'`.
27. **SM-rules-1** | med | [feats.ts:73-85](src/core/hunter/feats.ts#L73-L85) | Feat statechart permits `unlocked` on "Hidden until earned" feats, disagreeing with its own prose | Guard `unlocked` in `TABLE.hidden` and regenerate `docs/state-machines.md`.
28. **BUG-rules-19** | med | [effect-ops.ts:539-545](src/core/combat/effect-ops.ts#L539-L545) | `settle()` moves a stacking status with `leave: 'round'` and `end` to `spent` on its final round, suppressing delayed `end` detonation | Check time expiry (`until <= now`) before `leave: 'round'` decay in `settle()`.
29. **SM-rules-6** | med | [standing.ts:174-194](src/core/combat/standing.ts#L174-L194) | `standing.ts` reads `b.statuses` without expiry checks and `settle` mixes `spent` vs `expired` lifecycles | Fix expiry precedence in `settle()` and enforce `live(b, now)` or non-expired status invariant.
30. **BUG-rules-20** | med | [grant.ts:301-302](src/core/hunter/grant.ts#L301-L302) | `sheetEdit` `put`/`drop` skips `fitted()`, leaving HP/mana/fatigue above lowered maxima | Wrap `putCondition` and `dropCondition` in `fitted(..., R)`.
31. **BUG-rules-21** | med | [grant.ts:183](src/core/hunter/grant.ts#L183) | `grant` and `finishQuest` bypass `sheetEdit` on `refill`, dropping `life: raised` facts and reporting `refill: true` on dead hunters | Route refills through `sheetEdit(..., { kind: 'refill' }, R)` and gate `refilled` on `life.at !== 'dead'`.
32. **AW-rules-7** | med | [build.ts:55-60](src/core/hunter/build.ts#L55-L60) | Inconsistent boundary authority and write-back across hunter core modules (`choosePath`, `editQuest`, `stepShadow`, `grant`) | Enforce role/inFight checks and Chronicle recording inside core functions consistently.
33. **SM-rules-3** | med | [effect-ops.ts:291-321](src/core/combat/effect-ops.ts#L291-L321) | Flat `Body` record with 15+ optional fields allows cross-kind illegal states (e.g. ownerless summon, hunter with extraction) | Refactor `Body` into a discriminated union by `kind` and validate arms in `fight-parse.ts`.
34. **SM-rules-4** | med | [noticed.ts:7-14](src/core/hunter/noticed.ts#L7-L14) | Untyped Chronicle inbox holds unstamped facts during fights and stamps them at drain time (wrong day/session/rest window) | Stamp facts at `record()` time and model inbox drain state explicitly.
35. **AW-rules-8** | med | [map-view.ts:1-773](src/core/combat/map-view.ts#L1-L773) | God-file coupling in `map-view.ts` (773L), `fight.ts` (699L), `fight-parse.ts` (828L), `resolve.ts` (652L), `formula.ts` (652L) | Split `map-choice.ts`/`hotbar.ts` from `map-view.ts` and move reaction/summon helpers out of `fight.ts`.
36. **BUG-rules-22** | low | [formula.ts:179-181](src/core/formula.ts#L179-L181) | Keyed formula names (`stacks`, `field`, `held`) are case-sensitive despite doc claiming case-insensitivity | Match keyed prefixes case-insensitively and lowercase the matched key kind.
37. **BUG-rules-23** | low | [standing.ts:201-207](src/core/combat/standing.ts#L201-L207) | `harmful()` checks only tier 0 (`v[0]`) and omits positive `fatigue`, `delay`, `channel: break`, and `edge(worse)` | Evaluate all tiers (or source tier) and include `fatigue > 0`, `delay > 0`, `channel: break`, `edge(worse)`.
38. **BUG-rules-24** | low | [progress.ts:107-109](src/core/hunter/progress.ts#L107-L109) | `setPoints` lacks `Number.isFinite`/`Math.trunc` guard, letting `NaN` corrupt `bonusPoints` | Validate `Number.isFinite(n)` and truncate before computing `bonusPoints`.
39. **BUG-rules-25** | low | [day.ts:13](src/core/day.ts#L13) | `parseDayKey` accepts impossible dates like `9999-99-99`, causing `dayGap` to return `NaN` | Validate parsed UTC year/month/day round-trip inside `parseDayKey()`.
40. **BUG-rules-26** | low | [bestiary.ts:143](src/core/bestiary.ts#L143) | `mergeMonsters` returns `lastAt: undefined` via `.pop()!` when both `lastAt` values are empty | Replace `.pop()!` with `.pop() ?? ''`.
41. **BUG-rules-27** | low | [inventory.ts:22](src/core/hunter/inventory.ts#L22) | `stackKey` omits `desc`, `attack`, `penFlat`, silently merging distinct slotless items and dropping descriptions | Add `desc`, `attack`, and `penFlat` to `stackKey()`.
42. **BUG-rules-28** | low | [imported.ts:26-44](src/core/hunter/imported.ts#L26-L44) | `withImportedHunters` does not remap `h.used`, `shadow.monster`, or `jobChain.id` | Remap `h.used` via skill map, allocate fresh `jobChain.id`, and reconcile `shadow.monster`.
43. **BUG-rules-29** | low | [counts.ts:77](src/core/hunter/counts.ts#L77) | `distinct` feat counter evicts values past `VALS_MAX = 200` while allowing `reach` up to `1e6` | Cap `distinct` feat `reach` at `VALS_MAX` (200) in `parseFeat()`.
44. **BUG-rules-30** | low | [chronicle.ts:113](src/core/hunter/chronicle.ts#L113) | `chronicle.ts`, `chronicle-view.ts`, and `feats.ts` use non-antisymmetric `<` timestamp comparators | Replace raw string `<` comparators with `compareTimes()` from `day.ts`.
45. **AW-rules-9** | low | [day.ts:60-62](src/core/day.ts#L60-L62) | Multiple hunter modules bypass canonical `compareTimes()` in `day.ts` | Standardize timestamp sorting on `compareTimes()` and add a lint rule if needed.
46. **AW-rules-10** | low | [sheet.ts:191-196](src/core/hunter/sheet.ts#L191-L196) | `derive.ts` and `sheet.ts` do not enforce `hpMax >= 1` and non-negative `manaMax`/`fatigueMax` | Clamp maxima in `derive.ts` and `sheet.ts:setMaximum`.
47. **AW-rules-11** | low | [rewards.ts:127-129](src/core/rewards.ts#L127-L129) | Unbranded `string` ID in `saveBundle()`, hardcoded `200` level cap in `fight-parse.ts`, incomplete ID remapping in `imported.ts` | Brand `BundleId`, share `MAX_LEVEL`, and complete `imported.ts` remapping.
48. **SM-rules-7** | low | [record.ts:26-38](src/core/hunter/record.ts#L26-L38) | Rank promotion vs level demotion has no explicit eligibility/mismatch state | Add `rankStanding(h, R)` helper to make ready/above-level states explicit.

---

### (C) Top 10 to Fix First, and What Is Already Good and Must Be Protected

#### Top 10 to Fix First
1. **BUG-rules-1 / AW-rules-1** ([overrides.ts:162](src/core/overrides.ts#L162)): Add numeric bounds to every `RULES` leaf so a single bad GM override cannot crash, OOM, or `NaN`-corrupt the entire campaign.
2. **BUG-rules-3 / AW-rules-2 / SM-rules-5** ([fight.ts:368-389](src/core/combat/fight.ts#L368-L389), [land.ts:265,276](src/core/combat/land.ts#L265)): Unify `act`/`release` via `commitUse()` and route all channel breaks through `interruptChannel()`.
3. **BUG-rules-2 / AW-rules-3** ([fight.ts:213-216](src/core/combat/fight.ts#L213-L216)): Fix stale `user` after `beforeReactions` and reconcile `before`-reaction `edge`/`boost` with `needs()`.
4. **BUG-rules-4** ([resolve.ts:532-542](src/core/combat/resolve.ts#L532-L542)): Compute `needs()` from post-blink `from` so blink abilities never falsely refuse or auto-hit without a dodge roll.
5. **BUG-rules-5** ([fight-turn.ts:384-391](src/core/combat/fight-turn.ts#L384-L391)): Add `overIf()` after `grounded()` (fixes crash) and `consequences()` on `turnReaction` (fixes dropped write-backs).
6. **BUG-rules-6** ([land.ts:168](src/core/combat/land.ts#L168)): Fix `op.from === 'target'` holder attribution in `landOps` so stolen stacks trigger thresholds and `statusGained` on the receiver.
7. **BUG-rules-7 / AW-rules-10** ([derive.ts:162-164](src/core/hunter/derive.ts#L162-L164)): Clamp `hpMax >= 1` and `manaMax`/`fatigueMax >= 0` to eliminate `band()` crashes and illegal "up at 0 HP" states.
8. **BUG-rules-8** ([fight-save.ts:154-155](src/core/combat/fight-save.ts#L154-L155)): Prevent `heldCommands` from reviving dead hunters on level-up refill or miscomputing refill deltas before statuses apply.
9. **BUG-rules-12 / AW-rules-4** ([map-view.ts:541](src/core/combat/map-view.ts#L541), [resolve.ts:100](src/core/combat/resolve.ts#L100)): Unify `effectiveRange()` (`rangeFor` + `blinkMax`) across `taunted`, `ready`, `aims`, and `aimFocus`.
10. **BUG-rules-13 + BUG-rules-14 + BUG-rules-15** ([land.ts:171-179](src/core/combat/land.ts#L171-L179), [fight.ts:244-246](src/core/combat/fight.ts#L244-L246), [resolve.ts:421-422](src/core/combat/resolve.ts#L421-L422)): Fix `landOps` status events/`dispel`/`channel: protect`, `afterReactions` tally/alive check, and `boost` roll key collisions.

#### What Is Already Good and Must Be Protected
- **Pure core architecture with zero IO or randomness** (`src/core/`): Every combat and hunter module takes `Rules`, timestamps, IDs, and dice explicitly as arguments (e.g. [fight.ts](src/core/combat/fight.ts#L677), [play.ts](src/core/combat/play.ts#L1-L6), [draws.ts](src/core/draws.ts)), enforced by `tests/lint.test.ts`. Protect this strictly.
- **Exhaustive table-driven state machines with compile-time coverage** across [fight.ts](src/core/combat/fight.ts#L620-L641), [vitals.ts](src/core/hunter/vitals.ts#L76-L103), [penalty.ts](src/core/hunter/penalty.ts), [job-chain.ts](src/core/hunter/job-chain.ts), [extraction.ts](src/core/combat/extraction.ts), [stacks.ts](src/core/combat/stacks.ts), [delayed.ts](src/core/combat/delayed.ts), [uses.ts](src/core/combat/uses.ts), [summons.ts](src/core/combat/summons.ts), [fight-react.ts](src/core/combat/fight-react.ts#L41-L48), [gesture.ts](src/core/combat/gesture.ts#L176-L247), [odds.ts](src/core/combat/odds.ts#L122-L127), and [coin.ts](src/core/coin.ts), plus automated chart generation into [docs/state-machines.md](docs/state-machines.md).
- **Refusal word exhaustiveness** in [refusal-words.ts](src/core/combat/refusal-words.ts#L10-L31): keying both `REFUSAL_WORDS` and `TABLE_REFUSAL_WORDS` by their union types guarantees no bare refusal key leaks to the UI.
- **Idempotent write-back and fog/stealth secrecy boundary**: [fight-save.ts](src/core/combat/fight-save.ts) commits fight state, local hunter vitals, remote outbox totals, and gate status atomically in one `store.apply`, and [fight-doc.ts](src/core/combat/fight-doc.ts) strips hidden foes, unrevealed monster intent numbers, and lines referencing hidden rows/zones before data leaves the GM's phone.
- **Deterministic odds and solo simulation loop**: [play.ts](src/core/combat/play.ts) and [odds.ts](src/core/combat/odds.ts) run directly on the real `reduce()` with `seededSource()`, ensuring balance/odds predictions never drift into a separate shadow engine.
- **Exact Roll20 dice parser and probability engine**: [formula.ts](src/core/formula.ts) bounds expression size (`FORMULA_PARTS`), guards recursion depth, and computes closed-form / exact `mean()` for `kh`/`kl`/`dh`/`dl`/reroll/explode/successes.

---

### Coverage

#### Read Fully
- **pstack skills (12/12)**: `.claude/skills/{poteto-mode,architect,statechart,principle-model-the-domain,principle-foundational-thinking,principle-type-system-discipline,principle-boundary-discipline,principle-separate-before-serializing-shared-state,principle-make-operations-idempotent,blast-radius,principle-minimize-reader-load,typescript-best-practices}/SKILL.md`
- **Architecture & docs**: [README.md](README.md), [AGENTS.md](AGENTS.md), [docs/state-machines.md](docs/state-machines.md), all 9 files in `docs/guide/` (`combat.md`, `hunters.md`, `machines.md`, `room-sync.md`, `gates-solo.md`, `feats-stories.md`, `makers.md`, `save-store.md`, `tests-ci.md`), [docs/GAME-UPDATE.md](docs/GAME-UPDATE.md), [docs/agent-handoff/START-HERE.md](docs/agent-handoff/START-HERE.md), [docs/agent-handoff/handoff.md](docs/agent-handoff/handoff.md), [docs/agent-handoff/landed.md](docs/agent-handoff/landed.md), [docs/agent-handoff/review.md](docs/agent-handoff/review.md), [docs/agent-handoff/design-frameworks-review.md](docs/agent-handoff/design-frameworks-review.md)
- **Top-level `src/core/` in lane (19/19)**: `rules.ts`, `rules-text.ts`, `stats.ts`, `formula.ts`, `roll.ts`, `effects.ts`, `award.ts`, `rewards.ts`, `coin.ts`, `upgrade.ts`, `applied.ts`, `day.ts`, `bestiary.ts`, `starter.ts`, `draws.ts`, `one-of.ts`, `overrides.ts`, `detail.ts`, `size.ts`
- **`src/core/hunter/` in lane (26/26)**: `build.ts`, `chips.ts`, `chronicle-view.ts`, `chronicle.ts`, `conditions.ts`, `counts.ts`, `derive.ts`, `facts.ts`, `feats.ts`, `grant.ts`, `identity.ts`, `imported.ts`, `inventory.ts`, `job-chain.ts`, `loadouts.ts`, `noticed.ts`, `penalty.ts`, `progress.ts`, `quest-rights.ts`, `quests.ts`, `record.ts`, `shadows.ts`, `sheet.ts`, `skills-held.ts`, `use.ts`, `vitals.ts`
- **`src/core/combat/` in lane (33/33)**: `ability-types.ts`, `delayed.ts`, `effect-ops.ts`, `extraction.ts`, `fight-channel.ts`, `fight-doc.ts`, `fight-facts.ts`, `fight-parse.ts`, `fight-react.ts`, `fight-save.ts`, `fight-turn.ts`, `fight-types.ts`, `fight-view.ts`, `fight.ts`, `gesture.ts`, `land.ts`, `map-view.ts`, `odds.ts`, `play.ts`, `policy.ts`, `refusal-words.ts`, `resolve.ts`, `row-tally.ts`, `rows.ts`, `space.ts`, `stacks.ts`, `standing.ts`, `summons.ts`, `table-news.ts`, `timeline.ts`, `triggers.ts`, `uses.ts`, `zones.ts`
- **Cross-module verifications read fully**: [src/views/rulesref.js](src/views/rulesref.js), [src/views/shadows.js](src/views/shadows.js), [src/core/registry/items.ts](src/core/registry/items.ts), [src/core/protocol.ts](src/core/protocol.ts)

#### Skimmed / Targeted Reads
- [docs/dependency-map.md](docs/dependency-map.md) (lines 1–250), [docs/agent-handoff/decisions.tsv](docs/agent-handoff/decisions.tsv) (lines 1–134, 330–388), [docs/agent-handoff/for-the-owner.md](docs/agent-handoff/for-the-owner.md) (lines 1–300)
- [src/core/save.ts](src/core/save.ts) (lines 1–650)
- [server.ts](server.ts) (targeted `rg` checks on `MAX_BODY`, `DOC_MAX`, and `SHEET_MAX`)

#### Not Read (Outside This Deep-Read Lane)
- `src/core/gates/`, `src/core/sync/`, `src/core/trade/`, `src/core/story/`, `src/core/registry/` (except `items.ts`), `src/core/{api,events,ids,role,save-step}.ts`
- `src/edge/`, `src/views/` (except `rulesref.js` and `shadows.js`), `src/app.js`, `src/sw.js`
- `scripts/`, `types/`, `public/`, `tests/`


---

# Neon lane report: sync (verbatim)

## Goal and Audit Scope

You asked for a read-only architecture, state-machine, and bug audit of `systemgaming` at commit `a11b6a5d`, focused on the `sync` lane covering room synchronization, network IO, persistence, and app boot (`server.ts`, `src/core/sync/`, `src/core/room-server.ts`, `src/core/protocol.ts`, `src/core/api.ts`, `src/core/save.ts`, `src/core/save-step.ts`, `src/core/store-life.ts`, `src/core/session-log.ts`, `src/core/events.ts`, `src/core/ids.ts`, `src/core/party.ts`, `src/core/role.ts`, `src/core/settings.ts`, `src/core/use-told.ts`, `src/core/trade/`, `src/edge/`, `src/app.js`, and `src/sw.js`). Every claim below is grounded in `file:line` evidence and evaluated against `docs/guide/room-sync.md`, `docs/guide/save-store.md`, `docs/guide/machines.md`, and `docs/state-machines.md`.

The review applies the pstack principles read in Step 1: `statechart`, `principle-model-the-domain`, `principle-foundational-thinking`, `principle-type-system-discipline`, `principle-boundary-discipline`, `principle-separate-before-serializing-shared-state`, `principle-make-operations-idempotent`, `blast-radius`, `principle-minimize-reader-load`, `typescript-best-practices`, `architect`, and `poteto-mode`. Already-modeled machines listed in [docs/state-machines.md](docs/state-machines.md) (`Link`, `Push`, `Outbox`, `StoreLife`, `Db`, `Update`, `Offer`) are not re-reported as implicit unless the implementation diverges from the documented chart or keeps extra unmodeled state beside it.

---

## (A) Implicit State Machines

### SM-sync-1: Server database lifecycle keeps `closed` and `retry` flags outside `Db<S>`
- **Evidence**: [server.ts](server.ts#L295-L320), [src/core/room-server.ts](src/core/room-server.ts#L48-L77), [docs/state-machines.md](docs/state-machines.md#L1217-L1249)
- **States and transitions as implemented**: `src/core/room-server.ts` models `Db<S>` as `opening | ready | down`. Beside `db`, [server.ts](server.ts#L296) stores two separate mutable flags, `let retry: ReturnType<typeof setTimeout> | null = null` and `let closed = false`. Calling `close()` ([server.ts](server.ts#L316-L320)) sets `closed = true`, clears `retry`, and closes the SQL pool, while leaving `db` stuck in `opening`, `ready`, or `down`.
- **Illegal states representable**: `closed === true && db.at === 'ready'` is representable. Calling `now()` after `close()` still returns `{ at: 'ready', store }` pointing to a closed Postgres pool. Similarly, `db.at === 'down' && retry === null` while `closed === false` is representable if scheduling fails.
- **Bugs and race risks**: Requests arriving during shutdown read `db.at === 'ready'` and issue queries against a closed pool, throwing `500` instead of cleanly refusing. If `connect()` resolves after `close()`, line 306 checks `closed` and closes `s`, which is a manual guard compensating for the missing terminal state.
- **Proposed explicit model**: Add `{ readonly at: 'closed' }` and `{ readonly type: 'close' }` to `Db<S>` and `DbEvent<S>` in [src/core/room-server.ts](src/core/room-server.ts#L48-L77), emitting `{ type: 'closePool', store }` and `{ type: 'clearRetry' }` effects. That removes the `closed` boolean in `server.ts` (`statechart`, `principle-model-the-domain`).
- **Blast radius**: Low. Only `src/core/room-server.ts`, `server.ts`, `tests/room-server.test.ts`, and `docs/state-machines.md`.

### SM-sync-2: Create/Join tap lifecycle (`attempt`) in `src/edge/sync.ts`
- **Evidence**: [src/edge/sync.ts](src/edge/sync.ts#L129-L132), [src/edge/sync.ts](src/edge/sync.ts#L215), [src/edge/sync.ts](src/edge/sync.ts#L420-L423), [src/edge/sync.ts](src/edge/sync.ts#L556-L581)
- **States and transitions as implemented**: A nullable `attempt: Attempt | null` object tracks the UI tap promise alongside `Link`. It implicitly moves through four phases via nullable fields: `idle` (`attempt === null`) -> `inFlight` (`attempt !== null, made === null, notice === null`) -> `hunterCreated` (`made !== null`, mutated at line 572 during `joining/head`) -> `notified` (`attempt.notice` mutated at lines 420-423) -> `settled` (`attempt = null`, resolve or reject at lines 576-580).
- **Illegal states representable**: `attempt !== null` while `link.at` is neither `creating` nor `joining` (only avoided if `settleAttempt()` runs after every `linkDo`). `attempt.made !== null` when `attempt.kind === 'create'` or `link.key !== null`. Two notices overwriting `attempt.notice` silently. `attempt.made === null` when `attempt.name !== ''` and `addHunter` failed in a read-only tab.
- **Bugs and race risks**: Directly causes `BUG-sync-12` (silently binding an existing hunter when `addHunter` fails, and leaving an orphaned hunter when `setActive(prevActive)` fails during undo). Also causes `joinRoom` ([src/edge/sync.ts](src/edge/sync.ts#L591)) to clear `invited` separately from `spendInvite` ([src/edge/sync.ts](src/edge/sync.ts#L234)).
- **Proposed explicit model**: Replace `Attempt` with a discriminated union keyed on `gen`: `{ at: 'idle' } | { at: 'creating'; gen; deferred } | { at: 'joining-existing'; gen; hunterId; deferred; notice } | { at: 'joining-named'; gen; name; phase: 'peeking' | { at: 'created'; made: HunterId; prevActive: HunterId }; deferred; notice }`, driven by one pure transition function called from `drain()`.
- **Blast radius**: Low. Confined to `src/edge/sync.ts` and a new unit test for tap settlement.

### SM-sync-3: GM doc publisher lifecycle in `src/edge/sync.ts`
- **Evidence**: [src/edge/sync.ts](src/edge/sync.ts#L744-L795)
- **States and transitions as implemented**: Three parallel maps (`publishers`, `publishTimers`, `tooBig`) manage each `PublishedDoc` (`fight`, `solo`, `rules`, `world`, `feats`, `story`). Implicit states per doc are `idle` -> `debouncing` (`publishTimers.has(name)`) -> `putting` (untracked in-flight `await putDoc(...)`) -> `retryingShort` (second `await putDoc(name, short)`) -> `stored` or `tooBig` (`tooBig.get(name) === gen`) or `failed`.
- **Illegal states representable**: Because `putting` is not represented, `publishTimers.has(name)` can be true while a previous `putDoc(name)` is still in flight, allowing two overlapping `PUT /sheets/_<name>` calls for the same doc. Also `tooBig` retains entries for dead `Gen` values until the next `stored`.
- **Bugs and race risks**: Directly causes `BUG-sync-8` (concurrent `putDoc` requests finishing out of order, overwriting newer server state and newer local `shown.docs[name]`).
- **Proposed explicit model**: Introduce a small core reducer `src/core/sync/publish.ts` per `PublishedDoc` (`idle | waiting | sending | sending-dirty | too-big`), mirroring `src/core/sync/push.ts`, with a monotonic `seq` or `dirty` flag so at most one `PUT` per doc is in flight at a time (`statechart`, `principle-make-operations-idempotent`).
- **Blast radius**: Low. `src/edge/sync.ts` and a new pure core module plus unit test.

### SM-sync-4: View/panel lifecycle and render batching in `src/app.js`
- **Evidence**: [src/app.js](src/app.js#L114-L166), [src/app.js](src/app.js#L270-L280)
- **States and transitions as implemented**: Each view and panel holds an untyped `part` object with a raw string `state: 'new' | 'live' | 'failed'` mutated in place at lines 124, 127, 134, 146, and 154, alongside module flags `current`, `navSig`, `hdrSig`, `ruled`, and `pending`. Transitions are scattered across `asked()`, `mountPart()`, `updatePart()`, and `render()`.
- **Illegal states representable**: `part.state === 'live'` while `mount()` never ran cleanly (line 124 sets `part.state = 'live'` before `def.mount` runs, then catches and flips it to `'failed'`). A view or panel whose `when()` already threw is still mounted because `avail(v)` checks `!== 'no'` (line 166), treating `'failed'` as available, then runs `mountPart` before `updatePart` calls `asked()` a second time.
- **Bugs and race risks**: Directly causes `BUG-sync-16` (calling `mount()` on a view or panel whose `when()` predicate already threw).
- **Proposed explicit model**: Type `PartState` as `'new' | 'live' | 'failed'`, evaluate `when()` once per render pass, and transition `new -> failed` directly when `when()` throws instead of mounting first.
- **Blast radius**: Low. Confined to `src/app.js` and `tests/views.test.ts`.

### SM-sync-5: `StoreLife` `readOnly` mode disagrees with `docs/state-machines.md` and `src/edge/store.ts` comments
- **Evidence**: [docs/state-machines.md](docs/state-machines.md#L1382), [src/edge/store.ts](src/edge/store.ts#L265-L268), [src/edge/store.ts](src/edge/store.ts#L284-L286), [src/edge/sync.ts](src/edge/sync.ts#L393), [src/edge/sync.ts](src/edge/sync.ts#L408), [src/edge/sync.ts](src/edge/sync.ts#L465-L472), [src/edge/sync.ts](src/edge/sync.ts#L550), [src/edge/sync.ts](src/edge/sync.ts#L626)
- **States and transitions as implemented**: [docs/state-machines.md](docs/state-machines.md#L1382) states that in `readOnly` ("Refuses every change"), "the room link's own bookkeeping ... still change memory and are dropped at the reload", and [src/edge/store.ts](src/edge/store.ts#L266-L267) repeats this claim. In reality, `src/edge/sync.ts` no longer calls `store.update`; every sync persistence path (`heard`, `save`, `landPage`, `bindJoin`, `boxDo`) calls `store.apply`, which immediately returns `refuse('read-only')` at [src/edge/store.ts](src/edge/store.ts#L285). Meanwhile `Link` in memory has no awareness of `StoreLife` and still transitions to `live`, advances `link.cursor`, and emits `sync:outbox` `{ at: 'sent' }`.
- **Illegal states representable**: `life.at === 'readOnly'` while `link.at === 'live'` with `link.cursor > save.settings.sync.cursor` and polled events silently discarded.
- **Bugs and race risks**: Directly causes `BUG-sync-7` (dropped GM events and lost notifications in read-only tabs while `link.cursor` moves forward) and misreported `'noRoom'` errors in `postLetter` ([src/edge/sync.ts](src/edge/sync.ts#L634)).
- **Proposed explicit model**: Either make `StoreLife` `readOnly` stop `Link` from writing/advancing cursors (a `readOnly` event into `Link` that pauses polling or keeps `link.cursor` pinned), or provide a dedicated `store.applyBookkeeping` path that matches [docs/state-machines.md](docs/state-machines.md#L1382) explicitly and is checked by `tests/lint.test.ts`.
- **Blast radius**: Medium. Touches `src/edge/store.ts`, `src/edge/sync.ts`, `docs/state-machines.md`, and `tests/store-life.test.ts`.

### SM-sync-6: Recursive `showRemoved` modal retry loop in `src/edge/sync.ts`
- **Evidence**: [src/edge/sync.ts](src/edge/sync.ts#L602-L616)
- **States and transitions as implemented**: On `notice('removed', code)`, `showRemoved(code, h)` opens a blocking System dialog. Clicking "Rejoin when the GM allows" calls `begin(joining(code, null), ...)`. Any error in the `catch` block shows a toast and recursively calls `showRemoved(code, h)`. There is no link generation guard or cancellation when the campaign is replaced, the room is deleted (`notfound`), or the player joins another room.
- **Illegal states representable**: `showRemoved` modal open for old room `code` after `replace()` swapped the campaign or after the room returned `404 notfound`.
- **Bugs and race risks**: If the room was deleted or the campaign was replaced while the dialog was open, clicking Rejoin shows the wrong error ("Could not reach the server") and reopens the modal indefinitely until the user clicks OK.
- **Proposed explicit model**: Handle `notFound` and `replaced` as terminal exits from the retry dialog (do not recurse), and drop the dialog callback if `link.at === 'live'` or the save's campaign changed.
- **Blast radius**: Low. Confined to `src/edge/sync.ts`.

---

## (B) Architectural Weaknesses

### AW-sync-1 (high): Phone-scoped sync state is mixed into portable campaign saves
- **Evidence**: [src/core/save.ts](src/core/save.ts#L187-L206), [src/core/save.ts](src/core/save.ts#L715-L735), [src/edge/store.ts](src/edge/store.ts#L245)
- **Problem**: Violates `principle-separate-before-serializing-shared-state`. `Save.settings.sync` mixes portable campaign context with phone-local session/protocol state (`deviceId`, `deviceToken`, `gmKey`, `gmKeys`, `outbox`, `held`, `applied`, `seen`, `runs`, `offers`, `joinedAt`, `cursor`, `boundHunterId`). Export and import must strip and restore fields piecemeal (`exportedSave`, `keepPhone`, `keepGmKey`), and currently miss seven phone-local fields (`BUG-sync-3`).
- **Concrete fix sequence**:
  1. Define a dedicated type `PhoneSyncFields` listing every phone-local key (`outbox`, `held`, `applied`, `seen`, `runs`, `offers`, `joinedAt`, `cursor`, `boundHunterId`, `deviceToken`, `gmKey`, `gmKeys`).
  2. Update `exportedSave` and `keepPhone` to strip/reset every `PhoneSyncFields` key by construction, and make `keepGmKey` merge `mine.gmKeys` without wiping unrelated room keys.
  3. Add unit tests in `tests/save.test.ts` verifying round-trip export/import between two phones with pending outbox, offers, seen cursors, and keyring entries.

### AW-sync-2 (high): `server.ts` `PUT /sheets/:key` loads and re-parses the entire room board on every player push
- **Evidence**: [server.ts](server.ts#L251-L267), [server.ts](server.ts#L480-L493)
- **Problem**: Violates `architect` scaling boundaries. Every 3-second player sheet push calls `st.board(code)` ([server.ts](server.ts#L487)), which fetches every sheet and doc row for the room from Postgres and runs `parseSheet` and `DOCS[name]` on up to 24 hunter sheets and all 7 docs (including 62 KB fight and solo docs) solely to read `_kicked` and check `Object.keys(board.sheets).length >= ROOM_SHEETS`.
- **Concrete fix sequence**:
  1. Extend `Store` in `server.ts` with narrow queries `getKicked(code)` and an atomic `putSheetIfAllowed(code, key, from, data, maxSheets)` method.
  2. Implement `putSheetIfAllowed` inside a single Postgres transaction locking the room row (`FOR UPDATE`, matching `addEvent` at [server.ts](server.ts#L219-L234)), which simultaneously eliminates the `ROOM_SHEETS` race (`BUG-sync-6`).
  3. Add concurrent `PUT /sheets/:key` capacity tests in `tests/server-rooms.test.ts`.

### AW-sync-3 (high): `rules()` serializes overrides, custom statuses, and room rules with `JSON.stringify` on every call
- **Evidence**: [src/edge/rules.ts](src/edge/rules.ts#L32-L38)
- **Problem**: `rules()` is called across renders, combat, sheets, store, and makers. Its memoization key calls `JSON.stringify([s.rulesOverrides, s.library.statuses, room])` on every invocation. With up to 200 custom statuses (up to 5 KB each), every call allocates and serializes tens to hundreds of kilobytes of JSON on mobile phones.
- **Concrete fix sequence**:
  1. Replace the `JSON.stringify` cache key with a monotonic revision counter incremented in `store.ts` (`store.update` / `replace`) and `bindRoom` (or reference identity checks on `s.rulesOverrides`, `s.library.statuses`, and `room`, since `writeInto` replaces non-`id` records and mutates arrays only inside `store.update`).
  2. Re-run `tests/rules.test.ts` and `tests/e2e/feel.e2e.ts` to verify cache invalidation and frame timings.

### AW-sync-4 (high): `src/edge/sync.ts` is a 944-line god module with mixed responsibilities and dead code
- **Evidence**: [src/edge/sync.ts](src/edge/sync.ts#L1-L944), [src/edge/sync.ts](src/edge/sync.ts#L109), [src/edge/sync.ts](src/edge/sync.ts#L141), [src/edge/sync.ts](src/edge/sync.ts#L877)
- **Problem**: Violates `principle-minimize-reader-load` and `principle-boundary-discipline`. One closure manages HTTP transport, timeouts, abort tracking, `Link` and `Push` runners, outbox delivery, doc publishing, tap promises, `ui.system` / `ui.toast` dialogs, `app.go('room')`, URL `history.replaceState`, and invite parsing. It also carries three unused helpers (`httpError` at line 109, `esc` at line 141, `nInt` at line 877).
- **Concrete fix sequence**:
  1. Remove the unused helpers (`httpError`, `esc`, `nInt`).
  2. Extract HTTP transport + timeout/abort tracking (`fetchApi`, `call`, `failKind`, `track`) into `src/edge/room-http.ts`.
  3. Extract doc publishing (`putDoc`, `publishNow`, `republish`, `tooBig`) into `src/edge/room-publish.ts` backed by a pure core reducer (`SM-sync-3`).
  4. Extract UI prompts (`showRemoved`, `notOwner`, `switchTo` confirmation) behind injected callbacks so `sync.ts` no longer touches DOM/UI modals directly.

### AW-sync-5 (med): Layer inversion where `src/edge/` imports `src/views/app.ts`
- **Evidence**: [src/edge/sync.ts](src/edge/sync.ts#L38), [src/edge/room-pill.ts](src/edge/room-pill.ts#L5), [docs/dependency-map.md](docs/dependency-map.md#L14)
- **Problem**: Violates strict dependency direction (`core <- edge <- views`). `docs/dependency-map.md` already flags `edge/sync.ts` and `edge/room-pill.ts` as the only layer violations in the codebase because the `App` type lives in `src/views/app.ts`.
- **Concrete fix sequence**:
  1. Define narrow `SyncHost` and `PillHost` interfaces (emitting events, reading APIs, showing toasts/dialogs) in `src/edge/host.ts` without importing `src/views/`.
  2. Have `App` in `src/views/app.ts` extend those interfaces and update `sync.ts` and `room-pill.ts` to import from `src/edge/host.ts`.
  3. Add a lint check in `tests/lint.test.ts` forbidding `src/edge/` imports from `src/views/`.

### AW-sync-6 (med): Duplicated and inconsistent validation across boundaries
- **Evidence**: [src/core/ids.ts](src/core/ids.ts#L108-L110), [src/core/ids.ts](src/core/ids.ts#L132-L136), [src/edge/sync.ts](src/edge/sync.ts#L798), [src/edge/sync.ts](src/edge/sync.ts#L807), [src/edge/sync.ts](src/edge/sync.ts#L828), [src/core/protocol.ts](src/core/protocol.ts#L823), [src/core/protocol.ts](src/core/protocol.ts#L877), [src/core/protocol.ts](src/core/protocol.ts#L912)
- **Problem**: Violates `principle-boundary-discipline` and `principle-type-system-discipline`. `sync.ts` re-implements sheet key and device ID regexes instead of calling `parseSheetKey` and `deviceOf` from `src/core/ids.ts`. `ids.ts` `parseSaveId<K>` ignores the prefix type parameter `K` at runtime. `protocol.ts` casts `a as AbilityId` and `id(...) as GateId` instead of calling `abilityId` and `parseGateId`.
- **Concrete fix sequence**:
  1. Change `parseSaveId` to take an explicit prefix argument `parseSaveId(v, prefix)` (or expose per-kind parsers `parseHunterId`, `parseItemId`, etc.) that verifies the prefix at runtime.
  2. Replace the ad-hoc regexes in `sync.ts:798, 807, 828` with `parseSheetKey(key)` and `deviceOf(parsed)`.
  3. Replace the `as AbilityId` and `as GateId` casts in `protocol.ts:823, 877` with `abilityId(a)` and `parseGateId(...)`.

### AW-sync-7 (med): Full-tree `writeInto` plus full `repairSave` runs on every `store.apply`, and `save.ts` retains unknown keys
- **Evidence**: [src/edge/store.ts](src/edge/store.ts#L269-L295), [src/core/save.ts](src/core/save.ts#L307-L313), [src/core/save.ts](src/core/save.ts#L613-L678)
- **Problem**: Every single mutation (even bumping `sync.cursor` or changing HP by 1) runs `writeInto` across the whole save tree and then runs the 839-line `repairSave` across all hunters, library entries, gates, monsters, logs, rolls, coins, outbox, offers, and seen cursors. Meanwhile `fill()` ([src/core/save.ts](src/core/save.ts#L307-L313)) keeps all unknown properties on loaded saves to accommodate legacy untyped views, allowing malformed keys to survive silently.
- **Concrete fix sequence**:
  1. Benchmark `repairSave` on a max-sized save; separate structural load-time migration/repair (`parseSave`) from lightweight post-step invariant checks in `store.apply` (or keep full repair in test/dev assertions).
  2. Audit remaining view-stashed fields and tighten `fill()` on strict sub-records (such as `settings.sync`) to reject unknown keys at load boundaries.

### AW-sync-8 (med): Postgres startup runs unconditional full-table `UPDATE` migrations on every boot, and CI skips `postgresStore`
- **Evidence**: [server.ts](server.ts#L184-L200), [docs/agent-handoff/decisions.tsv](docs/agent-handoff/decisions.tsv#L98)
- **Problem**: Every server boot executes four unconditional `UPDATE` statements scanning `events` and `sheets` ([server.ts](server.ts#L194-L200)). As the Postgres database grows, deploys stall or lock tables on boot. In addition, `postgresStore` and `memoryStore` diverge on event retention (`MEM_EVENTS = 20000` vs unlimited in Postgres) and `events()` slicing (`after` as array offset in memory vs `WHERE seq > after` in Postgres), yet `bun run ci` only exercises `memoryStore`.
- **Concrete fix sequence**:
  1. Gate one-time backfills behind a `schema_migrations` version table so they run once per database rather than on every deploy.
  2. Add a `memoryStore` vs `postgresStore` parity test job to CI with a throwaway Postgres container, or document a required pre-deploy Postgres test gate.

### AW-sync-9 (med): TOFU device binding on unauthenticated `GET` polls and unsealed targeted GM events
- **Evidence**: [server.ts](server.ts#L360-L366), [server.ts](server.ts#L423), [src/core/protocol.ts](src/core/protocol.ts#L413-L439), [src/core/protocol.ts](src/core/protocol.ts#L993-L996)
- **Problem**: `proven()` ([server.ts](server.ts#L360-L366)) binds a `deviceId` to the first `x-device-token` seen on a read-only `GET /api/rooms/:code?d=<dev>` poll ([server.ts](server.ts#L423)). Because every room member sees every other member's `deviceId` in unsealed `ev.from` and `ev.payload.by` fields, another room member can hijack a victim's `deviceId` immediately after a GM `release` or kick simply by polling with `?d=<victimDev>`. Separately, targeted GM `system` whispers (`to: [onePlayer]`) are not in `SEALED`, so every player's network poll receives the whispered text even though client UI filters it out.
- **Concrete fix sequence**:
  1. Only bind a new `deviceId -> tokenHash` on authenticated write (`PUT /sheets/:key`), and on `GET` polls only verify an existing binding rather than creating one.
  2. Add `system` events with a non-empty `to` list to server-side `visibleTo` filtering ([src/core/protocol.ts](src/core/protocol.ts#L993-L996)) so private GM whispers are not broadcast to other players.

### AW-sync-10 (med): `src/app.js` is untyped loose JS with dead `app.api.*` optional-chaining fallbacks
- **Evidence**: [src/app.js](src/app.js#L233-L234), [src/app.js](src/app.js#L262), [src/app.js](src/app.js#L265), [src/edge/api-table.ts](src/edge/api-table.ts#L14-L18)
- **Problem**: Violates `typescript-best-practices` and `principle-foundational-thinking`. `apiTable` ([src/edge/api-table.ts](src/edge/api-table.ts#L14-L18)) throws synchronously if an API is unregistered. Therefore `if (app.api.sync?.switchTo)` ([src/app.js](src/app.js#L233)) and `app.api.quests?.tick()`, `app.api.combat?.tick()` (lines 262, 265) never return `undefined` once booted, making the fallback on line 234 dead code and hiding registration errors behind loose JS.
- **Concrete fix sequence**:
  1. Remove the dead `?.` guards and unreachable `setActive` fallback in `src/app.js:233-234, 262, 265`.
  2. Migrate `src/app.js` (297 lines) to strict TypeScript `src/app.ts` under `tsconfig.json`.

### AW-sync-11 (low): `sendSheet` performs four JSON serialize/parse passes per push, and `room-world.ts` duplicates `sync.ts`
- **Evidence**: [src/edge/sync.ts](src/edge/sync.ts#L511-L520), [src/edge/sync.ts](src/edge/sync.ts#L168), [tests/models/room-world.ts](tests/models/room-world.ts#L1-L4)
- **Problem**: Every sheet push serializes `h` (`JSON.stringify(h)`), serializes `{ hunter: h }` for length checking, parses `text` back with `JSON.parse(text)`, and serializes `{ from, data }` again inside `fetchApi`. Meanwhile `tests/models/room-world.ts` (850 lines) re-implements `sync.ts`'s orchestration by hand, so bugs inside `sync.ts` itself (`BUG-sync-4`, `BUG-sync-7`, `BUG-sync-8`, `BUG-sync-12`, `BUG-sync-13`) are invisible to the room-system model tests.
- **Concrete fix sequence**:
  1. Build `{ from: deviceId(), data: { hunter: h } }` once, serialize once, and pass the pre-serialized body string to `fetchApi` (or measure `bytesOf(body)` once).
  2. After splitting `sync.ts` (`AW-sync-4`), drive `tests/room-system-model.test.ts` through the real extracted edge runner with an injected `fetch` stub instead of a hand-copied clone.

### AW-sync-12 (low): `Math.random()` used for device IDs and event IDs instead of `crypto.getRandomValues`
- **Evidence**: [src/edge/store.ts](src/edge/store.ts#L32), [src/edge/sync.ts](src/edge/sync.ts#L739)
- **Problem**: `randId` ([src/edge/store.ts](src/edge/store.ts#L32)) generates 6 base-36 characters (~31 bits) from `Math.random()` even though `randToken` directly below it (line 34) uses `crypto.getRandomValues`. `sync.ts:739` likewise uses `Math.random()` for `newEvent` IDs despite `src/edge/roll.ts` already providing `cryptoRandom`.
- **Concrete fix sequence**:
  1. Use `crypto.getRandomValues` (12+ base-36 chars or 8 random bytes) in `randId` and pass `cryptoRandom()` in `sync.ts:739`.

---

## (D) Bugs

### BUG-sync-1 (high): `writeInto` corrupts nested arrays in place when prepending or shifting non-`id` array elements
- **Evidence**: [src/core/save-step.ts](src/core/save-step.ts#L76-L87), [src/core/save-step.ts](src/core/save-step.ts#L101-L108)
- **Repro**: Let `target = [A]` where `A = { key: 'burn', def: { ops: [op1] } }` (no `id` field, matching `SheetStatus`, `OfferRecord`, `RoomEvent`, or `Choice`). A pure step prepends a fresh object `B = { key: 'slow', def: { ops: [op2] } }` and returns `next = [B, A]`. In `writeAny`:
  1. For `i = 0` (`n = B`), `live.has(B)` is `false` and `idOf(B)` is `undefined`, so line 82 sets `old = target[0] = A` without checking whether `A` is retained elsewhere in `next`.
  2. Line 83 calls `mergeValue(A, B)`, which recurses into `mergeValue(A.def, B.def)` and `mergeValue(A.def.ops, B.def.ops)`.
  3. Line 103 calls `writeAny(A.def.ops, B.def.ops)`, mutating `A.def.ops` in place to `[op2]`.
  4. For `i = 1` (`n = A`), line 81 sees `live.has(A)` and returns `A` unchanged, now with `A.def.ops` corrupted to `[op2]`.
- **Severity**: High (silent data corruption in the core save writer used by every `store.apply`).
- **Suggested fix**: In `writeAny` ([src/core/save-step.ts](src/core/save-step.ts#L79-L84)), compute `const kept = new Set<unknown>(next.filter(n => live.has(n)))` and only index-pair `old = target[i]` when `!kept.has(target[i])` (or never merge index-matched objects that lack an `id`; clone them directly). Add a regression test in `tests/save-step.test.ts`.

### BUG-sync-2 (high): `repairSave` validates hunter references before renaming `run.bad` IDs, leaving dangling references
- **Evidence**: [src/core/save.ts](src/core/save.ts#L388-L390), [src/core/save.ts](src/core/save.ts#L523-L566), [src/core/save.ts](src/core/save.ts#L668-L670)
- **Repro**: Load or import a save where an equipped item, active title, penalty quest, or job-chain quest has a malformed or duplicate ID (for example, two hunters or a hunter and library share `i1`, or a quest ID is missing).
  1. `claimId` records `[o, prefix]` in `run.bad` without changing `o.id` yet ([src/core/save.ts](src/core/save.ts#L388-L390)).
  2. `fixHunter` validates `h.titleId` (line 524), `h.jobChain` (line 539), `h.equipped[slot]` (line 543), `h.penalty` (line 551), and `h.loadouts` (line 562) against the old `o.id`.
  3. Line 668 then rewrites `o.id = prefix + (++save.seq)` for every entry in `run.bad`, leaving `titleId`, `equipped`, `loadouts`, `penalty.questId`, and `jobChain.questId` pointing at the old ID. On the immediate load, lookups fail; on the next `store.apply`, `repairSave` wipes those equipped slots, active title, penalty, and job chain.
  4. Additionally, line 670 runs `fixHunter(run, starter)` after line 668 already drained `run.bad`, so any bad ID queued for `starter` is never renamed.
- **Severity**: High (wipes player equipment, titles, penalties, and job chains on duplicate/repaired IDs).
- **Suggested fix**: Reassign `run.bad` IDs per-hunter (or record a rename map `oldObj -> newId` / rewrite IDs before reference checks) and update `titleId`, `equipped`, `loadouts`, `penalty`, and `jobChain` to follow renamed objects. Move starter hunter creation before the `run.bad` pass.

### BUG-sync-3 (high): `exportedSave` and `keepPhone` leak phone-scoped sync state across devices, and `keepGmKey` wipes `gmKeys`
- **Evidence**: [src/core/save.ts](src/core/save.ts#L715-L735), [src/edge/store.ts](src/edge/store.ts#L245)
- **Repro**:
  1. Phone A has an offline `outbox` entry (containing `by: devA:h1`), `applied` event IDs, `seen` cursors, `runs`, and `offers` (referencing `devA:h1`), and exports a campaign file.
  2. `exportedSave` ([src/core/save.ts](src/core/save.ts#L715-L718)) strips only `deviceId`, `deviceToken`, and optionally `gmKey`/`gmKeys`. All seven other phone-scoped sync fields remain in the export.
  3. Phone B imports the file. `keepPhone` ([src/core/save.ts](src/core/save.ts#L723-L724)) restores only `deviceId` and `deviceToken`. Phone B now attempts to send Phone A's `outbox` entries (`by: devA:h1` under `from: devB`, rejected `403 not your sheet`), skips GM events matching Phone A's `applied`, and holds Phone A's `seen` cursors and `offers`.
  4. Separately, if Phone B is GM of room X (`mine.gmKeys = { X: keyX }`) while currently idle or in room Y, importing a campaign file exported without keys hits line 732 (`theirs.room !== mine.room`) and returns `save` untouched, wiping Phone B's entire `gmKeys` keyring.
- **Severity**: High (broken sync after campaign import and permanent loss of saved GM keys).
- **Suggested fix**: Strip `outbox`, `held`, `applied`, `runs`, `offers`, `seen`, `joinedAt`, `cursor`, and `boundHunterId` in `exportedSave` and reset them in `keepPhone`. In `keepGmKey`, preserve `mine.gmKeys` entries whenever `theirs.gmKeys` lacks them regardless of `theirs.room`.

### BUG-sync-4 (high): `outbox` `roomGone` skips in-flight `sending` entries and `deliver` is untracked, leaving zombie queued messages
- **Evidence**: [src/core/sync/outbox.ts](src/core/sync/outbox.ts#L119), [src/edge/sync.ts](src/edge/sync.ts#L416), [src/edge/sync.ts](src/edge/sync.ts#L647-L655), [src/edge/sync.ts](src/edge/sync.ts#L669-L674)
- **Repro**:
  1. A player posts an event or solo run in room `R`; `flush()` moves the entry to `at: 'sending'` and calls `deliver()` ([src/edge/sync.ts](src/edge/sync.ts#L649)). `deliver()` does not pass a `track(gen)` abort signal.
  2. While `deliver()` is still in flight, a poll receives `404 no such room` (`gone`). `notice('gone', R)` runs `roomGone(b, R)` ([src/edge/sync.ts](src/edge/sync.ts#L416)).
  3. `roomGone` ([src/core/sync/outbox.ts](src/core/sync/outbox.ts#L119)) only filters `e.room === room && e.at === 'queued'`, skipping the `sending` entry.
  4. The in-flight `deliver()` fails with a network/timeout/5xx error (or the page reloads). `answered` (line 655) or `reloaded` ([src/edge/sync.ts](src/edge/sync.ts#L936)) returns the entry to `at: 'queued'` for dead room `R`, where it remains permanently consuming `OUTBOX_MAX` slots.
- **Severity**: High (permanent outbox leak for dead rooms).
- **Suggested fix**: In `roomGone` ([src/core/sync/outbox.ts](src/core/sync/outbox.ts#L119)), drop entries where `e.room === room` regardless of whether `e.at` is `'queued'` or `'sending'`. Also pass a `track(gen)` signal into `deliver()`.

### BUG-sync-5 (high): Rejoining the current room as GM (or switching role/key) fails with `busy`
- **Evidence**: [src/core/sync/link.ts](src/core/sync/link.ts#L399), [src/edge/sync.ts](src/edge/sync.ts#L558-L559), [src/edge/sync.ts](src/edge/sync.ts#L595-L598)
- **Repro**:
  1. A phone is `live` in room `ABC234` as a player (`link.key === null`).
  2. The user enters the GM key in the Room view ("Rejoin as GM"), calling `sync.rejoinGM('ABC234', key)` ([src/edge/sync.ts](src/edge/sync.ts#L595-L598)) -> `begin(joining('ABC234', key))`.
  3. `link.ts:399` executes `case 'join': return event.code === link.code ? same(link) : begin(link, event);`, ignoring `event.key !== link.key`.
  4. `link.at` remains `'live'`, so [src/edge/sync.ts](src/edge/sync.ts#L559) rejects the tap with `tapError('busy')` ("Another create or join is under way. Try again in a moment.").
- **Severity**: High (blocks GM rejoin without first manually leaving the room, with a misleading error).
- **Suggested fix**: Change [src/core/sync/link.ts](src/core/sync/link.ts#L399) to `event.code === link.code && event.key === link.key ? same(link) : begin(link, event);` and add a unit test in `tests/link.test.ts`.

### BUG-sync-6 (high): `server.ts` read-modify-write races on `_kicked` and `ROOM_SHEETS` capacity
- **Evidence**: [server.ts](server.ts#L342-L346), [server.ts](server.ts#L457), [server.ts](server.ts#L477), [server.ts](server.ts#L480-L493)
- **Repro**:
  1. **Kick race**: GM removes player A (`DELETE /sheets/devA:h1`) and player B (`DELETE /sheets/devB:h2`) concurrently (or removes A while allowing B back). Both requests run `setRemoved` ([server.ts](server.ts#L342-L346)), which reads `await st.board(code)` outside a transaction and then overwrites the `_kicked` doc via `await st.putDoc(code, 'kicked', ...)`. The second write clobbers the first, silently dropping one removal or re-blocking an allowed-back player.
  2. **Capacity race**: In a room with 23 sheets (`ROOM_SHEETS = 24`), two players call `PUT /sheets/:key` simultaneously. Both read `Object.keys(board.sheets).length === 23` at line 487 and both write, exceeding `ROOM_SHEETS`.
- **Severity**: High (lost kicks/un-kicks and broken room cap under concurrent requests on Postgres).
- **Suggested fix**: Wrap `_kicked` updates and `PUT /sheets/:key` capacity checks inside a Postgres `sql.begin` transaction locking the room row `FOR UPDATE`, matching `addEvent` ([server.ts](server.ts#L219-L234)).

### BUG-sync-7 (high): `landPage` silently drops polled events in `readOnly` tabs while `link.cursor` advances
- **Evidence**: [src/core/sync/link.ts](src/core/sync/link.ts#L382), [src/edge/sync.ts](src/edge/sync.ts#L449), [src/edge/sync.ts](src/edge/sync.ts#L465-L472), [src/edge/store.ts](src/edge/store.ts#L285)
- **Repro**:
  1. Tab 1 enters `readOnly` (for example, Tab 2 saved the campaign, or a newer-version save was opened).
  2. Tab 1 is still `live` in a room and receives a poll containing GM awards, HP changes, or system whispers.
  3. `linkReduce` advances `link.cursor` to `event.cursor` ([src/core/sync/link.ts](src/core/sync/link.ts#L382)).
  4. `landPage` calls `store.apply('sync-page', ...)` ([src/edge/sync.ts](src/edge/sync.ts#L465)), which returns `refuse('read-only')` ([src/edge/store.ts](src/edge/store.ts#L285)).
  5. Line 472 returns early without applying events or running `tells`, while the next poll requests `after = newCursor`, permanently dropping those events from the tab's view.
- **Severity**: High (silent data/message loss in read-only tabs and direct violation of [docs/state-machines.md](docs/state-machines.md#L1382)).
- **Suggested fix**: Resolve `SM-sync-5` by either stopping/pausing `Link` when `StoreLife` enters `readOnly` or giving `sync.ts` an explicit in-memory bookkeeping write path matching the documented contract.

### BUG-sync-8 (high): Concurrent `putDoc` calls in `publishNow` race out of order and corrupt server and local `shown.docs`
- **Evidence**: [src/edge/sync.ts](src/edge/sync.ts#L744-L795)
- **Repro**:
  1. GM makes Fight change #1. `publishTimers` fires after `PUBLISH_FIGHT_MS` (400 ms), clears `publishTimers.delete('fight')` (line 772), and starts `await putDoc('fight', data1)` (line 784).
  2. While request #1 is slow on mobile 4G, GM makes Fight change #2. `republish()` sees `!publishTimers.has('fight')`, starts a new 400 ms timer, and starts `await putDoc('fight', data2)` while request #1 is still in flight.
  3. Request #2 finishes first (`shown.docs.fight = data2`, server has `data2`). Request #1 finishes second and overwrites the server with stale `data1`, then line 753 (`shown.gen === gen && link.gen === gen`) passes and overwrites local `shown.docs.fight` with stale `data1`.
- **Severity**: High (stale fight state overwrites newer fight turns on both server and GM phone).
- **Suggested fix**: Serialize `putDoc` per `PublishedDoc` with an in-flight/dirty state machine (`SM-sync-3`) so a second `PUT` waits for the first to finish and only publishes the latest snapshot.

### BUG-sync-9 (med): UTF-16 `.length` vs UTF-8 byte length mismatch on `SHEET_MAX` and `DOC_MAX`
- **Evidence**: [server.ts](server.ts#L379), [server.ts](server.ts#L486), [src/edge/sync.ts](src/edge/sync.ts#L513), [src/edge/sync.ts](src/edge/sync.ts#L747), [src/core/protocol.ts](src/core/protocol.ts#L629), [src/core/protocol.ts](src/core/protocol.ts#L892)
- **Repro**: `server.ts:379` enforces `MAX_BODY` (65,536) in UTF-8 bytes (`new TextEncoder().encode(text).length`), whereas `server.ts:486`, `sync.ts:513`, `sync.ts:747`, and `protocol.ts:892` check `SHEET_MAX` (32,768) and `DOC_MAX` (62,000) using JavaScript string `.length` (UTF-16 code units). A fight doc or solo doc containing multi-byte UTF-8 text (for example CJK/Korean names, arrows, or emojis) at 45,000 UTF-16 characters passes `body.length <= DOC_MAX` in `sync.ts:747` and `protocol.ts:629` but exceeds 65,536 UTF-8 bytes and hits `413 too large` at `server.ts:379` (where `shorter()` may not help if the non-log payload exceeds 64 KB UTF-8).
- **Severity**: Medium (unexpected `413` failures for non-ASCII campaigns and broken size budgeting).
- **Suggested fix**: Use `bytesOf` from [src/core/size.ts](src/core/size.ts#L9) consistently in `server.ts`, `sync.ts`, and `protocol.ts` for `SHEET_MAX` and `DOC_MAX`.

### BUG-sync-10 (med): `upgrade.ts` re-arms `quiet` timer after `reloading`, and misses `registration.waiting`
- **Evidence**: [src/edge/upgrade.ts](src/edge/upgrade.ts#L36-L40), [src/edge/upgrade.ts](src/edge/upgrade.ts#L46-L47), [src/edge/upgrade.ts](src/edge/upgrade.ts#L54), [src/edge/upgrade.ts](src/edge/upgrade.ts#L59), [src/sw.js](src/sw.js#L14-L34)
- **Repro**:
  1. **Re-entrant timer**: On a browser without `navigator.serviceWorker`, `upgradeRefused` emits effects `['look', 'wait']`. `for (const fx of effects) run(fx, showStuck)` calls `run('look')` first, which synchronously invokes `tell({ type: 'looked', installing: false })` -> transitions to `'reloading'` -> runs `clearTimeout(quiet); location.reload();`. Control then returns to the outer `for` loop, which runs `run('wait')` and sets a new `quiet` timer after `'reloading'`.
  2. **Waiting worker race**: In [src/edge/upgrade.ts](src/edge/upgrade.ts#L59), `registration.update().then(() => registration.installing !== null)` returns `false` if the new service worker already moved from `installing` to `waiting` (before `skipWaiting()` / `activate` / `clients.claim()` finishes firing `controllerchange`). That triggers an immediate `location.reload()` under the old service worker, hitting `426` again on reload and falsely tripping the `stuck` state.
- **Severity**: Medium (false "app could not update itself" lockouts during fast deploys).
- **Suggested fix**: Queue re-entrant events inside `send()` (matching `sync.ts`'s `drain()`), and check `registration.installing !== null || registration.waiting !== null` at [src/edge/upgrade.ts](src/edge/upgrade.ts#L59).

### BUG-sync-11 (med): Leaving a room never clears `settings.sync.gmKey`, so `forgetKey` leaves the forgotten key in the save
- **Evidence**: [src/core/sync/link.ts](src/core/sync/link.ts#L424-L441), [src/core/sync/bind.ts](src/core/sync/bind.ts#L66), [src/edge/sync.ts](src/edge/sync.ts#L833-L837)
- **Repro**:
  1. GM creates or runs room `ABC234` (`save.settings.sync.gmKey = 'gm_...'`, `gmKeys['ABC234'] = 'gm_...'`).
  2. GM taps "Forget" on room `ABC234`, calling `forgetKey('ABC234')` ([src/edge/sync.ts](src/edge/sync.ts#L833-L837)).
  3. `linkDo({ type: 'leave' })` calls `saves(live, idle)` ([src/core/sync/link.ts](src/core/sync/link.ts#L439)). Because `stored(idle)` omits `gmKey` (`undefined`), `linkSaved` ([src/core/sync/bind.ts](src/core/sync/bind.ts#L66)) leaves `s.gmKey` untouched.
  4. `ringGone` deletes `gmKeys['ABC234']`, leaving the supposedly forgotten secret sitting in `save.settings.sync.gmKey` in `localStorage` and in any subsequent export with keys.
- **Severity**: Medium (credential retention after explicit user "Forget" action).
- **Suggested fix**: Have `stored(idle)` set `gmKey: null` (or clear `gmKey` whenever `fields.room === null` in `linkSaved`), and clear `s.gmKey` in `ringGone` when it matches the forgotten key.

### BUG-sync-12 (med): `settleAttempt` silently binds the wrong hunter on `addHunter` failure, and undo can orphan the new hunter
- **Evidence**: [src/edge/sync.ts](src/edge/sync.ts#L546), [src/edge/sync.ts](src/edge/sync.ts#L569-L578)
- **Repro**:
  1. A player joins a room with a typed new hunter name in a `readOnly` tab (or when `addHunter` is refused). Line 572 `store.apply('join-new-hunter', ...)` returns `{ ok: false }`, so `a.made` remains `null`. When `head` succeeds, `joiningHunter()` (line 546) falls back to `activeHunterId`, silently joining with the existing active hunter instead of failing.
  2. If `a.made` was created and the join later fails (for example `notAllowedBack`), line 578 runs `both(d => removeHunter(d, made, null), d => setActive(d, a.prevActive))`. If `a.prevActive` was removed while the join was in flight, `setActive` returns `refuse('no-hunter')`, rolling back the entire `both(...)` step and leaving the unused `made` hunter in the party.
- **Severity**: Medium (wrong hunter joined or orphaned hunter left in party).
- **Suggested fix**: Abort/reject the join if `join-new-hunter` fails, and in `join-new-hunter-undo` restore `prevActive` only if it still exists in `d.hunters`.

### BUG-sync-13 (med): `switchTo` moves `joinedAt` to `srvNow()`, falsely triggering `WHILE YOU WERE AWAY`
- **Evidence**: [src/edge/sync.ts](src/edge/sync.ts#L440), [src/edge/sync.ts](src/edge/sync.ts#L447), [src/edge/sync.ts](src/edge/sync.ts#L693), [src/core/sync/bind.ts](src/core/sync/bind.ts#L82)
- **Repro**: A player is live in a room. The GM sends an award or HP update at `t = 10:00:00`. At `t = 10:00:01`, before the next poll arrives, the player uses "Play as" to switch hunters (`switchTo`). Line 693 calls `boundTo(s, to.id, srvNow())`, setting `joinedAt = 10:00:01`. On the next poll, line 447 checks `Date.parse(ev.at) < joined` (`10:00:00 < 10:00:01`), which is true, so the live event is falsely grouped into the `"WHILE YOU WERE AWAY"` summary modal. (Also noted as an open leftover in [docs/agent-handoff/decisions.tsv](docs/agent-handoff/decisions.tsv#L383).)
- **Severity**: Medium (confusing away-modal UX during live play).
- **Suggested fix**: Keep `joinedAt` for the room join timestamp (used by `away`) separate from `boundAt` (used by `removedSinceJoin` at [src/edge/sync.ts](src/edge/sync.ts#L403)), so `switchTo` updates only `boundAt`.

### BUG-sync-14 (med): `store.ts` `schedule()` leaks uncancelled 1000 ms fallback timers that flush before next paint
- **Evidence**: [src/edge/store.ts](src/edge/store.ts#L200-L203)
- **Repro**:
  1. At `t = 0 ms`, Change #1 calls `schedule()`, registering both `requestAnimationFrame(() => setTimeout(..., 0))` and `setTimeout(() => run({ type: 'due' }), 1000)`.
  2. At `t = 16 ms`, the rAF callback flushes the save (`life` returns to `clean`). The 1000 ms timer is never cancelled.
  3. At `t = 995 ms`, Change #2 marks `life` `dirty` and expects to wait for the next frame.
  4. At `t = 1000 ms`, the stale timer from Change #1 fires `run({ type: 'due' })` synchronously before the frame paints, blocking the frame with a full-save `JSON.stringify` + `localStorage.setItem` write.
- **Severity**: Medium (defeats the frame-budget invariant documented at lines 196-199).
- **Suggested fix**: Store the pending `rafId` and `fallbackTimer` IDs in `store.ts` and clear both whenever `run({ type: 'due' })` or `leaving` runs.

### BUG-sync-15 (med): `loadUnkept` banner displays wrong message when only a corrupt fight was dropped and backup failed
- **Evidence**: [src/edge/store.ts](src/edge/store.ts#L97), [src/edge/store.ts](src/edge/store.ts#L104), [src/edge/store.ts](src/edge/store.ts#L157-L159)
- **Repro**: A user's storage is completely full and their save has a corrupt `fight` field while the rest of the campaign is valid. `loadSave` opens the campaign with `notice: 'fight'` and `backup: { reason: 'fightLost', data }`. At line 157, `pushBackup` fails (`backup = 'failed'`). Line 158 suppresses `LOAD_TEXT.fight`, and `opened` puts `StoreLife` into `readOnly` with `why: 'loadUnkept'`, displaying `"Your save could not be opened, and storage is too full to keep a copy of it in Backups..."` ([src/edge/store.ts](src/edge/store.ts#L104)) even though the campaign did open.
- **Severity**: Medium (misleading data-loss alarm to users).
- **Suggested fix**: Differentiate `fightUnkept` vs `loadUnkept` in `StoreLife` (or pass `loaded.notice` into `loadUnkept` copy) so the banner accurately states that the save opened without its corrupt fight.

### BUG-sync-16 (med): `src/app.js` mounts views and panels whose `when()` predicate already threw
- **Evidence**: [src/app.js](src/app.js#L119-L135), [src/app.js](src/app.js#L165-L166)
- **Repro**: A view or panel has a `when()` predicate that throws an exception. `avail(v)` ([src/app.js](src/app.js#L166)) calls `asked(v.when)` which catches the error and returns `'failed'`. Because `avail` checks `!== 'no'`, the broken view/panel is kept, mounted via `mountPart` (which calls `def.mount` at line 125 before checking `when()`), and only afterward does `updatePart` call `asked(def.when)` a second time to mark `part.state = 'failed'`.
- **Severity**: Medium (double error reporting and unintended `mount()` side effects on broken views).
- **Suggested fix**: Check `asked(def.when)` before `mountPart` (or skip mounting and call `failPart` immediately when `when()` returns `'failed'`).

### BUG-sync-17 (low): `parseSaveId<K>` ignores prefix `K`, `sheetKeyOf` can exceed 40 chars, and `releaseSheet` rejects valid non-`d-` device IDs
- **Evidence**: [src/core/ids.ts](src/core/ids.ts#L31-L35), [src/core/ids.ts](src/core/ids.ts#L108-L110), [src/core/ids.ts](src/core/ids.ts#L132-L136), [src/edge/sync.ts](src/edge/sync.ts#L828)
- **Repro**:
  1. `parseSaveId<'h'>('q12')` returns `'q12'` typed as `HunterId` because `SAVE_ID_RE` matches any `[a-z]{1,4}\d+` without checking `K`.
  2. `parseDeviceId` allows 40-char IDs (`WORD_RE`), so `sheetKeyOf(dev40, 'h1')` produces a 43-char string that `parseSheetKey` (capped at 40 chars) rejects.
  3. `releaseSheet('dev_test:h1')` ([src/edge/sync.ts](src/edge/sync.ts#L828)) returns `NOT_GM` because `/^(d-[a-z0-9]+):/` rejects valid `DeviceId` strings not prefixed with `d-` (including IDs accepted by `server.ts` and `parseDeviceId`).
- **Severity**: Low (type-guard dishonesty and edge-case failure on non-`d-` device IDs).
- **Suggested fix**: Enforce prefix `K` at runtime in `parseSaveId`, cap `parseDeviceId` at 24 chars (leaving room for `:h<seq>` within 40 chars), and use `parseSheetKey` + `deviceOf` in `releaseSheet`.

### BUG-sync-18 (low): Unsanitized `sync.cursor`, duplicate `line.id` in `trade/goods.ts`, and loose `protocol.ts` parsers
- **Evidence**: [src/core/save.ts](src/core/save.ts#L576-L601), [src/core/trade/goods.ts](src/core/trade/goods.ts#L75-L87), [src/core/trade/offer.ts](src/core/trade/offer.ts#L290-L294), [src/core/protocol.ts](src/core/protocol.ts#L823), [src/core/protocol.ts](src/core/protocol.ts#L877), [src/core/protocol.ts](src/core/protocol.ts#L912)
- **Repro**:
  1. Loading a save with `settings.sync.cursor: -5` or `1.7` passes `fillValue` (any finite number) and is never clamped in `fixSync` ([src/core/save.ts](src/core/save.ts#L576-L601)).
  2. Calling `setAside(h, { items: [{ id: i1, qty: 1 }, { id: i1, qty: 1 }], ... })` in [src/core/trade/goods.ts](src/core/trade/goods.ts#L75-L87) succeeds and produces duplicate `from` IDs, which `parseGoods` later rejects inside `offerPosted` ([src/core/trade/offer.ts](src/core/trade/offer.ts#L294)), misreporting `'too-large'`.
  3. In [src/core/protocol.ts](src/core/protocol.ts#L912), `DOCS.rules` checks `feats.on !== false`, accepting `"false"` or `0` as `true`; line 877 casts `id(own(o, 'id')) as GateId` instead of calling `parseGateId`; line 823 casts `a as AbilityId` instead of calling `abilityId(a)`.
- **Severity**: Low (edge-case boundary leaks).
- **Suggested fix**: Clamp `sync.cursor = int(sync.cursor, 0, 0, Number.MAX_SAFE_INTEGER)` in `fixSync`; reject duplicate `line.id` in `setAside`; use `bool`, `parseGateId`, and `abilityId` in `protocol.ts`.

---

## (E) All Findings Ordered by Importance

| Rank | ID | Severity | File:Line | One-line problem | One-line fix |
|---:|---|---|---|---|---|
| 1 | BUG-sync-1 | high | [src/core/save-step.ts](src/core/save-step.ts#L76-L87) | `writeInto` mutates nested arrays of retained non-`id` elements when prepending/shifting | Skip index-pairing `target[i]` when `target[i]` is kept elsewhere in `next` |
| 2 | BUG-sync-2 | high | [src/core/save.ts](src/core/save.ts#L523-L566) | `repairSave` validates hunter refs before renaming `run.bad` IDs, causing dangling refs | Rename `run.bad` IDs and remap references before validating hunter links |
| 3 | BUG-sync-3 | high | [src/core/save.ts](src/core/save.ts#L715-L735) | `exportedSave`/`keepPhone` leak phone-local sync fields and `keepGmKey` wipes `gmKeys` | Strip/reset all phone-local sync fields on export/import and merge `gmKeys` |
| 4 | AW-sync-1 | high | [src/core/save.ts](src/core/save.ts#L187-L206) | Portable campaign saves conflate device-scoped sync queues, cursors, and keys | Separate `PhoneSyncFields` structurally from portable campaign save data |
| 5 | BUG-sync-6 | high | [server.ts](server.ts#L342-L346) | `setRemoved` and `PUT /sheets/:key` have read-modify-write races on `_kicked` and `ROOM_SHEETS` | Wrap `_kicked` updates and sheet capacity checks in Postgres `FOR UPDATE` transactions |
| 6 | AW-sync-2 | high | [server.ts](server.ts#L251-L267) | Every player `PUT /sheets/:key` fetches and parses the entire room board | Add narrow `getKicked` and transactional `putSheetIfAllowed` store methods |
| 7 | BUG-sync-8 | high | [src/edge/sync.ts](src/edge/sync.ts#L744-L795) | Overlapping `putDoc` requests race out of order and overwrite newer server and local docs | Serialize `putDoc` per doc with an explicit in-flight/dirty publisher machine |
| 8 | SM-sync-3 | high | [src/edge/sync.ts](src/edge/sync.ts#L744-L795) | GM doc publisher uses three parallel maps with no explicit `putting` state | Model per-doc publishing in a pure core reducer `src/core/sync/publish.ts` |
| 9 | BUG-sync-4 | high | [src/core/sync/outbox.ts](src/core/sync/outbox.ts#L119) | `roomGone` skips `sending` entries and `deliver` is untracked, leaving zombie queued items | Drop both `queued` and `sending` entries in `roomGone` and abort `deliver` via `track(gen)` |
| 10 | BUG-sync-5 | high | [src/core/sync/link.ts](src/core/sync/link.ts#L399) | `link` `join` ignores `event.key !== link.key`, breaking GM rejoin in current room with `busy` | Check `event.code === link.code && event.key === link.key` before returning `same(link)` |
| 11 | BUG-sync-7 | high | [src/edge/sync.ts](src/edge/sync.ts#L465-L472) | `landPage` drops polled events in `readOnly` tabs while `link.cursor` advances | Pause `Link` in `readOnly` tabs or add an explicit in-memory bookkeeping write path |
| 12 | SM-sync-5 | high | [docs/state-machines.md](docs/state-machines.md#L1382) | `StoreLife` `readOnly` bookkeeping doc disagrees with `sync.ts` calling `store.apply` | Align `StoreLife`, `sync.ts`, and `docs/state-machines.md` on one explicit `readOnly` rule |
| 13 | AW-sync-3 | high | [src/edge/rules.ts](src/edge/rules.ts#L32-L38) | `rules()` runs `JSON.stringify` over overrides and custom statuses on every call | Cache `rules()` by monotonic store/room revision counter instead of `JSON.stringify` |
| 14 | AW-sync-4 | high | [src/edge/sync.ts](src/edge/sync.ts#L1-L944) | `sync.ts` is a 944-line god module mixing HTTP, reducers, UI dialogs, URLs, and dead code | Remove dead helpers and split HTTP, doc publishing, and UI prompts out of `sync.ts` |
| 15 | SM-sync-2 | high | [src/edge/sync.ts](src/edge/sync.ts#L556-L581) | Create/Join `attempt` is an implicit multi-phase machine with nullable fields | Replace `Attempt` with a typed discriminated union transitioned inside `drain()` |
| 16 | BUG-sync-10 | med | [src/edge/upgrade.ts](src/edge/upgrade.ts#L36-L59) | `upgrade.ts` re-arms `quiet` timer after `reloading` and misses `registration.waiting` | Queue re-entrant events in `send()` and check `registration.installing \|\| registration.waiting` |
| 17 | BUG-sync-9 | med | [server.ts](server.ts#L379) | `SHEET_MAX`/`DOC_MAX` check UTF-16 `.length` while `MAX_BODY` enforces UTF-8 bytes | Measure `SHEET_MAX` and `DOC_MAX` with UTF-8 `bytesOf` in server, edge, and core |
| 18 | BUG-sync-11 | med | [src/core/sync/link.ts](src/core/sync/link.ts#L424-L441) | Leaving a room leaves `settings.sync.gmKey` populated even after `forgetKey` | Clear `gmKey: null` when `room` becomes `null` and when `ringGone` forgets the key |
| 19 | AW-sync-9 | med | [server.ts](server.ts#L360-L366) | `GET` polls do TOFU device binding and targeted `system` whispers broadcast to all players | Bind device tokens only on `PUT /sheets/:key` and seal targeted `system` whispers server-side |
| 20 | BUG-sync-12 | med | [src/edge/sync.ts](src/edge/sync.ts#L569-L578) | Failed `join-new-hunter` binds existing hunter and failed `setActive` aborts undo removal | Reject join when `addHunter` fails and guard `prevActive` existence during undo |
| 21 | BUG-sync-13 | med | [src/edge/sync.ts](src/edge/sync.ts#L440-L447) | `switchTo` moves `joinedAt` to `srvNow()`, triggering false `WHILE YOU WERE AWAY` modals | Track `boundAt` separately from `joinedAt` so `switchTo` does not move `joinedAt` |
| 22 | BUG-sync-14 | med | [src/edge/store.ts](src/edge/store.ts#L200-L203) | `schedule()` never cancels its 1000 ms fallback timer, causing pre-paint flushes | Store and cancel both `rAF` and fallback timer handles on flush or leave |
| 23 | AW-sync-8 | med | [server.ts](server.ts#L184-L200) | Postgres boot runs full-table `UPDATE` migrations every start and CI skips Postgres | Gate backfills with a migration version table and run Postgres tests in CI |
| 24 | AW-sync-7 | med | [src/edge/store.ts](src/edge/store.ts#L269-L295) | Every `store.apply` runs full-tree `writeInto` plus full `repairSave`, while keeping unknown keys | Separate load-time repair from hot-path writes and tighten strict sync record parsing |
| 25 | SM-sync-1 | med | [server.ts](server.ts#L295-L320) | Server DB lifecycle keeps `closed` and `retry` flags outside `Db<S>` | Add explicit `closed` state and `close` event/effects to `src/core/room-server.ts` |
| 26 | SM-sync-6 | med | [src/edge/sync.ts](src/edge/sync.ts#L602-L616) | Recursive `showRemoved` modal retries forever on `notFound` or `replaced` with wrong message | Exit retry modal on `notFound`/`replaced` and guard against campaign/room changes |
| 27 | BUG-sync-15 | med | [src/edge/store.ts](src/edge/store.ts#L104) | `loadUnkept` says save could not open when only a corrupt fight was dropped | Add distinct copy/reason for `fightUnkept` when campaign opened without its fight |
| 28 | BUG-sync-16 | med | [src/app.js](src/app.js#L119-L166) | `app.js` mounts views and panels whose `when()` predicate already threw | Transition directly to `failed` when `when()` throws instead of calling `mountPart` |
| 29 | SM-sync-4 | med | [src/app.js](src/app.js#L114-L158) | View/panel lifecycle mutates untyped `state` strings alongside ad-hoc render flags | Type `PartState` transitions explicitly and evaluate `when()` once per render pass |
| 30 | AW-sync-5 | med | [src/edge/sync.ts](src/edge/sync.ts#L38) | `src/edge/sync.ts` and `room-pill.ts` invert layers by importing `src/views/app.ts` | Extract `SyncHost`/`PillHost` interfaces into `src/edge/` and enforce via lint test |
| 31 | AW-sync-6 | med | [src/core/ids.ts](src/core/ids.ts#L108-L110) | Boundary validation is duplicated with diverging regexes and unchecked casts | Centralize `parseSheetKey`/`deviceOf` in `sync.ts` and validate prefixes/IDs in `core` |
| 32 | AW-sync-10 | med | [src/app.js](src/app.js#L233-L265) | `src/app.js` is untyped loose JS carrying dead `app.api.*` optional-chaining fallbacks | Remove dead optional guards and migrate `src/app.js` to strict `src/app.ts` |
| 33 | BUG-sync-17 | low | [src/core/ids.ts](src/core/ids.ts#L31-L136) | `parseSaveId<K>` ignores `K`, `sheetKeyOf` can exceed 40 chars, `releaseSheet` rejects non-`d-` | Enforce prefix `K` in `parseSaveId`, cap `DeviceId` length, and use `parseSheetKey` |
| 34 | BUG-sync-18 | low | [src/core/save.ts](src/core/save.ts#L576-L601) | `sync.cursor` is unclamped, `setAside` allows duplicate IDs, `protocol.ts` loosens `feats.on`/casts | Clamp `cursor`, reject duplicate `line.id` in `setAside`, and tighten `protocol.ts` |
| 35 | AW-sync-11 | low | [src/edge/sync.ts](src/edge/sync.ts#L511-L520) | `sendSheet` runs 4 JSON serialize/parse passes and `room-world.ts` hand-copies `sync.ts` | Serialize sheet payload once and run model tests against the extracted edge runner |
| 36 | AW-sync-12 | low | [src/edge/store.ts](src/edge/store.ts#L32) | `randId` and `sync.ts:739` use `Math.random()` instead of `crypto.getRandomValues` | Use `crypto.getRandomValues` in `randId` and `cryptoRandom()` in `sync.ts:739` |

---

## (C) Top 10 to Fix First, and What Is Already Good

### Top 10 to Fix First
1. **Fix `writeInto` nested-array mutation (`BUG-sync-1`)** at [src/core/save-step.ts](src/core/save-step.ts#L76-L87): smallest change with the widest blast radius, because every `store.apply` funnels through it.
2. **Fix `repairSave` `run.bad` reference ordering (`BUG-sync-2`)** at [src/core/save.ts](src/core/save.ts#L523-L566): prevents silent wiping of equipped gear, titles, penalties, and job chains after duplicate-ID repair.
3. **Separate and strip phone-scoped sync state on export/import (`BUG-sync-3` + `AW-sync-1`)** at [src/core/save.ts](src/core/save.ts#L715-L735): stops cross-phone sync corruption and prevents wiping `gmKeys` on import.
4. **Make `_kicked` and `PUT /sheets/:key` transactional and narrow (`BUG-sync-6` + `AW-sync-2`)** at [server.ts](server.ts#L342-L346), [server.ts](server.ts#L480-L493): fixes concurrent kick/capacity races and eliminates full-board Postgres reads every 3 seconds per player.
5. **Serialize GM doc publishing with a pure reducer (`BUG-sync-8` + `SM-sync-3`)** at [src/edge/sync.ts](src/edge/sync.ts#L744-L795): stops out-of-order fight doc writes from rewinding GM combat turns on slow mobile links.
6. **Fix `outbox` `roomGone` on `sending` entries and abort `deliver` (`BUG-sync-4`)** at [src/core/sync/outbox.ts](src/core/sync/outbox.ts#L119), [src/edge/sync.ts](src/edge/sync.ts#L647-L674): eliminates zombie outbox entries for dead rooms.
7. **Allow GM rejoin into the currently open room (`BUG-sync-5`)** at [src/core/sync/link.ts](src/core/sync/link.ts#L399): one-line core fix unblocking player-to-GM room promotion.
8. **Resolve `StoreLife` `readOnly` vs `sync.ts` cursor advance (`BUG-sync-7` + `SM-sync-5`)** at [src/edge/sync.ts](src/edge/sync.ts#L465-L472): aligns code with [docs/state-machines.md](docs/state-machines.md#L1382) so read-only tabs do not advance cursors past unapplied events.
9. **Remove `JSON.stringify` from `rules()` hot path (`AW-sync-3`)** at [src/edge/rules.ts](src/edge/rules.ts#L32-L38): immediate mobile frame-budget win with minimal risk.
10. **Fix `upgrade.ts` re-entrancy and `registration.waiting` check (`BUG-sync-10`)** at [src/edge/upgrade.ts](src/edge/upgrade.ts#L36-L59): prevents false "cannot update" stuck banners during deploys.

### What Is Already Good and Must Be Protected
- **Pure core state machines with explicit effects and generated charts**: [src/core/sync/link.ts](src/core/sync/link.ts#L1-L445), [src/core/sync/push.ts](src/core/sync/push.ts#L1-L136), [src/core/sync/outbox.ts](src/core/sync/outbox.ts#L1-L184), [src/core/store-life.ts](src/core/store-life.ts#L1-L160), [src/core/upgrade.ts](src/core/upgrade.ts#L1-L127), and [src/core/trade/offer.ts](src/core/trade/offer.ts#L1-L549) cleanly separate pure transitions from IO effects, with `docs/state-machines.md` regenerated and verified by `tests/statecharts.test.ts`.
- **Idempotent atomic event application and Postgres row-locked `addEvent`**: [src/core/applied.ts](src/core/applied.ts#L1-L68) records event IDs in the exact same `store.apply` write as the effect (`appliedOnce`), and [server.ts](server.ts#L219-L234) locks the room row (`FOR UPDATE`) and deduplicates by `eid` inside one transaction. Protect both invariants.
- **Constant-time GM key hashing and strict wire boundary parsers**: [server.ts](server.ts#L50-L56) uses SHA-256 + `timingSafeEqual` for GM keys and device tokens, and [src/core/protocol.ts](src/core/protocol.ts#L1-L1065) validates every room payload, sheet, and doc at the wire boundary before it enters core logic.
- **Structural architectural lint tests and dependency map**: [tests/lint.test.ts](tests/lint.test.ts#L1-L300) mechanically enforces core purity, single-writer rules, explicit `edge` state inventories, and no swallowed `catch` blocks, while `docs/dependency-map.md` keeps module coupling auditable.
- **Transactional backup-first load protection**: [src/core/store-life.ts](src/core/store-life.ts#L1-L160) and [src/edge/store.ts](src/edge/store.ts#L134-L160) refuse to overwrite unreadable or newer-version saves when storage is too full to preserve a backup, protecting player campaign data from silent truncation.
- **Service worker all-or-nothing install caching**: [src/sw.js](src/sw.js#L14-L34) deletes the partial cache and aborts `skipWaiting()` if any shell asset fails to cache, preventing half-upgraded offline shells.

---

## Coverage

### Read Fully
- **Skills (all 12)**: `.claude/skills/poteto-mode/SKILL.md`, `architect/SKILL.md`, `statechart/SKILL.md`, `principle-model-the-domain/SKILL.md`, `principle-foundational-thinking/SKILL.md`, `principle-type-system-discipline/SKILL.md`, `principle-boundary-discipline/SKILL.md`, `principle-separate-before-serializing-shared-state/SKILL.md`, `principle-make-operations-idempotent/SKILL.md`, `blast-radius/SKILL.md`, `principle-minimize-reader-load/SKILL.md`, `typescript-best-practices/SKILL.md`.
- **Architecture & docs**: `README.md`, `AGENTS.md`, `docs/state-machines.md`, `docs/GAME-UPDATE.md`, all 9 `docs/guide/*.md` (`combat.md`, `feats-stories.md`, `gates-solo.md`, `hunters.md`, `machines.md`, `makers.md`, `room-sync.md`, `save-store.md`, `tests-ci.md`), `docs/agent-handoff/START-HERE.md`, `handoff.md`, `landed.md`, `NEXT-SESSION-PROMPT.md`, `tsconfig.json`, `tsconfig.views.json`, `package.json`.
- **All deep-read lane source files**:
  - `server.ts`
  - `src/core/room-server.ts`, `src/core/protocol.ts`, `src/core/api.ts`, `src/core/save.ts`, `src/core/save-step.ts`, `src/core/store-life.ts`, `src/core/session-log.ts`, `src/core/events.ts`, `src/core/ids.ts`, `src/core/party.ts`, `src/core/role.ts`, `src/core/settings.ts`, `src/core/use-told.ts`, `src/core/applied.ts`, `src/core/upgrade.ts`, `src/core/size.ts`
  - `src/core/sync/bind.ts`, `connection.ts`, `invite.ts`, `link.ts`, `outbox.ts`, `push.ts`, `seen.ts`, `taps.ts`
  - `src/core/trade/goods.ts`, `offer.ts`
  - `src/edge/api-table.ts`, `build.ts`, `bus.ts`, `notify.ts`, `pack-code.ts`, `report.ts`, `roll.ts`, `room-events.ts`, `room-pill.ts`, `rules.ts`, `store.ts`, `sync.ts`, `upgrade.ts`
  - `src/app.js`, `src/sw.js`
- **Cross-check files read fully**: `src/views/app.ts`, `src/views/uses.js`, `scripts/build.ts`, `types/bun.d.ts`, `types/build.d.ts`.

### Skimmed
- `docs/dependency-map.md`, `docs/agent-handoff/decisions.tsv`, `docs/agent-handoff/final/implicit-audit-3.md`, `docs/agent-handoff/for-the-owner.md`.
- `src/views/io.js` (lines 1-260), `src/views/room.js` (lines 1-260), `tests/lint.test.ts` (lines 1-300), `tests/models/room-world.ts` (lines 1-120).

### Not Read (Outside Sync Lane)
- Combat, hunter, gate, feat, story, and workshop core modules (`src/core/combat/`, `src/core/hunter/`, `src/core/gates/`, `src/core/feats/`, `src/core/story/`, `src/core/library/`, `src/core/rules*.ts`, `src/core/coin.ts`, `src/core/day.ts`, etc.).
- Remaining view modules in `src/views/` and `public/app.css`, `public/index.html`.
- Remaining scripts in `scripts/` (`ci.ts`, `deps.ts`, `statecharts.ts`, etc.) and unit/E2E test suites in `tests/` beyond the files listed above.


---

# Neon lane report: views (verbatim)

### Audit Scope and Lens

This read-only audit inspects the client UI lane of `systemgaming` (HEAD `a11b6a5d`, all 41 files in `src/views/` plus `src/app.js`) to find implicit state machines, architectural weaknesses, and concrete bugs. Every claim is grounded in exact `file:line` references, and machines already modeled in [docs/state-machines.md](docs/state-machines.md) are omitted unless view code disagrees with them.

The following pstack principles shaped this audit:
- **statechart** and **principle-model-the-domain** guided the search for unmodeled modal queues, form modes, and teardown phases that permit illegal states.
- **principle-type-system-discipline** and **typescript-best-practices** guided the assessment of `tsconfig.views.json`, unchecked `store.apply` return values, and DOM expandos.
- **principle-boundary-discipline** and **architect** highlighted duplicated validation/domain helpers, the `src/edge -> src/views/app.ts` dependency inversion, and imperative DOM mutations bypassing view caches.
- **principle-make-operations-idempotent** and **principle-separate-before-serializing-shared-state** exposed read-only partial side effects (posting room events or toasting success before a save write commits) and double-submit hazards.
- **blast-radius**, **principle-foundational-thinking**, and **principle-minimize-reader-load** drove severity ranking, sequenced fixes, and concise reporting.

---

### (A) Implicit state machines

#### SM-views-1 (High) — Modal window queue, stack, and held-toast lifecycle
- **Evidence**: [src/views/ui.js:63-108](src/views/ui.js#L63-L108), [src/views/ui.js:126-316](src/views/ui.js#L126-L316)
- **Implemented states and transitions**:
  - Windows live in `stack[]` with `at: 'queued' | 'open' | 'leaving'` and `kind: 'system' | 'maker' | 'onboard' | 'shelf' | 'story' | 'sheet'`.
  - `openWindow` pushes `'open'` immediately (`ui.js:187-188`). `system()` pushes `'queued'` (`ui.js:238`), then opens via `openNext()` immediately or after `LATE` (`ui.js:197, 240`).
  - A module-level singleton `refreshCur` (`ui.js:244, 297`) holds the live badge updater for whichever `system` window opened last.
  - Toasts attach expando callbacks `t._act` and `t._t` (`ui.js:71-79, 101-107`) that fire on timeout, third-toast eviction, `visibilitychange`, or `pagehide`, and cancel on Undo click.
- **Illegal states representable**:
  - A `system` window pushed as `'queued'` stays behind a later `openWindow` (`maker`/`onboard`/`shelf`/`story`) in `stack[]`, then `openNext()` appends it to `document.body` visually on top (`ui.js:221-225, 238-241`). `stack` order and DOM z-order invert.
  - `stack.push(w)` runs before `show()` (`ui.js:187-188`). If `show()` throws, `w` remains `'open'` forever.
  - A held toast pushed out by two quick toasts triggers `ended()` immediately even if the user was reaching for Undo (`ui.js:106`).
- **Bugs and race risks**: `keydown` scans `stack` from the end (`ui.js:143-145`), routing `Escape` and `Tab` to the obscured window underneath instead of the visible System window on top. A thrown `show()` permanently breaks `windowOpen()` and all keyboard shortcuts.
- **Proposed explicit model**: Move `stack` and `system` queue into a pure reducer over `{ top: OpenWin[]; queue: QueuedSystem[]; leaving: Set<WinId> }`. Push a `system` window onto `top` only when dequeued (matching DOM append order). Commit `top.push` only after `show()` succeeds. Store held toast timers/callbacks in a `Map<HTMLElement, ToastRecord>` with explicit `pending | fired | undone` state.
- **Blast radius**: Low-to-medium (internal to `src/views/ui.js`; all callers use `system`, `openWindow`, `closeWindow`, `toast`).

#### SM-views-2 (High) — Detail disclosure split across `detail.js`, caller HTML caches, and `map.js`
- **Evidence**: [src/views/detail.js:28-69](src/views/detail.js#L28-L69), [src/views/map.js:472-489](src/views/map.js#L472-L489)
- **Implemented states and transitions**:
  - `detail.js` holds `open: Map<list, key>`. `show()` updates `open` and calls `redraw()`. `close()` deletes from `open`, edits `aria-expanded` imperatively, and calls `motion.dismiss(p)` without calling `redraw()` (`detail.js:60-67`).
  - Callers cache rendered HTML strings in `patch.ts` `b.last` (`combat.js:828, 863`, `table.js:189, 478, 492`), `dataset.sig` (`odds-box.js:61-63`, `table.js:413-414`, `map.js:481-489`), or `el._h` (`hunter.js:571-575, 650-655`).
  - `map.js` mirrors `open.get('map')` in its own `let mapDt` (`map.js:472`) using a hardcoded `'map'` list key shared across every mounted map instance.
- **Illegal states representable**:
  - `detail.js` is closed (`open` empty) while caller caches still hold the open `<div class="dt">` HTML string.
  - Two mounted `map.js` instances (`combat.js` and `table.js`) overwrite each other's `'map'` key while keeping stale `mapDt`.
- **Bugs and race risks**: Closing any detail panel poisons the caller's cache so the 3rd tap cannot reopen it (7 call sites broken; see `BUG-views-1`, `BUG-views-22`).
- **Proposed explicit model**: Store `{ key, redraw }` in `detail.js` per list, have `close(list)` transition through `redraw()` (or expose a monotonic revision counter included in panel/cache keys), and generate a unique list ID per `map.mount()` instance instead of sharing `'map'`.
- **Blast radius**: Low (`detail.js` plus removing `map.js:489`'s manual `dataset.sig = ''` workaround).

#### SM-views-3 (High) — Battle map mount, active-fight, and teardown lifecycle
- **Evidence**: [src/views/map.js:202-221](src/views/map.js#L202-L221), [src/views/map.js:284-289](src/views/map.js#L284-L289), [src/views/map.js:341-346](src/views/map.js#L341-L346), [src/views/map.js:698](src/views/map.js#L698), [src/views/map.js:742-772](src/views/map.js#L742-L772)
- **Implemented states and transitions**:
  - `map.js` feeds two modeled core machines (`gesture.ts` and `map-view.ts` `choose` from [docs/state-machines.md](docs/state-machines.md)), yet its own lifecycle across `mounted -> active -> idle (!input) -> unmounted` is spread over 14 loose variables (`scene`, `fitted`, `areaSig`, `along`, `was`, `zonesWas`, `edges`, `choice`, `g`, `holdTimer`, `brush`, `mapDt`, `newsTimer`, `sized`) plus an uncleaned `window` `resize` listener and `IntersectionObserver`.
- **Illegal states representable**:
  - When `src.input()` returns `null` (`map.js:746`), `scene` becomes `null` while `g`, `holdTimer`, `choice`, `brush`, `fitted`, `was`, `zonesWas`, and `edges` remain populated from the ended fight. This disagrees with `docs/state-machines.md` ("A gesture on the map" and "What the map has chosen") because active gestures and choices survive fight teardown.
  - When `combat.js:1166` or `table.js:471` replaces the map container's HTML, the old `map.mount` closure remains subscribed to `window` `resize` and `cutSeen` forever.
- **Bugs and race risks**: Memory and listener leak on every fight restart or Map/List switch; stale pan/zoom and stale `zonesWas`/`was` animations when a new fight starts on the same grid dimensions (`12x10`); `holdTimer` firing after `scene === null` (see `BUG-views-8`).
- **Proposed explicit model**: Return a `destroy()` handle from `map.mount()` that removes the `resize` listener, disconnects `cutSeen`, clears `holdTimer`/`newsTimer`, and unsubscribes `newsLine`. Add an explicit `reset()` transition on `!input` or fight-ID change (pass `fightId` in `MapSceneInput`) that resets `g = IDLE`, `choice = NO_CHOICE`, `brush = null`, `fitted = ''`, and clears `was`/`zonesWas`/`edges`.
- **Blast radius**: Low (`map.js`, `combat.js`, `table.js`, `src/core/api.ts`).

#### SM-views-4 (Med) — Player turn submission hold and burst queue
- **Evidence**: [src/views/table.js:217-230](src/views/table.js#L217-L230), [src/views/table.js:313-319](src/views/table.js#L313-L319), [src/views/table.js:451-452](src/views/table.js#L451-L452), [src/views/table.js:539-551](src/views/table.js#L539-L551)
- **Implemented states and transitions**:
  - `hold` moves `{ at: 'free' } -> { at: 'sent', from, id: null } -> { at: 'sent', from, id: EventId } -> { at: 'free' }`.
  - Release happens only via `waitsFor(e)` (`e.at !== hold.from`), failed post, or `sync:outbox` with `o.at === 'refused'` (`table.js:230`).
- **Illegal states representable**:
  - Consumable buttons in List HUD / Desktop Kit (`table.js:314, 317`) invoke `inventory.use` without `sent()`, leaving `hold.at === 'free'` while a `cast` is in flight.
  - If an outbox item is `'dropped'` (e.g. room reset or disconnect cleanup), `sync:outbox` never calls `letGo()`, keeping buttons disabled until `e.at` changes.
- **Bugs and race risks**: Double-casting consumables on a player's turn; stuck disabled action buttons after an outbox drop (see `BUG-views-16`).
- **Proposed explicit model**: Route all turn-consuming actions (including `inventory.use` when `onTable`) through one `submitTurnAction` state machine with states `free | posting | waiting(from, id)` that releases on `docChanged`, `postFailed`, `outboxRefused`, `outboxDropped`, or `roomChanged`.
- **Blast radius**: Low (`table.js`, `inventory.js`).

#### SM-views-5 (Med) — App view/panel mount and error lifecycle
- **Evidence**: [src/app.js:110-173](src/app.js#L110-L173), [src/app.js:270-276](src/app.js#L270-L276)
- **Implemented states and transitions**:
  - Each registered view/panel has `state: 'new' | 'live' | 'failed'`.
  - In `showView` (`app.js:145-157`), every panel calls `mountPart(p)` on first visit regardless of `asked(p)` (`p.when()`), then calls `updatePart(p)`.
- **Illegal states representable**: A panel whose `when()` throws (`asked` returns `'failed'`) is still mounted (`p.mount()` runs and sets `p.state = 'live'`) before `updatePart` sees `'failed'` and marks it `'failed'` (`app.js:121-129, 152-155`).
- **Bugs and race risks**: Panel `mount()` runs on invalid preconditions when `when()` fails, potentially registering listeners or mutating DOM before being hidden.
- **Proposed explicit model**: Model each part as `{ at: 'unmounted' } | { at: 'mounted' } | { at: 'failed' }` and evaluate `when()` before transitioning `unmounted -> mounted`.
- **Blast radius**: Low (`src/app.js`).

#### SM-views-6 (Med) — Inline quest form edit/create mode
- **Evidence**: [src/views/quests.js:297](src/views/quests.js#L297), [src/views/quests.js:344-400](src/views/quests.js#L344-L400)
- **Implemented states and transitions**:
  - Mode is inferred from 4 separate flags: `editId` (string or null), `f.hidden`, `who.hidden`, and `autoTitle`.
  - `update()` refreshes the hunter list without resetting `editId` or closing the form when `store.active().id` changes.
- **Illegal states representable**: `editId` points to Hunter A's quest while `store.active()` is Hunter B, `f.hidden` is `false`, and `[data-who]` is `hidden`.
- **Bugs and race risks**: Submitting the form falls through `find(x => x.id === editId)` into the "new quest" branch, duplicating the quest onto Hunter B (player) or blocking the GM with `"Pick at least one hunter."` while the picker is hidden (see `BUG-views-15`).
- **Proposed explicit model**: Replace `editId` + DOM `hidden` flags with `{ at: 'closed' } | { at: 'new'; hunterId: string } | { at: 'edit'; hunterId: string; questId: string }`, automatically transitioning to `closed` when `store.active().id !== formState.hunterId` (matching `hunter.js:738`).
- **Blast radius**: Low (`src/views/quests.js`).

#### SM-views-7 (Med) — Room lobby code-check and GM seat controls
- **Evidence**: [src/views/room.js:62](src/views/room.js#L62), [src/views/room.js:189-243](src/views/room.js#L189-L243), [src/views/room.js:283-286](src/views/room.js#L283-L286)
- **Implemented states and transitions**:
  - Mutable object `view = { jc, ic, hid, open, t }` tracks debounced `runCheck(v)` timers, join code, invite code, selected hunter, and open panel.
  - `gmrelease` and `gmallow` async click handlers (`room.js:284-285`) have no busy/in-flight state.
- **Illegal states representable**: Two concurrent `gmrelease`/`gmallow` requests from rapid double-tap; stale debounced timer `view.t` firing after room state transitions to connected.
- **Bugs and race risks**: Duplicate GM seat mutations on double-click; wasted network checks after joining.
- **Proposed explicit model**: Explicit lobby state `idle | checking(code, reqId) | checked(code, result) | joining(code)` plus a `busy: boolean` guard on GM seat action buttons.
- **Blast radius**: Low (`src/views/room.js`).

#### SM-views-8 (Med) — Onboarding invite sub-step and debounced code check
- **Evidence**: [src/views/onboard.js:157-229](src/views/onboard.js#L157-L229)
- **Implemented states and transitions**:
  - Inside the modeled `invite` step of `onboard.ts`, `onboard.js` maintains an unmodeled local boolean `failed` (`onboard.js:167`) and mutates `joinBtn.disabled` / `aria-busy` / `textContent` imperatively (`onboard.js:173-183`).
- **Illegal states representable**: `joinBtn.disabled === true` and `aria-busy === 'true'` permanently after `go('joined', ...)` fails and returns early (`onboard.js:181`), trapping the user with a dead Join button.
- **Bugs and race risks**: User arriving via invite link cannot retry after a failed join step (see `BUG-views-21`).
- **Proposed explicit model**: Model the invite step as `ready | joining | retry(error)` and derive button text, `disabled`, and `aria-busy` from that state in one render function.
- **Blast radius**: Low (`src/views/onboard.js`).

#### SM-views-9 (Med) — Maker shell dirty/save-as-new and ability zone-end sub-editor
- **Evidence**: [src/views/maker.js:542-545](src/views/maker.js#L542-L545), [src/views/maker.js:748-756](src/views/maker.js#L748-L756), [src/views/maker.js:883](src/views/maker.js#L883), [src/views/maker.js:893-919](src/views/maker.js#L893-L919), [src/views/map-maker.js:62](src/views/map-maker.js#L62), [src/views/map-maker.js:101-162](src/views/map-maker.js#L101-L162)
- **Implemented states and transitions**:
  - `openMaker` tracks `form: 'clean' | 'edited'` and `asking: boolean`, while `shell.done(v)` (`maker.js:883`) calls `finish(v)` unconditionally without checking `v !== undefined`.
  - `map-maker.js` tracks `asNew`, `brush`, `zoneAt`, `eff`, and `painting` as independent flags; `Save as a new map` flips `asNew = true` and passes `save()` straight to `shell.done()` (`map-maker.js:148`).
  - `buildAbility` lazily initializes `zendFx` from a `NO_END` sentinel (`maker.js:748-751`) and only refreshes `[data-zend-err]` inside `draw()`, which is not invoked by `[data-zend-fx]` inputs (`maker.js:811`).
- **Illegal states representable**: Modal closes with `undefined` after a failed `Save as a new map`; `zendErr()` displays `"Add what lands when it ends."` while Save is enabled (valid effects present).
- **Bugs and race risks**: Silent loss of all unsaved map edits on validation/cap/read-only failure (`BUG-views-4`); stale zone-end validation banner (`BUG-views-14`).
- **Proposed explicit model**: Pass `asNew` as a parameter to `save(asNew)` instead of mutating closure state, guard `shell.done(v)` with `if (v !== undefined) finish(v)`, and update `zendErr()` on every `[data-zend-fx]` input event.
- **Blast radius**: Low (`maker.js`, `map-maker.js`).

#### SM-views-10 (Low) — Story chapter accordion and Dice FAB / Quick Check DC state
- **Evidence**: [src/views/story-maker.js:49-53](src/views/story-maker.js#L49-L53), [src/views/story-maker.js:121-160](src/views/story-maker.js#L121-L160), [src/views/dice.js:129](src/views/dice.js#L129), [src/views/dice.js:219-221](src/views/dice.js#L219-L221), [src/views/dice.js:266-285](src/views/dice.js#L266-L285)
- **Implemented states and transitions**:
  - `story-maker.js` keeps `open` chapter index and instantiates `rewards`/`quest` editors only for the open chapter, syncing back via `keep()`. `save()` validates only `quest.check()` on the open chapter (`story-maker.js:158-160`).
  - `dice.js` splits Quick Check DC initialization across `inst.dcInit` and `dcIn.dataset.touched`, and FAB sheet state across `isOpen`, `sheet.hidden`, and `sheet.inert`.
- **Illegal states representable**: Collapsed story chapter holds an invalid job quest that bypasses `quest.check()`; `dcInit` stays `true` after switching to a hunter of a different rank, leaving the old rank's default DC.
- **Bugs and race risks**: Invalid collapsed chapters saved (`BUG-views-17`); wrong default DC after hunter switch (`BUG-views-23`).
- **Proposed explicit model**: Validate every chapter's quest data via a pure core validator in `story-maker.js:save()`. Key `dice.js` DC auto-fill by `{ hunterId, rank }` rather than boolean `dcInit`.
- **Blast radius**: Low (`story-maker.js`, `dice.js`).

---

### (B) Architectural weaknesses

#### AW-views-1 (High) — Systemic unchecked or misattributed `store.apply` read-only refusals
- **Evidence**: [src/views/io.js:108-115](src/views/io.js#L108-L115), [src/views/coin.js:157-162](src/views/coin.js#L157-L162), [src/views/quests.js:99-103](src/views/quests.js#L99-L103), [src/views/quests.js:250-256](src/views/quests.js#L250-L256), [src/views/hunter.js:181](src/views/hunter.js#L181), [src/views/hunter.js:253-267](src/views/hunter.js#L253-L267), [src/views/gm.js:471-476](src/views/gm.js#L471-L476), [src/views/gm.js:510-511](src/views/gm.js#L510-L511), [src/views/gm.js:760](src/views/gm.js#L760), [src/views/gm.js:796-797](src/views/gm.js#L796-L797), [src/views/gates.js:587-588](src/views/gates.js#L587-L588), [src/views/combat.js:385-388](src/views/combat.js#L385-L388), [src/views/combat.js:513-516](src/views/combat.js#L513-L516), [src/views/combat.js:998](src/views/combat.js#L998), [src/views/inventory.js:261](src/views/inventory.js#L261), [src/views/shadows.js:97](src/views/shadows.js#L97), [src/views/custom.js:193-196](src/views/custom.js#L193-L196), [src/views/skills.js:211](src/views/skills.js#L211), [src/views/skills.js:292](src/views/skills.js#L292), [src/views/skills.js:329](src/views/skills.js#L329), [src/views/bestiary.js:406](src/views/bestiary.js#L406), [src/views/bestiary.js:434](src/views/bestiary.js#L434), [src/views/workshop.js:127-147](src/views/workshop.js#L127-L147), [src/views/reward-editor.js:342](src/views/reward-editor.js#L342), [src/views/feat-maker.js:143](src/views/feat-maker.js#L143), [src/views/forge.js:121](src/views/forge.js#L121), [src/views/loot.js:193](src/views/loot.js#L193), [src/views/story-maker.js:163](src/views/story-maker.js#L163)
- **Problem**: `store.apply` returns `{ ok: false, why: 'read-only' | 'refused' }` when another tab holds the write lock. Nearly half the views either ignore `.ok` (crash in `io.js`, infinite room-send loop in `coin.js`, false success toasts in `gm.js`, `gates.js`, `combat.js`, `custom.js`, `hunter.js`, `bestiary.js`), test truthiness of the returned object (`quests.js:253`), or conflate `'read-only'` with domain errors (`"Not enough gold"` in `inventory.js:261`, `"Not enough mana"` in `shadows.js:97`).
- **Sequenced fix**:
  1. Fix the crash and room-side-effect bugs first (`io.js`, `coin.js`, `quests.js`, `hunter.js`, `gm.js`).
  2. Add a lint check in `tests/lint.test.ts` banning bare statement `store.apply(...)` calls whose return value is discarded (unless explicitly marked with a helper or checked).
  3. Distinguish `r.why === 'read-only'` from domain refusals in `inventory.js`, `shadows.js`, and makers so read-only tabs never show misleading domain errors.

#### AW-views-2 (High) — Loose JS views bypass strict TypeScript checking
- **Evidence**: [tsconfig.views.json:1-15](tsconfig.views.json#L1-L15), all 38 `.js` files in `src/views/` and [src/app.js](src/app.js)
- **Problem**: `tsconfig.views.json` sets `strict: false`, `noImplicitAny: false`, `strictNullChecks: false`, and `exactOptionalPropertyTypes: false`. This directly allowed `io.js:110` (`report` null deref), `quests.js:253` (truthy `{ ok: false }` check), `map-maker.js:148` (`shell.done(undefined)`), `table.js:343` (`on: null` on a `turn` reaction), and untyped DOM expandos (`el._h`, `t._act`, `t._t`, `b._t`).
- **Sequenced fix**:
  1. Enable `strictNullChecks: true` incrementally on small views (`detail.js`, `io.js`, `coin.js`, `uses.js`, `effects.js`, `odds-box.js`) or migrate them to `.ts`.
  2. Replace DOM expandos (`_h`, `_act`, `_t`) with `WeakMap`s.
  3. Require typed return shapes on internal helpers like `questApply` and `gmWrite`.

#### AW-views-3 (High) — Imperative DOM mutation outside cached/patched render contracts
- **Evidence**: [src/views/detail.js:60-67](src/views/detail.js#L60-L67), [src/views/patch.ts:52](src/views/patch.ts#L52), [src/views/combat.js:828,863](src/views/combat.js#L828), [src/views/table.js:189,413-414](src/views/table.js#L413-L414), [src/views/hunter.js:571-575,650-655](src/views/hunter.js#L571-L575), [src/views/odds-box.js:61-63](src/views/odds-box.js#L61-L63), [src/views/map.js:481-489](src/views/map.js#L481-L489)
- **Problem**: Views cache rendered HTML strings (`patch.ts` `b.last`, `dataset.sig`, `el._h`), while `detail.close()` mutates and removes `.dt` nodes directly from the DOM without notifying callers or redrawing. Only `map.js:489` manually invalidates its cache (`dataset.sig = ''`); every other caller breaks on reopen.
- **Sequenced fix**:
  1. Make `detail.close(list)` invoke the stored `redraw()` callback (and fade out via a detached clone or `motion.fadeOff`) so caller caches stay synchronized with DOM reality.
  2. Add an E2E or unit test opening, closing, and reopening a detail panel on `combat`, `table`, `hunter`, and `odds-box`.

#### AW-views-4 (Med) — God files in `src/views/`
- **Evidence**: [src/views/combat.js](src/views/combat.js) (1,246 lines / 99 KB), [src/views/maker.js](src/views/maker.js) (1,081 lines / 85 KB), [src/views/gm.js](src/views/gm.js) (840 lines / 69 KB), [src/views/map.js](src/views/map.js) (789 lines / 64 KB), [src/views/hunter.js](src/views/hunter.js) (754 lines / 60 KB), [src/views/gates.js](src/views/gates.js) (644 lines / 49 KB), [src/views/table.js](src/views/table.js) (641 lines / 47 KB)
- **Problem**: Each file combines large embedded CSS strings, template rendering, local UI state, async modal workflows, room sync event handlers, and keyboard shortcuts. Cross-cutting bugs (such as `combat.js:355` bypassing `armRow` or `combat.js:1020` duplicating `gm.js:340`'s remote revive logic) arise because related logic sits hundreds of lines apart.
- **Sequenced fix**:
  1. Split `maker.js` into `maker-shell.js`, `maker-effects.js`, and `maker-ability.js` (just as `reward-editor.js` and `kit-parts.js` were already extracted).
  2. Extract `combat-sync.js` (room `sync:event` handlers + fight doc publisher) and `combat-end.js` (`endEncounter`, `offerDrop`, `showParty`) from `combat.js`.
  3. Extract GM roll tables and rules editor from `gm.js` into focused helpers.

#### AW-views-5 (Med) — Duplicated utilities, parsing, and rule constants in views
- **Evidence**:
  - `canon()` copy-pasted 5 times: [src/views/forge.js:24](src/views/forge.js#L24), [src/views/loot.js:29](src/views/loot.js#L29), [src/views/skills.js:69](src/views/skills.js#L69), [src/views/reward-editor.js:19](src/views/reward-editor.js#L19), [src/views/bestiary.js:195](src/views/bestiary.js#L195)
  - `guard()` in [src/views/rulesref.js:44-57](src/views/rulesref.js#L44-L57) duplicates `parseOverrides` validation; [src/views/rulesref.js:187](src/views/rulesref.js#L187) hardcodes `(minimum 5)` instead of `R.shadow.dcMin`; [src/views/rulesref.js:58-59](src/views/rulesref.js#L58-L59) duplicates `ui.esc` and `ui.fmt`
  - `highest()` in [src/views/dice.js:17](src/views/dice.js#L17) duplicates dice expression parsing
  - `parseQuick()` in [src/views/combat.js:1047-1064](src/views/combat.js#L1047-L1064) lives in a view instead of `src/core/registry/monsters.ts`
  - `flash()` duplicated in [src/views/io.js:44](src/views/io.js#L44) and [src/views/room.js:80](src/views/room.js#L80)
- **Problem**: Rule changes and parser fixes risk drifting between copies (`rulesref.js:187` already drifted from `R.shadow.dcMin`).
- **Sequenced fix**:
  1. Replace `rulesref.js:187`'s literal `5` with `R.shadow.dcMin` and drop `guard()` in favor of `app.rules()`.
  2. Export one `canon()` from `src/core/` and one `parseQuick()` from `src/core/registry/monsters.ts`.
  3. Move `flash()` into `src/views/ui.js`.

#### AW-views-6 (Med) — Global `document.body` `MutationObserver`, full-form reparsing, and mobile `<select>` `option.hidden`
- **Evidence**: [src/views/maker.js:990-1010](src/views/maker.js#L990-L1010), [src/views/loot.js:146-171](src/views/loot.js#L146-L171), [src/views/story-maker.js:148](src/views/story-maker.js#L148), [src/views/kit-parts.js:119](src/views/kit-parts.js#L119), [src/views/kit-parts.js:248](src/views/kit-parts.js#L248)
- **Problem**: `watchPicks()` attaches a permanent `MutationObserver` on `document.body` (`subtree: true`) that runs `querySelectorAll('select[data-pick]')` on every added node app-wide, including combat particles, rising damage numbers, and toasts. Inside `searchable()`, hiding options with `o.hidden = true` (`maker.js:1000`) is ignored by native iOS Safari and many Android WebView `<select>` pickers. Separately, `loot.js`, `story-maker.js`, and `kit-parts.js` re-serialize and re-parse entire forms on every keystroke.
- **Sequenced fix**:
  1. Scope `searchable()` directly to maker dialogs (call inside `openMaker` and `effects`/`kit-parts` render) and remove the global `document.body` observer.
  2. Replace `o.hidden = true` with detaching/re-attaching matching `<option>` elements so native mobile pickers actually filter.
  3. Debounce or narrow preview recomputation in heavy makers.

#### AW-views-7 (Med) — Inverted edge-to-views layering boundary
- **Evidence**: [docs/dependency-map.md:14](docs/dependency-map.md#L14), [src/views/app.ts](src/views/app.ts)
- **Problem**: `src/edge/sync.ts` and `src/edge/room-pill.ts` import `App` from `src/views/app.ts`, pointing the `edge` layer upward into `views`.
- **Sequenced fix**:
  1. Move the `App` type interface (or the minimal edge-facing `EdgeApp` contract) into `src/edge/app-types.ts` (or `src/core/api.ts`) and re-export from `src/views/app.ts`.
  2. Add a lint rule in `tests/lint.test.ts` forbidding `src/edge/*` from importing `src/views/*`.

#### AW-views-8 (Med) — Unbounded page Maps and uncollected `store.device` keys
- **Evidence**: [src/views/odds-box.js:28](src/views/odds-box.js#L28), [src/views/quests.js:298](src/views/quests.js#L298), [src/views/combat.js:82](src/views/combat.js#L82), [src/views/combat.js:390](src/views/combat.js#L390), [src/views/table.js:566-585](src/views/table.js#L566-L585), [src/views/feats.js](src/views/feats.js), [src/views/gates.js:219](src/views/gates.js#L219)
- **Problem**: `odds-box.js` `boxes` Map never evicts deleted gates; `quests.js` `barsWas` Map never evicts deleted quests; `combat.js` `picks`/`amounts` Maps never prune removed rows or cleared fights; `feats.js` and `gates.js` write per-hunter `store.device` keys without pruning on hunter delete; `table.js` stores `table-feed` in tab memory without scoping to the active room code.
- **Sequenced fix**:
  1. Prune `picks`, `amounts`, `barsWas`, and `boxes` on fight clear / render diff.
  2. Scope `table-feed` memory by room code and clear it on room change.
  3. Clean up per-hunter `store.device` keys when a hunter is deleted.

#### AW-views-9 (Low) — Stale snapshots across `await` and missing async in-flight guards
- **Evidence**: [src/views/combat.js:297-305](src/views/combat.js#L297-L305), [src/views/combat.js:870-883](src/views/combat.js#L870-L883), [src/views/shadows.js:46-78](src/views/shadows.js#L46-L78), [src/views/inventory.js:218-219](src/views/inventory.js#L218-L219), [src/views/inventory.js:266](src/views/inventory.js#L266), [src/views/gates.js:258-302](src/views/gates.js#L258-L302), [src/views/room.js:284-285](src/views/room.js#L284-L285), [src/views/stories.js:225-232](src/views/stories.js#L225-L232)
- **Problem**: Multiple click handlers capture mutable state (active hunter ID, fight snapshot, shop array index, extraction `left` count) before `await ui.system` / `await ui.confirm`, then use the stale capture after resuming. Several async entry points lack an in-flight lock against double taps.
- **Sequenced fix**:
  1. Re-read current `fight()`, `store.hunter(hid)`, and item ID (not index) after every `await`.
  2. Add single-flight guards on `enterAlone`, `gmrelease`/`gmallow`, and `End story`.

---

### (D) Bugs

#### BUG-views-1 (High) — Closing any detail panel poisons HTML caches so it cannot reopen on the 3rd tap
- **Evidence**: [src/views/detail.js:60-67](src/views/detail.js#L60-L67), [src/views/detail.js:29](src/views/detail.js#L29); broken callers: [src/views/combat.js:828](src/views/combat.js#L828), [src/views/combat.js:863](src/views/combat.js#L863), [src/views/table.js:189](src/views/table.js#L189), [src/views/table.js:413-414](src/views/table.js#L413-L414), [src/views/table.js:478](src/views/table.js#L478), [src/views/table.js:492](src/views/table.js#L492), [src/views/hunter.js:571-575](src/views/hunter.js#L571-L575), [src/views/hunter.js:650-655](src/views/hunter.js#L650-L655), [src/views/odds-box.js:61-63](src/views/odds-box.js#L61-L63)
- **Repro**:
  1. Open Combat view (GM) and tap a status chip or monster ability on the focused card (1st tap opens `.dt`).
  2. Tap the same chip again (2nd tap calls `detail.close()`, which removes `.dt` via `motion.dismiss` without calling `render()`, leaving `patch.ts` `b.last.conds` or `b.last.xtra` holding the open HTML string).
  3. Tap the same chip a 3rd time (`detail.show()` calls `render()`, which generates the identical open HTML string; `patch.ts:52` sees `b.last[k] === v` and skips writing `innerHTML`). Nothing opens.
  4. Same failure occurs on Hunter sheet status chips and stat numbers, Player HUD status chips and token sheet chips, and Odds box details. Additionally, `idOf` (`detail.js:29`) maps punctuation to `_`, allowing ID collisions across distinct keys.
- **Suggested fix**: Store `redraw` in `detail.js` when opening, call `redraw()` inside `close(list)` (animating a detached clone with `motion.fadeOff(p)` before redraw), and percent-encode `list`/`key` in `idOf`.

#### BUG-views-2 (High) — Players can never arm a `when: 'turn'` ("before turn") reaction from their own phone
- **Evidence**: [src/views/table.js:340-345](src/views/table.js#L340-L345), [src/views/combat.js:351-356](src/views/combat.js#L351-L356), [src/views/combat.js:245-251](src/views/combat.js#L245-L251), [src/core/combat/fight.ts:342-343](src/core/combat/fight.ts#L342-L343)
- **Repro**:
  1. Give a player hunter a reaction skill with `react.when === 'turn'` and enter a room fight.
  2. On the player phone, tap the reaction button in the Map hotbar or List HUD.
  3. `table.js:343` posts `arm` with `{ by: S.myKey(h.id), ability, on: null }` and immediately shows `"<Name> is armed."` (`table.js:344`).
  4. On the GM phone, `combat.js:355` forwards `{ type: 'arm', by: r.id, ability: p.ability }` directly to `send(...)` instead of calling `armRow(r, p.ability, p.on)`. `fight.ts:343` refuses with `'noTarget'`, and `combat.js:355` never calls `turnDown`.
- **Suggested fix**: Have `combat.js:355` call `armRow(r, p.ability, p.on ?? null)` (and report refusal via `turnDown`), and let `table.js:armTo` prompt the player to choose the target combatant `on` when `a.react.when === 'turn'`.

#### BUG-views-3 (High) — Reviving a dead remote hunter from Combat view leaves them dead on their phone
- **Evidence**: [src/views/combat.js:1020](src/views/combat.js#L1020), [src/views/gm.js:340-349](src/views/gm.js#L340-L349), [src/core/hunter/vitals.ts:85](src/core/hunter/vitals.ts#L85), [src/edge/room-events.ts:107-130](src/edge/room-events.ts#L107-L130)
- **Repro**:
  1. In a room fight, a remote player's hunter drops to 0 HP and fails 3 death saves (`life.at === 'dead'`).
  2. On the GM phone in Combat view, select that remote hunter's card and click **Revive** (`data-defeat`).
  3. `combat.js:1020` checks `if (k.down && h && lifeCan(h.life, 'revive'))`, which is `false` because `h = localHunter(r)` is `null` for a remote hunter. It falls into `adjust(r, { hp: REVIVE_HP })`, posting only a `vitals` (`setHp(1)`) event.
  4. On the player phone, `vitals.ts:85` defines `TABLE.dead.setHp = null`, so the sheet ignores `vitals` and remains `dead` at 0 HP while the GM's fight tracker shows the hunter alive at 1 HP.
- **Suggested fix**: When `k.down && isRemote(r)` in `combat.js:1020`, post a room `revive` event in the same write as `adjust(r, { hp: REVIVE_HP })` (sharing the exact path `gm.js:340-349` uses).

#### BUG-views-4 (High) — `Save as a new map` closes the dialog and discards all edits on failure
- **Evidence**: [src/views/map-maker.js:148](src/views/map-maker.js#L148), [src/views/maker.js:883](src/views/maker.js#L883), [src/views/maker.js:893](src/views/maker.js#L893)
- **Repro**:
  1. Open an existing map in Map Maker, make edits, clear the Name input (or hit `MAX_MAPS` / read-only tab).
  2. Click **Save as a new map** (`data-mm-asnew`).
  3. `map-maker.js:148` sets `asNew = true` and calls `shell.done(save())`. `save()` calls `shell.error(...)` and returns `undefined`.
  4. `maker.js:883` implements `done(v) { finish(v); }` without checking `v !== undefined`, closing the modal immediately and discarding every unsaved map edit.
- **Suggested fix**: Change `maker.js:883` to `done(v) { if (v !== undefined) finish(v); }` and pass `asNew` as an argument `save(true)` in `map-maker.js:148` instead of mutating `asNew`.

#### BUG-views-5 (High) — Importing a pack or share code in a read-only tab crashes with unhandled `TypeError`
- **Evidence**: [src/views/io.js:108-115](src/views/io.js#L108-L115)
- **Repro**:
  1. Open the app in a second tab (read-only lock).
  2. Paste a valid library share code or import a library JSON file in Data/IO.
  3. `store.apply('import-library', ...)` refuses without running its callback, leaving `report = null`.
  4. Line 110 executes `PACK_KINDS.reduce((x, k) => x + report[k][f], 0)` and throws `TypeError: Cannot read properties of null`.
- **Suggested fix**: Check `if (!w.ok || !report) { ui.toast('Import', 'This tab is read-only.', { kind: 'warning' }); return; }` immediately after `store.apply`.

#### BUG-views-6 (High) — `coin.js` `rule()` sends `coinLand` and loops infinitely in a read-only tab
- **Evidence**: [src/views/coin.js:154-162](src/views/coin.js#L154-L162)
- **Repro**:
  1. On a read-only GM tab with a pending coin call (`c.at === 'called'`), click **Let the coin decide** (or Heads/Tails).
  2. `coin.js:160` ignores the `{ ok: false }` return of `store.apply('coin-rule', ...)`.
  3. Line 161 still calls `sendLanding(body)` to broadcast `coinLand` to the room.
  4. Line 154 calls `ask()` in `finally`; because the save never updated, `c.at` is still `'called'`, immediately re-opening the same dialog. Clicking again rolls a fresh `flip()` and sends a conflicting `coinLand`.
- **Suggested fix**: Capture `const w = store.apply(...)`; if `!w.ok`, show a read-only warning and return without calling `sendLanding(body)` or looping into `ask()`.

#### BUG-views-7 (High) — `quests.js` `fail()` treats refused `{ ok: false }` as truthy and reports failure to GM
- **Evidence**: [src/views/quests.js:99-103](src/views/quests.js#L99-L103), [src/views/quests.js:211](src/views/quests.js#L211), [src/views/quests.js:250-256](src/views/quests.js#L250-L256)
- **Repro**:
  1. On a read-only player tab in a room, trigger `fail()` on an active quest (or let its deadline pass).
  2. `questApply(...)` returns `{ ok: false, why: 'read-only' }`, which is a truthy object.
  3. Unlike `deleteQuest` (`quests.js:211`), `fail()` (`quests.js:253`) tests `if (!questApply(...)) return false;`, passes through, calls `sendUpdate(h.id, q, 'failed')` to notify the GM, and returns `true` while the local quest remains active.
- **Suggested fix**: Check `const r = questApply(...); if (!r || 'why' in r) return false;` (or return `{ ok: true, quest } | { ok: false, why }` consistently from `questApply`).

#### BUG-views-8 (High) — `map.mount()` leaks `window` `resize` listeners and fails to reset state across fights
- **Evidence**: [src/views/map.js:286-289](src/views/map.js#L286-L289), [src/views/map.js:698](src/views/map.js#L698), [src/views/map.js:746](src/views/map.js#L746), [src/views/map.js:760-768](src/views/map.js#L760-L768), [src/views/combat.js:1164-1179](src/views/combat.js#L1164-L1179), [src/views/table.js:470-474](src/views/table.js#L470-L474)
- **Repro**:
  1. Start a fight, toggle Map/List in `table.js` (or end/clear and start a new fight in `combat.js`). Each mount adds a permanent `window` `resize` listener and `IntersectionObserver` closing over the detached DOM tree.
  2. On a persistent map (`table.js`), pan/zoom to a corner during Fight 1 (12x10 open arena). End Fight 1 (`!input` hits `map.js:746`) and start Fight 2 (also 12x10).
  3. Because `fitted` is still `'12x10'`, `fit()` is skipped (`map.js:762`), leaving the viewport panned to Fight 1's corner; `was`, `zonesWas`, `edges`, `brush`, `choice`, and any pending `holdTimer` from Fight 1 also carry over.
- **Suggested fix**: Return a `destroy()` cleanup from `map.mount()` and call it before replacing container HTML in `combat.js` and `table.js`. Reset `fitted`, `was`, `zonesWas`, `edges`, `choice`, `brush`, `g`, and `holdTimer` whenever `!input` or the fight ID changes.

#### BUG-views-9 (Med) — Modal stack/z-order inversion and phantom `'open'` entry on `show()` throw
- **Evidence**: [src/views/ui.js:143-145](src/views/ui.js#L143-L145), [src/views/ui.js:187-188](src/views/ui.js#L187-L188), [src/views/ui.js:221-225](src/views/ui.js#L221-L225), [src/views/ui.js:238-241](src/views/ui.js#L238-L241)
- **Repro**:
  1. Queue a `system()` window while another `system()` window is open (e.g. room broadcast arrives).
  2. Before the first closes, open a maker/shelf/story window via `openWindow`.
  3. Close the first `system` window. `openNext()` appends the queued `system` window to `document.body` (visually on top of the maker), but leaves it earlier in `stack[]`.
  4. Pressing `Escape` or `Tab` routes to the maker underneath instead of the visible System window. Separately, if any `openWindow` `show()` throws, `stack.push(w)` at line 187 leaves a permanent `'open'` entry.
- **Suggested fix**: Move a `system` entry to the top of `stack` when `openNext()` appends it to the DOM, and push to `stack` only after `show()` succeeds.

#### BUG-views-10 (Med) — `hunter.js` `deleteHunter` posts room tombstone early and deletes on Cancel
- **Evidence**: [src/views/hunter.js:253-267](src/views/hunter.js#L253-L267)
- **Repro**:
  1. In a room with only 1 local hunter, click Delete and confirm the first dialog.
  2. Line 260 immediately calls `app.api.sync.forget(h.id)` (posting a room tombstone) BEFORE line 262 (`await ui.promptText('Name your new hunter')`) and BEFORE line 264 (`store.apply('hunter-delete', ...)`).
  3. Clicking **Cancel** on the replacement-hunter prompt (`nn === null`) still deletes the hunter and silently creates `"Hunter"`. In a read-only tab, the hunter is tombstoned out of the room while staying locally and toasting `"was deleted"`.
- **Suggested fix**: Abort if `nn === null`, check `store.apply(...).ok`, and call `sync.forget(h.id)` and `ui.toast(...)` only after the save write succeeds.

#### BUG-views-11 (Med) — `uses.cast` ignores walls and line-of-sight when choosing targets
- **Evidence**: [src/views/uses.js:75](src/views/uses.js#L75)
- **Repro**:
  1. In a room fight on a map with walls, switch to Skills, Bag, or List HUD on a player's turn and use a ranged ability.
  2. `uses.js:75` computes `aims(docSpots(t.doc.rows), t.me.id, a, openGrid(t.doc.grid.w, t.doc.grid.h))` instead of `docGround(t.doc).grid`.
  3. Foes behind walls appear as selectable targets; picking one posts a `cast` that the GM's reducer refuses.
- **Suggested fix**: Import `docGround` from `../core/combat/map-view.ts` and pass `docGround(t.doc).grid` to `aims(...)`.

#### BUG-views-12 (Med) — Skill `Lv +` toast always displays the old level and never shows `(MAX)`
- **Evidence**: [src/views/skills.js:321-325](src/views/skills.js#L321-L325)
- **Repro**:
  1. Upgrade any skill from Lv.1 to Lv.2 (or Lv.9 to Lv.10).
  2. `levelUpSkill` is immutable, so the pre-upgrade reference `s` still has `s.level === 1` (or `9`).
  3. Line 323 toasts `"reached Lv.1."` (or `"reached Lv.9."` without `(MAX)`).
- **Suggested fix**: Re-read the upgraded skill (`find(s.id)`) or compute `const nextLv = s.level + 1` after `onSkills(...).ok`.

#### BUG-views-13 (Med) — Cancelling Shadow Extraction in Combat view toasts `"Extraction of X failed."`
- **Evidence**: [src/views/combat.js:1035-1037](src/views/combat.js#L1035-L1037), [src/views/shadows.js:48-58](src/views/shadows.js#L48-L58)
- **Repro**:
  1. Click **Extract** on a defeated monster in Combat view.
  2. Click **Cancel** in the Shadow Extraction confirmation dialog (or trigger when the army is full).
  3. `shadows.extract()` returns `null`; `combat.js:1037` checks `if (rowOf(fight(), r.id)) toast(made ? ... : \`Extraction of ${r.name} failed.\`)`, displaying a bogus failure toast even though no roll occurred.
- **Suggested fix**: Return a discriminated outcome from `shadows.extract()` (`'risen' | 'failed' | 'cancelled' | 'blocked'`) and toast failure only on `'failed'`.

#### BUG-views-14 (Med) — Zone-end validation error banner in Ability Maker stays stale after clicking buttons
- **Evidence**: [src/views/maker.js:734](src/views/maker.js#L734), [src/views/maker.js:753](src/views/maker.js#L753), [src/views/maker.js:799](src/views/maker.js#L799), [src/views/maker.js:811](src/views/maker.js#L811)
- **Repro**:
  1. In Skill Maker, open "Leaves a field", tick "Leaves a field", then tick "Something lands when it ends". `[data-zend-err]` shows `"Add what lands when it ends."` and Save disables.
  2. Click a Quick chip (e.g. `Damage 2d6`) inside `[data-zend-fx]`.
  3. `effects` dispatches an `input` event on `[data-zend-fx]`. Save enables via `win`'s listener, but `buildAbility`'s listener (`maker.js:811`) only checks `e.target.dataset.a || 'ztrig' in e.target.dataset`. `draw()` never runs, leaving `"Add what lands when it ends."` stuck on screen. Removing all effects likewise leaves `[data-zend-err]` blank while Save disables.
- **Suggested fix**: Update `maker.js:811` to also call `draw()` when `e.target.closest('[data-zend-fx],[data-zone-fx]')` matches.

#### BUG-views-15 (Med) — Switching active hunter while inline quest Edit form is open corrupts save or traps GM
- **Evidence**: [src/views/quests.js:344-400](src/views/quests.js#L344-L400)
- **Repro**:
  1. Click **Edit** on a quest for Hunter A (`editId` is set; for GM, `[data-who]` is hidden).
  2. Switch the active hunter in the header to Hunter B. `quests.js` `update()` does not close the form or clear `editId`.
  3. Click Save. `store.active().quests.find(x => x.id === editId)` returns `undefined`, falling into the `else` (new quest) branch. A player silently creates a duplicate quest on Hunter B; a GM gets `"Pick at least one hunter."` while `[data-who]` remains `hidden`.
- **Suggested fix**: Track the hunter ID the form opened for and reset/hide the form in `update()` whenever `store.active().id` changes.

#### BUG-views-16 (Med) — Player consumable use bypasses turn `hold`, and outbox `'dropped'` never releases `hold`
- **Evidence**: [src/views/table.js:230](src/views/table.js#L230), [src/views/table.js:314](src/views/table.js#L314), [src/views/table.js:317](src/views/table.js#L317)
- **Repro**:
  1. On a player's turn in List HUD or Desktop Kit, tap **Use** on a consumable (`data-cast` for an item ability at `:314` or `data-kit-item` at `:317`).
  2. Unlike skills (`:315`), neither path wraps the call in `sent(e, ...)`, so buttons stay enabled and a second tap double-submits while waiting on the GM.
  3. Separately, if a held `cast`/`step`/`pass` outbox entry emits `sync:outbox` with `o.at === 'dropped'`, `:230` checks only `o.at === 'refused'`, leaving `hold` stuck until a new fight doc arrives.
- **Suggested fix**: Have `inventory.use` return the `uses.cast` promise when `onTable`, wrap `:314` and `:317` in `sent(e, ...)`, and release `hold` on both `o.at === 'refused'` and `o.at === 'dropped'`.

#### BUG-views-17 (Med) — `story-maker.js` skips quest validation on collapsed chapters
- **Evidence**: [src/views/story-maker.js:158-160](src/views/story-maker.js#L158-L160)
- **Repro**:
  1. Create a 2-chapter story. In Chapter 1, enable "Issues a quest", set kind to `job`, and leave the job reward empty.
  2. Expand Chapter 2 (which collapses Chapter 1 and calls `keep()`).
  3. Click Save. `story-maker.js:158` checks `if (quest) { const why = quest.check(); ... }` only on the currently open chapter (Chapter 2), allowing Chapter 1's invalid quest past validation.
- **Suggested fix**: Validate every chapter's `c.quest` in `save()` using a shared pure quest validator (not just the currently mounted `quest` editor).

#### BUG-views-18 (Med) — Rules reference view misses room rule updates and hardcodes shadow extraction minimum DC
- **Evidence**: [src/views/rulesref.js:187](src/views/rulesref.js#L187), [src/views/rulesref.js:249](src/views/rulesref.js#L249)
- **Repro**:
  1. As a player in a room, open the Rules view. Then have the GM toggle Feats or change Solo/Build rules (synced via the room's `rules` doc).
  2. `rulesref.js:249` computes `sig` from `store.get().rulesOverrides` (the player's local overrides, unchanged) and never includes `app.rules()`, so the Rules view stays permanently stale.
  3. If the GM overrides `shadow.dcMin` (e.g. to `8`), line 187 still prints hardcoded `(minimum 5)`.
- **Suggested fix**: Key `sig` on `app.rules()` (or include `app.api.sync.doc('rules')`) and interpolate `${R.shadow.dcMin}` at `rulesref.js:187`.

#### BUG-views-19 (Med) — `gm.js` shows broadcast popup before save commits and reports success on read-only refusals
- **Evidence**: [src/views/gm.js:471-476](src/views/gm.js#L471-L476), [src/views/gm.js:510-511](src/views/gm.js#L510-L511), [src/views/gm.js:760](src/views/gm.js#L760), [src/views/gm.js:796-797](src/views/gm.js#L796-L797), [src/views/gates.js:587-588](src/views/gates.js#L587-L588)
- **Repro**:
  1. On a read-only GM tab, click **Send broadcast**. Line 471 pops the System broadcast locally, then line 476 silently returns on `!gmWrite(...)` with no error message (and line 474 ignores `addLog` failure completely).
  2. On the same read-only tab, click **Spawn gate** (`gates.js:587` ignores `store.apply`'s `.ok` and returns the unsaved gate, so `gm.js:511` reports `"Gate spawned: ..."`), apply typed local HP (`gm.js:760` reports `"Damaged/Healed"`), or save/reset roll tables (`gm.js:796-797` clears `dirty` and reports `"Saved"` / `"Reset"`).
- **Suggested fix**: Run `gmWrite` before calling `ui.system` in `doBroadcast` and report failure in `#gm-b-msg`. Return `null` from `gates.spawn` on `!w.ok`. Check boolean return values from `hunter.damage`/`heal`, `saveList`, and `resetList` before reporting success.

#### BUG-views-20 (Med) — `combat.js` uses stale fight snapshots across `await` and ignores `add`/`adjust` refusals
- **Evidence**: [src/views/combat.js:297-305](src/views/combat.js#L297-L305), [src/views/combat.js:385-388](src/views/combat.js#L385-L388), [src/views/combat.js:513-516](src/views/combat.js#L513-L516), [src/views/combat.js:870-883](src/views/combat.js#L870-L883), [src/views/combat.js:998](src/views/combat.js#L998)
- **Repro**:
  1. In `setIntent` (`:870-883`), `f` is captured before two `await ui.system(...)` calls. If a player moves while the GM is picking the monster's intent, `:876` and `:881` compute targets and `place` coordinates from the stale `f` (same stale `list` capture in `useAbility` at `:297-305`).
  2. Click **Add whole party** (`:998`) or type an HP amount (`:385`) in a read-only tab. Both ignore refusal and announce `"N hunters added."` / `"Goblin took 0 (asked 7)."` while clearing the input.
  3. In `startFlow` (`:513-516`), if `add(...)` returns `0` (refused), `start()` still runs and `startFlow` returns `true`.
- **Suggested fix**: Re-read `fight()` after each `await` in `setIntent` and `useAbility` (resolving current target tile at confirm time), check `if (add(...))` in `:998` and `:513`, and bail early if `!adjust(...)` in `:385`.

#### BUG-views-21 (Med) — Concurrency, disabled-button trap, and shared mutable dialog state in `gates.js`, `onboard.js`, and `custom.js`
- **Evidence**: [src/views/gates.js:258-302](src/views/gates.js#L258-L302), [src/views/gates.js:595-599](src/views/gates.js#L595-L599), [src/views/onboard.js:173-183](src/views/onboard.js#L173-L183), [src/views/custom.js:72-101](src/views/custom.js#L72-L101), [src/views/custom.js:193-196](src/views/custom.js#L193-L196)
- **Repro**:
  1. Double-tap **Enter alone** on an open gate while `api.odds.ask` runs (`gates.js:264`). Two confirm dialogs queue; if Run 1 loses (gate stays open), confirming Dialog 2 immediately executes a second solo run. Also `gates.js:595, 599` deletes `openPanel` before `store.apply` succeeds.
  2. On an invite link (`onboard.js:173-183`), if `go('joined', ...)` fails and returns `false`, line 181 returns early without clearing `joinBtn.disabled` or `aria-busy`, permanently trapping the button.
  3. Calling `identity.edit` (`custom.js:72-101`) while another identity modal is open/queued overwrites the module-level `pick` singleton; `LO.swap` (`custom.js:193-196`) ignores `store.apply` refusal and still toasts `"equipped."`.
- **Suggested fix**: Guard `enterAlone` with an in-flight Set per gate ID; restore `joinBtn.disabled = false` on `!go(...)` in `onboard.js:181`; make `pick` local to `identity.edit()` and check `store.apply().ok` in `LO.swap`.

#### BUG-views-22 (Low) — Multiple mounted `map.js` instances collide on hardcoded `'map'` detail key
- **Evidence**: [src/views/map.js:472](src/views/map.js#L472), [src/views/map.js:481-489](src/views/map.js#L481-L489)
- **Repro**:
  1. Switch roles between GM and Player during one session so both `combat.js` and `table.js` have mounted `map.js` instances in the DOM.
  2. Open a zone or ability detail in one map. Both instances pass `'map'` to `detail.js`, colliding on `open.get('map')`, `id="dt-map-..."`, and leaving the other instance's `mapDt` out of sync.
- **Suggested fix**: Allocate a unique list key per `map.mount()` call (e.g. `const dtList = \`map-${++mapSeq}\``).

#### BUG-views-23 (Low) — Secondary async and stale-state UI defects across `table.js`, `shadows.js`, `inventory.js`, `stories.js`, `dice.js`, and `bestiary.js`
- **Evidence**: [src/views/table.js:566-585](src/views/table.js#L566-L585), [src/views/shadows.js:46-78](src/views/shadows.js#L46-L78), [src/views/shadows.js:158](src/views/shadows.js#L158), [src/views/inventory.js:218-219](src/views/inventory.js#L218-L219), [src/views/inventory.js:254](src/views/inventory.js#L254), [src/views/inventory.js:266](src/views/inventory.js#L266), [src/views/stories.js:225-232](src/views/stories.js#L225-L232), [src/views/dice.js:219-221](src/views/dice.js#L219-L221), [src/views/bestiary.js:404-407](src/views/bestiary.js#L404-L407)
- **Repro**:
  - `table.js:566-585`: Switch rooms as GM; `table-feed` still shows feed rows from the previous room.
  - `shadows.js:158`: Focus a shadow's `textarea[data-notes]`, receive a store update, then blur without editing; `update()` early-returned while focused and never redraws on blur. Also `shadows.js:46-78` captures stale `h`/`c.left`/`bonus` across `await ui.system`.
  - `inventory.js:218-219, 254, 266`: `openForm` reads `store.active().id` after `await`; `sell` checks `if (got)` so selling a 0-gold item suppresses the toast; `shopDel` deletes by array index after `await ui.confirm`.
  - `stories.js:225-232`: Double-clicking **End story** spawns two held toasts; clicking Undo on the second still lets the first toast end the story.
  - `dice.js:219-221`: Switch active hunter to a different rank; Quick Check keeps the first hunter's default DC because `inst.dcInit` is already `true`.
  - `bestiary.js:404-407`: `toCombatant` allocates store IDs before `await combat.okToReplace()`, and toasts `"added"` without checking `combat.add`'s return count.
- **Suggested fix**: Scope `table-feed` by room code; trigger `render()` on notes `blur` in `shadows.js`; capture `hid` before `await` and delete shop entries by ID in `inventory.js`; deduplicate `End story` by `runId`; track `{ hid, rank }` in `dice.js`; move `toCombatant` after `okToReplace()` and check `if (add(...))` in `bestiary.js`.

#### BUG-views-24 (Low) — DOM, boundary, and math edge-case defects in `app.js`, `room.js`, `quest-fields.js`, `workshop.js`, and `motion.ts`
- **Evidence**: [src/app.js:121-129](src/app.js#L121-L129), [src/app.js:145-157](src/app.js#L145-L157), [src/views/room.js:263-271](src/views/room.js#L263-L271), [src/views/quest-fields.js:76](src/views/quest-fields.js#L76), [src/views/workshop.js:292-294](src/views/workshop.js#L292-L294), [src/views/motion.ts:288-303](src/views/motion.ts#L288-L303)
- **Repro**:
  - `app.js:152-155`: If a panel's `when()` throws, `mountPart` still runs `p.mount()` before `updatePart` marks the panel `'failed'`.
  - `room.js:263-271`: Clicking QR enlarge when another System window is open (or under `E2E_POPUP_DELAY`) queries `.sys-overlay.show .rm-sys-qr` synchronously, misses it, and leaves the QR tiny (`px0 = s * 2`).
  - `quest-fields.js:76`: An invalid `datetime-local` value passed to `new Date(at.value).toISOString()` throws `RangeError`.
  - `workshop.js:292-294`: Preserves `.ws-fold` open state by DOM index rather than section key, shifting folds when sections appear/disappear.
  - `motion.ts:288-303`: If `--t-slow` is missing or `0` and `now === t0`, `countTo` computes `(now - t0) / dur` (`0 / 0 = NaN`) and writes `NaN` into the DOM.
- **Suggested fix**: Check `asked(p)` before `mountPart(p)` in `app.js`; size the QR canvas inside a `ui.system` mount callback; guard `Number.isNaN(d.getTime())` in `quest-fields.js:76`; key `.ws-fold` open state by `dataset.fold`; return final value immediately when `dur <= 0` in `motion.ts:288`.

---

### (E) ALL findings in one list ordered by importance

1. **BUG-views-1** | High | [src/views/detail.js:60-67](src/views/detail.js#L60-L67) | `detail.close()` removes `.dt` imperatively without redrawing, poisoning 7 caller HTML caches so panels cannot reopen on 3rd tap | Call stored `redraw()` from `detail.close()` and percent-encode `idOf`
2. **BUG-views-2** | High | [src/views/table.js:340-345](src/views/table.js#L340-L345) | Players can never arm `when: 'turn'` reactions (`table.js` sends `on: null`, `combat.js:355` skips `armRow`, `fight.ts:343` refuses) | Route `sync:event` `arm` through `armRow` and prompt players for `on` on `turn` reactions
3. **BUG-views-3** | High | [src/views/combat.js:1020](src/views/combat.js#L1020) | Reviving a dead remote hunter from Combat card sends `vitals` (`setHp`) instead of `revive`, leaving them `dead` on their phone | Post room `revive` event in the same write as `adjust` when reviving a remote hunter
4. **BUG-views-4** | High | [src/views/map-maker.js:148](src/views/map-maker.js#L148) | `Save as a new map` calls `shell.done(save())`, closing the dialog and losing all unsaved edits when `save()` fails and returns `undefined` | Guard `shell.done(v)` with `if (v !== undefined)` in `maker.js:883` and pass `asNew` as an arg
5. **BUG-views-5** | High | [src/views/io.js:108-115](src/views/io.js#L108-L115) | Importing a library pack or share code in a read-only tab throws unhandled `TypeError` on `report === null` | Check `store.apply` `.ok` and `report` before summarizing import counts
6. **BUG-views-6** | High | [src/views/coin.js:154-162](src/views/coin.js#L154-L162) | `coin.js` `rule()` ignores read-only `store.apply` refusal, still sends `coinLand`, and loops infinitely with new random flips | Check `store.apply(...).ok` before `sendLanding` and abort re-asking on refusal
7. **BUG-views-7** | High | [src/views/quests.js:250-256](src/views/quests.js#L250-L256) | `quests.js` `fail()` treats refused `{ ok: false, why }` as truthy and still reports quest failure to GM | Check `!r || 'why' in r` before `sendUpdate` in `fail()`
8. **BUG-views-8** | High | [src/views/map.js:286-289](src/views/map.js#L286-L289) | `map.mount()` leaks `window` `resize` listeners/`IntersectionObserver` on remount and keeps stale pan/zoom/gesture/zone state across fights | Return `destroy()` from `map.mount()` and reset map/gesture/choice state on `!input` or fight change
9. **AW-views-1** | High | [src/views/gm.js:471-476](src/views/gm.js#L471-L476) | Systemic unchecked or misattributed `store.apply` read-only refusals across ~18 view files | Audit all `store.apply` callers, distinguish `'read-only'` from domain errors, and lint unused results
10. **AW-views-3** | High | [src/views/detail.js:60-67](src/views/detail.js#L60-L67) | Imperative DOM removal in `detail.js` violates `patch.ts`/`dataset.sig`/`_h` render cache contracts | Make `detail.js` drive all DOM updates through caller `redraw()` callbacks
11. **SM-views-2** | High | [src/views/detail.js:28-69](src/views/detail.js#L28-L69) | Detail disclosure state is split across `detail.js` `open`, caller caches, and `map.js` `mapDt` | Consolidate open state + `redraw` in `detail.js` with per-instance map list keys
12. **SM-views-3** | High | [src/views/map.js:742-772](src/views/map.js#L742-L772) | Battle map mount/active/idle/unmount lifecycle is unmodeled and violates `gesture`/`choose` teardown invariants | Add explicit `reset()` on `!input`/fight-ID change and `destroy()` on unmount
13. **SM-views-1** | High | [src/views/ui.js:126-316](src/views/ui.js#L126-L316) | Modal queue/stack and held-toast lifecycle split across `stack[]`, `refreshCur`, timers, and DOM expandos | Model modal stack/queue in a pure state reducer and replace toast expandos with a `Map`
14. **AW-views-2** | High | [tsconfig.views.json:1-15](tsconfig.views.json#L1-L15) | All 38 `.js` views and `src/app.js` run under loose TS (`strictNullChecks: false`), hiding null derefs and ignored results | Incrementally enable `strictNullChecks` / migrate views to `.ts` and remove DOM expandos
15. **BUG-views-9** | Med | [src/views/ui.js:221-241](src/views/ui.js#L221-L241) | Queued `system` window opens visually above `openWindow` while behind in `stack[]`, misrouting `Escape`/`Tab`; thrown `show()` wedges stack | Move `system` entry to top of `stack` on dequeue and push only after `show()` succeeds
16. **BUG-views-10** | Med | [src/views/hunter.js:253-267](src/views/hunter.js#L253-L267) | `deleteHunter` posts room tombstone before replacement prompt and `store.apply`, and deletes even on Cancel | Abort on prompt Cancel, check `store.apply().ok`, then call `sync.forget` and toast
17. **BUG-views-11** | Med | [src/views/uses.js:75](src/views/uses.js#L75) | `uses.cast` builds target list with `openGrid` instead of `docGround(t.doc).grid`, ignoring walls and LOS | Pass `docGround(t.doc).grid` to `aims(...)` in `uses.js:75`
18. **BUG-views-12** | Med | [src/views/skills.js:321-325](src/views/skills.js#L321-L325) | Skill `Lv +` toast reads pre-upgrade `s.level`, always showing old level and never `(MAX)` | Read upgraded skill level (or `s.level + 1`) after `onSkills(...).ok`
19. **BUG-views-13** | Med | [src/views/combat.js:1035-1037](src/views/combat.js#L1035-L1037) | Cancelling or blocking Shadow Extraction in Combat view toasts `"Extraction of X failed."` | Return a discriminated extraction outcome and toast failure only on `'failed'`
20. **BUG-views-14** | Med | [src/views/maker.js:811](src/views/maker.js#L811) | `buildAbility` `input` listener ignores `[data-zend-fx]`, leaving zone-end error banner stuck after button clicks | Call `draw()` when `input` originates inside `[data-zend-fx]` or `[data-zone-fx]`
21. **BUG-views-15** | Med | [src/views/quests.js:344-400](src/views/quests.js#L344-L400) | Switching active hunter while inline quest Edit form is open creates duplicates or traps GM on hidden `[data-who]` | Reset/hide the inline quest form when `store.active().id` changes
22. **BUG-views-16** | Med | [src/views/table.js:230](src/views/table.js#L230) | Player List HUD/Desktop Kit consumables bypass `hold` double-submit guard, and `'dropped'` outbox events never release `hold` | Route consumable casts through `sent(e, ...)` and release `hold` on `o.at === 'dropped'`
23. **BUG-views-17** | Med | [src/views/story-maker.js:158-160](src/views/story-maker.js#L158-L160) | `story-maker.js` `save()` only validates `quest.check()` on the currently open chapter | Validate every chapter's quest data in `save()` regardless of accordion state
24. **BUG-views-18** | Med | [src/views/rulesref.js:249](src/views/rulesref.js#L249) | Rules view cache omits room `rules` doc (stale for players) and line 187 hardcodes `(minimum 5)` instead of `R.shadow.dcMin` | Include `app.rules()` in `rulesref.js` `sig` and interpolate `R.shadow.dcMin`
25. **BUG-views-19** | Med | [src/views/gm.js:471-476](src/views/gm.js#L471-L476) | `gm.js` pops broadcast before `gmWrite` and reports success on read-only refusals in `doSpawn`, `typedHp`, and roll tables | Write before popping broadcast and gate all GM success messages on write `.ok`
26. **BUG-views-20** | Med | [src/views/combat.js:870-883](src/views/combat.js#L870-L883) | `combat.js` captures stale `fight()` across `await` in `setIntent`/`useAbility` and ignores refusal in `addparty`/`applyAmount`/`startFlow` | Re-read `fight()` after `await` and check return values of `add()` and `adjust()`
27. **BUG-views-21** | Med | [src/views/gates.js:258-302](src/views/gates.js#L258-L302) | `enterAlone` allows double solo run, `onboard.js:181` permanently disables Join on failure, `custom.js:72` shares mutable `pick` | Add in-flight guard to `enterAlone`, restore `joinBtn` on failure, make `pick` local, check `LO.swap` `.ok`
28. **SM-views-4** | Med | [src/views/table.js:217-230](src/views/table.js#L217-L230) | Player turn `hold` state has inconsistent entry points and missing release transitions | Funnel all turn actions through one `free | posting | waiting` state machine
29. **SM-views-6** | Med | [src/views/quests.js:297-400](src/views/quests.js#L297-L400) | Inline quest form mode spread across `editId`, `f.hidden`, `who.hidden`, and `autoTitle` | Replace with explicit `closed | new(hid) | edit(hid, qid)` state
30. **SM-views-9** | Med | [src/views/maker.js:883-919](src/views/maker.js#L883-L919) | Maker shell `done()`, `map-maker.js` `asNew`, and lazy `zendFx` sentinel permit inconsistent form states | Guard `done(v)`, pass `asNew` explicitly, and sync `zendErr` on `zendFx` edits
31. **SM-views-8** | Med | [src/views/onboard.js:157-229](src/views/onboard.js#L157-L229) | Invite sub-step uses local `failed` boolean and imperative button disabling outside `onboard.ts` | Model invite sub-step as `ready | joining | retry(err)` with single render function
32. **SM-views-7** | Med | [src/views/room.js:62](src/views/room.js#L62) | Room lobby mutable `view` bag and unguarded async `gmrelease`/`gmallow` handlers race on fast taps | Use explicit lobby check/join state and disable GM seat buttons while in flight
33. **SM-views-5** | Med | [src/app.js:110-173](src/app.js#L110-L173) | View/panel `state` mounts a panel even if its `when()` threw before marking it `'failed'` | Evaluate `when()` before `mountPart()` on first visit
34. **AW-views-6** | Med | [src/views/maker.js:1006-1010](src/views/maker.js#L1006-L1010) | Global `document.body` `MutationObserver` scans every app DOM mutation; `option.hidden` fails on mobile pickers | Scope `searchable()` to makers and detach/re-attach `<option>` nodes instead of `option.hidden`
35. **AW-views-4** | Med | [src/views/combat.js:1-1246](src/views/combat.js#L1-L1246) | Seven 640-to-1246-line god view files mix CSS, templates, async dialogs, and sync handlers | Extract focused helpers from `maker.js`, `combat.js`, and `gm.js`
36. **AW-views-5** | Med | [src/views/rulesref.js:44-59](src/views/rulesref.js#L44-L59) | Duplicated `canon()` (5x), `flash()` (2x), `guard()`, `highest()`, and view-resident `parseQuick()` | Consolidate shared helpers in `src/core/` and `src/views/ui.js`
37. **AW-views-7** | Med | [docs/dependency-map.md:14](docs/dependency-map.md#L14) | `src/edge/sync.ts` and `src/edge/room-pill.ts` import `App` from `src/views/app.ts` | Move edge-facing `App` types out of `src/views/` and lint `edge -> views` imports
38. **AW-views-8** | Med | [src/views/odds-box.js:28](src/views/odds-box.js#L28) | Unbounded view Maps (`boxes`, `barsWas`, `picks`, `amounts`), unscoped `table-feed`, and uncollected `store.device` keys | Prune view Maps on render/clear, scope `table-feed` by room, clean up device keys on hunter delete
39. **AW-views-9** | Low | [src/views/shadows.js:46-78](src/views/shadows.js#L46-L78) | Stale entity/index captures across `await` and missing in-flight guards in secondary views | Re-read fresh state after `await` and add in-flight guards
40. **SM-views-10** | Low | [src/views/story-maker.js:49-53](src/views/story-maker.js#L49-L53) | Story accordion lazy validation and Dice `dcInit`/`isOpen` flags permit stale UI states | Validate all chapters on save and key Dice DC init by `{ hid, rank }`
41. **BUG-views-22** | Low | [src/views/map.js:481-489](src/views/map.js#L481-L489) | Multiple mounted `map.js` instances collide on hardcoded `'map'` key in `detail.js` | Give each `map.mount()` instance its own unique detail list key
42. **BUG-views-23** | Low | [src/views/inventory.js:218-266](src/views/inventory.js#L218-L266) | Stale/async edge bugs in `table-feed`, `shadows.js` notes blur, `inventory.js` shop index/0g sell, `stories.js` double-end, `dice.js` DC, `bestiary.js` IDs | Scope feed by room, redraw on notes blur, use IDs not indices, deduplicate held end-story toasts
43. **BUG-views-24** | Low | [src/views/motion.ts:288-303](src/views/motion.ts#L288-L303) | Edge defects in `app.js` panel mount-on-throw, `room.js` QR sizing, `quest-fields.js` invalid date, `workshop.js` fold index, `motion.ts` div-by-0 | Guard `when()` before mount, size QR on open, check `isNaN(date)`, key folds, guard `dur <= 0`

---

### (C) Top 10 to fix first, and what is already good and must be protected

#### Top 10 to fix first
1. **`BUG-views-1` (`detail.js:60-67`)** — One small fix restores broken detail reopening across 7 sites in Combat, Table HUD, Hunter sheet, and Odds box.
2. **`BUG-views-2` (`table.js:340-345`, `combat.js:351-356`)** — Unblocks an entire feature class (player `when: 'turn'` reactions) that currently fails 100% of the time while lying to the player.
3. **`BUG-views-3` (`combat.js:1020`)** — Eliminates permanent GM/player state split when reviving a dead remote hunter from Combat view.
4. **`BUG-views-4` (`map-maker.js:148`, `maker.js:883`)** — Prevents silent total data loss of unsaved map edits on `Save as a new map` failure.
5. **`BUG-views-8` (`map.js:286-289, 746, 760-768`)** — Stops permanent `window` listener and DOM leaks on every fight/view switch and fixes stale camera/state between fights.
6. **`BUG-views-5`, `BUG-views-6`, `BUG-views-7` (`io.js:108-115`, `coin.js:154-162`, `quests.js:250-256`)** — Eliminates the read-only crash, infinite conflicting `coinLand` broadcast loop, and bogus quest-fail report to GM.
7. **`BUG-views-10` (`hunter.js:253-267`)** — Stops tombstoning a player's hunter out of the room when deleting is cancelled or read-only.
8. **`BUG-views-11` (`uses.js:75`)** — Fixes wall/LOS bypass in Skills, Bag, and List HUD target pickers with a one-line swap to `docGround(t.doc).grid`.
9. **`BUG-views-9` (`ui.js:187-188, 221-241`)** — Fixes inverted modal keyboard routing and prevents a single `show()` exception from wedging the app's modal stack.
10. **`BUG-views-12`, `BUG-views-13`, `BUG-views-14` (`skills.js:321-325`, `combat.js:1035-1037`, `maker.js:811`)** — Three trivial, user-visible daily UX defects (wrong level toast, bogus extraction failure toast on Cancel, stuck zone-end error text).

#### What is already good and must be protected
- **Strict core/view separation enforced by lint tests** ([tests/lint.test.ts:1-489, 801-1285](tests/lint.test.ts#L1-L489)): `src/core/` stays pure, views mutate saves only through `store.apply` with core steps, and every view timer, `let`, and container is inventoried. Keep and extend these lint tests (especially for `store.apply` return checks and `edge -> views` imports).
- **26 explicitly modeled domain state machines** ([docs/state-machines.md](docs/state-machines.md)): Modeling `vitals`, `fight`, `fight-react`, `gesture`, `choose`, `coin`, `outbox`, `store-life`, `onboard`, and `story` as pure tables/reducers prevented far worse UI state soup.
- **Keyed in-place DOM patching (`patch.ts`) and unified compositor motion (`motion.ts`)** ([src/views/patch.ts](src/views/patch.ts), [src/views/motion.ts](src/views/motion.ts)): `patch.ts` avoids DOM thrashing while keeping templates declarative, and `motion.ts:108-112` already guards `hide()` against animation cancellation (`mine.playState === 'finished'`), respects reduced motion, and avoids layout-thrashing properties.
- **Atomic single-write room/save orchestration (`gmWrite` and `combat.js` `command`)** ([src/views/gm.js:116-121](src/views/gm.js#L116-L121), [src/views/combat.js:111-139](src/views/combat.js#L111-L139)): Combining save mutation, outbox enqueue, and session log lines in one `store.apply` before `sync.flush()` is the right pattern. Extending it to `doBroadcast`, `doIssue`, and `deleteHunter` will close the remaining split-write holes.
- **No silent error swallowing in views**: Our `catch` sweep across `src/views/` and `src/app.js` confirmed that every `catch` either logs via `reported(...)`, surfaces user-facing feedback, or documents an intentional browser-API fallback (clipboard/pointer capture).

---

### Coverage

- **Read fully**:
  - All 12 pstack skill files in `.claude/skills/*/SKILL.md`
  - Architecture docs: `README.md`, `AGENTS.md`, `docs/state-machines.md` (all 2,002 lines), `docs/GAME-UPDATE.md`, all 9 files in `docs/guide/*.md`, `docs/agent-handoff/START-HERE.md`, `handoff.md`, `landed.md`, `review.md`, `tsconfig.json`, `tsconfig.views.json`
  - **All 42 files in the deep-read lane (100% coverage)**: `src/app.js` plus all 41 files in `src/views/` (`app.ts`, `bestiary.js`, `chronicle.js`, `coin.js`, `combat.js`, `custom.js`, `detail.js`, `dice.js`, `effects.js`, `feat-maker.js`, `feats.js`, `forge.js`, `gates.js`, `give-shelf.js`, `gm.js`, `hunter.js`, `inventory.js`, `io.js`, `kit-parts.js`, `loot.js`, `maker.js`, `map-maker.js`, `map.js`, `motion.ts`, `odds-box.js`, `onboard.js`, `patch.ts`, `quest-fields.js`, `quests.js`, `reward-editor.js`, `room.js`, `rulesref.js`, `shadows.js`, `skills.js`, `starter.js`, `stories.js`, `story-maker.js`, `table.js`, `ui.js`, `uses.js`, `workshop.js`)
  - Cross-module confirmations read fully: `src/core/party.ts`, `src/core/combat/fight-doc.ts`, `src/core/combat/fight-react.ts`
- **Skimmed / read partially**:
  - `docs/dependency-map.md` (lines 1-423), `docs/agent-handoff/decisions.tsv` (tail 60 lines), `tests/lint.test.ts` (lines 1-489, 801-1285)
  - Cross-module targeted slices: `src/core/combat/fight.ts` (`arm`), `src/core/combat/fight-turn.ts` (lines 1-120), `src/core/hunter/vitals.ts` (lines 60-105), `src/edge/room-events.ts` (lines 85-150)
- **Not read (outside deep-read lane)**:
  - `server.ts`, `scripts/`, `src/sw.js`, `public/`, `types/`, remaining `src/core/` and `src/edge/` modules, and the rest of `tests/` and `docs/agent-handoff/` sub-folders.


---

# Neon lane report: gates (verbatim)

You asked for a read-only architecture, state-machine, and bug audit of the `systemgaming` repository (detached worktree at `a11b6a5d`, after PR #38) focused on the **gates/content/core lane** (`src/core/gates/`, `src/core/story/`, `src/core/registry/`, `src/core/{first-run,onboarding,library,pack,qr}.*`, `scripts/`, `types/`, `public/`, `package.json`, `tsconfig*.json`, and `tests/` for test gaps vs risk) plus the **cross-cutting dependency-direction review** for the entire `src/` tree.

This audit applies the `pstack` review lens: **model the domain** (illegal states unrepresentable), **statechart discipline** (explicit transitions, no doc/code drift), **type-system discipline** (narrow branded types, exhaustive checks, no silent drops), **boundary discipline** (parse once at the edge with consistent byte and schema limits), **separate before serializing shared state** (clean boundaries between view state, device memory, and saved domain state), **idempotency** (safe retries and single-settlement guarantees), **foundational thinking** (enforce invariants in CI rather than comments), **blast-radius awareness**, and **minimize reader load**.

---

## (A) Implicit State Machines and Statechart Disagreements

The 39 explicit state machines already charted in [docs/state-machines.md](docs/state-machines.md) are not re-reported as implicit. Below are unmodeled implicit machines in this lane and one chart-vs-code disagreement.

### `SM-gates-1` — Multi-step async solo run lifecycle in `gates.js` (HIGH)
- **Evidence**: [src/views/gates.js](src/views/gates.js#L258-L302), [src/views/gates.js](src/views/gates.js#L505-L518), [src/views/gates.js](src/views/gates.js#L554-L560)
- **States and transitions as implemented**:
  1. `idle` (card rendered with `[data-solo-enter]`).
  2. `checking` (`soloReady` check at L259).
  3. `waitingOdds` (`await api.odds.ask(...)` at L261).
  4. `confirming` (`await ui.system(...)` at L263-L264).
  5. `simulating` (`requestAnimationFrame` loop calling `oddsStep` at L272-L282, toggling `progressEl.hidden = false`).
  6. `writing` (`store.apply('solo-run', ...)` + `sync().flush()` at L291-L294).
  7. `showingResult` (`await ui.system(...)` at L298-L300).
- **Illegal states currently representable**:
  - Two concurrent `enterAlone` runs for the same hunter or gate (`[data-solo-enter]` is never disabled during `waitingOdds` or `simulating`).
  - `simulating` with a detached DOM node: any `sync:docs` poll, `store` change, or personal gate minute countdown tick calls `renderSolo()` which replaces `box.innerHTML = html` ([src/views/gates.js](src/views/gates.js#L514)), detaching `card` and `progressEl` while `requestAnimationFrame` continues writing progress into an orphaned element and renders a fresh enabled `Enter alone` button.
- **Bugs / race risks**: Double-tapping `Enter alone` during async odds calculation or multi-frame fight playback queues duplicate confirm modals or spawns parallel `requestAnimationFrame` simulations. A mid-run `renderSolo()` hides the progress bar and re-exposes the button.
- **Proposed explicit model**: Discriminated union held per view (`{ at: 'idle' } | { at: 'askingOdds'; gate: SoloGate; hid: HunterId } | { at: 'confirming'; ... } | { at: 'running'; gate: SoloGate; hid: HunterId; progress: { round: number; commands: number } } | { at: 'showingResult'; ... }`) with a pure transition function in `src/core/gates/` so `renderSolo()` renders the disabled button and live progress from state rather than mutating a captured DOM reference, and ignores clicks when `at !== 'idle'`.
- **Blast radius**: Localized to [src/views/gates.js](src/views/gates.js#L258-L302) and a small core state module.

### `SM-gates-2` — Gate news notification and deduplication across device memory and `asking` set (MED)
- **Evidence**: [src/views/gates.js](src/views/gates.js#L182-L204), [src/views/gates.js](src/views/gates.js#L214-L227), [src/core/gates/world.ts](src/core/gates/world.ts#L171-L205)
- **States and transitions as implemented**:
  - Room gates: `uninitialized` (`stored === null` -> immediate write of `r.told` at L193) -> `unseen` -> `queued` (key added to in-memory `asking` `Set` at L197, `ui.system` promise pending) -> `told` (on `.then()`, `asking.delete(key)` and `memory.write(toldGate(...))` at L201). Batched to at most 3 of each kind per poll (`world.ts:190`).
  - Personal gates: `unseen` -> `queued` (`asking` `Set` at L222) -> `told` (appended to raw string array in `store.device('personal-told:' + hid)` and `.slice(-50)` at L224).
- **Illegal states currently representable**:
  - `personal-told` has no typed parser or schema validation (unlike `parseGateTold`), only an inline `Array.isArray(raw) ? raw.filter(...) : []` check ([src/views/gates.js](src/views/gates.js#L219)).
  - If more than 3 room gates appear at once, gates 4+ are never queued until another `sync:docs` event triggers `onWorld()` again; dismissing the 3rd modal does not trigger `onWorld()`, so gate 4 waits indefinitely if the world doc stops changing or the user stays in the room without a doc diff.
  - Because `personal-told` caps at 50 entries by append order without deduplication (`[...now, g.id].slice(-50)` at L224), repeated writes or >50 personal gates across a campaign can evict an older open gate ID and re-alert it.
- **Proposed explicit model**: Unify room and personal gate notification queues into a single pure core reducer (`unseen -> pending -> told`) with a typed parser for `personal-told` (pruning IDs no longer in `h.solo.gates`) and a callback after modal dismissal that checks whether more queued room news remain.
- **Blast radius**: [src/core/gates/world.ts](src/core/gates/world.ts#L171-L205), [src/core/gates/personal.ts](src/core/gates/personal.ts), [src/views/gates.js](src/views/gates.js#L182-L227).

### `SM-gates-3` — GM world-doc merge latch (`merged`) and frozen card panels (`openPanel`) (MED)
- **Evidence**: [src/views/gates.js](src/views/gates.js#L160-L176), [src/views/gates.js](src/views/gates.js#L377), [src/views/gates.js](src/views/gates.js#L422-L427), [src/views/gates.js](src/views/gates.js#L531-L549)
- **States and transitions as implemented**:
  - `merged = { code: null, at: '' }` resets on room change and advances strictly on `compareTimes(raw.at, merged.at) > 0` ([src/views/gates.js](src/views/gates.js#L166)).
  - `openPanel` (`Map<GateId, 'clear' | 'edit'>`) suppresses card rebuilds whenever `openPanel.has(g.id)` ([src/views/gates.js](src/views/gates.js#L538)).
- **Illegal states currently representable**:
  - A gate card can stay stuck showing an open `Clear` form after a player's `soloRun` or another GM device already transitioned that gate to `cleared` or `closed`. Submitting that stale form hits `clearGate` -> `settleClear` and double-pays the gate (`BUG-gates-1`).
  - Two GM writes in the same millisecond (or with slightly behind clock on the second GM device, though `raw.at` is server time on poll) fail `compareTimes(raw.at, merged.at) > 0` and drop the merge.
- **Proposed explicit model**: Close any `'clear'` panel automatically when `!can(g, 'clear')` in `render()`, and move world-doc merge freshness tracking to a monotonic revision or content-diff check instead of strict `>` timestamp comparison.
- **Blast radius**: [src/views/gates.js](src/views/gates.js#L160-L176) and [src/views/gates.js](src/views/gates.js#L530-L550).

### `SM-gates-4` — Statechart disagreement: `Personal gate clock` chart contradicts `soloTick` when 3 gates are already open (MED)
- **Evidence**: [docs/state-machines.md](docs/state-machines.md#L1474-L1475), [scripts/charts/solo.ts](scripts/charts/solo.ts#L19-L21) vs [src/core/gates/solo.ts](src/core/gates/solo.ts#L122-L128)
- **Disagreement**:
  - `scripts/charts/solo.ts:19,21` unconditionally labels the `on` and `revived` transitions `"personal gates turned on: a gate at once"` and `"the hunter is revived: a gate at once"`.
  - In [docs/state-machines.md](docs/state-machines.md#L1474-L1475), this generates arrows `Off, 3 gates open --> On, 3 gates open: personal gates turned on: a gate at once` and `Off, 3 gates open --> On, 3 gates open: the hunter is revived: a gate at once`.
  - In [src/core/gates/solo.ts](src/core/gates/solo.ts#L125), `if (gates.length < S.held)` guards the spawn. When 3 gates are already open, turning personal gates on or reviving opens **no** gate.
- **Proposed fix**: In [scripts/charts/solo.ts](scripts/charts/solo.ts#L19-L21), inspect `(e, from, to)` so transitions where `from.gates.length === to.gates.length` are labeled `"personal gates turned on (already at cap)"` / `"the hunter is revived (already at cap)"`, then regenerate `docs/state-machines.md` via `bun run charts`.
- **Blast radius**: [scripts/charts/solo.ts](scripts/charts/solo.ts#L19-L21) and generated [docs/state-machines.md](docs/state-machines.md).

### `SM-gates-5` — Implicit pause/retry/timeout loop in `scripts/ci.ts` (LOW)
- **Evidence**: [scripts/ci.ts](scripts/ci.ts#L32-L65)
- **States and transitions as implemented**: Implicit state across `attempt`, `pauses`, `last`, `cmd` vs `retry`, and a `setInterval` watchdog (`STALL_MS = 30_000`) that calls `proc.kill()` and increments `pauses` (retrying once via `retry` command if `attempt === 1` and `pauses > 0`).
- **Illegal states / race risks**: If the child writes output and exits right as `setInterval` fires (`Date.now() - last >= STALL_MS`), `pauses` is incremented before `proc.exited` settles; a successful exit with `code === 0` is fine, but a non-zero exit from a real test failure occurring right at the 30 s boundary is misclassified as a hang and retried.
- **Proposed explicit model**: Model one run step explicitly as `'running' | 'stalled' | 'exited'` so the watchdog only transitions `'running' -> 'stalled'` and `proc.exited` transitions `'running' -> 'exited'` (mutually exclusive).
- **Blast radius**: [scripts/ci.ts](scripts/ci.ts#L32-L65) only.

---

## (B) Architectural Weaknesses

### `AW-gates-1` — Cross-cutting dependency direction: `edge -> views` layer inversion is documented but not enforced in tests, and `room-pill.ts` is a view in `edge/` (HIGH)
- **Evidence**: [src/edge/room-pill.ts](src/edge/room-pill.ts#L5), [src/edge/sync.ts](src/edge/sync.ts#L38), [src/views/app.ts](src/views/app.ts#L9-L11), [docs/dependency-map.md](docs/dependency-map.md#L14), [scripts/deps.ts](scripts/deps.ts#L424-L427), [tests/deps.test.ts](tests/deps.test.ts#L1-L124)
- **Problem**:
  - `src/edge/room-pill.ts:5` and `src/edge/sync.ts:38` import `type { App }` from `src/views/app.ts`, while `src/views/app.ts:9-11` imports `src/edge/bus.ts`, `src/edge/rules.ts`, and `src/edge/store.ts`. This forms a layer cycle `edge <-> views`.
  - `scripts/deps.ts:426` already computes layer-rule breaks and prints them to `docs/dependency-map.md:14`, yet `tests/deps.test.ts` never asserts that layer breaks are empty, so new `edge -> views` or `core -> edge` violations can enter without failing `deps.test.ts` (core is separately protected by `lint.test.ts`, edge is not).
  - `src/edge/room-pill.ts` directly manipulates DOM (`document.getElementById`, `innerHTML`, `ui.css`, `app.go`), making it a view module misplaced in `src/edge/` where view lints (`pageLets`, `store.apply`, timer naming) do not check it.
- **Concrete fix (sequenced)**:
  1. Extract the shared `App` interface (or minimal `SyncHost` interface) into `src/core/app-host.ts` (or `src/core/api.ts`) so `src/edge/sync.ts` imports only from `src/core/`.
  2. Move `src/edge/room-pill.ts` to `src/views/room-pill.ts` (it only consumes `app.api.sync`, `app.on('sync:status')`, and `edge/upgrade.ts`).
  3. Add a test in `tests/deps.test.ts` asserting zero layer violations across all 5 layers (`core`, `edge`, `views`, `entry`, `server`).

### `AW-gates-2` — Cross-cutting dependency direction: runtime value import cycles inside `src/core/` (HIGH)
- **Evidence**:
  - Cycle 1 (3-node value cycle): [src/core/save.ts](src/core/save.ts#L15) (`parseOutbox`) -> [src/core/sync/outbox.ts](src/core/sync/outbox.ts#L13) (`parseEvent`, `parseRoomCode`) -> [src/core/protocol.ts](src/core/protocol.ts#L8) (`QUEST_KINDS`, `QUEST_STATUSES`, `RANKS`, `SHADOW_GRADES`, `parseSheetHunter`) -> `src/core/save.ts`.
  - Cycle 2 (3-node value cycle): [src/core/save.ts](src/core/save.ts#L32) (`keptRuns`, `parseStoryRun`) -> [src/core/story/run.ts](src/core/story/run.ts#L21) (`newEvent`) -> [src/core/protocol.ts](src/core/protocol.ts#L8) -> `src/core/save.ts`.
  - Cycle 3 (2-node value cycle): [src/core/combat/effect-ops.ts](src/core/combat/effect-ops.ts#L23) (`harmful`, `withSheetOps`) <-> [src/core/combat/standing.ts](src/core/combat/standing.ts#L9) (`atTier`, `countOn`, `SHEET_OP_KEYS`).
- **Problem**: Module evaluation currently succeeds only because references occur inside functions called after module load. Any module-top-level initializer touching an imported constant from a cycle partner (`QUEST_KINDS`, `SHEET_OP_KEYS`, `RANKS`) will silently throw a TDZ `ReferenceError` depending on entry-point import order. Furthermore, `scripts/deps.ts` merges `import type` and runtime value imports into one `imports` list, hiding runtime cycles inside a noisy graph.
- **Concrete fix (sequenced)**:
  1. Update `scripts/deps.ts` to track `valueImports` separately from `typeImports` and report strongly connected components (runtime cycles).
  2. Break Cycle 3 by moving `SHEET_OP_KEYS`, `atTier`, and `countOn` into a leaf module `src/core/combat/op-helpers.ts` imported by both `effect-ops.ts` and `standing.ts`.
  3. Break Cycles 1 and 2 by extracting `QUEST_KINDS`, `QUEST_STATUSES`, `SHADOW_GRADES`, and `parseSheetHunter` out of `src/core/save.ts` into `src/core/hunter/hunter-parse.ts` (a lower-level module that does not import `outbox.ts` or `story/run.ts`).
  4. Add a `deps.test.ts` assertion banning new runtime value cycles in `src/core/`.

### `AW-gates-3` — Unchecked JavaScript in `src/core/qr.js` and permissive `tsconfig.views.json` + `types/views/dom.d.ts` (HIGH)
- **Evidence**: [src/core/qr.js](src/core/qr.js#L1-L112), [tsconfig.json](tsconfig.json#L1-L26), [tsconfig.views.json](tsconfig.views.json#L1-L19), [types/views/dom.d.ts](types/views/dom.d.ts#L7-L53)
- **Problem**:
  - `src/core/qr.js` is the only `.js` file in `src/core/`. `tsconfig.json` does not set `checkJs: true`, and `tsconfig.views.json` includes only `src/views/**/*.js` and `src/app.js`. Consequently, `src/core/qr.js` receives zero static typechecking (which masked `BUG-gates-13` where `opts` is accepted and ignored in `qrSvg`).
  - `tsconfig.views.json:4-8` disables `strict`, `noImplicitAny`, `strictNullChecks`, and `exactOptionalPropertyTypes`, while `types/views/dom.d.ts:7-31,49-52` injects `[control: string]: ViewElement` onto every `HTMLElement`/`HTMLFormElement` and defines `ViewEvent = Event & KeyboardEvent & PointerEvent & ...`. Any misspelled form field or null `querySelector` result silently typechecks.
- **Concrete fix (sequenced)**:
  1. Convert `src/core/qr.js` to strict `src/core/qr.ts` (112 lines, zero dependencies).
  2. Tighten `types/views/dom.d.ts` incrementally (remove the blanket `[control: string]` index from non-form `HTMLElement` first) and enable `noImplicitAny` per view or migrate high-risk views (`gates.js`, `combat.js`, `stories.js`) to `.ts`.

### `AW-gates-4` — Branded ID boundaries bypassed and inconsistent across core content modules (MED)
- **Evidence**: [src/core/registry/maps.ts](src/core/registry/maps.ts#L17), [src/core/gates/gate.ts](src/core/gates/gate.ts#L44), [src/core/gates/gate.ts](src/core/gates/gate.ts#L132-L134), [src/core/gates/gate.ts](src/core/gates/gate.ts#L163), [src/core/gates/personal.ts](src/core/gates/personal.ts#L50), [src/core/pack.ts](src/core/pack.ts#L340-L348)
- **Problem**:
  - `maps.ts:17` exports `export const mapId = (s: string): MapId => s as MapId` with zero validation, allowing arbitrary strings (empty, spaces, >40 chars) to masquerade as `MapId`.
  - `gate.ts:132,134` (`parseGateId`, `monsterId`) accept any 1..80 char string instead of a consistent ID grammar, while `gate.ts:163` duplicates a `<= 40` check for `mapId` and `personal.ts:50` casts `m.monsterId as MonsterId` directly.
  - `pack.ts:340,348` fabricates `${prefix}${++seq}` strings and casts `as T` instead of using `saveId` from `src/core/ids.ts`.
- **Concrete fix (sequenced)**:
  1. Add `parseMapId` to `src/core/ids.ts` (or `maps.ts`) and stop exporting unvalidated `mapId` casts to callers outside `maps.ts`.
  2. Use `saveId` in `src/core/pack.ts:340-352` and reuse `monsterId` in `src/core/gates/personal.ts:50`.

### `AW-gates-5` — `saveById` bypasses `library.ts` case-insensitive uniqueness for maps (MED)
- **Evidence**: [src/core/library.ts](src/core/library.ts#L29-L49), [src/views/map-maker.js](src/views/map-maker.js#L14), [src/views/map-maker.js](src/views/map-maker.js#L174)
- **Problem**: `saveEntry` enforces unique names case-insensitively (`namedLike`), but `saveById` is exported publicly and used by `map-maker.js:174`. A GM can create two maps both named `"Arena"` with different IDs. Later, `pack.ts` `mergeNamed(..., 'replace')` matches by name (`out.findIndex(x => x.name === t.name)`), overwriting only the first and creating silent drift on pack import.
- **Concrete fix**: Either enforce `namedLike` uniqueness for maps via `saveEntry` in `map-maker.js` (keeping `saveById` internal to `library.ts`), or explicitly document and test multi-map name collisions in `pack.ts`.

### `AW-gates-6` — Duplicated UTF-8 sizing utilities and missing size caps on `parseMonster` (MED)
- **Evidence**: [src/core/size.ts](src/core/size.ts#L1-L26), [src/core/story/story.ts](src/core/story/story.ts#L130-L140), [src/core/gates/solo.ts](src/core/gates/solo.ts#L391), [src/core/protocol.ts](src/core/protocol.ts#L892), [src/core/registry/monsters.ts](src/core/registry/monsters.ts#L234-L252)
- **Problem**:
  - Three different size-measurement mechanisms exist: `bytesOf` (`TextEncoder`) in `size.ts:9`, hand-rolled `utf8Bytes` in `story.ts:130-134`, and UTF-16 `.length` in `solo.ts:391`, `protocol.ts:892`, and `server.ts:486` (causing `BUG-gates-6`).
  - `size.ts:1-6` states that every library thing past its size cap is refused whole, never silently cut, and `parseItem`/`parseSkill` follow this rule. However, `parseMonster` (`monsters.ts:242`) silently drops abilities that `parseAbility` refuses (including oversized ones via `abilityTooLarge`), and imposes no `THING_MAX.monster` bound: a single monster can hold 11 × 8 KiB abilities + 20 × 7 KiB loot items (>220 KiB), blowing past `DOC_MAX` (60 KiB) if included in a solo gate.
- **Concrete fix (sequenced)**:
  1. Use `bytesOf` from `src/core/size.ts` in `story.ts`, `solo.ts`, `protocol.ts`, and `server.ts`.
  2. Add `THING_MAX.monster` (and `abilityTooLarge` whole-monster refusal) in `size.ts` and `monsters.ts`.

### `AW-gates-7` — Shell injection hazard in `scripts/publish-clean.ts` (MED)
- **Evidence**: [scripts/publish-clean.ts](scripts/publish-clean.ts#L23)
- **Problem**: `Bun.spawnSync(['sh', '-c', \`git archive HEAD | tar -x -C "${out}"\`])` interpolates CLI argument `out` into a double-quoted `sh -c` command string. A destination path containing `"`, `$`, or `` ` `` executes arbitrary shell code.
- **Concrete fix**: Spawn `git archive HEAD` and pipe its `stdout` directly to `tar -x -C` using argv arrays (no `sh -c`), or pass `out` as a positional parameter `$1` (`sh -c 'git archive HEAD | tar -x -C "$1"' _ out`).

### `AW-gates-8` — Hand-rolled regex/brace lexers in `scripts/deps.ts` and `tests/lint.test.ts` (MED)
- **Evidence**: [tests/lint.test.ts](tests/lint.test.ts#L1023-L1055), [tests/lint.test.ts](tests/lint.test.ts#L1215-L1225), [scripts/deps.ts](scripts/deps.ts#L150-L240)
- **Problem**: Both `deps.ts` and `lint.test.ts` rely on fragile regex/brace scanning even though `typescript` (`7.0.2`) is already installed as a devDependency (`package.json:21`). As a result, `deps.ts` conflates `import type` with runtime imports (`AW-gates-2`), and `lint.test.ts` accepts any 4-word comment as proof that a `catch` block is not swallowing an error.
- **Concrete fix**: Introduce a shared small helper using `ts.createSourceFile` (from `typescript`) for `deps.ts` import scanning first, then migrate the `pageLets` and `catch`-block checks in `lint.test.ts` to AST traversal.

### `AW-gates-9` — High-risk test gaps across the gates, registry, pack, and dependency suites (HIGH)
- **Evidence**: [tests/world.test.ts](tests/world.test.ts#L126-L143), [tests/pay.test.ts](tests/pay.test.ts#L118-L137), [tests/statuses.test.ts](tests/statuses.test.ts#L123-L125), [tests/solo.test.ts](tests/solo.test.ts#L312-L374), [tests/abilities.test.ts](tests/abilities.test.ts#L250-L320), [tests/pack.test.ts](tests/pack.test.ts#L180-L246), [tests/deps.test.ts](tests/deps.test.ts#L1-L124), [tests/worth.test.ts](tests/worth.test.ts#L169-L234)
- **Concrete test gaps vs risk**:
  1. **Double-settlement of gates**: Neither `world.test.ts` nor `pay.test.ts` calls `clearGate` or `settleClear` on an already `cleared` or `closed` gate (directly hiding `BUG-gates-1`).
  2. **Built-in Stealth in combat**: `statuses.test.ts:123-125` asserts the stale pre-wave-2 rule that `invisible.ops` and `stealth.ops` are `[]`, and no test uses the built-in `Stealth` skill in `fight.ts` (hiding `BUG-gates-2`).
  3. **Room solo edge cases**: `solo.test.ts` never tests `soloFight` when `t.statuses` overrides a built-in status key (`BUG-gates-3`), never calls `soloPlan` on a gate with `solo: false` (`BUG-gates-7`), never checks chronicle `gate` facts after a room world solo clear (`BUG-gates-8`), never tests `soloDoc` with non-ASCII text near `DOC_MAX` (`BUG-gates-6`), and never tests monster `summon.statuses` in `soloDoc` (`BUG-gates-10`).
  4. **Wave-2 consumables**: `abilities.test.ts` never passes any wave-2 `UseOp` (`dispel`, `hasten`, `shove`, `move`, `extra`, `guard`, `negate`) to `itemAbility` (`BUG-gates-4`).
  5. **Wave-1/2 kit pack round-trips**: `pack.test.ts` never tests `packOf`/`mergePack('add')` with ability `zone`, `prices` (`stacks`), `gates` (`holds`), `summon.statuses`, `effect` formulas (`stacks`/`field`/`held`), `move` ops, trigger `statusGained`/`statusEnded`/`need`, map zone `triggers`/`end` (`BUG-gates-5`), or case-insensitive name collisions (`BUG-gates-9`).
  6. **Layer enforcement**: `deps.test.ts` checks `docs/dependency-map.md` freshness and event/API wiring, but never asserts zero layer violations (`AW-gates-1`).
  7. **Worth invariants**: `worth.test.ts` never tests `wornWorth` on a status def containing `stack` or `end` (`BUG-gates-12`).
- **Concrete fix**: Add targeted regression tests for each of the 7 gaps alongside the corresponding bug/AW fixes.

---

## (D) Concrete Bugs

### `BUG-gates-1` — `clearGate` swallows `onGate`'s `'unchanged'` refusal, letting `settleClear` double-pay already-cleared or closed gates (HIGH)
- **Evidence**: [src/core/gates/world.ts](src/core/gates/world.ts#L122-L129), [src/core/gates/gate.ts](src/core/gates/gate.ts#L95-L96), [src/core/gates/pay.ts](src/core/gates/pay.ts#L141-L147)
- **Repro**:
  1. Take a `detected` gate `'g-den'` (worth 150 XP) and call `settleClear(s, 'g-den', pay, locals, posts, DAY)`. Gate becomes `cleared`, `xpPaid` becomes `150`, local hunter gets `+75 XP` and a `gate` chronicle fact, remote award is posted to outbox.
  2. Call `settleClear` a second time on the resulting save (or once on a `closed` gate, or submit a stale open `Clear` panel in `gates.js` after a player clears the gate via `soloRun`).
  3. `gate.ts:95-96` has `clear: null` for `cleared` and `closed`, so `onGate` returns `refuse('unchanged')`.
  4. `world.ts:126` executes `let next = 'ok' in cleared ? save : cleared;`, silently swallowing the refusal.
  5. `world.ts:127` still applies `{ type: 'paid', xp: pay.due }`, `world.ts:128` logs another `'GATE CLEARED'` line, and `pay.ts:146-147` records a second `gate` fact and grants full XP, gold, items, and remote awards again.
- **Suggested fix**: In [src/core/gates/world.ts](src/core/gates/world.ts#L125-L126), return the refusal immediately: `if (isRefused(cleared)) return cleared;` (matching `settleClear`'s own declared return type `Settled | Refused<'missing' | 'unchanged'>` and JSDoc at `pay.ts:139-141`).

### `BUG-gates-2` — Built-in `stealth` and `invisible` statuses have `ops: []` (missing `{ op: 'hidden' }`), leaving the built-in `Stealth` skill mechanically inert (HIGH)
- **Evidence**: [src/core/registry/statuses.ts](src/core/registry/statuses.ts#L41), [src/core/registry/statuses.ts](src/core/registry/statuses.ts#L44), [src/core/registry/abilities.ts](src/core/registry/abilities.ts#L124), [src/core/combat/standing.ts](src/core/combat/standing.ts#L87-L89), [src/core/combat/standing.ts](src/core/combat/standing.ts#L185), [src/core/combat/fight.ts](src/core/combat/fight.ts#L349), [src/core/combat/fight-doc.ts](src/core/combat/fight-doc.ts#L220), [src/core/combat/fight-turn.ts](src/core/combat/fight-turn.ts#L175-L187), [docs/state-machines.md](docs/state-machines.md#L505)
- **Repro**:
  1. A hunter uses the built-in `Stealth` skill (`abilities.ts:124`) or a GM applies the built-in `invisible` / `stealth` condition (`statuses.ts:41,44`).
  2. Because both defs have `ops: []` instead of `ops: [{ op: 'hidden' }]`, `hides(a)` (`fight.ts:349`) is `false` (allowed in plain sight), `holds(b, 'hidden')` is `false` everywhere: foes can still target and area-hit the stealthed body (`standing.ts:89`), the hidden body gains no attacker advantage (`standing.ts:185`), hidden foes remain visible in `fightDoc` (`fight-doc.ts:220`), and attacking/taking damage/proximity never reveals them (`fight-turn.ts:175`).
- **Suggested fix**: Change `invisible.ops` and `stealth.ops` in [src/core/registry/statuses.ts](src/core/registry/statuses.ts#L41-L44) to `[{ op: 'hidden' }]`, and update the stale M2 assertion in [tests/statuses.test.ts](tests/statuses.test.ts#L123-L125) and [tests/abilities.test.ts](tests/abilities.test.ts#L35).

### `BUG-gates-3` — `soloFight` spreads `t.statuses` before `R0.conditions`, letting default built-ins overwrite GM-edited built-in statuses (HIGH)
- **Evidence**: [src/core/gates/solo.ts](src/core/gates/solo.ts#L174), [src/core/gates/solo.ts](src/core/gates/solo.ts#L240-L243)
- **Repro**:
  1. GM customizes built-in status `burning` in `save.library.statuses` and puts a monster starting with `burning` inside a world gate marked `solo: true`.
  2. `soloDoc` (`solo.ts:370-371,389`) copies the GM's `burning` def into `doc.statuses.burning`.
  3. On the player's phone, `soloFight` runs line 243: `{ ...R0, conditions: { ...t.statuses, ...R0.conditions } }`.
  4. `R0.conditions.burning` (the player's unedited built-in) overwrites `t.statuses.burning`, contradicting the comments at L174 ("laid over `conditions` for this fight only") and L240 ("with the target's statuses over the rules'").
- **Suggested fix**: Swap the spread order at [src/core/gates/solo.ts](src/core/gates/solo.ts#L243) to `{ ...R0.conditions, ...t.statuses }`.

### `BUG-gates-4` — `itemAbility` silently strips all 7 wave-2 `UseOp`s from consumables in combat (HIGH)
- **Evidence**: [src/core/registry/abilities.ts](src/core/registry/abilities.ts#L200-L201), [src/core/registry/abilities.ts](src/core/registry/abilities.ts#L217-L218) vs [src/core/combat/effect-ops.ts](src/core/combat/effect-ops.ts#L233-L236) and [src/core/combat/fight-parse.ts](src/core/combat/fight-parse.ts#L317)
- **Repro**:
  1. Create a consumable item whose `effects` contains `{ op: 'dispel', which: 'all' }` or `{ op: 'hasten', share: 0.5 }` (accepted by `parseItem` via `parseOp`, and part of `UseOp` via `USE_OPS_2`).
  2. Call `itemAbility(item, RULES)`.
  3. `abilities.ts:200` hardcodes only the 9 wave-1 ops (`satisfies UseOp['op'][]` checks subset membership, not exhaustiveness). `effects.filter(isUseOp)` silently drops all 7 wave-2 ops (`shove`, `move`, `hasten`, `extra`, `guard`, `negate`, `dispel`). If the item had only wave-2 ops, `itemAbility` returns `null` and the item cannot be used in combat at all.
- **Suggested fix**: Export `USE_OPS` (or build `USE_OPS` from `USE_OPS_2` with an exhaustive `Record<UseOp['op'], true>` check) in `effect-ops.ts` and import it in both `abilities.ts:200` and `fight-parse.ts:317`.

### `BUG-gates-5` — `pack.ts` misses status keys in wave-1/wave-2 kit fields during export dependency collection and Add-mode rekeying (HIGH)
- **Evidence**: [src/core/pack.ts](src/core/pack.ts#L83-L108), [src/core/pack.ts](src/core/pack.ts#L220-L259), [src/core/formula.ts](src/core/formula.ts#L43-L49), [src/core/combat/fight-parse.ts](src/core/combat/fight-parse.ts#L307-L310), [src/core/combat/fight-parse.ts](src/core/combat/fight-parse.ts#L388-L400), [src/core/combat/fight-parse.ts](src/core/combat/fight-parse.ts#L582-L616)
- **Repro**:
  1. Create a custom status `rot` and an active skill whose ability uses any of:
     - `zone.ops`, `zone.triggers`, or `zone.end` referencing `rot`;
     - `prices: [{ kind: 'stacks', key: 'rot', ... }]`;
     - `gates: [{ kind: 'holds', key: 'rot', ... }]`;
     - `summon.statuses: [{ key: 'rot', rounds: 2 }]`;
     - `effect` formula `stacks(rot)`, `field(rot)`, or `held(rot)`;
     - `ops` containing `{ op: 'move', key: 'rot', as: 'rot', ... }`;
     - triggers with `on: 'statusGained' | 'statusEnded'` (`key: 'rot'`) or `need: { kind: 'holds', key: 'rot' }`;
     - a reward status (`pack.ts:101`) whose `def` has `triggers`, `stack.threshold`, or `end`;
     - a battle map zone (`pack.ts:103,253`) whose `triggers` or `end` apply `rot`.
  2. Single-item export `packOf(save, at, 'skills', skill.id)` omits `rot` from `doc.library.statuses`.
  3. Full-pack import `mergePack(target, pack, 'add')` on a phone that already has `rot` renames the imported status to `rot-2`, but leaves all the references above pointing at the old `rot` key.
- **Suggested fix**: Extract a single exhaustive visitor/mapper over `Op`, `Formula`, `Trigger`, `StatusDef`, `ZoneSpec`/`Zone`, and `Ability` so `opKeys`/`defKeys`/`abilityKeys`/`rewardKeys`/`mapKeys` and their `rekey*` twins walk every `StatusKey` position, with a unit test covering every one of those fields.

### `BUG-gates-6` — `soloDoc` and `protocol.ts` measure `DOC_MAX` in UTF-16 `.length` while `server.ts` enforces `MAX_BODY` in UTF-8 bytes, causing 413 failures on non-ASCII content (MED)
- **Evidence**: [src/core/gates/solo.ts](src/core/gates/solo.ts#L391), [src/core/protocol.ts](src/core/protocol.ts#L892), [server.ts](server.ts#L41), [server.ts](server.ts#L379), [server.ts](server.ts#L486) vs [src/core/size.ts](src/core/size.ts#L9)
- **Repro**:
  1. GM creates world solo gates with custom monsters/statuses whose text uses non-ASCII characters (CJK, Cyrillic, emoji, or symbols).
  2. Suppose `JSON.stringify(next)` has 25,000 UTF-16 characters (~75,000 UTF-8 bytes).
  3. `soloDoc` (`solo.ts:391`) checks `JSON.stringify(next).length <= DOC_MAX` (`25,000 <= 61,440`), accepts all gates, and returns `left: []`. `gates.js` publishes `_world` marking those gates `solo: true` and shows no warning.
  4. `PUT /api/rooms/:code/sheets/_solo` hits `readJson` (`server.ts:379`), which checks `new TextEncoder().encode(text).length > MAX_BODY` (`75,000 > 65,536`) and rejects the entire `_solo` doc with HTTP `413 too large`. Players never get the solo doc.
- **Suggested fix**: Use `bytesOf` (`src/core/size.ts:9`, UTF-8 bytes) in `solo.ts:391`, `protocol.ts:892`, and `server.ts:486`.

### `BUG-gates-7` — `soloPlan` does not check `g.solo`, allowing a stale or crafted `soloRun` to clear a non-solo world gate (MED)
- **Evidence**: [src/core/gates/solo.ts](src/core/gates/solo.ts#L413-L420)
- **Repro**:
  1. GM spawns a world gate with `solo: false` (or unchecks `solo` after a player begins a run).
  2. A player phone sends a `soloRun` room event with `outcome: 'won'` for that gate ID.
  3. `soloPlan` (`solo.ts:415-417`) checks only that `g` exists and `can(g, 'clear')`; it never checks `g.solo`. It returns `{ kind: 'paid', xp }` and `soloTaken` clears the gate and awards XP and loot.
- **Suggested fix**: Add `if (!g.solo) return { kind: 'refused', why: 'closed' };` (or add a `'not-solo'` variant to `SoloRefused`) in [src/core/gates/solo.ts](src/core/gates/solo.ts#L417).

### `BUG-gates-8` — Clearing a room's world solo gate never records a `{ kind: 'gate' }` fact on the player's chronicle (MED)
- **Evidence**: [src/core/gates/solo.ts](src/core/gates/solo.ts#L320), [src/core/gates/solo.ts](src/core/gates/solo.ts#L444), [src/edge/room-events.ts](src/edge/room-events.ts#L193-L208)
- **Repro**:
  1. Player in a room enters and wins a GM's world gate marked `solo: true`.
  2. On the player's phone, `soloRan` (`solo.ts:320`) only records `kind: 'gate'` when `gate.kind === 'personal'`.
  3. On the GM's phone, `soloTaken` (`solo.ts:444`) calls `settleClear(s, p.gate, pay, [], { room, events: [answer] }, c.day)` with `locals = []` and posts only `soloAnswer` (unlike manual `clearGate` in `gates.js:132-133`, which posts both `award` and `noted` with `gateFact`).
  4. On the player's phone, `landSoloAnswer` (`room-events.ts:193-208`) grants rewards and marks the waiting run answered, but records no `{ kind: 'gate' }` fact.
  5. Result: room world solo clears never count toward gate-count feats (`Regular`, `Gate Closer`).
- **Suggested fix**: Either post a `noted` event carrying `gateFact(g, rank, save.world.day)` alongside `soloAnswer` in `soloTaken`, or carry the gate's `rank` and `toBreak` on a paid `soloAnswer` payload and record the `gate` fact in `landSoloAnswer`.

### `BUG-gates-9` — `mergeNamed` in `pack.ts` compares names case-sensitively, breaking `library.ts`'s case-insensitive uniqueness invariant (MED)
- **Evidence**: [src/core/pack.ts](src/core/pack.ts#L297-L303) vs [src/core/library.ts](src/core/library.ts#L29-L30), [src/core/library.ts](src/core/library.ts#L39-L41)
- **Repro**:
  1. Target save has library item `"Potion"`.
  2. Import a pack containing item `"potion"` in `add` mode.
  3. `mergeNamed` checks `names.has(t.name)` using raw case-sensitive strings, so `"potion"` is added without renaming.
  4. Target library now holds both `"Potion"` and `"potion"`. Opening either item in the maker and saving calls `saveEntry` (`library.ts:40`), which checks `namedLike` (case-insensitive) against the other entry and refuses the save with `'taken'`.
- **Suggested fix**: Normalize names with `name.trim().toLowerCase()` (matching `library.ts:29` `namedLike`) in `mergeNamed` (`pack.ts:297,300-301`) for both `replace` matching and `add` collision suffixing.

### `BUG-gates-10` — `namedStatuses` in `soloDoc` omits custom statuses referenced by monster abilities' `summon.statuses` and `move` ops (MED)
- **Evidence**: [src/core/gates/solo.ts](src/core/gates/solo.ts#L370-L371), [src/core/combat/rows.ts](src/core/combat/rows.ts#L274-L276)
- **Repro**:
  1. GM creates a custom status `void-ward` and a monster with an ability whose `summon.statuses` contains `{ key: 'void-ward', rounds: 3 }`.
  2. GM puts that monster in a world gate marked `solo: true`.
  3. `namedStatuses(m, R)` (`solo.ts:370-371`) only collects keys from `m.statuses`, never from `m.abilities[*].summon.statuses` (or `move` op `as` keys).
  4. On the player's phone, `soloFight` runs `rows.ts:274-276`, which looks up `R.conditions['void-ward']` and silently skips it because `doc.statuses` does not include it.
- **Suggested fix**: Reuse the shared status-key collector from `pack.ts` (`monsterKeys`) in `namedStatuses` (collecting transitive custom status defs up to `DOC_MAX`).

### `BUG-gates-11` — Room world solo clear on GM's phone always rolls boss loot even when the gate has no boss (LOW)
- **Evidence**: [src/views/gates.js](src/views/gates.js#L308-L309) vs [src/views/gates.js](src/views/gates.js#L288)
- **Repro**:
  1. GM edits a world gate to have `bossId: null` and `solo: true`.
  2. A solo run cleared locally (`gates.js:288`) rolls `lootOf(ready.target.rank, ready.target.boss)` (`boss = false`).
  3. The exact same gate cleared by a room player (`gates.js:309`) rolls `lootOf(g.rank, true)` (`boss = true`), paying boss-tier loot for a bossless gate.
- **Suggested fix**: Change `lootOf(g.rank, true)` at [src/views/gates.js](src/views/gates.js#L309) to `lootOf(g.rank, g.bossId !== null)`.

### `BUG-gates-12` — `wornWorth` ignores `def.stack` and `def.end` without recording them in `Worth.unweighed` (LOW)
- **Evidence**: [src/core/registry/worth.ts](src/core/registry/worth.ts#L7), [src/core/registry/worth.ts](src/core/registry/worth.ts#L331-L336)
- **Repro**:
  1. Build a worn status def (for a passive skill or worn item) with `ops: []`, `triggers: []`, and either a `stack` threshold or an `end` block.
  2. Call `wornWorth(def, RULES)`.
  3. `wornWorth` sums only `def.triggers` and inspects only `def.ops`, returning `{ worth: 0, over: false, unweighed: [] }` — silently counting `stack` and `end` as 0 in violation of the module invariant at L7 ("A block with no rule is named in `Worth.unweighed`, never counted as 0").
- **Suggested fix**: In `wornWorth` ([src/core/registry/worth.ts](src/core/registry/worth.ts#L334)), add `'end'` to `at.miss` when `def.end` is present, and record/weigh `def.stack` (or add a `'stack'` unweighed key) when `def.stack` is present.

### `BUG-gates-13` — `qrSvg` accepts `opts` but drops it when calling `qrMatrix(text)` (LOW)
- **Evidence**: [src/core/qr.js](src/core/qr.js#L93), [src/core/qr.js](src/core/qr.js#L105-L106)
- **Repro**: Call `qrSvg('hello', { mask: 2 })`. Line 106 calls `qrMatrix(text)` without forwarding `opts`, so `opts.mask` is silently ignored and all 8 masks are evaluated instead.
- **Suggested fix**: Change [src/core/qr.js](src/core/qr.js#L106) to `const q = qrMatrix(text, opts);`.

---

## (E) All Findings Ordered by Importance

| Rank | ID | Severity | Location | Problem | Fix |
|---:|---|---|---|---|---|
| 1 | `BUG-gates-1` | HIGH | [src/core/gates/world.ts:122-129](src/core/gates/world.ts#L122-L129) | `clearGate` swallows `onGate` `'unchanged'` refusal so `settleClear` double-pays cleared/closed gates | Return `cleared` immediately when `isRefused(cleared)` |
| 2 | `BUG-gates-2` | HIGH | [src/core/registry/statuses.ts:41-44](src/core/registry/statuses.ts#L41-L44) | Built-in `invisible` and `stealth` have `ops: []`, making built-in `Stealth` skill inert in combat | Set `ops: [{ op: 'hidden' }]` on both and update stale M2 tests |
| 3 | `BUG-gates-3` | HIGH | [src/core/gates/solo.ts:243](src/core/gates/solo.ts#L243) | `soloFight` spreads `t.statuses` before `R0.conditions`, overwriting GM-edited built-in statuses | Reverse spread to `{ ...R0.conditions, ...t.statuses }` |
| 4 | `BUG-gates-4` | HIGH | [src/core/registry/abilities.ts:200](src/core/registry/abilities.ts#L200) | `itemAbility` hardcodes wave-1 `USE_OPS` and silently drops all 7 wave-2 `UseOp`s | Share an exhaustive `USE_OPS` list with `effect-ops.ts` and `fight-parse.ts` |
| 5 | `BUG-gates-5` | HIGH | [src/core/pack.ts:83-108,220-259](src/core/pack.ts#L83-L108) | `pack.ts` misses status keys in `zone`, `prices`, `gates`, `summon`, `move`, `Trigger`, `Formula`, reward defs, and map zones | Use one exhaustive status-key collector and rekey mapper across all kit structures |
| 6 | `AW-gates-1` | HIGH | [src/edge/room-pill.ts:5](src/edge/room-pill.ts#L5), [src/edge/sync.ts:38](src/edge/sync.ts#L38) | `edge -> views` layer cycle unblocked by `deps.test.ts` and DOM view `room-pill.ts` misplaced in `edge/` | Move `App` host type to `core/`, move `room-pill.ts` to `views/`, assert zero layer breaks in `deps.test.ts` |
| 7 | `AW-gates-2` | HIGH | [src/core/save.ts:15,32](src/core/save.ts#L15), [src/core/combat/effect-ops.ts:23](src/core/combat/effect-ops.ts#L23) | Three runtime value import cycles inside `src/core/` hidden by `deps.ts` merging type/value imports | Track value vs type imports in `deps.ts`, extract leaf helpers (`op-helpers.ts`, `hunter-parse.ts`), ban core value cycles |
| 8 | `AW-gates-9` | HIGH | [tests/world.test.ts:126](tests/world.test.ts#L126), [tests/pack.test.ts:180](tests/pack.test.ts#L180) | High-risk test gaps across gate re-clearing, built-in stealth, solo overrides/non-solo/UTF-8, wave-2 items, and kit packs | Add regression tests for all 7 identified risk gaps |
| 9 | `SM-gates-1` | HIGH | [src/views/gates.js:258-302,514](src/views/gates.js#L258-L302) | `enterAlone` has no in-flight phase lock; concurrent clicks or `renderSolo()` DOM replace breaks live runs | Model solo run UI phase explicitly in a state union and disable button/render progress from state |
| 10 | `AW-gates-3` | HIGH | [src/core/qr.js:1](src/core/qr.js#L1), [tsconfig.views.json:4-8](tsconfig.views.json#L4-L8) | `src/core/qr.js` is completely untypechecked and `dom.d.ts` index signatures hide view type bugs | Convert `qr.js` to strict `qr.ts` and narrow `dom.d.ts` / migrate critical views to `.ts` |
| 11 | `BUG-gates-6` | MED | [src/core/gates/solo.ts:391](src/core/gates/solo.ts#L391), [server.ts:379,486](server.ts#L379) | `DOC_MAX` checked in UTF-16 `.length` while `MAX_BODY` is checked in UTF-8 bytes, causing 413s on non-ASCII docs | Measure `DOC_MAX` and `SHEET_MAX` with UTF-8 `bytesOf` (`src/core/size.ts:9`) everywhere |
| 12 | `BUG-gates-7` | MED | [src/core/gates/solo.ts:413-420](src/core/gates/solo.ts#L413-L420) | `soloPlan` never checks `g.solo`, letting stale/forged `soloRun` events clear non-solo gates | Refuse in `soloPlan` when `!g.solo` |
| 13 | `BUG-gates-8` | MED | [src/core/gates/solo.ts:320,444](src/core/gates/solo.ts#L320), [src/edge/room-events.ts:193-208](src/edge/room-events.ts#L193-L208) | Room world solo clears never record `{ kind: 'gate' }` chronicle facts, breaking gate-count feats | Send `gateFact` with `soloAnswer` (or `noted`) and record it in `landSoloAnswer` |
| 14 | `BUG-gates-9` | MED | [src/core/pack.ts:297-301](src/core/pack.ts#L297-L301) | `mergeNamed` matches names case-sensitively, creating collisions that `library.ts` `saveEntry` later rejects | Compare normalized lowercase trimmed names in `mergeNamed` |
| 15 | `BUG-gates-10` | MED | [src/core/gates/solo.ts:370-371](src/core/gates/solo.ts#L370-L371) | `namedStatuses` in `soloDoc` omits custom statuses referenced by monster `summon.statuses` / `move` ops | Reuse shared transitive `monsterKeys` collector in `namedStatuses` |
| 16 | `SM-gates-3` | MED | [src/views/gates.js:160-176,538](src/views/gates.js#L160-L176) | Frozen `openPanel` allows stale `Clear` form on cleared gates; strict `>` timestamp check can drop merges | Auto-close `'clear'` panel when `!can(g, 'clear')` and merge by content diff or revision |
| 17 | `SM-gates-2` | MED | [src/views/gates.js:182-227](src/views/gates.js#L182-L227) | Gate news queue split across raw `personal-told` array, `asking` Set, and 3-item cap that stalls overflow alerts | Unify gate news queue with typed parser and drain remaining batch after modal dismissal |
| 18 | `SM-gates-4` | MED | [scripts/charts/solo.ts:19-21](scripts/charts/solo.ts#L19-L21), [docs/state-machines.md:1474-1475](docs/state-machines.md#L1474-L1475) | Chart claims `"a gate at once"` on `Off, 3 gates open -> On, 3 gates open` where `soloTick` spawns none | Condition arrow label on `to.gates.length > from.gates.length` and re-run `bun run charts` |
| 19 | `AW-gates-6` | MED | [src/core/registry/monsters.ts:234-252](src/core/registry/monsters.ts#L234-L252), [src/core/story/story.ts:130](src/core/story/story.ts#L130) | Duplicated UTF-8 helpers and missing `THING_MAX.monster` / `abilityTooLarge` whole-monster refusal | Standardize on `size.ts` `bytesOf` and add `THING_MAX.monster` enforcement |
| 20 | `AW-gates-4` | MED | [src/core/registry/maps.ts:17](src/core/registry/maps.ts#L17), [src/core/gates/gate.ts:44,132,163](src/core/gates/gate.ts#L44) | Unvalidated `mapId` cast exported publicly and inconsistent ID validation/fabrication in `gate.ts`/`pack.ts` | Export validated `parseMapId` and use `saveId` / shared ID parsers consistently |
| 21 | `AW-gates-7` | MED | [scripts/publish-clean.ts:23](scripts/publish-clean.ts#L23) | CLI arg `out` interpolated directly into `sh -c` double-quoted string | Spawn `git archive` and `tar` with argv arrays (no shell string interpolation) |
| 22 | `AW-gates-5` | MED | [src/core/library.ts:45](src/core/library.ts#L45), [src/views/map-maker.js:174](src/views/map-maker.js#L174) | `map-maker.js` uses `saveById`, bypassing `namedLike` uniqueness and causing name ambiguity in packs | Route `map-maker.js` through `saveEntry` and keep `saveById` private to `library.ts` |
| 23 | `AW-gates-8` | MED | [tests/lint.test.ts:1023-1055](tests/lint.test.ts#L1023-L1055), [scripts/deps.ts:150-240](scripts/deps.ts#L150-L240) | Regex/brace scanners in `deps.ts` and `lint.test.ts` miss AST semantics despite `typescript` devDependency | Parse files with `ts.createSourceFile` in a shared tooling helper |
| 24 | `BUG-gates-11` | LOW | [src/views/gates.js:309](src/views/gates.js#L309) | GM room solo clear hardcodes boss loot (`lootOf(g.rank, true)`) even when `g.bossId === null` | Pass `g.bossId !== null` to match local solo clear at L288 |
| 25 | `BUG-gates-12` | LOW | [src/core/registry/worth.ts:331-336](src/core/registry/worth.ts#L331-L336) | `wornWorth` ignores `def.stack` and `def.end` without reporting them in `Worth.unweighed` | Record `def.end` and `def.stack` in `at.miss` (or weigh them) in `wornWorth` |
| 26 | `BUG-gates-13` | LOW | [src/core/qr.js:105-106](src/core/qr.js#L105-L106) | `qrSvg` accepts `opts` but calls `qrMatrix(text)` without passing `opts` (drops `mask`) | Pass `opts` through: `qrMatrix(text, opts)` |
| 27 | `SM-gates-5` | LOW | [scripts/ci.ts:32-65](scripts/ci.ts#L32-L65) | CI stall watchdog and `proc.exited` share mutable `pauses` flag with timer-race retry risk | Use an explicit `'running' \| 'stalled' \| 'exited'` phase variable |

---

## (C) Top 10 to Fix First & What Is Already Good

### Top 10 to fix first
1. **`BUG-gates-1`** ([src/core/gates/world.ts:125-126](src/core/gates/world.ts#L125-L126)): One-line guard (`if (isRefused(cleared)) return cleared;`) eliminates duplicate XP, gold, loot, and chronicle inflation on cleared/closed gates.
2. **`BUG-gates-2`** ([src/core/registry/statuses.ts:41,44](src/core/registry/statuses.ts#L41)): Restores the entire stealth subsystem for the built-in `Stealth` skill and `invisible` condition.
3. **`BUG-gates-3`** ([src/core/gates/solo.ts:243](src/core/gates/solo.ts#L243)): One-line spread swap restores GM-customized built-in statuses in room solo runs.
4. **`BUG-gates-4`** ([src/core/registry/abilities.ts:200](src/core/registry/abilities.ts#L200)): Unblocks all 7 wave-2 combat ops (`dispel`, `hasten`, `shove`, `move`, `extra`, `guard`, `negate`) on consumables.
5. **`BUG-gates-5`** ([src/core/pack.ts:83-108,220-259](src/core/pack.ts#L83-L108)): Stops shared custom kits from silently losing dependencies or breaking cross-references on Add-mode pack import.
6. **`BUG-gates-6`** ([src/core/gates/solo.ts:391](src/core/gates/solo.ts#L391), [src/core/protocol.ts:892](src/core/protocol.ts#L892), [server.ts:486](server.ts#L486)): Eliminates silent HTTP 413 room-sync failures for non-ASCII solo docs and sheets.
7. **`BUG-gates-7` & `BUG-gates-8`** ([src/core/gates/solo.ts:413-444](src/core/gates/solo.ts#L413-L444)): Closes the `solo: false` authorization bypass and restores missing `gate` chronicle facts on room world solo clears.
8. **`SM-gates-1`** ([src/views/gates.js:258-302,514](src/views/gates.js#L258-L302)): Prevents double-click races and mid-run UI detachment during `Enter alone`.
9. **`AW-gates-1`** ([src/edge/room-pill.ts:5](src/edge/room-pill.ts#L5), [src/edge/sync.ts:38](src/edge/sync.ts#L38), [tests/deps.test.ts](tests/deps.test.ts)): Removes the last `edge -> views` layer inversion and locks layer boundaries in CI.
10. **`AW-gates-2` & `BUG-gates-9`** ([src/core/save.ts:15,32](src/core/save.ts#L15), [src/core/combat/effect-ops.ts:23](src/core/combat/effect-ops.ts#L23), [src/core/pack.ts:297-301](src/core/pack.ts#L297-L301)): Breaks core runtime value cycles and aligns `pack.ts` case-insensitive uniqueness with `library.ts`.

### What is already good and must be protected
- **Pure core architecture enforced by architectural lints**: [tests/lint.test.ts](tests/lint.test.ts) keeps `src/core/` completely free of DOM, storage, network, module-level `let`, and edge/view imports, and enforces single-writer ownership for every major state domain.
- **Exhaustive generated statecharts**: [scripts/statecharts.ts](scripts/statecharts.ts) and [tests/statecharts.test.ts](tests/statecharts.test.ts) BFS-walk 39 real reducers (including `gate.ts`, `onboarding.ts`, `story/run.ts`, `solo-wait.ts`, `solo.ts`) and verify `docs/state-machines.md` never drifts from the code.
- **Discriminated-union domain modeling in `gate.ts`, `story/run.ts`, `onboarding.ts`, and `solo-wait.ts`**:
  - `Gate` ([src/core/gates/gate.ts:22-30](src/core/gates/gate.ts#L22-L30)) makes `clearedDay` present if and only if `status === 'cleared'`, checked by `@ts-expect-error` tests in [tests/gate.test.ts:240-247](tests/gate.test.ts#L240-L247).
  - `storyMove` ([src/core/story/run.ts:150-240](src/core/story/run.ts#L150-L240)) uses monotonic `opens` (`seen`) optimistic concurrency to make stale/double taps idempotent and guarantees story runs only advance from explicit GM taps.
  - `solo-wait.ts` ([src/core/gates/solo-wait.ts:44-67](src/core/gates/solo-wait.ts#L44-L67)) derives `'lost'` directly from outbox evidence rather than a second flag.
  - `onboarding.ts` ([src/core/onboarding.ts:28-39](src/core/onboarding.ts#L28-L39)) proves every path from start to `done` marks `onboarded` exactly once ([tests/onboarding.test.ts:54-58](tests/onboarding.test.ts#L54-L58)).
- **Atomic save-step writes & snapshot guards**: `soloRan` ([src/core/gates/solo.ts:285-336](src/core/gates/solo.ts#L285-L336)) verifies `soloKey(h) === run.from` inside the write step so a hunter mutated during simulation never gets overwritten, and `soloTaken` ([src/core/gates/solo.ts:435-446](src/core/gates/solo.ts#L435-L446)) re-runs `soloPlan` inside the write and pairs with `sync().once(p.eid, ...)` for idempotency.
- **Zero-dependency deterministic build and strict static serving**: [scripts/build.ts](scripts/build.ts) hashes inputs into a build ID enforced via HTTP `426` handshake in [server.ts:398-399](server.ts#L398-L399), and serves only built in-memory assets.
- **Typed `AppEvents` and `AppApi` cross-module contracts**: [tests/deps.test.ts](tests/deps.test.ts) guarantees zero dead events, zero unregistered API calls, and exact parity between `src/core/api.ts` and view registrations.

---

## Coverage

### Read fully
- **Skills**: All 12 requested `pstack` skills in `.claude/skills/*/SKILL.md` plus `.claude/skills/architect/references/design-red-flags.md`.
- **Architecture & docs**: `AGENTS.md`, `README.md`, `docs/state-machines.md`, all 9 `docs/guide/*.md` files, `docs/GAME-UPDATE.md`, `docs/agent-handoff/START-HERE.md`, `docs/agent-handoff/handoff.md`, `docs/agent-handoff/landed.md`.
- **Lane core modules**: All 7 files in `src/core/gates/` (`gate.ts`, `world.ts`, `spawn.ts`, `pay.ts`, `personal.ts`, `solo-wait.ts`, `solo.ts`); both files in `src/core/story/` (`story.ts`, `run.ts`); all 15 files in `src/core/registry/` (`abilities.ts`, `ability-kinds.ts`, `bundles.ts`, `feats.ts`, `items.ts`, `jobs.ts`, `kit-examples.ts`, `maps.ts`, `monsters.ts`, `paths.ts`, `scalers.ts`, `skills.ts`, `statuses.ts`, `stories.ts`, `worth.ts`); all 5 named core files (`first-run.ts`, `onboarding.ts`, `library.ts`, `pack.ts`, `qr.js`).
- **Tooling, types, config, public, server**: `package.json`, `tsconfig.json`, `tsconfig.views.json`, all 3 files in `types/` (`build.d.ts`, `bun.d.ts`, `views/dom.d.ts`), `public/index.html`, `public/manifest.webmanifest`, `scripts/build.ts`, `scripts/deps.ts`, `scripts/statecharts.ts`, `scripts/ci.ts`, `scripts/ci-plan.ts`, `scripts/publish-clean.ts`, `scripts/ci-public.sh`, `scripts/charts/{gate,onboarding,solo,story}.ts`, `server.ts`.
- **Cross-module verification & lane tests**: `src/views/gates.js`, `src/views/stories.js`, `src/views/app.ts`, `src/edge/room-pill.ts`, `src/edge/room-events.ts`, `src/core/size.ts`, `src/core/ids.ts`, `src/core/day.ts`, `src/core/protocol.ts`, `src/core/combat/fight-parse.ts`, `src/core/combat/standing.ts`, `src/core/combat/rows.ts`, `src/core/combat/zones.ts`, `tests/lint.test.ts`, `tests/deps.test.ts`, `tests/statecharts.test.ts`, `tests/gate.test.ts`, `tests/world.test.ts`, `tests/pay.test.ts`, `tests/solo.test.ts`, `tests/story.test.ts`, `tests/statuses.test.ts`, `tests/abilities.test.ts`, `tests/pack.test.ts`, `tests/qr.test.ts`, `tests/onboarding.test.ts`, `tests/first-run.test.ts`.

### Skimmed
- `docs/dependency-map.md` (read all layer summaries, edge, views, and core cycle edges; scanned via `rg` for all relative imports across `src/core/` and `src/edge/`).
- `docs/agent-handoff/decisions.tsv` (tail 60), `docs/agent-handoff/final/implicit-audit-3.md` (lines 1-150).
- `public/app.css` (lines 1-120; confirmed no JS in `public/`).
- `src/core/formula.ts` (lines 1-300), `src/core/combat/effect-ops.ts` (lines 1-661), `src/core/combat/ability-types.ts` (lines 1-50), `src/core/combat/stacks.ts` (lines 1-30), `src/core/combat/fight.ts` (lines 335-375 + `rg` for `hidden`), `src/core/save.ts` (lines 1-60), `src/core/rules.ts` (lines 1-60), `src/edge/sync.ts` (lines 1-120), `tests/run.test.ts` (lines 1-250), and test case lists via `rg` across `tests/{monsters,maps,worth,solo-wait,spawn,library,items,skills}.test.ts`.

### Not read (outside this lane)
- Screenshot and paper-generation scripts (`scripts/{ui-shots,shots,maker-shots,first-run-shots,rw-paper,kits-paper}.ts`), non-lane chart files in `scripts/charts/` (26 files outside `gate`/`onboarding`/`solo`/`story`), non-lane core/edge/view modules (`src/core/hunter/*`, `src/core/trade/*`, `src/core/sync/*`, most of `src/core/combat/*`, `src/views/*` other than `app.ts`/`gates.js`/`stories.js`), and `tests/e2e/*`.

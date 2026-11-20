# Neon re-audit with evidence: systemgaming, 20 November 2026

- **Audited commit:** `9ef33bd65416f52f8f35d83959dc7373f48165c2` (`origin/main` after PR #43). The 19 November audit was at `a11b6a5d`.
- **Date:** 20 November 2026, 09:21 to 09:52 (UTC-2, Atlantic/South_Georgia).
- **Model:** Gemini 4 Neon high (`gemini-4-neon-high`) through the Antigravity CLI (`agy -p --mode accept-edits`, headless). No Claude and no Anthropic key were used.
- **Method:** Neon ran four lanes in parallel: rules (48 findings), sync (36), views (43) and gates (27). They are the same lanes as on 19 November, and each lane took the findings of the same name. Each lane:
  1. read `docs/agent-handoff/landed.md` first, then the `git log` since `a11b6a5d`, and searched for its finding ids in the docs, the source and the tests;
  2. read the pstack skills in `.claude/skills/` (poteto-mode, statechart, model-the-domain, prove-it-works, test-behavior-not-implementation, blast-radius, tdd), `AGENTS.md` and the architecture docs;
  3. re-checked every finding at HEAD, writing throwaway proofs and running them. The proofs were bun unit tests against the real modules and Playwright drives of the built app (`E2E_CHROMIUM=/opt/google/chrome/chrome`).
  
  The proofs lived in a scratch worktree and were never committed. They are kept on the box at `/workspace/sg-tools/reaudit/proofs/`: `.reaudit/proofs/<lane>/*.test.ts` and `tests/e2e/proof-<lane>-*.e2e.ts` in the entries below refer to those files. The tracked tree was checked afterwards, and `git status` showed no tracked file changed. After the run, the orchestrator re-ran every proof and spot-checked the claims. A check that cannot reproduce a finding never removes it from the open list (see the table at the end).
- **Source findings:** `docs/audit/2026-11-19-neon-audit.md`, with 154 findings.

## Legend

- **How it knows**
  - **RAN:** Neon ran something and saw the fault: a unit test, a script against real modules, or a Playwright drive. For a fixed finding, it saw that the fault is gone. The entry names the proof file, the command and the key output.
  - **READ:** Neon read the code and inferred the fault. It did not run anything. Most architecture and state-machine items are READ.
- **Status**
  - **open:** still present at `9ef33bd6`.
  - **fixed:** gone. The entry cites the commit and the landed.md row.
  - **COULD NOT REPRODUCE:** a tag, not a status. The finding stays in the open list at Neon's severity and position, with a note on what was tried. Nothing is dismissed just because a check could not reproduce it.
  - **not-a-bug:** only when code or a test proves the behavior is intended. Neon's claim is still recorded.
  - **new:** first reported in this run (ids `NEW-<lane>-n`; `NEW-orch-n` was added by the orchestrator).
- **Severity** is Neon's value at HEAD after re-checking. "(was X)" gives the 19 November value where it changed.

## What merged since a11b6a5d

| PR | Merge commit | Merged (UTC-2) | Title |
|---|---|---|---|
| [#39](https://github.com/the-owner/systemgaming/pull/39) | `ab5ef1bb` | 19 Nov 17:30 | The shop closed in death, counting quests, and the audit's first fixes |
| [#40](https://github.com/the-owner/systemgaming/pull/40) | `f3554328` | 19 Nov 21:24 | A detail closed by a tap opens again; notes, the enemy draft, the icons design |
| [#41](https://github.com/the-owner/systemgaming/pull/41) | `243b311e` | 19 Nov 22:54 | The room server holds changes made at the same moment; the unit pass at four workers |
| [#42](https://github.com/the-owner/systemgaming/pull/42) | `47524e5d` | 20 Nov 04:39 | The fight's rules audit, the unit pass on the public repository, the hook tests the pushed commit |
| [#43](https://github.com/the-owner/systemgaming/pull/43) | `9ef33bd6` | 20 Nov 08:15 | Audit: a pack's statuses, a solo run in flight, the battle map's life, import cycles; the lag test's measure |

That is 185 commits and 223 files (+10,817 / −4,809). PRs #39 to #42 came from `claude/nifty-keller-3nvune` and #43 from `claude/festive-fermat-tvpykj`. `festive-fermat` has 3 more commits after the merge (handoff docs only). They are not in this audit.

## Counts

| Status | Count |
|---|---|
| open | 117 (1 tagged COULD NOT REPRODUCE: BUG-views-12) |
| new | 8 (7 from Neon, 1 from the orchestrator) |
| fixed | 37 |
| not-a-bug | 0 |
| **total** | **162** (154 old + 8 new) |

- **Evidence:** RAN 134 and READ 28. Among the open and new findings, RAN 97 and READ 28. All 37 fixed findings were RAN.
- **Open and new by severity:** high 3, med 83, low 39.

## Still open, ordered by importance (125 findings)

Order: severity first. Within each severity, user-visible bugs proven by running come first, then other bugs, then state-machine and architecture items. Ties keep the 19 Nov rank. `old #` is the 19 Nov rank, and `new` marks a finding first reported in this run.

1. **NEW-rules-1** [high] [NEW] `src/core/combat/fight.ts:465-479, src/core/combat/land.ts:47, src/core/combat/fight-turn.ts:66,211`. Non-refill HP raises on a dead hunter's fight row (GM adjust, heal op, per-round regen) raise the row above 0 HP while the sheet stays dead, desyncing fight row and sheet
   - **Tap:** Hunter goes down in a running fight and fails 3 death saves (sheet is Dead); GM adjusts +10 HP on the hunter's fight row (or an ally casts Heal / regen ticks)
   - **Shows:** Fight row stands back up at 10 HP and keeps fighting, while lifeAfter() on the sheet ignores setHp on a dead hunter so the sheet remains Dead at 0 HP
   - **Should show:** The dead hunter's row stays at 0 HP and the heal does nothing. Only a revive brings them back: one the GM grants, or one the player pre-bought.
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / after 3 failed death saves + adjust(hp:+10): fight row hp=10 while hunter.life={at:'dead'}
   - **Fix:** Add a dedicated revive fight command (distinct from adjust) and block positive HP changes in adjust/healed/payDue when rowLife(b, ctx).at === 'dead'  
     _Notes:_ Also noted as a test.todo in commit be10db75 (tests/fight-save.test.ts:382) as the broader sibling of BUG-rules-8 Orchestrator: re-ran it. An ally's Heal op reaches it too, which bypasses the revive rules the owner set on 19 Nov (dead stays dead unless the GM grants a revive or one was pre-bought).
2. **SM-views-1** [high] [old #35] `src/views/ui.js:63-110,141-333`. Modal queue/stack and held-toast lifecycle remain split across stack[], singleton refreshCur, timers, and DOM expandos (t._act, t._t).
   - **Tap:** Queue a 2nd System window while a 1st is open, open a maker via openWindow, close the 1st System window so the 2nd appears on top, then press Escape (or have openWindow's show() throw).
   - **Shows:** Escape closes the maker underneath while the visible System window stays on top; a thrown show() leaves windowOpen() wedged true forever.
   - **Should show:** Escape closes the window you can see, the System window on top. A window that fails to open leaves the app usable.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-a.e2e.ts:18 / bunx playwright test tests/e2e/proof-views-open-a.e2e.ts --workers=1 -g "BUG-views-9" / passed (1.5s): domOrder=['Underlying Maker','Second System'], Escape closed maker while Second System stayed visible, thrown show() left windowOpen()===true
   - **Fix:** Model modal stack/queue in a pure core machine, push on dequeue / post-show(), and replace toast _act/_t expandos with a Map.  
     _Notes:_ Listed in docs/agent-handoff/handoff.md:25 as the next audit unit to tackle.
3. **AW-views-2** [high] [old #37] `tsconfig.views.json:1-12`. All .js views and src/app.js still typecheck under loose TS (strict: false, noImplicitAny: false, strictNullChecks: false, exactOptionalPropertyTypes: false).
   - **User steps:** no user-visible symptom. **Developer trigger:** Inspect tsconfig.views.json:5-8; nullable derefs and untyped DOM expandos (_h, _act, _t) pass bun run typecheck without warning.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Migrate views incrementally to strict .ts (starting with small modules like detail.js, io.js, coin.js, uses.js) and remove DOM expandos.  
     _Notes:_ Unchanged since a11b6a5d (only room-pill.ts moved in as .ts).
4. **BUG-rules-5** [med (was high)] [old #22] `src/core/combat/fight-turn.ts:393-401`. grounded() crash was fixed (18cbd5e1), but turnReaction at line 393-394 still skips consequences(), dropping vitals/sendRemote write-backs for mana, fatigue, HP, statuses, and uses spent by a turn reaction
   - **Tap:** A hunter arms a 'turn' reaction that costs mana/fatigue (or applies a status), ends their turn, and the reaction fires before the named foe's turn
   - **Shows:** Hunter's fight row loses 5 mana and gains 2 fatigue, but zero vitals/sendRemote write-back effects are emitted; hunter's sheet (or remote player's phone) never receives the mana/fatigue/status change
   - **Should show:** The reaction's mana and fatigue cost shows on the hunter's sheet and on the player's phone, the same as when they use it on their own turn.
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / part 1 (grounded) passes (phase='ended'); part 2 (turnReaction): aAfter.mana=15 (-5), aAfter.fatigue=2, vitals effects=0
   - **Fix:** In fight-turn.ts:394, run g = consequences(before, logged(...), ctx, fx) before continue  
     _Notes:_ Part 1 (grounded crash) fixed by 18cbd5e1/df66fb41 (landed.md row 33); part 2 (turnReaction skipping consequences) was missed and remains open; sev lowered from high to med
5. **BUG-gates-3** [med] [old #41] `src/core/gates/solo.ts:243`. soloFight spreads t.statuses before R0.conditions, so default built-in statuses overwrite GM-edited built-ins in room solo runs.
   - **Tap:** GM edits a built-in status (e.g. Burning) in the Workshop, puts a monster starting with Burning in a world gate marked Open to solo runs, and a player enters that gate alone.
   - **Shows:** The solo fight plays with the unedited default Burning definition instead of the GM's customized Burning.
   - **Should show:** The solo fight plays with the GM's edited Burning definition from the room's solo doc overlaid on R0.conditions.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: soloFight with target.statuses.burning = 'Super Burning' returned made.R.conditions.burning.label === 'Burning'
   - **Fix:** Swap the spread order at src/core/gates/solo.ts:243 to `{ ...R0.conditions, ...t.statuses }`.  
     _Notes:_ Contradicts comments at solo.ts:174 and solo.ts:240.
6. **BUG-sync-4** [med] [old #44] `src/core/sync/outbox.ts:119, src/edge/sync.ts:436, 669, 689-694`. roomGone skips outbox entries in state 'sending' and deliver() is not aborted via track(gen), leaving zombie queued entries for dead rooms on failure or reload.
   - **Tap:** Player posts a roll or use while the room expires (404 on poll), and the in-flight POST times out or the tab reloads.
   - **Shows:** The in-flight entry is skipped by roomGone and reverts to 'queued' for the deleted room permanently, consuming an OUTBOX_MAX slot.
   - **Should show:** The roll is dropped with a "room is gone" notice, and nothing stays stuck in the send queue.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-core.test.ts / bun test ./.reaudit/proofs/sync/open-core.test.ts / pass: roomGone leaves sending entry intact; failed/reloaded flips it back to queued for dead room
   - **Fix:** Match e.room === room && (e.at === 'queued' // e.at === 'sending') in roomGone (outbox.ts:119) and pass track(gen).signal into deliver().  
     _Notes:_ Bounded by OUTBOX_MAX (100), and a 404 directly on deliver() refuses it; zombie occurs on network/5xx/timeout/reload race.
7. **BUG-rules-1** [med] [old #46] `src/core/overrides.ts:162, src/core/formula.ts:623`. Unbounded numeric GM rule overrides allow 0/negative/1e9 values causing level-9999 jumps, NaN stats/ticks, and standOdds OOM
   - **Tap:** GM opens Rules editor, enters 0 for xpPerLevel or fight.half or fight.round (or 1e9 for dice.maxSides), saves, then grants 1 XP or rolls/parses a 1d1000000000kh1 formula
   - **Shows:** Override is accepted with zero refusals; 1 XP jumps a hunter straight to level 9999, derived stats/timeline become NaN, and 1d1000000000kh1 parses cleanly (calling mean() OOMs in standOdds)
   - **Should show:** The Rules editor refuses 0 or absurd values ("must be at least 1"), and the hunter levels up normally.
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / parseOverrides refused=[], gainXp(h,1,R).to=9999, capped=NaN, eff=NaN, interval=NaN, parseFormula('1d1000000000kh1',R).ok=true
   - **Fix:** Add explicit numeric min/max bounds for all RULES leaves in overrides.ts and cap standOdds sides in formula.ts:623  
     _Notes:_ Self-inflicted GM input only, matching lowered med severity
8. **BUG-sync-2** [med] [old #47] `src/core/hunter/hunter.ts:199-248, src/core/save.ts:411-416`. repairSave validates hunter item/title/quest references in fixHunter before renaming run.bad duplicate or malformed IDs, leaving dangling refs that wipe equipment on the next repair.
   - **Tap:** Player loads or imports a save where two hunters share an item ID (or an equipped item/title/quest has a malformed ID), then makes any save edit.
   - **Shows:** On first load the second hunter's equipped weapon points to the old ID while its item was renamed; on the next edit, the weapon is silently unequipped.
   - **Should show:** Renaming duplicate or malformed IDs updates titleId, equipped, loadouts, penalty, and jobChain to the new ID so nothing is unequipped.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-core.test.ts / bun test ./.reaudit/proofs/sync/open-core.test.ts / pass: after 1st repairSave equipped.weapon='i50' while item renamed; after 2nd repairSave equipped.weapon=null
   - **Fix:** Assign new IDs for run.bad entries (with an object->newId map) before validating references in fixHunter, and move starterHunter creation before draining run.bad.  
     _Notes:_ Reproducible with duplicate IDs across two hunters (not just malformed IDs); starterHunter still runs at save.ts:416 after run.bad drains at :414. Orchestrator: reached only by loading or importing a save where two hunters share an item id, or one with a malformed id; not by normal taps.
9. **BUG-gates-2** [med] [old #48] `src/core/registry/statuses.ts:41,44`. Built-in invisible and stealth statuses still have ops: [] (missing hidden op), leaving the built-in Stealth skill mechanically inert in combat.
   - **Tap:** A hunter in a fight uses the built-in Stealth skill (or GM applies built-in Stealth / Invisible status).
   - **Shows:** The status badge appears on the hunter's row, but the hunter is still targetable by foes, gains no ambush/attacker advantage, is allowed to cast in plain sight, and never breaks stealth.
   - **Should show:** Built-in Stealth and Invisible carry a hidden op so hiding actually conceals the bearer and applies stealth rules.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: BUILT_IN_STATUSES.stealth.ops is [], hunter acts Stealth in fight.ts reduce(), receives 'stealth' status, and holds(row, 'hidden') is false
   - **Fix:** Implement feature 7 (docs/agent-handoff/features/notes-7-stealth.md) giving built-in stealth and invisible their hidden op and replacing the stale pin in tests/statuses.test.ts:123-125.  
     _Notes:_ Intentional pre-kits pin at tests/statuses.test.ts:123-125; the owner ruled Nov 19 to implement stealth/sight (design in commit 23a419b4 notes-7-stealth.md, not yet built). Orchestrator: design decision, not an accident. The owner ruled on 19 Nov to build stealth and sight; the design is in 23a419b4 (notes-7-stealth.md) and is not built yet.
10. **BUG-sync-7** [med] [old #49] `src/edge/sync.ts:482-496, 651-656, src/core/sync/link.ts:382, src/edge/store.ts:285`. In a readOnly tab, Link advances link.cursor on poll while landPage's store.apply is refused ('read-only'), dropping polled events for the rest of the session; postLetter also misreports 'noRoom'.
   - **Tap:** Player has a read-only tab open in a room (e.g., newer-schema save or overtaken by another tab), GM sends a 50-gold award, and player rolls or sends an event.
   - **Shows:** Tab polls the award and advances its poll ?after=1 past it, yet shows 0 gold and no popup; posting an event returns { ok: false, why: 'noRoom' }.
   - **Should show:** The read-only tab shows the award when it becomes writable again, or says plainly that this tab cannot save and is missing room updates.
   - **How it knows:** **RAN.** tests/e2e/proof-sync-browser.e2e.ts / bunx playwright test tests/e2e/proof-sync-browser.e2e.ts --workers=1 / pass: pollCursors reached >=1 while gold=0, savedCursor=0, postRes={ok:false,why:'noRoom'}
   - **Fix:** Align readOnly handling between StoreLife and Link (pause Link polling/cursor advance when readOnly, or add an explicit in-memory bookkeeping path) and distinguish read-only in postLetter.  
     _Notes:_ Events are replayed after a reload because savedCursor stays 0, so loss is session-scoped rather than permanent.
11. **BUG-gates-6** [med] [old #50] `src/core/gates/solo.ts:391; src/core/protocol.ts:894; server.ts:426,528`. soloDoc, protocol.ts soloDocOf, and server.ts DOC_MAX/SHEET_MAX check UTF-16 .length while server.ts readJson enforces MAX_BODY in UTF-8 bytes, causing 413 failures on non-ASCII solo docs.
   - **Tap:** GM using non-ASCII text (e.g. CJK/Cyrillic/emoji) in custom monsters marks world gates Open to solo runs while in a room.
   - **Shows:** GM sees no 'Too many monsters' warning (soloDoc returns left: []), world doc advertises the gates as solo, but PUT /api/rooms/:code/sheets/_solo fails with HTTP 413 too large so players never receive the solo doc.
   - **Should show:** soloDoc measures UTF-8 bytes so gates that exceed the server byte cap are left out cleanly and warned on the GM's card.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: CJK soloDoc had left=[], json.length <= 61440, bytesOf(doc) > 65536, DOCS.solo accepted it, and server PUT _solo returned HTTP 413 { error: 'too large' }
   - **Fix:** Measure DOC_MAX and SHEET_MAX with bytesOf (src/core/size.ts:9) in solo.ts:391, protocol.ts:894, and server.ts:528.  
     _Notes:_ Still completely unfixed across solo.ts, protocol.ts, and server.ts.
12. **BUG-gates-7** [med] [old #52] `src/core/gates/solo.ts:413-420`. soloPlan never checks g.solo, allowing a stale or crafted soloRun event to clear and pay out a world gate that is not open to solo runs.
   - **Tap:** GM unchecks 'Open to solo runs' on a world gate while a player's solo run is in flight (or a client posts a soloRun event for a non-solo gate).
   - **Shows:** GM's phone accepts the soloRun, clears the non-solo gate, and posts a paid soloAnswer with full XP and loot.
   - **Should show:** GM's phone refuses the soloRun because the gate is not open to solo runs and leaves the gate open.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: soloPlan on gate with solo: false returned { kind: 'paid', xp: ... } and soloTaken set gate.status = 'cleared'
   - **Fix:** In src/core/gates/solo.ts:417, refuse when `!g.solo` (e.g. `if (!g.solo) return { kind: 'refused', why: 'closed' };` or add `'not-solo'` to SoloRefused).  
     _Notes:_ soloReady checks g.solo locally (solo.ts:226), but soloPlan on the GM's phone omits it. Orchestrator: needs a stale or forged solo proposal (the GM unticks solo mid-run). The player's phone checks solo first.
13. **BUG-gates-8** [med] [old #54] `src/core/gates/solo.ts:320,444; src/edge/room-events.ts:193-208`. Clearing a room's world solo gate never records a { kind: 'gate' } fact on the player's chronicle, so room solo clears never count toward gate-count feats.
   - **Tap:** Player in a room enters and wins a GM's world gate marked Open to solo runs, then opens their Chronicle / Feats after the GM's phone pays the run.
   - **Shows:** Player receives the XP/gold/items and a solo fact, but their cleared-gates tally stays 0 and gate-count feats (e.g. Regular, Gate Closer) do not advance.
   - **Should show:** Clearing a room's world solo gate records a { kind: 'gate' } chronicle fact just like personal solo clears and manual GM Clears.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: after soloRan -> soloTaken -> landAll(soloAnswer), GM outbox posted ['soloAnswer'] only, player got gold, yet chronicle.inbox had no kind:'gate' fact and tally.gates === 0
   - **Fix:** Post a 'noted' event carrying gateFact alongside soloAnswer in soloTaken (or carry rank/toBreak on paid soloAnswer and record it in landSoloAnswer).  
     _Notes:_ Manual clearGate in gates.js:132-133 posts 'noted' with gateFact; soloTaken at solo.ts:444 omits it.
14. **BUG-rules-12** [med] [old #55] `src/core/combat/resolve.ts:102, src/core/combat/fight-view.ts:268, src/core/combat/map-view.ts:543,550,560`. taunted, aims, and aimFocus ignore sheet:range status modifiers and blinkMax (8)
   - **Tap:** Hunter with +2 range status tries to tap a foe 5 tiles away with a range-4 shot on the map (or shoots another foe while taunted at distance 5); or taps tile 9 with a range-10 blink
   - **Shows:** Map refuses the legal distance-5 shot with 'range', taunted() ignores the taunter at distance 5, and map marks distance-9 blink ok:true before resolve() refuses it with 'range'
   - **Should show:** taunted, aims, aimFocus, and ready all use one effectiveRange() applying both rangeFor() and blinkMax
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / taunted=false at dist 5, aims.inRange=false, tapOn={kind:'refuse',reason:'range'}; farBlink dist 9 aim.ok=true vs resolve={ok:false,reason:'range'}
   - **Fix:** Export effectiveRange(a, rangeAdd, R) in resolve.ts, carry rangeAdd on Spot/MapBody, and call it in taunted, ready, aims, and aimFocus  
     _Notes:_ Note: RULES.fight.kit.blinkMax is 8 (not 6 as the old report wrote)
15. **BUG-gates-9** [med] [old #56] `src/core/pack.ts:233-246`. mergeNamed compares names case-sensitively, allowing case-colliding entries that library.ts saveEntry later refuses with 'taken'.
   - **Tap:** GM has custom item 'Potion', imports a pack containing 'potion' in Add mode, then opens 'Potion' in the maker and taps Save.
   - **Shows:** Both 'Potion' and 'potion' coexist in the library after import; saving either entry in the maker is refused because the other already holds that name case-insensitively.
   - **Should show:** Importing 'potion' in Add mode renames it to 'potion 2' (and Replace matches case-insensitively), matching library.ts namedLike.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: mergePack(add) left ['Potion', 'potion'] with renamed: 0, then saveEntry on 'Potion' returned { ok: false, why: 'taken' }
   - **Fix:** Normalize names with `.trim().toLowerCase()` in mergeNamed (src/core/pack.ts:237,240-241) for both replace matching and add collision suffixing.  
     _Notes:_ Explicitly noted as left open in decisions.tsv row 407.
16. **BUG-gates-10** [med] [old #58] `src/core/gates/solo.ts:370-371`. namedStatuses in soloDoc only reads monster.statuses, omitting custom statuses referenced in monster abilities (summon.statuses, move ops, formulas, zones, triggers) and transitive status defs.
   - **Tap:** GM creates custom status 'void-ward', gives a monster an ability whose summon starts with 'void-ward' (or a move op converting to 'void-ward'), puts it in a world solo gate, and a player runs it alone.
   - **Shows:** The solo doc's statuses map is empty, so on the player's phone the monster's summon spawns without 'void-ward' (silently dropped by rows.ts:274).
   - **Should show:** soloDoc includes all custom statuses referenced anywhere in the monster's abilities or starting statuses (transitively).
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: monster with summon.statuses and move op referencing 'void-ward' yielded Object.keys(doc.statuses) === []
   - **Fix:** Reuse namedIn(monster, m, keys) and transitive namedIn(statusDef, ...) from src/core/status-refs.ts inside namedStatuses (src/core/gates/solo.ts:370).  
     _Notes:_ status-refs.ts landed in 8f5a3b0b for pack.ts, making this fix now a small reuse.
17. **BUG-views-9** [med] [old #59] `src/views/ui.js:158-160,201-204,236-256`. Queued system window opens visually above openWindow while remaining behind it in stack[], misrouting Escape/Tab; a thrown show() leaves a permanent 'open' entry.
   - **Tap:** Open System window S1, queue S2, open a maker window, close S1 so S2 appears visually on top of the maker, then press Escape.
   - **Shows:** Escape closes the obscured maker underneath while S2 remains open on top; if openWindow's show() throws, ui.windowOpen() remains true forever.
   - **Should show:** Move dequeued system window to the top of stack[] so Escape/Tab target the top visible dialog, and push to stack[] only after show() succeeds.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-a.e2e.ts:18 / bunx playwright test tests/e2e/proof-views-open-a.e2e.ts --workers=1 -g "BUG-views-9" / passed (1.5s): Escape removed .mk-overlay while Second System stayed visible; thrown show() kept windowOpen()===true
   - **Fix:** In openNext() move w to the end of stack before calling w.show(); in openWindow() call show() before stack.push(w).  
     _Notes:_ Concrete symptom of SM-views-1.
18. **BUG-rules-13** [med] [old #60] `src/core/combat/land.ts:187-192,307,309, src/core/combat/triggers.ts:113, src/core/combat/resolve.ts:551-555`. landOps emits statusGained on refused statuses, landOne dispel skips cureLands/cured, channel:break bypasses protect, cureStatus reads pre-loop snapshot, and eventsOf misses dispel/move
   - **Tap:** Trigger or reaction applies a harmful status onto a Safeguarded target, dispels a cleanse:'land' bomb, breaks a channel-protected caster, or cures a bomb applied earlier in the same ops list
   - **Shows:** Safeguarded target rejects poison yet emits statusGained; dispel removes bomb with 0 damage and cured=[]; channel:break breaks despite channel:protect; apply+cure in one op list skips detonation; eventsOf emits no statusEnded for dispel
   - **Should show:** landOne returns put and detonated, respects channelBreaks(), reads current t before cureStatus, and eventsOf diffs statuses for statusEnded/statusGained
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / all 5 sub-bugs verified: gained contains 'poison' when refused; dispel hp unchanged & cured=[]; channel='broken' despite protect; apply+cure hp unchanged; eventsOf statusEnded=false
   - **Fix:** Return put and detonated from landOne, gate channel:break on channelBreaks(), inspect live t before cureStatus, and diff statuses in eventsOf  
     _Notes:_ All 5 sub-issues still open at HEAD
19. **BUG-sync-10** [med] [old #61] `src/edge/upgrade.ts:36-61`. upgrade.ts re-arms its quiet timer after synchronously transitioning to 'reloading' (no SW) and ignores registration.waiting, reloading prematurely under the old service worker.
   - **Tap:** Deploy lands while a player is in a room; room API returns 426 upgrade just as the new service worker enters registration.waiting (or on a browser without serviceWorker).
   - **Shows:** Without serviceWorker, 'wait' arms a quiet timer after location.reload(); with a waiting worker, look() reports installing:false and reloads immediately under the old worker, risking a false stuck lockout.
   - **Should show:** Re-entrant events queue inside send() so stale effects do not run after reloading, and look() treats registration.installing // registration.waiting as in-progress.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-edge.test.ts / bun test ./.reaudit/proofs/sync/open-edge.test.ts / pass: armed.size===1 after reloading (part 1); reloads===1 despite registration.waiting!==null (part 2)
   - **Fix:** Queue re-entrant events in send() (upgrade.ts:36-40) and check registration.installing !== null // registration.waiting !== null at upgrade.ts:59.  
     _Notes:_ Both halves reproduced directly against src/edge/upgrade.ts.
20. **BUG-rules-14** [med] [old #64] `src/core/combat/fight.ts:266-268,305`. afterReactions runs after tallied/triggered (dropping counterattack kills/triggers) and charges a second reactor on an already-downed monster
   - **Tap:** Two allies arm 'after' counterattack reactions; a monster attacks Ally 1, Ally 1's counterattack kills the monster
   - **Shows:** Ally 1 gets 0 kills in RowTally (and no kill/down/struck triggers fire), and Ally 2 still fires its reaction, losing 4 mana and its cooldown/uses against the already-dead monster
   - **Should show:** afterReactions skips an attacker already at 0 HP and feeds its outcomes into tallied and triggered
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / mAfter.hp=0, a1After.tally.kills=0, a2After.mana=16 (lost 4 mana on dead monster)
   - **Fix:** Stop afterReactions when !alive(map.get(by)!) (or hp<=0) and record afterReactions kills/damage in tallied() and triggered()  
     _Notes:_ Verified at fight.ts:266-268 and 305
21. **BUG-sync-9** [med] [old #65] `server.ts:426, 528, src/edge/sync.ts:533, 767, src/core/protocol.ts:631, 637, 894`. SHEET_MAX and DOC_MAX are checked with UTF-16 string .length while server MAX_BODY (64 KiB) enforces UTF-8 byte length, causing 413 failures on multi-byte text that passed client/protocol size checks.
   - **Tap:** GM publishes a solo or fight doc (or player pushes a sheet) containing multi-byte UTF-8 text (e.g., Korean/CJK names or symbols) whose UTF-16 length is under DOC_MAX/SHEET_MAX but UTF-8 size exceeds 64 KiB.
   - **Shows:** Client and protocol.ts DOCS.solo accept the payload, then server.ts:426 rejects the PUT with HTTP 413 too large.
   - **Should show:** Client, protocol, and server all measure DOC_MAX and SHEET_MAX in UTF-8 bytes via bytesOf so limits agree across ASCII and multi-byte text.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-core.test.ts / bun test ./.reaudit/proofs/sync/open-core.test.ts / pass: Korean soloDoc passes DOC_MAX and DOCS.solo, then PUT /sheets/_solo returns HTTP 413
   - **Fix:** Use bytesOf from src/core/size.ts for DOC_MAX and SHEET_MAX checks in server.ts:528, sync.ts:533,767, and protocol.ts:894.  
     _Notes:_ Directly relevant to Solo Leveling campaigns using Korean/CJK/emoji text.
22. **BUG-views-11** [med] [old #67] `src/views/uses.js:75`. uses.cast builds its target list using openGrid(w, h) instead of docGround(t.doc).grid, ignoring walls and line-of-sight.
   - **Tap:** In a room fight on a walled map, player switches to List HUD (or Skills/Bag) on their turn and taps Use on a ranged line skill (e.g. Arc Bolt) while a foe stands behind a wall.
   - **Shows:** The foe behind the wall appears as a selectable target in the 'Use Arc Bolt on…' dialog (picking it posts a cast the GM reducer refuses).
   - **Should show:** Filter targets through docGround(t.doc).grid so foes behind walls are not offered.
   - **How it knows:** **RAN.** .reaudit/proofs/views/open-views-unit.test.ts + tests/e2e/proof-views-open-b.e2e.ts:20 / bun test ./.reaudit/proofs/views/open-views-unit.test.ts & bunx playwright test tests/e2e/proof-views-open-b.e2e.ts --workers=1 -g "BUG-views-11" / unit: buggy=['Goblin'] vs fixed=[]; browser: WallGoblin behind wall shown in 'Use Arc Bolt on' picker (passed 14.1s)
   - **Fix:** Import docGround from ../core/combat/map-view.ts and pass docGround(t.doc).grid to aims() at src/views/uses.js:75.  
     _Notes:_ One-line swap; table.js:236 already uses docGround(e).grid.
23. **BUG-rules-15** [med] [old #68] `src/core/combat/resolve.ts:370,409-412`. Multiple die-based boost statuses on one combatant collide by CombatantId in needs() and keptFace()
   - **Tap:** Attacker holds two die-based attack boost statuses (e.g. +1d4 Bless and +1d8 Focus) and uses an attack
   - **Shows:** needs() requests only one die ([{id:'A', sides:4}]), dropping the d8, while keptFace() subtracts rolls.boost['A'] twice (using the d4 for both) and spendEdges() consumes both statuses
   - **Should show:** Each die-based boost status requests and reads its own roll keyed by combatant id + status key
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / with bless(d4)+focus(d8), needs().boost=[{id:'A',sides:4}] (d8 dropped)
   - **Fix:** Key Needs.boost and Rolls.boost by `${id}:${key}` instead of `id` alone in resolve.ts:370,410  
     _Notes:_ Also update rollNeeds in draws.ts/roll.ts for the composite key
24. **BUG-rules-16** [med] [old #72] `src/core/rules.ts:19, src/views/rulesref.js:136,158,199-200`. Rules page reads dead RULES.dailyRewardPoints and prints 5x wrong item sell values (baseValue * mult instead of sellPrice)
   - **Tap:** User opens Rules -> Loot and rarity (and optionally GM overrides dailyRewardPoints=5 and views Rules -> Leveling vs Daily quests), then sells an unpriced Common item in Bag
   - **Shows:** Rules prints Common sell value '×1 (10 gold)' and 'grants +5' vs '1 point', while selling an unpriced Common item actually pays 50 gold (and dailies award 1 point)
   - **Should show:** Rules page reads dailyTemplate.rewards.points everywhere and displays sell values computed via priceOf()/sellPrice() (Common = 50 gold)
   - **How it knows:** **RAN.** tests/e2e/proof-rules-rulesref.e2e.ts / timeout 600 bunx playwright test tests/e2e/proof-rules-rulesref.e2e.ts --workers=1 / 1 passed (3.8s): #rr-leveling='grants +5', #rr-daily='1 point', #rr-loot='×1 (10 gold)', actual Bag sell paid 50 gold
   - **Fix:** Remove RULES.dailyRewardPoints (read R.dailyTemplate.rewards.points) and compute Rules Loot sell values from priceOf()/sellPrice()  
     _Notes:_ Proven both in unit test and live browser UI
25. **BUG-views-13** [med] [old #75] `src/views/combat.js:1057-1059, src/views/shadows.js:48-58`. Cancelling (or blocking) Shadow Extraction in Combat view returns null from shadows.extract(), causing combat.js to toast 'Extraction of X failed.'.
   - **Tap:** GM with a Necromancer in Combat defeats a bestiary monster, taps Extract on its card, and taps Cancel in the Shadow Extraction dialog.
   - **Shows:** Toast reads 'Extraction of <monster> failed.' even though the GM cancelled and no roll occurred.
   - **Should show:** Show no failure toast when extraction is cancelled or blocked before rolling.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-b.e2e.ts:103 / bunx playwright test tests/e2e/proof-views-open-b.e2e.ts --workers=1 -g "BUG-views-13" / passed (2.1s): cancelling extraction displayed toast 'Extraction of <monster> failed.'
   - **Fix:** Return a discriminated outcome ('risen' / 'failed' / 'cancelled' / 'blocked') from shadows.extract() and toast failure in combat.js only on 'failed'.  
     _Notes:_ Also occurs if army is full or attempts left is 0 (blocked paths return null too).
26. **BUG-sync-12** [med] [old #77] `src/edge/sync.ts:566, 589-599`. When join-new-hunter's addHunter fails (e.g., readOnly tab), settleAttempt silently joins with the existing active hunter; when join fails after creating a hunter and prevActive is gone, undo's both() rolls back removeHunter and orphans the new hunter.
   - **Tap:** Player in a read-only tab joins a room with a typed new hunter name; or a new-hunter join fails after prevActive was deleted.
   - **Shows:** Join succeeds as 'player' without creating the new hunter (silently binding the old active hunter); in the undo case, both(removeHunter, setActive) refuses with 'no-hunter' and leaves the created hunter in the party.
   - **Should show:** Failed addHunter aborts/rejects the join; undo removes the created hunter even if prevActive no longer exists.
   - **How it knows:** **RAN.** tests/e2e/proof-sync-browser.e2e.ts & .reaudit/proofs/sync/open-core.test.ts / pass: readOnly joinRoom({name:'Brand New Hunter'}) resolved 'player' without adding it; both(removeHunter,setActive(missing)) returned refuse('no-hunter')
   - **Fix:** Abort and reject the join if join-new-hunter store.apply fails (sync.ts:592), and wrap setActive(d, a.prevActive) in orKeep() inside join-new-hunter-undo (sync.ts:598).  
     _Notes:_ Both halves verified by running code.
27. **BUG-views-14** [med] [old #79] `src/views/maker.js:811`. buildAbility's input listener only checks dataset.a or 'ztrig' in dataset, ignoring inputs from [data-zend-fx] so the zone-end error banner stays stuck.
   - **Tap:** GM opens Skill Maker, expands 'Leaves a field', ticks 'Leaves a field' and 'Something lands when it ends', then taps a Quick effect chip inside the zone-end effects editor.
   - **Shows:** Save button becomes enabled, but the red alert banner still displays 'Add what lands when it ends.'.
   - **Should show:** Clear the zone-end error banner as soon as a valid zone-end effect is added.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-a.e2e.ts:86 / bunx playwright test tests/e2e/proof-views-open-a.e2e.ts --workers=1 -g "BUG-views-14" / passed (1.9s): [data-apply] enabled while [data-zend-err] stayed 'Add what lands when it ends.'
   - **Fix:** Update maker.js:811 to call draw() whenever e.target.closest('[data-zend-fx],[data-zone-fx]') matches.  
     _Notes:_ Conversely, removing the last zone-end effect leaves [data-zend-err] blank while disabling Save.
28. **BUG-rules-17** [med] [old #80] `src/core/bestiary.ts:103,106, src/core/hunter/feats.ts:209,211, src/core/combat/fight-doc.ts:403, server.ts:426,528`. Room doc builders measure UTF-16 .length against DOC_MAX (62000), letting non-ASCII docs exceed server.ts 64 KiB UTF-8 MAX_BODY (HTTP 413)
   - **Tap:** GM authors feats or bestiary entries in CJK/Cyrillic/emoji/non-ASCII text and syncs the room
   - **Shows:** featsDoc/codexDoc accept JSON <= 62000 UTF-16 chars whose UTF-8 byte size exceeds 65536 bytes, causing PUT /api/rooms/:code/sheets/_... to fail with HTTP 413 too large
   - **Should show:** Doc builders and protocol/server size checks all measure UTF-8 byte length via bytesOf() from size.ts
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / CJK featsDoc & codexDoc pass JSON.length <= 62000 while bytesOf(json) > 65536
   - **Fix:** Replace JSON.stringify(...).length with bytesOf(JSON.stringify(...)) from size.ts in bestiary.ts, feats.ts, fight-doc.ts, protocol.ts, and server.ts:528  
     _Notes:_ server.ts:426 enforces UTF-8 bytes > 65536 while server.ts:528 and all doc builders check UTF-16 .length
29. **BUG-sync-13** [med] [old #81] `src/edge/sync.ts:460-467, 713, src/core/sync/bind.ts:89-92`. switchTo calls boundTo(s, to.id, srvNow()), moving settings.sync.joinedAt forward so live room events sent moments before switching hunters falsely trigger the 'WHILE YOU WERE AWAY' modal.
   - **Tap:** Player is live in a room with two hunters; GM sends an award; before the next poll arrives, player switches hunters via the header dropdown ('Play as Hunter Two').
   - **Shows:** When the next poll arrives, the live award opens a 'WHILE YOU WERE AWAY' modal saying 'These were sent while this phone was out of the room.'
   - **Should show:** Live events sent while the phone was in the room arrive as normal live awards/toasts, not 'WHILE YOU WERE AWAY'.
   - **How it knows:** **RAN.** tests/e2e/proof-sync-browser.e2e.ts / bunx playwright test tests/e2e/proof-sync-browser.e2e.ts --workers=1 / pass: live award sent before switchTo triggered visible 'WHILE YOU WERE AWAY' overlay
   - **Fix:** Keep joinedAt (room join timestamp for away detection) separate from boundAt (rebind timestamp for removedSinceJoin) so switchTo updates only boundAt.  
     _Notes:_ Cleanly reproduced end-to-end in Playwright.
30. **BUG-views-15** [med] [old #82] `src/views/quests.js:333,382-439,570-594`. Switching the active hunter while the inline quest Edit form is open does not close/reset the form, duplicating the quest onto Hunter B (player) or trapping GM on hidden [data-who].
   - **Tap:** Open Quests on Hunter A, tap Edit on a quest, switch active hunter to Hunter B in the header selector, and tap Save quest.
   - **Shows:** As player: silently creates a duplicate quest on Hunter B. As GM: shows 'Pick at least one hunter.' while the 'Assign to' section remains hidden.
   - **Should show:** Close and reset the inline quest form whenever store.active().id changes.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-a.e2e.ts:106 / bunx playwright test tests/e2e/proof-views-open-a.e2e.ts --workers=1 -g "BUG-views-15" / passed (1.5s): Hunter B got duplicate 'Hunt Wolves'; GM got 'Pick at least one hunter.' with [data-who] hidden
   - **Fix:** Store the hunter ID the inline form opened for (or explicit closed/new/edit state) and close the form in update() when store.active().id changes.  
     _Notes:_ Directly driven by SM-views-6.
31. **BUG-sync-14** [med] [old #84] `src/edge/store.ts:200-203`. schedule() never stores or cancels its 1000 ms fallback timer when the rAF write flushes early, allowing a stale fallback timer to flush a later dirty change synchronously before the next paint.
   - **Tap:** Player triggers a save change at t=0 (flushed by rAF at 16 ms), then makes another edit right before t=1000 ms.
   - **Shows:** The uncancelled 1000 ms timer from the first change fires before the second change's rAF paint, running JSON.stringify + localStorage.setItem synchronously inside the frame.
   - **Should show:** Flushing via rAF or leaving cancels both pending rAF and fallback timer handles so no stale timer survives.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-edge.test.ts / bun test ./.reaudit/proofs/sync/open-edge.test.ts / pass: fallback1.cleared===false after rAF flush; firing fallback1 flushed Change #2 (writes=2) before Change #2's rAF
   - **Fix:** Store pending rafId and fallbackTimer in store.ts and cancel both whenever due or leaving runs.  
     _Notes:_ Directly defeats the frame-budget invariant documented at src/edge/store.ts:196-199.
32. **BUG-views-16** [med] [old #86] `src/views/table.js:231,315,318`. Player List HUD and Desktop Kit consumables call inventory.use without sent(), bypassing the turn hold double-submit guard; 'dropped' outbox events never release hold.
   - **Tap:** On a player's turn in List HUD, tap Use on a combat consumable (or tap End turn and have the outbox entry dropped).
   - **Shows:** After tapping a consumable, End turn and other actions remain enabled while the cast is in flight; after a 'dropped' outbox event on End turn, all action buttons stay stuck disabled.
   - **Should show:** Engage hold on consumable casts via sent() and release hold on both 'refused' and 'dropped' outbox events.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-b.e2e.ts:20 / bunx playwright test tests/e2e/proof-views-open-b.e2e.ts --workers=1 -g "BUG-views-11" / passed (14.1s): [data-pass] remained enabled after consumable tap; boltBtn stayed disabled after sync:outbox at='dropped'
   - **Fix:** Return the uses.cast promise from inventory.use when onTable, wrap table.js:315,318 in sent(e, ...), and check o.at === 'refused' // o.at === 'dropped' at table.js:231.  
     _Notes:_ Concrete symptom of SM-views-4.
33. **BUG-rules-18** [med] [old #87] `src/core/combat/fight-parse.ts:654`. parseFight caps hunter origin level at hardcoded 200 while MAX_LEVEL is 9999, deleting running fights on reload
   - **Tap:** GM sets a hunter to level 201+, starts a fight with them, and reloads the page
   - **Shows:** parseFight() rejects the row (whole(b.level, 1, 200) -> null) and drops the entire running fight on load
   - **Should show:** parseFight() accepts any valid hunter level up to MAX_LEVEL (9999) and restores the fight on reload
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / parseFight(serialized level-201 fight, RULES) returned null
   - **Fix:** Import MAX_LEVEL from ../hunter/progress.ts and use whole(b.level, 1, MAX_LEVEL) at fight-parse.ts:654  
     _Notes:_ One-line fix
34. **BUG-views-17** [med] [old #90] `src/views/story-maker.js:158-160`. story-maker.js save() only runs quest.check() on the currently expanded chapter, letting invalid quests in collapsed chapters bypass validation.
   - **Tap:** In Story Maker, give Chapter 1 a quest of kind Job Change with a title and no Job selected in Rewards, add Chapter 2 (collapsing Chapter 1), name Chapter 2, and tap Save story.
   - **Shows:** Story saves with Chapter 1 holding an invalid job quest (rewards.job === null).
   - **Should show:** Validate every chapter's quest on Save regardless of which chapter is expanded, opening the offending chapter on error.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-a.e2e.ts:144 / bunx playwright test tests/e2e/proof-views-open-a.e2e.ts --workers=1 -g "BUG-views-17" / passed (2.2s): story saved with chapters[0].quest.kind==='job' and rewards.job===null
   - **Fix:** Validate every chapter's c.quest in problem(r) (checking kind === 'job' && !c.quest.rewards.job and unfinished rows) instead of only the mounted quest editor.  
     _Notes:_ Also noted in SM-views-10.
35. **BUG-rules-9** [med] [old #91] `src/core/hunter/inventory.ts:75-78`. editItem keeps an edited item equipped in its old slot (and/or with qty > 1) when its slot or quantity changes
   - **Tap:** Hunter equips a sword in weapon slot; GM edits that held item to slot='chest' and qty=3
   - **Shows:** Item remains equipped in h.equipped.weapon while its own slot is 'chest' and qty is 3
   - **Should show:** editItem unwears itemId whenever the new slot is incompatible with its worn slot (allowing ring1/ring2) or qty > 1
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / edited.equipped.weapon='i1' despite slot='chest' and qty=3
   - **Fix:** In inventory.ts:77, unwear itemId when !it.slot, it.qty > 1, or the currently worn slot does not match it.slot (treating ring1/ring2 as compatible)  
     _Notes:_ Line shifted from 68-71 to 75-78
36. **BUG-views-18** [med] [old #93] `src/views/rulesref.js:187,249`. Rules reference view cache sig omits room rules (staying stale for players when GM changes synced rules) and line 187 hardcodes '(minimum 5)' instead of R.shadow.dcMin.
   - **Tap:** GM sets shadow.dcMin to 8 and views Rules; in a room, player opens Rules, then GM changes solo.personal/solo.hours and player re-opens Rules.
   - **Shows:** GM's Rules still prints '(minimum 5)' despite shadow.dcMin === 8; player's Rules #rr-gates text stays stale even after player's app.rules().solo updates.
   - **Should show:** Interpolate R.shadow.dcMin at rulesref.js:187 and include app.rules() (or room rules doc) in rulesref.js:249 sig.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-a.e2e.ts:166 / bunx playwright test tests/e2e/proof-views-open-a.e2e.ts --workers=1 -g "BUG-views-18" / passed (9.6s): #rr-shadows still contained '(minimum 5)' with dcMin=8; player #rr-gates unchanged after solo.hours synced to 12
   - **Fix:** Replace literal 5 with ${R.shadow.dcMin} at rulesref.js:187 and key sig on app.rules() (or include app.api.sync.doc('rules')) at rulesref.js:249.  
     _Notes:_ Room rules doc syncs build, solo, and feats switches; rulesref renders soloLines(R) in #rr-gates.
37. **BUG-rules-10** [med] [old #94] `src/core/hunter/noticed.ts:81, src/core/hunter/feats.ts:79,84`. distinct + within:'row' feats do not clear vals on 'broke', permanently preventing previously seen values from counting in future streaks
   - **Tap:** Hunter kills Goblin (D) and Orc (D) toward a distinct-in-a-row feat (n=2), breaks the streak with a Slime (E), then kills Goblin (D) again
   - **Shows:** Streak resets n to 0 but keeps vals=['goblin','orc'], so killing Goblin again leaves n stuck at 0
   - **Should show:** Breaking a row resets count to { n: 0, mark: from.mark } without vals so Goblin counts as 1 in the new streak
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / after broke: {at:'shown', n:0, vals:['goblin','orc']}; killing Goblin again stayed n=0
   - **Fix:** Pass { n: 0, mark: from.mark } (dropping vals) on 'broke' in noticed.ts:81 and drop vals in feats.ts:79,84 (matching counts.ts:164)  
     _Notes:_ Interestingly, counts.ts:164 (objectiveStep) already drops vals on 'broke', while noticed.ts:81 still spreads ...from
38. **BUG-views-20** [med] [old #99] `src/views/combat.js:296-312,891-906`. Read-only refusal checks in applyAmount/addparty/startFlow were fixed in b5d24630, but setIntent and useAbility still capture stale fight()/list across await ui.system().
   - **Tap:** GM selects a monster with a place-aimed blast, taps Set intent…, picks the blast, and while the target picker is open the target hunter moves from (2,2) to (5,5); GM taps the hunter.
   - **Shows:** Monster's intent is set on the stale coordinates (2,2) instead of the hunter's current tile (5,5).
   - **Should show:** Re-read fight() after each await in setIntent and useAbility so targets and tile coordinates reflect live positions.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-b.e2e.ts:127 / bunx playwright test tests/e2e/proof-views-open-b.e2e.ts --workers=1 -g "BUG-views-20" / passed (2.3s): intent.aim equaled {x:2,y:2} after hunter moved to {x:5,y:5}
   - **Fix:** Re-read fight() and resolve the chosen target's current row/place after await ui.system() in combat.js setIntent() and useAbility().  
     _Notes:_ applyAmount (:406), addparty (:1020), and startFlow (:535) refusal checks are fixed; only the async stale-snapshot half remains open.
39. **BUG-sync-15** [med] [old #101] `src/edge/store.ts:97, 104, 156-159`. When storage is full and a save has only a corrupt fight field (campaign opens fine, fight dropped, backup fails), StoreLife shows loadUnkept saying 'Your save could not be opened'.
   - **Tap:** Player opens the app with full browser storage and a save whose fight field is corrupt while the campaign and hunters are intact.
   - **Shows:** The hunter and campaign open normally without the fight, yet the banner alarms: 'Your save could not be opened, and storage is too full to keep a copy of it in Backups...'
   - **Should show:** The banner accurately states that the campaign opened without its unreadable fight and storage was too full to back up the old save.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-edge.test.ts / bun test ./.reaudit/proofs/sync/open-edge.test.ts / pass: store.active().name==='Intact Hero' & fight===null yet notices includes loadUnkept ('Your save could not be opened')
   - **Fix:** Distinguish fightUnkept from loadUnkept in StoreLife / store.ts:104,158 when loaded.notice === 'fight'.  
     _Notes:_ Reproduced directly against src/edge/store.ts.
40. **BUG-rules-19** [med] [old #103] `src/core/combat/effect-ops.ts:538-545`. settle() runs leave:'round' stack decay before time expiry, moving a stacking delayed-end status to spent instead of expired on its final round and suppressing end detonation
   - **Tap:** Combatant holds a 1-stack status with leave:'round' and a delayed end (damage bomb) with 1 round remaining; their turn starts
   - **Shows:** Status wears off as 'spent' with 0 detonation damage; settleRow only detonates statuses in s.expired
   - **Should show:** Time expiry (until !== null && now >= until) takes precedence over leave:'round' decay so delayed end detonates
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / settle([ticking], tick(1000), RULES) -> spent.length=1, expired.length=0
   - **Fix:** Check `if (s.until !== null && now >= s.until) { expired.push(next); continue; }` before leave:'round' stackStep in effect-ops.ts:538  
     _Notes:_ Verified at effect-ops.ts:538-545
41. **BUG-rules-20** [med] [old #109] `src/core/hunter/grant.ts:342-343`. sheetEdit put/drop skips fitted(), leaving HP/mana/fatigue above reduced maxima
   - **Tap:** Hunter at full HP wears a +VIT or +hpMax status outside a fight; GM removes the status via the Status window (or adds a -VIT debuff)
   - **Shows:** Hunter's current HP stays above their new lower hpMax (e.g. buffedMax > baseMax) until an unrelated edit calls fitted()
   - **Should show:** sheetEdit put and drop clamp HP/mana/fatigue to the new maxima via fitted()
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / after dropping +30 vit status, dropped.life.hp stayed at buffedMax (> baseMax)
   - **Fix:** Wrap non-refused putStatus/dropStatus returns in fitted(..., R) at grant.ts:342-343  
     _Notes:_ Line shifted from 301-302 to 342-343
42. **BUG-rules-21** [med] [old #112] `src/core/hunter/grant.ts:183-185,248`. grant and finishQuest bypass sheetEdit on refill, dropping Chronicle life:raised facts on dying hunters and setting levelup.refill=true on dead hunters
   - **Tap:** Dying hunter levels up from a reward or finishes all dailies outside a fight; OR dead hunter levels up from an XP reward outside a fight
   - **Shows:** Dying hunter stands up with zero life:raised fact recorded in Chronicle; dead hunter stays dead at 0 HP yet levelup.refill is true ('HP and mana restored')
   - **Should show:** Route refills through sheetEdit (recording life:raised on dying/stable -> up) and report levelup.refill=false (or mana-only) when the hunter is dead
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / dying grant & finishQuest raised to 'up' with life:raised=false; dead grant stayed life='dead' with levelup.refill=true
   - **Fix:** Add a refill arm to sheetEdit (recording lifeNews) and use it in grant.ts:183,248; gate levelup.refill on life.at !== 'dead'  
     _Notes:_ Verified all 3 paths in hunter-core-proofs.test.ts Orchestrator: part 3 of this proof shows a dying hunter standing up after a daily. That conflicts with the owner's 19 Nov decision "Dailies should not recover you"; see NEW-orch-1.
43. **NEW-sync-1** [med] [NEW] `src/edge/sync.ts:704-719, src/app.js:235-236`. sync.switchTo drops the Refused answer of store.apply('switch-hunter') and returns true, so switching hunters in a readOnly tab desynchronizes #hunter-sel from store.active() with no 'Not saved' toast.
   - **Tap:** In a read-only tab with two hunters, user picks the second hunter from the header hunter switcher (#hunter-sel).
   - **Shows:** Header dropdown stays on 'Second One' with no 'Not saved' toast while store.active() and the entire sheet remain on 'Existing One' (and in 'view' mode even toasts 'stays synced').
   - **Should show:** switchTo checks store.apply via ui.wrote (or returns false on refusal), shows 'Not saved', and resets #hunter-sel back to the active hunter.
   - **How it knows:** **RAN.** tests/e2e/proof-sync-browser.e2e.ts / bunx playwright test tests/e2e/proof-sync-browser.e2e.ts --workers=1 / pass: selectValue==='h2' while activeId==='h1' and no 'Not saved' toast
   - **Fix:** Return store.apply('switch-hunter', ...).ok from act() in sync.ts:706 (notifying on refusal, and checking it on lines 708, 713, 718) so app.js:235 resets #hunter-sel.  
     _Notes:_ Missed by audit-views (b5d24630) because the lint checks src/views/ only, and app.js:236 (which was fixed) is dead unreachable code behind app.api.sync?.switchTo.
44. **NEW-gates-1** [med] [NEW] `src/views/gates.js:314-316`. runAlone checks SOLO_REFUSAL_WORDS[w.why] instead of calling ui.wrote('! Gate', w, SOLO_REFUSAL_WORDS), silently swallowing 'read-only' (and 'no-room'/'missing'/'unchanged') write refusals with no toast.
   - **Tap:** Player opens Gates in a read-only tab (e.g. newer save or another tab took over), taps Enter alone on a personal gate, and confirms Enter alone.
   - **Shows:** The solo fight plays to completion, Enter alone re-enables, nothing is written, and no 'Not saved' toast or error appears.
   - **Should show:** A 'Not saved: this tab cannot save right now. The banner at the top says why.' toast appears via ui.wrote, matching every other view.
   - **How it knows:** **RAN.** tests/e2e/proof-gates-ui.e2e.ts / bunx playwright test tests/e2e/proof-gates-ui.e2e.ts --workers=1 --output=/tmp/pw-gates / pass: read-only tab (schema 99) solo run completed with 0 .toast elements shown
   - **Fix:** Replace line 316 of src/views/gates.js with `if (!ui.wrote('! Gate', w, SOLO_REFUSAL_WORDS) // !ran) return;`.  
     _Notes:_ Missed by b5d24630's refused-writes lint because runAlone reads w.ok directly without routing through ui.wrote.
45. **NEW-orch-1** [med] [NEW] `src/core/rules.ts:38 (dailyTemplate recover: true), src/core/hunter/grant.ts:247-248`. Finishing all dailies still refills vitals and stands a dying hunter up. The owner decided on 19 Nov that dailies should not recover you. The rule is still recover: true on main and on the nifty-keller, festive-fermat and design-frameworks branches.
   - **Tap:** A hunter is dying (0 HP, making death saves) and the player finishes the day's daily training quest.
   - **Shows:** The hunter stands up at full HP and mana.
   - **Should show:** The daily pays its rewards, and the hunter stays dying with no refill.
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts, BUG-rules-21 part 3: finishQuest on a daily with a dying hunter gives life.at === "up". The orchestrator re-ran it, and it passes.
   - **Fix:** Set dailyTemplate.recover to false (or remove recover), update rules-text and the guide, and flip the daily-recovery tests.  
     _Notes:_ Added by the orchestrator, not Neon. It is a decision that was never carried out, not a code accident.
46. **BUG-rules-11** [med] [old #97] `src/core/hunter/feats.ts:80, docs/state-machines.md:1687-1723`. featStep unlocks show:{at:'never'} ('Hidden until earned') feats to shown, contradicting docs/state-machines.md
   - **User steps:** no user-visible symptom. **Developer trigger:** Call featStep(startOf(featWithShowNever), { type: 'unlocked' }, featWithShowNever, now)
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / featStep returned state.at='shown', fx='shown' for show:{at:'never'}
   - **Fix:** Guard TABLE.hidden.unlocked in feats.ts:80 on c.def.show.at === 'feat' and re-run bun run charts  
     _Notes:_ Currently masked only by caller check at noticed.ts:95; docs/state-machines.md:1698-1706 still shows the illegal arrows
47. **BUG-sync-16** [med] [old #104] `src/app.js:105, 113, 122-130, 143-159`. app.js mounts views and panels whose when() predicate already threw, invoking mount() and calling when() a second time before marking the part failed.
   - **User steps:** no user-visible symptom. **Developer trigger:** Calling hunterApp.registerPanel({ id: 'broken-panel', view: 'status', when() { throw new Error(); }, mount() { ... } }) and routing to 'status'.
   - **How it knows:** **RAN.** tests/e2e/proof-sync-browser.e2e.ts / bunx playwright test tests/e2e/proof-sync-browser.e2e.ts --workers=1 / pass: mountCalls===1 and whenCalls>=2 despite when() throwing
   - **Fix:** Carry the result of asked() from avail()/viewPanels() into renderView() and call failed() directly without mountPart() when it is 'failed'.  
     _Notes:_ Reproduced in real running app via Playwright.
48. **NEW-views-1** [med] [NEW] `src/views/combat.js:1185-1202`. combat.js only calls mapView.destroy() when main.dataset.mode changes away from 'fight', never when onMap turns false (GM switching to List or switching seat to Player while a local fight exists), leaving the hidden GM map subscribed to window resize and ui.newsLine.
   - **Tap:** GM starts a fight in Map view, then switches to Player mode (or List view) while the local fight stays in the save.
   - **Shows:** combat.js sets box.hidden = true without calling mapView.destroy(); the hidden GM map stays mounted, listens to window resize/newsLine, and collides with table.js's player map on detail.js's 'map' key.
   - **Should show:** Destroy mapView whenever onMap becomes false (or mirror table.js's unmountMap() when switching from map to list/player).
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** In combat.js:1199-1202 add else if (mapView) { mapView.destroy(); mapView = null; } when !onMap.  
     _Notes:_ Observed while verifying BUG-views-8 and BUG-views-22 at HEAD (table.js:490 destroys mapView on mode change, combat.js:1188 only on fight->empty/idle).
49. **AW-rules-2** [med (was high)] [old #9] `src/core/combat/resolve.ts:241-292, src/core/combat/land.ts:162-199,283-315`. act vs release was unified (landed) and move was unified (landMove), but resolve.ts:landOps and land.ts:landOps/landOne still duplicate cureStatus, dispel, channel:break, and applyStatus tracking
   - **User steps:** no user-visible symptom. **Developer trigger:** Compare resolve.ts:256-280 vs land.ts:187-192,307,309 (or run BUG-rules-13 proof showing land.ts misses put check, cureLands on dispel, and channelBreaks on channel:break)
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / BUG-rules-13 proof confirms land.ts diverges from resolve.ts on safeguard/dispel/channel:protect/cureStatus
   - **Fix:** Extract shared cureStatus, dispel, channel:break, and applyStatus result helpers in land.ts and call them from both resolve.ts and land.ts  
     _Notes:_ Partially fixed by f14cf068 (act/release -> landed) and a2c01d36 (landMove); remaining duplication lowered from high to med
50. **AW-gates-9** [med (was high)] [old #24] `tests/solo.test.ts:340-375; tests/pack.test.ts:240-316; tests/worth.test.ts:169-175; tests/statuses.test.ts:123-125`. 3 of the 7 identified test gaps remain open (room solo edge cases, case-insensitive pack merge collisions, wornWorth stack/end; plus built-in Stealth pending feature 7).
   - **User steps:** no user-visible symptom. **Developer trigger:** Run bun run test: suite passes even while BUG-gates-3, -6, -7, -8, -9, -10, -12 remain broken because no tests cover those cases.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Add regression tests in tests/solo.test.ts, tests/pack.test.ts, tests/worth.test.ts, and tests/statuses.test.ts alongside fixing BUG-gates-2, -3, -6, -7, -8, -9, -10, -12.  
     _Notes:_ 4 of 7 original gaps are now closed (pay.test.ts double-clear, abilities.test.ts wave-2 items, pack.test.ts 24 status cases, deps.test.ts layer checks); severity lowered to med.
51. **AW-views-1** [med (was high)] [old #27] `src/views/forge.js:121, src/views/loot.js:193, src/views/skills.js:211, src/views/feat-maker.js:74, src/views/story-maker.js:163, src/views/shadows.js:97, src/views/quests.js:159`. Unchecked store.apply calls were fixed in b5d24630 with a lint, but 5 makers, shadows.js, and quests.js still conflate 'read-only' refusals with domain errors (library full, not enough mana, already has a Job Change quest).
   - **Tap:** In a read-only tab, GM opens Status Maker (or Item/Skill/Feat/Story Maker) and taps Save, or hunter taps Summon on a shadow with plenty of mana.
   - **Shows:** Status Maker displays 'The library holds ... statuses at most' and Shadows toasts 'Not enough mana to summon Igris' instead of saying the tab cannot save.
   - **Should show:** Show NOT_SAVED ('Not saved: this tab cannot save right now...') whenever store.apply returns why === 'read-only'.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-a.e2e.ts:199 / bunx playwright test tests/e2e/proof-views-open-a.e2e.ts --workers=1 -g "AW-views-1" / passed (2.1s): forge showed 'statuses at most' and shadows toasted 'Not enough mana to summon Igris' on schema-99 read-only tab
   - **Fix:** Check r.why === READ_ONLY -> NOT_SAVED in forge.js, loot.js, skills.js, feat-maker.js, story-maker.js, and propagate Applied (or READ_ONLY) from hunter.spendMana and quests.issueJobChain.  
     _Notes:_ Severity lowered from high to med because b5d24630 fixed all unchecked writes/crashes/loops and added tests/lint.test.ts:829; only domain-error misattribution remains.
52. **AW-gates-3** [med (was high)] [old #29] `src/core/qr.js:1-112; tsconfig.json:15-16,20; tsconfig.views.json:4-8; types/views/dom.d.ts:7-53`. src/core/qr.js is the only unchecked .js file in src/core/ (masked BUG-gates-13), and tsconfig.views.json + dom.d.ts disable strict checks and add permissive form index signatures.
   - **User steps:** no user-visible symptom. **Developer trigger:** Introduce a type error in src/core/qr.js or access a misspelled control on a ViewForm in src/views/*.js; bun run typecheck exits 0.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Convert src/core/qr.js to strict src/core/qr.ts and incrementally narrow types/views/dom.d.ts and high-risk views.  
     _Notes:_ Lowered to med because loose view checking is documented in AGENTS.md, though unchecked qr.js directly masked BUG-gates-13.
53. **SM-sync-5** [med (was high)] [old #33] `docs/state-machines.md:1422, src/edge/store.ts:265-267, 285, src/edge/sync.ts:485`. StoreLife docs and store.ts comments claim sync.ts bookkeeping writes memory in readOnly via store.update, but sync.ts has zero store.update calls and calls store.apply everywhere (which refuses readOnly).
   - **User steps:** no user-visible symptom. **Developer trigger:** Checking callers of store.update (only store.ts:295) vs docs/state-machines.md:1422 and running a readOnly tab in a room.
   - **How it knows:** **RAN.** tests/e2e/proof-sync-browser.e2e.ts / bunx playwright test tests/e2e/proof-sync-browser.e2e.ts --workers=1 / pass: readOnly tab has link.cursor>=1 while save.settings.sync.cursor===0
   - **Fix:** Make StoreLife readOnly either pause Link or give sync.ts an explicit in-memory bookkeeping path, and update docs/state-machines.md:1422 and store.ts:265-267.  
     _Notes:_ Direct cause of BUG-sync-7; lowered to med because reload recovers from savedCursor.
54. **AW-sync-4** [med (was high)] [old #36] `src/edge/sync.ts:1-976 (unused helpers at :109, :909)`. src/edge/sync.ts is a 976-line god module mixing HTTP transport, timeout/abort tracking, Link/Push/Publish/Outbox runners, UI modals/toasts, URL state, and dead helpers (httpError, nInt).
   - **User steps:** no user-visible symptom. **Developer trigger:** Reading src/edge/sync.ts (976 lines; grew from 944 despite extracting publish.ts) and grepping httpError/nInt (zero callers).
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Delete unused httpError and nInt, and extract room-http.ts, room-publish.ts, and injected UI prompt callbacks from src/edge/sync.ts.  
     _Notes:_ esc was removed since a11b6a5d and publish.ts reducer was extracted, but sync.ts grew to 976 lines.
55. **SM-sync-2** [med (was high)] [old #38] `src/edge/sync.ts:129-132, 235, 440-443, 576-601`. Create/Join tap lifecycle (attempt) is an implicit multi-phase state machine encoded via nullable mutable fields (made, hunterId, notice) mutated across notice() and settleAttempt().
   - **User steps:** no user-visible symptom. **Developer trigger:** Tracing begin(), notice(), and settleAttempt() in src/edge/sync.ts:576-601 (directly enables BUG-sync-12).
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Replace Attempt with a discriminated union keyed on gen and drive its transitions through one pure step function inside drain().  
     _Notes:_ Directly causes BUG-sync-12.
56. **AW-rules-1** [med] [old #40] `src/core/overrides.ts:123-125,162`. Only solo.* rules have numeric domain bounds in READERS; every other numeric RULES leaf accepts any finite number
   - **User steps:** no user-visible symptom. **Developer trigger:** Call parseOverrides({ xpPerLevel: 0, fight: { round: 0, half: 0, statBase: 0 }, dice: { maxSides: 1e9 } }) -> refused is []
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / parseOverrides returned refused=[] for zero divisors and maxSides=1e9
   - **Fix:** Define a typed BOUNDS table in overrides.ts covering every numeric leaf in RULES and enforce it in tests/overrides.test.ts  
     _Notes:_ Root architectural cause of BUG-rules-1
57. **AW-sync-3** [med] [old #45] `src/edge/rules.ts:32-38`. rules() calls JSON.stringify([s.rulesOverrides, s.library.statuses, room]) on every invocation to check its memoization key.
   - **User steps:** no user-visible symptom. **Developer trigger:** Instrumenting JSON.stringify and calling rules() repeatedly with unchanged store/room state.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-core.test.ts / bun test ./.reaudit/proofs/sync/open-core.test.ts / pass: stringifyCalls === 10 for 10 unchanged rules() calls
   - **Fix:** Cache rules() by monotonic store/room revision counter incremented on store.update/replace and room rules doc change.  
     _Notes:_ Hot-path perf overhead on mobile frames rather than a correctness bug.
58. **SM-rules-2** [med] [old #51] `src/core/combat/fight.ts:629-660`. Running fight TABLE permits turn commands (act, move, endTurn, etc.) while owed(f) has unpaid pending dice/spreads or broken releases
   - **User steps:** no user-visible symptom. **Developer trigger:** Start a fight with a body holding a dice per-round Burn status, advance until owed(f).length > 0, then dispatch endTurn without paying settle
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / owed(f0).length>0, yet reduce(endTurn) returned refused=false and pending.length>0
   - **Fix:** Reject turn commands in actor() (or a Running sub-phase) whenever owed(f).length > 0  
     _Notes:_ Note: consequences() at fight-turn.ts:149-150 already drops channel on 0 HP transition, so only the owed/turn interleaving remains
59. **AW-rules-4** [med] [old #57] `src/core/combat/resolve.ts:102,112-115,467, src/core/combat/fight-view.ts:221,268, src/core/combat/map-view.ts:540-562`. Range legality is duplicated across resolve.ts, fight-view.ts, and map-view.ts without carrying status range bonus or blinkMax
   - **User steps:** no user-visible symptom. **Developer trigger:** Compare resolve.ts:467 against resolve.ts:102, fight-view.ts:268, and map-view.ts:543,550 (proven by BUG-rules-12 test)
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / BUG-rules-12 proof demonstrates map/aims/taunted disagreeing with ready()
   - **Fix:** Carry rangeAdd on Spot/MapBody (and FightDocRow) and delegate range checks to one effectiveRange() helper in resolve.ts  
     _Notes:_ Root architectural cause of BUG-rules-12
60. **SM-gates-2** [med] [old #66] `src/views/gates.js:183-205,216-229; src/core/gates/world.ts:195-205`. Gate news queue is split across raw unparsed personal-told array (50-cap without dedupe/pruning), asking Set, and a 3-item cap in gateNews that stalls gates 4+ until another sync:docs event arrives.
   - **Tap:** GM spawns 5 new world gates while a player is away/offline, then the player opens the room and dismisses the 3 'A GATE HAS APPEARED' popups.
   - **Shows:** Gates 4 and 5 never show their appearance popups after the 3rd popup is dismissed unless another sync:docs poll happens to trigger onWorld() again.
   - **Should show:** Dismissing a gate news popup drains remaining untold gates cleanly, and personal-told uses a typed parser that deduplicates/prunes closed gate IDs.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: gateNews on 5 new gates returns only ['g-0','g-1','g-2'] leaving ['g-3','g-4'] pending; gates.js:202 does not re-run onWorld() in .then()
   - **Fix:** Call onWorld() after marking a gate told in gates.js:202 (when more news remain) and extract a typed parser/pruner for personal-told.  
     _Notes:_ gates.js:221,226 still writes raw un-deduped array sliced to -50.
61. **AW-sync-9** [med] [old #73] `server.ts:407-413, 470, src/core/protocol.ts:415-419, 995-998`. GET polls TOFU-bind deviceId to the first x-device-token seen (letting another room member hijack a released/kicked deviceId via GET ?d=), and targeted GM 'system' whispers are not sealed server-side.
   - **Tap:** Another player polls GET /api/rooms/:code?d=<victimDev> after GM releases or kicks victim, locking victim out with 403; or GM sends a targeted system whisper to Player A and Player B inspects their poll JSON.
   - **Shows:** Attacker's GET poll binds victimDev to attacker's token (victim's PUT gets 403); Player B's poll JSON receives the private whisper text sent only to Player A.
   - **Should show:** GET polls verify existing device bindings without creating new ones (only PUT binds), and 'system' events with a non-empty 'to' list are sealed server-side in servedTo.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-core.test.ts / bun test ./.reaudit/proofs/sync/open-core.test.ts / pass: victim PUT gets 403 after attacker GET poll; bystander poll receives whisper body 'Only for victim'
   - **Fix:** Split proven() into verify-only for GET vs bind-on-write for PUT, and add sealed: p => !!p.to?.length on DEFS.system in src/core/protocol.ts:415.  
     _Notes:_ Note server.ts:402-405 documents GET-poll binding as intentional for fresh joins receiving sealed messages before first push; unsealed whispers have no such tradeoff.
62. **AW-gates-6** [med] [old #74] `src/core/registry/monsters.ts:234-252; src/core/story/story.ts:130-140; src/core/size.ts:9,19`. UTF-8 sizing is duplicated (hand-rolled utf8Bytes in story.ts vs bytesOf in size.ts) and parseMonster has no THING_MAX.monster cap or whole-monster refusal on oversized abilities.
   - **User steps:** no user-visible symptom. **Developer trigger:** Pass a monster with 11 near-cap abilities and 20 near-cap loot items to parseMonster; it accepts a >64 KiB monster (violating DOC_MAX in soloDoc), and silently drops any single oversized ability instead of refusing the monster.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: parseMonster returned non-null monster with bytesOf(huge) > DOC_MAX (61440)
   - **Fix:** Replace utf8Bytes in story.ts:130 with bytesOf from size.ts and add THING_MAX.monster + abilityTooLarge whole-monster refusal in monsters.ts.  
     _Notes:_ size.ts still defines THING_MAX only for item, status, and ability.
63. **AW-rules-5** [med] [old #76] `src/views/rulesref.js:136,199-200, src/core/rules.ts:19`. rulesref.js hand-computes rule formulas (baseValue * mult) and reads dead RULES.dailyRewardPoints instead of calling core helpers
   - **User steps:** no user-visible symptom. **Developer trigger:** Inspect rulesref.js:136,199-200 and run BUG-rules-16 proof
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / R.baseValue*mult=10 vs sellPrice=50; dailyRewardPoints=5 vs dailyTemplate.rewards.points=1
   - **Fix:** Move loot/sell-price formatting into src/core/rules-text.ts using priceOf()/sellPrice() and delete RULES.dailyRewardPoints  
     _Notes:_ Root architectural cause of BUG-rules-16
64. **AW-gates-4** [med] [old #78] `src/core/registry/maps.ts:17; src/core/gates/gate.ts:44,132-134,163; src/core/gates/personal.ts:50; src/core/pack.ts:280,289`. Unvalidated mapId cast is exported publicly, and gate/monster/pack ID parsing and fabrication are inconsistent across gate.ts, personal.ts, and pack.ts.
   - **User steps:** no user-visible symptom. **Developer trigger:** Call mapId('') or mapId(' '.repeat(100)) or parseGateId('not a valid id! @#$'); all succeed and return branded IDs without format validation.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: mapId(''), 100-space mapId, and parseGateId('not a valid id! @#$') all accepted
   - **Fix:** Export validated parseMapId, keep raw mapId internal to maps.ts, reuse monsterId in personal.ts:50, and use saveId in pack.ts:280.  
     _Notes:_ Unchanged since a11b6a5d (note repair() later normalizes malformed gate IDs on save, which can cause ID drift).
65. **AW-rules-6** [med] [old #83] `src/core/protocol.ts:631,894, src/core/bestiary.ts:103,106, src/core/hunter/feats.ts:209,211, src/core/combat/fight-doc.ts:403, server.ts:426,528`. Unit mismatch between UTF-16 DOC_MAX checks in client doc builders/protocol.ts/server.ts:528 and UTF-8 MAX_BODY check in server.ts:426
   - **User steps:** no user-visible symptom. **Developer trigger:** Pass multi-byte UTF-8 entries to featsDoc() or codexDoc() with max=DOC_MAX and check bytesOf(JSON.stringify(doc)) > 65536
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / BUG-rules-17 proof confirms UTF-16 <= 62000 but UTF-8 > 65536
   - **Fix:** Use bytesOf() in bestiary.ts, feats.ts, fight-doc.ts, protocol.ts:894, and server.ts:528  
     _Notes:_ Root architectural cause of BUG-rules-17
66. **AW-gates-5** [med] [old #85] `src/core/library.ts:45; src/views/map-maker.js:178`. map-maker.js saves maps via saveById instead of saveEntry, bypassing case-insensitive namedLike uniqueness and causing silent name-match drift in pack Replace.
   - **Tap:** GM creates two battle maps both named 'Arena' in the Map Maker (via New or Save as new map), then shares/imports a pack in Replace mode.
   - **Shows:** Both 'Arena' maps save without warning; pack Replace matches by name and only updates the first 'Arena' while leaving the second unchanged.
   - **Should show:** Map Maker refuses a duplicate map name (case-insensitively) via saveEntry, matching items, skills, and stories.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: saveById stored [['mp1','Arena'],['mp2','Arena']] whereas saveEntry refused mp2 with { ok: false, why: 'taken' }
   - **Fix:** Route map-maker.js:178 through saveEntry (handling 'taken' with shell.error) and keep saveById private to library.ts.  
     _Notes:_ map-maker.js was touched in audit-views-2 (d7f67cf1) for refused saves, but still calls saveById at line 178.
67. **AW-sync-7** [med] [old #92] `src/edge/store.ts:269-296, src/core/repair.ts:59-62, src/core/save.ts:359-424`. Every store.apply runs full-tree writeInto plus full repairSave (only fight parsing is skipped via 'kept'), and fill() retains arbitrary unknown keys on loaded saves.
   - **User steps:** no user-visible symptom. **Developer trigger:** Inspecting store.ts:271,295 (repairSave(state, env(), 'kept')) and repair.ts:59-62 (fill mutates existing object keeping unknown keys).
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Keep full repairSave at load/import/storage boundaries and run lightweight targeted invariants on hot-path store.apply; strip unknown keys on strict sub-records.  
     _Notes:_ Also tracked in docs/agent-handoff/audit/brief-lag-store.md as a fight-turn frame-budget candidate.
68. **SM-sync-1** [med] [old #95] `server.ts:350-379, src/core/room-server.ts:69-98`. Server database lifecycle keeps mutable closed and retry flags outside Db<S>; calling close() closes the pool while leaving db at 'ready'.
   - **User steps:** no user-visible symptom. **Developer trigger:** Calling await db.close() followed by await db.now() on database('postgres://...', open).
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-core.test.ts / bun test ./.reaudit/proofs/sync/open-core.test.ts / pass: after db.close() (closedCount===1), db.now() still returned { at: 'ready' }
   - **Fix:** Add { at: 'closed' } and { type: 'close' } to Db<S> and dbStep in src/core/room-server.ts and remove the parallel closed flag in server.ts:354.  
     _Notes:_ Reproduced directly against server.ts database().
69. **SM-sync-6** [med] [old #98] `src/edge/sync.ts:622-636`. showRemoved recursively reopens its blocking retry modal with the wrong toast ('Could not reach the server') even on terminal errors like notfound or replaced, with no room/campaign guard.
   - **Tap:** GM removes a player; while the 'REMOVED FROM ROOM' dialog is open, the room expires/is deleted; player taps 'Rejoin when the GM allows'.
   - **Shows:** Toast says 'Could not reach the server. Try again in a moment.' and 'REMOVED FROM ROOM' reopens indefinitely until the user taps OK.
   - **Should show:** notfound and replaced exit the retry loop with an accurate message instead of recursing.
   - **How it knows:** **RAN.** tests/e2e/proof-sync-browser.e2e.ts / bunx playwright test tests/e2e/proof-sync-browser.e2e.ts --workers=1 / pass: peek=exists:false showed 'Could not reach the server' toast and reopened 'REMOVED FROM ROOM'
   - **Fix:** Handle TapError kinds 'notfound' and 'replaced' as terminal exits (no recursion) in showRemoved (sync.ts:630-634) and bail if link.at === 'live'.  
     _Notes:_ Reproduced end-to-end in Playwright.
70. **SM-rules-1** [med] [old #100] `src/core/hunter/feats.ts:76-88, docs/state-machines.md:1687-1723`. Feat statechart TABLE.hidden.unlocked allows unlocking 'Hidden until earned' feats, contradicting the chart's own prose at docs/state-machines.md:1723
   - **User steps:** no user-visible symptom. **Developer trigger:** Inspect docs/state-machines.md:1687-1723 or dispatch {type:'unlocked'} to featStep with show:{at:'never'}
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / BUG-rules-11 proof confirms hidden->shown transition on show:{at:'never'}
   - **Fix:** Guard TABLE.hidden.unlocked on c.def.show.at === 'feat' in feats.ts:80 and run bun run charts  
     _Notes:_ Statechart counterpart of BUG-rules-11
71. **SM-views-4** [med] [old #105] `src/views/table.js:218-231,315,318`. Player turn hold state still has inconsistent entry points (consumables bypass sent()) and misses the 'dropped' outbox release transition.
   - **Tap:** On a player's turn in List HUD, tap Use on a consumable (buttons stay enabled), or tap End turn and have the outbox event dropped (buttons stay stuck disabled).
   - **Shows:** hold stays 'free' during consumable cast and stays 'sent' permanently on outbox 'dropped'.
   - **Should show:** Funnel every turn-consuming action (including consumables) through one free / posting / waiting state machine that releases on refused, dropped, doc change, or room change.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-b.e2e.ts:20 / bunx playwright test tests/e2e/proof-views-open-b.e2e.ts --workers=1 -g "BUG-views-11" / passed (14.1s)
   - **Fix:** Model player turn hold as one state machine in core or table.js, route consumable casts through it, and handle 'dropped' and 'sync:room' releases.  
     _Notes:_ Root state machine behind BUG-views-16.
72. **SM-rules-6** [med] [old #106] `src/core/combat/effect-ops.ts:538-545, src/core/combat/standing.ts:18-22,63-70,87,174-194`. settle() conflates spent vs expired lifecycles (suppressing delayed end) and standing.ts reads b.statuses without checking s.until > now
   - **User steps:** no user-visible symptom. **Developer trigger:** Call settle() on a leave:'round'+end status at until===now, or call standing.ts helpers with a status where s.until <= now
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / BUG-rules-19 proof confirms settle() spent=1, expired=0; standing.ts:18-194 verified by read
   - **Fix:** Prioritize time expiry in settle() and pass now / filter live(b, now) in standing.ts  
     _Notes:_ State-machine counterpart of BUG-rules-19
73. **SM-sync-4** [med] [old #107] `src/app.js:105-159, 178-287`. View/panel lifecycle in src/app.js mutates untyped part.state strings ('new' / 'live' / 'failed') in place (setting 'live' before mount runs) and re-evaluates when() multiple times per render pass.
   - **User steps:** no user-visible symptom. **Developer trigger:** Registering a panel whose when() throws observes whenCalls >= 2 and mountCalls === 1 in a single render pass.
   - **How it knows:** **RAN.** tests/e2e/proof-sync-browser.e2e.ts / bunx playwright test tests/e2e/proof-sync-browser.e2e.ts --workers=1 / pass: whenCalls>=2 and mountCalls===1 on single route('status')
   - **Fix:** Type PartState explicitly, evaluate when() once per render pass, and set 'live' only after mount() succeeds.  
     _Notes:_ Root cause of BUG-sync-16.
74. **SM-views-6** [med] [old #108] `src/views/quests.js:333,382-439,570-594`. Inline quest form mode remains spread across editId, f.hidden, who.hidden, and autoTitle without tracking which hunter opened the form.
   - **Tap:** Open inline Edit on Hunter A's quest, switch active hunter to Hunter B, and submit the form.
   - **Shows:** editId fails to match Hunter B's quests and falls into the new-quest branch while [data-who] stays hidden.
   - **Should show:** Represent form mode as explicit closed / new(hid) / edit(hid, qid) and transition to closed when store.active().id changes.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-a.e2e.ts:106 / bunx playwright test tests/e2e/proof-views-open-a.e2e.ts --workers=1 -g "BUG-views-15" / passed (1.5s)
   - **Fix:** Replace editId/f.hidden/who.hidden flags with a single union state closed / new(hid) / edit(hid, qid) reset on active hunter change.  
     _Notes:_ Root state machine behind BUG-views-15.
75. **SM-views-9** [med] [old #111] `src/views/maker.js:748-753,811,883`. map-maker.js asNew was fixed in dacd81ab, but maker.js:883 shell.done(v) still calls finish(v) without guarding v !== undefined, and lazy zendFx/zendErr still falls out of sync on edits.
   - **Tap:** In Skill Maker, tick 'Leaves a field' and 'Something lands when it ends', then add an effect in [data-zend-fx].
   - **Shows:** zendErr banner stays 'Add what lands when it ends.' while Save becomes enabled; any future caller passing undefined to shell.done() closes the maker silently.
   - **Should show:** Guard shell.done(v) with if (v !== undefined) finish(v) and refresh zendErr on every [data-zend-fx] input.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-a.e2e.ts:86 / bunx playwright test tests/e2e/proof-views-open-a.e2e.ts --workers=1 -g "BUG-views-14" / passed (1.9s)
   - **Fix:** Guard shell.done(v) with if (v !== undefined) in maker.js:883 and include [data-zend-fx],[data-zone-fx] in maker.js:811.  
     _Notes:_ Partially fixed: map-maker.js asNew was removed in dacd81ab.
76. **AW-sync-6** [med] [old #113] `src/core/ids.ts:110, src/edge/sync.ts:830, 839, 860, src/core/protocol.ts:825, 879`. Boundary validation is duplicated with diverging regexes in sync.ts (kickSheet, allowBack, releaseSheet) and unchecked casts/prefix-blind parseSaveId in ids.ts and protocol.ts.
   - **User steps:** no user-visible symptom. **Developer trigger:** Reading src/edge/sync.ts:830,839,860, src/core/ids.ts:110, and src/core/protocol.ts:825,879 (see BUG-sync-17 and BUG-sync-18 proofs).
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Pass explicit prefix to parseSaveId, replace ad-hoc regexes in sync.ts:830,839,860 with parseSheetKey/deviceOf, and use abilityId/parseGateId in protocol.ts.  
     _Notes:_ Underlying architectural cause of BUG-sync-17 and BUG-sync-18.
77. **AW-rules-7** [med] [old #115] `src/core/hunter/build.ts:36-40, src/core/hunter/quests.ts:157-165, src/core/hunter/shadows.ts:85-90, src/core/hunter/grant.ts:183,248,342-343`. Inconsistent boundary authority and write-back across hunter core modules (choosePath skips role/buildsOn/inFight, editQuest skips mayChangeQuest, stepShadow skips mana cost, grant/finishQuest bypass sheetEdit)
   - **User steps:** no user-visible symptom. **Developer trigger:** Call choosePath() with builds disabled, editQuest() on a GM quest as a player, stepShadow('summon') without mana check, or grant()/sheetEdit('drop')
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Enforce buildsOn/role in choosePath, mayChangeQuest in editQuest, mana spend in stepShadow, and route grant/finishQuest refills through sheetEdit  
     _Notes:_ Note: editQuest already guards rewards/onFail/penaltyText by role, but still lets a player edit title/desc/objectives of a GM quest if called directly
78. **SM-views-7** [med] [old #117] `src/views/room.js:62,219,284-285,301-304`. Room lobby mutable view bag leaves debounced check timers active across room transitions and gmrelease/gmallow handlers have no in-flight guard against double taps.
   - **Tap:** GM rapidly double-taps Release or Allow back on a player row in Room view, or types a code and immediately joins via another path before the 300ms debounce timer fires.
   - **Shows:** Two concurrent release/allowBack network requests fire with duplicate toasts; stale view.t timer still calls runCheck() after joining.
   - **Should show:** Disable GM seat action buttons while in flight and clear debounced check timers on room transition.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Model lobby check/join state explicitly, clear view.t on sync:room, and disable gmrelease/gmallow buttons while their promise is pending.  
     _Notes:_ Code at room.js:62,219,284-285 unchanged since a11b6a5d.
79. **SM-rules-3** [med] [old #118] `src/core/combat/effect-ops.ts:335-392, src/core/combat/fight-parse.ts:688-750`. Flat Body record with 15+ optional/nullable fields allows cross-kind illegal states (ownerless summon, hunter with extraction/stagger/intent, monster with local holder)
   - **User steps:** no user-visible symptom. **Developer trigger:** Pass a JSON row with kind:'summon', owner:undefined or kind:'hunter', extraction:{at:'open',tried:1} to parseFight()
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Refactor Body into a discriminated union by kind and validate each kind's allowed fields in fight-parse.ts:rowOf  
     _Notes:_ High blast-radius mechanical type refactor
80. **SM-views-5** [med] [old #119] `src/app.js:122-159`. renderView() calls mountPart(p) for every panel in viewPanels(id) even when asked(p) returned 'failed', running mount() before updatePart() marks the panel failed.
   - **User steps:** no user-visible symptom. **Developer trigger:** Register a panel whose when() throws and navigate to its view: panel.mount() runs once before state becomes 'failed'.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-b.e2e.ts:243 / bunx playwright test tests/e2e/proof-views-open-b.e2e.ts --workers=1 -g "BUG-views-22" / passed (2.5s): mountedOnThrow === true after go('rules')
   - **Fix:** In src/app.js mountPart(), check asked(def, 'when:' + def.id) === 'failed' and call failed(part, what) before invoking def.mount().  
     _Notes:_ Paired with BUG-views-24 part 1.
81. **SM-rules-4** [med] [old #120] `src/core/hunter/noticed.ts:6-14,70-72,163-169, src/core/hunter/chronicle.ts:65-76,104-105`. Chronicle inbox holds unstamped Fact[] during fights and stamps them with drain-time day/session/longRests instead of event-time
   - **Tap:** Hunter earns a fact while held in a fight on Day 1 / Session 1; fight ends on Day 2 / Session 2
   - **Shows:** Fact is stamped with Day 2 / Session 2 at inbox drain time, misclassifying within:'day'/'session'/'rest' feats
   - **Should show:** Stamp facts when enqueued in record() and model the held-vs-drained inbox explicitly in docs/state-machines.md
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / fact recorded while held on Day 1/Session 1 was stamped {day:'2026-11-16', session:2} on drain
   - **Fix:** Attach FactStamp (day/session/at) when enqueuing facts in record() and document the inbox machine  
     _Notes:_ Verified via noticed() in hunter-core-proofs.test.ts
82. **AW-views-6** [med] [old #121] `src/views/maker.js:990-1010`. watchPicks() runs a permanent document.body MutationObserver (subtree: true) scanning every app DOM addition; searchable() uses option.hidden which native iOS/Android pickers ignore.
   - **Tap:** Open a maker with >14 statuses/skills on mobile Safari/Android and type in the Search input above the select.
   - **Shows:** MutationObserver runs querySelectorAll('select[data-pick]') on every added node app-wide (toasts, combat FX), and native mobile pickers still display hidden <option> elements.
   - **Should show:** Scope searchable() directly to maker dialogs and detach/re-attach matching <option> nodes instead of setting option.hidden.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Remove document.body MutationObserver, call searchable() inside openMaker/effects/kit-parts, and rebuild select options from a cached option list.  
     _Notes:_ Code at maker.js:990-1010 unchanged since a11b6a5d.
83. **AW-rules-8** [med] [old #122] `src/core/combat/fight-parse.ts:1-828, src/core/combat/map-view.ts:1-775, src/core/combat/fight.ts:1-697, src/core/combat/resolve.ts:1-615, src/core/formula.ts:1-750`. God-file coupling in core combat/formula modules (615–828 lines each mixing unrelated responsibilities)
   - **User steps:** no user-visible symptom. **Developer trigger:** wc -l src/core/combat/{fight-parse,map-view,fight,resolve}.ts src/core/formula.ts -> 828, 775, 697, 615, 750 lines
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Extract map-choice.ts and hotbar.ts from map-view.ts, and move afterReactions into fight-react.ts and summoned into summons.ts  
     _Notes:_ resolve.ts shrank slightly (652 -> 615) via charge.ts extraction in audit-cycles; formula.ts grew to 750L
84. **AW-views-4** [med] [old #123] `src/views/combat.js:1-1269`. Seven 664-to-1269-line god view files (combat.js 1269, maker.js 1081, gm.js 841, hunter.js 836, map.js 805, table.js 677, gates.js 664) mix CSS, templates, async dialogs, and sync handlers.
   - **User steps:** no user-visible symptom. **Developer trigger:** wc -l on the 7 view files totals 6,173 lines (grew from a11b6a5d).
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Extract maker-shell/maker-effects/maker-ability from maker.js, combat-sync/combat-end from combat.js, and rules/tables helpers from gm.js.  
     _Notes:_ Verified line counts via wc -l at HEAD.
85. **AW-views-5** [med] [old #124] `src/views/rulesref.js:44-59, src/views/forge.js:24, src/views/dice.js:17, src/views/combat.js:1069`. Duplicated canon() (5x), flash() (2x), guard() & esc/fmtN in rulesref.js, highest() in dice.js, and view-resident parseQuick() in combat.js remain.
   - **User steps:** no user-visible symptom. **Developer trigger:** rg for canon, flash, highest, parseQuick in src/views/ shows all duplicates intact.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Export one canon() and parseQuick() from src/core/, move flash() to ui.js, and drop rulesref.js guard()/esc/fmtN.  
     _Notes:_ Verified via rg at HEAD.
86. **AW-views-8** [med] [old #126] `src/views/odds-box.js:29, src/views/quests.js:335, src/views/combat.js:84,411, src/views/table.js:585, src/views/feats.js:15, src/views/gates.js:216`. View Maps (boxes, barsWas, picks, amounts) never prune removed entries; table-feed is unscoped by room; per-hunter store.device keys (feat-told:, personal-told:, quest-told:) are never deleted on hunter removal.
   - **Tap:** GM switches rooms and opens Combat Table feed (or deletes hunters/gates/quests over a long campaign).
   - **Shows:** Table feed still displays entries from the previous room; view Maps and localStorage device keys grow monotonically.
   - **Should show:** Prune view Maps on clear/render, scope table-feed by room code, and clean up per-hunter device keys when a hunter is deleted.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Prune boxes/barsWas/picks/amounts on clear/render, key table-feed by room code (clearing on sync:room), and remove per-hunter store.device keys in deleteHunter.  
     _Notes:_ quests.js:275 also added quest-told:<hid> per-hunter device key with the same uncollected pattern.
87. **BUG-sync-11** [low (was med)] [old #69] `src/core/sync/link.ts:425, 439, src/core/sync/bind.ts:49-52`. Leaving a room omits gmKey from stored(idle), leaving settings.sync.gmKey populated while room is null (though forgetKey/ringGone ALREADY clears gmKey, contradicting half of the old audit claim).
   - **Tap:** GM leaves a room via Leave (not Forget).
   - **Shows:** save.settings.sync.room becomes null while save.settings.sync.gmKey still holds the old room's GM key. (Tapping Forget DOES clear gmKey via ringGone.)
   - **Should show:** Leaving a room sets save.settings.sync.gmKey to null when room becomes null.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-core.test.ts / bun test ./.reaudit/proofs/sync/open-core.test.ts / pass: after leave room=null & gmKey=gmKey; after ringGone gmKey=null
   - **Fix:** Have stored(idle) in src/core/sync/link.ts:425 return gmKey: null.  
     _Notes:_ Lowered to low: the old report's credential-retention claim after Forget was false (ringGone already clears gmKey when matching); only normal leave leaves stale gmKey while room is null.
88. **BUG-views-12** [low (was med)] [old #71] [COULD NOT REPRODUCE] `src/views/skills.js:322-326`. Neon's 19 Nov claim: Skill `Lv +` toast reads pre-upgrade `s.level`, always showing old level and never `(MAX)`
   - **Tap:** Player taps Lv + on a Lv.1 skill and on a Lv.9 skill in the Skills panel.
   - **Shows:** Claimed: the toast shows the level before the upgrade and never says (MAX). In the 20 Nov drive the toasts read 'Flame Slash reached Lv.2.' and 'Frost Nova reached Lv.10 (MAX).', so the fault was not seen.
   - **Should show:** The toast shows the new level, with (MAX) at the cap.
   - **How it knows:** **RAN.** Tried, and did not see the fault: tests/e2e/proof-views-open-a.e2e.ts:57 / bunx playwright test tests/e2e/proof-views-open-a.e2e.ts --workers=1 -g "BUG-views-12" / passed (1.4s): toasts read 'SYSTEM Flame Slash reached Lv.2. ×' and 'SYSTEM Frost Nova reached Lv.10 (MAX). ×'
   - **Fix:** Re-read const now = find(s.id) after onSkills(...) so the toast does not depend on writeInto mutating s in place.  
     _Notes:_ Spot-check: could not reproduce. Neon tried a Playwright drive of Lv + on a Lv.1 and a Lv.9 skill, and the toasts read correctly (proof above). Kept open at Neon's severity, per the owner's rule: if Neon found it and the check didn't, record that and don't dismiss it. The 19 Nov claim was: Skill `Lv +` toast reads pre-upgrade `s.level`, always showing old level and never `(MAX)`. False positive in the Nov 19 read-only audit; quests.js:446 explicitly re-reads after store.apply for cleanliness.
89. **BUG-gates-11** [low] [old #130] `src/views/gates.js:332`. GM's room soloRun handler hardcodes boss loot (`lootOf(g.rank, true)`) even when the cleared world gate has bossId === null.
   - **Tap:** GM edits a world gate to 'No boss' and checks 'Open to solo runs'; a room player enters and wins that gate alone.
   - **Shows:** GM's phone rolls boss-tier loot (`{ boss: true }`) for the bossless gate, unlike a local solo clear which passes `boss: false`.
   - **Should show:** GM's phone passes `g.bossId !== null` to `lootOf`, matching local solo clears at src/views/gates.js:311.
   - **How it knows:** **RAN.** tests/e2e/proof-gates-ui.e2e.ts / bunx playwright test tests/e2e/proof-gates-ui.e2e.ts --workers=1 --output=/tmp/pw-gates / pass: sync:event soloRun win on gate g999 (bossId: null) called rollLoot('E', { boss: true })
   - **Fix:** Change `lootOf(g.rank, true)` to `lootOf(g.rank, g.bossId !== null)` at src/views/gates.js:332.  
     _Notes:_ One-line bug still present at gates.js:332 (moved from line 309).
90. **BUG-gates-12** [low] [old #131] `src/core/registry/worth.ts:331-336`. wornWorth ignores def.stack and def.end without adding them to Worth.unweighed, silently counting them as 0 SA in the maker's worth bar.
   - **Tap:** GM creates a passive skill (or worn gear item) with a worn status that has a Stacks threshold or 'When it ends' damage effect and reads the worth line in the maker.
   - **Shows:** Worth bar reads 'Worth 0.00 of a standard action (budget 0.15).' with no warning that stack or end effects were not weighed.
   - **Should show:** Worth bar either weighs stack/end or lists them in Worth.unweighed ('without ... which it cannot estimate: test it in a fight').
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: wornWorth returned { worth: 0, over: false, unweighed: [] } for worn defs with heavy end damage and stack.threshold damage
   - **Fix:** In wornWorth (src/core/registry/worth.ts:331-336), add 'end' (and stack/threshold) to at.miss when def.end or def.stack is present.  
     _Notes:_ Violates the invariant documented at worth.ts:7; both skills.js:133 and loot.js render statusBlocks (stack/end) on worn statuses.
91. **BUG-sync-17** [low] [old #133] `src/core/ids.ts:31-39, 110, 132, src/edge/sync.ts:860`. parseSaveId<K> ignores prefix K at runtime, 40-char DeviceId causes sheetKeyOf to exceed 40 chars (rejected by parseSheetKey), and releaseSheet rejects valid non-'d-' device IDs.
   - **Tap:** GM taps 'Release to a new device' for a sheet whose valid deviceId does not start with 'd-'.
   - **Shows:** releaseSheet returns NOT_GM without calling the server; parseSaveId<'h'>('q12') returns 'q12'; sheetKeyOf(dev40, 'h1') has length 43 and fails parseSheetKey.
   - **Should show:** parseSaveId checks prefix K, DeviceId max length leaves room for ':h<seq>' within 40 chars, and releaseSheet uses parseSheetKey + deviceOf.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-core.test.ts / bun test ./.reaudit/proofs/sync/open-core.test.ts / pass: parseSaveId<'h'>('q12')==='q12', sheetKeyOf(40-char).length===43 -> parseSheetKey===null, releaseSheet regex rejects 'dev_test:h1'
   - **Fix:** Validate prefix K in parseSaveId, cap parseDeviceId to <=24 chars, and replace /^(d-[a-z0-9]+):/ in sync.ts:860 with parseSheetKey + deviceOf.  
     _Notes:_ All three parts reproduced directly.
92. **BUG-rules-22** [low] [old #136] `src/core/formula.ts:164,179-181,330-331`. Keyed formula names (stacks, field, held, target.stacks) are case-sensitive despite doc claiming case-insensitivity
   - **Tap:** GM types STACKS(bleed) * 2 or Target.stacks(bleed) in a formula field
   - **Shows:** Parser refuses the formula even though stacks(bleed) * 2 succeeds and line 330-331 states names are case-insensitive
   - **Should show:** Keyed prefixes and target. prefix match case-insensitively
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / parseFormula('stacks(bleed) * 2').ok=true; 'STACKS(bleed) * 2'.ok=false; 'Target.stacks(bleed)'.ok=false
   - **Fix:** Match keyed prefixes case-insensitively in TOKEN (or via RegExp 'iy' flag) and lowercase m[1] at formula.ts:179-181  
     _Notes:_ Simple regex/lowercasing fix
93. **BUG-rules-23** [low] [old #138] `src/core/combat/standing.ts:201-207`. harmful() inspects only tier 0 (v[0]) of tiered ops and omits positive fatigue, positive delay, channel:break, and edge(worse)
   - **Tap:** GM creates a tiered debuff with [0, -2, -4, -6, -8, -10] stat penalty or a status inflicting fatigue/delay/channel:break/edge(worse); Safeguard or dispel('harmful') runs
   - **Shows:** harmful() returns false, letting the debuff bypass Safeguard and survive dispel('harmful')
   - **Should show:** harmful() checks across tiers (or active source tier) and classifies positive fatigue, positive delay, channel:break, and edge(keep:'worse') as harmful
   - **How it knows:** **RAN.** .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / harmful() returned false for all 5 cases (tieredDebuff, fatigue, delay, channel:break, edge worse)
   - **Fix:** Check all tiers (or pass source tier) and include fatigue>0, delay>0, channel:break, and edge(keep:'worse') in standing.ts:201-207  
     _Notes:_ Verified at standing.ts:201-207
94. **BUG-rules-26** [low] [old #142] `src/core/bestiary.ts:143`. mergeMonsters returns lastAt: undefined via .pop()! when both codex records have empty lastAt
   - **Tap:** GM merges two bestiary monsters whose codex entries both have empty lastAt
   - **Shows:** Merged codex entry gets lastAt: undefined (violating CodexEntry.lastAt: string)
   - **Should show:** Merged codex entry gets lastAt: '' when both inputs have empty lastAt
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / merged.codex['b/E'].lastAt === undefined
   - **Fix:** Replace `.pop()!` with `.pop() ?? ''` at bestiary.ts:143  
     _Notes:_ One-line fix
95. **BUG-rules-27** [low] [old #144] `src/core/hunter/inventory.ts:29`. stackKey omits desc, attack, and penFlat, silently merging distinct slotless items and dropping the second description
   - **Tap:** GM gives a hunter two slotless items with the same name/rarity/type ('Key') but different descriptions ('Opens red door' vs 'Opens blue door')
   - **Shows:** Bag merges them into one stack (qty 2) keeping only 'Opens red door'; 'Opens blue door' is permanently lost
   - **Should show:** Items with different desc, attack, or penFlat stay separate stacks
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / items.length=1, qty=2, desc='Opens red door' (second desc dropped)
   - **Fix:** Include i.desc, i.attack ?? '', and i.penFlat ?? 0 in stackKey() at inventory.ts:29  
     _Notes:_ Line shifted from 22 to 29
96. **BUG-views-22** [low] [old #145] `src/views/map.js:303,328,417-418,481,487,509,783-784`. Multiple mounted map.js instances still collide on the hardcoded 'map' detail key in detail.js, producing duplicate DOM IDs and cross-closing details.
   - **Tap:** Switch from GM (with a local fight in Map view) to Player in a room fight so both combat.js and table.js hold mounted map.js instances, then open a zone/ability detail.
   - **Shows:** Both mounted map instances read D().openIn('map') and render duplicate id="dt-map-..." panels; one map's forget() closes the other's open detail.
   - **Should show:** Give each map.mount() instance its own unique detail list key (e.g. map-1, map-2).
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-b.e2e.ts:220 / bunx playwright test tests/e2e/proof-views-open-b.e2e.ts --workers=1 -g "BUG-views-22" / passed (2.5s): two mounted maps rendered 2 duplicate #dt-map-zone_3a_z1 nodes
   - **Fix:** Allocate a unique const dtList = `map-${++mapSeq}` per map.mount() call and pass dtList to detail.openIn/panel/move.  
     _Notes:_ views-1 (8451001a) removed mapDt but kept the hardcoded 'map' list name.
97. **BUG-rules-28** [low] [old #146] `src/core/hunter/imported.ts:22-46`. withImportedHunters does not remap h.used skill IDs, jobChain.id (and quest.chainId), or shadow.monster
   - **Tap:** User imports a hunter from another campaign file who has rest-limited skill uses spent or an active Job Change chain
   - **Shows:** Imported skills get fresh IDs (e.g. s2) while h.used keeps old key 's1' (resetting rest-limited uses), and jobChain.id keeps old 'jc1' (colliding with existing chains)
   - **Should show:** withImportedHunters remaps h.used via the skill ID map, allocates a fresh jobChain.id (updating q.chainId), and reconciles shadow.monster
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / added.skills[0].id!='s1' yet added.used['s1']=2, added.used[newId]=undefined, added.jobChain.id='jc1'
   - **Fix:** Build a skill ID map in imported.ts to remap h.used, allocate fresh jc ID for jobChain.id/q.chainId, and clear/reconcile shadow.monster  
     _Notes:_ Verified at imported.ts:30-44
98. **BUG-views-23** [low] [old #147] `src/views/table.js:585, src/views/shadows.js:46-78,158, src/views/inventory.js:220-221,256,268, src/views/stories.js:225-232, src/views/dice.js:221-223, src/views/bestiary.js:405-408`. Secondary edge bugs remain: unscoped table-feed, shadows notes blur not redrawing & stale extract capture, inventory openForm/0g sell/shopDel index, stories double End toast, dice DC stale on hunter switch, bestiary ID alloc before okToReplace & unchecked combat.add.
   - **Tap:** Switch E-rank to S-rank hunter in Dice view; sell a 0-gold item in Bag; double-tap End story; blur shadow notes after store update; switch rooms as GM; add monster from Bestiary.
   - **Shows:** Dice DC stays at E-rank; selling a 0g item shows no 'Sold' toast; double-clicking End story spawns 2 held toasts; table-feed shows prior room's entries; bestiary toasts 'added' even if combat.add returns 0.
   - **Should show:** Update DC on hunter/rank change, toast on 0g sale when sell succeeds, deduplicate End story by runId, scope table-feed by room, redraw shadow notes on blur, delete shop items by ID, and check combat.add return.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-b.e2e.ts:207-218 / bunx playwright test tests/e2e/proof-views-open-b.e2e.ts --workers=1 -g "BUG-views-22" / passed (2.5s): dice DC unchanged on E->S switch and selling 0g Pebble emitted 0 'Sold Pebble' toasts; other 4 items verified by read
   - **Fix:** Scope table-feed by room, redraw shadows on notes blur, capture hid before await & return { ok, got } from sell & delete shop items by ID, deduplicate endStory by runId, key dice DC by { hid, rank }, move toCombatant after okToReplace & gate toast on combat.add.  
     _Notes:_ All 6 bundled sub-items remain unfixed at HEAD.
99. **BUG-rules-29** [low] [old #148] `src/core/hunter/counts.ts:26,77, src/core/hunter/feats.ts:173`. distinct feat counter evicts seen values past VALS_MAX=200 while parseFeat allows reach up to 1e6
   - **Tap:** GM creates a 'Different values of' (distinct) feat with target reach 250; hunter records 201 distinct values then repeats the 1st value
   - **Shows:** vals evicts value #0 at 201, so repeating value #0 increments n to 202 (double-counting)
   - **Should show:** parseFeat caps reach at VALS_MAX (200) for distinct measures
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / parseFeat accepted reach=250; after 201 distinct kills vals.length=200 and re-killing m-0 raised n to 202
   - **Fix:** Cap reach to Math.min(reach, VALS_MAX) when count.measure.of === 'distinct' in feats.ts:173  
     _Notes:_ Verified at counts.ts:77 and feats.ts:173
100. **BUG-views-24** [low] [old #149] `src/app.js:153-158, src/views/room.js:263-271, src/views/quest-fields.js:103, src/views/workshop.js:290-292, src/views/motion.ts:289-303`. Edge defects remain: app.js mounts panels whose when() threw, room.js sizes QR synchronously before queued/delayed window mounts, quest-fields.js throws RangeError on invalid date, workshop.js keys folds by DOM index, motion.ts countTo divides 0/0=NaN when dur<=0.
   - **Tap:** Tap QR enlarge while a System window is open; enter invalid datetime-local in urgent quest edit; toggle Workshop folds as built-in sections appear/disappear; run countTo with --t-slow: 0.
   - **Shows:** Panel mount() runs despite throwing when(); QR stays tiny if queued/delayed; invalid date throws RangeError; Workshop folds shift to wrong section; countTo computes NaN when dur===0 and now===t0.
   - **Should show:** Check when() before mountPart(), size QR on dialog mount, guard !Number.isNaN(d.getTime()), key folds by dataset key, and short-circuit dur <= 0 in countTo/tumble.
   - **How it knows:** **RAN.** .reaudit/proofs/views/open-views-unit.test.ts + tests/e2e/proof-views-open-b.e2e.ts:243 / bun test ./.reaudit/proofs/views/open-views-unit.test.ts & bunx playwright test tests/e2e/proof-views-open-b.e2e.ts --workers=1 -g "BUG-views-22" / unit: countAt(0,10,0/0)=NaN & invalid Date toISOString throws RangeError; browser: mountedOnThrow===true
   - **Fix:** Guard asked() in mountPart(), size QR via mount callback, check !Number.isNaN(d.getTime()) in quest-fields.js:103, key .ws-fold by section+kind, and return format(to) immediately when dur <= 0 in motion.ts.  
     _Notes:_ All 5 bundled sub-items remain unfixed at HEAD.
101. **NEW-rules-2** [low] [NEW] `src/core/hunter/sheet.ts:191-194`. setMaximum(h, 'hpMax', n, R) does not clamp n >= 1 before subtracting sheet.hpMax, causing repeated calls with 0 (or negative n) to drift hpAdj arbitrarily negative and swallow future level-up HP
   - **Tap:** GM edits a hunter's Max HP to 0 (or a negative value) repeatedly
   - **Shows:** Derived hpMax stays clamped at 1, but each call with 0 subtracts another 1 from hpAdj (and -500 subtracts 501), burying future level-up HP gains
   - **Should show:** setMaximum clamps requested n to >= 1 for hpMax and >= 0 for manaMax before computing the adjustment delta
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / setMaximum(h,'hpMax',0) twice gave h2.hpAdj === h1.hpAdj - 1; setMaximum(...,-500) gave h3.hpAdj === h2.hpAdj - 501
   - **Fix:** Clamp target n with `Math.max(key === 'hpMax' ? 1 : 0, Math.trunc(n) // 0)` in sheet.ts:192  
     _Notes:_ Residual edge case after 8864d53d clamped derive.ts:165
102. **BUG-views-21** [low (was med)] [old #102] `src/views/custom.js:72-101`. 4 of 5 sub-parts were fixed (gates.js enterAlone in 8f5a3b0b; openPanel restore, onboard.js:183 joinBtn restore, and custom.js:193 LO.swap in b5d24630); only custom.js:72 module-level mutable pick singleton remains open.
   - **User steps:** no user-visible symptom. **Developer trigger:** Invoke app.api.identity.edit(h1) followed by app.api.identity.edit(h2) before the first closes (e.g. under E2E_POPUP_DELAY or queued system modals).
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Make pick local to identity.edit() and bind click handling on the opened dialog's .cz-pick container instead of a shared module singleton.  
     _Notes:_ Severity lowered from med to low now that enterAlone, onboard.js:183, gates openPanel, and LO.swap are all fixed.
103. **BUG-gates-13** [low] [old #128] `src/core/qr.js:105-106`. qrSvg accepts opts (including mask) but calls qrMatrix(text) without forwarding opts.
   - **User steps:** no user-visible symptom. **Developer trigger:** Call `qrSvg('https://example.test/join/AB34CD', { mask: 2 })`; opts.mask is dropped and the SVG equals auto-masked qrSvg(url) instead of mask 2.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: qrMatrix(url, { mask: 2 }) differed from qrMatrix(url), while qrSvg(url, { mask: 2 }) === qrSvg(url)
   - **Fix:** Pass opts through at src/core/qr.js:106: `const q = qrMatrix(text, opts);`.  
     _Notes:_ No UI caller passes opts.mask today, so low severity holds.
104. **BUG-sync-5** [low] [old #129] `src/core/sync/link.ts:399, src/edge/sync.ts:579, 615-618`. Link reducer's live 'join' handler checks only event.code === link.code, ignoring event.key !== link.key, causing sync.rejoinGM on the current room to fail with 'busy'.
   - **User steps:** no user-visible symptom. **Developer trigger:** Calling link.reduce(livePlayerInRoom, { type: 'join', code, key: gmKey, from: null }) or app.api.sync.rejoinGM(code, key) while live in code.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-core.test.ts / bun test ./.reaudit/proofs/sync/open-core.test.ts / pass: reduce returns same(livePlayer) with [] effects when event.key differs
   - **Fix:** Change link.ts:399 to event.code === link.code && event.key === link.key ? same(link) : begin(link, event).  
     _Notes:_ Low severity because src/views/room.js:347 hides the lobby ('Rejoin as GM' form) while in a room, so the UI cannot directly trigger it. Orchestrator: only reachable through the API. The UI hides Rejoin as GM while you are in a room (room.js:347). Kept low.
105. **BUG-sync-18** [low] [old #134] `src/core/save.ts:329-354, src/core/trade/goods.ts:69-88, src/core/trade/offer.ts:290-294, src/core/protocol.ts:879, 914`. fixSync leaves sync.cursor unclamped (accepting negative/fractional values), setAside allows duplicate line.id causing offerPosted to misreport 'too-large', and protocol.ts accepts non-boolean feats.on and non-GateId world gate IDs.
   - **User steps:** no user-visible symptom. **Developer trigger:** Calling parseSave with cursor=-5.7, setAside/offerPosted with duplicate item IDs, and DOCS.rules/DOCS.world with malformed inputs.
   - **How it knows:** **RAN.** .reaudit/proofs/sync/open-core.test.ts / bun test ./.reaudit/proofs/sync/open-core.test.ts / pass: cursor===-5.7, offerPosted==='too-large', rulesDoc.feats.on===true, worldDoc.gates[0].id==='not-a-gate-id'
   - **Fix:** Clamp sync.cursor in fixSync, reject duplicate line.id in setAside, and use bool()/parseGateId()/abilityId() in protocol.ts.  
     _Notes:_ All three parts reproduced directly.
106. **BUG-rules-24** [low] [old #139] `src/core/hunter/progress.ts:107-109`. setPoints lacks Number.isFinite/Math.trunc guard, allowing NaN or fractional values to corrupt bonusPoints
   - **User steps:** no user-visible symptom. **Developer trigger:** Call setPoints(newHunter(RULES), Number.NaN, RULES) or setPoints(h, 2.7, RULES)
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / setPoints(NaN).bonusPoints=NaN; setPoints(2.7).bonusPoints is non-integer
   - **Fix:** Guard n with `const target = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : available(p, R)` at progress.ts:108  
     _Notes:_ One-line fix
107. **BUG-rules-25** [low] [old #140] `src/core/day.ts:13,45`. parseDayKey accepts impossible calendar dates like '9999-99-99', causing dayGap to return NaN
   - **User steps:** no user-visible symptom. **Developer trigger:** Call parseDayKey('9999-99-99') and pass result to dayGap()
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / parseDayKey('9999-99-99')='9999-99-99', dayGap=NaN
   - **Fix:** Validate Date.parse(v + 'T00:00:00Z') and UTC y/m/d round-trip inside parseDayKey() in day.ts:13  
     _Notes:_ Affects corrupted save imports / day keys
108. **BUG-rules-30** [low] [old #150] `src/core/hunter/chronicle.ts:116, src/core/hunter/feats.ts:149, src/core/hunter/chronicle-view.ts:112,152`. chronicle.ts and feats.ts use non-antisymmetric '< ? -1 : 1' string comparators (and chronicle-view.ts uses string '<'/'>') instead of compareTimes()
   - **User steps:** no user-visible symptom. **Developer trigger:** Pass earned feats with '2026-11-15T11:00:00+02:00' (09:00Z) and '2026-11-15T10:00:00Z' to featNews() or pushedChronicle()
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / featNews() returned ['a'(10:00Z), 'b'(09:00Z)] instead of oldest-first ['b','a']
   - **Fix:** Replace raw string comparators in chronicle.ts:116, feats.ts:149, and chronicle-view.ts:112,152 with compareTimes() from day.ts  
     _Notes:_ chronicle-view.ts:112,152 IS antisymmetric (returns 0 on equal) but still compares raw strings instead of instants
109. **NEW-views-2** [low] [NEW] `src/views/quests.js:445,540-542`. In a read-only tab, tapping objective +/- (quests.js:445) or Reopen on a failed quest (quests.js:540-542) silently ignores the read-only refusal without calling ui.wrote() to tell the user.
   - **Tap:** In a read-only tab, tap + or - on an active quest objective, or tap Reopen on a failed quest.
   - **Shows:** Nothing happens and no 'Not saved' toast is shown (unlike Fail, Complete, Edit, and Delete in the same view).
   - **Should show:** Pass the store.apply result through ui.wrote('! Quest', ...) so read-only refusals show NOT_SAVED consistently across all quest taps.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Use ui.wrote('! Quest', store.apply('quest-progress', ...)) at quests.js:445 and ui.wrote('! Quest', r, { pastDue: ... }) at quests.js:540-542.  
     _Notes:_ Caught during AW-views-1 re-audit; passed lint.test.ts:829 only because the return values were checked with .ok / 'why' in r.
110. **NEW-gates-2** [low] [NEW] `scripts/statecharts.ts:7-40,77; scripts/charts/solo.ts:8`. Circular runtime value imports between scripts/statecharts.ts and every scripts/charts/*.ts throw a TDZ ReferenceError if any chart module is imported directly.
   - **User steps:** no user-visible symptom. **Developer trigger:** Import any chart directly (e.g. `import { soloClock } from './scripts/charts/solo.ts'`); Bun throws `ReferenceError: Cannot access 'soloClock' before initialization` at scripts/statecharts.ts:77.
   - **How it knows:** **RAN.** Observed directly running bun test when .reaudit/proofs/gates/gates-proofs.test.ts imported soloClock from scripts/charts/solo.ts: ReferenceError: Cannot access 'soloClock' before initialization at scripts/statecharts.ts:77:322
   - **Fix:** Move `bfs`, `machine`, and chart types into a leaf module (e.g. scripts/statechart-lib.ts) imported by both scripts/charts/*.ts and scripts/statecharts.ts.  
     _Notes:_ deps.ts scans only src/ and server.ts, so scripts/ value cycles are unchecked.
111. **SM-gates-3** [low (was med)] [old #62] `src/views/gates.js:160-176,568`. The stale Clear openPanel half was fixed in df66fb41, but mergeWorld still uses strict `compareTimes(raw.at, merged.at) > 0`, dropping another GM phone's world doc written in the same millisecond.
   - **Tap:** Two GM phones share a room; another GM phone publishes two world-doc updates stamped with the same server millisecond (or a second GM device writes within the same millisecond).
   - **Shows:** The first update merges (gate 'First Name', day 2), and the second update with the same timestamp is silently dropped (gate stays 'First Name' / detected, day stays 2).
   - **Should show:** Both updates merge cleanly (and an open Clear panel on an externally cleared gate closes automatically, which now works).
   - **How it knows:** **RAN.** tests/e2e/proof-gates-ui.e2e.ts / bunx playwright test tests/e2e/proof-gates-ui.e2e.ts --workers=1 --output=/tmp/pw-gates / pass: openPanel auto-closes (fixed, test 1), while second sync:docs world update with identical raw.at is silently dropped (open, test 2)
   - **Fix:** Compare world-doc freshness by content diff (or >= with last-merged digest/revision) instead of strict `compareTimes(raw.at, merged.at) > 0` at src/views/gates.js:166.  
     _Notes:_ Primary half (stale Clear panel enabling BUG-gates-1) FIXED by df66fb41 (c0863941); remaining mergeWorld timestamp race is low severity.
112. **SM-gates-4** [low (was med)] [old #70] `scripts/charts/solo.ts:19,21; docs/state-machines.md:1514-1515`. Personal gate clock chart unconditionally labels Off, 3 gates open -> On, 3 gates open as 'a gate at once', contradicting soloTick which spawns 0 gates at cap.
   - **User steps:** no user-visible symptom. **Developer trigger:** Read docs/state-machines.md:1514-1515 or inspect soloClock.walk(): arrow s7 -> s4 says 'personal gates turned on, a gate at once' while soloTick returns opened: [] when 3 gates are open.
   - **How it knows:** **RAN.** .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: soloClock steps Off, 3 gates open -> On, 3 gates open carry 'a gate at once' label while soloTick with 3 open gates returns opened: []
   - **Fix:** Condition the label in scripts/charts/solo.ts:19,21 on `clockOf(to).gates.length > clockOf(from).gates.length` and run `bun run charts`.  
     _Notes:_ Doc/chart disagreement only; runtime soloTick behavior is correct (lowered to low).
113. **AW-sync-8** [low (was med)] [old #88] `server.ts:223-229, .github/workflows/ci.yml:29-53`. Postgres startup still runs four unconditional full-table UPDATE statements on every boot (though the CI Postgres gap was fixed by adding unit-postgres in ci-remote).
   - **User steps:** no user-visible symptom. **Developer trigger:** Calling postgresStore(url) on an existing Postgres database executes server.ts:223-229 unconditionally.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Record applied backfills in a schema_migrations table so server.ts:223-229 run once per database.  
     _Notes:_ Half-fixed: CI Postgres tests were added in ebacefad (ci-remote). Also memoryStore.events() and postgresStore.events() actually agree on after slicing because memoryStore never trims events.
114. **AW-gates-8** [low (was med)] [old #89] `scripts/deps.ts:56-260; tests/lint.test.ts:1049-1055,1109-1146,1299-1324`. scripts/deps.ts and tests/lint.test.ts still use hand-rolled regex/brace lexers instead of ts.createSourceFile despite typescript being a devDependency.
   - **User steps:** no user-visible symptom. **Developer trigger:** Write an unusual multi-line import/export or a catch block with any 4-word dummy comment (`catch { /* any four word comment */ }`); regex scanners miss AST semantics.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Share a small ts.createSourceFile AST helper for import scanning in deps.ts and pageLets/catchesIn checks in lint.test.ts.  
     _Notes:_ Lowered to low because 09e74e2a already fixed deps.ts's biggest symptom (separating typeImports from value imports).
115. **SM-views-8** [low (was med)] [old #114] `src/views/onboard.js:158-189`. Invite sub-step still uses local failed boolean and imperative button mutations outside onboard.ts (though the permanent disable trap at line 183 is fixed via fail('')).
   - **User steps:** no user-visible symptom. **Developer trigger:** Inspect onboard.js:159,171-185; failed boolean and DOM mutations live outside src/core/onboard.ts.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Model the invite step's ready / joining / retry(err) state explicitly and derive button text, disabled, and aria-busy in one render helper.  
     _Notes:_ Severity lowered from med to low because b5d24630 fixed the stuck-disabled button trap at onboard.js:183.
116. **AW-sync-10** [low (was med)] [old #116] `src/app.js:235-236, 264, 267`. src/app.js remains untyped loose JS carrying dead optional-chaining/truthiness guards (app.api.sync?.switchTo, app.api.onboard) even though apiTable throws on unregistered APIs.
   - **User steps:** no user-visible symptom. **Developer trigger:** Inspecting src/app.js:235-236,264,267 against src/edge/api-table.ts:14-18.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Delete dead fallback line 236 and unnecessary app.api.onboard guards at lines 264/267, and migrate src/app.js to strict src/app.ts.  
     _Notes:_ Note: old report misquoted quests?.tick()/combat?.tick() at lines 262-265; the actual dead guards there are app.api.onboard at lines 264 and 267. Line 236 dead fallback masked NEW-sync-1.
117. **AW-gates-7** [low] [old #127] `scripts/publish-clean.ts:23`. CLI argument out is interpolated directly into a double-quoted sh -c command string (`git archive HEAD / tar -x -C "${out}"`).
   - **User steps:** no user-visible symptom. **Developer trigger:** Run `bun scripts/publish-clean.ts '/tmp/$(touch /tmp/pwn)'`; sh -c evaluates shell metacharacters in argv[2].
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Spawn `git archive HEAD` and pipe its stdout to `tar -x -C` using argv arrays (or pass out as positional $1 to sh -c).  
     _Notes:_ Developer-only local script; low severity holds.
118. **SM-gates-5** [low] [old #132] `scripts/ci.ts:55-82`. scripts/ci.ts freeze-detection interval mutates module-level pauses array across async step boundaries and post-exit wait, so a freeze during the 1 s post-exit wait can misclassify a real failure as a pause and retry it.
   - **User steps:** no user-visible symptom. **Developer trigger:** Run `bun run ci` when a step exits non-zero from a real test failure and the VM pauses during the 1000 ms setTimeout at scripts/ci.ts:74; pauses becomes non-empty and the real failure is retried up to MAX_TRIES.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Scope freeze tracking per step attempt with an explicit 'running' / 'exited' phase so freezes after proc.exited are ignored.  
     _Notes:_ Old audit misdescribed ci.ts as having STALL_MS=30_000 and proc.kill(); actual code is a 5 s VM-freeze detector (FREEZE_MS=5000) with a minor post-exit window.
119. **AW-sync-11** [low] [old #135] `src/edge/sync.ts:531-539, tests/models/room-world.ts:1-850`. sendSheet runs 4 JSON serialize/parse passes per push, and tests/models/room-world.ts (850 lines) hand-copies sync.ts orchestration so edge bugs escape model tests.
   - **User steps:** no user-visible symptom. **Developer trigger:** Reading src/edge/sync.ts:531-539 and tests/models/room-world.ts:1-4.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Serialize the sheet push payload once with bytesOf, and drive tests/room-system-model.test.ts through an extracted sync runner with injected fetch.  
     _Notes:_ Unchanged since a11b6a5d.
120. **AW-sync-12** [low] [old #137] `src/edge/store.ts:32, src/edge/sync.ts:759`. randId in store.ts and event ID generation in sync.ts still use Math.random() instead of crypto.getRandomValues / cryptoRandom.
   - **User steps:** no user-visible symptom. **Developer trigger:** Inspecting src/edge/store.ts:32 and src/edge/sync.ts:759.
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Use crypto.getRandomValues in randId (store.ts:32) and cryptoRandom() in sync.ts:759.  
     _Notes:_ Unchanged since a11b6a5d.
121. **AW-views-9** [low] [old #141] `src/views/shadows.js:46-78, src/views/combat.js:296-312,891-906, src/views/inventory.js:215-222,266-269, src/views/room.js:284-285, src/views/stories.js:225-232`. Stale entity/index/snapshot captures across await and missing in-flight guards persist across secondary views (only gates.js enterAlone was fixed in 8f5a3b0b).
   - **Tap:** GM picks intent target after hunter moves, or double-taps End story / GM seat release / deletes a shop item while shop mutates.
   - **Shows:** Stale coordinates/indices/counts are used after resuming from await, or duplicate async actions trigger.
   - **Should show:** Re-read live state after every await and guard async triggers against double taps.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-b.e2e.ts:127 / bunx playwright test tests/e2e/proof-views-open-b.e2e.ts --workers=1 -g "BUG-views-20" / passed (2.3s) for combat.js setIntent; other sites verified by read
   - **Fix:** Re-read fresh fight/hunter/item-by-id after await in combat.js, shadows.js, inventory.js, and add in-flight/dedup guards in room.js and stories.js.  
     _Notes:_ gates.js enterAlone was fixed by SM-gates-1 (8f5a3b0b).
122. **SM-views-10** [low] [old #143] `src/views/story-maker.js:49-53,159-160, src/views/dice.js:221-223,268-276`. Story accordion lazy quest validation and Dice dcInit/isOpen flags still permit stale UI states.
   - **Tap:** Collapse an invalid job-quest chapter in Story Maker and save; switch active hunter from E-rank to S-rank in Dice view.
   - **Shows:** Invalid collapsed chapter saves; Quick Check DC stays stuck at E-rank Standard instead of S-rank Standard.
   - **Should show:** Validate all chapters' quest data on save and key Dice DC default initialization by { hid, rank }.
   - **How it knows:** **RAN.** tests/e2e/proof-views-open-a.e2e.ts:144 & tests/e2e/proof-views-open-b.e2e.ts:207 / both passed: collapsed job quest saved, and dice DC stayed unchanged on E->S hunter switch
   - **Fix:** Validate all chapters in story-maker.js problem() and key dice.js DC auto-fill by `${h.id}:${h.rank}` instead of boolean inst.dcInit.  
     _Notes:_ Both sub-parts reproduced in Playwright.
123. **AW-rules-9** [low] [old #151] `src/core/day.ts:64-67, src/core/hunter/chronicle.ts:116, src/core/hunter/feats.ts:149, src/core/hunter/chronicle-view.ts:112,152`. Multiple hunter chronicle/feat modules bypass canonical compareTimes() in day.ts despite day.ts:62 claiming a lint prevents text comparison
   - **User steps:** no user-visible symptom. **Developer trigger:** Inspect chronicle.ts:116, feats.ts:149, chronicle-view.ts:112,152 (proven by BUG-rules-30 test)
   - **How it knows:** **RAN.** .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / BUG-rules-30 proof shows featNews and pushedChronicle mis-order offset ISO timestamps
   - **Fix:** Use compareTimes() in chronicle.ts, feats.ts, and chronicle-view.ts and extend the lint test  
     _Notes:_ Architectural counterpart of BUG-rules-30
124. **AW-rules-11** [low] [old #153] `src/core/rewards.ts:159-166, src/core/combat/fight-parse.ts:654, src/core/hunter/imported.ts:22-46`. Boundary type/limit inconsistencies: saveBundle() accepts unbranded string id, fight-parse.ts hardcodes level <= 200, and imported.ts misses ID remappings
   - **User steps:** no user-visible symptom. **Developer trigger:** Check rewards.ts:159 signature and run BUG-rules-18 and BUG-rules-28 proofs
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Change saveBundle id parameter to BundleId, import MAX_LEVEL in fight-parse.ts:654, and complete imported.ts ID remapping  
     _Notes:_ Underlying BUG-rules-18 and BUG-rules-28 were both proven via ran tests
125. **SM-rules-7** [low] [old #154] `src/core/hunter/record.ts:39-44`. Rank vs level demotion has no explicit eligibility/mismatch state (level can drop below rank floor while hunter retains higher rank bonus and open build tiers)
   - **User steps:** no user-visible symptom. **Developer trigger:** Set a rank-A hunter to level 1 via atLevel(); reevaluate() returns refused('not-eligible') with no mismatch indicator
   - **How it knows:** **READ.** Inferred from the code.
   - **Fix:** Add rankStanding(h, R): {at:'current'} / {at:'ready';to:Rank} / {at:'above-level';floor:number} in record.ts  
     _Notes:_ Correction to old report: record.ts:42 uses rankForLevel(R, h.level) so promotion already jumps multiple ranks at once; only level-below-rank mismatch lacks an explicit state

## Fixed since a11b6a5d (37 findings)

| # | ID | Old sev | Fixed by | How it knows | Evidence |
|---|---|---|---|---|---|
| 1 | BUG-gates-1 | high | df66fb41 (commit c0863941; landed.md row 'The shop closed in death; audit: gates and the fight') | ran | .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: second settleClear on cleared or closed gate returned { ok: false, why: 'unchanged' } (gold stayed 20, xpPaid 150); tests/pay.test.ts also passes |
| 2 | BUG-views-2 | high | b5d24630 / f11e6911 (landed.md: Audit: refused writes, a player's turn reaction) | ran | tests/fight-view.test.ts + tests/e2e/map-extras.e2e.ts / bunx playwright test tests/e2e/map-extras.e2e.ts --workers=1 -g "arms a reaction before a turn" / 1 passed (16.7s); fight-view waitChoices tests pass |
| 3 | BUG-sync-3 | high | 0e2b4133 (ef6ee9fc; landed.md: Audit: the save and the room link) | ran | .reaudit/proofs/sync/fixed.test.ts / bun test ./.reaudit/proofs/sync/fixed.test.ts / pass: all SYNC_OWNER phone/key fields absent in export; Phone B retains deviceToken, applied, and gmKeys |
| 4 | BUG-gates-4 | high | df66fb41 (commit d6a6b20c; landed.md row 'The shop closed in death; audit: gates and the fight') | ran | .reaudit/proofs/gates/gates-proofs.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts / pass: itemAbility returned non-null ability with matching op for all 7 wave-2 UseOps; tests/abilities.test.ts also passes |
| 5 | BUG-views-7 | high | b5d24630 (landed.md: Audit: refused writes, a player's turn reaction) | ran | tests/e2e/refused-writes.e2e.ts:33 / bunx playwright test tests/e2e/refused-writes.e2e.ts --workers=1 / passed (2.1s) |
| 6 | BUG-views-1 | high | 8451001a (landed.md: Audit: the detail that would not open again) | ran | tests/detail-open.test.ts + tests/e2e/look.e2e.ts / bun test tests/detail-open.test.ts & bunx playwright test tests/e2e/look.e2e.ts --workers=1 -g "opens it again" / 5/5 unit pass and 3/3 browser pass (chip/stat, monster ability, map hotbar) |
| 7 | BUG-rules-3 | high | f14cf068 (7825f6df) / landed.md row 30; beforeReactions unified in e165338b (6c47a720) | ran | .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / broken(holding charge=4) -> state='broken', charge=2 (and tests/fight.test.ts holds 10 channel release cases) |
| 8 | BUG-views-3 | high | dacd81ab / e1105aac (landed.md: Audit: the map maker's refused save, a revive on a player's phone, the battle map's life) | ran | tests/e2e/table-turn.e2e.ts / bunx playwright test tests/e2e/table-turn.e2e.ts --workers=1 -g "revives from the fight" / 1 passed (16.5s) |
| 9 | AW-sync-1 | high | 0e2b4133 (ef6ee9fc; landed.md: Audit: the save and the room link) | ran | .reaudit/proofs/sync/fixed.test.ts / bun test ./.reaudit/proofs/sync/fixed.test.ts / pass: SYNC_OWNER exhaustively strips phone/key fields on export and preserves phone fields on keepPhone |
| 10 | BUG-views-4 | high | dacd81ab / d7f67cf1 (landed.md: Audit: the map maker's refused save, a revive on a player's phone, the battle map's life) | ran | tests/e2e/maps.e2e.ts / bunx playwright test tests/e2e/maps.e2e.ts --workers=1 -g "Save as a new map is refused" / 1 passed (3.5s) |
| 11 | BUG-rules-2 | high | e165338b (merged in 6c47a720) / landed.md row 48 | ran | .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / needs().second=['M'] and resolve(..., {second:{M:18}}).ok=true |
| 12 | BUG-sync-6 | high | 3fa078be (audit-server; landed.md: Audit: the room server at the same moment) | ran | .reaudit/proofs/sync/fixed.test.ts / bun test ./.reaudit/proofs/sync/fixed.test.ts / pass: 24x200 + 1x413 on 25 concurrent PUTs; both concurrent DELETEs kept in _kicked |
| 13 | BUG-gates-5 | high | 8f5a3b0b (commit 5ab271e9; landed.md row 'Audit: a pack\'s statuses, a solo run in flight') | ran | .reaudit/proofs/gates/gates-proofs.test.ts & tests/pack.test.ts / bun test ./.reaudit/proofs/gates/gates-proofs.test.ts & bun test tests/pack.test.ts / pass: all 24 cases in pack.test.ts and multi-field proof test pass |
| 14 | BUG-views-5 | high | b5d24630 (landed.md: Audit: refused writes, a player's turn reaction) | ran | tests/e2e/refused-writes.e2e.ts:47 / bunx playwright test tests/e2e/refused-writes.e2e.ts --workers=1 / passed (2.6s) |
| 15 | AW-rules-3 | high | e165338b (merged in 6c47a720) / landed.md row 48 | ran | .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / BUG-rules-2 & BUG-rules-4 proofs both pass using shared field() |
| 16 | AW-sync-2 | high | 3fa078be (audit-server; landed.md: Audit: the room server at the same moment) | ran | .reaudit/proofs/sync/fixed.test.ts / bun test ./.reaudit/proofs/sync/fixed.test.ts / pass: boardCalls === 0 across 25 PUT /sheets/:key requests |
| 17 | AW-gates-1 | high | 09e74e2a (commit f4391da6; landed.md row 'Audit: layers and import cycles') | ran | .reaudit/proofs/gates/gates-proofs.test.ts & tests/deps.test.ts / bun test tests/deps.test.ts / pass: layerBreaks(map) is [], room-pill.ts moved to src/views/room-pill.ts, sync.ts defines SyncHost |
| 18 | BUG-views-6 | high | b5d24630 (landed.md: Audit: refused writes, a player's turn reaction) | ran | tests/e2e/refused-writes.e2e.ts:67 / bunx playwright test tests/e2e/refused-writes.e2e.ts --workers=1 / passed (962ms) |
| 19 | BUG-rules-4 | high | e165338b (merged in 6c47a720) / landed.md row 48 | ran | .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / blink to (4,0) near M2 at (5,0) -> needs().react=['M2'] and resolve().ok=true |
| 20 | AW-gates-2 | high | 09e74e2a (commits bd2e2518, 3ad5fd91; landed.md row 'Audit: layers and import cycles') | ran | .reaudit/proofs/gates/gates-proofs.test.ts & tests/deps.test.ts / bun test tests/deps.test.ts / pass: valueCycles(map) is [] |
| 21 | SM-sync-3 | high | 0e2b4133 (d8e4827e; landed.md: Audit: the save and the room link) | ran | .reaudit/proofs/sync/fixed.test.ts & tests/publish.test.ts / bun test tests/publish.test.ts / pass: 7/7 tests pass |
| 22 | BUG-views-8 | high | dacd81ab / 38523719 (landed.md: Audit: the map maker's refused save, a revive on a player's phone, the battle map's life) | ran | tests/map-mount.test.ts + tests/e2e/battle-map.e2e.ts:370,413 / bun test tests/map-mount.test.ts & bunx playwright test tests/e2e/battle-map.e2e.ts --workers=1 -g "zoomed the map out/switches the fight" / 8/8 unit pass, 2/2 browser pass (13.7s, 10.5s) |
| 23 | SM-gates-1 | high | 8f5a3b0b (commit 2be89ce2; landed.md row 'Audit: a pack\'s statuses, a solo run in flight') | ran | tests/e2e/solo.e2e.ts & tests/solo-run.test.ts / bunx playwright test tests/e2e/solo.e2e.ts -g 'while a run plays/a redraw of the solo panel' --workers=1 --output=/tmp/pw-gates-solo / 3 passed (15.3s); bun test tests/solo-run.test.ts: 6 pass |
| 24 | BUG-rules-7 | high | 8864d53d (merged in 6c47a720) / landed.md row 48 | ran | .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / hpAdj=-99999, manaAdj=-99999, fatigueMax=-99999 -> sheet hpMax=1, manaMax=0, fatigueMax=1 |
| 25 | AW-views-3 | high | 8451001a (landed.md: Audit: the detail that would not open again) | ran | tests/detail-open.test.ts + tests/e2e/look.e2e.ts / bun test tests/detail-open.test.ts & bunx playwright test tests/e2e/look.e2e.ts --workers=1 -g "opens it again" / all pass |
| 26 | BUG-rules-8 | high | f2e5f811 (merged in 6c47a720) / landed.md row 48 | ran | .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / heldCommands emitted [{type:'refill',id:'c1'}]; dead row stayed hp=0, mana=manaMax |
| 27 | SM-views-2 | high | 8451001a (landed.md: Audit: the detail that would not open again) | ran | tests/detail-open.test.ts + tests/e2e/look.e2e.ts / bun test tests/detail-open.test.ts & bunx playwright test tests/e2e/look.e2e.ts --workers=1 -g "opens it again" / 5/5 unit pass, 3/3 browser pass |
| 28 | SM-views-3 | high | dacd81ab / 38523719 (landed.md: Audit: the map maker's refused save, a revive on a player's phone, the battle map's life) | ran | tests/map-mount.test.ts + tests/e2e/battle-map.e2e.ts / bun test tests/map-mount.test.ts & bunx playwright test tests/e2e/battle-map.e2e.ts --workers=1 -g "zoomed the map out/switches the fight" / 8/8 unit pass, 2/2 browser pass |
| 29 | BUG-sync-1 | med | 0e2b4133 (f0255d2d; landed.md: Audit: the save and the room link) | ran | .reaudit/proofs/sync/fixed.test.ts / bun test ./.reaudit/proofs/sync/fixed.test.ts / pass: A.def.ops stays [op1] and target.s[0].def.ops is [op2] |
| 30 | BUG-sync-8 | med | 0e2b4133 (d8e4827e; landed.md: Audit: the save and the room link) | ran | .reaudit/proofs/sync/fixed.test.ts / bun test ./.reaudit/proofs/sync/fixed.test.ts / pass: changed during sending enters sendingStale with [] effects, then waiting+setTimer on answered |
| 31 | BUG-rules-6 | med | a2c01d36 (merged in 6c47a720) / landed.md row 48 | ran | .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / res.fired[0].bearer='A', A.gained=['mark'], M.gained=[] |
| 32 | SM-rules-5 | med | f14cf068 (7825f6df) / landed.md row 30 | ran | .reaudit/proofs/rules/combat-proofs.test.ts / bun test ./.reaudit/proofs/rules/combat-proofs.test.ts / broken(holding charge=4) -> state='broken', charge=2; rg state:'broken' matches only fight-channel.ts:36 |
| 33 | BUG-views-10 | med | b5d24630 (landed.md: Audit: refused writes, a player's turn reaction) | ran | tests/e2e/refused-writes.e2e.ts:91 / bunx playwright test tests/e2e/refused-writes.e2e.ts --workers=1 / passed (3.6s) |
| 34 | BUG-views-19 | med | b5d24630 (landed.md: Audit: refused writes, a player's turn reaction) | ran | tests/e2e/refused-writes.e2e.ts:79 / bunx playwright test tests/e2e/refused-writes.e2e.ts --workers=1 / passed (1.3s) + verified gm.js:474,478,513,761,797-798 and gates.js:45 |
| 35 | AW-sync-5 | med | 09e74e2a (f4391da6, audit-cycles; landed.md: Audit: layers and import cycles) | ran | tests/deps.test.ts / bun test tests/deps.test.ts / pass: every import keeps its layer's rule + layer check sees type-only edge->view import |
| 36 | AW-views-7 | med | 09e74e2a / f4391da6 (landed.md: Audit: layers and import cycles) | ran | tests/deps.test.ts:84-95 / bun test tests/deps.test.ts / 17/17 pass including 'every import keeps its layer's rule' |
| 37 | AW-rules-10 | low | 8864d53d (merged in 6c47a720) / landed.md row 48 | ran | .reaudit/proofs/rules/hunter-core-proofs.test.ts / bun test ./.reaudit/proofs/rules/hunter-core-proofs.test.ts / BUG-rules-7 & AW-rules-10 proof: hpMax=1, manaMax=0, fatigueMax=1 |

## Not a bug (0)

None. A finding is marked "not a bug" only when code or a test proves the behavior is intended, and even then Neon's claim is kept. A finding Neon or the spot-check could not reproduce stays in the open list at Neon's severity and position, marked COULD NOT REPRODUCE with what was tried (one such finding: BUG-views-12). BUG-gates-2 (Stealth: the owner has decided on a design, not built yet) and BUG-sync-5 (rejoin as GM: reachable only through the API) also stay open, with notes.

## Orchestrator spot-check

After Neon finished, the orchestrator re-ran **every** proof Neon wrote at `9ef33bd6`. That was 72 unit tests in 7 files and 21 Playwright tests in 5 files, each Playwright file on its own port. All 93 passed, matching what Neon reported. A passing proof shows the fault, because each one asserts the faulty behavior. The orchestrator also read the assertions of the tests below to check that each tests the claim and not something weaker. To check the fixed claims, it re-ran the 19 November throwaway proofs (`/tmp/sg-proofs`) against both the old commit and HEAD.

| # | ID | Claim | Re-run result | Verdict |
|---|---|---|---|---|
| 1 | BUG-rules-9 | open, ran | pass: after editItem the item is still worn as a weapon with slot chest and qty 3 | confirmed |
| 2 | BUG-rules-10 | open, ran | pass: after a break n=0 but vals keeps [goblin, orc], and a new Goblin kill does not count | confirmed |
| 3 | BUG-rules-16 | open, ran (unit + e2e) | pass: Rules page shows 10 g; sellPrice is 50 | confirmed |
| 4 | BUG-rules-17 | open, ran | pass: featsDoc JSON fits under DOC_MAX in chars but is over 65,536 bytes | confirmed |
| 5 | BUG-rules-18 | open, ran | pass: parseFight returns null for a level-201 row | confirmed |
| 6 | BUG-rules-20 | open, ran | pass: HP stays at the buffed max after the buff drops | confirmed |
| 7 | BUG-rules-21 | open, ran | pass. Part 3 also shows a dying hunter standing up after a daily | confirmed; led to NEW-orch-1 |
| 8 | NEW-rules-1 | new, ran | pass: the dead hunter's row gets hp 10 while the sheet stays dead | confirmed |
| 9 | BUG-sync-2 | open, ran | pass: the equipped ref dangles, then gets wiped on the next repair | confirmed; note added that it needs duplicate ids from an import |
| 10 | BUG-sync-4 | open, ran | pass: an entry that was sending stays sending after roomGone, then is queued again for the dead room | confirmed |
| 11 | BUG-sync-5 | open, ran | pass, at reducer level | confirmed, but only reachable through the API (UI hides it); kept low |
| 12 | BUG-gates-7 | open, ran | pass: soloPlan pays and clears a gate with solo: false | confirmed; note added that it needs a stale or forged proposal |
| 13 | BUG-views-13 | open, ran (e2e) | pass: tapping Cancel on Shadow Extraction toasts "Extraction of X failed." | confirmed |
| 14 | NEW-gates-1, NEW-sync-1, BUG-sync-13, BUG-views-9/15/17 | ran (e2e) | all pass | confirmed |
| 15 | BUG-gates-1 | fixed | old proof at a11b6a5d: the second clear is not refused and gold goes 20 to 40. At HEAD: the second clear is refused and gold stays 20 | fixed, confirmed |
| 16 | BUG-gates-4 | fixed | old proof at a11b6a5d: itemAbility gives null for dispel and hasten items. At HEAD it keeps the ops | fixed, confirmed |
| 17 | BUG-sync-1 | fixed | old proof at a11b6a5d: burn's ops are overwritten with slow's. At HEAD they are correct | fixed, confirmed |
| 18 | BUG-views-5, -6, -7, -10, -19 | fixed | `tests/e2e/refused-writes.e2e.ts` (new since a11b6a5d, 3e8a0b53): 5/5 pass | fixed, confirmed |
| 19 | BUG-views-2 | fixed | `map-extras.e2e.ts` "arms a reaction before a turn" (added in f11e6911): pass | fixed, confirmed |

**Corrections the orchestrator made:**

- **Added NEW-orch-1** (dailies still recover). This is the owner's 19 November decision, and it was never carried out.
- **Added reachability notes** to BUG-sync-2, BUG-sync-5 and BUG-gates-7.
- **Added a note to BUG-gates-2:** the fix is a design the owner has decided, and it is not built yet.
- **Wrote plain "should show" text** for six of the top-ten entries where Neon had written a code fix instead.
- **BUG-views-12 is back in the open list** at Neon's severity (low) and its rank (old #71), tagged COULD NOT REPRODUCE. Neon could not reproduce it with a Playwright drive. The previous version of this doc had listed it as not-repro.
- **No claim was found wrong.** Every proof re-run reproduced. No finding was dismissed, moved or downgraded because of the spot-check. Severity is Neon's value at HEAD. Neon lowered many 19 November highs to med after re-checking. The orchestrator did not raise them back.

**Run notes:**

- **Lane times:** rules 1,158 s, sync 1,189 s, views 1,802 s and gates 1,561 s.
- **Tokens:** about 0.33 to 0.84 M in, 84 to 94 k out and 22 to 35 k thinking per lane.
- **Errors:** each lane's last stream ended in a transport error ("stream was interrupted" or a connection timeout) after it had written its JSON and final answer. All 154 ids came back, and no lane needed a relaunch.
- **No quota errors.** No command was denied (`run_command` ran 56 to 78 times per lane).


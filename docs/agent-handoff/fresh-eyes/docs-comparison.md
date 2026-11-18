# Fable: docs vs. fresh-eyes review

Model: claude-fable-5-2 (direct Messages API, no Claude Code). Input 608,857 tokens, output 23,006. Run 2026-11-17 ~18:15 (UTC-3).
Repo: the-owner/systemgaming @ claude/zen-pasteur-ov4cgd e7e68735. 290 doc files: 68 whole, 222 excerpted (session notes, briefs, big inventories), plus in-app help sources (onboard.js, onboarding.ts, rulesref.js, rules.ts).
PR #35 (and #36) MERGED 2026-11-16, so the live site already has the rework; branch is 18 commits ahead (odds engine + docs).
Prompt/meta: docs-run/{context.txt,ask.txt,build.py,request.json,build-stats.json,meta.json}

---

**Two corrections first.** Everything I reviewed was already the reworked build, so nothing below is excused by "the fix is on a branch"; only the odds engine is not live. And I was wrong that "Workshop", "GM tab" and "room button" don't exist: they do, but only in the GM role (`AGENTS.md`, the Workshop row: "a GM-only view in the More menu").

Paths are under `docs/agent-handoff/` unless they start with `README`, `AGENTS`, `docs/` or `src/`.

## 1. Finding by finding

(a) already addressed · (b) planned, not done · (c) genuine gap · (d) deliberate choice

| # | Finding | Class | Evidence and note |
|---|---|---|---|
| 1 | Nothing says what this is | (c) | `README.md` line 1 has the sentence ("Solo Leveling-inspired… for a GM and their players"). `final/notes-wording.md` step 4 put a description only in the manifest. Nothing is on screen in `src/views/onboard.js`. |
| 2 | Welcome popup is an in-joke | (d) | The dodging "No" is coded on purpose in `onboard.js` `welcome()`; `later-phases/ui-prompt.md` says "Keep the Solo Leveling system-window look". A newcomer still needs one plain line under it. `copy-tasks.md` "The voice" already says a window's body should be plain, so that line follows your own rule. |
| 3 | "Who are you?" assumes the roles | (c) | `onboard.js` `role()` shows only "I'm a Player / I'm the GM". Spelling out "Game Master" is (d): `copy-tasks.md` glossary says GM, not Game Master. A line per role is still missing. |
| 4 | No first step after onboarding | (c) | `PLAYER_TIPS` exist in `onboard.js` but show only behind "?". Begin and Skip end silently. Docs are silent on a checklist. |
| 5 | Bottom bar covers controls | (a) | Very likely my full-page capture. `lead-report.md` §5: overlaps are "scrolled content passing under the bottom nav". `AGENTS.md` ("How a screen looks at each size") has a phone sweep. Caveat: `final/notes-final.md` says real-device behaviour was never checked. |
| 6 | Penalty countdown ambushes | (d) | Dailies and penalties are the core loop (`README.md` Features; the Rules tab's "Daily quests and penalty" in `src/views/rulesref.js`). Still needed: the banner names the quest and the penalty and opens the Daily tab. |
| 7 | Players see GM controls | (d) | Alone, "a phone with no room is its own GM" (`ui-pass/notes-3-player.md` step 1). In a room it is locked (`docs/GAME-UPDATE.md` P01, F02). A full player lockdown is deferred: "table trust holds socially" (`docs/GAME-UPDATE.md` "Deferred"). Still needed: one line saying so. |
| 8 | PLAYER pill is a hidden switch | (d) | `p3/notes-role.md`: alone the pill asks and switches; in a room it only explains. `AGENTS.md` "Saves and roles": in a room the GM is whoever holds the GM key. Smallest change: label it "Mode: Player". |
| 9 | Status page overwhelming, fake tabs | (d) | One sheet with jump chips is the design (`ui-pass/design.md`, "The sheet (A5, A15, A16)"). Smallest change: fold Derived and Check bonus shut by default. |
| 10 | Attribute cards cryptic | (c) | The Confirm part is (a): `for-the-owner.md` "Ability points: + then −" names "Confirm allocation"; I infer it shows only with points pending. Labelling "+2" and explaining a check: docs are silent. |
| 11 | Room unexplained, three doors | (c) | The three doors are deliberate and open one view (`lead-report.md` §9, "One place for the room"). What a room shares is only in `README.md` "Campaign rooms", not in the app. |
| 12 | Rules opens with GM tables; 14 → +2 vs +1 | (c) | `rulesref.js` lists "GM quick card" first for everyone. The contradiction is a real bug: by the file's own formula, Strength 14 gives +1, not "about 2". |
| 13 | Quick-start hidden and mismatched | (c) | `onboard.js` `quickstart()` shows GM and player tips to everyone. "The room button at the top" is the glossary's name (`copy-tasks.md`), but a player's button reads "Join" (`final/notes-wording.md` step 1). |
| 14 | Build and job undescribed | (b) | `final/notes-wording.md` step 4: "Left, needs a field: the path flavour lines"; also `handoff.md` §4.5. Job versus path explained: docs are silent. |
| 15 | Combat has no flow | (c) | Start exists but only after you add someone (`docs/state-machines.md` "A fight"). The empty text still says "shadows" although their space went in PR 36 (`features/plan.md`); I infer that line is a leftover. |
| 16 | Empty states are dead ends | (c) | `ui-pass/audit.md` has no empty-state finding; `lead-report.md` §13 "Left on purpose" says gates, bestiary, data, room and device were not read closely. |
| 17 | Bestiary jargon and leftovers | (c) | Two were noticed and left: "Penalty Zone resident" (`lead-report.md` §10 "Open, and why") and "Stride 4" with no unit (`final/notes-final.md` step 3). The "AC" and "ft" lines are old text from before Armor replaced AC (inferred from `rw/m2-plan.md` §1.2, excerpted). |
| 18 | Colliding terms | (d) | The wording pass chose each word (`copy-tasks.md` glossary; `final/notes-wording.md`: Store versus "New item…"). The Status tab versus the "Statuses" heading, and Shop versus Store, still collide. Smallest change: rename the Store button. |
| 19 | Sample character vanishes | (d) | `onboard.js`: "the seed hunter… becomes the player's own, neutral". Smallest change: a "Hunter created" toast. |
| 20 | HP and fatigue controls | (d) | "7 damages, +5 heals" is a feature (`docs/GAME-UPDATE.md` P01, F04). Smallest change: placeholder "7 = damage, +5 = heal". Fatigue "Full": docs are silent. |
| 21 | Settings split, Sound twice | (d) | Device settings are kept apart so they never sync or export (`lead-report.md` §3). The doubled Sound toggle: docs are silent. |
| 22 | Mobile wayfinding | (d) | "The bottom bar stays as it is" (`ui-pass/design.md`, "Makers from home"). Room is already one tap from the header (`lead-report.md` §9). A page title for views under More is still missing. |
| 23 | Dice notation | (d) | You asked for Roll20 text (`later-phases/combat-rework-notes.md`, "Dice typed the Roll20 way"). Smallest change: one example line under the field. |
| 24 | "?" button versus "?" key | (c) | `README.md` says "?" opens the guide; `docs/GAME-UPDATE.md` "Keyboard shortcuts" says the "?" key opens a shortcut list. Nobody reconciled them. |
| 25 | Data page scary | (c) | `README.md` "Saves and backups" has the reassuring sentence; the app does not lead with it. Docs are silent on hiding GM items from players. |

Smaller points from my review that were not numbered fixes:

| Finding | Class | Evidence |
|---|---|---|
| Can I play alone? | (b) | Solo runs are feature 2: brief written, not built (`features/plan.md`, `features/brief-2-solo.md`). |
| What a room sends, who sees it | (c) | Only in `README.md` "Campaign rooms" ("The room code is the only secret"). |
| Jump chips cut off, no hint | (a) | A fade was added (`ui-pass/notes-3-player.md` step 2, A15). It is evidently too subtle. |
| "SYSTEM" missing on phones | (d) | `lead-report.md` §1: the wordmark stays for screen readers only. |
| Desktop says "phone", "Tap" | (d) | Phone-first (`AGENTS.md` line 1). |
| Guide title clipped on a phone | — | Docs are silent; check on a real phone. |

## 2. Promised but undiscoverable

- **Nothing sent is lost.** `for-the-owner.md` "Nothing sent to the room is lost". A user sees only a pill state. Say it once in the Room view.
- **Backups.** The last 8 are kept automatically, and moving phones needs an export (`README.md` "Saves and backups"; `docs/GAME-UPDATE.md` Oct 19, "New phone"). The Data page should lead with this.
- **Rooms.** Invite link and QR, who is online, Remove and Allow back, a hunter locked to its device, expiry after 30 idle days (`lead-report.md` §9; `docs/GAME-UPDATE.md` Oct 19; `README.md`). None of it is stated before you create a room.
- **GM tools.** The Workshop and its makers, kit examples to copy, bundles, boons with Redeem, "Reward uses", maps and fog (`lead-report.md` §12–13; `for-the-owner.md` "Making kits in the Workshop"). A player-mode visitor never learns these exist. Name them on the "I'm the GM" step.
- **Starter campaign.** Its contents are described only in `README.md` and behind "?"; the button itself says nothing.
- **Coin call on a natural 1 or 20** (`later-phases/coin-notes.md`). The Rules tab never mentions it.
- **More info.** Tap a chip, or press and hold a hotbar slot, for details (`later-phases/feel-notes.md`, "More info on anything"). No hint anywhere.
- **Sharing codes.** `HS1.` packs (`lead-report.md` §12 "Sharing"). They appear on Data with no explanation.
- **Desktop shortcuts and home-screen install** (`docs/GAME-UPDATE.md` "Desktop pass"; `lead-report.md` §1). No prompt.
- **Odds engine.** "Play it out 100 times" (`for-the-owner.md`, "How hard is this fight") is not live yet.

## 3. Conflicts and staleness

**In-app help versus docs:**
- The Rules tab says points lock when you "leave the Status view" (`rulesref.js`, leveling). `for-the-owner.md` says "nothing else confirms" but the Confirm button.
- The Rules tab says "a score of 14 adds about 2"; its own worked example gives +1.
- The Rules tab says "Natural 1 always fails". `later-phases/coin-notes.md` says a right call on a 1 is "Saved".
- The Rules tab says a hunter at 0 HP is "Unconscious". The chip says "Dying" (`ui-pass/notes-3-player.md` step 3) and the glossary says "down" (`copy-tasks.md`).
- The Rules tab says "Each shadow level adds +10% max HP". `rw/m2-plan.md` §1.2 (excerpted) lists a shadow's level as gone. Likely stale.
- The onboarding body is in System voice ("[SYSTEM] You have been chosen…"). `copy-tasks.md` says System voice lives in the tag and title only.
- Onboarding lets any player pick Necromancer as a starting job (`onboard.js` lists `RULES.jobs` from `src/core/rules.ts`). `features/plan.md` says "Your average class won't have access" to shadows.

**`README.md` is out of date:**
- It says saves live under `hunter-system-v3` and old saves are updated and kept. `AGENTS.md` "Saves and roles" says v4, and old saves are not carried over.
- It says "Start encounter", "roll initiative", "Campaign Room" and "join… (Data tab)". The glossary says fight and room, and the room opens from the button at the top (`copy-tasks.md`; `lead-report.md` §9).
- It says phones poll every 5 s. `final/notes-final.md` (merge, step 3) says 3 s in a fight and 1 s on a player's turn.

**`docs/GAME-UPDATE.md`** is addressed to you with the live URL but describes the October app: AC, Status Forge, Loot Forge, an old Quick line format and "existing saves are untouched". Its "Try it in 5 minutes" no longer matches.

**Agent and handoff docs:**
- `START-HERE.md` "Where things stand" says the combat rework is next and a PR is open. `handoff.md` §1–2 says PRs 35 and 36 are merged.
- `START-HERE.md` asks for a TestFlight note. `features/plan.md` says you don't care about it.
- `handoff.md` §2 says the lead has not looked at feature 6 on a screen. `features/lead-look-6-odds.md` exists with three findings.
- That file reports "dead in 20%" in fights the party always wins. `for-the-owner.md` describes the odds line with no such caveat.
- `features/plan.md` says the solo brief is "written when 6 lands". It is written.
- `features/notes-6-odds.md` opens with "step 1 written" and ends done.
- `helper-rules.md` and `.claude/agents/*.md` still say "phase 3", branch `mobile-gameplay-pass`, and that hunters survive a save change by migration. `AGENTS.md` says no carry-over.
- `phase3-plan.md` says never commit `.claude/`. `START-HERE.md` says skills and agents are committed.
- `lead-report.md` stops at §13 and still uses "Enemy" and "Reward" labels. There is no rework, map or "Phone test" section, although `START-HERE.md` order of work step 5 requires one.

**The live site is unverified.** `handoff.md` §1 says a cloud session cannot reach it, so the docs hold no evidence anyone has looked at the deployed build.

## 4. What to add, in priority order

**Top 5**

1. **Say what this is on the first window.** In `onboard.js` `welcome()`, add a plain line under the System line: "A companion app for a tabletop RPG inspired by Solo Leveling. One person runs the game (the GM); players keep their hunter here." Add the same sentence to an About line in the "?" guide. *Why:* a stranger cannot tell tool from game. *Small.*
2. **Describe the two roles.** In `onboard.js` `role()`, add a line under each button ("I have a hunter; someone else runs the game" / "I run the game for my table: quests, fights, rewards, a Workshop to make content") and relabel Skip "Just looking". In `gm()`, say what the starter campaign contains. *Why:* this is the first real decision. *Small.*
3. **Give a first step after setup.** When setup reaches `done`, show a "Hunter created" toast and open the guide with only that role's tips. Rewrite the tips to name what is on screen ("Spend your 12 points with +, then Confirm", "Tap Join at the top"). *Why:* 60 buttons and no goal is where people leave. *Small to medium.*
4. **Fix the Rules tab** (`src/views/rulesref.js`):
   - "14 adds about 2" should be +1.
   - Delete "or leave the Status view".
   - Add the coin call.
   - Use one word for 0 HP.
   - Check the shadow-level line.
   - Open with a short "How a session works" and move "GM quick card" last for non-GMs.
   *Why:* it is the only glossary and it contradicts itself. *Small.*
5. **State who may do what.** When a phone is alone in player mode, show one line on Status, Combat and Bestiary: "You're not in a room, so this phone runs its own game and you can change anything. In your GM's room, the GM does this." *Why:* it removes the "am I allowed?" confusion without building a lockdown. *Small to medium.*

**Then**

6. **Penalty banner.** In `src/views/quests.js`: name the quest and the penalty (−2 to checks), make a tap open Daily, and open Quests on Daily when that is the only live quest. Whether day one should count at all is your call. *Small.*
7. **Room explainer.** Two sentences on the Room view from `README.md` (your sheet goes to the GM; the code is the only key; nothing is lost offline), plus a reason beside a disabled Join. *Small.*
8. **Empty states** on Gates, Combat, Titles, Skills and Bag: who fills this and how. Drop "shadows" from Combat's line. *Small.*
9. **Path descriptions** (already planned) and a line on job versus path. Decide whether Necromancer belongs in the starting jobs. *Medium.*
10. **Data page.** Lead with "Your game lives only in this browser. Back it up here." Hide GM key and custom-content sharing from players. *Small to medium.*
11. **Bestiary clean-up.** Remove "AC" and "ft" from monster notes, add units, make "Extractable" tap to explain, and name "Penalty Zone resident". *Small.*
12. **Hints at the control.** One Roll20 example under the dice field, the HP placeholder, and a label on the floating d20. *Small.*
13. **One Help.** The "?" button and "?" key should open the same thing, with a title on pages under More. *Small.*
14. **Doc fixes.** Rewrite `README.md`; mark `docs/GAME-UPDATE.md` historical; update `START-HERE.md` "Where things stand" and the TestFlight line; fix `helper-rules.md` and the two agent files; correct `handoff.md` §2; add the missing `lead-report.md` sections. *Medium.*
15. **Check the live site on a real phone.** Look at the bottom bar at the end of each page and the clipped guide title. Settle the "dead in 20%" odds wording before feature 6 goes live. *Small.*
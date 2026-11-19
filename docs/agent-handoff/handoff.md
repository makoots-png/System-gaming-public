# Handoff for the next lead (rewritten Nov 18, for a handover after feature 2 of the four features)

Read `START-HERE.md` first: it holds the owner's standing rules, and it wins. Then `features/plan.md`: his rulings for the work under way. The trail of every decision and push is `decisions.tsv` (read its last 30 rows).

## 1. What the owner wants, in his words

The improvement run is finished and live (PRs 35 and 36 merged into `main`, which deploys by itself: https://hunter-main-production.up.railway.app; a cloud session cannot reach it). He then picked four features and their order (`features/plan.md`): "1, 2, 5, 6", built as **6, then 2, then 1, then 5**. On solo play: "I do want the player to essentially 'speedrun' a dungeon. It just takes his odds of winning and adds it"; he ruled that a solo run always resolves and the odds set the cost, a hunter can die "but resurrection is possible", and solo gates are both the System's personal ones on a timer and world gates the GM marks solo. He does not care about iOS. His standing words hold: "I want it perfect, I do not care about time." "Everything must be explicit. Everything." "For all things we must fix the problem and not the symptoms." "Architecture first." And on Nov 17: "Make sure to hand off when applicable." Messages to him: short, phone-readable, the answer first. He was at 87% of his usage on Nov 16: helpers may be stopped by the limit; resume them with SendMessage.

## 2. Where things stand (rewritten Nov 19)

- **The working branch is `ccr-648c5f00-3hvnn9`** on `the-owner/systemgaming` (private). It is `main` merged with `first-run-clarity` (PR 37, still open and contained here) plus everything since. `main` holds everything through PR 36 and is live (Railway deploys from `main` of this repo). If the remote branch's head does not hold this file, the last push was refused: read the trail's last row first.
- **Done and on the branch:** feature 6 (odds), feature 2 (solo runs, the Resurrection Crystal), and of feature 1: unit 1 (the chronicle), the GM's awards for roleplay with their shelf, unit 2 (the row tally), unit 3 (feats, 28 built-ins), units 4 and 5 (the room's part; the feat maker, the Workshop's Feats, feats in packs: `features/notes-1-feats.md` 17.9), and the plain pass over every description (`final/notes-plain-pass.md`).
- **Units 4 and 5 and the plain pass have not been reviewed by a lead.** The helper that built 4 and 5 was stopped before its hand-back; the lead committed its tree after the typecheck and the unit tests passed and the public repo's browser tests ran (the trail's last rows say with what result). Read the diff of `21c88ff` against the design before building on it, and look at the feat maker and the Workshop's Feats at 390 px yourself. The plain pass ran before feats existed on its base: the feats' lines need the same second reader. Its own open points: the Welcome window's No-button joke, the "System whispers" table, the starter quest's story, the Invisible and Stealth lines were left; four descriptions were guesses (Trailsense, Mana Sense, Dagger Rush, Marked Shot).
- **the owner's rulings since Nov 18** (all in `features/plan.md` or the trail): go live as features land; every PC can rise in rank and level (no ceiling); rank colours dropped for now; names and titles may be clever or unclear, every description and explanation plain and literal; stories are started by the GM, move at the GM's pace, and the GM writes their own; the intro story is tabled (he writes it after the features); the PC browser pass is last.
- **"Go live as they land" has not been acted on.** It needs this branch merged into `main` (a PR he asked for in those words covers it; open one and tell him, or ask once if you think he would want to look first). Nothing has gone to `main` since PR 36.
- No helper is running. No scheduled task exists for this lead.

## 3. The public repository and its tests (new, Nov 19: the owner wants the tests run there)

- `the-owner/System-gaming-public` is a public, clean copy of the game: no history, the owner's name, email and old account names taken out by rule (`scripts/publish-clean.ts`, the rules in `.private/scrub-terms.tsv`, which is never published). He remade the repository once because a commit made on GitHub's site carried his email: **never create or edit a file there through GitHub's site or API, never push anything to it but the clean copy, and never push an unscrubbed tree to any public place.**
- **Run the browser tests there, not here.** In a fresh session: `add_repo` it with push access, clone it beside the main tree (`../system-gaming-public`, or set `CI_PUBLIC_DIR`), then for a commit you want to push: `sh scripts/ci-public.sh` (sends the clean copy of HEAD as one more commit, prints HEAD's tree id), start the run by hand (a push there does not start one: the GitHub tools' `actions_run_trigger`, method `run_workflow`, `ci.yml` on `main`), wait for it (about six minutes; `curl -s https://api.github.com/repos/the-owner/System-gaming-public/actions/runs?per_page=1`, or the GitHub tools' `actions_list` and `get_job_logs`), and when every `browser` job is green push with `CI_BROWSER_REMOTE=<the tree id>`: the hook then runs only the typecheck, the unit tests and the lag test here (`scripts/ci.ts`). A red job is a finding as any failed test is: read its log, name the cause, never push past it.
- The workflow (`.github/workflows/ci.yml`) runs only where the repository is public: the browser tests in six parts, on Inter (a bare runner's DejaVu Sans is wider than any phone's font and wrapped the 1280 px nav and a status dialog's button: kept as a finding for the PC pass). No unit job there: the exhaustive room model does not finish in its 60 s on two cores, and the hook runs the unit tests here always.
- The second account's repository (`m4k0t0224-code/systemgaming3`) is not used.

## 4. What is left, in order

1. **Review units 4 and 5 and the feats' words** (section 2), fix what you find, push.
2. **Go live** (section 2).
3. **Feature 1's rest**, one Opus helper from `features/notes-1-feats.md` (read its top for what is done): first the stories design section, written and handed to you before any story code. The owner: "the story modes have to be active table by me. They should [move] entirely at the GM pace and I should be able to make my own stories. This should be perfect. Architecturally sound, clean and easy to use." Count the taps at 390 px in the review. Then the story build, then units 7 and 8 (the screens; counting quests, titles with worn statuses). Not built in unit 4: a room solo run's gate fact on the player's phone. A gate cannot yet be set to drop a Resurrection Crystal.
4. **Feature 5, players deal with each other**: trading items and gold, a party stash, a private word to the GM, a secret objective. Write `features/brief-5-trade.md`: every piece is a room message by AGENTS.md's recipe; a trade is two hunters' changes that must both land or neither across two phones: design that first on paper (the GM's phone as the one that settles, as `soloTaken` and `solo-wait.ts` do for a room's solo run; or the server), the variants weighed.
5. **The PC browser pass, last** (`features/plan.md`): an audit at 1280 and 1920 px as the UI run did (`ui-pass/audit.md`), what a wide screen shows side by side, keyboard and mouse, and the wide-font finding of section 3. Write `features/brief-pc.md` then.
6. Known and left, each low: one step of `scripts/ui-shots.ts` at gm-390 times out on a tap after the monster card; path flavour lines need a field; two leads on the frame after a use (`final/notes-lag-use.md`); the lag test's fight turn reads 33 to 83 ms against a limit of 100, not profiled; four thin roleplay awards stay (their descriptions are clear); `.claude/settings.json` sets `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` at the owner's word, unverified whether it does anything; the ideas lists (`features/ideas-feats-titles-rewards.md`, `ideas-2-imaginative.md`) and the tabled stories (`features/intro-story*.md`) are his to pick from.

## 5. How to work (what this lead learned)

- One helper per unit, Opus (`heavy-writer`), a brief under `docs/agent-handoff/`, poteto mode (START-HERE says how and its one limit: a helper starts no helpers). Helpers commit by path and never push; the lead merges, runs `bun run deps -- --write`, `bun run charts`, typecheck and the whole `bun run test`, and pushes from `<scratchpad>/push-wt` through the hook in the background (no backup push: section 2).
- The CI's upgrade test starts a second server on its port + 15 (3218 + 15 = 3233): give no helper port 3233, and stop orphaned `bun server.ts` processes before a push (push 38 was refused on it). A helper's whole `bun run test` beside the CI's makes the model tests time out (push 39). A helper's browser loop that keeps only the last lines of each file can hide a failure: have it grep for `failed`.
- The lag test times frames: nothing else may run a browser while the CI's last pass runs. Tell running helpers to hold browser runs for 35 minutes before a push. A use from the map's worst frame is about 67 ms against 100; a fight turn about 33 to 50.
- Every helper runs every browser file before it reports. Five pushes were refused on a test a unit did not think it touched.
- A test that fails once is a finding. Two were the test's own race (push 34: a clock started on the browser's click though the map acts at the lift; push 35: a goto issued while the page reloaded itself): each was explained from the trace and reproduced by hand before the test changed. The four before them were real: a tap read from screen coordinates during a framing move; a field scrolled on a 250 ms timer under the finger; a tap lost after a pan because Chrome sends no click; a hold decided by which callback ran first.
- When two units merge, look for one rule written twice (a session's start was). Regenerate the dependency map and charts after every merge. The lint "every let a view keeps" lists page variables by name: a merge that adds or removes one fails it; fix the list, do not loosen it.
- Merging into the main tree while a helper has uncommitted files there works only when no file overlaps; otherwise wait for its clean point, and tell it the tree moved.
- The usage limit (five hours) stops every helper at once, about every five hours with three or four running. `SendMessage` to each resumes it from where it stopped; the hourly scheduled task reminds the lead.
- A helper that says a permission check blocked an edit outside its files did right; give that row to the unit that owns the file.

## 6. Decisions the owner may want otherwise

`for-the-owner.md`, kept by every unit. The ones he has already ruled on: no instant kill (execute is a family of scalers with suggested numbers he can type over); duplicate skill names refused; points come back with − until Confirm; rewinds are out for now; the dice cap is 100 a term; perfect over fast.

## 7. What earlier leads got wrong (read this)

A lead before the last one kept going long after its context was compacted, because a unit was always about to land; the owner caught it. Hand over at the end of a feature once your context has been compacted, or after the second compaction wherever you are: rewrite this file, update NEXT-SESSION-PROMPT.md, land the push, start the next lead with `create_session` and stop. The last lead also started a helper while the CI's lag pass was still timing frames, which cost a failed baseline: nothing else runs a browser while a push's CI runs. And a container restart loses any work not pushed: push at each feature's end, not later.

## 8. First-run clarity (Nov 17): a second branch, and a PR to merge before you go on

While the working branch's lead was stalled, a second lead ran the owner's triage of the fresh-eyes review on its own
branch, so no push could meet yours.

- **Branch `first-run-clarity`**, cut from `claude/zen-pasteur-ov4cgd` at e7e68735, pushed through the hook. **PR 37
  from it into `claude/zen-pasteur-ov4cgd` is open and not merged** (CI passed on a9deec6a: 3574 unit, 339 browser,
  6 lag). The working-branch lead merges that PR into
  `claude/zen-pasteur-ov4cgd` before starting feature 2: it changes `src/views/onboard.js`, `room.js`, `rulesref.js`,
  `hunter.js`, `quests.js`, `src/edge/room-pill.ts`, `src/core/onboarding.ts`, `hunter/vitals.ts`, `hunter/chips.ts`,
  `registry/statuses.ts`, the generated `docs/dependency-map.md` and `docs/state-machines.md`, and AGENTS.md. After the
  merge run `bun run deps -- --write` and `bun run charts`, then the whole `bun run test`.
- **What it did** (`lead-report.md` section 14, `frc/design.md`): setup ends on "Hunter created" (a player) or
  "Campaign ready" (a GM) with the role's next steps, two explicit states of the setup machine; one sentence says what
  the site is under the Welcome window and in the ? guide; a room is explained once, a GM creates one and a player
  joins one, and the Room view is the one door (the Data view's room panel is gone, the room button at the top reads
  "Join room" or "Create room"); the Rules page takes its contradicted lines from `src/core/rules-text.ts`, pinned by a
  test, and shows the GM quick card to a GM only; a hunter at 0 HP is "down" on every screen (the status key
  `unconscious` is `down`).
- **What feature 2 should know**: the life machine's states kept their names (`dying`, `stable`), so `play.ts` reads
  them as before; only the words a player reads changed (`LIFE_TAG`, `FELL_WORDS` in `vitals.ts`). A new sentence for
  a new person goes in `src/core/first-run.ts`; a Rules page line that states a rule goes in `src/core/rules-text.ts`
  with its pin in `tests/rules-text.test.ts`. A solo run's rules will want a line there.
- **Two things about the box** it found: a `bun test` used to leave a server on port 3000 (fixed in the test and in
  `server.ts`: `PORT=0` is any free port), and `tests/e2e/used.e2e.ts:220` fails under Playwright's headless shell,
  which refuses notifications; export `E2E_CHROMIUM=/opt/google/chrome/chrome` (the box's own Chrome) before a
  browser run, `bun run ci` or a push (AGENTS.md, "Set up once"). The box was rebuilt during the run: `node_modules`
  and Playwright's downloaded browsers were gone, so `bun install` again, and no `playwright install` is needed.
- **A bug it fixed outside its scope**: the Quests view's first daily check ran inside its register and threw whenever
  a rollover was due as the app opened (`quests.js`; now on the app's `ready`). `save.e2e.ts` holds it.
- Its helpers' worktrees (`/workspace/sg-frc-a`, `/workspace/sg-frc-rules`) and branches (`frc-first-run`,
  `frc-rules`) are local only and merged; nothing of theirs is on origin.

## 9. The Nov 18 lead's session: solo runs, and three bugs the push's CI found

- **Solo runs** (feature 2) were built by one Opus helper in two phases, the design notes first (`features/notes-2-solo.md`, approved with rulings in its section 15). What exists: `src/core/gates/solo.ts` (the run's one write `soloRan`, its refusals, the System's clock `soloTick`, the room's solo doc, the GM's settle `soloTaken`), `personal.ts` (a personal gate on `Hunter.solo`), `solo-wait.ts` (a player's won run of a room's gate waiting for the GM's phone), `RULES.solo`, the `rules` doc (the old `build` doc renamed, with the solo switches), the `solo` doc, the messages `soloRun` and `soloAnswer`, `src/views/odds-box.js` (the odds control, now shared by the GM's fight and a gate's card). AGENTS.md has the rows. `for-the-owner.md`, "Solo runs", lists every choice he might want otherwise, two of them questions not yet put to him (a long rest undoes a run's cost; a death alone with no GM).
- **A new player now meets "A GATE HAS APPEARED"** right after Hunter created: the System opens the first personal gate at once. The browser tests' `onboardPlayer` answers it; a test that is not about gates and seeds a save turns personal gates off in its setup (AGENTS.md, Tests).
- **Three bugs in the app, each found by a test that failed once in the hook's CI** and named from its trace before anything changed:
  - `route()` in `src/app.js` drew a view while its section was hidden, so the battle map, which frames itself from its frame's width at its first draw, stayed unframed (40 px tokens) for a player who opened Combat on a fight whose doc did not change after. The section is now shown before it is drawn.
  - The map worked out its frame's height once. A player who opened the map on a foe's turn got the height for a page without the YOUR TURN line, and when the turn came the hotbar's End turn sat 36 px under the bottom bar on a 360 px phone. The map's source now says what stands over the frame (`MapSource.over`, a player's in `table.js`), and the map works the height out again in the draw where that word changes (`overWas`, `src/views/map.js`).
  - Both had been hidden by a race in the browser tests' fight setups: the player's phone acted on the doc of the fight's start before the setup's doc arrived. `setupDoc` in `tests/e2e/helpers.ts` waits for it; `table-turn`, `phone`, `used`, `maps` and `map-extras` use it, as `battle-map` already did. Any new fight setup that places rows through the store and then taps on a player's phone must call it: this one race refused four pushes.
- **How the push runs on this box**: the lead pushes from a second worktree (`<scratchpad>/push-wt`, `bun install` once in it) with `E2E_CHROMIUM=/opt/google/chrome/chrome git push origin HEAD:refs/heads/ccr-648c5f00-3hvnn9`, in the background, so a helper's uncommitted files in the main tree do not block the hook. Nothing else runs a test or a browser while `pgrep -f "[s]cripts/ci.ts"` prints a pid. A full CI is about 30 minutes. A push that changes only `docs/agent-handoff/` skips the browser passes (the owner, Nov 18: "You fix it", asked whether a handoff doc needs the CI): about two minutes.
- **What this lead did not do**: read every document in the repo. The scheduled prompt asked for all of them in full; the set is 3.7 MB, several times one session's context. It read the governing set (START-HERE, this file, `features/`, AGENTS.md, `frc/`, copy-tasks, helper-rules, the charts of the gate, the life, the outbox, the store and the odds, poteto-mode, unslop, every principle skill, the trail's last 30 rows).


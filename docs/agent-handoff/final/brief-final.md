# Brief: the last unit (what the feel pass left, the phone test, a last look)

One helper (Opus, heavy-writer), in the main tree, on `claude/zen-pasteur-ov4cgd`. Commit after each numbered step with `git commit -m "..." -- <paths>` (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Never `git checkout`, `git stash` or `git reset` a file. Do not push. Do not start helpers. Never edit `.claude/skills`. No new dependency. Do not run `bun run ci`; your checks are `bun run typecheck`, `bun run test`, and browser files one at a time (`E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --output=/tmp/pw-final`). Never `playwright install`. Commit no image.

Read first: `AGENTS.md` (in full; follow its recipes), `docs/agent-handoff/START-HERE.md`, `docs/agent-handoff/later-phases/feel-notes.md` (the owner's words), `docs/agent-handoff/feel/notes-1-motion.md` ("Not done" lists), `docs/agent-handoff/map/notes-m6.md`, `docs/agent-handoff/rw/principles.md`, and the skills `unslop`, `principle-prove-it-works`, `principle-subtract-before-you-add`, `principle-experience-first` under `.claude/skills/`.

## Why

the owner, the GM, opens the finished site on his phone when this unit and the lead's final verify are done; he sees nothing before. His words: "I want top tier animations. I love percentages when things are loading. I don't want them to be laggy... Everything should be satisfying on UI. Nothing over the top." and "I want a fully functional site at the end of this." This unit is the last chance to find what a person on a phone would trip over. Find it by using the app as they would, fix it at its root in the one place AGENTS.md names, and leave a test that would have caught it.

## Steps

0. **First, the fight's use frame (it blocks the push).** Push 19 was refused: in `tests/e2e/feel.e2e.ts` the map case's "a use from the map" measured 116.7 ms against its 100 ms limit at 4x CPU with the box otherwise idle, and it misses about one run in five. The limit does not move and the test does not get retries. Profile it (`FEEL_PROFILE=1`, an unminified build, a CPU profile; notes-1-motion step 5 shows how), name each cost in the use's frame in the notes, and remove what is ours until the worst frame of the use is at or under 83 ms in twenty runs of twenty of the map case alone. Look first at: the scene computed more than once per command, the reducer or `mapScene` doing work per tile that could be per change (the fog, `seenBy`, `outline`, zones), a forced layout between writes, a `data-part` rewritten whole, work that can go in the frame after the tap's own (the log line, the room doc send, the save's write). Splitting one long frame into two shorter ones is a real fix only when the first shows the result of the tap. Run the whole feel file after. Commit with the before and after numbers in the notes.

1. **What the feel units left.** (a) The onboarding windows (`onboard.js`) open and leave through `enter` and `dismiss` of `motion.ts` like every other window; its tests keep passing without fixed waits. (b) The dice sheet opens and closes through the same moves. (c) The app update shows a true percentage: `sw.js` posts files-cached of files-to-cache to the page as it installs, and the pill or the update line shows it with `progress`; if the worker cannot know the count, leave the pulse and say why in the notes. (d) The quests' and storage meter's bars use `fillTo`; the player's HUD chips pop when one arrives. (e) On the Dice view the detail line appears when the total lands, not before. Not in scope: a room catch-up as n of m (a wire change), export progress (no fraction exists). Run `tests/e2e/feel.e2e.ts`, `room-onboarding`, `pwa`, `upgrade` and whichever files you touched. Commit.

2. **The phone test, as durable tests.** A new `tests/e2e/phone.e2e.ts` (copy `room-sync.e2e.ts`; helpers from `helpers.ts`), with an iPhone profile and an Android profile for the players and a desktop GM, touch input. Cover, each as a test named for what the person sees: the GM opens a room and a phone joins by the invite link and by typing the code; the player makes a hunter and the GM sees the sheet; a fight on a saved map with a wall and a zone: the player moves their token on the map, uses an ability from the hotbar, ends their turn, a status with rounds lands and is paid, the fog hides a monster behind the wall on the player's phone and shows it once seen; a natural 20 outside a fight calls the coin and the GM rules it; the player's page is hidden, goes offline (`context.setOffline`), comes back and holds the same fight as the GM; a reload in the middle of a fight; a reward given by the GM arrives; landscape (a phone turned) shows the map and the hotbar usable. Then a sweep test over every view at 360 by 640 and 390 by 844, for a player and for a GM, in and out of a fight: no horizontal scroll, no tap target under 44 px among visible buttons and fields (extend what `look.e2e.ts` already checks; do not duplicate it), no text under 12 px, a focused field of each maker not covered by the bottom bar. Fix every failure at its root. Where a flow already has a test, name it in the notes instead of writing another. Commit per fix, then the test file.

3. **A last look with your own eyes.** `bun scripts/ui-shots.ts --serve 3241 --out /tmp/shots-final` and look at every shot at 390 and 360 as a first-time player would: anything cramped, cut off, misaligned, unlabeled, a number without its unit, a window with two filled buttons, an empty state with no next step, a word that is jargon ("doc", "row", "eid", "op") shown to a person. Also play one whole fight by hand in a throwaway script against the map at 4x CPU throttle and watch for a jump, a flash of unstyled content or a move that does not finish. Fix what you find (wording that is a judgment call goes in `copy-tasks.md` done or left, with the choice you made). Commit by screen.

4. **The other frames.** With step 0 done, run the feel file five times and write each case's worst frame in the notes; anything within a fifth of its limit gets the same treatment as step 0. Commit.

5. **Close.** `bun run deps -- --write`, `bun run charts`, `bun run typecheck`, the whole `bun run test`, then every browser file one at a time and `feel.e2e.ts` last alone. AGENTS.md rows for anything new. Write `docs/agent-handoff/final/notes-final.md`: what was tested on which profile, what broke, what you fixed (with the commit), what cannot be verified without a real device (real touch latency, iOS Safari's own bars and keyboard, install to home screen, notifications). Commit.

## Rules

- A fix goes in the one place the table in AGENTS.md names; a second writer of any state is a bug. A view computes no fight number and writes no time or keyframe (the lint tests hold these).
- No retries, no fixed waits in tests. A test that fails once in several runs is a finding: find the race.
- Words on screen are plain, short, whole. No long dashes.
- If a finding needs a design decision the owner would notice, take the conservative choice, do it, and add a line to `docs/agent-handoff/for-the-owner.md` with what he would say to reverse it.
- Notes file as you go, so a restart loses minutes.

## Done means

Steps 0 to 5 committed, the tree clean, typecheck and `bun run test` pass, every browser file passes alone, `phone.e2e.ts` exists and passes three runs in a row.

## Time

Three hours. Reply in at most 250 words: the commit range, the last lines of each check, what broke and was fixed, what is left.

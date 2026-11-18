# Brief: the wording pass

One helper (Opus, heavy-writer) in the main tree, on `claude/zen-pasteur-ov4cgd` at the commit the lead names. Nobody else writes this tree while you work. The general brief is `final/brief-implicit-unit.md`: read it first and follow it (poteto mode, a commit by path after each step with a plain message and no attribution line, no push, no helpers, never `git checkout`, `stash` or `reset` a file, never edit `.claude/skills`, no new dependency). Read `.claude/skills/unslop` and `.claude/skills/technical-writing` in full before you write a word. Where they differ from this file, this file wins.

## The goal, in the owner's words

"I want a fully functional site at the end of this." "I want it perfect, I do not care about time." "Everything must be explicit. Everything." Every unit so far left its words as placeholders marked `TODO(copy)` (about 200 marks in `src` and `public`) and listed them in `docs/agent-handoff/copy-tasks.md`. The problem: a player or GM at the table reads words written by twenty hands, some of them placeholders ("[removed: N XP]"), with two names for one thing. The smallest change that meets the goal: every sentence the app shows is read once, by one writer, against one sheet of names and one voice, and the marks are gone. This is a pass over words, never over behaviour: no control moves, no rule changes, no markup changes beyond the text.

## The voice

- A person at a table reads this on a phone in the middle of a game. The fact first, in the fewest plain words; then what to do, if there is something to do. Numbers exact ("Respec costs 200 gold. You have 150.").
- One name for one thing, everywhere: a button's label is the word the help line, the toast and the confirm use for it.
- The System's voice (the `! TAG` windows, "ARISE", "REWARD RECEIVED") lives in a window's tag and title only. A body, an error, a refusal, a label and a hint are plain.
- A refusal says why and, where there is one, the way out. It blames nobody and does not say "please" or "sorry". An error is not shouted.
- Sentence case. No exclamation mark outside a System tag. No em dash, no semicolon chains, no "(s)" plural (write both forms), no "successfully", no "simply", no "just".
- A label fits its control at 360 px: check the width where the task list gives one (the room pill is 96 px; short_name at most 12 characters).
- Calm where something went wrong with the connection: the player must come away knowing nothing is lost, when that is true. Never say it when it is not.
- British or American: American, as the app is now ("color").

## Steps, a commit after each

1. **The sheet of names.** Read every screen's words once (run `bun scripts/ui-shots.ts --serve 3241 --out <your scratch dir>/shots` and read the shots, and grep the views). Write `final/notes-wording.md`: the glossary (for each thing, the one word: fight or encounter, defeated or down, MP or mana, room or campaign room, the header's room control, hunter or character, bag or inventory, status or condition, skill or ability as a player meets them, GM, the Workshop's kinds), each with the count of each variant in `src` today and the one you pick, with one line of why. Pick the word most of the app already uses unless it misleads. Rename no identifier, id, key, CSS class or test id: words only.
2. **The inventory.** Every `TODO(copy)` in `src` and `public` and every row of `copy-tasks.md` in one table in the notes: still there, stale (the thing is gone: say what replaced it), or already final. `copy-tasks.md` is older than the code; the code wins.
3. **File by file**, views first (combat.js, gm.js, custom.js, map.js, table.js, skills.js, onboard.js, maker.js, then the rest), then the edge, then core's sentence functions (`describeStatus`, `rewardLines`, `grantLines`, `REFUSAL_WORDS`, `coinWords`, `tapWords`, the fight's log lines). For each mark: read the words where they show (the shot or the code path), write the final words by the voice and the glossary, delete the mark. Words that are already right stay, and the mark still goes. A sentence a view builds that belongs in core (AGENTS.md: "A sentence goes in core, never in the view") is noted, not moved, unless a lint already asks for it. One commit a file, with the tests that assert on its words changed in the same commit. A test changed here changes only the words it looks for.
4. **What the marks did not cover**: the rows of `copy-tasks.md` not marked in code (the manifest's name and description, the label sets reviewed "as a set", the session log's date written month first whatever the phone's language, the title and text of a use's log row run together, "Awarded to 0 local hunters", the Workshop's "+ New status" beside "New item"). Fix each that is words. One that needs a control or a field (path flavour lines, row 9) goes in the notes as left, with what it needs. The date is a format, not a word: `toLocaleString` with the phone's own locale is the fix if a literal locale is passed today; say what you found.
5. **The class.** After the pass `grep -rn "TODO(copy)" src public server.ts` prints nothing, and a lint in `tests/lint.test.ts` holds it ("no placeholder words are left marked", its first case a line with the mark). Rewrite `copy-tasks.md` to a short file: the voice above, the glossary, and how a new sentence is checked. AGENTS.md's mention of `copy-tasks.md` in the link recipe stays true.
6. **Close**: `bun run deps -- --write`, `bun run charts`, `bun run typecheck`, the whole `bun run test`, then every browser file one at a time except `tests/e2e/feel.e2e.ts` on `E2E_PORT=3260` (the loop in `final/brief-close-audit.md`, keeping every `failed` or `flaky` line). `for-the-owner.md`: one short section, "Words", listing the names picked where the app had two and the handful of sentences he is most likely to want otherwise (the room control's name, the path names if you touched them), each with what he would say to reverse it. A line `UNIT wording DONE at <commit>` at the top of the notes. Leave no `bun server.ts` running.

## Rules that have cost a push before

- A test that fails once is a finding about the app until shown otherwise. A test that fails because it looks for the old words is changed to the new words in the same commit and nothing else in it changes. Any other failure: name its cause from evidence before changing anything. Never retry, lengthen a wait or loosen a bound.
- Many browser tests find a control by its words (`getByRole('button', { name: ... })`, `hasText`). Before you change a label, grep `tests/` and `scripts/ui-shots.ts` for it.
- Words the room sends between phones of two builds do not exist: the build handshake holds every phone to one build.
- When the lead says the CI is timing frames, run no browser and no whole `bun run test` until the time it gives.
- The lint "every let a view keeps" and the other lints are not loosened.

## Final reply (at most 200 words)

The commit range; marks removed of marks found; the glossary's picks in one line; each check's last line; what is left and why; the five sentences you were least sure of, old and new.

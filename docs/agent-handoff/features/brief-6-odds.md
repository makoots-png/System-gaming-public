# Brief: feature 6, how hard is this fight (the odds engine)

One helper (Opus, heavy-writer) in the main tree, on `claude/zen-pasteur-ov4cgd` at the commit the lead names, alone in the tree. Read `features/plan.md` (the owner's rulings), `AGENTS.md`, `START-HERE.md`, `final/brief-implicit-unit.md` (the general rules: poteto mode, the cause or the design written before code, a test that fails without the change, a commit by path after each step with a plain message and no attribution line, no push, no helpers, never `git checkout`, `stash` or `reset` a file, never edit `.claude/skills`, no new dependency), `rw/design.md` section 6, and `tests/models/fight-sim.ts` with `tests/models/fight-play.ts`.

## The goal, in the owner's words

"I want it perfect, I do not care about time." "Everything must be explicit. Everything." "Architecture first." And of feel: "I love percentages when things are loading. I don't want them to be laggy."

The problem: a GM building a fight cannot tell how hard it is. An ability is weighed against a budget (`worth.ts`), an encounter is weighed against nothing, so the first sign a fight is a wipe is the wipe. The same question, asked of one hunter and one gate, is what a solo run (feature 2, next) resolves from. The smallest thing that meets the goal: one pure engine that plays a fight as it stands many times on the real reducer and answers its odds, and one place the GM reads them.

## What the engine is

- A module in `src/core/combat/` (name it; `odds.ts` is the working name). Pure: no clock, no storage, no `Math.random`. It takes a fight in setup or running (`Fight`), the rules, a seed and a count, and plays it to its end that many times with `reduce`, each run with its own seeded dice. Nothing in it works out a rule: a use is the reducer's, as in `tests/models/fight-sim.ts`, whose `playFight` is the model to lift from.
- **Who decides for a row is a policy**, a pure function from the fight and the row to a command, written as a sensible player plays (the test file's words: "not as an optimizer"). The tests' policies are one per archetype of made-up builds. The engine needs one that plays any row from what the row holds: its real abilities, their kinds, costs, cooldowns, reach, gates and prices, a heal when an ally is low, a monster by its intent's own rule (`suggested`, threat). Weigh on paper in the notes: one general policy; a policy per ability kind composed; the test's archetype policies kept and a general one beside them. One rule for a monster's choice already exists for the GM's card (`intentOf`, `threatOf`, the suggested target): the policy reads it and does not copy it.
- **What it answers** is a type, named before code: at least the share of runs the party side wins, and for each party row the spread of what it comes out with (HP, mana, fatigue, down, dead: enough for feature 2 to pay a cost from one sampled run, and for the GM to read "who drops"), the rounds it took, and how many runs it is from (so a reader knows how firm it is). Say in the notes what feature 2 will need from it and show the type holds it: a solo run is this engine on one hunter and a gate's monsters, one run drawn by a seed.
- **It must not freeze a phone.** Measure first: how long one played fight takes on the reducer at 4x CPU throttle for a small fight (2 hunters, 3 monsters) and a large one (5 hunters, 8 monsters with kits). Then pick the count and how the work is cut: the engine runs in steps the caller drives (so many fights a step, a step under a frame's budget), answering its progress as a real count, so the view can draw "37 of 200" as it goes. No worker thread unless the measurements say a step cannot fit a frame, and then say why. A played fight that does not end (a stalemate) ends at a time cap and counts as its own outcome, not as a win or a loss.
- The seed comes from the edge (`src/edge/roll.ts` owns every draw; core never draws). The same fight, rules, seed and count answer the same odds: a test holds that.
- **The tests' simulator then stands on the engine, not beside it.** `tests/models/fight-sim.ts` keeps its builds and its bounds and calls the core's play loop, so there is one loop that plays a fight (subtract before you add). `tests/fight-sim.test.ts` must hold its numbers as they are: if a number moves, the lift changed behaviour, and that is a finding.

## Where the GM reads it

- In the GM's fight screen while the fight is being built (Add to the fight, before Start) and from the Fight tools while it runs ("from here"): a control that says what it does, runs the engine with its count shown as it goes, and then one line a GM can act on, with a detail under it (AGENTS.md, "More info on a thing"): the chance the party wins, who is most likely to go down, about how many rounds. The sentence is core's (`detail.ts` or beside the engine), never the view's. Words by `copy-tasks.md`'s voice and glossary (fight, defeated, down).
- It never runs by itself on every change of the form (a GM adding rows must not pay for it); it runs when asked, and a result is marked stale when the fight it was worked out from has changed.
- It changes nothing: no save write, no room message, nothing a player sees. A lint or a type holds that the engine cannot write (it returns numbers only).
- 390 and 360 px: the control and its line fit, a look test says so (`tests/e2e/look.e2e.ts`), and the lag test still passes: add a case to `tests/e2e/feel.e2e.ts` that the screen keeps its frames while the engine runs.

## Steps, a commit after each

1. Notes first, `features/notes-6-odds.md`: the measurements, the answer's type, the policy variants weighed and the one picked, how the work is cut, what feature 2 needs. No code before this is written.
2. The engine and its policy, with `tests/odds.test.ts`: the same inputs answer the same odds; a fight the party cannot lose reads near 1 and one it cannot win near 0; a stalemate is its own outcome; the policy never sends a command the reducer refuses (a random walk over fights with kits, as `tests/fight-model.test.ts` plays them).
3. The tests' simulator moved onto the engine's loop; `tests/fight-sim.test.ts` unchanged and passing.
4. The GM's control, its line and detail, the stale mark, the progress count; the browser tests.
5. Close: `bun run deps -- --write`, `bun run charts` (a machine if you made one: a run of the engine has states: idle, running with its count, done, stale), `bun run typecheck`, the whole `bun run test`, every browser file one at a time except `tests/e2e/feel.e2e.ts` on `E2E_PORT=3260` (the loop in `final/brief-close-audit.md`), then `feel.e2e.ts` alone on port 3218 three times with every `[feel]` line kept. AGENTS.md's rows and a recipe ("A policy's new choice"), `for-the-owner.md` (what he sees and what to say to change it), `UNIT 6-odds DONE at <commit>` at the top of the notes. Leave no `bun server.ts` running.

Environment: `E2E_CHROMIUM=/opt/pw-browsers/chromium` for every Playwright run; never `playwright install`; never port 3233. A test that fails once is a finding: name its cause from evidence; never retry, lengthen a wait, loosen a bound or a lint, or change a test to pass. Budget is tight: commit each step whole; if you must stop early, say at the top of the notes exactly what is done and what is left, with the typecheck and `bun run test` passing at your last commit.

## Final reply (at most 200 words)

The commit range; the measurements in one line; the policy picked and the answer's type in one line each; each check's last line and the three lag runs; what a GM now sees; what is left and why.

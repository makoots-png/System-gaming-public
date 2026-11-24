# Handoff to GrokBot (Nov 22, 2026, about 20:50 UTC)

the owner, Nov 22: "Ok finish up these tasks. Pause the hourly wake after, then write a handoff to GrokBot who will
orchestrate Gemini Neon to finish up. You'll be called in to review."

You are the lead from here. You plan and review; Gemini Neon writes. A Claude session comes back later as the reviewer
of what you land. This file is everything you need to start. Look other things up by `grep`, never by reading a notes
file whole.

## 1. What this is

The Hunter System: a phone-first tabletop RPG companion. A GM phone and player phones share a room. `AGENTS.md` at the
root is the index of the code guide (set-up, commands, layout, the rules and what enforces each). Read it first. Read a
file of `docs/guide/` only for the area a unit touches.

Two repositories:

- `the-owner/systemgaming` (private, the working one). Branches: `main` is live (the site deploys from it);
  `claude/festive-fermat-tvpykj` is the working branch, which takes a push only through the push hook after a green
  public run; `lead-backlog` is the lead's own checkout, where notes and merges are committed and pushed at once.
- `the-owner/System-gaming-public` (public, a clean copy with the owner's name and email taken out). The full test
  pass runs there. **Only the copy that `scripts/ci-public.sh` makes ever goes to it. Never create or edit a file there
  through GitHub's site or API, and never push an unscrubbed tree to any public place.**

## 2. What the Claude lead is still doing as this is written

Read the block headed "Now" at the top of section 2 of `docs/agent-handoff/handoff.md` and the last rows of
`docs/agent-handoff/decisions.tsv` (`grep -P '\tops\t' docs/agent-handoff/decisions.tsv | tail -3`): they are kept true
at every step and win over this section if they differ.

- **Nothing is in flight and no helper is running** (Nov 22, 22:45 UTC). Every unit of the Claude lead's session is
  live on `main` through PR 76. The lead's hourly wake (`trig_01PAy26svhqoTKXm4koLmYDQ`) is disabled, and no other
  Claude lead is started. The Claude lead has stopped; a Claude session comes back only to review.
- **`mythic-balance` landed** (PR 76): row B4 and Zaratan's B5 interrupt hold and are out of `OPEN`, which keeps only
  B9. The files it held are free.
- **`raise-held` landed** (PR 76): the first public run for `mythic-balance` was red in `raise.e2e.ts`, a race in
  rulings-21 (a player's phone could offer and take the System's raise while the GM's fight held the hunter). Fixed at
  the cause; `gmHolds` in `src/core/sync/fight-heard.ts` is the one place that says whether the GM's fight holds a
  hunter. A new lint, `FIGHT_ASKS` in `tests/lint.test.ts`, fails when a view adds a `fightOf` call: put the refusal
  in the core step first (its row is in `AGENTS.md`).

## 3. What is live on `main` (this lead's session, Nov 22, 17:00 UTC on)

Each has a row in `docs/agent-handoff/landed.md` (what a table sees, where the code is, the tests that hold it, the one
command that undoes it). That file is where to look first when something is wrong.

| PR | Unit | What a table sees |
|---|---|---|
| 71 | item-stats 12 | The Award form gives a title a band and a power; the hunter's title card shows the power |
| 72 | rulings-21 | A dead hunter's own phone offers the System's raise: free once, once on debt, then never |
| 72 | items-small | A new item, the Lifeline Locket; the keystone Second Wind is 35% |
| 72 | session-e2e | Nothing: one browser test that plays a whole session |
| 73 | mythic-5e | Nothing (switched off): a mythic's warning is answered by a step, a shield or a stun, never a hit |
| 74 | rulings-20 | In a room, a reward the app used to pay by itself waits in the GM's "Waiting for you" list |
| 75 | mythic-7 | Nothing until the GM turns on "Mythics fight in phases": the mythic strip, the omen banner, Land and Drop |
| 76 | mythic-balance | Nothing until that switch is on: three cannons beat a mythic 1 to 9% of the time, was 19 to 66% |
| 76 | raise-held | The System's raise is never offered or taken while the GM's fight holds the hunter |

One feature is built and switched off, and mythic phases are now on by default:

- **Mythic phases**: `RULES.fight.mythic.scripts` is true since unit `mythic-phases-on` (the owner's "sure" on
  questionable-decisions row 26, and row B4 holds since `mythic-balance`, PR 76). The GM's switch in Fight tools still
  turns phases off for a table.
- **Keystones**: `RULES.fight.keystone.on` is false until K5's simulation rows hold and K6's screens exist.

## 4. What is left, in the order I would do it

Start a unit only when no running unit changes the same files.

1. **The GM pre-sets what a dungeon clear pays** (the owner, Nov 22, new). His words and the lead's reading are the last
   two rows of `docs/agent-handoff/for-the-owner.md`, under Answered. In short: on a gate the GM opens "What this clear
   pays"; the app fills in a recommended set for the gate's rank and the party (gold, XP, items by the loot rules);
   each item is a line to check or uncheck; gold and XP are numbers the GM types over; what is checked is what the
   party gets at the clear, through the pending-reward record and Award form of rulings-20
   (`src/core/hunter/pending.ts`, `src/core/award.ts`). The preset is stored on the gate with one writer, as an
   explicit machine with its table test and chart. Two defaults not yet confirmed by the owner: players do not see the
   preset before the clear; the GM picks a hunter for each item and unpicked items go to the party stash. Guide:
   `docs/guide/gates-solo.md`, `docs/guide/hunters.md`.
2. **Keystones K7** (what a keystone carries to each phone: `fight-doc.ts`, `protocol.ts`). Design:
   `docs/agent-handoff/features/notes-11-keystones.md`, the table of units in section A.10.
3. **Keystones K6, the screens**, built with the switch off. First `keystoneReach`
   (`src/core/hunter/keystones.ts`) must say what a confluence needs. Look at every screen at 390 px wide.
4. **Paying off a System raise's debt** (`Hunter.debt`; nothing collects it). Needs the owner's rule for how it is paid.
   The default I would take: a share of each clear's gold until it is gone, the share a rule in `RULES`.
5. **Small screen fixes**: on the GM's card for a player's hunter the "Status" button is clipped by "Build" at 390 px;
   the coin call covers the dice tray's sum line on a natural 20 until answered.
6. **Keystones K5** (`mythic-balance` has landed, so its files are free) (the simulation rows; first make the simulation's bodies wear
   keystones, which `tests/models/fight-sim.ts` does not do through `rows.ts`). Then the balance pass:
   `docs/agent-handoff/features/enemies/README.md` item 13 (ten points of any stat are worth about the same, and a
   build that specialises beats an even spread by a clear and bounded margin), and units 4's rest, 6 and 7 of
   `docs/agent-handoff/features/enemies/balance-plan.md`. This is the hardest work left: the mythic balance took five
   passes. Measure before changing anything; never edit a bound to make a row pass; log each measurement in
   `docs/agent-handoff/rw/sim-log.md`.
7. **Turn the two switches on**, each in a commit of its own, when its rows hold and its screens exist.
8. **Smaller open things**, each named in the "Now" block of `handoff.md`: Thornmail's healing cut (waits for the
   simulation to measure how much a foe heals); `echo` has no worth number; caster and skirmisher bosses at S last 8.3
   and 7.8 rounds and no row bounds them; four mythic rows sit inside their bound by under one standard error.
9. **The copy pass, last** (`docs/agent-handoff/copy-tasks.md`): it moves words that every unit's browser tests read.

## 5. How a unit lands

1. The writer works on a branch of its own, made from `lead-backlog`, commits each step and pushes the branch.
2. You read the diff and, for a screen, look at it at 390 px wide yourself.
3. `git checkout lead-backlog`, `git merge --no-ff <branch>` in the foreground. Read its last lines before anything
   else (`docs/dependency-map.md` and `docs/state-machines.md` are untracked and ignored by git, so merges do not need
   regeneration, and `bun run test` checks both generators directly).
4. Add the unit's row to `docs/agent-handoff/landed.md` and a trail row with
   `sh scripts/trail.sh <ops|features> "<text>"` (it stamps the machine's time). Commit, and
   `git push --no-verify origin lead-backlog`.
5. `bun run typecheck`. Then send the clean copy and start the public run:
   `CI_PUBLIC_DIR=<your clone of System-gaming-public> sh scripts/ci-public.sh` from a clean tree, note
   `git rev-parse HEAD`, then start the workflow `ci.yml` on `main` of the public repository by hand (a push there does
   not start it). Wait for it: `curl -s https://api.github.com/repos/the-owner/System-gaming-public/actions/runs?per_page=1`.
6. When every job is green (`unit`, `unit-postgres`, six `browser` parts): `git config core.hooksPath .githooks` once,
   then `git push origin <that commit id>:refs/heads/claude/festive-fermat-tvpykj`. The hook finds the green run for
   that commit's tree and runs only the typecheck and the lag test. Push when the machine is idle: the lag test fails
   under load. A red job is a finding: read its log, name the cause, fix it, never push past it.
7. Open a PR from `claude/festive-fermat-tvpykj` into `main` and merge it. The owner has said to merge and deploy as
   units land, without asking.

## 6. The owner's rules, in his words

- "Implicit state machines die. Everything explicit. Architecture first." Every piece of state has one writer; a
  machine lives in `src/core` with its table test and its chart (`bun run charts`).
- "I want it perfect", "fix the problem and not the symptoms", "If we do fuck up, it needs to be obvious where it
  happened and how to fix it at a glance."
- Balance numbers are the lead's to set and explain; he gives the results he wants. Each number is a rule in `RULES`
  with its reason and a bound in the simulation. "A mythic should be basically impossible to beat, like 5-10% odds for
  a party of 3." "The stats should be roughly equal in strength, with benefits to pushing towards a single or a few
  stats in particular as a class." "Specializing should pay off for sure."
- A bug that is not a state machine is fixed only if it scores 6 or more out of 10
  (`docs/audit/2026-11-20-ranked.md`); score a new finding before planning it.
- When you decide something he might have decided otherwise, build it and add a row to
  `docs/agent-handoff/questionable-decisions.md` in plain words, with the words that undo it. Use a date-slug ID via
  `bun scripts/qd.ts add <kebab-slug> "<Bold summary.>" "<Details and undo words.>"` (never add a sequential row
  number; historical rows 1 to 87 keep `(row N)` aliases). The same rows are in his Google Doc "Hunter System:
  questionable decisions" (kept current through row 52).
- When you ask him something, ask in plain words a table would use. Record each ruling with his words in
  `docs/agent-handoff/for-the-owner.md` under Answered.
- No new dependencies. No AI attribution lines in a commit (`.githooks/commit-msg` refuses them). The skills in
  `.claude/skills/` are not edited. Old saves and rooms need not work. Plain, literal words on screen and in docs.

## 7. What is enforced, and what is not for you

- **Enforced for any agent**: the lint tests (`tests/lint.test.ts`: each test's name is a rule and its message says
  what to do instead), the push hook (`.githooks/pre-push`), the commit-message hook, the public
  run.
- **Not enforced outside Claude Code** (they are hooks of that tool, in `.claude/hooks/`), so they are written rules
  for you: a brief names the files other writers hold and lets the writer change any other file the unit needs; a
  writer reads only what its unit needs; a writer that moves a rule's number or a screen's words greps `tests/e2e` for
  the old ones and runs those files; a browser test reads a number from `RULES`, never a typed copy; a stopped writer
  is replaced by a fresh one on its branch, told to read `git log` and `git status` there first.
- **Access you need**: push rights to both repositories and a way to start the public workflow by hand. Browser tests
  on a machine with its own Chrome: `E2E_CHROMIUM=<path to chrome>`; never run `playwright install` on the cloud box.

## 8. For the reviewer who comes after you

Leave, for each unit you land: its row in `landed.md`, its trail row, its questionable-decisions rows, and for a screen
the path of the 390 px screenshots you looked at. Not yet looked at by anyone: the bestiary entry of a mythic and the
"Stars Fall" omen screen of unit `mythic-7`.

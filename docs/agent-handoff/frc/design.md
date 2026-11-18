# First-run clarity: the design (Nov 17)

Branch `first-run-clarity`, cut from `claude/zen-pasteur-ov4cgd` at e7e68735. The source is the owner's triage of the
fresh-eyes review (`../fresh-eyes/fable-response.md`, `../fresh-eyes/docs-comparison.md`). Four items, two units.

## What a new person meets today

- The Welcome window says "[SYSTEM] You have been chosen as a Player. Accept?" and nothing says what the site is.
- Setup ends without a word: Begin closes the window on the Status view. A GM gets "Open a room?" with one line.
- A room is never explained. Three doors lead to it: the room button at the top ("Join" for a player, "Room" for a GM),
  the Room tab, and the Data view's "Campaign Room" panel. The verb changes by place: open, create, run.
- The Rules page contradicts the game in four places and opens with the GM quick card for everyone.

## The decisions

1. **One concept, one sentence, in core.** `src/core/first-run.ts` holds what the site is (`ABOUT`), what a room is
   (`ROOM_IS`), each role's path to one (`ROOM_PATH`) and the next steps after setup (`nextSteps`). The Welcome window,
   the step after setup, the Room view and the ? guide all read them, so the words cannot drift apart.
2. **One verb per role.** A GM creates a room and invites players. A player joins a room. "Open a room" and "Run a room"
   go; "Open ABC234 as GM" stays, since it reopens a room that exists.
3. **One door.** The Room view is the one place a room is created, joined and shared. The room button at the top leads
   there and says what this phone would do there: "Join room" for a player, "Create room" for a GM, the room's code once
   in one. The Data view's room panel goes: it only linked to the Room view. The Room tab stays in the list of views
   (it is the page itself; on a phone it sits under More). Taking it out of the list would need a new kind of view that
   routes but is not listed, and the phone sweep reads its views from the list; left for the owner to rule on
   (`for-the-owner.md`).
4. **A real first step after setup, as two explicit states.** `hunterCreated` (a player) and `campaignReady` (a GM)
   replace the silent end and the old `room` step in the setup machine. Each shows a confirmation and the role's next
   steps from `nextSteps`: a player spends points, picks a path, joins the GM's room; a GM creates a room and invites
   players. A step already done (the player joined with a code during setup) shows as done. Skip still ends setup at
   once.
5. **The site in one sentence, under the Welcome window.** The window keeps the System's voice; the sentence sits
   below it on the backdrop in plain words. The ? guide opens with the same sentence, then this role's next steps and
   this role's tips only.
6. **0 HP is "down".** The glossary already says so and the fight already does. "Unconscious" and "Dying" leave every
   screen: the chip, the death panel, the toast, the Rules page. A hunter who is down makes death saves; three
   successes make it stable (the chip reads "Down, stable": still at 0 HP, no more saves), three failures dead. The status key becomes `down`. The life
   machine's states keep their names (`dying` is "down and rolling saves"; the odds engine's `play.ts` reads it).
7. **The Rules page reads the rule it states.** `src/core/rules-text.ts` works out the contradicted lines from the
   game's own functions (`statBonus` shared with `checksOf`, `checkResult`, the coin's `VERDICT_WORDS`, the life
   machine's numbers), and `tests/rules-text.test.ts` pins each against the function that plays it. The GM quick card
   is drawn for a GM only; a player's page opens with "How checks work".

## The units

| Unit | Helper | Brief | Tree |
|---|---|---|---|
| A: first run and the room (items 1 to 3) | heavy-writer | `brief-a-first-run.md` | `/workspace/sg-frc` |
| B: the Rules page and the 0 HP term (item 4) | writer | `brief-b-rules.md` | `/workspace/sg-frc-rules`, branch `frc-rules` |

Files do not overlap except the generated `docs/dependency-map.md`, which the lead regenerates at the merge.

## Overlap with the stalled lead's work

Feature 2 (solo runs) is next there and has not started. This run stays out of `src/core/combat/`, `gates/`, the odds
engine and the store. The one shared name is the life state `dying`, which is not renamed.

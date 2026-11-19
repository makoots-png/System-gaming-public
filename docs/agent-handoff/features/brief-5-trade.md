# Brief: players deal with each other (feature 5), the design first

the owner picked this feature on Nov 16 (`features/plan.md`): "Trading items and gold, a party stash, a private word to
the GM, a secret objective." His standing words: "I want it perfect, I do not care about time", "Everything must be
explicit. Everything.", "Architecture first."

His goal: players at one table do things with each other and with the GM through their phones: hand over an item or
gold, share a stash, say something to the GM that the others do not see, and hold an objective the others do not know.
The problem: today every room message runs between one player's phone and the GM's. Nothing passes between two
players, and nothing a player sends is private from the table. The smallest change that meets it is what your design
must find.

## This phase: design notes only

Write `docs/agent-handoff/features/notes-5-trade.md` and nothing else. No code, no test, no test run, no browser, no
server (other helpers are building and testing in this box). Commit the notes by path when a section is whole and once
at the end. Never push. No attribution lines in a commit message. Then stop and reply; the lead reviews the design
before any code.

Read first, in full: `.claude/skills/poteto-mode/SKILL.md` (you start no helpers; where it calls for `architect` or
`arena`, weigh the variants yourself on paper, three where the choice is real), `docs/agent-handoff/START-HERE.md`
(the owner's standing rules, "Everything explicit", "The problem, not the symptom"), `AGENTS.md` (the rows for a room
message, the outbox, what a player's phone does with a message, the room server, a solo run waiting for the GM, a
hunter's bag and gold, a quest; the recipes "A room message", "A write to the save from a view", "A rule that differs
by where the phone sits"; "Machines and their charts"), `features/plan.md`, `features/notes-2-solo.md` (how a player's
won run of a room's gate is settled by the GM's phone: the nearest thing built), `features/notes-1-stories.md`
sections 1 to 4 and 11 (the shape to copy, and how a GM-only thing stays off players' phones),
`docs/agent-handoff/copy-tasks.md` (Plain first), the skills `statechart`, `principle-model-the-domain`,
`principle-foundational-thinking`, `principle-make-operations-idempotent`,
`principle-separate-before-serializing-shared-state`, `principle-boundary-discipline`, `principle-experience-first`.
Then the code: `src/core/protocol.ts`, `src/core/room-server.ts`, `server.ts`, `src/core/sync/outbox.ts`,
`src/core/applied.ts`, `src/edge/room-events.ts`, `src/edge/sync.ts` (read only), `src/core/gates/solo.ts` and
`solo-wait.ts`, `src/core/hunter/inventory.ts`, `src/core/hunter/quests.ts` and `quest-rights.ts`,
`tests/models/room-world.ts` (what the room as a whole must always do).

## What the notes must answer

1. **A trade is two hunters' changes on two phones that must both land or neither.** This is the heart of the
   feature: design it first. Name what can go wrong (a phone offline, a reload between two parts, the same offer
   accepted twice, an item used or sold after it was offered, a player removed from the room, the room gone) and weigh
   at least three ways to settle a trade: the GM's phone as the one that settles (as `soloTaken` does, with what
   happens while the GM's phone is away), the server as the one that settles (what the server would have to know: today
   it stores sheets and keeps no room state of its own, and a lint holds that), and the two phones alone with an escrow
   (the giver's item leaves its bag into a held state before the taker gains it). For the one chosen: the machine of an
   offer, drawn before its table (offered, accepted, settled, refused, withdrawn, expired or however you cut it), who
   may send each event, what each writes in one write, and the proof that an item or gold is never doubled and never
   lost over every interleaving (which cases the room model, `tests/models/room-world.ts`, must gain).
2. **Who may see and stop a trade.** Does the GM see every trade, approve it, or only read a log line? A GM switch for
   the table (trading on or off, as the feats switch travels in the `rules` doc). What an equipped item, a quest item
   or an item that revives may do. Gold with a bound.
3. **The party stash.** Whose save holds it (weigh: a doc the GM's phone owns and publishes, as the world doc; the
   server; one hunter), who may put in and take out, what happens when two players take the last potion at once, what
   a player sees while the GM's phone is away, and whether it is a trade with the stash as the other side (one machine
   for both if it fits without bending).
4. **A private word to the GM.** A message only the GM's phone lands, by the recipe "A room message": its bound, where
   the GM reads it and answers, what the player sees of it later, and what "private" means given that the server holds
   the room's events (say plainly what is and is not hidden, and from whom).
5. **A secret objective.** What it is against what exists: a quest only one hunter and the GM see, issued by the GM
   (the quest offer goes to one hunter today: what is missing for it to be secret is what you must find), its reward,
   how it ends, and what the others ever learn. Whether it is a quest with one more field or a thing of its own.
6. **The players' use at 360 and 390 px, counted in taps**: offer an item to another hunter, accept it, put an item in
   the stash, take one out, send the GM a private word. Where each lives on a player's phone and on the GM's.
7. **Words**: every label, hint, window and refusal, plain and literal. List them.
8. **The cut into units**, each whole with its tests and the app working after each, the order chosen so the hardest
   proof (the trade's settle) lands first; the AGENTS.md rows; the charts; what goes in `for-the-owner.md`; questions
   only the owner can answer, each with the default you take meanwhile.
9. **A decision trail** and the principles you read with the choice each changed.

Reply with: the notes' commit, the design in ten lines, the tap counts, the choices you think are contested, and the
questions for the owner with your defaults.

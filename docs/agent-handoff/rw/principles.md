# The principle skills in the rework: where each one bites

the owner, Nov 13, in the rework lead's session: "Ok apply pstack principles wherever possible to help inform architecture creation and maintenance." Earlier the same day he asked whether the lead has "subtract before you add".

Every rework brief links this file. A helper reads the leaf skill (`.claude/skills/principle-<name>/SKILL.md`) for each row its unit touches and says in its notes which choice the principle changed. The lead checks a unit's diff against the "check" column before merging it.

| Principle | What it decides in the rework | Check on a unit's diff |
|---|---|---|
| subtract-before-you-add | The first build unit deletes: the second `STAT_KEYS`, the six label maps, `carry`, then the fight numbers in the views. Each later unit names what it deletes | The unit's notes list deleted lines and files. No old and new path left side by side |
| migrate-callers-then-delete-legacy-apis | AC, `mod`, the six stats and the round counter go in the same unit that moves their last caller | `grep` for the old name finds nothing after the unit |
| redesign-from-first-principles | Positions, the timeline and the `Sheet` are in the combatant row as if they had always been there, not bolted beside the old fields | No field that exists only to feed an old screen |
| foundational-thinking | Types and tables before logic: `Sheet`, `Place`, `Time`, `Ability`, `Outcome` and the rule numbers land before any resolver | The first commits of a unit are types and tables |
| model-the-domain | A channel, a shield, stagger, threat and the timeline are each a named type with one reducer or table, with a chart where it is a machine | No new boolean beside an old one; no branch on `kind` in a view |
| type-system-discipline | A place, a time, a stat key and a damage type are their own types; a formula is parsed once into a tree | No bare `number` for a place or a time in a signature; no `any` in core |
| boundary-discipline | A formula, a room message, a save and a GM's rule override are parsed once at the edge; core trusts its types. Dice are rolled at the edge and passed in | No validation inside `resolve` or `reduce`; no `Math.random` in core |
| minimize-reader-load | One home for each fight number. A view draws and sends taps | "Where does this number come from" is answered by one file named in `AGENTS.md` |
| laziness-protocol | The smallest set of derived numbers and status ops that the rules need | Each new field has a rule that reads it |
| make-operations-idempotent | A player's move or use reaches the GM's phone as a room message with an id, applied once | The applier is `once: true` and the model test replays it |
| separate-before-serializing-shared-state | A combatant's fight state has one writer, the reducer; the sheet hears of HP through an effect | A lint test holds the single writer |
| exhaust-the-design-space | Two or three variants on paper numbers for the timeline, the reaction roll and the map model before code | The design names the variants and the numbers that chose |
| explain-the-number | Every rule number has its reason beside it and a bound written before the run | The simulation prints run count and spread; a bound names its lever |
| build-the-lever | `scripts/rw-paper.ts` prints the design's tables; the simulation runs the real core | The script or test is in the diff and reruns in seconds |
| prove-it-works, sequence-verifiable-units | One unit, one check, green before the next; the lead reruns the check itself | The unit's last commit has the command and its last line in the notes |
| test-behavior-not-implementation | An expected value comes from the rule in the design, not from a run of the code | A test fails when the rule is broken by hand |
| encode-lessons-in-structure | A boundary that matters becomes a lint test: no view computes a fight number, only the fight changes a place | The lint test is added in the unit that makes it true |
| experience-first | A normal fight lasts 4 to 8 rounds; the table still rolls dice; a fight without the map loses nothing | The simulation's bounds include fight length |
| guard-the-context-window, never-block-on-the-human | Helpers carry the bulk; the lead decides and records in `for-the-owner.md` | |

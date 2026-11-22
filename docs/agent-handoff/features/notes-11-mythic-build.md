# Notes 11: the mythic build (design B), unit by unit

## MY1: the script's types, the registry, the rules, `Monster.script`

Branch `mythic-1`.

### What exists

- `src/core/combat/mythic-types.ts`: `MythicScript<M, O>`, `MythicPhase` (`GatePhase | ClockPhase`), `Rotation`,
  `Beat`, `Omen<M>`, `MythicMove`, `MythicStatus`, `OmenAim`, `AnswerOutcome`, `Interrupt`, `MythicStanding`, the
  brands `MoveKey` and `OmenKey`.
- `src/core/registry/mythics.ts`: `MYTHICS` (`plain` and B.6's three), `MythicScriptId`, `PLAIN`, `MYTHIC_IDS`,
  `isMythicScriptId`, `mythicScriptOf`, `movesOf`, `omensOf`, `bandOf`, `scriptFits`, `sampleHp`, `mythicMove`.
- `RULES.fight.mythic`: `scripts: false`, `staggerTaken`, `turnPace`, `bounds`.
- `Monster.script`, `monsterScript`, three mythic seeds; `extractableOf` in `monster-types.ts` (never a mythic).

### Where the design did not hold against the code, and what was built

- **A clock phase holds no `from`.** The brief asks for a phase union the compiler checks: `GatePhase` holds `from`,
  `ClockPhase` has `from?: never`. Zaratan's Dive is written without its `from: 0.55`. `bandOf(script, i)` reads a
  phase's band: a gate phase from its `from` to the next gate phase's `from` (0 when none follows); a clock phase
  begins at its gate, the next gate phase's `from`. MY2's `gateOf(row)` should read `bandOf(...).gate` in place of
  `phases[phase + 1].from`, which a clock phase no longer has. The phases tuple is `[...MythicPhase[], GatePhase]`, so
  the last phase ends at 0 HP by type.
- **The keys are checked by the compiler.** `MythicScript<M, O>` is generic in its move and omen keys while written;
  `full`, `weak` and each omen beat are `NoInfer` of them, so a beat naming an omen the script lacks, an omen landing a
  move it lacks, or a clock phase with a `from` does not compile (each was tried). `mythicScript` brands the keys once.
- **`MythicScriptId` is the key union of `MYTHICS`, not `Id<'MythicScriptId'>`.** A row has no `id` field: its key is
  its id, so the two cannot disagree, and a seed naming a script the registry lacks does not compile.
  `isMythicScriptId` is the parse check. `MythicScript` therefore has no `id`; `mythicScriptOf(id)` reads a row.
- **A mythic seed must name its script by type.** `MonsterSeed` is a union of two row shapes: a mythic's tweak needs
  `script`, any other kind's may not have one. `Monster.script` stays optional (a union on `Monster` would reach every
  view and fixture); `parseMonster`, `statBlock` and `seedMonsters` give every mythic one, `plain` when it names none or
  one the registry lacks, and drop it from any other kind. `monsterScript(m)` is the reader (null off a mythic).
- **A move's shape by kind.** `MythicMove` is a union: a blast reaches a number of tiles or `field`; a strike, shot or
  curse has `reach: 0`. A `field` blast is a radius of 60 (the farthest two tiles of a 40-tile map are, by `dist`) with
  no ring. **Check in MY4**: a blast's spread stops at walls (space.ts), so a field move on a walled map may not reach
  every body; a dedicated reach may be wanted there.
- **`mythicMove` sets `foesOnly: true`**, so a mythic's own field blast never lands on itself (a blast kind is not foes
  only by default). Its time is `mythic.turnPace`, no fatigue, mana or cooldown. Its `self` status (Crescendo) is not
  on the ability: MY4 puts it on the mythic when the move lands.
- **The factor** is `hits × sampleHp(S) / kindHit` to three significant figures; "the sample S hunter" is read as the
  item maker's `SAMPLE_WEARER` build at rank S's first level (item-budget.ts reads the same build at any rank).
- **`plain`'s Overwhelm is physical** (the design names no type; `plain` plays on the brute body M1 measured). Its
  phase is named "The Fight".
- **`SHELL` is written once** at the top of mythics.ts, not twice inline as B.6 has it: one key, one def.
- **`turnPace` and the bounds needed readers in `src/core/overrides.ts`** (outside the row's files; no helper held it):
  a text rule that is only a pace is checked against `fight.cost`'s keys, and each bound is a `lowToHigh` list.
  Without them a GM's override could set the pace to any text. Their test is in tests/mythics.test.ts.
- **`Monster.script` needed one row in `src/core/status-refs.ts`** (`script: none`): the typecheck holds that walk
  whole. No helper held it.
- **A mythic cannot be extracted** (the lead's call): `extractableOf(kind, type, own)` in `monster-types.ts` is the one
  decision, used by `statBlock`, `seedMonsters` and `parseMonster`. A mythic is never extractable whatever its type or
  a saved yes. The bestiary maker (`bestiary.js`, trade-4's views) still shows the Extractable chip for a mythic; the
  saved monster reads false. `combat.js` treats a row whose monster left the bestiary as extractable (line ~1137):
  a mythic whose bestiary entry was deleted is not covered. `shadows.ts` `bossDc` was left as it is (moot now).
- Seeds use the script's name ("The Angel of the Last Trumpet", not the draft's "Angel of the Last Trumpet"); the
  draft's abilities that are the script's moves are not listed on the seed. XP is the kind's 5 times S.

### Principles that changed a choice

- `principle-type-system-discipline`: the phase union, the generic keys checked with `NoInfer`, the key-union id, and
  the seed row union.
- `principle-model-the-domain`: a registry keyed by id with no second copy of the id; `extractableOf` as the one
  place extractable is decided.
- `principle-test-behavior-not-implementation`: the sample S hunter's HP in the share test is worked out in the test
  from the rules, not from `sampleHp`; each loop test was made to fail by a mutation of the data (a burst of 30%, a
  factor read at rank A).
- **The solo doc's size bound moved from 55% to 60% of `DOC_MAX`** (tests/protocol.test.ts, outside the row's files;
  trade-4 holds `protocol.ts`, not its test). The worst-case solo doc packs every built-in monster, and the three
  mythic seeds took it from about 32,700 to 35,858 characters (57.8%). Item-stats 6.2 moved the same bound from 50%
  to 55% the same way. The other way out is a call for the lead: no mythic in a solo gate (a lone hunter against a
  fight built for 5 to 10% wins for three), which would drop them from the solo doc and keep 55%.

## MY2: the machine and its readers, the chart

Branch `mythic-2`. Nothing calls any of it yet: MY3 puts the standing on the row and raises the events, MY4 lands
the moves.

### What exists

- `src/core/combat/mythic.ts`: `MYTHIC_TABLE` (B.3's table cell for cell), `mythicStep`, `mythicCan`,
  `MYTHIC_STATES` and `MYTHIC_EVENTS` (both read from the table's keys, so neither list can miss a state or an event
  the typecheck holds), `MythicEvent`, `MythicRefusal`, `Answer`; the readers `scriptOf`, `gateOf`, `heldAtGate`,
  `clockOut`, `phaseOver`, `enraged`, `beatOf`, `landingMove`, `omenAim`, `answerMet`.
- `tests/mythic.test.ts`: the seven named tests, plus the landing move, an omen with no foe to aim at, and three of
  `answerMet`.
- `scripts/charts/mythic.ts`, its entry in `MACHINES`, its line in `docs/guide/machines.md`.

### Where B.3 did not hold against the code, and what was built

- **The row has no `mythic` field yet** (MY3 adds it to `MonsterOwn`). The readers that B.3 gives a `row` take a
  `MythicRow`: `Pick<Body, 'life' | 'sheet'> & { mythic: MythicStanding | null }`, which a `Body` will satisfy once
  MY3 adds the field. The readers that need no HP take the standing alone: `clockOut(s, now, R)`, `enraged(s, now, R)`,
  `beatOf(s, now, R)`, `landingMove(s)`. Each reader that reads a clock takes the rules (a round's length).
- **`gateOf` reads `bandOf(script, phase).gate`**, as MY1 asked: a clock phase's gate is the next gate phase's
  `from`, the HP it began at, so no damage moves it in the Dive. Rounded up (65% of 999 holds at 650).
- **The chart walks the Angel's three phases, not a two-phase script.** `MythicStanding.script` is a key of
  `MYTHICS` and the registry holds no two-phase script; adding one for a chart would put a fight in the codex. The
  chart draws one box per phase (its name) with the three card states inside, so the `next` arrows and the last
  phase's lack of one show. Standings that differ only by beat or `since` are one state of the walk (`at/phase`).
- **`omenAim(aim, move, me, f, R)` takes the move.** `crowd` needs the move's reach, and the aim's form needs its kind:
  a blast aims at the chosen body's tile (B.4: stepping out of the marked tiles answers it), any other move at the
  body (going out of range makes it fizzle). The foes it picks among are `policy.ts`'s `foesOf`: up, not warded from
  it, perceived by its side. `threat` with no entry ties every foe, so the first in row order. `crowd` counts the foes
  each foe's tile catches in a radius of the reach (walls stop it, `inShape`); a `field` reach takes the first foe.
  With no foe to pick, every aim is its own tile (the move then lands on no one or fizzles); B.3 left that case open.
- **`answerMet(omen, hpAt, before, after)`** returns only the answers whose outcome does something, cancels first;
  B.3 had `consequences` filter `none`. A weaken of an omen with no `weak` move is not met (tests/mythics.test.ts
  already holds that an omen that weakens has one), so `landingMove` in `faltering` always finds a weak move.
- **`omenAim` imports `threatOf` from fight-view.ts.** When MY3 makes fight-view's `intentOf` read `landingMove`,
  the two modules import each other. Bun resolves it (only functions cross), and no lint forbids it; MY3 may move
  `threatOf` and `tauntOf` down if it wants the cycle gone.

### Calls the owner might have made otherwise

- With no foe to aim at, an omen aims at its own tile. The other way: return null and have MY3's turn start skip the
  announce (an act beat instead). Undo: `omenAim`'s last two lines and its test "with no foe up to pick".
- A hidden or untargetable body is never an omen's aim (the same foes the policy picks among). The other way: aim at
  any foe up. Undo: the `foes` filter in `omenAim`.

### Principles that changed a choice

- `principle-model-the-domain`: the state and event lists are the table's keys, not lists beside it.
- `principle-type-system-discipline`: each table cell is typed by its state (`Calm` or an omen standing) and its
  event's payload, so a cell cannot read an omen field in `calm`.
- `principle-test-behavior-not-implementation`: every expected value is worked from B.3's table and the scripts'
  words (65%, 30%, 55%, clocks of 5 and 3 rounds), not from running the readers.

## MY3: the standing on the row, the gate, a mythic's row, the one-writer lint

Branch `mythic-3`. A first helper moved `threatOf` and stopped; the lead ruled on its three questions (split the
registry; the row's field required; the one line in `joined`) and a second helper built the rest. The switch
`fight.mythic.scripts` stays off, so no table sees any of it.

### What exists

- `threatOf` and `taunter` in `src/core/combat/threat.ts`, under fight-view.ts, policy.ts and mythic.ts (first helper).
- `src/core/registry/mythics.ts` imports types only: its status keys are branded by a local `statusKey` cast, as
  `mythicScript` brands the move keys. `sampleHp`, `MythicBody`, `MythicRules` and `mythicMove` moved to
  `src/core/registry/mythic-moves.ts`. `src/core` still has no value import cycle (checked with a walk of every file's
  value imports after the change).
- `Body.mythic`: `MythicStanding | null` on a monster row, `null` on a hunter's, shadow's and summon's, required on
  every kind and said at every place a row is built (rows.ts, fight-parse.ts, every test fixture and model that builds a
  row, `tests/e2e/customization.e2e.ts`'s stored fight, `docs/agent-handoff/features/enemies/measure.ts`).
- mythic.ts is the standing's one writer: `mythicStep` (MY2), `mythicStart(id, since)` (a new row's: calm, phase 0,
  beat 0; null with no script) and `mythicJoined(row, now)` (moves `since` by the fight's now). `joined` in fight.ts
  wraps its row in `mythicJoined` (ruling 3).
- `monsterRows`: with the switch on, a mythic's row starts with `mythicStart(monsterScript(m), 0)`, its stagger bar
  times its first phase's `bar`, and its first phase's `worn` statuses after its start statuses (one whose key a start
  status holds is left out; source the row at its rank's tier; until removed). With the switch off, and on every other
  kind, `mythic: null`. `RowMonster` gains `script?`.
- The gate: `foeLifeAfter(life, event, hpMax, floor)`; `rowLifeAfter` passes `gateOf(row)`. `damage` and `setHp` land
  at `max(hp, min(floor, current HP))`: never under the gate, and never lower than it already is when it stands at or
  under the gate (a status that raises max HP can lift the gate above its HP). `heal`, `revive` and `maxChanged` do not
  read the floor. The foe-life chart passes 0.
- `staggerOp` (land.ts): a row with a standing takes `mythic.staggerTaken` of the fill, after the `staggerOpMax` cap.
- `fight-parse.ts` reads `mythic` by kind: a monster's through `mythicOf` (a script the registry holds, a phase of
  it, an omen of it, a faltering omen one that can be weakened, an aim on the grid); every other kind must store null.
  A stored fight with no `mythic` on a row no longer reads (old fights need not).
- Tests: `tests/mythic-gate.test.ts` (B.10's six, plus "every other row's life is as it was" and the stagger op's
  share), `tests/rows.test.ts` ("a mythic": B.10's three, plus "a mythic joining a running fight counts its phase's
  clock from its joining"), `tests/lint.test.ts` "a mythic's standing has one writer".

### Proof

- `bun run test`: `Ran 6064 tests across 138 files.` (6060 pass, 0 fail).
- With `rowLifeAfter`'s floor set to 0, five of tests/mythic-gate.test.ts's eight fail (the last phase, every other row
  and the stagger op's share pass, as they should).
- Browser files that write a fight's rows straight into the store or build rows: `customization`, `kits`, `makers`,
  `maps` (`92 passed`).

### Where the design did not hold, and what was built instead

- **"Only `mythicStep` writes it"** cannot hold with a row maker and `joined` moving `since` (B.3 itself names
  `joined`). The one writer is the module: the lint permits `mythic: null` and the answers of `mythicStart` and
  `mythicJoined` outside mythic.ts, and sees any `.mythic =`, any copy of a row with a new `mythic`, and any standing
  literal (`at: 'calm' | 'omen' | 'faltering'`). fight-parse.ts builds its standing from shorthand fields, which the
  rule does not see (as the life and threat rules leave the row makers alone).
- **`joined` changes two lines, not one**: a spread of the `NewRow` union with one `mythic` value does not typecheck
  (a hunter's `mythic` is `null`), so `joined` wraps its copy in the generic `mythicJoined(row, now)`.
- **The log line "held at the gate"** (B.3) is not written: `rowLifeAfter` returns a row, and its callers are in
  fight.ts, resolve.ts, land.ts and fight-turn.ts. MY4 (the reducer) writes it where it reads the change.
- **A floor under a standing HP**: B.3 says "while the life is up and above the floor"; the built rule also keeps a
  row under its floor from going lower (no damage, a hand edit only upward), so no path ever lowers it past the gate.

### Calls the owner might have made otherwise

- A mythic's first-phase statuses are plain statuses that last until removed, the row their source; not `worn: true`
  (that flag means a hunter's never-written-back status). MY4 takes them off by key at the phase change. Undo: the
  `worn` line in `monsterRows`.
- The stagger op's mythic share applies after `staggerOpMax`'s cap. The other way: before it. Undo: the factor's place
  in `staggerOp`.
- The parse does not check that a row holding a standing is a mythic by its origin. Undo: one line in `OWN.monster`.

### Principles that changed a choice

- `principle-type-system-discipline`: `mythic` required on every kind, `null` typed as the only value on three of them,
  so a fixture that forgets it does not compile; the parse checks script, phase and omen against the registry once.
- `principle-model-the-domain`: the gate is a parameter of the foe table's steps, not a clamp at each caller.
- `principle-test-behavior-not-implementation`: every expected HP is the Angel's own share (65%, 30%) of its max HP.

## MY4: the reducer (beats, omens, answers, landing, the GM's command, the phase change)

Branch `mythic-4`. The switch `fight.mythic.scripts` stays off, so no table sees any of it; the tests turn it on, and
the reducer plays any row that holds a standing whatever the switch says (the switch only decides whether `monsterRows`
gives a mythic one).

### What exists

- `fight-types.ts`: the GM's `{ type: 'mythic'; by; step: 'drop' | 'next' }`; `Refusal` gains `MythicRefusal` (`noOmen`,
  `omenStands`, `weakened`, `lastPhase`), `notMythic` and `omenDue`; effects `phased`, `omen`, `answered`.
- `fight-turn.ts`: `scriptTurn` at a turn start (after a held turn is passed): its phase over, `phasedRow` (the one
  place a phase begins: worn statuses swapped by key, bar emptied at its kind's bar times the phase's `bar`, channel
  dropped; by the GM its HP brought to the phase's start, at its turn the turn spent) logged "X enters <phase>."; an
  omen standing, nothing; an omen beat, `announce` at `omenAim` with its HP, the turn spent, "X readies <omen>: it lands
  on its next turn." (enraged: "X is enraged: it readies <omen>, which lands on its next turn."); an act beat, `beat`.
  `consequences` logs "X is held at the gate." once when a change takes it there, and `answered` turns each answer
  `answerMet` finds into `cancel` or `weaken` (cancel first, each only when the state takes it) with a line and an
  effect. `omenMove` (the landing move, built by `mythicMove` when needed, never on the row), `omenNeeds` (its dice),
  `untaunted` and `retaunted`.
- `fight.ts`: `RunningState` gains `{ at: 'landing'; id }` after `owing`; its row of `TABLE` is acting's with `act:
  landOmen` and `move`, `endTurn`, `release`, `setIntent` null. `landOmen` takes only the omen's move at its aim
  (`omenDue` else), reads it on the untaunted row, fizzles on `noTarget` or `range` ("<move> finds no one.", the turn
  spent), and on a landing puts the move's `self` status (Crescendo) on the mythic and hands on to `landed`. The GM's
  `mythic` step (`mythic`) in every running row, null in setup, none and ended. `setIntent` on a mythic whose omen
  stands is refused `omenStands`.
- `mythic.ts`: `playsScript` (a guard) and `mythicStepped` (a row's standing moved by an event), so fight.ts and
  fight-turn.ts move a standing without writing one (the one-writer lint holds).
- Tests: the eleven of B.10 in `tests/fight.test.ts` ("a mythic plays its script"), the three per-script tests in
  `tests/mythics.test.ts`, the table test with `mythic` and the landing row; random play holds a rank D Fourth Rider in a
  third of the fights (`MYTHIC` in `tests/models/fight-play.ts`), sends its landing and the GM's hand, and
  `mythicWrong` (tests/fight-model.test.ts) checks the standing after every command.

### Proof

- `bun run test`: `Ran 6120 tests across 139 files.` (6116 pass, 0 fail).
- With `answered` (fight-turn.ts) returning at once, the three answer tests fail ("a stun ... cancels", "a broken
  stagger bar weakens", "enough damage weakens").
- Random play (2,500 seeds) reaches 98 phase changes and 38 omens announced; an answer met once and a landing a few
  times, too rare for the model test to count on, so it asserts only the first two.
- Browser files that store a fight's rows straight into the save: `customization`, `kits` (`19 passed`).
- `bun run charts` redrew docs/state-machines.md (the fight's walk with the mythic's fights).

### Where the design did not hold, and what was built instead

- **A `self` or `all` omen aims at the mythic itself, not its tile** (`omenAim`, changed from MY2). Aimed at the tile,
  a shove of one tile between the announce and the landing put its own tile out of a range of 0, and The First Breath
  fizzled. Aimed at its id, the area moves with it, and with nobody in it the landing finds no one. So does an omen with
  no foe to pick (MY2's call 1 now reads "aims at itself").
- **Every write of a standing goes through `mythicStepped`.** The lint flags `{ ...row, mythic: next }` outside
  mythic.ts, which is what B.3's cells would have written in fight-turn.ts.
- **A break of the bar is a growth of its max within one phase.** `phasedRow` sets the bar to the new phase's size,
  which grows it when `bar` rises (the Angel's 1 to 1.25), and `consequences` read a growth as a break: it now also
  asks that the phase did not change.
- **A taunt is set aside by reading the landing on the row without its taunts** (`untaunted`): `ready`'s rule 2 is in
  resolve.ts, which MY4 does not hold. `retaunted` puts them back on the row the use left, and `omenNeeds` asks the dice
  the same way (resolve.ts `needs` on a taunted row asks none).
- **The answer lines are read from the change, not from a template** (B.3's "Mira's stun answers ..."): "The Fourth
  Rider is stunned by Brakk: Named in the Book is cancelled.", "The Angel of the Last Trumpet's stagger bar breaks: The
  Final Note will land as The Broken Note.", "The Fourth Rider loses 5% of its HP: Named in the Book will land as Struck
  from the Book." The status's label and source, the omen's name, its weak move and its burst share are the data's.
- **A forced `act` of another row during a landing turn is `act`'s**, so the GM's out-of-turn hand still works there.
- **A row stored with no `mythic` field reads as one with none** (`heldAtGate`, `playsScript` test it as `gateOf` does,
  by truth): fixtures of tests/triggers.test.ts and others cast a row without the field, and `consequences` now asks
  every row whether it is held at its gate.
- **The model's ward invariant reads a use**: an omen aimed at a body that went untargetable fizzles, which is no use
  on it (`wave2Wrong` now asks for a `used` effect).

### Calls the owner might have made otherwise

- A self or all omen follows the mythic (above). Undo: `omenAim`'s two `me.id` back to `me.place`, and its two tests.
- A landing that cannot reach spends the mythic's turn (a standard action), as B.3 says; the omen's `beat` moves on.
- The GM's Drop the omen during a landing turn leaves the mythic a normal turn (calm, its next beat taken later). The
  other way: the drop spends the turn. Undo: an `acted` in `mythic`'s drop branch.
- The GM's Next phase brings HP to the phase's start rounded up, as the gate rounds. Undo: `Math.ceil` in `phasedRow`.
- A worn status both phases name stays as it was across the change (its `since` too). The other way: off and on again.
- **A gap until MY7**: a GM who turns the switch on in Custom rules now reaches a landing turn with no button for the
  omen's move or Drop the omen (combat.js has neither), and End turn is refused there. The log reads every announce,
  answer and landing; to free the turn the GM removes the mythic, stuns it or ends the fight. MY7's screens add both
  buttons; the switch ships off until then.

### Principles that changed a choice

- `principle-model-the-domain`: the landing is a running state of `TABLE` read from the fight, not a flag; the omen
  move is built from the script when needed, never stored.
- `principle-type-system-discipline`: `playsScript` narrows a row to one with a standing, so no cast reaches
  `mythicStepped` or `phasedRow`.
- `principle-test-behavior-not-implementation`: each expected number is the script's (65%, 70%, 30%, 55%, 1.25, 5%,
  range 24, clocks of 3 and 5 rounds); the tests drive the reducer turn by turn as a table would.

## MY5: the play and the numbers (`answerChoice`, the landing, rows B1 to B9, each script's `hp`)

Branch `mythic-5`. The switch `fight.mythic.scripts` stays off (the lead's ruling: MY7 turns it on with its screens);
the rows turn it on in the sim's own rules (`scriptsOn`).

### What exists

- `policy.ts`: `ANSWER_KINDS`, `answerChoice` (step out of the omen's tiles, a status whose op its interrupt names, a
  shield on a body it would drop, the strongest hit while its stagger or burst outcome still changes it), `keptOut` (a
  walk from outside the tiles into them becomes a pass), `beatUses` (an act beat takes its phase's acts) and the landing
  first in `sensible`.
- `tests/policy.test.ts`: the four named tests, each on the reducer with a seed mythic made as the table makes it.
- `tests/models/fight-sim.ts`: `scriptsOn`, `scripted`, `mythicPolicy`, `answering`, `landed` (the landing turn) and
  `MythicTrace` on each record.
- `tests/fight-sim.test.ts`: rows B1 to B9 by name (`SCRIPT_ROWS`) and "with mythic phases off the old rows are
  unchanged"; the misses are in `OPEN` with their values.
- `registry/mythics.ts`: `hp` plain 1 → 1.03, the Angel 0.85 → 0.9, Zaratan 0.9 → 1, the Rider 0.85 → 0.8; the Broken
  Note's hits 0.7 → 1.2 and the Reaping on every name (both for B6). Every move is in rw/sim-log.md, "MY5".

### Where the design did not hold

- **A script's `hp` is read by nothing** in src. The sim puts it on the seed's tweak; rows.ts `monsterRows` needs that
  one factor before scripts go on.
- **play.ts cannot play a landing turn** (its `rollsFor` looks the omen's move up on the row, and asks `needs` on the
  taunted row). The sim plays it (`landed`). My edit of play.ts was refused as outside the unit's files; the odds engine
  throws on a scripted mythic's first landing until play.ts asks `omenNeeds` on a landing turn (the change:
  `rollsFor` takes the `Ability` and reads `omenNeeds(f, me, R)` when `runningState(f)` is `landing` for `me`).
- **`sensible` plays a mythic badly**: 0.245 against M1's body where `monsterPolicy` gives 0.065. The rows play the
  mythic's act beats as M1's monster; the odds engine reads `sensible`, so its mythic odds are rosy (a gap from before).
- **B3 and B5's stagger and burst test a premise that does not hold**: those answers are met by ordinary hits, so
  taking them out of `answerChoice` leaves them met. B3 measured 0.078, 0.042, 0.053 against under 0.01.
- **The gate holds HP, not turns** (B2 and B4 with three cannons): a burst party takes a phase before the mythic acts in
  it, and its hits held at the gate break the bar during Zaratan's Dive. A reducer rule would hold it.
- **B4 and B9 have no keystones**: K4 and K5 have not landed. B4 plays three plain cannons; B9 is `todo`.
- **B6 read from the first doom's landing**: an enraged omen is announced a turn ahead, so every party gets a round past
  the clock.
- **The shield answer comes before the hits**, and only on a body the move would drop: shielding every body it hit
  cost the Angel's party half its wins (0.215 against 0.44).

### Calls the owner might have made otherwise

- The B rows' tank holds a stun. Undo: drop `abilities().stun` from `answeringParty`.
- The Reaping takes every name. Undo: the Reaping back to a curse aimed at `weakest`.
- The Broken Note is 1.2, not 0.7. Undo: its hits.
- A mythic's act beats play as M1's monster, not `sensible`'s. Undo: `scripted`'s policy to `sensible`.

### Principles that changed a choice

- `principle-explain-the-number`: plain's 0.175 against M1's 0.065 was traced to its clock (clock 40 gives 0.065
  exactly) before any `hp` moved, and `sensible` against `monsterPolicy` was measured on one body before choosing.
- `principle-attack-the-premise`: B3 and B5 failing for every script, whatever the omens' hits, pointed at the measure
  (answers met by ordinary hits), not at another number.
- `principle-test-behavior-not-implementation`: each policy test lands the omen after the choice and reads the HP.

## MY5, second pass: play.ts lands an omen, `monsterRows` applies `hp`, B3 to B7

Branch `mythic-5b`. The switch `fight.mythic.scripts` stays off. Every measure and move is in rw/sim-log.md, "MY5,
second pass".

### What exists

- play.ts `rollsFor` asks fight-turn.ts `omenNeeds` on a landing turn, so the odds engine plays a scripted mythic; the
  sim's own landing turn is gone (B1 read the same, seed by seed). Test in tests/odds.test.ts.
- rows.ts `monsterRows` puts a script's `hp` on the row's tweak (max HP and bar), the one place; the sim's tweak is gone.
  Test in tests/rows.test.ts.
- mythic.ts `phaseOver`: a phase ends only once the mythic has taken a turn in it (`actedIn`: an act beat taken or an
  omen announced). B2 is 0 everywhere. Tests: tests/fight.test.ts, and the reader's cases in tests/mythic.test.ts.
- Script moves: Zaratan's Trench no longer answered by a taunt; the Sea Rises at the weakest, 0.8; the Dive 4 rounds;
  Zaratan hp 0.93; the Rider's Book Opens from 0.55, hp 0.83. B1, B2, B4 (the Rider), B6, B7, B8 hold.
- `OPEN`: B3 (three scripts), B5 (interrupt for the Angel and Zaratan, stagger and burst for all three), B4 (plain, the
  Angel, Zaratan), B9.

### Where the design did not hold

- **The clocks decide a mythic fight.** 467 to 599 of B1's 600 fights reach an enraged turn, and a fight a doom lands in
  is lost. An answer cancels or weakens a move, which saves HP, not time; so answering well and answering nothing lose
  the same race (B3, B5), and a party with more damage a round wins it (B4, the Angel). Four ways tried in memory did
  not separate them: answers no ordinary turn meets with the cannon's Focus saved for them (the saving party lost more),
  deadlier move-answered omens, a Dread stack on each whole landing, clocks 1.5 times as long. The fix this needs is a
  design call: an answer met moves its phase's clock back (`mythic.answerTime` rounds on `since`, carried by the
  `cancel` and `weaken` events), so answering buys the time a fight is lost for want of. It moves `MythicEvent`, its
  table tests and fight-turn.ts `answered`, outside this unit.
- **Stagger and burst are not decisions for this party.** Its ordinary hits meet them as often as aimed ones; made
  unreachable by ordinary hits (a break taking 0.6 of the bar in one change, burst 0.12), only a saved channel meets
  them, and saving it cost more than it saved. B5's stagger and burst rows read about 1.0 for every script; the bound
  stays, as no number of an omen moves it.
- **B4 against a brute body is the body's.** Today's brute mythic with no script loses 0.435 to three cannons; Zaratan's
  brute body 0.525. The lever is `fight.archetypes` or `fight.kinds.mythic`, outside `fight.mythic`.
- **Two files outside the unit's list**: tests/mythic.test.ts, whose reader case asserted the old `phaseOver` (a phase
  ends at its gate with no turn taken) and the Dive's 3 rounds; the rule lives in mythic.ts, so its own test follows.

### Calls the owner might have made otherwise

- A phase ends only after the mythic's first turn in it; the party's hits meanwhile are held at the gate. Undo: drop
  `actedIn` from `phaseOver` (B2 returns to 5 and 199 skips with three cannons).
- The Sea Rises names the weakest hunter (0.8) instead of the crowd's tile (0.4), and the Dive lasts 4 rounds. Undo: the
  three numbers, and Zaratan's hp back to 1 (B7 for the Dive returns to 0.007).
- The Fourth Rider's book opens at 55%, not 70%, so the Pale Horse lasts long enough to name someone. Undo: `from` and
  hp 0.8.
- The Trench is cancelled by a hold or a root, not a taunt. Undo: `'taunt'` back in its `by`.

### Principles that changed a choice

- `principle-attack-the-premise`: after three omen-number fixes failed B3 the same way, the premise "answers save the
  fight" was tested directly (the share of fights reaching a doom), which named the clock as the cause.
- `principle-fix-root-causes`: B2's skips were fixed in the phase-end rule, not by widening a clock or a band.
- `principle-explain-the-number`: every B4 miss was compared with the same body played with no script before a number
  moved; the brute body's 0.435 says the miss is not the script's.

## MY6: the room doc (a mythic row's standing, the room's switch)

Branch `mythic-6`. The switch `fight.mythic.scripts` stays off. No screen reads the doc yet (MY7).

### What exists

- `fight-doc.ts`: `DocStanding` (a monster row's `standing?`, absent on a row with none and off the wire): `state`,
  `script`, `phase`, `beat`, `since`, and while an omen stands `omen`, `aim` and `band`. It is derived from
  `MythicStanding` (`Omit<Extract<..., 'calm'>, 'at'>`), so a field MY5c adds to the standing is a compile error in
  `docStanding` until the doc says whether it travels. `DOC_MYTHICS` (4): the doc carries the standings of the first four
  mythic rows; later ones show as plain monsters. On the wire a row's `my`: `s p b t`, and in an omen `z` (index in
  `MYTHIC_STATES`), `o`, `a` (row id or `[x, y]`, absent when left out), `h` (band index). 105 characters at worst.
- `protocol.ts`: `docStanding` reads `my`; one that does not read (a script, phase or omen this build lacks, an omen that
  cannot weaken standing as faltering, a bad band or aim) is no standing, the row shows plain and the doc still reads, as
  an icon key this build lacks. `withinMythics` drops standings past `DOC_MYTHICS`. `RoomRules.mythic.scripts`, read
  off when absent; `roomRulesOf` publishes it, `withRoomRules` lays it over a player's rules (`hunter/build.ts`).
- Tests: `tests/fight-doc.test.ts` "a mythic on the table" (the two of B.10, plus HP off the table, the cap of four, an
  unreadable standing); `tests/protocol.test.ts` "the worst-case doc on the wire" (four mythics in an omen, the longest
  script id and omen key, a tile aim: 54,611 of the 55,111 cap, 500 to spare) and "the room carries the mythic switch".

### Proof

- With the hidden-aim guard taken out of `docStanding`, "an omen's aim on a hidden body" fails.
- `bun run test`: `Ran 6246 tests across 141 files.` (0 fail). Browser files that write a fight straight into the store: `table-turn` (20 passed, 1 skipped), `map-extras` (11), `maps` (12), `kits` (10).

### Where the design did not hold, and what was built instead

- `hpAt` does not travel. A monster's HP is a band on every phone and `hpAt` is its exact HP when announced (with the
  band it gives hpMax away). The doc carries the band the mythic had then. The burst answer is the GM's phone's to judge.
- The doc field is `standing` and the state `state`, not `mythic` and `at`: the lint "a mythic's standing has one writer"
  reads those words as a write to a row, and a doc's copy is not one.
- `withRoomRules` builds `mythic` through `mythicOver` for the same lint (a `{ ...R.fight, mythic: ... }` line reads as a
  copy of a row).
- "A hidden body" is a row the party does not perceive: its id never reaches a player's phone. In play the aims are the
  party's own rows or tiles, so it is a guard for a standing a GM edit or a later script could make, tested by hand.
- Seven fields a row would not fit: 18 mythic rows in a worst doc are 1,890 characters, over the 944 the doc had to spare.
  Hence the cap of four.

### Calls the owner might have made otherwise

- The cap of four standings (`DOC_MYTHICS`). Undo: raise it and `DOC_MAX`'s arithmetic fails first; or drop `beat`/`since`
  from the wire if a screen does not need them (MY7 decides).
- A doc without `mythic.scripts` reads as off (`trade` and `feats` read as on). A room made before scripts plays none.
- The band stands in place of `hpAt`; a screen that wanted the burst meter would need a share instead.

### Principles that changed a choice

- `principle-boundary-discipline`: a standing the reader cannot place is dropped at the boundary, the row stays plain.
- `principle-type-system-discipline`: `DocStanding` is derived from the standing's type so a new field cannot be missed.
- `principle-test-behavior-not-implementation`: the hidden-aim test failed when the guard was removed.

## MY5, third pass: an answer winds its phase's clock back (decision 40)

Branch `mythic-5c`. The switch `fight.mythic.scripts` stays off. Every measure and move is in rw/sim-log.md, "MY5,
third pass".

### What exists

- mythic.ts: the `cancel` and `weaken` events carry `back`, and their cells move the standing's `since` later by it (the
  clock is the standing's `since`, written only by the machine). `answerBack` reads it: `fight.mythic.answerTime`
  rounds for the outcome (1 for a cancel, 1 for a weaken), never past the phase's start (`since` stays at most now, so
  a clock never holds more than its length), 0 in a clock phase. fight-turn.ts `answered` passes it. Tests: the table
  test and "an answer winds a gate phase's clock back..." in tests/mythic.test.ts; "an answered omen winds its phase's
  clock back by the rule's rounds, and a landed one does not" in tests/fight.test.ts (fails when the cell drops `back`).
  The chart's answer arrows say the clock goes back.
- Zaratan's `hp` 0.93 → 0.97, the Rider's 0.83 → 0.89: answers buying time raised their B1 to 0.140 and 0.107.
- B1, B2, B4 (the Rider), B5 (the Rider's interrupt, 0.38), B6, B7, B8 hold. `OPEN` keeps B3 (Angel 0.082, Zaratan
  0.040, Rider 0.033), B5 (interrupt 1.04 and 1.00, stagger 0.87 to 1.00, burst 1.00 to 1.02), B4 (plain 0.380, the Angel
  0.242, Zaratan 0.685), B9, with this pass's values.

### Where the design did not hold

- **Time bought is lost again in the last phase.** With answers winding the clock back, the Angel's B1 fights with no
  doom went from 56 to 309 of 600 and its wins from 36 to 45: the fights the clock no longer ends are lost a few rounds
  later to its ordinary hits in the Note, the Angel at a median 9% of its HP. MY5b's "the clocks decide the fight" was
  half of it; the HP race decides the same fights once the clock is gone.
- **The party that answers none is given the time too.** Its ordinary hits meet the stagger and burst answers as often
  as the answering party's (the Angel 1.76 a fight against 1.65), and each now winds the clock back for it. It reaches
  as many fights with no doom (the Angel 336, the Rider 352) as the party that answers all (309, 325). No value of
  `answerTime`, 1 to 4 rounds, with or without the cap at the phase's start, moved B3 near 0.01.
- **B5's stagger and burst rows measure the same fights.** Taken out of `answerChoice`, the stagger or burst answer is
  met in the same numbers and the fights end the same (Zaratan and the Rider 1.00): the policy's choice for both, the
  strongest hit on the mythic, is the turn the party plays anyway. No number of the clock moves a row whose two parties
  play the same turns.
- **What would separate B3 and B5 is a design call**, outside `fight.mythic`: an answer only a chosen turn meets (a
  stagger or burst answer that counts only hits landed after the omen by a use the party aims as an answer, or answers
  out of ordinary reach with a party that saves a use for them; MY5b's saving party lost more, but then an answer
  bought no time); or a clock wound back only by the answers ordinary play does not meet (the interrupt), which would
  make B3 a question of the tank's stun alone.

### Calls the owner might have made otherwise

- An answer winds the clock back 1 round, a cancel and a weaken alike. Undo: "answers do not move the clock"
  (`answerTime` 0 and 0), or a cancel more than a weaken (`answerTime.cancel` 2).
- The clock is never wound past the phase's start: an answer in a phase's first round buys only the time already
  spent. Undo: "an answer may bank time past the clock's length" (drop the `now - since` cap in `answerBack`); measured
  the same (sim-log.md step 1).
- An answer in a clock phase (Zaratan's Dive) moves nothing, as its clock is the time the party must survive; today no
  omen of a clock phase has an answer. Undo: "an answer in the Dive shortens it" (`answerBack` winding the other way).
- An answer to a doom winds the enraged phase's clock back too, so a party that breaks the Angel's bar on the Final
  Note less than a round after its clock ran out takes it back out of its enraged rotation. Undo: "a doom's answer buys no time" (`answerBack` 0 while `enraged`).
  B6 holds either way today (0.000 to 0.004).
- The log line of an answer still reads "Named in the Book is cancelled." and does not say the clock went back; the
  card's clock is mythic-6's. Undo: "say the round bought" (a clause in fight-turn.ts `answered`'s line).
- Zaratan's `hp` 0.97 and the Rider's 0.89 to hold B1 under the rule. Undo: the two numbers, with `answerTime` 0.

### Principles that changed a choice

- `principle-attack-the-premise`: before fitting `answerTime` for B3, the premise "answering buys the time the fight is
  lost for want of" was tested directly (fights with no doom, and how those were lost), which showed the time is spent
  in the last phase and given to the party that answers none.
- `principle-explain-the-number`: each B3 value was read beside the answers met by each party, which named why no
  value of the clock moves it (the none party meets stagger and burst answers as often).
- `principle-test-behavior-not-implementation`: the reducer test reads the clock's start from the fight and the expected
  wind-back from the rule; with the cell dropping `back` it fails.

## MY5, fourth pass: an omen is answered only by a turn the party chooses (decision 42)

Branch `mythic-5d`. The switch `fight.mythic.scripts` stays off. Every measure is in rw/sim-log.md, "MY5, fourth pass".

### What exists

- rules.ts `fight.mythic.answerReach`: `stagger` 4 same-rank hits of fill on the bar, `burst` 0.13 of max HP, both counted
  from the omen's announce. One rule for every omen: an omen's `burst` is now an outcome like its `stagger`, and the
  shares each omen held (0.05 to 0.08) and their bound `mythic.bounds.burst` are gone (the rule's own domain bounds it).
- mythic-types.ts: an omen standing keeps `barAt` (the bar's fill and max at the announce, null with no bar) beside
  `hpAt`; the `announce` event carries it (fight-turn.ts `scriptTurn` reads it off the row). mythic.ts `barLanded` reads
  the fill since then, a break counting the bar it emptied; `answerMet` takes the standing's `hpAt` and `barAt` and the
  rules. The stagger answer no longer asks a break: a bar full at the announce and broken by one hit after it answers
  nothing, and 4 hits landed after it answer whether or not the bar broke. Its log line reads "reels under the blows".
- fight-parse.ts reads a stored `barAt`; fight-doc.ts sends none (fight-doc.test.ts: `barAt` is not on the wire), so
  protocol.ts is untouched.
- The policy saves nothing new: `answerChoice` is MY5c's, its burst read from the new outcome. A first build saved the
  cannon's Focus for the windows; it lost more fights than its answers won (sim-log.md step 3) and is gone.
- Tests: tests/mythic.test.ts "the answers a change met" (HP and fill before the announce answer nothing; a break counts
  the bar it emptied; sizes read from the rule); tests/fight.test.ts "the stagger answer counts the fill landed on its
  bar after the announce, not a bar filled before it" and "the burst answer weakens an omen once the HP lost since the
  announce reaches the rule's share", their hits sized from the rule through `afterDefence`. The chart's note says it.
- registry/mythics.ts `hp`: the Angel 0.9 → 0.93, Zaratan 0.97 → 0.92, the Rider 0.89 → 0.82, for B1 (answers out of
  ordinary reach lowered the answering party's wins at Zaratan and the Rider and raised them at the Angel).
- B1, B2, B5's interrupt row for the Angel (0.46) and the Rider (0.31), B6, B7, B8 hold. `OPEN` keeps B3 (the Angel
  0.028, Zaratan 0.042, the Rider 0.018), B5's stagger and burst rows (1.00 to 1.03) and Zaratan's interrupt row (0.98),
  B4 (plain 0.380, the Angel 0.152, Zaratan 0.697 at hp 0.94), B9, with this pass's values. The table is sim-log.md
  step 5.

### Where the design did not hold

- **Saving a use for the omen loses the fights it is saved for.** The one use of the mixed party that lands more in a
  window when saved is the cannon's Focus (a channel, 1.45 times a bolt for each turn held). Saved from one omen to the
  next, it met 0.4 to 0.9 stagger and burst answers a fight, against 0.03 to 0.26 for the party that answers none, and
  the party won less than that one at every script; against the Rider it was enraged in its first phase (8.5 rounds,
  against 14.2). The cannon passes about every other turn, and the clocks are fitted to the party's whole damage. At 3
  rounds of `answerTime` the same. Mutilation is a strike (1.04 of one), and the blast catches the melee allies beside
  the mythic. So for this party "spend now or save for the omen" is always "spend now", and the policy saves nothing.
- **The reach separates the parties, and not to 1%.** With the stagger and burst answers out of ordinary reach, the
  party that answers none meets them 0.01 to 0.2 times a fight, and the answering party wins two to four times its
  share with the turns it chose: the stun, the step out of an area, the shield. B3 fell from 0.082 / 0.040 / 0.033 to
  0.028 / 0.042 / 0.018. Under 1% asks about seven times. Harder area moves (their hits times 1.5) moved both parties
  alike (sim-log.md step 4).
- **No chosen turn meets the stagger and burst answers**, so B5's rows for them read 1.00: the answering party meets them
  only in windows its stun lengthened (a held mythic lands later). Zaratan's interrupt row reads 0.98: its one omen a stun
  answers, the Trench, comes in its last phase, and the stun meets it 0.1 times a fight.
- **What would separate them, each a design call:** a party that holds a burst it can save at no cost to the clocks (a
  kit's cooldown finisher, or the stagger ops of keystones A.7, which `answerReach.stagger` would then be sized against;
  B5 measures the mixed party, which holds none); answers that ask a turn off the best hit, written in the omen's data (a
  shield on the aimed body, or the aimed tile left empty, that cancels or weakens it, where today the step and the shield
  only spare HP); or more omens a stun answers, since the stun is the chosen answer that separates now (Zaratan's B3 and
  B5).

### Calls the owner might have made otherwise

- One reach for every omen, a rule (`answerReach`: 4 same-rank hits on the bar, 0.13 of max HP), in place of each omen's
  burst share (0.05 to 0.08) and its bound. Undo: "each omen sizes its burst" (`burst: { share, outcome }` and
  `bounds.burst` back), or "ordinary hits answer a warning" (`answerReach` at 0: any hit after the announce answers).
- A stagger answer is fill landed after the announce, not a break: a bar nearly full at the announce and broken by one
  hit answers nothing, and 4 hits landed answer with or without a break. Undo: "a break answers" (`answerMet` asks a
  break, as before, and the reach only for the fill before it).
- The policy saves no channel for an omen (measured to lose). Undo: "a cannon saves Focus for the omen" (step 2's
  policy, in sim-log.md).
- A stagger answer's log line reads "reels under the blows", with no number. Undo: "say the share of its bar".
- `hp` the Angel 0.93, Zaratan 0.92, the Rider 0.82, for B1. Undo: the three numbers.

### Principles that changed a choice

- `principle-explain-the-number`: the reach was read off what ordinary windows land (step 1), and each B3 value beside
  the answers each party met, which named why saving lost (the clocks) and why the stagger and burst rows read 1.00 (no
  chosen turn meets them).
- `principle-model-the-domain`: the HP and the bar the omen found are one place, the standing (`hpAt`, `barAt`), written
  by the machine at the announce, and one rule sizes both answers.
- `principle-test-behavior-not-implementation`: the reducer tests size their hits from the rule through `afterDefence`,
  and fail when a bar filled before the announce answers (the old break) or when a reach is not read.

## MY5, fifth pass: an omen answered by a turn that is not an attack (decision 43)

Branch `mythic-5e`. The switch `fight.mythic.scripts` stays off. Every measure is in rw/sim-log.md, "MY5, fifth pass".

### What exists

- mythic-types.ts `Omen`: every omen writes five answers' outcomes, `none` included: `interrupt`, `stagger`, `burst`,
  and decision 43's `shield` (a shield landing on the hunter it aims at) and `step` (the tile it aims at left with no
  hunter on it, standing or fallen). An omen aimed at the mythic itself (`self`, `all`) is typed with `shield` and `step`
  at `none`; tests/mythics.test.ts asks that only a blast's omen writes a step answer.
- mythic.ts: `ANSWERS`, the kinds in the order a party tries them (`Answer` is its member, and the policy's kinds: the old
  `ANSWER_KINDS` and `AnswerKind` of policy.ts are gone, and the policy's `move` is `step`); `answerOutcome`;
  `aimedBody`; `answerMet` reads an `AnswerScene` before and after a change (the mythic's row and every row) and the
  time, so a shield on the aimed hunter or a step off the aimed tile is met by that hunter's own change.
- fight-turn.ts `answered` passes the rows before and after; the log reads "Brakk is shielded: Named in the Book is
  cancelled." and "No one stands where Stars Fall was aimed: Stars Fall is cancelled."
- policy.ts `answerChoice`: the hunter on an aimed tile steps off it by the nearest tile (out of the area on a tie); a
  hunter steps out of an area only when the move would drop it (`drops`, the shield's rule too); the tank shields the
  aimed hunter while the shield answer changes the omen.
- No omen keeps a stagger or burst answer. The rule and its tests stay (tests/mythic.test.ts reads it on an omen of its
  own), for keystones' stagger ops (K5). The reducer tests of those two answers are gone with the data that held them.
- rules.ts `answerTime` 1 → 3 rounds, both outcomes. registry/mythics.ts: see sim-log.md step 4 for every number.
- Tests: tests/mythic.test.ts (the shield and the step in `answerMet`), tests/fight.test.ts ("a shield landing on the
  hunter an omen names cancels it...", "the hunter on the tile Stars Fall aims at cancels it by stepping off..."),
  tests/policy.test.ts (the step off the aimed tile, the tank's shield on the named hunter), tests/mythics.test.ts.
- Rows at 600 fights: B1 0.068 / 0.062 / 0.058 (the Angel, Zaratan, the Rider); **B3 0.000 / 0.002 / 0.008, all inside,
  out of `OPEN`**; B5's stagger and burst rows are gone (no omen answers by a hit); the new B5 rows hold (step 0.780 and
  0.135, shield 0.561 and 0.771, interrupt 0.195 and 0.514) except Zaratan's interrupt (1.08, se 0.23, in `OPEN`); B4
  stays open (0.380 / 0.187 / 0.657, the Rider 0.018); B2, B6, B7, B8 hold.

### Where the design did not hold

- **The walk in answers a step omen.** Stars Fall at the crowd, announced on the Angel's second beat, was answered by the
  party walking up (0.74 a fight for the party that answers none). It now comes after Weighed and aims at the farthest
  hunter, the cannon, who stands; the none party leaves its tile 0.00 times a fight.
- **The omens' hits do not move the party that answers none.** Its wins (2 to 5%) come from fights it wins on damage
  before omens add up: heavier Stars Fall and Pale Wake (1.6) left them as they were. What moved it is the clock: once
  only chosen turns answer, the none party buys no time, so shorter clocks with 3 rounds an answer separate the parties
  (sim-log.md step 2). The fight is now a clock the party extends by answering.
- **An answer only the tank holds covers about one omen in two.** The stun and Shield Wall are the tank's, each back
  every 3 rounds; the Rider names 3.5 hunters a fight and the party answers 0.8 of them. Its B1 (0.058) and B3 (0.008)
  are each inside by less than one standard error, and so are the Angel's B5 step (0.780) and the Rider's B5 shield
  (0.771): a move of the data or a policy can push one out.
- **Two decision-43 answers were words and are gone:** Zaratan's Trench shield (its hunter is the farthest, past Shield
  Wall's 6 tiles: met 0.00 times) and the Rider's Pale Wake step (B5 1.02 to 1.06: the Wake decides no fight).
- **Zaratan's interrupt row stays out (1.08):** its one omen a stun answers is in its last phase, met 0.09 times.
- **No guard.** A guard is a reaction armed ahead that fires at the landing, after the window; the mixed party holds
  none. Only a shield answers for the aimed hunter.

### Calls the owner might have made otherwise

- No omen is answered by a hit any more; the stagger and burst rule stays for keystones. Undo: "every warning is answered
  by hitting it" (the omens' old `stagger` and `burst` outcomes).
- The Angel's Final Note is made smaller by a stun, not by breaking its bar, and its phase line says so ("Hold it still
  before the note to make the note smaller."). Undo: "break its bar to make the note smaller" (Note `stagger: 'weaken'`,
  `interrupt` none, the old line).
- An answer buys 3 rounds, and the clocks are shorter: the Angel 4 / 4 / 2 (was 5 / 4 / 3), Zaratan 5 / 4 / 5 (6 / 4 / 7),
  the Rider 5 / 3 / 3 (5 / 5 / 4). Undo: "answers buy one round" (`answerTime` 1 and the old clocks).
- Weighed and Found Wanting is cancelled by a shield on the hunter it names, and no longer by a stun. Undo: "a stun
  cancels Weighed" (`interrupt: { by: ['hold', 'root'], outcome: 'cancel' }`).
- Stars Fall comes after Weighed, aims at the farthest hunter, and hits for 1.0 of a hunter's HP (0.55). Undo: "the stars
  fall on the crowd" (aim `crowd`, rotation act, Stars, act, Weighed, hits 0.55).
- Named in the Book is cancelled by a shield on the named hunter, as by a stun. Undo: "a shield only weakens the naming".
- Zaratan's Sinking hits 1.0 (0.5) and its Trench 1.2 (0.75), so not stepping off costs a hunter. Undo: the two numbers.
- A hunter fallen on the aimed tile still holds it, so a hunter killed there answers nothing. Undo: "a fallen hunter
  leaves the tile".
- The policy steps out of an area only when the move would drop the hunter (it cost the Angel's party 0.103 against
  0.147). Undo: "a hunter always steps out of an omen's area".
- `hp`: the Angel 0.93 → 1.0, the Rider 0.82 → 0.78, Zaratan 0.92 as it was. Undo: the numbers.

### Principles that changed a choice

- `principle-attack-the-premise`: "a heavier unanswered omen separates the parties" was tested directly (step 2) and
  failed; the parties' wins were read for what decides them, the clock, before any number moved.
- `principle-explain-the-number`: each B5 row was read beside the answers each party met, which found two answers that
  were words (met 0.00 times, or changing no fight) and the walk in that answered Stars Fall.
- `principle-model-the-domain`: one list of answer kinds, `ANSWERS`, shared by the data, the reducer, the policy and the
  rows; the type, not a check, keeps a self-aimed omen from a shield or step answer.
- `principle-test-behavior-not-implementation`: the reducer tests drive the shield and the step by commands and read the
  standing and the log; the stagger and burst rule is read on a test omen, not on a script's data.

## MY7: the words and screens (the strip, the omen banner, the GM's hand)

Branch `mythic-7`. The switch `fight.mythic.scripts` stays off in `rules.ts`; the GM's new switch in Fight tools and the
tests turn it on. Written from B.5 with decision 43 over it: an omen is answered by a step off its tile, a shield on the
hunter it is aimed at, or a stun, root or taunt on the mythic, never by a hit.

### What exists

- `fight-view.ts`: `MythicSeen` (a mythic row as a screen reads it; `mythicSeenOf` from the GM's body, `mythicSeenOfDoc` from
  the room doc's row, so both phones say the same words), `mythicStrip` (name, phase, HP and gate, clock, the phase's own
  line until its next turn, the GM's "Next omen" line), `omenBanner` (title, when and at whom, one line for each answer
  the omen's data gives an outcome, read from `answerOutcome` and `RULES`), `omenOnYou` (a player's own line), `answersBy`
  (a hotbar tag), `mythicHand` (the GM's Land, Drop and Next phase words), `omenMoveOf`.
- `map-view.ts`: a mythic's omen is a `MapAimLine` of kind `omen` (to the aimed body or tile, the tiles of an area move's
  reach, its name and when it lands); `HotbarSlot.answers`. `map.js` draws the danger tint and dashed edge.
- `rules-text.ts`: `mythicLines`, `mythicCodexLines`, `MYTHIC_SWITCH_WORDS`; `src/core/mythic-switch.ts` `mythicSwitched`.
- Views: `src/views/mythic-html.js` (the markup and look, shared); `combat.js` (the strip over the fight, Land, Drop, Next
  phase with its question, the switch, toasts for an omen, a phase and an answer); `table.js` (the strip on a player's HUD,
  the line on the hunter's own card, a tag under an answering ability); `map.js` (the tag on a hotbar slot);
  `bestiary.js` (the fight and its phases on a mythic's card while scripts are on); `rulesref.js` ("How a mythic fights",
  while scripts are on).
- Tests: `tests/fight-view.test.ts` ("a mythic on the table", "the GM's hand on a mythic"), `tests/map-view.test.ts` ("a
  mythic's omen"), `tests/rules-text.test.ts` ("how a mythic fights"), `tests/e2e/mythic.e2e.ts`.

### Where the design did not hold, and what was built instead

- The doc carries a mythic's HP only as a band, so a player's strip says the band ("Bloodied · gate at 30%"), not "HP 58%",
  and cannot say "held at the gate" (the GM's phone does). Nothing was added to the doc (`protocol.ts` is rulings-20's).
- B.5's "Cancelled: Mira's stun stopped ..." line under the banner is not drawn: a cancelled omen leaves no state to read
  once the standing is calm. The GM's toast and the log carry the words.
- B.5's stagger and burst lines exist (read from the omen's data) but no script writes either today.
- The switch is in Fight tools of the GM's fight screen, not on the Custom panel (that panel is the hunters' Build panel).
- B.5's first example banner text had the stun line first; the lines now go in the order of `ANSWERS` (step, interrupt,
  shield, stagger, burst), then how to dodge it.
- A player's own stun cannot be driven through a UI tap in the browser test cheaply; the test puts the stun on the mythic
  with the GM's Status API, which is the same command.

### Calls the owner might have made otherwise

- A hotbar tag reads "Cancels the omen" or "Weakens the omen" (the list view reads "Answers the omen: cancels it"), short
  for a 390 px slot. Undo: "write Answers the omen in full on the hotbar".
- The Rules page and the bestiary's fight lines show only while scripts are on. Undo: "show them always".
- The GM's Next phase is a plain button in the strip, not under a More button. Undo: "put Next phase under More".

### Principles that changed a choice

- `principle-model-the-domain`: one `MythicSeen` read from the GM's row or the doc's row, so two screens cannot word an
  omen differently; the answer lines loop over `ANSWERS` rather than name an omen.
- `principle-test-behavior-not-implementation`: the banner tests loop over every script and compare the lines with the
  omen's own outcomes, so a moved omen or number moves the expectation.

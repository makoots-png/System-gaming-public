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

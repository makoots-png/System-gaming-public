# Brief: the combat reducer (M3 unit B)

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first. Where this brief and the rules differ, this brief wins.

You work in the repo root on the branch that is checked out. Commit after every numbered step (plain messages, no AI attribution lines, never `.claude/`). Do not push. Do not start helpers of your own. Another helper may be editing `src/core/rules.js` and import lines in `src/views` in a separate worktree: do not touch those.

This unit is pure TypeScript plus bun tests. No browser. Do not wire anything into the app: `src/views/combat.js` and `src/core/save.ts` stay as they are. The next unit does the wiring.

Notes file (append a line after each commit): `docs/agent-handoff/p3/notes-reducer.md`.

## Why

`src/views/combat.js` (1,035 lines) keeps the fight as an array index `e.turn` plus `e.begun = round * 1e4 + index`, patched by hand on every re-sort, removal, Prev and Next. Five past fixes were about that arithmetic. It can hold states that mean nothing (a turn index past the end, `begun` 0 for "unknown", `active: false` with round 3). The owner wants each state machine explicit: a union whose illegal states do not compile, one pure function that every command goes through, and bun tests that pin each mechanic. Read `combat.js` lines 1 to 330 and 488 to 525 before you write anything: the reducer must keep what a GM sees today unless this brief says otherwise.

## The model (decided, do not reopen; tell me in the notes if something cannot work)

File `src/core/combat/encounter.ts`. Statuses come from `src/core/combat/status.ts` (`Status`, `Source`, `applyStatus`, `removeStatus`, `tickStatuses`, `statusDef`, `mods`). Read that file first.

```ts
// No fight is `null` in the save. An ended fight is not stored: `end` answers null plus an `ended` effect.
export type Encounter = Setup | Running;
type Shared = { id: string; gateId: string | null; combatants: Combatant[]; log: string[]; shareInit: boolean; bankedXp: number };
export type Setup = Shared & { phase: 'setup' };
export type Running = Shared & {
  phase: 'running'; round: number; currentId: string;
  // The furthest point the fight got to: a round, and whose turns have started in it. Every turn of an earlier
  // round has started. Next starts a turn only past this point, so Prev then Next does not tick a status twice.
  reached: { round: number; started: string[] };
};

type Order = { id: string; name: string; init: number; tie: number; initMod: number; group: string | null; state: 'up' | 'down' };
export type Combatant =
  | Order & { kind: 'monster'; refId: string | null; hp; hpMax; ac; atk: number | null; dmg: string; rank; boss: boolean;
              xp: number; extractable: boolean; extractTried: number; abilities: string[]; statuses: Status[] }
  | Order & { kind: 'shadow'; refId: string; hp; hpMax; ac; atk; dmg; rank; abilities; statuses: Status[] }
  | Order & { kind: 'hunter'; hunterId: string }                       // a hunter on this phone: HP, MP and statuses live on the sheet, never copied here
  | Order & { kind: 'remote'; remote: string; hp; hpMax; mp; mpMax; ac; statuses: Status[] };   // a hunter on another phone: the last numbers it sent
```

- `state: 'down'` means "takes no turns". For a monster or shadow it follows HP (0 is down, above 0 is up) and the GM can also set it by hand at any HP (a monster that fled or surrendered). For a hunter only the GM sets it.
- The list is kept in turn order while running: `init` high to low, then `initMod`, then `tie`.
- `export function reduce(enc: Encounter | null, cmd: Command, ctx: Ctx): { enc: Encounter | null; effects: Effect[] }`. It never mutates its input, never rolls dice, never reads a clock or a global. Random numbers and ids arrive inside commands.
- `Ctx = { rules: Rules; hunter: (id: string) => HunterView | null }` where `HunterView = { name; hp; hpMax; mp; mpMax; ac; initMod; tier; statuses: Status[] }` is what the reducer may know about a local hunter's sheet.
- Everything that happens outside the encounter is an effect, returned as data for the edge to carry out: `turnStarted { combatantId, hunterId }`, `rollTick { combatantId, key, label, op }` (a per-turn status op the edge must roll and send back as a command), `hunterHp`, `hunterMp`, `hunterFatigue`, `hunterStatuses { hunterId, statuses }`, `sendRemote { remote, ... }` (HP, MP, fatigue, status add and remove for a hunter on another phone), `shadowHp`, `defeated { combatant }`, `ended { summary, encounter }`, `refused { reason }` (the view turns it into a toast). Name and shape them as the code needs, one union, exhaustive.
- Commands (one union, exhaustive `switch` with a `never` check): `add` (carries ready-made combatants and the id for a new encounter), `rollInitiative { rolls }`, `setInitiative`, `setShareInit`, `next`, `prev`, `changeHp { id, delta, reason? }`, `changeMp`, `changeFatigue`, `setState`, `applyStatus { id, status, source? }`, `removeStatus`, `remove`, `linkGate`, `note`, `setExtractTried`, `syncRemote` (fresh numbers from a phone), `end`, `clear`.
- `rollInitiative` on Setup starts the fight: sort, round 1, the first combatant that is up is current, its turn starts. On Running it re-sorts and keeps the current combatant, the round and what has started. Nothing restarts. Also export a pure `initiativeNeeds(enc, ctx, only?)` that lists the d20 rolls the edge must make (one per combatant, or one per monster group when `shareInit` is on; a monster added mid-fight to a group that already rolled takes the group's number).
- A turn start (`next` past `reached`, the first turn, or a removal that passes the turn on): `tickStatuses` on the combatant's statuses, log the expiries and the turn, emit `turnStarted` and one `rollTick` per per-turn op. For a local hunter the statuses come from `ctx.hunter` and go back as a `hunterStatuses` effect. For a remote hunter the expiries also go out as `sendRemote`.
- `applyStatus` with no `source` takes the current combatant as the source when running (its tier: a monster's or shadow's rank index, a hunter's `tier`), otherwise `{ kind: 'gm', id: null, name: 'GM', tier: 0 }`. Reason: the GM applies a status during the turn of whoever caused it, so this costs no extra tap.
- `next` skips combatants that are down. With nobody up it answers `refused`. `prev` at round 1's first turn does nothing.
- `remove` of the current combatant passes the turn to the next one that is up, as `next` would. Removing the last combatant of a running fight gives `Setup` with an empty list (a running fight always has a current combatant). A monster removed while down adds its XP to `bankedXp`.
- The log keeps the newest 100 lines, newest first, with the `R3:` prefix while running, as today.
- `end` answers `enc: null` and `ended` with a summary: total XP (down monsters plus `bankedXp`), the down monsters, rounds fought, the hunters and remotes that took part, `gateId`, and a copy of the encounter. Who gets paid is not decided here (the gate unit does that).
- `export function parseEncounter(value: unknown, rules): Encounter | null`: the boundary parser the save repair will call. Anything that is not this shape (for example a fight saved by the old code, which has no `phase`) is `null`. Bounded: at most 60 combatants, names 60 characters, log 100 lines.

## Steps

1. Types, `parseEncounter` and its tests (`tests/encounter.test.ts`): a valid fight round-trips, an old-shape fight is `null`, hostile values come out bounded.
2. Tests first, then code, for setup and turn order: add, roll initiative, shared group rolls, next and prev across rounds, down combatants skipped, re-roll and `setInitiative` mid-fight keep the turn. Port the scenarios of `tests/e2e/combat-turns.e2e.ts` as reducer tests.
3. Tests first, then code, for HP, MP, state, statuses and turn starts: a monster at 0 goes down and reports `defeated` once, healing brings it back, the GM's manual down at full HP, a 2-round Poisoned ticks twice and leaves, Prev then Next does not tick again, default source, hunters and remotes produce the right effects.
4. Tests first, then code, for remove, bankedXp, link, note, sync, end, clear.
5. A property test in `tests/encounter-model.test.ts`: a small seeded generator (write it in the test, no dependency) runs at least 2,000 random command sequences of length up to 40 over a fight with hunters, a remote, monsters and a shadow, and after every command checks:
   - the input was not mutated (deep-freeze it before the call);
   - while running, `currentId` names a combatant in the list and the list is in turn order;
   - `round >= 1`, `reached.round >= round`, `reached.started` only names combatants in the list, and when `reached.round === round` the current combatant is in it;
   - over a whole sequence no combatant's turn starts twice in the same round;
   - `next` never lands on a down combatant;
   - HP and MP stay inside 0 to max, ids are unique, the log is at most 100 lines;
   - `parseEncounter(JSON.parse(JSON.stringify(enc)))` deep-equals `enc`.
   When it finds a failure, print the seed and the shortest prefix that fails, fix the reducer, and keep the failing sequence as a named test. List what it found in the notes (the lead reports them to the owner).
6. Mutation check: break three rules of your choice in the reducer by hand, one at a time (for example drop the `reached` check in `next`), and confirm a test fails each time. Restore the code. List the three in the notes.

## Done means

- `bun run test` passes (typecheck plus all bun tests).
- No `any`, no non-null `!` on a lookup that can miss, exhaustive switches.
- Final reply under 200 words: what you made, the last line of `bun run test`, test counts, what the property test found, anything you were unsure of.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task.

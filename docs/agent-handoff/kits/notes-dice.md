# Notes: Roll20 dice notation in the formula parser

Brief: `docs/agent-handoff/kits/brief-dice.md` (in the main checkout). Branch started at `kits` (221a979).

## Sources

No web access on this box: the proxy refuses wiki.roll20.net and help.roll20.net (403). The semantics below are Roll20's
as I remember its Dice Reference, and where I was not sure I chose the plainest reading. Those choices are listed in
"Semantics not checked against Roll20" below and named in the header of `src/core/formula.ts`.

## Progress

- Steps 1 to 5 done, one commit each on this branch.

## Step 1: the grammar

- A modified term is the existing `dice` node with an optional `mods` (a `DiceMods` record), not a new kind of
  `Formula`. `withDice` in `src/core/registry/abilities.ts` switches over every kind with `satisfies never`, so a new
  kind needs a line there, and the brief keeps me out of `registry`. A plain term stays `{ kind, count, sides }`, so
  every stored tree, room message and test that spells one out is unchanged.
- `floor`, `ceil`, `round` and `abs` could not avoid a new kind: they are `{ kind: 'fn', fn, arg }`. That needed one
  line in `withDice` (`case 'fn'`), the only edit outside `formula.ts`, `roll.ts`, tests and docs. The lead may move it
  to the registry helper's branch; the typecheck fails without it.
- Follow-up for whoever owns `src/core/combat/fight-parse.ts`: `formulaOf` reads a stored tree and drops what it does
  not know. Today it reads a dice node as `{ count, sides }`, so a saved or sent ability with `2d20kh1` loses its
  modifiers at load, and a `fn` node makes the whole formula null. It needs a `mods` reader and a `case 'fn'`.
  `diceModsOf` (step 2) is that reader.
- One existing test changed: "a die with no count says to write 1 in front" (`d6 + 2` refused). The owner's own example
  is `/r d20+4`, and the brief says N is optional, so `d6` now reads as `1d6`; the test now says so.
- Dice limits: the brief asks for 100 dice and 1000 sides as constants. The rules already hold `dice: { maxDice: 50,
  maxSides: 1000 }` (`src/core/rules.ts`), which `parseFormula`, `fight-parse` and the Dice view all read, and an
  existing test checks the parser follows the rules (`1d1001` passes with `maxSides: 2000`). A second constant would be
  a second bound for the same thing, so the rules stay the one bound: 50 dice, 1000 sides. To allow 100 dice, raise
  `RULES.dice.maxDice` (outside this brief's files).
- Formula length: the parser has no length cap today. The present caps are the input fields (the maker's formula field
  holds 200 characters, the Dice view's 60), and the kinds' recommended formulas that the registry builds as text and
  parses reach 249 characters (`recommended` with scalers), so a 200 cap in the parser would refuse built-ins. I added
  none. The Dice view's typed field should take 200, as the maker's does.
- Modifiers written with a space (`2d6 >3`) are refused; Roll20 writes them glued to the dice. Case does not matter
  (`2D20KH1`), since a phone keyboard may capitalise.
- A point outside the die's faces (`1d6r7`, `3d6>0`) is refused: it can be read, but it never matches, so it is a typo.
  Keep and drop take 1 to the dice written (`2d20kh3` is refused), so an explosion never makes `kl` or `dl` reach past
  the dice written; this keeps the expected value exact (step 2).

## Step 2: rolling stays outside core

- The two ways weighed. (a) The edge supplies a bounded stream: it rolls the most faces a term could read
  (count × 11 × 11, 6,050 for 50 dice) and core reads a prefix. One call, but it rolls thousands of faces to use a
  handful, and the bound must be kept in step with the caps in two places. (b) Core reports it needs k more: `rollOf(d,
  faces)` answers a `TermRoll` or `{ more }`, the least number of faces still needed (one per die written that has not
  stood), and the edge rolls those and asks again. Chosen: (b). It rolls exactly the faces used, a plain term is one ask
  of `count` faces (so a seeded roll of a plain term draws the same numbers as before), and the edge needs no bound of
  its own. Core stays pure: the same faces give the same roll, and a longer list reads its prefix the same way (a test).
- `evaluate` keeps its signature (one total per term in `Env.dice`): the fight's `resolve.ts`, `effect-ops.ts` and
  `effects.ts` call it and are outside this brief. The breakdown is `rolled(formula, scope, terms)`, which returns the
  total and each term's faces; the edge's `rollFormula(formula, scope, random)` rolls the terms and calls it.
- The fight pipeline needs no change for modified dice: `diceOf` now carries `mods`, `rollNeeds` and `rollSettle` call
  `rollDice`, which is `rollTerm(d).total`, so a fight gets the right total per term (for `2d20kh1` the kept face, not
  the sum of two). Only `fight-parse.ts` (above) loses the modifiers at load.
- `Face` is a union: a `rerolled` face has no `exploded` field, so "rerolled and exploded" cannot be written. The fates
  are `rerolled`, `dropped`, `kept`, `success`; `exploded` marks a standing face that added a die.
- `mean(d)` is the true expected value, so `average` and the makers' `averages` (ability-kinds.ts) read it with no
  change there. Closed form for a term with no keep or drop: count × the chain's expected length × E[face], or × P(a
  face is a success). With keep or drop it is exact by a convolution: a sum of faces is Σ over f of the number of faces
  at f or above, and the kept number at f or above needs the law of how many of all the dice are at f or above (or below
  f) only below n, so the convolution is cut at n. Cost count × n × 12 for each face value: 0.3 ms for `4d6dl1`, 200 ms
  for the worst term the rules allow (`50d1000!kh25`). Floats: `2d20kh1` is 13.825, `2d20kl1` 7.175 to 1e-15.
- `rows.ts` line 158 works out a strike's mean as `count * (sides + 1) / 2` itself; it should call `mean` so a monster's
  strike with `kh` is priced right (combat helper).
- `diceModsOf(v, count, sides)` reads a stored `mods` record with the parser's bounds, for `fight-parse.ts`.

## Step 3: advantage is this

- `tests/formula.test.ts` ("advantage is a dice term"): over all 400 pairs, `2d20kh1` is the higher face and `2d20kl1`
  the lower; their means are 13.825 and 7.175 (worked from P(higher >= f) = 1 - ((f-1)/20)^2), and a natural 20 on
  the kept die comes 39 times in 400 against 1.
- For kits wave 2 unit 22 (edges and held dice, design 8.2 and rule 7b): read the target's kept d20 through this term,
  not a second rule. The defender's edge is `2d20kh1`, the attacker's (keep the lower) `2d20kl1`, no edge `1d20`. Let
  `needs` ask for the two faces as it plans (`rolls.react`, one or two numbers), and let rule 7b read the kept face as
  `rollOf({ count: 2, sides: 20, mods: { cut: { how: 'kh' | 'kl', n: 1 } } }, [a, b]).total`, so "keep the higher" is
  written once, in `formula.ts`.

## Step 4: tests

- `tests/formula.test.ts`: a table of 23 formulas with fixed faces, the owner's three first, each with its total and every
  face's fate, worked by hand; the caps (the 11th six stands, the 11th one stands); `rollOf`'s `more`; 28 refusals with
  what each says to write; the rules' limits on a modified term and on `d%`; the stored-modifier reader; means worked by
  hand (`4d6dl1` = 15869/1296, `1d6ro1`, `10d6>5`, `3d6!`, `2d8r<2`) and 17 terms whose mean must equal a walk over
  every list of faces the term can read, each with its chance (an oracle that shares only `rollOf` with `mean`); a
  property test of 2,000 random formulas from the grammar with random faces (the total is the signed sum of its terms
  and numbers, a term is its kept faces or its successes, the kept count is the cut's, each rerolled face met a reroll
  point and each exploded one the explode point); 5,000 random texts of dice characters, read or refused, never
  thrown, and every one read prints back to the same tree.
- Found by the table: `4d6kh3` and `4d6dl1` struck different dice of two equal faces. Now of two equal faces the one
  rolled first ranks higher, so both strike the later one.
- `tests/roll.test.ts`: the roller draws what core asks and core reads the same faces the same way, over seeds; an
  exploding die asks again up to the cap; a plain term draws the same faces as before; a fight's needs with `2d20kh1`
  get one face from 1 to 20; `rollFormula` gives terms and total; 20,000 seeded rolls of `2d20kh1` average within 0.1
  of `mean`.
- `bun run test`: 2548 pass, 0 fail.

## Step 5: close, and what the Dice view's typed field needs

Added in this step for the view, in `formula.ts` with tests: `withEdge(formula, 'kh' | 'kl')` (the adv and dis
buttons: a lone plain `1d20` becomes `2d20kh1` or `2d20kl1`, as `dice.roll`'s `adv`/`dis` do today) and
`naturalOf(rolled)` (the one face the only d20 term keeps, else null: what `crit`, `fumble`, `natural` and the coin
call read).

What `dice.roll(expr, o)` in `src/views/dice.js` should do in place of its own regex:

1. `const p = parseFormula(expr, rules())`. If `!p.ok`, throw `new Error(p.error)` (the view shows the message; it says
   what to write). Drop the view's own `d%` replace, space check and limits: the parser has them.
2. `const f = o.adv && !o.dis ? withEdge(p.formula, 'kh') : o.dis && !o.adv ? withEdge(p.formula, 'kl') : p.formula`.
3. A scope: the hunter's numbers if the formula names any, `const b = app.api.hunter.sheet(h)` and `{ user: b, target:
   b, charge: 0 }` (`HunterSheet` has `stats` and `sheet`). With no hunter (the GM alone), any body works for a formula
   with no names; a formula with names and no hunter should be refused by the view with a sentence.
4. `const r = rollFormula(f, scope, () => Math.random())` from `src/edge/roll.ts`. Pass `Math.random` read at each roll,
   as `rollDie` does, so the browser tests that seed a check by replacing `Math.random` keep working.
5. The result: `total = r.total`, `natural = naturalOf(r)`, `crit = natural === 20`, `fumble = natural === 1`, `adv` and
   `dis` true only when `withEdge` changed the formula (compare `printFormula`), `expr = printFormula(f)` (the
   canonical text, `1d20 + 4` for `/r d20+4`), `rolls` = every face of every term in order (the log's list).
6. Show: the canonical text, then each term in order as its faces, a `rerolled` or `dropped` face struck through
   (`<s>`), an `exploded` face marked (Roll20 marks it; a small `!` after it does), a `success` face marked as one,
   then `= total`. A term that counts successes shows its total as "3 successes".
7. The log line (`d.rolls`) keeps its fields; `rolls` is the flat list of faces. If the log should strike dropped dice
   too, it needs the fates stored (a field of the roll in `save.ts`, outside this brief).
8. The typed field: `maxlength="200"` (the maker's formula field's length; today 60), placeholder `/r 2d20kh1 + 4`.
9. Lint: `tests/lint.test.ts` lets a view import only `parseFormula` and `printFormula` from `formula.ts`. Add
   `withEdge` and `naturalOf` there with the reason ("a typed roll's edge and its natural"). `rollFormula` is from the
   edge and needs nothing.

Other follow-ups, outside this brief's files:

- `fight-parse.ts` `formulaOf`: read `mods` through `diceModsOf` and a `case 'fn'` (above). Without it a saved ability
  with Roll20 dice loses its modifiers at load and one with `floor(...)` is refused.
- `rows.ts` line 158: call `mean` in place of `count * (sides + 1) / 2`.
- `RULES.dice.maxDice` is 50; the brief's 100 needs that one number raised.

Checks at the close: `bun run deps -- --write` and `bun run charts` changed nothing; `bun run test`: 2550 pass, 0 fail.

## Semantics not checked against Roll20

No web access (the proxy refused Roll20's sites). Chosen as the plainest reading:

1. The order: reroll, explode, keep or drop, successes, whatever order they are written in. Roll20's reference lists an
   order of its own that I could not read.
2. An added (exploded) die follows the term's reroll rule too.
3. The caps of 10 rerolls a die and 10 added dice per die written (Roll20's are higher).
4. Keep and drop take 1 to the dice written; Roll20 may allow more with explosions.
5. A point off the die (`1d6r7`) is refused; Roll20 may read it and never match.
6. `!` followed by a number is that number's explode point (`3d6!6>4` explodes on 6 and counts 4 or more).
7. `round` is JavaScript's `Math.round` (half up, so `round(-2.5)` is -2).
8. Of two equal faces under keep or drop, the one rolled first ranks higher.
9. Modifiers must be glued to the dice; `2d6 >3` is refused.

Known from memory and used as fact: `>n` is n or more and `<n` is n or less; `k` is `kh`, `d` is `dl`; `r` rolls again
until the face no longer matches, `ro` once; `!` alone explodes on the highest face; successes replace the sum.

## Principles that changed a choice

- Type-system discipline: `Face` is a union so a rerolled face has no `exploded`; `Cut.how` is Roll20's four letters as
  a union; a term with no modifiers has no `mods` at all, never `{}`.
- Boundary discipline: the text is read once by `parseFormula`; a stored record has its own reader (`diceModsOf`) with
  the same bounds; `rollOf` trusts the typed term.
- Test behaviour, not implementation: each table total and mean was worked by hand from the rule, and the mean is also
  checked against a walk over every roll, which shares only `rollOf` with `mean`.

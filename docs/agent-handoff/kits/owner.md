# Kits like Glas (the owner, Nov 14)

"Ok. Can you look at how Glas works in my TOG ACT 3 sheet? His formulas are funky you don't have to worry about copying those, but the general premise of how he works?"

Then: "Glas type kits to be makeable. If we can look at Nikolas, Einar, Maro, Hwei. Those are pretty fleshed out kits and should contain a lot of the types of customizabikity I'd like. The time abilities are a little fucky though. The rewind is unnecessary for now, delayed dmg is good though."

The sheet is the Google Sheet "ToG - Act 3" (tabs Glas, Nikolas, Einar, Maro, Hwei among others). The lead's reading: the Workshop must be able to make kits of this kind: counters on a target that abilities build and read, thresholds that trigger (an execute), costs paid in HP, scaling from missing HP, kills or stacks on the field, delayed damage, modes. Not now: a rewind to an earlier state, and the other time tricks unless they fall out of the blocks. The formulas are not copied; the building blocks are. Summaries of each kit are in this folder.

Then: "Ok we must keep in mind they must all be balanced properly, and everything must be defined with a state tree where applicable."

The lead's reading: every building block has its numbers in `RULES.fight` with a reason and a budget (what a counter, a trigger or an execute is worth against the ability kinds' bounds, design section 6), the maker shows a made kit's worth against that budget, and the balance simulation gains kit rows that must hold. Every block with states (a counter's life, a mode, a delayed hit, a summon, a zone, a limited use) is a table with a chart, like the fight's other machines.

## Execute is scaling, not a kill (the owner, Nov 14)

On the first design's execute at 35% (normal) and 25% (elite, boss): "25/35% is a lot. How about execute just does more dmg the lower health people are, the scaling and % activated should give me a suggested for the ability and I should be able to set it. There should be a counterpart for when people are higher hp. Also one for higher max hp than the player, lower max hp than the player, etc..."

The lead's reading, which replaces the threshold kill everywhere in the design: there is no instant kill. An ability (or a threshold's or trigger's damage) may carry conditional scalers, each one of a closed family that compares a pair of numbers: the target's HP share low (execute) or high (opener); the target's max HP above the user's (giant slayer) or below it (cull); the user's own HP share low (desperation) or high; and the rest of the family that falls out of the same shape (the target's current HP above or below the user's). Each has where it starts (the percent at which it activates) and how far it scales (the bonus at the extreme, linear between). The maker shows a suggested start and scale for that ability, worked out from its kind's budget so the ability stays inside its bound averaged over a fight, and the GM may type over both; past the bound the maker warns and does not refuse.

## Queue after the running units (the lead, Nov 14 15:40Z)

- Branch `dice` (Roll20 notation in `formula.ts`, core and edge, on top of `kits`): left to do when it is merged with the kits line: `fight-parse.ts` keeps dice modifiers and `fn` nodes of a stored formula (`diceModsOf` is ready); the Dice view's typed field (`notes-dice.md` says what to call); `RULES.dice.maxDice` is 50, the owner was told 100: raise it or tell him.
- Roll20's own reference could not be reached from the box; the order used is reroll, explode, keep or drop, successes.

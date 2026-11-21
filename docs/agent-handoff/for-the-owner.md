# For the owner

A running list of what needs your call. The lead adds to it and strikes a line when you answer; your answer goes into the trail (`decisions.tsv`) in your words. Newest section first. Nothing here blocks work unless it says so.

## Open

### 1. The economy on the live site (asked Nov 21)

Grades and shared gate pay are on the working branch, not on `main`. The lead is holding the PR into `main` until the items lane lands, because a consumable still costs half there, which you have replaced. Say "merge now" if you want it live as it is.

### 2. Rule calls the state machines rest on (asked Nov 20)

Each machine is being built to behave as the app does today, with the row below named in its table, so your answer is a one-row change. Each line is Neon's proposal; the lead recommends yes unless it says otherwise. Answer "yes to all" or by number.

1. Does a dead hunter get nothing from a rest or a level-up (no mana, no Exhausted cleared, no uses back)?
2. Does taking off a status clamp HP, mana and fatigue to the new maxima at once, and is max HP at least 1?
3. Does a status stop counting the moment its time runs out, even when its last tick is still owed? (Built as yes, Nov 21: before, a hold, a taunt and the fight card stopped at once while wards and buffs lasted until the bearer's turn, so one answer had to be picked to make them agree. No is one word in `STATUS_COUNTS`, `src/core/combat/standing.ts`.)
4. Does a broken channel released on its user's own turn cost the user that turn?
5. Must the owed dice be rolled before a turn can end?
6. May a hunter who is down arm a reaction, and do a reaction's kills count?
7. Does lowering max fatigue to the current fatigue collapse the hunter at once, and is a hunter who reaches full fatigue in a fight collapsed in the fight too?
8. Are pending (unconfirmed) points handed back when the level drops, and does rank follow level unless the GM marks it as set by hand?
9. Does a day feat count a fact on the day it happened, not the day the fight ended?
10. Does a feat set to never show stay hidden after it unlocks, and does a feat with an extra condition unlock when the condition becomes true later?
11. Does a shadow at 0 HP leave the field and refuse to be summoned until healed?
12. Does using a consumable in a fight take the player's turn?
13. Does the Dice view's default DC follow the active hunter's rank?
14. Does a gate the GM closes to solo runs refuse a run already in flight?
15. When an urgent quest runs out on a player's phone, does the GM's room hear of it?
16. Does a quest with any hand-ticked objective keep its Complete button?
17. Does the world day only move forward, and does a gate past its break day break whatever edit put it there?
18. Does a held Give… wait for its own two seconds even when other notices arrive?
19. Is a System whisper to one hunter sealed from the other phones?
20. Does rule (d) mean that rewards the app pays by itself (a room solo clear, a counted quest, a feat, a Give… from the shelf) wait for the GM's edit and approval?
21. How do the free first revive and the revive on debt (rule a) appear in the app: a System raise, or a GM button that spends the step?
22. Does a Resurrection Crystal handed over by another hunter after death count as bought before the death?
23. Stealth, the lead's ruling to confirm (built in unit 2): by your ruling 1 a body is hidden only from sight of a lower level, and everyone's sight starts at 0, so a hide at level 0 would hide from nobody. A hidden status with no level written is level 1, and level 0 is not offered. Say if a plain hide should be something else.
24. Icons, to confirm: the first set is taken from one outside set (game-icons, CC BY 3.0), by your ruling that drawings may come from elsewhere if they look consistent. That licence asks for credit, so the Rules page's foot gets a credit line. Say if you would rather every icon were drawn here.
25. Tenacity (his idea of Nov 21, below under Answered): a true blend, the geometric mean of Strength and Discipline through today's curve and cap (the lead's default, built unless he says otherwise), or Discipline as the base with a smaller bonus from Strength? The blend lowers a pure-Discipline build's Tenacity against today.

## Answered

- Nov 20: consumables priced by rank and how long they last (staple 0.1, one fight 0.5, one gate 1, escape stone 2): "Sure yes."
- Nov 20: crafting, professions and new item types after trade unit 2: "2.  Ok"
- Nov 20: more than two helpers when their code does not overlap: standing rule.
- Nov 20: every implicit state machine is made explicit, no scoring.
- Nov 21 (typed in the lead's session, to "a blast aimed straight at a hidden body its user can already see hits it but does not reveal it; say if every area hit should reveal"): "Yes it should hit". The lead reads it as: every area hit reveals, whoever it was aimed at.
- Nov 21 (to the ambush at 1.5 and 1.25 against a boss): "I mean the goal is that stealth will do more dmg.  Also for bosses, I don't want them to halve or quarter effects.  The goal is that they just have more hp, armor, magic resist, etc... than other enemies." So the ambush stays a damage multiplier, and a monster's kind no longer shortens or weakens what lands on it (`fight.kinds.*.control` goes): a boss or an elite is tougher by HP, armor and resist.
- Nov 21 (typed in the lead's session, after the ruling on bosses): ".  Maybe we add a stat called tenacity which works just like league tenacity, I'd probably make it a product of strength and discipline or something.  Idk maybe throwing more of a bone to those stats." Tenacity exists (derive.ts: from Discipline, cap `fight.tenacityCap` 60; effect-ops.ts `lasting`: a control status lasts duration * (100 + potency) / (100 + tenacity)); the lead told him so and proposed feeding Strength in by the geometric mean of the two stats. To build as a small unit after `rulings-1121`, measured with it by the simulation (both move how long control lasts on a boss).
- Nov 21 (typed in the old lead's session after its hand-over, relayed by that session, not yet confirmed by him in the new lead's): "Ok I think we should add in all the LoL stats.  Lethality, armor pen %, magic pen (we should give it a name like lethality), and % magic pen.  Thoughts?  Questions?" Asked which stat feeds each, whether monsters get them and whether today's flat-penetration gear becomes Lethality: "I think we should figure that out during our balance run." Then: "But I do like the idea of being able to get more % pen on items, or flat pen on items, etc..." So today's two penetration stats (`derive.ts` `pen`, a share from Control, and `penFlat`, flat, gear only, each against armor or resist, whichever the hit meets) become four (flat and percent, for armor and for resist), an item may hold each of the four, and their sources, names and numbers are settled in the enemy balance pass (`features/enemies/README.md`, item 9). A name proposed for flat magic penetration: Unravel.

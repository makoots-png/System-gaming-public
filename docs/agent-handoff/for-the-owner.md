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

## Answered

- Nov 20: consumables priced by rank and how long they last (staple 0.1, one fight 0.5, one gate 1, escape stone 2): "Sure yes."
- Nov 20: crafting, professions and new item types after trade unit 2: "2.  Ok"
- Nov 20: more than two helpers when their code does not overlap: standing rule.
- Nov 20: every implicit state machine is made explicit, no scoring.

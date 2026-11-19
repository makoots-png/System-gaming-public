# Four features after launch (the owner, Nov 16)

The run of handoff.md is finished and merged (PRs 35 and 36). The owner then picked four features from the lead's list of what the product lacks, and their order. His answers are the rulings below; a helper does not reopen them.

## His words and rulings

- "shadows are not going to be common. Your average class won't have access to them... I'd rather that real estate be used elsewhere." Done in PR 36.
- Picked: "1, 2, 5, 6". Order (his pick): **6, then 2, then 1, then 5**.
- On solo play: "I do want the player to essentially 'speedrun' a dungeon. It just takes his odds of winning and adds it". Asked what that means, he ruled:
  - **A solo run always resolves; the odds set the cost** (HP, mana and fatigue spent, and whether the hunter comes out down). No fight is played out on screen.
  - **A hunter can die on a solo run, "but resurrection is possible"** (the game already has Revive and a resurrection boon; a solo death uses the same life machine).
  - **Solo gates are both**: personal gates the System spawns for a player on a timer, with no GM needed, and any world gate the GM marks solo.
- He does not care about iOS or TestFlight.

## The four, in order

| # | Feature | What it is | Brief |
|---|---|---|---|
| 6 | How hard is this fight | The odds of a fight before it starts: the party's chance to win and what it costs them, from the real reducer played many times. The GM reads it while building a fight. Its engine is what feature 2 runs. | `brief-6-odds.md` |
| 2 | Solo runs | A player enters a solo gate alone and it resolves in one step from the odds: the cost paid, the reward given, a death possible. Personal System gates on a timer, and world gates the GM marks solo. | written when 6 lands |
| 1 | The System acts on its own | Feats noticed outside a fight (a count of kills, a survival at 1 HP, a streak): hidden quests and titles the System grants without the GM's hand, made by the GM in a maker as triggers are. | written when 2 lands |
| 5 | Players deal with each other | Trading items and gold, a party stash, a private word to the GM, a secret objective. | written when 1 lands |

Standing rules are START-HERE.md's, all in force: perfect over fast, everything explicit, the cause and not the symptom, one helper per unit on Opus with a brief, poteto mode, a helper starts no helpers, no new dependency, no attribution in commits, the lead reviews and pushes through the hook, messages to the owner short and phone-readable. Words follow `copy-tasks.md`. AGENTS.md says where each kind of thing lives.

## Resurrection (the owner, Nov 18, typed in the lead's session)

Asked how a hunter who dies alone comes back: "So GM determines resurrection. There should be a resurrection crystal but they should be incredibly expensive to buy. Or I can give them out attached to a title or a quest or a dungeon."

So: no System resurrection for a price in XP, and none for free. The way back is the GM's Revive, as today, or a Resurrection Crystal, an item. The shop sells it at a price a hunter saves a long time for, and the GM gives one in any reward (a quest's, an award's, a title's bundle, a gate's loot). The GM decides how common they are.

## Stories (the owner, Nov 18, typed in the lead's session)

"Ok something big is the story modes have to be active table by me. They should [move] entirely at the GM pace and I should be able to make my own stories. This should be perfect. Architecturally sound, clean and easy to use."

So: a story (an arc the System runs over sessions: a chain of hidden quests, a title that grows, a debt that comes due) never starts by itself. The GM turns a story on for the table, each of its steps happens when the GM says so, and the GM writes stories of his own in a maker. The System may show the GM that a step is ready; it never takes the step. A single feat noticed by the System (a count reached, a survival at 1 HP) is not a story and stays automatic, with one switch for the GM to turn the System's feats off for the table.

## A PC browser pass, last (the owner, Nov 18, typed in the lead's session)

"Then after all of our changes are done. we need to also optimize for pc browser. I mean obviously the pc version is going to be easier to use but yeah..."

So: when feature 1 (with stories and the roleplay awards) and feature 5 have landed, one pass makes the app good on a PC browser, where he expects to run the game as GM. Not before: every screen still changing would be done twice. Until then new screens stay phone-first and must not break at 1280 px (`scripts/ui-shots.ts` shoots the GM at 1280; `tests/e2e/look.e2e.ts`).

## The intro story (the owner, Nov 19, typed in the lead's session)

Of the PC pass: "Just have that in the list of stuff to do, at the very end."

"For now after you finish your next task, I want your (or the next instance [after] a handoff) help creating an intro story/mission. It does not have to be based off the solo-leveling, but there should be a reason why these players get their specialized classes. There should be a lot to choose from based on their decisions within the story. This may mean items they select, etc... I'd start them off as D class hunters doing a shit E class dungeon for scraps that turns into something hellish. Read books and stories for inspiration and exercise abstract thought (you don't have to write your reasoning just think, dream, imagine). It should have elements of horror in it. This should be bone chilling."

So: the campaign's opening mission, written with him. D-rank hunters take a worthless E-rank gate for scraps and it becomes something hellish. What each player decides inside it (what they pick up, who they save, what they refuse) is the reason their hunter comes out with its specialized class, with many classes to end in. Horror, the kind that chills. It is a story the GM runs chapter by chapter (the ruling above), so it is also the first complete story the app ships and the proof of the story maker. A first draft is `features/intro-story.md`; it is his to change.

## The intro story, second ruling (the owner, Nov 19, typed in the lead's session)

"Ok going over the story. Let's have it based in the universe of Solo Leveling. Same premise. Nobody rises above their rank. They can get very strong inside of their rank, but never surpass it. Something has to be unique about what happens inside of the dungeon which allows them to rank up. Let's have fable do two passes. Very different each. Have it post them on a Google doc. Deslop them with the various skills."

And of the writing: "I hate the ai-isms in the text" (`copy-tasks.md` has the rule: humanizer and unslop on everything written for him).

So: the opening mission is set in that world, with its hunters, gates, ranks and System, and with characters of our own. The world's law is that a rank is for life: a hunter grows strong inside its rank and never passes it. What happens in this one dungeon is the exception, and the story must say what is unique about it. Two versions by Fable, far apart from each other, each edited with the skills, each a Google Doc of his. `features/intro-story.md` and `intro-story-2.md` are the earlier drafts in a world of our own; they are material, not the base.

## The intro story is tabled (the owner, Nov 19, typed in the lead's session)

"Let's table this. First we focus on all features then I will storywrite"

So: no more story writing by a lead or a helper until the features are done, and then he writes it himself. What exists stays as his material: `features/intro-story.md`, `intro-story-2.md` (a world of our own), `intro-story-sl-a.md` ("Next of kin") and `intro-story-sl-b.md` ("The count", both in the world he named, each also a Google Doc of his). Still open from them, for him: the app lets a hunter's rank follow its level, so the law "nobody rises above their rank" is not held by the game.

The order: feature 1 (the chronicle, the roleplay awards, feats, stories the GM turns on and paces, counting quests, titles with statuses), feature 5 (players deal with each other), then the PC browser pass.

## Rulings of Nov 19, late (the owner, typed in the lead's session)

"So, cleverness is ok in the ideas. It's not ok in explanation text. Yes run it on all other text that's player or GM facing. Descriptions, info, etc... should not be clever. Names/titles are fine. Names can be unclear, but their descriptions must be clear. Nope, all PCs should be able to move up in rank/level. Go live as they land. I don't care about content being ripped off, it's whatever. For ranks let's do them as a color code, give me advice on what they should be named to. Remember architecture first for everything, and pstack rules."

So:
- **Words.** A name or a title may be clever and may be unclear. Whatever describes, explains or informs is plain and clear (`copy-tasks.md`, "Plain first"). The plain pass with a second reader runs over every sentence a player or GM reads in the whole app, not only the awards. The roleplay awards the editor could describe only thinly stay: a name may be unclear when its description is clear.
- **Rank.** Every hunter can rise in rank and level, as the app has it. No ceiling is built. (The intro story's "nobody rises above their rank" is that story's premise, for him to keep or drop when he writes it.)
- **Going live.** Each feature goes live as it lands: no more waiting for all four.
- **Borrowed names.** The shipped names from the game's inspiration stay.
- **Ranks as colours.** The ranks are to be shown as a colour code; he asked for advice on their names. Not built until he picks.
- **The design frameworks review's six questions** (the owner, Nov 19, typed in the previous lead's session and relayed to the lead: "Yes defaults"). The defaults stand as his rulings: no top level; each rank takes more fights a level than the one before; the daily keeps giving a point every day with no limit; Necromancer stays on the starting jobs; the app does not lay out a gate as rooms; the app does not itself make a red gate pay more or forbid leaving.
- **Stories.** (the owner, Nov 19, relayed the same way) "We will need to rewrite the stories anyways, so let's hold off of that." No story work until he says.
- **Stealth and Invisible in a fight** (the owner, Nov 19, typed in the lead's session, on the audit's BUG-gates-2): "they will make you untargetable by non-aimed abilities (think like how invisible works in League), or you take damage, or you are revealed, or you deal damage (these can be affected by class/skills upgrade). An attack made from invis should have a damage multiplier. Eventually there should be classes/skills that focus on invis." The lead's reading, told to him: a hidden body cannot be picked as the target of an ability that picks a target; an ability aimed at a place (a blast, a line, a zone) still hits it. It ends when the body takes damage, is revealed, or deals damage, and each of those three is a part of the status that a skill or job can change. A use made while hidden has its damage multiplied by a rule number. Built on the kits' `hidden` op and stealth machine (`standing.ts`), not a second rule; the test that pins "Invisible and Stealth do nothing the fight counts" is replaced with the rule.
- **Going live after PR 38** (the owner, Nov 19): "Merge as they land." Each batch that passes the full CI gets a PR into `main` and the lead merges it.
- **The GM sees as an enemy** (the owner, Nov 19, typed in the lead's session): "I want a view for each of the enemies I'm controlling in gm mode where I can see what they're seeing. The other one is where I can see everything obviously. That goes for invis players too. On the player side they shouldn't be able to see invis enemies." The lead's reading, told to him: the GM's map has a choice of whose eyes it shows: Everything (as today, hidden bodies dimmed), or one enemy row the GM controls, which shows only what that row sees (`sees`, `seenBy` in `space.ts`: its sight, the fog for it) and leaves out a hidden hunter it cannot see. A player's phone never holds a hidden enemy (`fightDoc` leaves it out today; a test holds it). It is a view of the scene (`mapScene` in `map-view.ts` given a viewer), never a second rule of sight. Built with the Stealth and Invisible unit, after the audit's top ten.
- **Sight against stealth** (the owner, Nov 19, typed in the lead's session): "If a hunter has the appropriate level of sight they can see enemies which are stealthed under that level". The lead's reading, told to him: a hidden status has a level and a body has a level of sight; a body sees a hidden body whose stealth level is under its own sight level, and one of an equal or higher level stays hidden from it. The same rule for every body, a hunter looking at an enemy and an enemy looking at a hunter. What a player's phone holds follows it: a hidden enemy is in the party's doc only while some hunter of the party sees it. Part of the Stealth and Invisible unit.

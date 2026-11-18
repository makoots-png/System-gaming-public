# V11: a quest's completion in one step

Goal: a completed quest and its reward are one write, so a player never sees a quest Done with nothing given. Problem:
quests.js completed a quest in up to five writes (the quest, the progress post, the chain's asked completions, the
reward, the refill) and held three rules (the streak's +1 point, a chain step's quest gives no job, the daily
recovery); the quest kinds a form offers were listed three times in two views. Smallest change: one core step
(`finishQuest`) the view writes with its post, and the kinds in core.

## Inventory (code at 755e40e)

| Row | Verdict | Where |
|---|---|---|
| Q1 | still true | quests.js:206-238 `complete`: `completeQuest` (a write), `sendUpdate` (a post), `completeAsked` (a recursive `complete` per chain step, each its writes), `applyRewards` (a write), `refill` (a write); `bonus ? 1 : 0`, `job: q.chainId ? null : ...`, `dailyTemplate.recover !== false` in the view |
| Q2 | still true | quests.js:14-16 `KINDS`, `PLAYER_KINDS`; gm.js:60 `QUEST_KINDS` |
| sweep | same class | quests.js:141-147 `chainEvent` + `completeAsked` (a chain event, then each completion in writes of its own); room-events.ts `landChain` held the one-write version of the same step by hand |

## The rows

**Q1.** Cause: each part of a completion was its own write, and its rules were the view's. Change: grant.ts
`finishQuest(save, hid, qid, day)` answers the save with the quest done (`completeQuest`: penalty, chain, streak), the
chain's asked step quests completed (`stepsReached`), the quest's reward granted (`grant`, with
`STREAK_BONUS_POINTS` beside the quest's points and no job for a chain step's own quest), and, for the day's last daily
when the template recovers, HP and mana refilled on the sheet (or `recover: 'fight'` for the fight that holds them),
with every log line. quests.js `complete` writes it in one `store.apply` together with the GM's progress post (award.ts
`sent` with a keyed post), then shows what it answered: the window lists the reward's lines as given (`granted.lines`,
so a title already held or a status not taken is not listed), the fight's parts go to the fight. Tests: quests.test.ts
"a quest finished in one step" (one save holds the quest done, the XP, the gold and the line; the recovery on the sheet
and left to the fight; the bonus point; a Job quest's job; refusals write nothing).

**Q2.** Cause: three lists of kinds in views. Change: quest-rights.ts `GM_QUEST_KINDS`, `PLAYER_QUEST_KINDS` and
`questKindsFor(role, editing)`; both GM forms and the player's form read them. The GM view's Issue quest now also offers
Daily, as the Quests panel's GM form did (for-the-owner.md).

Sweep: grant.ts `chainStep(save, hid, make, day)` is a chain event (made with the save's next ids) and the steps it
completes in one step; room-events.ts `landChain` and quests.js `chainEvent` both use it, and `completeAsked` is gone.

Principles: model-the-domain (a completion is one value the view shows); subtract-before-you-add (`completeAsked`, the
view's lists and the view's three rules deleted).

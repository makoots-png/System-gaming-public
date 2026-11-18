# V2: the GM view's actions in one step

Goal: each GM action writes its change, its posts to the room and its log line together, as a fight's end and a gate's
Clear already do. Problem: Send award was four kinds of write from gm.js; HP, Revive, a broadcast and the rules were a
write then a log line; a player's quest progress was logged under the GM's own hunter. Smallest change: one core step
per action (`gmAward`, `sent`), the view's writes going through one helper (`gmWrite`), and the quest line built in core.

## Inventory (code at c54e6f9, merged with e69d7e8)

| Row | Verdict | Where |
|---|---|---|
| N3 | still true | gm.js:351-370 `doAward`: `applyRewards` per local hunter, a `roomPost` per group, a `combat.status` per held player's status, then `addLog` |
| N4 | still true | gm.js:301-315 `sendHp`, `sendRevive`: post then `addLog`; Revive in the fight also `combat.adjust(cid, { hp: 1 })` |
| N14 | still true | quests.js:191 `hunterId: store.active().id` |
| more (audit 3) | still true | gm.js:319 `sendStatus` in a fight, one command per status with `every`; 389-390 a broadcast logged before its post; 509-512 and 518-520 rules saved, then logged |

## The rows

**N14.** Cause: the line was built in the view with the GM's active hunter as its hunter. Change: session-log.ts
`questUpdateSaid(p)` builds it with `hunterId: null`; `objectivesSum` is the one sum (the GM's quest list kept a copy).
Test: session-log.test.ts "a player's quest progress in the GM's log". Commit f9f48c0.

**N3.** Cause: each part of an award was its own write. Change: src/core/award.ts `gmAward(save, locals, rewards,
sends, day)` grants each local hunter (vitals where its fight holds them), posts each player's award (outbox) and
writes the log line, in one `store.apply`; the view flushes the outbox after. What a running fight holds goes to it
after the write, as a grant's fight parts always did (`hunter.granted` settles each local hunter's; a held player's
statuses go on its row with `combat.status`). Tests: tests/award.test.ts (one save holds the grants, the post and the
line; a hunter gone is left out; outside a room nothing is queued; a post repeated is queued once). Commit e427a5c.

**N4.** Cause: a post and its log line were two writes; Revive's row HP was a view's `+1`. Change: gm.js `gmWrite(why,
change, events, said)` writes a change, its posts and its lines with award.ts `sent`; HP and Revive to a player are
one `gmWrite` each. In this phone's fight, Revive is the new `combat.revive(cid, also)`: the row, when down
(`cardOf(...).down`), is raised to vitals.ts `REVIVE_HP` (the life table's revive HP, exported) by the fight's `adjust`,
with the `revive` post and its line as `also` in the same write (commit c2f38a1, combat.js). A status to a player's row
is one fight command: `sendStatus` takes one change (`add` or `remove`), which is all its two callers send. A broadcast
and its line are one write; the rules and their line are one write (`setOv` takes the line).

Not a fight command of its own: a `revive` command would add a column to every row of fight.ts's `TABLE`, which Lane A
is changing for V13 now; the rule's number lives in vitals.ts and the row's "down" in fight-view.ts's `cardOf`, so the
view holds no number. If Lane A adds commands to the TABLE anyway, `revive` belongs there.

`day.ts stepTime(save, now)` is new here (the award's `Day`), so gm.js did not make a fifth copy of "when a step
happens"; V5 moves the four copies (N13) onto it.

Lines in Lane A's files: combat.js and api.ts (c2f38a1: `combat.revive`).

Principles: subtract-before-you-add (`addLog` and `roomPost`-then-log collapse into `gmWrite`); model-the-domain (an
action is a change with its sends, one value).

Left: a held player's reward statuses, and a local hunter's fight parts, go to the fight after the award's write
(one fight command each). They are the fight's state, written by its reducer; a throw between leaves the award paid and
logged with a status missing from a row, which the GM sees on the card. The fight's `status` command takes one row, so
folding them into the award's write needs a fight command for several rows (Lane A's file, V13 running).
combat.js:996 (the card's toggle `adjust(r, { hp: k.down ? 1 : -k.hpMax })`) is Lane A's (V10, V3) and left.

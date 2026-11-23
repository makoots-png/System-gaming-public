# clear-preset: the /interrogate findings (Neon seat; GrokBot seat agreed and added G2, the same as F2)

Repro file: [zz-interrogate.test.ts](file:///workspace/sg-interrogate/tests/zz-interrogate.test.ts). Verified unmodified `src/` (`git status --short` shows only untracked test files).

---

## Code findings

### 1. `settleClearPreset` silently drops a payee's reward when `newEventId` cannot mint an id, while clearing the gate and permanently locking the preset `paid`
- **Where:** [pay.ts](file:///workspace/sg-interrogate/src/core/gates/pay.ts#L291-L295) (`if (!eid) continue;`)
- **Command:** `bun test tests/zz-interrogate.test.ts -t "F1:"`
- **Printed output:**
  ```text
  error: expect(received).toEqual(expected)

    {
  -   "ok": false,
  -   "why": Any<String>,
  +   "gateStatus": "cleared",
  +   "pending": 0,
  +   "presetAt": "paid",
  +   "refused": false,
  +   "stashed": [
  +     "Health Potion",
  +   ],
    }
  (fail) clear-preset adversarial repros > F1: settleClearPreset must refuse (not silently drop payee and lock preset paid) when newEventId returns null
  ```
- **Required by intent:** `settleClearPreset` must be atomic: if any payee's event id cannot be minted, it must refuse without clearing the gate, stashing items, or permanently locking `preset.at = 'paid'`.

### 2. `settleClearPreset` drops subsequent payees and duplicates the first in `pending` when `room.stamp.now + payees.length + i` collides
- **Where:** [pay.ts](file:///workspace/sg-interrogate/src/core/gates/pay.ts#L291-L295) and [pending.ts](file:///workspace/sg-interrogate/src/core/hunter/pending.ts#L107)
- **Command:** `bun test tests/zz-interrogate.test.ts -t "F1b:"`
- **Printed output:**
  ```text
  error: expect(received).toEqual(expected)

    {
      "returnedPending": [
        "Sung Jin-Woo",
  -     "Brakk",
  +     "Sung Jin-Woo",
      ],
      "savedWaiting": [
        "Sung Jin-Woo",
  -     "Brakk",
      ],
    }
  (fail) clear-preset adversarial repros > F1b: settleClearPreset must not drop second payee or duplicate first in pending when stamp.now collides
  ```
- **Required by intent:** Each non-empty payee must receive a distinct `PendingReward` in `Waiting for you` (`["Sung Jin-Woo", "Brakk"]`), or the step must refuse atomically rather than dropping `Brakk` and returning `Sung Jin-Woo` twice.

### 3. Clearing a preset gate with no hunters picked (`payees = []`) permanently locks the preset `paid` and logs fake XP/gold
- **Where:** [pay.ts](file:///workspace/sg-interrogate/src/core/gates/pay.ts#L256-L266) and [gates.js](file:///workspace/sg-interrogate/src/views/gates.js#L470-L472)
- **Command:** `bun test tests/zz-interrogate.test.ts -t "F2:"`
- **Printed output:**
  ```text
  error: expect(received).toEqual(expected)

    {
      "granted": 0,
  -   "log": "E-rank gate "Goblin Den" cleared. No one rewarded: +0 XP, 0 gold.",
  -   "presetAt": "recommended",
  +   "log": "E-rank gate "Goblin Den" cleared. No one rewarded: +220 XP, 120 gold.",
  +   "presetAt": "paid",
      "stashed": 0,
      "xpPaid": 0,
    }
  (fail) clear-preset adversarial repros > F2: clearing a preset gate with no hunters selected must not mark the preset paid or log fake XP/gold
  ```
- **Required by intent:** When zero hunters are selected (`granted: 0`, `stashed: 0`, `xpPaid: 0`), the log must not claim `+220 XP, 120 gold`, and the gate's preset must not lock as `paid` (which makes the card claim `"Clear preset paid"` and `"Paid preset items"` right after the dialog tells the GM `"No hunters were selected, so no rewards were paid."`, and prevents fixing the mistake by reopening the gate).

### 4. Reopening a gate in Edit after its preset is `paid` lets subsequent clears fall through `isActivePreset` into the rolled-loot branch and pay fresh gold and items a second time
- **Where:** [solo.ts](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L367-L386), [solo.ts](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L522-L537), and [gates.js](file:///workspace/sg-interrogate/src/views/gates.js#L132-L152), [gates.js](file:///workspace/sg-interrogate/src/views/gates.js#L346), [gates.js](file:///workspace/sg-interrogate/src/views/gates.js#L367), [gates.js](file:///workspace/sg-interrogate/src/views/gates.js#L567)
- **Command:** `bun test tests/zz-interrogate.test.ts -t "F3"`
- **Printed output:**
  ```text
  error: expect(received).toEqual(expected)

    {
  -   "extraGoldPaid": 0,
  -   "extraItemsPaid": 0,
  +   "extraGoldPaid": 2000,
  +   "extraItemsPaid": 1,
    }
  (fail) clear-preset adversarial repros > F3: reopening a paid-preset gate in Edit must not allow soloRan to roll loot and pay a second time

  error: expect(received).toEqual(expected)

  - []
  + [
  +   {
  +     "gold": 1600,
  +     "items": [
  +       "Health Potion",
  +     ],
  +   },
  + ]
  (fail) clear-preset adversarial repros > F3b: reopening a paid-preset gate in Edit must not allow soloTaken to roll loot and queue a second reward
  ```
- **Required by intent:** A paid preset can never pay twice, and nothing is rolled on a preset gate. Because `isActivePreset(g.preset)` returns `false` for `g.preset.at === 'paid'`, `soloRan`, `soloTaken`, and `gates.js` (`clearGate`/`clearPanel`) treat a reopened `paid` gate as `none` and roll/pay fresh boss gold and items a second time.

### 5. Local solo clear (`soloRan`) with a full stash returns `'stash-full'`, which is missing from `SOLO_REFUSAL_WORDS`, so `gates.js` shows no message and reports an internal error
- **Where:** [solo.ts](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L160-L177), [solo.ts](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L377), [gates.js](file:///workspace/sg-interrogate/src/views/gates.js#L350), [ui.js](file:///workspace/sg-interrogate/src/views/ui.js#L152-L153)
- **Command:** `bun test tests/zz-interrogate.test.ts -t "F4:"`
- **Printed output:**
  ```text
  error: expect(received).toBeDefined()

  Received: undefined

        at <anonymous> (/workspace/sg-interrogate/tests/zz-interrogate.test.ts:211:74)
  (fail) clear-preset adversarial repros > F4: soloRan stash-full refusal has user-facing words in SOLO_REFUSAL_WORDS (gates.js ui.wrote)
  ```
- **Required by intent:** When `soloRan` refuses `'stash-full'`, `SOLO_REFUSAL_WORDS['stash-full']` must exist so `ui.wrote('! Gate', w, SOLO_REFUSAL_WORDS)` tells the user why the run could not clear instead of showing no toast and calling `reported('write:! Gate', new Error('the screen offered a change its rule refuses: stash-full'))`.

### 6. Remote solo clear (`soloTaken`) with a full stash refuses with no `soloAnswer` (and `gates.js` `sync().once` silently swallows it while the poll cursor advances, stranding the player in `waiting`)
- **Where:** [solo.ts](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L530-L531), [gates.js](file:///workspace/sg-interrogate/src/views/gates.js#L370), [sync.ts](file:///workspace/sg-interrogate/src/edge/sync.ts#L509-L514)
- **Command:** `bun test tests/zz-interrogate.test.ts -t "F4b:"`
- **Printed output:**
  ```text
  error: expect(received).toBe(expected)

  Expected: false
  Received: true

        at <anonymous> (/workspace/sg-interrogate/tests/zz-interrogate.test.ts:232:28)
  (fail) clear-preset adversarial repros > F4b: soloTaken on a preset gate when stash is full refuses with no soloAnswer (stranding the player in waiting)
  ```
- **Required by intent:** A remote player's won solo run cannot be silently dropped on the GM's phone with no `soloAnswer` and no GM notification while the poll cursor moves past `soloRun`, stranding the player's phone permanently in `"Waiting for the GM's answer"` after they already paid the run's HP/mana/fatigue/item costs.

### 7. `soloTaken` queues an un-approvable empty `PendingReward` when the solo hunter's preset share is empty (`xp: 0, gold: 0`, items only for stash/other hunters)
- **Where:** [solo.ts](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L524-L532) (compare [pay.ts](file:///workspace/sg-interrogate/src/core/gates/pay.ts#L289) `if (isEmptyReward(rw)) continue;`)
- **Command:** `bun test tests/zz-interrogate.test.ts -t "F5:"`
- **Printed output:**
  ```text
  error: expect(received).toEqual(expected)

  - []
  + [
  +   {
  +     "at": "waiting",
  +     "from": "solo",
  +     "heard": "2026-11-22T20:00:00.000Z",
  +     "id": "d-gm-2bc7777",
  +     "name": "Kai",
  +     "rewards": {
  +       "boons": [],
  +       "gold": 0,
  +       "items": [],
  +       "job": null,
  +       "points": 0,
  +       "skills": [],
  +       "statuses": [],
  +       "title": null,
  +       "xp": 0,
  +     },
  +     "room": "ABC234",
  +     "to": "d-p1:h1",
  +     "what": "Goblin Den",
  +   },
  + ]
  (fail) clear-preset adversarial repros > F5: soloTaken with empty personal share (0 XP, 0 gold, item only to stash) must not queue an un-approvable empty PendingReward
  ```
- **Required by intent:** Empty shares must not be queued in `Waiting for you` (`gm.js` line 518 refuses Edit -> Approve on empty rewards and line 540 sends no `award` event on direct Approve).

### 8. `addItem` mints an unparseable `PresetLineId` (`pl1000000`) when a parsed save holds `pl999999`, silently deleting the added item on reload
- **Where:** [ids.ts](file:///workspace/sg-interrogate/src/core/ids.ts#L88-L91), [preset.ts](file:///workspace/sg-interrogate/src/core/gates/preset.ts#L78-L85), [preset.ts](file:///workspace/sg-interrogate/src/core/gates/preset.ts#L262-L264)
- **Command:** `bun test tests/zz-interrogate.test.ts -t "F6:"`
- **Printed output:**
  ```text
  error: expect(received).toEqual(expected)

    {
      "mintedId": "pl1000000",
  -   "parsedBack": "pl1000000",
  +   "parsedBack": null,
      "reloadedItems": [
        "Health Potion",
  -     "Iron Blade",
      ],
    }
  (fail) clear-preset adversarial repros > F6: addItem on a parsed preset holding max valid 6-digit id pl999999 must produce a parseable PresetLineId that survives save/reload
  ```
- **Required by intent:** Every `PresetLineId` minted by `addItem` from a valid parsed preset must satisfy `parsePresetLineId` and survive `parseClearPreset`/`parseGate` round-trip (and remain toggleable/assignable/removable in [gates.js](file:///workspace/sg-interrogate/src/views/gates.js#L746-L781), which gates on `parsePresetLineId`).

### 9. Paid preset record and summary attribute an item to an unpicked hunter after `settleClearPreset` sent it to the party stash
- **Where:** [preset.ts](file:///workspace/sg-interrogate/src/core/gates/preset.ts#L134-L138), [preset.ts](file:///workspace/sg-interrogate/src/core/gates/preset.ts#L236-L242), [gates.js](file:///workspace/sg-interrogate/src/views/gates.js#L470-L472)
- **Command:** `bun test tests/zz-interrogate.test.ts -t "F7:"`
- **Printed output:**
  ```text
  error: expect(received).toEqual(expected)

    {
  -   "recordedTo": null,
  -   "summary": "Clear preset paid: 200 XP, 100 gold, 1 item (1 to stash)",
  +   "recordedTo": {
  +     "hunterId": "h2",
  +     "kind": "local",
  +   },
  +   "summary": "Clear preset paid: 200 XP, 100 gold, 1 item",
    }
  (fail) clear-preset adversarial repros > F7: paid preset summary and item record must reflect Party stash when assigned hunter was not picked at Clear
  ```
- **Required by intent:** When an item assigned to an unpicked hunter (`h2`) is routed to the party stash at Clear, the locked paid record and summary (`PRESET_WORDS.summary` and `paidList` on the gate card) must show it went to `Party stash`, not to the unpicked hunter who received nothing.

---

## Words / copy findings

Checked all player- and GM-facing strings added in `git diff 2f36d5a2..HEAD` across [gates.js](file:///workspace/sg-interrogate/src/views/gates.js), [gm.js](file:///workspace/sg-interrogate/src/views/gm.js) (no user-facing strings added), and [preset.ts](file:///workspace/sg-interrogate/src/core/gates/preset.ts) against [copy-tasks.md](file:///workspace/sg-interrogate/docs/agent-handoff/copy-tasks.md) and [unslop/SKILL.md](file:///workspace/sg-pstack/.claude/skills/unslop/SKILL.md).

### 10. Arrow symbol and verbless fragment in `gates.js` waiting-rewards line
- **Proof:** [gates.js:141](file:///workspace/sg-interrogate/src/views/gates.js#L141)
  ```js
  const lines = [`${settled.pending.length} reward${settled.pending.length === 1 ? '' : 's'} waiting in GM → Waiting for you.`, ...stashLine];
  ```
- **Rules broken:** Unslop #33 ("Write whole sentences with their articles and verbs. Spell out arrows and abbreviations."): uses `→` and drops the verb ("waiting"); `copy-tasks.md` ("Where the words live": sentences belong in core, not in views).
- **Plain rewrite:** `` `${settled.pending.length} reward${settled.pending.length === 1 ? ' waits' : 's wait'} in Waiting for you on the GM screen.` ``

### 11. Title case window title in `gates.js`
- **Proof:** [gates.js:142](file:///workspace/sg-interrogate/src/views/gates.js#L142), [gates.js:147](file:///workspace/sg-interrogate/src/views/gates.js#L147), [gates.js:148](file:///workspace/sg-interrogate/src/views/gates.js#L148)
  ```js
  title: 'Gate Cleared'
  ```
- **Rules broken:** `copy-tasks.md` ("Use sentence case.") and Unslop #17 ("Sentence case headings."). Title case is neither sentence case nor the all-caps System window voice (`GATE CLEARED` in `solo.ts`). (Base lines 176–177 also had `'Gate Cleared'`; this diff adds three new occurrences.)
- **Plain rewrite:** `title: 'Gate cleared'` (or `'GATE CLEARED'` to match the System voice used in `solo.ts`).

### 12. Double passive voice in `gates.js` no-hunters line
- **Proof:** [gates.js:149](file:///workspace/sg-interrogate/src/views/gates.js#L149)
  ```js
  'No hunters were selected, so no rewards were paid.'
  ```
- **Rules broken:** Unslop #29 ("Active voice. Name the actor unless it is unknown or doesn't matter."). (Copied from base line 178.)
- **Plain rewrite:** `'You picked no hunters, so nobody got rewards.'`

### 13. Mid-sentence colon fragment, stiff passive hint, and inconsistent naming in `gates.js` Clear panel note
- **Proof:** [gates.js:572](file:///workspace/sg-interrogate/src/views/gates.js#L572)
  ```js
  <div class="gt-notes">Using preset clear reward: each selected hunter gets <span data-clearxp>${ui.fmt(n ? p.xp : 0)}</span> XP and <span data-cleargold>${ui.fmt(n ? p.gold : 0)}</span> gold. Nothing is rolled.${app.seat() === 'gm' ? ' Each hunter\'s share waits in Waiting for you on the GM screen.' : ''}</div>
  ```
- **Rules broken:**
  - Unslop #14 ("A colon goes before a list or an example, never mid-sentence as a connector.") and #33 (verbless participle fragment `Using preset clear reward:`).
  - `copy-tasks.md` & Unslop #11 ("Call one thing by one name everywhere. / One name per thing."): calls it `preset clear reward` here vs `Preset clear` / `Clear preset` in `preset.ts`.
  - Unslop #29 & `copy-tasks.md` ("Active voice" / "stiff passive hint"): `Nothing is rolled.`
- **Plain rewrite:** `` `Each selected hunter gets ${xp} XP and ${gold} gold from the clear preset. The app rolls no loot.` `` (followed by ` Each hunter's share waits in Waiting for you on the GM screen.` when `app.seat() === 'gm'`).

### 14. Inconsistent name (`Preset clear` vs `Clear preset`), button-label collision, and parenthetical fragment in `preset.ts`
- **Proof:** [preset.ts:232](file:///workspace/sg-interrogate/src/core/gates/preset.ts#L232), [preset.ts:235](file:///workspace/sg-interrogate/src/core/gates/preset.ts#L235), [preset.ts:240-241](file:///workspace/sg-interrogate/src/core/gates/preset.ts#L240-L241)
  ```ts
  clear: 'Clear preset',
  ...
  noItems: 'No items in this preset.',
  ...
  if (checked.length) parts.push(`${checked.length} item${checked.length === 1 ? '' : 's'}${toStash ? ` (${toStash} to stash)` : ''}`);
  return `${paid ? 'Clear preset paid' : 'Preset clear'}: ${parts.join(', ')}`;
  ```
- **Rules broken:**
  - `copy-tasks.md` & Unslop #11 ("Call one thing by one name everywhere."): switches between `'Preset clear'` (unpaid summary), `'Clear preset'` (paid summary, refusals), and uses `'Clear preset'` as the delete button label (`clear: 'Clear preset'`).
  - Unslop #33 ("Write whole sentences with their articles and verbs."): `'No items in this preset.'` is a verbless fragment; `(${toStash} to stash)` drops the article (`the stash` in `copy-tasks.md` glossary) and uses parentheses (Unslop #13).
- **Plain rewrites:**
  - `clear: 'Remove clear preset'`
  - `noItems: 'This clear preset has no items.'`
  - `` `${checked.length} item${checked.length === 1 ? '' : 's'}${toStash ? `, ${toStash} to the stash` : ''}` ``
  - `` `${paid ? 'Clear preset paid' : 'Clear preset'}: ${parts.join(', ')}` ``

### 15. Personified gate and vague refusal errors in `preset.ts`
- **Proof:** [preset.ts:245-246](file:///workspace/sg-interrogate/src/core/gates/preset.ts#L245-L246)
  ```ts
  'gate-done': 'A cleared or closed gate cannot change its clear preset.',
  refused: 'That change does not apply to this preset.',
  ```
- **Rules broken:**
  - `'gate-done'`: Unslop #32 ("No metaphor, aphorism, personified code, or figurative verb where a literal phrase exists.") and #29 (active voice, name the actor): the GM changes the preset, not the gate.
  - `'refused'`: `copy-tasks.md` ("A refusal says why and, where there is one, the way out.") and Unslop #27 ("Name the mechanism or the number."): vague error that hides whether the preset is paid, at the 20-item limit, or received an invalid number.
- **Plain rewrites:**
  - `'gate-done': 'This gate is cleared or closed, so you cannot change its clear preset.'`
  - `'refused': 'You cannot make this change now. The clear preset may already be paid, or it may hold all 20 items.'`

---

## Findings summary list
1. `settleClearPreset` silently drops a payee when `newEventId` returns `null`, while clearing the gate and locking `preset.at = 'paid'` ([pay.ts:291-295](file:///workspace/sg-interrogate/src/core/gates/pay.ts#L291-L295)).
2. `settleClearPreset` drops subsequent payees and duplicates the first in `pending` when `room.stamp.now` collides ([pay.ts:291-295](file:///workspace/sg-interrogate/src/core/gates/pay.ts#L291-L295)).
3. `settleClearPreset` with `payees = []` permanently marks `preset.at = 'paid'` and logs fake XP/gold even though nobody was paid and nothing was stashed ([pay.ts:256-266](file:///workspace/sg-interrogate/src/core/gates/pay.ts#L256-L266)).
4. Reopening a paid-preset gate in `editGate` causes `soloRan`, `soloTaken`, and `gates.js` (`clearGate`/`clearPanel`) to fall through `isActivePreset` and roll/pay fresh boss loot a second time ([solo.ts:367-386](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L367-L386), [solo.ts:522-537](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L522-L537), [gates.js:132-152](file:///workspace/sg-interrogate/src/views/gates.js#L132-L152)).
5. `soloRan` returns `'stash-full'`, which is missing from `SOLO_REFUSAL_WORDS`, causing `ui.wrote` in `gates.js` to show no toast and report an internal error ([solo.ts:160-177](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L160-L177), [solo.ts:377](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L377), [gates.js:350](file:///workspace/sg-interrogate/src/views/gates.js#L350)).
6. `soloTaken` returns `refuse('stash-full')` with no `soloAnswer`, which `gates.js` `sync().once` silently drops while the poll cursor advances, stranding the player in `waiting` ([solo.ts:530-531](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L530-L531), [gates.js:370](file:///workspace/sg-interrogate/src/views/gates.js#L370)).
7. `soloTaken` queues an un-approvable empty `PendingReward` when a solo hunter's preset share is empty ([solo.ts:524-532](file:///workspace/sg-interrogate/src/core/gates/solo.ts#L524-L532)).
8. `addItem` on a parsed preset holding `pl999999` mints `pl1000000`, which fails `parsePresetLineId` and silently deletes the added item on reload ([ids.ts:88-91](file:///workspace/sg-interrogate/src/core/ids.ts#L88-L91), [preset.ts:78-85](file:///workspace/sg-interrogate/src/core/gates/preset.ts#L78-L85)).
9. Paid preset record and `PRESET_WORDS.summary` still attribute an item to an unpicked hunter after `settleClearPreset` sent it to `Party stash` ([preset.ts:134-138](file:///workspace/sg-interrogate/src/core/gates/preset.ts#L134-L138), [preset.ts:236-242](file:///workspace/sg-interrogate/src/core/gates/preset.ts#L236-L242)).
10. Copy: `gates.js:141` uses literal arrow `→` and verbless fragment (`GM → Waiting for you`).
11. Copy: `gates.js:142,147,148` uses title case (`Gate Cleared`).
12. Copy: `gates.js:149` uses double passive (`No hunters were selected, so no rewards were paid.`).
13. Copy: `gates.js:572` uses mid-sentence colon fragment, inconsistent naming (`preset clear reward`), and stiff passive (`Nothing is rolled.`).
14. Copy: `preset.ts:232,235,240-241` mixes names (`Preset clear` vs `Clear preset` vs delete button `Clear preset`), verbless fragment (`No items in this preset.`), and parenthetical missing article (`(1 to stash)`).
15. Copy: `preset.ts:245-246` personifies the gate (`A cleared or closed gate cannot change its clear preset.`) and gives a vague refusal (`That change does not apply to this preset.`).

# mythic-phases-on: the /interrogate findings (Neon seat; GrokBot reran the unit repros: findings 2, 4 and 7 fail as reported)

Waiting for the full unit test suite (`bun run test`) and the Playwright adversarial probes (`tests/e2e/zz-phases.e2e.ts`) to finish running.
Waiting for `tests/e2e/zz-phases.e2e.ts` to finish running and capture updated screenshots.
### Summary of checks run

- `bun run test` passed (6,416 pass, 3 skip, 5 todo, 0 fail, including typecheck, lint, and all balance simulation bounds).
- `E2E_CHROMIUM=/opt/google/chrome/chrome bunx playwright test tests/e2e/mythic.e2e.ts --workers=1 --output=/tmp/pw-int-phases` passed (7/7).
- Old save with no `mythic` field in `rulesOverrides` loads cleanly with `fight.mythic.scripts === true` ([zz-phases.test.ts](file:///workspace/sg-int-phases/tests/zz-phases.test.ts#L35-L44)). An old room `rules` doc with no `mythic` field reads as `{ scripts: false }` and overrides the player's default ([zz-phases.test.ts](file:///workspace/sg-int-phases/tests/zz-phases.test.ts#L59-L66), matching [protocol.test.ts](file:///workspace/sg-int-phases/tests/protocol.test.ts#L1147)).
- Pre-existing base issue (already present at `bb36a784`): `parseFight` drops an entire saved fight if legacy rows omit the `mythic` property ([zz-phases.test.ts](file:///workspace/sg-int-phases/tests/zz-phases.test.ts#L46-L57)).

---

### Findings

#### 1. Player's Rules screen ignores the room's mythic switch once cached (stale `sig` in `src/views/rulesref.js`)
A player who opens Rules before joining a room whose GM turned mythic phases off-or while in a room before the GM flips the switch off-keeps seeing the `#rr-mythic` ("How a mythic fights") section and its TOC entry because [rulesref.js](file:///workspace/sg-int-phases/src/views/rulesref.js#L260-L262) keys `body.dataset.sig` on `store.get().rulesOverrides` instead of live `rules()`. Room rules are never written to the player's save, so `update(el)` returns early even after `hunterApp.rules().fight.mythic.scripts` becomes `false` (this becomes a default-path bug now that phases start `true` on every player phone).

- **Exact command:**
  ```
  E2E_CHROMIUM=/opt/google/chrome/chrome bunx playwright test tests/e2e/zz-phases.e2e.ts -g "Rules" --workers=1 --output=/tmp/pw-int-phases
  ```
  *(Executed as part of `E2E_CHROMIUM=/opt/google/chrome/chrome bunx playwright test tests/e2e/zz-phases.e2e.ts --workers=1 --output=/tmp/pw-int-phases`, tests 1 and 4.)*
- **Output printed:**
  ```
    1) zz-phases.e2e.ts:125:5 › probe: player who viewed Rules before joining a room with phases off keeps seeing "How a mythic fights"
      Error: Timed out 15000ms waiting for expect(locator).toHaveCount(expected)
      Locator: locator('#rr-mythic')
      Expected: 0
      Received: 1

    4) zz-phases.e2e.ts:186:5 › probe: player in room viewing Rules does not update when GM flips mythic switch off
      Error: Timed out 15000ms waiting for expect(locator).toHaveCount(expected)
      Locator: locator('#rr-mythic')
      Expected: 0
      Received: 1
  ```
- **Output the intent requires:** `locator('#rr-mythic')` count is `0` on the player's phone once the room's `rules` doc has `mythic.scripts: false`, because a player's phone follows the room's switch.

---

#### 2. Flipping the GM's mythic switch off during fight `setup` leaves the mythic in phases when the fight starts
The GM switch hint in [rules-text.ts](file:///workspace/sg-int-phases/src/core/rules-text.ts#L221) says: `"While this is off, a mythic fights like any other monster. A fight already running keeps the way it began."` Because mythic phases are now on by default, adding a mythic during `setup` (before tapping **Start fight**) stamps `row.mythic` onto the row immediately in `monsterRows`. If the GM then turns the switch off before starting the fight, tapping **Start fight** still runs the mythic in phases.

- **Exact command:**
  ```
  bun test tests/zz-phases.test.ts
  ```
  and
  ```
  E2E_CHROMIUM=/opt/google/chrome/chrome bunx playwright test tests/e2e/zz-phases.e2e.ts --workers=1 --output=/tmp/pw-int-phases
  ```
- **Output printed:**
  Unit (`tests/zz-phases.test.ts:84`):
  ```
  error: expect(received).toBeNull()
  Received: {
    at: "calm",
    script: "angel-of-the-last-trumpet",
    phase: 0,
    beat: 0,
    since: 0,
  }
  (fail) mythic-phases-on adversarial probes > probe: setup fight with mythic added before flipping switch off still starts with phases on
  ```
  Browser (`tests/e2e/zz-phases.e2e.ts:248`):
  ```
    6) zz-phases.e2e.ts:233:5 › probe: GM flipping mythic switch off during setup (not yet running) still starts fight with phases on
      Error: expect(received).toBeNull()
      Received: {"at": "calm", "beat": 1, "phase": 0, "script": "angel-of-the-last-trumpet", "since": 0}
  ```
- **Output the intent requires:** Either starting a `setup` fight after turning the switch off starts the mythic with `mythic: null` (no phases), or the switch hint states accurately that mythics already added to setup keep the setting they were added with.

---

#### 3. GM's `Next phase` button renders during `setup`, opens a confirmation dialog, and silently fails on confirm
Because phases are on by default, adding any mythic in `setup` immediately renders the mythic strip and the `Next phase` button ([combat.js](file:///workspace/sg-int-phases/src/views/combat.js#L1270-L1277)). Tapping `Next phase` opens `"Move The Angel of the Last Trumpet to The First Breath now? Its HP drops to 65%."`, and tapping **Move it** sends `{ type: 'mythic', by, step: 'next' }`, which `reduce` refuses with `{ type: 'refused', reason: 'notNow' }` ([fight.ts](file:///workspace/sg-int-phases/src/core/combat/fight.ts#L760)) with no user feedback and no phase change.

- **Exact command:**
  ```
  E2E_CHROMIUM=/opt/google/chrome/chrome bunx playwright test tests/e2e/zz-phases.e2e.ts --workers=1 --output=/tmp/pw-int-phases
  ```
- **Output printed:**
  ```
    5) zz-phases.e2e.ts:214:5 › probe: GM tapping Next phase during setup opens confirm and silently fails
      Error: Timed out 15000ms waiting for expect(locator).toContainText(expected)
      Locator: locator('#view-combat').locator('.myth-phase')
      Expected string: "Phase 2 of 3"
      Received string: "Phase 1 of 3: The Trumpet Raised"
  ```
  (Confirmed in [zz-phases.test.ts](file:///workspace/sg-int-phases/tests/zz-phases.test.ts#L87-L95): `reduce(setup, { type: 'mythic', by: combatantId('m1'), step: 'next' }, ...).effects` is `[{ type: 'refused', reason: 'notNow' }]`.)
- **Output the intent requires:** During `setup`, the `Next phase` button should not be offered (or tapping **Move it** should advance the phase rather than silently failing).

---

#### 4. `omenOnYou` never warns a player standing inside a self-centered blast omen (`The First Breath`)
In [fight-view.ts](file:///workspace/sg-int-phases/src/core/combat/fight-view.ts#L485), `if (aim === m.id) return omen.aim === 'all' ? ... : null;` returns `null` for `omen.aim === 'self'` even when the move is a blast (`The First Breath`, reach 4) and the player's hunter stands 1 tile from the Angel inside the marked area.

- **Exact command:**
  ```
  bun test tests/zz-phases.test.ts
  ```
  and
  ```
  E2E_CHROMIUM=/opt/google/chrome/chrome bunx playwright test tests/e2e/zz-phases.e2e.ts --workers=1 --output=/tmp/pw-int-phases
  ```
- **Output printed:**
  Unit (`tests/zz-phases.test.ts:111`):
  ```
  error: expect(received).toBe(expected)
  Expected: "You are in the marked tiles."
  Received: null
  (fail) mythic-phases-on adversarial probes > probe: omenOnYou fails to warn a player standing in The First Breath (self-aimed blast) tiles
  ```
  Browser (`tests/e2e/zz-phases.e2e.ts:254`):
  ```
    7) zz-phases.e2e.ts:251:5 › probe: player standing 1 tile from Angel during The First Breath gets no "You are in the marked tiles." warning
      Error: Timed out 15000ms waiting for expect(locator).toHaveText(expected)
      Locator: locator('#view-combat').locator('.myth-you')
      Expected string: "You are in the marked tiles."
      Received: <element(s) not found>
  ```
- **Output the intent requires:** `omenOnYou` returns `"You are in the marked tiles."` and the player's banner displays `.myth-you` when the hunter stands within `move.reach` of the mythic for a self-centered blast omen.

---

#### 5. At 390 px wide, the GM mythic switch has 0 px spacing between label and button, no active/pressed styling, and unstyled hint text
`.cmb-mythsw` and `.cmb-hint` in [combat.js](file:///workspace/sg-int-phases/src/views/combat.js#L1013) and [combat.js](file:///workspace/sg-int-phases/src/views/combat.js#L1296) have no CSS rules anywhere in the app, and `[data-mythsw-btn]` is not inside `.seg` or `.mk-chip`, so `aria-pressed="true"` gets no pressed highlight ([app.css](file:///workspace/sg-int-phases/public/app.css#L249)). Visually at 390 px ([gm-switch-on.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/gm-switch-on.png)), `MYTHICS FIGHT IN PHASES` butts flush against the `On` button's left border (`0 px` gap).

- **Exact command:**
  ```
  E2E_CHROMIUM=/opt/google/chrome/chrome bunx playwright test tests/e2e/zz-phases.e2e.ts --workers=1 --output=/tmp/pw-int-phases
  ```
- **Output printed:**
  ```
    3) zz-phases.e2e.ts:173:5 › probe: at 390px, GM switch label touches button with 0px gap and has no pressed styling
      Error: GM switch label and button should have visible spacing
      expect(received).toBeGreaterThanOrEqual(expected)
      Expected: >= 6
      Received:    0
  ```
- **Output the intent requires:** Every screen a table sees by default reads right at 390 px wide: the switch label and toggle button should have visible separation, clear pressed styling when `On`, and muted hint typography.

---

#### 6. At 390 px wide, mythic Bestiary entries wrap `40,000` XP mid-number (`40,00` / `0`) and double-number phases (`1. Phase 1:`)
In [bestiary.js](file:///workspace/sg-int-phases/src/views/bestiary.js#L142-L145), the 5-column `.bst-vit` grid plus `overflow-wrap: anywhere` breaks every S-rank mythic's `40,000` XP into two lines (`40,00` / `0`) at 390 px ([bestiary-angel.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/bestiary-angel.png), [bestiary-zaratan.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/bestiary-zaratan.png)). In addition, [bestiary.js](file:///workspace/sg-int-phases/src/views/bestiary.js#L191) renders `mythicCodexLines` inside `<ol class="bst-phases">` while each item already begins with `Phase 1:`, producing `1. Phase 1:`, `2. Phase 2:`, `3. Phase 3:`.

- **Exact command:**
  ```
  E2E_CHROMIUM=/opt/google/chrome/chrome bunx playwright test tests/e2e/zz-phases.e2e.ts --workers=1 --output=/tmp/pw-int-phases
  ```
- **Output printed:**
  ```
    2) zz-phases.e2e.ts:159:5 › probe: at 390px, mythic bestiary XP wraps mid-number ("40,00" / "0")
      Error: XP "40,000" should stay on one line, not break mid-number
      - Expected  - 1
      + Received  + 1
        Object {
      -   "rects": 1,
      +   "rects": 2,
          "text": "40,000",
        }
  ```
- **Output the intent requires:** `40,000` stays on one line (`rects: 1`) at 390 px, and phase entries do not duplicate list numbers (`1. Phase 1:`).

---

#### 7. "Stars Fall" omen banner still ships British spelling `"centre"` (and mixed bullet punctuation)
[fight-view.ts](file:///workspace/sg-int-phases/src/core/combat/fight-view.ts#L457-L458) renders `"Leave its centre tile empty, so no hunter stands on it: cancels it"` in the Stars Fall omen banner (flagged in `questionable-decisions.md` row 52 to change to `"center"` before enabling phases by default, still unfixed).

- **Exact command:**
  ```
  bun test tests/zz-phases.test.ts
  ```
- **Output printed:**
  ```
  error: expect(received).not.toContain(expected)
  Expected to not contain: "centre"
  Received: "Leave its centre tile empty, so no hunter stands on it: cancels it\nStep out of the marked tiles to dodge it."
  (fail) mythic-phases-on adversarial probes > probe: omenBanner for Stars Fall uses British spelling "centre" instead of "center"
  ```
- **Output the intent requires:** American spelling (`"center"`) matching the rest of the UI (`"Armor"`, `"Color"`, `"Defense"`), with consistent bullet punctuation.

---

### 390×844 Screenshot Review & Plain-Voice Audit

All screenshots were captured at viewport `390×844` via `tests/e2e/zz-phases.e2e.ts` and inspected directly:

1. **[bestiary-angel.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/bestiary-angel.png)**: The Angel of the Last Trumpet in Bestiary (phases on)
   - **Layout:** No horizontal scroll/clipping/overlap, **but** `XP` breaks mid-number (`40,00` / `0`), and phases double-number (`1. Phase 1:`, `2. Phase 2:`, `3. Phase 3:`).
   - **Plain voice:** No semicolons, em dashes, or `"just"`. Note/description/phase lines are figurative/dramatic lore (`"It has held the trumpet to its lips since the beginning and waits for the word."`, `"A figure whose feet stand on the earth and whose head is above the sky..."`, `"The trumpet sounds."`, `"The fight: A countdown: ..."` has double colons).

2. **[bestiary-zaratan.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/bestiary-zaratan.png)**: Zaratan, the Island That Wakes in Bestiary (phases on)
   - **Layout:** Same `40,00` / `0` mid-number XP wrap and `1. Phase 1:` double numbering. Also displays base stats (`HP 1,336`, `ARMOR 92`, `RESIST 10`) rather than its scripted Phase 1 fight stats (`0.92×` HP and Even Guard + Shell `81/51`).
   - **Plain voice:** No semicolons, em dashes, or `"just"`. British spelling `"Jaws Like a Harbour"` beside `"ARMOR"`; double colon and figurative/personified lines (`"The fight: The ground: each Sinking floods tiles..."`, `"The island stirs. Where it sinks, the sea stays."`, `"...and then it remembers the deep."`).

3. **[gm-switch-on.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/gm-switch-on.png)**: GM Fight tools switch (`Mythics fight in phases`)
   - **Layout:** `MYTHICS FIGHT IN PHASES` touches the `On` button with `0 px` gap; `On` button has no active/pressed fill; hint paragraph uses unstyled body text size/color.
   - **Plain voice:** Clean plain voice (no semicolons, em dashes, `"just"`, or personification), though `"A fight already running keeps the way it began."` is inaccurate for `setup` fights (Finding 2).

4. **[omen-banner-gm.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/omen-banner-gm.png)** & **[omen-banner-player.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/omen-banner-player.png)**: Angel's `Weighed and Found Wanting` omen banner (GM & player)
   - **Layout:** Clean wrapping, no text clipping or overlap inside the strip or banner. On GM view, `Drop the omen` / `Next phase` sit just at the viewport fold above the bottom nav (scrollable, not clipped horizontally).
   - **Plain voice:** No semicolons, em dashes, `"just"`, or personified objects. Minor punctuation inconsistency: bullet 1 has no trailing period (`"...: cancels it"`), bullet 2 ends with a period (`"Dodge it or resist it, like any attack."`).

5. **[stars-fall-gm.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/stars-fall-gm.png)** & **[stars-fall-player.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/stars-fall-player.png)**: Angel's `Stars Fall` omen banner (GM & player)
   - **Layout:** Clean wrapping, no clipping or overlap; player clearly sees `"You are in the marked tiles."`.
   - **Plain voice / wording:** Contains British spelling `"centre"` (`"Leave its centre tile empty, so no hunter stands on it: cancels it"`, Finding 7) and the same bullet-period inconsistency; no semicolons, em dashes, `"just"`, or personification.

6. **[mythic-strip-gm.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/mythic-strip-gm.png)** & **[mythic-strip-player.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/mythic-strip-player.png)**: Mythic strip (calm state, GM & player)
   - **Layout:** No clipping or overlap. GM shows HP bar with gate notch at 65%, `HP 100% · gate at 65%`, `Clock: 4 rounds left`, `Next omen: Stars Fall, in 2 turns.`, and `Next phase`; player shows band `Healthy · gate at 65%` and `Clock: 4 rounds left` with no exact HP.
   - **Plain voice:** Clean plain voice throughout (no semicolons, em dashes, `"just"`, or figurative/personified lines).

---

### Findings List & Screenshot Paths

**Findings (7):**
1. Player's Rules screen ignores the room's mythic switch once cached (`src/views/rulesref.js`)
2. Flipping the GM's mythic switch off during fight `setup` leaves the mythic in phases when the fight starts
3. GM's `Next phase` button renders during `setup`, opens confirm, and silently fails (`refused: notNow`)
4. `omenOnYou` never warns a player standing inside a self-centered blast omen (`The First Breath`)
5. At 390 px, the GM mythic switch has `0 px` gap between label and button and no pressed styling
6. At 390 px, mythic Bestiary entries wrap `40,000` XP mid-number (`40,00` / `0`) and double-number phases (`1. Phase 1:`)
7. "Stars Fall" omen banner still uses British spelling `"centre"`

**Repro files:**
- [tests/zz-phases.test.ts](file:///workspace/sg-int-phases/tests/zz-phases.test.ts)
- [tests/e2e/zz-phases.e2e.ts](file:///workspace/sg-int-phases/tests/e2e/zz-phases.e2e.ts)

**Screenshot paths:**
- [docs/agent-handoff/ui-pass/mythic-phases-on/bestiary-angel.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/bestiary-angel.png)
- [docs/agent-handoff/ui-pass/mythic-phases-on/bestiary-zaratan.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/bestiary-zaratan.png)
- [docs/agent-handoff/ui-pass/mythic-phases-on/gm-switch-on.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/gm-switch-on.png)
- [docs/agent-handoff/ui-pass/mythic-phases-on/omen-banner-gm.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/omen-banner-gm.png)
- [docs/agent-handoff/ui-pass/mythic-phases-on/omen-banner-player.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/omen-banner-player.png)
- [docs/agent-handoff/ui-pass/mythic-phases-on/stars-fall-gm.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/stars-fall-gm.png)
- [docs/agent-handoff/ui-pass/mythic-phases-on/stars-fall-player.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/stars-fall-player.png)
- [docs/agent-handoff/ui-pass/mythic-phases-on/mythic-strip-gm.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/mythic-strip-gm.png)
- [docs/agent-handoff/ui-pass/mythic-phases-on/mythic-strip-player.png](file:///workspace/sg-int-phases/docs/agent-handoff/ui-pass/mythic-phases-on/mythic-strip-player.png)

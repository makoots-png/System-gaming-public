# Save fields that modules write and the store examples miss

From a search helper of the first save parser helper (2026-11-12). Verify each with grep before relying on it.

Below is every field that code outside `store.js` writes into the save and that is missing from the example objects at lines 38-66. Each line number points to one place that writes the field. `fixObj` keeps unknown keys, so all of these survive `normalize()`. Unless a path says otherwise, it is under `./.claude/worktrees/agent-a100301e080ab1961/src/`.

### Top-level state (two new keys, not in `stateEx`)
| Field | Type / values | Written at |
|---|---|---|
| `codex` | map from `"<base name lowercased>\|<rank>"` to `{name, rank:'E'..'S', kills:number, firstAt:ISO, lastAt:ISO, monsterId:string\|null, room?:true, info?:{hp, ac, atk, dmg:string, abilities:string[≤4]}}`. `room` and `info` only appear on entries copied from the GM's room doc. | views/bestiary.js:145 (defeat), :191 (from room), :211 (merge), :364 (sets `monsterId` to null) |
| `codexSeen` | string[] of combatant ids, at most 400 | views/bestiary.js:146-147 |

### settings.sync
| Field | Type / values | Written at |
|---|---|---|
| `gmKey` | string \| null. Holds the key for the current room only. | edge/sync.js:357 (create), :376 (null on player join), :501 (rejoin as GM); views/room.js:220 (null) |
| `gmKeys` | object `{ROOMCODE: key}`. Room code matches `/^[A-HJ-NP-Z2-9]{6}$/`. At most 10 entries, newest inserted last. | edge/sync.js:14 (`ringKeep`), :369 (drops a stale key); views/room.js:220 (forget) |
| `keyed` | boolean | edge/sync.js:230 (via `setSync`), :357, :377, :425, :552 |
| `lastRoom` | null \| `{code}` (left the room) \| `{code, gone:true}` (room gone) | edge/sync.js:65 (null), :66 and :255 (`{code, gone:true}`), :552 (`{code}`) |
| `boundHunterId` | hunter id string | edge/sync.js:274, :379, :484; views/hunter.js:201 |
| `deviceToken` | 32-character base36 string | edge/sync.js:40 |
| `joinedAt` | ISO string in server time (`srvNow`) | edge/sync.js:377, :484 |
| `forgetQueue` | array of `{room: code, hid: hunterId}`, last 20 kept | edge/sync.js:454 (push), :459 (`dropForget`), :468; views/hunter.js:201 |
| `gmKeyLoose` | string, deleted once claimed | edge/sync.js:494 (set), :365 (delete); views/room.js:220 (delete) |

- `copyInvite` is not saved. It is a function on `app.api.sync` (edge/sync.js:614, :627).
- views/io.js:98 copies `gmKey`/`gmKeys` into an incoming import. views/io.js:164 strips them from an export.
- No other `settings` fields are written. `sound` is already in `settingsEx` (written at views/custom.js:146 and views/io.js:202).

### Hunter
| Field | Type / values | Written at |
|---|---|---|
| `deathSaves` | `{s:number, f:number, stable:boolean}`. Created when HP reaches 0 and deleted when HP > 0. | views/hunter.js:113 (create), :114 (delete), :434-437 (rolls), :422 (stabilize) |

`updatedAt` is in the example but nothing ever writes it. No rest, room or other hunter fields are written.

### Hunter condition / combatant condition entries
Entries are `{key, rounds:number|null, def?}`, where `def` is `{label, desc, color?:'#rrggbb', ops?, checkMod?}`. They are written at views/hunter.js:75, views/combat.js:69 and views/quests.js:306. `src` is normalized by the store, but no module writes it.

### Quest
| Field | Type / values | Written at |
|---|---|---|
| `chainId` | string, made by `store.id('c')`, e.g. `'c123'` | views/quests.js:153 (value from :165) |
| `step` | integer 1-3 (clamped to 1..99) | views/quests.js:153, next step at :253 |
| `chainJob` | `'Necromancer'\|'Assassin'\|'Mage'\|'Tanker'\|'Healer'\|'Fighter'\|'Ranger'` | views/quests.js:153 |

- `rewards`: `cleanRewards` (views/quests.js:126) keeps only xp, points, gold, items, titleName and job, so there are no extra keys.
- `rewards.items[]` have **no `id`** and may carry `effects` (views/quests.js:124).
- Objectives are only `{label, target, progress}` (views/quests.js:116).

### Skill
| Field | Type | Written at |
|---|---|---|
| `perk` | build path id string | Only edge/store.js:192 (`perkSkill`). No other module writes it; views/skills.js:75 and :81 only read it. |

### Item (hunter items, library items, shop entries)
| Field | Type | Written at |
|---|---|---|
| `effects` | sanitized op array, at most 8: `{op:'heal'\|'mp'\|'fatigue'\|'damage', dice?, amount?}` \| `{op:'mod', stat:'ac'\|'atk'\|'dmg'\|'check', value}` \| `{op:'applyStatus', status, rounds, def?}` \| `{op:'cureStatus', status}` \| `{op:'note', text}`, each with optional `when:'use'\|'equip'\|'turn'` | views/inventory.js:79; views/loot.js:206; views/quests.js:124 |
| `fatigue` | integer 0-100 (removes that much fatigue on use) | views/inventory.js:78; views/loot.js:203 |

`clean()` in views/inventory.js:64 spreads `...r`, so any other unknown keys on an item pass through too.

### Monster (`state.monsters`)
| Field | Type | Written at |
|---|---|---|
| `elite` | `true` (only present when true) | views/bestiary.js:91 |
| `auto` | `true` (monster added automatically on first defeat) | views/bestiary.js:92 (set from :138) |
| `statusDefs` | StatusDef[], at most 8 | views/bestiary.js:92 (from :136-138) |

### Shadow
| Field | Type | Written at |
|---|---|---|
| `baseHp` | number | views/shadows.js:23, :139 |

### Encounter
| Field | Type | Written at |
|---|---|---|
| `shareInit` | boolean. Missing means true. | views/combat.js:838 |

- `ended`, `by`, `currentId`, `list` and `at` exist only in the `_encounter` room doc (views/combat.js:595, :607). They are not saved.
- `summary` is set only on the snapshot sent with `combat:end` (views/combat.js:511), not on the save.
- No `pending`, `xp` or `loot` fields are written. `pend` is a module variable.

### Combatant
| Field | Type / values | Written at |
|---|---|---|
| `initMod` | integer | views/combat.js:132, :137, :144, :455, :904; views/bestiary.js:75 |
| `tie` | number in [0,1), initiative tie-break | views/combat.js:199, :842 |
| `remote` | string `'<deviceId>:<hunterId>'`, at most 80 characters (proxy for a remote player) | views/combat.js:137, :152 |
| `atk` | integer | views/combat.js:145, :456, :905; views/bestiary.js:76 |
| `dmg` | dice string | same lines as `atk` |
| `rank` | `'E'\|'D'\|'C'\|'B'\|'A'\|'S'` | views/combat.js:145, :456; views/bestiary.js:76 |
| `boss` | boolean | views/bestiary.js:76 |
| `xp` | integer | views/bestiary.js:76; views/combat.js:456, :905 |
| `extractable` | boolean | views/bestiary.js:76; views/combat.js:457, :905 |
| `abilities` | string[], at most 20, each at most 500 characters | views/combat.js:145, :153; views/bestiary.js:77 |

None of `hid`, `monsterId`, `shadowId`, `elite` or `statuses` is written. Monsters and shadows use `refId`. views/shadows.js:50 sets `elite` only on a local copy.

### Gate, world, log, roll
- **Gate:** no new fields. `monsters[]` entries are `{monsterId, count:1..26}` (views/gates.js:55, :481). No `loot`, `dc` or `spawn`.
- **World:** only `day` and `lastDailyKey`, both already in the example.
- **Log:** entries match `logEx`. `kind` is one of `system`, `gate`, `combat`, `quest`, `rank`.
- **Rolls:** entries match `rollEx` (views/dice.js:101).

### Collection shapes
- **`library`:** `{items: Item[]}`, at most 200. Each item is the forged item plus an `id` and may have `fatigue` and `effects`. Saved at views/loot.js:220-228, deleted at :231.
- **`shop`:** null (use the default list) or an array of `clean()` items with no `id`. Written at views/inventory.js:358-360 (copies the default list on first edit, then replaces by name or pushes), :400 (splice), :403 (reset to null).
- **`lootTables`:** nothing in `src` writes it. It is only read at views/inventory.js:96, so it can only arrive through an import. The shape read is `{[rank]: [{w:number>0, item?:Item, gold?:[lo,hi]}]}` or null.
- **`rulesOverrides`** (helper `setOv` at views/gm.js:95):
  - `gmTables`: `{encounter?:{E..S: string[]}, urgent?: string[] ("title | desc | xp"), npc?: string[], whisper?: string[]}`, at most 200 lines of up to 300 characters (views/gm.js:460-461).
  - `gateNames`: string[] (views/gm.js:459).
  - `conditions`: `{[key]: {...StatusDef, custom:true}}` (views/forge.js:29, delete at :246).
  - `build`: `{enabled?:boolean, playerPick?:boolean}` (views/custom.js:342, trimmed at :355, deleted with `paths` at :344). Nothing writes `paths`.
  - Saving the rules editor replaces the whole object with the validated JSON while keeping `gmTables` (views/gm.js:519). Reset keeps `gmTables` and custom `conditions` (views/gm.js:529).

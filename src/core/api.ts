// What each module puts on `app.api`: one type per API name, and `AppApi`, which maps each name to its type.
// The compiler checks every use against these types: the TypeScript callers with tsconfig.json, the JavaScript views
// with tsconfig.views.json (each view's `register(app)` takes the `App` of src/views/app.ts). `tests/deps.test.ts`
// checks what a type cannot: every member declared here is registered by its module, and every one is used. Types are
// what the module answers: a shape a view builds and reads alone stays `unknown` or a record rather than a guess.

import type { FeatBook } from './hunter/feats.ts';
import type { End, Op, SheetStatus, Source, StackRule, StatusDef } from './combat/effect-ops.ts';
import type { Trigger } from './combat/triggers.ts';
import type { LootDrop } from './gates/spawn.ts';
import type { DocName, DocOf, EventBody, EventId, EventStamp, EventType, HunterFace, QuestOffer, RoomCode, RoomEvent, SystemKind, UsedWhat } from './protocol.ts';
import type { Hunter, Item, Monster, Objective, QuestKind, Rank, Rewards, Save, Skill, Slot } from './save.ts';
import type { TableSeen } from './sync/fight-heard.ts';
import type { Stats } from './stats.ts';
import type { Applied, Refused, Step, TOLD } from './save-step.ts';
import type { Granted, StepDone, SystemRaised } from './hunter/grant.ts';
import type { StatusIn } from './hunter/conditions.ts';
import type { HeldParts } from './combat/fight-save.ts';
import type { Archetype, MonsterKind, Sheet } from './hunter/derive.ts';
import type { Checks } from './hunter/sheet.ts';
import type { RewardBundle, SystemWords } from './rewards.ts';
import type { PackKind } from './pack.ts';
import type { Connection, RosterEntry } from './sync/connection.ts';
import type { Call } from './sync/outbox.ts';
import type { ItemTemplate } from './registry/items.ts';
import type { HeldItem, ItemGrant, ResolvedGrant, ResolvedItem } from './registry/item-book.ts';
import type { IconItem } from './registry/icon-defaults.ts';
import type { SkillTemplate } from './registry/skills.ts';
import type { Worth } from './registry/worth.ts';
import type { StatBlock } from './registry/monsters.ts';
import type { Gate, GateId, GateType } from './gates/gate.ts';
import type { DifficultyLevel, DifficultyScale } from './gates/difficulty.ts';
import type { WorldWhy } from './gates/world.ts';
import type { NewRow, Running, Setup } from './combat/fight-types.ts';
import type { OddsRead, OddsVoice } from './combat/odds.ts';
import type { SoloFight } from './gates/solo.ts';
import type { ExtractionOutcome } from './combat/extraction.ts';
import type { MapInput, ViewAs } from './combat/map-view.ts';
import type { Ability, AbilityId, AbilityKind, CombatantId } from './combat/ability-types.ts';
import type { Place } from './combat/space.ts';
import type { Tick } from './combat/timeline.ts';
import type { BattleMap } from './registry/maps.ts';
import type { Terrain } from './combat/space.ts';
import type { ZoneId } from './combat/zones.ts';
import type { DiceRoll, LevelUp } from './events.ts';
import type { Thing } from './detail.ts';
import type { DetailEvent } from './detail-open.ts';
import type { Coin, RollId } from './coin.ts';
import type { Check, RollKind } from './roll.ts';
import type { DeviceId, FightId, HunterId, HunterRef, ItemDefId, ItemId, MonsterId, RollEntryId, SheetKey, StoryId } from './ids.ts';

/** A System window's text (the options `ui.system` takes that a reward window passes on). */
export type RewardWindow = { tag?: string; title?: string; kind?: SystemKind; body?: string | undefined; lines?: string[] | undefined };
/** What `applyRewards` gives: any part of a reward. */
export type RewardGrant = Partial<Rewards>;
/** How a reward is shown: `popup: false` leaves out its window, `silent` every window, `levelPopup: false` the level-up's. */
export type RewardShown = { popup?: boolean; silent?: boolean; levelPopup?: boolean };
/** What a reward showed: the window's lines, the level-up, and the window while it is open. */
export type RewardSeen = { lines: string[]; levelup: LevelUp | null; popup: Promise<unknown> | null };
/**
 * What `hunter.sheet` answers: the hunter's stats after perks and conditions, its sheet of derived numbers
 * (src/core/hunter/sheet.ts `hunterSheet`), HP and mana as the sheet shows them, and its checks.
 */
export type HunterSheet = { stats: Stats; sheet: Sheet; hp: number; mana: number; checks: Checks };

/** A row joining the fight (`combat.add` takes a list): the fight's new row, and the bestiary entry a monster row was made from. */
export type JoinRow = { row: NewRow; monsterId: MonsterId | null };
/** A bestiary entry: a seed, or one of the GM's own monsters (`custom`). */
export type BestiaryMonster = Monster & { custom?: true };

export type BestiaryApi = {
  list(): BestiaryMonster[];
  get(id: string): BestiaryMonster | null;
  /** A new monster of a rank: a normal brute unless `o` says otherwise (`boss` or `elite` sets its kind), its XP by the rule. */
  statBlock(rank: Rank, o?: { id?: string; name?: string; type?: string; archetype?: Archetype; kind?: MonsterKind; boss?: boolean; elite?: boolean }): StatBlock;
  /** `n` fighters made from a bestiary entry, for `combat.add`, with optional gate/boss difficulty scaling. */
  toCombatant(monster: Monster | string, n?: number, scale?: DifficultyScale): JoinRow[];
  /** Saves a monster to the GM's bestiary; answers its id, or the store's refusal whole for the caller's `ui.wrote`. */
  save(m: Partial<Monster>, asNew?: boolean): { ok: true; id: string } | Refused;
  /** Opens the monster maker on `m` (null: a new monster; a seed is saved as a copy); answers the id it saved, or null. */
  make(m: Monster | null): Promise<string | null>;
  /** Deletes one of the GM's monsters; its codex record stays, without a link to it. Answers whether it was deleted. */
  remove(id: string): boolean;
};

/** The GM view's Award form. */
export type AwardApi = {
  /**
   * Shows the GM view with the Award form open and its reward editor holding `rewards` (a fight's loot, a bundle; with
   * `bundleId`, that bundle shows as picked): no hunter is picked, nothing is sent until the GM sends it. With `drop`,
   * the rewards are a drop of the loot waiting (`Save.loot`), which the send deals with in its write (pay.ts `dropDealt`).
   */
  open(rewards: Rewards, bundleId?: string, drop?: boolean): void;
};

/** The GM's reward bundles (`library.rewards`): a reward saved under a name, to give again. */
export type BundlesApi = {
  list(): RewardBundle[];
  /**
   * Saves `rewards` as `name`, by id: the bundle `id` (an edit or a rename), else a new one. Answers its id, or the
   * refusal whole for the caller's `ui.wrote` with library.ts `savedWords('bundle', name)`: a blank name or reward, a
   * full library, a name another bundle holds (`taken`), or the store's.
   */
  save(name: string, rewards: Rewards, id?: string | null, window?: SystemWords | null): { ok: true; id: string } | Refused;
  remove(id: string): boolean;
};

export type CombatApi = {
  /**
   * The GM's hand edit of a row of the running fight (the fight's `adjust` command): signed amounts of HP, mana and
   * fatigue, each kept within 0 and its maximum, with `also` (a step of another module: a life event on the sheet) in the
   * same write. A refusal of the fight's or `also`'s is told in the fight's news and answered `TOLD` (save-step.ts); each
   * member here answers so, for its caller's `ui.wrote`.
   */
  adjust(cid: string, delta: { hp?: number; mana?: number; fatigue?: number }, also?: Step<Save> | null): Applied;
  /**
   * Row `cid` pays `mana` for something outside the fight (a shadow summoned): the fight's `adjust` as a price, refused
   * when the row holds less, with `also` (a step of another module) in the same write. Answers as `adjust`.
   */
  spend(cid: string, mana: number, also: Step<Save> | null): Applied;
  /**
   * The GM's Revive of row `cid` (its card's, the GM board's): the fight's `revive` command, which stands only the dead
   * up at the life table's revive HP (vitals.ts `REVIVE_HP`) and takes off every status. The fight holds every row's
   * life, so a player's hunter's phone hears it in the room's `vitals`. Answers as `adjust`.
   */
  revive(cid: string): Applied;
  /**
   * What a grant hands to this phone's fight (grant.ts `Granted.fight`) put on the rows it names (fight-save.ts
   * `heldCommands`: a status each, a refill), with `also` (the grant's own step) in the same write: all of it, or nothing
   * when the fight refuses a part or `also` is refused. Answers as `adjust`.
   */
  held(parts: readonly HeldParts[], also: Step<Save>): Applied;
  /** The GM's Status window on a row (the fight's `status` command): a status taken off, one put on. Answers as `adjust`. */
  status(cid: string, change: { add?: { key: string; def: StatusDef; rounds: number | null; tier: number }; remove?: string }): Applied;
  /**
   * An extraction attempt by hunter row `by` on fallen monster `cid` came to `outcome`: the fight's `extract` keeps it on
   * the row, and a shadow that rose (`rose`) is written with it, or nothing is. Answers as `adjust`.
   */
  extracted(cid: string, by: string, outcome: ExtractionOutcome, rose: Rose | null): Applied;
  /** Rows join the fight (a new one in setup when there is none; while it runs each rolls its opening). Answers how many joined. */
  add(list: JoinRow[]): number;
  isActive(): boolean;
  /** Starts a fight from a gate or the bestiary: asks the GM who fights (and which wave on a wave gate), adds them with `cs`, and starts it. */
  startFlow(cs: JoinRow[], o?: { gateId?: string; title?: string; body?: string; waves?: readonly { readonly id: string; readonly label: string; readonly rows: () => JoinRow[] }[]; wave?: string }): Promise<boolean>;
  /** One party reward window for rewards already given in one step (pay.ts): each hunter's lines and level-ups, listed together. */
  showParty(granted: readonly { hid: string; g: Granted }[], o?: { title?: string; body?: string; lines?: string[] }): Promise<void>;
  /** False when another GM phone runs a fight and the GM declines to replace it. */
  okToReplace(): Promise<boolean>;
  /** Removes a player's card from the fight; answers how many rows left. */
  removeRemote(key: string): number;
  /**
   * A consumable used by a hunter of this phone in the running fight: its ability on the hunter's row (`itemAbility`),
   * used as the card uses it (the fight's `act`). False when that hunter's row does not hold it (nothing happens).
   */
  useItem(hid: string, itemId: string): boolean;
};

/**
 * How to roll: with advantage or disadvantage and the log's label; `silent` rolls without logging or announcing. `kind`:
 * what the roll is for (src/core/roll.ts; `other` when not given, so a rule's own roll never calls the coin). `hid`: the
 * hunter who rolls; without it, the active hunter on a player's phone and the GM on the GM's. `dc`: a check's DC, which
 * the log keeps with its result (`checkResult`).
 */
export type RollOptions = { adv?: boolean; dis?: boolean; label?: string; silent?: boolean; kind?: RollKind; hid?: HunterId; dc?: number | null };
/**
 * A roll; `kept` is the d20 kept under advantage or disadvantage (null without a single d20). `coin`: it called the coin.
 * `check`: a check's DC and result, null for a roll without a DC.
 */
export type Roll = DiceRoll & { kept: number | null; coin?: boolean; check: Check | null };

/**
 * "More info" on a thing (src/views/detail.js): `control` is the attributes of the thing's button, `panel` the detail's
 * markup right after it (empty while closed), `wire` the taps inside a view's root. One open at a time per list.
 */
export type DetailApi = {
  control(list: string, key: string): string;
  panel(list: string, key: string, thing: Thing | null | (() => Thing | null), titled?: boolean): string;
  wire(root: HTMLElement, redraw: () => void): void;
  /** Moves `list`'s open detail by `e` (src/core/detail-open.ts) and draws the change with `redraw`, a close as an open. */
  move(list: string, e: DetailEvent, redraw: () => void): void;
  /** The key whose detail is open in `list`, or null. */
  openIn(list: string): string | null;
};

export type DiceApi = {
  /** Rolls an expression such as `2d6+3`; throws on a bad expression. */
  roll(expr: string, o?: RollOptions): Roll;
  /** A d20 check on a stat with the hunter's bonus, logged with its DC and result (`Roll.check`, null without a `dc`). */
  check(hid: HunterId, stat: keyof Stats, o?: { adv?: boolean; dis?: boolean; dc?: number | null; label?: string }): Roll;
};


export type EffectsApi = {
  /**
   * Applies ops to a hunter outside a fight, each amount at `source`'s tier with the dice rolled in src/edge/roll.ts;
   * answers the lines to show, or the refusal whole for the caller's `ui.wrote` (`nothing` changed: use.ts `USE_WORDS`).
   * A damage op is not taken by the hunter: its line says what it deals. A status applied comes from `source`.
   */
  applyOps(hid: string, ops: readonly Op[], o: { label: string; source: Source }): { ok: true; lines: string[] } | Refused;
  /** A status def from outside data, as `parseStatusDef` reads it with the current rules, or null. */
  sanitizeDef(def: unknown, key?: string | null): StatusDef | null;
  /** The def of a status: the one it carries, else the rules' for its key, else a bare label. */
  statusDef(x: string | { key: string; def?: StatusDef }): StatusDef;
  /** Resolves `follow: true` `applyStatus` ops inside `def` against the current rules starting at `depth` (1 for a stored `applyStatus` op's `def`). */
  liveStatusDef(def: StatusDef, depth?: number): StatusDef;
  /** What a status does, one line per op: at `tier` (its source's), or every rank's value with null or no tier. */
  describe(def: StatusDef, tier?: number | null, key?: string | null): string[];
  /** The lines an item's card shows for its ops (all of them, or `ops`), each at the item's rarity's tier. */
  describeItem(item: Pick<Item, 'rar' | 'revive'> & { effects?: readonly Op[] }, ops?: readonly Op[]): string[];
  /** A free key for a new custom status named `label`: none of the rules' statuses and none in `taken`. */
  slug(label: string, taken?: Set<string> | Record<string, unknown> | null): string;
};

/**
 * What the Status dialog is for. `apply`: put a status on `target` (a fight, a party card); with `rank` (the target's), a
 * Strength row picks the rank it is put on at, default `rank`, and the answer carries `source: { id: null, tier }` at that rank. `library`:
 * make a status for the library, or with `edit` (a status key) edit that one; it answers with `rounds: null`.
 */
export type ForgeOpts = { mode: 'apply'; title: string; target?: string; rank?: Rank } | { mode: 'library'; edit?: string };
export type ForgeApi = {
  /** Opens the Status dialog; answers the status made or picked, or null. */
  status(opts: ForgeOpts): Promise<{ key: string; rounds: number | null; def: StatusDef; source?: Source } | null>;
};

export type GatesApi = {
  /** A new gate in the save; a rank or type left out is drawn from the rules' spawn weights. Null when the write was refused (told in a toast). */
  spawn(o?: { rank?: Rank; type?: GateType; name?: string; difficulty?: DifficultyLevel }): Gate | null;
  /** A gate rolled as `spawn` rolls it, with the monsters made for it, not yet in the save (a step writes it: `spawnGate`). */
  roll(o?: { rank?: Rank; type?: GateType; name?: string; difficulty?: DifficultyLevel }): { gate: Gate; monsters: Monster[] };
  /**
   * Moves the world day by `n` and logs it (world.ts `advanceDay`), then shows a window for each gate it broke. Answers
   * what it did, or why the day did not move.
   */
  advanceDay(n?: number): DayMove;
  /**
   * The GM starts a session: the count of sessions and the world day move in one step (world.ts `sessionStarted`), its
   * line saying whether `backup`, the backup taken just before, was kept; then the windows of the gates it broke.
   */
  startSession(backup: boolean): DayMove<{ session: number }>;
  /**
   * The System's clock brought to now (gates/solo.ts `soloTick`): each hunter's personal gates opened and closed for the
   * time that passed, in one write, then a window for each gate it opened. Run on the app's ready and by the one timer.
   */
  tick(): void;
};
/** The odds control (src/views/odds-box.js): one box per key, the engine's run of it page memory only. */
export type OddsApi = {
  /**
   * Draws the box `el` for the table's `fight` under `key` (null hides it), played by this phone's rules, its words in
   * `voice`; a fight or rules that changed mark its answer stale.
   */
  paint(el: HTMLElement, key: string, fight: Setup | Running | null, voice: OddsVoice): void;
  /**
   * Draws the box `el` for a solo run's fight under `key` (null hides it), played by the rules `soloFight` gave it and no
   * others, so the odds are of the fight the run plays; its words speak to one hunter.
   */
  paintSolo(el: HTMLElement, key: string, made: SoloFight | null): void;
  /** The box's answer: at once when it is done for the fight it shows, else played out first; null when stopped or the fight changed. */
  ask(key: string): Promise<OddsRead | null>;
};
/** What a move of the world day did (world.ts `DayMoved`, without the save), or why the day did not move. */
export type DayMove<More = object> = ({ ok: true; day: number; by: number; broke: Gate[] } & More) | Refused<WorldWhy>;

/** What a grant's step answers to `HunterApi.grantWrite`: the next save and what each grant hands to a fight, by whom it is for. */
export type GrantWritten = {
  readonly save: Save;
  readonly held: readonly { readonly who: { readonly hid: string } | { readonly key: string }; readonly statuses: readonly StatusIn[]; readonly refill: boolean }[];
};
export type HunterApi = {
  deleteHunter(hid: string): Promise<boolean>;
  parseAmount(text: string): { n: number; heal: boolean } | null;
  amountMsg(text: string): string;
  /** Enter damages, Shift+Enter or a leading '+' heals; null when the key is not Enter. */
  amountFromKey(e: KeyboardEvent, text: string): { n: number; heal: boolean; msg: string } | null;
  /** The hunter's numbers as the sheet shows them; a pushed sheet from another phone reads the same way. */
  sheet(h: Hunter): HunterSheet;
  /** Answers the level-up, or null when the level did not rise (or there is no such hunter). */
  gainXP(hid: string, n: number): LevelUp | null;
  /** Gives the rewards and shows them; answers what it showed and the level-up, or null when there is no such hunter. */
  applyRewards(hid: string, rewards: RewardGrant, opts?: RewardWindow & RewardShown): RewardSeen | null;
  /**
   * After a grant's write (src/core/hunter/grant.ts, from `applyRewards` or a room award): what a fight holds goes to the
   * row or is refused, the level-up is announced, a level step reached is completed, and the windows show what it gave.
   */
  granted(hid: string, g: Granted, opts?: RewardWindow & RewardShown): RewardSeen;
  /**
   * A grant's write (an award, a quest's reward, XP): `step` answers the next save and, in `held`, what each grant hands
   * to a fight for a hunter of this phone (`hid`) or a player's (`key`). What this phone's fight holds goes on the row in
   * the same write (`combat.held`); otherwise `store.apply` writes it. Answers what `step` answered in the write, or the
   * refusal. `granted` then shows each grant.
   */
  grantWrite<T extends GrantWritten>(why: string, step: (s: Save) => T | Refused): T | Refused;
  /** The toast that a change of HP, mana, fatigue or statuses was refused because the GM's fight holds them. Answers the refusal it told. */
  gmHolds(): Refused<typeof TOLD>;
  /**
   * A hand edit of a hunter's HP, mana or fatigue. While the hunter has a row in this phone's fight, it goes to the row as
   * the fight's `adjust` (the row holds them, and its next `vitals` would write over the sheet); while it has one in the
   * GM's fight on a player's phone, it is refused with a toast (no message carries it). Each vitals member here answers
   * the write's `Applied` for its caller's `ui.wrote`: the store's (a refusal by its kind, a read-only tab's among them),
   * or `TOLD` where the fight's news or the GM's hold told the refusal already.
   */
  damage(hid: string, n: number): Applied;
  heal(hid: string, n: number): Applied;
  /**
   * The GM's Revive of a dead hunter: on the sheet through the life machine, every status taken off (grant.ts
   * `sheetEdit`; refused `cannot` when the hunter is not dead), or, while this phone's fight holds the hunter, the
   * fight's `revive` command on its row (the row holds the life). Refused in the GM's fight on a player's phone.
   */
  revive(hid: string): Applied;
  /**
   * The System raise of this phone's dead hunter (grant.ts `systemRaise`, no GM button): refused `held` while a fight
   * holds it, `spent` past the ladder, `cannot` when it is up; else the ladder, the life and the debt in one write, with
   * the GM's `systemRaise` message in a room.
   */
  systemRaise(hid: string): SystemRaised | Refused;
  /**
   * The one answer to "where do this hunter's HP, mana, fatigue, life and statuses live now": a row of this phone's fight
   * (`cid`), the GM's fight on a player's phone (`gm`, where a change is refused), or the sheet (null). Every writer asks it.
   */
  fightOf(who: { hid: string } | { key: string }): { at: 'row'; cid: string } | { at: 'gm' } | null;
  /** `fightOf` evaluated against a specific save `s` inside a `store.apply` step so core guards never read stale state. */
  heldIn(s: Save, who: { hid: string } | { key: string }): { at: 'row'; cid: string } | { at: 'gm' } | null;
  /**
   * Takes `n` mana as a price, where the mana lives (`fightOf`: the fight's row, or the sheet), and `also` (a step on the
   * hunter, such as a shadow summoned) in the same write. Refused, with nothing taken, when the mana there is less
   * (`mana` on the sheet; the fight's news on a row) or `also` refuses, and on a player's phone in the GM's fight.
   */
  spendMana(hid: string, n: number, also?: Step<Hunter> | null): Applied;
  /**
   * A rest (grant.ts `sheetEdit`, rests.ts): refused `spent` with no rest left in this gate, `cannot` for a dead hunter
   * (rests.ts `restRefusalWords`), and with a toast (`TOLD`) while the hunter is in a fight: the fight's row holds its HP, mana and fatigue.
   */
  rest(hid?: string): Applied;
  /**
   * Adds a status: one instance per key, the stronger source and the longer duration stay. In a fight it goes to the
   * row as `damage` does (the fight's `status` command), or is refused on a player's phone.
   */
  addCondition(hid: string, status: SheetStatus): Applied;
  /** As `addCondition`. */
  removeCondition(hid: string, key: string): Applied;
};

export type IdentityApi = {
  /** The hunter's emblem in its colour, as HTML. Any part may be missing (a picker preview, a sheet not yet sent). */
  badge(h: Partial<Pick<Hunter, 'name' | 'emblem' | 'color' | 'rank'>>, size?: string): string;
  edit(hid: string): Promise<boolean>;
};


export type InventoryApi = {
  /** The shop's items as they read now, each with its def id (`save.shop`, or the built-in shop). */
  shop(): (ResolvedGrant & { readonly defId: ItemDefId })[];
  /**
   * A hunter's bag, each line resolved (inventory.ts `bagOf`) under the rules in force: on the GM's phone a player's
   * custom item reads from the defs its sheet carries. The one way a view reads a bag.
   */
  bag(h: Pick<Hunter, 'items'>): ResolvedItem[];
  /** What a hunter wears now, by the rules (inventory.ts `wornOf`). */
  worn(h: Pick<Hunter, 'items' | 'equipped'>): Record<Slot, ItemId | null>;
  /** What an item picker lists, by def id: the built-in items, and the library's own custom items. */
  choices(): { readonly builtIn: readonly { readonly defId: ItemDefId; readonly name: string }[]; readonly library: readonly { readonly defId: ItemDefId; readonly name: string }[] };
  /** A grant (a reward's, a drop's, a preset line's) as the item it gives. */
  grant(g: ItemGrant): ResolvedGrant;
  /** Answers the item as the hunter now holds it, or null when there is no such hunter. */
  addItem(hid: string, item: ItemGrant): ResolvedItem | null;
  addGold(hid: string, n: number): void;
  addCrystal(hid: string, n: number): void;
  /**
   * A loot roll of `rank`'s table over the loot pool, the built-in items without a Resurrection Crystal (items.ts
   * `lootPool`, spawn.ts `rollLoot`): a boss's when `boss`, at the `share` a gate of its kind pays (spawn.ts
   * `lootShareOf`; the whole table when left out).
   */
  rollLoot(rank: Rank, o?: { boss?: boolean; share?: number }): LootDrop<ItemGrant>[];
  equip(hid: string, itemId: string): boolean;
  unequip(hid: string, slot: Slot): void;
  use(hid: string, itemId: string): unknown;
  /** The purchase written, or why not: the step's refusal (inventory.ts `buy`: `dead`, `borrow-off`, `no-payoff`, `over-cap`), `no-hunter`, `no-item` for a template that does not read, or the store's. */
  buy(hid: string, defId: ItemDefId): Applied;
  /** Answers the gold the sale paid, 0 when nothing was sold. */
  sell(hid: string, itemId: string, n?: number): number;
};

export type LoadoutsApi = {
  inFight(hid: string): boolean;
  /**
   * Saves the equipped gear as a loadout (loadouts.ts `saveLoadout`, refused `full` at the cap). Each change of a set
   * answers the write's Applied whole, for the caller's `ui.wrote` with `LOADOUT_WORDS`.
   */
  save(hid: string, name: string): Applied;
  overwrite(hid: string, id: string): Applied;
  rename(hid: string, id: string, name: string): Applied;
  remove(hid: string, id: string): Applied;
  /** Equips a loadout; answers the gear it equipped and what it could not, or null when there is no such loadout. */
  swap(hid: string, id: string): { skipped: string[]; kept: string[] } | null;
};

/** The GM's battle maps (src/views/map-maker.js), each as `parseBattleMap` reads it. */
export type MapsApi = {
  list(): readonly BattleMap[];
  get(id: string): BattleMap | null;
  /** Opens the map maker for `m` (null: a new map); answers the map as saved, or null on Cancel. */
  make(m: BattleMap | null): Promise<BattleMap | null>;
  /** Deletes a saved map; answers whether it was deleted. */
  remove(id: string): boolean;
};

export type LootApi = {
  /**
   * Opens the item maker; answers the item as parseItem reads it, or null. "Save to library" saves it as a new custom
   * item; `library: false` leaves it out.
   */
  item(o?: { initial?: Partial<Item>; library?: boolean }): Promise<ItemTemplate | null>;
  /**
   * The GM's inline maker (a reward, a monster's loot, a clear preset, the shop): the item is saved as a custom item of
   * this campaign's catalog (`defId`: an edit of that one), and answered as a reference to it with its count; null on Cancel.
   */
  ref(o?: { initial?: Partial<Item>; defId?: ItemDefId }): Promise<ItemGrant | null>;
  /**
   * Opens the maker on def `defId` (the Bag's Edit, the Workshop's): Save edits it for every copy. From a bag line
   * (`held`) the save is library.ts `editHeldDef`, refused where the phone does not own the def. Answers whether it saved.
   */
  edit(defId: ItemDefId, initial: Partial<Item>, held?: HeldItem): Promise<boolean>;
};

/** What a maker's body gives its shell: the preview lines, whether Save is off, and the answer `T`. */
export type MakerBody<T> = {
  /** The lines the live preview shows for the thing as it stands, redrawn on every change. */
  preview?(): string[];
  /** True while Save must stay off (a field the parser would drop is shown as an error). */
  blocked?(): boolean;
  /** The answer, or undefined to stay open (the body has said why). */
  save(): T | undefined;
};
/** What a maker's shell gives its body, whose answer is `T`. */
export type MakerShell<T> = {
  el: HTMLElement;
  /** Redraws the preview and the Save button; the shell calls it on every input, change and chip. */
  changed(): void;
  /** Closes the maker and answers `value` (null: as Cancel does). */
  done(value: T | null): void;
  /** Shows a line above the bar ('' clears it). */
  error(text: string): void;
};
/** What a maker dialog is opened with: its tag, title and Save label, its class, where focus goes first, and the body `build` fills. */
export type MakerOptions<T> = { tag: string; title: string; save?: string; cls?: string; focus?(win: HTMLElement): HTMLElement | null; build(body: HTMLElement, shell: MakerShell<T>): MakerBody<T> };
/** A def's kits fields as the status maker's groups hold them, each absent when none: its stacks, its triggers and its end. */
export type KitFields = { stack?: StackRule; triggers?: readonly Trigger[]; end?: End };
export type MakerApi = {
  /**
   * Opens a maker dialog: the tag and title, a body `build` fills, Cancel and Save. Answers what the body's `save` gave
   * (its `T`), or null on Cancel, Escape or a tap outside. `cls` names the overlay (`<cls>-overlay`) and the window (`<cls>-win`).
   */
  open<T>(o: MakerOptions<T>): Promise<T | null>;
  /** A group of toggle chips as HTML: one value pressed at a time unless `many`; `clear` lets the pressed one go. */
  chips(name: string, options: ReadonlyArray<readonly string[]>, value: string | string[] | null, o?: { many?: boolean; clear?: boolean; label?: string }): string;
  /** The pressed value of a chip group under `root` (null when none), or every pressed value of a `many` group. */
  picked(root: ParentNode, name: string): string | string[] | null;
  /** The bonus inputs as HTML, each empty when 0, with optional parser bounds. */
  bonus(values?: Partial<Record<string, number>>, o?: { min?: number; max?: number }): string;
  /** What the bonus inputs under `root` hold: each whole number that is not 0. */
  readBonus(root: ParentNode): Record<string, number>;
  /**
   * The effects editor in `box`: one row per op given, over the whole op vocabulary, at most 8. `kind` 'item' labels "By
   * rank" with the rarities; `kind` picks the quick chips. `newStatus` opens the status maker for an Apply status row's "New status…".
   */
  effects(box: HTMLElement, o: { ops?: unknown; kind: 'status' | 'item' | 'skill' | 'land'; statusKey?: string | null; newStatus?: () => Promise<{ key: string; def?: StatusDef } | null> }): MakerEffects;
  /**
   * The ability form in `box`: the formula field, then cost, reach, how it is avoided and the channel, each a group
   * collapsed until opened, every field starting at the kind's (`abilityOf`), or at `ability`'s when it is of `kind`.
   */
  ability(box: HTMLElement, o: { kind: AbilityKind; ability?: Ability | null }): AbilityForm;
  /**
   * The kits' groups of a status def in `box` (src/views/kit-parts.js): Stacks with what a count sets off, When something
   * happens (triggers) and When it ends, each collapsed. `fields` answers the def's `stack`, `triggers` and `end` as the
   * groups hold them, each absent when none; `name` keeps two of these in one window apart.
   */
  statusBlocks(box: HTMLElement, def: StatusDef | null, name: string): { fields(): KitFields; blocked(): boolean };
  /**
   * The worth bar and line in `box` (src/core/registry/worth.ts `worthLine`): a bar to one and a half budgets with a mark
   * at the budget, gold past the tolerance, never a refusal. Answers the function that draws a worth, or hides it on null.
   */
  worth(box: HTMLElement): (w: Worth | null) => void;
  /**
   * The reward editor in `box` (src/views/reward-editor.js): XP, gold and points, a row per part added by its chip, a
   * Bundle row (left out with `bundles: false`) and the reward window's lines as a preview. `id` names the number fields
   * `<id>-xp`, `<id>-gold`, `<id>-pts`; `floor` keeps them at 0 or more.
   */
  rewards(box: HTMLElement, o?: { initial?: unknown; id?: string; floor?: boolean; bundles?: boolean }): RewardEditor;
};
/** What the reward editor holds. */
export type RewardEditor = {
  /** The reward, as `parseRewards` reads it. */
  value(): Rewards;
  /** Fills the editor with `rewards`; `bundleId` shows that bundle picked. */
  set(rewards: unknown, bundleId?: string): void;
  /** True while a row is not finished (an item or skill not picked, a title or boon without a name); the row says why. */
  blocked(): boolean;
  /** Draws the bundle select again when the bundles changed. */
  refresh(): void;
  /** Adds an empty row of `kind` when there is none and puts the cursor in it. */
  ensure(kind: 'item' | 'title' | 'skill' | 'status' | 'boon' | 'job'): void;
  /** Shows a line under the editor ('' clears it). */
  message(text: string, bad?: boolean): void;
};
/** What the ability form holds. */
export type AbilityForm = {
  /** The ability for this id and name, with no ops and the kind's aim; null while the formula does not read or a gap has no cap. */
  value(id: AbilityId, name: string): Ability | null;
  blocked(): boolean;
  /** A new kind: every field back to the kind's. */
  setKind(kind: AbilityKind): void;
};
/** What the effects editor holds. */
export type MakerEffects = {
  /** The ops of the rows, each as `parseOp` reads it. */
  ops(): Op[];
  /** True while a row holds an op the parser would drop (its error is shown on the row). */
  blocked(): boolean;
};

export type OnboardApi = { quickstart(): void };

export type QuestsApi = {
  /** Gives each hunter a copy of the quest; answers the new quest ids, none when the write was refused (told in a toast). */
  issue(hids: string[], partial: Partial<Omit<QuestOffer, 'rewards' | 'objectives'>> & {
    objectives?: (Omit<Objective, 'progress'> & { progress?: number })[]; rewards?: Partial<Rewards> | QuestOffer['rewards']; from?: 'gm' | 'system' | 'self';
  }): string[];
  /** Starts a Job Change chain; answers step 1's quest id, or the refusal whole for the caller's `ui.wrote` (`CHAIN_WORDS`). */
  issueJobChain(hid: string, job: string): { ok: true; questId: string } | Refused;
  complete(hid: string, qid: string): Promise<boolean>;
  /** The windows of the Job Change steps a step on the save completed in the same write (grant.ts `stepsReached`). */
  stepsDone(hid: string, done: readonly StepDone[]): void;
  /**
   * The one quest form in `box` (src/views/quest-fields.js), for a quest issued now (`new`), a quest a hunter holds
   * (`edit`, `initial`) or a chapter's quest written ahead (`chapter`), on the GM's or a player's phone (`role`). `id`
   * names its reward editor's number fields.
   */
  fields(box: HTMLElement, o: { id: string; use: 'new' | 'edit' | 'chapter'; role: 'gm' | 'player'; initial?: unknown }): QuestFields;
};
/** A quest as the quest form holds it, the draft `questOf` and `parseChapterQuest` read. */
export type QuestFormDraft = {
  kind: QuestKind; title: string; desc: string; objectives: Objective[]; rewards: Rewards; penaltyText: string;
  /** What failing costs (the GM's form; a player's is empty). */
  onFail: Rewards;
  /** Hours from when it is issued, or from when its chapter opens (the GM's new quest, a chapter's); null for none. */
  dueHours: number | null;
  /** The date and time an urgent quest is due (an edit, a player's own quest); null for none. */
  dueAt: string | null;
};
/** What the quest form holds. */
export type QuestFields = {
  value(): QuestFormDraft;
  /** The first thing that stops a save, in words, with the cursor put there; '' when nothing does. */
  check(): string;
  /** Fills the fields `draft` names and leaves the rest. */
  set(draft: Partial<QuestFormDraft>): void;
  /** Its reward editor: the GM's form only. */
  rewards: RewardEditor | null;
  focus(): void;
};

/** A use as a hunter's phone reports it: what it was, its text and whom it is for. A use in a fight is a `cast`. */
export type UseReport = { what: UsedWhat; name: string; text: string; target: 'self' | 'other'; tell: boolean };
export type UsesApi = {
  /**
   * A use by a hunter of this phone reaches the GM: a player's phone in a room posts `used` (a told use, or one on
   * another) to the outbox, which sends it when the room answers; any other phone writes a told use to its own session
   * log. Answers as `told`.
   */
  report(hid: string, use: UseReport): Promise<{ ok: true; sent: boolean } | Refused>;
  /**
   * A use by hunter `hid` and its report in one write (src/core/use-told.ts): `change`, a step on the hunter (null: the
   * hunter is not changed), and `use` told as `report` tells it (null: told to nobody). Nothing is written when the
   * hunter is gone or `change` refuses. Answers whether a `used` was posted, or the refusal whole for the caller's `ui.wrote`.
   */
  told(hid: string, why: string, change: Step<Hunter> | null, use: UseReport | null): { ok: true; sent: boolean } | Refused;
  /** Whether hunter `hid` has a row in the room's running fight on this player's phone (a use there is a `cast`). */
  onTable(hid: string): boolean;
  /**
   * The turn on this player's phone (src/core/combat/hold.ts): free, a command being picked or posted, or one sent and
   * not answered. While it is not free the table's turn buttons are off.
   */
  hold(): import('./combat/hold.ts').TurnHold;
  /**
   * A command of the turn tapped on any screen (a step, a use, End turn, a Release; `via` `bag` for a consumable's use),
   * the one way one goes out: `post` runs only when the hold lets it, under the hold for `turn` and `bag` alike
   * (SMX-views-5.1), and the hold hears its answer. Answers the post's answer, or null when nothing was posted (the turn
   * held, after a word to the player, or `post` sent nothing).
   */
  command(post: () => Posting | null | Promise<Posting | null>, via?: import('./combat/hold.ts').TurnHoldVia): Promise<Posting | null>;
  /**
   * Hunter `hid` on a player's phone uses its ability `abilityId` in the GM's fight, through `command` with `via`: on its
   * turn, at a target `aims` lets it reach (picked in a window, or `aim` when the map picked it), with its own dice,
   * posted as the room's `cast`. Answers the post, or null when nothing was cast (the turn held, not its turn, nobody in
   * reach, the picker cancelled).
   */
  cast(hid: string, abilityId: string, aim?: CombatantId | Place, via?: import('./combat/hold.ts').TurnHoldVia): Promise<Posting | null>;
};

/**
 * What a shadow that rose writes beside the corpse's outcome: this phone's hunter takes it into its army (`step`,
 * core/hunter/shadows.ts `shadowRises`), or a player's hunter on another phone is sent the room's `shadow` message.
 */
export type Rose = { readonly kind: 'local'; readonly step: Step<Save> } | { readonly kind: 'remote'; readonly event: RoomEvent };
/**
 * A fallen monster a hunter may extract: its fight row's id and name, the body it had (rank, archetype, kind), its
 * bestiary entry if it has one, whether it is down and may be extracted, the attempts left on it (its row's
 * `extraction`, src/core/combat/extraction.ts), and the extracting hunter's row in the fight (`by`).
 */
export type ExtractTarget = {
  id: string; by: string; name: string; rank: Rank; archetype: Archetype; kind: MonsterKind; monster: string | null;
  down: boolean; extractable: boolean; left: number;
};
export type ShadowsApi = {
  canExtract(h: Hunter | null): boolean;
  /**
   * The extraction roll of the hunter a fight row holds (`who`: this phone's, or a player's, whose sheet the GM's phone
   * reads) on a fallen monster; answers the shadow that rose, or null.
   */
  extract(who: HunterRef, c: ExtractTarget): Promise<unknown>;
};

/** A skill paid for: the skill as it was used, its dice total (null without dice) and the line that says what was paid and rolled. */
export type SkillsApi = {
  /**
   * Opens the skill maker; answers the skill as parseSkill reads it, or null. `library` (default: on a GM's phone) shows
   * "Save to library", on by default, which writes `library.skills` (same name replaces). `give` (the receivers pressed at
   * the start: `l:` a hunter's id, `r:` a player's sheet key) shows "Give to": Save gives the skill to each one pressed.
   */
  make(o?: { initial?: Partial<Skill>; library?: boolean; give?: string[] | null }): Promise<SkillTemplate | null>;
  /** What a skill does, in the game's words: its kind, cost and cooldown, its formula, whom it is on, each op; used `from` a monster, each number at its rank. */
  lines(k: SkillTemplate, from?: Source): string[];
  /** "Give to…": a list of this phone's hunters and, in a room, the players' sheets; gives `k` to the one picked. */
  give(k: SkillTemplate): Promise<void>;
};

/**
 * A hunter sheet another phone pushed to the room (a deleted hunter's tombstone is not one): its key, the phone and the
 * hunter id on that phone the key names (src/core/ids.ts), and `polledAt`, when that phone last polled.
 */
export type RemoteSheet = { key: SheetKey; polledAt: string | null; deviceId: DeviceId; hunterId: HunterId; at: string; from: string; data: Hunter };

/** Another player's hunter in the room as this phone gets it: its sheet key and its face (protocol.ts `HunterFace`), for the Give window. */
export type RoomFace = { key: SheetKey } & HunterFace['face'];

/** What `sync.post` answers: the outbox entry's id and how many older messages a full outbox let go, or why nothing was posted. */
export type Posting = { ok: true; id: string; dropped: number } | { ok: false; why: 'noRoom' | 'notEvent' };
export type SyncApi = {
  status(): 'off' | 'offline' | 'connected';
  conn(): Connection;
  /**
   * `waiting`: the messages this phone has posted for its room that the room does not have yet (src/core/sync/outbox.ts).
   * `joining`: the room a join under way goes to, from whichever window started it.
   */
  detail(): { conn: Connection; room: RoomCode | null; lastOk: number; online: boolean; unsent: boolean; locked: boolean; waiting: number; joining: RoomCode | null };
  /** The room the link is in: live, or the one a create or join started from. A view asks `app.seat()` whether it is in one. */
  room(): RoomCode | null;
  /** A room event of `type` with its id (newEvent in src/core/protocol.ts), or null for a body the server would refuse. */
  event<K extends EventType>(type: K, body: EventBody<K>): RoomEvent | null;
  /** The parts of a new event id, for a core step that makes its own event (trade/offer.ts `offerPosted`). */
  stamp(): EventStamp;
  /**
   * Puts the event in the outbox for the room this phone is in (src/core/sync/outbox.ts): kept in the save and sent after
   * each good poll until the room takes it, once. `key`: a queued message of that room with the same key stands for the
   * same thing and is replaced. Answers the entry's id and how many older messages a full outbox let go, or why nothing
   * was posted (no room; not an event the room takes).
   */
  post(ev: RoomEvent | null, o?: { key?: string }): Posting;
  /** Sends what waits in the outbox for the live room now: a core step that posted in the save calls it after its write. */
  flush(): void;
  /**
   * The first time only for `eid`: `write`, a step (src/core/save-step.ts), and the id recorded with the applied event ids
   * (src/core/applied.ts `appliedOnce`) in one write, so what a room event writes on this phone is written whole at most
   * once, across a reload and a repeated poll. A step that refuses records the id alone; one that throws writes nothing,
   * the id included. Answers whether it wrote.
   */
  once(eid: EventId, write: Step<Save>): boolean;
  /** The players' sheets, on the room's GM phone; none on any other phone. */
  remoteSheets(): RemoteSheet[];
  /** The other players' hunters as faces (protocol.ts `HunterFace`), on a player's phone in a room; none on any other phone. */
  faces(): RoomFace[];
  myKey(hid: HunterId): SheetKey;
  /** A room doc as `DOCS` in protocol.ts parsed it: the GM's own last put too. */
  doc<K extends DocName>(name: K): DocOf<K> | null;
  /**
   * When the room stored doc `name` (its `Stored.at`, an ISO time on the server's clock; the GM's own last put too): the
   * time of what `doc` answers, so a view can say how old it is ("As of 21:04."). Null where `doc` is.
   */
  docAt(name: DocName): string | null;
  /** What this phone knows of the GM's fight: its doc, when the room stored it, and its last message as `save` keeps it (fight-heard.ts), for `fightHold`. */
  table(save: Save): TableSeen;
  /** On a GM's phone in a room, keeps the doc what `build` answers (null: leave it). Register once; sync.ts calls it after each change. */
  publish(name: Exclude<DocName, 'kicked'>, build: () => unknown): void;
  inviteLink(code?: string | null): string;
  /** The room of the invite link this tab was opened with, until it is joined or dropped. */
  invite(): RoomCode | null;
  dropInvite(): void;
  create(): Promise<string>;
  parseInvite(text: unknown): RoomCode | null;
  check(text: unknown): Promise<{ ok: true; exists: boolean; gm: boolean } | { ok: false }>;
  joinRoom(text: unknown, o?: { hunterId?: string; name?: string }): Promise<string>;
  /** Rejoin room `code` as its GM: with `key` typed by hand, or else the GM key this phone keeps for that room. */
  rejoinGM(code: string, key?: string): Promise<void>;
  roster(): RosterEntry[];
  lastRoom(): { code: RoomCode; gone: boolean; gm: boolean } | null;
  bound(): Hunter | null;
  switchTo(hid: string): Promise<boolean>;
  forgetKey(code: string): void;
  leave(): void;
  forgetLast(): void;
  retry(): Promise<void>;
  gmRooms(): { code: string; current: boolean }[];
  /** The GM's actions on a player's sheet answer how the room answered: taken, offline, refused with its reason, or the server's failure. */
  kick(key: string): Promise<Call>;
  allowBack(key: string): Promise<Call>;
  recentKicks(): { key: string; at: string; name: string }[];
  release(key: string): Promise<Call>;
  /** A hunter deleted on this phone leaves the GM's board: a tombstone over its sheet, through the outbox. In no room, nothing. */
  forget(hid: HunterId): void;
  /** The GM's custom shop list from the active room catalog while this phone is a player in a room, or null for the shipped shop. */
  catalogShop(): readonly ItemDefId[] | null;
  /** Whether the GM's catalog publish is paused on a 409 conflict with another device (shown in Workshop). */
  catalogConflict(): boolean;
  /** Resolves a GM catalog conflict in Workshop: keep this phone's items (`mine`) or adopt the server's (`theirs`). */
  resolveCatalog(choice: 'mine' | 'theirs'): void;
};

/** Sharing the GM's custom content (src/views/io.js): a pack as a code or a file (src/core/pack.ts). */
export type ShareApi = {
  /** Asks what to share (everything or one kind) and how (a code or a file), then shows the code or saves the file. */
  open(): Promise<void>;
  /** Shows the code of a pack that holds one library entry (a status by its key, a monster by its id) and the statuses it names. */
  entry(kind: PackKind, id: string): Promise<void>;
};

/** The coin call (src/views/coin.js, src/core/coin.ts). */
export type CoinApi = {
  /**
   * A roll the dice tray just logged: when `isCoinRoll` says it calls the coin, asks "Heads or tails?" for hunter `hid`.
   * `roll` is the roll's id in the roll log. Answers whether it asked.
   */
  rolled(o: { hid: HunterId; roll: RollEntryId; kind: RollKind; expr: string; natural: number | null; label: string }): boolean;
  /** The GM's ruling of a coin this phone called (the `coinLand` room message, no side): the first one of a roll marks it ruled. */
  ruled(roll: RollId): void;
  /** The coin of roll `roll` of this phone's roll log, or null when that roll called none. */
  of(roll: string): Coin | null;
};

/** The abilities a map's hotbar shows: the actor's list, when each is ready again, the fight's time, its cost cut, and the key its pins are kept under. */
export type MapKit = {
  list: readonly Ability[]; readyAt: Readonly<Record<string, Tick>>; now: Tick; costCut: number; pinKey: string;
  /** The actor's channel while it holds (fight-view.ts `channelView`): the hotbar offers Release with its payoff. */
  channel: { name: string; charge: number; max: number; factor: number } | null;
  /** The kits the hotbar shows (map-view.ts `HotbarKit`): the armed reaction and where it stands, and the uses left. */
  armed?: { ability: string; spent: boolean } | null;
  left?: Readonly<Record<string, number>>;
  /** The actor's bag, for an item's use's picture (map-view.ts `HotbarKit`): the item with this id, or null when the bag holds none. */
  itemOf?: (id: ItemId) => IconItem | null;
  /** What each ability does to the omen standing, by ability id (map-view.ts `HotbarKit`, fight-view.ts `answersBy`). */
  answers?: Readonly<Record<string, string>>;
};
/**
 * What a phone gives its battle map (src/views/map.js): the scene's input, the order ahead by name, the actor's kit (null
 * when this phone plays no row), and the commands it sends. `place` is null where a drag is not allowed (a player's phone).
 * `offTurn` answers a tap on the hotbar while it is not this phone's turn. `card` opens a token's card.
 */
export type MapSource = {
  /** The fight to draw, its id with its scene's input (a new id is a new fight, framed afresh), or null when there is none. */
  input(): (MapInput & { readonly fight: FightId }) | null;
  order(): { id: CombatantId; name: string }[];
  kit(): MapKit | null;
  move(to: Place, dash: boolean): void;
  place: ((id: CombatantId, to: Place) => void) | null;
  use(a: Ability, aim: CombatantId | Place | null): void;
  /** The actor's holding channel goes off at its charge. */
  release(): void;
  /** The actor ends its turn from the hotbar: a player's phone sends a `pass`. Null where the bar has its own Next (the GM's). */
  pass: (() => void) | null;
  /** The GM paints tiles during a fight with a terrain or more of a zone on the ground. Null on a player's phone. */
  paint: ((tiles: Place[], brush: { terrain: Terrain } | { zone: ZoneId }) => void) | null;
  /**
   * A word for what this phone draws over the map's frame that can change its height (a player's turn line, the life's
   * word, the number of chips). The map works its frame's height out again when the word changes. Absent where nothing does.
   */
  over?: () => string;
  offTurn(): void;
  /** This phone's last command is on its way to the GM's phone, which has not answered it yet (a player's; the GM's is always false). */
  waiting(): boolean;
  card(id: CombatantId): void;
  /** The actor's row arms one of its reactions, or disarms with null (kits design 8.4.2): at any time, not only its turn. */
  arm(ability: AbilityId | null): void;
  /** Sends a chosen dodge tile for the open dodge prompt. */
  dodge: ((to: Place) => void) | null;
  /**
   * Whose eyes the map shows (map-view.ts `ViewAs`; kits design 8.7, feature 7): the foe rows the GM may take, the choice
   * as it reads for the fight now, and the GM's pick, kept on this phone until the GM picks again. Null on a player's phone.
   */
  eyes: { choices(): { id: CombatantId; name: string }[]; now(): ViewAs; set(v: ViewAs): void } | null;
};
/**
 * A map drawn in an element: `draw` after each change, `fit` to frame the whole fight, `destroy` when the screen takes the
 * element off the page (the map stops listening: src/core/combat/map-mount.ts `gone`).
 */
export type MapView = { draw(): void; fit(): void; destroy(): void };
export type MapApi = {
  /** Draws a battle map in `el` from `source` (src/core/combat/map-view.ts makes its scene). */
  mount(el: HTMLElement, source: MapSource): MapView;
};

/** The GM view's Stories section and its turn-on window (src/views/stories.js, notes-1-stories.md section 5). */
export type StoriesApi = {
  /** Draws the Stories section's body in `box` from the save; answers its head summary ("2 running", or ''). */
  paint(box: HTMLElement): string;
  /** Opens the turn-on window at story `id` (the Workshop's Turn on…), or at the list of stories when null. */
  turnOn(id: StoryId | null): Promise<void>;
};

/**
 * Trading on screen (src/views/trade.js; notes-5-trade.md sections 3, 6 and 7): the Give window, the Bag's Offers and
 * Stash tabs, the GM's section.
 */
export type TradeApi = {
  /**
   * Opens the Give window for hunter `hid`'s item `item`, or its gold when null: to another player's hunter in the room
   * (an offer, trade/offer.ts `offerPosted`), to another hunter of this phone (goods.ts `handOver`) or into the party
   * stash (trade/stash.ts).
   */
  give(hid: HunterId, item: string | null): Promise<void>;
  /** Draws hunter `hid`'s offers in `box` (the Bag's Offers tab): the offers to it with Accept and Refuse, and its own with Take back. */
  offers(box: HTMLElement, hid: HunterId): void;
  /**
   * Draws the party stash in `box` for hunter `hid` (the Bag's Stash tab): its gold and lines with Take and Take gold, and
   * the hunter's waiting asks, with Take back or Put away once the room did not take one (trade/stash.ts).
   */
  stash(box: HTMLElement, hid: HunterId): void;
  /** How many offers to hunter `hid` wait for its answer: the count on the Bag's Offers tab. */
  waiting(hid: HunterId): number;
  /** Draws the GM view's "Trades and stash" section in `box` (the switch, the open offers with Stop, the stash with Remove); answers its head summary. */
  paint(box: HTMLElement): string;
  /** The line the GM's Remove window adds for the player's sheet `key` (named `name`) while it has open offers; '' when it has none. */
  removeLine(key: string, name: string): string;
};

/**
 * A private word to the GM on screen (src/views/words.js; notes-5-trade.md section 4): the Room view's "Word to the GM"
 * on a player's phone and the GM view's "Words from players".
 */
export type WordsApi = {
  /** Draws the player's section in `box` (the field, Send to the GM, the thread of the hunter it plays in the room); hides it on any other phone. */
  player(box: HTMLElement): void;
  /** Draws the GM view's "Words from players" in `box` (each word with Answer); answers its head summary ("2 new"). */
  paint(box: HTMLElement): string;
  /** The GM opened or closed the section: its new words are seen (sync/word.ts `wordsSeen`). */
  seen(): void;
  /** How many words of the GM's room the GM has not seen: the section opens with the page while any is. */
  unseen(): number;
};

/** What the System remembers of a hunter, on screen (src/views/chronicle.js, feature 1's notes 17.12). */
export type ChronicleApi = {
  /** The feats that apply on this phone: a player in a room reads the GM's from the room's feats doc, any other phone its own library. */
  book(): FeatBook;
  /** Opens a hunter's Chronicle in a read-only window: `id` is a hunter of this phone, or a player's sheet key (its pushed cut). */
  open(id: string): void;
};

/** The GM's guild editor for a local hunter or a player's sheet in a room (src/views/guild.js). */
export type GuildApi = {
  /** Opens the GM Guild modal for `who` (`sheet` for a remote player hunter; null for a local hunter). */
  edit(who: HunterRef, sheet: Hunter | null): Promise<void>;
};

/** The player class locker / skill tree panel, class offer window, and GM unique-class registry (src/views/classes.js). */
export type ClassesApi = {
  /** Draws the GM view's "Unique classes" section in `box`; answers its head summary (for example, "2 of 18 held"). */
  paint(box: HTMLElement): string;
  /** Opens the GM unique-class offer (or manages the active one), optionally clearing the starter offer flag on `gateId`. */
  openOffer(gateId?: GateId | null): void;
};

/** Every `app.api` name and the type of what its module registers. */
export type AppApi = {
  award: AwardApi;
  classUi: ClassesApi;
  coin: CoinApi;
  bestiary: BestiaryApi;
  bundles: BundlesApi;
  chronicle: ChronicleApi;
  combat: CombatApi;
  detail: DetailApi;
  dice: DiceApi;
  effects: EffectsApi;
  forge: ForgeApi;
  gates: GatesApi;
  guild: GuildApi;
  hunter: HunterApi;
  identity: IdentityApi;
  inventory: InventoryApi;
  loadouts: LoadoutsApi;
  loot: LootApi;
  maker: MakerApi;
  map: MapApi;
  maps: MapsApi;
  odds: OddsApi;
  onboard: OnboardApi;
  quests: QuestsApi;
  shadows: ShadowsApi;
  share: ShareApi;
  skills: SkillsApi;
  stories: StoriesApi;
  sync: SyncApi;
  trade: TradeApi;
  uses: UsesApi;
  words: WordsApi;
};
export type ApiName = keyof AppApi;

/** What a player's phone uses of the hunter API to apply room events (src/edge/room-events.ts). */
export type RoomHunter = Pick<HunterApi, 'fightOf' | 'granted' | 'gmHolds'>;

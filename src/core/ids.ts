// ids.ts: the one brand, and the ids of the save and the room. A branded type is `Brand<T, 'Name'>` (or `Id<'Name'>` for a
// string id) from here, so two kinds of id never mix and no module declares a brand of its own (tests/lint.test.ts). A
// room id is made only by its parser below; a save id by save.ts's repair at load, or by the store's `id` maker.
// Pure, and imports nothing, so every core module can use it.
declare const brand: unique symbol;
/** A `T` that means one thing: `Name` is unique across the code base (tests/lint.test.ts). */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
/** A string id of one kind of thing. */
export type Id<B extends string> = Brand<string, B>;
/** A room's six character code. */
export type RoomCode = Id<'RoomCode'>;
/** A GM's item catalog id (`cat-<6..24 lowercase alnum>`): on the server derived from its `CatalogKey`. */
export type CatalogId = Id<'CatalogId'>;
/** The secret key that owns a GM's item catalog (never sent to players). */
export type CatalogKey = Id<'CatalogKey'>;
/**
 * An item definition's stable id: a built-in (`b:<slug>`) or a GM custom item (`c:<catalogId>:<stamp>`).
 * Distinct from `ItemId` (`i<n>` / `seed:<word>`), which identifies one held stack in a hunter's bag or stash.
 */
export type ItemDefId = Id<'ItemDefId'>;
/** A phone: `settings.deviceId`. */
export type DeviceId = Id<'DeviceId'>;
/** One event. The sender makes it; a phone applies an event that changes a hunter at most once per id. */
export type EventId = Id<'EventId'>;
/** The secret that makes a phone the GM of a room (src/core/role.ts). */
export type GmKey = Id<'GmKey'>;
/** A hunter in a room: `<deviceId>:<hunterId>`, the key its sheet is stored under. */
export type SheetKey = Id<'SheetKey'>;

/**
 * A room code's alphabet: letters and digits without 0, 1, I and O, which read as each other. The server makes its codes
 * of it, and every reader of a code asks `parseRoomCode` (implicit audit 3, RM1: the alphabet was written five times).
 */
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** A room code's length. */
export const CODE_LEN = 6;
/** The characters that are not in a code's alphabet, for the words that say so ("no 0, 1, I or O"). */
export const CODE_LEFT_OUT = [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter(c => !CODE_CHARS.includes(c));
const CODE_RE = new RegExp(`^[${CODE_CHARS}]{${CODE_LEN}}$`);
const WORD_RE = /^[\w-]{1,40}$/;
const SHEET_KEY_RE = /^[\w-]+:[\w.-][\w:.-]*$/;
const GM_KEY_RE = /^[\w-]{1,80}$/;
export const ITEM_DEF_ID_MAX = 64;
const CATALOG_ID_RE = /^cat-[a-z0-9]{6,24}$/;
const CATALOG_KEY_RE = /^[\w-]{16,80}$/;
const BUILT_IN_ITEM_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BUILT_IN_ITEM_ID_RE = /^b:[a-z0-9][a-z0-9-]{0,39}$/;
const CUSTOM_ITEM_ID_RE = /^c:(cat-[a-z0-9]{6,24}):[a-z0-9]{4,20}$/;
export const parseRoomCode = (v: unknown): RoomCode | null => (typeof v === 'string' && CODE_RE.test(v) ? (v as RoomCode) : null);
export const parseCatalogId = (v: unknown): CatalogId | null => (typeof v === 'string' && CATALOG_ID_RE.test(v) ? (v as CatalogId) : null);
export const parseCatalogKey = (v: unknown): CatalogKey | null => (typeof v === 'string' && CATALOG_KEY_RE.test(v) ? (v as CatalogKey) : null);
export const parseItemDefId = (v: unknown): ItemDefId | null =>
  (typeof v === 'string' && v.length <= ITEM_DEF_ID_MAX && (BUILT_IN_ITEM_ID_RE.test(v) || CUSTOM_ITEM_ID_RE.test(v)) ? (v as ItemDefId) : null);
/** The built-in item definition id for `slug` (`b:<slug>`). Throws if `slug` is not a valid built-in slug. */
export function builtInItemId(slug: string): ItemDefId {
  if (!BUILT_IN_ITEM_SLUG_RE.test(slug)) throw new Error(`invalid built-in item slug: "${slug}"`);
  return `b:${slug}` as ItemDefId;
}
/** A custom item definition id under `catalogId` with collision-free `stamp` (`c:<catalogId>:<stamp>`). */
export function customItemDefId(catalogId: CatalogId, stamp: string): ItemDefId {
  const id = `c:${catalogId}:${stamp}`;
  if (!CUSTOM_ITEM_ID_RE.test(id) || id.length > ITEM_DEF_ID_MAX) throw new Error(`invalid custom item def id: "${id}"`);
  return id as ItemDefId;
}
/** Whether `id` names a shipped built-in item (`b:*`). */
export const isBuiltInItemId = (id: ItemDefId): boolean => id.startsWith('b:');
/** Whether `id` names a GM-created custom item (`c:*`). */
export const isCustomItemDefId = (id: ItemDefId): boolean => id.startsWith('c:');
/** The catalog that owns custom item `id`, or null for a built-in item. */
export function catalogOfItemDefId(id: ItemDefId): CatalogId | null {
  const m = CUSTOM_ITEM_ID_RE.exec(id);
  return m ? (m[1] as CatalogId) : null;
}
export const parseDeviceId = (v: unknown): DeviceId | null => (typeof v === 'string' && WORD_RE.test(v) ? (v as DeviceId) : null);
export const parseGmKey = (v: unknown): GmKey | null => (typeof v === 'string' && GM_KEY_RE.test(v) ? (v as GmKey) : null);
export const parseEventId = (v: unknown): EventId | null => (typeof v === 'string' && WORD_RE.test(v) ? (v as EventId) : null);
export const parseSheetKey = (v: unknown): SheetKey | null =>
  (typeof v === 'string' && v.length <= 40 && SHEET_KEY_RE.test(v) ? (v as SheetKey) : null);
/** An offer between two hunters of a room (trade/offer.ts): the id of its `offer` event. */
export type OfferId = Id<'OfferId'>;
/** What an offer's end id adds to the offer's id (`endIdOf`). Every other id the app reads refuses to end in it (`isEndId`). */
export const END_SUFFIX = '-e';
/** The longest offer id: an event id's 40 characters less the end's suffix, so the end's id is still an event id. */
export const OFFER_ID_MAX = 40 - END_SUFFIX.length;
/** Whether an event id is an offer's end id. No other message may carry one, or it would take the offer's one end (notes-5-trade.md 12.1). */
export const isEndId = (v: string): boolean => v.endsWith(END_SUFFIX);
/** An offer id: an event id of at most `OFFER_ID_MAX` characters that is not an end id; else null. */
export const parseOfferId = (v: unknown): OfferId | null =>
  (typeof v === 'string' && v.length <= OFFER_ID_MAX && WORD_RE.test(v) && !isEndId(v) ? (v as OfferId) : null);
/** The one event id every end of offer `o` carries, so the room keeps one end of it (server.ts `addEvent` takes an id once). */
export const endIdOf = (o: OfferId): EventId => `${o}${END_SUFFIX}` as EventId;
/**
 * The deterministic event id for approving waiting reward `id`: identical across GM devices so two GM phones approving
 * the same reward converge to one server event (`server.ts` `addEvent`) and at-most-once player application. Always at
 * most 40 characters and never ending in `-e`.
 */
export function approvalIdOf(id: EventId): EventId {
  if (id.length <= OFFER_ID_MAX) return `${id}-a` as EventId;
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return `${id.slice(0, 30)}-${(h >>> 0).toString(36).padStart(7, '0')}-a` as EventId;
}
/**
 * The deterministic event id of a player's phone's report that it could not take unique class grant `grantId`
 * (protocol.ts `classGrantRefused`): the same on every poll, so the room keeps one report a grant however often the phone
 * reads the holders doc. Always an event id of at most 40 characters, never ending in `-e`.
 */
export function grantRefusalIdOf(grantId: string): EventId {
  if (grantId.length <= 38) return `${grantId}-g` as EventId;
  let h = 2166136261;
  for (let i = 0; i < grantId.length; i++) h = Math.imul(h ^ grantId.charCodeAt(i), 16777619);
  return `${grantId.slice(0, 30)}-${(h >>> 0).toString(36).padStart(7, '0')}-g` as EventId;
}
/** A feat's key, as a status has one: a built-in's is reserved; the GM's own is made from its name and kept through renames (hunter/feats.ts). */
export type FeatKey = Id<'FeatKey'>;
const FEAT_KEY_RE = /^[a-z0-9-]{1,40}$/;
export const parseFeatKey = (v: unknown): FeatKey | null => (typeof v === 'string' && FEAT_KEY_RE.test(v) ? (v as FeatKey) : null);
/** A node inside a class skill tree (src/core/registry/class-trees.ts). Lowercase slug, 1 to 32 characters. */
export type ClassNodeId = Id<'ClassNodeId'>;
export const CLASS_NODE_ID_MAX = 32;
const CLASS_NODE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const parseClassNodeId = (v: unknown): ClassNodeId | null =>
  (typeof v === 'string' && CLASS_NODE_ID_RE.test(v) ? (v as ClassNodeId) : null);
// ── the save's ids: a prefix and the save's `seq` (`h12`, `q40`), or `seed:<word>` for a built-in's copy ──
/** A hunter of this phone's save: `Hunter.id`. */
export type HunterId = Id<'HunterId'>;
/** A quest in a hunter's list. */
export type QuestId = Id<'QuestId'>;
/** A title in a hunter's list. */
export type TitleId = Id<'TitleId'>;
/** A shadow in a hunter's list. */
export type ShadowId = Id<'ShadowId'>;
/** An item in a hunter's bag or the GM's library. */
export type ItemId = Id<'ItemId'>;
/** A line of the session log. */
export type LogId = Id<'LogId'>;
/** A roll in this phone's roll log. */
export type RollEntryId = Id<'RollEntryId'>;
/** A skill a hunter holds or the GM's library keeps. */
export type SkillId = Id<'SkillId'>;
/** A hunter's saved set of worn gear. */
export type LoadoutId = Id<'LoadoutId'>;
/** A boon a hunter was granted. */
export type BoonId = Id<'BoonId'>;
/** A reward bundle in the GM's library. */
export type BundleId = Id<'BundleId'>;
/** A Job Change chain: its step quests' `chainId`. */
export type ChainId = Id<'ChainId'>;
/** A monster in the save's bestiary (`save.monsters`), or a built-in's copy (`seed:<word>`). */
export type MonsterId = Id<'MonsterId'>;
/** A gate of the world. */
export type GateId = Id<'GateId'>;
/** A gate id from a stored gate, a waiting ask, or a fight's link to it; null for an empty or too long one. */
export const parseGateId = (v: unknown): GateId | null => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? (v as GateId) : null);
/** One item line inside a gate's clear preset (`pl1`, `pl2`, ...): unique within its preset. */
export type PresetLineId = Id<'PresetLineId'>;
const PRESET_LINE_RE = /^pl\d{1,6}$/;
export const parsePresetLineId = (v: unknown): PresetLineId | null =>
  (typeof v === 'string' && PRESET_LINE_RE.test(v) ? (v as PresetLineId) : null);
export const presetLineId = (n: number): PresetLineId => `pl${n}` as PresetLineId;
/** A gate the System opened for one hunter (`Hunter.solo`, gates/solo.ts): never a gate of the world. */
export type PersonalGateId = Id<'PersonalGateId'>;
/** A battle map in the GM's library. */
export type MapId = Id<'MapId'>;
/** A story in the GM's library (story/story.ts). */
export type StoryId = Id<'StoryId'>;
/** A story on the table: one run of a library story, on the GM's save (notes-1-stories.md 1.4; its machine is unit 3's). */
export type StoryRunId = Id<'StoryRunId'>;
/**
 * A row of a fight: `c` and the save's seq for a hunter's or a monster's, its summoner's id and the time for a summon's
 * (fight.ts), so not a save id's form.
 */
export type CombatantId = Id<'CombatantId'>;
/** A stored row id (the fight's own reader's rule: text of 1 to 80 characters), or null. */
export const parseCombatantId = (v: unknown): CombatantId | null => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? (v as CombatantId) : null);
/** A fight's id: `f` and the save's seq (`f12`), or any non-empty fight id on the wire. */
export type FightId = Id<'FightId'>;
export const fightId = (s: string): FightId => s as FightId;
/** The id each prefix makes (save.ts's repair and the store's `id`). A prefix not listed makes a plain string. */
export type SaveIds = {
  h: HunterId; q: QuestId; t: TitleId; sh: ShadowId; i: ItemId; l: LogId; r: RollEntryId; s: SkillId; lo: LoadoutId; bn: BoonId;
  rb: BundleId; jc: ChainId; m: MonsterId; g: GateId; mp: MapId; pg: PersonalGateId; st: StoryId; sr: StoryRunId;
};
export type IdOf<P extends string> = P extends keyof SaveIds ? SaveIds[P] : string;
/** A save id's form: a prefix and a number (`h12`), or `seed:<word>` for a built-in's copy. */
export const SAVE_ID_RE = /^[a-z]+\d+$|^seed:[a-z0-9-]+$/;
/** A stored id of kind `K`, or null when it is not in a save id's form: the reader of an id kept in a field that names an entity. */
export const parseSaveId = <K extends keyof SaveIds>(v: unknown): SaveIds[K] | null => (typeof v === 'string' && SAVE_ID_RE.test(v) ? (v as SaveIds[K]) : null);
/** The id of kind `K` of a built-in's copy (`seed:<slug>`): the one maker of a seed id. */
export const seedId = <K extends keyof SaveIds>(slug: string): SaveIds[K] => `seed:${slug}` as SaveIds[K];
/** The id `prefix` and the number `n` make: the one maker of a new save id. */
export const saveId = <P extends string>(prefix: P, n: number): IdOf<P> => `${prefix}${n}` as IdOf<P>;
/** A rule title's key (src/core/rules.ts `titles`; a held title's `seedKey`): lower-case words and hyphens, at most 40; else null. */
export const titleKey = (v: unknown): string | null => (typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v) ? v : null);
/** A hunter this phone acts on: one of its own save's, or one on another phone, by its sheet key in the room. */
export type HunterRef = { readonly kind: 'local'; readonly hunterId: HunterId } | { readonly kind: 'remote'; readonly remote: SheetKey };

/** A stored hunter reference, or null when it is not one. */
export function parseHunterRef(v: unknown): HunterRef | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'local') { const hunterId = parseSaveId<'h'>(o.hunterId); return hunterId ? { kind: 'local', hunterId } : null; }
  if (o.kind === 'remote') { const remote = parseSheetKey(o.remote); return remote ? { kind: 'remote', remote } : null; }
  return null;
}
/**
 * The key of hunter `hid` of phone `device` in a room. This phone's ids (`d-` and six characters, `h` and a number, made
 * by the store) keep it inside the 40 characters `parseSheetKey` allows.
 */
export const sheetKeyOf = (device: DeviceId, hid: HunterId): SheetKey => `${device}:${hid}` as SheetKey;
/** The hunter id in a sheet key: the id that hunter has in its own phone's save. */
export const hunterIdOf = (key: SheetKey): HunterId => key.slice(key.indexOf(':') + 1) as HunterId;
/** The phone in a sheet key: a device id, since a sheet key's part before ':' is one (`SHEET_KEY_RE` within 40 characters). */
export const deviceOf = (key: SheetKey): DeviceId => key.slice(0, key.indexOf(':')) as DeviceId;

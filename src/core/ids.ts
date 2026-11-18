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
export const parseRoomCode = (v: unknown): RoomCode | null => (typeof v === 'string' && CODE_RE.test(v) ? (v as RoomCode) : null);
export const parseDeviceId = (v: unknown): DeviceId | null => (typeof v === 'string' && WORD_RE.test(v) ? (v as DeviceId) : null);
export const parseGmKey = (v: unknown): GmKey | null => (typeof v === 'string' && GM_KEY_RE.test(v) ? (v as GmKey) : null);
export const parseEventId = (v: unknown): EventId | null => (typeof v === 'string' && WORD_RE.test(v) ? (v as EventId) : null);
export const parseSheetKey = (v: unknown): SheetKey | null =>
  (typeof v === 'string' && v.length <= 40 && SHEET_KEY_RE.test(v) ? (v as SheetKey) : null);
/** A feat's key, as a status has one: a built-in's is reserved; the GM's own is made from its name and kept through renames (hunter/feats.ts). */
export type FeatKey = Id<'FeatKey'>;
const FEAT_KEY_RE = /^[a-z0-9-]{1,40}$/;
export const parseFeatKey = (v: unknown): FeatKey | null => (typeof v === 'string' && FEAT_KEY_RE.test(v) ? (v as FeatKey) : null);
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
/** A gate the System opened for one hunter (`Hunter.solo`, gates/solo.ts): never a gate of the world. */
export type PersonalGateId = Id<'PersonalGateId'>;
/** A battle map in the GM's library. */
export type MapId = Id<'MapId'>;
/**
 * A row of a fight: `c` and the save's seq for a hunter's or a monster's, its summoner's id and the time for a summon's
 * (fight.ts), so not a save id's form.
 */
export type CombatantId = Id<'CombatantId'>;
/** A stored row id (the fight's own reader's rule: text of 1 to 80 characters), or null. */
export const parseCombatantId = (v: unknown): CombatantId | null => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? (v as CombatantId) : null);
/** The id each prefix makes (save.ts's repair and the store's `id`). A prefix not listed makes a plain string. */
export type SaveIds = {
  h: HunterId; q: QuestId; t: TitleId; sh: ShadowId; i: ItemId; l: LogId; r: RollEntryId; s: SkillId; lo: LoadoutId; bn: BoonId;
  rb: BundleId; jc: ChainId; m: MonsterId; g: GateId; mp: MapId; pg: PersonalGateId;
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

/**
 * The key of hunter `hid` of phone `device` in a room. This phone's ids (`d-` and six characters, `h` and a number, made
 * by the store) keep it inside the 40 characters `parseSheetKey` allows.
 */
/** A stored hunter reference, or null when it is not one. */
export function parseHunterRef(v: unknown): HunterRef | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'local') { const hunterId = parseSaveId<'h'>(o.hunterId); return hunterId ? { kind: 'local', hunterId } : null; }
  if (o.kind === 'remote') { const remote = parseSheetKey(o.remote); return remote ? { kind: 'remote', remote } : null; }
  return null;
}
export const sheetKeyOf = (device: DeviceId, hid: HunterId): SheetKey => `${device}:${hid}` as SheetKey;
/** The hunter id in a sheet key: the id that hunter has in its own phone's save. */
export const hunterIdOf = (key: SheetKey): HunterId => key.slice(key.indexOf(':') + 1) as HunterId;
/** The phone in a sheet key: a device id, since a sheet key's part before ':' is one (`SHEET_KEY_RE` within 40 characters). */
export const deviceOf = (key: SheetKey): DeviceId => key.slice(0, key.indexOf(':')) as DeviceId;

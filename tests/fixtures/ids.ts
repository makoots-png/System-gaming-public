// ids.ts: the save's and the room's ids, and day keys, for tests, each read by its parser in src/core/ids.ts, so a test cannot hold an
// id the app would refuse.
import { parseCombatantId, parseDeviceId, parseGmKey, parseRoomCode, parseSaveId } from '../../src/core/ids.ts';
import { parseDayKey } from '../../src/core/day.ts';
import { monsterId, parseGateId } from '../../src/core/gates/gate.ts';
import type { DayKey } from '../../src/core/day.ts';
import type { BundleId, ChainId, CombatantId, DeviceId, GateId, GmKey, HunterId, ItemId, LoadoutId, LogId, MonsterId, QuestId, RollEntryId, RoomCode, ShadowId, SkillId, TitleId } from '../../src/core/ids.ts';

const must = <T>(v: T | null, s: string): T => { if (v === null) throw new Error(`not an id: ${s}`); return v; };
export const dev = (s: string): DeviceId => must(parseDeviceId(s), s);
export const room = (s: string): RoomCode => must(parseRoomCode(s), s);
export const gmKey = (s: string): GmKey => must(parseGmKey(s), s);
export const hid = (s: string): HunterId => must(parseSaveId<'h'>(s), s);
export const qid = (s: string): QuestId => must(parseSaveId<'q'>(s), s);
export const tid = (s: string): TitleId => must(parseSaveId<'t'>(s), s);
export const shid = (s: string): ShadowId => must(parseSaveId<'sh'>(s), s);
export const iid = (s: string): ItemId => must(parseSaveId<'i'>(s), s);
export const lid = (s: string): LogId => must(parseSaveId<'l'>(s), s);
/** A day key (src/core/day.ts), read by its parser. */
export const day = (s: string): DayKey => must(parseDayKey(s), s);
export const rid = (s: string): RollEntryId => must(parseSaveId<'r'>(s), s);
export const skid = (s: string): SkillId => must(parseSaveId<'s'>(s), s);
export const loid = (s: string): LoadoutId => must(parseSaveId<'lo'>(s), s);
export const rbid = (s: string): BundleId => must(parseSaveId<'rb'>(s), s);
export const jcid = (s: string): ChainId => must(parseSaveId<'jc'>(s), s);
/** A monster as a gate, a codex entry or a fight's link names it (gate.ts's reader). */
export const mid = (s: string): MonsterId => must(monsterId(s), s);
/** A gate as a fight's link names it (gate.ts's reader). */
export const gid = (s: string): GateId => must(parseGateId(s), s);
/** A fight row, read as the save reads one. */
export const cid = (s: string): CombatantId => must(parseCombatantId(s), s);

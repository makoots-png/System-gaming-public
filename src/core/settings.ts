// settings.ts: what this campaign's settings hold that a person chooses (`save.settings`): whether onboarding is done,
// the sound, the hour the dailies reset. Each is an `atSettings` step (save-step.ts) a view gives to `store.apply`. The
// mode a phone chose while alone is `chooseMode` (role.ts), the hunter it shows `setActive` (party.ts); the room fields
// of the settings (`settings.sync`) are src/edge/sync.ts's. A device pref (store.prefs) is not the save:
// `store.setPrefs` writes it.
import type { Settings } from './save.ts';
/** Onboarding done: the welcome windows do not open again. */
export const onboarded = (s: Settings): Settings => ({ ...s, onboarded: true });
/** The sound on or off. */
export const withSound = (s: Settings, on: boolean): Settings => ({ ...s, sound: on });
/** The hour (0 to 23) the dailies reset, from the field's text: a whole hour, clamped; an empty or unreadable field keeps the old one. */
export function withResetHour(s: Settings, text: string): Settings {
  const n = Math.round(Number(text));
  return text !== '' && Number.isFinite(n) ? { ...s, dailyResetHour: Math.min(23, Math.max(0, n)) } : s;
}

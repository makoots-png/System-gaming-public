// Where this phone sits and whether it is the GM. The one place that decides. Pure: callers pass the settings and the
// room the link is in (`sync.room()`); a view asks `app.seat()` or `app.isGM()`.

export type Role = 'gm' | 'player';

/** Where this phone sits: alone (in no room), the GM of the room it is in, or a player in it. */
export type Seat = 'alone' | Role;

/** The part of the settings the seat and the role depend on. */
export type RoleSettings = {
  /** What this phone chose while not in a room. */
  mode: Role;
  sync: {
    /** The GM key this phone holds for the room it is in, or null (absent in a save that never held one). */
    gmKey?: string | null | undefined;
  };
};

/** `room`: the room this phone's link is in, null when it is in none. In a room, the phone that holds its GM key is the GM. */
export const seatOf = (settings: RoleSettings, room: string | null): Seat => (room === null ? 'alone' : settings.sync.gmKey ? 'gm' : 'player');

/** In a room the role is the seat. Alone, the phone chooses. */
export function roleOf(settings: RoleSettings, room: string | null): Role {
  const seat = seatOf(settings, room);
  return seat === 'alone' ? settings.mode : seat;
}

/** Whether this phone runs a fight of its own: a phone alone runs its own; in a room only the GM's does, and a player plays in the GM's. */
export const runsFight = (seat: Seat): boolean => seat !== 'player';

/**
 * What this phone chooses while alone (the GM/player switch, onboarding, the starter campaign). In a room the room
 * decides (`seatOf`) and this choice waits for the phone to be alone again. Choosing twice in a row is choosing once.
 */
export const chooseMode = <S extends RoleSettings>(settings: S, mode: Role): S => ({ ...settings, mode });

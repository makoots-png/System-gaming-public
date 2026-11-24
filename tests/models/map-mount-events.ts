// The events of the battle map's life on the page (src/core/combat/map-mount.ts), over two fights, shared by
// tests/map-mount.test.ts and the state chart (scripts/charts/map-mount.ts), so both walk the same events.
import { fightId } from '../../src/core/ids.ts';
import type { BuildDrawerEvent, MapMountEvent } from '../../src/core/combat/map-mount.ts';

/** Two fights one after the other on the same ground. */
export const MOUNT_FIGHTS = [fightId('f1'), fightId('f2')] as const;
/** Every event, from every state: each fight shown and none, a draw with a token or none, with words over the frame or not, a turn lost from sight, the frame's size read shown and hidden with each words, a resize shown and hidden, and the removal. */
export const MOUNT_WALK: readonly MapMountEvent[] = [
  ...MOUNT_FIGHTS.map(fight => ({ kind: 'show', fight }) as const),
  { kind: 'show', fight: null },
  { kind: 'drawn', tokens: false, over: '', lost: false },
  { kind: 'drawn', tokens: true, over: '', lost: false },
  { kind: 'drawn', tokens: true, over: 'your turn', lost: false },
  { kind: 'drawn', tokens: true, over: '', lost: true },
  { kind: 'sized', shown: true, over: '' },
  { kind: 'sized', shown: true, over: 'your turn' },
  { kind: 'sized', shown: false, over: '' },
  { kind: 'resized', shown: true },
  { kind: 'resized', shown: false },
  { kind: 'gone' },
];

/** Every event of the Build drawer (map-mount.ts `buildDrawer`) over the two fights and none: a toggle with and against the screen in each, and each drawn. */
export const DRAWER_WALK: readonly BuildDrawerEvent[] = [
  ...[...MOUNT_FIGHTS, null].flatMap(fight => [
    { kind: 'toggled', open: true, wanted: false, fight },
    { kind: 'toggled', open: true, wanted: true, fight },
    { kind: 'drawn', fight },
  ] as const),
];

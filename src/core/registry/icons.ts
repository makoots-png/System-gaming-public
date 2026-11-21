// icons.ts: every picture the game draws, named once: a key, the group a picker lists it under, a label and the path
// data of a 24 by 24 filled silhouette (docs/agent-handoff/features/icons/design.md section 1). Pure: a path is a string
// of data, so core holds no markup; a view makes the `<svg>` from it. A key once saved is never renamed (a hunter's
// emblem is saved by key): change the drawing instead. To add one: a row of ICONS, then `bun run test`
// (tests/icons.test.ts checks the key, the group, the label and that every point of the path lies inside 0 to 24).

/** The places a picker lists icons under. */
export const ICON_GROUPS = ['foe', 'item', 'status', 'ability', 'emblem'] as const;
/** One of the groups of icons. */
export type IconGroup = (typeof ICON_GROUPS)[number];
/** What the registry holds of an icon: where it is listed, its name for a person (a picker's aria label and tooltip), its path data. */
type IconDef = { readonly group: IconGroup; readonly label: string; readonly path: string };

/** A hunter's emblems: the first twelve icons, in the order a picker shows them. */
const ICONS = {
  star: { group: 'emblem', label: 'Star', path: 'M12 2l3 7h7l-5.5 4.5 2 7.5L12 17l-6.5 4 2-7.5L2 9h7z' },
  crown: { group: 'emblem', label: 'Crown', path: 'M3 19h18l-1-11-5 4-3-7-3 7-5-4z' },
  moon: { group: 'emblem', label: 'Moon', path: 'M15 3a9 9 0 1 0 6 15A7 7 0 0 1 15 3z' },
  flame: { group: 'emblem', label: 'Flame', path: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z' },
  shield: { group: 'emblem', label: 'Shield', path: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z' },
  blade: { group: 'emblem', label: 'Blade', path: 'M19 2l3 3-12 12-3-3zM6 15l3 3-3 3-3-3z' },
  eye: { group: 'emblem', label: 'Eye', path: 'M2 12c3-5 7-7 10-7s7 2 10 7c-3 5-7 7-10 7S5 17 2 12zm10-4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  bolt: { group: 'emblem', label: 'Bolt', path: 'M13 2L4 14h7l-1 8 9-12h-7z' },
  skull: { group: 'emblem', label: 'Skull', path: 'M12 2a8 8 0 0 0-8 8c0 3 1.5 5 3 6v4h10v-4c1.5-1 3-3 3-6a8 8 0 0 0-8-8zM9 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z' },
  wing: { group: 'emblem', label: 'Wing', path: 'M2 6c6 0 10 3 10 9v6c-2-3-5-4-10-4 3-1 5-2 6-3-3 0-5-1-6-3 3 0 5 0 6-1-3-1-5-2-6-4z' },
  diamond: { group: 'emblem', label: 'Diamond', path: 'M12 2l9 10-9 10-9-10z' },
  fang: { group: 'emblem', label: 'Fang', path: 'M4 3h16l-3 8-5 11-5-11z' },
} satisfies Record<string, IconDef>;

/** The key of an icon of the registry. */
export type IconKey = keyof typeof ICONS;
/** Every key, in the order of the table. */
export const ICON_KEYS = Object.keys(ICONS) as readonly IconKey[];
/** The longest key an icon may have. */
export const ICON_KEY_MAX = 20;
/** Whether `v` is the key of an icon of the registry: the one check for a key read from a save, a room or the page. */
export const isIconKey = (v: unknown): v is IconKey => typeof v === 'string' && Object.hasOwn(ICONS, v);
/** An icon's group, label and path. */
export const iconDef = (k: IconKey): IconDef => ICONS[k];
/** The keys of one group, in the order of the table: what a picker lists. */
export const iconsOf = (group: IconGroup): readonly IconKey[] => ICON_KEYS.filter(k => ICONS[k].group === group);

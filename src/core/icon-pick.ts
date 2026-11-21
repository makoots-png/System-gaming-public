// icon-pick.ts: the Icon row of the monster, item and status makers (docs/agent-handoff/features/icons/design.md section
// 6), one machine and its words. The row shows the icon in use and why; a tap opens a sheet over the maker on a group of
// the registry (`open`), a tap on a group shows that group, a tap on a cell picks it and closes the sheet, and Escape, a
// tap beside the sheet or its close button closes it and keeps the pick (`closed`). The pick is a key of the registry, or null for
// "Default", which stores none: the thing then shows its default (src/core/registry/icon-defaults.ts) as its form
// changes. A GM may give any icon to anything (the owner's ruling 2), so every group is offered, the thing's own first.
// src/views/maker.js keeps one value per maker and moves it only by `iconPickStep`.
import { ICON_GROUPS, iconDef } from './registry/icons.ts';
import type { IconGroup, IconKey } from './registry/icons.ts';
import { itemIcon, monsterIcon, statusIcon } from './registry/icon-defaults.ts';
import type { IconItem } from './registry/icon-defaults.ts';
import type { Archetype } from './hunter/derive.ts';
import type { StatusDef } from './combat/effect-ops.ts';

/** The things a GM picks an icon for, each in its own maker. */
export type IconThing = 'monster' | 'item' | 'status';
/** Each thing's own group: the one its sheet lists first and opens on when nothing is picked. */
const OWN_GROUP: { readonly [T in IconThing]: IconGroup } = { monster: 'foe', item: 'item', status: 'status' };
/** The row of groups in a thing's sheet: its own first, then the rest in the registry's order. */
export const pickerGroups = (thing: IconThing): readonly IconGroup[] => [OWN_GROUP[thing], ...ICON_GROUPS.filter(g => g !== OWN_GROUP[thing])];
/** A group's name on its button in the sheet. */
export const GROUP_WORDS: { readonly [G in IconGroup]: string } = { foe: 'Foe', item: 'Item', status: 'Status', ability: 'Ability', emblem: 'Emblem' };

/** A maker's icon: the pick (null: "Default"), and the sheet closed or open at a group. */
export type IconPick =
  | { readonly at: 'closed'; readonly thing: IconThing; readonly pick: IconKey | null }
  | { readonly at: 'open'; readonly thing: IconThing; readonly pick: IconKey | null; readonly group: IconGroup };
export const ICON_PICK_STATES = ['closed', 'open'] as const satisfies readonly IconPick['at'][];
/** A maker's icon as it opens on a thing saved with `pick`, or on a new thing. */
export const iconPickStart = (thing: IconThing, pick: IconKey | null = null): IconPick => ({ at: 'closed', thing, pick });

/**
 * What moves it: `opened` a tap on the Icon row, `group` a tap on a group in the sheet, `picked` a tap on a cell (null
 * the "Default" cell), `shut` Escape, a tap beside the sheet or on its close button.
 */
export type IconPickEvent =
  | { readonly kind: 'opened' }
  | { readonly kind: 'group'; readonly group: IconGroup }
  | { readonly kind: 'picked'; readonly key: IconKey | null }
  | { readonly kind: 'shut' };
export const ICON_PICK_EVENTS = ['opened', 'group', 'picked', 'shut'] as const satisfies readonly IconPickEvent['kind'][];

type Cell<S extends IconPick['at'], K extends IconPickEvent['kind']> = (s: Extract<IconPick, { at: S }>, e: Extract<IconPickEvent, { kind: K }>) => IconPick;
/** What each event does from each state; a cell that answers its state unchanged is a move that changes nothing. */
const TABLE: { readonly [S in IconPick['at']]: { readonly [K in IconPickEvent['kind']]: Cell<S, K> } } = {
  closed: {
    // the pick's group, so the pick in use is lit; with none, the thing's own
    opened: s => ({ at: 'open', thing: s.thing, pick: s.pick, group: s.pick ? iconDef(s.pick).group : OWN_GROUP[s.thing] }),
    group: s => s,
    picked: s => s,
    shut: s => s,
  },
  open: {
    opened: s => s,
    group: (s, e) => (s.group === e.group ? s : { ...s, group: e.group }),
    picked: (s, e) => ({ at: 'closed', thing: s.thing, pick: e.key }),
    shut: s => ({ at: 'closed', thing: s.thing, pick: s.pick }),
  },
};

/** The icon after `e`; the same value when `e` changes nothing, so a caller draws only a change. */
export function iconPickStep(s: IconPick, e: IconPickEvent): IconPick {
  const row = TABLE[s.at] as { readonly [K in IconPickEvent['kind']]: (s: IconPick, e: IconPickEvent) => IconPick };
  return row[e.kind](s, e);
}

// ── why a thing shows its icon ──
/** What a maker's form holds that its default is read from (the `icon` a subject may carry is ignored: the pick is passed apart). */
export type IconSubject =
  | { readonly thing: 'monster'; readonly monster: { readonly type?: string; readonly archetype: Archetype } }
  | { readonly thing: 'item'; readonly item: IconItem }
  | { readonly thing: 'status'; readonly key: string; readonly def: Pick<StatusDef, 'ops' | 'end'> };
/** Where the icon in use comes from: the GM's pick, or the field of the form its default is read from. */
export type IconFrom = 'picked' | 'type' | 'archetype' | 'attack' | 'slot' | 'revive' | 'builtIn' | 'effect' | 'end' | 'plain';
/** The icon a thing shows and where it comes from. */
export type IconShown = { readonly key: IconKey; readonly from: IconFrom };
const FROM_WORDS: { readonly [F in IconFrom]: string } = {
  picked: 'picked', type: 'from its type', archetype: 'from its archetype', attack: 'from its attack', slot: 'from its slot',
  revive: 'as it revives', builtIn: 'the built-in\'s', effect: 'from its first effect', end: 'from its end', plain: 'the default',
};

/**
 * The first of `fields` whose absence changes the picture `key`, else `rest`. The default rules stay in
 * icon-defaults.ts: a field is named here only when the picture would differ without it, so the line never names a
 * field the rule did not read. The fields are given most particular first, so a picture two of them give alike is
 * named by the more particular one only when it alone decides.
 */
const decidedBy = <F extends IconFrom>(key: IconKey, fields: readonly (readonly [F, IconKey])[], rest: F): F =>
  fields.find(([, without]) => without !== key)?.[0] ?? rest;

/** The icon `s` shows with `pick` (null: its default), and where it comes from. */
export function iconShown(s: IconSubject, pick: IconKey | null): IconShown {
  switch (s.thing) {
    case 'monster': {
      const { type, archetype } = s.monster, key = pick ?? monsterIcon({ archetype, ...(type === undefined ? {} : { type }) });
      return { key, from: pick ? 'picked' : decidedBy(key, [['type', monsterIcon({ archetype })]], 'archetype') };
    }
    case 'item': {
      const { type, slot, attack, revive } = s.item;
      const attacks = attack ? { attack } : {}, revives = revive ? { revive } : {};
      const key = pick ?? itemIcon({ type, slot, ...attacks, ...revives });
      return {
        key, from: pick ? 'picked' : decidedBy(key, [
          ['revive', itemIcon({ type, slot, ...attacks })], ['attack', itemIcon({ type, slot, ...revives })], ['slot', itemIcon({ type, slot: null, ...attacks, ...revives })],
        ], 'type'),
      };
    }
    case 'status': {
      const { ops, end } = s.def, ends = end ? { end } : {}, key = pick ?? statusIcon(s.key, { ops, ...ends });
      if (pick) return { key, from: 'picked' };
      // '' is no built-in's key: without its own, the picture its effects and end give
      if (statusIcon('', { ops, ...ends }) !== key) return { key, from: 'builtIn' };
      return { key, from: decidedBy(key, [['effect', statusIcon('', { ops: [], ...ends })], ['end', statusIcon('', { ops: [] })]], 'plain') };
    }
  }
}

/** The line beside the Icon row's button: "Wolf, from its type", "Raven, picked". */
export const iconWords = (shown: IconShown): string => `${iconDef(shown.key).label}, ${FROM_WORDS[shown.from]}`;

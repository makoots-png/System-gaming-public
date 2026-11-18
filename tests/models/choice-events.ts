// The map's choice and the events a viewer gives it on one small fight: the hunter `@` with a foe beside it and one two
// tiles off, a strike and a self ward in its kit. Shared by the state chart (scripts/charts/choice.ts) and any test that
// walks the choice, so both walk the same events.
import { RULES } from '../../src/core/rules.ts';
import { abilityId, combatantId } from '../../src/core/combat/ability-types.ts';
import type { Ability, CombatantId } from '../../src/core/combat/ability-types.ts';
import { openGrid, place, tiles } from '../../src/core/combat/space.ts';
import type { Place, Side } from '../../src/core/combat/space.ts';
import { abilityOf } from '../../src/core/registry/ability-kinds.ts';
import { NO_CHOICE, choose, mapScene } from '../../src/core/combat/map-view.ts';
import type { Choice, ChoiceEvent, MapBody, MapInput, MapScene } from '../../src/core/combat/map-view.ts';

const body = (name: string, side: Side, at: Place, mine = false): MapBody => ({
  id: combatantId(name), side, kind: side === 'party' ? 'hunter' : 'monster', place: at, down: false, name,
  ring: { share: 1, band: null }, statuses: false, mine, stride: tiles(mine ? 3 : 0), dash: tiles(mine ? 6 : 0), bars: null,
  extras: { shield: null, stagger: null, channel: null, taunted: false, reacted: false }, aim: null, summon: null, stealth: false,
});
export const HUNTER: CombatantId = combatantId('@');
/** A row of eight: `@` at 1, a foe `g` beside it at 2, a foe `h` at 5. */
const BODIES = [body('@', 'party', place(1, 0), true), body('g', 'foe', place(2, 0)), body('h', 'foe', place(5, 0))];
const input = (actor: CombatantId | null): MapInput => ({ bodies: BODIES, grid: openGrid(8, 2), currentId: HUNTER, actor });
export const STRIKE: Ability = abilityOf('strike', { id: abilityId('strike'), name: 'Strike' }, RULES);
export const WARD: Ability = { ...abilityOf('support', { id: abilityId('ward'), name: 'Ward' }, RULES), aim: 'self' };
export const KIT: readonly Ability[] = [STRIKE, WARD];
/** The scene this viewer draws from `c` while it plays `@`'s turn, or watches when `actor` is null. */
export const sceneOf = (c: Choice, actor: CombatantId | null = c.actor): MapScene => mapScene(input(actor), c.now, RULES);
/** A turn of `@` just begun. */
export const START: Choice = choose(NO_CHOICE, { kind: 'seen', actor: HUNTER, kit: KIT, waiting: false }).choice;

/** Each event as the view makes it from the choice it has (its scene drawn from that choice). */
export const WALK_EVENTS: readonly { readonly name: string; readonly of: (c: Choice) => ChoiceEvent }[] = [
  { name: 'tap a tile in reach', of: c => ({ kind: 'tap', scene: sceneOf(c), at: place(0, 0) }) },
  { name: 'tap the foe beside', of: c => ({ kind: 'tap', scene: sceneOf(c), at: place(2, 0) }) },
  { name: 'tap the far foe', of: c => ({ kind: 'tap', scene: sceneOf(c), at: place(5, 0) }) },
  { name: 'tap far ground', of: c => ({ kind: 'tap', scene: sceneOf(c), at: place(7, 1) }) },
  { name: 'double tap', of: () => ({ kind: 'double' }) },
  { name: 'pick Strike', of: c => ({ kind: 'pick', scene: sceneOf(c), ability: STRIKE }) },
  { name: 'pick Ward', of: c => ({ kind: 'pick', scene: sceneOf(c), ability: WARD }) },
  { name: 'Cancel', of: () => ({ kind: 'cancel' }) },
  { name: 'Move or Use', of: c => ({ kind: 'go', scene: sceneOf(c) }) },
  { name: 'End turn', of: c => ({ kind: 'pass', scene: sceneOf(c) }) },
  { name: 'More', of: () => ({ kind: 'more' }) },
  { name: 'the turn passes on', of: () => ({ kind: 'seen', actor: null, kit: KIT, waiting: false }) },
  { name: 'the turn comes back', of: () => ({ kind: 'seen', actor: HUNTER, kit: KIT, waiting: false }) },
  { name: 'the aimed ability leaves the kit', of: c => ({ kind: 'seen', actor: c.actor, kit: [WARD], waiting: false }) },
];

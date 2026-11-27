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
import type { Choice, ChoiceEvent, MapBody, MapDodge, MapInput, MapScene } from '../../src/core/combat/map-view.ts';

const body = (name: string, side: Side, at: Place, mine = false): MapBody => ({
  id: combatantId(name), side, kind: side === 'party' ? 'hunter' : 'monster', place: at, down: false, name,
  ring: { share: 1, band: null }, statuses: false, mine, stride: tiles(mine ? 3 : 0), dash: tiles(mine ? 6 : 0), bars: null,
  extras: { shield: null, stagger: null, channel: null, taunted: false, reacted: false }, aim: null, summon: null, unseen: false, word: null, icon: null, pack: side !== 'party',
});
export const HUNTER: CombatantId = combatantId('@');
/** A row of eight: `@` at 1, a foe `g` beside it at 2, a foe `h` at 5. */
const BODIES = [body('@', 'party', place(1, 0), true), body('g', 'foe', place(2, 0)), body('h', 'foe', place(5, 0))];
/** A dodge prompt for `@` with two safe tiles: (0,0) as the nearest default and (0,1) as an alternate. */
export const DODGE: MapDodge = {
  n: 1, who: HUNTER, mode: 'out', ability: 'Blast', reach: tiles(1), left: tiles(6), max: tiles(6),
  tiles: [{ place: place(1, 0), steps: tiles(0), avoid: 'caught' }, { place: place(0, 0), steps: tiles(1), avoid: 'out' }, { place: place(0, 1), steps: tiles(1), avoid: 'out' }],
  auto: place(0, 0), hit: [place(1, 0)], ring: [place(1, 1)],
};
const input = (actor: CombatantId | null, dodge: MapDodge | null = null): MapInput => ({ bodies: BODIES, grid: openGrid(8, 2), currentId: HUNTER, actor, dodge });
export const STRIKE: Ability = abilityOf('strike', { id: abilityId('strike'), name: 'Strike' }, RULES);
export const WARD: Ability = { ...abilityOf('support', { id: abilityId('ward'), name: 'Ward' }, RULES), aim: 'self' };
export const KIT: readonly Ability[] = [STRIKE, WARD];
/** The scene this viewer draws from `c` while it plays `@`'s turn, watches, or picks a dodge tile. */
export const sceneOf = (c: Choice, actor: CombatantId | null = c.actor): MapScene => mapScene(input(c.now.kind === 'dodge' ? null : actor, c.now.kind === 'dodge' ? DODGE : null), c.now, RULES);
/** A turn of `@` just begun. */
export const START: Choice = choose(NO_CHOICE, { kind: 'seen', actor: HUNTER, kit: KIT, waiting: false }).choice;

/** Each event as the view makes it from the choice it has (its scene drawn from that choice). */
export const WALK_EVENTS: readonly { readonly name: string; readonly of: (c: Choice) => ChoiceEvent }[] = [
  { name: 'tap a tile in reach', of: c => ({ kind: 'tap', scene: sceneOf(c), at: place(0, 0) }) },
  { name: 'tap offered dodge tile', of: c => ({ kind: 'tap', scene: sceneOf(c), at: place(0, 1) }) },
  { name: 'tap the foe beside', of: c => ({ kind: 'tap', scene: sceneOf(c), at: place(2, 0) }) },
  { name: 'tap the far foe', of: c => ({ kind: 'tap', scene: sceneOf(c), at: place(5, 0) }) },
  { name: 'tap far ground', of: c => ({ kind: 'tap', scene: sceneOf(c), at: place(7, 1) }) },
  { name: 'double tap', of: () => ({ kind: 'double' }) },
  { name: 'pick Strike', of: c => ({ kind: 'pick', scene: sceneOf(c), ability: STRIKE }) },
  { name: 'pick Ward', of: c => ({ kind: 'pick', scene: sceneOf(c), ability: WARD }) },
  { name: 'Cancel', of: () => ({ kind: 'cancel' }) },
  { name: 'Move, Use or Dodge', of: c => ({ kind: 'go', scene: sceneOf(c) }) },
  { name: 'End turn', of: c => ({ kind: 'pass', scene: sceneOf(c) }) },
  { name: 'More', of: () => ({ kind: 'more' }) },
  { name: 'the turn passes on', of: () => ({ kind: 'seen', actor: null, kit: KIT, waiting: false }) },
  { name: 'the turn comes back', of: () => ({ kind: 'seen', actor: HUNTER, kit: KIT, waiting: false }) },
  { name: 'the aimed ability leaves the kit', of: c => ({ kind: 'seen', actor: c.actor, kit: [WARD], waiting: false }) },
  { name: 'dodge opens', of: () => ({ kind: 'seen', actor: null, kit: KIT, waiting: false, dodge: { n: DODGE.n, auto: DODGE.auto } }) },
  { name: 'dodge closes', of: () => ({ kind: 'seen', actor: HUNTER, kit: KIT, waiting: false, dodge: null }) },
];

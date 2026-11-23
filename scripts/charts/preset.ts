// The chart of a gate's clear preset (src/core/gates/preset.ts `presetStep`), walked with every event.
import { NO_PRESET, PRESET_STATES, presetStep } from '../../src/core/gates/preset.ts';
import type { ClearPreset, PresetEvent, PresetItem, PresetState } from '../../src/core/gates/preset.ts';
import { presetLineId } from '../../src/core/ids.ts';
import type { HunterId } from '../../src/core/ids.ts';
import { parseItem } from '../../src/core/registry/items.ts';
import { bfs, machine } from '../statecharts.ts';

const POTION = parseItem({ name: 'Health Potion', type: 'consumable', rar: 'common' })!;
const SWORD = parseItem({ name: 'Iron Blade', type: 'weapon', slot: 'weapon', dice: '1d8', rar: 'uncommon' })!;
const LINE: PresetItem = { id: presetLineId(1), item: POTION, checked: true, to: null };
const AT = '2026-11-22T20:00:00.000Z';

const EVENTS: readonly PresetEvent[] = [
  { type: 'recommend', xp: 150, gold: 100, items: [LINE] },
  { type: 'setGold', gold: 200 },
  { type: 'setXp', xp: 250 },
  { type: 'toggleItem', id: presetLineId(1), checked: false },
  { type: 'assignItem', id: presetLineId(1), to: { kind: 'local', hunterId: 'h1' as HunterId } },
  { type: 'addItem', item: SWORD, to: null },
  { type: 'removeItem', id: presetLineId(1) },
  { type: 'clear' },
  { type: 'pay', at: AT },
];

const LABEL: { readonly [S in PresetState]: string } = {
  none: 'No preset (rolls at clear)',
  recommended: 'Recommended set filled',
  edited: 'Edited by the GM',
  paid: 'Paid at the clear',
};

function stepLabel(e: PresetEvent): string {
  switch (e.type) {
    case 'recommend': return 'the GM opens or resets What this clear pays';
    case 'setGold': case 'setXp': case 'toggleItem': case 'assignItem': case 'addItem': case 'removeItem':
      return 'the GM edits gold, XP, or items';
    case 'clear': return 'the GM removes the clear preset';
    case 'pay': return 'the gate is cleared: clear preset paid once';
  }
}

export const clearPreset = machine<ClearPreset, PresetEvent>({
  name: 'A gate\'s clear preset',
  walked: 'Every state reachable from a gate with no preset (`none`) under the 9 events of `PRESET_EVENTS`, breadth first.',
  walk: () => bfs<ClearPreset, PresetEvent>([NO_PRESET], s => EVENTS.flatMap(event => {
    const to = presetStep(s, event);
    return to ? [{ event, to }] : [];
  }), s => s.at),
  kinds: PRESET_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'A gate\'s clear preset, from none to paid',
    note: 'Stored on `Gate.preset` on the GM\'s save and left out of the room\'s world doc so players never see it before the clear. Opening What this clear pays fills a recommended set from the loot rules (`recommended`). Any edit of gold, XP, checkboxes, item recipients, or lines moves it to `edited`. Clearing the gate pays the exact checked set once (`paid`, terminal, never rolled or paid again).',
    hides: '',
    state: s => LABEL[s.at],
    step: e => stepLabel(e),
  }],
  where: [
    ['The union', '`ClearPreset`, `PresetEvent`, and `PRESET_STATES` in `src/core/gates/preset.ts`; stored on `Gate.preset`'],
    ['What changes it', '`presetStep(preset, event)` and `PRESET_TABLE`; `gatePreset` (GM edits) and `payGatePreset` (clear settlement)'],
    ['Who calls it', '`src/views/gates.js` ("What this clear pays" panel), `settleClearPreset` (`src/core/gates/pay.ts`), and `soloTaken` / `soloRan` (`src/core/gates/solo.ts`)'],
    ['The test to copy', '`tests/preset.test.ts`'],
    ['The recipe', 'docs/guide/gates-solo.md, "Where things live"'],
  ],
});

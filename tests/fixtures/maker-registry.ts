// Single registry of every maker and saved-entity editor in src/views/.
// tests/lint.test.ts enforces that every PACK_KINDS entry, every *-maker.js / *-editor.js file, every maker.open(
// caller (except explicit non-editor pickers below), and every core edit-step caller has a row here and is covered by
// tests/maker-roundtrip.test.ts and/or tests/e2e/maker-roundtrip.e2e.ts.
import type { PackKind } from '../../src/core/pack.ts';

export type MakerCoverage = 'unit' | 'e2e' | 'both';

export type MakerRegistryEntry = {
  readonly id: string;
  readonly viewFile: string;
  readonly packKind?: PackKind;
  readonly opensMaker: boolean;
  readonly coverage: MakerCoverage;
  readonly description: string;
};

/** Every maker and saved-entity editor surface in the app. */
export const ROUNDTRIP_REGISTRY = [
  { id: 'status', viewFile: 'src/views/forge.js', packKind: 'statuses', opensMaker: true, coverage: 'e2e', description: 'Status forge (library.statuses)' },
  { id: 'item', viewFile: 'src/views/loot.js', packKind: 'items', opensMaker: true, coverage: 'e2e', description: 'Item maker (library.items and hunter items)' },
  { id: 'skill', viewFile: 'src/views/skills.js', packKind: 'skills', opensMaker: true, coverage: 'e2e', description: 'Skill maker (library.skills)' },
  { id: 'skill-swap', viewFile: 'src/views/kit-parts.js', opensMaker: false, coverage: 'e2e', description: 'Skill maker shadow-swap movement (kit-parts.js MOVE_LABEL)' },
  { id: 'monster', viewFile: 'src/views/bestiary.js', packKind: 'monsters', opensMaker: true, coverage: 'e2e', description: 'Monster maker (monsters)' },
  { id: 'npc', viewFile: 'src/views/npc-maker.js', packKind: 'npcs', opensMaker: true, coverage: 'both', description: 'NPC maker (library.npcs)' },
  { id: 'rewards', viewFile: 'src/views/reward-editor.js', opensMaker: false, coverage: 'both', description: 'Embedded reward editor (reward-rows.ts projection)' },
  { id: 'bundle', viewFile: 'src/views/reward-editor.js', packKind: 'rewards', opensMaker: true, coverage: 'both', description: 'Reward bundle maker (library.rewards)' },
  { id: 'map', viewFile: 'src/views/map-maker.js', packKind: 'maps', opensMaker: true, coverage: 'both', description: 'Battle map maker (library.maps, maps.ts projection)' },
  { id: 'feat', viewFile: 'src/views/feat-maker.js', packKind: 'feats', opensMaker: true, coverage: 'both', description: 'Feat maker (library.feats)' },
  { id: 'story', viewFile: 'src/views/story-maker.js', packKind: 'stories', opensMaker: true, coverage: 'both', description: 'Story maker (library.stories)' },
  { id: 'quest', viewFile: 'src/views/quests.js', opensMaker: false, coverage: 'both', description: 'Quest editor (quests.js + quest-fields.js)' },
  { id: 'gate', viewFile: 'src/views/gates.js', opensMaker: false, coverage: 'both', description: 'Gate edit panel (gates.js + difficulty-control.js)' },
  { id: 'preset', viewFile: 'src/views/gates.js', opensMaker: false, coverage: 'both', description: 'Gate clear preset panel (gates.js + preset.ts)' },
  { id: 'title', viewFile: 'src/views/hunter.js', opensMaker: false, coverage: 'both', description: 'Hunter title editor (hunter.js + record.ts)' },
  { id: 'guild', viewFile: 'src/views/guild.js', opensMaker: false, coverage: 'both', description: 'Guild membership editor (guild.js + guild.ts projection)' },
  { id: 'identity', viewFile: 'src/views/custom.js', opensMaker: false, coverage: 'both', description: 'Hunter emblem and color picker (custom.js + identity.ts)' },
  { id: 'rules-overrides', viewFile: 'src/views/gm.js', opensMaker: false, coverage: 'both', description: 'GM rules overrides JSON editor (gm.js + overrides.ts)' },
  { id: 'roll-tables', viewFile: 'src/views/gm.js', opensMaker: false, coverage: 'both', description: 'GM roll tables editor (gm.js + settings.ts)' },
  { id: 'item-def', viewFile: 'src/views/loot.js', opensMaker: true, coverage: 'unit', description: 'Item def save by id: the Bag\'s Edit and the Workshop\'s (library.ts saveItemDef, item sync PR 2)' },
  { id: 'typed-weapon', viewFile: 'src/views/loot.js', opensMaker: true, coverage: 'both', description: 'Weapon with custom damageType (loot.js + items.ts)' },
  { id: 'true-ability', viewFile: 'src/views/skills.js', opensMaker: true, coverage: 'both', description: 'Active skill with true damage effect (skills.js + maker.js)' },
  { id: 'grievous-cut', viewFile: 'src/views/skills.js', opensMaker: true, coverage: 'both', description: 'Active skill applying Grievous Wounds with custom healing cut (skills.js + maker.js)' },
  { id: 'dispel-helpful', viewFile: 'src/views/skills.js', opensMaker: true, coverage: 'both', description: 'Active skill dispelling helpful statuses (skills.js + maker.js)' },
  { id: 'zone-erase', viewFile: 'src/views/kit-parts.js', opensMaker: false, coverage: 'both', description: 'Active skill erasing foe fields (skills.js + kit-parts.js)' },
  { id: 'stacks-by', viewFile: 'src/views/forge.js', opensMaker: true, coverage: 'both', description: 'Status trigger applyStatus with dynamic stacksBy formula (forge.js + maker.js)' },
  { id: 'overhealed', viewFile: 'src/views/forge.js', opensMaker: true, coverage: 'both', description: 'Status trigger on overhealed using over formula count (forge.js + maker.js + kit-parts.js)' },
] as const satisfies readonly MakerRegistryEntry[];

export type MakerId = (typeof ROUNDTRIP_REGISTRY)[number]['id'];
export type UnitMakerId = Extract<(typeof ROUNDTRIP_REGISTRY)[number], { readonly coverage: 'unit' | 'both' }>['id'];
export type E2EMakerId = Extract<(typeof ROUNDTRIP_REGISTRY)[number], { readonly coverage: 'e2e' | 'both' }>['id'];

/** `maker.open(` call sites that do not edit a saved entity and are intentionally exempt from round-trip testing. */
export const MAKER_OPEN_EXEMPTIONS: Readonly<Record<string, string>> = {
  'src/views/combat.js': 'partyDialog fight start picker, does not edit a saved entity',
};

/** Unit-covered ids from `ROUNDTRIP_REGISTRY`. */
export const UNIT_MAKER_IDS: readonly UnitMakerId[] = (ROUNDTRIP_REGISTRY as readonly MakerRegistryEntry[])
  .filter(e => e.coverage === 'unit' || e.coverage === 'both')
  .map(e => e.id as UnitMakerId);

/** Browser-covered ids from `ROUNDTRIP_REGISTRY`. */
export const E2E_MAKER_IDS: readonly E2EMakerId[] = (ROUNDTRIP_REGISTRY as readonly MakerRegistryEntry[])
  .filter(e => e.coverage === 'e2e' || e.coverage === 'both')
  .map(e => e.id as E2EMakerId);

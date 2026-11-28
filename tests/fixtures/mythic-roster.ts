// mythic-roster.ts: canonical roster of all Mythic-class solo-sim specs and their per-class sim files.
// Derives the expected Mythic class list directly from `BUILT_IN_CLASSES` (never duplicating rarity, stat pair,
// allocation weights, or recommended rank that `jobs.ts` already owns).
import { BUILT_IN_CLASSES, CLASS_NAMES } from '../../src/core/registry/jobs.ts';
import type { ClassDef, ClassName } from '../../src/core/registry/jobs.ts';
import {
  BLADEFIEND_SOLO_SPEC,
  DAWNBRINGER_SOLO_SPEC,
  DREADNOUGHT_SOLO_SPEC,
  GODFIST_SOLO_SPEC,
  HEMOMANCER_SOLO_SPEC,
  NECROMANCER_SOLO_SPEC,
  NULLWEAVER_SOLO_SPEC,
  RIFTHUNTER_SOLO_SPEC,
  STARFORGER_SOLO_SPEC,
  USURPER_SOLO_SPEC,
} from './mythic-hunters.ts';
import type { MythicSoloSpec } from './mythic-hunters.ts';

/** Any built-in class whose rarity in `BUILT_IN_CLASSES` is `'mythic'`. */
export type MythicClassName = {
  [K in ClassName]: (typeof BUILT_IN_CLASSES)[K]['rarity'] extends 'mythic' ? K : never;
}[ClassName];

/** Derives all Mythic class names in registry order from a class metadata table (defaults to `BUILT_IN_CLASSES`). */
export function mythicClassesOf(
  classes: Readonly<Record<string, Pick<ClassDef, 'rarity'>>> = BUILT_IN_CLASSES,
): readonly string[] {
  return Object.entries(classes)
    .filter(([, def]) => def.rarity === 'mythic')
    .map(([name]) => name);
}

/** All Mythic built-in classes in registry order, derived from `BUILT_IN_CLASSES`. */
export const MYTHIC_CLASSES: readonly MythicClassName[] = CLASS_NAMES.filter(
  (name): name is MythicClassName => BUILT_IN_CLASSES[name].rarity === 'mythic',
);

/** Returns the solo-sim test file path (relative to repo root) for a Mythic class. */
export function mythicSimFileOf(className: string): string {
  return className === 'Hemomancer'
    ? 'tests/mythic-solo-sim.test.ts'
    : `tests/${className.toLowerCase()}-solo-sim.test.ts`;
}

/** One Mythic class's solo-sim registration: its hunter spec, sim file path, and declared baseline constant name. */
export type MythicRosterEntry = {
  readonly spec: MythicSoloSpec;
  readonly simFile: string;
  readonly baselineConst: string;
};

const entry = (spec: MythicSoloSpec, baselineConst: string): MythicRosterEntry => ({
  spec,
  simFile: mythicSimFileOf(spec.className),
  baselineConst,
});

/** Canonical 10-Mythic solo-sim roster (one spec per Mythic, including Dawnbringer and Usurper). */
export const MYTHIC_ROSTER: readonly MythicRosterEntry[] = [
  entry(HEMOMANCER_SOLO_SPEC, 'HEMO_BEFORE_BASELINE'),
  entry(NECROMANCER_SOLO_SPEC, 'NECROMANCER_BASELINES'),
  entry(STARFORGER_SOLO_SPEC, 'STARFORGER_BASELINES'),
  entry(BLADEFIEND_SOLO_SPEC, 'BLADEFIEND_BASELINES'),
  entry(DREADNOUGHT_SOLO_SPEC, 'DREADNOUGHT_BASELINES'),
  entry(USURPER_SOLO_SPEC, 'USURPER_BASELINES'),
  entry(DAWNBRINGER_SOLO_SPEC, 'DAWNBRINGER_BASELINES'),
  entry(RIFTHUNTER_SOLO_SPEC, 'RIFTHUNTER_BASELINES'),
  entry(NULLWEAVER_SOLO_SPEC, 'NULLWEAVER_BASELINES'),
  entry(GODFIST_SOLO_SPEC, 'GODFIST_BASELINES'),
];

// The rules with keystones on: `RULES.fight.keystone.on` ships false until K5's rows hold and K6's screens exist, so a
// test that needs a body to hold a keystone builds its rules here and nowhere else.
import { RULES } from '../../src/core/rules.ts';
import type { Rules } from '../../src/core/rules.ts';

/** `rules` with the room's keystone switch on. */
export const withKeystones = <R extends { readonly fight: { readonly keystone: object } }>(rules: R): R => ({ ...rules, fight: { ...rules.fight, keystone: { ...rules.fight.keystone, on: true } } });

/** The shipped rules with keystones on. */
export const KEYSTONES_ON: Rules = withKeystones(RULES);

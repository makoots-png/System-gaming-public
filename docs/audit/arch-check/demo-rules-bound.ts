// demo-rules-bound.ts: a GM's override of a kit bound holds in the Forge and is cut back to the shipped bound by the
// parsers that read the shipped RULES. Runs the real parser under both.
//
//   bun docs/audit/arch-check/demo-rules-bound.ts

import { parseStatusDef } from '../../../src/core/combat/fight-parse.ts';
import { RULES, rulesOf } from '../../../src/core/rules.ts';

// The GM raises "the most stacks a def holds" from 20 to 40 in the Rules editor (domain 1 to 99), then makes "Rage"
// with a cap of 30 in the Forge. The Forge reads the def with the GM's rules (effects.js:39 sanitizeDef, rules()).
const gm = rulesOf({ fight: { kit: { stackCap: 40 } } });
const rage = { label: 'Rage', desc: '', ops: [], stack: { cap: 30, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
const inForge = parseStatusDef(rage, gm);
// The next load reads the library's statuses with the shipped rules (save.ts:323), as do a room doc's defs
// (protocol.ts:736, :949), an item's or skill's worn status (items.ts:255, skills.ts:100) and a pack (pack.ts:168).
const afterLoad = parseStatusDef(inForge, RULES);
console.log(`GM stackCap ${gm.fight.kit.stackCap}, shipped ${RULES.fight.kit.stackCap}`);
console.log(`Rage cap in the Forge: ${inForge?.stack?.cap}; after a reload: ${afterLoad?.stack?.cap}`);
console.log(inForge?.stack?.cap === 30 && afterLoad?.stack?.cap === 20 ? 'FAULT: the cap the GM set is cut to the shipped bound at the next load' : 'ok');

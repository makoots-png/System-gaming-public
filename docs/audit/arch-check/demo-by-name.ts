// demo-by-name.ts: runs the real core functions behind two hits of by-name.ts and prints what a GM or player gets.
//
//   bun docs/audit/arch-check/demo-by-name.ts

import { writeShopItem } from '../../../src/core/hunter/inventory.ts';
import { giveSkill } from '../../../src/core/hunter/skills-held.ts';
import { customItemDefId, parseCatalogKey } from '../../../src/core/ids.ts';
import { catalogIdOf } from '../../../src/core/catalog-id.ts';
import { parseSkill } from '../../../src/core/registry/skills.ts';
import type { Skill } from '../../../src/core/registry/skills.ts';
import { newHunter } from '../../../src/core/hunter/hunter.ts';
import { giveTitle } from '../../../src/core/hunter/record.ts';
import { RULES } from '../../../src/core/rules.ts';

const DEMO_CATALOG = catalogIdOf(parseCatalogKey('ck_demo_by_name_key_0123456789ab')!);

// 1. The GM's shop holds two items named "Ration" (one common, one rare). The GM taps Edit on the second (the rare one)
// and sets its value to 999. Before item sync PR 2 the shop held items by value and inventory.js passed the item's name
// as its id, so writeShopItem found the first. Now the shop holds item ids, and the edit saves a new def under its own id.
const common = customItemDefId(DEMO_CATALOG, 'rationcommon0000');
const rare = customItemDefId(DEMO_CATALOG, 'rationrare000000');
const edited = customItemDefId(DEMO_CATALOG, 'rationrare999000');
const shop = writeShopItem([common, rare], rare, edited);
console.log('shop after editing the 2nd Ration:', shop.join(', '));
console.log(shop[0] !== common || shop[1] !== edited ? 'FAULT: the common row was overwritten, the rare row tapped is unchanged' : 'ok');

// 2. A hunter holds "Iron Will", raised to Lv 5 and given the badge "Unbroken". The GM's reward gives "Iron Will" from
// the library (Lv 1). grant.ts:160 calls giveSkill, which replaces the held skill by name with the template.
const held = { ...parseSkill({ name: 'Iron Will', type: 'passive', level: 5, label: 'Unbroken', desc: 'Mine.', bonus: { vit: 2 } })!, id: 's1' } as Skill;
const fromLibrary = parseSkill({ name: 'iron will', type: 'passive', level: 1, desc: 'Library words.', bonus: { vit: 1 } })!;
const after = giveSkill({ skills: [held] }, fromLibrary, 's2').skills;
console.log('skills after the reward:', after.map(s => `${s.id} ${s.name} Lv${s.level} badge=${s.label}`).join('; '));
console.log(after[0]!.level === 1 ? 'FAULT: the held skill went back to Lv 1 and lost its badge' : 'ok');

// 3. A hunter holds the GM's written title "Slayer" (+1 STR). A later reward gives "Slayer" with +2 STR. record.ts:64
// finds it held by its words, so giveTitle changes nothing: the new bonus never arrives.
const h0 = newHunter();
const h1 = giveTitle(h0, { name: 'Slayer', desc: 'First.', bonus: { str: 1 } }, 't1', RULES.titles);
const h2 = giveTitle(h1, { name: 'Slayer', desc: 'Second.', bonus: { str: 2 } }, 't2', RULES.titles);
console.log('titles after the second reward:', h2.titles.map(t => `${t.id} ${t.name} ${JSON.stringify(t.bonus)}`).join('; '));
console.log(h2 === h1 ? 'FAULT: the second Slayer reward changed nothing (still +1 STR), and nothing says so' : 'ok');

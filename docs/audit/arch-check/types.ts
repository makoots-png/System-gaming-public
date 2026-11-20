// types.ts: where the core's types let a wrong value through. Principle: type-system-discipline (brand semantic
// primitives; make illegal states unrepresentable).
//
//   bun docs/audit/arch-check/types.ts
//
// 1. A parameter or field of src/core named for an id (`hid`, `qid`, `itemId`, ...) typed as a plain string, though
//    src/core/ids.ts brands that kind of id. Two such ids can be swapped and tsc says nothing.
// 2. Casts in src/core: `as unknown as`, and `as X` other than `as const`, per file (each is a place the compiler was
//    told to stop checking).
// 3. A lookup asserted present (`.find(...)!`, `.get(...)!`) in src/core: a missing thing throws instead of being a case.

import { filesUnder, grep, report, text } from './lib.ts';

const CORE = filesUnder('src/core', ['.ts']);
const BRANDED: Readonly<Record<string, string>> = {
  hid: 'HunterId', hunterId: 'HunterId', qid: 'QuestId', questId: 'QuestId', itemId: 'ItemId', skillId: 'SkillId',
  gateId: 'GateId', monsterId: 'MonsterId', mapId: 'MapId', storyId: 'StoryId', titleId: 'TitleId', deviceId: 'DeviceId',
  shadowId: 'ShadowId', bundleId: 'BundleId', loadoutId: 'LoadoutId', runId: 'StoryRunId', offerId: 'OfferId',
};
const ID_AS_STRING = new RegExp(String.raw`\b(${Object.keys(BRANDED).join('|')})\??:\s*string\b`);
const idHits = grep(CORE, ID_AS_STRING).map(h => ({ ...h, why: BRANDED[h.text.match(ID_AS_STRING)![1]!]! }));
report('1. An id of a branded kind typed as string in src/core (the brand it should be)', idHits, 150);
const byFile = new Map<string, number>();
for (const h of idHits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
console.log('per file:', [...byFile].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f.replace('src/core/', '')} ${n}`).join(', '));

console.log('\n## 2. Casts in src/core, per file (as unknown as / other as X)');
const casts = CORE.map(f => {
  const t = text(f);
  return { f, uu: (t.match(/\bas unknown as\b/g) ?? []).length, as: (t.match(/\bas (?!const\b)(?!unknown as)[A-Z]\w*/g) ?? []).length };
}).filter(c => c.uu + c.as > 0).sort((a, b) => b.uu * 10 + b.as - (a.uu * 10 + a.as));
for (const c of casts.slice(0, 15)) console.log(`${String(c.uu).padStart(2)} as-unknown-as  ${String(c.as).padStart(3)} as-X  ${c.f}`);
console.log(`total: ${casts.reduce((s, c) => s + c.uu, 0)} as unknown as, ${casts.reduce((s, c) => s + c.as, 0)} as X, in ${casts.length} files`);

report('3. A lookup asserted present in src/core', grep(CORE, /\.(find|get)\([^()]*(\([^()]*\))?[^()]*\)!/), 150);

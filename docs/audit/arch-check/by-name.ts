// by-name.ts: every place that finds, keys, merges or matches a saved or shared thing (an item, monster, status, ability,
// hunter, gate, quest, feat, story, map, title, rule) by its `name`, `title` or `label` instead of its id.
// Principles: model-the-domain, type-system-discipline (an id is the identity; a name is words a person can change).
//
//   bun docs/audit/arch-check/by-name.ts          the hits still to judge, and the ones cleared with why
//
// A hit is cleared only in CLEARED below, by file and a piece of its text, with the reason. The reasons allowed: a search
// box or a typed name read once (the person typed words, a name is all there is), a name clash refused or suffixed on
// import, a parser cutting a field, a compile-time name union, or a comparison of a DOM or token field that is not a thing.

import { SOURCES, grep, report } from './lib.ts';

const PATTERNS: readonly { kind: string; re: RegExp }[] = [
  { kind: 'compared', re: /\.(name|title|label)\b(\.trim\(\))?(\.toLowerCase\(\))?\s*[!=]==?\s|[!=]==?\s*[\w.()]*\.(name|title|label)\b/ },
  { kind: 'keyed', re: /new (Set|Map)\b.*\.(name|title|label)\b|\[\s*\w+\.(name|title|label)\s*,|\[\w+(\.def)?\.(name|title|label)\]/ },
  { kind: 'listed', re: /\.(includes|indexOf|has)\(\w+\.(name|title|label)(\.toLowerCase\(\))?\)/ },
  { kind: 'key made of a name', re: /codexKey\(\w+\.name|Key\w*\(.*\.origin\.name|`\w+:\$\{\w+\.name\}`|\.id \|\| \w+\.name/ },
];

/** Hits judged not to be a lookup of a thing by its words. `has` is a piece of the line's text. */
const CLEARED: readonly { file: string; has: string; why: string }[] = [
  { file: 'src/core/pack.ts', has: 'labels', why: 'import name clash: a status whose label is taken arrives as "Label 2"' },
  { file: 'src/core/pack.ts', has: 'names.has', why: 'import name clash: suffixed' },
  { file: 'src/core/pack.ts', has: 'name !== t.name', why: 'counts a rename' },
  { file: 'src/core/pack.ts', has: 'd.name === n', why: 'import name clash for feats: suffixed' },
  { file: 'src/core/library.ts', has: 'x.id !== exceptId', why: 'name clash refused on save' },
  { file: 'src/core/rewards.ts', has: "refuse('taken')", why: 'name clash refused on save' },
  { file: 'src/core/hunter/skills-held.ts', has: 's.id !== but', why: 'name clash refused (two skills of one name cannot be told apart on a card)' },
  { file: 'src/core/formula.ts', has: 'tok.name', why: 'a formula token, not a thing' },
  { file: 'src/core/formula.ts', has: 'kit[f.name]', why: 'a kit count key, not a thing' },
  { file: 'src/core/combat/fight-parse.ts', has: '=== null', why: 'parser: null test' },
  { file: 'src/core/combat/map-view.ts', has: 'b.name === at.text', why: 'a name plate already shows the whole name' },
  { file: 'src/core/registry/skills.ts', has: 'SKILL_ABILITIES[def.name]', why: 'compile-time union BuiltInSkill: a wrong name fails tsc' },
  { file: 'src/core/registry/scalers.ts', has: 'FAMILY', why: 'compile-time union' },
  { file: 'src/views/maker.js', has: 'FAMILY[r.name]', why: 'compile-time scaler name from a select' },
  { file: 'src/views/maker.js', has: 'c.name === r.name', why: 'a select option marked chosen' },
  { file: 'src/views/gm.js', has: "t.name === 'gm-b-to'", why: 'a DOM input name' },
  { file: 'src/views/room.js', has: "x.name === 'AbortError'", why: 'an error name' },
  { file: 'src/views/room.js', has: "o.name === ''", why: 'empty name refused' },
  { file: 'src/edge/sync.ts', has: "t.name === 'hunter-api'", why: 'a server-timing entry' },
  { file: 'src/views/hunter.js', has: 'The name did not match', why: 'typed confirmation of a delete' },
  { file: 'src/views/shadows.js', has: 'name.trim() !== made.name', why: 'a rename that changes nothing is skipped' },
  { file: 'src/views/reward-editor.js', has: 't.replaces.trim() !== t.name.trim()', why: 'a title does not replace itself' },
  { file: 'src/views/reward-editor.js', has: 'Replace bundle?', why: 'typed name clash, confirmed, then saved by id' },
  { file: 'src/views/reward-editor.js', has: 'b.name.toLowerCase() === name.trim()', why: 'typed name clash, confirmed, then saved by id' },
  { file: 'src/views/forge.js', has: 'conds[k].label', why: 'a typed status name read once into its key' },
  { file: 'src/views/bestiary.js', has: 'wordsOf', why: 'search box' },
  { file: 'src/core/hunter/counts.ts', has: "case 'text'", why: 'a feat condition on typed text' },
  { file: 'src/core/gates/solo.ts', has: 'payees: [h.name]', why: 'words for a pay record, shown only' },
  { file: 'src/views/quests.js', has: "typeof q.title === 'string'", why: 'not a lookup (a redundant guard, see boundary check)' },
  { file: 'src/core/overrides.ts', has: 'typeof v.', why: 'parser' },
  { file: 'src/views/motion.ts', has: 'a.name', why: 'DOM attribute names' },
  { file: 'src/core/pack.ts', has: 'const names = new Set', why: 'import name clash: suffixed' },
  { file: 'src/views/gates.js', has: 'const same = (a, b)', why: 'change test on a gate already matched by id' },
  { file: 'src/core/combat/zones.ts', has: 'was.name === s.def.label', why: 'change test on an aura already matched by its anchor' },
  { file: 'src/core/combat/zones.ts', has: 'heldBy(z, owner)', why: "a zone act picks among its own user's zones by the name the GM gave the act" },
  { file: 'src/core/bestiary.ts', has: 'codexKey(', why: 'by design: a room-wide monster kind; ids differ per phone; an entry naming a monster by id wins' },
  { file: 'src/views/bestiary.js', has: 'codexKey(', why: 'sort by kind, see bestiary.ts' },
  { file: 'src/core/rewards.ts', has: 'R.titles.find(t => t.name === n)', why: 'a typed title name read once: a built-in title of that name brings its key' },
  { file: 'src/views/bestiary.js', has: 'have', why: 'a picker hides skills already listed by name (two of one name cannot be told apart)' },
  { file: 'src/views/skills.js', has: 'have', why: 'a picker hides skills already held by name (addSkill refuses them anyway)' },
];

/**
 * The hits that are findings of docs/audit/2026-11-20-arch-check.md (BN-n), or of an older audit. They stay listed under
 * "to judge" until fixed; this table only names them.
 */
const FINDINGS: readonly { file: string; has: string; id: string }[] = [
  { file: 'src/core/hunter/skills-held.ts', has: 's.name.trim().toLowerCase() === n ?', id: 'BN-1 a given skill replaces a held one of the same name, level and badge lost' },
  { file: 'src/core/hunter/inventory.ts', has: 't.name === name', id: 'BN-2 a shop item is edited by its name' },
  { file: 'src/views/inventory.js', has: 'item.id || item.name', id: 'BN-2 a shop item is edited by its name' },
  { file: 'src/core/hunter/record.ts', has: 't.name', id: 'BN-3 a written title is held and replaced by its words' },
  { file: 'src/core/hunter/record.ts', has: 's.name === name', id: 'BN-3 a written title is held and replaced by its words' },
  { file: 'src/core/combat/triggers.ts', has: 's.def.label === name', id: "BN-4 a trigger's zone condition matches any zone of that exact name" },
  { file: 'src/views/map.js', has: 'x.name === z.name', id: 'BN-4 the legend shows one row for two zones of one name' },
  { file: 'src/core/pack.ts', has: 'x.name === t.name', id: 'AW-gates-5 (ranked): Replace overwrites the first of a name; mergeNamed does it for items, skills, rewards, maps, stories, monsters' },
  { file: 'src/core/registry/bundles.ts', has: "'Health Potion'", id: 'BN-5 built-in items have no key: found by their words' },
  { file: 'src/core/registry/feats.ts', has: 'd.name === name', id: 'BN-5 built-in items have no key: found by their words' },
  { file: 'src/core/save.ts', has: 'STARTER_', id: 'BN-5 built-in items have no key: found by their words (a string[] of names)' },
  { file: 'src/views/bestiary.js', has: 'seed:${k.name}', id: 'BN-5 a picker carries a built-in skill by its name, though it has a key' },
  { file: 'src/views/skills.js', has: 'seed:${s.name}', id: 'BN-5 a picker carries a built-in skill by its name, though it has a key' },
];

const strip = (t: string): string => t.replace(/typeof [\w.]+ === '\w+'/g, '').replace(/[!=]==? null\b/g, '').replace(/[!=]==? undefined\b/g, '');

const hits = SOURCES().flatMap(f => PATTERNS.flatMap(p => grep([f], p.re).filter(h => p.re.test(strip(h.text))).map(h => ({ ...h, why: p.kind }))));
const seen = new Set<string>();
const unique = hits.filter(h => { const k = `${h.file}:${h.line}`; if (seen.has(k)) return false; seen.add(k); return true; });
const clearedBy = (h: { file: string; text: string }) => CLEARED.find(c => c.file === h.file && h.text.includes(c.has));

const findingOf = (h: { file: string; text: string }) => FINDINGS.find(c => c.file === h.file && h.text.includes(c.has));
report('Found, keyed or matched by its words: to judge', unique.filter(h => !clearedBy(h)).map(h => ({ ...h, why: findingOf(h)?.id ?? `${h.why}: NEW, not judged yet` })));
report('Cleared', unique.flatMap(h => { const c = clearedBy(h); return c ? [{ ...h, why: c.why }] : []; }), 110);

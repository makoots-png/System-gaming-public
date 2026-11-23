// starter.ts: what first-run setup does to the save. The seed hunter a new install starts with (`seed: true`, made by
// `starterHunter` in save.ts) either becomes the player's own (`ownSeed`) or makes way for the starter campaign
// (`starterCampaign`): three pregens with their job, stats, skills and gear, two gates, a three-session quest arc and
// the log line, in one step, so `store.apply` writes all of it or none. Pure: the view makes the hunters
// (`store.newHunter`, which reserves their ids) and rolls the gates (`gates.roll`), and every other id comes from the
// save's `seq`.
import { STARTER_GEAR, parseItem } from './registry/items.ts';
import type { ItemDef } from './registry/items.ts';
import { STARTER_SKILLS, skillOf } from './registry/skills.ts';
import type { SkillDef } from './registry/skills.ts';
import { startingStats } from './hunter/progress.ts';
import { setJob } from './hunter/record.ts';
import { learnSkill } from './hunter/skills-held.ts';
import { equip, putItem } from './hunter/inventory.ts';
import { refill } from './hunter/vitals.ts';
import { hunterSheet } from './hunter/sheet.ts';
import { neutralSeed } from './hunter/identity.ts';
import { issueQuest } from './hunter/quests.ts';
import type { QuestDraft } from './hunter/quests.ts';
import { spawnGate } from './gates/world.ts';
import type { Gate, GateType } from './gates/gate.ts';
import { chooseMode } from './role.ts';
import { told } from './session-log.ts';
import type { Said, Stamp } from './session-log.ts';
import { isRefused, refuse } from './save-step.ts';
import type { Refused } from './save-step.ts';
import type { Hunter, Monster, Rank, Save } from './save.ts';
import type { Stats } from './stats.ts';
import type { Rules } from './rules.ts';
import { saveId } from './ids.ts';
import type { IdOf } from './ids.ts';

/** The hunter a new install starts with, while first-run setup has not replaced it or made it the player's. */
export const seedOf = (save: Save): Hunter | null => save.hunters.find(h => h.seed === true) ?? null;

/** The seed hunter becomes the player's own: neutral, named, with the job given. A save with no seed is answered as it is. */
export function ownSeed(save: Save, name: string, job = ''): Save {
  const seed = seedOf(save);
  return seed ? { ...save, hunters: save.hunters.map(h => (h === seed ? neutralSeed(h, name || 'Hunter', job) : h)) } : save;
}

// Each pregen spends its 12 creation points 2:1 on the design's build for its job (m2-plan section 3.6): Brakk the tank
// (Vitality 18, Strength 14), Mira the speed build (Agility 18, Strength 14), Eldrin the cannon (Power 18, Control 14).
export const PREGENS: readonly { name: string; job: string; stats: Partial<Stats>; skills: readonly SkillDef[]; item: ItemDef }[] = [
  { name: 'Brakk Ironhide', job: 'Tanker', stats: { vit: 18, str: 14 }, skills: [STARTER_SKILLS.shieldWall, STARTER_SKILLS.ironSkin], item: STARTER_GEAR.towerShield },
  { name: 'Mira Vale', job: 'Ranger', stats: { agi: 18, str: 14 }, skills: [STARTER_SKILLS.markedShot, STARTER_SKILLS.trailsense], item: STARTER_GEAR.huntingBow },
  { name: 'Eldrin Voss', job: 'Mage', stats: { pow: 18, ctl: 14 }, skills: [STARTER_SKILLS.arcBolt, STARTER_SKILLS.manaSense], item: STARTER_GEAR.manaPotion },
];

/** The two gates the view rolls (`gates.roll`) and hands in. */
export const STARTER_GATES: readonly { name: string; rank: Rank; type: GateType }[] = [
  { name: 'Goblin Den', rank: 'E', type: 'normal' },
  { name: 'Double Dungeon (hidden)', rank: 'D', type: 'double' },
];

export const ARC: readonly QuestDraft[] = [
  { title: 'Session 1: Goblins at the Gate', desc: 'Reports of goblins raiding a nearby market. Find and clear the Goblin Den.', objectives: [{ label: 'Enter the Goblin Den', target: 1 }, { label: 'Defeat the Goblin Chief', target: 1 }], rewards: { xp: 100, gold: 50 } },
  { title: 'Session 2: The Strange Altar', desc: 'The chief guarded a carved altar that does not belong in an E-rank gate. Someone has been here before.', objectives: [{ label: 'Examine the altar', target: 1 }, { label: 'Question the survivors', target: 3 }], rewards: { xp: 150, points: 1 } },
  { title: 'Session 3: Double Dungeon', desc: 'The altar opens a hidden second dungeon. Descend, and keep your party alive.', objectives: [{ label: 'Find the hidden entrance', target: 1 }, { label: 'Survive the Double Dungeon', target: 1 }], rewards: { xp: 300, gold: 150, title: { name: 'Survivor', desc: '', bonus: {} } } },
].map(q => ({ ...q, kind: 'side', from: 'gm' }));

/** What the view makes before the step: a hunter per pregen (in `PREGENS` order) and a rolled gate per `STARTER_GATES`. */
export type StarterMade = { hunters: readonly Hunter[]; gates: readonly { gate: Gate; monsters: readonly Monster[] }[] };

/** Why the starter campaign cannot be written: the view handed in the wrong number of hunters or gates, or a pregen's own data is wrong. */
export type StarterRefusal = Refused<'made' | 'pregen'>;

/**
 * The starter campaign on `save`: the pregens join with their job, stats, skills, gear worn and full HP and mana, the
 * seed hunter leaves, the first pregen is active, this phone is the GM's, the gates are spawned, each pregen holds the
 * arc's quests, and the log says so. One step: a refusal changes nothing.
 */
export function starterCampaign(save: Save, made: StarterMade, stamp: Stamp, R: Rules): Save | StarterRefusal {
  if (made.hunters.length !== PREGENS.length || made.gates.length !== STARTER_GATES.length) return refuse('made');
  let seq = save.seq;
  const next = <P extends string>(prefix: P): IdOf<P> => saveId(prefix, ++seq);
  const said: Said[] = [];
  const pregens: Hunter[] = [];
  for (const [i, p] of PREGENS.entries()) {
    const jobbed = setJob(made.hunters[i]!, p.job);
    const item = parseItem(p.item);
    if (isRefused(jobbed) || !item) return refuse('pregen');
    let h = startingStats(jobbed, p.stats);
    for (const k of p.skills) h = learnSkill(h, { ...skillOf(k, R), label: 'Lv.1' }, next('s'));
    const itemId = next('i');
    h = putItem(h, item, itemId);
    if (item.slot) { const worn = equip(h, itemId, itemId); if (isRefused(worn)) return refuse('pregen'); h = worn; }
    h = { ...h, ...refill(h, hunterSheet(h, R).sheet) };
    for (const d of ARC) { const t = issueQuest(h, d, next('q'), stamp.at); h = t.hunter; said.push(...t.said); }
    pregens.push(h);
  }
  const seed = seedOf(save);
  let s: Save = {
    ...save, seq,
    hunters: [...save.hunters.filter(h => h !== seed), ...pregens],
    settings: chooseMode({ ...save.settings, activeHunterId: pregens[0]!.id }, 'gm'),
  };
  for (const g of made.gates) s = spawnGate(s, g.gate, g.monsters, stamp);
  return told(s, stamp, ...said, { kind: 'system', hunterId: null, title: 'Campaign begun',
    text: 'Starter campaign loaded with 3 hunters, the Goblin Den (E), a hidden Double Dungeon (D), and 3 linked quests.' });
}

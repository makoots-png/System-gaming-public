// starter.ts: what first-run setup does to the save. The seed hunter a new install starts with (`seed: true`, made by
// `starterHunter` in save.ts) either becomes the player's own (`ownSeed`) or makes way for the starter campaign
// (`starterCampaign`): optional sample hunters with their job, stats, skills, gear and `Cap: 9` display, one
// deterministic two-wave gate (`Tidewall Cannery Gate`), and the 5-chapter `The Empty Seat` Story in
// `save.library.stories` (not started at load), in one atomic step so `store.apply` writes all of it or none. Pure:
// every id comes from the save's `seq`.
import { SHOP_ITEMS, STARTER_GEAR } from './registry/items.ts';
import type { ItemSeed } from './registry/items.ts';
import type { ItemGrant } from './registry/item-book.ts';
import { STARTER_SKILLS, skillOf } from './registry/skills.ts';
import type { SkillDef } from './registry/skills.ts';
import { capDisplayLevel, confirm, raiseMany, setCapDisplay } from './hunter/progress.ts';
import type { StatPoints } from './hunter/progress.ts';
import { debtPayoffClears, raiseOwes } from './hunter/revive-standing.ts';
import { setJob } from './hunter/classes.ts';
import { learnSkill } from './hunter/skills-held.ts';
import { equip, putItem } from './hunter/inventory.ts';
import { refill } from './hunter/vitals.ts';
import { hunterSheet } from './hunter/sheet.ts';
import { neutralSeed } from './hunter/identity.ts';
import { newGate, parseGate } from './gates/gate.ts';
import type { Gate, GateMonster, GateType } from './gates/gate.ts';
import type { GateDifficulty } from './gates/difficulty.ts';
import { clearGoldEach } from './gates/pay.ts';
import { spawnGate } from './gates/world.ts';
import { saveEntry } from './library.ts';
import { newRewards } from './rewards.ts';
import { parseStory } from './story/story.ts';
import type { Chapter, Story, StoryTemplate } from './story/story.ts';
import { chooseMode } from './role.ts';
import { told } from './session-log.ts';
import type { Stamp } from './session-log.ts';
import { isRefused, refuse } from './save-step.ts';
import type { Refused } from './save-step.ts';
import { makeHunter } from './save.ts';
import type { Hunter, Rank, Save } from './save.ts';
import { RULES, clearOf, priceBaseOf } from './rules.ts';
import type { Rules } from './rules.ts';
import { builtInItemId, saveId, seedId } from './ids.ts';
import type { IdOf, MonsterId } from './ids.ts';

/** The hunter a new install starts with, while first-run setup has not replaced it or made it the player's. */
export const seedOf = (save: Save): Hunter | null => save.hunters.find(h => h.seed === true) ?? null;

/** The seed hunter becomes the player's own: neutral, named, with the job given. A save with no seed is answered as it is. */
export function ownSeed(save: Save, name: string, job = ''): Save {
  const seed = seedOf(save);
  return seed ? { ...save, hunters: save.hunters.map(h => (h === seed ? neutralSeed(h, name || 'Hunter', job) : h)) } : save;
}

const HEALTH_POTION_E: ItemSeed = (() => {
  const found = SHOP_ITEMS.find(i => i.defId === builtInItemId('health-potion-e'));
  if (!found) throw new Error('missing built-in Health Potion (E)');
  return found;
})();

/** One sample hunter definition for the starter campaign. An empty `stats` plan leaves creation points unspent. */
export type StarterPregen = {
  readonly name: string;
  readonly job: string;
  readonly stats: StatPoints;
  readonly skills: readonly SkillDef[];
  readonly items: readonly ItemSeed[];
};

// Four zero-collision sample hunters: Dolan (Tanker), Nadia (Ranger), Bram (Healer), and Tessa (Mage with 12 unspent
// points for creation practice during solo testing). Each begins with `capDisplay: 'E'` (`Cap: 9`) and healing.
export const PREGENS: readonly StarterPregen[] = [
  {
    name: 'Dolan Kestrel',
    job: 'Tanker',
    stats: { vit: 8, str: 4 },
    skills: [STARTER_SKILLS.shieldWall, STARTER_SKILLS.ironSkin],
    items: [STARTER_GEAR.towerShield, HEALTH_POTION_E],
  },
  {
    name: 'Nadia Cho',
    job: 'Ranger',
    stats: { agi: 8, ctl: 4 },
    skills: [STARTER_SKILLS.markedShot, STARTER_SKILLS.trailsense],
    items: [STARTER_GEAR.huntingBow, HEALTH_POTION_E],
  },
  {
    name: 'Bram Halstead',
    job: 'Healer',
    stats: { pre: 8, dis: 4 },
    skills: [STARTER_SKILLS.mendingAura],
    items: [HEALTH_POTION_E, STARTER_GEAR.manaPotion],
  },
  {
    name: 'Tessa Corbin',
    job: 'Mage',
    stats: {},
    skills: [STARTER_SKILLS.arcBolt, STARTER_SKILLS.manaSense],
    items: [STARTER_GEAR.manaPotion, HEALTH_POTION_E],
  },
];

/** Name of the sample hunter who starts with unspent creation points for solo testing. */
export const STARTER_UNSPENT_HUNTER = 'Tessa Corbin';

/** Fixed authored E-rank gate for the first mission: Day 6 of 7 (`breakDay: today + 1`), two waves, difficulty 1, class offer on boss fall. */
export const STARTER_GATE: {
  readonly name: string;
  readonly rank: Rank;
  readonly type: GateType;
  readonly classOffer: true;
  readonly difficulty: GateDifficulty;
  readonly bossId: MonsterId;
  readonly monsters: readonly GateMonster[];
  readonly notes: string;
} = {
  name: 'Tidewall Cannery Gate',
  rank: 'E',
  type: 'normal',
  classOffer: true,
  difficulty: { gate: { at: 'set', level: 3 }, boss: { at: 'own', level: 1 } },
  bossId: seedId<'m'>('head-usher'),
  monsters: [
    { monsterId: seedId<'m'>('goblin'), count: 1, wave: 1 },
    { monsterId: seedId<'m'>('goblin-shaman'), count: 1, wave: 1 },
    { monsterId: seedId<'m'>('goblin-chief'), count: 1, wave: 1 },
    { monsterId: seedId<'m'>('usher'), count: 2, wave: 2 },
  ],
  notes: 'Day 6 of 7 at the Tidewall loading bay. Wave 1: cannery tunnels. Wave 2: stone hall (Head Usher).',
};

/** Name of the preloaded first-mission Story in `save.library.stories`. */
export const STARTER_STORY_NAME = 'The Empty Seat';

const chapter = (c: Partial<Chapter> & Pick<Chapter, 'name' | 'words'>): Chapter => ({
  rewards: newRewards(),
  quest: null,
  note: '',
  ...c,
});

/** Builds the 5-chapter `The Empty Seat` Story template (Health Potion (E) travels as a built-in ref grant). */
export function starterStory(R: Rules = RULES): StoryTemplate {
  const twoPotions: ItemGrant = { kind: 'ref', defId: HEALTH_POTION_E.defId, qty: 2 };
  const eCap = capDisplayLevel('E', R) ?? 9;
  const eGold = clearGoldEach(R, 'E', R.gateParty);
  const eMid = Math.round(clearOf(R, 'E'));
  const eBase = priceBaseOf(R, 'E');
  const laborerDay = Math.max(1, Math.round(eBase * 0.12));
  const entryFee = Math.max(1, Math.round(eBase * 0.1));
  const eDebt = raiseOwes('debt', 'E', R);
  const eDebtClears = debtPayoffClears(eDebt, 'E', R);
  const eCrystal = Math.round(R.revivePrices * eBase);
  const debtText = eDebtClears !== null
    ? `${eDebt.toLocaleString('en-US')} gold in debt (about ${eDebtClears} E-rank clear${eDebtClears === 1 ? '' : 's'} to pay off)`
    : `${eDebt.toLocaleString('en-US')} gold in debt`;
  const crystalText = eCrystal.toLocaleString('en-US');
  return {
    name: STARTER_STORY_NAME,
    when: 'Start in Session 1 at the Halfway House to open Chapter 1 (required) for the table.',
    for: 'table',
    chapters: [
      chapter({
        name: 'Seat Assigned',
        required: true,
        words: {
          title: 'SEAT ASSIGNED',
          line: `The Bureau assigned your party to Tidewall Cannery Gate (E-rank, breaks tomorrow). Collect your license from Pim Aldous at the Halfway House. Level 1. Cap: ${eCap}.`,
        },
        rewards: { ...newRewards(), items: [twoPotions] },
        quest: {
          kind: 'main',
          title: "Thursday's Gate",
          desc: `Collect your license from seat clerk Pim Aldous at the Halfway House, pay the ${entryFee}-gold entry fee, and reach Tidewall Cannery Gate before dark. An E-rank Clear pays ${eGold.low} to ${eGold.high} gold per hunter (a laborer earns ${laborerDay} gold a day). Your daily quest does not heal wounds.`,
          objectives: [
            { label: 'Collect your license from Pim Aldous', target: 1, progress: 0 },
            { label: 'Reach Tidewall Cannery Gate', target: 1, progress: 0 },
          ],
          rewards: { ...newRewards(), xp: 50 },
          onFail: newRewards(),
          dueHours: null,
          penaltyText: '',
        },
        note: [
          'Required (do not skip).',
          "Bridge: you survived the three-day fever a few weeks back, registered as E-rank at San Francisco's Bureau hall, and got your license. This morning your names came up on the public board.",
          `Halfway House scene. Wages and poverty: a laborer earns ${laborerDay} gold a day. An E-rank Clear pays ${eGold.low} to ${eGold.high} gold per hunter (average ${eMid}) after a ${entryFee}-gold entry fee, but unsigned hunters wait months for seats and spend gold on potions and gear, so most stay poor while a few at the top grow rich.`,
          `Revive ladder (Pim reads the card): first return within an hour is free (takes a memory), second puts you ${debtText}, and third and after need a pre-bought ${crystalText}-gold Resurrection Crystal within an hour (gold after death does not help). None of it works on anyone who never awakened.`,
          `Level cap: an E-rank hunter stops at level ${eCap} (Cap: ${eCap}).`,
          'An older man does squats in the queue. The license has one extra paid line with no name. Pim assumes someone is late. At the cordon, watches stop near the light.',
        ].join(' '),
      }),
      chapter({
        name: 'Gate Entered',
        words: {
          title: 'GATE ENTERED',
          line: 'You entered Tidewall Cannery Gate. Your party holds one more seat than it has hunters. The entry fee for the extra seat is paid. The seat holder is present.',
        },
        quest: {
          kind: 'main',
          title: 'Tidewall Cannery Gate',
          desc: 'Defeat the goblins inside the cannery tunnels and clear the gate before it breaks tomorrow.',
          objectives: [
            { label: 'Defeat the outer goblin pack', target: 1, progress: 0 },
            { label: 'Defeat the Goblin Chief', target: 1, progress: 0 },
          ],
          rewards: { ...newRewards(), xp: 100, points: 1 },
          onFail: newRewards(),
          dueHours: null,
          penaltyText: '',
        },
        note: 'Open Gates, tap Mark as raiding on Tidewall Cannery Gate, and tap Start fight (Wave 1 is preselected). Do not explain the extra seat. The Goblin Chief backs from an empty tile and counts one finger too many as it dies. Settle with Award XP, then say the extra seat declined its share.',
      }),
      chapter({
        name: 'The Stone Hall',
        words: {
          title: 'TRIAL ISSUED',
          line: 'Party incomplete. Exit locked until all seated hunters assemble. Take your seat, answer when asked, and remain seated. Reward: not stated. Penalty: not stated.',
        },
        note: 'Exit locked. Past the boss room: stone hall, fitted chairs, one extra chair facing the wall, 3 lamps. Pay 20 gold per answer (GM -> Award), kill a lamp each round, turn the extra chair. Ask: (1) Who is waiting outside? (2) What were you before the fever? (3) What will you not do for gold?',
      }),
      chapter({
        name: 'Final Objective',
        words: {
          title: 'FINAL OBJECTIVE',
          line: 'When the lights return, one seat at this table must be empty. Time: 03:14.',
        },
        note: 'Kill the last lamp, start a 3:14 timer, stay silent. No forced-stand roll. Standing starts Fight 2 free. Staying seated starts one restrained. Tap Gates -> Start fight (Wave 2: Head Usher, Ushers). Revive downed hunters free (Collateral taken) before the offer. A wipe wakes everyone in chairs.',
      }),
      chapter({
        name: 'Trial Complete',
        words: {
          title: 'TRIAL COMPLETE',
          line: 'The seat holder left. One seat is empty. Remain seated: failed (no penalty stated). Cost paid by seat holder. Your cap is removed (Cap: none).',
        },
        rewards: {
          ...newRewards(),
          title: {
            name: 'Guest',
            desc: 'Someone paid for your trial inside Tidewall Cannery Gate. You do not know who.',
            bonus: { dis: 1 },
          },
        },
        note: 'Revive downed hunters first. Tap Lift cap and offer classes, wait for picks, tap Close offer, then Clear gate on Tidewall Cannery Gate. Local 7 cuts crystal in the boss room with solid brick behind them. Outside, Pim notes 12 minutes and one line fewer. End on one blank line below Cap: none.',
      }),
    ],
  };
}

/** Options for loading the starter campaign. `includePregens` defaults to true (4 sample hunters). */
export type StarterOptions = { readonly includePregens?: boolean };

/** Why the starter campaign cannot be written: a pregen, gate, or story failed validation, or the story library refused it. */
export type StarterRefusal = Refused<'pregen' | 'gate' | 'story' | 'full' | 'taken'>;

/**
 * The starter campaign on `save`: optionally replaces the seed hunter with the 4 sample hunters (with `capDisplay: 'E'`
 * and full HP/mana; Tessa Corbin keeps her 12 creation points unspent) or neutralizes the seed when `includePregens` is
 * false (keeping `activeHunterId` valid), sets this phone to GM mode, spawns the deterministic `Tidewall Cannery Gate`
 * (`breakDay: today + 1`, two waves, `classOffer: true`), stores the 5-chapter `The Empty Seat` Story in
 * `save.library.stories` with no auto-started run and zero non-daily quests at load, and writes the log line.
 * One atomic step: a refusal changes nothing.
 */
export function starterCampaign(
  save: Save,
  stamp: Stamp,
  R: Rules,
  options: StarterOptions = {},
): Save | StarterRefusal {
  const includePregens = options.includePregens !== false;
  let seq = save.seq;
  const next = <P extends string>(prefix: P): IdOf<P> => saveId(prefix, ++seq);
  const now = new Date(stamp.at);

  const parsedStory = parseStory(starterStory(R));
  if (!parsedStory) return refuse('story');
  const story: Story = { ...parsedStory, id: next('st') };
  const nextLibrary = saveEntry(save.library, 'stories', story);
  if (isRefused(nextLibrary)) return refuse(nextLibrary.why === 'taken' ? 'taken' : 'full');

  const today = save.world.day;
  const gate: Gate | null = parseGate({
    ...newGate(),
    id: next('g'),
    name: STARTER_GATE.name,
    rank: STARTER_GATE.rank,
    type: STARTER_GATE.type,
    status: 'detected',
    createdDay: today,
    breakDay: today + 1,
    monsters: STARTER_GATE.monsters.map(m => ({ ...m })),
    bossId: STARTER_GATE.bossId,
    difficulty: STARTER_GATE.difficulty,
    notes: STARTER_GATE.notes,
    classOffer: STARTER_GATE.classOffer,
    bossFell: false,
  });
  if (!gate) return refuse('gate');

  const pregens: Hunter[] = [];
  if (includePregens) {
    for (const p of PREGENS) {
      const created = makeHunter({ seq, settings: save.settings }, p.name, R, now);
      seq = created.seq;
      const jobbed = setJob(created.hunter, p.job, { held: false, dead: false });
      if (isRefused(jobbed)) return refuse('pregen');
      let h: Hunter = jobbed;
      if (Object.keys(p.stats).length > 0) {
        const raised = raiseMany(h, p.stats, R);
        if (isRefused(raised)) return refuse('pregen');
        h = confirm(raised);
      }
      h = setCapDisplay(h, 'E');
      for (const k of p.skills) h = learnSkill(h, { ...skillOf(k, R), label: 'Lv.1' }, next('s'));
      for (const seed of p.items) {
        const item: ItemGrant = { kind: 'ref', defId: seed.defId, qty: 1 };
        const itemId = next('i');
        h = putItem(h, item, itemId, R);
        if ('slot' in seed) {
          const worn = equip(h, itemId, itemId, false, R);
          if (isRefused(worn)) return refuse('pregen');
          h = worn;
        }
      }
      h = { ...h, ...refill(h, hunterSheet(h, R).sheet) };
      pregens.push(h);
    }
  }

  const seed = seedOf(save);
  const existing = save.hunters.filter(h => h !== seed);
  let hunters: Hunter[];
  if (includePregens) {
    hunters = [...existing, ...pregens];
  } else if (existing.length > 0) {
    hunters = existing;
  } else if (seed) {
    hunters = [neutralSeed(seed, 'Hunter')];
  } else {
    const created = makeHunter({ seq, settings: save.settings }, 'Hunter', R, now);
    seq = created.seq;
    hunters = [created.hunter];
  }

  const activeHunterId = includePregens
    ? pregens[0]!.id
    : hunters.some(h => h.id === save.settings.activeHunterId)
      ? save.settings.activeHunterId
      : hunters[0]!.id;

  let s: Save = {
    ...save,
    seq,
    hunters,
    library: nextLibrary,
    settings: chooseMode({ ...save.settings, activeHunterId }, 'gm'),
  };
  s = spawnGate(s, gate, [], stamp);

  const partyLine = includePregens
    ? `${pregens.length} sample hunters, `
    : '';
  return told(s, stamp, {
    kind: 'system',
    hunterId: null,
    title: 'Campaign begun',
    text: `Starter campaign loaded with ${partyLine}${STARTER_GATE.name} (E) and the story ${STARTER_STORY_NAME}.`,
  });
}

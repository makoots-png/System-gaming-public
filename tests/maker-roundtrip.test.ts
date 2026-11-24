// Fast unit round-trip suite for every maker and editor with a pure projection or core edit step, plus regression
// guards for past data-loss bugs: 7e222b1e (feat maker dropped show.at === 'feat'), 4e6be3c8 (story maker dropped
// chapter quest onFail), and 9e57d384 (reward editor dropped title active and band).
import { describe, expect, test } from 'bun:test';
import { RULES, saveRuleNumbers, writeTable } from '../src/core/rules.ts';
import { mapFromForm, mapToForm } from '../src/core/registry/maps.ts';
import { guildFromForm, guildStep, guildToForm } from '../src/core/hunter/guild.ts';
import { rewardForm, rewardOfForm } from '../src/core/reward-rows.ts';
import { parseBundle, parseRewards, parseWords, REWARD_BOUNDS, saveBundle } from '../src/core/rewards.ts';
import { afterChoices, parseFeat } from '../src/core/hunter/feats.ts';
import { BUILT_IN_FEATS } from '../src/core/registry/feats.ts';
import { parseStory } from '../src/core/story/story.ts';
import { storyProblem } from '../src/core/draft.ts';
import { editQuest } from '../src/core/hunter/quests.ts';
import { editGate } from '../src/core/gates/world.ts';
import { gatePreset } from '../src/core/gates/preset.ts';
import { giveTitle, writeTitle } from '../src/core/hunter/record.ts';
import { withBadge } from '../src/core/hunter/identity.ts';
import { newHunter } from '../src/core/hunter/hunter.ts';
import { parseOverrides } from '../src/core/overrides.ts';
import { newSave } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import { dev } from './fixtures/ids.ts';
import { UNIT_MAKER_IDS } from './fixtures/maker-registry.ts';
import type { UnitMakerId } from './fixtures/maker-registry.ts';
import {
  WORST_BUNDLE,
  WORST_FEAT_AFTER,
  WORST_FEAT_COUNT,
  WORST_GUILD,
  WORST_IDENTITY,
  WORST_MAP,
  WORST_MONSTER_BOSS,
  WORST_MONSTER_MYTHIC,
  WORST_OVERRIDES,
  WORST_QUEST_GM,
  WORST_QUEST_SELF,
  WORST_REWARDS,
  WORST_ROLL_TABLES,
  WORST_STORY,
  worstGate,
  worstPreset,
} from './fixtures/maker-fixtures.ts';

const STAMP = { at: '2029-05-10T12:00:00.000Z', cap: 200 };
const saveWithHunter = () => {
  const h = newHunter(RULES);
  return { ...newSave(dev('d-rt')), hunters: [h], activeId: h.id };
};

/** Every unit-covered registry id maps to its worst-case round-trip assertion below. */
const UNIT_CASES: Record<UnitMakerId, () => void> = {
  rewards() {
    // Regression guard for 9e57d384: title active, band, key, replaces, worn, and every reward part survive unchanged.
    const form = rewardForm(WORST_REWARDS);
    const back = parseRewards(rewardOfForm(form, RULES));
    expect(back).toEqual(WORST_REWARDS);
    expect(back?.title?.active).toEqual(WORST_REWARDS.title?.active);
    expect(back?.title?.band).toBe('A');
  },

  bundle() {
    const rw = parseRewards(rewardOfForm(rewardForm(WORST_BUNDLE.rewards), RULES))!;
    const words = parseWords(WORST_BUNDLE.window);
    const saved = saveBundle({ rewards: [WORST_BUNDLE] }, WORST_BUNDLE.id, WORST_BUNDLE.name, rw, 50, words);
    expect(isRefused(saved)).toBe(false);
    if (!isRefused(saved)) {
      const after = saved.rewards.find(b => b.id === WORST_BUNDLE.id);
      expect(after).toEqual(WORST_BUNDLE);
      const { id: _id, ...tpl } = WORST_BUNDLE;
      expect(parseBundle(after)).toEqual(tpl);
    }
  },

  map() {
    const form = mapToForm(WORST_MAP);
    const back = mapFromForm(form, WORST_MAP.id, RULES);
    expect(back).toEqual(WORST_MAP);
  },

  feat() {
    // Regression guard for 7e222b1e: show.at === 'feat' keeps its prerequisite key in afterChoices and parseFeat.
    const libFeats = { 'silent-sovereign': WORST_FEAT_AFTER, 'gate-runner': WORST_FEAT_COUNT };
    const afterKey = WORST_FEAT_AFTER.show.at === 'feat' ? WORST_FEAT_AFTER.show.key : null;
    const choices = afterChoices(BUILT_IN_FEATS, libFeats, 'silent-sovereign', afterKey);
    expect(choices.some(([k]) => k === afterKey)).toBe(true);
    const formRaw = {
      name: WORST_FEAT_AFTER.name,
      window: WORST_FEAT_AFTER.window,
      desc: WORST_FEAT_AFTER.desc,
      rule: WORST_FEAT_AFTER.rule,
      show: WORST_FEAT_AFTER.show,
      rewards: parseRewards(rewardOfForm(rewardForm(WORST_FEAT_AFTER.rewards), RULES))!,
      ...(WORST_FEAT_AFTER.off ? { off: true } : {}),
    };
    expect(parseFeat(formRaw)).toEqual(WORST_FEAT_AFTER);
    expect(parseFeat(WORST_FEAT_COUNT)).toEqual(WORST_FEAT_COUNT);
  },

  story() {
    // Regression guard for 4e6be3c8: chapter quest onFail, counted objectives, dueHours, and rewards round-trip whole.
    const { id: _id, ...tpl } = WORST_STORY;
    expect(storyProblem(tpl)).toBeNull();
    const back = parseStory(tpl);
    expect(back).toEqual(tpl);
    expect(back?.chapters[0]?.quest?.onFail).toEqual(WORST_STORY.chapters[0]?.quest?.onFail);
  },

  quest() {
    const h0 = { ...newHunter(RULES), quests: [WORST_QUEST_GM, WORST_QUEST_SELF] };
    const gmEdited = editQuest(h0, WORST_QUEST_GM.id, {
      kind: WORST_QUEST_GM.kind,
      title: WORST_QUEST_GM.title,
      desc: WORST_QUEST_GM.desc,
      objectives: WORST_QUEST_GM.objectives,
      rewards: parseRewards(rewardOfForm(rewardForm(WORST_QUEST_GM.rewards), RULES, true))!,
      onFail: parseRewards(rewardOfForm(rewardForm(WORST_QUEST_GM.onFail), RULES, false))!,
      dueAt: WORST_QUEST_GM.dueAt,
      penaltyText: WORST_QUEST_GM.penaltyText,
    }, 'gm');
    expect(isRefused(gmEdited)).toBe(false);
    if (!isRefused(gmEdited)) {
      expect(gmEdited.quests.find(q => q.id === WORST_QUEST_GM.id)).toEqual(WORST_QUEST_GM);
    }

    const playerEdited = editQuest(h0, WORST_QUEST_SELF.id, {
      kind: WORST_QUEST_SELF.kind,
      title: WORST_QUEST_SELF.title,
      desc: WORST_QUEST_SELF.desc,
      objectives: WORST_QUEST_SELF.objectives,
      rewards: WORST_QUEST_SELF.rewards,
      onFail: WORST_QUEST_SELF.onFail,
      dueAt: WORST_QUEST_SELF.dueAt,
      penaltyText: WORST_QUEST_SELF.penaltyText,
    }, 'player');
    expect(isRefused(playerEdited)).toBe(false);
    if (!isRefused(playerEdited)) {
      expect(playerEdited.quests.find(q => q.id === WORST_QUEST_SELF.id)).toEqual(WORST_QUEST_SELF);
    }
  },

  gate() {
    const base = saveWithHunter();
    const h = base.hunters[0]!;
    const gate = worstGate(h.id);
    const save = {
      ...base,
      monsters: [WORST_MONSTER_MYTHIC, WORST_MONSTER_BOSS],
      library: { ...base.library, maps: [WORST_MAP] },
      gates: [gate],
    };
    const next = editGate(save, gate.id, {
      name: gate.name,
      rank: gate.rank,
      type: gate.type,
      breakDay: gate.breakDay,
      monsters: [...gate.monsters],
      bossId: gate.bossId,
      notes: gate.notes,
      mapId: gate.mapId,
      status: gate.status,
      solo: gate.solo,
      difficultyEvents: [],
    }, STAMP);
    expect(isRefused(next)).toBe(false);
    if (!isRefused(next)) {
      expect(next.gates[0]).toEqual(gate);
    }
  },

  preset() {
    const base = saveWithHunter();
    const h = base.hunters[0]!;
    const preset = worstPreset(h.id);
    expect(preset.at).toBe('edited');
    if (preset.at !== 'edited') return;
    const gate = worstGate(h.id);
    const save = { ...base, gates: [gate] };
    const afterXp = gatePreset(save, gate.id, { type: 'setXp', xp: preset.xp });
    expect(isRefused(afterXp)).toBe(false);
    if (!isRefused(afterXp)) {
      const afterGold = gatePreset(afterXp, gate.id, { type: 'setGold', gold: preset.gold });
      expect(isRefused(afterGold)).toBe(false);
      if (!isRefused(afterGold)) {
        const afterCrystal = gatePreset(afterGold, gate.id, { type: 'setCrystal', crystal: preset.crystal });
        expect(isRefused(afterCrystal)).toBe(false);
        if (!isRefused(afterCrystal)) {
          expect(afterCrystal.gates[0]?.preset).toEqual(preset);
        }
      }
    }
  },

  title() {
    const longDesc = 'T'.repeat(REWARD_BOUNDS.titleDesc + 50);
    const tSpec = WORST_REWARDS.title!;
    const h0 = giveTitle(newHunter(RULES), { ...tSpec, desc: longDesc }, 't-rt-1', RULES.titles);
    const saved = h0.titles.find(t => t.id === 't-rt-1')!;
    expect(saved.desc.length).toBe(REWARD_BOUNDS.titleDesc);
    const h1 = writeTitle(h0, saved.id, { name: saved.name, desc: saved.desc, bonus: saved.bonus });
    expect(isRefused(h1)).toBe(false);
    if (!isRefused(h1)) {
      expect(h1.titles.find(t => t.id === 't-rt-1')).toEqual(saved);
    }
  },

  guild() {
    const form = guildToForm(WORST_GUILD);
    expect(form.goldCut).toBe('12.34');
    expect(form.crystalShare).toBe('37.65');
    const back = guildFromForm(form, RULES);
    expect(back).toEqual({ ok: true, guild: WORST_GUILD });
    expect(guildFromForm(guildToForm(null), RULES)).toEqual({ ok: true, guild: null });

    const base = saveWithHunter();
    const h = base.hunters[0]!;
    const set1 = guildStep(base, h.id, WORST_GUILD, STAMP, RULES);
    expect(isRefused(set1)).toBe(false);
    if (!isRefused(set1)) {
      const set2 = guildStep(set1.save, h.id, back.ok ? back.guild : null, STAMP, RULES);
      expect(isRefused(set2)).toBe(false);
      if (!isRefused(set2)) {
        expect(set2.changed).toBe(false);
        expect(set2.hunter.guild).toEqual(WORST_GUILD);
      }
    }
  },

  identity() {
    const h0 = withBadge(newHunter(RULES), WORST_IDENTITY.emblem, WORST_IDENTITY.color);
    expect(h0.emblem).toBe(WORST_IDENTITY.emblem);
    expect(h0.color).toBe(WORST_IDENTITY.color);
    expect(withBadge(h0, h0.emblem, h0.color)).toEqual(h0);
  },

  'rules-overrides'() {
    const baseOv = saveRuleNumbers({ gmTables: { urgent: [...WORST_ROLL_TABLES.urgent] } }, WORST_OVERRIDES);
    const { gmTables: _drop, ...shown } = baseOv;
    const text = JSON.stringify(shown, null, 2);
    const parsed = parseOverrides(JSON.parse(text));
    expect(parsed.refused).toEqual([]);
    const after = saveRuleNumbers(baseOv, parsed.overrides);
    expect(after).toEqual(baseOv);
  },

  'roll-tables'() {
    const ov0 = writeTable(
      writeTable(WORST_OVERRIDES, 'urgent', '', [...WORST_ROLL_TABLES.urgent]),
      'encounter',
      'B',
      [...WORST_ROLL_TABLES.encounterB],
    );
    const linesOf = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 200).map(x => x.slice(0, 300));
    const ov1 = writeTable(ov0, 'urgent', '', linesOf(WORST_ROLL_TABLES.urgent.join('\n')));
    const ov2 = writeTable(ov1, 'encounter', 'B', linesOf(WORST_ROLL_TABLES.encounterB.join('\n')));
    expect(ov2).toEqual(ov0);
  },
};

describe('maker and editor unit round-trips (all unit-registered surfaces)', () => {
  test('UNIT_CASES covers every unit-registered id in ROUNDTRIP_REGISTRY', () => {
    expect(Object.keys(UNIT_CASES).sort()).toEqual([...UNIT_MAKER_IDS].sort());
  });

  for (const id of UNIT_MAKER_IDS) {
    test(`${id}: worst-case saved value round-trips unchanged`, () => {
      UNIT_CASES[id]();
    });
  }
});

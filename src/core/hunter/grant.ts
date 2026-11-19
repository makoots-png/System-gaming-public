// grant.ts: what reaches a hunter's sheet from outside it, each as one step on the save. Pure.
//
// `grant` gives a reward whole: points, title, job, build, skills, boons, statuses, gold, items, XP and the level-up's
// refill in one answer, so a reward is all given in one write or not at all (a reward used to be five or more writes,
// and a throw part way left the rest ungiven). `sheetEdit` is the GM's change of HP, mana, fatigue, life or a status,
// and the fight's totals. `levelled` is the one place a level change is told to the Job Change chain: every step that
// may move a level runs it, so the chain's level step, and its completion when the level reaches it, are in the same
// write as the level.
//
// Where HP, mana, fatigue and statuses live is the caller's answer (`VitalsAt`, from hunter.js `fightOf`): while a fight
// holds them, a step never writes them on the sheet (the fight's next totals would write over it); `grant` hands those
// parts back in `fight` for the caller to send to the fight's row or to refuse. Ids come from the save's `seq`, as
// `told` takes them (src/core/session-log.ts), so a step needs no id reserved outside it.
import { gmSource } from '../effects.ts';
import type { LevelUp } from '../events.ts';
import type { BuildChange } from '../protocol.ts';
import { grantLines } from '../rewards.ts';
import type { RewardStatus, RewardTitle, Rewards } from '../rewards.ts';
import type { Rank, Rules } from '../rules.ts';
import type { Hunter, Quest, Save } from '../save.ts';
import { told } from '../session-log.ts';
import type { Said } from '../session-log.ts';
import type { JobName } from '../registry/jobs.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import type { SheetStatus } from '../combat/effect-ops.ts';
import type { AbilityId } from '../combat/ability-types.ts';
import { buildAward } from './build.ts';
import { dropStatus, putStatus } from './conditions.ts';
import type { StatusIn } from './conditions.ts';
import { addGold, putItem, stackOf } from './inventory.ts';
import { addXp, atLevel, gainXp, grantPoints } from './progress.ts';
import type { ChainEffect, ChainEvent } from './job-chain.ts';
import { chained, completeQuest } from './quests.ts';
import type { Completed, QuestWhy } from './quests.ts';
import { giveBoons, giveTitle, holdsTitle, setJob, titleNamed } from './record.ts';
import { fitted, hunterSheet } from './sheet.ts';
import { giveSkill } from './skills-held.ts';
import { can, changeFatigue, changeMana, hit, lifeNews, refill, rest, setFatigue, setMana, spendMana } from './vitals.ts';
import type { Life, LifeEvent } from './vitals.ts';
import { record } from './chronicle.ts';
import type { LifeHow } from './facts.ts';
import { saveId } from '../ids.ts';
import type { IdOf } from '../ids.ts';
import type { DayKey } from '../day.ts';

/** Where a hunter's HP, mana, fatigue and statuses live now: its sheet, or a fight's row (this phone's or the GM's). */
export type VitalsAt = 'sheet' | 'fight';

/** Ids taken from a save's `seq` in turn, as `store.id(prefix)` would: `next` answers one, `seq` the counter after them. */
export function idsFrom(seq: number): { next: <P extends string>(prefix: P) => IdOf<P>; seq: () => number } {
  let n = seq;
  return { next: prefix => saveId(prefix, ++n), seq: () => n };
}

/** When a step happens: its time, today's day key (src/core/rules.ts `dayKey`) and the rules. */
export type Day = { at: string; today: DayKey; R: Rules };
/** A Job Change step a change completed: the quest as it was before, and the job it granted (the last step's). */
export type StepDone = { quest: Quest; job: JobName | null };
/** A hunter after a step, the log lines it says, and the Job Change steps it completed. */
export type Levelled = { hunter: Hunter; said: Said[]; done: StepDone[] };

/**
 * The chain's `completeQuest` requests in `effects` carried out on `h` in the same step: each step quest completed by
 * its own transition (quests.ts `completeQuest`, which tells the chain `stepCompleted` and opens the next step), and any
 * request that raises in turn. A step quest gives no reward of its own (`stepQuest`): the job comes from the chain.
 */
export function stepsReached(h: Hunter, effects: readonly ChainEffect[], day: Day, next: <P extends string>(prefix: P) => IdOf<P>): Levelled {
  let hunter = h;
  const said: Said[] = [], done: StepDone[] = [];
  const queue = effects.flatMap(fx => (fx.type === 'completeQuest' ? [fx.questId] : []));
  for (let qid = queue.shift(); qid !== undefined; qid = queue.shift()) {
    const quest = hunter.quests.find(q => q.id === qid);
    if (!quest) continue;
    const c = completeQuest(hunter, qid, { at: day.at, today: day.today, nextQuestId: next('q'), streakBonusEvery: day.R.streakBonusEvery });
    if (isRefused(c)) continue;
    hunter = c.hunter; said.push(...c.said);
    const job = c.effects.find((fx): fx is Extract<ChainEffect, { type: 'grantJob' }> => fx.type === 'grantJob')?.job ?? null;
    done.push({ quest, job });
    for (const fx of c.effects) if (fx.type === 'completeQuest') queue.push(fx.questId);
  }
  return { hunter, said, done };
}

/**
 * Hunter `after`, a change of a hunter whose level was `from`, with the Job Change chain told of the level when it moved
 * (`levelChanged`: a level step's progress), and a level step it reached completed in the same step (`stepsReached`).
 */
export function levelled(from: number, after0: Hunter, day: Day, next: <P extends string>(prefix: P) => IdOf<P>): Levelled {
  if (after0.level === from) return { hunter: after0, said: [], done: [] };
  // the level's fact, recorded where every level change is told (chronicle.ts)
  const after = record(after0, { kind: 'level', level: after0.level });
  if (!after.jobChain) return { hunter: after, said: [], done: [] };
  const t = chained(after, { type: 'levelChanged', level: after.level });
  const r = stepsReached(t.hunter, t.effects, day, next);
  return { hunter: r.hunter, said: [...t.said, ...r.said], done: r.done };
}

/**
 * The GM's edit of hunter `hid`'s level and the XP inside it (`atLevel`), the chain told of the level (`levelled`) and
 * its log lines written, in one step. A hunter that is not there is refused.
 */
export function levelEdit(save: Save, hid: string, level: number, xp: number, day: Day): { save: Save; done: StepDone[] } | Refused<'no-hunter'> {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const h = save.hunters[at]!, ids = idsFrom(save.seq);
  const l = levelled(h.level, fitted(atLevel(h, level, xp, day.R), day.R), day, ids.next);
  const next = { ...save, seq: ids.seq(), hunters: save.hunters.map((x, i) => (i === at ? l.hunter : x)) };
  return { save: told(next, { at: day.at, cap: day.R.logCap }, ...l.said), done: l.done };
}

/** What one reward did to one hunter. */
export type Granted = {
  save: Save;
  /**
   * The reward window's lines (`grantLines`): a title only when it is new ("in place of" only when it took a held title's place), a status only when the sheet took it, and XP,
   * gold and points as they moved (a cost larger than what the hunter holds says what was taken; one that took nothing has no line).
   */
  lines: string[];
  levelup: LevelUp | null;
  /** The parts the sheet does not hold while a fight does: the statuses to put on the hunter's row, and the level-up's refill. */
  fight: { statuses: StatusIn[]; refill: boolean };
  /** The Job Change steps the level change completed in the same step (`levelled`), for their windows. */
  done: StepDone[];
};

const sheetOf = (h: Hunter, R: Rules) => hunterSheet(h, R).sheet;
/** A reward's title as the window says it was given: in place of the title it took the place of (by the name the hunter held it under), else as a new one. */
const titleGiven = (t: RewardTitle, replaced: string | undefined): RewardTitle => {
  const { replaces: _named, ...rest } = t;
  return replaced === undefined ? rest : { ...rest, replaces: replaced };
};

/**
 * A reward's status as its hunter takes it, on the sheet or on a fight's row: from the GM, at the hunter's rank. The one
 * place a reward's status gets its source: `grant` for a hunter of this phone, fight-save.ts `playerHeld` for a player's
 * hunter on a row of this phone's fight.
 */
export const statusGiven = (s: RewardStatus, rank: Rank): StatusIn => ({ key: s.key, rounds: s.rounds, source: gmSource(rank), ...(s.def ? { def: s.def } : {}) });

/**
 * Hunter `hid` given `r` (read by `parseRewards`) and a build change, at time `at`, as one answer. Order: points,
 * title, job, build, skills, boons, then the sheet's maxima fitted; statuses; gold and items, fitted again (gear weighs);
 * XP last, so a level-up's refill fills the maxima the rest of the reward gave. A hunter that is not there is refused.
 */
export function grant(save: Save, hid: string, r: Rewards, build: BuildChange | null, o: Day & { vitals: VitalsAt }): Granted | Refused<'no-hunter'> {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const { R } = o, ids = idsFrom(save.seq), h0 = save.hunters[at]!;
  let h = r.points ? grantPoints(h0, r.points, R) : h0;
  // what reached the sheet, for the window's lines: a cost takes no more than the hunter holds
  const points = h.bonusPoints - h0.bonusPoints;
  const titleNew = !!r.title && !holdsTitle(h, r.title, R.titles);
  // the title it took the place of, by the name the hunter held it under; none when it was given as new
  const replaced = titleNew && r.title?.replaces ? titleNamed(h, r.title.replaces, R.titles) : undefined;
  if (r.title && titleNew) h = giveTitle(h, r.title, ids.next('t'), R.titles);
  if (r.job) { const j = setJob(h, r.job); if (!isRefused(j)) h = j; }
  let buildLine = '';
  if (build !== null) { const b = buildAward(h, build, R); buildLine = b.line; h = { ...h, build: b.build }; }
  for (const k of r.skills) h = giveSkill(h, k, ids.next('s'));
  h = giveBoons(h, r.boons.map(b => ({ id: ids.next('bn'), name: b.name, text: b.text })), o.at);
  h = fitted(h, R);

  const took: RewardStatus[] = [], toFight: StatusIn[] = [];
  for (const s of r.statuses) {
    const put = statusGiven(s, h0.rank);
    if (o.vitals === 'fight') { toFight.push(put); continue; }
    const next = putStatus(h, put, R.conditions);
    if (!isRefused(next)) { h = next; took.push(s); }
  }

  const goldBefore = h.gold;
  if (r.gold) h = addGold(h, r.gold);
  const gold = h.gold - goldBefore;
  for (const it of r.items) h = putItem(h, it, stackOf(h, it)?.id ?? ids.next('i'));
  h = fitted(h, R);

  let levelup: LevelUp | null = null, refillLeft = false, done: StepDone[] = [], said: Said[] = [], xp = 0;
  if (r.xp) {
    const from = h.level, change = gainXp(h, r.xp, R);
    h = fitted(addXp(h, r.xp, R), R); xp = change.xp;
    let refilled = false;
    if (change.refill && o.vitals === 'sheet') { h = { ...h, ...refill(h, sheetOf(h, R)) }; refilled = true; }
    refillLeft = change.refill && o.vitals === 'fight';
    if (change.to > change.from) levelup = { hunterId: hid, from: change.from, to: change.to, points: change.points, refill: refilled };
    const l = levelled(from, h, o, ids.next);
    h = l.hunter; done = l.done; said = l.said;
  }

  const lines = grantLines(R, { ...r, xp, gold, points, title: r.title && titleNew ? titleGiven(r.title, replaced?.name) : null, statuses: took }, { build: buildLine, level: { from: h0.level, to: h.level } });
  const hunters = save.hunters.map((x, i) => (i === at ? h : x));
  const next = told({ ...save, seq: ids.seq(), hunters }, { at: o.at, cap: R.logCap }, ...said);
  return { save: next, lines, levelup, fight: { statuses: toFight, refill: refillLeft }, done };
}

// ── a Job Change chain event ──
/** What a chain event did on a hunter of the save: the next save, the chain's effects, and the step quests it completed. */
export type Chained = { save: Save; effects: ChainEffect[]; done: StepDone[] };
/**
 * Hunter `hid`'s Job Change chain told the event `make` builds with the save's next ids, the step quests it asks to
 * complete completed (`stepsReached`, a level step its level already reaches), and its log lines, in one step. Refused
 * when the hunter is not there (`no-hunter`), or when the chain refuses the event or it changes nothing (`refused`).
 */
export function chainStep(save: Save, hid: string, make: (next: <P extends string>(prefix: P) => IdOf<P>) => ChainEvent, day: Day): Chained | Refused<'no-hunter' | 'refused'> {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const ids = idsFrom(save.seq), t = chained(save.hunters[at]!, make(ids.next));
  if (!t.effects.length || t.effects.some(fx => fx.type === 'refused')) return refuse('refused');
  const r = stepsReached(t.hunter, t.effects, day, ids.next);
  const next = told({ ...save, seq: ids.seq(), hunters: save.hunters.map((x, i) => (i === at ? r.hunter : x)) }, { at: day.at, cap: day.R.logCap }, ...t.said, ...r.said);
  return { save: next, effects: t.effects, done: r.done };
}

// ── a quest's completion ──
/** The ability points a day's streak bonus gives (every `R.streakBonusEvery` days of all dailies done). */
export const STREAK_BONUS_POINTS = 1;
/**
 * What completing a quest did: the next save, the quest as it was, the completion's facts (`completeQuest`), the reward
 * as given (`grant`), the job the completion gave (a chain's last step, or a Job quest's reward), whether HP and mana
 * were restored for the day's dailies (`sheet`), are the fight's to restore (`fight`) or not (null), and the Job Change
 * steps the chain completed with it.
 */
export type Finished = {
  save: Save; quest: Quest; completed: Completed; granted: Granted; job: string | null; recover: VitalsAt | null; done: StepDone[];
};
/**
 * Hunter `hid`'s active quest `qid` completed, in one step (implicit audit 3, Q1): the quest done, the penalty and the
 * streak (`completeQuest`), the Job Change steps the chain asked to complete (`stepsReached`), the quest's reward given
 * (`grant`) with the streak's bonus points, and, when the day's last daily is done and the rules' daily template
 * recovers, HP and mana restored (on the sheet, or left to the fight that holds them); every log line with it. A step
 * quest of a chain gives no job of its own: the chain grants the job. Refused as `completeQuest` refuses, and when the
 * hunter is not there (`no-hunter`).
 */
export function finishQuest(save: Save, hid: string, qid: string, o: Day & { vitals: VitalsAt }): Finished | Refused<'no-hunter' | 'belowLevel' | QuestWhy> {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const h = save.hunters[at]!, quest = h.quests.find(q => q.id === qid), ids = idsFrom(save.seq), R = o.R;
  if (!quest) return refuse('missing');
  const c = completeQuest(h, qid, { at: o.at, today: o.today, nextQuestId: ids.next('q'), streakBonusEvery: R.streakBonusEvery });
  if (isRefused(c)) return c;
  const chain = c.effects.filter((fx): fx is Extract<ChainEffect, { type: 'completeQuest' | 'grantJob' }> => fx.type === 'completeQuest' || fx.type === 'grantJob');
  const r = stepsReached(c.hunter, chain, o, ids.next);
  const done = told({ ...save, seq: ids.seq(), hunters: save.hunters.map((x, i) => (i === at ? r.hunter : x)) }, { at: o.at, cap: R.logCap }, ...c.said, ...r.said);
  const rewards: Rewards = { ...quest.rewards, job: quest.chainId ? null : quest.rewards.job, points: quest.rewards.points + (c.bonus ? STREAK_BONUS_POINTS : 0) };
  const g = grant(done, hid, rewards, null, o);
  if (isRefused(g)) return g;
  const recover = c.allDaily && R.dailyTemplate.recover !== false ? o.vitals : null;
  const after = recover === 'sheet' ? { ...g.save, hunters: g.save.hunters.map(x => (x.id === hid ? { ...x, ...refill(x, sheetOf(x, R)) } : x)) } : g.save;
  const job: string | null = chain.find(fx => fx.type === 'grantJob')?.job ?? (quest.kind === 'job' ? rewards.job : null);
  return { save: after, quest, completed: c, granted: { ...g, save: after }, job, recover, done: [...r.done, ...g.done] };
}

/** A change the GM or the fight makes to a hunter's HP, mana, fatigue, life or statuses on its sheet. */
export type SheetEdit =
  /** `by`: who revives (the GM's Revive, or an item: a Resurrection Crystal); absent is the GM's. */
  | { type: 'life'; event: LifeEvent; by?: 'gm' | 'item' }
  | { type: 'mana'; delta: number }
  /** Mana paid as a price: refused when the hunter holds less (`spendMana`). */
  | { type: 'spend'; mana: number }
  | { type: 'fatigue'; delta: number }
  /**
   * The fight's totals for the hunter: HP, mana, fatigue and the statuses as its row holds them, and with `used` the uses
   * spent of its abilities limited a long rest (the row holds all of them, so they replace the sheet's). Without `used`
   * (the room's `vitals` message carries none yet) the sheet keeps its own.
   */
  | { type: 'totals'; hp: number; mana: number; fatigue: number; statuses: readonly SheetStatus[]; used?: Readonly<Record<AbilityId, number>> }
  | { type: 'put'; status: StatusIn }
  | { type: 'drop'; key: string }
  /** A short or long rest (vitals.ts `rest`). */
  | { type: 'rest'; kind: 'short' | 'long' };

/** How an edit changes a life, for its fact (facts.ts `LifeHow`). */
const howOf = (e: SheetEdit): LifeHow =>
  e.type === 'totals' ? 'fight' : e.type === 'rest' ? 'rest'
  : e.type === 'life' && e.event.type === 'deathSave' ? 'save' : e.type === 'life' && e.event.type === 'revive' ? e.by ?? 'gm' : 'hand';
/** The death saves failed before a change, while dying; 0 otherwise. */
const failuresOf = (life: Life): number => (life.at === 'dying' ? life.failures : 0);

/**
 * Hunter `h` after `e`, each with the maxima its sheet gives. A life event its state does not take (a heal on a dead
 * hunter) is refused (`cannot`), and so is a price of more mana than the hunter holds (`mana`); a status put on that changes nothing, or taken off that is not held, is refused
 * (`unchanged`), as `putStatus` and `dropStatus` answer. What the change did to the life (`lifeNews`) and a rest are
 * recorded as facts on the hunter in the same answer (chronicle.ts `record`).
 */
export function sheetEdit(h: Hunter, e: SheetEdit, R: Rules): Hunter | Refused<'cannot' | 'mana' | 'state-chip' | 'no-def' | 'unchanged'> {
  const next = edited(h, e, R);
  if (isRefused(next)) return next;
  // what the change did to the life, and a rest, are facts (chronicle.ts), recorded in the edit's own write
  const news = lifeNews(h.life, next.life);
  const withLife = news ? record(next, { kind: 'life', news: news.kind, how: howOf(e), failures: failuresOf(h.life) }) : next;
  return e.type === 'rest' ? record(withLife, { kind: 'rest', long: e.kind === 'long' }) : withLife;
}
function edited(h: Hunter, e: SheetEdit, R: Rules): Hunter | Refused<'cannot' | 'mana' | 'state-chip' | 'no-def' | 'unchanged'> {
  const m = sheetOf(h, R);
  switch (e.type) {
    case 'life': return can(h.life, e.event.type) ? { ...h, ...hit(h, e.event, m) } : refuse('cannot');
    case 'mana': return { ...h, ...changeMana(h, e.delta, m) };
    case 'spend': { const v = spendMana(h, e.mana, m); return isRefused(v) ? v : { ...h, ...v }; }
    case 'fatigue': return { ...h, ...changeFatigue(h, e.delta, m, R) };
    case 'totals': return { ...h, ...setFatigue(setMana(hit(h, { type: 'setHp', hp: e.hp }, m), e.mana, m), e.fatigue, m, R), conditions: e.statuses.map(s => ({ ...s })), ...(e.used ? { used: { ...e.used } } : {}) };
    case 'put': return putStatus(h, e.status, R.conditions);
    case 'drop': return dropStatus(h, e.key);
    case 'rest': return { ...h, ...rest(h, e.kind, m, R) };
  }
}

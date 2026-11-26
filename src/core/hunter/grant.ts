// grant.ts: what reaches a hunter's sheet from outside it, each as one step on the save. Pure.
//
// `grant` gives a reward whole: points, title, job, skills, boons, statuses, gold, items, XP and the level-up's
// refill in one answer, so a reward is all given in one write or not at all (a reward used to be five or more writes,
// and a throw part way left the rest ungiven). `sheetEdit` is the GM's change of HP, mana, fatigue, life or a status,
// and the fight's totals; a raising from death through it costs levels (`reviveLevelShare`, the owner's ruling 9).
// `systemRaise` is the System's raise of a dead hunter on its revive ladder, the standing, the life and the debt in one write.
// `levelled` is the one place a level change is told to the Job Change chain: every step that may move a level runs it
// (a raising runs its first part, `levelMoved`), so the chain's level step, and its completion when the level reaches
// it, are in the same write as the level.
//
// Where HP, mana, fatigue and statuses live is the caller's answer (`VitalsAt`, from hunter.js `fightOf`): while a fight
// holds them, a step never writes them on the sheet (the fight's next totals would write over it); `grant` hands those
// parts back in `fight` for the caller to send to the fight's row or to refuse. Ids come from the save's `seq`, as
// `told` takes them (src/core/session-log.ts), so a step needs no id reserved outside it.
import { gmSource } from '../effects.ts';
import type { LevelUp } from '../events.ts';
import type { RewardFrom } from '../protocol.ts';
import { grantLines } from '../rewards.ts';
import type { RewardStatus, RewardTitle, Rewards } from '../rewards.ts';
import type { Rank, Rules } from '../rules.ts';
import type { Hunter, Quest, Save } from '../save.ts';
import { told } from '../session-log.ts';
import type { Said } from '../session-log.ts';
import { canonicalUniqueClass } from '../registry/jobs.ts';
import type { ChainJobName, UniqueClassName } from '../registry/jobs.ts';
import { roleOf } from '../role.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import type { SheetStatus } from '../combat/effect-ops.ts';
import type { AbilityId } from '../combat/ability-types.ts';
import { dropStatus, putStatus } from './conditions.ts';
import type { StatusIn } from './conditions.ts';
import { addGold, putItem, stackOf } from './inventory.ts';
import { addCrystal } from './crystal.ts';
import { addXp, atLevel, gainXp, grantPoints, raisedLevels } from './progress.ts';
import type { ChainEffect, ChainEvent, ChainRefusal } from './job-chain.ts';
import { chained, completeQuest, failQuest, rollover } from './quests.ts';
import type { Completed, QuestCompletedBy, QuestWhy, Rollover, Told } from './quests.ts';
import { reportsProgress } from './quest-rights.ts';
import { newEvent } from '../protocol.ts';
import { atOutbox, post } from '../sync/outbox.ts';
import { giveBoons, giveTitle, holdsTitle, rankStep, titleNamed } from './record.ts';
import { setJob } from './classes.ts';
import { HOLDER_REFUSAL_WORDS, claimUniqueClass, holderOf } from './class-holders.ts';
import type { HolderStepCtx, HolderTarget } from './class-holders.ts';
import { fitted, hunterSheet } from './sheet.ts';
import { giveSkill } from './skills-held.ts';
import { healRestingShadows } from './shadows.ts';
import { REVIVE_HP, lifeNews, vitalStep } from './vitals.ts';
import type { Life, LifeEvent, VitalEvent } from './vitals.ts';
import { record } from './chronicle.ts';
import type { Fact, LifeHow } from './facts.ts';
import { restStep } from './rests.ts';
import { canRaise, debtStep, paysDebt, raiseOwes, standingStep } from './revive-standing.ts';
import type { DebtPaid, DebtXpCut, Raise } from './revive-standing.ts';
import { guildGoldStep, guildPaidLog, takesGuildCut } from './guild.ts';
import type { GuildGoldCut } from './guild.ts';
import { saveId, sheetKeyOf } from '../ids.ts';
import type { HunterId, IdOf, RoomCode } from '../ids.ts';
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
export type StepDone = { quest: Quest; job: ChainJobName | null };
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
 * Hunter `after`, a change of a hunter whose level was `from`, told of the level when it moved: its fact, the rank
 * machine's `levelMoved`, and the Job Change chain's `levelChanged` (a level step's progress), with the chain's lines
 * and its effects, among them the request to complete a level step the level reached, which `levelled` carries out.
 */
function levelMoved(from: number, after0: Hunter, R: Rules): Told<ChainEffect> {
  if (after0.level === from) return { hunter: after0, said: [], effects: [] };
  // the level's fact, recorded where every level change is told (chronicle.ts)
  const recorded = record(after0, { kind: 'level', level: after0.level });
  // the rank machine is told the level moved (record.ts `RANK_TABLE`); a row that refuses it keeps the rank
  const stepped = rankStep(recorded, { type: 'levelMoved' }, R);
  const after = isRefused(stepped) ? recorded : stepped;
  return after.jobChain ? chained(after, { type: 'levelChanged', level: after.level }) : { hunter: after, said: [], effects: [] };
}

/**
 * Hunter `after`, a change of a hunter whose level was `from`, with the Job Change chain told of the level when it moved
 * (`levelMoved`), and a level step it reached completed in the same step (`stepsReached`).
 */
export function levelled(from: number, after0: Hunter, day: Day, next: <P extends string>(prefix: P) => IdOf<P>): Levelled {
  const t = levelMoved(from, after0, day.R);
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

/** Why a unique class named in `rewards.job` was not granted to a hunter. */
export type UniqueJobRefusal = {
  readonly className: UniqueClassName;
  readonly why: 'class-taken' | 'held' | 'locker-full' | 'foreign-class' | 'not-gm' | 'no-hunter' | 'bad-target' | 'not-unique';
  readonly holderName: string | null;
};

/** Plain-English GM/player notice when a unique `rewards.job` claim is refused (voice.md compliant). */
export function uniqueJobRefusalText(ref: UniqueJobRefusal, targetName?: string | null): string {
  const toPart = targetName ? ` to ${targetName}` : '';
  if (ref.why === 'class-taken') {
    return ref.holderName
      ? `${ref.className} was not granted${toPart}. ${ref.holderName} holds it. Release or reassign it first.`
      : `${ref.className} was not granted${toPart}. ${HOLDER_REFUSAL_WORDS['class-taken']}`;
  }
  if (ref.why === 'held') return `${ref.className} was not granted${toPart}. ${HOLDER_REFUSAL_WORDS.held}`;
  if (ref.why === 'locker-full') return `${ref.className} was not granted${toPart}. ${HOLDER_REFUSAL_WORDS['locker-full']}`;
  if (ref.why === 'foreign-class') return `${ref.className} was not granted${toPart}. ${HOLDER_REFUSAL_WORDS['foreign-class']}`;
  if (ref.why === 'not-gm') return `${ref.className} was not granted${toPart}. Only the GM can grant a unique class.`;
  return `${ref.className} was not granted${toPart}.`;
}

/**
 * Routes a GM reward's unique `rewards.job` for a remote player hunter through `claimUniqueClass`.
 * Leaves non-unique or empty jobs untouched (`claimed: null, refused: null`).
 */
export function claimRemoteRewardJob(
  save: Save,
  job: string | null,
  target: Extract<HolderTarget, { kind: 'remote' }>,
  ctx: HolderStepCtx,
): { readonly save: Save; readonly claimed: UniqueClassName | null; readonly refused: UniqueJobRefusal | null } {
  if (!job) return { save, claimed: null, refused: null };
  const uniqueCls = canonicalUniqueClass(job);
  if (!uniqueCls) return { save, claimed: null, refused: null };
  const claimed = claimUniqueClass(save, uniqueCls, target, ctx);
  if (isRefused(claimed)) {
    return {
      save,
      claimed: null,
      refused: {
        className: uniqueCls,
        why: claimed.why,
        holderName: holderOf(save, uniqueCls)?.name ?? null,
      },
    };
  }
  return { save: claimed.save, claimed: uniqueCls, refused: null };
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
  /** Clear gold split applied under System revive debt in this grant, or null when no gold went to debt or debt costs. */
  debtPaid: DebtPaid | null;
  /** Guild gold cut applied on a table world-gate clear in this grant, or null when none applied. */
  guildCut: GuildGoldCut | null;
  /** Earned XP reduced under System revive debt in this grant, or null when XP was not reduced. */
  debtXp: DebtXpCut | null;
  /** Job actually granted by `r.job`, or null when no job was given or `setJob`/`claimUniqueClass` refused it. */
  job: string | null;
  /** Refusal details when `r.job` named a unique class that could not be granted, or null. */
  jobRefused: UniqueJobRefusal | null;
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
 * Hunter `hid` given `r` (read by `parseRewards`), at time `at`, as one answer. Order: points,
 * title, job, skills, boons, then the sheet's maxima fitted; statuses; gold and items, fitted again (gear weighs);
 * XP last, so a level-up's refill fills the maxima the rest of the reward gave. A hunter that is not there is refused.
 */
export function grant(save: Save, hid: string, r: Rewards, o: Day & { vitals: VitalsAt; from?: RewardFrom | null | undefined }): Granted | Refused<'no-hunter'> {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const { R } = o;

  // Route unique `r.job` through `claimUniqueClass` BEFORE allocating `idsFrom(baseSave.seq)` or mutating `h`,
  // so `save.classHolders`, `save.log`, and `save.seq` stay atomic and disjoint.
  let baseSave: Save = save;
  let jobGranted: string | null = null;
  let jobRefused: UniqueJobRefusal | null = null;
  const uniqueCls = r.job ? canonicalUniqueClass(r.job) : null;
  if (uniqueCls) {
    if (roleOf(save.settings, save.settings.sync.room) === 'gm') {
      const claimed = claimUniqueClass(
        save,
        uniqueCls,
        { kind: 'local', hunterId: save.hunters[at]!.id },
        {
          at: o.at,
          room: null,
          stamp: null,
          R,
          heldLocal: id => id === save.hunters[at]!.id && o.vitals === 'fight',
          heldRemote: () => false,
        },
      );
      if (isRefused(claimed)) {
        jobRefused = { className: uniqueCls, why: claimed.why, holderName: holderOf(save, uniqueCls)?.name ?? null };
      } else {
        baseSave = claimed.save;
        jobGranted = uniqueCls;
      }
    } else if (!Object.hasOwn(save.hunters[at]!.classes, uniqueCls)) {
      jobRefused = { className: uniqueCls, why: 'not-gm', holderName: null };
    }
  }

  const ids = idsFrom(baseSave.seq), h0 = baseSave.hunters[at]!;
  let h = r.points ? grantPoints(h0, r.points, R) : h0;
  // what reached the sheet, for the window's lines: a cost takes no more than the hunter holds
  const points = h.bonusPoints - h0.bonusPoints;
  const titleNew = !!r.title && !holdsTitle(h, r.title, R.titles);
  // the title it took the place of, by the name the hunter held it under; none when it was given as new
  const replaced = titleNew && r.title?.replaces ? titleNamed(h, r.title.replaces, R.titles) : undefined;
  if (r.title && titleNew) h = giveTitle(h, r.title, ids.next('t'), R.titles);
  // a job refused because the hunter is held or down is told in the window; the other refusals are the GM's job name to fix.
  // A unique class never reaches setJob: its refusal is `jobRefused`, which the caller tells.
  let jobWhy: 'held' | 'dead' | null = null;
  if (r.job && !uniqueCls) {
    const j = setJob(h, r.job, { held: o.vitals === 'fight', dead: h.life.at === 'dead' });
    if (!isRefused(j)) { h = j; jobGranted = j.job; } else if (j.why === 'held' || j.why === 'dead') jobWhy = j.why;
  }
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

  // Order C (`debtFirst`): System debt splits gross clear gold first, then the guild gold cut runs on post-debt kept
  // gold (only on table world-gate clears, `from === 'clear'`), always leaving at least 1 gold kept.
  const pay = r.gold > 0 && paysDebt(o.from) && h.debt > 0
    ? debtStep(h.debt, { type: 'clearGold', gold: r.gold }, R)
    : { debt: h.debt, paid: 0, burn: 0, kept: r.gold, xp: 0 };
  const guildCut = pay.kept > 0 && takesGuildCut(o.from) ? guildGoldStep(pay.kept, h, R) : null;
  const finalKept = guildCut ? guildCut.kept : pay.kept;
  const goldBefore = h.gold;
  if (finalKept) h = addGold(h, finalKept);
  const gold = h.gold - goldBefore;
  // Mana crystal never pays System debt automatically; grant applies it directly through crystal.ts.
  const crystalBefore = h.crystal;
  if (r.crystal) h = addCrystal(h, r.crystal);
  const crystal = h.crystal - crystalBefore;
  if (pay.debt !== h.debt) h = { ...h, debt: pay.debt };
  const debtPaid: DebtPaid | null = pay.paid > 0 || pay.burn > 0
    ? { total: r.gold, paid: pay.paid, burn: pay.burn, kept: pay.kept, left: pay.debt }
    : null;
  for (const it of r.items) h = putItem(h, it, stackOf(h, it)?.id ?? ids.next('i'));
  h = fitted(h, R);

  // Gold clears debt first; if debt remains above 0, positive XP from every source is scaled by reviveDebtXpRate.
  const baseXp = Math.trunc(r.xp || 0);
  const xpStepped = baseXp > 0 && h.debt > 0 && R.reviveDebtXpRate < 1
    ? debtStep(h.debt, { type: 'xp', xp: baseXp }, R)
    : null;
  const grantXp = xpStepped ? xpStepped.xp : baseXp;
  const debtXp: DebtXpCut | null = xpStepped
    ? { base: baseXp, xp: grantXp, rate: R.reviveDebtXpRate, left: h.debt }
    : null;
  const debtXpCleared = !!debtPaid && debtPaid.left === 0 && baseXp > 0 && R.reviveDebtXpRate < 1;

  let levelup: LevelUp | null = null, refillLeft = false, done: StepDone[] = [], said: Said[] = [], xp = 0;
  if (grantXp) {
    const from = h.level, change = gainXp(h, grantXp, R);
    h = fitted(addXp(h, grantXp, R), R); xp = change.xp;
    let refilled = false;
    if (change.refill && o.vitals === 'sheet') {
      const v = vitalStep(h, { type: 'refill' }, sheetOf(h, R), R);
      // "HP and mana fully restored" is said only when HP was: a dead hunter's refill fills mana alone (SMX-rules-1.2)
      if (!isRefused(v)) { h = { ...h, ...v }; refilled = v.life.at !== 'dead'; }
    }
    refillLeft = change.refill && o.vitals === 'fight';
    if (change.to > change.from) levelup = { hunterId: hid, from: change.from, to: change.to, points: change.points, refill: refilled };
    const l = levelled(from, h, o, ids.next);
    h = l.hunter; done = l.done; said = l.said;
  }

  const debtLog = guildPaidLog(h.name, debtPaid, guildCut, debtXp, debtXpCleared ? xp : 0);
  const lines: string[] = grantLines(
    R,
    { ...r, xp, gold, crystal, points, job: jobGranted, title: r.title && titleNew ? titleGiven(r.title, replaced?.name) : null, statuses: took },
    {
      level: { from: h0.level, to: h.level },
      ...(debtPaid ? { debt: debtPaid } : {}),
      ...(guildCut ? { guildCut } : {}),
      ...(debtXp ? { debtXp } : {}),
      ...(debtXpCleared ? { debtXpCleared: true } : {}),
    },
  );
  if (r.job && jobWhy) lines.push(jobWhy === 'held' ? `Job not taken: ${r.job} (you are in a fight)` : `Job not taken: ${r.job} (you are down)`);
  const hunters = baseSave.hunters.map((x, i) => (i === at ? h : x));
  const next = told({ ...baseSave, seq: ids.seq(), hunters }, { at: o.at, cap: R.logCap }, ...(debtLog ? [debtLog] : []), ...said);
  return { save: next, lines, levelup, fight: { statuses: toFight, refill: refillLeft }, done, debtPaid, guildCut, debtXp, job: jobGranted, jobRefused };
}

// ── a Job Change chain event ──
/** What a chain event did on a hunter of the save: the next save, the chain's effects, and the step quests it completed. */
export type Chained = { save: Save; effects: ChainEffect[]; done: StepDone[] };
/**
 * Hunter `hid`'s Job Change chain told the event `make` builds with the save's next ids, the step quests it asks to
 * complete completed (`stepsReached`, a level step its level already reaches), and its log lines, in one step. Refused
 * when the hunter is not there (`no-hunter`), by the chain's own reason when it refuses the event (`CHAIN_WORDS` says
 * it), or when the event changes nothing (`unchanged`).
 */
export function chainStep(save: Save, hid: string, make: (next: <P extends string>(prefix: P) => IdOf<P>) => ChainEvent, day: Day): Chained | Refused<'no-hunter' | 'unchanged' | ChainRefusal> {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const ids = idsFrom(save.seq), t = chained(save.hunters[at]!, make(ids.next));
  const no = t.effects.find(fx => fx.type === 'refused');
  if (no) return refuse(no.reason);
  if (!t.effects.length) return refuse('unchanged');
  const r = stepsReached(t.hunter, t.effects, day, ids.next);
  const next = told({ ...save, seq: ids.seq(), hunters: save.hunters.map((x, i) => (i === at ? r.hunter : x)) }, { at: day.at, cap: day.R.logCap }, ...t.said, ...r.said);
  return { save: next, effects: t.effects, done: r.done };
}

// ── a quest's completion ──
/** The ability points a day's streak bonus gives (every `R.streakBonusEvery` days of all dailies done). */
export const STREAK_BONUS_POINTS = 1;
/**
 * What completing a quest did: the next save, the completed quest (`status: 'done'`, objectives filled), the completion's
 * facts (`completeQuest`), the reward as given (`grant`), the job the completion gave (a chain's last step, or a Job
 * quest's reward), and the Job Change steps the chain completed with it.
 */
export type Finished = {
  save: Save; quest: Quest & { status: 'done' }; completed: Completed; granted: Granted; job: string | null; done: StepDone[];
};
/**
 * Hunter `hid`'s active quest `qid` completed by `by` (a tap when not given), in one step (implicit audit 3, Q1): the quest done, the penalty and the
 * streak (`completeQuest`), the Job Change steps the chain asked to complete (`stepsReached`), the quest's reward given
 * (`grant`) with the streak's bonus points; every log line with it. Finishing the day's dailies restores no HP or mana
 * (the owner, 19 Nov: dailies do not recover you). A step
 * quest of a chain gives no job of its own: the chain grants the job. Refused as `completeQuest` refuses, and when the
 * hunter is not there (`no-hunter`).
 */
export function finishQuest(save: Save, hid: string, qid: string, o: Day & { vitals: VitalsAt; by?: QuestCompletedBy }): Finished | Refused<'no-hunter' | 'belowLevel' | QuestWhy> {
  const d = questDone(save, hid, qid, o);
  if (isRefused(d)) return d;
  const g = grant(d.save, hid, d.rewards, o);
  if (isRefused(g)) return g;
  return { save: g.save, quest: d.quest, completed: d.completed, granted: g, job: d.rewards.job ? g.job : d.job, done: [...d.done, ...g.done] };
}
/** What completing a quest did before its reward is given: as `Finished`, with the reward it earned in place of the reward given. */
export type QuestDone = Omit<Finished, 'granted'> & { rewards: Rewards };
/**
 * `finishQuest` up to its reward: the quest done with everything but its reward, and the reward it earned (the quest's,
 * with the streak's bonus points). The System's completion of a counted quest (noticed.ts `countQuests`) routes that
 * reward by the seat (hunter/pending.ts `selfPaid`): in a room it waits for the GM (ruling 20).
 */
export function questDone(save: Save, hid: string, qid: string, o: Day & { by?: QuestCompletedBy }): QuestDone | Refused<'no-hunter' | 'belowLevel' | QuestWhy> {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const h = save.hunters[at]!, quest = h.quests.find(q => q.id === qid), ids = idsFrom(save.seq), R = o.R;
  if (!quest) return refuse('missing');
  const c = completeQuest(h, qid, { at: o.at, today: o.today, nextQuestId: ids.next('q'), streakBonusEvery: R.streakBonusEvery, ...(o.by ? { by: o.by } : {}) });
  if (isRefused(c)) return c;
  const finished = c.hunter.quests.find(q => q.id === qid);
  if (!finished || finished.status !== 'done') return refuse('not-now');
  const chain = c.effects.filter((fx): fx is Extract<ChainEffect, { type: 'completeQuest' | 'grantJob' }> => fx.type === 'completeQuest' || fx.type === 'grantJob');
  const r = stepsReached(c.hunter, chain, o, ids.next);
  const done = told({ ...save, seq: ids.seq(), hunters: save.hunters.map((x, i) => (i === at ? r.hunter : x)) }, { at: o.at, cap: R.logCap }, ...c.said, ...r.said);
  const rewards: Rewards = { ...finished.rewards, job: finished.chainId ? null : finished.rewards.job, points: finished.rewards.points + (c.bonus ? STREAK_BONUS_POINTS : 0) };
  const job: string | null = chain.find(fx => fx.type === 'grantJob')?.job ?? (finished.kind === 'job' ? rewards.job : null);
  return { save: done, quest: finished, completed: c, rewards, job, done: r.done };
}

/** What failing a quest did: the next save, the quest as it was, its cost as given (`grant`), and the chain's effects. */
export type QuestFailed = { save: Save; quest: Quest; granted: Granted; effects: ChainEffect[] };
/**
 * Hunter `hid`'s active quest `qid` failed, in one step (feature 1's notes 17.14): the quest failed with its fact and its
 * chain told (`failQuest`), its log lines, and what failing costs (`Quest.onFail`) given by `grant`. Refused as
 * `failQuest` refuses, and when the hunter is not there (`no-hunter`).
 */
export function questFailed(save: Save, hid: string, qid: string, o: Day & { vitals: VitalsAt }): QuestFailed | Refused<'no-hunter' | QuestWhy> {
  const h = save.hunters.find(x => x.id === hid);
  if (!h) return refuse('no-hunter');
  const quest = h.quests.find(q => q.id === qid);
  if (!quest) return refuse('missing');
  const f = failQuest(h, qid, o.at);
  if (isRefused(f)) return f;
  const done = told({ ...save, hunters: save.hunters.map(x => (x.id === hid ? f.hunter : x)) }, { at: o.at, cap: o.R.logCap }, ...f.said);
  const g = grant(done, hid, quest.onFail, o);
  if (isRefused(g)) return g;
  return { save: g.save, quest, granted: g, effects: f.effects };
}
// ── a quest's end, told to the room ──
/**
 * Whether the GM's room hears of the end of a quest it issued that a player's phone ends with no tap, in the write that
 * ends it, by how it ended: `counted`, the System completing it (noticed.ts `countQuests`); `overdue`, the rollover
 * failing it past its due time. A tapped Complete or Fail is posted by the Quests view (quests.js `progressPost`).
 */
export const ROOM_HEARS: { readonly [How in 'counted' | 'overdue']: boolean } = {
  counted: true,
  // SMX-gates-3.3: an urgent quest that runs out fails with its cost, and the room hears of it (the owner, Nov 22: "Yes.")
  overdue: true,
};
/** A fraction made from a quest's id, so the same quest's end is the same room event however often it is posted. */
export function idShare(id: string): number {
  let x = 2166136261;
  for (let i = 0; i < id.length; i++) x = Math.imul(x ^ id.charCodeAt(i), 16777619) >>> 0;
  return x / 2 ** 32;
}
/**
 * Quest `q` of hunter `hid` as it ended (done or failed) posted to the GM of `room` in this write (`questUpdate`), under
 * the key the Quests view posts a tapped one with, so a progress post still waiting is replaced by it.
 */
export function questEnded(save: Save, hid: HunterId, q: Quest & { status: 'done' | 'failed' }, o: { at: string; room: RoomCode }): Save {
  const h = save.hunters.find(x => x.id === hid), device = save.settings.deviceId;
  if (!h) return save;
  const event = newEvent('questUpdate', {
    by: sheetKeyOf(device, hid), name: h.name, questId: q.id, title: q.title, kind: q.kind, status: q.status,
    objectives: q.objectives.map(o => ({ label: o.label, progress: o.progress, target: o.target })), secret: q.secret,
  }, { device, now: Date.parse(o.at), rand: idShare(q.id) });
  return event ? atOutbox(box => post(box, o.room, { kind: 'event', event }, `quest ${hid} ${q.id}`).box)(save) : save;
}

/** What the daily rollover did (`rollover`): the hunters it penalized, and each quest it failed past its due time with its cost as given. */
export type RolledOver = { save: Save; said: Said[]; penalties: Rollover['penalties']; failed: (Rollover['failed'][number] & { granted: Granted })[] };
/**
 * The daily rollover (`rollover`, quests.ts) with what each quest it failed for being past due costs, given by `grant` in
 * the same step: the one place an overdue quest's cost is paid, as `questFailed` is for a tapped Fail. `vitals` says
 * where each hunter's vitals are now; `room` is the room this phone is a player in (null alone or on the GM's phone),
 * told of the quests the GM issued when `ROOM_HEARS.overdue`. The Quests view shows its windows only once its write is saved.
 */
export function rolledOver(save: Save, o: Day & { nowMs: number; gm: boolean; vitals: (hid: string) => VitalsAt; room: RoomCode | null }): RolledOver {
  const r = rollover(save, { today: o.today, at: o.at, nowMs: o.nowMs, gm: o.gm });
  let s = r.save;
  const failed: RolledOver['failed'] = [];
  for (const f of r.told.failed) {
    const q = s.hunters.find(h => h.id === f.hid)?.quests.find(x => x.id === f.qid);
    if (!q || q.status !== 'failed') continue;
    const g = grant(s, f.hid, q.onFail, { ...o, vitals: o.vitals(f.hid) });
    if (isRefused(g)) continue;
    s = g.save;
    if (ROOM_HEARS.overdue && o.room && reportsProgress(q, 'player')) s = questEnded(s, f.hid, q, { at: o.at, room: o.room });
    failed.push({ ...f, granted: g });
  }
  return { save: s, said: r.said, penalties: r.told.penalties, failed };
}

/** A change the GM or the fight makes to a hunter's HP, mana, fatigue, life or statuses on its sheet. */
export type SheetEdit =
  /** `by`: who revives (the GM's Revive, an item: a Resurrection Crystal, or the System: `systemRaise`); absent is the GM's. */
  | { type: 'life'; event: LifeEvent; by?: 'gm' | 'item' | 'system' }
  | { type: 'mana'; delta: number }
  /** Mana paid as a price: refused when the hunter holds less (`spendMana`). */
  | { type: 'spend'; mana: number }
  | { type: 'fatigue'; delta: number }
  /**
   * The fight's totals for the hunter: its mana, fatigue and the statuses as its row holds them, and with `used` the uses
   * spent of its abilities limited a gate (the row holds all of them, so they replace the sheet's; without it the
   * sheet keeps its own). With them the row's `life` (its HP with it), the one writer's while the fight holds the hunter:
   * this phone's fight's write-back, or the room's `vitals` message for a player's hunter in the GM's fight.
   */
  | { type: 'totals'; life: Life; mana: number; fatigue: number; statuses: readonly SheetStatus[]; used?: Readonly<Record<AbilityId, number>> }
  | { type: 'put'; status: StatusIn }
  | { type: 'drop'; key: string }
  /** A rest (vitals.ts `rest`), counted against the rests a gate (rests.ts): refused `spent` when none is left, `cannot` when dead. */
  | { type: 'rest' }
  /** A gate the hunter was paid for cleared: everything back and the rests a gate with it (vitals.ts `cleared`, rests.ts); the dead get only the rests' count. */
  | { type: 'cleared' }
  /** A gate left without its Clear (a solo run lost or retreated from): the rests a gate start again (rests.ts), nothing else. */
  | { type: 'gateLeft' };

/**
 * How edit `e` changed a life from `before`, for its fact (facts.ts `LifeHow`): a fight's totals that stand a dead
 * hunter up are the GM's Revive of its row (the fight's `revive` command), any other the fight's; a revive is by who
 * raised; anything else is by hand.
 */
const howOf = (e: SheetEdit, before: Life): LifeHow =>
  e.type === 'totals' ? (before.at === 'dead' ? 'gm' : 'fight') : e.type === 'life' && e.event.type === 'revive' ? e.by ?? 'gm' : 'hand';

/**
 * Whether a change of life from `before` to `after` raised a hunter from death: the life table's `revive` (the GM's
 * Revive, a Resurrection Crystal), or a fight's totals that stand up a hunter the sheet holds dead (the GM's Revive of
 * the fight's row, written back).
 */
const raisedFromDeath = (before: Life, after: Life): boolean => before.at === 'dead' && after.at !== 'dead';
/**
 * Hunter `h` just raised from death, its levels lost (progress.ts `raisedLevels`, `levelAfterRaising`), the maxima
 * fitted to the level it is at, and the level told (`levelMoved`: its fact, the rank kept, the chain's level step's
 * progress). A lower level completes no Job Change step: a level step is completed in the write that reaches its level
 * (`levelled`), so the step a hunter is on asks for a level above the one it holds, and the chain's only effect is the
 * step's progress, which `chained` has written. Its lines are only of a quest issued, which a level change never does.
 */
function raisedAt(h: Hunter, R: Rules): Hunter {
  return levelMoved(h.level, fitted(raisedLevels(h, R), R), R).hunter;
}
/**
 * What a raising says where it is told (a Resurrection Crystal's use, the GM's Revive): up at the life table's revive HP
 * and, when it cost levels (`raisedAt`), the level it came back at and how many were lost: "Up at 1 HP at level 29, 2
 * levels lost". `from` and `to` are the levels before and after.
 */
export function raisedLine(from: number, to: number): string {
  const lost = from - to;
  return lost > 0 ? `Revived at ${REVIVE_HP} HP and level ${to} (${lost} level${lost === 1 ? '' : 's'} lost)` : `Revived at ${REVIVE_HP} HP`;
}

// ── the System raise ──
/** What a System raise did: the save after it, the raise taken, the gold it owes, and the levels before and after (`raisedLine`). */
export type SystemRaised = { save: Save; raise: Raise; owes: number; from: number; to: number };
/**
 * The System raise of dead hunter `hid` (world rule 6; the owner, Nov 22: "System raise", no GM button), in one write: its
 * revive standing stepped (revive-standing.ts `standingStep`), the life's revive by the System through `sheetEdit` (up
 * at the revive HP, every status off, its levels lost), and from `debt` the gold it owes added to its debt (`raiseOwes`,
 * at the rank after the raise, `up.rank`). In a room the GM's phone hears it in the same write (the `systemRaise` message). Refused
 * `spent` past the ladder, `cannot` when the hunter is up, `held` while a fight holds it (`o.held`, the caller's
 * `fightHold` of this save: section 21's default, a fight's dead row is the GM's to revive). A crystal or the GM's
 * Revive leaves the standing.
 */
export function systemRaise(save: Save, hid: string, o: { at: string; room: RoomCode | null; R: Rules; held: boolean }): SystemRaised | Refused<'no-hunter' | 'spent' | 'cannot' | 'held'> {
  const h = save.hunters.find(x => x.id === hid);
  if (!h) return refuse('no-hunter');
  const raise = h.reviveLeft, left = standingStep(raise, { type: 'raise' });
  if (isRefused(left) || !canRaise(raise)) return refuse('spent');
  const up = sheetEdit(h, { type: 'life', event: { type: 'revive' }, by: 'system' }, o.R);
  // a revive is refused only where the life table does not take it: the hunter is up
  if (isRefused(up)) return refuse('cannot');
  if (o.held) return refuse('held');
  const owes = raiseOwes(raise, up.rank, o.R);
  const raised: Save = { ...save, hunters: save.hunters.map(x => (x.id === hid ? { ...up, reviveLeft: left, debt: debtStep(up.debt, { type: 'incur', amount: owes }, o.R).debt } : x)) };
  const device = save.settings.deviceId;
  const event = o.room ? newEvent('systemRaise', { by: sheetKeyOf(device, h.id), name: h.name, raise, owes }, { device, now: Date.parse(o.at), rand: idShare(`raise ${hid} ${raise}`) }) : null;
  const room = o.room;
  return {
    save: event && room ? atOutbox(box => post(box, room, { kind: 'event', event }, `raise ${hid}`).box)(raised) : raised,
    raise, owes, from: h.level, to: up.level,
  };
}

/**
 * Whether a status put on or taken off fits the vitals to the maxima it leaves. Both do (SMX-rules-1.3, the owner, Nov 22:
 * "Yes"): HP, mana and fatigue come down to the new maxima at once, and max HP is at least 1 (derive.ts `hpMax`).
 */
const STATUS_FITS: { readonly put: boolean; readonly drop: boolean } = { put: true, drop: true };

/**
 * Hunter `h` after `e`, each with the maxima its sheet gives. A life event its state does not take (a heal on a dead
 * hunter) is refused (`cannot`), and so is a price of more mana than the hunter holds (`mana`); a status put on that changes nothing, or taken off that is not held, is refused
 * (`unchanged`), as `putStatus` and `dropStatus` answer. What the change did to the life (`lifeNews`) and a rest are
 * recorded as facts on the hunter in the same answer (chronicle.ts `record`). A change that raises the hunter from death
 * (`raisedFromDeath`: the life's `revive` by the GM or an item, or a fight's totals) costs its levels in the same answer
 * (`raisedAt`); the hunter it answers is up, so a second write of the same change costs nothing. A revive takes off
 * every status the hunter holds.
 */
export function sheetEdit(h: Hunter, e: SheetEdit, R: Rules): Hunter | Refused<'cannot' | 'mana' | 'spent' | 'state-chip' | 'no-def' | 'unchanged'> {
  const next = edited(h, e, R);
  if (isRefused(next)) return next;
  // what the change did to the life, and a rest, are facts (chronicle.ts), recorded in the edit's own write
  const news = lifeNews(h.life, next.life);
  const withLife = news ? record(next, { kind: 'life', news: news.kind, how: howOf(e, h.life) }) : next;
  // a raising from death costs levels (the owner's ruling 9), told after the life's fact
  const raised = raisedFromDeath(h.life, next.life) ? raisedAt(withLife, R) : withLife;
  return e.type === 'rest' ? record(raised, { kind: 'rest' }) : raised;
}
/**
 * Hunter `h` with `facts` recorded (chronicle.ts `record`); a gate's Clear among them (a `gate` fact, pay.ts `gateFact`)
 * gives it everything back in the same answer (`cleared`). Every place a Clear reaches a hunter records its fact here:
 * `settleClear` on the clearing phone, `soloRan` for a personal gate won alone, and the `noted` message on a player's phone.
 */
export function noteFacts(h: Hunter, facts: readonly Fact[], R: Rules): Hunter {
  const noted = record(h, ...facts);
  if (!facts.some(f => f.kind === 'gate')) return noted;
  const back = sheetEdit(noted, { type: 'cleared' }, R);
  return isRefused(back) ? noted : back;
}
function edited(h: Hunter, e: SheetEdit, R: Rules): Hunter | Refused<'cannot' | 'mana' | 'spent' | 'state-chip' | 'no-def' | 'unchanged'> {
  const step = (ev: VitalEvent): Hunter | Refused<'cannot' | 'mana'> => { const v = vitalStep(h, ev, sheetOf(h, R), R); return isRefused(v) ? v : { ...h, ...v }; };
  // a rest moves the vitals and the count of rests together, or neither (a dead hunter's rest is refused first)
  const rested = (): Hunter | Refused<'cannot' | 'mana' | 'spent'> => {
    const x = step({ type: 'rest' }); if (isRefused(x)) return x;
    const restsTaken = restStep(h.restsTaken, { type: 'rest' }, R);
    return isRefused(restsTaken) ? restsTaken : { ...x, restsTaken };
  };
  // a gate's end starts the count again for every hunter it ends for; a Clear gives everything back (and heals resting
  // shadows) too, except to the dead, who get nothing else (vitals.ts `VITAL_TABLE`)
  const ended = (ev: 'cleared' | 'gateLeft'): Hunter | Refused<'spent'> => {
    const x = ev === 'cleared' ? step({ type: 'cleared' }) : h;
    const base = isRefused(x) ? h : ev === 'cleared' ? healRestingShadows(x, R) : x;
    const restsTaken = restStep(h.restsTaken, { type: ev }, R);
    return isRefused(restsTaken) ? restsTaken : { ...base, restsTaken };
  };
  const fits = (x: Hunter | Refused<'state-chip' | 'no-def' | 'unchanged'>, edit: 'put' | 'drop') => (isRefused(x) || !STATUS_FITS[edit] ? x : fitted(x, R));
  switch (e.type) {
    // a revive takes off every status, so a poison does not kill the hunter again (the owner, Nov 21)
    case 'life': { const x = step(e.event.type === 'revive' ? { type: 'revive', by: e.by ?? 'gm' } : e.event); return isRefused(x) || e.event.type !== 'revive' ? x : { ...x, conditions: [] }; }
    case 'mana': case 'spend': case 'fatigue': return step(e);
    case 'rest': return rested();
    case 'cleared': case 'gateLeft': return ended(e.type);
    // the life, mana and fatigue fitted to the maxima the sheet gave before the fight's statuses replace its own
    case 'totals': { const x = step({ type: 'fightTotals', life: e.life, mana: e.mana, fatigue: e.fatigue, ...(e.used ? { used: e.used } : {}) }); return isRefused(x) ? x : { ...x, conditions: e.statuses.map(s => ({ ...s })) }; }
    case 'put': return fits(putStatus(h, e.status, R.conditions), 'put');
    case 'drop': return fits(dropStatus(h, e.key), 'drop');
  }
}

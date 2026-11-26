// job-chain.ts: a hunter's Job Change chain. Pure.
// `jobChain` on a hunter is the only store: which job, which of its three steps (src/core/registry/jobs.ts), whether it
// is running or failed, and the quest of the open step, tied by id. A step's quest keeps `chainId` only as a
// back-reference. One table of events, `chainAfter`, answers the next chain and what the app must do (issue a step's
// quest, set a level step's progress, complete it, grant the job). src/views/quests.js sends the events.
import type { Quest, QuestStatus } from '../save.ts';
import type { Role } from '../role.ts';
import { chainStepsOf, isChainJob } from '../registry/jobs.ts';
import type { ChainJobName, StepDef } from '../registry/jobs.ts';
import { parseSaveId } from '../ids.ts';
import type { ChainId, QuestId } from '../ids.ts';

export type ChainStep = 1 | 2 | 3;
export type ChainStatus = 'active' | 'failed';
/** A chain: its id (the step quests' `chainId`), the job it grants, the open step and that step's quest. */
export type JobChain = { id: ChainId; job: ChainJobName; step: ChainStep; status: ChainStatus; questId: QuestId };

/**
 * `issued`: the GM starts a chain; `questId` is the id step 1's quest takes. `levelChanged`: the hunter's level is now
 * `level`. `stepCompleted` and `stepFailed` name a quest that was completed, or failed or deleted. `nextQuestId` is the
 * id the next step's quest takes. `reissued` (the GM) restarts a failed chain at its step; `abandoned` (the GM) drops it.
 * `level` is the hunter's level when the event happens; `at` is when.
 */
export type ChainEvent =
  | { type: 'issued'; id: ChainId; job: ChainJobName; questId: QuestId; level: number; at: string }
  | { type: 'levelChanged'; level: number }
  | { type: 'stepCompleted'; questId: QuestId; level: number; nextQuestId: QuestId; at: string }
  | { type: 'stepFailed'; questId: QuestId }
  | { type: 'reissued'; by: Role; questId: QuestId; level: number; at: string }
  | { type: 'abandoned'; by: Role };
export type ChainEventType = ChainEvent['type'];
export const CHAIN_EVENT_TYPES = ['issued', 'levelChanged', 'stepCompleted', 'stepFailed', 'reissued', 'abandoned'] as const satisfies readonly ChainEventType[];

/** Why an event was refused: a chain is already running, a level step completed below its level, a player acting for the GM. */
export type ChainRefusal = 'running' | 'belowLevel' | 'gmOnly';
/** What a refused chain event says (`ui.wrote`'s words). A player's phone never offers the GM's events, so `gmOnly` has none. */
export const CHAIN_WORDS: Readonly<Partial<Record<ChainRefusal, string>>> = {
  running: 'This hunter already has a Job Change quest running.',
  belowLevel: 'This step completes at a higher level.',
};
/**
 * `issueQuest`: add `quest` to the hunter's quests. `progress`: set a level step's objective. `completeQuest`: complete
 * that quest as a player would (its completion comes back as `stepCompleted`). `grantJob`: the hunter is now `job`.
 * `closed`: the chain has ended. `refused`: nothing happened.
 */
export type ChainEffect =
  | { type: 'issueQuest'; quest: Quest }
  | { type: 'progress'; questId: QuestId; value: number }
  | { type: 'completeQuest'; questId: QuestId }
  | { type: 'grantJob'; job: ChainJobName }
  | { type: 'closed' }
  | { type: 'refused'; reason: ChainRefusal };
/** The next chain, named as the hunter's field so a caller can assign it, and what the app must do. */
export type ChainResult = { jobChain: JobChain | null; effects: ChainEffect[] };

const stepDef = (job: ChainJobName, step: ChainStep): StepDef => chainStepsOf(job)[(step - 1) as 0 | 1 | 2];
const isStep = (n: unknown): n is ChainStep => n === 1 || n === 2 || n === 3;

/** The quest a step issues. A level step's objective already shows the level reached, up to the level it asks for. */
export function stepQuest(job: ChainJobName, step: ChainStep, o: { chainId: ChainId; questId: QuestId; at: string; level: number }): Quest {
  const def = stepDef(job, step);
  const objectives = def.goal === 'level'
    ? [{ label: `Reach Level ${def.level}`, target: def.level, progress: Math.max(0, Math.min(def.level, Math.trunc(o.level))) }]
    : def.objectives.map(x => ({ label: x.label, target: x.target, progress: 0 }));
  return {
    id: o.questId, kind: 'job', title: def.title, desc: def.desc, objectives,
    rewards: { xp: 0, points: 0, gold: 0, crystal: 0, items: [], title: null, job: step === 3 ? job : null, skills: [], statuses: [], boons: [] },
    status: 'active', issuedAt: o.at, doneAt: null, dueAt: null, from: 'system', penaltyText: '', chainId: o.chainId, secret: false,
    onFail: { xp: 0, points: 0, gold: 0, crystal: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] },
  };
}

// ── the table ──
type ChainState = 'none' | ChainStatus;
const stateOf = (c: JobChain | null): ChainState => (c ? c.status : 'none');
type Step<T extends ChainEventType> = (c: JobChain | null, e: Extract<ChainEvent, { type: T }>) => ChainResult;
/** For one state: what each event does there. `null` means the event does not apply, and the chain stays as it is. */
type Row = { readonly [T in ChainEventType]: Step<T> | null };

const refuse = (c: JobChain | null, reason: ChainRefusal): ChainResult => ({ jobChain: c, effects: [{ type: 'refused', reason }] });
/**
 * The chain of a hunter whose quests took new ids (imported.ts): tied to its step quest's new id; when that quest is
 * gone (a failed step deleted), to a new id (`fresh`) no quest has, so it stays failed at its step.
 */
export const chainMoved = (c: JobChain | null, moved: (id: QuestId) => QuestId | null, fresh: () => QuestId): JobChain | null =>
  c && { ...c, questId: moved(c.questId) ?? fresh() };
/** Opens `step`: its quest, and for a level step already reached, the request to complete it. */
function open(chain: JobChain, level: number, at: string): ChainResult {
  const quest = stepQuest(chain.job, chain.step, { chainId: chain.id, questId: chain.questId, at, level });
  const def = stepDef(chain.job, chain.step);
  const done: ChainEffect[] = def.goal === 'level' && level >= def.level ? [{ type: 'completeQuest', questId: chain.questId }] : [];
  return { jobChain: chain, effects: [{ type: 'issueQuest', quest }, ...done] };
}
const start: Step<'issued'> = (_c, e) => open({ id: e.id, job: e.job, step: 1, status: 'active', questId: e.questId }, e.level, e.at);
const levelChanged: Step<'levelChanged'> = (c, e) => {
  const def = stepDef(c!.job, c!.step);
  if (def.goal !== 'level') return { jobChain: c, effects: [] };
  const value = Math.max(0, Math.min(def.level, Math.trunc(e.level)));
  const done: ChainEffect[] = e.level >= def.level ? [{ type: 'completeQuest', questId: c!.questId }] : [];
  return { jobChain: c, effects: [{ type: 'progress', questId: c!.questId, value }, ...done] };
};
const advance: Step<'stepCompleted'> = (c, e) => {
  const chain = c!;
  if (e.questId !== chain.questId) return { jobChain: chain, effects: [] };
  const def = stepDef(chain.job, chain.step);
  if (def.goal === 'level' && e.level < def.level) return refuse(chain, 'belowLevel');
  if (chain.step === 3) return { jobChain: null, effects: [{ type: 'grantJob', job: chain.job }, { type: 'closed' }] };
  return open({ ...chain, step: (chain.step + 1) as ChainStep, questId: e.nextQuestId }, e.level, e.at);
};
const fail: Step<'stepFailed'> = (c, e) => (e.questId === c!.questId ? { jobChain: { ...c!, status: 'failed' }, effects: [] } : { jobChain: c, effects: [] });
const reissue: Step<'reissued'> = (c, e) => (e.by === 'gm' ? open({ ...c!, status: 'active', questId: e.questId }, e.level, e.at) : refuse(c, 'gmOnly'));
const abandon: Step<'abandoned'> = (c, e) => (e.by === 'gm' ? { jobChain: null, effects: [{ type: 'closed' }] } : refuse(c, 'gmOnly'));
const running: Step<'issued'> = c => refuse(c, 'running');

const TABLE: { readonly [S in ChainState]: Row } = {
  none: { issued: start, levelChanged: null, stepCompleted: null, stepFailed: null, reissued: null, abandoned: null },
  active: { issued: running, levelChanged, stepCompleted: advance, stepFailed: fail, reissued: null, abandoned: null },
  failed: { issued: start, levelChanged: null, stepCompleted: null, stepFailed: null, reissued: reissue, abandoned: abandon },
};

/** The chain after `event`. Never changes its inputs. */
export function chainAfter(chain: JobChain | null, event: ChainEvent): ChainResult {
  // TABLE pairs each event type with its own step.
  const f = TABLE[stateOf(chain)][event.type] as Step<ChainEventType> | null;
  return f ? f(chain, event as never) : { jobChain: chain, effects: [] };
}

/** Whether the GM's Reissue and Abandon apply: only to a failed chain. */
export const canReissue = (chain: JobChain | null): boolean => stateOf(chain) === 'failed';

// ── the boundary ──
/** What the parser reads of a quest. */
export type ChainQuestRef = { id: QuestId; status: QuestStatus; chainId?: unknown };
/**
 * The chain in `value` for a hunter with `quests`, or null. An active chain whose quest is no longer open (failed, or
 * gone, some way other than its event) is failed at its step.
 */
export function parseJobChain(value: unknown, quests: readonly ChainQuestRef[]): JobChain | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (!isChainJob(o.job) || !isStep(o.step)) return null;
  if (o.status !== 'active' && o.status !== 'failed') return null;
  const id = parseSaveId<'jc'>(o.id), questId = parseSaveId<'q'>(o.questId);
  if (!id || !questId) return null;
  const openQuest = quests.some(q => q.id === questId && q.status === 'active');
  return { id, job: o.job, step: o.step, status: o.status === 'active' && openQuest ? 'active' : 'failed', questId };
}

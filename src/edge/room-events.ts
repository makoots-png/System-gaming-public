// room-events.ts: what a player's phone does with each room message. One applier per event type in `APPLIERS`, so a new
// type without one does not compile. sync.ts parses every event it receives (parseEvent in src/core/protocol.ts) and
// hands the typed event here: nothing below re-checks a field the parser checked.
//
// An applier that changes a hunter (`once: true`) answers a `Land`: for the save it is given, the next save and what to
// tell the player once that is written. `applyRoomEvent` runs it inside `once` with the event's id, so the change and
// the id are one write or none (src/core/applied.ts `appliedOnce`): a message is never marked applied while only part
// of it landed, and a repeat changes nothing. Each change is a core step (src/core/hunter/grant.ts, quests.ts).
import { describeStatus } from '../core/combat/effect-ops.ts';
import type { SheetStatus } from '../core/combat/effect-ops.ts';
import { chainStep, grant, idsFrom, noteFacts, raisedLine, sheetEdit } from '../core/hunter/grant.ts';
import type { Granted, SheetEdit, StepDone } from '../core/hunter/grant.ts';
import { chained, issueQuest, withTold } from '../core/hunter/quests.ts';
import { told } from '../core/session-log.ts';
import { appliedOnce, hold, replaced, unhold } from '../core/applied.ts';
import { runAnswered } from '../core/gates/solo-wait.ts';
import { REFUSED_WORDS } from '../core/gates/solo.ts';
import type { ChainEvent } from '../core/hunter/job-chain.ts';
import { WAYS_BACK, hpChange, lifeNews } from '../core/hunter/vitals.ts';
import type { Life } from '../core/hunter/vitals.ts';
import { spendItem } from '../core/hunter/use.ts';
import { shadowRises } from '../core/hunter/shadows.ts';
import { record } from '../core/hunter/chronicle.ts';
import { chapterLanded, whoseLine } from '../core/story/story.ts';
import { weightHeard } from '../core/table-weight.ts';
import type { ChapterGiven } from '../core/story/story.ts';
import { deviceOf, hunterIdOf } from '../core/protocol.ts';
import { rewardLines } from '../core/rewards.ts';
import type { EventId, EventType, PayloadOf, QuestOffer, RoomEvent, SheetKey } from '../core/protocol.ts';
import type { Hunter, Rules, Save } from '../core/save.ts';
import { isRefused, refuse } from '../core/save-step.ts';
import type { Refused, Step } from '../core/save-step.ts';
import type { store } from './store.ts';
import type { RoomHunter } from '../core/api.ts';
import type { RollId } from '../core/coin.ts';
import type { DayKey } from '../core/day.ts';

type Window = { tag: string; title: string; kind: string; body?: string | undefined; lines?: string[]; rewards?: string[] };
/** What the appliers use of the app. sync.ts passes it in. */
export type ApplyDeps = {
  store: Pick<typeof store, 'get'>;
  /** `step` and the event id `eid` in one write, the first time only (sync.ts `once`): whether it wrote. */
  once: (eid: EventId, step: Step<Save>) => boolean;
  rules: () => Rules;
  /** The time a change is written at. */
  now: () => string;
  /** Today's day key at the save's reset hour (src/core/rules.ts `dayKey`). */
  today: () => DayKey;
  toast: (tag: string, text: string, opts?: { kind: string }) => void;
  system: (w: Window) => unknown;
  /** Where a hunter's vitals live (`fightOf`), a grant's windows and fight parts (`granted`), the refusal in the GM's fight. */
  hunter: RoomHunter;
  /** The windows of the Job Change steps a change completed in its own write (quests.js `stepsDone`). */
  stepsDone: (hid: string, done: readonly StepDone[]) => void;
  /** The GM's ruling of a coin this phone called (`coinLand`, no side): src/views/coin.js marks it ruled, once per roll. */
  coinRuled: (roll: RollId) => void;
};

/** What a change answers for the save it is given: the next save, and what to tell the player once it is written. */
type Landed = { save: Save; tell: () => void };
/** A change to this phone's hunters, as a step that also says what to tell. */
type Land = (save: Save) => Landed | Refused;
/**
 * An event type's applier. `once: true` marks one that changes a hunter: it answers its change as a `Land`, written with
 * its id at most once per phone. Any other applies at once and writes nothing of its own here.
 */
type Applier<K extends EventType> =
  | { once: true; land: (p: PayloadOf<K>, hids: string[], app: ApplyDeps) => Land }
  | { once: false; apply: (p: PayloadOf<K>, hids: string[], app: ApplyDeps) => void };
/** Nothing to apply on a player's phone: the GM's views read these from the `sync:event` signal. */
const GM_ONLY_READS = null;
/**
 * Not applied one by one: an offer and its end are read whole from each page, own echoes included, by the fold
 * (core/trade/offer.ts `offersSeen`), guarded by each phone's record of the offer and never by the applied ring.
 */
const OFFER_FOLD_READS = null;

const money = (n: number): string => (n < 0 ? '-' : '+') + Math.abs(n);
const nothing = (): void => undefined;
/** The save with hunter `h` in the place of the hunter of its id. */
const withHunter = (save: Save, h: Hunter): Save => ({ ...save, hunters: save.hunters.map(x => (x.id === h.id ? h : x)) });
/** Runs `each` for every hunter of `hids` the save holds, in turn: one save, and every tell in order. */
function forEach(save: Save, hids: readonly string[], each: (save: Save, h: Hunter) => Landed): Landed {
  let s = save;
  const tells: (() => void)[] = [];
  for (const hid of hids) {
    const h = s.hunters.find(x => x.id === hid); if (!h) continue;
    const r = each(s, h);
    s = r.save; tells.push(r.tell);
  }
  return { save: s, tell: () => { for (const t of tells) t(); } };
}

const APPLIERS: { readonly [K in EventType]: Applier<K> | typeof GM_ONLY_READS } = {
  offer: OFFER_FOLD_READS,
  offerEnd: OFFER_FOLD_READS,
  offerStop: OFFER_FOLD_READS,
  system: { once: false, apply: (p, _hids, app) => { app.system({ tag: p.tag, title: p.title, body: p.body || undefined, kind: p.kind }); } },
  award: { once: true, land: landAward },
  quest: { once: true, land: (p, hids, app) => save => {
    const at = app.now(), stamp = { at, cap: app.rules().logCap };
    const landed = forEach(save, hids, (s, h) => {
      const ids = idsFrom(s.seq), id = ids.next('q'), next = withTold({ ...s, seq: ids.seq() }, h.id, stamp, x => issueQuest(x, { ...p.quest, from: 'gm' }, id, at));
      return { save: isRefused(next) ? s : next, tell: nothing };
    });
    return { save: landed.save, tell: () => { app.system({ tag: '! Quest', title: p.quest.title, kind: 'quest', ...questWindow(app.rules(), p.quest) }); } };
  } },
  hp: { once: true, land: landHp },
  vitals: { once: true, land: (p, hids, app) => save => forEach(save, hids, (s, h) => {
    // the fight's own totals, its row's life among them: written on the sheet wherever the fight is, so a repeat changes nothing
    const next = sheetEdit(h, { type: 'totals', life: p.life, mana: p.mana, fatigue: p.fatigue, statuses: p.statuses }, app.rules());
    if (isRefused(next)) return { save: s, tell: nothing };
    const had = new Set(h.conditions.map(c => c.key)), was = h.level; // the save is written into `h`: the level before is kept here
    return { save: withHunter(s, next), tell: () => {
      for (const st of p.statuses) if (!had.has(st.key)) statusToast(app, st);
      fightLifeTold(app, h.life, next.life, p.reason, was, next.level);
    } };
  }) },
  // the GM's fight took this hunter's use of an item: one leaves the bag (src/core/hunter/use.ts `spendItem`); an item
  // the bag no longer holds (sold since) leaves nothing to take, and the id is recorded all the same
  spent: { once: true, land: (p, hids, app) => save => forEach(save, hids, (s, h) => {
    const it = h.items.find(i => i.id === p.item), next = spendItem(h, p.item, app.rules());
    if (isRefused(next) || !it) return { save: s, tell: nothing };
    return { save: withHunter(s, next), tell: () => app.toast('! System', `${it.name} used.`, { kind: 'info' }) };
  }) },
  status: { once: true, land: landStatus },
  // a hunter no fight holds: only a dead one is revived (the vitals table), its statuses taken off with it (grant.ts
  // `sheetEdit`), the rest of the list is left as it is. A hunter a fight holds is not written here: its row holds the
  // life, the GM's fight revives it with its `revive` command
  // and this phone hears it in `vitals`, so a revive sent before the hunter joined a fight lands on nothing
  revive: { once: true, land: (_p, hids, app) => save => forEach(save, hids, (s, h) => {
    if (app.hunter.fightOf({ hid: h.id })) return { save: s, tell: nothing };
    const was = h.level, next = sheetEdit(h, { type: 'life', event: { type: 'revive' } }, app.rules()); // the save is written into `h`, so the level before is kept here
    return isRefused(next) ? { save: s, tell: nothing }
      : { save: withHunter(s, next), tell: () => app.toast('! System', `The GM has revived you. ${raisedLine(was, next.level)}.`, { kind: 'good' }) };
  }) },
  // the chain machine refuses what does not apply (a second chain, a reissue of a chain that has not failed): nothing happens
  chain: { once: true, land: landChain },
  roll: GM_ONLY_READS,
  questUpdate: GM_ONLY_READS,
  used: GM_ONLY_READS,
  // the GM's fight takes these (`onTurn` in src/core/protocol.ts); a player's phone hears of the result in `vitals`,
  // `spent` and the fight doc
  step: GM_ONLY_READS,
  cast: GM_ONLY_READS,
  pass: GM_ONLY_READS,
  // a player's armed reaction (kits design 8.4.2): the GM's fight takes it as its `arm`; a player's phone does nothing
  arm: GM_ONLY_READS,
  // the GM's phone keeps the call and asks the GM (src/views/coin.js)
  coinCall: GM_ONLY_READS,
  // not `once`: the coin's own table takes the first ruling of a roll and refuses any after it, so a replay changes
  // nothing, and a ruling for a roll this phone does not hold finds no coin
  coinLand: { once: false, apply: (p, _hids, app) => { app.coinRuled(p.roll); } },
  // the GM's phone rolled this hunter's extraction in its fight and the shadow rose: it joins the army with its log line
  // (core/hunter/shadows.ts `shadowRises`); an army at its cap takes none, and the player is told
  shadow: { once: true, land: (p, hids, app) => save => forEach(save, hids, (s, h) => {
    const ids = idsFrom(s.seq), id = ids.next('sh');
    const next = shadowRises({ ...s, seq: ids.seq() }, h.id, p.shadow, id, { at: app.now(), cap: app.rules().logCap }, app.rules());
    if (isRefused(next)) return { save: s, tell: () => app.toast('ARISE', `${p.shadow.name || 'A shadow'} rose, but ${h.name}'s army is full.`, { kind: 'warn' }) };
    return { save: next, tell: () => app.toast('ARISE', `${p.shadow.name || 'A shadow'} rises and joins ${h.name}'s army.`, { kind: 'levelup' }) };
  }) },
  // the GM's phone takes a player's run (gates.js, gates/solo.ts `soloTaken`); a player's phone does nothing with one
  soloRun: GM_ONLY_READS,
  soloAnswer: { once: true, land: landSoloAnswer },
  // the facts the GM's phone saw of this phone's hunter (a fight's end, a Clear it was paid in): recorded in one write
  // with the event's id, where the store's notice step takes them (feature 1's notes 2.3); its feats tell their own
  // windows. A gate's Clear among the facts gives the hunter everything back in the same write (grant.ts `noteFacts`)
  noted: { once: true, land: (p, hids, app) => save => forEach(save, hids, (s, h) => ({ save: withHunter(s, noteFacts(h, p.facts, app.rules())), tell: nothing })) },
  chapter: { once: true, land: landChapter },
  // the GM's table weight on this phone's hunter (core/table-weight.ts `weightHeard`): kept for the room it came in, set
  // and not added, once by its id so a page read again never puts back a force a roll spent since. It tells nothing:
  // the player's page names no weight
  weigh: { once: true, land: (p, hids) => save => {
    const room = save.settings.sync.room;
    return room ? forEach(save, hids, (s, h) => ({ save: weightHeard(s, room, h.id, p), tell: nothing })) : refuse('nothing');
  } },
};

/**
 * A chapter of a story the GM opened: each hunter of this phone it names given it by the one step that gives a chapter on
 * any phone (story/story.ts `chapterLanded`: its reward, its quest from the GM, its fact), all in one write; then one
 * window a hunter, the chapter's (`chapterWindow`, its line named by `whoseLine` on a phone of several hunters). What the reward hands to a fight is the GM's, as for an award
 * (`landAward`): refused here with the toast that says so.
 */
function landChapter(p: PayloadOf<'chapter'>, hids: string[], app: ApplyDeps): Land {
  return save => {
    let s = save;
    const given: [string, ChapterGiven, boolean][] = [];
    for (const hid of hids) {
      const at = app.hunter.fightOf({ hid });
      const g = chapterLanded(s, hid, p, { at: app.now(), today: app.today(), R: app.rules(), vitals: at ? 'fight' : 'sheet' });
      if (isRefused(g)) continue;
      const off = at?.at === 'row' && (g.fight.statuses.length > 0 || g.fight.refill);
      s = g.save;
      given.push([hid, off ? { ...g, fight: { statuses: [], refill: false } } : g, off]);
    }
    const hunters = s.hunters;
    return { save: s, tell: () => { for (const [hid, g, off] of given) { app.hunter.granted(hid, { ...g, lines: g.window.lines }, { tag: g.window.tag, title: g.window.title, body: whoseLine(g.window.body, hunters, hid), kind: 'quest' }); if (off) app.hunter.gmHolds(); } } };
  };
}

/**
 * The GM's phone's answer to this phone's won run of a room's solo gate (gates/solo-wait.ts): the waiting run leaves the
 * list and, when paid, its hunter is given the gate's reward (`grant`), in one write with the event's id. With no run of
 * that id waiting (a second GM phone's answer, one already landed) nothing is given: the land is refused.
 */
function landSoloAnswer(p: PayloadOf<'soloAnswer'>, hids: string[], app: ApplyDeps): Land {
  return save => {
    const closed = runAnswered(save, p.run);
    if (isRefused(closed)) return closed;
    const hid = hids[0];
    if (p.verdict === 'refused' || !hid) {
      const why = p.verdict === 'refused' ? REFUSED_WORDS[p.why] : '';
      return { save: closed, tell: () => { app.system({ tag: '! Gate', title: 'GATE TAKEN', kind: 'warning', body: p.name, lines: why ? [why] : [] }); } };
    }
    const at = app.hunter.fightOf({ hid });
    const g = grant(closed, hid, p.rewards, null, { at: app.now(), today: app.today(), R: app.rules(), vitals: at ? 'fight' : 'sheet' });
    if (isRefused(g)) return { save: closed, tell: nothing };
    const off = at?.at === 'row' && (g.fight.statuses.length > 0 || g.fight.refill), given = off ? { ...g, fight: { statuses: [], refill: false } } : g;
    return { save: g.save, tell: () => { app.hunter.granted(hid, given, { title: 'GATE CLEARED', tag: '! Gate', kind: 'quest', body: `${p.name}: the GM's phone paid your solo run.` }); if (off) app.hunter.gmHolds(); } };
  };
}

/**
 * The GM's award: one grant per hunter (src/core/hunter/grant.ts), all in one write; then each hunter's window. What a
 * grant hands to a fight is the GM's to give, so on this phone it is refused with a toast (`granted`, `gmHolds`), as
 * the room's `status` is for a held hunter: in the GM's fight the GM's own phone puts it on the row in the award's
 * write; a fight this phone ran alone runs no command while it is a player in a room (role.ts `runsFight`).
 */
function landAward(p: PayloadOf<'award'>, hids: string[], app: ApplyDeps): Land {
  return save => {
    let s = save;
    const given: [string, Granted, boolean][] = [];
    const b = p.bundle;
    for (const hid of hids) {
      const at = app.hunter.fightOf({ hid });
      const g = grant(s, hid, p.rewards, p.rewards.build ?? null, { at: app.now(), today: app.today(), R: app.rules(), vitals: at ? 'fight' : 'sheet' });
      if (isRefused(g)) continue;
      const off = at?.at === 'row' && (g.fight.statuses.length > 0 || g.fight.refill);
      // a bundle the GM gave by hand is a fact of the hunter's chronicle, in the award's write
      s = b ? { ...g.save, hunters: g.save.hunters.map(h => (h.id === hid ? record(h, { kind: 'given', key: b.key, name: b.name }) : h)) } : g.save;
      given.push([hid, off ? { ...g, fight: { statuses: [], refill: false } } : g, off]);
    }
    // one window a hunter, in the bundle's words when it has them, else "REWARD RECEIVED"; a level-up window may follow
    const words = b?.window ? { title: b.window.title, body: b.window.line || b.name } : { title: 'REWARD RECEIVED', body: 'The System has delivered a reward.' };
    return { save: s, tell: () => { for (const [hid, g, off] of given) { app.hunter.granted(hid, g, { ...words, tag: '! Reward', kind: 'quest' }); if (off) app.hunter.gmHolds(); } } };
  };
}

/** A4: a death is a toast too; the sheet's death panel and the Dead chip say how to come back. */
function fallen(app: ApplyDeps, before: Hunter, after: Hunter, reason: string): void {
  if (before.life.at === 'up' && after.life.at === 'dead') diedTold(app, reason);
}
const diedTold = (app: ApplyDeps, reason: string): void => app.toast('! Warning', `You are dead. ${reason || 'Your HP has reached 0.'} ${WAYS_BACK} brings you back.`, { kind: 'warn' });
/**
 * What the GM's fight did to this phone's hunter's life, told from the lives before and after the `vitals` write
 * (vitals.ts `lifeNews`), so the words follow what the row's life did: a death, or a revive.
 */
function fightLifeTold(app: ApplyDeps, before: Life, after: Life, reason: string, levelBefore: number, levelAfter: number): void {
  const news = lifeNews(before, after);
  if (!news) return;
  switch (news.kind) {
    case 'died': diedTold(app, reason); return;
    case 'raised': app.toast('! System', `You are revived. ${raisedLine(levelBefore, levelAfter)}.`, { kind: 'good' }); return;
  }
}

/**
 * The GM's change of HP, mana and fatigue. While the GM's fight holds the hunter's vitals it is refused with the
 * toast that says so (the fight's next totals would write over the sheet).
 */
function landHp(p: PayloadOf<'hp'>, hids: string[], app: ApplyDeps): Land {
  return save => {
    if (!p.hp && !p.mana && !p.fatigue) return refuse('nothing');
    const edits: SheetEdit[] = [
      ...(p.hp ? [{ type: 'life', event: hpChange(p.hp) } as const] : []),
      ...(p.mana ? [{ type: 'mana', delta: p.mana } as const] : []),
      ...(p.fatigue ? [{ type: 'fatigue', delta: p.fatigue } as const] : []),
    ];
    const bits = [p.hp && `${money(p.hp)} HP`, p.mana && `${money(p.mana)} mana`, p.fatigue && `${money(p.fatigue)} fatigue`].filter(Boolean).join(', ');
    return forEach(save, hids, (s, h) => {
      if (app.hunter.fightOf({ hid: h.id })) return { save: s, tell: () => { app.hunter.gmHolds(); } };
      const next = edits.reduce((x, e) => { const y = sheetEdit(x, e, app.rules()); return isRefused(y) ? x : y; }, h);
      return { save: withHunter(s, next), tell: () => {
        app.toast('! System', p.reason ? `${bits} · ${p.reason}` : bits, { kind: p.hp < 0 || p.fatigue > 0 ? 'warn' : 'good' });
        fallen(app, h, next, p.reason);
      } };
    });
  };
}

/** What a status a hunter now holds does, at the tier of its source, and its rounds: a toast, not a window (A4). */
function statusToast(app: ApplyDeps, s: SheetStatus): void {
  const lines = describeStatus(s.def, s.source.tier, app.rules());
  const what = [...lines, ...(s.rounds ? [`${s.rounds} round${s.rounds === 1 ? '' : 's'}`] : [])].join(' · ');
  app.toast('! Status', what ? `${s.def.label}: ${what}` : s.def.label, { kind: 'warn' });
}

/**
 * The status toast says what the status does as the hunter now holds it: one instance per key, so a weaker or shorter
 * one sent does not replace a stronger or longer one (`putStatus`), and the toast reads the one that stayed, at the
 * tier of its source. While the GM's fight holds the hunter's statuses, the change is refused with the toast that says so.
 */
function landStatus(p: PayloadOf<'status'>, hids: string[], app: ApplyDeps): Land {
  return save => forEach(save, hids, (s, h) => {
    if (app.hunter.fightOf({ hid: h.id })) return { save: s, tell: () => { app.hunter.gmHolds(); } };
    let x = h;
    for (const a of p.add) { const y = sheetEdit(x, { type: 'put', status: a }, app.rules()); if (!isRefused(y)) x = y; }
    const ended: string[] = [];
    for (const k of p.remove) {
      const c = x.conditions.find(c2 => c2.key === k), y = sheetEdit(x, { type: 'drop', key: k }, app.rules());
      if (!isRefused(y)) { x = y; ended.push(c?.def.label ?? k); }
    }
    const held = x;
    return { save: withHunter(s, held), tell: () => {
      // A4: a status that lands mid-fight is a toast, not a window: it needs no answer, and a window covers the turn.
      for (const a of p.add) statusToast(app, held.conditions.find(c => c.key === a.key) ?? a);
      for (const label of ended) app.toast('! Status', `${label} has ended.`);
    } };
  });
}

/**
 * The GM's Job Change chain on a hunter of this phone: the chain machine's event (src/core/hunter/job-chain.ts) and the
 * step quest it issues, in one write with its log lines. A step the hunter's level already reaches (a chain issued at
 * level 10) is completed in the same write (`stepsReached`).
 */
function landChain(p: PayloadOf<'chain'>, hids: string[], app: ApplyDeps): Land {
  return save => {
    const day = { at: app.now(), today: app.today(), R: app.rules() }, at = day.at;
    return forEach(save, hids, (s, h) => {
      const c = chainStep(s, h.id, (next): ChainEvent => (p.kind === 'issue' ? { type: 'issued', id: next('jc'), job: p.job, questId: next('q'), level: h.level, at }
        : p.kind === 'reissue' ? { type: 'reissued', by: 'gm', questId: next('q'), level: h.level, at } : { type: 'abandoned', by: 'gm' }), day);
      if (isRefused(c)) return { save: s, tell: nothing };
      const r = c;
      return { save: c.save, tell: () => {
        if (p.kind === 'issue') app.system({ tag: '! Job Change', title: 'JOB CHANGE QUEST', kind: 'quest', body: `The GM has started your Job Change: ${p.job}. Step 1 is in your Quests.` });
        else app.toast('! Quest', p.kind === 'reissue' ? `The GM reissued your Job Change step (${p.job}).` : `The GM abandoned your Job Change (${p.job}).`);
        if (r.done.length) app.stepsDone(h.id, r.done);
      } };
    });
  };
}

/** The phone's quest popup: goal, objectives, rewards, penalty and due time (ui.system escapes the text). */
function questWindow(R: Rules, q: QuestOffer): { lines: string[]; rewards: string[] } {
  const rw = q.rewards, lines: string[] = [], rewards: string[] = [];
  if (q.desc) lines.push(`GOAL: ${q.desc}`);
  for (const o of q.objectives) lines.push(`OBJECTIVE: ${o.label}${o.target > 1 ? ` (0/${o.target})` : ''}`);
  rewards.push(...rewardLines(R, rw));
  if (q.penaltyText) lines.push(`PENALTY FOR FAILURE: ${q.penaltyText}`);
  if (q.dueAt) lines.push(`DUE: ${new Date(q.dueAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`);
  return { lines, rewards };
}

/** The ids of this phone's hunters an event is for. No `to` (a System window to everyone) means all of them. */
export function targets(to: readonly SheetKey[] | undefined, device: string, mine: readonly string[]): string[] {
  if (!to) return [...mine];
  return to.filter(k => deviceOf(k) === device).map(hunterIdOf).filter(id => mine.includes(id));
}

/** What an event does on this phone: a change to write with its id (`land`), something to do with no write of its own here (`act`), or nothing. */
type Doing = { kind: 'land'; land: Land } | { kind: 'act'; act: () => void } | null;
function doingOf(ev: RoomEvent, save: Save, app: ApplyDeps): Doing {
  const applier = APPLIERS[ev.type] as Applier<EventType> | null;
  if (!applier) return null;
  const to = 'to' in ev.payload ? ev.payload.to : undefined;
  const hids = targets(to, save.settings.deviceId, save.hunters.map(h => h.id));
  if (!hids.length) return null;
  // APPLIERS pairs each type with the applier of its own payload.
  const payload = ev.payload as PayloadOf<EventType>;
  return 'apply' in applier ? { kind: 'act', act: () => applier.apply(payload, hids, app) } : { kind: 'land', land: applier.land(payload, hids, app) };
}

/**
 * Applies a parsed event on a player's phone, for this phone's hunters it names. An event that changes a hunter is
 * written with its id in one write the first time only, and its player is told only when it was written.
 */
export function applyRoomEvent(ev: RoomEvent, app: ApplyDeps): void {
  const doing = doingOf(ev, app.store.get(), app);
  if (!doing) return;
  if (doing.kind === 'act') { doing.act(); return; }
  const land = doing.land;
  let tell: (() => void) | null = null;
  const wrote = app.once(ev.payload.eid, save => { const r = land(save); if (isRefused(r)) return r; tell = r.tell; return r.save; });
  if (wrote && tell) (tell as () => void)();
}

/** What a page of the room did to a save: the save, the events now held, the ones held for the first time, and what to tell once the save is written, in the room's order. */
export type PageLanded = { save: Save; held: RoomEvent[]; fresh: RoomEvent[]; tells: (() => void)[] };
/**
 * A page of the room's events on a player's phone, as one change to `save`: the events held from earlier pages
 * (src/core/applied.ts `hold`) and then the page's, each landed with its id (`appliedOnce`) on the save the one before
 * left, so sync.ts writes the whole page and its cursor in one write: a reload finds all of a page's lands with its
 * cursor, or none and the page is read again. An event whose applier throws is held, so the cursor may move past it, and
 * it is tried again with the next page; a throw is warned each time. A held event that a newer one stands in for
 * (`replaced`: a later total for the same hunter) leaves untried, so it never lands after the newer one. Nothing is
 * told here: `tells` run after the write. `appOf` gives each event of the page the app it tells through (`awayDeps` for
 * one sent while this phone was out of the room); a held event tells through `app`.
 */
export function landAll(save: Save, held: readonly RoomEvent[], events: readonly RoomEvent[], app: ApplyDeps, appOf: (ev: RoomEvent) => ApplyDeps = () => app): PageLanded {
  const tried = events.reduce(replaced, [...held]);
  const out: PageLanded = { save, held: [...tried], fresh: [], tells: [] };
  for (const ev of [...tried, ...events]) {
    const again = tried.includes(ev);
    if (!again) out.held = replaced(out.held, ev);
    try {
      const doing = doingOf(ev, out.save, again ? app : appOf(ev));
      if (doing?.kind === 'act') out.tells.push(doing.act);
      if (doing?.kind === 'land') {
        let tell: (() => void) | null = null;
        const land = doing.land, next = appliedOnce(ev.payload.eid, s => { const r = land(s); if (isRefused(r)) return r; tell = r.tell; return r.save; })(out.save);
        if (!isRefused(next)) { out.save = next; if (tell) out.tells.push(tell); }
      }
      if (again) out.held = unhold(out.held, ev.payload.eid);
    } catch (e) {
      console.warn(`[sync] the ${ev.type} event ${ev.payload.eid} could not be applied${again ? ' again' : ''}; it is kept and tried with the next page:`, e instanceof Error ? e.message : e);
      if (!again) { out.held = hold(out.held, ev); out.fresh.push(ev); }
    }
  }
  return out;
}

/** The first word of a window's tag, as a line names it: "! Quest" is "Quest". */
const tagWord = (tag: string): string => tag.replace(/^!\s*/, '');
/**
 * A window as one line: its tag's word, its title, its body and lines. A title in the System's upper case ("REWARD
 * RECEIVED") is the window's voice, kept to a window's title, so a line leaves it out: "Reward: +10 gold". A title of
 * other words (a quest's name, the GM's own) is what the line is about, so it stays.
 */
function lineOf(tag: string, title: string, rest: readonly string[]): string {
  const said = rest.filter(Boolean), voice = title === title.toUpperCase();
  return voice ? `${tagWord(tag)}: ${said.join('. ')}` : [`${tagWord(tag)}: ${title}`, ...said].join('. ');
}
/**
 * The app a message tells through when it was sent while this phone was out of the room: each window and toast becomes
 * one line of `lines`, which sync.ts shows in one window after the page is written, in place of a window a message.
 * Whatever a tell does besides telling stays: a grant's level-up and Job Change steps (`granted` without its own
 * window), a coin's landing, the toast that the GM's fight holds a hunter.
 */
export function awayDeps(app: ApplyDeps, lines: string[]): ApplyDeps {
  return {
    store: app.store, once: app.once, rules: app.rules, now: app.now, today: app.today, stepsDone: app.stepsDone, coinRuled: app.coinRuled,
    toast: (_tag, text) => { lines.push(text); },
    system: w => { lines.push(lineOf(w.tag, w.title, [w.body ?? '', ...(w.lines ?? []), ...(w.rewards ?? [])])); },
    hunter: {
      fightOf: target => app.hunter.fightOf(target), gmHolds: () => app.hunter.gmHolds(),
      granted: (hid, g, opts) => {
        const r = app.hunter.granted(hid, g, { ...opts, popup: false });
        lines.push(lineOf(opts?.tag ?? '! Reward', opts?.title ?? 'REWARDS ACQUIRED', r.lines));
        return r;
      },
    },
  };
}

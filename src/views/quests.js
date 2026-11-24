// quests.js (U03): quest kinds, objectives, daily reset engine, penalty zone, job change, urgent auto-fail.
import { dueAt as dueIn, nextReset } from '../edge/rules.ts';
import { canDeleteQuest } from '../core/hunter/penalty.ts';
import { CHAIN_WORDS, canReissue } from '../core/hunter/job-chain.ts';
import { COMPLETER, completerOf, mayChangeQuest, reportsProgress, systemCounts } from '../core/hunter/quest-rights.ts';
import { SECRET_WORDS } from '../core/hunter/quest-secret.ts';
import { pickables, pickedRef } from '../core/party.ts';
import { JOB_NAMES, isJobName } from '../core/registry/jobs.ts';
import { isEmptyReward, newRewards, rewardLines as linesOf } from '../core/rewards.ts';
import { PENDING_WORDS, rewardWaits } from '../core/hunter/pending.ts';
import { atHunter } from '../core/save-step.ts';
import { objectivesSum, questUpdateSaid, told } from '../core/session-log.ts';
import { chained, completeQuest, deleteQuest as questDeleted, editQuest, issueQuest, nextWake, overdue, questNews, questOffer, questTold, reopenQuest, rolloverDue, rolloverRetry, setProgress as progressSet, tracked as penalizable, withTold } from '../core/hunter/quests.ts';
import { fillTo } from './motion.ts';
import { QUEST_FORM_CLOSED, questFormStep } from '../core/hunter/quest-form.ts';
import { compareTimes, stepTime } from '../core/day.ts';
import { STREAK_BONUS_POINTS, chainStep, finishQuest, questFailed, rolledOver } from '../core/hunter/grant.ts';
import { sent } from '../core/award.ts';
import { isRefused, refuse } from '../core/save-step.ts';
import { postNews } from '../core/sync/connection.ts';
import { COUNTED_WORDS, FAIL_WORDS, KIND_LABEL, questFields, questFieldsCss } from './quest-fields.js';

const TABS = [['active', 'Active'], ['daily', 'Daily'], ['done', 'Completed'], ['failed', 'Failed']];
/** What Reopen says of a failed quest it may not reopen as it is (quests.ts `reopenQuest`). */
const REOPEN_WORDS = { pastDue: 'Set a new due time first.' };

const STYLE = `
.q-top{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:10px}
.q-tabs{flex:1 1 auto}
.q-tabs button{white-space:nowrap}
.q-tabs .n{font-family:var(--font-mono);font-size:12px;margin-left:5px;color:var(--muted)}
.q-tabs button[aria-selected=true] .n{color:inherit}
.q-reset{font-family:var(--font-mono);color:var(--cyan);font-size:14px;margin:0 0 10px}
.qc{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-width:0}
.qc.done{border-color:rgba(89,230,168,.35)}
.qc.failed{border-color:rgba(255,77,94,.4)}
.qc.kind-penalty{border-color:rgba(255,77,94,.5)}
.qc.kind-urgent{border-color:rgba(255,201,77,.5)}
.qc-head{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}
.qc-title{margin:0;font-size:16px;font-weight:600;flex:1 1 140px;min-width:0;overflow-wrap:anywhere}
.qc.done .qc-title{text-decoration:line-through;opacity:.7}
.qk{font-size:12px;letter-spacing:.14em;text-transform:uppercase;padding:2px 7px;border:1px solid var(--line-bright);color:var(--cyan);white-space:nowrap}
.qk.k-daily{color:#59e6a8;border-color:rgba(89,230,168,.5)}
.qk.k-penalty{color:var(--red);border-color:rgba(255,77,94,.6)}
.qk.k-urgent{color:var(--gold);border-color:rgba(255,201,77,.6)}
.qk.k-job{color:#c79bff;border-color:rgba(199,155,255,.6)}
.qk.k-main{color:#fff;border-color:#9fb6c9}
.qk.qs{color:#c79bff;border-style:dashed;border-color:rgba(199,155,255,.6)}
.qc-secret{margin:0;font-size:13px;color:#c79bff;overflow-wrap:anywhere}
.qc-st{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.qc-desc{margin:0;color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.qo{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;align-items:center}
.qo-l{font-size:14px;overflow-wrap:anywhere}
.qo-c{display:flex;gap:4px;align-items:center;justify-content:flex-end}
.qo-c button{padding:0 8px}
.qo-c .qo-v{font-family:var(--font-mono);min-width:72px}
.qo-bar{grid-column:1/-1;height:6px;background:rgba(6,14,26,.9);border:1px solid var(--line)}
.qo-bar i{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(var(--f,0));background:var(--cyan);box-shadow:0 0 8px rgba(77,216,255,.5)}
.qo.full .qo-bar i{background:#59e6a8}
.qr{display:flex;gap:6px;flex-wrap:wrap}
.qr span{font-family:var(--font-mono);font-size:13px;color:var(--gold);border:1px solid rgba(255,201,77,.35);padding:1px 7px}
.qdue{font-size:13px;color:var(--gold)}
.qdue.over{color:var(--red)}
.qa{display:flex;gap:6px;flex-wrap:wrap}
.qa button{flex:1 1 auto}
.qf{margin-top:12px;display:flex;flex-direction:column;gap:10px}
.qf[hidden]{display:none}
@media (min-width:1100px){
  .qf .qfx{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px;align-items:start}
  .qf .dlg-actions button{min-width:120px}
}
@media (min-width:1500px){.qk,.qc-st,.qf legend,.qb h4,.pq .st{font-size:13px}}
.qf fieldset{border:1px solid var(--line);padding:8px 10px;margin:0;min-width:0}
.qf legend{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan-dim);padding:0 4px}
.qf .chk{display:inline-flex;align-items:center;gap:6px;margin-right:12px;min-height:40px}
.qf-err{color:var(--red);font-size:13px;min-height:1em}
.qf .recips{display:flex;flex-wrap:wrap;gap:0 4px;align-items:center}
.qb{border-left:2px solid var(--line-bright);padding:2px 0 2px 10px;display:flex;flex-direction:column;gap:4px;min-width:0}
.qb.pen{border-left-color:rgba(255,77,94,.7)}
.qb h4{margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan-dim)}
.qb.pen h4{color:var(--red)}
.qb p{margin:0;font-size:14px;overflow-wrap:anywhere}
.pq{margin-top:14px}
.pq h3{margin:0 0 8px;font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)}
.pq ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.pq li{border:1px solid var(--line);background:rgba(10,26,46,.45);padding:8px 10px;font-size:14px;overflow-wrap:anywhere;display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between}
.pq li.done{border-color:rgba(89,230,168,.35)}
.pq li.failed{border-color:rgba(255,77,94,.4)}
.pq .who{color:var(--cyan)}
.pq .sec{color:#c79bff}
.pq .st{font-family:var(--font-mono);font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
@media (pointer:coarse),(max-width:720px){.qf .chk{min-height:44px}}
`;

const iso = () => new Date().toISOString();
const pad = n => String(n).padStart(2, '0');
const hms = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`; };

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const resetHour = () => store.get().settings.dailyResetHour;
  /** When a quest step writes its log lines, and how many lines the log keeps. */
  const stamp = () => ({ at: iso(), cap: app.rules().logCap });
  /** A quests.ts step on hunter `hid` with its log lines, in one write (`withTold`). Answers what the step answered, or its refusal. */
  function questApply(reason, hid, f) {
    let out = null;
    const r = store.apply(reason, s => withTold(s, hid, stamp(), h => { const t = f(h); if (!('ok' in t)) out = t; return t; }));
    return 'why' in r ? r : out;
  }
  const rewardLines = r => linesOf(app.rules(), r);

  // ── public API ──
  const api = app.api.quests = {
    issue(hids, partial = {}) {
      const at = iso(), to = (hids || []).filter(hid => store.hunter(hid)).map(hid => ({ hid, id: store.id('q') }));
      if (!to.length || !ui.wrote('! Quest', store.apply('quest-issue', s => to.reduce((x, { hid, id }) => { const n = withTold(x, hid, stamp(), h => issueQuest(h, partial, id, at)); return 'ok' in n ? x : n; }, s)))) return [];
      return to.map(x => x.id);
    },
    /** Starts a Job Change chain (a job in src/core/registry/jobs.ts). Answers step 1's quest id, or the refusal whole. */
    issueJobChain(hid, job) {
      const h = store.hunter(hid); if (!h) return refuse('no-hunter');
      if (!isJobName(job)) return refuse('no-job');
      let questId = null;
      const w = chainEvent(hid, next => { const id = next('jc'); questId = next('q'); return { type: 'issued', id, job, questId, level: h.level, at: iso() }; });
      return isRefused(w) ? w : { ok: /** @type {const} */ (true), questId };
    },
    complete: (hid, qid) => complete(hid, qid),
    /** The windows of Job Change steps a step completed in its own write (src/core/hunter/grant.ts `stepsReached`). */
    stepsDone(hid, done) {
      for (const { quest, job } of done) {
        app.emit('quest:done', { hunterId: hid, quest });
        ui.system({ tag: '! Quest', kind: 'quest', ...(job ? { title: 'JOB CHANGE COMPLETE', body: `You are now a ${job}.` } : { title: 'QUEST COMPLETE', body: quest.title }),
          lines: [], rewards: job ? [`Job: ${job}`] : [] });
      }
    },
    fields: (box, o) => questFields(app, box, o),
  };

  // ── Job Change chain (src/core/hunter/job-chain.ts) ──
  /**
   * A chain event (made with the save's next ids) and the step quests it completes (a level step already reached), in
   * one write (src/core/hunter/grant.ts `chainStep`); then those steps' windows. Answers the write's Applied whole, for
   * the caller's `ui.wrote` with `CHAIN_WORDS`.
   * @param {string} hid @param {(next: <P extends string>(prefix: P) => import('../core/ids.ts').IdOf<P>) => import('../core/hunter/job-chain.ts').ChainEvent} make
   */
  function chainEvent(hid, make) {
    const day = { ...stepTime(store.get(), new Date()), R: app.rules() }, out = chainStep(store.get(), hid, make, day);
    if (isRefused(out)) return out;
    const w = store.apply('job-chain', s => { const r = chainStep(s, hid, make, day); return isRefused(r) ? r : r.save; });
    if (isRefused(w)) return w;
    api.stepsDone(hid, out.done);
    return w;
  }

  /** The GM issues a Job Change chain to a hunter on this phone, or to a player's (the `chain` message: the chain runs on that phone). */
  async function pickChain() {
    const hs = store.get().hunters, rem = remotes();
    const hid = hs.length === 1 && !rem.length ? hs[0].id : await ui.system({ tag: '! Job Change', title: 'Issue to…', body: 'Choose the hunter.', layout: 'list',
      actions: [...hs.map(x => ({ label: `${x.name} (Lv ${x.level})`, value: x.id })), ...rem.map(r => ({ label: `${r.name} (player)`, value: r.key })),
        { label: 'Cancel', value: null, cancel: true }] });
    if (!hid) return;
    const job = await ui.system({ tag: '! Job Change', title: 'Choose the job', body: 'Granted when the final step is complete.', layout: 'list',
      actions: [...JOB_NAMES.map(j => ({ label: j, value: j })), { label: 'Cancel', value: null, cancel: true }] });
    if (!job) return;
    const ref = pickedRef(pickables(hs, rem.map(r => ({ key: r.key, data: { name: r.name } }))), hid);
    if (ref && ref.kind === 'remote') return sendChain(ref.remote, job, 'issue');
    if (ui.wrote('! Quest', api.issueJobChain(hid, job), CHAIN_WORDS)) ui.toast('! Quest', `Job Change quest issued (${job}).`);
  }
  /** The `chain` message to a player's hunter. Their phone's chain machine decides; the GM sees the result in the party quests. */
  async function sendChain(key, job, kind) {
    const S = app.api.sync, r = S.post(S.event('chain', { to: [key], job, kind })), news = postNews(r, S.conn());
    const sentMsg = kind === 'issue' ? `Job Change quest sent (${job}).` : kind === 'reissue' ? `Job Change reissue sent (${job}).` : `Job Change abandoned (${job}).`;
    const waitMsg = kind === 'issue' ? `Saved. Job Change quest (${job}) will send once the room server confirms it.` : kind === 'reissue' ? `Saved. Job Change reissue (${job}) will send once the room server confirms it.` : `Saved. Job Change abandon request (${job}) will send once the room server confirms it.`;
    const ok = news === 'sent' || news === 'waits';
    ui.toast(ok ? '! Quest' : 'Quest', news === 'sent' ? sentMsg : news === 'waits' ? waitMsg
      : news === 'noRoom' ? 'Not in a room. Nothing was sent.' : 'The room server rejected this Job Change.', { kind: ok ? 'info' : 'warning' });
  }

  // ── player→GM progress (questUpdate, only for from:'gm' quests, only on a player device in a room) ──
  /**
   * The progress post of quest `q` of hunter `hid` at `status` (a quest the GM issued, on a player's phone in a room:
   * `reportsProgress`), under its key so a newer one replaces one waiting; null when there is none to send.
   * @returns {import('../core/award.ts').Keyed | null}
   */
  function progressPost(hid, q, status) {
    if (!reportsProgress(q, app.seat())) return null;
    const h = store.hunter(hid), S = app.api.sync; if (!h) return null;
    // the room's reader (protocol.ts) cuts each field to its bound: the view sends the quest as it is
    const event = S.event('questUpdate', { by: S.myKey(hid), name: h.name, questId: q.id, title: q.title, kind: q.kind, status,
      objectives: q.objectives.map(o => ({ label: o.label, progress: o.progress, target: o.target })), secret: q.secret });
    return event ? { key: `quest ${hid} ${q.id}`, event } : null;
  }
  /**
   * The quest as it is now goes to the outbox, keyed by the hunter and the quest: a newer progress takes the place of one
   * still waiting there, so a run of taps is one message and the GM gets the last.
   */
  function sendUpdate(hid, q, status) {
    const p = progressPost(hid, q, status); if (!p) return;
    app.api.sync.post(p.event, { key: p.key });
  }

  // ── GM device: questUpdate events from players ──
  app.on('sync:event', ({ event: ev }) => { // the payload is as parseEvent (src/core/protocol.ts) bounded it
    if (!app.isGM() || ev.type !== 'questUpdate') return;
    const p = ev.payload, st = p.status, line = questUpdateSaid(p), msg = line.text;
    const write = d => told(d, stamp(), line);
    // a quest's end is written once per event id (the applied ring, as a told use is), so a repeated post or a restored
    // backup does not log it twice; a progress tick keeps to the poll cursor, so it does not crowd the ring
    if (st === 'done' || st === 'failed') { if (!app.api.sync.once(p.eid, write)) return; }
    else if (!store.apply('quest-update', s => told(s, stamp(), line)).ok) return; // a read-only tab's banner says why
    ui.toast(st === 'failed' ? 'Quest' : '! Quest', msg, { kind: st === 'failed' ? 'warning' : 'info' });
  });

  const role = () => (app.isGM() ? 'gm' : 'player');
  /** May this phone edit or delete `q` (src/core/hunter/quest-rights.ts). */
  const mayChange = q => mayChangeQuest(q, app.seat());
  /** Deletes a quest unless the penalty model refuses it (a player's phone deleting the quest a penalty is tied to). */
  function deleteQuest(hid, qid) {
    const h = store.hunter(hid), q = h && h.quests.find(x => x.id === qid); if (!q || !mayChange(q)) return false;
    const r = questApply('quest-del', hid, x => questDeleted(x, qid, role()));
    return !!r && !('why' in r);
  }

  // ── completion ──
  /**
   * Hunter `hid` completes quest `qid`: the quest done, the chain's steps, the reward, the streak's bonus,
   * with the GM's progress post and what this phone's fight holds of it, in one write (src/core/hunter/grant.ts
   * `finishQuest`, hunter.js `grantWrite`). Then what the write answered is shown: the window lists what the reward gave
   * (`hunter.granted`); the Job Change steps it completed open their windows.
   */
  async function complete(hid, qid) {
    const h = store.hunter(hid), q = h && h.quests.find(x => x.id === qid);
    if (!q || q.status !== 'active') return false;
    const day = { ...stepTime(store.get(), new Date()), R: app.rules(), vitals: /** @type {import('../core/hunter/grant.ts').VitalsAt} */ (app.api.hunter.fightOf({ hid }) ? 'fight' : 'sheet') };
    const post = progressPost(hid, { ...q, status: 'done', objectives: q.objectives.map(o => ({ ...o, progress: o.target })) }, 'done'), code = app.api.sync.room();
    // one write: the quest, its reward and the GM's post, with what this phone's fight holds (the reward's statuses or a
    // level-up's refill) on the hunter's row (hunter.grantWrite)
    const out = app.api.hunter.grantWrite('quest-done', s => {
      const r = finishQuest(s, hid, qid, { ...day, by: 'hand' });
      if (isRefused(r)) return r;
      const fight = r.granted.fight;
      return { ...r, granted: { ...r.granted, fight }, save: sent(r.save, { room: code, events: post ? [post] : [], said: [] }, { at: day.at, cap: day.R.logCap }), held: [{ who: { hid }, ...fight }] };
    });
    // the fight's own refusal of a part it holds was told by the fight (combat.js `command`), and answers `TOLD`
    if (isRefused(out)) { ui.wrote('! Quest', out, { belowLevel: `Reach Level ${q.objectives[0] ? q.objectives[0].target : ''} first.` }); return false; }
    if (post) app.api.sync.flush();
    app.emit('quest:done', { hunterId: hid, quest: q });
    const { completed: c, granted: g, job } = out;
    const lines = [...g.lines, ...(job && !g.lines.includes(`Job: ${job}`) ? [`Job: ${job}`] : [])];
    const popup = c.allDaily ? { title: 'DAILY QUEST COMPLETE', body: q.title }
      : job ? { title: 'JOB CHANGE COMPLETE', body: `You are now a ${job}.` }
      : c.lifted ? { title: 'PENALTY ZONE CLEARED', body: 'The penalty has been lifted.' }
      : { title: q.kind === 'urgent' ? 'URGENT QUEST COMPLETE' : 'QUEST COMPLETE', body: q.title };
    const extra = c.streak ? [`Streak: ${c.streak} day${c.streak === 1 ? '' : 's'}${c.bonus ? ` (+${STREAK_BONUS_POINTS} bonus point${STREAK_BONUS_POINTS === 1 ? '' : 's'})` : ''}`] : [];
    ui.system({ tag: '! Quest', kind: 'quest', ...popup, lines: extra, rewards: lines });
    app.api.hunter.granted(hid, g, { popup: false });
    api.stepsDone(hid, out.done.filter(d => !g.done.includes(d)));
    return true;
  }

  /**
   * Hunter `hid` fails quest `qid`: the quest failed, its chain told and what failing costs given, with what this phone's
   * fight holds of the cost on the hunter's row, in one write (grant.ts `questFailed`, hunter.js `grantWrite`); then the
   * GM's progress post and the cost's window when it gave anything.
   */
  function fail(hid, qid) {
    const h = store.hunter(hid), q = h && h.quests.find(x => x.id === qid);
    if (!q || q.status !== 'active') return false;
    const day = { ...stepTime(store.get(), new Date()), R: app.rules(), vitals: /** @type {import('../core/hunter/grant.ts').VitalsAt} */ (app.api.hunter.fightOf({ hid }) ? 'fight' : 'sheet') };
    const out = app.api.hunter.grantWrite('quest-fail', s => {
      const r = questFailed(s, hid, qid, day);
      return isRefused(r) ? r : { ...r, held: [{ who: { hid }, ...r.granted.fight }] };
    });
    if (isRefused(out)) { ui.wrote('! Quest', out); return false; }
    sendUpdate(h.id, q, 'failed');
    if (out.granted.lines.length) ui.warn({ tag: 'Quest failed', title: 'Quest failed', body: q.title, lines: out.granted.lines });
    app.api.hunter.granted(hid, out.granted, { popup: false });
    return true;
  }

  // ── a quest the System completed (feature 1's notes 17.14): its window, until answered (quests.ts `questNews`, `questTold`) ──
  /** The quests asked of the player and not answered yet, by hunter and quest, so a second change does not queue a second window. */
  const telling = new Set();
  function tellDone() {
    if (store.readOnly) return;
    const s = store.get(), many = s.hunters.length > 1;
    for (const h of s.hunters) for (const q of questNews(h)) {
      const id = `${h.id}|${q.id}`;
      if (telling.has(id)) continue;
      telling.add(id);
      app.emit('quest:done', { hunterId: h.id, quest: q });
      // in a room the System's completion pays nothing by itself: the reward waits for the GM (ruling 20, hunter/pending.ts)
      const lines = rewardWaits(app.seat()) && !isEmptyReward(q.rewards) ? [PENDING_WORDS.waits] : rewardLines(q.rewards);
      void ui.system({ tag: '! Quest', kind: 'quest', title: q.kind === 'urgent' ? 'URGENT QUEST COMPLETE' : 'QUEST COMPLETE', body: `${many ? `${h.name}: ` : ''}${q.title}`, rewards: lines })
        .then(() => { telling.delete(id); ui.wrote('! Quest', store.apply('quest-told', atHunter(h.id, x => questTold(x, q.id)))); });
    }
  }
  // after the task that wrote, as a feat's window is (feats.js)
  store.subscribe(() => queueMicrotask(tellDone));
  app.on('ready', tellDone);

  // ── daily engine (§D) ──
  // a GM device holds NPCs and pre-made sheets nobody trains with: no penalty until that hunter has completed a daily once
  const tracked = h => penalizable(h, app.isGM());
  // the one clock of the rollover and the System's personal gates: a timer set for the next moment either has something
  // to do (nextWake in quests.ts), set
  // again after every change of the save and when the page is shown
  let wake = 0;
  /** The one timer set for `at` (ms), or for nextWake when not given. */
  function arm(at) {
    clearTimeout(wake);
    if (store.readOnly) return;
    const now = new Date();
    wake = setTimeout(checkDaily, (at ?? nextWake(store.get(), now, resetHour(), { personal: app.rules().solo.personal, gm: app.isGM() })) - now.getTime());
  }
  /**
   * The rollover and what each overdue quest costs, with what this phone's fight holds of a cost on its row, in one write
   * (grant.ts `rolledOver`); then its windows, from what the saved write answered. A refused write shows nothing, as
   * nothing of it was saved, and is tried again (`rolloverRetry`).
   */
  function checkDaily() {
    if (store.readOnly) return;
    // the one timer also wakes for the System's clock (nextWake's term `soloWake`): personal gates open and close first
    app.api.gates.tick();
    const now = new Date(), key = stepTime(store.get(), now).today, nowMs = now.getTime();
    if (!rolloverDue(store.get(), key, nowMs)) { arm(); return; }
    const room = app.seat() === 'player' ? app.api.sync.room() : null;
    const out = app.api.hunter.grantWrite('daily-check', s => {
      const r = rolledOver(s, { today: key, at: now.toISOString(), nowMs, gm: app.isGM(), R: app.rules(), vitals: hid => (app.api.hunter.fightOf({ hid }) ? 'fight' : 'sheet'), room });
      return { ...r, save: told(r.save, stamp(), ...r.said), held: r.failed.map(f => ({ who: { hid: f.hid }, ...f.granted.fight })) };
    });
    if (isRefused(out)) { arm(rolloverRetry(now)); return; }
    const many = store.get().hunters.length > 1;
    for (const p of out.penalties) {
      ui.warn({ tag: 'Penalty Zone', kind: 'penalty', title: 'Penalty',
        body: `${many ? `${p.name}: ` : ''}You have failed to complete the Daily Quest. You will be transported to the Penalty Zone.`,
        lines: [...(p.days > 1 ? [`Days missed: ${p.days}`] : []), 'Streak reset to 0', `Penalized: -${app.rules().penaltyCheck} to all checks until the Penalty Zone is cleared`] });
    }
    for (const f of out.failed) {
      ui.warn({ tag: 'Quest expired', title: 'Quest failed', body: `${many ? `${f.name}: ` : ''}${f.title}: the time limit has expired.`, ...(f.granted.lines.length ? { lines: f.granted.lines } : {}) });
      app.api.hunter.granted(f.hid, f.granted, { popup: false });
    }
  }

  // ── view ──
  ui.css('quests', STYLE);
  questFieldsCss(ui.css);
  let tab = 'active', form = QUEST_FORM_CLOSED;
  /** What each objective's bar showed last, by quest id and objective. */
  const barsWas = new Map();

  const objHtml = (q, i, o, counted) => {
    const f = Math.min(1, o.progress / o.target), live = q.status === 'active' && !counted && !o.count;
    return `<div class="qo${o.progress >= o.target ? ' full' : ''}"><span class="qo-l">${esc(o.label)}${o.count ? ` <span class="qo-by" data-counted>${esc(COUNTED_WORDS.card)}</span>` : ''}</span>
      <span class="qo-c">${live ? `<button type="button" data-od="${esc(q.id)}" data-i="${i}" aria-label="Decrease ${esc(o.label)}">&minus;</button>
        <button type="button" class="qo-v" data-os="${esc(q.id)}" data-i="${i}" aria-label="Set progress for ${esc(o.label)}">${esc(o.progress)}/${esc(o.target)}</button>
        <button type="button" data-oi="${esc(q.id)}" data-i="${i}" aria-label="Increase ${esc(o.label)}">+</button>` : `<span class="qo-v">${esc(o.progress)}/${esc(o.target)}</span>`}</span>
      <div class="qo-bar" role="progressbar" aria-label="${esc(o.label)} progress" aria-valuemin="0" aria-valuemax="${esc(o.target)}" aria-valuenow="${esc(o.progress)}" data-qbar="${esc(q.id)}:${i}" data-f="${f}"><i style="--f:${f}"></i></div></div>`;
  };
  const cardHtml = (q, gm, h) => {
    const rw = rewardLines(q.rewards), cost = rewardLines(q.onFail), live = q.status === 'active';
    const due = q.dueAt ? `<div class="qdue${overdue(q, Date.now()) ? ' over' : ''}">Due ${esc(new Date(q.dueAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</div>` : '';
    const st = q.status === 'done' ? 'Done' : q.status === 'failed' ? 'Failed' : '';
    const id = esc(q.id), blocks = q.from === 'gm', lock = !mayChange(q), counted = systemCounts(q, h.jobChain);
    const del = !lock && canDeleteQuest(h.penalty, q.id, role());
    return `<li class="qc kind-${esc(q.kind)} ${esc(q.status)}${q.status === 'done' ? ' done' : ''}" data-qid="${id}" data-st="${esc(q.status)}">
      <div class="qc-head"><span class="qk k-${esc(q.kind)}">${esc(KIND_LABEL[q.kind] || q.kind)}</span>${q.secret ? `<span class="qk qs" data-secret>${esc(SECRET_WORDS.chip)}</span>` : ''}<h3 class="qc-title">${esc(q.title)}</h3>${st ? `<span class="qc-st">${st}</span>` : ''}</div>
      ${q.secret ? `<p class="qc-secret">${esc(SECRET_WORDS.line)}</p>` : ''}
      ${blocks ? `${q.desc ? `<div class="qb"><h4>Goal</h4><p>${esc(q.desc)}</p></div>` : ''}
        ${q.objectives.length ? `<div class="qb"><h4>Objectives</h4>${q.objectives.map((o, i) => objHtml(q, i, o, counted)).join('')}</div>` : ''}
        ${due}${rw.length ? `<div class="qb"><h4>Reward</h4><div class="qr" aria-label="Rewards">${rw.map(r => `<span>${esc(r)}</span>`).join('')}</div></div>` : ''}
        ${cost.length ? `<div class="qb pen" data-onfail><h4>${esc(FAIL_WORDS.legend)}</h4><div class="qr">${cost.map(r => `<span>${esc(r)}</span>`).join('')}</div></div>` : ''}
        ${q.penaltyText ? `<div class="qb pen"><h4>Penalty</h4><p>${esc(q.penaltyText)}</p></div>` : ''}` : `
      ${q.desc ? `<p class="qc-desc">${esc(q.desc)}</p>` : ''}
      ${q.objectives.map((o, i) => objHtml(q, i, o, counted)).join('')}
      ${due}${rw.length ? `<div class="qr" aria-label="Rewards">${rw.map(r => `<span>${esc(r)}</span>`).join('')}</div>` : ''}
      ${cost.length ? `<div class="qb pen" data-onfail><h4>${esc(FAIL_WORDS.legend)}</h4><div class="qr">${cost.map(r => `<span>${esc(r)}</span>`).join('')}</div></div>` : ''}
      ${q.penaltyText ? `<div class="qb pen"><h4>Penalty</h4><p>${esc(q.penaltyText)}</p></div>` : ''}`}
      <div class="qa">
        ${live ? `${COMPLETER[completerOf(q)].button ? `<button type="button" class="primary" data-done="${id}">Complete</button>` : ''}<button type="button" data-fail="${id}">Fail</button>` : ''}
        ${q.status === 'failed' && !q.chainId ? `<button type="button" data-reopen="${id}">Reopen</button>` : ''}
        ${lock ? '' : `<button type="button" data-edit="${id}">Edit</button>`}
        ${gm ? `<button type="button" data-issue="${id}">Issue to…</button>` : ''}
        ${del ? `<button type="button" class="danger" data-del="${id}" aria-label="Delete quest ${esc(q.title)}">Delete</button>` : ''}
      </div></li>`;
  };

  function tick(el) {
    const now = new Date(), left = nextReset(now, resetHour()).getTime() - now.getTime(), h = store.active();
    const cd = el.querySelector('[data-countdown]'); if (cd) cd.textContent = `Resets in ${hms(left)}`;
    const warn = el.querySelector('[data-warn]');
    const pending = tracked(h) && h.quests.some(q => q.kind === 'daily' && q.status === 'active');
    warn.hidden = !pending; warn.classList.toggle('show', pending);
    const m = Math.floor(left / 60000);
    warn.textContent = `⚠ Daily quest incomplete. Penalty in ${Math.floor(m / 60)}h ${pad(m % 60)}m`;
  }

  /**
   * The quest form moved by `ev` (src/core/hunter/quest-form.ts), shown while it is open; a form that closes is emptied.
   * @param {HTMLElement} el @param {import('../core/hunter/quest-form.ts').QuestFormEvent} ev
   */
  function formMoved(el, ev) {
    const was = form, f = el.querySelector('form[data-form]');
    form = questFormStep(form, ev);
    f.hidden = form.at === 'closed';
    if (form.at === 'closed' && was.at !== 'closed') f.reset();
  }
  /** The form opened for a new quest, or for quest `q` of the hunter on screen, for the role and hunter on screen. */
  function openForm(el, q) {
    const hid = store.active().id;
    formMoved(el, q ? { type: 'edit', role: role(), hid, qid: q.id } : { type: 'new', role: role(), hid });
    if (form.at === 'closed') return;
    const f = el.querySelector('form[data-form]'), gm = form.role === 'gm';
    f.reset();
    f.querySelector('[data-ftitle]').textContent = q ? 'Edit quest' : 'New quest';
    questForm = questFields(app, f.querySelector('[data-qfields]'), { id: 'qf', use: q ? 'edit' : 'new', role: form.role, initial: q });
    autoTitle = false;
    f.querySelector('[data-preset]').hidden = !(gm && !q);
    const who = f.querySelector('[data-who]');
    who.hidden = !(gm && !q);
    if (gm && !q) {
      const rem = remotes();
      const chk = (val, label, on, extra = '') => `<label class="chk"><input type="checkbox" name="to" value="${esc(val)}"${extra}${on ? ' checked' : ''}> ${esc(label)}</label>`;
      who.querySelector('[data-whobox]').innerHTML = (rem.length + store.get().hunters.length > 1 ? '<label class="chk"><input type="checkbox" data-all> Whole party</label>' : '')
        + store.get().hunters.map(h => chk(h.id, h.name, h.id === hid && !rem.length, ' data-local')).join('')
        + rem.map(r => chk(r.key, `${r.name} (player)`, false)).join('');
    }
    f.querySelector('.qf-err').textContent = '';
    questForm.focus();
    f.scrollIntoView({ block: 'nearest' });
  }
  let autoTitle = false;
  /** @type {import('../core/api.ts').QuestFields | null} the quest form's fields (quest-fields.js), drawn again each time it opens */
  let questForm = null;
  const remotes = () => {
    return app.api.sync.remoteSheets().filter(r => r.data && typeof r.data === 'object')
      .map(r => ({ key: r.key, name: r.data.name }));
  };
  /**
   * Save quest: the form's quest written to the hunter and with the role it was opened for. A form the screen moved under
   * (another hunter, the GM/Player switch) is closed first and saves nothing (quest-form.ts `seen`).
   */
  function submitForm(el, f) {
    formMoved(el, { type: 'seen', role: role(), hid: store.active().id });
    if (form.at === 'closed') return;
    const at = form, gm = at.role === 'gm', err = f.querySelector('.qf-err');
    const why = questForm.check();
    if (why) { err.textContent = why; return; }
    const v = questForm.value(), { kind, title, objectives } = v;
    const existing = at.at === 'editing' ? store.hunter(at.hid)?.quests.find(x => x.id === at.qid) ?? null : null;
    // a date and time typed for an urgent quest, else hours from now (the GM's new quest), else an edit keeps its due time unless it is urgent now
    const dueAt = v.dueAt ?? (v.dueHours !== null ? dueIn(v.dueHours, new Date()) : null) ?? (existing && kind !== 'urgent' ? existing.dueAt : null);
    const rewards = gm ? v.rewards : existing ? existing.rewards : newRewards();
    const penaltyText = gm ? v.penaltyText.slice(0, 300) : existing ? existing.penaltyText || '' : '';
    const onFail = gm ? v.onFail : existing ? existing.onFail : newRewards();
    const partial = { kind, title, desc: v.desc, objectives, rewards, onFail, dueAt, penaltyText };
    if (at.at === 'editing') {
      // a refused edit (the quest gone meanwhile included) keeps the form open with what was typed
      if (!ui.wrote('! Quest', store.apply('quest-edit', atHunter(at.hid, h => editQuest(h, at.qid, { kind, title, desc: partial.desc, objectives, rewards, onFail, dueAt, penaltyText }, at.role))))) return;
    } else {
      const picks = gm ? [...f.querySelectorAll('[name=to]:checked')] : [];
      const to = gm ? picks.filter(c => c.hasAttribute('data-local')).map(c => c.value) : [at.hid];
      const keys = picks.filter(c => !c.hasAttribute('data-local')).map(c => c.value);
      if (!to.length && !keys.length) { err.textContent = 'Pick at least one hunter.'; return; }
      if (to.length && !api.issue(to, { ...partial, from: gm ? 'gm' : 'self' }).length) return;
      if (keys.length) {
        const S = app.api.sync, r = S.post(S.event('quest', { to: keys, quest: questOffer(partial, dueAt) })), news = postNews(r, S.conn()), n = `${keys.length} player${keys.length === 1 ? '' : 's'}`;
        const ok = news === 'sent' || news === 'waits';
        ui.toast(ok ? '! Quest' : 'Quest', news === 'sent' ? `Quest sent to ${n}.` : news === 'waits' ? `Saved. The quest will go to ${n} once the room server confirms it.`
          : news === 'noRoom' ? 'Not in a room. Quest not sent.' : 'The room server rejected this quest.', { kind: ok ? 'info' : 'warning' });
      }
    }
    formMoved(el, { type: 'saved' });
  }

  async function setProgress(hid, qid, i, value) {
    const h = store.hunter(hid), q = h && h.quests.find(x => x.id === qid), o = q && q.objectives[i];
    if (!o || q.status !== 'active' || systemCounts(q, h.jobChain)) return;
    const was = q.objectives.every(x => x.progress >= x.target);
    if (!ui.wrote('! Quest', store.apply('quest-progress', atHunter(hid, x => progressSet(x, qid, i, value))))) return;
    // the quest as the write left it, read again: never the object read before the write
    const now = store.hunter(hid)?.quests.find(x => x.id === qid); if (!now) return;
    sendUpdate(hid, now, now.status);
    if (!was && now.objectives.every(x => x.progress >= x.target)) {
      if (await ui.confirm({ title: 'Complete quest?', body: `All objectives are complete: ${now.title}`, confirmLabel: 'Complete quest' })) complete(hid, qid);
    }
  }

  async function issueTo(qid) {
    const src = store.active().quests.find(x => x.id === qid); if (!src) return;
    const sent = new Set();
    for (;;) {
      const others = store.get().hunters.filter(x => x.id !== store.active().id);
      if (!others.length) { ui.toast('! Quest', 'There are no other hunters to issue this to.'); return; }
      const v = await ui.system({ tag: '! Issue', title: 'Issue to…', body: src.title, layout: 'list',
        actions: [...others.map(x => ({ label: `${sent.has(x.id) ? '✓ ' : ''}${x.name}`, value: x.id })), { label: 'Done', value: null, cancel: true }] });
      if (!v) return;
      if (sent.has(v)) continue;
      api.issue([v], { kind: src.kind, title: src.title, desc: src.desc, objectives: src.objectives.map(o => ({ ...o, progress: 0 })), rewards: src.rewards, dueAt: src.dueAt, from: 'gm' });
      sent.add(v);
    }
  }

  // GM: each remote player's GM quests (active, plus the 3 most recent finished), read from their synced sheets
  function renderParty(el) {
    const box = el && el.querySelector('[data-party]'); if (!box) return;
    const rows = [];
    for (const r of remotes()) {
      const sh = app.api.sync.remoteSheets().find(x => x.key === r.key), qs = (sh && Array.isArray(sh.data.quests) ? sh.data.quests : []).filter(q => q && q.from === 'gm' && typeof q.title === 'string');
      const fin = qs.filter(q => q.status !== 'active').sort((a, b) => compareTimes(b.doneAt, a.doneAt)).slice(0, 3);
      for (const q of [...qs.filter(q => q.status === 'active'), ...fin]) {
        const os = q.objectives;
        const st = q.status === 'done' ? 'done' : q.status === 'failed' ? 'failed' : 'active';
        rows.push(`<li class="${st}"><span><span class="who">${esc(r.name)}</span> · ${esc(q.title.slice(0, 120))}${q.secret ? ` <span class="sec">${esc(SECRET_WORDS.mark)}</span>` : ''}</span><span class="st">${st === 'done' ? 'Done' : st === 'failed' ? 'Failed' : os.length ? esc(objectivesSum(os)) : 'Active'}</span></li>`);
      }
      // a player's failed Job Change: the GM reissues or abandons it with the `chain` message
      const c = sh && sh.data.jobChain;
      if (c && c.status === 'failed' && isJobName(c.job)) {
        rows.push(`<li class="failed"><span><span class="who">${esc(r.name)}</span> · Job Change failed: ${esc(c.job)}, step ${esc(c.step)} of 3</span>
          <span class="qa"><button type="button" data-rchain="${esc(r.key)}" data-kind="reissue" data-job="${esc(c.job)}">Reissue</button><button type="button" class="danger" data-rchain="${esc(r.key)}" data-kind="abandon" data-job="${esc(c.job)}">Abandon</button></span></li>`);
      }
    }
    const show = app.isGM() && remotes().length > 0;
    box.hidden = !show;
    if (show) box.innerHTML = `<h3>Party quests</h3>${rows.length ? `<ul aria-label="Party quests">${rows.join('')}</ul>` : '<p class="qc-desc">No GM quests issued to players yet.</p>'}`;
  }
  let viewEl = null;
  app.on('sync:sheets', () => renderParty(viewEl));

  app.registerView({
    id: 'quests', label: 'Quests', icon: '❖', order: 20,
    mount(el) {
      viewEl = el;
      el.innerHTML = `<section class="win"><span class="cb"></span><h2>Quest Log</h2>
        <div class="warn" data-warn hidden role="status"></div>
        <div class="q-top"><div class="q-tabs seg" role="tablist" aria-label="Quest lists" data-tabs></div>
          <span><button type="button" data-chain hidden>Issue Job Change Quest</button> <button type="button" class="primary" data-new>+ New quest</button></span></div>
        <div class="qc failed" data-jobchain hidden></div>
        <p class="q-reset" data-countdown hidden></p>
        <ul class="plain" data-list></ul>
        <div class="pq" data-party hidden></div>
        <form class="qf" data-form hidden novalidate>
          <h3 class="lbl" data-ftitle>New quest</h3>
          <div data-preset hidden><button type="button" data-jobpreset>Fill Job Change preset</button></div>
          <div data-qfields></div>
          <fieldset data-who hidden><legend>Assign to</legend><div class="recips" data-whobox></div></fieldset>
          <div class="qf-err" role="alert"></div>
          <div class="dlg-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Save quest</button></div>
        </form></section>`;
      const f = el.querySelector('form[data-form]');
      f.addEventListener('input', e => {
        if (e.target.matches('[name=title]')) autoTitle = false;
        else if (autoTitle && e.target.matches('[data-rw-job]')) questForm.set({ title: `Job Change: ${e.target.value.trim()}` });
      });
      f.addEventListener('change', e => { if (e.target.matches('[data-all]')) f.querySelectorAll('[name=to]').forEach(c => { c.checked = e.target.checked; }); });
      f.addEventListener('submit', e => { e.preventDefault(); submitForm(el, f); });
      f.addEventListener('keydown', e => {
        if (ui.formEnter(e, f, () => f.requestSubmit())) return;
        // a browser submits a form on Enter in its other inputs too (the due date, a box of Assign to); here Enter never saves
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault();
      });
      el.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
        const h = store.active(), d = b.dataset, find = id => h.quests.find(x => x.id === id);
        if (b.closest('[data-tabs]')) { tab = d.tab; this.update(el); return; }
        if ('new' in d) return openForm(el, null);
        if ('chain' in d) { if (app.isGM()) pickChain(); return; }
        if (d.rchain && app.isGM() && (d.kind === 'reissue' || d.kind === 'abandon')) return sendChain(d.rchain, d.job, d.kind);
        if ('cancel' in d) { formMoved(el, { type: 'cancelled' }); return; }
        if ('jobpreset' in d) { questForm.set({ kind: 'job', title: `Job Change: ${questForm.value().rewards.job || ''}` }); autoTitle = true; questForm.rewards.ensure('job'); return; }
        if (d.edit) { const q = find(d.edit); if (q && mayChange(q)) openForm(el, q); return; }
        if (d.done) { const q = find(d.done); if (q && await ui.confirm({ title: 'Complete quest?', body: q.title, confirmLabel: 'Complete quest' })) complete(h.id, d.done); return; }
        if (d.fail) { const q = find(d.fail); if (q && await ui.confirm({ title: 'Fail quest?', body: q.title, danger: true, confirmLabel: 'Fail quest' })) fail(h.id, d.fail); return; }
        if (d.reopen) {
          const r = store.apply('quest-reopen', atHunter(h.id, x => reopenQuest(x, d.reopen, iso())));
          // a quest past its due time reopens with a new one: the form opens for it
          if (!ui.wrote('! Quest', r, REOPEN_WORDS) && 'why' in r && r.why === 'pastDue') openForm(el, find(d.reopen));
          return;
        }
        if (d.issue) return issueTo(d.issue);
        if ('reissue' in d) {
          const c = h.jobChain;
          if (c && ui.wrote('! Quest', chainEvent(h.id, next => ({ type: 'reissued', by: role(), questId: next('q'), level: h.level, at: iso() })), CHAIN_WORDS)) ui.toast('! Quest', `Job Change quest reissued (${c.job}).`);
          return;
        }
        if ('abandon' in d) {
          const c = h.jobChain;
          if (c && await ui.confirm({ title: 'Abandon the Job Change?', body: `${h.name} will not become a ${c.job}.`, danger: true, confirmLabel: 'Abandon Job Change' })) ui.wrote('! Quest', chainEvent(h.id, () => ({ type: 'abandoned', by: role() })), CHAIN_WORDS);
          return;
        }
        if (d.del) {
          const q = find(d.del), pardon = q && h.penalty && h.penalty.questId === q.id;
          if (q && await ui.confirm({ title: 'Delete quest?', body: pardon ? `${q.title}. Deleting it clears ${h.name}'s penalty.` : q.title, danger: true, confirmLabel: 'Delete quest' })) deleteQuest(h.id, q.id);
          return;
        }
        const qid = d.od || d.oi || d.os, i = Number(d.i);
        if (qid) {
          const o = find(qid) && find(qid).objectives[i]; if (!o) return;
          if (d.od) setProgress(h.id, qid, i, o.progress - 1);
          else if (d.oi) setProgress(h.id, qid, i, o.progress + 1);
          else { const n = await ui.promptNum({ title: 'Set progress', label: o.label, value: o.progress, min: 0, max: o.target }); if (n !== null) setProgress(h.id, qid, i, n); }
        }
      });
      setInterval(() => { if (el.isConnected && !el.closest('[hidden]')) tick(el); }, 1000);
    },
    update(el) {
      const h = store.active(), gm = app.isGM(), qs = h.quests;
      const sets = {
        active: qs.filter(q => q.status === 'active' && q.kind !== 'daily'),
        daily: qs.filter(q => q.kind === 'daily'),
        done: qs.filter(q => q.status === 'done' && q.kind !== 'daily'),
        failed: qs.filter(q => q.status === 'failed'),
      };
      const a = document.activeElement, keep = a && el.contains(a) && !a.closest('form') && Object.entries(a.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${CSS.escape(v)}"]`).join('');
      el.querySelector('[data-tabs]').innerHTML = TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}<span class="n">${sets[k].length}</span></button>`).join('');
      const empty = { active: 'No active quests.', daily: 'No daily quests. Tap + New quest and choose Daily to add one.', done: 'No completed quests yet.', failed: 'No failed quests.' };
      el.querySelector('[data-list]').innerHTML = sets[tab].length ? sets[tab].map(q => cardHtml(q, gm, h)).join('') : `<li class="empty">${empty[tab]}</li>`;
      // an objective's bar fills from what it showed before the list was drawn again (motion.ts `fillTo`)
      for (const b of el.querySelectorAll('[data-qbar]')) { const k = b.dataset.qbar, f = Number(b.dataset.f); void fillTo(b, f, { from: barsWas.get(k) ?? f, trail: false }); barsWas.set(k, f); }
      if (keep) { const n = el.querySelector(keep); if (n && n !== a) n.focus(); }
      el.querySelector('[data-chain]').hidden = !gm;
      const chain = h.jobChain, failedBox = el.querySelector('[data-jobchain]');
      failedBox.hidden = !canReissue(chain);
      failedBox.innerHTML = canReissue(chain) ? `<div class="qc-head"><span class="qk k-job">Job Change</span><h3 class="qc-title">Job Change failed: ${esc(chain.job)}, step ${esc(chain.step)} of 3</h3><span class="qc-st">Failed</span></div>
        <p class="qc-desc">${gm ? 'Reissue the step to let the hunter try again, or abandon the Job Change.' : 'The GM can reissue it.'}</p>
        ${gm ? '<div class="qa"><button type="button" class="primary" data-reissue>Reissue</button><button type="button" class="danger" data-abandon>Abandon</button></div>' : ''}` : '';
      el.querySelector('[data-countdown]').hidden = tab !== 'daily';
      // the form opened for another hunter or role closes (quest-form.ts `seen`)
      formMoved(el, { type: 'seen', role: gm ? 'gm' : 'player', hid: h.id });
      tick(el);
      renderParty(el);
    },
  });

  app.on('change', () => arm());
  // the first check waits for every module: the rollover asks who the GM is, which the room link answers (sync, listed later)
  app.on('ready', checkDaily);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDaily(); });
}

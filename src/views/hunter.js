// hunter.js (U02): the sheet (src/core/hunter/sheet.ts), allocation, ranks, titles, party, level-up, conditions, rests,
// app.api.hunter. It computes no number of its own: the stats, the sheet and the checks are `hunterSheet` and `checksOf`.
import { stepTime } from '../core/day.ts';
import { BONUS_KEYS, BONUS_LABELS, xpToNext, rules } from '../edge/rules.ts';
import { STAT_KEYS, STAT_LABELS, STAT_SHORT } from '../core/stats.ts';
import { SHEET_LABELS } from '../core/hunter/derive.ts';
import { fightHold, heldLines } from '../core/combat/fight-save.ts';
import { combatantId, hunterId } from '../core/combat/ability-types.ts';
import { titlePowerLines } from '../core/title-card.ts';
import { checksOf, fitted, hunterSheet, setAdjust, setMaximum, autoSpend } from '../core/hunter/sheet.ts';
import { keystoneBasis, keystoneConfirmDiff, keystoneReach, keystonesOf, nearestKeystone } from '../core/hunter/keystones.ts';
import { keystoneOf } from '../core/registry/keystones.ts';
import { AUTO_ALLOC_WORDS, JOB_NAMES, focusWeights, isJobName, jobFocus, matchingJob, parseStatFocus } from '../core/registry/jobs.ts';
import {
  KEYSTONE_WORDS, keystoneAwakenedLine, keystoneConfirmLine, keystoneNextLine, keystoneShareAria, keystoneShareText, keystoneTierLabel,
} from '../core/rules-text.ts';
import { ALLOCATION_WORDS, allocated, available, confirm, hasPending, lower, plusPoint, raise, raiseMany, setPoints, setStat } from '../core/hunter/progress.ts';
import { TOLD, atHunter, atLibrary, both, isRefused, orKeep, refuse } from '../core/save-step.ts';
import { dropBoon, giveTitle, nameActiveTitle, rankStanding, reevaluate as reevaluated, removeTitle, rename, setJob, setRank, toggleTitle, writeTitle, cleanName } from '../core/hunter/record.ts';
import { grant, levelEdit, raisedLine, sheetEdit, systemRaise } from '../core/hunter/grant.ts';
import { RAISE_REFUSED, RAISE_TITLE, canRaise, debtXpLine, raiseLine, raiseOffer, raisedSaid } from '../core/hunter/revive-standing.ts';
import { setGold } from '../core/hunter/inventory.ts';
import { setCrystal } from '../core/hunter/crystal.ts';
import { GUILD_WORDS, guildSheetLine } from '../core/hunter/guild.ts';
import { removeHunter } from '../core/party.ts';
import { logLine, logged } from '../core/session-log.ts';
import { removeBundle, saveBundle } from '../core/rewards.ts';
import { DIED_WORDS, WAYS_BACK, can, fatigueNews, hpOf, lifeNews, manaOf } from '../core/hunter/vitals.ts';
import { lifeWord } from '../core/combat/row-life.ts';
import { chipDef, chipsOf, isStateChip } from '../core/hunter/chips.ts';
import { PUT_WORDS } from '../core/hunter/conditions.ts';
import { restRefusalWords, restsLeftLine } from '../core/hunter/rests.ts';
import { oneOf } from '../core/one-of.ts';
import { gmSource } from '../core/effects.ts';
import { BUNDLE_NAME, REWARD_BOUNDS, newRewards, parseRewards, parseWords } from '../core/rewards.ts';
import { LIMITS, createHunter } from '../core/save.ts';
import * as motion from './motion.ts';
import { icon, sprite } from './icons.ts';
import { statusIcon } from '../core/registry/icon-defaults.ts';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const int = v => Math.trunc(Number(v)) || 0;
const sgn = n => (n >= 0 ? '+' : '-') + Math.abs(n);
/** The derived numbers the Derived panel shows, in its order (m2-plan section 4.4, W4). */
const SHOWN = ['speed', 'armor', 'resist', 'react', 'aim', 'will', 'manaMax', 'fatigueMax', 'carry', 'weight', 'sight'];
/** The numbers only a bonus gives, each shown on the sheet only while it is above 0: the four penetrations (rule 12), lifesteal, ability haste, heal and shield power and damage to shield. */
const FROM_BONUSES = ['armorPen', 'resistPen', 'armorPenFlat', 'resistPenFlat', 'drain', 'haste', 'healPower', 'shieldDrain'];

const CSS = `
.id-read{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.id-read[hidden]{display:none}
.id-who{flex:1;min-width:0}
.id-name{font-family:var(--font-display);font-weight:600;font-size:calc(20px*var(--ts));color:var(--ice);overflow-wrap:anywhere}
.id-sub{font-size:calc(13px*var(--ts));color:var(--cyan-dim);overflow-wrap:anywhere}
.id-guild{font-size:calc(12px*var(--ts));color:var(--cyan-dim);overflow-wrap:anywhere;margin-top:2px}
.id-read [data-idedit]{min-height:var(--control-h)}
.id-done{flex:1 1 100%;display:flex;justify-content:flex-end}
.id-done button{min-height:var(--control-h)}
.hp-amt{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:6px 0 10px}.hp-amt .field{flex:1 1 120px;min-width:0}.hp-amt input{width:100%;min-height:44px}.hp-amt button{min-height:44px;min-width:76px}.hp-amt-msg{flex:1 1 100%;margin:0;font-size:13px;color:var(--cyan-dim);min-height:0}.hp-amt-msg:empty{display:none}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.chip{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--line-bright);background:rgba(17,42,70,.6);padding:0 0 0 10px;font-size:13px;color:var(--cyan)}
.chip.warn-c{border-color:var(--red);color:#ff8a96}
.chip{min-height:40px}
.chip button{border:0;background:none;color:inherit;padding:0 10px;min-height:40px;min-width:40px}
.chip button.c-info{padding:0 6px 0 10px;text-align:left;font:inherit}
.chip .c-end{padding-right:10px}
.chip .c-ic{display:inline-flex;margin-right:5px;vertical-align:-2px}
.chip .c-ic .ic{--ic:var(--icon-chip)}
.cond-add{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-top:6px}
.cond-add .field{flex:1 1 150px}
.rest-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0 4px}
.rest-row [data-rests-left]{margin:0}
.reeval{display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:13px;color:var(--gold);text-align:right}
.reeval[hidden]{display:none}
.death{border:1px solid var(--red);background:rgba(255,77,94,.08);padding:8px 12px;margin:8px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.death[hidden]{display:none}
.death b{color:#ff8a96;letter-spacing:.12em;text-transform:uppercase;font-size:13px}
.death [data-wayback]{flex:1 1 100%;margin:0;font-size:14px;color:var(--ice)}
.stat .s-roll{display:block;width:100%;border:0;background:none;padding:2px 0;color:inherit;font:inherit;cursor:pointer;min-height:44px}
.stat .s-roll:hover{background:rgba(77,216,255,.08)}
.stat .s-roll span{display:block}
.stat .s-bonus{font-family:var(--font-mono);font-size:14px;color:var(--green);margin-left:4px;font-weight:400}
.stat .s-bonus:empty{display:none}
.stat .s-share{display:block;font-size:calc(12px*var(--ts));color:var(--cyan-dim);margin-top:2px;line-height:1.2}
.stat .s-share[hidden]{display:none}
.ap-ks{margin:6px 0 0;font-size:calc(13px*var(--ts));color:var(--gold);overflow-wrap:anywhere}
.ap-ks[hidden]{display:none}
.ks-list{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:8px}
.ks-item{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:8px 12px}
.ks-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}
.ks-name{font-weight:600;color:var(--ice)}
.ks-tier{font-size:12px;color:var(--cyan-dim)}
.ks-line{margin:4px 0 0;font-size:13px;color:var(--ice);overflow-wrap:anywhere}
.ks-awake{margin:4px 0 0;padding-left:8px;border-left:2px solid var(--gold);font-size:13px;color:var(--ice);overflow-wrap:anywhere}
.ks-next{margin:6px 0 8px;font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}
.ks-next[hidden]{display:none}
.derived{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
.dv{border:1px solid var(--line);background:rgba(10,26,46,.6);padding:6px 10px;text-align:center}
button.dv{display:block;width:100%;min-height:var(--control-h);color:inherit;font:inherit}
.derived .dt{grid-column:1/-1}
.dv .lbl{display:block;letter-spacing:.1em}
.dv b{font-family:var(--font-display);font-size:22px;color:var(--ice)}
.dv-note{margin:8px 0 0;font-size:13px;color:var(--muted)}
.dv-note.bad{color:#ff8a96}
.dv-sub{margin:12px 0 6px}
.row-li{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:8px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.row-li.on{border-color:var(--line-bright);box-shadow:0 0 10px rgba(77,216,255,.25)}
.row-li .r-main{flex:1 1 160px;min-width:0;overflow-wrap:anywhere}
.row-li .r-name{font-weight:600}
.row-li .r-sub{font-size:13px;color:var(--cyan-dim)}
.row-li .r-acts{display:flex;gap:6px;flex-wrap:wrap}
.row-li .t-powers{list-style:none;margin:4px 0 0;padding:0 0 0 8px;border-left:2px solid var(--line);font-size:13px;color:var(--muted)}
.row-li.on .t-powers{border-left-color:var(--gold);color:var(--ice)}
.tag-on{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);border:1px solid rgba(255,201,77,.5);padding:1px 7px}
.t-form{border:1px solid var(--line);padding:10px;margin-top:10px;display:grid;gap:8px}
.t-form[hidden]{display:none}
.raw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}
.af-pick{text-align:left;display:grid;gap:10px}
.af-presets{display:flex;flex-wrap:wrap;gap:6px}
.af-presets button{min-height:44px;padding:6px 10px;font-size:13px}
.af-presets button[aria-pressed=true]{border-color:var(--cyan);color:var(--cyan);background:rgba(77,216,255,.16)}
.af-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.af-fields select{width:100%;min-height:44px;box-sizing:border-box}
.af-match{margin:0;font-size:13px;color:var(--cyan-dim)}
.af-match[hidden]{display:none}
.af-pv{list-style:none;margin:0;padding:0;font-size:14px}
.af-pv li{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(27,74,110,.5)}
.af-pv .up{color:var(--green)}
@media (max-width:720px){.row-li .r-acts button{flex:1 0 auto}}
@media (pointer:coarse),(max-width:720px){.chip,.chip button{min-height:44px}.chip button{min-width:44px}}
`;

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  sprite();
  ui.css('hunter', CSS);

  const seedTitle = key => rules().titles.find(t => t.key === key) || null;
  // A status on the sheet: src/core/hunter/conditions.ts (one instance per key; a chip drawn from the state is never put on).
  const addC = (h, s) => sheetEdit(h, { type: 'put', status: s }, rules());
  const delC = (h, k) => sheetEdit(h, { type: 'drop', key: k }, rules());

  /** The hunter's numbers as its sheet shows them: src/core/hunter/sheet.ts answers each one. */
  const sheetOf = h => {
    const R = rules(), at = hunterSheet(h, R);
    return { stats: at.stats, sheet: at.sheet, hp: hpOf(h.life, at.sheet.hpMax), mana: manaOf(h, at.sheet), checks: checksOf(h, at, R) };
  };

  /** The maxima the vitals functions in src/core/hunter/vitals.ts take: the sheet's. */
  const maxima = h => hunterSheet(h, rules()).sheet;
  /** The hunter with HP, mana and fatigue brought down to the maxima its sheet now gives (sheet.ts `fitted`). */
  const fit = h => fitted(h, rules());
  /** A life event on a hunter: the hunter after it, or a refusal when it does not apply. */
  const lifeEvent = (h, event) => sheetEdit(h, { type: 'life', event }, rules());

  /** A step that writes a line of the session log (src/core/session-log.ts). */
  const logStep = (kind, hid, title, text) => logged(logLine(store.id('l'), new Date().toISOString(), kind, hid, title, text), rules());
  /** A change to one hunter, as one write. */
  const onHunter = (hid, why, step) => store.apply(why, atHunter(hid, step));

  // ── XP / level and rewards: one step each (src/core/hunter/grant.ts) ──
  /** When a step happens: now, today's day key at the save's reset hour, and the rules. */
  const dayNow = () => ({ ...stepTime(store.get(), new Date()), R: rules() });
  /**
   * Gives `rw` to hunter `hid` in one write (`grant`), its vitals' parts on the sheet unless a fight holds them: what the
   * grant did (`api.granted` shows it), or null when there is no such hunter. `rw` comes from a view: read it here.
   */
  function give(hid, rw) {
    const r = parseRewards(rw) ?? newRewards();
    const day = dayNow(), held = !!fightOf({ hid });
    const w = grantWrite('rewards', s => { const x = grant(s, hid, r, { ...day, vitals: held ? 'fight' : 'sheet' }); return isRefused(x) ? x : { ...x, held: [{ who: { hid }, ...x.fight }] }; });
    return isRefused(w) ? null : w;
  }
  /**
   * A grant's write: `step` answers the next save and, in `held`, what each grant hands to a fight (grant.ts
   * `Granted.fight`) for a hunter of this phone (`{ hid }`) or a player's (`{ key }`). What this phone's fight holds goes
   * on the hunter's row in the same write (`combat.held`, the grant's step as its `also`), so the reward is paid with its
   * statuses and refill or not at all. The step is read first on the save as it is, for the rows' commands: it answers
   * the same parts for the same save, and the fight's write-back changes nothing they read (the reward, the rank, the
   * XP). Answers what the step answered in the write, or the refusal (`fight` when the fight refused a part).
   * @template {{ save: import('../core/save.ts').Save; held: readonly { who: { hid: string } | { key: string }; statuses: readonly import('../core/hunter/conditions.ts').StatusIn[]; refill: boolean }[] }} T
   * @param {string} why @param {(s: import('../core/save.ts').Save) => T | import('../core/save-step.ts').Refused} step
   * @returns {T | import('../core/save-step.ts').Refused}
   */
  function grantWrite(why, step) {
    const plan = step(store.get());
    if (isRefused(plan)) return plan;
    const parts = plan.held.flatMap(p => { const at = fightOf(p.who); return at && at.at === 'row' && (p.statuses.length || p.refill) ? [{ cid: combatantId(at.cid), statuses: p.statuses, refill: p.refill }] : []; });
    /** @type {T | null} */
    let out = null;
    const write = s => { const x = step(s); if (isRefused(x)) return x; out = x; return x.save; };
    if (parts.length) { const w = app.api.combat.held(parts, write); return isRefused(w) ? w : out; }
    const w = store.apply(why, write);
    return isRefused(w) ? w : out;
  }
  /**
   * After a grant's write: the window's lines with the statuses a row took (a part this phone's fight holds was written
   * with the grant, `grantWrite`), a part the GM's fight holds refused with a toast, a level-up announced, and the Job
   * Change steps it completed opened. Answers the window's lines and the level-up.
   */
  function settle(hid, g, at) {
    const lines = [...g.lines]; let levelup = g.levelup;
    if (at && (g.fight.statuses.length || g.fight.refill)) {
      if (at.at === 'row') {
        lines.push(...heldLines(g.fight.statuses, rules()));
        // the row's refill, its life now on the sheet: "HP and mana fully restored" only when HP was (a dead row stays dead)
        if (g.fight.refill && levelup && store.hunter(hid)?.life.at !== 'dead') levelup = { ...levelup, refill: true };
      } else gmHolds();
    }
    if (levelup) app.emit('levelup', levelup);
    if (g.done.length) app.api.quests.stepsDone(hid, g.done);
    return { lines, levelup };
  }
  const levelPopup = info => ui.system({
    tag: '! Notification', title: 'LEVEL UP!', kind: 'levelup', body: `You have reached Level ${info.to}.`,
    lines: [...(info.points > 0 ? [`+${info.points} ability point${info.points === 1 ? '' : 's'}`] : []), ...(info.refill ? ['HP and mana fully restored'] : [])],
  });

  // ── rank re-evaluation ──
  const eligibleRank = h => { const s = rankStanding(h, rules()); return s.at === 'follows' ? h.rank : s.earns; };
  const canReeval = h => rankStanding(h, rules()).at === 'behind';
  async function reevaluate(hid) {
    const h = store.hunter(hid); if (!h || !canReeval(h)) return false;
    const from = h.rank, to = eligibleRank(h);
    if (!ui.wrote('! Hunter', store.apply('rank', both(atHunter(hid, x => reevaluated(x, rules())), logStep('rank', hid, `Rank re-evaluation: ${from} → ${to}`, `${h.name} was re-evaluated from ${from}-rank to ${to}-rank.`))))) return false;
    await ui.system({ tag: '! Notification', title: `RANK RE-EVALUATION: ${from} → ${to}`, kind: 'levelup',
      body: `The System has re-assessed ${h.name}. You are now a ${to}-rank Hunter.`, lines: [`Rank bonus +${rules().rankBonus[to]}`] });
    return true;
  }

  /**
   * Where the HP, mana, fatigue, life and statuses of a hunter of this phone (`hid`) or of a player's sheet (`key`) live
   * now: the one answer every writer of them asks. In a fight the fight's row holds them and the fight's next `vitals`
   * writes them over the sheet (src/core/combat/fight.ts), so a change made beside the fight is lost. `{ at: 'row', cid }`:
   * a row in this phone's fight (setup or running), the change is a command on it; `{ at: 'gm' }`: a row in the GM's fight
   * on a player's phone (no message carries a player's change); null: the sheet.
   * @type {import('../core/api.ts').HunterApi['fightOf']}
   */
  const fightOf = who => heldIn(store.get(), who);
  /** `fightOf` as save `s` answers it: what a step asks of the save it is handed. */
  const heldIn = (s, who) => {
    const S = app.api.sync;
    return fightHold(s.fight, who, { seat: app.seat(), key: 'hid' in who ? S.myKey(hunterId(who.hid)) : null, ...S.table(s) });
  };
  const gmHolds = () => { ui.toast('System', 'During the GM\'s fight, the GM changes your HP, mana, fatigue and statuses.', { kind: 'warning' }); return refuse(TOLD); };
  /**
   * The one writer of a hunter's HP, mana, fatigue, life and statuses, beside the fight's own write-back (fight-save.ts `fought`):
   * `onRow(cid, sheet, onSheet)` in this phone's fight, `onTable(sheet)` in the GM's fight (refused with a toast unless
   * given), else `onSheet(h)` in one update. `sheet()` writes `onSheet` for what the row does not hold (a life event), and
   * `onRow` may carry `onSheet` as a fight command's `also` instead. A sheet write of them sits inside a call of this
   * (tests/lint.test.ts). Answers the write's Applied whole, for the caller's `ui.wrote`: the store's, the fight's
   * (`TOLD`: its news said why), or `TOLD` from `gmHolds`.
   * @typedef {import('../core/save-step.ts').Applied} Applied
   * @param {string} hid @param {string} why @param {(h: any) => unknown} onSheet
   * @param {(cid: string, sheet: () => Applied, onSheet: (h: any) => unknown) => Applied} onRow @param {(sheet: () => Applied) => Applied} [onTable]
   * @returns {Applied}
   */
  function vitalsEdit(hid, why, onSheet, onRow, onTable = gmHolds) {
    const at = fightOf({ hid }), sheet = () => onHunter(hid, why, onSheet);
    if (!at) return sheet();
    return at.at === 'row' ? onRow(at.cid, sheet, onSheet) : onTable(sheet);
  }
  /** A hand edit of HP, mana or fatigue: the fight's `adjust` on the row, refused in the GM's fight, else `onSheet(h)`. */
  const handEdit = (hid, delta, onSheet, why) => vitalsEdit(hid, why, orKeep(onSheet), cid => app.api.combat.adjust(cid, delta));
  /**
   * `write`, a change of hunter `hid`'s HP or life, and what it did to the life, worked out from the life read before and
   * read again after (src/core/hunter/vitals.ts `lifeNews`): the write's refusal whole, else `news`, null when the state stayed.
   */
  function lifeWrite(hid, write) {
    const was = store.hunter(hid)?.life; if (!was) return refuse('no-hunter');
    const w = write(); if (isRefused(w)) return w;
    const now = store.hunter(hid)?.life;
    return { ok: /** @type {const} */ (true), news: now ? lifeNews(was, now) : null };
  }
  /** The toast of a death: HP reached 0. */
  const diedToast = w => { if (w && w.news && w.news.kind === 'died') ui.toast('Warning', DIED_WORDS, { kind: 'warning' }); };
  const restRefused = () => { ui.toast('System', 'You cannot rest during a fight.', { kind: 'warning' }); return refuse(TOLD); };
  /** A status put on a row by hand (Add status): the def the status carries, else the rules' under its key; refused as the sheet's `putStatus` refuses. */
  const statusToRow = (cid, s) => {
    const def = s.def || rules().conditions[s.key];
    return isStateChip(s.key) ? refuse('state-chip') : !def ? refuse('no-def') : app.api.combat.status(cid, { add: { key: s.key, def, rounds: s.rounds ?? null, tier: s.source.tier } });
  };

  // ── app.api.hunter (§B5) ──
  const api = app.api.hunter = {
    // shared numeric HP entry (P01): '7' = damage 7, '+12' = heal 12, '-3' = damage 3; null when not a whole number 1..99999
    // R01: delete a local hunter. Typed-name confirm, backup first; deleting the last one makes a fresh hunter instead of refusing
    async deleteHunter(hid) {
      const h = store.hunter(hid); if (!h) return false;
      const typed = await ui.promptText({
        danger: true,
        tag: 'Delete hunter',
        title: `Delete ${h.name}?`,
        body: `Deleting removes ${h.name} along with all their items and data. A backup is saved first.`,
        label: `Type ${h.name} to confirm`,
        value: '',
        maxlength: 60,
        confirmLabel: 'Delete hunter',
        match: { word: String(h.name), error: `Type ${h.name} to confirm.` },
      });
      if (typed == null) return false;
      if (!store.backupNow('pre-delete-hunter') && !(await ui.confirm({ title: 'No backup saved', body: `Storage is full, so a backup of ${h.name} could not be saved. Delete anyway?`, danger: true, confirmLabel: 'Delete without backup' }))) return false;
      // the last hunter goes only with the one that takes its place: Cancel on its name deletes nothing
      const last = store.get().hunters.length <= 1;
      const fresh = last ? await ui.promptText({ title: 'Create a new hunter', label: 'New hunter name', value: 'Hunter', maxlength: 60 }) : null;
      if (last && fresh == null) return false;
      const name = last ? cleanName(fresh) || 'Hunter' : null;
      const now = new Date(), R = rules();
      if (!ui.wrote('System', store.apply('delete-hunter', s => (name !== null && s.hunters.length <= 1
        ? removeHunter(createHunter(s, name, R, now).save, h.id, null)
        : removeHunter(s, h.id, null))))) return false;
      app.api.sync.forget(h.id); // the tombstone waits in the outbox until the room takes it
      ui.toast('System', `${h.name} was deleted. A backup was saved (Data → Backups).`, { kind: 'info' });
      return true;
    },
    // F04: NFKC-normalised (full-width digits ok), 1..999999 accepted and clamped to 99999
    parseAmount(text) {
      const m = /^\s*([+-])?\s*(\d{1,6})\s*$/.exec(String(text ?? '').normalize('NFKC')); if (!m) return null;
      const n = Number(m[2]); if (!n) return null;
      return { n: Math.min(n, 99999), heal: m[1] === '+' };
    },
    amountMsg(text) { return api.parseAmount(text) ? '' : /^\s*[+-]?\s*0+\s*$/.test(String(text ?? '').normalize('NFKC')) ? 'Amount must be at least 1' : 'Type a whole number. Enter deals damage, and +5 or Shift+Enter heals.'; },
    // one key contract for every HP box: Enter = damage, Shift+Enter or a leading '+' = heal; ignores IME composition. null = not a trigger key
    amountFromKey(e, text) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return null;
      const a = api.parseAmount(text);
      return a ? { n: a.n, heal: a.heal || !!e.shiftKey, msg: '' } : { n: 0, heal: false, msg: api.amountMsg(text) };
    },
    sheet: sheetOf,
    gainXP(hid, n) {
      n = int(n);
      const g = n ? give(hid, { xp: n }) : null;
      if (!g) return null;
      const { levelup } = api.granted(hid, g, { popup: false });
      if (!levelup) {
        if (g.debtXp) ui.toast('System', debtXpLine(g.debtXp));
        else ui.toast('System', `${n > 0 ? '+' : ''}${n} XP`, { key: 'xp', amount: n, fmt: t => `${t > 0 ? '+' : ''}${t} XP acquired.` });
      }
      return levelup;
    },
    applyRewards(hid, rw, opts = {}) {
      const g = store.hunter(hid) ? give(hid, rw || {}) : null;
      return g && api.granted(hid, g, opts);
    },
    grantWrite,
    granted(hid, g, opts = {}) {
      const { lines, levelup } = settle(hid, g, fightOf({ hid }));
      const all = [...(opts.lines || []).map(String), ...lines];
      let popup = null;
      const silent = !!opts.silent || opts.levelPopup === false;
      if (opts.popup !== false && !opts.silent && (all.length || opts.title)) {
        popup = ui.system({ tag: opts.tag || '! Notification', title: opts.title || 'REWARDS ACQUIRED', kind: opts.kind || 'quest', body: opts.body ?? `${store.hunter(hid)?.name ?? ''} receives the System's rewards.`, lines: all });
      }
      if (levelup && !silent) levelPopup(levelup);
      return { lines: all, levelup, popup };
    },
    gmHolds,
    damage(hid, n) { return handEdit(hid, { hp: -Math.abs(int(n)) }, h => lifeEvent(h, { type: 'damage', amount: Math.abs(int(n)) }), 'damage'); },
    heal(hid, n) { return handEdit(hid, { hp: Math.abs(int(n)) }, h => lifeEvent(h, { type: 'heal', amount: Math.abs(int(n)) }), 'heal'); },
    /**
     * The GM's Revive (src/core/hunter/vitals.ts), from the sheet or the GM board: on the sheet it stands the dead hunter
     * up and takes off every status (grant.ts `sheetEdit`). In this phone's fight the row holds the life: it is the
     * fight's `revive` command, and the sheet hears the row's new life in the same write. In the GM's fight it is the GM's.
     */
    revive(hid) { return vitalsEdit(hid, 'life-revive', h => lifeEvent(h, { type: 'revive' }), cid => app.api.combat.revive(cid)); },
    /**
     * The System raise (grant.ts `systemRaise`): refused `held` while a fight holds the hunter (section 21's default: a
     * fight's dead row is the GM's to revive), so it never writes beside a fight's row. The ladder, the life and the
     * debt in one write, with the GM's `systemRaise` message in a room.
     */
    systemRaise(hid) {
      /** @type {import('../core/hunter/grant.ts').SystemRaised | null} */
      let out = null;
      const w = store.apply('system-raise', s => { const r = systemRaise(s, hid, { at: new Date().toISOString(), room: app.api.sync.room(), R: rules(), held: heldIn(s, { hid }) !== null }); if (isRefused(r)) return r; out = r; return r.save; });
      if (isRefused(w)) return w;
      return out ?? refuse('no-hunter'); // a write that took the step holds its answer
    },
    /** HP and mana to their maxima: in a fight the row's (`combat.refill`), refused in the GM's fight. */
    fightOf,
    // the price is checked where the mana lives: the row refuses a paid adjust it cannot cover, the sheet's `spend` the same
    spendMana(hid, n, also = null) {
      n = Math.max(0, int(n));
      if (!n && !also) return refuse('unchanged');
      if (!n) return onHunter(hid, 'mana', also);
      return vitalsEdit(hid, 'mana', also ? both(x => sheetEdit(x, { type: 'spend', mana: n }, rules()), also) : x => sheetEdit(x, { type: 'spend', mana: n }, rules()),
        cid => app.api.combat.spend(cid, n, also ? atHunter(hid, also) : null));
    },
    rest(hid = store.active().id) {
      return vitalsEdit(hid, 'rest', h => sheetEdit(h, { type: 'rest' }, rules()), restRefused, restRefused);
    },
    addCondition(hid, status) { return vitalsEdit(hid, 'condition', h => addC(h, status), cid => statusToRow(cid, status)); },
    removeCondition(hid, key) { return vitalsEdit(hid, 'condition', h => delC(h, key), cid => app.api.combat.status(cid, { remove: key })); },
  };

  // ── the System raise: a dead hunter's own phone offers it (the owner, Nov 22: "System raise", no GM button) ──
  /**
   * Whether this phone offers the System raise to hunter `h` now: a player's dead hunter with a raise left on its ladder,
   * once no fight holds it. The GM's phone has its Revive, and offers none.
   */
  const raiseOpen = h => !app.isGM() && h.life.at === 'dead' && canRaise(h.reviveLeft) && !fightOf({ hid: h.id });
  let raiseOffered = null; // the hunter the window last opened for by itself, so a death opens it once; a reload opens it again
  /** The System's window for hunter `hid`: Rise raises it (`api.systemRaise`) and tells how it came back; Not now leaves it dead. */
  async function offerRaise(hid) {
    const h = store.hunter(hid), offer = h && raiseOpen(h) ? raiseOffer(h, rules()) : null;
    if (!offer) return;
    const rise = await ui.warn({ tag: 'System revive', title: RAISE_TITLE, body: offer.body, lines: [...offer.lines],
      actions: [{ label: offer.rise, value: true, primary: true }, { label: 'Not now', value: false, cancel: true }] });
    // the hunter may have been raised another way while the window stood open (the GM's Revive): then it says nothing
    if (rise !== true || store.hunter(hid)?.life.at !== 'dead') return;
    const w = api.systemRaise(hid);
    if (!ui.wrote('System', w, RAISE_REFUSED)) return;
    ui.toast('System', `The System brought you back. ${raisedLine(w.from, w.to)}.`, { kind: 'good' });
  }
  /**
   * Opens the window by itself when this phone's active hunter is first offered the raise: at a death outside a fight, or
   * as the fight that held it ends. Asked after the write that killed the hunter has asked its own window (a solo run's
   * RUN FAILED), so the offer stands behind what told the death.
   */
  const offerOnce = () => queueMicrotask(() => {
    const h = store.active();
    if (!h || !raiseOpen(h)) { raiseOffered = null; return; }
    if (raiseOffered === h.id) return;
    raiseOffered = h.id;
    void offerRaise(h.id);
  });
  app.on('change', offerOnce);
  app.on('sync:docs', offerOnce);
  app.on('ready', offerOnce);
  // the GM's phone: a player's report of the System's raise goes in the session log once per event id, with a toast
  app.on('sync:event', ({ event: ev }) => {
    if (!app.isGM() || ev.type !== 'systemRaise') return;
    const p = ev.payload, said = raisedSaid(p.name, p.raise, p.owes);
    if (!app.api.sync.once(p.eid, logStep('system', null, said.title, said.text))) return;
    ui.toast('! System', said.text, { kind: 'info' });
  });

  // ── reward bundles: a reward the GM saved under a name (library.rewards) ──
  /** @type {import('../core/api.ts').BundlesApi} */
  app.api.bundles = {
    list: () => store.get().library.rewards.map(b => ({ ...b, rewards: parseRewards(b.rewards) })),
    save(name, rewards, id = null, window = null) {
      const rw = parseRewards(rewards); if (!rw) return refuse('blank');
      const bid = id || store.id('rb'), r = store.apply('bundle-save', atLibrary(l => saveBundle(l, bid, name, rw, LIMITS.libraryRewards, window ? parseWords(window) : null)));
      return isRefused(r) ? r : { ok: /** @type {const} */ (true), id: bid };
    },
    remove(id) { return ui.wrote('Workshop', store.apply('bundle-remove', atLibrary(l => removeBundle(l, id)))); },
  };

  // ── view + shared helpers ──
  // B8: sticky jump chips (anchors by data-panel + scroll-margin; no layout change), one for each panel that names its
  // chip (`jump`), in the panels' own order (app.jumps), so the row and the sheet cannot disagree
  if (!document.getElementById('u17-style')) {
    const st = document.createElement('style'); st.id = 'u17-style';
    st.textContent = `#view-status>.view-main{display:contents}[data-panel]{scroll-margin-top:58px}
.jump-chips{position:sticky;top:0;z-index:20;display:flex;gap:8px;overflow-x:auto;padding:8px 2px;margin:0 0 10px;background:var(--bg,#050b14);border-bottom:1px solid var(--line)}
.jump-chips button{flex:0 0 auto;min-height:40px;min-width:56px;padding:0 14px}
.jump-chips.fade-r{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 36px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 36px),transparent)}
.jump-chips.fade-l{-webkit-mask-image:linear-gradient(90deg,transparent,#000 36px);mask-image:linear-gradient(90deg,transparent,#000 36px)}
.jump-chips.fade-l.fade-r{-webkit-mask-image:linear-gradient(90deg,transparent,#000 36px,#000 calc(100% - 36px),transparent);mask-image:linear-gradient(90deg,transparent,#000 36px,#000 calc(100% - 36px),transparent)}
@media (pointer:coarse),(max-width:720px){.jump-chips button{min-height:44px}[data-panel]{scroll-margin-top:calc(var(--sat) + 74px)}}
@media (min-width:721px) and (max-width:1099px) and (max-height:500px){[data-panel]{scroll-margin-top:12px}}`;
    document.head.appendChild(st);
  }
  /** Syncs the Status view's jump chips with the panels currently visible (`when()` may flip with room rules). */
  const drawJumps = nav => {
    const items = app.jumps('status'), sig = items.map(j => `${j.id}:${j.label}`).join('|');
    if (nav.dataset.sig === sig) return;
    nav.dataset.sig = sig;
    nav.innerHTML = items.map(j => `<button type="button" data-jump="${ui.esc(j.id)}">${ui.esc(j.label)}</button>`).join('');
  };
  app.registerView({ id: 'status', label: 'Status', icon: '◈', order: 10,
    mount(el) {
      el.insertAdjacentHTML('afterbegin', '<nav class="jump-chips" aria-label="Jump to section"></nav>');
      // A15: the row fades at the edge it can still scroll toward, so a player sees there is more than "Stats … Ge…".
      const nav = el.querySelector('.jump-chips');
      drawJumps(nav);
      const fades = () => {
        const more = nav.scrollWidth - nav.clientWidth;
        nav.classList.toggle('fade-l', nav.scrollLeft > 4);
        nav.classList.toggle('fade-r', nav.scrollLeft < more - 4);
      };
      nav.addEventListener('scroll', fades, { passive: true });
      addEventListener('resize', fades);
      fades();
      app.on('view', ({ id }) => { if (id === 'status') fades(); });
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-jump]'); if (!b) return;
        const t = document.querySelector(`#view-status [data-panel="${b.dataset.jump}"]`);
        if (t) t.scrollIntoView({ behavior: ui.reduced() ? 'auto' : 'smooth', block: 'start' });
      });
    },
    update(el) {
      const nav = el.querySelector('.jump-chips');
      if (nav) drawJumps(nav);
    } });
  const setHTML = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; } };
  const setVal = (i, v) => { if (i && document.activeElement !== i && i.value !== String(v)) i.value = v; };
  const bonusText = b => { const o = BONUS_KEYS.filter(k => b && Number(b[k])).map(k => `${sgn(Number(b[k]))} ${BONUS_LABELS[k]}`); return o.length ? o.join(', ') : 'No bonus'; };
  const stepBtns = (attr, vals) => vals.map(v => v === 'full' ? `<button type="button" data-${attr}="full">Full</button>` : v === 'none' ? `<button type="button" data-${attr}="none">None</button>`
    : `<button type="button" data-${attr}="${v}" aria-label="${v < 0 ? 'Decrease' : 'Increase'} by ${Math.abs(v)}">${v < 0 ? '&minus;' : '+'}${Math.abs(v)}</button>`).join('');
  const bar = (key, label, ctl) => `<div class="bar-row" data-bar="${key}">
      <div class="bar-head"><span class="lbl">${label}</span><span class="bar-nums"><span data-cur>0</span> / <span data-maxtxt>0</span>${key === 'ft' ? '' : `<button type="button" class="linkish" data-edit="${key}" aria-label="Edit max ${label}" hidden>0</button>`}</span></div>
      <div class="bar bar-${key}"><i></i></div><div class="bar-ctrl">${ctl}</div></div>`;

  // ═══ Panel: Status Window ═══
  app.registerPanel({
    view: 'status', id: 'status-window', order: 10, title: 'Status Window',
    mount(el) {
      el.innerHTML = `
        <div class="id-read" data-idread>
          <button type="button" class="emb-btn" data-emblem aria-label="Emblem and color"><span data-emb></span><span>Emblem</span></button>
          <div class="id-who"><div class="id-name" data-idname>Hunter</div><div class="id-sub" data-idsub></div><div class="id-guild" data-guild-line></div></div>
          <button type="button" data-idedit aria-expanded="false">Edit</button>
        </div>
        <div class="id-row" data-idform hidden>
          ${[['name', 'Name'], ['job', 'Job'], ['title', 'Title']].map(([k, l]) => `<label class="id-item"><span class="lbl">${l}</span><input class="id-input" type="text" data-f="${k}" maxlength="60" spellcheck="false" autocomplete="off"${k === 'job' ? ' list="job-list"' : ''}></label>`).join('')}
          <datalist id="job-list">${rules().jobs.map(j => `<option value="${esc(j)}"></option>`).join('')}</datalist>
          <div class="id-done"><button type="button" data-iddone>Done</button></div>
        </div>
        <div class="lv-block">
          <div><div class="lv-tag">Level</div><div class="lv-num" data-lv>1</div></div>
          <div class="xp-wrap">
            <div class="bar-head"><span class="lbl">Experience <span class="xp-pct" data-xppct>0%</span></span><span class="bar-nums" data-xpnums>0 / 100</span></div>
            <div class="bar bar-xp"><i data-xpbar></i></div>
            <div class="bar-ctrl gm-only" data-xpctl hidden>${[10, 50, 100].map(v => `<button type="button" data-xp="${v}">+${v} XP</button>`).join('')}</div>
          </div>
          <div class="reeval-wrap"><div data-rank></div><div class="reeval" data-reeval hidden><span>Re-evaluation available</span><button type="button" class="primary" data-reeval-btn>Re-evaluate</button></div></div>
        </div>
        ${bar('hp', 'HP', stepBtns('hp', [-5, -1, 1, 5, 'full']))}
        <div class="hp-amt" data-hpamt-row>
          <label class="field"><span class="lbl">HP amount</span><input data-hpamt type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" spellcheck="false" placeholder="7 or +5" title="Press Enter to deal damage. Type +5 or press Shift+Enter to heal." aria-describedby="hp-amt-msg"></label>
          <button type="button" class="danger" data-hpdmg>Damage</button><button type="button" data-hpheal>Heal</button>
          <p class="hp-amt-msg" id="hp-amt-msg" data-hpmsg role="status" aria-live="polite"></p>
        </div>
        <div class="death" data-death hidden>
          <b data-life></b>
          <button type="button" class="primary" data-revive hidden>Revive</button>
          <button type="button" class="primary" data-raise hidden>Use System revive</button>
          <p class="note" data-wayback></p>
          <p class="note" data-raise-line></p>
        </div>
        <div class="lbl dv-sub">Statuses</div>
        <div class="chips" data-chips></div>
        <div class="cond-add">${ui.field('Add status', `<select data-cond-sel>${Object.entries(rules().conditions).filter(([k]) => !isStateChip(k)).map(([k, c]) => `<option value="${esc(k)}">${esc(c.label)}</option>`).join('')}</select>`)}<button type="button" data-cond-add>Add</button></div>
        ${bar('mana', 'Mana', stepBtns('mana', [-5, -1, 1, 5, 'full']))}
        ${bar('ft', 'Fatigue', stepBtns('ft', [-10, -5, 5, 10, 'none', 'full']))}
        <div class="rest-row"><button type="button" data-rest>Rest</button><p class="note" data-rests-left></p></div>
`;

      el.addEventListener('change', e => {
        const f = e.target.dataset.f; if (!f) return;
        const v = e.target.value.replace(/\s+/g, ' ').trim().slice(0, 60);
        const hid = store.active().id;
        // a refused change is told, and the redraw below puts the field back as the save holds it
        if (f === 'title') { const tid = store.id('t'); ui.wrote('! Hunter', onHunter(hid, 'identity', both(h => nameActiveTitle(h, v, tid), fit))); }
        else if (f === 'name') ui.wrote('! Hunter', onHunter(hid, 'identity', h => rename(h, v)));
        else if (f === 'job') ui.wrote('! Hunter', onHunter(hid, 'identity', h => setJob(h, v)));
        update(el);
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.f) e.target.blur(); });
      const applyHpAmt = heal => {
        const inp = el.querySelector('[data-hpamt]'), msg = el.querySelector('[data-hpmsg]'), a = api.parseAmount(inp.value), h = store.active();
        if (!a) { msg.textContent = api.amountMsg(inp.value); return; }
        const hl = heal || a.heal, before = sheetOf(h).hp;
        const w = lifeWrite(h.id, () => (hl ? api.heal(h.id, a.n) : api.damage(h.id, a.n))); if (!ui.wrote('System', w)) return;
        const hp = sheetOf(store.hunter(h.id)).hp;
        msg.textContent = `${hl ? 'Healed' : 'Took'} ${Math.abs(hp - before)} HP (entered ${a.n}). Current HP: ${hp}.`;
        diedToast(w);
        inp.value = ''; inp.focus();
      };
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-hpamt]')) { e.preventDefault(); if (api.amountFromKey(e, e.target.value)) applyHpAmt(e.shiftKey); } });
      el.querySelector('[data-hpdmg]').addEventListener('click', () => applyHpAmt(false));
      el.querySelector('[data-hpheal]').addEventListener('click', () => applyHpAmt(true));
      app.api.detail.wire(el, () => update(el));
      el.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset, h = store.active();
        if (d.xp) return api.gainXP(h.id, Number(d.xp));
        if ('reevalBtn' in d) return reevaluate(h.id);
        if ('emblem' in d) return app.api.identity.edit(h.id);
        if ('idedit' in d || 'iddone' in d) return showIdForm(el, 'idedit' in d);
        if ('rest' in d) {
          if (!ui.wrote('System', api.rest(h.id), restRefusalWords(rules()))) return;
          return ui.toast('System', `Rest complete. ${restsLeftLine(store.hunter(h.id).restsTaken, rules())}`);
        }
        if (d.hp || d.mana || d.ft) {
          const key = d.hp ? 'hp' : d.mana ? 'mana' : 'ft', val = d[key], n = Number(val), m = maxima(h), R = rules(), tired = { fatigue: h.fatigue, collapsed: h.collapsed };
          // 'full' and 'none' as amounts: the fight's adjust keeps each within 0 and its maximum
          const delta = key === 'hp' ? { hp: val === 'full' ? m.hpMax : n } : key === 'mana' ? { mana: val === 'full' ? m.manaMax : n } : { fatigue: val === 'full' ? m.fatigueMax : val === 'none' ? -m.fatigueMax : n };
          const w = lifeWrite(h.id, () => handEdit(h.id, delta, x => {
            if (key === 'hp') return lifeEvent(x, val === 'full' ? { type: 'setHp', hp: m.hpMax } : n < 0 ? { type: 'damage', amount: -n } : { type: 'heal', amount: n });
            return key === 'mana' ? sheetEdit(x, { type: 'mana', delta: delta.mana }, R) : sheetEdit(x, { type: 'fatigue', delta: delta.fatigue }, R);
          }, key));
          if (!ui.wrote('System', w)) return;
          diedToast(w);
          const now = store.hunter(h.id), crossed = key === 'ft' && now ? fatigueNews(tired, now, maxima(now), R) : null;
          if (crossed) ui.toast('Warning', crossed === 'collapsed' ? 'You have collapsed from exhaustion.' : 'Fatigue is critically high.', { kind: 'warning' });
          return;
        }
        if (d.edit) { // GM max HP/mana edit via prompt; adjusts hpAdj/manaAdj; current value clamps only on confirm (P1-4)
          const key = d.edit, m = maxima(h), cur = key === 'hp' ? m.hpMax : m.manaMax;
          const n = await ui.promptNum({ title: key === 'hp' ? 'Edit max HP' : 'Edit max mana', label: key === 'hp' ? 'Maximum HP' : 'Maximum mana', value: cur, min: key === 'hp' ? 1 : 0, max: 9999 });
          if (n === null) return;
          ui.wrote('! Hunter', onHunter(h.id, 'max-edit', x => setMaximum(x, key === 'hp' ? 'hpMax' : 'manaMax', n, rules())));
          return;
        }
        if ('condAdd' in d) {
          const key = el.querySelector('[data-cond-sel]').value;
          ui.wrote('System', api.addCondition(h.id, { key, def: rules().conditions[key], rounds: null, source: gmSource(h.rank) }), PUT_WORDS); return;
        }
        if (d.condDel) { ui.wrote('System', api.removeCondition(h.id, d.condDel)); return; }
        if ('raise' in d) { void offerRaise(h.id); return; }
        if ('revive' in d && app.isGM()) {
          const was = h.level; // the store writes into the hunter a view holds, so the level before is read before the write
          if (ui.wrote('System', api.revive(h.id))) return ui.toast('System', `${h.name} is back up. ${raisedLine(was, store.hunter(h.id).level)}.`);
        }
      });
    },
    update,
  });

  /** Opens or closes the three identity inputs (the sheet shows name, job and title as text until the player taps Edit). */
  function showIdForm(el, open) {
    el.querySelector('[data-idform]').hidden = !open;
    el.querySelector('[data-idread]').hidden = open;
    const edit = el.querySelector('[data-idedit]');
    edit.setAttribute('aria-expanded', String(open));
    if (open) el.querySelector('[data-f="name"]').focus(); else edit.focus();
  }

  let shownHunter = null, shownLevel = null; // the hunter and level the sheet showed last: a change of hunter is drawn at once, a change of level is a level-up
  function update(el) {
    const h = store.active(), d = sheetOf(h), gm = app.isGM(), r = rules();
    const q = s => el.querySelector(s);
    const t = h.titles.find(x => x.id === h.titleId);
    for (const [f, v] of [['name', h.name], ['job', h.job ?? ''], ['title', t ? t.name : '']]) setVal(q(`[data-f="${f}"]`), v);
    q('[data-idname]').textContent = h.name;
    q('[data-idsub]').textContent = [h.job ?? '', t ? t.name : ''].filter(Boolean).join(' \u00b7 ');
    q('[data-guild-line]').textContent = guildSheetLine(h, r);
    const sameHunter = shownHunter === h.id, levelled = sameHunter && shownLevel !== null && h.level > shownLevel;
    shownHunter = h.id; shownLevel = h.level;
    q('[data-lv]').textContent = h.level;
    if (levelled) { motion.pop(q('[data-lv]')); motion.burst('levelup', q('[data-lv]')); }
    if (app.api.identity) setHTML(q('[data-emb]'), app.api.identity.badge(h));
    setHTML(q('[data-rank]'), ui.rankBadge(h.rank));
    q('[data-reeval]').hidden = !canReeval(h);
    const need = xpToNext(h.level);
    q('[data-xpnums]').textContent = `${ui.fmt(h.xp)} / ${ui.fmt(need)}`;
    // XP lands by filling its bar while its percentage counts; a level-up fills from empty again
    motion.fillTo(q('.bar-xp'), h.xp / need, { trail: false, ...(levelled ? { from: 0 } : {}) });
    motion.numberTo(q('[data-xppct]'), motion.percent(h.xp / need), n => `${n}%`, `xp:${h.id}`);
    q('[data-xpctl]').hidden = !gm;
    const setBar = (key, cur, max) => {
      const row = q(`[data-bar="${key}"]`);
      row.querySelector('[data-cur]').textContent = ui.fmt(cur);
      const txt = row.querySelector('[data-maxtxt]'), btn = row.querySelector('[data-edit]');
      txt.textContent = ui.fmt(max);
      if (btn) { btn.textContent = ui.fmt(max); txt.hidden = gm; btn.hidden = !gm; }
      motion.fillTo(row.querySelector('.bar'), max ? cur / max : 0, sameHunter ? {} : { from: max ? cur / max : 0 });
    };
    setBar('hp', d.hp, d.sheet.hpMax); setBar('mana', d.mana, d.sheet.manaMax); setBar('ft', h.fatigue, d.sheet.fatigueMax);
    const life = h.life, dead = life.at === 'dead';
    q('[data-death]').hidden = !dead;
    if (dead) {
      q('[data-life]').textContent = lifeWord({ kind: 'hunter', life });
      q('[data-revive]').hidden = !gm || !can(life, 'revive');
      q('[data-wayback]').textContent = `${WAYS_BACK} brings you back and removes every status.`;
      q('[data-raise-line]').textContent = raiseLine(h, r, !!fightOf({ hid: h.id }));
      q('[data-raise]').hidden = !raiseOpen(h);
    }
    q('[data-rests-left]').textContent = restsLeftLine(h.restsTaken, r);
    const sel = q('[data-cond-sel]'), opts = Object.entries(r.conditions).filter(([k]) => !isStateChip(k)).map(([k, c]) => `<option value="${esc(k)}">${esc(c.label)}</option>`).join('');
    if (sel._h !== opts) { const keep = sel.value; sel._h = opts; sel.innerHTML = opts; if (keep) sel.value = keep; } // library statuses show up without a reload
    // the chips drawn from the hunter's state (src/core/hunter/chips.ts) have no x: nothing removes them by hand
    const chips = [...chipsOf(h).map(key => ({ c: { key, rounds: null, def: chipDef(key), source: null }, key, rm: false })), ...h.conditions.map(c => ({ c, key: c.key, rm: true }))];
    const chipBox = q('[data-chips]'), chipsWere = sameHunter ? new Map([...chipBox.querySelectorAll('[data-chip]')].map(c => [c.dataset.chip, c])) : null;
    if (chipsWere) for (const [key, c] of chipsWere) if (!chips.some(x => x.key === key)) motion.fadeOff(c);
    setHTML(chipBox, chips.length ? chips.map(({ c, key, rm }) => {
      const def = c.def, rd = c.rounds != null ? ` \u00b7 ${c.rounds} round${c.rounds === 1 ? '' : 's'}` : '', n = 'stacks' in c ? c.stacks : undefined;
      return `<span class="chip${isStateChip(key) ? ' warn-c' : ''}" data-chip="${esc(key)}"${def.color ? ` style="border-color:${esc(def.color)}"` : ''}><button type="button" class="c-info"${app.api.detail.control('sheet-chips', key)}><span class="c-ic"${def.color ? ` style="color:${esc(def.color)}"` : ''}>${icon(statusIcon(key, def))}</span>${esc(def.label)}${n ? ` ×${n}` : ''}${rd}</button>${rm ? `<button type="button" data-cond-del="${esc(key)}" aria-label="Remove status ${esc(def.label)}">&times;</button>` : '<span class="c-end"></span>'}</span>`
        + app.api.detail.panel('sheet-chips', key, () => ({ kind: 'status', label: def.label, def, tier: c.source ? c.source.tier : null, ...(n ? { stacks: n } : {}), left: c.rounds ?? null }));
    }).join('') : '<span class="empty">No statuses.</span>');
    if (chipsWere) for (const c of chipBox.querySelectorAll('[data-chip]')) if (!chipsWere.has(c.dataset.chip)) motion.pop(c);
  }

  // ═══ Panel: Attributes (stats grid + allocation) ═══
  const statCell = k => { const label = STAT_SHORT[k], alias = STAT_LABELS[k]; return `<div class="stat" data-k="${k}">
      <button type="button" class="s-roll" data-roll="${k}" aria-label="Roll ${label} check (${alias})">
        <span class="s-name">${label}</span><span class="s-alias">${alias}</span>
        <span class="s-val"><span data-v>10</span> <small class="s-bonus" data-b></small></span><span class="s-mod">+0</span>
      </button>
      <span class="s-share" data-share hidden></span>
      <div class="s-btns">
        <button type="button" data-st="${k}" data-dir="-1" aria-label="Decrease ${alias}">&minus;</button>
        <button type="button" data-st="${k}" data-dir="1" aria-label="Increase ${alias}">+</button>
      </div></div>`; };

  const focusMemory = store.device('auto-focus');
  /**
   * Initial stat focus for hunter `h`: job's 2:1 pair, else saved device focus, else highest spent stats (or Strength).
   * @returns {import('../core/registry/jobs.ts').StatFocus}
   */
  function initialFocus(h, R) {
    if (isJobName(h.job)) { const jf = jobFocus(h.job); if (jf) return jf; }
    const saved = focusMemory.read();
    const kept = saved && typeof saved === 'object' && !Array.isArray(saved) ? parseStatFocus(saved[h.id]) : null;
    if (kept) return kept;
    const put = allocated(h), base = R.fight.statBase;
    const spent = STAT_KEYS.filter(k => put[k] > base).sort((a, b) => put[b] - put[a]);
    return spent.length ? { main: spent[0], second: spent[1] ?? null } : { main: 'str', second: null };
  }
  async function openAutoAllocate(hid) {
    const h = store.hunter(hid), R = rules();
    if (!h || available(h, R) <= 0) return;
    const init = initialFocus(h, R);
    /** @type {{ main: import('../core/stats.ts').StatKey; second: import('../core/stats.ts').StatKey | null }} */
    const picked = { main: init.main, second: init.second };
    const job = isJobName(h.job) ? h.job : null;
    const jf = job ? jobFocus(job) : null;
    const lead = job && jf
      ? AUTO_ALLOC_WORDS.jobHint(job, STAT_LABELS[jf.main], jf.second ? STAT_LABELS[jf.second] : null)
      : h.job ? AUTO_ALLOC_WORDS.customJobHint : AUTO_ALLOC_WORDS.preJobHint;
    const statOpts = STAT_KEYS.map(k => `<option value="${k}">${esc(STAT_LABELS[k])} (${STAT_SHORT[k]})</option>`).join('');
    const html = `<div class="af-pick">
      <div class="lbl">${esc(AUTO_ALLOC_WORDS.jobPresetsLabel)}</div>
      <div class="af-presets" role="group" aria-label="${esc(AUTO_ALLOC_WORDS.jobPresetsLabel)}">${JOB_NAMES.map(j => `<button type="button" data-af-job="${esc(j)}" aria-pressed="false">${esc(j)}</button>`).join('')}</div>
      <div class="af-fields">
        <label class="field"><span class="lbl">${esc(AUTO_ALLOC_WORDS.mainLabel)}</span><select data-af-main>${statOpts}</select></label>
        <label class="field"><span class="lbl">${esc(AUTO_ALLOC_WORDS.secondLabel)}</span><select data-af-second><option value="">${esc(AUTO_ALLOC_WORDS.secondNone)}</option>${statOpts}</select></label>
      </div>
      <p class="af-match" data-af-match hidden></p>
      <div class="lbl">${esc(AUTO_ALLOC_WORDS.previewLabel)}</div>
      <ul class="af-pv" data-af-pv aria-live="polite"></ul>
      <p class="dv-note">${esc(AUTO_ALLOC_WORDS.undoHint)}</p>
    </div>`;
    const ok = await ui.system({
      tag: '! Points', title: AUTO_ALLOC_WORDS.title, kind: 'info', body: lead, html,
      actions: [{ label: 'Cancel', value: false, cancel: true }, { label: AUTO_ALLOC_WORDS.placeAction, value: true, primary: true }],
      drawn(win) {
        const box = win.querySelector('.af-pick');
        if (!box) return;
        const mainSel = box.querySelector('[data-af-main]'), secSel = box.querySelector('[data-af-second]');
        const matchEl = box.querySelector('[data-af-match]'), pvEl = box.querySelector('[data-af-pv]');
        const drawFocus = () => {
          if (picked.second === picked.main) picked.second = null;
          mainSel.value = picked.main;
          for (const opt of secSel.querySelectorAll('option')) opt.disabled = opt.value === picked.main;
          secSel.value = picked.second ?? '';
          const match = matchingJob(picked);
          for (const b of box.querySelectorAll('[data-af-job]')) b.setAttribute('aria-pressed', String(b.dataset.afJob === match));
          matchEl.hidden = !match;
          matchEl.textContent = match ? AUTO_ALLOC_WORDS.matchesJob(match) : '';
          const plan = autoSpend(h, focusWeights(picked), R), d = sheetOf(h);
          pvEl.innerHTML = STAT_KEYS.filter(k => plan[k] > 0).map(k => `<li><span>${esc(STAT_LABELS[k])} (${STAT_SHORT[k]})</span><span>${esc(d.stats[k])} &rarr; <b class="up">${esc(d.stats[k] + plan[k])}</b> (+${esc(plan[k])})</span></li>`).join('');
        };
        box.addEventListener('click', e => {
          const b = e.target.closest('[data-af-job]'); if (!b) return;
          const j = b.dataset.afJob;
          if (!isJobName(j)) return;
          const next = jobFocus(j);
          picked.main = next.main; picked.second = next.second;
          drawFocus();
        });
        mainSel.addEventListener('change', () => { picked.main = oneOf(mainSel.value, STAT_KEYS, 'str'); drawFocus(); });
        secSel.addEventListener('change', () => { picked.second = secSel.value ? oneOf(secSel.value, STAT_KEYS, null) : null; drawFocus(); });
        drawFocus();
      },
    });
    if (ok !== true) return;
    const cur = store.hunter(hid);
    if (!cur) return;
    const prev = focusMemory.read();
    const nextMem = prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...prev, [hid]: { main: picked.main, second: picked.second } } : { [hid]: { main: picked.main, second: picked.second } };
    focusMemory.write(nextMem);
    const plan = autoSpend(cur, focusWeights(picked), rules());
    if (!Object.keys(plan).length) return;
    ui.wrote('Points', store.apply('stat', atHunter(hid, both(x => raiseMany(x, plan, rules()), x => fitted(x, rules())))), ALLOCATION_WORDS);
  }

  app.registerPanel({
    view: 'status', id: 'attributes', order: 12, title: 'Attributes', jump: 'Stats',
    mount(el) {
      el.innerHTML = `<div class="stats">${STAT_KEYS.map(statCell).join('')}</div>
        <div class="ap-row">
          <span class="lbl">Ability points</span><span class="ap-num" data-ap>0</span>
          <button type="button" data-auto-alloc hidden>${esc(AUTO_ALLOC_WORDS.button)}</button>
          <button type="button" class="primary" data-confirm hidden>${esc(KEYSTONE_WORDS.confirmAction)}</button>
          <button type="button" data-grant hidden>+1 point</button>
        </div>
        <p class="ap-ks" data-confirm-ks hidden aria-live="polite"></p>
        <p class="dv-note">Tap a stat to roll a check. Tap &minus; to undo points until you confirm.</p>`;
      el.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset, h = store.active(), role = app.isGM() ? 'gm' : 'player';
        if (d.roll) {
          const stat = oneOf(d.roll, STAT_KEYS, 'str'), label = STAT_SHORT[stat], res = app.api.dice.check(h.id, stat, { label: `${label} check` });
          // a natural that called the coin is not a critical yet: the coin card asks heads or tails (coin.js)
          ui.toast('Check', `${label} check: ${res.total}${res.coin ? ` (natural ${res.natural})` : res.crit ? ' (critical)' : res.fumble ? ' (fumble)' : ''}`, { kind: res.fumble && !res.coin ? 'warning' : 'info' });
          return;
        }
        if (d.st) {
          // The rule of + and −, and what each role may do, is src/core/hunter/progress.ts (raise, lower).
          const k = oneOf(d.st, STAT_KEYS, 'str'), move = Number(d.dir) > 0 ? x => raise(x, k, role, rules()) : x => lower(x, k, role);
          ui.wrote('! Hunter', store.apply('stat', atHunter(h.id, both(move, x => fitted(x, rules())))), ALLOCATION_WORDS);
          return;
        }
        if ('autoAlloc' in d) { void openAutoAllocate(h.id); return; }
        if ('confirm' in d) { ui.wrote('! Hunter', store.apply('confirm-alloc', atHunter(h.id, confirm))); return; }
        if ('grant' in d && role === 'gm') ui.wrote('! Hunter', store.apply('grant', atHunter(h.id, x => plusPoint(x, rules()))));
      });
    },
    update(el) {
      const h = store.active(), R = rules(), d = sheetOf(h), gm = app.isGM(), role = gm ? 'gm' : 'player', points = available(h, R), put = allocated(h);
      const ksOn = R.fight.keystone.on, basis = keystoneBasis(h), reach = keystoneReach(basis, R.fight);
      STAT_KEYS.forEach((k, i) => {
        const c = el.querySelector(`.stat[data-k="${k}"]`), delta = d.stats[k] - put[k], b = d.checks.bonus[k];
        c.querySelector('[data-v]').textContent = d.stats[k];
        c.querySelector('[data-b]').textContent = delta ? `(${sgn(delta)})` : '';
        c.querySelector('.s-mod').textContent = sgn(b);
        const sh = c.querySelector('[data-share]');
        if (ksOn) {
          const share = reach.stats[i].share;
          sh.hidden = false;
          sh.textContent = keystoneShareText(share);
          sh.setAttribute('aria-label', keystoneShareAria(share));
        } else {
          sh.hidden = true;
          sh.textContent = '';
          sh.removeAttribute('aria-label');
        }
        const [minus, plus] = c.querySelectorAll('.s-btns button');
        minus.disabled = isRefused(lower(h, k, role));
        plus.disabled = isRefused(raise(h, k, role, R));
        c.querySelector('.s-roll').setAttribute('aria-label', `Roll ${STAT_SHORT[k]} check (${STAT_LABELS[k]}), bonus ${sgn(b)}`);
      });
      el.querySelector('[data-ap]').textContent = points;
      el.querySelector('[data-auto-alloc]').hidden = points <= 0;
      const pending = hasPending(h);
      el.querySelector('[data-confirm]').hidden = !pending;
      el.querySelector('[data-grant]').hidden = !gm;
      const ksLine = ksOn && pending ? keystoneConfirmLine(keystoneConfirmDiff(h, R.fight), R) : '';
      const ksEl = el.querySelector('[data-confirm-ks]');
      ksEl.hidden = !ksLine;
      ksEl.textContent = ksLine;
    },
  });

  // ═══ Panel: Keystones (shown only while `fight.keystone.on` is on) ═══
  app.registerPanel({
    view: 'status', id: 'keystones', order: 12.5, title: KEYSTONE_WORDS.panelTitle, jump: KEYSTONE_WORDS.panelTitle,
    when: () => rules().fight.keystone.on,
    mount(el) {
      el.innerHTML = `<ul class="ks-list" data-ks-held></ul>
        <p class="empty" data-ks-empty hidden></p>
        <p class="ks-next" data-ks-next hidden></p>
        <div class="bar-ctrl"><button type="button" data-ks-codex>${esc(KEYSTONE_WORDS.browseAll)}</button></div>`;
      el.addEventListener('click', e => {
        if (e.target.closest('[data-ks-codex]')) app.go('keystones');
      });
    },
    update(el) {
      const h = store.active(), R = rules(), basis = keystoneBasis(h);
      const held = keystonesOf(basis, R.fight), reach = keystoneReach(basis, R.fight);
      setHTML(el.querySelector('[data-ks-held]'), held.map(key => {
        const ks = keystoneOf(key, R), aw = key.tier === 'confluence' && basis.awakened ? keystoneAwakenedLine(ks) : null;
        return `<li class="ks-item"><div class="ks-head"><span class="ks-name">${esc(ks.name)}${aw ? ` <span class="tag-on">${esc(KEYSTONE_WORDS.awakenedBadge)}</span>` : ''}</span><span class="ks-tier">${esc(keystoneTierLabel(key))}</span></div><p class="ks-line">${esc(ks.line)}</p>${aw ? `<p class="ks-awake">${esc(aw)}</p>` : ''}</li>`;
      }).join(''));
      const empty = el.querySelector('[data-ks-empty]');
      empty.hidden = held.length > 0;
      empty.textContent = held.length ? '' : KEYSTONE_WORDS.noneEarned;
      const next = keystoneNextLine(nearestKeystone(reach, R.fight), R, reach.totalSpent);
      const nx = el.querySelector('[data-ks-next]');
      nx.hidden = !next;
      nx.textContent = next;
    },
  });

  // ═══ Panel: Derived ═══
  const shown = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
  app.registerPanel({
    view: 'status', id: 'derived', order: 14, title: 'Combat stats',
    mount(el) {
      el.innerHTML = `<div class="derived" data-dv></div><div class="lbl dv-sub">Check bonus</div><div class="derived" data-cb></div><p class="dv-note" data-dnote></p>`;
      app.api.detail.wire(el, () => derived(el));
    },
    update: el => derived(el),
  });
  function derived(el) {
      const h = store.active(), d = sheetOf(h), c = d.checks, rankBonus = rules().rankBonus[h.rank];
      const cell = (l, v, k) => `<div class="dv"${k ? ` data-dv-k="${k}"` : ''}><span class="lbl">${esc(l)}</span><b>${esc(v)}</b></div>`;
      // each number of the sheet opens its parts (src/core/hunter/sheet.ts `explain`) under its row
      const number = k => `<button type="button" class="dv" data-dv-k="${k}"${app.api.detail.control('sheet-numbers', k)} aria-label="${esc(SHEET_LABELS[k])} ${esc(shown(d.sheet[k]))}"><span class="lbl">${esc(SHEET_LABELS[k])}</span><b>${esc(shown(d.sheet[k]))}</b></button>`
        + app.api.detail.panel('sheet-numbers', k, () => ({ kind: 'number', key: k, hunter: h }));
      setHTML(el.querySelector('[data-dv]'), [
        ...SHOWN.map(number), ...FROM_BONUSES.filter(k => d.sheet[k] > 0).map(number),
        cell('Rank bonus', sgn(rankBonus), 'rank'), cell('Fatigue penalty', c.tired ? sgn(-c.tired) : '0', 'fatigue'),
      ].join(''));
      setHTML(el.querySelector('[data-cb]'), STAT_KEYS.map(k => `<div class="dv" data-cb-k="${k}"><span class="lbl">${STAT_SHORT[k]}</span><b>${esc(sgn(c.bonus[k]))}</b></div>`).join(''));
      const notes = [];
      if (c.tired) notes.push(`Fatigue ${h.fatigue}: ${sgn(-c.tired)} to all checks.`);
      if (c.dis) notes.push('Fatigue is high: disadvantage on checks.');
      if (c.penalty) notes.push(`Penalty Zone: ${sgn(-c.penalty)} to all checks.`);
      const n = el.querySelector('[data-dnote]');
      n.textContent = notes.join(' ') || `Your check bonus is half the stat's effective points above 10, rounded down, plus your rank bonus (${sgn(rankBonus)}).`;
      n.classList.toggle('bad', notes.length > 0);
  }

  /** A boon the player redeems: after a confirm it leaves the hunter, and the GM is told (app.api.uses: the room, or this phone's log). */
  async function redeem(hid, id) {
    const b = store.hunter(hid)?.boons.find(x => x.id === id); if (!b) return;
    if (!await ui.confirm({ title: `Redeem ${b.name}?`, body: `${b.text ? `${b.text} ` : ''}When you redeem this boon, the GM is notified and the boon is spent.`, confirmLabel: 'Redeem boon' })) return;
    // the boon leaves and the GM's report is written in one write (src/core/use-told.ts)
    if (!ui.wrote('System', app.api.uses.told(hid, 'boon-redeem', h => dropBoon(h, id), { what: 'boon', name: b.name, text: b.text, target: 'self', tell: true }))) return;
    ui.toast('System', `${b.name} redeemed. The GM was notified.`);
  }

  /** The GM takes a boon back from a hunter on this phone: nothing is reported, nobody used it. */
  async function removeBoon(hid, id) {
    const b = store.hunter(hid)?.boons.find(x => x.id === id); if (!b) return;
    if (!await ui.confirm({ title: 'Remove boon?', body: `Remove ${b.name} without redeeming it. The player is not notified.`, danger: true, confirmLabel: 'Remove boon' })) return;
    ui.wrote('! Hunter', onHunter(hid, 'boon-remove', h => dropBoon(h, id)));
  }

  // ═══ Panel: Titles ═══
  let editingTitle = null, lastHid = null; // null | 'new' | title id
  app.registerPanel({
    view: 'status', id: 'titles', order: 20, title: 'Titles', jump: 'Titles',
    mount(el) {
      el.innerHTML = `<ul class="plain" data-tlist></ul>
        <div data-boonwrap hidden><div class="lbl dv-sub">Boons</div><ul class="plain" data-boons aria-label="Boons"></ul></div>
        <div data-seedwrap><div class="lbl dv-sub">Available titles</div><ul class="plain" data-tseed></ul></div>
        <div class="bar-ctrl" data-tgm hidden><button type="button" data-tadd>Add title</button></div>
        <form class="t-form" data-tform hidden>
          ${ui.field('Title name', `<input type="text" name="tname" maxlength="${REWARD_BOUNDS.title}" autocomplete="off" required>`)}
          ${ui.field('Description', `<input type="text" name="tdesc" maxlength="${REWARD_BOUNDS.titleDesc}" autocomplete="off">`)}
          <div data-tbonus></div>
          <div class="bar-ctrl"><button type="button" data-tcancel>Cancel</button><button type="submit" class="primary">Save title</button></div>
        </form>`;
      const form = el.querySelector('form[data-tform]');
      const openForm = id => {
        editingTitle = id; const h = store.active(), t = id === 'new' ? { name: '', desc: '', bonus: {} } : h.titles.find(x => x.id === id);
        if (!t) { editingTitle = null; return; }
        form.tname.value = t.name; form.tdesc.value = t.desc;
        form.querySelector('[data-tbonus]').innerHTML = app.api.maker.bonus(t.bonus);
        form.hidden = false; form.tname.focus();
      };
      el.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset, h = store.active(), gm = app.isGM();
        if (d.tset !== undefined) { ui.wrote('! Hunter', onHunter(h.id, 'title-active', both(x => toggleTitle(x, d.tset), fit))); return; }
        if (d.grantTitle) {
          const seed = seedTitle(d.grantTitle); if (!seed || (seed.gmOnly && !gm)) return;
          const tid = store.id('t');
          if (ui.wrote('! Hunter', onHunter(h.id, 'title-grant', x => giveTitle(x, { key: seed.key }, tid, rules().titles)))) ui.toast('System', `Title acquired: ${seed.name}`);
          return;
        }
        if (d.redeem) return redeem(h.id, d.redeem);
        if (d.boondel && gm) return removeBoon(h.id, d.boondel);
        if ('tadd' in d && gm) return openForm('new');
        if (d.tedit && gm) return openForm(d.tedit);
        if ('tcancel' in d) { form.hidden = true; editingTitle = null; return; }
        if (d.tdel && gm) {
          const t = h.titles.find(x => x.id === d.tdel);
          if (t && await ui.confirm({ title: 'Delete title?', body: t.name, danger: true, confirmLabel: 'Delete title' })) {
            if (ui.wrote('! Hunter', onHunter(h.id, 'title-del', both(x => removeTitle(x, t.id), fit))) && editingTitle === t.id) { form.hidden = true; editingTitle = null; }
          }
        }
      });
      form.addEventListener('submit', e => {
        e.preventDefault(); if (!app.isGM()) return;
        const h = store.active(), name = form.tname.value.replace(/\s+/g, ' ').trim().slice(0, REWARD_BOUNDS.title); if (!name) return;
        const bonus = app.api.maker.readBonus(form);
        const tid = editingTitle === 'new' ? store.id('t') : editingTitle;
        // a refused title keeps the form open with what was typed
        if ((editingTitle === 'new' || h.titles.some(t => t.id === tid)) && !ui.wrote('! Hunter', onHunter(h.id, 'title-edit', both(x => writeTitle(x, tid, { name, desc: form.tdesc.value, bonus }), fit)))) return;
        form.hidden = true; editingTitle = null;
      });
    },
    update(el) {
      const h = store.active(), gm = app.isGM();
      if (h.id !== lastHid) { lastHid = h.id; editingTitle = null; el.querySelector('[data-tform]').hidden = true; }
      const R = rules(), holder = hunterSheet(h, R);
      const powers = t => { const lines = titlePowerLines(t, h.rank, holder, R); return lines.length ? `<ul class="t-powers" aria-label="${esc(t.name)} in a fight">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''; };
      setHTML(el.querySelector('[data-tlist]'), h.titles.length ? h.titles.map(t => `<li class="row-li${t.id === h.titleId ? ' on' : ''}" data-title="${esc(t.id)}">
          <div class="r-main"><div class="r-name">${esc(t.name)} ${t.id === h.titleId ? '<span class="tag-on">Active</span>' : ''}</div>
          <div class="r-sub">${esc(bonusText(t.bonus))}${t.desc ? ` &middot; ${esc(t.desc)}` : ''}</div>${powers(t)}</div>
          <div class="r-acts"><button type="button" data-tset="${esc(t.id)}">${t.id === h.titleId ? 'Deactivate' : 'Set active'}</button>
          ${gm ? `<button type="button" data-tedit="${esc(t.id)}" aria-label="Edit title ${esc(t.name)}">Edit</button><button type="button" class="danger" data-tdel="${esc(t.id)}" aria-label="Delete title ${esc(t.name)}">&times;</button>` : ''}</div></li>`).join('')
        : '<li class="empty">No titles earned yet.</li>');
      el.querySelector('[data-boonwrap]').hidden = !h.boons.length;
      setHTML(el.querySelector('[data-boons]'), h.boons.map(b => `<li class="row-li" data-boon="${esc(b.id)}">
          <div class="r-main"><div class="r-name">${esc(b.name)}</div>${b.text ? `<div class="r-sub">${esc(b.text)}</div>` : ''}</div>
          <div class="r-acts"><button type="button" data-redeem="${esc(b.id)}" aria-label="Redeem ${esc(b.name)}">Redeem</button>${gm ? `<button type="button" class="danger" data-boondel="${esc(b.id)}" aria-label="Remove boon ${esc(b.name)}">&times;</button>` : ''}</div></li>`).join(''));
      const seeds = rules().titles.filter(s => !h.titles.some(t => t.seedKey === s.key) && (gm || !s.gmOnly));
      el.querySelector('[data-seedwrap]').hidden = !gm || !seeds.length;
      setHTML(el.querySelector('[data-tseed]'), seeds.map(s => `<li class="row-li"><div class="r-main"><div class="r-name">${esc(s.name)}${s.gmOnly ? ' <span class="tag-on">GM award</span>' : ''}</div>
          <div class="r-sub">${esc(bonusText(s.bonus))}${s.desc ? ` &middot; ${esc(s.desc)}` : ''}</div></div>
          <div class="r-acts"><button type="button" data-grant-title="${esc(s.key)}" aria-label="Grant title ${esc(s.name)}">Grant</button></div></li>`).join(''));
      el.querySelector('[data-tgm]').hidden = !gm;
      if (!gm) { el.querySelector('[data-tform]').hidden = true; editingTitle = null; }
    },
  });

  // ═══ Panel: Party ═══
  app.registerPanel({
    view: 'status', id: 'party', order: 30, title: 'Party',
    mount(el) {
      el.innerHTML = `<ul class="plain" data-plist></ul><div class="bar-ctrl"><button type="button" class="primary" data-padd>Add hunter</button></div>`;
      el.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        const d = b.dataset, hs = store.get().hunters;
        if ('padd' in d) {
          const name = await ui.promptText({ title: 'New hunter', label: 'Hunter name', value: '' });
          if (name) ui.wrote('System', store.apply('new-hunter', s => createHunter(s, name, rules(), new Date()).save));
          return;
        }
        const h = d.pset || d.pren || d.pdel ? store.hunter(d.pset || d.pren || d.pdel) : null; if (!h) return;
        if (d.pset) return app.api.sync.switchTo(h.id); // S03
        if (d.pren) {
          const name = await ui.promptText({ title: 'Rename hunter', label: 'Hunter name', value: h.name });
          if (name) ui.wrote('! Hunter', onHunter(h.id, 'rename', x => rename(x, name)));
          return;
        }
        if (d.pdel) { await api.deleteHunter(h.id); return; }
      });
    },
    update(el) {
      const hs = store.get().hunters, act = store.active().id;
      setHTML(el.querySelector('[data-plist]'), hs.map(h => `<li class="row-li${h.id === act ? ' on' : ''}" data-hunter="${esc(h.id)}">
        <div class="r-main"><div class="r-name">${app.api.identity.badge(h, 'sm')}${esc(h.name)} ${h.id === act ? '<span class="tag-on">Active</span>' : ''}</div>
        <div class="r-sub">Lv. ${esc(h.level)} &middot; ${ui.rankBadge(h.rank)} ${h.job ? ` &middot; ${esc(h.job)}` : ''}</div></div>
        <div class="r-acts">${h.id === act ? '' : `<button type="button" data-pset="${esc(h.id)}">Switch</button>`}
        <button type="button" data-pren="${esc(h.id)}" aria-label="Rename ${esc(h.name)}">Rename</button>
        <button type="button" class="danger" data-pdel="${esc(h.id)}" aria-label="Delete ${esc(h.name)}" title="Delete ${esc(h.name)}">Delete</button></div></li>`).join(''));
    },
  });

  // ═══ Panel: GM raw edits ═══
  const RAW = [['level', 'Level', 1], ['xp', 'Current XP', 0], ['points', 'Ability points', 0], ['hpAdj', 'Max HP bonus', null], ['manaAdj', 'Max mana bonus', null], ['gold', 'Gold', 0], ['crystal', 'Mana crystal', 0]];
  function rawRefresh(el) {
    const h = store.active();
    for (const [k] of RAW) setVal(el.querySelector(`[data-raw="${k}"]`), k === 'points' ? available(h, rules()) : h[k]);
    const put = allocated(h);
    for (const k of STAT_KEYS) setVal(el.querySelector(`[data-rawstat="${k}"]`), put[k]);
    setVal(el.querySelector('[data-rawrank]'), h.rank);
  }
  app.registerPanel({
    view: 'status', id: 'gm-edit', order: 35, title: 'GM: Edit hunter', gmOnly: true,
    mount(el) {
      el.innerHTML = `<div class="raw-grid">
        ${RAW.map(([k, l]) => ui.field(l, `<input type="number" step="1" inputmode="numeric" data-raw="${k}">`)).join('')}
        ${STAT_KEYS.map(k => ui.field(`${STAT_SHORT[k]} (base)`, `<input type="number" step="1" min="1" inputmode="numeric" data-rawstat="${k}">`)).join('')}
        ${ui.field('Rank', `<select data-rawrank>${rules().rankLevels ? Object.keys(rules().rankLevels).map(r => `<option value="${r}">${r}</option>`).join('') : ''}</select>`)}
      </div><div class="bar-ctrl"><button type="button" data-raw-guild>${esc(GUILD_WORDS.button)}</button></div><p class="dv-note">Changes save immediately. Stat edits lock in right away and cannot be undone with the minus button.</p>`;
      el.addEventListener('click', e => {
        if (e.target.closest('[data-raw-guild]')) void app.api.guild.edit({ kind: 'local', hunterId: store.active().id }, null);
      });
      el.addEventListener('change', e => {
        const i = e.target, h = store.active(); let v = Math.trunc(Number(i.value));
        // a refused edit is told, and the fields are drawn again from the save
        const written = w => { if (!ui.wrote('! Hunter', w)) rawRefresh(el); };
        if (i.dataset.rawrank) return written(onHunter(h.id, 'gm-edit', x => setRank(x, i.value)));
        if (!Number.isFinite(v)) return rawRefresh(el);
        if (i.dataset.rawstat) return written(store.apply('gm-edit', atHunter(h.id, both(x => setStat(x, oneOf(i.dataset.rawstat, STAT_KEYS, 'str'), v), x => fitted(x, rules())))));
        const k = i.dataset.raw, R = rules();
        if (k === 'level' || k === 'xp') {
          // the Job Change level step moves with the level, and is completed when reached, in the same write
          let done = [];
          const day = dayNow();
          written(store.apply('gm-edit', s => { const x = levelEdit(s, h.id, k === 'level' ? v : h.level, k === 'xp' ? v : h.xp, day); if (isRefused(x)) return x; done = x.done; return x.save; }));
          if (done.length) app.api.quests.stepsDone(h.id, done);
          return;
        }
        const edit = k === 'points' ? x => setPoints(x, v, R) : k === 'gold' ? x => setGold(x, v) : k === 'crystal' ? x => setCrystal(x, v) : k === 'hpAdj' || k === 'manaAdj' ? x => setAdjust(x, k, v, R) : null;
        if (edit) written(onHunter(h.id, 'gm-edit', both(edit, fit)));
      });
    },
    update: rawRefresh,
  });
}

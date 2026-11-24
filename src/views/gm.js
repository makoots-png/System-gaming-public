// gm.js (U11): the GM screen. Party board, awards, System broadcast, quest/gate shortcuts, roll tables,
// rules editor, session log and world day. Everything is called through app.api.X at call time (stub or real).
import { RANKS, dueAt as dueIn, parseOverrides, refusalWords } from '../edge/rules.ts';
import { can, vitalChipsOf } from '../core/hunter/vitals.ts';
import { chipDef, ofLife } from '../core/hunter/chips.ts';
import { RAISE_CHIPS, debtChip, debtStep, paysDebt } from '../core/hunter/revive-standing.ts';
import { GUILD_WORDS, clearPreviewLine, guildChip, guildGoldStep, takesGuildCut } from '../core/hunter/guild.ts';
import { gmSource } from '../core/effects.ts';
import { playerHeld } from '../core/combat/fight-save.ts';
import { parseSheetKey, sheetKeyOf } from '../core/ids.ts';
import { oneOf } from '../core/one-of.ts';
import { standsFor } from '../core/protocol.ts';
import { weighed, weighsFor, weightOf, weightOn, weightStep, weightsJoined } from '../core/table-weight.ts';
import { cheatSheet } from './rulesref.js';
import { bundleMaker } from './reward-editor.js';
import { UNFINISHED_ROWS, isEmptyReward, newRewards, rewardLines } from '../core/rewards.ts';
import { GIVE_HOLD_MS, SHELF_WORDS, readRecent, recentGives } from '../core/registry/bundles.ts';
import { giveShelf } from './give-shelf.js';
import { LOG_KINDS } from '../core/save.ts';
import { questOffer } from '../core/hunter/quests.ts';
import { SECRET_WORDS, questReaches } from '../core/hunter/quest-secret.ts';
import { pickables, sheetName } from '../core/party.ts';
import { tapWords } from '../core/sync/taps.ts';
import { featsSwitched, resetRuleNumbers, resetTable, saveRuleNumbers, writeTable } from '../core/rules.ts';
import { CHRONICLE_WORDS, FEATS_SWITCH_WORDS, boardLine } from '../core/hunter/chronicle-view.ts';
import { BLANK_DRAFT, draftStep, gmAward, sendApproves, sendDeals, sendGives, sent } from '../core/award.ts';
import { PENDING_WORDS, localHunter, pendingApproved, pendingHeard, pendingOf, pendingRefused, rewardWaits, waitingIn } from '../core/hunter/pending.ts';
import { LOOT_WORDS, dropDealt, dropLine, dropWaiting, lootOffered } from '../core/gates/pay.ts';
import { SPAWN_TYPES } from '../core/gates/gate.ts';
import { DIFFICULTY_WORDS, parseDifficultyLevel } from '../core/gates/difficulty.ts';
import { difficultySliderHtml, wireDifficultyLive } from './difficulty-control.js';
import { stepTime } from '../core/day.ts';
import { isRefused } from '../core/save-step.ts';
import { askToNotify, notifyState } from '../edge/notify.ts';
import { pick } from '../edge/roll.ts';
import * as motion from './motion.ts';
import { compareTimes } from '../core/day.ts';
import { postNews } from '../core/sync/connection.ts';
import { running } from '../core/story/run.ts';
import { WORD_WORDS } from '../core/sync/word.ts';
import { raisedLine } from '../core/hunter/grant.ts';

/** The Make row at the top of the GM view: a kind the Workshop makes and its button. */
const MAKE = [['status', 'Status'], ['item', 'Item'], ['skill', 'Skill'], ['monster', 'Monster'], ['bundle', 'Bundle']];

// ── seed roll tables (GM-editable; edits persist in rulesOverrides.gmTables, gate names in rulesOverrides.gateNames) ──
const SEED = {
  encounter: {
    E: ['Goblin pack: 4 goblins and a goblin shaman', 'Giant rats swarm out of the drains (2d6)', 'A lone Kasaka-touched wolf guards the corridor', 'Slime nest: 3 slimes, one splits when hit', 'Rogue E-rank hunter ambushes the party for their loot'],
    D: ['Orc raiding party: 3 orcs and an orc captain', 'Stone golem blocks the only exit', 'Giant spiders drop from the ceiling (1d4+2)', 'Lizardmen patrol with a tamer and two drakelings', 'Cursed knight rises from a collapsed shrine'],
    C: ['Ogre brute with two goblin war-drummers', 'Ice-bear pair guarding a frozen chamber', 'Wraith choir: 3 wraiths drain mana on hit', 'Mimic chest next to a very obvious treasure pile', 'Poison-ant queen and her soldier escort'],
    B: ['Minotaur warlord and his gore-hounds', 'Blood-red knights, four strong, in perfect formation', 'Basilisk lair: petrification gaze every other round', 'Shadow assassin duo hunting the strongest hunter', 'A mage tower of mirrors: duplicates of the party attack'],
    A: ['Cerberus-class gatekeeper with three heads and three initiative slots', 'Demon noble and two bound knights', 'Dragon wyrmling brood with a mother returning in 3 rounds', 'Commander-grade soldier ant and its honor guard', 'Ancient lich fragment tethered to the room'],
    S: ['Archdemon sovereign, phase one', 'Ruler-class entity: reality shifts each round', 'Calamity beast rampaging through the gate break', 'Monarch envoy offers a deal and an ambush', 'The gate itself is a creature'],
  },
  urgent: [
    'Rescue the survivors | A hunter team is trapped inside the gate. Reach them before the timer runs out. | 150',
    'Kill the escaped boss | A boss crossed over into the city. Eliminate it. | 300',
    'Protect the supply convoy | Escort the convoy to the Association branch without losses. | 120',
    'Seal the unstable gate | The gate pulses red. Clear it or evacuate the block. | 250',
    'Retrieve the stolen relic | A thief hunter fled with a relic. Bring it back. | 180',
    'Survive the ambush | An unknown force targets you. Survive until reinforcements arrive. | 100',
  ],
  npc: [
    'Han Seo-jun', 'Choi Min-gi', 'Kang Tae-shik', 'Yoo Ji-ho', 'Baek Do-yun', 'Seo Hae-rin', 'Min Byung-chul', 'Ahn Soo-ah',
    'Tanaka Ryo', 'Kuroda Shin', 'Hoshino Aya', 'Sakamoto Ren', 'Akiyama Haruto', 'Mori Kaito', 'Yamashiro Rei', 'Fujiwara Mio',
  ],
  whisper: [
    'The System is watching.', 'You have not been forgotten.', 'The weak do not get to choose.', 'A new gate opens somewhere near you.',
    'Your level will not save you from a stronger gate.', 'The Player is stronger than yesterday.', 'Rest. The next gate will not wait.',
    'Your shadow is longer than it should be.', 'Daily quest pending. Failure carries a penalty.', 'Arise.',
  ],
};
const TABLES = [
  { id: 'encounter', label: 'Random fight (by rank)', ranked: true },
  { id: 'urgent', label: 'Urgent quest generator' },
  { id: 'gate', label: 'Gate names' },
  { id: 'npc', label: 'NPC hunter names (Korean / Japanese)' },
  { id: 'loot', label: 'Random loot (by rank)', ranked: true, noEdit: true },
  { id: 'whisper', label: 'System whisper' },
];
const SYS_KINDS = ['info', 'quest', 'warning', 'penalty', 'levelup', 'arise'];
const SYS_KIND_LABEL = { info: 'Info', quest: 'Quest', warning: 'Warning', penalty: 'Penalty', levelup: 'Level up', arise: 'Arise' };
const LOG_KIND_LABEL = { system: 'System', award: 'Awards', quest: 'Quests', gate: 'Gates', combat: 'Fights', rank: 'Ranks', use: 'Reported uses', story: 'Stories', trade: 'Trades', word: 'Player words', answer: 'GM answers' };
// broadcast presets (System voice): [label, tag, kind, title, body]
const PRESETS = [
  ['Emergency Quest', '! Emergency Quest', 'warning', 'EMERGENCY QUEST', 'An emergency quest has been issued. Failure to respond carries a penalty.'],
  ['Skill Acquired', '! Notification', 'info', 'SKILL ACQUIRED', 'You have acquired a new skill.'],
  ['Gate Break Warning', '! Warning', 'warning', 'GATE BREAK WARNING', 'A gate has not been cleared in time. Its monsters will come out into the world.'],
  ['Penalty Zone', '! Penalty', 'penalty', 'PENALTY ZONE', 'You have failed the daily quest. Survive for 4 hours to clear the penalty.'],
  ['Level Restriction Lifted', '! Notification', 'levelup', 'LEVEL RESTRICTION LIFTED', 'The level restriction has been lifted.'],
];

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const int = v => Math.trunc(Number(v)) || 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function diffCount(ov, base) {
  let n = 0;
  for (const k of Object.keys(ov || {})) {
    const v = ov[k], bv = base ? base[k] : undefined;
    if (isObj(v) && isObj(bv)) n += diffCount(v, bv);
    else if (JSON.stringify(v) !== JSON.stringify(bv)) n++;
  }
  return n;
}

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const A = () => app.api; // never cache function refs: stubs are replaced by owners
  const S = () => store.get();
  /** The ids of the hunters picked in Award (`targetList`'s `id`): read back through the list, never taken apart. */
  const sel = new Set();
  let root = null;       // view body, set on mount
  const open = matchMedia('(max-width:720px)').matches ? { party: true } : matchMedia('(min-width:1100px)').matches ? { party: true, award: true } : { cheat: true, party: true, award: true }; // phones start collapsed except Party; desktop (D04) starts with the cheat-sheet folded so Party + Award lead

  const ov = () => (isObj(S().rulesOverrides) ? S().rulesOverrides : {});
  const ovPublic = () => { const o = { ...ov() }; delete o.gmTables; return o; };
  /** The rule overrides after `fn` (a function of src/core/rules.ts from the overrides to the next), and `said` (a log line), in one write. */
  const setOv = (fn, said = []) => gmWrite('gm-rules', d => ({ ...d, rulesOverrides: fn(isObj(d.rulesOverrides) ? d.rulesOverrides : {}) }), [], said);
  /** A line of the session log the GM view says (src/core/session-log.ts `Said`). */
  const line = (kind, title, text, hunterId = null) => ({ kind, hunterId, title: String(title), text: String(text) });
  /**
   * `change` (a step on the save, or none), the room events posted and the lines said, in one write (src/core/award.ts
   * `sent`): a GM action is written whole or not at all. The outbox sends what it posted after the write. Answers whether
   * it wrote; a refused write is told (ui.js `wrote`).
   */
  function gmWrite(why, change, events, said) {
    const S = A().sync, code = events.length ? S.room() : null;
    const w = store.apply(why, s => { const x = change ? change(s) : s; return isRefused(x) ? x : sent(x, { room: code, events, said }, { at: new Date().toISOString(), cap: app.rules().logCap }); });
    if (!ui.wrote('GM', w)) return false;
    if (code) S.flush();
    return true;
  }
  const addLog = (kind, title, text, hunterId = null) => gmWrite('gm-log', null, [], [line(kind, title, text, hunterId)]);
  /** A room event of `type` this phone may post: the event, or why not (no room; a body the room would refuse). */
  const postable = (type, body) => { const ev = A().sync.event(type, body); return app.seat() === 'alone' ? { why: 'noRoom' } : ev ? { ev } : { why: 'notEvent' }; };
  const room = () => A().sync.room();
  const remotes = () => A().sync.remoteSheets();
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  /** HP, mana and fatigue with their maxima, as the hunter's own sheet shows them (`hunter.sheet`). */
  const vitalsOf = h => { const d = A().hunter.sheet(h); return { hp: d.hp, hpMax: d.sheet.hpMax, mana: d.mana, manaMax: d.sheet.manaMax, fatigueMax: d.sheet.fatigueMax }; };
  const $ = sl => root.querySelector(sl);
  const say = (id, text, bad = false) => { const e = $(id); if (e) { e.textContent = text; e.classList.toggle('bad', !!bad); } };

  ui.css('gm', `
.gm-sec>.gm-body{margin-top:4px}
.gm-sec h2{padding:0}
.gm-hsum{font-size:13px;color:var(--cyan-dim);letter-spacing:.04em;text-transform:none;font-family:var(--font-body,inherit);font-weight:400;overflow-wrap:anywhere;min-width:0}
.gm-hsum{flex:0 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gm-sec h2:has(.gm-hsum)::after{display:none}
.gm-tog{flex:0 1 auto;background:none;border:0;box-shadow:none;padding:0 4px 0 0;min-height:40px;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;text-align:left;display:inline-flex;align-items:center;gap:8px}
.gm-tog:hover{box-shadow:none}
.gm-tog .ar{font-size:12px;color:var(--cyan-dim)}
.gm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px 10px;margin-bottom:10px}
.gm-grid .wide{grid-column:1/-1}
.gm-sec input[type=text],.gm-sec input[type=number],.gm-sec select,.gm-sec textarea{width:100%;box-sizing:border-box}
.gm-sec textarea{font-family:var(--font-mono);font-size:13px;resize:vertical;min-height:110px}
.gm-chk{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 10px;border:1px solid var(--line);background:rgba(10,26,46,.55);cursor:pointer;overflow-wrap:anywhere}
.gm-chk input{width:20px;height:20px;flex:0 0 auto;margin:0}
.gm-targets{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:10px}
.gm-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.gm-card{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:10px 12px;min-width:0}
.gm-card.remote{border-style:dashed}
.gm-card h3{margin:0 0 6px;font-size:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;overflow-wrap:anywhere}
.gm-card .tagline{font-size:12px;color:var(--muted);letter-spacing:.06em}
.gm-chron{width:100%;min-height:var(--control-h);margin:8px 0 0;text-align:left;white-space:normal;overflow-wrap:anywhere}
.gm-switch{margin:0 0 14px}.gm-switch .seg{margin:6px 0}.gm-switch .seg button{min-height:var(--control-h);min-width:72px}
.gm-chips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
.gm-chip{font-size:12px;padding:1px 7px;border:1px solid var(--line);color:var(--ice)}
.gm-chip.pen{border-color:var(--red);color:#ff8a96}
.gm-chip.pen[data-life-at]{border-color:var(--life);color:var(--life)}.gm-chip.pen[data-life-at=dead]{background:rgba(255,77,94,.16)}
.gm-chip.ok{border-color:var(--green);color:var(--green)}
.gm-hp{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.gm-hp-lbl{flex:1 1 100%;margin-bottom:-2px}
.gm-hp button{flex:1 1 44px;min-height:40px}
.gm-hp [data-grevive]{flex:1 0 auto;padding-inline:14px} /* the life's one action keeps its whole word on a 390 px phone */
.gm-chip.rm{display:inline-flex;align-items:center;gap:4px;padding-right:0}
.gm-x{min-width:40px;min-height:40px;padding:0;background:none;border:0;box-shadow:none;color:inherit;font-size:14px}
.gm-seg{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}.gm-seg .gm-chk{flex:1 1 140px}
.gm-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.gm-msg{min-height:20px;font-size:13px;color:var(--green);margin:4px 0}
.gm-msg.bad{color:#ff8a96}
.gm-tie{margin:6px 0;padding:6px 8px;border-left:3px solid var(--gold);font-size:13px;overflow-wrap:anywhere}
.gm-pw{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.gm-pw-row{border:1px solid var(--line);border-left:3px solid var(--gold);background:rgba(10,26,46,.45);padding:8px 10px;overflow-wrap:anywhere}
.gm-pw-what{color:var(--cyan);font-size:13px}
.gm-pw-lines{font-size:13px;margin:4px 0 6px}
.dlg-actions .gm-msg{flex:1 1 0;min-width:0;margin:0;align-self:center}
.gm-prev{position:relative;margin:8px 0 12px;padding:18px 16px;text-align:center;border:1px solid var(--line-bright);background:var(--panel-solid);box-shadow:0 0 24px rgba(63,192,255,.35)}
.gm-prev .n-tag{font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:var(--cyan);margin-bottom:8px;overflow-wrap:anywhere}
.gm-prev .n-big{margin:0 0 8px;font-family:var(--font-display);letter-spacing:.1em;text-transform:uppercase;color:var(--ice)}
.gm-prev.k-warning,.gm-prev.k-penalty{border-color:var(--red)}.gm-prev.k-warning .n-big,.gm-prev.k-penalty .n-big{color:#ff8a96}
.gm-prev.k-levelup{border-color:var(--gold)}.gm-prev.k-levelup .n-big{color:var(--gold)}
.gm-prev.k-arise{border-color:var(--purple)}.gm-prev.k-arise .n-big{color:var(--purple)}
.gm-prev .n-big{font-size:22px;overflow-wrap:anywhere}
.gm-prev .n-body{margin:0;color:var(--cyan-dim);white-space:pre-wrap;overflow-wrap:anywhere}
.gm-result{border:1px solid var(--line-bright);background:rgba(10,26,46,.7);padding:10px 12px;margin:8px 0;overflow-wrap:anywhere;min-height:40px}
.gm-log{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:420px;overflow:auto}
.gm-log li{border:1px solid var(--line);background:rgba(10,26,46,.45);padding:6px 10px;font-size:13px;overflow-wrap:anywhere}
.gm-log .k{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)}
.gm-log .t{color:var(--muted);font-family:var(--font-mono);font-size:12px}
.gm-log .lt{display:block;margin-top:2px}.gm-log .lx{display:block;color:var(--ice);margin-top:2px}
.gm-make{display:flex;flex-direction:column;gap:4px;margin:0 0 10px}
.gm-make-h{display:flex;align-items:center;justify-content:space-between}.gm-make-h button{min-height:var(--control-h)}
.gm-make-row{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.gm-make-row button{min-height:var(--control-h);padding:6px 4px;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (min-width:1100px){.gm-make-h{justify-content:flex-start;gap:12px}.gm-make-row{display:flex;flex-wrap:wrap}.gm-make-row button{padding:6px 18px}}
.gm-uses{display:flex;flex-direction:column;gap:4px;margin:0 0 10px}.gm-uses .gm-row{margin:0}.gm-uses .gm-row button{min-height:44px}
.gm-uses-go{align-self:flex-start;min-height:48px;display:flex;align-items:center;justify-content:center;gap:10px;font-size:16px}
@media (max-width:899px){.gm-uses-go{align-self:stretch}}
.gm-uses-n{min-width:26px;padding:1px 8px;border-radius:13px;background:var(--gold);color:#000;font-weight:700}
.gm-day{font-family:var(--font-display);font-weight:700;font-size:28px;color:var(--ice);text-shadow:0 0 14px rgba(77,216,255,.6)}
.gm-room{margin:0 0 12px}.gm-room:empty{display:none}
.gm-wtable{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:0 0 12px}
.gm-whint{flex:1 1 100%;margin:0;font-size:13px;color:var(--cyan-dim)}
.gm-weight{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:8px}
.gm-wstep{display:flex;flex-wrap:nowrap;align-items:center;gap:6px}.gm-wstep b{min-width:2.2em;text-align:center}
.gm-wstep button{min-width:44px;min-height:44px;padding:0}
.gm-wnext{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.gm-wnext .seg{margin:0}.gm-wnext .seg button{min-height:44px;min-width:44px}
.gm-wline{display:flex;gap:10px;font-size:13px;color:var(--gold);margin:4px 0 0}
.gm-wdot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--gold);box-shadow:0 0 6px rgba(255,201,77,.7);margin-left:4px}
.gm-rm-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}
.gm-rm-code{display:flex;gap:.7em;font-family:var(--font-mono);font-size:24px;letter-spacing:.15em;color:var(--gold);line-height:1.1}
.gm-rm-st{font-size:13px;color:var(--cyan-dim);white-space:nowrap}.gm-rm-st[data-conn=reconnecting]{color:#ffb02e}
.gm-rm-n{flex:1 1 auto;min-width:0;font-size:13px;color:var(--cyan-dim)}
.gm-rm-acts{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}.gm-rm-acts button{min-height:44px}
.gm-rm-none{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}.gm-rm-none p,.gm-rm-hint{margin:0;color:var(--cyan-dim);overflow-wrap:anywhere;flex:1 1 180px}.gm-rm-hint{margin-top:6px;font-size:13px}
@media (min-width:1100px){.gm-cols{display:grid;gap:18px;align-items:start}.gm-cols.gm-c2{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}.gm-col{display:flex;flex-direction:column;gap:18px;min-width:0}.gm-col>.gm-sec{margin:0}.gm-col .gm-cards{grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}}
@media (min-width:1100px){.gm-sec.gm-wide{margin-top:18px}.gm-wide .rw{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;align-items:end}.gm-wide .rw > :not(.rw-bundle):not(.rw-nums){grid-column:1/-1}.gm-wide .rw-rows{display:block;columns:2;column-gap:18px}.gm-wide .rw-rows > .rw-row{break-inside:avoid;margin-bottom:8px}.gm-wide .gm-targets{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}}
@media (min-width:1500px){.gm-cols.gm-c3{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr) minmax(0,1fr)}.gm-tog .ar,.gm-chip{font-size:13px}}
@media (pointer:coarse),(max-width:720px){.gm-tog,.gm-hp button{min-height:44px}.gm-sec textarea{font-size:16px}}
@media(max-width:720px){.gm-sec{padding:4px 14px}.gm-sec h2{margin:0;letter-spacing:.2em}.gm-sec>.gm-body{margin:6px 0 10px}.gm-chk{min-height:44px}.gm-cards{grid-template-columns:1fr}}`);

  // ── section shell ──
  const section = (id, title, body, openDefault = false, hsum = false) => {
    const isOpen = open[id] ?? openDefault;
    return `<section class="win gm-sec" data-sec="${id}"><span class="cb"></span><h2><button type="button" class="gm-tog" data-tog="${id}" aria-expanded="${isOpen}" aria-controls="gm-b-${id}"><span class="ar" aria-hidden="true">${isOpen ? '▾' : '▸'}</span>${esc(title)}</button>${hsum ? `<span class="gm-hsum" id="gm-hsum-${id}"></span>` : ''}</h2><div class="gm-body" id="gm-b-${id}" ${isOpen ? '' : 'hidden'}>${body}</div></section>`;
  };
  const txt_ = (id, label, extra = '') => ui.field(label, `<input type="text" id="${id}" autocomplete="off" ${extra}>`);
  const sel_ = (id, label, opts, extra = '') => ui.field(label, `<select id="${id}" ${extra}>${opts}</select>`);
  const opt = (v, l = v) => `<option value="${esc(v)}">${esc(l)}</option>`;

  // ── party board ──
  // a condition carries its def (a SheetStatus): its label is the one the hunter's own sheet shows
  const condLabel = c => String(c.def.label).slice(0, 40);
  const cardHtml = (h, remote, key) => {
    const v = vitalsOf(h), ft = clamp(num(h.fatigue), 0, v.fatigueMax), wkey = remote ? key : sheetKeyOf(S().settings.deviceId, h.id);
    const rank = RANKS.includes(h.rank) ? h.rank : 'E';
    // the vitals' chips; the penalty's chip is `pen` below, with its days. While this phone's fight holds the hunter its row
    // holds the life (row-life.ts), so the chips and the life's button read the row's, as the combat card does
    const row = heldRow(remote ? { key } : { hid: h.id }), life = row ? row.life : h.life;
    const drawn = life ? vitalChipsOf({ life, collapsed: h.collapsed }).map(k => `<span class="gm-chip pen"${ofLife(k) ? ` data-life-at="${life.at}"` : ''}>${esc(chipDef(k).label)}</span>`).join('') : '';
    // a dead hunter's revive ladder: whether the System can still raise it (the GM applies the hour, world rule 3)
    const ladder = life && life.at === 'dead' && RAISE_CHIPS[h.reviveLeft] ? `<span class="gm-chip" data-raise-chip>${esc(RAISE_CHIPS[h.reviveLeft])}</span>` : '';
    const debtTag = debtChip(h.debt), debt = debtTag ? `<span class="gm-chip pen" data-debt-chip>${esc(debtTag)}</span>` : '';
    const guildTag = guildChip(h.guild), guild = guildTag ? `<span class="gm-chip" data-guild-chip>${esc(guildTag)}</span>` : '';
    const revive = life && can(life, 'revive') ? `<button type="button" class="primary" data-grevive aria-label="Revive ${esc(h.name)}">Revive</button>` : '';
    const cond = drawn + (Array.isArray(h.conditions) ? h.conditions : []).filter(c => c && typeof c.key === 'string')
      .map(c => remote
        ? `<span class="gm-chip rm">${esc(condLabel(c))}${c.rounds ? ` · ${esc(int(c.rounds))} round${int(c.rounds) === 1 ? '' : 's'}` : ''}<button type="button" class="gm-x" data-rmstatus="${esc(c.key)}" aria-label="Remove ${esc(condLabel(c))} from ${esc(h.name)}">✕</button></span>`
        : `<span class="gm-chip">${esc(condLabel(c))}${c.rounds ? ` (${esc(int(c.rounds))})` : ''}</span>`).join('');
    const quests = (Array.isArray(h.quests) ? h.quests : []).filter(q => q && q.kind === 'daily');
    const done = quests.filter(q => q.status === 'done').length;
    const active = (Array.isArray(h.quests) ? h.quests : []).filter(q => q && q.status === 'active').length;
    const activeChip = remote ? `<span class="gm-chip">${active} active quest${active === 1 ? '' : 's'}</span>` : '';
    const dailyChip = quests.length ? `<span class="gm-chip ${done === quests.length ? 'ok' : ''}">Daily ${done}/${quests.length}</span>` : '<span class="gm-chip">No daily quests</span>';
    const streak = h.daily && num(h.daily.streak) ? `<span class="gm-chip">Daily streak ${esc(int(h.daily.streak))}</span>` : '';
    const pen = h.penalty ? `<span class="gm-chip pen">Penalty${h.penalty.days ? ` (${esc(int(h.penalty.days))} day${int(h.penalty.days) === 1 ? '' : 's'})` : ''}</span>` : '';
    const bar = (cls, label, v, m) => `<div class="bar-row"><div class="bar-head"><span class="lbl">${label}</span><span class="bar-nums">${esc(ui.fmt(v))} / ${esc(ui.fmt(m))}</span></div><div class="bar bar-${cls}" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${esc(m)}" aria-valuenow="${esc(v)}">${motion.fillMarkup(m > 0 ? v / m : 0)}</div></div>`;
    const hid = esc(remote ? key : h.id), path = A().build.label(h); // path name + active perks, validated against rules()
    return `<article class="gm-card${remote ? ' remote' : ''}" data-hid="${hid}">
      <h3>${ui.rankBadge(rank)}${A().identity.badge(h, 'sm')}<span>${esc(h.name)}</span></h3>
      <div class="tagline">Lv ${esc(int(h.level) || 1)}${h.job ? ' · ' + esc(h.job) : ''}${path ? ` · <span data-gmpath>${esc(path)}</span>` : ''}${remote ? ' · player phone' : ''}</div>
      ${bar('hp', 'HP', v.hp, v.hpMax)}${bar('mana', 'Mana', v.mana, v.manaMax)}${bar('ft', 'Fatigue', ft, v.fatigueMax)}
      <div class="gm-chips">${ladder}${debt}${guild}${pen}${activeChip}${dailyChip}${streak}${cond}</div>${weightCard(h.name, wkey)}
      ${h.chronicle ? `<button type="button" class="gm-chron" data-gchron aria-label="${esc(CHRONICLE_WORDS.title)} of ${esc(h.name)}">${esc(boardLine(h.chronicle))}</button>` : ''}
      <div class="gm-hp" role="group" aria-label="Quick HP for ${esc(h.name)}">
        <span class="lbl gm-hp-lbl">Quick HP</span>
        <button type="button" data-hp="-5" aria-label="Damage 5 to ${esc(h.name)}" title="Damage 5 to ${esc(h.name)}">−5</button><button type="button" data-hp="-1" aria-label="Damage 1 to ${esc(h.name)}" title="Damage 1 to ${esc(h.name)}">−1</button>
        <button type="button" data-hp="1" aria-label="Heal 1 to ${esc(h.name)}" title="Heal 1 to ${esc(h.name)}">+1</button><button type="button" data-hp="5" aria-label="Heal 5 to ${esc(h.name)}" title="Heal 5 to ${esc(h.name)}">+5</button>
        ${revive}${remote ? `<button type="button" data-rstatus aria-label="Add status to ${esc(h.name)}" title="Add status to ${esc(h.name)}">+ Status</button>` : ''}<button type="button" data-hbuild aria-label="Build for ${esc(h.name)}">Build</button><button type="button" data-hguild aria-label="Guild for ${esc(h.name)}">${esc(GUILD_WORDS.button)}</button><button type="button" data-ggive aria-label="Give a bundle to ${esc(h.name)}">Give award…</button></div>
      <div class="hp-amt" role="group" aria-label="Type an HP amount for ${esc(h.name)}">
        <label class="field"><span class="lbl">HP amount</span><input type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" spellcheck="false" placeholder="7 (or +5 to heal)" title="Press Enter to deal damage. Type +5 or press Shift+Enter to heal." data-gmamt aria-label="HP amount for ${esc(h.name)}"></label>
        <button type="button" class="danger" data-gmdmg aria-label="Damage ${esc(h.name)}">Damage</button><button type="button" data-gmheal aria-label="Heal ${esc(h.name)}">Heal</button></div>
    </article>`;
  };
  // ── the table weight (core/table-weight.ts): the GM's hidden weight on the hunters' dice outside a fight ──
  /** The sheet keys of the hunters at the table: this phone's, made from its device, then the players' in the room. */
  const tableKeys = () => S().hunters.map(h => sheetKeyOf(S().settings.deviceId, h.id)).concat(remotes().map(r => r.key));
  const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  /** A stepper of the table weight: `attrs` names what it sets, each tap sets the value it shows plus or minus one. */
  const weightStepper = (label, n, attrs, name) => `<span class="gm-wstep"><span class="lbl">${esc(label)}</span>`
    + `<button type="button" ${attrs} data-weigh-to="${n - 1}" aria-label="Lower fudge on ${esc(name)}">−</button><b>${signed(n)}</b>`
    + `<button type="button" ${attrs} data-weigh-to="${n + 1}" aria-label="Raise fudge on ${esc(name)}">+</button></span>`;
  /** The Party board's line for every hunter's weight. */
  const weightTable = () => `${weightStepper('Fudge on all hunters\' rolls', S().tableWeight.hunters, 'data-weigh-scope="hunters"', 'all hunters\' rolls')}<p class="gm-whint">Hidden roll bias (secret from players). Positive numbers nudge dice higher. Negative numbers nudge them lower.</p>`;
  /**
   * A card's weight: the line that says what its hunter's dice read while any is on, the hunters' and its own added
   * ("Fudge +2", "Next d20 forced to 20"), then the stepper of its own and its Force next d20 choice.
   */
  function weightCard(name, wkey) {
    const tw = S().tableWeight, w = weightOf(tw, wkey), face = [[20, 'Natural 20'], [1, 'Natural 1'], [null, 'Don\'t force']];
    const line = w.total !== 0 || w.force !== null ? `<div class="gm-wline" data-weightline>${w.total !== 0 ? `<b>Fudge ${signed(w.total)}</b>` : ''}${w.force !== null ? `<b>Next d20 forced to ${w.force}</b>` : ''}</div>` : '';
    return `${line}<div class="gm-weight" role="group" aria-label="Fudge on ${esc(name)}'s rolls">${weightStepper(`Fudge on ${name}'s rolls`, tw.own[wkey] ?? 0, `data-weigh-scope="own" data-weigh-key="${esc(wkey)}"`, `${name}'s rolls`)}`
      + `<span class="gm-wnext"><span class="lbl">Force ${esc(name)}'s next d20</span><span class="seg" role="group" aria-label="Force ${esc(name)}'s next d20">${face.map(([f, l]) =>
        `<button type="button" data-weigh-force="${esc(wkey)}" data-face="${f ?? ''}" aria-pressed="${w.force === f}">${l}</button>`).join('')}</span></span></div>`;
  }
  /** The Party board's heading carries the gold dot while a hunter at the table has a weight or a forced roll. */
  function paintWeightDot() {
    const tog = root.querySelector('[data-tog="party"]'), on = weightOn(S().tableWeight, tableKeys()), dot = tog.querySelector('.gm-wdot');
    if (on === !!dot) return;
    if (on) { tog.insertAdjacentHTML('beforeend', '<i class="gm-wdot" aria-hidden="true"></i>'); tog.setAttribute('aria-label', 'Party board, fudge on'); }
    else { dot.remove(); tog.removeAttribute('aria-label'); }
  }
  /** The `weigh` messages of `bodies` (table-weight.ts `Weigh`), each under its hunter's key so a newer one takes the place of one still waiting. */
  const weighEvents = bodies => bodies.flatMap(body => { const ev = A().sync.event('weigh', body); return ev ? [{ key: standsFor(ev), event: ev }] : []; });
  /**
   * `e` on the GM's table weight, and a `weigh` to each player's hunter in the room whose weight it changes (`weighsFor`),
   * in one write. A tap comes here (`tap`: the board says so when what it sent waits for the room), and so does a
   * player's roll that spends a force, so the player's phone hears every change the GM's phone makes.
   */
  function weigh(e, tap) {
    const tw = S().tableWeight, after = weightStep(tw, e);
    if (after === tw) return;
    const events = weighEvents(weighsFor(tw, after, remotes().map(r => r.key)));
    if (gmWrite('gm-weight', s => weighed(s, e), events, []) && tap && events.length && !goesNow()) say('#gm-board-msg', 'Saved. Players\' phones will get the fudge once the room server confirms it.');
  }
  const weighTap = e => weigh(e, true);
  /** The players' hunters this phone has sent their weight to since each joined the room (table-weight.ts `WeightsTold`). */
  const toldMemory = store.device('weights-told');
  /**
   * The room's sheets changed: each player's hunter that joined since is sent its whole weight (`weightsJoined`), in one
   * write; the hunters told are kept only once that write is made, so a refused one is tried with the next sheets.
   */
  function weighJoined() {
    const code = room();
    if (!code || app.seat() !== 'gm') return;
    const was = toldMemory.read(), r = weightsJoined(was, code, remotes().map(x => x.key), S().tableWeight);
    if (r.weighs.length && !gmWrite('gm-weight', null, weighEvents(r.weighs), [])) return;
    if (JSON.stringify(r.told) !== JSON.stringify(was)) toldMemory.write(r.told);
  }

  // the GM tab's room strip: state at a glance; the Room view (#/room) has the QR, link and the player list
  const MARK = { live: '● Live', connecting: '○ Connecting', reconnecting: '! Reconnecting' };
  function renderRoom() {
    const box = $('#gm-room'); if (!box) return;
    const sy = A().sync, st = sy.status(), cn = sy.conn();
    const code = room(); let html = '';
    if (st === 'off') html = '';
    else if (!code) {
      // the last room when this phone holds its key, else the newest key in the ring; a room that is gone took its key with it (link.ts)
      const lr = sy.lastRoom(), rc = lr && lr.gm ? lr.code : sy.gmRooms()[0]?.code || '';
      html = `<div class="gm-rm-none"><p>${rc ? 'Not in a room.' : 'No room yet.'}</p><div class="gm-rm-acts">${rc ? `<button type="button" class="primary" data-gmrejoin="${esc(rc)}">Reopen ${esc(rc)} as GM</button><button type="button" data-gmcreate>New room</button>` : '<button type="button" class="primary" data-gmcreate>Create room</button>'}</div></div>`;
    } else {
      const rs = sy.roster();
      const on = rs.filter(r => r.state === 'online').length, away = rs.filter(r => r.state === 'away').length, unk = rs.some(r => r.state === 'unknown');
      const n = !rs.length ? '' : unk ? `${rs.length} player${rs.length === 1 ? '' : 's'}` : `${on} online${away ? `, ${away} away` : ''}`;
      html = `<div class="gm-rm-row"><b class="gm-rm-code" data-gmroomcode><span>${esc(code.slice(0, 3))}</span><span>${esc(code.slice(3))}</span></b>${MARK[cn] ? `<span class="gm-rm-st" data-conn="${esc(cn)}">${MARK[cn]}</span>` : ''}<span class="gm-rm-n" data-gmcount>${esc(n)}</span>
        <div class="gm-rm-acts"><button type="button" class="${rs.length ? '' : 'primary'}" data-gminvite>Invite</button></div></div>${rs.length ? '' : '<p class="gm-rm-hint">No players yet. Tap Invite to share the QR code or join link.</p>'}`;
    }
    if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
  }
  function renderBoard() {
    renderRoom();
    paintWeightDot();
    const wt = $('#gm-weight'), wsig = weightTable();
    if (wt.dataset.sig !== wsig) { wt.dataset.sig = wsig; wt.innerHTML = wsig; }
    const s = S(), rs = remotes();
    const cards = s.hunters.map(h => cardHtml(h, false)).concat(rs.map(r => cardHtml(r.data, true, r.key)));
    const html = cards.join('') || '<p class="empty">No hunters yet.</p>';
    const b = $('#gm-board');
    if (b.dataset.sig !== html) {
      const ae = document.activeElement, keep = ae && ae.matches && ae.matches('[data-gmamt]') && b.contains(ae) ? { hid: ae.closest('[data-hid]').dataset.hid, v: ae.value, at: ae.selectionStart } : null;
      b.dataset.sig = html; b.innerHTML = html;
      if (keep) { const i = [...b.querySelectorAll('[data-hid]')].find(c => c.dataset.hid === keep.hid); const inp = i && i.querySelector('[data-gmamt]'); if (inp) { inp.value = keep.v; inp.focus(); inp.setSelectionRange(keep.at, keep.at); } }
    }
  }
  /**
   * The hunters the GM may pick: this phone's, then the players' sheets. Each is a hunter reference (src/core/ids.ts
   * `HunterRef`) and the id its checkbox carries: a hunter id or a sheet key, which never look alike (a sheet key holds a ':').
   */
  const targetList = () => pickables(S().hunters, remotes());
  function renderTargets() {
    const items = targetList();
    for (const k of [...sel]) if (!items.some(i => i.id === k)) sel.delete(k);
    const box = $('#gm-targets'), sig = items.map(i => i.id + i.name).join('|');
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.innerHTML = items.map(i => `<label class="gm-chk"><input type="checkbox" data-sel="${esc(i.id)}"><span>${esc(i.name)}${i.ref.kind === 'remote' ? ' (player phone)' : ''}</span></label>`).join('');
    }
    box.querySelectorAll('input[data-sel]').forEach(c => { c.checked = sel.has(c.dataset.sel); });
    const all = $('#gm-all'); all.checked = items.length > 0 && sel.size === items.length;
    const n = sel.size;
    for (const id of ['#gm-sel-sum-a', '#gm-sel-sum-q']) { const e = $(id); if (e) e.textContent = n ? `${n} selected` : 'No hunters selected'; }
    { const e = $('#gm-sel-sum-b'); if (e) e.textContent = n ? `(${n})` : '(none)'; }
    const names = items.filter(i => sel.has(i.id)).map(i => i.name), to = !n ? 'To: nobody selected' : `To: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`;
    for (const id of ['award', 'quest', 'bcast']) { const e = $('#gm-hsum-' + id); if (e) e.textContent = id === 'bcast' && ($('#gm-b-to-all') || {}).checked ? 'To: everyone' : to; }
    return items;
  }
  /** The picked hunters: this phone's by hunter id, the players' by sheet key. */
  const picked = () => {
    const refs = targetList().filter(i => sel.has(i.id)).map(i => i.ref);
    return { local: refs.flatMap(r => (r.kind === 'local' ? [r.hunterId] : [])), remote: refs.flatMap(r => (r.kind === 'remote' ? [r.remote] : [])) };
  };
  const nameOf = id => (store.hunter(id) || {}).name || id;

  // ── remote hunters: HP and status for the player's phone, posted to the outbox (src/core/sync/outbox.ts) ──
  /** Posts a room message: the outbox keeps it in the save and sends it until the room takes it, once. Answers `sync.post`'s answer. */
  const roomPost = (type, body) => { const sy = A().sync; return sy.post(sy.event(type, body)); };
  /**
   * Whether a message just posted goes now (this phone is connected to the room) or waits in the outbox for the room's next
   * answer (`postNews`): asked only after a post that was made.
   */
  const goesNow = () => postNews({ ok: true }, A().sync.conn()) === 'sent';
  /** Why `sync.post` posted nothing (`noRoom`, `notEvent`), or null when it posted. */
  const whyNot = r => ('why' in r ? r.why : null);
  /** Why a message was not posted, for the line under the form. */
  const notPosted = (r, who) => (whyNot(r) === 'noRoom' ? `${who}. Create a room with the room button at the top to reach players' phones.` : `${who}. The room server rejected this message.`);
  const remoteName = key => sheetName(remotes(), key, 'hunter');
  /** A remote hunter's row in this phone's fight: it holds the hunter's HP and statuses until the fight ends, so the board's edit goes to it. */
  const fightRowOf = key => { const at = A().hunter.fightOf({ key }); return at && at.at === 'row' ? at.cid : null; };
  /** The row of this phone's fight that holds hunter `who` (this phone's by `hid`, a player's by `key`), or null. */
  const heldRow = who => { const at = A().hunter.fightOf(who), f = S().fight; return at && at.at === 'row' && f ? f.rows.find(r => r.id === at.cid) || null : null; };
  function sendHp(key, n) {
    const name = remoteName(key), cid = fightRowOf(key);
    if (cid !== null) { if (ui.wrote('GM', A().combat.adjust(cid, { hp: n }))) say('#gm-board-msg', `${n < 0 ? 'Damaged' : 'Healed'} ${name} by ${Math.abs(n)} in the fight.`); return; }
    const p = postable('hp', { to: [key], hp: n, reason: 'GM' }), hp = `${n < 0 ? '−' : '+'}${Math.abs(n)} HP`;
    if (!p.ev) return say('#gm-board-msg', notPosted(p, `Not sent to ${name}`), true);
    if (!gmWrite('gm-hp', null, [p.ev], [line('system', `${n < 0 ? 'Damage' : 'Heal'} ${Math.abs(n)}`, name)])) return;
    say('#gm-board-msg', goesNow() ? `Sent ${hp} to ${name}.` : `Saved. ${name} will get ${hp} once the room server confirms it.`);
  }
  /**
   * Revive of a player's dead hunter. One this phone's fight holds is revived there (the fight's `life` command), and its
   * phone hears the new life in the room's `vitals`; one no fight holds gets the room's `revive`, with its log line.
   */
  function sendRevive(key) {
    const name = remoteName(key), cid = fightRowOf(key);
    if (cid !== null) { if (ui.wrote('GM', A().combat.revive(cid))) say('#gm-board-msg', `Revived ${name} in the fight.`); return; }
    const p = postable('revive', { to: [key] });
    if (!p.ev) return say('#gm-board-msg', notPosted(p, `Not sent to ${name}`), true);
    if (!gmWrite('gm-revive', null, [p.ev], [line('system', 'Revive', name)])) return;
    say('#gm-board-msg', goesNow() ? `Sent Revive to ${name}.` : `Saved. ${name} will be revived once the room server confirms it.`);
  }
  /** One status put on (`add`) or taken off (`remove`) a player's hunter: on its row in this phone's fight, else posted. */
  function sendStatus(key, change, verb) { // verb(name) → confirmation line
    const name = remoteName(key), cid = fightRowOf(key), a = change.add;
    if (cid !== null) {
      if (ui.wrote('GM', A().combat.status(cid, a ? { add: { key: a.key, def: a.def, rounds: a.rounds, tier: a.source.tier } } : { remove: change.remove }))) say('#gm-board-msg', `${verb(name)}.`);
      return;
    }
    const r = roomPost('status', { to: [key], ...(a ? { add: [a] } : { remove: [change.remove] }) });
    if (!r.ok) return say('#gm-board-msg', notPosted(r, `Not sent to ${name}`), true);
    say('#gm-board-msg', goesNow() ? `${verb(name)}.` : `Saved. The status change for ${name} will sync once the room server confirms it.`);
  }
  async function addRemoteStatus(key) {
    const name = remoteName(key);
    const rank = (remotes().find(x => x.key === key) || { data: { rank: 'E' } }).data.rank;
    const res = await A().forge.status({ mode: 'apply', title: `Status for ${name}`, target: name, rank });
    const r = remotes().find(x => x.key === key);
    if (!res || !res.key || !r) return;
    const def = res.def || app.rules().conditions[res.key];
    sendStatus(key, { add: { key: res.key, rounds: res.rounds ?? null, def, source: res.source || gmSource(r.data.rank) } }, n => `Sent ${def.label} status to ${n}`);
  }

  // ── award: the reward editor (app.api.maker.rewards) and who gets it ──
  /** @type {import('../core/api.ts').RewardEditor | null} */
  let editor = null;
  /**
   * The Award form's tie to a fight's drop, and what it opens with when the GM view is next drawn: the one value of the
   * machine in src/core/award.ts, stepped only by `draft`.
   * @type {import('../core/award.ts').AwardDraft}
   */
  let awardDraft = BLANK_DRAFT;
  /** @type {import('../core/api.ts').QuestFields | null} Issue quest's fields: the one quest form (quest-fields.js) */
  let questForm = null;
  /**
   * The Award form after `e`: its draft stepped (award.ts `draftStep`), the form filled or emptied as the step says, and
   * the line that names the loot it holds drawn again. Answers whether the table took it.
   * @param {import('../core/award.ts').AwardDraftEvent} e
   */
  function draft(e) {
    const r = draftStep(awardDraft, e); if (!r) return false;
    awardDraft = r.draft;
    if (r.form.do === 'fill') editor.set(r.form.rewards, r.form.bundle || undefined);
    else if (r.form.do === 'clear') editor.set(newRewards());
    showTie();
    return true;
  }
  /** The drop the Award form holds while it waits; null for a form tied to none, or once the drop was dealt with. */
  const tiedDrop = () => (awardDraft.at === 'tied' && awardDraft.tie.kind === 'drop' ? dropWaiting(S().loot, awardDraft.tie.fight) : null);
  /** The waiting reward a send from `form` approves, while it still waits; null for a form tied to none. */
  const waitingOf = (form = awardDraft) => { const id = sendApproves(form); return id ? pendingOf(S()).find(p => p.id === id && p.at === 'waiting') || null : null; };
  /** The line over the reward that says what the form is tied to (a fight's loot, a waiting reward), and the send's words. */
  function showTie() {
    const p = root && root.querySelector('#gm-award-tie'), d = tiedDrop(), w = waitingOf(), g = sendGives(awardDraft); if (!p) return;
    p.hidden = !d && !w && !g;
    p.textContent = d ? `Fight loot: ${dropLine(d, ui.fmt)}. Tap Send award to give it, or collapse the Award section to save it for later.` : w ? PENDING_WORDS.tie(w.name, w.from, w.what)
      : g ? SHELF_WORDS.tie(g.given.name, whoName(g.to)) : '';
    const go = root.querySelector('#gm-award-go'); if (go) go.textContent = w ? PENDING_WORDS.approve : g ? SHELF_WORDS.send : 'Send award';
  }
  // Award loot… opens the drop the Loot dropped window offered, the oldest waiting (combat.js `offerDrop`)
  app.api.award = { open(rewards, bundleId, drop) {
    const d = drop ? lootOffered(S().loot) : null;
    draft({ type: 'open', rewards, bundle: bundleId || null, tie: d ? { kind: 'drop', fight: d.fight } : null }); app.go('gm');
  } };
  function openDraft() {
    if (!draft({ type: 'drawn' })) return;
    open.award = true; applyOpen();
    say('#gm-award-msg', waitingOf() ? '' : 'Select who gets it, then tap Send award.');
    // after the view is shown (routing scrolls a newly shown view to its top)
    requestAnimationFrame(() => { const sec = root.querySelector('.gm-sec[data-sec="award"]'); if (sec) sec.scrollIntoView({ block: 'start' }); });
  }
  function doAward() {
    const g = sendGives(awardDraft);
    if (g) {
      if (editor.blocked()) return say('#gm-award-msg', UNFINISHED_ROWS, true);
      const tied = awardDraft;
      holdGive(g.to, editor.value(), g.given, '#gm-award-msg', () => { if (awardDraft === tied) draft({ type: 'sent' }); });
      return;
    }
    const w = waitingOf(), { local, remote } = w ? recipient(w) : picked();
    if (!local.length && !remote.length) return say('#gm-award-msg', 'Select at least one hunter.', true);
    if (editor.blocked()) return say('#gm-award-msg', UNFINISHED_ROWS, true);
    const rw = editor.value();
    if (isEmptyReward(rw)) return say('#gm-award-msg', 'Add something to the reward: XP, gold, ability points, or an item, skill, title, boon, or status.', true);
    if (sendAward(local, remote, rw, null, '#gm-award-msg', awardDraft)) draft({ type: 'sent' });
  }
  /** Who a waiting reward is for, as Send award takes it: this phone's hunter by id, a player's by sheet key. */
  const recipient = w => { const hid = localHunter(S(), w); return hid ? { local: [hid], remote: [] } : { local: [], remote: [w.to] }; };
  /**
   * `rw` given to this phone's hunters `local` and posted to the players' `remote`, in one write with its log line (and,
   * from the Award form, the drop its draft holds dealt with, award.ts `sendDeals`: a loot send that would miss a picked
   * player is not made). `bundle`: the bundle it was given from by hand (the GM's awards for roleplay), recorded in each
   * hunter's chronicle and shown in its window's words. From a form tied to a reward waiting for the GM, the send is its
   * approval: the record approved in the same write (hunter/pending.ts `pendingApproved`), so a second approve, from the
   * list or another tab, writes and posts nothing. Says what it did under `msg`; answers whether it wrote.
   * @param {string[]} local @param {import('../core/ids.ts').SheetKey[]} remote @param {import('../core/rewards.ts').Rewards} rw
   * @param {import('../core/protocol.ts').GivenBundle | null} bundle @param {string} msg @param {import('../core/award.ts').AwardDraft} [form]
   */
  function sendAward(local, remote, rw, bundle, msg, form = BLANK_DRAFT) {
    const bits = bundle ? bundle.name : [...rewardLines(app.rules(), rw)].join(', '), approves = sendApproves(form), w = waitingOf(form);
    if (approves && !w) { say(msg, PENDING_WORDS.refusals.answered, true); return false; }
    const earned = w ? { from: w.from, what: w.what } : null;
    // a player's hunter in this phone's fight: the row holds its statuses, so the reward's go on the row (in the award's write) and the award posted holds the rest
    const held = remote.length && rw.statuses.length ? remote.filter(k => fightRowOf(k) !== null) : [], free = remote.filter(k => !held.includes(k));
    const { statuses: _onRow, ...kept } = rw, rest = { ...newRewards(), ...kept };
    const awards = [{ to: free, rewards: rw }, { to: held, rewards: rest }].filter(a => a.to.length && (bundle || !isEmptyReward(a.rewards)))
      .map(a => ({ to: a.to, p: postable('award', { ...a, ...(bundle ? { bundle } : {}), ...(earned ? { earned } : {}) }) }));
    const lost = remote.filter(k => awards.some(a => !a.p.ev && a.to.includes(k))), posted = remote.filter(k => !lost.includes(k));
    const failed = !lost.length ? '' : awards.some(a => a.p.why === 'noRoom') ? `${andList(lost.map(remoteName))} need${lost.length === 1 ? 's' : ''} a room. Create or reopen one with the room button at the top.` : `Not sent to ${andList(lost.map(remoteName))}. The room server rejected this award.`;
    const deal = sendDeals(form, lost.length);
    if (isRefused(deal)) { say(msg, `${failed} Nothing was sent, and the loot is still saved.`, true); return false; }
    // a waiting reward is approved only with its award: one the room would not take stays waiting, never lost
    if (approves && lost.length) { say(msg, `${failed} Nothing was sent, and the reward is still pending.`, true); return false; }
    const here = local.map(nameOf), away = posted.map(remoteName);
    const said = here.length || away.length ? [line('award', bundle ? 'GM gave' : earned ? 'GM approved' : 'GM award', `${earned ? `${PENDING_WORDS.earned(earned.from, earned.what)}: ` : ''}${bits} → ${[...here, ...away].join(', ')}`, local[0] || null)] : [];
    // every hunter of this phone granted, every player's award posted, the log line, and what this phone's fight holds
    // (each local hunter's fight parts, a held player's statuses) on the rows: one write (src/core/award.ts, hunter.grantWrite)
    const locals = local.map(hid => ({ hid, vitals: /** @type {import('../core/hunter/grant.ts').VitalsAt} */ (A().hunter.fightOf({ hid }) ? 'fight' : 'sheet') }));
    const day = { ...stepTime(S(), new Date()), R: app.rules() }, events = awards.flatMap(a => (a.p.ev ? [a.p.ev] : [])), code = room();
    const players = playerHeld(remotes(), posted.filter(k => held.includes(k)), rw.statuses);
    const out = A().hunter.grantWrite(bundle ? 'gm-give' : 'gm-award', sv => {
      const a = gmAward(sv, locals, rw, { room: code, events, said }, day, bundle, earned ? earned.from : null), dealt = deal.deals ? dropDealt(a.save, deal.deals) : a.save;
      const save = approves && !isRefused(dealt) ? pendingApproved(dealt, approves, rw) : dealt;
      if (isRefused(save)) return save;
      return { ...a, save, held: [...a.granted.map(({ hid, g }) => ({ who: { hid }, ...g.fight })), ...players] };
    });
    if (isRefused(out)) { say(msg, out.why === 'no-drop' ? `${LOOT_WORDS['no-drop']} Nothing was sent.` : out.why === 'answered' || out.why === 'no-reward' ? PENDING_WORDS.refusals[out.why] : 'Could not save. Nothing was sent.', true); return false; }
    if (events.length) A().sync.flush();
    // one System popup per hunter, queued by ui.system; a bundle's in its own words
    const words = bundle && bundle.window ? { title: bundle.window.title, body: bundle.window.line || bundle.name, tag: '! Reward', kind: 'quest' }
      : earned ? { title: 'REWARD RECEIVED', body: PENDING_WORDS.approvedBody(earned.from, earned.what), tag: '! Reward', kind: 'quest' } : undefined;
    for (const { hid, g } of out.granted) A().hunter.granted(hid, g, words);
    const sentTo = names => (names.length ? (earned ? PENDING_WORDS.approved(andList(names)) : `${bundle ? `Gave ${bundle.name} to` : 'Sent to'} ${andList(names)}.`) : '');
    const waiting = away.length && !goesNow() ? `Saved. ${andList(away)} will get it once the room server confirms it.` : '';
    say(msg, [waiting ? sentTo(here) : sentTo([...here, ...away]), waiting, failed].filter(Boolean).join(' '), !!lost.length);
    return true;
  }
  /** The keys of the last awards given from this phone, newest first (bundles.ts `readRecent`, `recentGives`). */
  const recentMemory = store.device('give-recent');
  /**
   * The GM's awards for roleplay (src/core/registry/bundles.ts): Give… opens the shelf (give-shelf.js) for one hunter of
   * the board. In a room the award tapped opens in the Award form, tied to its bundle and hunter, and the form's Give is
   * held (`holdGive`); alone the award tapped is held at once. `id`: this phone's hunter id or a player's sheet key.
   * @param {string} id
   */
  async function giveFrom(id) {
    const own = A().bundles.list().map(b => ({ key: b.id, name: b.name, rewards: b.rewards, window: b.window || null }));
    const b = await giveShelf({ name: whoName(id), own, recent: readRecent(recentMemory.read()), R: app.rules() });
    if (!b) return;
    const given = { key: b.key, name: b.name, window: b.window };
    // ruling 20 (SMX-gates-5.2): in a room every reward is editable before a player sees it, so the pick opens the Award
    // form with the award filled in and only its Give is held; alone it is held as picked (hunter/pending.ts `ROUTE`)
    if (!rewardWaits(app.seat())) return holdGive(id, b.rewards, given, '#gm-board-msg');
    sel.clear(); sel.add(id);
    draft({ type: 'open', rewards: b.rewards, bundle: null, tie: { kind: 'shelf', given, to: id } }); openDraft(); renderTargets();
  }
  /** The name of hunter `id`: this phone's by hunter id, a player's by sheet key. */
  const whoName = id => (parseSheetKey(id) ? remoteName(id) : nameOf(id));
  /**
   * Award `rw` given as bundle `given` to hunter `id` (this phone's hunter id or a player's sheet key), held back for
   * `GIVE_HOLD_MS` under a toast with Undo (held.ts), then given by the one path an award takes (`sendAward`). Undo drops
   * it; nothing was written. `then` runs once it is given.
   */
  function holdGive(id, rw, given, msg, then = () => {}) {
    const key = parseSheetKey(id), heldIn = room();
    const give = () => {
      // a player's award goes to the room it was picked in, or not at all (SMX-gates-5.3b)
      if (key && room() !== heldIn) return say(msg, `Not given. The room changed before ${given.name} was sent.`, true);
      if (!sendAward(key ? [] : [id], key ? [key] : [], rw, given, msg)) return;
      recentMemory.write(recentGives(recentMemory.read(), given.key));
      then();
    };
    ui.toast(SHELF_WORDS.toastTag, SHELF_WORDS.given(given.name, whoName(id)), { hold: { what: { kind: 'give', to: id, bundle: given.key }, ms: GIVE_HOLD_MS, act: give, undo: SHELF_WORDS.undo } });
  }
  // ── Waiting for you: the rewards the app would have paid by itself, until the GM answers each (hunter/pending.ts) ──
  /** The rewards waiting in this phone's room, oldest first; none out of a room. */
  const waitingHere = () => { const code = room(); return code ? waitingIn(S(), code) : []; };
  /** Draws the list and its head summary ("2 waiting"). */
  function renderWaiting() {
    const list = waitingHere(), R = app.rules(), W = PENDING_WORDS, rs = remotes();
    const hunterOf = w => { const hid = localHunter(S(), w); return hid ? store.hunter(hid) : (rs.find(r => r.key === w.to)?.data ?? null); };
    const html = list.length ? list.map(w => {
      const targetH = hunterOf(w), owed = targetH?.debt ?? 0;
      const pay = paysDebt(w.from) && w.rewards.gold > 0 && owed > 0
        ? debtStep(owed, { type: 'clearGold', gold: w.rewards.gold }, R)
        : null;
      const paidInfo = pay && (pay.paid > 0 || pay.burn > 0)
        ? { total: w.rewards.gold, paid: pay.paid, burn: pay.burn, kept: pay.kept, left: pay.debt }
        : null;
      const keptAfterDebt = pay ? pay.kept : w.rewards.gold;
      const gCut = targetH && takesGuildCut(w.from) && keptAfterDebt > 0 ? guildGoldStep(keptAfterDebt, targetH, R) : null;
      const afterDebt = pay?.debt ?? owed;
      const baseXp = Math.trunc(w.rewards.xp || 0);
      const xpCut = afterDebt > 0 && baseXp > 0 && R.reviveDebtXpRate < 1
        ? { base: baseXp, xp: debtStep(afterDebt, { type: 'xp', xp: baseXp }, R).xp, rate: R.reviveDebtXpRate, left: afterDebt }
        : null;
      const dline = clearPreviewLine(paidInfo, gCut, xpCut);
      return `<li class="gm-pw-row" data-pw="${esc(w.id)}"><div><b>${esc(w.name)}</b> <span class="gm-pw-what">${esc(W.earned(w.from, w.what))}</span></div>`
        + `<div class="gm-pw-lines">${esc(rewardLines(R, w.rewards).join(', '))}</div>`
        + (dline ? `<div class="gm-pw-lines" data-pw-debt>${esc(dline)}</div>` : '')
        + `<div class="gm-row"><button type="button" class="primary" data-pw-approve>${esc(W.approve)}</button><button type="button" data-pw-edit>${esc(W.edit)}</button><button type="button" class="danger" data-pw-refuse>${esc(W.refuse)}</button></div></li>`;
    }).join('')
      : `<li class="empty">${esc(W.none)}</li>`;
    const ul = $('#gm-pw'); if (ul.dataset.sig !== html) { ul.dataset.sig = html; ul.innerHTML = html; }
    $('#gm-hsum-waiting').textContent = W.summary(list.length);
  }
  /**
   * The GM's answer to waiting reward `id`: approved as it stands (Send award's one path, tied to the record), opened in
   * the Award form's fields to edit first, or refused (its record and the player's window, one write).
   * @param {string} id @param {'approve' | 'edit' | 'refuse'} how
   */
  function answerWaiting(id, how) {
    const w = waitingHere().find(p => p.id === id); if (!w) return say('#gm-pw-msg', PENDING_WORDS.refusals['no-reward'], true);
    const to = recipient(w);
    if (how === 'approve') { sendAward(to.local, to.remote, w.rewards, null, '#gm-pw-msg', { at: 'tied', tie: { kind: 'pending', id: w.id } }); return; }
    if (how === 'edit') {
      sel.clear(); sel.add(to.local[0] || w.to);
      draft({ type: 'open', rewards: w.rewards, bundle: null, tie: { kind: 'pending', id: w.id } }); openDraft(); renderTargets(); return;
    }
    const log = { at: new Date().toISOString(), cap: app.rules().logCap };
    if (!ui.wrote('GM', store.apply('gm-refuse', s => pendingRefused(s, w.id, { stamp: A().sync.stamp(), log })))) return;
    A().sync.flush();
    say('#gm-pw-msg', PENDING_WORDS.refused(w.name));
  }
  /** "Mira", "Mira and Brakk", "Mira, Brakk and Eldrin". */
  const andList = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

  // ── broadcast ──
  const bcast = () => ({ tag: $('#gm-b-tag').value.trim() || '! Notification', title: $('#gm-b-title').value.trim(), body: $('#gm-b-body').value, kind: $('#gm-b-kind').value });
  function renderPreview() {
    const b = bcast(), p = $('#gm-prev');
    p.className = `gm-prev k-${SYS_KINDS.includes(b.kind) ? b.kind : 'info'}`;
    p.querySelector('.n-tag').textContent = b.tag; p.querySelector('.n-big').textContent = b.title || '(title)'; p.querySelector('.n-body').textContent = b.body;
  }
  function doBroadcast() {
    const b = bcast();
    if (!b.title) return say('#gm-b-msg', 'Enter a title.', true);
    const only = $('#gm-b-to-sel').checked, { local, remote } = picked();
    if (only && !remote.length && !local.length) return say('#gm-b-msg', 'Select hunters in Award first, or choose Everyone.', true);
    // the log line and the post are one write: the line never says Broadcast for a post that was not made, nor the
    // reverse; the window here shows only what was written
    const said = [line('system', `Broadcast: ${b.title}`, b.body)], shown = () => ui.system({ tag: b.tag, title: b.title, body: b.body || undefined, kind: b.kind });
    if (only && !remote.length) {
      if (!addLog('system', `Broadcast: ${b.title}`, b.body)) return;
      shown(); say('#gm-b-msg', `Shown here for the ${local.length === 1 ? 'hunter' : `${local.length} hunters`} picked on this phone.`); return;
    }
    const p = postable('system', { ...b, ...(only ? { to: remote } : {}) }), whom = only ? `${remote.length} selected hunter${remote.length === 1 ? '' : 's'}` : `room ${room()}`;
    if (!gmWrite('gm-broadcast', null, p.ev ? [p.ev] : [], said)) return;
    shown();
    if (!p.ev) say('#gm-b-msg', p.why === 'noRoom' ? 'Shown here. To reach players\' phones, create a room with the room button at the top.' : 'Shown here. The room server rejected this broadcast.', p.why !== 'noRoom');
    else say('#gm-b-msg', goesNow() ? (only ? `Sent to ${whom}.` : `Shown here and sent to ${whom}.`) : `Shown here and saved. It will go to ${whom} once the room server confirms it.`);
  }

  // ── issue quest ──
  function doIssue() {
    const why = questForm.check();
    if (why) return say('#gm-q-msg', why, true);
    const { local, remote } = picked(), secret = $('#gm-q-secret').checked;
    if (!local.length && !remote.length) return say('#gm-q-msg', 'Select at least one hunter in the Award section.', true);
    if (!questReaches({ secret }, local.length + remote.length)) return say('#gm-q-msg', SECRET_WORDS.oneHunter, true);
    const v = questForm.value();
    // the offer the room carries and the draft a hunter here is issued are the same quest (quests.ts `questOffer`)
    const quest = questOffer({ ...v, secret }, v.dueHours !== null ? dueIn(v.dueHours, new Date()) : null), partial = { ...quest, from: /** @type {const} */ ('gm') };
    let msg = '';
    if (local.length) { const ids = A().quests.issue(local, partial); msg = Array.isArray(ids) && ids.length ? `Issued to ${local.length} hunter${local.length === 1 ? '' : 's'}.` : 'Could not issue the quest. Try again.'; }
    if (remote.length) {
      const r = roomPost('quest', { to: remote, quest });
      msg += !r.ok ? (whyNot(r) === 'noRoom' ? ' Create or reopen a room to send quests to players on other phones.' : ' The room server rejected this quest.') : goesNow() ? ` Sent to ${remote.length} player${remote.length === 1 ? '' : 's'} in the room.` : ` Saved. ${remote.length} player${remote.length === 1 ? '' : 's'} in the room will get it once the room server confirms it.`;
    }
    say('#gm-q-msg', msg.trim());
  }

  // ── session start: a backup, then the session count and the world day in one step (world.ts `sessionStarted`) ──
  function startSession() {
    const backup = store.backupNow('session'), r = A().gates.startSession(backup);
    if (!r.ok) return say('#gm-s-msg', 'Could not start the session because the world day could not advance.', true);
    say('#gm-s-msg', `Session ${r.session} began on day ${r.day}. ${backup ? 'A backup was saved.' : 'Could not save a backup in this browser.'}`, !backup);
  }

  // ── spawn gate / world day ──
  function doSpawn() {
    const rank = $('#gm-g-rank').value, type = $('#gm-g-type').value, name = $('#gm-g-name').value.trim();
    const difficulty = parseDifficultyLevel(Number($('#gm-g-diff')?.value)) ?? undefined;
    const g = A().gates.spawn({ rank: rank || undefined, type: type || undefined, name: name || undefined, difficulty });
    if (!g) return;
    say('#gm-g-msg', `Spawned ${g.rank}-rank ${g.type} gate "${g.name}". It breaks on day ${g.breakDay}.`);
  }
  /** The world day moved by `n` (gates.js `advanceDay` writes its line); the day shown is redrawn by the change. */
  function advance(n) {
    if (!A().gates.advanceDay(n).ok) say('#gm-g-msg', 'Could not change the world day.', true);
  }

  // ── roll tables ──
  const tbl = () => TABLES.find(t => t.id === $('#gm-t-sel').value) || TABLES[0];
  const rank_ = () => $('#gm-t-rank').value;
  function listFor(t, rank = rank_()) {
    const tabs = /** @type {{ encounter?: Record<string, unknown>, [id: string]: unknown }} the GM's own tables, kept in the rules overrides */ (ov().gmTables || {});
    if (t.id === 'gate') return app.rules().gateNames.slice();
    if (t.id === 'encounter') return (tabs.encounter && Array.isArray(tabs.encounter[rank]) ? tabs.encounter[rank] : SEED.encounter[rank] || []).slice();
    return (Array.isArray(tabs[t.id]) ? tabs[t.id] : SEED[t.id] || []).slice();
  }
  /** The GM's roll table `t` written with `lines`: whether it was written. */
  const saveList = (t, lines) => setOv(o => writeTable(o, t.id, rank_(), lines));
  /** The GM's roll table `t` back to its seed: whether it was written. */
  const resetList = t => setOv(o => resetTable(o, t.id, rank_()));
  const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 200).map(x => x.slice(0, 300));
  function syncTableUi(force = false) {
    const t = tbl(), ta = $('#gm-t-list');
    $('#gm-t-rank-f').hidden = !t.ranked; $('#gm-t-edit').hidden = !!t.noEdit;
    const want = listFor(t).join('\n');
    if (force || (document.activeElement !== ta && !ta.dataset.dirty)) { if (ta.value !== want) ta.value = want; ta.dataset.dirty = ''; }
  }
  function doRoll() {
    const t = tbl(), rank = rank_();
    let text = '', fill = null;
    if (t.id === 'loot') {
      const r = A().inventory.rollLoot(rank, { boss: false });
      text = r.length ? r.map(e => (e.kind === 'gold' ? `${ui.fmt(e.gold)} gold` : `${e.item.name}${e.item.rar ? ` (${e.item.rar})` : ''}`)).join(', ') : 'Nothing.';
      text = `${rank}-rank loot: ${text}`;
    } else {
      const list = listFor(t);
      if (!list.length) return say('#gm-t-out', 'This table is empty. Add lines in the list below.', true);
      const pickLine = pick(list);
      if (t.id === 'urgent') {
        const [title, desc = '', xp = '0'] = pickLine.split('|').map(x => x.trim());
        text = `${title}${desc ? ': ' + desc : ''}${int(xp) ? ` (${int(xp)} XP)` : ''}`; fill = { title, desc, xp: int(xp) };
      } else text = t.id === 'encounter' ? `${rank}-rank fight: ${pickLine}` : pickLine;
    }
    const out = $('#gm-t-out'); out.textContent = text; out.classList.remove('bad');
    $('#gm-t-use').hidden = !fill; $('#gm-t-use').onclick = () => {
      if (!fill) return;
      const was = questForm.value();
      questForm.set({ kind: 'urgent', title: fill.title, desc: fill.desc, rewards: { ...was.rewards, xp: fill.xp || 0 }, dueHours: was.dueHours ?? 24 });
      open.quest = true; applyOpen(); say('#gm-q-msg', 'Filled from the roll table. Select hunters in the Award section, then tap Issue quest.'); $('#gm-qf [name=title]').scrollIntoView({ block: 'center' });
    };
    addLog('system', `Roll: ${t.label}`, text);
  }

  // ── rules editor ──
  function checkRules() {
    const ta = $('#gm-r-text'), raw = ta.value.trim() || '{}';
    let parsed; try { parsed = JSON.parse(raw); } catch (e) { return { err: `Invalid JSON: ${e.message}` }; }
    const { overrides, refused } = parseOverrides(parsed);
    return refused.length ? { err: refusalWords(refused[0]) } : { parsed: overrides, diff: diffCount(overrides, app.RULES) };
  }
  function liveRules() {
    const r = checkRules(), m = $('#gm-r-msg');
    $('#gm-r-save').disabled = !!r.err;
    m.textContent = r.err || `Valid. ${r.diff} setting${r.diff === 1 ? '' : 's'} differ${r.diff === 1 ? 's' : ''} from the defaults.`; m.classList.toggle('bad', !!r.err);
    $('#gm-r-text').setAttribute('aria-invalid', r.err ? 'true' : 'false');
  }
  const rulesJson = () => JSON.stringify(ovPublic(), null, 2);
  function saveRules() {
    const r = checkRules(); if (r.err) return liveRules();
    if (!setOv(o => saveRuleNumbers(o, r.parsed), [line('system', 'Rules overrides saved', `${r.diff} setting${r.diff === 1 ? '' : 's'} differ${r.diff === 1 ? 's' : ''} from the defaults.`)])) return;
    const ta = $('#gm-r-text'); ta.dataset.dirty = ''; ta.value = rulesJson();
    say('#gm-r-msg', `Saved. ${r.diff} setting${r.diff === 1 ? '' : 's'} overridden.`);
  }
  /** The GM's switch for every feat: one write of the override and its line in the session log; the rules doc carries it to the players. */
  function switchFeats(on) {
    if (app.rules().feats.on === on) return;
    setOv(o => featsSwitched(o, on), [line('system', FEATS_SWITCH_WORDS.logTitle, FEATS_SWITCH_WORDS.logLine(on))]);
  }
  async function resetRules() {
    if (!await ui.confirm({ title: 'Reset rules?', body: 'Every rule number goes back to its default. Your roll tables and everything in the Workshop stay.', danger: true, confirmLabel: 'Reset rules' })) return;
    // the GM's statuses live in the library, which a reset of the rule numbers keeps
    if (!setOv(resetRuleNumbers, [line('system', 'Rules reset', 'Every rule number is back to its default.')])) return;
    const ta = $('#gm-r-text'); ta.dataset.dirty = ''; ta.value = rulesJson(); liveRules();
    say('#gm-r-msg', 'Every rule number is back to its default.');
  }

  // ── notifications (src/edge/notify.ts): a told use while this page is hidden ──
  const NOTIFY_WORDS = { granted: 'On. Notifications appear for player reward uses, messages, and coin calls while this page is hidden.', denied: 'Blocked in this browser\'s settings.',
    default: 'Off.', unsupported: "You can't get notifications in this browser." };
  const renderNotify = () => { const st = notifyState(), e = $('#gm-notify-state'); if (e) e.textContent = NOTIFY_WORDS[st]; const b = $('#gm-notify'); if (b) b.hidden = st === 'unsupported'; };
  async function askNotify() { await askToNotify(); renderNotify(); }

  // ── reward uses: the log's `use` lines since this phone last opened them (device prefs `usesSeen`); a count, never a list of its own ──
  const unseenUses = () => { const seen = store.prefs().usesSeen; return S().log.filter(l => l.kind === 'use' && compareTimes(l.at, seen) > 0).length; };
  function renderUses() {
    const n = unseenUses(), e = $('#gm-uses-n'), b = $('#gm-uses-go');
    e.textContent = String(n); e.hidden = !n;
    b.setAttribute('aria-label', n ? `Reported uses, ${n} new` : 'Reported uses');
  }
  /** One tap from the top: the Session log, unfolded and filtered to reward uses; they count as seen. */
  function openUses() {
    open.log = true; applyOpen();
    $('#gm-l-kind').value = 'use'; renderLog();
    store.setPrefs({ usesSeen: new Date().toISOString() }); renderUses();
    const sec = root.querySelector('.gm-sec[data-sec="log"]'); if (sec) sec.scrollIntoView({ block: 'start' });
  }

  // ── session log ──
  function renderLog() {
    const kind = $('#gm-l-kind').value, q = $('#gm-l-q').value.trim().toLowerCase();
    const rows = S().log.filter(l => (!kind || l.kind === kind) && (!q || `${l.title} ${l.text}`.toLowerCase().includes(q)));
    $('#gm-l-count').textContent = `${rows.length} of ${S().log.length} entries`;
    const html = rows.slice(0, 120).map(l => {
      const t = new Date(l.at), hn = l.hunterId && store.hunter(l.hunterId);
      return `<li><span class="k">${esc(l.kind)}</span> <span class="t">${esc(Number.isNaN(t.getTime()) ? '' : t.toLocaleString())}</span>${hn ? ` · ${esc(hn.name)}` : ''}<strong class="lt">${esc(l.title)}</strong>${l.text ? `<span class="lx">${esc(l.text)}</span>` : ''}</li>`;
    }).join('') || '<li class="empty">No log entries match.</li>';
    const ul = $('#gm-l-list'); if (ul.dataset.sig !== html) { ul.dataset.sig = html; ul.innerHTML = html; }
  }

  function applyOpen() {
    root.querySelectorAll('[data-tog]').forEach(b => {
      const id = b.dataset.tog, o = open[id] ?? false;
      b.setAttribute('aria-expanded', o); b.querySelector('.ar').textContent = o ? '▾' : '▸';
      document.getElementById('gm-b-' + id).hidden = !o;
    });
  }

  // ── the Make row: each button opens the maker the Workshop opens ──
  function make(kind) {
    if (kind === 'workshop') return app.go('workshop');
    if (kind === 'status') return void A().forge.status({ mode: 'library' });
    if (kind === 'item') return void A().loot.item({});
    if (kind === 'skill') return void A().skills.make({ give: [] });
    if (kind === 'monster') return void A().bestiary.make(null);
    if (kind === 'bundle') return void bundleMaker(app, null);
  }

  // ── view ──
  app.registerView({
    id: 'gm', label: 'GM', icon: '♛', order: 90, gmOnly: true,
    mount(el) {
      root = el;
      // the Stories section opens with the page while a story runs; after that it keeps the GM's choice, as each section does
      if (!('stories' in open) && running(S().storyRuns).length) open.stories = true;
      // Words from players opens with the page while a word is new; after that it keeps the GM's choice
      if (!('words' in open) && A().words.unseen()) open.words = true;
      // Waiting for you opens with the page while a reward waits
      if (!('waiting' in open) && waitingHere().length) open.waiting = true;
      const rankOpts = RANKS.map(r => opt(r, `${r}-rank`)).join('');
      el.innerHTML = `<nav class="gm-make" id="gm-make" aria-label="Make"><div class="gm-make-h"><span class="lbl">Make</span><button type="button" class="quiet" data-make="workshop">Open Workshop</button></div>
          <div class="gm-make-row">${MAKE.map(([k, l]) => `<button type="button" data-make="${k}" aria-label="Make ${l.toLowerCase()}">${l}</button>`).join('')}</div></nav>
        <div class="gm-uses" id="gm-uses">
          <button type="button" class="gm-uses-go" id="gm-uses-go">Reported uses <span class="gm-uses-n" id="gm-uses-n" hidden></span></button>
          <div class="gm-row"><button type="button" id="gm-notify">Turn on player notifications</button><span class="gm-msg" id="gm-notify-state" role="status"></span></div></div>` + [
        section('cheat', 'GM cheat sheet', `
          <div class="gm-row"><button type="button" class="primary" id="gm-s-go">Start session</button></div>
          <div class="gm-msg" id="gm-s-msg" role="status"></div><div id="gm-cheat"></div>`),
        section('party', 'Party board', `<div class="gm-room" id="gm-room"></div><div class="gm-wtable" id="gm-weight" role="group" aria-label="Fudge on all hunters' rolls"></div><div class="gm-cards" id="gm-board" aria-live="polite"></div><div class="gm-msg" id="gm-board-msg" role="status"></div>`),
        section('waiting', PENDING_WORDS.title, '<div class="gm-msg" id="gm-pw-msg" role="status"></div><ol class="gm-pw" id="gm-pw"></ol>', false, true),
        section('words', WORD_WORDS.gm.title, '<div id="gm-words"></div>', false, true),
        section('trade', 'Trades and stash', '<div id="gm-trade"></div>', false, true),
        section('stories', 'Stories', '<div id="gm-stories"></div>', false, true),
        section('award', 'Award', `
          <div class="lbl">Hunters <span id="gm-sel-sum-a" class="gm-sum"></span></div>
          <div class="gm-targets"><label class="gm-chk"><input type="checkbox" id="gm-all"><span><strong>All hunters</strong></span></label></div>
          <div class="gm-targets" id="gm-targets"></div>
          <p class="gm-tie" id="gm-award-tie" hidden></p>
          <div class="gm-rw" id="gm-rw"></div>
          <div class="dlg-actions"><div class="gm-msg" id="gm-award-msg" role="status"></div><button type="button" class="primary" id="gm-award-go">Send award</button></div>`, false, true),
        section('bcast', 'System broadcast', `
          <div class="gm-grid">${sel_('gm-b-preset', 'Preset', '<option value="">Custom</option>' + PRESETS.map((p, i) => opt(i, p[0])).join(''))}</div>
          <div class="lbl" id="gm-b-to-l">Send to</div>
          <div class="gm-seg" role="radiogroup" aria-labelledby="gm-b-to-l"><label class="gm-chk"><input type="radio" name="gm-b-to" id="gm-b-to-all" value="all" checked><span>Everyone</span></label><label class="gm-chk"><input type="radio" name="gm-b-to" id="gm-b-to-sel" value="sel"><span>Selected hunters <span id="gm-sel-sum-b" class="gm-sum"></span></span></label></div>
          <div class="gm-grid">${txt_('gm-b-tag', 'Banner tag', 'value="! Notification" maxlength="40"')}${sel_('gm-b-kind', 'Style', SYS_KINDS.map(k => opt(k, SYS_KIND_LABEL[k] || k)).join(''))}
            <div class="wide">${txt_('gm-b-title', 'Title', 'maxlength="80"')}</div>
            <div class="wide">${ui.field('Message', '<textarea id="gm-b-body" rows="3" maxlength="500"></textarea>')}</div></div>
          <div class="lbl">Preview</div>
          <div class="gm-prev k-info" id="gm-prev" aria-hidden="true"><div class="n-tag"></div><h3 class="n-big"></h3><p class="n-body"></p></div>
          <div class="gm-row"><button type="button" class="primary" id="gm-b-go">Send broadcast</button></div>
          <div class="gm-msg" id="gm-b-msg" role="status"></div>`, false, true),
        section('quest', 'Issue quest', `
          <p class="empty">Sends to the hunters selected in the Award section: <span id="gm-sel-sum-q"></span></p>
          <div id="gm-qf"></div>
          <label class="gm-chk"><input type="checkbox" id="gm-q-secret"><span>${esc(SECRET_WORDS.box)}</span></label>
          <div class="gm-row"><button type="button" class="primary" id="gm-q-go">Issue quest</button></div>
          <div class="gm-msg" id="gm-q-msg" role="status"></div>`, false, true),
        section('gate', 'Gates and world day', `
          <div class="gm-grid">${sel_('gm-g-rank', 'Rank', `<option value="">Random</option>${rankOpts}`)}${sel_('gm-g-type', 'Type', '<option value="">Random</option>' + SPAWN_TYPES.map(k => opt(k, k[0].toUpperCase() + k.slice(1))).join(''))}
            <div class="wide">${txt_('gm-g-name', 'Name (optional)', 'maxlength="60"')}</div>
            <div class="wide">${difficultySliderHtml({ idPrefix: 'gm-g', inputId: 'gm-g-diff', name: 'difficulty', label: DIFFICULTY_WORDS.gateLabel, level: app.rules().fight.difficulty.default, R: app.rules() })}</div></div>
          <div class="gm-row"><button type="button" class="primary" id="gm-g-go">Spawn gate</button></div>
          <div class="gm-msg" id="gm-g-msg" role="status"></div>
          <div class="lbl">World day</div>
          <div class="gm-row"><span class="gm-day" id="gm-day" aria-live="polite">Day 1</span><button type="button" id="gm-d1">Advance 1 day</button><button type="button" id="gm-dn">Advance days…</button></div>`),
        section('tables', 'Roll tables', `
          <div class="gm-grid">${sel_('gm-t-sel', 'Table', TABLES.map(t => opt(t.id, t.label)).join(''))}<div id="gm-t-rank-f">${sel_('gm-t-rank', 'Rank', rankOpts)}</div></div>
          <div class="gm-row"><button type="button" class="primary" id="gm-t-go">Roll</button><button type="button" id="gm-t-use" hidden>Use in Issue quest</button></div>
          <div class="gm-result" id="gm-t-out" role="status">Choose a table, then tap Roll.</div>
          <div id="gm-t-edit">${ui.field('Table entries (one per line)', '<textarea id="gm-t-list" rows="6" spellcheck="false"></textarea>')}
            <div class="gm-row"><button type="button" id="gm-t-save">Save list</button><button type="button" id="gm-t-reset">Reset to defaults</button></div>
            <div class="gm-msg" id="gm-t-msg" role="status"></div></div>`),
        section('rules', 'Rules editor', `
          <div class="gm-switch"><span class="lbl" id="gm-feats-l">${esc(FEATS_SWITCH_WORDS.label)}</span>
            <div class="seg" role="group" aria-labelledby="gm-feats-l"><button type="button" data-feats="on">${esc(FEATS_SWITCH_WORDS.on)}</button><button type="button" data-feats="off">${esc(FEATS_SWITCH_WORDS.off)}</button></div>
            <p class="empty">${esc(FEATS_SWITCH_WORDS.hint)}</p></div>
          <p class="empty">Enter JSON overrides for the default rules, such as {"pointsPerLevel":5}. Unknown rules and invalid values are rejected.</p>
          ${ui.field('Rules overrides (JSON)', '<textarea id="gm-r-text" rows="9" spellcheck="false" autocomplete="off"></textarea>')}
          <div class="gm-msg" id="gm-r-msg" role="status"></div>
          <div class="gm-row"><button type="button" id="gm-r-val">Validate</button><button type="button" class="primary" id="gm-r-save">Save</button><button type="button" class="danger" id="gm-r-reset">Reset</button></div>`),
        section('log', 'Session log', `
          <div class="gm-grid">${sel_('gm-l-kind', 'Event type', '<option value="">All types</option>' + LOG_KINDS.map(k => opt(k, LOG_KIND_LABEL[k] || k[0].toUpperCase() + k.slice(1))).join(''))}${txt_('gm-l-q', 'Search', 'maxlength="60"')}</div>
          <div class="lbl" id="gm-l-count"></div><ul class="gm-log" id="gm-l-list" tabindex="0" aria-label="Session log entries"></ul>`),
      ].join('');
      wireDifficultyLive(el, () => app.rules());

      // D04: desktop columns. Sections move into column wrappers at >=1100 (2 cols) / >=1500 (3 cols); phone/tablet keep the original single stack
      const ORDER = ['cheat', 'party', 'waiting', 'words', 'trade', 'stories', 'award', 'bcast', 'quest', 'gate', 'tables', 'rules', 'log'];
      // A20: the Award form is a full-width row under the columns, its reward rows two to a line
      const PLAN2 = [['party', 'waiting', 'words', 'trade', 'stories', 'quest'], ['cheat', 'bcast', 'gate', 'tables', 'rules', 'log']];
      const PLAN3 = [['party', 'waiting', 'words', 'trade', 'stories'], ['quest', 'bcast'], ['cheat', 'gate', 'tables', 'rules', 'log']];
      let planSig = '';
      const arrange = () => {
        const L = app.layout || { desktop: () => false, wide: () => false };
        const plan = L.desktop() ? (L.wide() ? PLAN3 : PLAN2) : null, sig = plan ? String(plan.length) : '0';
        if (sig === planSig) return; planSig = sig;
        const secs = Object.fromEntries(ORDER.map(id => [id, el.querySelector(`.gm-sec[data-sec="${id}"]`)]).filter(([, v]) => v));
        const ae = document.activeElement;
        el.querySelector('.gm-cols')?.remove();
        if (secs.award) secs.award.classList.toggle('gm-wide', !!plan);
        if (!plan) { for (const id of ORDER) if (secs[id]) el.appendChild(secs[id]); }
        else {
          const wrap = document.createElement('div'); wrap.className = 'gm-cols gm-c' + plan.length;
          for (const col of plan) { const c = document.createElement('div'); c.className = 'gm-col'; for (const id of col) if (secs[id]) c.appendChild(secs[id]); wrap.appendChild(c); }
          for (const id of ORDER) if (id !== 'award' && secs[id] && !secs[id].parentElement.classList.contains('gm-col')) wrap.lastElementChild.appendChild(secs[id]);
          el.prepend(wrap);
          if (secs.award) wrap.after(secs.award);
          el.prepend(el.querySelector('#gm-uses'));
          el.prepend(el.querySelector('#gm-make'));
        }
        if (ae && el.contains(ae) && document.activeElement !== ae) ae.focus({ preventScroll: true });
      };
      arrange(); app.on('layout', arrange);

      // static fills
      editor = A().maker.rewards($('#gm-rw'), { id: 'gm' });
      questForm = A().quests.fields($('#gm-qf'), { id: 'gmq', use: 'new', role: 'gm' });
      $('#gm-r-text').value = rulesJson();
      renderPreview();

      // numeric HP entry on party cards: Damage / Heal buttons, Enter = damage, a leading '+' heals; remote cards send an `hp` event
      async function typedHp(card, heal, keepFocus) {
        const inp = card.querySelector('[data-gmamt]'), a = A().hunter.parseAmount(inp.value), hid = card.dataset.hid;
        if (!a) return say('#gm-board-msg', A().hunter.amountMsg(inp.value), true);
        const n = heal || a.heal ? a.n : -a.n; inp.value = '';
        if (card.classList.contains('remote')) sendHp(hid, n);
        else if (ui.wrote('GM', n < 0 ? A().hunter.damage(hid, -n) : A().hunter.heal(hid, n))) say('#gm-board-msg', `${n < 0 ? 'Damaged' : 'Healed'} ${(S().hunters.find(x => x.id === hid) || {}).name || 'hunter'} by ${a.n}.`);
        if (keepFocus) { const c2 = [...$('#gm-board').querySelectorAll('[data-hid]')].find(c => c.dataset.hid === hid), i2 = c2 && c2.querySelector('[data-gmamt]'); if (i2) i2.focus(); }
      }
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-gmamt]')) { e.preventDefault(); if (A().hunter.amountFromKey(e, e.target.value)) typedHp(e.target.closest('[data-hid]'), e.shiftKey, true); } });
      el.addEventListener('click', e => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.hasAttribute('data-gminvite')) { app.go('room'); return; }
        if (t.dataset.gmrejoin || t.hasAttribute('data-gmcreate')) { // busy until settled: a second tap must not start a second request
          if (t.disabled) return; t.disabled = true; t.setAttribute('aria-busy', 'true');
          (async () => {
            const c = t.dataset.gmrejoin;
            try { if (c) await A().sync.rejoinGM(c); else await A().sync.create(); }
            catch (e) {
              const words = tapWords(e && e.kind ? e.kind : 'net', c || '');
              if (words) say('#gm-board-msg', words, true);
            } finally { t.disabled = false; t.removeAttribute('aria-busy'); renderRoom(); }
          })(); return;
        }
        if (t.hasAttribute('data-gmdmg') || t.hasAttribute('data-gmheal')) { typedHp(t.closest('[data-hid]'), t.hasAttribute('data-gmheal'), false); return; }
        if (t.dataset.make) { make(t.dataset.make); return; }
        if (t.dataset.weighScope) {
          const n = Number(t.dataset.weighTo), k = parseSheetKey(t.dataset.weighKey);
          if (Number.isInteger(n) && t.dataset.weighScope === 'hunters') weighTap({ kind: 'hunters', n });
          else if (Number.isInteger(n) && k) weighTap({ kind: 'own', key: k, n });
          return;
        }
        if (t.dataset.weighForce !== undefined) {
          const k = parseSheetKey(t.dataset.weighForce), face = oneOf(t.dataset.face, ['20', '1', ''], '');
          if (k) weighTap({ kind: 'force', key: k, face: face === '' ? null : /** @type {20 | 1} */ (Number(face)) });
          return;
        }
        if (t.dataset.tog) {
          open[t.dataset.tog] = !(open[t.dataset.tog] ?? false); applyOpen();
          if (t.dataset.tog === 'words') A().words.seen();
          // folding Award puts the loot it holds off, as Later: the form is emptied and the loot waits
          if (t.dataset.tog === 'award' && !open.award) draft({ type: 'fold' });
          return;
        }
        if (t.dataset.rmstatus !== undefined) { const key = t.closest('[data-hid]').dataset.hid, sk = t.dataset.rmstatus;
          const r = remotes().find(x => x.key === key), c = r && (r.data.conditions || []).find(x => x && x.key === sk);
          sendStatus(key, { remove: sk }, n => `Removed ${c ? condLabel(c) : sk} from ${n}`); return; }
        if (t.dataset.rstatus !== undefined) { addRemoteStatus(t.closest('[data-hid]').dataset.hid); return; }
        if (t.dataset.hbuild !== undefined) { const c = t.closest('[data-hid]'), r = c.classList.contains('remote') && remotes().find(x => x.key === c.dataset.hid); const h = r ? null : store.hunter(c.dataset.hid); if (r) A().build.gmMenu({ kind: 'remote', remote: r.key }, r.data); else if (h) A().build.gmMenu({ kind: 'local', hunterId: h.id }, null); return; }
        if (t.dataset.hguild !== undefined) { const c = t.closest('[data-hid]'), r = c.classList.contains('remote') && remotes().find(x => x.key === c.dataset.hid); const h = r ? null : store.hunter(c.dataset.hid); if (r) void A().guild.edit({ kind: 'remote', remote: r.key }, r.data); else if (h) void A().guild.edit({ kind: 'local', hunterId: h.id }, null); return; }
        const pw = t.closest('[data-pw]');
        if (pw) { answerWaiting(pw.dataset.pw, t.hasAttribute('data-pw-approve') ? 'approve' : t.hasAttribute('data-pw-edit') ? 'edit' : 'refuse'); return; }
        if (t.dataset.ggive !== undefined) { void giveFrom(t.closest('[data-hid]').dataset.hid); return; }
        if (t.dataset.gchron !== undefined) { A().chronicle.open(t.closest('[data-hid]').dataset.hid); return; }
        if (t.dataset.feats) { switchFeats(t.dataset.feats === 'on'); return; }
        if (t.dataset.grevive !== undefined && t.closest('.gm-card.remote')) { sendRevive(t.closest('[data-hid]').dataset.hid); return; }
        if (t.dataset.grevive !== undefined) { const hid = t.closest('[data-hid]').dataset.hid, was = (S().hunters.find(x => x.id === hid) || {}).level; if (ui.wrote('GM', A().hunter.revive(hid))) { const now = S().hunters.find(x => x.id === hid); say('#gm-board-msg', now ? `${now.name} is back up. ${raisedLine(was, now.level)}.` : 'Revived hunter.'); } return; }
        if (t.dataset.hp && t.closest('.gm-card.remote')) { sendHp(t.closest('[data-hid]').dataset.hid, int(t.dataset.hp)); return; }
        if (t.dataset.hp) { const hid = t.closest('[data-hid]').dataset.hid, n = int(t.dataset.hp); ui.wrote('GM', n < 0 ? A().hunter.damage(hid, -n) : A().hunter.heal(hid, n)); return; }
        const act = { 'gm-notify': askNotify, 'gm-uses-go': openUses, 'gm-award-go': doAward, 'gm-b-go': doBroadcast, 'gm-q-go': doIssue, 'gm-g-go': doSpawn, 'gm-s-go': startSession, 'gm-t-go': doRoll,
          'gm-d1': () => advance(1), 'gm-r-val': liveRules, 'gm-r-save': saveRules, 'gm-r-reset': resetRules,
          'gm-dn': async () => { const n = await ui.promptNum({ title: 'Advance world day', label: 'Days', value: 1, min: 1, max: 365 }); if (n) advance(n); },
          'gm-t-save': () => { const l = lines($('#gm-t-list').value); if (!l.length) return say('#gm-t-msg', 'A table needs at least one line. Tap Reset to defaults to restore the original list.', true); if (!saveList(tbl(), l)) return; $('#gm-t-list').dataset.dirty = ''; say('#gm-t-msg', `Saved ${l.length} entries.`); },
          'gm-t-reset': () => { if (!resetList(tbl())) return; syncTableUi(true); say('#gm-t-msg', 'Reset to the default list.'); } }[t.id];
        if (act) act();
      });
      el.addEventListener('change', e => {
        const t = e.target;
        if (t.id === 'gm-all') { sel.clear(); if (t.checked) renderTargetsAll(); renderTargets(); return; }
        // a bundle picked in the Award form replaces what it held: a drop it held is no longer what it sends
        if (t.matches('#gm-rw [data-rw-bundle]') && t.value) { draft({ type: 'bundle' }); return; }
        if (t.dataset && t.dataset.sel) { t.checked ? sel.add(t.dataset.sel) : sel.delete(t.dataset.sel); renderTargets(); return; }
        if (t.name === 'gm-b-to') renderTargets();
        if (t.id === 'gm-b-preset') {
          const p = PRESETS[t.value]; if (p) { $('#gm-b-tag').value = p[1]; $('#gm-b-kind').value = p[2]; $('#gm-b-title').value = p[3]; $('#gm-b-body').value = p[4]; renderPreview(); }
        }
        if (t.id === 'gm-t-sel' || t.id === 'gm-t-rank') { syncTableUi(true); $('#gm-t-use').hidden = true; }
        if (t.id === 'gm-l-kind') renderLog();
      });
      el.addEventListener('input', e => {
        const id = e.target.id;
        if (id.startsWith('gm-b-')) renderPreview();
        if (id === 'gm-l-q') renderLog();
        if (id === 'gm-r-text') { e.target.dataset.dirty = '1'; liveRules(); }
        if (id === 'gm-t-list') e.target.dataset.dirty = '1';
      });
      const renderTargetsAll = () => { for (const i of targetList()) sel.add(i.id); };
      this.update(el);
    },
    update(el) {
      root = el;
      if (awardDraft.at === 'opening') openDraft();
      // the drop the form holds was set aside or given elsewhere, or its waiting reward was answered: the form lets it go
      if (awardDraft.at === 'tied' && !tiedDrop() && !waitingOf()) draft({ type: 'gone' });
      showTie();
      const csig = JSON.stringify(ov()), cs = $('#gm-cheat'); if (cs.dataset.sig !== csig) { cs.dataset.sig = csig; cs.innerHTML = cheatSheet(); }
      renderBoard(); renderTargets(); renderWaiting();
      if (!('waiting' in open) && waitingHere().length) { open.waiting = true; applyOpen(); }
      $('#gm-hsum-words').textContent = A().words.paint($('#gm-words'));
      $('#gm-hsum-trade').textContent = A().trade.paint($('#gm-trade'));
      $('#gm-hsum-stories').textContent = A().stories.paint($('#gm-stories'));
      editor.refresh();
      $('#gm-day').textContent = `Day ${S().world.day}`;
      syncTableUi(); renderLog(); renderNotify(); renderUses();
      root.querySelectorAll('[data-feats]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.feats === 'on') === app.rules().feats.on)));
      const ta = $('#gm-r-text');
      if (document.activeElement !== ta && !ta.dataset.dirty && ta.value !== rulesJson()) { ta.value = rulesJson(); liveRules(); }
      else if (!ta.dataset.init) { ta.dataset.init = '1'; liveRules(); }
    },
  });

  setInterval(() => { if (root && root.isConnected && !root.closest('[hidden]') && document.visibilityState === 'visible') renderRoom(); }, 5000); // presence ages
  app.on('sync:status', () => { if (root && root.isConnected && !root.closest('[hidden]')) renderRoom(); });
  app.on('sync:sheets', () => { if (root && root.isConnected && !root.closest('[hidden]')) { renderBoard(); renderTargets(); } });
  app.on('sync:sheets', weighJoined);
  // a player's reward asked of the GM (hunter/pending.ts): kept waiting once by its id, with its log line
  app.on('sync:event', ({ event: ev }) => {
    const code = room();
    if (ev.type !== 'rewardAsk' || app.seat() !== 'gm' || !code) return;
    const p = ev.payload, log = { at: new Date().toISOString(), cap: app.rules().logCap };
    if (!A().sync.once(p.eid, s => pendingHeard(s, p, code, log))) return;
    ui.toast('GM', PENDING_WORDS.notify(p.name || 'A hunter'), { kind: 'info' });
  });
  // a player's roll reached the Table feed: one that shows the forced face spends the force the GM set on that hunter's
  // next roll, and the spend goes to the player's phone like any change (table-weight.ts `showsForced`)
  app.on('sync:event', ({ event }) => {
    if (event.type !== 'roll' || app.seat() !== 'gm') return;
    weigh({ kind: 'rolled', key: event.payload.by, expr: event.payload.expr, rolls: event.payload.rolls }, false);
  });
}

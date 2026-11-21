// bestiary.js (U07): the bestiary screen, the codex and the enemy maker. Seeds, a monster's body from its rank, archetype
// and kind, and the one monster parser: src/core/registry/monsters.ts; custom and edited monsters live in state.monsters.
import { isRefused } from '../core/save-step.ts';
import { RANKS, rankIdx } from '../edge/rules.ts';
import {
  ARCHETYPE_LIST, MONSTER_BOUNDS, MONSTER_KINDS, copiesOf, monsterSheetOf, parseMonster, seedMonsters, statBlock as statBlockOf, xpOf, monsterXp,
} from '../core/registry/monsters.ts';
import { ARCHETYPE_ATTACKS, ATTACK_ID } from '../core/registry/abilities.ts';
import { oneOf } from '../core/one-of.ts';
import { isUp } from '../core/combat/row-hp.ts';
import { monsterRows } from '../core/combat/rows.ts';
import { combatantId } from '../core/combat/ability-types.ts';
import { SKILL_SEEDS, parseSkill, skillOf } from '../core/registry/skills.ts';
import { parseItem } from '../core/registry/items.ts';
import { isStateChip } from '../core/hunter/chips.ts';
import { newMonster } from '../core/save.ts';
import { codexDoc as codexDocOf, codexFromRoom, codexKey, mergeMonsters, monsterOfKind, playerShelf, recordDefeat as recordDefeatStep, recordKeyOf, recordOf, removeMonster, saveMonster as monsterSaved } from '../core/bestiary.ts';
import { runsFight } from '../core/role.ts';
import { monsterIcon } from '../core/registry/icon-defaults.ts';
import * as motion from './motion.ts';
import { icon, sprite } from './icons.ts';
import { iconField } from './maker.js';

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  sprite();

  /** @type {import('../core/api.ts').BestiaryApi['statBlock']} */
  const statBlock = (rank, o = {}) => statBlockOf(app.rules(), rank, { ...o, kind: o.kind ?? (o.boss ? 'boss' : o.elite ? 'elite' : undefined) });
  // Seeds are built lazily from the (possibly GM-overridden) rank table so edits to RULES flow through.
  const seeds = () => seedMonsters(app.rules());
  const custom = () => store.get().monsters;
  /** @type {import('../core/api.ts').BestiaryApi['list']} */
  const list = () => [...seeds(), ...custom().map(m => ({ ...m, custom: /** @type {const} */ (true) }))];
  /** @type {import('../core/api.ts').BestiaryApi['get']} */
  const get = id => list().find(m => m.id === id) || null;

  // Combatants for combat.add: n copies, A/B/C suffix when n > 1, each with the monster's skills and starting statuses
  // (monsterRows in src/core/combat/rows.ts), with the entry's id for the fight's loot and extraction. Run outside a
  // store step: the ids come from `store.id`, which counts up the save's seq.
  /** @type {import('../core/api.ts').BestiaryApi['toCombatant']} */
  function toCombatant(monster, n = 1) {
    const m = typeof monster === 'string' ? get(monster) : monster; if (!m) return [];
    n = copiesOf(n);
    const one = parseMonster(m), ids = []; if (!one) return [];
    for (let i = 0; i < n; i++) ids.push(combatantId(store.id('c'))); // ids only: the fight's add stores the save
    return monsterRows(one, ids, app.rules()).map(row => ({ row, monsterId: m.id || null }));
  }

  
  // ── persistence of custom monsters ──
  /** Saves monster `m` (a new one under a new id); answers its id, or the store's refusal whole for the caller's `ui.wrote`. */
  function saveMonster(m, asNew) {
    const id = !asNew && custom().some(x => x.id === m.id) ? m.id : store.id('m');
    const w = store.apply('monster-save', s => monsterSaved(s, { ...parseMonster(m), id }));
    return isRefused(w) ? w : { ok: /** @type {const} */ (true), id };
  }

  // ── codex (B01): monsters are added as they are fought and beaten ──
  const codexOf = () => store.get().codex;
  const dateOf = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
  /** What the codex keeps of a monster: its body's numbers from its rank, archetype, kind and tweak, its abilities' names, and its picture (the GM's pick, else its type's or archetype's), so a player's bestiary shows what the GM's does. */
  const infoOf = m => {
    const s = monsterSheetOf({ rank: m.rank, archetype: m.archetype, kind: m.kind, tweak: m.tweak || {} }, app.rules());
    return { hpMax: s.hpMax, armor: s.armor, resist: s.resist, speed: s.speed, abilities: (m.abilities || []).slice(0, 4).map(a => String(a.name).slice(0, 70)), icon: monsterIcon(m) };
  };
  const statLines = i => [`HP ${i.hpMax} · Armor ${i.armor} · Resist ${i.resist} · Speed ${i.speed}`];
  // A17: a kill unlocks the Bestiary entry; that is news, not a question, so it is a toast (the entry holds the stats).
  const unlock = (name, rank, info) => ui.toast('! System', `Monster info unlocked: ${name} (${rank}). ${statLines(info).join(' · ')}`);

  /**
   * A fight's monster row that went down: its entry's kills go up, and a monster the bestiary lacks is made from its row,
   * both in one step (bestiary.ts `recordDefeat`), which refuses a row counted already. The fight's `defeated` effect and
   * its end both ask, so a row that went down without the effect (set to 0 HP before the fight began) is counted too.
   */
  function recordDefeat(b) {
    if (!b || b.kind !== 'monster' || !b.id) return;
    const o = b.origin && b.origin.kind === 'monster' ? b.origin : null;
    const rank = o && RANKS.includes(o.rank) ? o.rank : 'E', now = new Date().toISOString();
    const name = o ? o.name : 'Monster', key = codexKey(name, rank), was = codexOf()[key];
    const found = monsterOfKind(codexOf(), list(), key);
    const made = found ? null : { ...parseMonster({ name, rank, archetype: o ? o.archetype : 'brute', kind: o ? o.monsterKind : 'normal', tweak: o ? { hp: o.tweak.hp, stats: o.tweak.stats } : {},
      abilities: (b.abilities || []).filter(a => a.id !== ATTACK_ID), xp: b.xp, desc: 'Auto-added on first defeat', type: 'Custom', auto: true }), id: store.id('m') };
    const entry = found || made;
    if (!store.apply('codex-record', s => recordDefeatStep(s, { bodyId: b.id, key, name: entry.name || name, rank, monsterId: entry.id, at: now }, made)).ok) return;
    if (!was || was.room) unlock(entry.name, rank, infoOf(entry));
    else ui.toast('! Codex', `+1 ${entry.name} (kills: ${codexOf()[key].kills})`, { kind: 'info' });
  }
  app.on('combat:defeated', ({ body }) => recordDefeat(body));
  app.on('combat:end', ({ fight }) => { for (const b of (fight && fight.rows) || []) if (!isUp(b)) recordDefeat(b); });

  // the room's codex doc: the GM's phone keeps it (app.api.sync.publish), players read it
  /** What the codex doc shows of entry `key`: the body of the monster it names, or of the bestiary's monster of that name and rank. */
  const docInfo = (key, r) => {
    const m = monsterOfKind(codexOf(), list(), key);
    return m ? infoOf(m) : { hpMax: 0, armor: 0, resist: 0, speed: 0, abilities: [] };
  };
  const codexDoc = () => codexDocOf(codexOf(), docInfo, new Date().toISOString());
  app.api.sync.publish('codex', codexDoc);
  app.on('sync:docs', () => {
    if (app.seat() !== 'player') return;
    const d = app.api.sync.doc('codex'); if (!d) return; // as DOCS in src/core/protocol.ts parsed it
    const laid = codexFromRoom(store.get(), d);
    if (laid.save === store.get()) return;
    if (!store.apply('codex-room', s => codexFromRoom(s, d).save).ok) return;
    const fresh = laid.fresh;
    if (fresh.length > 3) ui.toast('! System', `Monster info unlocked: ${fresh.map(r => `${r.name} (${r.rank})`).slice(0, 8).join(', ')}.`);
    else for (const r of fresh) unlock(r.name, r.rank, r.info);
  });

  /** A bestiary monster's codex entry (bestiary.ts `recordOf`). */
  const recFor = m => recordOf(codexOf(), m, id => !!get(id));
  /** Merges monster `srcId` into `dstId` (bestiary.ts `mergeMonsters`): whether it was written. */
  function mergeInto(srcId, dstId) {
    const src = get(srcId), dst = get(dstId); if (!src || !dst || src.id === dst.id) return false;
    const cx = codexOf(), sk = recordKeyOf(cx, src), dk = recordKeyOf(cx, dst);
    return ui.wrote('! Bestiary', store.apply('codex-merge', s => mergeMonsters(s, { srcId: src.id, srcKey: sk, dst: { id: dst.id, name: dst.name, rank: dst.rank }, dstKey: dk })));
  }
  /** @type {import('../core/api.ts').BestiaryApi['remove']} */
  const remove = id => ui.wrote('! Bestiary', store.apply('monster-del', s => removeMonster(s, id)));
  app.api.bestiary = { list, get, statBlock, toCombatant, save: (m, asNew = true) => saveMonster(m, asNew), make: m => make(m || { ...statBlock('E'), id: null }), remove };

  // ── view ──
  ui.css('bestiary', `
.bst-filter{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:12px}
.bst-filter .grow{flex:1 1 160px;min-width:0}.bst-filter .md{flex:0 0 110px;min-width:0}
.bst-filter .field,.bst-gen .field{width:100%}
.bst-count{font-size:12px;color:var(--muted);margin:0 0 8px}
.bst-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.bst-card{border:1px solid var(--line);background:rgba(10,26,46,.6);padding:12px;min-width:0;display:flex;flex-direction:column;gap:8px}
.bst-card.boss{border-color:rgba(255,201,77,.45)}
.bst-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bst-h .bst-ic{--ic:var(--icon-list);color:var(--cyan)}
.bst-h .nm{font-family:var(--font-display);font-weight:700;font-size:17px;color:var(--ice);flex:1 1 140px;min-width:0;overflow-wrap:anywhere}
.bst-tag{font-size:12px;letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--line);padding:1px 6px;color:var(--cyan-dim)}
.bst-tag.boss{color:var(--rank-s);border-color:rgba(255,201,77,.5)}
.bst-tag.elite{color:var(--rank-a);border-color:rgba(199,155,255,.5)}
.bst-vit{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;text-align:center}
.bst-vit div,.bst-st div{border:1px solid var(--line);padding:4px 2px;min-width:0}
.bst-vit b,.bst-st b{display:block;font-family:var(--font-mono);color:var(--ice);font-size:15px;overflow-wrap:anywhere}
.bst-vit span,.bst-st span{font-size:12px;letter-spacing:.1em;color:var(--cyan-dim);text-transform:uppercase}
.bst-st{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;text-align:center}
.bst-st b{font-size:14px}.bst-st small{display:block;font-size:12px;color:var(--cyan)}
.bst-card ul{margin:0;padding-left:18px;font-size:13px}.bst-card li{margin:2px 0}.bst-notes{color:var(--muted)}
.enm-derived{margin:0;font-family:var(--font-mono);font-size:14px;color:var(--ice)}
.bst-meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--ice)}
.bst-meta .y{color:var(--rarity-ok,#59e6a8)}.bst-meta .n{color:var(--muted)}
.bst-desc{font-size:13px;color:var(--muted);margin:0}
.bst-acts{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;margin-top:auto}
.bst-acts .cnt{flex:0 0 64px}.bst-acts .cnt input{width:100%}
.bst-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:10px}
.bst-form .wide{grid-column:1/-1}.bst-form .chk{flex-direction:row;align-items:center;gap:8px;min-height:40px}
.bst-form textarea{width:100%;min-height:80px}
.enm-win{max-width:560px;width:100%}
.enm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.enm-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.enm-list li{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;border:1px solid var(--line);background:rgba(10,26,46,.55);padding:6px 8px}
.enm-list .nm{flex:1 1 120px;min-width:0;font-weight:600;overflow-wrap:anywhere}
.enm-list .meta{flex:1 1 100%;order:3;font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}
.enm-list input{flex:0 0 120px;width:120px}
.enm-list .unit{font-size:13px;color:var(--cyan-dim)}
.enm-list .enm-rounds{flex:1 1 100%;order:3;display:flex;align-items:center;gap:8px}  /* under the name, so the × stays on the name's row */
.bst-gen{margin:0 0 14px}
.bst-enc{flex-direction:row;align-items:center;gap:8px;min-height:40px}.bst-tag.cdx{color:var(--rarity-ok,#59e6a8);border-color:rgba(89,230,168,.5)}
@media (max-width:720px){.bst-grid{grid-template-columns:minmax(0,1fr)}.bst-vit{grid-template-columns:repeat(5,minmax(0,1fr))}.bst-st{grid-template-columns:repeat(3,1fr)}}
@media (pointer:coarse),(max-width:720px){.bst-form .chk{min-height:44px}label.field[style*="min-height:40px"]{min-height:44px!important}}
`);

  const f = { rank: '', type: '', q: '', enc: false }; const counts = new Map(); let lastHtml = '';
  const typeOptions = () => [...new Set(list().map(m => m.type).filter(Boolean))].sort();

  const KIND_LABEL = { normal: 'Normal', elite: 'Elite', boss: 'Boss' };
  const ARCH_LABEL = { brute: 'Brute', skirmisher: 'Skirmisher', caster: 'Caster' };
  const ABILITY_KIND = { strike: 'Strike', shot: 'Shot', blast: 'Blast', curse: 'Curse', support: 'Support' };
  /** A monster's attacks in a fight: its archetype's, then its own. */
  const attacksOf = m => [ARCHETYPE_ATTACKS[m.archetype](app.rules()), ...(m.abilities || [])];
  /** An ability as a skill, so its lines are the skill maker's, read at the monster's rank. */
  const abilityLines = (a, rank) => app.api.skills.lines({ name: a.name, level: 1, label: null, desc: '', type: 'active', ability: a }, { id: null, tier: rankIdx(rank) });

  const card = (m, gm, canAdd) => {
    const n = counts.get(m.id) || 1, id = esc(m.id), rec = recFor(m), i = m.synthetic ? m.info : infoOf(m);
    const badge = !rec ? (gm ? '<span class="bst-tag">Not encountered</span>' : '') : `<span class="bst-tag cdx">Defeated ×${rec.kills} · first ${esc(dateOf(rec.firstAt))}</span>`;
    const kind = m.kind || 'normal';
    // a card of the room's codex has no type or archetype to work a default from: it draws the picture its entry carries, or none (an entry from before the field)
    const pic = m.synthetic ? i.icon : monsterIcon(m);
    const attacks = m.synthetic ? i.abilities.map(a => `<li>${esc(a)}</li>`) : attacksOf(m).map(a => `<li><b>${esc(a.name)}</b> · ${esc(abilityLines(a, m.rank).slice(0, 1).join(''))}</li>`);
    return `<article class="bst-card${kind === 'boss' ? ' boss' : ''}" data-mid="${id}" aria-label="${esc(m.name)} stat block">
      <div class="bst-h">${pic ? icon(pic, 'bst-ic') : ''}${ui.rankBadge(m.rank)}<span class="nm">${esc(m.name)}</span>${kind !== 'normal' ? `<span class="bst-tag ${kind}">${KIND_LABEL[kind]}</span>` : ''}${m.auto ? '<span class="bst-tag">Auto</span>' : m.custom ? '<span class="bst-tag">Custom</span>' : ''}${badge}</div>
      ${m.type || !m.synthetic ? `<div class="lbl">${esc([m.type, m.synthetic ? '' : ARCH_LABEL[m.archetype]].filter(Boolean).join(' · '))}</div>` : ''}
      <div class="bst-vit"><div><span>HP</span><b>${ui.fmt(i.hpMax)}</b></div><div><span>Armor</span><b>${esc(i.armor)}</b></div><div><span>Resist</span><b>${esc(i.resist)}</b></div><div><span>Speed</span><b>${esc(i.speed)}</b></div>${m.synthetic ? '' : `<div><span>XP</span><b>${ui.fmt(monsterXp(m, app.rules()))}</b></div>`}</div>
      ${attacks.length ? `<ul class="bst-ab">${attacks.join('')}</ul>` : ''}
      ${!m.synthetic && m.notes.length ? `<ul class="bst-notes">${m.notes.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${m.synthetic ? '' : `<div class="bst-meta"><span class="${m.extractable ? 'y' : 'n'}">${m.extractable ? 'Extractable' : 'Not extractable'}</span></div>`}
      ${m.desc ? `<p class="bst-desc">${esc(m.desc)}</p>` : ''}
      <div class="bst-acts">
        ${m.synthetic || !canAdd ? '' : `<span class="cnt">${ui.field('Count', `<input type="number" min="1" max="${MONSTER_BOUNDS.copies}" value="${n}" data-count="${id}" aria-label="Count of ${esc(m.name)} to add">`)}</span>
        <button type="button" class="primary" data-addc="${id}">Add to fight ×${n}</button>`}
        ${gm ? `<button type="button" data-edit="${id}" aria-label="Edit ${esc(m.name)}">Edit</button><button type="button" data-dup="${id}" aria-label="Duplicate ${esc(m.name)}">Duplicate</button>${m.custom ? `<button type="button" data-merge="${id}" aria-label="Merge ${esc(m.name)} into another entry">Merge</button><button type="button" class="danger" data-del="${id}" aria-label="${m.auto ? 'Remove' : 'Delete'} ${esc(m.name)}">${m.auto ? 'Remove' : 'Delete'}</button>` : ''}` : ''}
      </div></article>`;
  };

  // ── the enemy maker (on maker.js's shell) ──
  const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
  const statusLabel = key => { const c = app.rules().conditions[key]; return String((c && c.label) || key); };
  /** The most stacks a starting status may hold: its def's cap, 1 for a plain status. */
  const stackCap = key => { const c = app.rules().conditions[key]; return c && c.stack ? c.stack.cap : 1; };
  /** A monster's body, its abilities, what it starts with and what it drops, in words; each ability's numbers at its rank. */
  function monsterLines(m) {
    const s = infoOf(m);
    return [
      `${m.rank}-rank ${KIND_LABEL[m.kind].toLowerCase()} ${ARCH_LABEL[m.archetype].toLowerCase()} · HP ${ui.fmt(s.hpMax)} · Armor ${s.armor} · Resist ${s.resist} · Speed ${s.speed} · XP ${ui.fmt(monsterXp(m, app.rules()))}`,
      ...attacksOf(m).map(a => `${a.name}: ${abilityLines(a, m.rank).join('; ')}`),
      m.statuses.length ? `Starts with: ${m.statuses.map(st => `${st.stacks ? `${st.stacks} ` : ''}${statusLabel(st.key)} (${st.rounds === null ? 'until removed' : `${st.rounds} round${st.rounds === 1 ? '' : 's'}`})`).join(', ')}` : '',
      m.loot.gold || m.loot.items.length ? `Drops: ${[m.loot.gold ? `${ui.fmt(m.loot.gold)} gold` : '', ...m.loot.items.map(i => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`)].filter(Boolean).join(', ')}` : '',
    ].filter(Boolean);
  }

  /** Opens the monster maker on `m` (a seed is saved as a copy); answers the id it saved, or null. */
  function make(m) {
    const M = app.api.maker, B = MONSTER_BOUNDS;
    const own = custom().some(x => x.id === m.id), builtIn = !own && seeds().some(x => x.id === m.id);
    const start = parseMonster(m);
    let rank = start.rank, archetype = start.archetype, kind = start.kind;
    const abilities = start.abilities.map(a => ({ ...a })), statuses = start.statuses.map(st => ({ ...st })), items = start.loot.items.map(i => ({ ...i }));
    return M.open({
      tag: '! Bestiary', title: own ? 'Edit monster' : builtIn ? `Edit copy of ${m.name}` : 'New monster', save: 'Save monster', cls: 'enm',
      build(el, shell) {
        el.innerHTML = `
          ${ui.field('Name', `<input type="text" id="enm-name" maxlength="60" autocomplete="off" placeholder="e.g. Ice Warden" value="${esc(own || m.id ? start.name : '')}">`)}
          <div data-icon></div>
          <div class="lbl">Rank</div>
          ${M.chips('rank', RANKS.map(r => [r, r]), rank, { label: 'Rank' })}
          <div class="lbl">Archetype</div>
          ${M.chips('archetype', ARCHETYPE_LIST.map(a => [a, ARCH_LABEL[a]]), archetype, { label: 'Archetype' })}
          <div class="lbl">Kind</div>
          ${M.chips('kind', MONSTER_KINDS.map(k => [k, KIND_LABEL[k]]), kind, { label: 'Kind' })}
          ${M.chips('flags', [['extractable', 'Extractable']], start.extractable ? ['extractable'] : [], { many: true, label: 'Extractable' })}
          <p class="enm-derived" data-derived aria-live="polite"></p>
          <div class="enm-grid">
            ${ui.field('XP', `<input type="number" inputmode="numeric" id="enm-xp" min="0" value="${esc(start.xp ?? '')}">`)}
            ${ui.field('HP ×', `<input type="number" inputmode="decimal" id="enm-hp" min="0.1" max="${B.hp}" step="0.1" placeholder="1" value="${esc(start.tweak.hp ?? '')}">`)}
            ${ui.field('Type', `<input type="text" id="enm-type" maxlength="40" autocomplete="off" placeholder="e.g. Beast" value="${esc(start.type)}">`)}
          </div>
          <div class="slot" data-later><div class="lbl">Abilities</div><ul class="enm-list" data-abilities></ul><div data-ability-add></div>
          ${ui.field('Notes (one per line)', `<textarea id="enm-notes" maxlength="4000">${esc(start.notes.join('\n'))}</textarea>`)}
          <div class="lbl">Starts with</div><ul class="enm-list" data-statuses></ul><div data-status-add></div>
          <div class="lbl">Loot</div>
          ${ui.field('Gold', `<input type="number" id="enm-gold" inputmode="numeric" min="0" value="${esc(start.loot.gold || '')}" placeholder="0">`)}
          <ul class="enm-list" data-items></ul><div data-item-add></div>
          ${ui.field('Description', `<textarea id="enm-desc" maxlength="500">${esc(start.desc)}</textarea>`)}
          <div data-mk-preview></div></div>`;
        const $ = sel => el.querySelector(sel);
        const int = (v, lo, hi, d) => { const t = String(v).trim(), n = Math.trunc(Number(t)); return t === '' || !Number.isFinite(n) ? d : Math.max(lo, Math.min(hi, n)); };
        const row = (label, i, kind, extra = '') => `<li><span class="nm">${esc(label)}</span>${extra}<button type="button" class="icon-btn" data-rm="${kind}" data-i="${i}" aria-label="Remove ${esc(label)}">&times;</button></li>`;
        const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
        function lists() {
          $('[data-abilities]').innerHTML = abilities.map((a, i) => row(a.name, i, 'ability', `<span class="meta">${esc(abilityLines(a, rank).join('; '))}</span><button type="button" class="quiet" data-edit-ability="${i}" aria-label="Edit ${esc(a.name)}">Edit</button>`)).join('');
          $('[data-statuses]').innerHTML = statuses.map((st, i) => row(statusLabel(st.key), i, 'status',
            `<span class="enm-rounds"><input type="number" min="1" max="999" inputmode="numeric" data-rounds="${i}" aria-label="Rounds of ${esc(statusLabel(st.key))}" placeholder="Until removed" value="${st.rounds ?? ''}"><span class="unit">rounds</span>${stackCap(st.key) > 1
              ? `<input type="number" min="1" max="${stackCap(st.key)}" inputmode="numeric" data-stacks="${i}" aria-label="Stacks of ${esc(statusLabel(st.key))}" placeholder="1" value="${st.stacks ?? ''}"><span class="unit">stacks</span>` : ''}</span>`)).join('');
          $('[data-items]').innerHTML = items.map((it, i) => row(`${it.name}${it.qty > 1 ? ` ×${it.qty}` : ''}`, i, 'item')).join('');
          const lib = store.get().library, have = new Set(abilities.map(a => a.name.toLowerCase()));
          const fullA = abilities.length >= B.abilities, fullT = statuses.length >= B.statuses, fullI = items.length >= B.lootItems;
          const fights = k => k.type === 'active' && !have.has(k.name.toLowerCase());
          $('[data-ability-add]').innerHTML = `<select data-add="ability" data-pick aria-label="Add an ability from a skill"${fullA ? ' disabled' : ''}><option value="">${fullA ? `Add an ability (${B.abilities} at most)` : 'Add an ability…'}</option>
            <optgroup label="Built-in">${SKILL_SEEDS.filter(fights).map(k => opt(`seed:${k.name}`, k.name)).join('')}</optgroup>
            ${lib.skills.some(fights) ? `<optgroup label="Library">${lib.skills.filter(fights).map(k => opt(`lib:${k.id}`, k.name)).join('')}</optgroup>` : ''}
            <option value="new">New skill…</option></select>`;
          const conds = Object.keys(app.rules().conditions).filter(k => !isStateChip(k) && !statuses.some(st => st.key === k));
          $('[data-status-add]').innerHTML = `<select data-add="status" data-pick aria-label="Add a starting status"${fullT ? ' disabled' : ''}><option value="">${fullT ? `Add a status (${B.statuses} at most)` : 'Add a status…'}</option>${conds.map(k => opt(k, statusLabel(k))).join('')}</select>`;
          $('[data-item-add]').innerHTML = `<select data-add="item" aria-label="Add a loot item"${fullI ? ' disabled' : ''}><option value="">${fullI ? `Add an item (${B.lootItems} at most)` : 'Add an item…'}</option>
            ${lib.items.length ? `<optgroup label="Library">${lib.items.map(it => opt(`lib:${it.id}`, it.name)).join('')}</optgroup>` : ''}<option value="new">New item…</option></select>`;
        }
        /** The tweak the form holds: its HP factor when one is typed (above 0, at most 10), and the stat points it was made with. */
        const tweakOf = () => {
          const t = $('#enm-hp').value.trim(), hp = Number(t);
          return { ...(t !== '' && Number.isFinite(hp) && hp > 0 ? { hp: Math.min(B.hp, hp) } : {}), ...(start.tweak.stats ? { stats: { ...start.tweak.stats } } : {}) };
        };
        /** The monster the form holds, every number inside the parser's bounds. */
        const formMonster = () => ({
          name: $('#enm-name').value.trim().slice(0, B.name), rank, type: $('#enm-type').value.trim().slice(0, B.type), archetype, kind, tweak: tweakOf(),
          abilities: abilities.map(a => ({ ...a })), notes: $('#enm-notes').value.split('\n').map(t => t.trim().slice(0, B.note)).filter(Boolean).slice(0, B.notes),
          // a blank XP is the rule's for its rank and kind (left out: monsterXp), so a change of the XP table reaches it
          ...($('#enm-xp').value.trim() === '' ? {} : { xp: int($('#enm-xp').value, 0, B.xp, 0) }), extractable: /** @type {string[]} */ (M.picked(el, 'flags')).includes('extractable'), desc: $('#enm-desc').value.slice(0, B.desc),
          statuses: statuses.map(st => ({ ...st })), loot: { gold: int($('#enm-gold').value, 0, B.gold, 0), items: items.map(i => ({ ...i })) },
        });
        /** The body the rank, archetype, kind and HP factor make, shown as the GM picks them; and the rule's XP a blank field takes. */
        const derived = () => {
          $('#enm-xp').placeholder = `By the rule: ${xpOf(app.rules(), rank, kind)}`;
          const s = infoOf({ rank, archetype, kind, tweak: tweakOf(), abilities: [] });
          $('[data-derived]').textContent = `HP ${ui.fmt(s.hpMax)} · Armor ${s.armor} · Resist ${s.resist} · Speed ${s.speed}`;
        };
        lists(); derived();
        // the Icon row (icons design 6): its default is read from the type typed and the archetype picked
        const iconRow = iconField($('[data-icon]'), shell.el, { thing: 'monster', pick: start.icon || null, subject: () => ({ thing: 'monster', monster: { type: $('#enm-type').value, archetype } }) });
        el.addEventListener('click', e => {
          const t = e.target.closest('button'); if (!t) return;
          if (t.closest('[data-chips="rank"]')) { rank = oneOf(M.picked(el, 'rank'), RANKS, rank); lists(); }
          else if (t.closest('[data-chips="archetype"]')) archetype = oneOf(M.picked(el, 'archetype'), ARCHETYPE_LIST, archetype);
          else if (t.closest('[data-chips="kind"]')) kind = oneOf(M.picked(el, 'kind'), MONSTER_KINDS, kind);
          else if (t.dataset.editAbility !== undefined) {
            // the ability form is the skill maker's: the ability comes back as the skill it was edited as
            const i = Number(t.dataset.editAbility), was = abilities[i];
            void app.api.skills.make({ initial: { name: was.name, level: 1, label: null, desc: '', type: 'active', ability: was }, library: false }).then(k => {
              if (k && k.type === 'active' && k.ability) { abilities[i] = { ...k.ability, id: was.id }; lists(); shell.changed(); }
            });
            return;
          } else if (t.dataset.rm) {
            const list = t.dataset.rm === 'ability' ? abilities : t.dataset.rm === 'status' ? statuses : items;
            list.splice(Number(t.dataset.i), 1); lists();
          }
          derived(); shell.changed();
        });
        el.addEventListener('input', e => {
          const t = e.target;
          if (t.id === 'enm-hp') derived();
          if (t.dataset.rounds !== undefined) { const st = statuses[Number(t.dataset.rounds)]; if (st) st.rounds = t.value.trim() === '' ? null : int(t.value, 1, B.rounds, 1); }
          if (t.dataset.stacks !== undefined) {
            // a starting count (kits design 5.1, "Starts with 3 Pain"): 1 or empty is none, the rest within the def's cap
            const st = statuses[Number(t.dataset.stacks)], n = int(t.value, 1, stackCap(st ? st.key : ''), 1);
            if (st) { if (n > 1) st.stacks = n; else delete st.stacks; }
          }
        });
        el.addEventListener('change', async e => {
          const t = e.target; if (!t.dataset.add) return;
          const v = t.value; t.value = ''; if (!v) return;
          const lib = store.get().library;
          if (t.dataset.add === 'ability') {
            const seed = SKILL_SEEDS.find(k => `seed:${k.name}` === v), mine = lib.skills.find(k => `lib:${k.id}` === v);
            const k = v === 'new' ? await app.api.skills.make({}) : seed ? skillOf(seed, app.rules()) : mine ? parseSkill(mine) : null;
            const a = k && k.type === 'active' ? k.ability : null;
            if (a && abilities.length < B.abilities && !abilities.some(x => x.id === a.id)) abilities.push(a);
          } else if (t.dataset.add === 'status') {
            if (statuses.length < B.statuses) statuses.push({ key: v, rounds: 3 });
          } else {
            const it = v === 'new' ? await app.api.loot.item({}) : parseItem(lib.items.find(x => `lib:${x.id}` === v));
            if (it && items.length < B.lootItems) items.push(it);
          }
          lists(); shell.changed();
        });
        return {
          preview: () => monsterLines(formMonster()),
          save() {
            const pick = iconRow.pick(), form = { ...formMonster(), ...(pick ? { icon: pick } : {}) };
            if (!form.name) { shell.error('Give the monster a name.'); $('#enm-name').focus(); return undefined; }
            const out = parseMonster(form);
            if (canon(out) !== canon(form)) console.error('The monster maker wrote a monster its parser reads differently', form, out);
            const w = saveMonster({ ...out, id: own ? m.id : null }, !own);
            if (!ui.wrote('! Bestiary', w)) return undefined;
            return w.id;
          },
        };
      },
    });
  }

  app.registerView({
    id: 'bestiary', label: 'Bestiary', icon: '☠', order: 60,
    mount(el) {
      el.innerHTML = `<section class="win"><span class="cb"></span><h2>Bestiary</h2>
        <div class="bst-filter" role="search">
          <span class="grow">${ui.field('Search', '<input type="text" data-q maxlength="40" placeholder="Name or ability" autocomplete="off">')}</span>
          <span class="md">${ui.field('Rank', `<select data-rank><option value="">All</option>${RANKS.map(r => `<option>${r}</option>`).join('')}</select>`)}</span>
          <span class="md">${ui.field('Type', '<select data-type><option value="">All</option></select>')}</span>
          <label class="field chk bst-enc" data-gmenc hidden><input type="checkbox" data-enc> <span>Encountered only</span></label>
          <span data-gmnew hidden><button type="button" class="primary" data-new>New monster</button></span>
        </div>
        <div data-gen hidden></div>
        <div data-editor></div>
        <p class="bst-count" data-count-line aria-live="polite"></p>
        <div class="bst-grid" data-grid></div></section>`;
      const $q = s => el.querySelector(s);
      const gen = $q('[data-gen]');
      gen.innerHTML = `<form class="bst-gen add-row" data-genform autocomplete="off">
        <span class="grow">${ui.field('Generate stat block: name', '<input type="text" name="name" maxlength="60" placeholder="e.g. Cave Stalker">')}</span>
        <span class="sm">${ui.field('Rank', `<select name="rank">${RANKS.map(r => `<option>${r}</option>`).join('')}</select>`)}</span>
        <span class="sm">${ui.field('Archetype', `<select name="archetype">${ARCHETYPE_LIST.map(a => `<option value="${a}">${ARCH_LABEL[a]}</option>`).join('')}</select>`)}</span>
        <span class="sm">${ui.field('Kind', `<select name="kind">${MONSTER_KINDS.map(k => `<option value="${k}">${KIND_LABEL[k]}</option>`).join('')}</select>`)}</span>
        <button type="submit" class="primary">Generate stat block</button></form>`;

      $q('[data-q]').addEventListener('input', e => { f.q = e.target.value; render(el); });
      $q('[data-rank]').addEventListener('change', e => { f.rank = e.target.value; render(el); });
      $q('[data-enc]').addEventListener('change', e => { f.enc = e.target.checked; render(el); });
      $q('[data-type]').addEventListener('change', e => { f.type = e.target.value; render(el); });
      el.addEventListener('input', e => {
        const id = e.target.dataset && e.target.dataset.count; if (!id) return;
        const n = copiesOf(e.target.value); counts.set(id, n);
        const b = e.target.closest('.bst-acts').querySelector('[data-addc]'); b.textContent = `Add to fight ×${n}`;
      });
      gen.querySelector('form').addEventListener('submit', e => {
        e.preventDefault(); const fm = e.target;
        const m = statBlock(oneOf(fm.rank.value, RANKS, 'E'), { archetype: oneOf(fm.archetype.value, ARCHETYPE_LIST, 'brute'), kind: oneOf(fm.kind.value, MONSTER_KINDS, 'normal'), name: fm.name.value.trim() || undefined, type: 'Generated' });
        const w = saveMonster(m, true), i = infoOf(m); if (!ui.wrote('! Bestiary', w)) return;
        f.rank = ''; f.type = ''; f.q = '';
        $q('[data-q]').value = ''; $q('[data-rank]').value = ''; $q('[data-type]').value = '';
        ui.toast('! Bestiary', `${m.name} generated: HP ${ui.fmt(i.hpMax)}, Armor ${i.armor}, Resist ${i.resist}, Speed ${i.speed}.`);
        shown(w.id);
      });
      /** A monster just saved: drawn, brought into view and lit once (motion.ts `flash`). */
      const shown = id => {
        lastHtml = ''; render(el);
        const c = $q(`[data-mid="${CSS.escape(id)}"]`); if (!c) return;
        c.scrollIntoView({ block: 'nearest' }); motion.flash(c);
      };
      const edited = async m => {
        const id = await make(m); if (!id) return;
        shown(id);
        ui.toast('! Bestiary', `${(get(id) || { name: 'Monster' }).name} saved.`);
      };
      $q('[data-new]').addEventListener('click', () => edited({ ...statBlock('E'), id: null }));
      el.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.addc) {
          const m = get(b.dataset.addc); if (!m) return;
          const n = counts.get(m.id) || 1, cs = toCombatant(m, n);
          if (app.api.combat.okToReplace && !(await app.api.combat.okToReplace())) return;
          app.api.combat.add(cs);
          ui.toast('! Combat', `${n} × ${m.name} added to the fight.`);
        } else if (b.dataset.edit) {
          const m = get(b.dataset.edit); if (m) edited(m);
        } else if (b.dataset.dup) {
          const m = get(b.dataset.dup); if (!m) return;
          const w = saveMonster({ ...m, name: `${m.name} (copy)`.slice(0, 60) }, true);
          if (!ui.wrote('! Bestiary', w)) return;
          shown(w.id);
          ui.toast('! Bestiary', `Duplicated ${m.name}.`);
        } else if (b.dataset.merge) {
          const m = get(b.dataset.merge); if (!m) return;
          const kin = codexKey(m.name, m.rank), opts = list().filter(x => x.id !== m.id).sort((a, c) => (codexKey(a.name, a.rank) === kin ? -1 : 0) - (codexKey(c.name, c.rank) === kin ? -1 : 0) || a.name.localeCompare(c.name));
          $q('[data-editor]').innerHTML = `<section class="win bst-ed" aria-label="Merge monster"><span class="cb"></span><h2>Merge ${esc(m.name)} (${esc(m.rank)})</h2>
            <p class="bst-desc">Moves its kills into the chosen entry and removes ${esc(m.name)}.</p>
            <form data-mform data-src="${esc(m.id)}"><div class="bst-form"><span class="wide">${ui.field('Merge into', `<select name="dst">${opts.map(x => `<option value="${esc(x.id)}">${esc(x.name)} (${esc(x.rank)})${x.custom ? ' · custom' : ''}</option>`).join('')}</select>`)}</span></div>
            <div class="data-actions"><button type="button" data-ecancel>Cancel</button><button type="submit" class="primary">Merge</button></div></form></section>`;
          $q('[data-editor]').scrollIntoView({ block: 'nearest' });
        } else if (b.dataset.del) {
          const m = get(b.dataset.del);
          if (m && await ui.confirm({ title: 'Delete monster?', body: m.name, danger: true, confirmLabel: 'Delete' })) {
            remove(m.id);
          }
        } else if (b.hasAttribute('data-ecancel')) $q('[data-editor]').innerHTML = '';
      });
      el.addEventListener('submit', e => {
        if (e.target.matches('[data-mform]')) {
          e.preventDefault(); const dst = get(e.target.elements.dst.value), src = get(e.target.dataset.src);
          if (!mergeInto(e.target.dataset.src, e.target.elements.dst.value)) return;
          $q('[data-editor]').innerHTML = '';
          ui.toast('! Bestiary', `${src.name} merged into ${dst.name}.`);
          lastHtml = ''; render(el); return;
        }
      });
    },
    update(el) { render(el); },
  });

  /** What the search reads of a card: its name, type, notes and abilities' names. */
  const wordsOf = m => [m.name, m.type || '', ...(m.notes || []), ...(m.synthetic ? m.info.abilities : (m.abilities || []).map(a => a.name))];
  function render(el) {
    const gm = app.isGM();
    el.querySelector('[data-gmnew]').hidden = !gm;
    el.querySelector('[data-gen]').hidden = !gm; el.querySelector('[data-gmenc]').hidden = !gm;
    if (!gm) el.querySelector('[data-editor]').innerHTML = '';
    // type filter options (don't rebuild while unchanged so an open select keeps focus)
    const sel = el.querySelector('[data-type]'), types = typeOptions(), sig = types.join('|');
    if (sel.dataset.sig !== sig) { sel.dataset.sig = sig; sel.innerHTML = '<option value="">All</option>' + types.map(t => `<option${t === f.type ? ' selected' : ''}>${esc(t)}</option>`).join(''); }
    if (f.type && !types.includes(f.type)) { f.type = ''; sel.value = ''; }
    const q = f.q.trim().toLowerCase();
    let pool = list(), unknown = 0;
    const seat = app.seat(), codexOnly = seat === 'player'; // a player in a room sees what the room's codex records
    if (codexOnly) {
      const shelf = playerShelf(codexOf(), pool);
      unknown = shelf.unknown;
      // a card of the room's codex alone: no monster of the save holds its id, which keys only the card
      pool = shelf.known.concat(shelf.roomOnly.map(([k, r]) => ({ ...newMonster(), id: /** @type {import('../core/ids.ts').MonsterId} */ ('codex:' + k), name: r.name, rank: r.rank, type: '',
        info: r.info, xp: 0, extractable: false, desc: '', synthetic: true })));
    } else if (gm && f.enc) pool = pool.filter(m => recFor(m));
    const items = pool.filter(m => (!f.rank || m.rank === f.rank) && (!f.type || m.type === f.type) &&
      (!q || wordsOf(m).some(t => t.toLowerCase().includes(q))))
      .sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank) || ((a.kind === 'boss') === (b.kind === 'boss') ? a.name.localeCompare(b.name) : a.kind === 'boss' ? 1 : -1));
    el.querySelector('[data-count-line]').textContent = `${items.length} monster${items.length === 1 ? '' : 's'}${codexOnly && unknown ? ` · ${unknown} creature${unknown === 1 ? '' : 's'} still unknown` : ''}`;
    const html = (items.length ? items.map(m => card(m, gm, runsFight(seat))).join('') : `<p class="empty">${codexOnly && !f.q && !f.rank && !f.type ? 'No creatures recorded yet. Defeat monsters to unlock their info.' : 'No monsters match this filter.'}</p>`) + (gm ? '|gm' : '');
    if (html !== lastHtml) { lastHtml = html; el.querySelector('[data-grid]').innerHTML = html.replace(/\|gm$/, ''); }
  }
}

// skills.js (U04): Skills panel on Status, active/passive skills, levels (1-10), and the skill maker (`app.api.skills.make`,
// on maker.js's shell), which saves the GM's skills to `library.skills`. An active skill's fight use is its ability, made
// from one of the five kinds (src/core/registry/ability-kinds.ts). The built-in skills and the one skill parser are in
// src/core/registry/skills.ts.
import { pickables, pickedRef, sheetName } from '../core/party.ts';
import { SKILL_BOUNDS, SKILL_SEEDS, parseSkill, skillOf } from '../core/registry/skills.ts';
import { describeAbility, formulaOf, kindDefaults } from '../core/registry/ability-kinds.ts';
import { abilityWorth, gateCredit, wornWorth } from '../core/registry/worth.ts';
import { exampleSkills } from '../core/registry/kit-examples.ts';
import { describeStatus, reactionMayHold } from '../core/combat/effect-ops.ts';
import { abilityId } from '../core/combat/ability-types.ts';
import { opLines } from '../core/combat/effect-ops.ts';
import { printFormula } from '../core/formula.ts';
import { tiles } from '../core/combat/space.ts';
import { roundsOf } from '../core/combat/timeline.ts';
import { oneOf } from '../core/one-of.ts';
import { gmSource } from '../core/effects.ts';
import { BONUS_KEYS, BONUS_LABELS, rules } from '../edge/rules.ts';
import { newRewards } from '../core/rewards.ts';
import { SKILL_MAX_LEVEL, editSkill, forgetSkill, addSkill, levelUpSkill } from '../core/hunter/skills-held.ts';
import { saveEntry, savedWords } from '../core/library.ts';
import { fitted } from '../core/hunter/sheet.ts';
import { atHunter, atLibrary, both } from '../core/save-step.ts';
import { useWords } from '../core/hunter/use.ts';
import { reportWords } from '../core/sync/connection.ts';
import { tooLarge } from '../core/size.ts';

const BONUS_LABEL = { ...BONUS_LABELS, hpMax: 'Max HP', manaMax: 'Max mana' };
const KINDS = /** @type {const} */ (['strike', 'shot', 'blast', 'curse', 'support']);
const KIND_LABEL = { strike: 'Strike (melee)', shot: 'Shot (ranged)', blast: 'Blast (area)', curse: 'Curse (spell)', support: 'Support (heal or shield)', none: 'No fight use' };
const AIM_LABEL = { foe: 'On a foe', ally: 'On an ally', self: 'On the user', place: 'On a place' };
const EFFECT_LABEL = { physical: 'Physical damage', arcane: 'Arcane damage', heal: 'Heals', shield: 'Shield' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const hunterOf = h => (typeof h === 'string' ? store.hunter(h) : h) || null;

  // ── app.api.skills (§B5) ──
  /**
   * A skill's Use on the Skills panel. On a player's phone with a row in the GM's fight it is a `cast` (app.api.uses). In this phone's own
   * fight it is used from the hunter's card there. Outside a fight it costs nothing (a cost is the fight's): an ability
   * on the user puts its ops on the hunter, one on another is told to the GM to rule on.
   * @param {string} hid @param {string} skillId @returns {boolean}
   */
  const use = (hid, skillId) => {
    const h = store.hunter(hid), s = h && h.skills.find(x => x.id === skillId);
    if (!s || s.type !== 'active') return false;
    const a = s.ability;
    if (a && app.api.uses.onTable(hid)) { void app.api.uses.cast(hid, a.id); return true; }
    if (a && app.api.loadouts.inFight(hid)) { ui.toast('System', `Use ${s.name} from ${h.name}'s card in the fight.`, { kind: 'info' }); return false; }
    if (a && a.aim !== 'self') {
      void app.api.uses.report(hid, { what: 'skill', name: s.name, text: s.desc, target: 'other', tell: false })
        .then(w => { if (ui.wrote('System', w)) ui.toast('System', `${s.name} activated.${w.sent ? ` ${reportWords(app.api.sync.conn())}` : ''}`, { kind: 'info' }); });
      return true;
    }
    const w = a ? app.api.effects.applyOps(hid, a.ops, { label: s.name, source: gmSource(h.rank) }) : { ok: /** @type {const} */ (true), lines: [] };
    if (!ui.wrote('System', w, useWords(s.name))) return false;
    ui.toast('System', `${s.name} activated.${w.lines.length ? ` ${w.lines.join(', ')}.` : ''}`, { kind: 'info' });
    return true;
  };

  app.api.skills = { make, lines: skillLines, give };

  // ── the skill maker ──
  const lib = () => store.get().library.skills;
  const int = (v, lo, hi) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; };
  /** Keys sorted, so the form's skill and the parser's compare by what they hold. */
  const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
  const bonusText = b => BONUS_KEYS.filter(k => b && b[k]).map(k => `${b[k] > 0 ? '+' : ''}${b[k]} ${BONUS_LABEL[k]}`).join(', ');
  /** @type {import('../core/api.ts').SkillsApi['lines']} */
  function skillLines(k, from) {
    if (k.type === 'passive') { const b = bonusText(k.bonus); return b ? [`While known: ${b}`] : []; }
    const a = k.ability; if (!a) return [KIND_LABEL.none];
    const R = rules(), pace = Object.entries(R.fight.cost).find(([, n]) => n === a.cost.time), rounds = roundsOf(a.cost.cooldown, R, 'near');
    const cost = [a.cost.fatigue ? `${a.cost.fatigue} fatigue` : '', a.cost.mana ? `${a.cost.mana} mana` : ''].filter(Boolean).join(', ');
    return [
      `${KIND_LABEL[a.kind]}${pace ? `, ${pace[0]}` : ''} · ${AIM_LABEL[a.aim]}${a.aim === 'self' ? '' : `, ${plural(a.range, 'tile')}`}`,
      [cost ? `Costs ${cost}` : 'No cost', rounds ? `ready again after ${plural(rounds, 'round')}` : ''].filter(Boolean).join(', '),
      a.effect ? `${EFFECT_LABEL[a.effect.type]}: ${printFormula(formulaOf(a, R))}${a.effect.by === 'hand' ? ' (edited)' : ''}` : '',
      ...opLines(a.ops, from ? from.tier : null, R),
    ].filter(Boolean);
  }

  /** @type {import('../core/api.ts').SkillsApi['make']} */
  function make({ initial, library = app.isGM(), give = null } = {}) {
    const was = initial && typeof initial === 'object' ? parseSkill({ ...initial, name: 'x' }) : null;
    const name0 = was ? String(initial.name || '') : '';
    const wasAbility = was && was.type === 'active' ? was.ability : null;
    // the ability's id is made once, when the skill is, and kept across every edit (a rename, a new kind): the fight's
    // cooldowns and uses and the hotbar's pins key on it
    const ownId = wasAbility ? wasAbility.id : abilityId(store.id('ab'));
    const wasWorn = was && was.type === 'passive' && was.worn ? was.worn : null;
    const M = app.api.maker;
    let type = was ? was.type : 'active';
    let kind = was && was.type === 'active' ? (wasAbility ? wasAbility.kind : 'none') : 'strike';
    return M.open({
      tag: '! Skill', title: name0 ? 'Edit skill' : 'New skill', save: 'Save skill', cls: 'skm',
      build(el, shell) {
        const R = rules();
        el.innerHTML = `<div class="skm-cols"><div class="skm-col">
          ${ui.field('Name', `<input type="text" id="skm-name" maxlength="${SKILL_BOUNDS.name}" autocomplete="off" placeholder="e.g. Frost Lance" value="${esc(name0)}">`)}
          <div class="lbl">Type</div>
          ${M.chips('type', [['active', 'Active'], ['passive', 'Passive']], type, { label: 'Type' })}
          ${ui.field('Description', `<textarea id="skm-desc" maxlength="${SKILL_BOUNDS.desc}">${esc(was ? was.desc : '')}</textarea>`)}
          ${ui.field('Custom label', `<input type="text" id="skm-label" maxlength="${SKILL_BOUNDS.label}" autocomplete="off" placeholder="Default: level (Lv.${was ? was.level : 1})" value="${esc(was && was.label ? was.label : '')}">`)}
          <div data-active>
            <div class="lbl">Ability type</div>
            ${M.chips('kind', [...KINDS, 'none'].map(k => [k, KIND_LABEL[k]]), kind, { label: 'Ability type' })}
            <div data-self-w><div class="lbl">Affects</div>${M.chips('aim', [['ally', 'An ally'], ['self', 'The user']], wasAbility && wasAbility.aim === 'self' ? 'self' : 'ally', { label: 'Affects' })}</div>
            <div data-ability-form></div>
          </div>
          <div data-passive><div class="lbl">Passive stat bonuses</div>${M.bonus(was && was.type === 'passive' ? was.bonus : {})}
            <details class="mk-group" data-group="worn"><summary data-sum="worn"></summary><div class="mk-group-body">
              <label class="mk-check"><input type="checkbox" data-worn${wasWorn ? ' checked' : ''}><span>Grants a status during a fight</span></label>
              <div data-worn-f><div class="lbl">Status effects</div><div data-worn-fx></div><div data-worn-kit></div></div>
            </div></details></div>
          </div><div class="skm-col" data-later>
          <div data-active-fx><div class="lbl">Effects on each target</div><div data-fx></div></div>
          <div data-worth-box></div>
          <div data-mk-preview></div>
          ${give ? `<div class="lbl">Give to</div>${M.chips('give', receivers(), give, { many: true, label: 'Give to' })}` : ''}
          ${library ? '<label class="skm-chk"><input type="checkbox" id="skm-save" checked><span>Save to library</span></label>' : ''}
          </div></div>`;
        const $ = sel => el.querySelector(sel);
        const fx = M.effects($('[data-fx]'), { ops: wasAbility ? wasAbility.ops : [], kind: 'skill', newStatus: () => app.api.forge.status({ mode: 'library' }) });
        const form = M.ability($('[data-ability-form]'), { kind: oneOf(kind, KINDS, 'strike'), ability: wasAbility });
        // the worn status's editors are drawn when its box is first ticked
        let wornFx = { ops: () => [], blocked: () => false }, wornKit = { fields: () => ({}), blocked: () => false }, wornMade = false;
        const wornEditors = () => {
          if (wornMade) return; wornMade = true;
          wornFx = M.effects($('[data-worn-fx]'), { ops: wasWorn ? wasWorn.ops : [], kind: 'status', newStatus: () => app.api.forge.status({ mode: 'library' }) });
          wornKit = M.statusBlocks($('[data-worn-kit]'), wasWorn, 'skw');
        };
        /** The status a passive wears into a fight: named after the skill, its ops and its kits groups; null when not ticked. */
        const wornOf = name => {
          if (!$('[data-worn]').checked) return null;
          const label = wasWorn && name === name0 ? wasWorn.label : name.slice(0, SKILL_BOUNDS.name);
          return { label, desc: wasWorn ? wasWorn.desc : '', ops: wornFx.ops(), ...(wasWorn && wasWorn.color ? { color: wasWorn.color } : {}), ...(wasWorn && wasWorn.icon ? { icon: wasWorn.icon } : {}), ...wornKit.fields() };
        };
        /**
         * The ability the form holds: its kind's fields as the ability form has them, and its effects. A support on the
         * user reaches only the user. Null while the formula does not read.
         */
        const formAbility = name => {
          if (kind === 'none') return null;
          const k = oneOf(kind, KINDS, 'strike'), d = kindDefaults(k, R);
          const v = form.value(ownId, name);
          if (!v) return null;
          const self = k === 'support' && M.picked(el, 'aim') === 'self';
          /** @type {Partial<import('../core/combat/ability-types.ts').Ability>} */
          const reach = self ? { aim: 'self', shape: { kind: 'self' }, range: tiles(0) } : { aim: d.aim, foesOnly: d.foesOnly };
          return { ...v, ...reach, ops: /** @type {import('../core/combat/effect-ops.ts').UseOp[]} */ (fx.ops()) };
        };
        /**
         * The skill the form holds, every number inside `SKILL_BOUNDS`.
         * @returns {import('../core/registry/skills.ts').SkillTemplate}
         */
        const formSkill = () => {
          const name = $('#skm-name').value.trim().slice(0, SKILL_BOUNDS.name), base = { name, level: was ? was.level : 1, label: $('#skm-label').value.trim().slice(0, SKILL_BOUNDS.label) || null, desc: $('#skm-desc').value.slice(0, SKILL_BOUNDS.desc) };
          if (type === 'active') return { ...base, type: 'active', ability: formAbility(name) };
          const bonus = {};
          for (const [k, v] of Object.entries(M.readBonus(el))) bonus[k] = Math.min(SKILL_BOUNDS.bonus, Math.max(-SKILL_BOUNDS.bonus, v));
          const worn = wornOf(name || 'Passive');
          return worn ? { ...base, type: 'passive', bonus, worn } : { ...base, type: 'passive', bonus };
        };
        const sync = () => {
          const active = type === 'active', fight = active && kind !== 'none';
          $('[data-active]').hidden = !active;
          $('[data-active-fx]').hidden = !fight;
          $('[data-passive]').hidden = active;
          $('[data-self-w]').hidden = kind !== 'support';
          $('[data-ability-form]').hidden = !fight;
          if (fight) form.setKind(oneOf(kind, KINDS, 'strike'));
          if ($('[data-worn]').checked) wornEditors();
          $('[data-worn-f]').hidden = !$('[data-worn]').checked;
          $('[data-sum="worn"]').textContent = $('[data-worn]').checked ? 'Fight status: set' : 'Fight status: none';
        };
        /**
         * The worth line under the preview (worth.ts, kits design 5.1): an ability with the credit of the mode that opens it,
         * its entry looked for among the library's skills, the active hunter's and the kits' examples (`gateCredit`).
         */
        const drawWorth = M.worth($('[data-worth-box]'));
        const others = () => [...lib(), ...(store.active() ? store.active().skills : []), ...exampleSkills(rules())]
          .flatMap(x => (x.type === 'active' && x.ability ? [x.ability] : []));
        const showWorth = k => {
          const R2 = rules();
          drawWorth(k.type === 'active' && k.ability ? abilityWorth(k.ability, R2, { credit: gateCredit(k.ability, others(), R2) }) : k.type === 'passive' && k.worn ? wornWorth(k.worn, R2) : null);
        };
        sync();
        el.addEventListener('click', e => {
          if (e.target.closest('[data-chips="type"]')) type = M.picked(el, 'type') === 'passive' ? 'passive' : 'active';
          if (e.target.closest('[data-chips="kind"]')) kind = String(M.picked(el, 'kind') || kind);
          sync();
        });
        el.addEventListener('input', sync);
        el.addEventListener('change', sync);
        return {
          preview: () => {
            const k = formSkill(); showWorth(k);
            return [...skillLines(k), ...(k.type === 'active' && k.ability ? describeAbility(k.ability, rules()) : []), ...(k.type === 'passive' && k.worn ? describeStatus(k.worn, null, rules()).map(l => `In a fight: ${l}`) : [])];
          },
          blocked: () => (type === 'active' && kind !== 'none' && (fx.blocked() || form.blocked())) || (type === 'passive' && $('[data-worn]').checked && (wornFx.blocked() || wornKit.blocked())),
          save() {
            const form = formSkill();
            if (!form.name) { shell.error('Give the skill a name.'); $('#skm-name').focus(); return undefined; }
            if (form.type === 'active' && form.ability && form.ability.react && !form.ability.ops.every(reactionMayHold)) {
              shell.error('A reaction cannot push, pull, or grant an extra action. Remove that effect or uncheck Reaction.'); return undefined;
            }
            if (form.type === 'active' && form.ability && form.ability.channel && form.ability.move) {
              shell.error('A channeled ability cannot teleport or swap places. Turn off channeling or set User movement to None.'); return undefined;
            }
            const big = form.type === 'active' ? (form.ability ? tooLarge('ability', form.ability) : null) : form.worn ? tooLarge('status', form.worn) : null;
            if (big) { shell.error(big); return undefined; }
            const out = parseSkill(form);
            if (!out || canon(out) !== canon(form)) console.error('The skill maker wrote a skill its parser reads differently', form, out);
            if (out && library && $('#skm-save').checked && !ui.wrote('Workshop', saveToLibrary(out, initial && initial.id), savedWords('skill', out.name))) return undefined;
            const to = give ? /** @type {string[]} */ (M.picked(el, 'give')) : [];
            if (out && to.length) void giveTo(out, to).then(names => { if (names.length) acquired(out, names); });
            return out || undefined;
          },
        };
      },
    });
  }
  /** Saves `k` to the library by its id (library.ts `saveEntry`); answers the write's Applied whole (full, or a name another skill holds). */
  const saveToLibrary = (k, editId) => store.apply('library-skill', atLibrary(l => saveEntry(l, 'skills', { ...k, id: editId || store.id('s') })));

  // ── giving a skill: a hunter of this phone gets a copy at once, a player's sheet in the room an award of that skill alone ──
  /**
   * Whom a skill can be given to, as chip options: this phone's hunters (`l:` id), then, on the room's GM phone, the players' sheets (`r:` key).
   * @returns {[string, string][]}
   */
  function receivers() {
    /** @type {[string, string][]} */
    const out = pickables(store.get().hunters, app.api.sync.remoteSheets()).map(p => [p.id, p.ref.kind === 'remote' ? `${p.name} (player)` : p.name]);
    return out;
  }
  /** Gives `k` to each receiver in `to`; answers the names it reached. A hunter here holding a skill of that name has it replaced. */
  async function giveTo(k, to) {
    const names = [], remote = [], list = pickables(store.get().hunters, app.api.sync.remoteSheets());
    for (const v of to) {
      const ref = pickedRef(list, v); if (!ref) continue;
      if (ref.kind === 'remote') { remote.push(ref.remote); continue; }
      const h = store.hunter(ref.hunterId);
      if (h && app.api.hunter.applyRewards(h.id, { skills: [k] }, { silent: true })) names.push(h.name);
    }
    if (remote.length) {
      const S = app.api.sync, sent = S.post(S.event('award', { to: remote, rewards: { ...newRewards(), skills: [k] } }));
      if (!sent.ok) ui.toast('Warning', `Not in a room. ${k.name} was not sent to the players.`, { kind: 'warning' });
      else names.push(...remote.map(key => sheetName(app.api.sync.remoteSheets(), key, 'a player')));
    }
    return names;
  }

  /** @type {import('../core/api.ts').SkillsApi['give']} */
  async function give(k) {
    const to = await ui.system({ tag: '! Skills', title: `Give ${k.name} to…`, layout: 'list',
      actions: [...receivers().map(([v, label]) => ({ label, value: v })), { label: 'Cancel', value: null, cancel: true }] });
    if (!to) return;
    const names = await giveTo(parseSkill(k) || k, [String(to)]);
    if (names.length) ui.toast('! Skills', `${k.name} given to ${names.join(', ')}.`);
  }

  // ── panel ──
  const card = s => {
    const lv = s.label || `Lv.${s.level}`, max = s.level >= SKILL_MAX_LEVEL;
    const bon = s.type === 'passive' ? bonusText(s.bonus) : '';
    const [meta, ...fx] = s.type === 'active' ? skillLines(s) : [bon];
    // its name opens what it does (app.api.detail): an active skill's ability, a passive's worn status; a passive with
    // none has only the bonus its card already says
    /** @type {import('../core/detail.ts').Thing | null} */
    const thing = s.type === 'active' && s.ability ? { kind: 'ability', ability: s.ability } : s.type === 'passive' && s.worn ? { kind: 'status', label: s.worn.label, def: s.worn, tier: null } : null;
    const title = thing ? `<button type="button" class="s-title"${app.api.detail.control('skills', s.id)}>${esc(s.name)}</button>` : `<span class="s-title">${esc(s.name)}</span>`;
    return `<li class="skill sk-${s.type}" data-skill="${esc(s.id)}">
      <div class="sk-head">${title}
        <span class="sk-type">${s.type === 'active' ? 'Active' : 'Passive'}</span>
        <span class="s-rank">${esc(lv)}${max ? ' <b class="sk-max">MAX</b>' : ''}</span></div>
      ${thing ? app.api.detail.panel('skills', s.id, thing) : ''}
      ${meta ? `<div class="sk-meta">${esc(meta)}</div>` : ''}
      ${fx.length ? `<div class="sk-meta sk-fx">${fx.map(esc).join(' · ')}</div>` : ''}
      ${s.desc ? `<div class="sk-desc">${esc(s.desc)}</div>` : ''}
      <div class="sk-acts">
        ${s.type === 'active' ? `<button type="button" data-use="${esc(s.id)}" aria-label="Use ${esc(s.name)}">Use</button>` : ''}
        <button type="button" data-lvup="${esc(s.id)}"${max ? ' disabled' : ''} aria-label="Level up ${esc(s.name)}">Level up</button>
        <button type="button" data-edit="${esc(s.id)}" aria-label="Edit ${esc(s.name)}">Edit</button>
        <button type="button" class="icon-btn danger" data-del="${esc(s.id)}" aria-label="Remove skill ${esc(s.name)}">&times;</button>
      </div></li>`;
  };
  const cards = () => { const list = store.active().skills; return list.length ? list.map(card).join('') : '<li class="empty">No skills yet.</li>'; };
  const acquired = (k, names) => ui.system({ tag: '! Notification', title: 'Skill acquired', kind: 'info', body: k.name,
    lines: [`${k.type === 'active' ? 'Active' : 'Passive'} skill · ${k.label || 'Lv.' + k.level}`, ...(names ? [`Given to: ${names.join(', ')}`] : [])] });
  /** What the player reads when a skill of `k`'s name is held already (skills-held.ts `held`). */
  const heldWords = k => ({ held: `You already have a skill called ${k.name}. Edit that one, or give this one another name.` });
  /** Adds a copy of `k` to the active hunter. */
  const learn = k => { const id = store.id('s'); if (ui.wrote('Skills', onSkills(store.active().id, 'skill-add', h => addSkill(h, k, id)), heldWords(k))) acquired(k); };
  /** A change to the skills of hunter `hid`: a passive's bonus is on the sheet, so its maxima are fitted after it. */
  const onSkills = (hid, why, step) => store.apply(why, atHunter(hid, both(step, h => fitted(h, app.rules()))));

  app.registerPanel({
    view: 'status', id: 'skills', order: 40, title: 'Skills', jump: 'Skills',
    mount(el) {
      el.innerHTML = `<ul class="plain" data-list></ul>
        <div class="sk-bar"><button type="button" class="primary" data-new>Add skill</button><button type="button" data-seeds>Add from list</button></div>`;
      app.api.detail.wire(el, () => { el.querySelector('[data-list]').innerHTML = cards(); });
      el.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        const hid = store.active().id, find = id => store.active().skills.find(x => x.id === id);
        // a GM's maker gives the skill to whom it picks (the active hunter, pressed at the start); a player's goes to the active hunter
        if (b.hasAttribute('data-new')) { const gm = app.isGM(), k = await make({ give: gm ? [hid] : null }); if (k && !gm) learn(k); }
        else if (b.hasAttribute('data-seeds')) {
          const have = new Set(store.active().skills.map(s => s.name.toLowerCase()));
          const pick = await ui.system({
            tag: '! Skills', title: 'Add from list', layout: 'list',
            actions: [
              ...SKILL_SEEDS.filter(s => !have.has(s.name.toLowerCase())).map(s => ({ label: `${s.name} (${s.type})`, value: `seed:${s.name}` })),
              ...lib().filter(s => !have.has(s.name.toLowerCase())).map(s => ({ label: `${s.name} (${s.type}, library)`, value: `lib:${s.id}` })),
              { label: 'Cancel', value: null, cancel: true }],
          });
          const seed = SKILL_SEEDS.find(s => `seed:${s.name}` === pick), mine = lib().find(s => `lib:${s.id}` === pick);
          const k = seed ? skillOf(seed, app.rules()) : mine ? parseSkill(mine) : null;
          if (k) learn(k);
        }
        else if (b.dataset.use) use(hid, b.dataset.use);
        else if (b.dataset.lvup) {
          const s = find(b.dataset.lvup);
          if (s && ui.wrote('Skills', onSkills(hid, 'skill-lv', h => levelUpSkill(h, s.id)))) {
            ui.toast('System', `${s.name} reached Lv.${s.level}${s.level >= SKILL_MAX_LEVEL ? ' (MAX)' : ''}.`);
          }
        } else if (b.dataset.edit) {
          const s = find(b.dataset.edit); if (!s) return;
          const k = await make({ initial: s, library: false });
          if (k) ui.wrote('Skills', onSkills(hid, 'skill-edit', h => editSkill(h, s.id, k)), heldWords(k));
        } else if (b.dataset.del) {
          const s = find(b.dataset.del);
          if (s && await ui.confirm({ title: 'Remove skill?', body: s.name, danger: true, confirmLabel: 'Remove skill' })) {
            ui.wrote('Skills', onSkills(hid, 'skill-del', h => forgetSkill(h, s.id)));
          }
        }
      });
    },
    update(el) {
      el.querySelector('[data-list]').innerHTML = cards();
    },
  });

  ui.css('skills', `
.skill{flex-direction:column;align-items:stretch;gap:6px}
.skill .sk-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.skill button.s-title{min-height:var(--control-h);border:0;background:none;padding:0;text-align:left;color:inherit;font:inherit;font-weight:600}
.sk-type{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);border:1px solid var(--line);padding:1px 6px}
.sk-passive .sk-type{color:var(--gold)}
.sk-max{color:var(--gold)}
.sk-meta{font-family:var(--font-mono);font-size:13px;color:var(--cyan)}
.sk-desc{font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.sk-acts{display:flex;gap:6px;flex-wrap:wrap}
.sk-bar{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.sk-fx{color:var(--ice)}
.skm-win{max-width:540px;width:100%}
.skm-cols,.skm-col{display:contents}
@media (min-width:1100px){
  .skm-win.dlg-form{max-width:760px;width:min(760px,calc(100vw - 48px))}
  .skm-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 22px;align-items:start}
  .skm-col{display:flex;flex-direction:column;gap:8px;min-width:0}
}
.skm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px}
.skm-chk{display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer}
.skm-chk input{width:20px;height:20px;margin:0}
@media (max-width:720px){.sk-acts button{flex:1}}
`);
}

// loot.js (G06): the item maker, which saves to the GM's item library (the Workshop lists it). Publishes app.api.loot = { item }.
// The maker is one form with everything an item has, built from maker.js, and answers what parseItem gives back for it.
// The worn block (slot, weight, armor and resist, the bonus while worn) shows for a weapon, armor or accessory; a weapon
// also has its dice and how it attacks. What an item does when used is its effect rows, ops of the fight. Its grade
// (minus, middle, plus) is a row of chips named for the rarity picked, Epic−, Epic, Epic+; a blank Value shows the price
// the rule gives the rarity, grade and type (`valueOf`). Under the preview, a worn item's spend line says what it spends
// of its tier's budget against the grade picked (item-budget.ts `spendLine`): a warning when the grade is under it, never a refusal.
import { BONUS_LABELS, TIERS, rules } from '../edge/rules.ts';
import { ITEM_TYPES } from '../core/save.ts';
import { atLibrary } from '../core/save-step.ts';
import { saveEntry, savedWords } from '../core/library.ts';
import { oneOf } from '../core/one-of.ts';
import { REVIVE_TEXT, effectsOf, gradeLabel } from '../core/effects.ts';
import { weaponLines } from '../core/detail.ts';
import { parseFormula } from '../core/formula.ts';
import { describeStatus } from '../core/combat/effect-ops.ts';
import { wornWorth } from '../core/registry/worth.ts';
import { itemSpend, spendLine } from '../core/registry/item-budget.ts';
import { ATTACKS, GRADES, ITEM_BOUNDS, KIT_SHARE, RARITIES, SAMPLE_WEARER, SLOTS, SLOT_LABELS, parseItem, piece, valueOf, weightOf, wornSpeed } from '../core/registry/items.ts';
import { tooLarge } from '../core/size.ts';
import { abilityId } from '../core/combat/ability-types.ts';
import { kindDefaults } from '../core/registry/ability-kinds.ts';
import { tiles } from '../core/combat/space.ts';
import { iconField } from './maker.js';

const TYPE_LABEL = { weapon: 'Weapon', armor: 'Armor', accessory: 'Accessory', consumable: 'Consumable', material: 'Material', key: 'Key', misc: 'Misc' };
const AUTO_SLOT = { weapon: 'weapon', armor: 'chest', accessory: 'ring1' };
/** The types a hunter wears: only these show the slot, the gear numbers and the bonus. */
const WORN = Object.keys(AUTO_SLOT);
/** The kinds of ability an item's wearer may be given (the skill maker's), and what each is called. */
const ACTIVE_KINDS = /** @type {const} */ (['strike', 'shot', 'blast', 'curse', 'support']);
const ACTIVE_LABEL = { strike: 'Strike (melee)', shot: 'Shot (ranged)', blast: 'Blast (area)', curse: 'Curse (spell)', support: 'Support (heal or shield)' };
const ATTACK_LABEL = { strike: 'Strike (melee)', shot: 'Shot (ranged)' };
const KITS = /** @type {const} */ ([['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']]);
/** The gear numbers of a worn item, each a field of the form. */
const GEAR = [['weight', 'Weight'], ['armor', 'Armor'], ['resist', 'Resist']];
const BONUS_LABEL = { ...BONUS_LABELS, hpMax: 'Max HP', manaMax: 'Max mana' };
const cap = s => s[0].toUpperCase() + s.slice(1);
const int = (v, lo, hi) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; };
/** Keys sorted, so the form's item and the parser's compare by what they hold. */
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const E = () => app.api.effects;

  ui.css('loot', `
.lf-win{max-width:540px;width:100%}
.lf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.lf-grid .wide{grid-column:1/-1}
.lf-gear{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.lf-chk{display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer}
.lf-chk input{width:20px;height:20px;margin:0}
.lf-cols,.lf-col{display:contents}
.lf-unworn [data-worn]{display:none}
.lf-worn{display:flex;flex-direction:column;gap:8px}
.lf-active-body{display:flex;flex-direction:column;gap:8px;min-width:0}
.lf-spend{margin:0;font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}.lf-spend.over{color:var(--gold)}
@media (min-width:1100px){
  .lf-win.dlg-form{max-width:760px;width:min(760px,calc(100vw - 48px))}
  .lf-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 22px;align-items:start}
  .lf-col{display:flex;flex-direction:column;gap:8px;min-width:0}
}
`);

  const bonusText = b => Object.entries(b || {}).map(([k, n]) => `${n > 0 ? '+' : ''}${n} ${BONUS_LABEL[k] || k}`).join(', ');

  // ── the item maker ──
  /** @type {import('../core/api.ts').LootApi['item']} */
  function item({ initial, library = true } = {}) {
    const ini = initial && typeof initial === 'object' ? parseItem({ name: 'x', ...initial }) : null;
    const was = ini ? { ...ini, name: initial.name || '' } : null;
    const M = app.api.maker, gm = app.isGM(), B = ITEM_BOUNDS;
    const wasActive = was && was.active ? was.active : null;
    let type = was ? was.type : 'misc', slotDirty = !!(was && was.slot);
    return M.open({
      tag: '! Loot', title: was && was.name ? 'Edit item' : 'New item', save: 'Save item', cls: 'lf',
      build(el, shell) {
        el.innerHTML = `<div class="lf-cols"><div class="lf-col">
          ${ui.field('Name', `<input type="text" id="lf-name" maxlength="${B.name}" autocomplete="off" value="${esc(was ? was.name : '')}">`)}
          <div data-icon></div>
          <div class="lbl">Type</div>
          ${M.chips('type', ITEM_TYPES.map(t => [t, TYPE_LABEL[t] || cap(t)]), type, { label: 'Type' })}
          <div class="lf-grid">
            ${ui.field('Rarity', `<select id="lf-rar">${TIERS.map(t => `<option value="${t}"${was && t === was.rar ? ' selected' : ''}>${cap(t)}</option>`).join('')}</select>`)}
            ${ui.field('Quantity', `<input type="number" id="lf-qty" inputmode="numeric" min="1" max="${B.qty}" value="${esc(was ? was.qty : 1)}">`)}
            <div class="wide">${ui.field('Value (gold)', `<input type="number" id="lf-value" inputmode="numeric" min="0" max="${B.value}" value="${esc(was && was.value !== undefined ? was.value : '')}">`)}</div>
            <div class="wide"><div class="lbl">Item grade</div>${M.chips('grade', GRADES.map(g => [String(g), gradeLabel(was ? was.rar : 'common', g)]), String(was && was.grade ? was.grade : 0), { label: 'Item grade' })}</div>
            <div class="wide">${ui.field('Description', `<textarea id="lf-desc" maxlength="${B.desc}">${esc(was ? was.desc : '')}</textarea>`)}</div>
          </div>
          <div class="lf-worn" data-weapon>
            ${ui.field('Weapon damage', `<input type="text" id="lf-dice" maxlength="${B.dice}" placeholder="1d8" autocomplete="off" value="${esc(was ? was.dice : '')}">`)}
            <p class="mk-fx-err" data-dice-err></p>
            <div class="lbl">Attacks with</div>
            ${M.chips('attack', ATTACKS.map(a => [a, ATTACK_LABEL[a]]), was && was.attack ? was.attack : 'strike', { label: 'Attacks with' })}
            <label class="lf-chk" data-finesse-w><input type="checkbox" id="lf-finesse"${was && was.finesse ? ' checked' : ''}><span>Finesse (uses Agility if higher)</span></label>
            <label class="lf-chk" data-twohanded-w><input type="checkbox" id="lf-twohanded"${was && was.twoHanded ? ' checked' : ''}><span>Two-handed (uses both hands)</span></label>
          </div>
          <div class="lf-worn" data-worn>
            ${ui.field('Slot', `<select id="lf-slot"><option value="">None</option>${SLOTS.map(s => `<option value="${s}">${SLOT_LABELS[s] || s}</option>`).join('')}</select>`)}
            <div data-kit-w><div class="lbl">Fill with standard gear stats</div><div class="mk-chips" role="group" aria-label="Fill with standard gear stats">${KITS.map(([k, l]) => `<button type="button" class="mk-chip" data-kit="${k}">${esc(l)}</button>`).join('')}</div></div>
            <div class="lf-gear">${GEAR.map(([k, l]) => ui.field(l, `<input type="number" inputmode="numeric" min="0" max="${B[k]}" data-gear="${k}" value="${esc(was ? (was[k] ?? '') : k === 'weight' ? '' : 0)}">`)).join('')}</div>
            <div class="lbl">Stat bonuses while equipped</div>
            ${M.bonus(was ? was.bonus : {}, { min: -B.bonus, max: B.bonus })}
            <details class="mk-group" data-group="worn"><summary data-sum="worn"></summary><div class="mk-group-body">
              <label class="lf-chk"><input type="checkbox" data-worn-on${was && was.worn ? ' checked' : ''}><span>Grants a status while equipped in a fight</span></label>
              <div data-worn-f><div class="lbl">Status effects</div><div data-worn-fx></div><div data-worn-kit></div></div>
            </div></details>
            <details class="mk-group" data-group="active"><summary data-sum="active"></summary><div class="mk-group-body">
              <label class="lf-chk"><input type="checkbox" data-active-on${was && was.active ? ' checked' : ''}><span>Grants an active ability while equipped</span></label>
              <div class="lf-active-body" data-active-f>
                <div class="lbl">Ability type</div>
                ${M.chips('akind', ACTIVE_KINDS.map(k => [k, ACTIVE_LABEL[k]]), wasActive ? wasActive.kind : 'support', { label: 'Ability type' })}
                <div data-active-self-w><div class="lbl">Affects</div>${M.chips('aaim', [['ally', 'An ally'], ['self', 'The user']], wasActive && wasActive.aim === 'self' ? 'self' : 'ally', { label: 'Affects' })}</div>
                <div data-active-form></div>
                <div class="lbl">Effects on each target</div><div data-active-fx></div>
              </div>
            </div></details>
          </div>
          </div><div class="lf-col" data-later>
          <div class="lbl">Effects when used</div>
          <div data-fx></div>
          <div data-target-w><div class="lbl">Affects</div>${M.chips('target', [['self', 'The user'], ['other', 'A target']], was && was.target === 'other' ? 'other' : 'self', { label: 'Affects' })}</div>
          <div data-worth-box></div>
          <div data-mk-preview></div>
          <p class="lf-spend" data-spend hidden></p>
          ${gm ? `<label class="lf-chk"><input type="checkbox" id="lf-tell"${was && was.tell ? ' checked' : ''}><span>Notify GM when used</span></label>` : ''}
          ${gm ? `<label class="lf-chk" data-revive-w><input type="checkbox" id="lf-revive"${was && was.revive ? ' checked' : ''}><span>${esc(REVIVE_TEXT)}</span></label>` : ''}
          ${gm ? `<label class="lf-chk" data-rank-cap-w><input type="checkbox" id="lf-rank-cap"${was && was.rankCap ? ' checked' : ''}><span>Limit to hunters of this rarity's rank or lower</span></label>` : ''}
          ${library ? '<label class="lf-chk"><input type="checkbox" id="lf-save" checked><span>Save to library</span></label>' : ''}
          </div></div>`;
        const $ = s => el.querySelector(s), slotSel = $('#lf-slot');
        const gearInput = k => /** @type {HTMLInputElement} */ ($(`[data-gear="${k}"]`));
        const rarity = () => oneOf($('#lf-rar').value, RARITIES, 'common');
        const grade = () => oneOf(Number(M.picked(el, 'grade')), GRADES, 0);
        slotSel.value = was && was.slot ? was.slot : '';
        const fx = M.effects($('[data-fx]'), { ops: was ? was.effects || [] : [], kind: 'item', newStatus: () => app.api.forge.status({ mode: 'library' }) });
        // the worth line of the status the item wears in a fight (worth.ts `wornWorth`, a kit with no ability)
        const drawWorth = M.worth($('[data-worth-box]'));
        /** The spend line of the form's item against the grade picked; hidden for an item nobody wears, which has no budget. */
        const drawSpend = it => {
          const box = $('[data-spend]'), s = itemSpend(it, rules());
          box.hidden = !s;
          if (!s) return;
          const line = spendLine(s, rules(), it.rar, it.grade || 0);
          box.textContent = line.words;
          box.classList.toggle('over', line.over);
        };
        // the worn status (kits design 1.3.2): its editors are drawn when its box is first ticked
        const wasWorn = was && was.worn ? was.worn : null;
        let wornFx = { ops: () => [], blocked: () => false }, wornKit = { fields: () => ({}), blocked: () => false }, wornMade = false;
        const wornOn = () => $('[data-worn-on]').checked;
        const wornEditors = () => {
          if (wornMade) return; wornMade = true;
          wornFx = M.effects($('[data-worn-fx]'), { ops: wasWorn ? wasWorn.ops : [], kind: 'status', newStatus: () => app.api.forge.status({ mode: 'library' }) });
          wornKit = M.statusBlocks($('[data-worn-kit]'), wasWorn, 'lfw');
        };
        // the ability its wearer may use (item-stats 6.1): the skill maker's ability form, drawn when its box is first ticked
        const ownId = wasActive ? wasActive.id : abilityId(store.id('ab'));
        /** @type {{ ops: () => any[]; blocked: () => boolean }} */
        let activeFx = { ops: () => [], blocked: () => false };
        /** @type {{ value: (id: any, name: string) => any; blocked: () => boolean; setKind: (k: any) => void }} */
        let activeForm = { value: () => null, blocked: () => false, setKind: () => {} };
        let activeMade = false;
        const activeOn = () => $('[data-active-on]').checked;
        const activeKind = () => oneOf(M.picked(el, 'akind'), ACTIVE_KINDS, 'support');
        const activeEditors = () => {
          if (activeMade) return; activeMade = true;
          activeFx = M.effects($('[data-active-fx]'), { ops: wasActive ? wasActive.ops : [], kind: 'skill', newStatus: () => app.api.forge.status({ mode: 'library' }) });
          activeForm = M.ability($('[data-active-form]'), { kind: activeKind(), ability: wasActive });
        };
        /** The ability the form holds, named for the item; a support on the user reaches only the user. Null while its formula does not read. */
        const activeOf = name => {
          const k = activeKind(), label = wasActive && was && name === was.name ? wasActive.name : name || 'Item';
          const v = activeForm.value(ownId, label);
          if (!v) return null;
          const d = kindDefaults(k, rules());
          const reach = k === 'support' && M.picked(el, 'aaim') === 'self' ? { aim: 'self', shape: { kind: 'self' }, range: tiles(0) } : { aim: d.aim, foesOnly: d.foesOnly };
          return { ...v, ...reach, ops: activeFx.ops() };
        };
        /** The item the form holds, every number inside the parser's bounds. A type that is not worn keeps the slot, gear and bonus it was saved with, unseen. */
        const formItem = () => {
          const worn = WORN.includes(type), same = was && was.type === type, weapon = type === 'weapon';
          const gear = k => (worn ? int(gearInput(k).value, 0, B[k]) : same ? was[k] : 0);
          // a blank price or weight is the rule's (left out: valueOf, weightOf), so the rule reaches the item later too
          const typed = (input, hi) => (input.value.trim() === '' ? undefined : int(input.value, 0, hi));
          const weight = worn ? typed(gearInput('weight'), B.weight) : same ? was.weight : undefined;
          const value = typed($('#lf-value'), B.value);
          const out = {
            name: $('#lf-name').value.trim().slice(0, B.name), rar: rarity(), type, slot: worn ? slotSel.value || null : same ? was.slot : null,
            qty: int($('#lf-qty').value, 1, B.qty) || 1, dice: weapon ? $('#lf-dice').value.trim().slice(0, B.dice) : '',
            bonus: worn ? M.readBonus(el) : same ? { ...was.bonus } : {}, desc: $('#lf-desc').value.slice(0, B.desc),
            armor: gear('armor'), resist: gear('resist'),
          };
          if (value !== undefined) out.value = value;
          if (grade()) out.grade = grade();
          if (weight !== undefined) out.weight = weight;
          if (weapon) out.attack = oneOf(M.picked(el, 'attack'), ATTACKS, 'strike');
          if (weapon && out.attack !== 'shot' && $('#lf-finesse').checked) out.finesse = true;
          if (weapon && out.slot === 'weapon' && $('#lf-twohanded').checked) out.twoHanded = true;
          const effects = fx.ops(); if (effects.length) out.effects = effects;
          if (effectsOf(out).length && M.picked(el, 'target') === 'other') out.target = 'other';
          if (gm ? $('#lf-tell').checked : was && was.tell) out.tell = true;
          // only a GM makes an item revive or rank-capped; a player's edit of one keeps it
          if (type === 'consumable' && (gm ? $('#lf-revive').checked : was && was.revive)) out.revive = true;
          if (type === 'consumable' && (gm ? $('#lf-rank-cap').checked : was && was.rankCap)) out.rankCap = true;
          if (worn && wornOn()) {
            const label = wasWorn && was && out.name === was.name ? wasWorn.label : out.name || 'Item';
            out.worn = { label, desc: wasWorn ? wasWorn.desc : '', ops: wornFx.ops(), ...(wasWorn && wasWorn.color ? { color: wasWorn.color } : {}), ...(wasWorn && wasWorn.icon ? { icon: wasWorn.icon } : {}), ...wornKit.fields() };
          }
          else if (!worn && was && was.worn && same) out.worn = was.worn;
          if (worn && activeOn()) { const a = activeOf(out.name); if (a) out.active = a; }
          else if (!worn && wasActive && same) out.active = wasActive;
          for (const k of Object.keys(out.bonus)) out.bonus[k] = Math.max(-B.bonus, Math.min(B.bonus, out.bonus[k]));
          return out;
        };
        // the Icon row (icons design 6): its default is read from the type, slot, attack and revive the form holds
        const iconRow = iconField($('[data-icon]'), shell.el, {
          thing: 'item', pick: was && was.icon ? was.icon : null,
          subject: () => { const it = formItem(); return { thing: 'item', item: { type: it.type, slot: it.slot, ...(it.attack ? { attack: it.attack } : {}), ...(it.revive ? { revive: true } : {}) } }; },
        });
        /** Parse error on a non-empty weapon damage formula, or '' when empty or valid: blocks Save on typos. */
        const diceError = () => {
          if (type !== 'weapon') return '';
          const raw = $('#lf-dice').value.trim();
          if (!raw) return '';
          const p = parseFormula(raw, rules());
          return 'error' in p ? p.error : '';
        };
        const sync = () => {
          if (wornOn()) wornEditors();
          $('[data-worn-f]').hidden = !wornOn();
          $('[data-sum="worn"]').textContent = wornOn() ? 'Fight status: set' : 'Fight status: none';
          if (activeOn()) { activeEditors(); activeForm.setKind(activeKind()); }
          $('[data-active-f]').hidden = !activeOn();
          $('[data-active-self-w]').hidden = activeKind() !== 'support';
          $('[data-sum="active"]').textContent = activeOn() ? `Wearer ability: ${ACTIVE_LABEL[activeKind()].toLowerCase()}` : 'Wearer ability: none';
          el.closest('.lf-win').classList.toggle('lf-unworn', !WORN.includes(type));
          $('[data-weapon]').hidden = type !== 'weapon';
          if (gm) {
            $('[data-revive-w]').hidden = type !== 'consumable';
            $('[data-rank-cap-w]').hidden = type !== 'consumable';
          }
          if (!slotDirty) slotSel.value = AUTO_SLOT[type] || '';
          $('[data-finesse-w]').hidden = !(type === 'weapon' && M.picked(el, 'attack') !== 'shot');
          $('[data-twohanded-w]').hidden = !(type === 'weapon' && slotSel.value === 'weapon');
          $('[data-kit-w]').hidden = !Object.hasOwn(KIT_SHARE, slotSel.value);
          const derr = diceError();
          $('[data-dice-err]').textContent = derr;
          $('#lf-dice').setAttribute('aria-invalid', String(!!derr));
          for (const b of el.querySelectorAll('[data-chips="grade"] [data-chip]')) b.textContent = gradeLabel(rarity(), oneOf(Number(b.dataset.chip), GRADES, 0));
          const revivesOn = type === 'consumable' && (gm ? $('#lf-revive').checked : was && was.revive);
          $('#lf-value').placeholder = `Default: ${valueOf({ rar: rarity(), type, grade: grade(), effects: fx.ops(), ...(revivesOn ? { revive: true } : {}) }, rules())}`;
          gearInput('weight').placeholder = `Default: ${weightOf({ type, dice: $('#lf-dice').value.trim() })}`;
          // "Affects" only means something for an item that does something when used
          $('[data-target-w]').hidden = !effectsOf(formItem()).length;
        };
        sync();
        for (const ev of ['input', 'change']) slotSel.addEventListener(ev, () => { slotDirty = true; });
        el.addEventListener('click', e => {
          if (e.target.closest('[data-chips="type"]')) { type = oneOf(M.picked(el, 'type'), ITEM_TYPES, type); sync(); }
          if (e.target.closest('[data-chips="grade"],[data-chips="attack"]')) sync();
          const kit = e.target.closest('[data-kit]');
          if (kit && Object.hasOwn(KIT_SHARE, slotSel.value)) {
            const p = piece(oneOf(kit.dataset.kit, KITS.map(([k]) => k), 'light'), slotSel.value, rules());
            for (const [k] of GEAR) gearInput(k).value = String(p[k]);
            shell.changed();
          }
        });
        el.addEventListener('input', sync);
        el.addEventListener('change', sync);
        return {
          preview() {
            const it = formItem(), worn = WORN.includes(it.type);
            drawWorth(it.worn && worn ? wornWorth(it.worn, rules()) : null);
            drawSpend(it);
            return [
              ...weaponLines(it, rules()),
              worn ? `Weight ${weightOf(it)} · Armor ${it.armor} · Resist ${it.resist}` : '',
              worn ? (sp => `Sample ${SAMPLE_WEARER.rank}-rank hunter in ${SAMPLE_WEARER.kit} gear: speed ${sp.bare} normally, ${sp.worn} with this equipped`)(wornSpeed({ ...it, weight: weightOf(it) }, rules())) : '',
              bonusText(it.bonus) && `Equipped: ${bonusText(it.bonus)}`, ...lines(it),
              ...(it.worn && worn ? describeStatus(it.worn, null, rules()).map(l => `In a fight: ${l}`) : []),
            ].filter(Boolean);
          },
          blocked: () => !!diceError() || fx.blocked() || (WORN.includes(type) && wornOn() && (wornFx.blocked() || wornKit.blocked())) || (WORN.includes(type) && activeOn() && (activeFx.blocked() || activeForm.blocked())),
          save() {
            const form = formItem(), pick = iconRow.pick();
            if (pick) form.icon = pick;
            if (!form.name) { shell.error('Give the item a name.'); $('#lf-name').focus(); return undefined; }
            const big = (form.worn ? tooLarge('status', form.worn) : null) || tooLarge('item', form);
            if (big) { shell.error(big); return undefined; }
            const out = parseItem(form);
            if (canon(out) !== canon(form)) console.error('The item maker wrote an item its parser reads differently', form, out);
            if (library && $('#lf-save').checked && !ui.wrote('Workshop', saveToLibrary(out, initial && initial.id), savedWords('item', out.name))) return undefined;
            return out;
          },
        };
      },
    });
  }

  // ── library ──
  /**
   * Saves `it` to the library by its id (library.ts `saveEntry`: an edit keeps its entry); answers the write's Applied
   * whole: refused when the library is full, or another item has that name (the maker says so; it never replaces it).
   */
  const saveToLibrary = (it, editId) => store.apply('library-save', atLibrary(l => saveEntry(l, 'items', { ...it, id: editId || store.id('i') })));

  app.api.loot = { item };

  const lines = it => E().describeItem(it);
}

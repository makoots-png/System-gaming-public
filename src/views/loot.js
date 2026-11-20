// loot.js (G06): the item maker, which saves to the GM's item library (the Workshop lists it). Publishes app.api.loot = { item }.
// The maker is one form with everything an item has, built from maker.js, and answers what parseItem gives back for it.
// The worn block (slot, weight, armor and resist, the bonus while worn) shows for a weapon, armor or accessory; a weapon
// also has its dice and how it attacks. What an item does when used is its effect rows, ops of the fight.
import { PERK_LABELS, TIERS, rules } from '../edge/rules.ts';
import { ITEM_TYPES } from '../core/save.ts';
import { atLibrary } from '../core/save-step.ts';
import { saveEntry, savedWords } from '../core/library.ts';
import { oneOf } from '../core/one-of.ts';
import { REVIVE_TEXT, effectsOf } from '../core/effects.ts';
import { describeStatus } from '../core/combat/effect-ops.ts';
import { wornWorth } from '../core/registry/worth.ts';
import { ATTACKS, ITEM_BOUNDS, KIT_SHARE, RARITIES, SAMPLE_WEARER, parseItem, piece, priceOf, weightOf, wornSpeed } from '../core/registry/items.ts';
import { tooLarge } from '../core/size.ts';

const TYPE_LABEL = { weapon: 'Weapon', armor: 'Armor', accessory: 'Accessory', consumable: 'Consumable', material: 'Material', key: 'Key', misc: 'Misc' };
const AUTO_SLOT = { weapon: 'weapon', armor: 'chest', accessory: 'ring1' };
/** The types a hunter wears: only these show the slot, the gear numbers and the bonus. */
const WORN = Object.keys(AUTO_SLOT);
const SLOT_LABEL = { weapon: 'Weapon', offhand: 'Off-hand', head: 'Head', chest: 'Chest', hands: 'Hands', legs: 'Legs', feet: 'Feet', neck: 'Neck', ring1: 'Ring 1', ring2: 'Ring 2' };
const ATTACK_LABEL = { strike: 'Strike', shot: 'Shot' };
const KITS = /** @type {const} */ ([['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']]);
/** The gear numbers of a worn item, each a field of the form. */
const GEAR = [['weight', 'Weight'], ['armor', 'Armor'], ['resist', 'Resist']];
const BONUS_LABEL = { ...PERK_LABELS, hpMax: 'Max HP', manaMax: 'Max mana' };
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
    let type = was ? was.type : 'misc', slotDirty = !!(was && was.slot);
    return M.open({
      tag: '! Loot', title: was && was.name ? 'Edit item' : 'New item', save: 'Save item', cls: 'lf',
      build(el, shell) {
        el.innerHTML = `<div class="lf-cols"><div class="lf-col">
          ${ui.field('Name', `<input type="text" id="lf-name" maxlength="60" autocomplete="off" value="${esc(was ? was.name : '')}">`)}
          <div class="lbl">Type</div>
          ${M.chips('type', ITEM_TYPES.map(t => [t, TYPE_LABEL[t] || cap(t)]), type, { label: 'Type' })}
          <div class="lf-grid">
            ${ui.field('Rarity', `<select id="lf-rar">${TIERS.map(t => `<option value="${t}"${was && t === was.rar ? ' selected' : ''}>${cap(t)}</option>`).join('')}</select>`)}
            ${ui.field('Qty', `<input type="number" id="lf-qty" inputmode="numeric" min="1" max="${ITEM_BOUNDS.qty}" value="${esc(was ? was.qty : 1)}">`)}
            ${ui.field('Value (gold)', `<input type="number" id="lf-value" inputmode="numeric" min="0" value="${esc(was && was.value !== undefined ? was.value : '')}">`)}
            <div class="wide">${ui.field('Description', `<textarea id="lf-desc" maxlength="500">${esc(was ? was.desc : '')}</textarea>`)}</div>
          </div>
          <div class="lf-worn" data-weapon>
            ${ui.field('Damage dice', `<input type="text" id="lf-dice" maxlength="30" placeholder="1d8" autocomplete="off" value="${esc(was ? was.dice : '')}">`)}
            <div class="lbl">Attacks with</div>
            ${M.chips('attack', ATTACKS.map(a => [a, ATTACK_LABEL[a]]), was && was.attack ? was.attack : 'strike', { label: 'Attacks with' })}
            ${ui.field('Armor ignored on a hit', `<input type="number" id="lf-pen" inputmode="numeric" min="0" max="${B.penFlat}" placeholder="0" value="${esc(was && was.penFlat ? was.penFlat : '')}">`)}
          </div>
          <div class="lf-worn" data-worn>
            ${ui.field('Slot', `<select id="lf-slot"><option value="">None</option>${rules().slots.map(s => `<option value="${s}">${SLOT_LABEL[s] || s}</option>`).join('')}</select>`)}
            <div data-kit-w><div class="lbl">Fill with typical gear</div><div class="mk-chips" role="group" aria-label="Fill with typical gear">${KITS.map(([k, l]) => `<button type="button" class="mk-chip" data-kit="${k}">${esc(l)}</button>`).join('')}</div></div>
            <div class="lf-gear">${GEAR.map(([k, l]) => ui.field(l, `<input type="number" inputmode="numeric" min="0" data-gear="${k}" value="${esc(was ? (was[k] ?? '') : k === 'weight' ? '' : 0)}">`)).join('')}</div>
            <div class="lbl">Bonus while worn</div>
            ${M.bonus(was ? was.bonus : {})}
            <details class="mk-group" data-group="worn"><summary data-sum="worn"></summary><div class="mk-group-body">
              <label class="lf-chk"><input type="checkbox" data-worn-on${was && was.worn ? ' checked' : ''}><span>In a fight, its wearer wears a status</span></label>
              <div data-worn-f><div class="lbl">What the status does</div><div data-worn-fx></div><div data-worn-kit></div></div>
            </div></details>
          </div>
          </div><div class="lf-col" data-later>
          <div class="lbl">Effects when used</div>
          <div data-fx></div>
          <div data-target-w><div class="lbl">Affects</div>${M.chips('target', [['self', 'The user'], ['other', 'A target']], was && was.target === 'other' ? 'other' : 'self', { label: 'Affects' })}</div>
          <div data-worth-box></div>
          <div data-mk-preview></div>
          ${gm ? `<label class="lf-chk"><input type="checkbox" id="lf-tell"${was && was.tell ? ' checked' : ''}><span>Tell me when it is used</span></label>` : ''}
          ${gm ? `<label class="lf-chk" data-revive-w><input type="checkbox" id="lf-revive"${was && was.revive ? ' checked' : ''}><span>${esc(REVIVE_TEXT)}</span></label>` : ''}
          ${library ? '<label class="lf-chk"><input type="checkbox" id="lf-save" checked><span>Save to library</span></label>' : ''}
          </div></div>`;
        const $ = s => el.querySelector(s), slotSel = $('#lf-slot');
        const gearInput = k => /** @type {HTMLInputElement} */ ($(`[data-gear="${k}"]`));
        slotSel.value = was && was.slot ? was.slot : '';
        const fx = M.effects($('[data-fx]'), { ops: was ? was.effects || [] : [], kind: 'item', newStatus: () => app.api.forge.status({ mode: 'library' }) });
        // the worth line of the status the item wears in a fight (worth.ts `wornWorth`, a kit with no ability)
        const drawWorth = M.worth($('[data-worth-box]'));
        // the worn status (kits design 1.3.2): its editors are drawn when its box is first ticked
        const wasWorn = was && was.worn ? was.worn : null;
        let wornFx = { ops: () => [], blocked: () => false }, wornKit = { fields: () => ({}), blocked: () => false }, wornMade = false;
        const wornOn = () => $('[data-worn-on]').checked;
        const wornEditors = () => {
          if (wornMade) return; wornMade = true;
          wornFx = M.effects($('[data-worn-fx]'), { ops: wasWorn ? wasWorn.ops : [], kind: 'status', newStatus: () => app.api.forge.status({ mode: 'library' }) });
          wornKit = M.statusBlocks($('[data-worn-kit]'), wasWorn, 'lfw');
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
            name: $('#lf-name').value.trim().slice(0, B.name), rar: oneOf($('#lf-rar').value, TIERS, 'common'), type, slot: worn ? slotSel.value || null : same ? was.slot : null,
            qty: int($('#lf-qty').value, 1, B.qty) || 1, dice: weapon ? $('#lf-dice').value.trim().slice(0, B.dice) : '',
            bonus: worn ? M.readBonus(el) : same ? { ...was.bonus } : {}, desc: $('#lf-desc').value.slice(0, B.desc),
            armor: gear('armor'), resist: gear('resist'),
          };
          if (value !== undefined) out.value = value;
          if (weight !== undefined) out.weight = weight;
          if (weapon) { out.attack = oneOf(M.picked(el, 'attack'), ATTACKS, 'strike'); const pen = int($('#lf-pen').value, 0, B.penFlat); if (pen) out.penFlat = pen; }
          const effects = fx.ops(); if (effects.length) out.effects = effects;
          if (effectsOf(out).length && M.picked(el, 'target') === 'other') out.target = 'other';
          if (gm ? $('#lf-tell').checked : was && was.tell) out.tell = true;
          // only a GM makes an item revive; a player's edit of one keeps it (the GM decides how many exist)
          if (type === 'consumable' && (gm ? $('#lf-revive').checked : was && was.revive)) out.revive = true;
          if (worn && wornOn()) out.worn = { label: out.name || 'Item', desc: wasWorn ? wasWorn.desc : '', ops: wornFx.ops(), ...(wasWorn && wasWorn.color ? { color: wasWorn.color } : {}), ...wornKit.fields() };
          else if (!worn && was && was.worn && same) out.worn = was.worn;
          for (const k of Object.keys(out.bonus)) out.bonus[k] = Math.max(-B.bonus, Math.min(B.bonus, out.bonus[k]));
          return out;
        };
        const sync = () => {
          if (wornOn()) wornEditors();
          $('[data-worn-f]').hidden = !wornOn();
          $('[data-sum="worn"]').textContent = wornOn() ? 'In a fight: wears a status' : 'In a fight: nothing more';
          el.closest('.lf-win').classList.toggle('lf-unworn', !WORN.includes(type));
          $('[data-weapon]').hidden = type !== 'weapon';
          if (gm) $('[data-revive-w]').hidden = type !== 'consumable';
          if (!slotDirty) slotSel.value = AUTO_SLOT[type] || '';
          $('[data-kit-w]').hidden = !Object.hasOwn(KIT_SHARE, slotSel.value);
          $('#lf-value').placeholder = `By the rule: ${priceOf(rules(), oneOf($('#lf-rar').value, RARITIES, 'common'))}`;
          gearInput('weight').placeholder = `By the rule: ${weightOf({ type, dice: $('#lf-dice').value.trim() })}`;
          // "Affects" only means something for an item that does something when used
          $('[data-target-w]').hidden = !effectsOf(formItem()).length;
        };
        sync();
        for (const ev of ['input', 'change']) slotSel.addEventListener(ev, () => { slotDirty = true; });
        el.addEventListener('click', e => {
          if (e.target.closest('[data-chips="type"]')) { type = oneOf(M.picked(el, 'type'), ITEM_TYPES, type); sync(); }
          const kit = e.target.closest('[data-kit]');
          if (kit && Object.hasOwn(KIT_SHARE, slotSel.value)) {
            const p = piece(oneOf(kit.dataset.kit, KITS.map(([k]) => k), 'light'), slotSel.value, oneOf($('#lf-rar').value, RARITIES, 'common'), rules());
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
            return [
              it.type === 'weapon' && it.dice ? `${ATTACK_LABEL[it.attack]} with ${it.dice}${it.penFlat ? `, ignoring ${it.penFlat} armor` : ''}` : '',
              worn ? `Weight ${weightOf(it)} · Armor ${it.armor} · Resist ${it.resist}` : '',
              worn ? (sp => `A ${SAMPLE_WEARER.rank}-rank hunter in ${SAMPLE_WEARER.kit} gear: speed ${sp.bare}, ${sp.worn} with this on too`)(wornSpeed({ ...it, weight: weightOf(it) }, rules())) : '',
              bonusText(it.bonus) && `Worn: ${bonusText(it.bonus)}`, ...lines(it),
              ...(it.worn && worn ? describeStatus(it.worn, null, rules()).map(l => `In a fight: ${l}`) : []),
            ].filter(Boolean);
          },
          blocked: () => fx.blocked() || (WORN.includes(type) && wornOn() && (wornFx.blocked() || wornKit.blocked())),
          save() {
            const form = formItem();
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

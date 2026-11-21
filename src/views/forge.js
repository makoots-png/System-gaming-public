// forge.js (G05): Status Forge. One dialog to pick or invent a status with real mechanics (PROGRAM2 §D G05). The GM's
// statuses live in the save's `library.statuses`: a built-in key there is an override, any other key a status of the GM's
// own. The Workshop (workshop.js) lists them.
// Exposes app.api.forge.status(opts): `{ mode: 'apply', ... }` in a fight, `{ mode: 'library', ... }` in the Workshop.
import { css, esc, wrote } from './ui.js';
import { RANKS } from '../core/rules.ts';
import { oneOf } from '../core/one-of.ts';
import { gmSource } from '../core/effects.ts';
import { atLibrary } from '../core/save-step.ts';
import { saveStatus, savedWords } from '../core/library.ts';
import { defWorth } from '../core/registry/worth.ts';
import { tooLarge } from '../core/size.ts';
import { iconField } from './maker.js';

const SWATCHES = [['#4dd8ff', 'Cyan'], ['#ff4d5e', 'Red'], ['#ffc94d', 'Gold'], ['#a064ff', 'Purple'], ['#4dffa0', 'Green']];

/** @type {import('./app.ts').App | null} the app, set by register */
let A = null;
const store = () => A.store;
/** The GM's statuses by key: overrides of built-ins and statuses of the GM's own. */
const library = () => store().get().library.statuses;
const lines = (def, tier) => A.api.effects.describe(def, tier);
/** Keys sorted, so the form's def and the parser's compare by what they hold. */
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
/** The status a typed name means: one whose key or label is that name, any case. */
const knownKey = (conds, name) => {
  const n = name.trim().toLowerCase();
  return Object.keys(conds).find(k => k === n || String(conds[k].label).toLowerCase() === n) || null;
};

/** Saves `def` under `key` in the library; answers the write's Applied whole (refused `full` at the cap). */
const saveToLibrary = (key, def) => store().apply('forge-status', atLibrary(l => saveStatus(l, key, def)));

// ── the dialog ──
// Two modes. `apply` (a combat card, a party card): Rounds and Strength on top, then the existing statuses, where one tap
// puts that status on with the Rounds and Strength shown; or a new status named, with its effects in the shared editor,
// applied (and kept in the library unless the box is cleared). `library` (the Workshop, the "New status…" of an effects
// row): a maker like the others, the name, the effects and the colour, saved to the library; with `edit`, that status.
/** @param {import('../core/api.ts').ForgeOpts} opts */
function openForge(opts) {
  const M = A.api.maker, E = A.api.effects, rulesNow = A.rules().conditions;
  const apply = opts.mode === 'apply';
  const editKey = opts.mode === 'library' && opts.edit && rulesNow[opts.edit] ? opts.edit : null;
  const editDef = editKey ? rulesNow[editKey] : null;
  const lib = Object.keys(library()), builtin = Object.keys(rulesNow).filter(k => !lib.includes(k));
  const chipKeys = apply ? [...lib, ...builtin] : [];
  const touch = matchMedia('(pointer: coarse)').matches;
  const rank = apply && RANKS.includes(opts.rank) ? opts.rank : null;
  let color = (editDef && editDef.color) || SWATCHES[0][0], infinite = false;
  const title = apply ? opts.title : editKey ? `Edit ${editDef.label}` : 'New status';

  return M.open({
    tag: '! Status', title, save: apply ? 'Apply' : 'Save status', cls: 'fg',
    // the window opens at its top: on a touch screen the first existing status takes the focus, not a text field
    focus: win => (!touch || !chipKeys.length ? win.querySelector('[data-name]') : win.querySelector('[data-existing] button')),
    build(el, shell) {
      el.innerHTML = `<div class="fg-cols${apply ? ' fg-ap' : ''}">${apply ? `<div class="fg-col">
        <div class="fg-row"><label class="field fg-rounds"><span class="lbl">Rounds</span><input type="number" min="1" max="999" inputmode="numeric" data-rounds value="3" autocomplete="off"></label>
          <button type="button" class="fg-inf" data-inf aria-pressed="false" aria-label="Lasts until removed (infinite rounds)">∞</button></div>
        ${rank ? `<div class="lbl">Strength</div><div data-strength>${M.chips('strength', RANKS.map(r => [r, r]), rank, { label: 'Strength' })}</div>` : ''}
        ${chipKeys.length ? `<div class="lbl">Apply existing</div><div class="fg-chips" data-existing><div class="mk-chips" role="group" aria-label="Apply existing">${chipKeys.map(k => `<button type="button" class="mk-chip${lib.includes(k) ? ' lib' : ''}" data-chip="${esc(k)}" title="${esc(String((rulesNow[k] && rulesNow[k].desc) || ''))}">${esc(String((rulesNow[k] && rulesNow[k].label) || k))}</button>`).join('')}</div></div>` : ''}
        </div>` : ''}<div class="fg-col" data-newcol>
        <div class="fg-a1"><div class="lbl fg-new">${editKey ? 'Edit status' : 'New status'}</div>
        <label class="field"><span class="lbl">Name</span><input type="text" data-name maxlength="40" autocomplete="off" spellcheck="false" placeholder="e.g. Ember Mark"></label>
        <label class="field"><span class="lbl">Description</span><input type="text" data-desc maxlength="200" autocomplete="off" placeholder="What the System says it does"></label>
        <div data-icon></div></div>
        <div class="fg-b" data-later><div class="lbl">Effects</div>
        <div class="fg-fx" data-fx></div>
        <div class="fg-kit" data-kit></div>
        <div data-worth-box></div>
        <div data-mk-preview></div></div>
        <div class="fg-a2" data-later><div class="lbl">Color</div>
        <div class="fg-sw" role="radiogroup" aria-label="Color">${SWATCHES.map(([c, n]) => `<button type="button" role="radio" class="fg-swatch" data-c="${c}" style="--sw:${c}" aria-label="${n}" aria-checked="false"></button>`).join('')}</div>
        ${apply ? `<label class="gm-chk fg-save"><input type="checkbox" data-save checked><span>Save to library</span></label>` : ''}
        </div></div></div>`;
      const q = s => el.querySelector(s), all = s => [...el.querySelectorAll(s)];
      const name = q('[data-name]'), desc = q('[data-desc]'), fxBox = q('[data-fx]');
      if (editDef) { name.value = editDef.label; desc.value = editDef.desc; }
      const fx = M.effects(fxBox, { ops: editDef ? editDef.ops : [], kind: 'status', newStatus: () => openForge({ mode: 'library' }) });
      const kit = M.statusBlocks(q('[data-kit]'), editDef, 'fgk');
      // the worth line (worth.ts `defWorth`): what the def is worth put on by a standard curse at its cap, held the reference fight
      const drawWorth = M.worth(q('[data-worth-box]'));

      const sync = () => {
        all('[data-c]').forEach(b => { const o = b.dataset.c === color; b.setAttribute('aria-checked', o); b.classList.toggle('on', o); });
        const inf = q('[data-inf]'); if (inf) { inf.setAttribute('aria-pressed', infinite); inf.classList.toggle('on', infinite); q('[data-rounds]').disabled = infinite; }
      };
      const roundsVal = () => { if (infinite) return null; const n = Math.trunc(Number(q('[data-rounds]') ? q('[data-rounds]').value : 3)); return Number.isFinite(n) && n >= 1 ? Math.min(n, 999) : 3; };
      const source = () => (rank ? gmSource(oneOf(M.picked(el, 'strength'), RANKS, rank)) : null);
      const formDef = () => ({ label: name.value.replace(/\s+/g, ' ').trim().slice(0, 40), desc: desc.value.replace(/\s+/g, ' ').trim().slice(0, 200), color, ops: fx.ops(), ...kit.fields() });
      const withSource = v => { const src = source(); return src ? { ...v, source: src } : v; };
      /** The key the status is saved under: its own when edited, else the one its name makes (a built-in's key is never made). */
      const keyOf = label => editKey || E.slug(label, library());
      // the Icon row (icons design 6): its default is read from the key, the effects and the end the form holds
      const iconRow = iconField(q('[data-icon]'), shell.el, {
        thing: 'status', pick: editDef && editDef.icon ? editDef.icon : null,
        subject: () => { const f = formDef(); return { thing: 'status', key: keyOf(f.label), def: { ops: f.ops, ...(f.end ? { end: f.end } : {}) } }; },
      });
      /** An existing status as the window answers it: on with the Rounds and Strength shown. */
      const existing = key => withSource({ key, rounds: roundsVal(), def: A.rules().conditions[key] });

      el.addEventListener('click', e => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.chip && t.closest('[data-existing]')) return shell.done(existing(t.dataset.chip));
        if (t.dataset.c) { color = t.dataset.c; return sync(); }
        if (t.matches('[data-inf]')) { infinite = !infinite; return sync(); }
      });
      sync();
      return {
        /** What the new status does: at the picked strength when there is one, else all six values. */
        preview() {
          const src = source(), form = formDef(), def = form.label ? E.sanitizeDef(form) : null;
          drawWorth(def && (def.ops.length || def.stack || def.triggers || def.end) ? defWorth(def, A.rules()) : null);
          return lines(form, src ? src.tier : null);
        },
        blocked: () => fx.blocked() || kit.blocked(),
        save() {
          const pick = iconRow.pick(), form = { ...formDef(), ...(pick ? { icon: pick } : {}) };
          if (!form.label) { shell.error('Give the status a name.'); name.focus(); return undefined; }
          const known = editKey || form.ops.length || form.stack || form.triggers || form.end || form.icon ? null : knownKey(A.rules().conditions, form.label); // a typed name with no mechanics and no icon picked is that status
          if (known) return existing(known);
          const big = tooLarge('status', form);
          if (big) { shell.error(big); return undefined; }
          const def = E.sanitizeDef(form);
          if (!def || canon(def) !== canon(form)) console.error('The Status dialog wrote a status its parser reads differently', form, def);
          if (!def) { shell.error('This status cannot be saved.'); return undefined; }
          const save = apply ? q('[data-save]').checked : true;
          const newKey = keyOf(form.label);
          if (save && !wrote('Workshop', saveToLibrary(newKey, def), savedWords('status', def.label))) return undefined;
          return withSource({ key: newKey, rounds: apply ? roundsVal() : null, def });
        },
      };
    },
  });
}

/** @param {import('./app.ts').App} app */
export function register(app) {
  A = app;
  css('forge', `
.fg-row{display:flex;gap:10px;align-items:flex-end}
.fg-rounds{width:110px}
.fg-chips{display:block}
.fg-inf,.fg-win .fg-swatch{min-height:40px}
.fg-inf{min-width:48px;font-size:20px}.fg-inf.on{border-color:var(--cyan);background:rgba(77,216,255,.18);color:var(--ice)}
.fg-col>*{flex-shrink:0}  /* .fg-col is display:contents on a phone, so its children are the flex items of the maker's body */
.fg-chips[data-existing]{max-height:140px;overflow-y:auto}
.fg-chips[data-existing] .mk-chips{gap:6px}
.fg-sw{display:flex;gap:8px}
.fg-win .fg-swatch{width:44px;min-width:44px;padding:0;background:var(--sw);border:2px solid transparent;border-radius:50%}
.fg-win .fg-swatch.on{border-color:var(--ice);box-shadow:0 0 10px var(--sw)}
.fg-save{min-height:40px}
.fg-cols,.fg-col,.fg-a1,.fg-a2,.fg-b{display:contents}
@media (min-width:1100px){
  .fg-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:10px 22px;align-items:start}
  .fg-cols.fg-ap{grid-template-columns:minmax(0,.8fr) minmax(0,2fr)}
  .fg-col{display:flex;flex-direction:column;gap:8px;min-width:0}
  .fg-col[data-newcol]{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);grid-template-rows:auto 1fr;column-gap:22px;row-gap:8px;align-items:start}
  .fg-a1,.fg-a2,.fg-b{display:flex;flex-direction:column;gap:8px;min-width:0}
  .fg-a1{grid-column:1;grid-row:1}.fg-a2{grid-column:1;grid-row:2}.fg-b{grid-column:2;grid-row:1/span 2}
  .fg-chips[data-existing]{max-height:300px}
}
@media (pointer:coarse),(max-width:720px){.fg-inf,.fg-save{min-height:44px}.fg-win .fg-swatch{min-height:44px;height:44px}}`);

  app.api.forge = { status: openForge };
}

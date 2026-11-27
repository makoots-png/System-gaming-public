// custom.js: player customization. Device prefs (own localStorage key, never in a save/sheet/event; written by
// store.setPrefs), hunter identity (emblem + color on the sheet, hunter/identity.ts), equipment loadouts
// (hunter/loadouts.ts), and GM room-rule switches (hunter/build.ts). This file draws and taps.
import { iconDef, iconsOf, isIconKey } from '../core/registry/icons.ts';
import { SLOTS, SLOT_LABELS } from '../core/registry/items.ts';
import { HUNTER_COLORS, ACCENTS, TEXT_SCALES, RANKS } from '../edge/rules.ts';
import * as ui from './ui.js';
import { oneOf } from '../core/one-of.ts';
import { atHunter, atSettings } from '../core/save-step.ts';
import { withSound } from '../core/settings.ts';
import { withBadge } from '../core/hunter/identity.ts';
import { LOADOUT_WORDS, fits, loadoutCap, overwriteLoadout, removeLoadout, renameLoadout, saveLoadout, swapLoadout } from '../core/hunter/loadouts.ts';
import { keystoneSwitched, roomRulesOf } from '../core/hunter/build.ts';
import { KEYSTONE_SWITCH_WORDS } from '../core/rules-text.ts';

const { esc } = ui;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const RANK_C = { E: '#9fb6c9', D: '#59e6a8', C: '#4dd8ff', B: '#4d8cff', A: '#c79bff', S: '#ffc94d' }; // = --rank-* in app.css
const COLOR_NAMES = { '#4dd8ff': 'Cyan', '#59e6a8': 'Mint', '#ffc94d': 'Gold', '#ff6b3d': 'Orange', '#ff4d5e': 'Red', '#c79bff': 'Purple', '#4d8cff': 'Blue', '#ff7ad9': 'Pink', '#dff3ff': 'Ice white', '#9fb6c9': 'Silver' };
const hexRgb = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
const TOUCH = '@media (pointer:coarse),(max-width:720px)'; // = the app.css touch-sizing block: 44px targets only there

const STYLE = `
.hb{--hc:#9fb6c9;display:inline-flex;align-items:center;justify-content:center;flex:none;width:30px;height:30px;border:1px solid var(--hc);border-radius:50%;color:var(--hc);background:rgba(4,7,15,.6);box-shadow:0 0 6px color-mix(in srgb,var(--hc) 45%,transparent);vertical-align:middle}
.hb svg{width:19px;height:19px;fill:currentColor}.hb text{font:700 15px var(--font-display);fill:currentColor}
.hb-sm{width:22px;height:22px;margin-right:6px}.hb-sm svg{width:14px;height:14px}.hb-lg{width:64px;height:64px}.hb-lg svg{width:40px;height:40px}
.cz-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:6px;margin:6px 0 12px}
.cz-grid button{min-height:48px;min-width:44px;padding:0;display:flex;align-items:center;justify-content:center}
.cz-grid button[aria-pressed=true]{border-color:var(--cyan);background:rgba(77,216,255,.18)}
.cz-sw{display:block;width:26px;height:26px;border-radius:50%;background:var(--sw);border:1px solid rgba(255,255,255,.3)}.cz-sw[data-accent]{background:rgb(var(--acc-rgb))}
.cz-prev{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.cz-sec{margin:0 0 18px}.cz-sec h3{margin:0 0 6px;font-size:14px;letter-spacing:.12em;color:var(--cyan-dim)}
.cz-note{font-size:13px;color:var(--muted);margin:4px 0}
.cz-check{display:flex;align-items:center;gap:10px;min-height:40px;font-size:15px}.cz-check input{width:22px;height:22px;flex:none}
.lo-list{display:flex;flex-direction:column;gap:8px;margin:0 0 10px;padding:0;list-style:none}
.lo-row{display:flex;gap:6px}.lo-row .lo-chip{flex:1 1 auto;min-height:36px;text-align:left;display:flex;justify-content:space-between;align-items:center;gap:8px;min-width:0}
.lo-chip>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lo-chip small{color:var(--muted);font-weight:400;flex:none}.lo-chip[aria-pressed=true]{border-color:var(--cyan);color:var(--cyan)}
.lo-row .lo-more{min-width:36px}
.lo-acts{display:flex;flex-wrap:wrap;gap:8px}
.lo-pv{list-style:none;margin:0;padding:0;font-size:14px}.lo-pv li{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(27,74,110,.5)}
.lo-pv .bad{color:#ff8a96}
.cz-grid [data-pc=""] .cz-sw{border:2px dashed var(--ice)}
.id-del .emb-btn{margin-right:auto;color:var(--ice);border-color:var(--edge);display:inline-flex;align-items:center;gap:8px;padding:4px 12px 4px 6px}
${TOUCH}{.lo-acts button,.lo-row .lo-chip,.id-del .emb-btn,.sys-actions button{min-height:44px}
  .lo-row .lo-more{min-width:44px;min-height:44px}.cz-check{min-height:44px}}
`;

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, rules } = app, A = () => app.api;
  ui.css('custom', STYLE);

  // ── identity ──────────────────────────────────────────────────────────────
  // sheets reach the GM raw, so every value is checked against the registries at render time (no free-form color/markup)
  const colorOf = h => { const o = isObj(h) ? h : {}; return oneOf(o.color, HUNTER_COLORS, null) || RANK_C[oneOf(o.rank, RANKS, 'E')]; };
  const badge = (h, size = '') => {
    h = isObj(h) ? h : {}; const e = isIconKey(h.emblem) ? h.emblem : '';
    const ch = [...String(h.name || '?').trim()][0] || '?';
    const inner = e ? `<path d="${iconDef(e).path}"/>` : `<text x="12" y="17" text-anchor="middle">${esc(ch.toUpperCase())}</text>`;
    return `<span class="hb${size ? ' hb-' + size : ''}" style="--hc:${colorOf(h)}" aria-hidden="true"><svg viewBox="0 0 24 24">${inner}</svg></span>`;
  };
  const pick = { e: '', c: '', hid: null }; // the open identity picker
  const pickerHtml = () => `<div class="cz-pick">
      <div class="cz-prev" data-czprev>${badge({ ...store.hunter(pick.hid), emblem: pick.e, color: pick.c }, 'lg')}<span class="cz-note">Shown to your party and the GM.</span></div>
      <div class="lbl">Emblem</div>
      <div class="cz-grid" role="group" aria-label="Emblem">
        <button type="button" data-pe="" aria-pressed="${!pick.e}" aria-label="Initial">${badge({ ...store.hunter(pick.hid), emblem: '', color: pick.c }, 'sm')}</button>
        ${iconsOf('emblem').map(k => `<button type="button" data-pe="${k}" aria-pressed="${pick.e === k}" aria-label="${esc(iconDef(k).label)}">${badge({ emblem: k, color: pick.c, rank: (store.hunter(pick.hid) || {}).rank }, 'sm')}</button>`).join('')}
      </div>
      <div class="lbl">Color</div>
      <div class="cz-grid" role="group" aria-label="Color">
        <button type="button" data-pc="" aria-pressed="${!pick.c}" aria-label="Rank color"><span class="cz-sw" style="--sw:${RANK_C[(store.hunter(pick.hid) || {}).rank] || RANK_C.E}"></span></button>
        ${HUNTER_COLORS.map(c => `<button type="button" data-pc="${c}" aria-pressed="${pick.c === c}" aria-label="Color ${COLOR_NAMES[c] || c}"><span class="cz-sw" style="--sw:${c}"></span></button>`).join('')}
      </div></div>`;
  document.addEventListener('click', e => {
    const b = e.target.closest('.cz-pick [data-pe],.cz-pick [data-pc]'); if (!b) return;
    if ('pe' in b.dataset) pick.e = b.dataset.pe; else pick.c = b.dataset.pc;
    const root = b.closest('.cz-pick'); root.outerHTML = pickerHtml();
    const again = document.querySelector(`.cz-pick [data-p${'pe' in b.dataset ? 'e' : 'c'}="${CSS.escape(b.dataset.pe ?? b.dataset.pc)}"]`); if (again) again.focus();
  });
  A().identity = {
    badge,
    async edit(hid) {
      const h = store.hunter(hid); if (!h) return false;
      Object.assign(pick, { e: h.emblem, c: h.color, hid });
      const v = await ui.system({ tag: '! Hunter', title: 'Emblem and color', kind: 'info', html: pickerHtml(),
        actions: [{ label: 'Cancel', value: false, cancel: true }, { label: 'Save', value: true, primary: true }] });
      if (v !== true || !store.hunter(hid)) return false;
      return ui.wrote('! Hunter', store.apply('identity', atHunter(hid, x => withBadge(x, pick.e, pick.c))));
    },
  };

  // ── device prefs (store.prefs: own key; nothing here touches the save) ───────
  // same attributes as the inline script in index.html: presets and text sizes are CSS rules in app.css; only 'hunter' is computed here
  function applyPrefs() {
    const p = store.prefs(), root = document.documentElement, st = root.style;
    root.dataset.accent = p.accent; root.dataset.ts = String(p.text);
    if (p.accent !== 'hunter') for (const k of ['--acc-rgb', '--acc2-rgb', '--deep-rgb', '--deep2-rgb']) st.removeProperty(k);
    else { const rgb = hexRgb(colorOf(store.active())), m = f => rgb.map(v => Math.round(v * f)).join(','); st.setProperty('--acc-rgb', rgb.join(',')); st.setProperty('--acc2-rgb', m(0.85)); st.setProperty('--deep-rgb', m(0.3)); st.setProperty('--deep2-rgb', m(0.45)); }
    if (p.motion === 'os') delete root.dataset.motion; else root.dataset.motion = p.motion;
    const sel = document.getElementById('hunter-sel'); if (sel) sel.style.borderColor = colorOf(store.active());
  }
  const setPref = patch => { store.setPrefs(patch); applyPrefs(); app.emit('prefs'); };
  const buzz = pat => { if (store.prefs().haptics && typeof navigator.vibrate === 'function') navigator.vibrate(pat); }; // a phone that refuses answers false, never throws
  applyPrefs();
  let hpSeen = null;
  store.subscribe(p => {
    if (p && p.reason === 'prefs') app.emit('prefs');
    applyPrefs();
    const h = store.active(), hp = app.api.hunter.sheet(h).hp, k = `${h.id}:${hp}`;
    if (hpSeen && hpSeen.id === h.id && hp < hpSeen.hp) buzz(hp <= 0 ? [90, 50, 90] : 20);
    if (!hpSeen || hpSeen.k !== k) hpSeen = { id: h.id, hp, k };
  });
  app.on('levelup', () => buzz([30, 40, 30, 40, 70]));
  app.on('quest:done', () => buzz(25));
  app.on('combat:turn', p => { if (p && p.hunterId && store.hunter(p.hunterId)) buzz([20, 40, 20]); });

  const seg = (key, opts, cur) => `<div class="seg" role="group" data-seg="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join('')}</div>`;
  app.registerView({
    id: 'device', label: 'Device', icon: '◐', order: 98,
    mount(el) {
      el.innerHTML = `<section class="win"><span class="cb"></span><h2>Device</h2>
        <p class="cz-note">These settings stay on this device only. They are not included in saves, backups, or rooms.</p>
        <div class="cz-sec"><h3>Accent color</h3><div class="cz-grid" role="group" aria-label="Accent color" data-acc></div></div>
        <div class="cz-sec"><h3>Text size</h3><div data-text></div></div>
        <div class="cz-sec"><h3>Motion</h3><div data-motion></div><p class="cz-note">Follow device matches your phone's reduce-motion setting. Reduce turns off animations, and Full keeps all animations on.</p></div>
        <div class="cz-sec"><h3>Feedback</h3>
          <label class="cz-check"><input type="checkbox" data-pf="haptics"><span>Vibrate on level up, your turn, quest completion, and damage</span></label>
          <p class="cz-note" data-novib hidden>This phone or browser cannot vibrate.</p>
          <label class="cz-check"><input type="checkbox" data-pf="sound"><span>Sound on</span></label></div>
      </section>`;
      el.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.acc !== undefined) return setPref({ accent: b.dataset.acc });
        const s = b.closest('[data-seg]'); if (!s) return;
        if (s.dataset.seg === 'text') setPref({ text: Number(b.dataset.v) }); else if (s.dataset.seg === 'motion') setPref({ motion: b.dataset.v });
      });
      el.addEventListener('change', e => {
        const t = e.target; if (!t.dataset || !t.dataset.pf) return;
        // settings.sound keeps its name and home (save state); a refused write puts the box back as the save holds it
        if (t.dataset.pf === 'sound') { if (!ui.wrote('Settings', store.apply('settings', atSettings(st => withSound(st, t.checked))))) t.checked = !t.checked; }
        else { setPref({ haptics: t.checked }); if (t.checked) buzz(30); }
      });
      app.on('prefs', () => { if (el.isConnected) deviceUpdate(el); });
    },
    update: el => deviceUpdate(el),
  });
  function deviceUpdate(el) {
      const p = store.prefs(), canVib = typeof navigator.vibrate === 'function';
      el.querySelector('[data-acc]').innerHTML = ACCENTS.map(k => `<button type="button" data-acc="${k}" aria-pressed="${p.accent === k}" aria-label="Accent ${k === 'hunter' ? 'hunter color' : k}">${k === 'hunter'
        ? `<span class="cz-sw" style="--sw:${colorOf(store.active())}"></span>` : `<span class="cz-sw" data-accent="${k}"></span>`}</button>`).join('');
      el.querySelector('[data-text]').innerHTML = seg('text', TEXT_SCALES.map((v, i) => [v, ['Normal', 'Large', 'Larger'][i] || `${v}x`]), p.text);
      el.querySelector('[data-motion]').innerHTML = seg('motion', [['os', 'Follow device'], ['reduce', 'Reduce'], ['full', 'Full']], p.motion);
      const hp = el.querySelector('[data-pf=haptics]'); hp.checked = p.haptics && canVib; hp.disabled = !canVib;
      el.querySelector('[data-novib]').hidden = canVib;
      el.querySelector('[data-pf=sound]').checked = !!store.get().settings.sound;
  }

  // ── loadouts ─────────────────────────────────────────────────────────────
  // new saves only: a lowered cap (even 0 or negative) never hides or deletes saved sets; never above the store's structural limit
  const loCap = () => loadoutCap(rules());
  const sameSet = (h, l) => { const worn = A().inventory.worn(h); return SLOTS.every(s => (l.slots[s] || null) === (worn[s] || null)); };
  // a fight holds hunter hid (core/combat/fight-save.ts `fightHold`, through the hunter api): its gear and build wait
  const inFight = hid => A().hunter.fightOf({ hid }) !== null;
  const LO = A().loadouts = {
    inFight,
    save: (hid, name) => store.apply('loadout-save', atHunter(hid, h => saveLoadout(h, store.id('lo'), String(name || ''), rules()))),
    overwrite: (hid, id) => store.apply('loadout-save', atHunter(hid, h => overwriteLoadout(h, id, rules()))),
    rename: (hid, id, name) => store.apply('loadout-rename', atHunter(hid, h => renameLoadout(h, id, String(name || '')))),
    remove: (hid, id) => store.apply('loadout-del', atHunter(hid, h => removeLoadout(h, id))),
    // one action. Core (`wearSet` via `swapLoadout`) enforces in-fight refusal, two-handed lock, and the 6-item cap.
    swap(hid, id) {
      const h = store.hunter(hid), l = h && h.loadouts.find(x => x.id === id); if (!l) return null;
      const skipped = [], left = [];
      if (!ui.wrote('Loadout', store.apply('loadout-swap', s => {
        const r = swapLoadout(s, hid, id, rules(), LO.inFight(hid));
        if ('save' in r) { skipped.push(...r.skipped); left.push(...r.left); return r.save; }
        return r;
      }), LOADOUT_WORDS)) return { skipped, kept: [...SLOTS] };
      const msg = [`${l.name} equipped.`];
      if (skipped.length) msg.push(`No longer in the bag: ${skipped.join(', ')}.`);
      if (left.length) msg.push(`Left in your bag: ${left.join(', ')}.`);
      ui.toast('Loadout', msg.join(' '), { kind: skipped.length || left.length ? 'warning' : 'info' });
      return { skipped, kept: [] };
    },
  };
  async function manageLoadout(hid, id) {
    const h = store.hunter(hid), l = h && h.loadouts.find(x => x.id === id); if (!l) return;
    const rows = SLOTS.map(s => {
      const want = l.slots[s], it = want && app.api.inventory.bag(h).find(i => i.id === want);
      return `<li><span>${esc(SLOT_LABELS[s] || s)}</span><span class="${want && !fits(it, s) ? 'bad' : ''}">${it ? esc(it.name) + (fits(it, s) ? '' : ' (cannot equip)') : '<i>empty</i>'}</span></li>`;
    }).join('');
    const v = await ui.system({ tag: '! Loadout', title: l.name, kind: 'info', layout: 'list', html: `<ul class="lo-pv">${rows}</ul>`,
      actions: [{ label: 'Equip', value: 'swap', primary: true }, { label: 'Rename', value: 'ren' }, { label: 'Overwrite with current gear', value: 'ow' },
        { label: 'Delete', value: 'del', danger: true }, { label: 'Close', value: null, cancel: true }] });
    if (v === 'swap') LO.swap(hid, id);
    else if (v === 'ren') { const n = await ui.promptText({ title: 'Rename loadout', label: 'Name', value: l.name, maxlength: 24 }); if (n) ui.wrote('Loadout', LO.rename(hid, id, n), LOADOUT_WORDS); }
    else if (v === 'ow') { if (await ui.confirm({ title: `Overwrite ${l.name}?`, body: 'Overwriting replaces the saved loadout with your equipped gear.', danger: true, confirmLabel: 'Overwrite loadout' })) ui.wrote('Loadout', LO.overwrite(hid, id), LOADOUT_WORDS); }
    else if (v === 'del') { if (await ui.confirm({ title: `Delete ${l.name}?`, body: 'Your items stay in your bag.', danger: true, confirmLabel: 'Delete loadout' })) ui.wrote('Loadout', LO.remove(hid, id), LOADOUT_WORDS); }
  }
  app.registerPanel({
    view: 'status', id: 'loadouts', order: 46, title: 'Loadouts',
    mount(el) {
      el.innerHTML = `<ul class="lo-list" data-lolist></ul><p class="cz-note" data-loempty>Save your equipped gear as a loadout so you can swap to it in one tap.</p>
        <div class="lo-acts"><button type="button" data-losave>Save current gear</button></div><p class="cz-note" data-lofight hidden>You cannot change gear during a fight.</p>`;
      el.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return; const hid = store.active().id;
        if (b.dataset.loswap) return LO.swap(hid, b.dataset.loswap);
        if (b.dataset.lomore) return manageLoadout(hid, b.dataset.lomore);
        if ('losave' in b.dataset) {
          const n = await ui.promptText({ title: 'Save loadout', label: 'Name', value: `Loadout ${store.active().loadouts.length + 1}`, maxlength: 24 });
          if (n) ui.wrote('Loadout', LO.save(hid, n), LOADOUT_WORDS);
        }
      });
    },
    update(el) {
      const h = store.active(), cap = loCap();
      el.querySelector('[data-lolist]').innerHTML = h.loadouts.map(l => {
        const n = Object.keys(l.slots).length;
        return `<li class="lo-row"><button type="button" class="lo-chip" data-loswap="${esc(l.id)}" aria-pressed="${sameSet(h, l)}"><span>${esc(l.name)}</span><small>${n} item${n === 1 ? '' : 's'}</small></button>
          <button type="button" class="lo-more" data-lomore="${esc(l.id)}" aria-label="Manage ${esc(l.name)}">⋯</button></li>`;
      }).join('');
      el.querySelector('[data-loempty]').hidden = h.loadouts.length > 0;
      const sv = el.querySelector('[data-losave]'); sv.disabled = h.loadouts.length >= cap; sv.textContent = h.loadouts.length >= cap ? `Loadouts full (${cap})` : 'Save current gear';
      el.querySelector('[data-lofight]').hidden = !LO.inFight(h.id);
    },
  });

  // ── room rules & GM Keystones switch ─────────────────────────────────────
  // the room's rules doc follows the GM's switches however they changed (app.api.sync.publish): personal gates,
  // feats, trade, keystones, economy (build.ts `roomRulesOf`); a player's phone in the room plays by it through
  // rules() (src/edge/rules.ts), and its own switches are never written by the room
  A().sync.publish('rules', () => roomRulesOf(rules()));

  app.registerPanel({
    view: 'status', id: 'build', order: 13, title: KEYSTONE_SWITCH_WORDS.label, gmOnly: true,
    mount(el) {
      el.innerHTML = '<div class="lo-acts" data-bdgm></div><p class="cz-note" data-ksgm-hint hidden></p>';
      el.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b || !app.isGM()) return;
        if ('kstoggle' in b.dataset) ui.wrote('GM', store.apply('gm-rules', s => keystoneSwitched(s, !rules().fight.keystone.on)));
      });
    },
    update(el) {
      const gm = app.isGM(), ksOn = rules().fight.keystone.on, KW = KEYSTONE_SWITCH_WORDS;
      el.querySelector('[data-bdgm]').innerHTML = gm
        ? `<button type="button" data-kstoggle aria-pressed="${ksOn}">${esc(KW.label)}: ${ksOn ? KW.on : KW.off}</button>`
        : '';
      const kh = el.querySelector('[data-ksgm-hint]');
      kh.hidden = !gm;
      kh.textContent = gm ? KW.hint : '';
    },
  });
}

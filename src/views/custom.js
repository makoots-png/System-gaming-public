// custom.js: player customization. Device prefs (own localStorage key, never in a save/sheet/event; written by
// store.setPrefs), hunter identity (emblem + color on the sheet, hunter/identity.ts), equipment loadouts
// (hunter/loadouts.ts), build paths (hunter/build.ts over the rules.ts table, GM-overridable). This file draws and taps.
import { EMBLEMS, HUNTER_COLORS, ACCENTS, TEXT_SCALES, RANKS, PERK_KEYS, PERK_LABELS, pathOf, perkOf, tiersOpen } from '../edge/rules.ts';
import * as ui from './ui.js';
import { oneOf } from '../core/one-of.ts';
import { available, raiseMany } from '../core/hunter/progress.ts';
import { atHunter, atSettings } from '../core/save-step.ts';
import { withSound } from '../core/settings.ts';
import { withBadge } from '../core/hunter/identity.ts';
import { fits, loadoutCap, overwriteLoadout, removeLoadout, renameLoadout, saveLoadout, swapLoadout } from '../core/hunter/loadouts.ts';
import { choosePath as pathChosen, mayPick, perkText, pickPerk, respec as respecHunter, respecBlock as respecWhy, respecCost as respecGold, buildRuleSet, buildRulesReset, roomRulesOf } from '../core/hunter/build.ts';
import { autoSpend } from '../core/hunter/sheet.ts';
import { newRewards } from '../core/rewards.ts';

const { esc } = ui;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const RANK_C = { E: '#9fb6c9', D: '#59e6a8', C: '#4dd8ff', B: '#4d8cff', A: '#c79bff', S: '#ffc94d' }; // = --rank-* in app.css
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
.lo-acts,.bd-acts{display:flex;flex-wrap:wrap;gap:8px}.bd-acts{margin-top:8px}.bd-acts:empty{display:none}
.lo-pv,.bd-pv{list-style:none;margin:0;padding:0;font-size:14px}.lo-pv li,.bd-pv li{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(27,74,110,.5)}
.lo-pv .bad{color:#ff8a96}.bd-pv .up{color:var(--green)}
.bd-paths{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.bd-paths button{min-height:64px;text-align:left;display:flex;flex-direction:column;gap:2px;padding:8px 10px}.bd-paths small{font-weight:400;color:var(--muted);letter-spacing:0}
.bd-tiers{list-style:none;margin:8px 0;padding:0;display:flex;flex-direction:column;gap:8px}
.bd-tier{display:grid;grid-template-columns:52px 1fr 1fr;gap:6px;align-items:stretch}
.bd-tier .bd-r{display:flex;flex-direction:column;justify-content:center;font-size:12px;color:var(--muted)}
.bd-tier button{min-height:40px;padding:4px 6px;font-size:13px}.bd-tier button[aria-pressed=true]{border-color:var(--cyan);color:var(--cyan);background:rgba(77,216,255,.16)}
.bd-tier.locked button{border-style:dashed}.bd-tier button[aria-pressed=true]:disabled{opacity:1}
.cz-grid [data-pc=""] .cz-sw{border:2px dashed var(--ice)}
.bd-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.bd-off{color:var(--gold)}
.id-del .emb-btn{margin-right:auto;color:var(--ice);border-color:var(--edge);display:inline-flex;align-items:center;gap:8px;padding:4px 12px 4px 6px}
${TOUCH}{.lo-acts button,.bd-acts button,.lo-row .lo-chip,.bd-tier button,.id-del .emb-btn,.sys-actions button{min-height:44px}
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
    h = isObj(h) ? h : {}; const e = typeof h.emblem === 'string' && Object.hasOwn(EMBLEMS, h.emblem) ? h.emblem : '';
    const ch = [...String(h.name || '?').trim()][0] || '?';
    const inner = e ? `<path d="${EMBLEMS[e]}"/>` : `<text x="12" y="17" text-anchor="middle">${esc(ch.toUpperCase())}</text>`;
    return `<span class="hb${size ? ' hb-' + size : ''}" style="--hc:${colorOf(h)}" aria-hidden="true"><svg viewBox="0 0 24 24">${inner}</svg></span>`;
  };
  const pick = { e: '', c: '', hid: null }; // the open identity picker
  const pickerHtml = () => `<div class="cz-pick">
      <div class="cz-prev" data-czprev>${badge({ ...store.hunter(pick.hid), emblem: pick.e, color: pick.c }, 'lg')}<span class="cz-note">Shown to your party and the GM.</span></div>
      <div class="lbl">Emblem</div>
      <div class="cz-grid" role="group" aria-label="Emblem">
        <button type="button" data-pe="" aria-pressed="${!pick.e}" aria-label="Initial">${badge({ ...store.hunter(pick.hid), emblem: '', color: pick.c }, 'sm')}</button>
        ${Object.keys(EMBLEMS).map(k => `<button type="button" data-pe="${k}" aria-pressed="${pick.e === k}" aria-label="${k}">${badge({ emblem: k, color: pick.c, rank: (store.hunter(pick.hid) || {}).rank }, 'sm')}</button>`).join('')}
      </div>
      <div class="lbl">Color</div>
      <div class="cz-grid" role="group" aria-label="Color">
        <button type="button" data-pc="" aria-pressed="${!pick.c}" aria-label="Rank color"><span class="cz-sw" style="--sw:${RANK_C[(store.hunter(pick.hid) || {}).rank] || RANK_C.E}"></span></button>
        ${HUNTER_COLORS.map(c => `<button type="button" data-pc="${c}" aria-pressed="${pick.c === c}" aria-label="Color ${c}"><span class="cz-sw" style="--sw:${c}"></span></button>`).join('')}
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
      store.apply('identity', atHunter(hid, x => withBadge(x, pick.e, pick.c)));
      return true;
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
        <p class="cz-note">These settings are for this phone only. Your save, a backup and the room never hold them.</p>
        <div class="cz-sec"><h3>Accent</h3><div class="cz-grid" role="group" aria-label="Accent" data-acc></div></div>
        <div class="cz-sec"><h3>Text size</h3><div data-text></div></div>
        <div class="cz-sec"><h3>Motion</h3><div data-motion></div><p class="cz-note">Follow device uses your phone's reduce-motion setting. Reduce keeps the screen still, and Full always moves.</p></div>
        <div class="cz-sec"><h3>Feedback</h3>
          <label class="cz-check"><input type="checkbox" data-pf="haptics"><span>Vibrate on a level up, your turn, a quest done and damage</span></label>
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
        if (t.dataset.pf === 'sound') store.apply('settings', atSettings(st => withSound(st, t.checked))); // settings.sound keeps its name and home (save state)
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
  const sameSet = (h, l) => rules().slots.every(s => (l.slots[s] || null) === (h.equipped[s] || null));
  // a fight holds hunter hid (core/combat/fight-save.ts `fightHold`, through the hunter api): its gear and build wait
  const inFight = hid => A().hunter.fightOf({ hid }) !== null;
  const LO = A().loadouts = {
    inFight,
    save(hid, name) {
      const id = store.id('lo');
      return store.apply('loadout-save', atHunter(hid, h => saveLoadout(h, id, String(name || ''), rules()))).ok ? id : null;
    },
    overwrite: (hid, id) => store.apply('loadout-save', atHunter(hid, h => overwriteLoadout(h, id, rules()))).ok,
    rename: (hid, id, name) => store.apply('loadout-rename', atHunter(hid, h => renameLoadout(h, id, String(name || '')))).ok,
    remove: (hid, id) => store.apply('loadout-del', atHunter(hid, h => removeLoadout(h, id))).ok,
    // one action. Listed slot + item exists + fits -> equipped; slot absent from the set -> emptied; item gone/unfit -> slot left as is and reported.
    // Refused in a fight: the fight's row holds the sheet it started with (m2-plan section 4.4, W4); `kept` lists every slot then.
    swap(hid, id) {
      const h = store.hunter(hid), l = h && h.loadouts.find(x => x.id === id); if (!l) return null;
      const skipped = [], kept = [];
      if (LO.inFight(hid)) {
        ui.toast('Loadout', 'Gear cannot change during a fight.', { kind: 'warning' });
        return { skipped, kept: [...rules().slots] };
      }
      store.apply('loadout-swap', s => { const r = swapLoadout(s, hid, id, rules(), false); if ('save' in r) { skipped.push(...r.skipped); return r.save; } return r; });
      const msg = [`${l.name} equipped.`];
      if (skipped.length) msg.push(`No longer in the bag: ${skipped.join(', ')}.`);
      ui.toast('Loadout', msg.join(' '), { kind: skipped.length ? 'warning' : 'info' });
      return { skipped, kept };
    },
  };
  async function manageLoadout(hid, id) {
    const h = store.hunter(hid), l = h && h.loadouts.find(x => x.id === id); if (!l) return;
    const rows = rules().slots.map(s => {
      const want = l.slots[s], it = want && h.items.find(i => i.id === want);
      return `<li><span>${esc(s)}</span><span class="${want && !fits(it, s) ? 'bad' : ''}">${it ? esc(it.name) + (fits(it, s) ? '' : ' (cannot equip)') : '<i>empty</i>'}</span></li>`;
    }).join('');
    const v = await ui.system({ tag: '! Loadout', title: l.name, kind: 'info', layout: 'list', html: `<ul class="lo-pv">${rows}</ul>`,
      actions: [{ label: 'Equip', value: 'swap', primary: true }, { label: 'Rename', value: 'ren' }, { label: 'Overwrite with current gear', value: 'ow' },
        { label: 'Delete', value: 'del', danger: true }, { label: 'Close', value: null, cancel: true }] });
    if (v === 'swap') LO.swap(hid, id);
    else if (v === 'ren') { const n = await ui.promptText({ title: 'Rename loadout', label: 'Name', value: l.name, maxlength: 24 }); if (n) LO.rename(hid, id, n); }
    else if (v === 'ow') { if (await ui.confirm({ title: `Overwrite ${l.name}?`, body: 'It will hold the gear you have on now.', confirmLabel: 'Overwrite' })) LO.overwrite(hid, id); }
    else if (v === 'del') { if (await ui.confirm({ title: `Delete ${l.name}?`, danger: true, confirmLabel: 'Delete' })) LO.remove(hid, id); }
  }
  app.registerPanel({
    view: 'status', id: 'loadouts', order: 46, title: 'Loadouts',
    mount(el) {
      el.innerHTML = `<ul class="lo-list" data-lolist></ul><p class="cz-note" data-loempty>Save the gear you have on as a set, then swap it back in one tap.</p>
        <div class="lo-acts"><button type="button" data-losave>Save current gear</button></div><p class="cz-note" data-lofight hidden>Gear cannot change during a fight.</p>`;
      el.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return; const hid = store.active().id;
        if (b.dataset.loswap) return LO.swap(hid, b.dataset.loswap);
        if (b.dataset.lomore) return manageLoadout(hid, b.dataset.lomore);
        if ('losave' in b.dataset) {
          const n = await ui.promptText({ title: 'Save loadout', label: 'Name', value: `Set ${store.active().loadouts.length + 1}`, maxlength: 24 });
          if (n) LO.save(hid, n);
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
      const sv = el.querySelector('[data-losave]'); sv.disabled = h.loadouts.length >= cap; sv.textContent = h.loadouts.length >= cap ? `Full (${cap})` : 'Save current gear';
      el.querySelector('[data-lofight]').hidden = !LO.inFight(h.id);
    },
  });

  // ── build paths ──────────────────────────────────────────────────────────
  const B = () => rules().build;
  const on = () => B().enabled !== false;
  const canPick = () => mayPick(rules(), role());
  const respecCost = h => respecGold(h, rules());
  const role = () => (app.isGM() ? 'gm' : 'player');
  // why a player can't buy a respec right now ('' = allowed). GM mode never asks.
  const RESPEC_WHY = {
    'no-path': () => 'There is no path to respec.', 'in-fight': () => 'You cannot respec during a fight.',
    short: h => `Respec costs ${ui.fmt(respecCost(h))} gold. You have ${ui.fmt(h.gold)}.`,
  };
  const respecBlock = h => { const why = respecWhy(h, rules(), inFight(h.id)); return why ? RESPEC_WHY[why](h) : ''; };
  // auto-place unspent ability points by the path's alloc weights (autoSpend); points stay undoable until confirmed
  const allocPlan = h => { const p = pathOf(rules(), h.build.path); return p ? autoSpend(h, p, rules()) : {}; };
  const BD = A().build = {
    setPath: (hid, id, force = false) => store.apply('build', atHunter(hid, h => pathChosen(h, id, rules(), force))).ok,
    pick: (hid, tier, choice) => store.apply('build', atHunter(hid, h => pickPerk(h, tier, choice, rules(), role()))).ok,
    // GM mode: free. Player: pays respecCost in the same step; refused (false) in a fight or when short of gold.
    respec: hid => store.apply('build', atHunter(hid, h => respecHunter(h, rules(), role(), inFight(hid)))).ok,
    // GM board line: path name + active perks from a sheet (a player's sheet is read by the room's parser; caller escapes)
    label(h) {
      const b = h.build, p = pathOf(rules(), b.path); if (!p) return '';
      const pk = b.picks, bad = pk.findIndex(x => x !== 0 && x !== 1);
      const n = Math.min(bad < 0 ? pk.length : bad, tiersOpen(p, h.rank));
      return `${p.name} ${n}/${p.tiers.length}`;
    },
    auto(hid) {
      const h = store.hunter(hid); if (!h) return null; const plan = allocPlan(h);
      return store.apply('stat', atHunter(hid, x => raiseMany(x, plan, rules()))).ok ? plan : null;
    },
    // GM board: local hunter -> applied here; remote sheet -> award event (old players ignore the unknown key)
    async gmMenu(who, sheet) {
      const R = rules(), h = who.kind === 'remote' ? sheet : store.hunter(who.hunterId); if (!h) return;
      // the next open tier's two perks (same checks as build.pick / reward; a player's sheet is read by the room's parser)
      const b = h.build, p = pathOf(R, b.path), pk = b.picks, t = pk.length;
      const next = on() && p && pk.every(x => x === 0 || x === 1) && t < tiersOpen(p, h.rank) ? t : -1;
      const v = await ui.system({ tag: '! GM', title: `Build: ${h.name}`, layout: 'list', kind: 'info',
        body: `Path: ${(p || {}).name || 'none'}`,
        actions: [...(next < 0 ? [] : [0, 1].map(c => ({ label: `Rank ${RANKS[next]}: ${perkText(perkOf(p, next, c))}`, value: { tier: next, pick: c } }))),
          ...Object.keys(R.paths || {}).filter(id => pathOf(R, id)).map(id => ({ label: `Set path: ${R.paths[id].name || id}`, value: id })),
          { label: 'Respec (clear path and perks)', value: 'respec', danger: true }, { label: 'Cancel', value: null, cancel: true }] });
      if (!v) return;
      if (who.kind === 'remote') {
        /** @type {import('../core/protocol.ts').BuildChange} */
        const build = isObj(v) ? { tier: Number(v.tier), pick: v.pick === 1 ? 1 : 0 } : v === 'respec' ? 'respec' : { path: String(v) };
        const ok = A().sync.post(A().sync.event('award', { to: [who.remote], rewards: { ...newRewards(), build } })).ok;
        ui.toast('GM', ok ? 'Build change sent.' : 'Not in a room: nothing was sent.', { kind: ok ? 'info' : 'warning' });
      } else if (isObj(v)) BD.pick(who.hunterId, Number(v.tier), v.pick === 1 ? 1 : 0); else if (v === 'respec') BD.respec(who.hunterId); else BD.setPath(who.hunterId, v, true);
    },
    setRule(patch) { // GM: enabled / playerPick; published in the room's 'rules' doc, which players' rules follow
      store.apply('gm-rules', s => buildRuleSet(s, patch));
    },
    resetRules() { store.apply('gm-rules', buildRulesReset); },
  };
  // the room's rules doc follows the GM's switches however they changed (app.api.sync.publish): the build's and the
  // personal gates' (build.ts `roomRulesOf`); a player's phone in the room plays by it through rules()
  // (src/edge/rules.ts), and its own switches are never written by the room
  A().sync.publish('rules', () => roomRulesOf(rules()));

  const deltaRows = (h, bonus) => {
    const d = A().hunter.sheet(h);
    return PERK_KEYS.filter(k => bonus[k]).map(k => { const cur = k in d.stats ? d.stats[k] : d.sheet[k]; return `<li><span>${PERK_LABELS[k]}</span><span>${esc(cur)} → <b class="up">${esc(cur + Math.trunc(bonus[k]))}</b></span></li>`; }).join('');
  };
  async function choosePath(hid, id) {
    const p = pathOf(rules(), id); if (!p) return;
    const rows = (p.tiers || []).map((t, i) => `<li><span>Rank ${RANKS[i] || '?'}</span><span>${esc(perkText(perkOf(p, i, 0)))} <i>or</i> ${esc(perkText(perkOf(p, i, 1)))}</span></li>`).join('');
    const ok = await ui.system({ tag: '! Path', title: p.name || id, kind: 'info', body: 'You take one perk at each rank. The path stays until a respec, which costs gold.', html: `<ul class="bd-pv">${rows}</ul>`,
      actions: [{ label: 'Cancel', value: false, cancel: true }, { label: 'Choose path', value: true, primary: true }] });
    if (ok === true) BD.setPath(hid, id);
  }
  async function confirmPick(hid, tier, choice) {
    const h = store.hunter(hid), p = pathOf(rules(), h.build.path), b = perkOf(p, tier, choice);
    const ok = await ui.system({ tag: '! Perk', title: perkText(b), kind: 'levelup', html: `<ul class="bd-pv">${deltaRows(h, b)}</ul>`, body: 'This choice stays until a respec.',
      actions: [{ label: 'Cancel', value: false, cancel: true }, { label: 'Take perk', value: true, primary: true }] });
    if (ok === true) BD.pick(hid, tier, choice);
  }
  async function buyRespec(hid) {
    const h = store.hunter(hid); if (!h) return;
    const why = respecBlock(h); if (why) return ui.toast('Build', why, { kind: 'warning' });
    const cost = respecCost(h);
    if (await ui.confirm({ title: `Respec for ${ui.fmt(cost)} gold?`, body: `You have ${ui.fmt(h.gold)} gold. Path and perks are cleared. Ability points are not refunded.`, danger: true, confirmLabel: `Pay ${ui.fmt(cost)} gold` })) {
      if (!BD.respec(hid)) ui.toast('Build', respecBlock(store.hunter(hid) || h) || 'The respec did not happen.', { kind: 'warning' });
    }
  }
  async function confirmAuto(hid) {
    const h = store.hunter(hid), plan = allocPlan(h); if (!Object.keys(plan).length) return;
    const ok = await ui.system({ tag: '! Points', title: 'Auto-place points', kind: 'info', html: `<ul class="bd-pv">${deltaRows(h, plan)}</ul>`, body: 'You can still undo with − until you confirm.',
      actions: [{ label: 'Cancel', value: false, cancel: true }, { label: 'Place points', value: true, primary: true }] });
    if (ok === true) BD.auto(hid);
  }
  app.registerPanel({
    view: 'status', id: 'build', order: 13, title: 'Build',
    mount(el) {
      el.innerHTML = '<div data-bd></div><div class="bd-acts" data-bdgm></div>';
      el.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return; const d = b.dataset, hid = store.active().id;
        if (d.bdpath) return choosePath(hid, d.bdpath);
        if (d.bdtier) return confirmPick(hid, Number(d.bdtier), Number(d.bdc));
        if ('bdauto' in d) return confirmAuto(hid);
        if ('bdbuy' in d) return buyRespec(hid);
        if (!app.isGM()) return;
        if ('bdset' in d) return BD.gmMenu({ kind: 'local', hunterId: hid }, null);
        if ('bdrespec' in d) return ui.confirm({ title: 'Respec this hunter?', body: 'Path and perks are cleared. Ability points are not refunded.', danger: true, confirmLabel: 'Respec' }).then(ok => ok && BD.respec(hid));
        if ('bdtoggle' in d) return BD.setRule({ enabled: !on() });
        if ('bdpp' in d) return BD.setRule({ playerPick: B().playerPick === false });
        if ('bdreset' in d) return BD.resetRules();
      });
    },
    update(el) {
      const h = store.active(), R = rules(), p = pathOf(R, h.build.path), gm = app.isGM(), open = tiersOpen(p, h.rank);
      let html;
      if (!on()) html = `<p class="cz-note bd-off">The GM has turned builds off. Your path is kept.</p>`;
      else if (!p) html = `<p class="cz-note">Pick a path. Each rank unlocks one perk.</p>
        <div class="bd-paths">${Object.keys(R.paths || {}).filter(id => pathOf(R, id)).map(id => `<button type="button" data-bdpath="${esc(id)}"${canPick() ? '' : ' disabled'}><span>${esc(R.paths[id].name || id)}</span>
          <small>${esc(Object.keys(R.paths[id].alloc || {}).map(k => PERK_LABELS[k] || k).join(' · '))}</small></button>`).join('')}</div>`;
      else {
        const next = h.build.picks.length, free = available(h, R);
        html = `<div class="bd-head"><span>${badge(h, 'sm')}<b>${esc(p.name || h.build.path)}</b></span><span class="cz-note">${Math.min(next, open)}/${(p.tiers || []).length} perks</span></div>
          <ol class="bd-tiers">${(p.tiers || []).map((t, i) => {
            const got = h.build.picks[i], locked = i >= open, live = i === next && !locked && canPick();
            return `<li class="bd-tier${locked ? ' locked' : ''}"><span class="bd-r">Rank ${RANKS[i] || '?'}${locked ? '<br>locked' : got !== undefined && i >= open ? '<br>inactive' : ''}</span>
              ${[0, 1].map(c => `<button type="button" data-bdtier="${i}" data-bdc="${c}" aria-pressed="${got === c}"${live ? '' : ' disabled'}>${esc(perkText(perkOf(p, i, c)))}</button>`).join('')}</li>`;
          }).join('')}</ol>
          ${canPick() ? '' : '<p class="cz-note">The GM picks perks in this game.</p>'}
          <div class="bd-acts">${free > 0 && Object.keys(allocPlan(h)).length ? `<button type="button" data-bdauto>Auto-place ${free} point${free === 1 ? '' : 's'}</button>` : ''}${
            !gm && canPick() ? `<button type="button" data-bdbuy>Respec (${ui.fmt(respecCost(h))} gold)</button>` : ''}</div>`;
      }
      if (el._h !== html) { el._h = html; el.querySelector('[data-bd]').innerHTML = html; }
      el.querySelector('[data-bdgm]').innerHTML = gm ? `<button type="button" data-bdset>Set path</button><button type="button" data-bdrespec class="danger"${h.build.path ? '' : ' disabled'}>Respec</button>
        <button type="button" data-bdtoggle aria-pressed="${on()}">Builds: ${on() ? 'on' : 'off'}</button><button type="button" data-bdpp aria-pressed="${B().playerPick !== false}">Players pick: ${B().playerPick !== false ? 'yes' : 'no'}</button>
        <button type="button" data-bdreset>Reset build rules</button>` : '';
    },
  });
  // the Path skill card's "Build" button lives in .panels, outside hunter.js's jump-chip listener
  document.addEventListener('click', e => {
    const b = e.target.closest('#view-status .panels [data-jump]'); if (!b) return;
    const t = document.querySelector(`#view-status [data-panel="${CSS.escape(b.dataset.jump)}"]`);
    if (t) t.scrollIntoView({ behavior: ui.reduced() ? 'auto' : 'smooth', block: 'start' });
  });
}

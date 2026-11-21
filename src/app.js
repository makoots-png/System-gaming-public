// app.js: bootstrap, view/panel registry, nav, hash routing, header (hunter switcher + mode pill), banners.
import { store } from './edge/store.ts';
import { newBus } from './edge/bus.ts';
import { apiTable } from './edge/api-table.ts';
import { reported } from './edge/report.ts';
import { RULES, rules } from './edge/rules.ts';
import { chooseMode, roleOf, seatOf } from './core/role.ts';
import { atSettings } from './core/save-step.ts';
import { addHunter } from './core/party.ts';
import { panelDraw, panelDrawn } from './core/panel.ts';
import { PANEL_DEFAULTS, VIEW_DEFAULTS } from './views/app.ts';
import * as ui from './views/ui.js';
import * as motion from './views/motion.ts';
import * as effects from './views/effects.js';
import * as detail from './views/detail.js';
import * as odds from './views/odds-box.js';
import * as feats from './views/feats.js';
import * as maker from './views/maker.js';
import * as hunter from './views/hunter.js';
import * as quests from './views/quests.js';
import * as skills from './views/skills.js';
import * as inventory from './views/inventory.js';
import * as dice from './views/dice.js';
import * as rulesref from './views/rulesref.js';
import * as bestiary from './views/bestiary.js';
import * as gates from './views/gates.js';
import * as map from './views/map.js';
import * as combat from './views/combat.js';
import * as shadows from './views/shadows.js';
import * as gm from './views/gm.js';
import * as io from './views/io.js';
import * as sync from './edge/sync.ts';
import * as roomPill from './views/room-pill.ts';
import * as room from './views/room.js';
import * as onboard from './views/onboard.js';
import * as table from './views/table.js';
import * as uses from './views/uses.js';
import * as coin from './views/coin.js';
import * as forge from './views/forge.js';
import * as loot from './views/loot.js';
import * as workshop from './views/workshop.js';
import * as stories from './views/stories.js';
import * as mapMaker from './views/map-maker.js';
import * as custom from './views/custom.js';
import * as chronicle from './views/chronicle.js';

const views = new Map();
const panels = [];
/** Runs `fn`: true when it returned, false when it threw, which is logged at `where`. */
const ran = (where, fn) => { try { fn(); return true; } catch (e) { reported(where, e); return false; } };
/**
 * What a view's, a panel's or a key's `when` says (src/core/panel.ts `PanelSaid`): a `when` that throws is a bug, logged,
 * and the view or panel shows failed.
 * @returns {import('./core/panel.ts').PanelSaid}
 */
const asked = (x, where) => { try { return x.when() ? 'yes' : 'no'; } catch (e) { reported(where, e); return 'threw'; } };
/** @type {import('./edge/api-table.ts').ApiTable<import('./core/api.ts').AppApi>} */
const apis = apiTable();
const linkRoom = () => app.api.sync.room(); // the room the link is in (src/edge/sync.ts, registered before any view draws)
const seat = () => seatOf(store.get().settings, linkRoom()); // 'alone' | 'gm' | 'player': the one answer to "where does this phone sit"
const role = () => roleOf(store.get().settings, linkRoom()); // 'gm' | 'player': the one answer to "is this phone the GM"

/** @type {import('./views/app.ts').App} */
export const app = {
  store, rules, ui, RULES,
  api: apis.api,
  ...newBus((name, e) => reported('handler:' + name, e)), // on(name, fn) and emit(name, payload), typed by src/core/events.ts
  registerView(v) { views.set(v.id, { ...VIEW_DEFAULTS, ...v }); chromeDirty(); },
  registerPanel(p) { panels.push({ ...PANEL_DEFAULTS, ...p }); },
  jumps: id => viewPanels(id).filter(p => p.jump).map(p => ({ label: p.jump, id: p.id })),
  go(id) {
    const want = '#/' + id;
    if (location.hash !== want) { location.hash = want; return; } // its hashchange routes it
    route(); // the view shown, gone to again: a navigation all the same, so the sheets over it go (ui.went)
  },
  redraw: () => scheduleUpdate(),
  isGM: () => role() === 'gm',
  seat,
  // layout helper (B1): behaviour only, never for styling
  layout: { desktop: () => mqD.matches, wide: () => mqW.matches },
  // keyboard registry (B5)
  keys: {
    add(def) { const d = { group: 'Global', ...def }; keyDefs.push(d); return () => { const i = keyDefs.indexOf(d); if (i >= 0) keyDefs.splice(i, 1); }; },
    list() { return live().map(({ key, label, group }) => ({ key, label, group })); },
  },
};

// ── layout helper (B1): behaviour only, never for styling ──
const mqD = matchMedia('(min-width:1100px)'), mqW = matchMedia('(min-width:1500px)');
const layoutFlip = () => app.emit('layout', { desktop: mqD.matches, wide: mqW.matches });
mqD.addEventListener('change', layoutFlip); mqW.addEventListener('change', layoutFlip);

// ── keyboard registry (B5) ──
const keyDefs = [];
function live() {
  return keyDefs.filter(d => (!d.view || d.view === current) && (!d.gmOnly || role() === 'gm') && (!d.when || asked(d, 'key:' + d.key) === 'yes'));
}
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.isComposing || e.repeat) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && t.closest && t.closest('input,textarea,select,[contenteditable]')) return;
  if (ui.windowOpen()) return;
  const d = live().find(x => x.key === e.key); if (!d) return;
  e.preventDefault();
  ran('key:' + e.key, () => d.run(e));
});
window.hunterApp = app; // handy for verify scripts

const $ = id => document.getElementById(id);
/** What a view's or panel's `when` says this draw; one for the GM only says no on a player's phone. */
const said = def => (def.gmOnly && role() !== 'gm' ? 'no' : asked(def, 'when:' + def.id));
const avail = v => said(v) !== 'no'; // a failed one shows, drawn failed
const sortedViews = () => [...views.values()].filter(avail).sort((a, b) => a.order - b.order);
const BOTTOM_PLAYER = ['status', 'quests', 'combat', 'dice'], BOTTOM_GM = ['gm', 'combat', 'quests', 'dice'];
const bottomIds = () => (role() === 'gm' ? BOTTOM_GM : BOTTOM_PLAYER);

// ── routing / mounting ──
let current = null; const sections = new Map();

/** Where panel `p` of view `id` is (src/core/panel.ts `PanelState`): `asked` until its box is first made. */
const panelAt = (id, p) => sections.get(id)?.pmounted.get(p.id)?.at ?? 'asked';
/** The panels of view `id` shown this draw, in order, each with what its `when` said (asked once). */
function shownPanels(id) {
  return panels.filter(p => p.view === id).map(p => ({ p, said: said(p) })).filter(x => panelDraw(panelAt(id, x.p), x.said).shown).sort((a, b) => a.p.order - b.p.order);
}
function viewPanels(id) { return shownPanels(id).map(x => x.p); }

/**
 * Draws a view's main part or a panel whose `when` said `when` this draw: the table of src/core/panel.ts says which of
 * its calls run, and a part that fails says so in place and runs no more until a reload. The one writer of `part.at`.
 */
function drawPart(part, def, when, what) {
  const was = part.at;
  part.at = panelDrawn(was, when, call => ran(call + ':' + def.id, () => def[call] && def[call](part.el)));
  if (part.at === 'failed' && was !== 'failed') {
    part.el.innerHTML = what === null ? '<p class="empty">This panel failed to load.</p>'
      : `<section class="win"><span class="cb"></span><h2>${ui.esc(what)}</h2><p class="empty">This section failed to load. The rest of the app still works.</p></section>`;
  }
}

function ensureSection(v) {
  let s = sections.get(v.id);
  if (!s) {
    const root = ui.h(`<section class="view" id="view-${ui.esc(v.id)}" aria-label="${ui.esc(v.label)}" hidden><div class="view-main"></div><div class="panels"></div></section>`);
    $('main').appendChild(root);
    s = { root, pbox: root.querySelector('.panels'), main: { el: root.querySelector('.view-main'), at: 'asked' }, pmounted: new Map() };
    sections.set(v.id, s);
  }
  return s;
}

/** Draws view `v`, whose `when` said `when` this draw (not no), and the panels its own draw shows. */
function renderView(v, when) {
  const s = ensureSection(v);
  const want = shownPanels(v.id);
  // a panel's box is made the first time it shows; one no longer shown leaves the page, kept for when it shows again
  for (const { p } of want) {
    if (!s.pmounted.has(p.id)) {
      const box = ui.h(`<section class="win panel" data-panel="${ui.esc(p.id)}"><span class="cb"></span>${p.title ? `<h2>${ui.esc(p.title)}</h2>` : ''}<div class="panel-body"></div></section>`);
      s.pmounted.set(p.id, { box, el: box.querySelector('.panel-body'), at: 'asked' });
    }
  }
  const boxes = want.map(({ p }) => s.pmounted.get(p.id).box);
  if (boxes.length !== s.pbox.children.length || boxes.some((b, i) => s.pbox.children[i] !== b)) s.pbox.replaceChildren(...boxes); // never churn DOM the user may be typing in
  drawPart(s.main, v, when, v.label);
  for (const { p, said: w } of want) drawPart(s.pmounted.get(p.id), p, w, null);
}

function route() {
  ui.went();
  const m = /^#\/([\w-]+)/.exec(location.hash);
  let id = m ? m[1] : role() === 'gm' ? 'gm' : 'status'; // with no view in the address a GM opens on the GM view, a player on Status
  let v = views.get(id), when = v ? said(v) : 'no';
  if (when === 'no') { id = 'status'; v = views.get('status'); if (!v) return; when = said(v); }
  const from = current;
  if (from && from !== id) { const o = sections.get(from); if (o) o.root.hidden = true; }
  current = id;
  // shown before it is drawn: a view that measures itself as it draws (the map's frame) measures nothing while hidden
  ensureSection(v).root.hidden = false;
  renderView(v, when);
  if (from !== id) { window.scrollTo(0, 0); app.emit('view', { id, from }); }
  renderNav();
}
addEventListener('hashchange', route);

// ── chrome: nav, header, banners ──
let navSig = '';
function renderNav() {
  const vs = sortedViews();
  const sig = vs.map(v => v.id).join() + '|' + current + '|' + role();
  if (sig === navSig) return; navSig = sig;
  const link = (v, cls, i) => `<a class="${cls}" ${i !== undefined && i < 9 ? `title="${ui.esc(v.label)} (${i + 1})"` : ''} href="#/${ui.esc(v.id)}" ${v.id === current ? 'aria-current="page"' : ''}><span class="ni" aria-hidden="true">${ui.esc(v.icon)}</span><span class="nl">${ui.esc(v.label)}</span></a>`;
  $('nav-top').innerHTML = vs.map((v, i) => link(v, 'tab', i)).join('');
  const main = bottomIds().map(id => vs.find(v => v.id === id)).filter(Boolean);
  const rest = vs.filter(v => !main.includes(v));
  const bottom = $('nav-bottom'), lit = () => bottom.querySelector('.tab[aria-current=page], .tab.on'), shown = bottom.offsetParent !== null;
  const was = shown && lit() ? lit().getBoundingClientRect() : null;
  bottom.innerHTML = main.map(v => link(v, 'tab')).join('') +
    (rest.length ? `<button type="button" class="tab more${rest.some(v => v.id === current) ? ' on' : ''}" id="more-btn" aria-haspopup="dialog"><span class="ni" aria-hidden="true">≡</span><span class="nl">More</span></button>` : '');
  const now = was && lit();
  if (now) motion.travel(was, now.getBoundingClientRect(), getComputedStyle(bottom).flexDirection === 'column' ? 'left' : 'top');
}
document.addEventListener('click', e => {
  const b = e.target.closest('#more-btn'); if (!b) return;
  const main = bottomIds();
  const rest = sortedViews().filter(v => !main.includes(v.id));
  ui.system({ tag: '! Menu', title: 'More', layout: 'list',
    actions: [...rest.map(v => ({ label: `${v.icon}  ${v.label}`, value: v.id })), { label: 'Close', value: null, cancel: true }] })
    .then(id => { if (id) app.go(id); });
});

let hdrSig = '';
function renderHeader() {
  const s = store.get(), hs = s.hunters, act = store.active();
  const sel = $('hunter-sel');
  const sig = hs.map(h => h.id + h.name).join('|');
  if (sig !== hdrSig) {
    hdrSig = sig;
    sel.innerHTML = hs.map(h => `<option value="${ui.esc(h.id)}">${ui.esc(h.name)}</option>`).join('') + '<option value="__new">+ New hunter</option>';
  }
  if (sel.value !== act.id) sel.value = act.id;
  const gm = role() === 'gm', inRoom = seat() !== 'alone', pill = $('mode-pill');
  if (pill.textContent !== (gm ? 'GM' : 'PLAYER')) pill.textContent = gm ? 'GM' : 'PLAYER'; // a write of the same text still lays the header out again
  pill.classList.toggle('gm', gm);
  pill.setAttribute('aria-label', inRoom ? `Role in this room: ${gm ? 'GM' : 'Player'}. Activate to read why` : `Mode: ${gm ? 'GM' : 'Player'}. Activate to switch to ${gm ? 'Player' : 'GM'} mode`);
  document.body.dataset.mode = role();
  // banners
  const notes = store.notices(); const bs = JSON.stringify(notes);
  if (bs !== $('banners').dataset.sig) {
    $('banners').dataset.sig = bs;
    $('banners').innerHTML = notes.map(n => `<div class="banner" role="alert">${ui.esc(n.text)}</div>`).join('');
  }
}

$('hunter-sel').addEventListener('change', async e => {
  const sel = e.target;
  if (sel.value === '__new') {
    const name = await ui.promptText({ title: 'New hunter', label: 'Hunter name', value: '' });
    const h = name ? store.newHunter(name) : null;
    // a hunter not added leaves the select on the active one
    if (!h || !ui.wrote('System', store.apply('new-hunter', d => addHunter(d, h)))) sel.value = store.active().id;
    return;
  }
  // a hunter not switched to (a refusal sync.switchTo told, or a Cancel in a room) leaves the select on the active one
  if (!(await app.api.sync.switchTo(sel.value))) sel.value = store.active().id;
});

const ROLE_IN_ROOM = { gm: 'You are the GM of this room.', player: 'You are a player in this room. The GM is the phone that opened it.' };
$('mode-pill').addEventListener('click', async () => {
  // in a room the role comes from the room (core/role.ts): the pill explains it and changes nothing
  const at = seat();
  if (at !== 'alone') { ui.system({ tag: '! System', title: at === 'gm' ? 'GM' : 'Player', body: ROLE_IN_ROOM[at], actions: [{ label: 'Understood', value: null, primary: true }] }); return; }
  const toGM = role() !== 'gm';
  const ok = await ui.confirm({ title: toGM ? 'Switch to GM mode?' : 'Switch to Player mode?',
    body: toGM ? 'GM mode unlocks XP grants, free stat edits and GM tools on this device.' : 'Player mode hides GM tools and direct XP grants.', confirmLabel: toGM ? 'Enter GM mode' : 'Enter Player mode' });
  if (ok) ui.wrote('System', store.apply('mode', atSettings(x => chooseMode(x, toGM ? 'gm' : 'player')))); // alone, the phone chooses
});

document.querySelector('.skip-link').addEventListener('click', e => { e.preventDefault(); $('main').focus(); }); // a '#main' hash would trip the router

// Global keys: ? overlay and 1-9 tab switching
app.keys.add({ key: '?', label: 'Show this keyboard list', group: 'Global', run: () => showKeys() });
for (let n = 1; n <= 9; n++) app.keys.add({ key: String(n), label: 'Go to tab ' + n, group: 'Global', when: () => !!sortedViews()[n - 1], run: () => app.go(sortedViews()[n - 1].id) });
function showKeys() {
  const rows = app.keys.list();
  const digits = rows.filter(r => /^[1-9]$/.test(r.key));
  const rest = rows.filter(r => !/^[1-9]$/.test(r.key));
  if (digits.length) rest.splice(rest.findIndex(r => r.key === '?') + 1, 0, { key: digits.length > 1 ? `1\u2013${digits.length}` : '1', label: 'Go to the Nth tab (top nav order)', group: 'Global' });
  const groups = [...new Set(rest.map(r => r.group))];
  const html = groups.map(g => `<div class="lbl kbd-grp">${ui.esc(g)}</div><ul class="kbd-list">${rest.filter(r => r.group === g).map(r => `<li><kbd>${ui.esc(r.key)}</kbd><span class="kl">${ui.esc(r.label)}</span></li>`).join('')}</ul>`).join('');
  ui.system({ tag: '! System', title: 'KEYBOARD', size: 'form', html,
    actions: [{ label: 'Quick start guide', value: 'qs' }, { label: 'Close', value: null, cancel: true, primary: true }] })
    .then(v => { if (v === 'qs' && app.api.onboard && app.api.onboard.quickstart) app.api.onboard.quickstart(); });
}

$('help-btn').addEventListener('click', () => { if (app.api.onboard) app.api.onboard.quickstart(); });

function chromeDirty() { navSig = ''; scheduleUpdate(); }

// ── update loop: after any store change, refresh chrome + visible view (rAF-batched) ──
let pending = false;
function scheduleUpdate() {
  if (pending) return; pending = true;
  requestAnimationFrame(() => {
    pending = false;
    renderHeader();
    const v = views.get(current), when = v ? said(v) : 'no';
    if (when === 'no') return route();
    renderView(v, when); renderNav();
  });
}
store.subscribe(p => { app.emit('change', p); scheduleUpdate(); });
// a player's rules follow the room's build doc (src/edge/rules.ts), which changes with no save change: redraw when they move
let ruled = rules();
const rulesMoved = () => { const R = rules(); if (R !== ruled) { ruled = R; scheduleUpdate(); } };
app.on('sync:docs', rulesMoved); app.on('sync:status', rulesMoved);

// ── boot ──
// Registration order is load order: a module's register may read the api of a module listed before it (a read of one
// listed after it throws, src/edge/api-table.ts). A register that throws is logged and the rest still register.
const MODULES = { effects, detail, odds, maker, hunter, quests, skills, inventory, dice, rulesref, sync, roomPill, bestiary, gates, map, combat, shadows, stories, gm, io, room, onboard, table, uses, coin, forge, loot, mapMaker, workshop, custom, chronicle, feats };
for (const [name, mod] of Object.entries(MODULES)) {
  ran('register:' + name, () => mod.register(app));
}
apis.booted();
renderHeader();
route();
app.emit('ready');

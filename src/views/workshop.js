// workshop.js: the Workshop, the GM's one screen for what the GM has made, a section per kind (statuses, items, skills,
// monsters, rewards, maps), each listing the library's entries: a tap on an entry edits it, "⋯" holds Duplicate, Share and
// Delete (Reset for a changed built-in), and a skill keeps Give to…, a reward bundle Award…, beside it. New and Edit open the kind's maker (forge.js, loot.js, skills.js, bestiary.js, map-maker.js, and for a bundle
// the reward editor in a maker shell), which saves through the kind's parser; Duplicate and Delete write the library here
// (a bundle through app.api.bundles; its maker is `bundleMaker` in reward-editor.js, which the GM view's Make row opens too). Share shows one entry's code, and Share custom content at the top shares many
// (app.api.share, io.js). The Bestiary keeps the full monster list.
import { BUILT_IN_STATUSES } from '../core/registry/statuses.ts';
import { monsterSheetOf } from '../core/registry/monsters.ts';
import { LIMITS } from '../core/save.ts';
import { atLibrary } from '../core/save-step.ts';
import { copyName, duplicateEntry, namedLike, removeEntry, removeStatus, saveEntry, saveStatus } from '../core/library.ts';
import { exampleSkills, exampleStatuses } from '../core/registry/kit-examples.ts';
import { BUILT_IN_BUNDLES, MOMENT_WORDS } from '../core/registry/bundles.ts';
import { rewardLines } from '../core/rewards.ts';
import { bundleMaker } from './reward-editor.js';
import { featMaker } from './feat-maker.js';
import { BUILT_IN_FEATS } from '../core/registry/feats.ts';
import { featsDoc, freeFeatKey, ruleLine } from '../core/hunter/feats.ts';
import { DOC_MAX } from '../core/protocol.ts';
import { removeFeat, saveFeat } from '../core/library.ts';

const KINDS = [
  ['status', 'Statuses', 'A status, such as Poisoned or Slowed, has effects and goes on a hunter or a monster.', 'New status'],
  ['item', 'Items', 'An item is gear, a potion or loot that a hunter carries, wears or uses.', 'New item'],
  ['skill', 'Skills', 'A skill is an ability a hunter or a monster uses in a fight: a strike, a shot, a blast, a curse or a support, which can hurt, heal, shield or put on a status.', 'New skill'],
  ['monster', 'Monsters', 'A monster of your own: its rank, archetype and kind, its abilities, starting statuses and loot, for the Bestiary and a fight.', 'New monster'],
  ['bundle', 'Bundles', 'A bundle is a reward you saved to give again: XP, gold, items, a title, skills, statuses and boons.', 'New bundle'],
  ['map', 'Maps', 'A battle map: walls, cover, rough ground and pits, the fields that stay on it, where each side starts and the fog. A gate may name one.', 'New map'],
  ['feat', 'Feats', 'A feat is something a hunter does that the game counts and rewards by itself, such as 100 beasts defeated. Make your own, or change or turn off a built-in one.', 'New feat'],
];
/** Each section's kind in a pack (src/core/pack.ts). */
const PACK_KIND = { status: 'statuses', item: 'items', skill: 'skills', monster: 'monsters', bundle: 'rewards', map: 'maps', feat: 'feats' };

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const A = () => app.api;
  const lib = () => store.get().library;
  const isBuiltIn = key => Object.hasOwn(BUILT_IN_STATUSES, key);
  const isBuiltInFeat = key => BUILT_IN_FEATS.some(([k]) => k === key);

  ui.css('workshop', `
.ws-sec{display:flex;flex-direction:column;gap:8px}
.ws-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ws-head h2{flex:1 1 auto;margin:0}
.ws-head button,.ws-acts button,.ws-more{min-height:44px}
.ws-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.ws-list li{border:1px solid var(--line);background:rgba(10,26,46,.55);display:flex;flex-wrap:wrap;align-items:stretch;gap:6px;min-width:0}
.ws-row{flex:1 1 60%;min-width:0;min-height:var(--control-h);display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;padding:8px 12px;background:none;border:0;box-shadow:none;text-align:left;font:inherit;letter-spacing:normal;text-transform:none;color:inherit}
.ws-row:hover{box-shadow:none;background:rgba(77,216,255,.06)}
.ws-list .nm{font-weight:600;overflow-wrap:anywhere}.ws-list .tag{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--cyan-dim);margin-left:8px}
.ws-list .meta{font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}
.ws-acts{display:flex;gap:6px;align-items:center;padding:6px 6px 6px 0;flex:0 0 auto;margin-left:auto}
@media (min-width:900px){.ws-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}.ws-acts{align-items:flex-start}} /* A20: entries are cards on a desktop */
.ws-empty{margin:0;font-size:14px;color:var(--muted)}
.ws-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ws-top h2{flex:1 1 auto;margin:0}.ws-top button{min-height:44px}
.ws-fold summary{min-height:44px;display:flex;align-items:center;cursor:pointer;color:var(--cyan)}
.ws-acts button{white-space:nowrap}
`);

  // ── each kind's rows: [id, name, tag, meta, actions] ──
  const ACTS = { edit: 'Edit', dup: 'Duplicate', del: 'Delete', reset: 'Reset', give: 'Give to…', award: 'Award…', share: 'Share', off: 'Turn off' };
  function rowsOf(kind) {
    const L = lib();
    if (kind === 'status') {
      const conds = app.rules().conditions;
      return Object.keys(L.statuses).filter(k => conds[k]).map(k => [k, String(conds[k].label || k), isBuiltIn(k) ? 'changed built-in' : '',
        A().effects.describe(conds[k]).join(' · ') || conds[k].desc || '', ['edit', 'dup', isBuiltIn(k) ? 'reset' : 'del', 'share']]);
    }
    if (kind === 'item') return L.items.map(it => [it.id, it.name, it.rar, [it.type, ...A().effects.describeItem(it)].filter(Boolean).join(' · '), ['edit', 'dup', 'del', 'share']]);
    if (kind === 'skill') return L.skills.map(k => [k.id, k.name, k.type, A().skills.lines(k).join(' · '), ['edit', 'dup', 'del', 'give', 'share']]);
    if (kind === 'map') return L.maps.map(m => [m.id, m.name, `${m.w} by ${m.h}`, [m.zones.length ? m.zones.map(z => z.name).join(', ') : '', m.fog ? `fog, sight ${m.sight}` : ''].filter(Boolean).join(' · '), ['edit', 'dup', 'del', 'share']]);
    if (kind === 'feat') {
      const left = featsDoc(L.feats, DOC_MAX).left;
      return Object.entries(L.feats).map(([k, d]) => [k, d.name, isBuiltInFeat(k) ? (d.off ? 'built-in, off' : 'changed built-in') : left.includes(k) ? 'too large to send to players' : '',
        d.off ? '' : d.desc || ruleLine(d.rule), ['edit', 'dup', isBuiltInFeat(k) ? 'reset' : 'del', 'share']]);
    }
    if (kind === 'bundle') return A().bundles.list().map(b => [b.id, b.name, '', rewardLines(app.rules(), b.rewards).join(' · '), ['award', 'edit', 'dup', 'del', 'share']]);
    return store.get().monsters.map(m => {
      const s = monsterSheetOf(m, app.rules());
      return [m.id, m.name, `${m.rank}-rank ${m.kind} ${m.archetype}`, `HP ${ui.fmt(s.hpMax)} · Armor ${s.armor} · Resist ${s.resist} · Speed ${s.speed}${m.abilities.length ? ` · ${m.abilities.map(a => a.name).join(', ')}` : ''}`, ['edit', 'dup', 'del', 'share']];
    });
  }
  /** What a row shows beside it: Give to… and Award… stay in sight; Duplicate, Share, Delete and Reset are behind "⋯". */
  const INLINE = ['give', 'award'], MORE = ['dup', 'share', 'off', 'reset', 'del'];
  const rowHtml = ([id, name, tag, meta, acts]) => {
    const inline = acts.filter(a => INLINE.includes(a)), more = MORE.filter(a => acts.includes(a));
    return `<li data-id="${esc(id)}" data-more="${more.join(' ')}"><button type="button" class="ws-row" data-act="edit" aria-label="Edit ${esc(name)}"><span><span class="nm">${esc(name)}</span>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}</span>
      ${meta ? `<span class="meta">${esc(meta)}</span>` : ''}</button>
      ${inline.length || more.length ? `<div class="ws-acts">${inline.map(a => `<button type="button" data-act="${a}" aria-label="${esc(ACTS[a].replace('…', ''))} ${esc(name)}">${ACTS[a]}</button>`).join('')}${more.length ? `<button type="button" class="icon-btn" data-act="more" aria-label="More for ${esc(name)}" aria-haspopup="dialog">⋯</button>` : ''}</div>` : ''}</li>`;
  };
  // ── the kits' examples (registry/kit-examples.ts): a GM copies one into the library and changes it there ──
  /** The examples of a kind as rows: [id, name, tag, meta]. */
  function examplesOf(kind) {
    const R = app.rules();
    if (kind === 'status') return Object.entries(exampleStatuses(R)).map(([k, d]) => [k, d.label, 'example', A().effects.describe(d).join(' · ') || d.desc]);
    if (kind === 'skill') return exampleSkills(R).map((k, i) => [String(i), k.name, k.type, k.desc]);
    // the GM's awards for roleplay (registry/bundles.ts): given from a hunter's card as they are, copied here to change one
    if (kind === 'bundle') return BUILT_IN_BUNDLES.map(b => [b.key, b.name, MOMENT_WORDS[b.moment], [b.window.title, ...rewardLines(R, b.rewards)].join(' · ')]);
    return [];
  }
  function examplesHtml(kind) {
    const rows = examplesOf(kind);
    if (!rows.length) return '';
    return `<details class="ws-fold ws-ex" data-examples><summary>${kind === 'bundle' ? 'Awards for roleplay to copy' : 'Kit examples to copy'} (${rows.length})</summary><ul class="ws-list">${rows.map(([id, name, tag, meta]) =>
      `<li data-id="${esc(id)}" data-example><div class="ws-row"><span><span class="nm">${esc(name)}</span><span class="tag">${esc(tag)}</span></span>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}</div>
        <div class="ws-acts"><button type="button" data-act="example" aria-label="Duplicate ${esc(name)}">Duplicate</button></div></li>`).join('')}</ul></details>`;
  }
  /** Copies an example into the library: a status under its own key when that is free, a skill or a bundle under its name ("… (copy)" when taken). */
  function copyExample(kind, id) {
    const R = app.rules(), L = lib();
    if (kind === 'status') {
      const def = exampleStatuses(R)[id]; if (!def) return;
      const key = Object.hasOwn(L.statuses, id) || isBuiltIn(id) ? A().effects.slug(def.label, { ...R.conditions, ...L.statuses }) : id;
      const done = store.apply('library-example-status', atLibrary(l => saveStatus(l, key, def)));
      ui.toast('Workshop', done.ok ? `${def.label} is in your statuses.` : `The library holds ${LIMITS.libraryStatuses} statuses at most.`, { kind: done.ok ? 'info' : 'warning' });
      return;
    }
    if (kind === 'bundle') {
      const b = BUILT_IN_BUNDLES.find(x => x.key === id); if (!b) return;
      const name = namedLike(L.rewards, b.name, null) ? copyName(b.name, L.rewards.map(x => x.name), 60) : b.name;
      const done = A().bundles.save(name, b.rewards, null, b.window);
      ui.toast('Workshop', done.ok ? `${name} is in your bundles.` : `The library holds ${LIMITS.libraryRewards} bundles at most.`, { kind: done.ok ? 'info' : 'warning' });
      return;
    }
    const k = exampleSkills(R)[Number(id)]; if (!k) return;
    const name = namedLike(L.skills, k.name, null) ? copyName(k.name, L.skills.map(x => x.name), 60) : k.name;
    const done = store.apply('library-example-skill', atLibrary(l => saveEntry(l, 'skills', /** @type {any} */ ({ ...k, name, id: store.id('s') }))));
    ui.toast('Workshop', done.ok ? `${name} is in your skills.` : `The library holds ${LIMITS.librarySkills} skills at most.`, { kind: done.ok ? 'info' : 'warning' });
  }

  /** The "⋯" window of a row: its other actions, Delete and Reset as danger (each still asks before it acts). */
  async function more(kind, li) {
    const name = li.querySelector('.nm') ? li.querySelector('.nm').textContent : '';
    const acts = (li.dataset.more || '').split(' ').filter(Boolean);
    const a = await ui.system({ tag: 'Workshop', title: name, layout: 'list',
      actions: [...acts.map(x => ({ label: ACTS[x], value: x, danger: x === 'del' || x === 'reset' })), { label: 'Cancel', value: null, cancel: true }] });
    if (a) await act(kind, a, li.dataset.id);
  }
  function sectionHtml([kind, title, empty, newLabel]) {
    const rows = rowsOf(kind);
    const built = kind === 'status' ? Object.keys(BUILT_IN_STATUSES).filter(k => !Object.hasOwn(lib().statuses, k)) : [];
    const builtFeats = kind === 'feat' ? BUILT_IN_FEATS.filter(([k]) => !Object.hasOwn(lib().feats, k)) : [];
    return `<section class="win ws-sec" data-ws="${kind}" aria-label="${esc(title)}"><span class="cb"></span>
      <div class="ws-head"><h2>${esc(title)}</h2><button type="button" class="primary" data-new>${esc(newLabel)}</button></div>
      ${rows.length ? `<ul class="ws-list">${rows.map(rowHtml).join('')}</ul>` : `<p class="ws-empty">${esc(empty)}</p>`}
      ${built.length ? `<details class="ws-fold ws-built"><summary>Built-in statuses (${built.length})</summary><ul class="ws-list">${built.map(k => rowHtml([k, String(BUILT_IN_STATUSES[k].label), '', '', ['edit']])).join('')}</ul></details>` : ''}
      ${builtFeats.length ? `<details class="ws-fold ws-built"><summary>Built-in feats (${builtFeats.length})</summary><ul class="ws-list">${builtFeats.map(([k, d]) => rowHtml([k, d.name, '', d.desc, ['edit', 'off']])).join('')}</ul></details>` : ''}
      ${examplesHtml(kind)}
      ${kind === 'monster' ? '<button type="button" class="ws-more" data-bestiary>Every monster in the Bestiary</button>' : ''}</section>`;
  }

  // ── what a button does ──
  async function act(kind, a, id) {
    const L = lib();
    if (a === 'share') return void await A().share.entry(PACK_KIND[kind], id);
    if (kind === 'status') {
      if (a === 'new') return void await A().forge.status({ mode: 'library' });
      const def = L.statuses[id];
      if (a === 'edit') return void await A().forge.status({ mode: 'library', edit: id });
      if (a === 'dup' && def) {
        if (Object.keys(L.statuses).length >= LIMITS.libraryStatuses) return void ui.toast('Workshop', `The library holds ${LIMITS.libraryStatuses} statuses at most.`, { kind: 'warning' });
        const label = copyName(def.label || id, Object.values({ ...app.rules().conditions, ...L.statuses }).map(d => d.label), 40), key = A().effects.slug(label, { ...app.rules().conditions, ...L.statuses });
        return void store.apply('library-status-dup', atLibrary(l => saveStatus(l, key, { ...def, label })));
      }
      if ((a === 'del' || a === 'reset') && def) {
        const ok = a === 'reset'
          ? await ui.confirm({ title: `Reset ${def.label || id}?`, body: `Restores the built-in ${BUILT_IN_STATUSES[id].label}. Statuses already applied keep the version they have.`, danger: true, confirmLabel: 'Reset' })
          : await ui.confirm({ title: `Delete ${def.label || id}?`, body: 'Removes it from the pickers. Statuses already applied keep working.', danger: true, confirmLabel: 'Delete' });
        if (ok) store.apply('library-status-del', atLibrary(l => removeStatus(l, id)));
      }
      return;
    }
    if (kind === 'feat') {
      if (a === 'new' || a === 'edit') return void await featMaker(app, a === 'new' ? null : id);
      const d = L.feats[id] || (BUILT_IN_FEATS.find(([k]) => k === id) || [])[1];
      if (!d) return;
      if (a === 'off') return void store.apply('library-feat-off', atLibrary(l => saveFeat(l, id, { ...d, off: true })));
      if (a === 'dup') {
        const name = copyName(d.name, Object.values(L.feats).map(x => x.name), 60), key = freeFeatKey(name, k => Object.hasOwn(L.feats, k) || isBuiltInFeat(k));
        const done = store.apply('library-feat-dup', atLibrary(l => saveFeat(l, key, { ...d, name })));
        if (!done.ok) ui.toast('Workshop', `The library holds ${LIMITS.libraryFeats} feats at most.`, { kind: 'warning' });
        return;
      }
      if (a === 'reset' && await ui.confirm({ title: `Reset ${d.name}?`, body: 'Restores the built-in feat as it shipped. What hunters have counted toward it stays.', danger: true, confirmLabel: 'Reset' })) store.apply('library-feat-reset', atLibrary(l => removeFeat(l, id)));
      if (a === 'del' && await ui.confirm({ title: `Delete ${d.name}?`, body: 'Nothing counts toward it any more. A hunter who earned it keeps it.', danger: true, confirmLabel: 'Delete' })) store.apply('library-feat-del', atLibrary(l => removeFeat(l, id)));
      return;
    }
    if (kind === 'item') {
      const it = L.items.find(x => x.id === id);
      if (a === 'new') return void await A().loot.item({});
      if (!it) return;
      if (a === 'edit') return void await A().loot.item({ initial: it });
      if (a === 'dup') return void dup('items', it, 'i', 60, LIMITS.libraryItems);
      if (a === 'del' && await ui.confirm({ title: 'Delete from library?', body: it.name, danger: true, confirmLabel: 'Delete' })) store.apply('library-del', atLibrary(l => removeEntry(l, 'items', id)));
      return;
    }
    if (kind === 'skill') {
      const k = L.skills.find(x => x.id === id);
      if (a === 'new') return void await A().skills.make({ give: [] });
      if (!k) return;
      if (a === 'edit') return void await A().skills.make({ initial: k });
      if (a === 'give') return void await A().skills.give(k);
      if (a === 'dup') return void dup('skills', k, 's', 60, LIMITS.librarySkills);
      if (a === 'del' && await ui.confirm({ title: 'Delete from library?', body: `${k.name}. Hunters and monsters who have it keep it.`, danger: true, confirmLabel: 'Delete' })) store.apply('library-skill-del', atLibrary(l => removeEntry(l, 'skills', id)));
      return;
    }
    if (kind === 'bundle') {
      const b = A().bundles.list().find(x => x.id === id);
      if (a === 'new') return void await bundleMaker(app, null);
      if (!b) return;
      if (a === 'award') return A().award.open(b.rewards, b.id);
      if (a === 'edit') return void await bundleMaker(app, b);
      if (a === 'dup') {
        if (L.rewards.length >= LIMITS.libraryRewards) return void ui.toast('Workshop', `The library holds ${LIMITS.libraryRewards} bundles at most.`, { kind: 'warning' });
        return void A().bundles.save(copyName(b.name, L.rewards.map(x => x.name), 60), b.rewards, null, b.window || null);
      }
      if (a === 'del' && await ui.confirm({ title: 'Delete bundle?', body: `${b.name}. Rewards already given from it stay given.`, danger: true, confirmLabel: 'Delete' })) A().bundles.remove(b.id);
      return;
    }
    if (kind === 'map') {
      const mp = L.maps.find(x => x.id === id);
      if (a === 'new') return void await A().maps.make(null);
      if (!mp) return;
      if (a === 'edit') return void await A().maps.make(mp);
      if (a === 'dup') return void dup('maps', mp, 'mp', 40, LIMITS.libraryMaps);
      if (a === 'del' && await ui.confirm({ title: 'Delete map?', body: `${mp.name}. A gate that names it fights on the open arena.`, danger: true, confirmLabel: 'Delete' })) A().maps.remove(mp.id);
      return;
    }
    const B = A().bestiary, m = id ? B.get(id) : null;
    if (a === 'new') return void await B.make(null);
    if (!m) return;
    if (a === 'edit') return void await B.make(m);
    if (a === 'dup') return void B.save({ ...m, name: copyName(m.name, store.get().monsters.map(x => x.name), 60) }, true);
    if (a === 'del' && await ui.confirm({ title: 'Delete monster?', body: m.name, danger: true, confirmLabel: 'Delete' })) B.remove(m.id);
  }
  /** A copy of a library entry under a new id and "(copy)" after its name; nothing at the cap, with a toast that says so. */
  function dup(list, x, prefix, n, cap) {
    const newId = store.id(prefix);
    const done = store.apply(`library-${list}-dup`, atLibrary(l => duplicateEntry(l, list, x.id, { newId, name: copyName(x.name, l[list].map(e => e.name), n) })));
    if ('why' in done && done.why === 'full') ui.toast('Workshop', `The library holds ${cap} of these at most.`, { kind: 'warning' });
  }

  app.registerView({
    id: 'workshop', label: 'Workshop', icon: '⚒', order: 62, gmOnly: true,
    mount(el) {
      el.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-bestiary')) { app.go('bestiary'); return; }
        if (b.hasAttribute('data-share-all')) { void A().share.open(); return; }
        const kind = b.closest('[data-ws]') && b.closest('[data-ws]').dataset.ws; if (!kind) return;
        const li = b.closest('li'), id = li ? li.dataset.id : null;
        if (b.dataset.act === 'more' && li) { void more(kind, li); return; }
        if (b.dataset.act === 'example' && li) { copyExample(kind, id); return; }
        void act(kind, b.hasAttribute('data-new') ? 'new' : b.dataset.act, id);
      });
    },
    update(el) {
      const html = '<div class="ws-top"><h2>Workshop</h2><button type="button" data-share-all>Share custom content</button></div>' + KINDS.map(sectionHtml).join('');
      if (el.dataset.sig === html) return;
      // keep the built-in and example folds open across a redraw
      const open = [...el.querySelectorAll('.ws-fold')].map(f => f.hasAttribute('open'));
      el.dataset.sig = html; el.innerHTML = html;
      el.querySelectorAll('.ws-fold').forEach((f, i) => { if (open[i]) f.setAttribute('open', ''); });
    },
  });
}

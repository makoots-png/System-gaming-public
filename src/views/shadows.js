// shadows.js (U10): shadow extraction and army. Publishes app.api.shadows {canExtract, extract}. A shadow's body is a
// monster's of its rank, archetype and grade (`shadowSheet` in src/core/combat/rows.ts); the army's size is the hunter's
// sheet's `shadows`, and the extraction roll is a Presence check.
import { canExtract as canExtractJob, RANKS } from '../edge/rules.ts';
import { shadowSheet } from '../core/combat/rows.ts';
import { ARCHETYPE_LIST, MONSTER_KINDS } from '../core/registry/monsters.ts';
import { oneOf } from '../core/one-of.ts';
import { armyCap, can, extractDc, extractOutcome, healShadow, noteShadow, renameShadow, risesAs, shadowRises, shadowState, stepShadow } from '../core/hunter/shadows.ts';
import { monsterId } from '../core/gates/gate.ts';
import { atHunter } from '../core/save-step.ts';

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui, rules } = app; const { esc } = ui;
  const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
  const A = () => app.api;
  const canExtract = h => !!h && canExtractJob(rules(), h.job);
  const cap = h => armyCap(h, rules());
  const summonCost = s => int(rules().shadow.summonMp[s.rank]);
  const dcFor = (h, c) => extractDc(h.rank, c.rank, c.kind, rules().shadow);
  const hpMaxOf = s => shadowSheet(s, rules()).hpMax;

  /** What a shadow of the monster `m` (an `ExtractTarget`'s body) is made from, under the monster's name. */
  const originOf = m => ({ rank: oneOf(m.rank, RANKS, 'E'), archetype: oneOf(m.archetype, ARCHETYPE_LIST, 'brute'), grade: risesAs(oneOf(m.kind, MONSTER_KINDS, 'normal')),
    monster: m.monster ? monsterId(m.monster) : null, name: String(m.name || '') });
  /** The step that puts a shadow of `origin` in hunter `hid`'s army under `id`, with its log line (core `shadowRises`). */
  const joined = (hid, origin, id) => s => shadowRises(s, hid, origin, id, { at: new Date().toISOString(), cap: rules().logCap }, rules());
  /** The hunter a fight row holds: this phone's, or a player's as the room's parser read its sheet (the GM's phone only). */
  const hunterOf = who => (who.kind === 'local' ? store.hunter(who.hunterId) : (A().sync.remoteSheets().find(x => x.key === who.remote) || {}).data || null);
  /** A change to one shadow of hunter `hid`. */
  const onArmy = (hid, why, step) => store.apply(why, atHunter(hid, step));

  /**
   * The ARISE window for shadow `made`, already in the army under the monster's name (so a page left in the window keeps
   * it): a name typed there renames it.
   */
  async function arise(h, made) {
    const name = await ui.system({ tag: '! ARISE', title: 'ARISE', kind: 'arise', body: `${made.name} rises as your shadow. Name it.`,
      form: { label: 'Shadow name', type: 'text', value: made.name, maxlength: 60 }, actions: [{ label: 'Arise', primary: true }] });
    if (typeof name === 'string' && name.trim() && name.trim() !== made.name) ui.wrote('ARISE', onArmy(h.id, 'shadow-name', x => renameShadow(x, made.id, name)));
    const s = store.hunter(h.id)?.shadows.find(x => x.id === made.id) ?? made;
    ui.toast('ARISE', `${s.name} joins your army.`, { kind: 'levelup' });
    return s;
  }

  async function extract(who, c) {
    const h = hunterOf(who); const R = rules().shadow;
    if (!h || !c || !c.down) return null;
    if (!canExtract(h)) { ui.toast('System', `${h.name} cannot extract shadows.`, { kind: 'warning' }); return null; }
    if (c.extractable === false) { ui.toast('System', `${c.name} cannot be extracted.`, { kind: 'warning' }); return null; }
    const left = int(c.left), tried = R.maxAttempts - left;
    if (left <= 0) { ui.toast('System', 'No attempts left on this corpse.', { kind: 'warning' }); return null; }
    if (h.shadows.length >= cap(h)) { ui.toast('System', `Army is full (${h.shadows.length} / ${cap(h)}). Release a shadow first.`, { kind: 'warning' }); return null; }
    const m = c, dc = dcFor(h, m), bonus = A().hunter.sheet(h).checks.bonus.pre;
    const go = await ui.system({ tag: '! Extraction', title: 'Shadow Extraction', kind: 'arise', body: `Target: ${m.name} (${m.rank}-rank${m.kind === 'boss' ? ' boss' : ''}).`,
      lines: [`DC ${dc}`, `Roll: d20 ${bonus >= 0 ? '+' : '−'}${Math.abs(bonus)} (Presence check)`, `Attempt ${tried + 1} of ${R.maxAttempts}`],
      actions: [{ label: 'Cancel', value: false, cancel: true }, { label: 'Extract', value: true, primary: true }] });
    if (!go) return null;
    // a player's hunter rolls on the GM's phone with its own sheet's bonus; the roll is the GM's, not a hunter of this phone's
    const r = A().dice.roll(`1d20${bonus >= 0 ? '+' : '-'}${Math.abs(bonus)}`, { label: `Extract ${m.name}`, ...(who.kind === 'local' ? { hid: h.id } : {}) });
    const outcome = extractOutcome(r, dc);
    // the outcome is kept on the corpse's fight row, and a risen shadow joins the army in the same write: this phone's
    // hunter's at once, a player's through the room's `shadow` message posted in that write
    const origin = outcome === 'risen' ? originOf(m) : null, id = origin && who.kind === 'local' ? store.id('sh') : null;
    const event = origin && who.kind === 'remote' ? A().sync.event('shadow', { to: [who.remote], shadow: origin }) : null;
    if (origin && who.kind === 'remote' && !event) return null;
    const rose = !origin ? null : who.kind === 'local' ? { kind: /** @type {const} */ ('local'), step: joined(h.id, origin, id) } : { kind: /** @type {const} */ ('remote'), event };
    if (!ui.wrote('! Extraction', A().combat.extracted(c.id, c.by, outcome, rose))) return null;
    if (origin && who.kind === 'local') return arise(h, store.hunter(h.id).shadows.find(s => s.id === id));
    if (origin) { ui.toast('ARISE', `${origin.name} rises for ${h.name}. It joins their army on their phone.`, { kind: 'levelup' }); return origin; }
    if (outcome === 'crumbled') {
      await ui.warn({ tag: 'Shadow extraction', title: 'Extraction failed', body: `Natural 1. ${m.name}'s corpse is destroyed and cannot be extracted.`, lines: [`Rolled ${r.total} vs DC ${dc}`] });
      return null;
    }
    const still = left - 1;
    await ui.warn({ tag: 'Shadow extraction', title: 'Extraction failed', body: still > 0 ? `${still} attempt${still === 1 ? '' : 's'} left.` : 'No attempts left.', lines: [`Rolled ${r.total} vs DC ${dc}`] });
    return null;
  }

  // GM: grant a bestiary monster directly as a shadow (no roll)
  async function grant(hid, monsterId) {
    const h = store.hunter(hid), b = A().bestiary.get(monsterId);
    if (!h || !b) return null;
    if (h.shadows.length >= cap(h)) { ui.toast('System', `Army is full (${h.shadows.length} / ${cap(h)}).`, { kind: 'warning' }); return null; }
    const id = store.id('sh');
    if (!ui.wrote('System', store.apply('shadow-add', joined(h.id, originOf({ name: b.name, rank: b.rank, archetype: b.archetype, kind: b.kind, monster: b.id }), id)))) return null;
    return arise(h, store.hunter(h.id).shadows.find(s => s.id === id));
  }

  function summon(hid, sid) {
    const h = store.hunter(hid), s = h && h.shadows.find(x => x.id === sid); if (!s) return false;
    if (can(h, sid, { kind: 'dismiss' })) return ui.wrote('System', onArmy(hid, 'shadow-unsummon', x => stepShadow(x, sid, { kind: 'dismiss' })));
    if (!can(h, sid, { kind: 'summon' })) return false;
    // the mana (where it lives: the fight's row or the sheet) and the summon are one write, so a summon refused costs nothing
    const cost = summonCost(s);
    return ui.wrote('System', A().hunter.spendMana(hid, cost, x => stepShadow(x, sid, { kind: 'summon' })), { mana: `Not enough mana to summon ${s.name} (${cost} mana).` });
  }

  A().shadows = { canExtract, extract };

  ui.css('shadows', `
.sh-bar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin:4px 0 12px}
.sh-cap{font-family:var(--font-display);font-size:22px;color:var(--purple);text-shadow:0 0 12px rgba(160,100,255,.5)}
.sh-cap.full{color:var(--amber,#ffc94d)}
.sh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;list-style:none;margin:0;padding:0}
.sh-card{border:1px solid var(--line);background:var(--panel-solid);padding:10px;display:flex;flex-direction:column;gap:6px;min-width:0}
.sh-card.on{border-color:var(--purple);box-shadow:0 0 12px rgba(160,100,255,.35)}
.sh-card h3{margin:0;font-size:16px;overflow-wrap:anywhere}
.sh-meta{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:13px;color:var(--muted)}
.sh-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.sh-row .grow{flex:1 1 120px}
.sh-card textarea{width:100%;min-height:56px;resize:vertical}
`);

  function rosterHtml(h) {
    const on = s => shadowState(h, s.id).at === 'summoned';
    const used = h.shadows.length, c = cap(h), summoned = h.shadows.filter(on);
    const total = summoned.reduce((a, s) => a + summonCost(s), 0);
    const cards = h.shadows.map(s => `<li class="sh-card${on(s) ? ' on' : ''}" data-sid="${esc(s.id)}">
      <h3>${esc(s.name)}</h3>
      <div class="sh-meta">${ui.rankBadge(s.rank)}<span>${esc(s.grade)}</span><span>${esc(s.archetype ? s.archetype[0].toUpperCase() + s.archetype.slice(1) : '')}</span><span>HP ${int(s.hp)} / ${hpMaxOf(s)}</span><span>Summon ${summonCost(s)} mana</span></div>
      <div class="sh-row"><button type="button" class="${on(s) ? '' : 'primary'}" data-act="summon" aria-pressed="${on(s)}"${!on(s) && !can(h, s.id, { kind: 'summon' }) ? ' disabled title="Cannot summon at 0 HP. Tap Heal to full first."' : ''}>${on(s) ? 'Unsummon' : 'Summon'}</button>
        <button type="button" data-act="rename">Rename</button><button type="button" data-act="heal">Heal to full</button></div>
      <div class="sh-row"><button type="button" class="danger grow" data-act="release">Release</button></div>
      <label class="field"><span class="lbl">Notes</span><textarea data-notes maxlength="500">${esc(s.notes)}</textarea></label></li>`).join('');
    return `<div class="sh-bar"><span class="sh-cap${used >= c ? ' full' : ''}" aria-label="Army capacity">${used} / ${c}</span><span>Summoned: ${summoned.length} · Mana spent to summon: ${total} · Current mana: ${int(A().hunter.sheet(h).mana)}</span></div>
      ${used ? `<ul class="sh-grid" aria-label="Shadow army">${cards}</ul>` : '<p class="empty">No shadows yet. Defeat a monster in a fight, then tap Extract.</p>'}`;
  }

  app.registerView({
    id: 'shadows', label: 'Shadows', icon: '☽', order: 50, when: () => app.isGM() || canExtract(store.active()) || store.active().shadows.length > 0, // a hunter the GM granted one sees its army too
    mount(el) {
      el.innerHTML = `<section class="win"><span class="cb"></span><h2>Shadow Army</h2><div data-shroster></div></section>
        <section class="win" data-shgm hidden><span class="cb"></span><h2>Grant a shadow (GM)</h2><p class="hint">Adds a bestiary monster to the active hunter's army without a roll.</p>
          <div class="sh-row"><label class="field grow"><span class="lbl">Monster</span><select data-shmsel></select></label><button type="button" class="primary" data-shgrant>Grant shadow</button></div></section>`;
      el.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        const h = store.active();
        if (b.hasAttribute('data-shgrant')) { const sel = el.querySelector('[data-shmsel]'); if (sel.value) await grant(h.id, sel.value); return; }
        const card = b.closest('[data-sid]'), act = b.dataset.act; if (!card || !act) return;
        const s = h.shadows.find(x => x.id === card.dataset.sid); if (!s) return;
        if (act === 'summon') return void summon(h.id, s.id);
        if (act === 'heal') return void ui.wrote('System', onArmy(h.id, 'shadow-heal', x => healShadow(x, s.id, rules())));
        if (act === 'rename') { const n = await ui.promptText({ title: 'Rename shadow', label: 'Name', value: s.name }); if (n) ui.wrote('System', onArmy(h.id, 'shadow-rename', x => renameShadow(x, s.id, n))); return; }
        if (act === 'release' && await ui.confirm({ title: 'Release shadow?', body: `${s.name} leaves your army. You cannot undo releasing a shadow.`, danger: true, confirmLabel: 'Release shadow' })) {
          ui.wrote('System', onArmy(h.id, 'shadow-release', x => stepShadow(x, s.id, { kind: 'release' })));
        }
      });
      el.addEventListener('change', e => {
        if (!e.target.matches('[data-notes]')) return;
        const s = store.active().shadows.find(x => x.id === e.target.closest('[data-sid]').dataset.sid);
        if (s) ui.wrote('System', onArmy(store.active().id, 'shadow-notes', x => noteShadow(x, s.id, e.target.value)));
      });
      this.update(el);
    },
    update(el) {
      const ae = document.activeElement; if (ae && ae.matches && ae.matches('textarea[data-notes]') && el.contains(ae)) return;
      const keep = ae && el.contains(ae) && ae.closest('[data-sid]') ? { sid: ae.closest('[data-sid]').dataset.sid, act: ae.dataset.act } : null;
      el.querySelector('[data-shroster]').innerHTML = rosterHtml(store.active());
      if (keep && keep.act) { const n = el.querySelector(`[data-sid="${CSS.escape(keep.sid)}"] [data-act="${keep.act}"]`); if (n) n.focus(); }
      const gm = el.querySelector('[data-shgm]'); gm.hidden = !app.isGM();
      const sel = el.querySelector('[data-shmsel]');
      if (!gm.hidden && A().bestiary) {
        const list = A().bestiary.list().filter(m => m.extractable !== false), v = sel.value;
        const sig = list.map(m => m.id).join();
        if (sel.dataset.sig !== sig) { sel.innerHTML = list.map(m => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.rank)})</option>`).join(''); sel.dataset.sig = sig; if (v) sel.value = v; }
      }
    },
  });
}

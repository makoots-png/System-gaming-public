// reward-editor.js: the reward editor, app.api.maker.rewards. One component the GM's Award form (gm.js), the quest form
// (quests.js) and the Workshop's bundle maker (workshop.js) embed. It edits a whole `Rewards` (src/core/rewards.ts): XP,
// gold and points in one row, then a row per part (an item, a title, a skill, a status, a boon, a job) added by its chip,
// a Bundle row that loads a saved bundle and saves the editor as one (app.api.bundles), and a live preview of the reward
// window's lines (`grantLines`). Its answer is what `parseRewards` reads, so it passes the parser unchanged.
import { esc, field } from './ui.js';
import { rewardJobs, rules } from '../edge/rules.ts';
import { REPLACES_WORDS, REWARD_BOUNDS, WORDS_BOUNDS, grantLines, isEmptyReward, newRewards, parseRewards, parseWords } from '../core/rewards.ts';
import { LIMITS } from '../core/save.ts';
import { ITEM_BOUNDS, parseItem } from '../core/registry/items.ts';
import { SKILL_SEEDS, parseSkill, skillOf } from '../core/registry/skills.ts';
import { isStateChip } from '../core/hunter/chips.ts';

const ADD = [['item', 'Item'], ['title', 'Title'], ['skill', 'Skill'], ['status', 'Status'], ['boon', 'Boon'], ['job', 'Job']];
const CAP = { item: REWARD_BOUNDS.items, skill: REWARD_BOUNDS.skills, status: REWARD_BOUNDS.statuses, boon: REWARD_BOUNDS.boons, title: 1, job: 1 };
const NEW = '__new';
const int = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : 0; };
/** Keys sorted, so two rewards compare by what they hold. */
const canon = v => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/**
 * The reward editor in `box`. `id` names the three number fields (`<id>-xp`, `<id>-gold`, `<id>-pts`); `floor` keeps
 * them at 0 or more (a quest's reward); `bundles: false` leaves out the Bundle row (the bundle maker names its own).
 * @param {import('./app.ts').App} app @param {HTMLElement} box
 * @param {{ initial?: unknown; id?: string; floor?: boolean; bundles?: boolean }} [o]
 * @returns {import('../core/api.ts').RewardEditor}
 */
export function rewardEditor(app, box, o = {}) {
  const { store, ui } = app;
  const id = o.id || 'rw' + Math.random().toString(36).slice(2, 7), withBundles = o.bundles !== false;
  /** @type {any[]} the part rows, in the order the GM added them */
  let rows = [];
  let nums = { xp: 0, gold: 0, points: 0 };
  let say = { text: '', bad: false };

  // ── the lists a row picks from ──
  const libItems = () => store.get().library.items;
  const shopItems = () => app.api.inventory.shop();
  const tplItems = () => app.api.inventory.itemTemplates();
  const libSkills = () => store.get().library.skills;
  const statusKeys = () => Object.keys(rules().conditions).filter(k => !isStateChip(k));
  const bundleList = () => app.api.bundles.list();
  const opt = (v, l, on = false) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(l)}</option>`;
  const group = (label, list) => (list.length ? `<optgroup label="${esc(label)}">${list.join('')}</optgroup>` : '');

  // ── a row from a part of a reward, and back ──
  const rowsOf = rw => [
    ...rw.items.map(item => ({ kind: 'item', item })),
    ...(rw.title ? [{ kind: 'title', pick: rw.title.key || '', name: rw.title.name, desc: rw.title.desc, replaces: rw.title.replaces || '', bonus: { ...rw.title.bonus } }] : []),
    ...rw.skills.map(skill => ({ kind: 'skill', skill })),
    ...rw.statuses.map(s => ({ kind: 'status', key: s.key, rounds: s.rounds ? String(s.rounds) : '', def: s.def || null })),
    ...rw.boons.map(b => ({ kind: 'boon', name: b.name, text: b.text })),
    ...(rw.job ? [{ kind: 'job', job: rw.job }] : []),
  ];
  function blank(kind) {
    if (kind === 'item') return { kind, item: null };
    if (kind === 'title') return { kind, pick: '', name: '', desc: '', replaces: '', bonus: {} };
    if (kind === 'skill') return { kind, skill: null };
    if (kind === 'status') { const k = statusKeys()[0] || ''; return { kind, key: k, rounds: '3', def: null }; }
    if (kind === 'boon') return { kind, name: '', text: '' };
    return { kind, job: '' };
  }
  /** What the editor holds, before the parser reads it. */
  function raw() {
    const floor = n => (o.floor ? Math.max(0, n) : n);
    const by = k => rows.filter(r => r.kind === k);
    const t = by('title')[0], j = by('job')[0];
    return {
      xp: floor(nums.xp), points: floor(nums.points), gold: floor(nums.gold),
      items: by('item').filter(r => r.item).map(r => r.item),
      // a title in place of itself is that title (rewards.ts `title`)
      title: t && t.name.trim() ? { name: t.name.trim(), desc: t.desc, bonus: t.bonus, ...(t.pick ? { key: t.pick } : {}), ...(t.replaces.trim() && t.replaces.trim() !== t.name.trim() ? { replaces: t.replaces.trim() } : {}) } : null,
      job: j && j.job.trim() ? j.job.trim() : null,
      skills: by('skill').filter(r => r.skill).map(r => r.skill),
      statuses: by('status').filter(r => r.key).map(r => {
        const n = int(r.rounds);
        return { key: r.key, rounds: n > 0 ? n : null, def: r.def || rules().conditions[r.key] };
      }),
      boons: by('boon').filter(r => r.name.trim()).map(r => ({ name: r.name.trim(), text: r.text })),
    };
  }
  /** Why a row cannot be saved yet, or ''. */
  function rowErr(r) {
    if (r.kind === 'item' && !r.item) return 'Pick an item, or remove the row.';
    if (r.kind === 'skill' && !r.skill) return 'Pick a skill, or remove the row.';
    if (r.kind === 'title' && !r.name.trim()) return 'Name the title, or remove the row.';
    if (r.kind === 'boon' && !r.name.trim()) return 'Name the boon, or remove the row.';
    if (r.kind === 'job' && !r.job.trim()) return 'Name the job, or remove the row.';
    if (r.kind === 'status' && r.rounds.trim() !== '' && !(int(r.rounds) >= 1 && int(r.rounds) <= REWARD_BOUNDS.rounds)) return `Rounds go from 1 to ${REWARD_BOUNDS.rounds}. Leave it empty for until removed.`;
    return '';
  }
  function value() {
    const r = raw(), rw = parseRewards(r) || newRewards();
    if (canon(rw) !== canon(r)) console.error('reward editor: the form holds a reward the parser reads differently', r, rw);
    return rw;
  }

  // ── drawing ──
  const itemPicker = i => `<select data-f="pick" aria-label="Item ${i + 1}">${opt('', 'Pick an item', true)}
    ${group('Library', libItems().map((t, n) => opt(`L:${n}`, `${t.name} (${t.rar})`)))}${group('Shop', shopItems().map((t, n) => opt(`S:${n}`, `${t.name} (${t.rar})`)))}
    ${group('Built-in', tplItems().map((t, n) => opt(`T:${n}`, `${t.name} (${t.rar})`)))}${opt(NEW, 'New item…')}</select>`;
  const skillPicker = i => `<select data-f="pick" aria-label="Skill ${i + 1}">${opt('', 'Pick a skill', true)}
    ${group('Built-in', SKILL_SEEDS.map((s, n) => opt(`B:${n}`, `${s.name} (${s.type})`)))}${group('Library', libSkills().map((s, n) => opt(`L:${n}`, `${s.name} (${s.type})`)))}${opt(NEW, 'New skill…')}</select>`;
  const itemMeta = it => [it.type, ...app.api.effects.describeItem({ id: '', ...it })].filter(Boolean).join(' · ');
  const skillMeta = k => app.api.skills.lines(k).join(' · ');
  const rm = what => `<button type="button" class="icon-btn" data-rm aria-label="Remove ${esc(what)}">&times;</button>`;
  function rowHtml(r, i) {
    let body = '', head = '';
    if (r.kind === 'item') {
      head = r.item ? `<span class="rw-nm">Item: ${esc(r.item.name)} <span class="rw-tag">${esc(r.item.rar)}</span></span>` : '<span class="rw-nm">Item</span>';
      body = !r.item ? itemPicker(i) : `<div class="rw-meta">${esc(itemMeta(r.item))}</div>
        <div class="rw-two">${field('Qty', `<input type="number" min="1" max="${ITEM_BOUNDS.qty}" step="1" inputmode="numeric" data-f="qty" value="${esc(r.item.qty)}">`)}
        <label class="rw-chk"><input type="checkbox" data-f="tell"${r.item.tell ? ' checked' : ''}><span>Tell me when used</span></label></div>`;
    } else if (r.kind === 'skill') {
      head = r.skill ? `<span class="rw-nm">Skill: ${esc(r.skill.name)} <span class="rw-tag">${esc(r.skill.type)}</span></span>` : '<span class="rw-nm">Skill</span>';
      body = r.skill ? `<div class="rw-meta">${esc(skillMeta(r.skill))}</div>` : skillPicker(i);
    } else if (r.kind === 'title') {
      head = '<span class="rw-nm">Title</span>';
      body = `<select data-f="tpick" aria-label="Title">${opt('', 'A new title', !r.pick)}${group('Built-in', rules().titles.map(t => opt(t.key, t.name, r.pick === t.key)))}</select>
        ${field('Title name', `<input type="text" maxlength="${REWARD_BOUNDS.title}" autocomplete="off" data-f="name" value="${esc(r.name)}">`)}
        ${field('Description', `<input type="text" maxlength="${REWARD_BOUNDS.titleDesc}" autocomplete="off" data-f="desc" value="${esc(r.desc)}">`)}
        ${field(REPLACES_WORDS.label, `<input type="text" maxlength="${REWARD_BOUNDS.title}" autocomplete="off" data-f="replaces" value="${esc(r.replaces)}">`)}
        <p class="rw-hint">${esc(REPLACES_WORDS.hint)}</p>
        <div class="lbl">Bonus while the title is active</div><div data-tbonus>${app.api.maker.bonus(r.bonus)}</div>`;
    } else if (r.kind === 'status') {
      const keys = statusKeys(); if (r.key && !keys.includes(r.key)) keys.push(r.key);
      const label = k => String((rules().conditions[k] && rules().conditions[k].label) || (r.def && r.key === k && r.def.label) || k);
      head = '<span class="rw-nm">Status</span>';
      body = `<div class="rw-two"><select data-f="key" aria-label="Status ${i + 1}">${keys.map(k => opt(k, label(k), k === r.key)).join('')}</select>
        <input type="number" min="1" max="${REWARD_BOUNDS.rounds}" step="1" inputmode="numeric" data-f="rounds" aria-label="Rounds of status ${i + 1}" placeholder="Rounds (∞)" value="${esc(r.rounds)}"></div>`;
    } else if (r.kind === 'boon') {
      head = '<span class="rw-nm">Boon</span>';
      body = `${field('Boon name', `<input type="text" maxlength="${REWARD_BOUNDS.boonName}" autocomplete="off" data-f="name" value="${esc(r.name)}">`)}
        ${field('What it gives', `<textarea rows="2" maxlength="${REWARD_BOUNDS.boonText}" data-f="text">${esc(r.text)}</textarea>`)}
        <p class="rw-hint">The player redeems it from their sheet, and you are told.</p>`;
    } else {
      head = '<span class="rw-nm">Job</span>';
      body = field('Job', `<input type="text" maxlength="${REWARD_BOUNDS.job}" autocomplete="off" data-f="job" data-rw-job list="${esc(id)}-jobs" value="${esc(r.job)}">`);
    }
    return `<div class="rw-row" data-row="${i}" data-kind="${r.kind}"><div class="rw-top">${head}${rm(r.kind)}</div>${body}<p class="rw-err" data-err role="alert"></p></div>`;
  }
  function bundleRow() {
    if (!withBundles) return '';
    const list = bundleList();
    return `<div class="rw-bundle">${field('Bundle', `<select data-rw-bundle>${opt('', list.length ? 'Choose a bundle…' : 'No bundles yet')}${list.map(b => opt(b.id, b.name)).join('')}</select>`)}
      <button type="button" data-rw-save>Save as bundle…</button></div>`;
  }
  const count = k => rows.filter(r => r.kind === k).length;
  /** Why the Add chip of `k` is off: the reward holds as many as it may. */
  const full = (k, l) => CAP[k] === 1 ? `One ${l.toLowerCase()} per reward.` : `At most ${CAP[k]} ${k === 'status' ? 'statuses' : l.toLowerCase() + 's'} per reward.`;
  function render(focus) {
    const was = withBundles ? box.querySelector('[data-rw-bundle]') : null, pick = was ? was.value : '';
    box.innerHTML = `<div class="rw">${bundleRow()}
      <div class="rw-nums">${field('XP', `<input type="number" step="1" inputmode="numeric" id="${esc(id)}-xp" data-n="xp" placeholder="0" value="${nums.xp || ''}">`)}
        ${field('Gold', `<input type="number" step="1" inputmode="numeric" id="${esc(id)}-gold" data-n="gold" placeholder="0" value="${nums.gold || ''}">`)}
        ${field('Points', `<input type="number" step="1" inputmode="numeric" id="${esc(id)}-pts" data-n="points" placeholder="0" value="${nums.points || ''}">`)}</div>
      <div class="rw-rows">${rows.map(rowHtml).join('')}</div>
      <div class="rw-add" role="group" aria-label="Add to the reward"><span class="lbl">Add</span>${ADD.map(([k, l]) => `<button type="button" class="mk-chip" data-add="${k}"${count(k) >= CAP[k] ? ` disabled title="${esc(full(k, l))}"` : ''}>${l}</button>`).join('')}</div>
      ${ADD.some(([k]) => count(k) >= CAP[k]) ? `<p class="rw-hint" data-rw-full>${esc(ADD.filter(([k]) => count(k) >= CAP[k]).map(([k, l]) => full(k, l)).join(' '))}</p>` : ''}
      <datalist id="${esc(id)}-jobs">${rewardJobs(rules()).map(j => `<option value="${esc(j)}">`).join('')}</datalist>
      <div class="rw-preview" aria-live="polite"></div>
      <p class="rw-say" data-rw-say role="status"></p></div>`;
    if (withBundles && pick) { const s = box.querySelector('[data-rw-bundle]'); if (bundleList().some(b => b.id === pick)) s.value = pick; }
    rows.forEach((_, i) => mark(i));
    paint();
    if (focus !== undefined) { const f = box.querySelector(`[data-row="${focus}"] select, [data-row="${focus}"] input`); if (f) f.focus(); }
  }
  function mark(i) {
    const el = box.querySelector(`[data-row="${i}"]`); if (!el) return;
    const e = rowErr(rows[i]);
    el.querySelector('[data-err]').textContent = e; el.classList.toggle('bad', !!e);
  }
  /** The preview and the message line, redrawn on every change. */
  function paint() {
    const lines = grantLines(rules(), parseRewards(raw()) || newRewards()), p = box.querySelector('.rw-preview');
    if (p) p.innerHTML = `<div class="lbl">The player sees</div>${lines.length ? `<ul class="mk-lines">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="mk-none">Nothing yet.</p>'}`;
    const s = box.querySelector('[data-rw-say]'); if (s) { s.textContent = say.text; s.classList.toggle('bad', say.bad); }
  }
  const raise = () => box.dispatchEvent(new Event('input', { bubbles: true }));
  const tell = (text, bad = false) => { say = { text, bad }; paint(); };

  // ── what a row picks ──
  async function pickItem(i, v) {
    if (v === NEW) {
      const made = await app.api.loot.item({});
      if (made && rows[i]) rows[i].item = parseItem(made);
    } else {
      const [k, n] = v.split(':'), src = (k === 'L' ? libItems() : k === 'S' ? shopItems() : tplItems())[int(n)];
      if (src && rows[i]) { const { id: _drop, ...t } = /** @type {any} */ (src); rows[i].item = parseItem({ ...t, qty: k === 'L' ? t.qty || 1 : 1 }); }
    }
    render(); raise();
  }
  async function pickSkill(i, v) {
    if (v === NEW) {
      const made = await app.api.skills.make({});
      if (made && rows[i]) rows[i].skill = rewardSkill(made);
    } else {
      const [k, n] = v.split(':'), src = k === 'B' ? (SKILL_SEEDS[int(n)] ? skillOf(SKILL_SEEDS[int(n)], rules()) : null) : libSkills()[int(n)];
      if (src && rows[i]) rows[i].skill = rewardSkill(src);
    }
    render(); raise();
  }
  /** A skill as a reward carries it: through the parser, without the id it had. */
  const rewardSkill = s => { const { id: _drop, ...t } = s; return parseSkill(t); };

  async function saveBundle() {
    const rw = value();
    if (isEmptyReward(rw)) return tell('Add something to the reward before saving it as a bundle.', true);
    const name = await ui.promptText({ title: 'Save as bundle', label: 'Bundle name', value: '', maxlength: 60 });
    if (!name || !name.trim()) return;
    // saving again under a name the library holds replaces that bundle, after the GM says so (a bundle is saved by its id)
    const same = app.api.bundles.list().find(b => b.name.toLowerCase() === name.trim().toLowerCase());
    if (same && !await ui.confirm({ title: 'Replace bundle?', body: `A bundle named "${same.name}" is saved. Replace it with this reward?`, confirmLabel: 'Replace' })) return;
    const r = app.api.bundles.save(name, rw, same ? same.id : null);
    if (!r.ok) return tell('why' in r && r.why === 'full' ? `The bundle was not saved: the library holds ${LIMITS.libraryRewards} bundles at most.` : 'The bundle was not saved.', true);
    render(); const s = box.querySelector('[data-rw-bundle]'); if (s) s.value = r.id;
    tell(`Saved bundle "${name.trim().slice(0, 60)}".`);
  }
  function set(rw, bundleId) {
    const r = parseRewards(rw) || newRewards();
    nums = { xp: r.xp, gold: r.gold, points: r.points }; rows = rowsOf(r); say = { text: '', bad: false };
    render();
    const s = box.querySelector('[data-rw-bundle]'); if (s) s.value = bundleId && bundleList().some(b => b.id === bundleId) ? bundleId : '';
    raise();
  }

  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
    const rowEl = b.closest('[data-row]'), i = rowEl ? Number(rowEl.dataset.row) : -1;
    if (b.dataset.add) { const k = b.dataset.add; if (count(k) >= CAP[k]) return; rows.push(blank(k)); say = { text: '', bad: false }; render(rows.length - 1); raise(); return; }
    if (b.hasAttribute('data-rm')) { rows.splice(i, 1); render(); raise(); return; }
    if (b.hasAttribute('data-rw-save')) void saveBundle();
  });
  box.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-rw-bundle]')) { const bl = bundleList().find(x => x.id === t.value); if (bl) set(bl.rewards, bl.id); return; }
    const rowEl = t.closest && t.closest('[data-row]'); if (!rowEl) return;
    const i = Number(rowEl.dataset.row), r = rows[i];
    if (t.dataset.f === 'pick' && t.value) { void (r.kind === 'item' ? pickItem(i, t.value) : pickSkill(i, t.value)); return; }
    if (t.dataset.f === 'tpick') {
      // a rule title is picked by its key, which the reward carries so the hunter's title records it
      const seed = rules().titles.find(x => x.key === t.value);
      Object.assign(r, seed ? { pick: seed.key, name: seed.name, desc: seed.desc || '', bonus: { ...(seed.bonus || {}) } } : { pick: '', name: '', desc: '', bonus: {} });
      render(); raise(); return;
    }
    if (t.dataset.f === 'key') { r.key = t.value; r.def = null; }
    if (t.dataset.f === 'tell') { if (t.checked) r.item.tell = true; else delete r.item.tell; }
    mark(i); paint();
  });
  box.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.n) { const B = REWARD_BOUNDS[t.dataset.n]; nums[t.dataset.n] = Math.max(-B, Math.min(B, int(t.value))); paint(); return; }
    const rowEl = t.closest && t.closest('[data-row]'); if (!rowEl) return;
    const r = rows[Number(rowEl.dataset.row)]; if (!r) return;
    const f = t.dataset.f;
    if (r.kind === 'item' && f === 'qty') r.item.qty = Math.max(1, Math.min(ITEM_BOUNDS.qty, int(t.value) || 1));
    else if (r.kind === 'title' && t.dataset.bonus) r.bonus = Object.fromEntries(Object.entries(app.api.maker.readBonus(rowEl)).map(([k, n]) => [k, Math.max(-REWARD_BOUNDS.bonus, Math.min(REWARD_BOUNDS.bonus, n))]));
    else if (f === 'rounds' || f === 'name' || f === 'desc' || f === 'replaces' || f === 'text' || f === 'job') r[f] = t.value;
    if (r.kind === 'title' && (f === 'name' || f === 'desc' || t.dataset.bonus)) r.pick = '';
    mark(Number(rowEl.dataset.row)); paint();
  });

  const start = parseRewards(o.initial);
  if (start) { nums = { xp: start.xp, gold: start.gold, points: start.points }; rows = rowsOf(start); }
  render();

  return {
    value,
    set,
    blocked: () => rows.some(r => !!rowErr(r)),
    /** Draws the bundle select again when the bundles changed; nothing else moves. */
    refresh() {
      const s = box.querySelector('[data-rw-bundle]'); if (!s) return;
      const list = bundleList(), sig = list.map(b => b.id + b.name).join('|');
      if (s.dataset.sig === sig) return;
      const cur = s.value; s.dataset.sig = sig;
      s.innerHTML = opt('', list.length ? 'Choose a bundle…' : 'No bundles yet') + list.map(b => opt(b.id, b.name)).join('');
      s.value = list.some(b => b.id === cur) ? cur : '';
    },
    /** Adds an empty row of `kind` when there is none, and puts the cursor in it (the quest form's Job Change). */
    ensure(kind) {
      let i = rows.findIndex(r => r.kind === kind);
      if (i < 0) { rows.push(blank(kind)); i = rows.length - 1; render(i); raise(); }
      else { const f = box.querySelector(`[data-row="${i}"] input, [data-row="${i}"] select`); if (f) f.focus(); }
    },
    message: tell,
  };
}

/** The editor's look, once. @param {(id: string, text: string) => void} css */
export function rewardEditorCss(css) {
  css('reward-editor', `
.rw{display:flex;flex-direction:column;gap:8px;min-width:0}
.rw input[type=text],.rw input[type=number],.rw select,.rw textarea{width:100%;box-sizing:border-box;min-height:44px}
.rw-bundle{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}
.rw-bundle button{min-height:44px}
.rw-nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.rw-rows{display:flex;flex-direction:column;gap:8px}
.rw-row{display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);background:rgba(10,26,46,.55);padding:8px;min-width:0}
.rw-row.bad{border-color:var(--red)}
.rw-top{display:flex;align-items:center;gap:6px}.rw-nm{flex:1 1 auto;min-width:0;font-weight:600;overflow-wrap:anywhere}
.rw-tag{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--cyan-dim);font-weight:400}
.rw-meta,.rw-hint{margin:0;font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}
.rw-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:8px;align-items:end}
.rw-chk{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 10px;border:1px solid var(--line);cursor:pointer}
.rw-chk input{width:20px;height:20px;flex:0 0 auto;margin:0}
.rw-err{margin:0;font-size:13px;color:#ff8a96}.rw-err:empty{display:none}
.rw-add{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.rw-add .lbl{margin-right:4px}
.rw-preview{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:6px 10px}
.rw-say{margin:0;min-height:0;font-size:13px;color:var(--green)}.rw-say.bad{color:#ff8a96}.rw-say:empty{display:none}
.rw .mk-bonus{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}`);
}

/**
 * The bundle maker (the Workshop's New reward and Edit, the GM view's Make row): a name, the words of the window it is
 * given with (rewards.ts `SystemWords`, for the GM's awards for roleplay) and the reward editor, in a maker shell. Save
 * keeps the bundle under its name (the same name replaces, as everywhere); an edit that renames the bundle removes the
 * old one. Answers the bundle's id, or null.
 * @param {import('./app.ts').App} app
 * @param {{ id: string; name: string; rewards: import('../core/rewards.ts').Rewards; window?: import('../core/rewards.ts').SystemWords } | null} b
 */
export function bundleMaker(app, b) {
  const A = app.api;
  return A.maker.open({
    tag: 'Workshop', title: b ? 'Edit bundle' : 'New bundle', save: 'Save bundle', cls: 'rwm',
    build(body, shell) {
      const w = b && b.window ? b.window : { title: '', line: '' };
      body.innerHTML = `${field('Name', `<input type="text" id="rwm-name" maxlength="60" autocomplete="off" value="${esc(b ? b.name : '')}">`)}
        ${field('Window title', `<input type="text" id="rwm-wtitle" maxlength="${WORDS_BOUNDS.title}" autocomplete="off" placeholder="THE SYSTEM TOOK NOTE" value="${esc(w.title)}">`)}
        ${field('Window line', `<input type="text" id="rwm-wline" maxlength="${WORDS_BOUNDS.line}" autocomplete="off" placeholder="What the System says when it is given" value="${esc(w.line)}">`)}
        <p class="rw-hint">With a window title, the hunter sees these words when it is given, and the bundle may hold no reward.</p><div data-rwm-ed></div>`;
      const ed = A.maker.rewards(body.querySelector('[data-rwm-ed]'), { initial: b ? b.rewards : undefined, bundles: false });
      return {
        blocked: () => ed.blocked(),
        save() {
          const name = body.querySelector('#rwm-name').value.trim(), rw = ed.value();
          const words = parseWords({ title: body.querySelector('#rwm-wtitle').value, line: body.querySelector('#rwm-wline').value });
          if (!name) { shell.error('Name the bundle.'); return undefined; }
          if (isEmptyReward(rw) && !words) { shell.error('Add something to the reward, or a window title.'); return undefined; }
          // by its id: a rename is one write, and a name another reward holds is refused, never overwritten
          const saved = A.bundles.save(name, rw, b ? b.id : null, words);
          if (!saved.ok) { shell.error('why' in saved && saved.why === 'taken' ? `Another bundle is named "${name}". Choose another name.` : `The library holds ${LIMITS.libraryRewards} bundles at most.`); return undefined; }
          return saved.id;
        },
      };
    },
  });
}

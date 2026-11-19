// quest-fields.js: the one quest form, app.api.quests.fields (registered by quests.js). Its kind, title, description,
// objectives with their targets, due time, penalty text and reward (the reward editor), drawn in a box its caller owns.
// Three callers: the Quests view's New quest and Edit, the GM view's Issue quest, and a chapter's quest in the story maker
// (story-maker.js). What it shows follows from where it is used and who uses it (`use`, `role`); what it answers is the
// draft that `questOf` (src/core/hunter/quests.ts) and `parseChapterQuest` (src/core/story/story.ts) read. Each caller
// keeps what is its own: the Quests view's title line, Job Change preset and Assign to, the GM view's recipients, the story
// maker's "Issues a quest" box. No rule of the game is here.
import { esc, field } from './ui.js';
import { GM_QUEST_KINDS, questKindsFor } from '../core/hunter/quest-rights.ts';
import { UNFINISHED_ROWS, newRewards } from '../core/rewards.ts';

/** Each quest kind's word, on the form's Kind and on a quest's card. */
export const KIND_LABEL = { daily: 'Daily', main: 'Main', side: 'Side', job: 'Job Change', urgent: 'Urgent', penalty: 'Penalty' };

const pad = n => String(n).padStart(2, '0');
/** A time as a `datetime-local` field holds it, in this phone's zone. */
const toLocalInput = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/**
 * The quest form in `box`. `use`: `new` (a quest issued now), `edit` (a quest a hunter holds, `initial`) or `chapter` (a
 * quest written ahead, whose due time counts from when its chapter opens). `role`: the phone's. The GM's form has the
 * reward editor and the penalty text; a quest issued now or written ahead takes its due time in hours, an edit or a
 * player's own quest as a date and time for an urgent quest. `id` names the reward editor's number fields (`<id>-xp`).
 * @param {import('./app.ts').App} app @param {HTMLElement} box
 * @param {{ id: string; use: 'new' | 'edit' | 'chapter'; role: 'gm' | 'player'; initial?: any }} o
 * @returns {import('../core/api.ts').QuestFields}
 */
export function questFields(app, box, o) {
  const gm = o.role === 'gm', hours = gm && o.use !== 'edit', init = o.initial || null;
  const kinds = o.use === 'chapter' ? [...GM_QUEST_KINDS] : questKindsFor(o.role, o.use === 'edit' ? init : null);
  const fixedKind = o.use === 'edit' && !!init && init.kind === 'penalty';
  const dueLabel = o.use === 'chapter' ? 'Due in hours after the chapter opens (optional)' : 'Due in hours (optional)';
  box.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'qfx';
  root.innerHTML = `<div class="qfx-main">
      <div class="row"><span data-kindf${fixedKind ? ' hidden' : ''}>${field('Kind', `<select name="kind">${kinds.map(k => `<option value="${k}">${esc(KIND_LABEL[k] || k)}</option>`).join('')}</select>`)}</span>
        ${field('Title', `<input type="text" name="title" maxlength="120" autocomplete="off">`)}</div>
      ${field('Description', `<textarea name="desc" maxlength="500" rows="2"></textarea>`)}
      <fieldset><legend>Objectives</legend><div data-objs></div><button type="button" data-oadd>+ Add objective</button></fieldset>
      ${hours ? `<div class="row">${field(dueLabel, `<input type="number" name="dueHours" min="0" max="999" step="any" inputmode="decimal">`)}</div>`
        : `<div data-duef hidden>${field('Due (urgent quests fail after this)', '<input type="datetime-local" name="dueAt">')}</div>`}
      ${gm ? field('Penalty on failure', `<input type="text" name="penaltyText" maxlength="300" autocomplete="off">`) : ''}
    </div>${gm ? '<div class="qfx-rw"><fieldset><legend>Rewards</legend><div data-rweditor></div></fieldset></div>' : ''}`;
  box.appendChild(root);
  const $ = sel => root.querySelector(sel);
  const kindSel = $('[name=kind]'), titleIn = $('[name=title]'), descIn = $('[name=desc]'), objs = $('[data-objs]');
  const rewards = gm ? app.api.maker.rewards($('[data-rweditor]'), { id: o.id, floor: true }) : null;

  function addObjRow(ob = { label: '', target: 1, progress: 0 }) {
    objs.appendChild(app.ui.h(`<div class="objrow" data-progress="${esc(ob.progress)}"><span class="grow">${field('Objective', `<input type="text" name="olabel" maxlength="80" value="${esc(ob.label)}" autocomplete="off">`)}</span>
      <span class="sm">${field('Target', `<input type="number" name="otarget" min="1" max="99999" value="${esc(ob.target)}">`)}</span>
      <button type="button" class="danger" data-orm aria-label="Remove objective">&times;</button></div>`));
  }
  const syncKind = () => { const d = $('[data-duef]'); if (d) d.hidden = kindSel.value !== 'urgent'; };

  /** @param {any} d */
  function set(d) {
    if ('kind' in d) { kindSel.value = kinds.includes(d.kind) ? d.kind : 'side'; syncKind(); }
    if ('title' in d) titleIn.value = d.title || '';
    if ('desc' in d) descIn.value = d.desc || '';
    if ('objectives' in d) { objs.innerHTML = ''; (d.objectives && d.objectives.length ? d.objectives : [{ label: '', target: 1, progress: 0 }]).forEach(addObjRow); }
    if ('rewards' in d && rewards) rewards.set(d.rewards || newRewards());
    if ('penaltyText' in d && $('[name=penaltyText]')) $('[name=penaltyText]').value = d.penaltyText || '';
    if ('dueHours' in d && $('[name=dueHours]')) $('[name=dueHours]').value = d.dueHours ? String(d.dueHours) : '';
    if ('dueAt' in d && $('[name=dueAt]')) $('[name=dueAt]').value = d.dueAt ? toLocalInput(d.dueAt) : '';
  }
  function value() {
    const kind = kindSel.value, hrs = $('[name=dueHours]') ? Number($('[name=dueHours]').value) : 0, at = $('[name=dueAt]');
    return {
      kind, title: titleIn.value.trim(), desc: descIn.value.trim(),
      objectives: [...objs.querySelectorAll('.objrow')].map(r => ({ label: r.querySelector('[name=olabel]').value.trim(), target: Number(r.querySelector('[name=otarget]').value), progress: Number(r.dataset.progress) || 0 })),
      rewards: rewards ? rewards.value() : newRewards(),
      penaltyText: $('[name=penaltyText]') ? $('[name=penaltyText]').value.trim() : '',
      dueHours: Number.isFinite(hrs) && hrs > 0 ? hrs : null,
      dueAt: at && kind === 'urgent' && at.value ? new Date(at.value).toISOString() : null,
    };
  }
  /** The first thing that stops a save, in words, with the cursor put there; '' when nothing does. */
  function check() {
    if (!titleIn.value.trim()) { titleIn.focus(); return 'Enter a title.'; }
    if (rewards && rewards.blocked()) return UNFINISHED_ROWS;
    if (rewards && kindSel.value === 'job' && !rewards.value().job) { rewards.ensure('job'); return 'Choose a job for a job quest.'; }
    return '';
  }

  root.addEventListener('change', e => { if (e.target === kindSel) syncKind(); });
  root.addEventListener('click', e => {
    const b = /** @type {Element} */ (e.target).closest('button'); if (!b || !root.contains(b) || b.closest('[data-rweditor]')) return;
    if (b.hasAttribute('data-oadd')) addObjRow();
    else if (b.hasAttribute('data-orm')) b.closest('.objrow').remove();
  });

  set({ kind: init ? init.kind : 'side', title: init ? init.title : '', desc: init ? init.desc : '', objectives: init ? init.objectives : [],
    ...(init && rewards ? { rewards: init.rewards } : {}), penaltyText: init ? init.penaltyText : '', dueHours: init ? init.dueHours : null, dueAt: init ? init.dueAt : null });
  return { value, check, set, rewards, focus: () => titleIn.focus() };
}

/** The form's look, once. @param {(id: string, text: string) => void} css */
export function questFieldsCss(css) {
  css('quest-fields', `
.qfx,.qfx-main,.qfx-rw{display:flex;flex-direction:column;gap:10px;min-width:0}
.qfx .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.qfx input[type=text],.qfx input[type=number],.qfx input[type=datetime-local],.qfx select,.qfx textarea{width:100%;box-sizing:border-box;min-width:0}
.qfx textarea{resize:vertical;min-height:60px}
.qfx .objrow{display:flex;gap:6px;align-items:flex-end}
.qfx .objrow .grow{flex:1 1 0;min-width:0}
.qfx .objrow .sm{flex:0 0 72px;min-width:0}
.qfx fieldset{border:1px solid var(--line);padding:8px 10px;margin:0;min-width:0}
.qfx legend{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan-dim);padding:0 4px}
@media (min-width:1500px){.qfx legend{font-size:13px}}
@media (pointer:coarse),(max-width:720px){.qfx [data-oadd]{margin-top:8px}.qfx .objrow+.objrow{margin-top:8px}}`);
}

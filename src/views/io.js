// io.js (U12): Data view. Settings, export/import with preview (the file read as the store reads a save), the backups ring
// (the day's backup is the store's, at load), danger zone, storage meter,
// and sharing the GM's custom content as a pack (src/core/pack.ts), in a code (src/edge/pack-code.ts) or a file (app.api.share).
import { SCHEMA, exportedSave } from '../core/save.ts';
import { atHunter, atSettings } from '../core/save-step.ts';
import { withResetHour, withSound } from '../core/settings.ts';
import { rename } from '../core/hunter/record.ts';
import { withImportedHunters } from '../core/hunter/imported.ts';
import { PACK_CAP, PACK_KINDS, PACK_WORDS, mergePack, packCounts, packOf, parsePack } from '../core/pack.ts';
import { canCode, makeCode, readCode } from '../edge/pack-code.ts';
import * as motion from './motion.ts';
const MAX_IMPORT = 5 * 1024 * 1024; // refuse files over 5 MB
const QUOTA = 5 * 1024 * 1024;      // typical storage budget of a site (bytes), used for the indicator only

const pad = n => String(n).padStart(2, '0');
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'hunter';

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const kb = b => (b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const BACKUP_REASON = { manual: 'Manual', daily: 'Daily', session: 'Session start', 'pre-import': 'Before import', 'pre-restore': 'Before restore', 'pre-reset': 'Before reset', 'pre-delete-hunter': 'Before deleting hunter', unreadable: 'Unreadable save' };
const backupLabel = r => BACKUP_REASON[r] || r;

/** "1 status, 2 items and 1 monster" for the kinds that have any, or "nothing". */
function summary(counts) {
  const parts = PACK_KINDS.filter(k => counts[k]).map(k => `${counts[k]} ${PACK_WORDS[k][counts[k] === 1 ? 0 : 1]}`);
  return parts.length ? parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : 'nothing';
}
const total = counts => PACK_KINDS.reduce((n, k) => n + counts[k], 0);
const CODE_ERROR = {
  'no-code': 'This is not a share code. A share code starts with HS1.',
  damaged: 'This code is damaged or cut short. Copy the whole code again.',
  unsupported: 'Share codes are not supported in this browser. Ask for a file instead.',
  'not-a-pack': 'This code does not contain custom content.',
  newer: 'This code is from a newer version of the app. Update the app, then try again.',
  older: 'This code is from an older version and cannot be imported. Ask for a new share code from the current version, or create it fresh in the Workshop.',
};
/** The custom content of a campaign file, read as a pack: its library and its monsters. */
const campaignPack = raw => parsePack({ schema: SCHEMA, kind: 'library', library: raw.library, monsters: raw.monsters });
const flash = (b, t) => { if (!b.dataset.lbl) b.dataset.lbl = b.textContent; b.textContent = t; clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = b.dataset.lbl; }, 2000); };

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;

  // ── sharing custom content ──
  const libraryCounts = () => { const s = store.get(); return packCounts({ ...s.library, monsters: s.monsters }); };
  const docCounts = doc => { const r = parsePack(doc); return r.ok ? packCounts(r.pack) : libraryCounts(); };
  /** The window with a pack's code in a text box and Copy. */
  async function showCode(doc) {
    if (!canCode()) return void ui.warn({ tag: 'Share error', title: 'No code on this browser', body: 'Share codes are not supported in this browser. Save a file instead.' });
    const code = await makeCode(doc);
    await ui.system({ tag: '! Share', title: 'Share code', body: `This code contains ${summary(docCounts(doc))}. On the other device, open Data, paste it under "Paste a code", and tap Read code.`,
      html: `<textarea class="io-code" readonly rows="${Math.min(12, Math.max(4, Math.ceil(code.length / 36)))}" spellcheck="false" aria-label="Share code" data-pack-code>${ui.esc(code)}</textarea>
        <div class="data-actions"><button type="button" class="primary" data-pack-copy>Copy code</button></div>`,
      actions: [{ label: 'Close', value: null, cancel: true }] });
  }
  async function shareOpen() {
    const c = libraryCounts(), total = PACK_KINDS.reduce((n, k) => n + c[k], 0);
    if (!total) return void ui.toast('System', 'Nothing to share yet. Create custom content (a status, item, skill, monster, bundle, map, feat, or story) in the Workshop first.', { kind: 'warning' });
    /** @type {import('./ui.js').SystemAction[]} */
    const kinds = [{ label: 'Cancel', value: null, cancel: true }, { label: `Everything (${total})`, value: 'all', primary: true },
      ...PACK_KINDS.filter(k => c[k]).map(k => ({ label: `${PACK_WORDS[k][2]} (${c[k]})`, value: k }))];
    const kind = await ui.system({ tag: '! Share', title: 'Share custom content', body: 'Choose what to share. Shared content never includes hunters or room keys.', layout: 'list', actions: kinds });
    if (!kind) return;
    const how = await ui.system({ tag: '! Share', title: 'Share as', body: 'A code is text you can paste in a message. A file works better for large amounts of content.',
      actions: [{ label: 'Cancel', value: null, cancel: true }, { label: 'Save a file', value: 'file' }, { label: 'Show a code', value: 'code', primary: true }] });
    if (!how) return;
    const doc = packOf(store.get(), new Date().toISOString(), kind);
    if (how === 'code') return void await showCode(doc);
    download(`hunter-library-${localDate(new Date())}.json`, JSON.stringify(doc, null, 2));
    ui.toast('System', `Saved a file with ${summary(docCounts(doc))}.`);
  }
  /**
   * Whether to go on although storage was too full to back up the current save first (`store.backupNow` answered false,
   * or a replace answered `unkept`): the player is asked, as before deleting a hunter.
   */
  const goOnUnbacked = what => ui.confirm({ title: 'No backup saved', body: `Storage is full, so your current save could not be backed up first. ${what} anyway?`, danger: true, confirmLabel: `${what} without backup` });
  /** A restore, an import or a reset (`go(anyway)`), asked again when it could not back up first. Answers what it did. */
  async function replaceAsking(go, what) {
    const r = go(false);
    return r === 'unkept' && await goOnUnbacked(what) ? go(true) : r;
  }

  /**
   * The preview of a pack read by `parsePack` (what it holds, what was refused and why), then Add or Replace: a backup,
   * and one store update that merges it through `mergePack`. Answers whether it was merged.
   */
  async function importPack(r, o = {}) {
    const kept = packCounts(r.pack), n = total(kept);
    const lines = PACK_KINDS.filter(k => kept[k]).map(k => `${PACK_WORDS[k][2]}: ${kept[k]}`);
    for (const k of PACK_KINDS) {
      const { unreadable, over } = r.counts[k], w = c => PACK_WORDS[k][c === 1 ? 0 : 1];
      if (unreadable) lines.push(`Refused: ${unreadable} ${w(unreadable)} that could not be read`);
      if (over) lines.push(`Skipped: ${over} ${w(over)} over the ${PACK_CAP[k]} share limit`);
    }
    if (!n) { await ui.warn({ tag: 'Import error', title: 'Nothing to import', body: 'No readable custom content was found in this file or code.', lines }); return false; }
    const mode = await ui.system({ tag: '! Import', title: o.title || 'Import custom content',
      body: (o.body ? o.body + ' ' : '') + 'Tap Add alongside existing to keep your entries and add these (duplicates get numbered, like "Frostbite 2"). Tap Replace matching entries to overwrite entries with the same name. Your save is backed up first.',
      lines, actions: [{ label: o.skip || 'Cancel', value: null, cancel: true }, { label: 'Replace matching entries', value: 'replace', danger: true }, { label: 'Add alongside existing', value: 'add', primary: true }] });
    if (mode !== 'add' && mode !== 'replace') return false;
    const backedUp = store.backupNow('pre-import');
    if (!backedUp && !(await goOnUnbacked('Import'))) return false;
    let report = null;
    if (!ui.wrote('System', store.apply('import-library', s => { const m = mergePack(s, r.pack, mode); report = m.report; return m.save; }))) return false;
    const sum = f => PACK_KINDS.reduce((x, k) => x + report[k][f], 0);
    const added = sum('added'), replaced = sum('replaced');
    ui.toast('System', `Custom content imported: ${added} added${replaced ? `, ${replaced} replaced` : ''}.${backedUp ? ' Previous save kept in backups.' : ''}`);
    const full = PACK_KINDS.filter(k => report[k].full).map(k => `${PACK_WORDS[k][2]}: ${report[k].full} skipped (library limit is ${PACK_CAP[k]})`);
    if (full.length) await ui.warn({ tag: 'Library full', title: 'Some did not fit', body: 'Your library was full, so these were not imported. Delete some in the Workshop and import again.', lines: full });
    return true;
  }
  async function readPasted(box) {
    const c = await readCode(box.value);
    const r = c.ok ? parsePack(c.value) : c;
    if ('why' in r) return void ui.warn({ tag: 'Import error', title: 'Code not read', body: CODE_ERROR[r.why] });
    if (await importPack(r)) box.value = '';
  }

  app.api.share = {
    open: shareOpen,
    entry: (kind, id) => showCode(packOf(store.get(), new Date().toISOString(), kind, id)),
  };
  document.addEventListener('click', async e => {
    const b = e.target instanceof Element ? e.target.closest('[data-pack-copy]') : null; if (!b) return;
    const box = b.closest('.sys-window').querySelector('[data-pack-code]');
    try { await navigator.clipboard.writeText(box.value); flash(b, 'Copied'); } catch { box.focus(); box.select(); flash(b, 'Select and copy'); } // the browser refused the clipboard: the code is selected for the GM to copy
  });

  ui.css('io', `
    #view-data .view-main{display:flex;flex-direction:column;gap:14px}
    .io-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;align-items:end}
    .io-check{display:flex;align-items:center;gap:10px;min-height:40px;cursor:pointer}
    .io-check input{width:22px;height:22px;accent-color:var(--cyan,#4dd8ff);flex:none}
    .io-help{color:var(--muted);font-size:13px;margin:6px 0 0}
    .io-bk{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
    .io-bk li{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 8px;border:1px solid var(--line,rgba(77,216,255,.25))}
    .io-bk .bk-t{font-family:var(--font-mono);font-size:13px;flex:1 1 150px;min-width:0}
    .io-bk .bk-r{color:var(--cyan-dim);letter-spacing:.08em;text-transform:uppercase;font-size:12px}
    .io-meter{height:10px;border:1px solid var(--line,rgba(77,216,255,.4));margin-top:6px;background:rgba(0,0,0,.35)}
    .io-meter i{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(var(--f,0));background:var(--cyan,#4dd8ff)}
    .io-meter.warn i{background:var(--red,#ff4d5e)}
    #view-data .danger-zone{border-color:rgba(255,77,94,.5)}
    #view-data input[type=file]{max-width:100%;min-height:40px}
    .io-code{width:100%;font-family:var(--font-mono);font-size:12px;word-break:break-all;resize:vertical;min-height:88px;max-height:45vh;overflow-y:auto}  /* rows fit the code up to 12 lines; a longer one scrolls */
@media (pointer:coarse),(max-width:720px){#view-data input[type=file]{min-height:44px}}
  `);

  let refresh = () => {};

  /** A file's text, read in chunks so the Data view shows how much of it is read: a real fraction, bytes of its size. */
  async function readFile(file) {
    const box = document.querySelector('#view-data [data-io-prog]'), show = f => { if (box) { box.hidden = false; motion.progress(box, f, `Reading ${file.name}`); } };
    if (!file.stream || !file.size) return file.text();
    const reader = file.stream().getReader(), parts = []; let got = 0;
    show(0);
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.byteLength; show(got / file.size); }
    if (box) motion.progress(box, 1, `Read ${file.name}`);
    return new TextDecoder().decode(await new Blob(parts).arrayBuffer());
  }

  async function doImport(file) {
    if (file.size > MAX_IMPORT) return ui.warn({ tag: 'Import error', title: 'File too large', body: 'Save files over 5 MB are not accepted.' });
    const text = await readFile(file);
    let raw = null; try { raw = JSON.parse(text); } catch { /* not JSON: store.read below refuses it and the Import failed window says why */ }
    if (isObj(raw) && raw.kind === 'library') {
      const r = parsePack(raw);
      if ('why' in r) {
        const body = r.why === 'newer' ? 'This file is from a newer version of the app.'
          : r.why === 'older' ? 'This file is from an older version and cannot be imported. Export it again from the current version, or create it fresh in the Workshop.'
            : 'This file does not contain custom content.';
        return ui.warn({ tag: 'Import error', title: 'Import failed', body });
      }
      return void await importPack(r);
    }
    const r = store.read(text);
    if (r.ok === false) return ui.warn({ tag: 'Import error', title: 'Import failed', body: r.error });
    const got = r.save, names = got.hunters.map(h => h.name), hunterFile = r.kind === 'hunter';
    const lines = [`Hunters: ${names.length} (${names.slice(0, 6).join(', ')}${names.length > 6 ? ', …' : ''})`, `Quests: ${got.hunters.reduce((n, h) => n + h.quests.length, 0)}`];
    if (!hunterFile) lines.push(`Gates: ${got.gates.length}`);
    const read = hunterFile ? null : campaignPack(got), extra = read && 'pack' in read ? read : null;
    const extraCount = extra ? total(packCounts(extra.pack)) : 0;
    if (extraCount) lines.push(`Custom content: ${summary(packCounts(extra.pack))}`);
    /** @type {import('./ui.js').SystemAction[]} */
    const actions = [{ label: 'Cancel', value: null, cancel: true },
      { label: hunterFile ? 'Add to party' : 'Add hunters to party', value: 'add', primary: hunterFile },
      { label: 'Replace campaign', value: 'replace', danger: true }];
    const choice = await ui.system({ tag: '! Import', title: 'Import preview', body: hunterFile
      ? 'This file contains one hunter. Add them to your party, or replace the whole campaign. Your current save is backed up first.'
      : 'Replace your campaign with this file, or add its hunters to your party. Your current save is backed up first.', lines, actions });
    if (choice === 'replace') {
      if (await replaceAsking(anyway => store.importSave(got, anyway), 'Replace') === 'replaced') ui.toast('System', 'Import complete. Previous save kept in backups.');
    } else if (choice === 'add') {
      if (!store.backupNow('pre-import') && !(await goOnUnbacked('Add'))) return;
      if (!ui.wrote('System', store.apply('import-hunter', sv => withImportedHunters(sv, got.hunters)))) return;
      ui.toast('System', `${names.length} hunter${names.length === 1 ? '' : 's'} added to the party.`);
      if (extraCount) await importPack(extra, { title: 'Bring its custom content too?', body: 'This file also contains custom content.', skip: 'Skip' });
    }
  }

  app.registerView({
    id: 'data', label: 'Data', icon: '▤', order: 100,
    mount(el) {
      el.innerHTML = `
      <section class="win"><span class="cb"></span><h2>Settings</h2>
        <div class="io-grid">
          ${ui.field('Daily reset hour (0-23)', '<input type="number" data-set="resetHour" min="0" max="23" step="1" inputmode="numeric">')}
          ${ui.field('Active hunter name', '<input type="text" data-set="hunterName" maxlength="60" autocomplete="off">')}
          <label class="io-check"><input type="checkbox" data-set="sound"><span>Sound on</span></label>
        </div>
        <p class="io-help">The daily reset hour sets when a new day begins.</p>
      </section>
      <section class="win"><span class="cb"></span><h2>Export / Import</h2>
        <div class="data-actions">
          <button type="button" class="primary" data-export>Export campaign</button>
          <button type="button" data-export-hunter>Export active hunter</button>
        </div>
        <label class="io-check"><input type="checkbox" data-export-key><span>Include GM key (anyone with this file can be GM of your room)</span></label>
        <div class="data-actions">${ui.field('Import (.json)', '<input type="file" accept="application/json,.json" data-import>')}</div>
        <div class="io-prog" data-io-prog hidden></div>
        <p class="io-help">Importing shows a preview first and saves a backup of your current campaign. You can add a hunter file to your party instead of replacing your campaign.</p>
      </section>
      <section class="win" data-io-share><span class="cb"></span><h2>Custom content</h2>
        <div class="data-actions"><button type="button" class="primary" data-share>Share custom content</button></div>
        <p class="io-help">Send your statuses, items, skills, monsters, bundles, maps, feats, and stories to another device or campaign as a code or file. It never includes hunters or room keys.</p>
        ${ui.field('Paste a code', '<textarea data-paste rows="3" spellcheck="false" autocomplete="off" placeholder="HS1.…"></textarea>')}
        <div class="data-actions"><button type="button" data-read-code>Read code</button></div>
        <p class="io-help">Use Import above for a shared file. Both show a preview before changing anything.</p>
      </section>
      <section class="win"><span class="cb"></span><h2>Backups</h2>
        <div class="data-actions"><button type="button" class="primary" data-backup-now>Back up now</button></div>
        <ul class="io-bk" data-backups></ul>
        <p class="io-help">The newest 8 backups are kept. One is taken automatically on the first load of each day.</p>
      </section>
      <section class="win"><span class="cb"></span><h2>Storage</h2>
        <div data-usage-text></div>
        <div class="io-meter" data-meter role="img" aria-label="Storage used"><i></i></div>
      </section>
      <section class="win danger-zone"><span class="cb"></span><h2>Danger zone</h2>
        <p>Reset the whole campaign to a fresh start. A backup is kept, and you must type RESET to confirm.</p>
        <div class="data-actions"><button type="button" class="danger" data-reset>Reset campaign</button></div>
      </section>`;

      const $ = s => el.querySelector(s);
      $('[data-export]').addEventListener('click', () => {
        // the file leaves this phone: never its device id or token, and its GM keys only when asked (save.ts `exportedSave`)
        download(`hunter-system-${localDate(new Date())}.json`, JSON.stringify(exportedSave(store.get(), $('[data-export-key]').checked), null, 2));
      });
      $('[data-export-hunter]').addEventListener('click', () => {
        const h = store.active();
        const doc = { schema: SCHEMA, kind: 'hunter', savedAt: new Date().toISOString(), hunters: [h] };
        download(`hunter-${slug(h.name)}-${localDate(new Date())}.json`, JSON.stringify(doc, null, 2));
      });
      $('[data-share]').addEventListener('click', () => { void shareOpen(); });
      $('[data-read-code]').addEventListener('click', () => { void readPasted($('[data-paste]')); });
      $('[data-import]').addEventListener('change', async e => {
        const f = e.target.files[0]; if (!f) return;
        try { await doImport(f); } finally { e.target.value = ''; }
      });
      $('[data-backup-now]').addEventListener('click', () => {
        if (store.backupNow('manual')) ui.toast('System', 'Backup saved.');
        else ui.warn({ tag: 'Storage full', title: 'No backup saved', body: 'Storage is full, so a backup could not be saved. Export your data to keep a copy.' });
        refresh();
      });
      $('[data-backups]').addEventListener('click', async e => {
        const b = e.target.closest('[data-restore]'); if (!b) return;
        const i = Number(b.dataset.restore);
        const bk = store.backups()[i]; if (!bk) return;
        const ok = await ui.confirm({ title: 'Restore this backup?', body: `Your current save will be replaced by the "${backupLabel(bk.reason)}" backup from ${new Date(bk.at).toLocaleString()}. The current save is backed up first.`, danger: true, confirmLabel: 'Restore backup' });
        if (!ok) return;
        const r = await replaceAsking(anyway => store.restore(i, anyway), 'Restore');
        if (r === 'replaced') ui.toast('System', 'Backup restored.');
        else if (r === 'old') ui.warn({ tag: 'Restore error', title: 'Restore failed', body: 'That backup is from an older version and cannot be restored. Keep your current save or use Reset campaign to start fresh.' });
        else if (r === 'unreadable') ui.warn({ tag: 'Restore error', title: 'Restore failed', body: 'That backup could not be read.' });
      });
      $('[data-reset]').addEventListener('click', async () => {
        const v = await ui.promptText({
          danger: true,
          tag: 'Reset campaign',
          title: 'Reset campaign?',
          body: 'Resetting replaces every hunter in this campaign. A backup is saved first.',
          label: 'Type RESET to confirm',
          value: '',
          maxlength: 10,
          confirmLabel: 'Reset campaign',
          match: { word: 'RESET', error: 'Type RESET to confirm.' },
        });
        if (v === null) return;
        if (await replaceAsking(anyway => store.reset(anyway), 'Reset') === 'replaced') ui.toast('System', 'Campaign has been reset.');
      });

      el.addEventListener('change', e => {
        const k = e.target.dataset && e.target.dataset.set; if (!k) return;
        const t = e.target;
        const step = k === 'resetHour' ? atSettings(st => withResetHour(st, t.value)) : k === 'sound' ? atSettings(st => withSound(st, t.checked))
          : k === 'hunterName' ? atHunter(store.active().id, h => rename(h, t.value)) : null;
        // a refused setting is told, and the fields are drawn again from the save
        if (step && !ui.wrote('Settings', store.apply('settings', step))) fill(el);
      });
      refresh = () => fill(el);
      fill(el);
    },
    update(el) { fill(el); },
  });

  function fill(el) {
    const s = store.get(), act = store.active(), q = x => el.querySelector(x), focus = document.activeElement;
    const put = (sel, prop, val) => { const n = q(sel); if (n && n !== focus && n[prop] !== val) n[prop] = val; };
    put('[data-set=resetHour]', 'value', String(s.settings.dailyResetHour));
    put('[data-set=sound]', 'checked', !!s.settings.sound);
    put('[data-set=hunterName]', 'value', act.name);
    const bks = store.backups(), list = q('[data-backups]');
    const sig = JSON.stringify(bks);
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.innerHTML = bks.length ? bks.map((b, i) => `<li><span class="bk-t">${ui.esc(new Date(b.at).toLocaleString())}</span><span class="bk-r">${ui.esc(backupLabel(b.reason))}</span><button type="button" data-restore="${i}" aria-label="Restore backup from ${ui.esc(new Date(b.at).toLocaleString())}, ${ui.esc(backupLabel(b.reason))}">Restore</button></li>`).join('')
        : '<li class="empty">No backups yet.</li>';
    }
    const used = store.used(), txt = q('[data-usage-text]'), meter = q('[data-meter]');
    if (used === null) { txt.textContent = 'Storage usage is unavailable.'; meter.hidden = true; return; }
    const pct = Math.min(100, Math.round(used / QUOTA * 100));
    txt.textContent = `${kb(used)} of about ${kb(QUOTA)} used (${pct}%)${store.saveOk ? '' : ' · saving failed, export your data'}`;
    meter.hidden = false; meter.classList.toggle('warn', pct >= 80);
    meter.setAttribute('aria-label', `Storage used: ${pct}%`); void motion.fillTo(meter, pct / 100, { trail: false });
  }
}

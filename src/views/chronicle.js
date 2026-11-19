// chronicle.js: what the System remembers of a hunter, on screen (feature 1's notes 17.12). It draws one value,
// `chronicleView` (src/core/hunter/chronicle-view.ts), in two places: the Chronicle panel on the hunter's sheet (short
// at first, one button for the rest) and the GM's read-only window opened from a board card (`app.api.chronicle.open`),
// which for a player's hunter reads the cut its phone pushed. Every sentence comes from core; this module writes
// nothing to the save. `book` is the one answer in the views to which feats apply on this phone.
import { CHRONICLE_WORDS as W, FIRST, chronicleView } from '../core/hunter/chronicle-view.ts';
import { featsFor } from '../core/hunter/feats.ts';
import { BUILT_IN_FEATS } from '../core/registry/feats.ts';
import { parseSheetKey } from '../core/ids.ts';

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app, esc = ui.esc;
  ui.css('chronicle', `
.chr-nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;margin:0}
.chr-nums div{border:1px solid var(--line);padding:6px 8px;min-width:0}
.chr-nums dt{font-size:calc(12px*var(--ts));letter-spacing:.08em;text-transform:uppercase;color:var(--cyan-dim);overflow-wrap:anywhere}
.chr-nums dd{margin:2px 0 0;font-family:var(--font-mono);font-size:calc(18px*var(--ts));color:var(--ice)}
.chr-list .row-li{margin-bottom:0}
.chr-facts li{display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
.chr-facts li:last-child{border-bottom:none}
.chr-when{flex:0 0 84px;font-size:calc(12px*var(--ts));color:var(--muted)}
.chr-line{flex:1 1 auto;min-width:0}
.chr-note{margin:6px 0 0;font-size:calc(13px*var(--ts));color:var(--cyan-dim)}
.chr-all{width:100%;min-height:var(--control-h);margin-top:10px;white-space:normal}
.chr-win{text-align:left}`);

  /** The feats that apply on this phone: a player in a room reads the GM's from the room's feats doc, any other phone its own library. */
  const book = () => featsFor(app.rules(), BUILT_IN_FEATS, app.seat() === 'player' ? app.api.sync.doc('feats')?.feats ?? {} : store.get().library.feats);
  /** Whether the sheet's panel shows every row: the view's memory for this tab. */
  const allMemory = store.device('chronicle-all', 'tab');

  /**
   * A chronicle's markup. `all`: every row, else the first of each list (`FIRST`); `button`: the Show all or Show less
   * button, where a list holds more than its first rows; `note`: a line over the numbers.
   * @param {import('../core/hunter/chronicle-view.ts').ChronicleView} v @param {{ all: boolean; button: boolean; note: string }} o
   */
  function draw(v, o) {
    const cut = (list, n) => (o.all ? list : list.slice(0, n));
    const more = W.showAll(v);
    const earned = cut(v.earned, FIRST.earned).map(f => `<li class="row-li" data-chr-earned="${esc(f.key)}"><div class="r-main">
        <div class="r-name">${esc(f.name)}${f.hidden ? ` <span class="tag-on">${esc(W.hidden)}</span>` : ''}</div>
        ${f.desc ? `<div class="r-sub">${esc(f.desc)}</div>` : ''}<div class="r-sub">${esc(f.when)}</div>
        ${f.gave.length ? `<div class="r-sub">${esc(f.gave.join(' · '))}</div>` : ''}</div></li>`).join('');
    const shown = cut(v.shown, FIRST.shown).map(f => `<li class="row-li" data-chr-shown="${esc(f.key)}"><div class="r-main">
        <div class="r-name">${esc(f.name)}</div>${f.desc ? `<div class="r-sub">${esc(f.desc)}</div>` : ''}<div class="r-sub">${esc(f.progress)}</div></div></li>`).join('');
    const facts = cut(v.facts, FIRST.facts).map(f => `<li><span class="chr-when">${esc(f.when)}</span><span class="chr-line">${esc(f.line)}</span></li>`).join('');
    return `${o.note ? `<p class="chr-note">${esc(o.note)}</p>` : ''}
      <dl class="chr-nums">${v.numbers.map(x => `<div><dt>${esc(x.label)}</dt><dd>${esc(ui.fmt(x.n))}</dd></div>`).join('')}</dl>
      <div class="lbl dv-sub">${esc(W.feats)}</div>
      ${earned ? `<ul class="plain chr-list" aria-label="${esc(W.feats)}">${earned}</ul>` : `<p class="empty">${esc(W.noFeats)}</p>`}
      ${v.featsOff ? `<p class="chr-note" data-chr-off>${esc(W.featsOff)}</p>` : shown ? `<div class="lbl dv-sub">${esc(W.shown)}</div><ul class="plain chr-list" aria-label="${esc(W.shown)}">${shown}</ul>` : ''}
      <p class="chr-note">${esc(W.hiddenNote)}</p>
      <div class="lbl dv-sub">${esc(W.facts)}</div>
      ${facts ? `<ul class="plain chr-facts" aria-label="${esc(W.facts)}">${facts}</ul>` : `<p class="empty">${esc(W.noFacts)}</p>`}
      ${o.button && more ? `<button type="button" class="chr-all" data-chr-all="${o.all ? '0' : '1'}">${esc(o.all ? W.showLess : more)}</button>` : ''}`;
  }

  app.registerPanel({
    view: 'status', id: 'chronicle', order: 21, title: W.title,
    mount(el) {
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-chr-all]'); if (!b) return;
        allMemory.write(b.dataset.chrAll === '1'); app.redraw();
      });
    },
    update(el) {
      const html = draw(chronicleView(store.active().chronicle, book(), app.rules()), { all: allMemory.read() === true, button: true, note: '' });
      if (el._h !== html) { el._h = html; el.innerHTML = html; }
    },
  });

  app.api.chronicle = {
    book,
    open(id) {
      const key = parseSheetKey(id), sheet = key ? app.api.sync.remoteSheets().find(x => x.key === key) : null;
      const h = key ? (sheet ? sheet.data : null) : store.get().hunters.find(x => x.id === id);
      if (!h) return;
      const v = chronicleView(h.chronicle, book(), app.rules(), key ? 'push' : 'sheet');
      void ui.system({ tag: W.title, title: h.name, kind: 'info', html: `<div class="chr-win" data-chr-of="${esc(id)}">${draw(v, { all: true, button: false, note: key ? W.pushed : '' })}</div>`,
        actions: [{ label: W.close, value: null, primary: true, cancel: true }] });
    },
  };
}

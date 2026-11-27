// dice.js (U06): the roller, Dice view, quick checks, floating d20 roll sheet. Publishes app.api.dice. Every roll is a
// formula read by `parseFormula` (src/core/formula.ts: Roll20's dice, a leading `/r` optional) and rolled with its faces
// by `rollFormula` (src/edge/roll.ts); the view shows each face's fate as core gives it and computes no total itself.
// A player's hunter in a room rolls with the weight its phone heard (src/core/table-weight.ts `heldWeight`): the faces
// it shows are the weighted ones, and nothing on the page says so.
import { clearRolls, rolled } from '../core/session-log.ts';
import { rules } from '../edge/rules.ts';
import * as motion from './motion.ts';
import { STAT_KEYS, STAT_LABELS, STAT_SHORT } from '../core/stats.ts';
import { rollFormula, trayRandom } from '../edge/roll.ts';
import { naturalOf, parseFormula, printFormula, withEdge } from '../core/formula.ts';
import { coinWords } from '../core/coin.ts';
import { checkResult } from '../core/roll.ts';
import { DC_GROUPS, DC_KEYS, DC_START, dcKeyOf, dcOf, dcPickStep, dcWords } from '../core/dc-pick.ts';
import { oneOf } from '../core/one-of.ts';
import { NO_WEIGHT, drawnWith, heldWeight, rolledWith } from '../core/table-weight.ts';

const DICE = [4, 6, 8, 10, 12, 20, 100];
/** The typed rolls this device keeps, newest first, to roll again with a tap. */
const RECENT_MAX = 10;
/** The highest total an expression such as "2d6+3" can roll: the numerals a tumble shows stay within it. */
const highest = (expr, total) => Math.max(total, String(expr).replace(/\s+/g, '').split(/(?=[+-])/).reduce((n, t) => { const m = /^([+-]?)(\d*)d(\d+)$/i.exec(t); return n + (m ? (m[1] === '-' ? 0 : (Number(m[2]) || 1) * Number(m[3])) : Math.max(0, Number(t) || 0)); }, 0));
const CSS = `
.seg button[data-m=dis][aria-pressed=true]{background:var(--red);border-color:var(--red)}
.dx-row{display:flex;align-items:flex-end;gap:10px;margin-top:10px;flex-wrap:wrap}
.dx-expr{flex:1 1 150px}
.dx-expr input{width:100%}
.dx-err{min-height:18px;margin-top:6px;color:var(--red);font-size:13px}
.dx-recent{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.dx-recent button{min-height:var(--control-h);font-family:var(--font-mono);font-size:13px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dx-faces s{color:var(--muted)}
.dx-faces .x{color:var(--gold)}
.dx-faces .ok{color:var(--green);font-weight:700}
.dx-sum{font-family:var(--font-mono);font-size:16px;color:var(--ice);margin-bottom:2px}
.dx-flag{font-size:12px;letter-spacing:.3em;text-transform:uppercase;min-height:16px;margin-top:4px}
.dx-flag.crit{color:var(--gold)}.dx-flag.fail{color:var(--red)}.dx-flag.ok{color:var(--green)}
.roll-out{text-align:center}
.dx-checks{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.dx-checks button{display:flex;flex-direction:column;align-items:center;gap:0;padding:6px 4px}
.dx-checks .cs{font-size:12px;letter-spacing:.04em;color:var(--cyan-dim)}
.dx-checks .cb2{font-family:var(--font-mono);font-size:16px;color:var(--ice)}
.dx-log{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.dx-log li{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:6px 10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dx-log .lt{font-family:var(--font-display);font-weight:700;font-size:22px;min-width:44px;text-align:center;color:var(--ice)}
.dx-log .lt.crit{color:var(--gold)}.dx-log .lt.fail{color:var(--red)}
.dx-log .lm{flex:1 1 160px;min-width:0;font-family:var(--font-mono);font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}
.dx-log .lm b{color:var(--ice);font-weight:600}
.dx-log .lw{font-size:12px;color:var(--muted);white-space:nowrap}
.dx-tag{font-size:12px;letter-spacing:.14em;text-transform:uppercase;padding:0 5px;border:1px solid currentColor}
.dx-tag.crit{color:var(--gold)}.dx-tag.fumble{color:var(--red)}
.dx-fab{position:fixed;right:14px;bottom:20px;z-index:45;width:52px;height:52px;border-radius:50%;padding:0;font-family:var(--font-display);font-weight:700;font-size:15px;
  background:rgba(8,26,48,.96);border:2px solid var(--cyan);color:var(--cyan);box-shadow:0 0 14px rgba(77,216,255,.55)}
.dx-sheet{position:fixed;right:calc(14px + var(--sar));bottom:84px;z-index:45;width:min(380px,calc(100vw - 28px));max-height:calc(100dvh - 110px);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:var(--panel-solid);
  border:1px solid var(--line-bright);box-shadow:0 0 26px rgba(20,100,160,.55);padding:14px}
.dx-sheet[hidden]{display:none}
.dx-sheet header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}
.dx-sheet header>span{display:flex;gap:6px;align-items:center}
.dx-sheet h2{margin:0;font-size:14px;letter-spacing:.3em;text-transform:uppercase;color:var(--cyan)}
.dx-sheet .roll-total{font-size:38px}
/* phones: the bottom nav's Dice tab opens the sheet (FAB hidden), sheet docks above the nav */
@media (max-width:720px){
  .dx-fab{display:none}
  .dx-sheet{left:0;right:0;width:auto;bottom:calc(var(--nav-h) + var(--sab));max-height:calc(100vh - var(--nav-h) - var(--sab) - var(--sat) - 8px);max-height:calc(100dvh - var(--nav-h) - var(--sab) - var(--sat) - 8px);
    padding:12px calc(12px + var(--sar)) 12px calc(12px + var(--sal));border-width:1px 0 0}
  /* while top-docked toasts are shown, keep the quick-roll sheet below them so its header and dice row stay clear */
  html:has(#toasts .toast:not(.m-leaving)) .dx-sheet{max-height:calc(100vh - var(--nav-h) - var(--sab) - var(--sat) - 112px);max-height:calc(100dvh - var(--nav-h) - var(--sab) - var(--sat) - 112px)}
  html:has(#toasts .toast:not(.m-leaving):nth-of-type(2)) .dx-sheet{max-height:calc(100vh - var(--nav-h) - var(--sab) - var(--sat) - 210px);max-height:calc(100dvh - var(--nav-h) - var(--sab) - var(--sat) - 210px)}
  .dx-sheet header button{min-height:44px;min-width:44px}
}
/* landscape phones: the rail's Dice tab opens the sheet at the right */
@media (min-width:721px) and (max-width:1099px) and (max-height:500px){
  .dx-fab{display:none}
  .dx-sheet{top:auto;bottom:calc(8px + var(--sab));right:calc(8px + var(--sar));width:min(380px,calc(100vw - var(--rail-w) - var(--sal) - var(--sar) - 24px));max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px)}
  .dx-sheet header button{min-height:44px;min-width:44px}
}`;

/** A roll with one kept d20 as its face, the rest and the total: "14 + 3 = 17". None for a roll without one. */
const sumLine = r => {
  if (r.natural === null) return '';
  const rest = Math.round((r.total - r.natural) * 100) / 100;
  return `${r.natural} ${rest < 0 ? '−' : '+'} ${Math.abs(rest)} = ${r.total}`;
};
const pad = n => String(n).padStart(2, '0');
const clock = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  // not ui.css(): its <style data-mod> would collide with the v1 [data-mod] modifier input selector used by regression scripts
  const st = document.createElement('style'); st.dataset.css = 'dice'; st.textContent = ui.themed(CSS); document.head.appendChild(st);

  // roll('2d6+1d4+3', {adv, dis, label, silent, kind, hid, dc}) -> {id,expr,total,rolls,kept,natural,crit,fumble,adv,dis,check,text,coin}; throws
  // on a bad expression. The log keeps who rolled (`hid`, else the active hunter on a phone that is not the GM's, else the
  // GM), what for (`kind`) and a check's DC and result. A hunter's roll is offered to the coin call (coin.js), which asks
  // "Heads or tails?" when src/core/coin.ts says the roll calls it.
  /** A formula's text read by the one parser, or its error (what to write) thrown. */
  const read = expr => { const p = parseFormula(String(expr).replace(/[−–]/g, '-'), rules()); if ('error' in p) throw new Error(p.error); return p.formula; };
  /** The faces of a roll as the Dice view shows them: kept plain, dropped and rerolled struck, exploded marked, successes counted. */
  const facesHtml = r => r.terms.map(t => {
    const faces = t.faces.map(f => f.fate === 'rerolled' || f.fate === 'dropped' ? `<s>${f.face}</s>` : `<span class="${f.fate === 'success' ? 'ok' : ''}${f.exploded ? ' x' : ''}">${f.face}${f.exploded ? '!' : ''}</span>`).join(', ');
    return `[${faces}]${t.dice.mods && t.dice.mods.success ? ` ${t.total} success${t.total === 1 ? '' : 'es'}` : ''}`;
  }).join(' ');
  /** The faces of the latest rolls by id, for the detail line (the log keeps the faces, not their fates). */
  const shown = new Map();
  function roll(expr, o = {}) {
    const f = read(expr), edged = o.adv && !o.dis ? withEdge(f, 'kh') : o.dis && !o.adv ? withEdge(f, 'kl') : f;
    // the hunter who rolls; the GM's own roll has none, and a formula that names a stat reads the GM's active hunter
    const who = o.hid ? store.hunter(o.hid) : app.isGM() ? null : store.active();
    const h = who || store.active(), b = app.api.hunter.sheet(h), body = { stats: b.stats, sheet: b.sheet };
    // the text logged is the formula as typed, before an edge: what the coin's rule reads (src/core/coin.ts `isCoinRoll`)
    const clean = printFormula(f);
    // the GM's weight on this hunter, heard while a player in this room; a roll that is not logged spends nothing, so it draws with none
    const room = app.seat() === 'player' ? app.api.sync.room() : null, weight = who && !o.silent ? heldWeight(store.get().settings.sync.weights, room, who.id) : NO_WEIGHT;
    const drawWeight = o.force === 20 || o.force === 1 ? { forced: o.force } : drawnWith(weight, clean);
    const r = rollFormula(edged, { user: body, target: body, charge: 0 }, trayRandom, drawWeight);
    const natural = naturalOf(r), total = Math.round(r.total * 100) / 100, rolls = r.terms.flatMap(t => t.faces.map(x => x.face));
    const kind = o.kind || 'other', check = kind === 'check' && typeof o.dc === 'number' ? checkResult(natural, total, o.dc) : null;
    const res = { expr: clean, total, rolls, kept: natural, natural, crit: natural === 20, fumble: natural === 1, adv: edged !== f && !o.dis, dis: edged !== f && !!o.dis, check };
    res.text = `${clean} [${rolls.join(', ')}] = ${total}`;
    res.faces = facesHtml(r);
    if (!o.silent) {
      res.id = store.id('r');
      shown.set(res.id, res.faces); if (shown.size > 20) shown.delete(shown.keys().next().value);
      // a roll the log refused is still shown; it is not posted and calls no coin, both of which read the logged roll
      const logged = rolled({ id: res.id, at: new Date().toISOString(), hid: who ? who.id : null, who: who ? who.name : 'GM', kind, label: o.label || '', expr: clean, rolls, total, natural, crit: res.crit, fumble: res.fumble, adv: res.adv, dis: res.dis, check }, rules());
      if (ui.wrote('! Dice', store.apply('roll', rolledWith(logged, room, who ? who.id : null, clean)))) {
        app.emit('roll', { roll: res });
        res.coin = !!who && app.api.coin.rolled({ hid: who.id, roll: res.id, kind, expr: clean, natural, label: o.label || clean });
      }
    }
    return res;
  }

  app.api.dice = {
    roll,
    check(hid, stat, o = {}) {
      const h = store.hunter(hid) || store.active(), checks = app.api.hunter.sheet(h).checks, b = checks.bonus[stat];
      const dis = o.dis || checks.dis;
      return roll(`1d20${b >= 0 ? '+' : ''}${b}`, { adv: o.adv, dis, label: o.label || `${stat.toUpperCase()} check`, kind: 'check', hid: h.id, dc: o.dc });
    },
  };

  // ── shared roller controls (used by the Dice view and the FAB sheet) ──
  /** A natural 20 or 1 is told at once, unless it called the coin: then the coin says what it means. */
  const critToast = r => { if (r.coin) return; if (r.crit) ui.toast('System', 'Critical success.'); else if (r.fumble) ui.toast('Warning', 'Critical failure.', { kind: 'warning' }); };
  const typedMemory = store.device('dice-typed');
  let recent = (v => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, RECENT_MAX) : []))(typedMemory.read());
  const keep = () => typedMemory.write(recent);
  function controls(root, { quickChecks }) {
    const inst = { mode: '' };
    root.innerHTML = `
      <div class="dice-btns">${DICE.map(d => `<button type="button" data-d="${d}" aria-label="Roll d${d}">d${d}</button>`).join('')}</div>
      <div class="mod-row">
        ${ui.field('Modifier', '<input type="number" data-mod value="0" min="-20" max="20" inputmode="numeric">')}
        ${ui.field('Dice count', '<input type="number" data-n value="1" min="1" max="20" inputmode="numeric">')}
        <div class="field"><span class="lbl">Roll mode</span><div class="seg" role="group" aria-label="Roll mode">
          <button type="button" data-m="adv" aria-pressed="false">Advantage</button><button type="button" data-m="" aria-pressed="true">Normal</button><button type="button" data-m="dis" aria-pressed="false">Disadvantage</button>
        </div></div>
      </div>
      <div class="dx-row">
        <div class="dx-expr">${ui.field('Type a roll', '<input type="text" data-expr maxlength="200" placeholder="2d6 + 3" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">')}</div>
        <button type="button" class="primary" data-go>Roll</button>
      </div>
      <div class="dx-err" data-err role="alert"></div>
      ${quickChecks ? '<div class="dx-recent" data-recent aria-label="Recent rolls"></div>' : ''}
      ${quickChecks ? `<div class="lbl sec">Quick stat check <span data-who></span></div>
        <div class="dx-row">${ui.field('Difficulty (DC)', '<select data-dc></select>')}</div>
        <div class="dx-checks" data-checks></div>` : ''}
      <div class="roll-out"><div class="roll-total" data-total>&mdash;</div><div class="dx-flag" data-flag></div><div class="roll-detail" data-detail>Tap a die to roll.</div></div>
      <div class="dx-coin" data-coin-slot></div>`;
    const q = s => root.querySelector(s);
    const setErr = t => { q('[data-err]').textContent = t || ''; };
    const doRoll = (expr, o = {}) => {
      try {
        setErr('');
        const r = roll(expr, { adv: inst.mode === 'adv', dis: inst.mode === 'dis', kind: 'die', ...o });
        critToast(r);
        return r;
      } catch (err) { setErr(err.message); return null; }
    };
    /** A typed roll: rolled, and kept first among this device's recent ones. */
    const typed = text => { const r = doRoll(text); if (r) { const t = text.trim(); recent = [t, ...recent.filter(x => x !== t)].slice(0, RECENT_MAX); keep(); } };
    const drawRecent = () => {
      const box = q('[data-recent]'); if (!box) return;
      const html = recent.map(t => `<button type="button" data-again="${esc(t)}" aria-label="Roll ${esc(t)} again">${esc(t)}</button>`).join('');
      if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
    };
    const clampIn = (inp, lo, hi) => {
      const raw = Math.trunc(Number(inp.value)) || 0, v = Math.min(hi, Math.max(lo, raw));
      if (v !== raw || inp.value === '') setErr(`Enter a number from ${lo} to ${hi}.`);
      inp.value = v; return v;
    };
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
      if (b.dataset.d) {
        const n = clampIn(q('[data-n]'), 1, 20), md = clampIn(q('[data-mod]'), -20, 20);
        doRoll(`${n}d${b.dataset.d}${md ? (md > 0 ? '+' : '') + md : ''}`);
      } else if (b.hasAttribute('data-go')) { const t = q('[data-expr]').value.trim(); if (t) typed(t); else doRoll('1d20'); }
      else if (b.dataset.again !== undefined) typed(b.dataset.again);
      else if (b.dataset.m !== undefined) {
        inst.mode = b.dataset.m;
        root.querySelectorAll('[data-m]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.m === inst.mode)));
      } else if (b.dataset.st) {
        try {
          setErr('');
          const against = dcOf(dc, rules().rankTable) ?? undefined;
          critToast(app.api.dice.check(store.active().id, b.dataset.st, { dc: against, adv: inst.mode === 'adv', dis: inst.mode === 'dis' }));
        } catch (err) { setErr(err.message); }
      }
    });
    q('[data-expr]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); q('[data-go]').click(); } });
    // a bad formula says what is wrong under the field as it is typed
    q('[data-expr]').addEventListener('input', e => { const t = e.target.value.trim(), p = t ? parseFormula(t.replace(/[−–]/g, '-'), rules()) : null; setErr(p && 'error' in p ? p.error : ''); });
    /** The quick check's DC (src/core/dc-pick.ts), moved only by `dcPickStep`; the sheet has no quick check. */
    let dc = quickChecks ? DC_START : null;
    inst.update = () => {
      const rs = store.get().rolls, last = rs[0], t = q('[data-total]'), f = q('[data-flag]');
      t.className = `roll-total${last && last.crit ? ' crit' : last && last.fumble ? ' fail' : ''}`;
      // a new roll tumbles its numerals and lands on the total already rolled above; anything else (or one that already opened the coin call) is drawn at once
      // the faces it rolled (the detail line) show when the total lands, not while it tumbles
      const v = last ? last.check : null, coin = last ? app.api.coin.of(last.id) : null;
      const detail = q('[data-detail]'), tail = last ? `${last.adv ? ' · advantage' : last.dis ? ' · disadvantage' : ''}${last.label ? ' · ' + esc(last.label) : ''}` : '';
      const sum = last ? sumLine(last) : '';
      const words = last ? `${sum ? `<div class="dx-sum" data-sum>${esc(sum)}</div>` : ''}${esc(last.expr)} <span class="dx-faces">${shown.get(last.id) ?? `[${esc(last.rolls.join(', '))}]`}</span>${tail}` : 'Tap a die to roll.';
      if (last && t.dataset.rid !== last.id && t.dataset.rid !== undefined && last.total >= 1 && !coin) {
        detail.textContent = '';
        void motion.tumble(t, last.total, highest(last.expr, last.total)).then(() => { if (t.dataset.rid === last.id) { detail.innerHTML = words; void motion.enter(detail, 'fade'); } });
      } else if (t.dataset.rid !== (last ? last.id : '')) { motion.forget(t); t.textContent = last ? last.total : '—'; detail.innerHTML = words; }
      t.dataset.rid = last ? last.id : '';
      drawRecent();
      f.className = `dx-flag${last && last.crit ? ' crit' : last && last.fumble ? ' fail' : v ? (v.success ? ' ok' : ' fail') : ''}`;
      // a roll that called the coin reads what the coin says, not "Critical success"
      f.textContent = coin ? coinWords(coin) : last && last.crit ? 'Critical success' : last && last.fumble ? 'Critical failure' : v ? `${v.success ? 'Success' : 'Failure'} against DC ${v.dc}` : '';
      if (!quickChecks) return;
      const h = store.active(), rt = rules().rankTable, sel = q('[data-dc]');
      // the options are drawn again only when the rank table's numbers change, so an open select is left alone
      const opts = `<option value="none">${esc(dcWords('none', rt))}</option>` + DC_GROUPS.map(g => `<optgroup label="${esc(g.rank)}-rank">${g.keys.map(k => `<option value="${esc(k)}">${esc(dcWords(k, rt))}</option>`).join('')}</optgroup>`).join('');
      if (sel.dataset.sig !== opts) { sel.dataset.sig = opts; sel.innerHTML = opts; }
      if (sel.value !== dcKeyOf(dc)) sel.value = dcKeyOf(dc);
      q('[data-who]').textContent = '· ' + h.name;
      const bonus = app.api.hunter.sheet(h).checks.bonus;
      const html = STAT_KEYS.map(k => { const alias = STAT_LABELS[k], b = bonus[k]; return `<button type="button" data-st="${esc(k)}" aria-label="${esc(alias)} check ${b >= 0 ? '+' : ''}${b}"><span class="cs">${esc(alias)}</span><span class="cb2">${b >= 0 ? '+' : ''}${b}</span></button>`; }).join('');
      const box = q('[data-checks]'); if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
    };
    if (quickChecks) q('[data-dc]').addEventListener('change', e => { dc = dcPickStep(dc, { kind: 'picked', key: oneOf(e.target.value, DC_KEYS, dcKeyOf(dc)) }); });
    return inst; // drawn by its first update: the view's after its mount, the sheet's when it opens, never inside register (the coin's api is not there yet)
  }

  // ── Dice view ──
  let viewInst = null, sheetInst = null;
  app.registerView({
    id: 'dice', label: 'Dice', icon: '⚄', order: 70,
    mount(el) {
      el.innerHTML = `<section class="win"><span class="cb"></span><h2>Dice</h2><div data-roller></div></section>
        <section class="win"><span class="cb"></span><h2>Roll log</h2>
          <div class="dx-row flush"><span class="empty" data-count></span><button type="button" class="danger" data-clear>Clear log</button></div>
          <ol class="dx-log" data-hist aria-label="Roll log"></ol></section>`;
      viewInst = controls(el.querySelector('[data-roller]'), { quickChecks: true });
      el.querySelector('[data-clear]').addEventListener('click', async () => {
        if (!store.get().rolls.length) return;
        if (await ui.confirm({ title: 'Clear roll log?', body: 'Clearing removes every roll from your roll log.', danger: true, confirmLabel: 'Clear log' })) ui.wrote('! Dice', store.apply('clear-rolls', clearRolls));
      });
    },
    update(el) {
      viewInst && viewInst.update();
      const rs = store.get().rolls, hist = el.querySelector('[data-hist]'), sig = rs.map(r => r.id).join();
      el.querySelector('[data-count]').textContent = `${rs.length} / ${rules().rollCap} rolls`;
      if (hist.dataset.sig === sig) return; hist.dataset.sig = sig;
      hist.innerHTML = rs.length ? rs.map(r => `<li><span class="lt${r.crit ? ' crit' : r.fumble ? ' fail' : ''}">${esc(r.total)}</span>
        <span class="lm"><b>${esc(r.expr)}</b> [${esc(r.rolls.join(', '))}] = ${esc(r.total)}${r.adv ? ' (advantage)' : r.dis ? ' (disadvantage)' : ''}${r.label ? '<br>' + esc(r.label) : ''}</span>
        ${r.crit ? '<span class="dx-tag crit">Critical success</span>' : r.fumble ? '<span class="dx-tag fumble">Critical failure</span>' : ''}
        <span class="lw">${esc(r.who)} · ${esc(clock(r.at))}</span></li>`).join('') : '<li class="empty">No rolls yet.</li>';
    },
  });

  // ── floating d20 FAB + compact roll sheet (non-modal) ──
  const fab = ui.h('<button type="button" class="dx-fab" id="dice-fab" aria-label="Open dice roller" aria-expanded="false" aria-controls="dice-sheet">d20</button>');
  const sheet = ui.h('<div class="dx-sheet" id="dice-sheet" role="dialog" aria-label="Quick dice roller" hidden><header><h2>Quick roll</h2><span><button type="button" data-full>Open Dice tab</button><button type="button" data-close aria-label="Close dice roller">&times;</button></span></header><div data-roller></div></div>');
  document.body.append(sheet, fab);
  sheetInst = controls(sheet.querySelector('[data-roller]'), { quickChecks: false });
  // where the bottom nav / rail is visible (phones, landscape phones) the nav's Dice tab is the opener and the FAB is display:none
  const NAV = '#nav-bottom a[href="#/dice"]', docked = () => !fab.getClientRects().length;
  /**
   * The sheet is open; while it leaves it is already closed (inert, and a tap opens it again). It is the `quickRoll`
   * sheet of src/core/windows.ts: Escape while it is on top, a tab or its own "Dice tab" take it down.
   */
  let isOpen = false;
  const syncNav = () => document.querySelectorAll(NAV).forEach(a => { a.setAttribute('aria-controls', 'dice-sheet'); if (a.hasAttribute('aria-current')) a.removeAttribute('aria-expanded'); else a.setAttribute('aria-expanded', String(isOpen)); });
  const setOpen = open => {
    isOpen = open; sheet.inert = !open; ui.sheet('quickRoll', open, () => setOpen(false));
    if (open) { sheet.hidden = false; void motion.enter(sheet); } else if (!sheet.hidden) void motion.hide(sheet);
    fab.setAttribute('aria-expanded', String(open)); syncNav();
    fab.setAttribute('aria-label', open ? 'Close dice roller' : 'Open dice roller');
    if (open) { sheetInst.update(); (sheet.querySelector('[data-d="20"]') || sheet).focus(); } else if (sheet.contains(document.activeElement)) (docked() && document.querySelector(NAV) || fab).focus();
  };
  fab.addEventListener('click', () => setOpen(!isOpen));
  document.addEventListener('click', e => { // delegated: the nav is re-rendered by app.js
    const a = e.target.closest(NAV); if (!a || e.defaultPrevented || !docked() || location.hash === '#/dice') return;
    e.preventDefault(); setOpen(!isOpen);
  });
  new MutationObserver(syncNav).observe(document.getElementById('nav-bottom'), { childList: true });
  sheet.querySelector('[data-full]').addEventListener('click', () => app.go('dice'));
  sheet.querySelector('[data-close]').addEventListener('click', () => setOpen(false));
  app.on('change', () => { if (isOpen) sheetInst.update(); });
}

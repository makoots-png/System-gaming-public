// keystones.js: the Keystones codex view (notes-11-keystones.md A.4, unit K6). Lists all 44 keystones with their
// thresholds read live from rules(), filterable by tier, stat, and search text. Hidden while `fight.keystone.on` is off.
import { rules } from '../edge/rules.ts';
import { STAT_KEYS, STAT_LABELS, STAT_SHORT } from '../core/stats.ts';
import { keystoneBasis, keystoneKeyId, keystonesOf } from '../core/hunter/keystones.ts';
import {
  KEYSTONE_WORDS, keystoneCodexEntries, keystoneCountLine, keystoneLines, keystoneTierCondition,
} from '../core/rules-text.ts';

const TIERS = [
  ['mark', KEYSTONE_WORDS.tierMarks],
  ['confluence', KEYSTONE_WORDS.tierConfluences],
  ['apex', KEYSTONE_WORDS.tierApexes],
];

const CSS = `
.ks-intro{margin:0 0 12px;font-size:calc(14px*var(--ts));color:var(--ice);overflow-wrap:anywhere}
.ks-ctrl{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:10px}
.ks-ctrl .ks-grow{flex:1 1 160px;min-width:0}
.ks-ctrl .ks-stat{flex:0 0 140px;min-width:0}
.ks-ctrl .field{width:100%}
.ks-ctrl input,.ks-ctrl select{width:100%}
.ks-tiers{margin-bottom:10px}
.ks-count{font-size:12px;color:var(--muted);margin:0 0 10px}
.ks-grp{margin:0 0 16px}
.ks-grp[hidden]{display:none}
.ks-grp h3{margin:0 0 4px;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--cyan-dim)}
.ks-cond{margin:0 0 8px;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.ks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
.ks-card{border:1px solid var(--line);background:rgba(10,26,46,.6);padding:10px 12px;min-width:0;display:flex;flex-direction:column;gap:6px}
.ks-card.held{border-color:var(--line-bright);box-shadow:0 0 10px rgba(77,216,255,.2)}
.ks-card-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}
.ks-card-name{font-family:var(--font-display);font-weight:700;font-size:16px;color:var(--ice);overflow-wrap:anywhere}
.ks-req{font-family:var(--font-mono);font-size:12px;color:var(--cyan-dim)}
.ks-card-line{margin:0;font-size:13px;color:var(--ice);overflow-wrap:anywhere}
.ks-card-meta{margin:0;font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.ks-card-aw{margin:0;padding-left:8px;border-left:2px solid var(--gold);font-size:12px;color:var(--ice);overflow-wrap:anywhere}
.ks-none{color:var(--muted);font-style:italic;margin:8px 0 0}
.ks-none[hidden]{display:none}
@media (max-width:720px){.ks-grid{grid-template-columns:minmax(0,1fr)}}
@media (pointer:coarse),(max-width:720px){.ks-tiers button{min-height:var(--control-h)}}
`;

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  ui.css('keystones', CSS);

  /** Reads active filters from the DOM and shows only matching cards and tier groups. */
  function applyFilter(el) {
    const tierBtn = el.querySelector('[data-ks-tier] button[aria-pressed="true"]');
    const tier = tierBtn ? tierBtn.dataset.tier : '';
    const stat = el.querySelector('[data-ks-stat]').value;
    const q = el.querySelector('[data-ks-q]').value.trim().toLowerCase();
    const cards = [...el.querySelectorAll('[data-ks-card]')];
    const shown = cards.filter(c => {
      const okTier = !tier || c.dataset.tier === tier;
      const okStat = !stat || c.dataset.stats.split(',').includes(stat);
      const okQ = !q || c.dataset.search.includes(q);
      const show = okTier && okStat && okQ;
      c.hidden = !show;
      return show;
    }).length;
    for (const g of el.querySelectorAll('[data-ks-grp]')) {
      g.hidden = !g.querySelector('[data-ks-card]:not([hidden])');
    }
    el.querySelector('[data-ks-count]').textContent = keystoneCountLine(shown, cards.length);
    el.querySelector('[data-ks-none]').hidden = shown > 0;
  }

  /** Renders all 44 keystone cards grouped by tier, marking any the active hunter holds. */
  function draw(el) {
    const R = rules(), h = store.active();
    const held = new Set(keystonesOf(keystoneBasis(h), R.fight).map(keystoneKeyId));
    const sig = JSON.stringify(R.fight.keystone) + '|' + [...held].join(',');
    const body = el.querySelector('[data-ks-body]');
    if (body.dataset.sig === sig) return;
    body.dataset.sig = sig;
    const entries = keystoneCodexEntries(R);
    el.querySelector('[data-ks-intro]').textContent = keystoneLines(R).slice(1).join(' ');
    body.innerHTML = TIERS.map(([tier, heading]) => {
      const list = entries.filter(e => e.key.tier === tier);
      const cards = list.map(e => {
        const isHeld = held.has(e.id);
        const search = [e.name, e.line, e.tierLabel, e.requirement, ...e.stats.map(s => `${STAT_LABELS[s]} ${STAT_SHORT[s]}`), ...e.jobs, e.awakenedLine || ''].join(' ').toLowerCase();
        return `<article class="ks-card${isHeld ? ' held' : ''}" data-ks-card="${esc(e.id)}" data-tier="${esc(tier)}" data-stats="${esc(e.stats.join(','))}" data-search="${esc(search)}">
          <div class="ks-card-h"><span class="ks-card-name">${esc(e.name)}</span>${isHeld ? `<span class="tag-on">${esc(KEYSTONE_WORDS.earnedBadge)}</span>` : ''}</div>
          <div class="ks-req">${esc(e.requirement)}</div>
          <p class="ks-card-line">${esc(e.line)}</p>
          ${e.jobs.length ? `<p class="ks-card-meta">${esc(KEYSTONE_WORDS.jobPairPrefix)}${esc(e.jobs.join(', '))}</p>` : ''}
          ${e.awakenedLine ? `<p class="ks-card-aw">${esc(KEYSTONE_WORDS.awakenedPrefix)}${esc(e.awakenedLine)}</p>` : ''}
        </article>`;
      }).join('');
      return `<div class="ks-grp" data-ks-grp="${esc(tier)}">
        <h3>${esc(heading)}</h3>
        <p class="ks-cond">${esc(keystoneTierCondition(/** @type {'mark'|'confluence'|'apex'} */ (tier), R))}</p>
        <div class="ks-grid">${cards}</div>
      </div>`;
    }).join('');
    applyFilter(el);
  }

  app.registerView({
    id: 'keystones', label: KEYSTONE_WORDS.codexTitle, icon: '✦', order: 81,
    when: () => rules().fight.keystone.on,
    mount(el) {
      el.innerHTML = `<section class="win"><span class="cb"></span><h2>${esc(KEYSTONE_WORDS.codexTitle)}</h2>
        <p class="ks-intro" data-ks-intro></p>
        <div class="seg ks-tiers" role="group" aria-label="Keystone tier" data-ks-tier>
          <button type="button" data-tier="" aria-pressed="true">${esc(KEYSTONE_WORDS.tierAll)}</button>
          <button type="button" data-tier="mark" aria-pressed="false">${esc(KEYSTONE_WORDS.tierMarks)}</button>
          <button type="button" data-tier="confluence" aria-pressed="false">${esc(KEYSTONE_WORDS.tierConfluences)}</button>
          <button type="button" data-tier="apex" aria-pressed="false">${esc(KEYSTONE_WORDS.tierApexes)}</button>
        </div>
        <div class="ks-ctrl" role="search">
          <span class="ks-grow">${ui.field(KEYSTONE_WORDS.searchLabel, `<input type="text" data-ks-q maxlength="60" placeholder="${esc(KEYSTONE_WORDS.searchPlaceholder)}" autocomplete="off">`)}</span>
          <span class="ks-stat">${ui.field(KEYSTONE_WORDS.statFilterLabel, `<select data-ks-stat><option value="">${esc(KEYSTONE_WORDS.statAll)}</option>${STAT_KEYS.map(k => `<option value="${esc(k)}">${esc(STAT_LABELS[k])}</option>`).join('')}</select>`)}</span>
        </div>
        <p class="ks-count" data-ks-count aria-live="polite"></p>
        <div data-ks-body></div>
        <p class="ks-none" data-ks-none hidden>${esc(KEYSTONE_WORDS.noMatch)}</p>
      </section>`;
      el.querySelector('[data-ks-tier]').addEventListener('click', e => {
        const b = e.target.closest('button[data-tier]'); if (!b) return;
        for (const x of el.querySelectorAll('[data-ks-tier] button[data-tier]')) x.setAttribute('aria-pressed', String(x === b));
        applyFilter(el);
      });
      el.querySelector('[data-ks-stat]').addEventListener('change', () => applyFilter(el));
      el.querySelector('[data-ks-q]').addEventListener('input', () => applyFilter(el));
    },
    update: el => draw(el),
  });
}

// mythic-html.js: the markup of a mythic's strip and omen banner (notes-11-keystones.md B.5), shared by the GM's fight
// screen (combat.js) and a player's HUD (table.js). Every word it draws comes from src/core/combat/fight-view.ts
// (`mythicStrip`, `omenBanner`, `omenOnYou`, `mythicHand`); this file only lays them out.
import { esc } from './ui.js';
import { fillMarkup } from './motion.ts';

/** The strip and banner's look: a danger edge on the banner, the HP bar with a notch at the gate, the phase's mark. */
export const MYTHIC_CSS = `
.myth{display:flex;flex-direction:column;gap:8px;margin:0 0 12px;min-width:0}
.myth:empty{display:none}
.myth-box{border:1px solid var(--line-bright);background:rgba(10,26,46,.78);padding:10px 12px;display:flex;flex-direction:column;gap:5px;min-width:0}
.myth-name{font-family:var(--font-display);font-weight:700;font-size:16px;color:var(--ice);overflow-wrap:anywhere}
.myth-phase{font-size:14px;color:var(--cyan);overflow-wrap:anywhere}
.myth-bar{position:relative}
.myth-bar .bar{height:10px}
.myth-notch{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ice);box-shadow:0 0 6px var(--ice);pointer-events:none}
.myth-hp,.myth-clock{font-size:14px;color:var(--ice);overflow-wrap:anywhere}
.myth-box[data-mark=held] .myth-hp{color:var(--warm)}
.myth-box[data-mark=enraged] .myth-clock,.myth-box[data-mark=enraged] .myth-name{color:var(--red)}
.myth-note,.myth-ahead{margin:0;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.myth-omen{border:1px solid rgba(255,77,94,.55);border-left:5px solid var(--red);background:rgba(90,12,24,.5);padding:10px 12px;display:flex;flex-direction:column;gap:5px;min-width:0}
.myth-omen[data-doom]{background:rgba(120,12,28,.65)}
.myth-title{font-family:var(--font-display);font-weight:700;font-size:15px;letter-spacing:.04em;color:#ffd5d9;overflow-wrap:anywhere}
.myth-when{font-size:14px;color:var(--ice);overflow-wrap:anywhere}
.myth-omen ul{margin:0;padding-left:18px;font-size:14px;color:#ffd5d9}
.myth-omen li{margin:2px 0;overflow-wrap:anywhere}
.myth-you{margin:0;font-weight:700;font-size:14px;color:var(--warm)}
.myth-hand{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.myth-hand button{min-height:44px}
.myth-tag{color:var(--warm);font-weight:700}
.myth-turn{margin:0;font-weight:700;font-size:14px;color:var(--ice)}
`;

/**
 * One mythic's box: the strip, then (while an omen stands) the banner, then what this phone adds. `m` is
 * `{ id, strip, banner, you, hand, turn }`: `you` (a player's own line or null), `hand` the GM's words
 * (`mythicHand`) or null on a player's phone, `turn` whether it is this mythic's own turn and the omen lands now.
 */
export function mythicBox(m) {
  const s = m.strip, b = m.banner;
  const strip = `<div class="myth-box" data-mark="${esc(s.mark)}" data-mythic-id="${esc(m.id)}"><b class="myth-name">${esc(s.name)}</b>
    <span class="myth-phase">${esc(s.phase)}</span>
    ${s.share === null ? '' : `<div class="myth-bar"><div class="bar bar-hp" role="img" aria-label="${esc(s.hp)}">${fillMarkup(s.share)}</div>${s.gate === null ? '' : `<i class="myth-notch" style="left:${(s.gate * 100).toFixed(1)}%" aria-hidden="true"></i>`}</div>`}
    <span class="myth-hp">${esc(s.hp)}</span><span class="myth-clock">${esc(s.clock)}</span>
    ${s.note ? `<p class="myth-note">${esc(s.note)}</p>` : ''}${m.hand && s.ahead ? `<p class="myth-ahead">${esc(s.ahead)}</p>` : ''}</div>`;
  const omen = b ? `<div class="myth-omen" role="status"${b.doom ? ' data-doom' : ''} data-omen="${esc(b.title)}"><b class="myth-title">${esc(b.title)}</b>
    <span class="myth-when">${esc(b.when)}</span><span class="lbl">${esc(b.answerHead)}</span>
    <ul>${b.answers.map(a => `<li>${esc(a)}</li>`).join('')}</ul>${m.you ? `<p class="myth-you">${esc(m.you)}</p>` : ''}
    ${m.hand ? hand(m) : ''}</div>` : (m.hand && m.hand.next ? `<div class="myth-hand">${nextButton(m)}</div>` : '');
  return strip + omen;
}
const nextButton = m => `<button type="button" data-mynext="${esc(m.id)}">${esc(m.hand.next.label)}</button>`;
/** The GM's buttons under the banner: Land and Drop on the mythic's own turn, Drop while it waits, and Next phase. */
function hand(m) {
  const h = m.hand;
  return `${m.turn ? `<p class="myth-turn">${esc(h.landTitle)}</p>` : ''}<div class="myth-hand">${m.turn ? `<button type="button" class="primary" data-myland="${esc(m.id)}">${esc(h.land)}</button>` : ''}<button type="button" data-mydrop="${esc(m.id)}">${esc(h.drop)}</button>${h.next ? nextButton(m) : ''}</div>`;
}

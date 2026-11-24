// table.js (G04): player table HUD (reads the `_fight` room doc), turn cue, roll feed out (player) and Table feed (GM).
// On the hunter's turn the HUD offers its abilities (`hunterAbilities` of src/core/combat/rows.ts, the same list the GM's
// row of it holds), sent as the room's `cast` through app.api.uses, and Toward and Away from the nearest foe
// (`stepToward`, `stepAway` of src/core/combat/fight-view.ts over the doc's rows), sent as `step`. Both carry the doc's
// `now` as `at`, so the GM's phone takes a tap only on that turn. By the device's choice the HUD shows the battle map
// (src/views/map.js, its scene from `docBodies` and `mapScene` of map-view.ts over the doc), which sends the same `step`
// and `cast`.
import { WAYS_BACK } from '../core/hunter/vitals.ts';
import { lifeWord } from '../core/combat/row-life.ts';
import { isUp } from '../core/combat/row-hp.ts';
import { WAIT_WORDS, aims, answersBy, docSpots, mythicSeenOfDoc, mythicStrip, omenBanner, omenOnYou, readyIn, stepAway, stepToward, waitChoices } from '../core/combat/fight-view.ts';
import { MYTHIC_CSS, mythicBox } from './mythic-html.js';
import { docBodies, docGround, myPinKey } from '../core/combat/map-view.ts';
import { parseTold, toldAfter } from '../core/combat/table-news.ts';
import { featsSeen } from '../core/hunter/chronicle-view.ts';
import { SECRET_WORDS } from '../core/hunter/quest-secret.ts';
import { hunterAbilities } from '../core/combat/rows.ts';
import { roundOf } from '../core/combat/timeline.ts';
import { itemOfAbility } from '../core/registry/abilities.ts';
import { TABLE_REFUSAL_WORDS } from '../core/combat/refusal-words.ts';
import * as motion from './motion.ts';
import { bind, keyed } from './patch.ts';
import { icon, sprite } from './icons.ts';
import { statusIcon } from '../core/registry/icon-defaults.ts';

const FEED_MAX = 20;
const BANDS = { healthy: 100, wounded: 70, bloodied: 45, critical: 20, down: 0 };
const BAND_LABEL = { healthy: 'Healthy', wounded: 'Wounded', bloodied: 'Bloodied', critical: 'Critical', down: 'Down' };

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  sprite();
  const sync = () => app.api.sync;
  const inRoomPlayer = () => app.seat() === 'player';
  const inRoomGM = () => app.seat() === 'gm';
  const str = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
  const int = x => Math.trunc(Number(x)) || 0;

  // what this phone told of the GM's fight (core/combat/table-news.ts `Told`), in device memory so a reload never repeats it
  const cues = store.device('table-cues');

  // the FightDoc of src/core/protocol.ts, as its reader read it: an ended fight has no rows
  const encounter = () => sync().doc('fight');
  const hudOn = () => { const e = encounter(); return inRoomPlayer() && !!(e && !e.ended && e.active); };
  const rowsOf = e => (e.ended ? [] : e.rows);
  /** The round the doc's `now` is in, from 1. */
  const roundIn = e => (e.ended ? 1 : roundOf(e.now, app.rules().fight));
  const myKeys = () => store.get().hunters.map(h => ({ hid: h.id, key: sync().myKey(h.id) }));
  const isMine = r => !!r.key && myKeys().some(k => k.key === r.key);

  ui.css('mythic', MYTHIC_CSS);
  ui.css('table', `
    #view-combat:not([hidden]){display:flex;flex-direction:column}
    #view-combat:has([data-panel="table-hud"]) .panels{order:-1}
    #view-combat:has([data-panel="table-hud"]) [data-idle]{display:none}
    #view-combat:has([data-panel="table-hud"]) > .view-main:has([data-idle]){display:none} /* D03: no empty Combat window under a player's HUD */
    .tb-round{font-family:var(--font-display);letter-spacing:.2em;color:var(--cyan);font-size:18px;margin:0 0 8px}
    .tb-rows{list-style:none;margin:0 0 10px;padding:0;display:grid;gap:6px}
    .tb-row{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:8px 10px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;align-items:center}
    .tb-row.cur{border-color:var(--cyan);box-shadow:0 0 10px rgba(77,216,255,.35) inset;background:rgba(20,52,88,.7)}
    .tb-row.down{opacity:.7}.tb-row.dead{opacity:.5}
    .tb-name .lw{margin-left:6px}
    .tb-name{overflow-wrap:anywhere;font-weight:600;min-width:0}
    .tb-name .ic{--ic:var(--icon-order);margin-right:5px;vertical-align:-3px}
    .tb-sheet h3 .ic{--ic:var(--icon-card)}
    .tb-you{font-family:var(--font-mono);font-size:12px;color:var(--gold);border:1px solid var(--gold);padding:0 6px;margin-left:6px}
    .tb-turn{font-size:12px;color:var(--cyan);letter-spacing:.15em}
    .tb-band{grid-column:1/-1;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--cyan-dim)}
    .tb-band .bar{flex:1;height:8px}
    .tb-band[data-band=healthy] i{--bar-c:#4dff9d}
    .tb-band[data-band=wounded] i{--bar-c:var(--gold)}
    .tb-band[data-band=bloodied] i{--bar-c:#ff9d4d}
    .tb-band[data-band=critical] i{--bar-c:var(--red)}
    .tb-conds{grid-column:1/-1;font-size:12px;color:var(--cyan-dim)}
    .tb-me{margin:6px 0}
    .tb-kit{border:1px solid var(--line-bright);background:rgba(10,26,46,.6);padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-width:0}
    .tb-kit.my-turn{border-color:var(--cyan);box-shadow:0 0 16px rgba(77,216,255,.35)}
    .tb-kh{margin:0;font-family:var(--font-display);letter-spacing:.2em;font-size:16px;color:var(--cyan-dim)}
    .tb-kit.my-turn .tb-kh{color:var(--cyan)}
    .tb-kl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
    .tb-kl li{display:flex;gap:10px;align-items:center;border:1px solid var(--line);padding:6px 10px}
    .tb-kn{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}.tb-kn small{display:block;color:var(--cyan-dim);font-size:13px}
    .tb-kl button{min-width:64px;min-height:40px}
    .tb-acts{display:flex;flex-direction:column;gap:6px;margin:8px 0}
    .tb-kact{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px}.tb-khint{font-size:13px;color:var(--muted)}
    @media (hover:none){.tb-khint{display:none}}
    .tb-banner{margin:0;font-size:14px;color:var(--cyan);letter-spacing:.04em}
    .tb-death{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid var(--life);padding:8px 10px;margin-bottom:8px}
    .tb-death .lw{font-size:13px}
    .tb-death span{font-size:14px;color:var(--ice)}
    .tb-mine{font-family:var(--font-display);font-weight:700;font-size:calc(22px*var(--ts));letter-spacing:.18em;color:var(--ground);background:var(--cyan);padding:8px 12px;margin:0 0 8px;text-align:center}
    .tb-banner.mine{font-family:var(--font-display);font-weight:700;font-size:calc(20px*var(--ts));letter-spacing:.14em;color:var(--ground);background:var(--cyan);padding:8px 12px;text-align:center}
    .tb-feed{list-style:none;margin:0;padding:0;display:grid;gap:6px}
    .tb-feed li{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:8px 10px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;overflow-wrap:anywhere}
    .tb-feed .tb-txt{flex:1 1 180px;min-width:0}
    .tb-feed li.crit .tb-txt{color:var(--gold)}
    .tb-feed li.q .tb-txt{color:var(--cyan)}
    .tb-feed .tb-out{display:block;color:var(--ice);font-size:14px;margin-top:2px}.tb-feed .tb-on{font-size:12px;color:var(--cyan-dim)}
    .tb-ftog{display:none}
    .tb-view{margin:0 0 8px}
    .tb-x{grid-column:1/-1;font-size:13px;color:var(--cyan-dim);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .tb-x b{color:var(--ice)}.tb-x.intent{color:var(--warm)}.tb-x.intent b{color:var(--warm)}.tb-x ul{margin:2px 0 0;padding-left:18px;flex-basis:100%;color:var(--ice)}
    .tb-x .bar{flex:1 1 80px;height:6px}.bar-stagger{--bar-c:var(--gold)}.tb-x.stagger b{color:var(--gold)}
    .tb-sheet{border:1px solid var(--line-bright);background:var(--ground);padding:8px 10px;display:flex;flex-direction:column;gap:4px}
    .tb-sheet h3{margin:0;font-family:var(--font-display);font-size:17px;color:var(--ice);display:flex;align-items:center;gap:8px}
    .tb-sheet h3 button{margin-left:auto}
    @media (max-width:899px){.tb-sheet{position:fixed;left:0;right:0;bottom:var(--nav-h,0px);max-height:50vh;overflow:auto;z-index:30;box-shadow:0 -8px 24px rgba(0,0,0,.5)}}
    @media (max-width:1099px){
      #view-combat .panels:has([data-live]){order:2}
      [data-panel="table-feed"]{padding:6px 10px}
      [data-panel="table-feed"] > h2{display:none}
      .tb-ftog{display:flex;width:100%;align-items:center;gap:10px;min-height:var(--control-h);border:none;background:transparent;padding:0 4px;font-family:var(--font-display);font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:var(--cyan)}
      .tb-ftog .tb-fn{margin-left:auto;font-family:var(--font-body);letter-spacing:.04em;text-transform:none;font-size:13px;color:var(--muted)}
      .tb-ftog .tb-fn.new{color:var(--ground);background:var(--cyan);padding:2px 8px;font-weight:700}
      .tb-ftog::after{content:"▾";color:var(--cyan-dim)}
      .tb-ftog[aria-expanded=true]::after{content:"▴"}
      .tb-fwrap:not(.open) .tb-flist{display:none}
      .tb-fwrap.open .tb-flist{margin-top:6px}
      #view-combat .panels:has([data-fresh]){position:sticky;bottom:0;z-index:20;background:var(--ground)}
    }
    @media (min-width:1500px){.tb-you,.tb-turn,.tb-band,.tb-conds{font-size:13px}}
    @media (max-width:720px){#view-combat .panels:has([data-fresh]){bottom:var(--nav-h)}}
@media (pointer:coarse),(max-width:720px){.tb-kl button{min-height:44px}}
  `);

  // the app redraws on a change of the save; a room doc and this view's own memory change outside it
  const refresh = () => { if (['combat', 'status'].some(id => document.getElementById(`view-${id}`)?.hidden === false)) app.redraw(); };

  // ───────────────────────── player HUD ─────────────────────────
  const meRow = e => rowsOf(e).find(isMine) || null;
  const meHunter = e => { const r = e && meRow(e); const k = r && myKeys().find(x => x.key === r.key); return (k && store.hunter(k.hid)) || store.active(); };
  const curRow = e => rowsOf(e).find(r => r.id === e.currentId) || null;
  const share = (v, max) => Math.min(1, Math.max(0, v / Math.max(1, max)));

  /** The HUD's life line for hunter `h` while it is dead: its row's word (row-life.ts `lifeWord`) and the ways back. */
  function deathHtml(e, h) {
    const me = e && !e.ended ? meRow(e) : null, at = me ? me.life : h.life, word = lifeWord({ kind: 'hunter', life: at });
    if (!word) return '';
    return `<div class="tb-death" data-life-at="${at.at}"><b class="lw" data-life-at="${at.at}">${esc(word)}</b><span>${me ? "The GM's Revive brings you back during a fight." : `${esc(WAYS_BACK)} brings you back.`}</span></div>`;
  }
  const statusDef = c => app.api.effects.statusDef(c);
  const D = () => app.api.detail;
  /**
   * A row of status chips, each opening its detail (app.api.detail) under the row: a status of the hunter's sheet carries
   * its def and source; one of the room doc (a fight's row) its key, label, rounds left, count, tier, and the GM's def of
   * it unless the doc's table had no room (then this phone's def of the key, if it knows one). A count is drawn in `[data-stacks]`, counted to by `countStacks` after the draw.
   */
  function chipRow(list, rowKey, statuses, label) {
    if (!statuses.length) return '';
    const R = app.rules();
    return `<div class="chips" aria-label="${esc(label)}">${statuses.map(s => {
      const key = s.key, def = s.def || (Object.hasOwn(R.conditions, key) ? R.conditions[key] : null), name = def ? def.label : s.label || key;
      const left = s.left !== undefined ? s.left : s.rounds, n = s.stacks;
      const ends = !!(def && def.end), when = left != null ? ` · ${ends ? 'in ' : ''}${left} round${left === 1 ? '' : 's'}` : '';
      return `<span class="chip${n ? ' stk' : ''}" data-chip="${esc(key)}"${def && def.color ? ` style="border-color:${esc(def.color)}"` : ''}><button type="button" class="c-info"${D().control(list, key)}><span class="c-ic">${icon(statusIcon(key, def || { ops: [] }))}</span>${esc(name)}${n ? ` <b class="c-n" data-stacks="${n}" data-sk="${esc(`${rowKey}:${key}`)}">${n}</b>` : ''}${esc(when)}</button></span>`
        + D().panel(list, key, () => ({ kind: 'status', label: name, def, tier: s.source ? s.source.tier : s.tier ?? null, ...(n ? { stacks: n } : {}), left: left ?? null }));
    }).join('')}</div>`;
  }
  /** Each count on a chip counts to its new value from the one shown last (motion.ts `numberTo`, by the row and the status). @param {ParentNode} root */
  const countStacks = root => { for (const n of root.querySelectorAll('[data-stacks]')) void motion.numberTo(n, Number(n.dataset.stacks), String, `stk:${n.dataset.sk}`); };

  // ── what the HUD shows, as descriptions (src/views/patch.ts): drawn once, then updated in place ──
  /** A row of the order: its fields are `rowDesc`'s. */
  const rowTemplate = id => `<li data-row="${esc(id)}" data-attr="class:cls aria-current:current">
      <span class="tb-name" data-part="name"></span>
      <span class="tb-turn" data-text="turn"></span>
      <span class="tb-band" data-attr="data-band:band"><span class="bar bar-hp" role="img" data-attr="aria-label:bandLabel" data-fill="w">${motion.fillMarkup(0)}</span><span data-text="hpText"></span></span>
      <span class="slot" data-part="conds"></span></li>`;
  function rowDesc(e, r) {
    const mine = isMine(r), cur = r.id === e.currentId, band = r.band, word = lifeWord(r);
    const exact = r.kind !== 'monster'; // players see a hunter's or shadow's HP, and only a monster's band; a defeated one says so instead
    const shown = exact ? `${r.hp}/${r.hpMax}` : word ? '' : BAND_LABEL[band];
    const conds = r.statuses.slice(0, 8).map(c => `${c.label}${c.stacks ? ` ${c.stacks}` : ''}`);
    const summon = r.kind === 'summon' ? ` (${esc(ownerName(e, r))}'s${r.left !== null ? `, ${r.left} round${r.left === 1 ? '' : 's'}` : ''})` : '';
    return {
      cls: `tb-row${cur ? ' cur' : ''}${word ? ` down ${r.life.at}` : ''}`, current: cur ? 'true' : false,
      name: `${r.icon ? icon(r.icon) : ''}${esc(r.name)}${summon}${mine ? '<span class="tb-you">YOU</span>' : ''}${word ? `<span class="lw" data-life-at="${r.life.at}">${esc(word)}</span>` : ''}`, turn: cur ? '▶ TURN' : '',
      band, bandLabel: word ?? BAND_LABEL[band], w: exact ? share(r.hp, r.hpMax) : BANDS[band] / 100, hpText: shown,
      conds: `${conds.length ? `<span class="tb-conds">${conds.map(esc).join(' · ')}</span>` : ''}${extrasHtml(e, r)}`,
    };
  }

  /** The HUD's template, with "Your kit" beside it on desktop (`kit`). Its fields are `hudDesc`'s; the rows go in `.tb-rows`. */
  const VIEWS = /** @type {const} */ (['map', 'list']);
  const segHtml = () => `<div class="seg tb-view" role="group" aria-label="Fight view">${VIEWS.map(v => `<button type="button" data-fview="${v}" aria-pressed="${store.prefs().fightView === v}">${v === 'map' ? 'Map' : 'List'}</button>`).join('')}</div>`;
  /** The HUD with the map: "Your turn", the Map and List choice, the death line, the map, and a token's card when one is open. */
  const mapTemplate = () => `<div class="slot"><div class="slot" data-part="mine"></div><div class="slot" data-part="seg"></div><div class="myth slot" data-part="mythic"></div><div class="slot" data-part="death"></div><div class="slot" data-part="chips"></div><div data-mapbox></div><div class="tb-sheet" data-tbsheet hidden></div></div>`;
  const hudTemplate = kit => {
    const main = `<div class="slot" data-part="mine"></div><div class="slot" data-part="seg"></div><div class="myth slot" data-part="mythic"></div><div class="tb-round" role="status" data-text="round"></div>
      <ol class="tb-rows" aria-label="Turn order"></ol>
      <div class="slot" data-part="death"></div>
      <div class="tb-me" data-attr="hidden:noMe"><div class="bar-row"><div class="bar-head"><span class="lbl">HP</span><span class="bar-nums" data-text="hp"></span></div><div class="bar bar-hp" role="img" data-attr="aria-label:hpLabel" data-fill="hpF">${motion.fillMarkup(0)}</div></div>
        <div class="bar-row"><div class="bar-head"><span class="lbl">Mana</span><span class="bar-nums" data-text="mana"></span></div><div class="bar bar-mana" role="img" data-attr="aria-label:manaLabel" data-fill="manaF">${motion.fillMarkup(0)}</div></div>
        <div class="hp-amt" role="group" aria-label="Type an HP amount">
          <label class="field"><span class="lbl">HP amount</span><input type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" spellcheck="false" placeholder="7 or +5" title="Press Enter to deal damage. Type +5 or press Shift+Enter to heal." data-tbamt aria-label="HP amount"></label>
          <button type="button" class="danger" data-tbdmg>Damage</button><button type="button" data-tbheal>Heal</button>
          <p class="hp-amt-msg" data-tbmsg role="status" aria-live="polite"></p></div>
        <div class="slot" data-part="chips"></div></div>`;
    return `<div class="slot">${kit ? `<div class="dk-grid tb-dk"><div class="tb-main">${main}</div><div class="slot" data-part="kit"></div></div>` : `${main}<div class="slot" data-part="acts"></div>`}</div>`;
  };

  /** The hunter's statuses: in a fight its row's in the room doc (a fight's count is the fight's), else its sheet's. */
  function myChips(e, h) {
    const me = e && !e.ended ? meRow(e) : null;
    return me ? chipRow('hud-chips', me.id, me.statuses, 'Your statuses') : chipRow('hud-chips', h.id, (h.conditions || []).filter(c => c && c.key), 'Your statuses');
  }
  /** The doc's mythics as a screen reads them (fight-view.ts `mythicSeenOfDoc`): those with a standing, in the doc's order. */
  const mythicsOf = e => rowsOf(e).flatMap(r => { const m = r.kind === 'monster' && isUp(r) ? mythicSeenOfDoc(r, BAND_LABEL) : null; return m ? [m] : []; });
  /** The strip and omen banner of each mythic on the table, and on this hunter's own row what the omen means for it. */
  function mythicMarkup(e) {
    if (e.ended) return '';
    const R = app.rules(), me = meRow(e);
    return mythicsOf(e).map(m => mythicBox({ id: m.id, strip: mythicStrip(m, e.now, R), banner: omenBanner(m, e.rows, e.now, R), you: me && isUp(me) ? omenOnYou(m, me.id, me.place, R) : null, hand: null, turn: false })).join('');
  }
  /** What each of the hunter's abilities does to the omen standing: by ability id, the words of `answersBy`. */
  function answersOf(e, list) {
    const out = {};
    for (const m of e.ended ? [] : mythicsOf(e)) for (const a of list) { const w = answersBy(a, m); if (w && !out[a.id]) out[a.id] = w; }
    return out;
  }
  function hudDesc(e, h, kit) {
    const out = { mythic: mythicMarkup(e), seg: segHtml(), mine: myTurn(e) ? '<div class="tb-mine" role="status">\u25b6 YOUR TURN</div>' : '', round: `ROUND ${roundIn(e)}`, noMe: !h, death: '', hp: '', hpLabel: '', hpF: 0, mana: '', manaLabel: '', manaF: 0, chips: '' };
    if (h) {
      const s = app.api.hunter.sheet(h), d = { hp: int(s.hp), hpMax: int(s.sheet.hpMax), mana: int(s.mana), manaMax: int(s.sheet.manaMax) };
      Object.assign(out, {
        hp: `${d.hp} / ${d.hpMax}`, hpLabel: `HP ${d.hp} of ${d.hpMax}`, hpF: share(d.hp, d.hpMax),
        mana: `${d.mana} / ${d.manaMax}`, manaLabel: `Mana ${d.mana} of ${d.manaMax}`, manaF: share(d.mana, d.manaMax),
        chips: myChips(e, h),
        // A27: at 0 HP the HUD says the hunter is dead. The word is the row's life in the GM's fight (the sheet hears it a
        // message later).
        death: deathHtml(e, h),
      });
    }
    const acts = h ? actsHtml(e, h) : '';
    return kit ? { ...out, kit: kitHtml(e, h, acts) } : { ...out, acts };
  }

  // ── D03: "Your kit" beside the HUD on desktop (>=1100 only; never rendered below, so phone/tablet are untouched) ──
  const kitOn = () => app.layout.desktop();
  const myTurn = e => { const r = e && curRow(e); return !!(r && isMine(r)); };
  /** Whether this phone's turn waits on a command it tapped, on any screen (app.api.uses `hold`): its buttons are off. */
  const waitsFor = e => !!e && e.ended === false && app.api.uses.hold().at !== 'free';
  const canAct = e => myTurn(e) && !waitsFor(e);
  /** The doc's rows as spots, this hunter's row, the map and the nearest foe its first foe ability aims at. */
  function table(e, h) {
    /** @type {(import('../core/protocol.ts').FightDocRow & import('../core/combat/fight-view.ts').Spot)[]} */
    const spots = e.ended ? [] : docSpots(e.rows);
    const me = meRow(e), grid = docGround(e).grid;
    const list = hunterAbilities(h, app.rules()), first = list.find(a => a.aim === 'foe');
    const foe = me && first ? aims(spots, me.id, first, grid)[0] || null : null;
    return { spots, me, grid, list, foe: foe ? foe.target : null };
  }
  /**
   * The hunter's actions in the fight: each ability (an item through the bag, so one leaves it), and Toward and Away
   * from the nearest foe, a full stride or less. Off while it is not the hunter's turn, or when no tile is better; an
   * ability on cooldown says when it is ready again (`readyIn` over the doc's `ready`) and is off until then.
   */
  function actsHtml(e, h) {
    const t = table(e, h), mine = canAct(e), off = mine ? '' : ' disabled title="Not your turn"';
    if (!t.me) return '';
    const step = dir => (mine && t.foe && t.me.kind !== 'monster' ? (dir > 0 ? stepToward : stepAway)(t.spots, t.me.id, t.foe.id, t.me.stride, t.grid) : null);
    const armed = armedOf(e), answers = answersOf(e, t.list);
    const abil = t.list.map(a => {
      if (a.react) {
        const st = armed && armed.ability === a.id ? (armed.spent ? 'Spent' : 'Armed') : 'Arm';
        return `<li><span class="tb-kn">${esc(a.name)}<small>Reaction</small></span><button type="button" data-arm="${esc(a.id)}" aria-pressed="${st !== 'Arm'}">${st}</button></li>`;
      }
      const left = mine ? readyIn(e.ready, a.id, e.now, app.rules()) : 0, ans = answers[a.id];
      const wait = left > 0 ? ` disabled title="Ready in ${left} round${left === 1 ? '' : 's'}"` : '';
      return `<li><span class="tb-kn">${esc(a.name)}${left > 0 ? `<small data-wait>Ready in ${left} round${left === 1 ? '' : 's'}</small>` : ''}${ans ? `<small class="myth-tag">Answers the omen: ${esc(ans)}</small>` : ''}</span><button type="button" data-cast="${esc(a.id)}"${off || wait}${mine && !wait ? ` title="Use ${esc(a.name)}"` : ''}>Use</button></li>`;
    }).join('');
    const mv = t.foe ? `<div class="tb-kact"><button type="button" data-step="1"${step(1) ? '' : ' disabled'}>Move toward ${esc(t.foe.name)}</button><button type="button" data-step="-1"${step(-1) ? '' : ' disabled'}>Move away from ${esc(t.foe.name)}</button></div>` : '';
    const pass = mine && !t.me.down ? '<div class="tb-kact"><button type="button" data-pass>End turn</button></div>' : '';
    return `<section class="tb-acts" data-acts aria-label="Your actions"><div class="lbl">Abilities</div><ul class="tb-kl">${abil}</ul>${mv}${pass}</section>`;
  }
  function kitHtml(e, h, acts) {
    const mine = myTurn(e), inFight = new Set(hunterAbilities(h, app.rules()).map(a => itemOfAbility(a)));
    const items = (h.items || []).filter(i => i && i.type === 'consumable' && !inFight.has(i.id) && int(i.qty) > 0).slice(0, 12).map(i =>
      `<li><span class="tb-kn">${esc(str(i.name, 60))}<small>×${int(i.qty)}${i.desc ? ' · ' + esc(str(i.desc, 60)) : ''}</small></span><button type="button" data-kit-item="${esc(i.id)}" title="Use ${esc(str(i.name, 60))}">Use</button></li>`).join('');
    return `<section class="tb-kit${mine ? ' my-turn' : ''}" data-kit aria-label="Your abilities"><h3 class="tb-kh">${mine ? 'YOUR TURN' : 'YOUR ABILITIES'}</h3>
      ${acts}
      <div class="lbl">Consumables</div>${items ? `<ul class="tb-kl">${items}</ul>` : '<p class="empty">No consumables.</p>'}
      <div class="tb-kact"><button type="button" class="primary" data-kit-d20 title="Roll d20">Roll d20</button><span class="tb-khint">Press U to jump here</span></div></section>`;
  }
  // background-turn signal (all widths, no layout): retitle the tab while it is my turn and the page is hidden
  const baseTitle = document.title;
  let titled = false;
  function turnTitle() {
    const e = encounter(), want = document.hidden && inRoomPlayer() && !!(e && !e.ended && e.active) && myTurn(e);
    if (want && !titled) { document.title = '▶ Your turn · The Hunter System'; titled = true; }
    else if (!want && titled) { document.title = baseTitle; titled = false; }
  }
  document.addEventListener('visibilitychange', turnTitle);
  app.on('sync:docs', turnTitle);

  const hud = { on: false, order: '', msg: '' };
  app.registerPanel({
    id: 'table-hud', view: 'combat', order: 0, title: 'Fight',
    when: hudOn,
    mount(el) {
      // numeric HP entry on the player's own sheet (never touches the GM's doc): Enter = damage, leading '+' = heal
      const applyAmt = (heal, keep) => {
        const inp = el.querySelector('[data-tbamt]'); if (!inp) return;
        const a = app.api.hunter.parseAmount(inp.value), h = meHunter(encounter());
        if (!h) return;
        const note = t => { const m = el.querySelector('[data-tbmsg]'); if (m) m.textContent = t; hud.msg = t; };
        if (!a) return note(app.api.hunter.amountMsg(inp.value));
        const hpNow = () => { const cur = store.hunter(h.id); return cur ? app.api.hunter.sheet(cur).hp : null; };
        const hl = heal || a.heal, before = hpNow(); if (before === null) return;
        if (!ui.wrote('System', hl ? app.api.hunter.heal(h.id, a.n) : app.api.hunter.damage(h.id, a.n))) return;
        const after = hpNow(); inp.value = '';
        paintHud(el);
        if (after !== null) note(`${hl ? 'Healed' : 'Took'} ${Math.abs(after - before)} HP (entered ${a.n}). Current HP: ${after}.`);
        if (keep) { const i = el.querySelector('[data-tbamt]'); if (i) i.focus(); }
      };
      el.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.matches('[data-tbamt]')) { ev.preventDefault(); if (app.api.hunter.amountFromKey(ev, ev.target.value)) applyAmt(ev.shiftKey, true); } });
      el.addEventListener('click', ev => {
        if (ev.target.closest('[data-mapbox]')) return;
        const fv = ev.target.closest('[data-fview]');
        if (fv) { store.setPrefs({ fightView: fv.dataset.fview === 'map' ? 'map' : 'list' }); cardId = null; paintHud(el); return; }
        if (ev.target.closest('[data-tbsheetx]')) { cardId = null; paintHud(el); return; }
        if (ev.target.closest('[data-pass]')) { pass(); return; }
        const ab = ev.target.closest('[data-arm]');
        if (ab) { const e = encounter(), h = meHunter(e), now = armedOf(e), aid = ab.dataset.arm ?? null; if (h) armTo(e, h, now && now.ability === aid ? null : aid); paintHud(el); return; }
        const kb = ev.target.closest('[data-cast],[data-step],[data-kit-item],[data-kit-d20]');
        if (kb && !kb.disabled) {
          const e = encounter(), h = meHunter(e); if (!h) return;
          const cast = kb.dataset.cast ? hunterAbilities(h, app.rules()).find(a => a.id === kb.dataset.cast) : null, iid = cast ? itemOfAbility(cast) : null;
          if (kb.dataset.cast) { if (cast) { if (iid !== null) app.api.inventory.use(h.id, iid); else void app.api.uses.cast(h.id, cast.id); } }
          else if (kb.dataset.step) walk(e, h, Number(kb.dataset.step));
          else if (kb.dataset.kitItem) app.api.inventory.use(h.id, kb.dataset.kitItem);
          else app.api.dice.roll('1d20', { label: 'd20', hid: h.id });
          paintHud(el); return;
        }
        if (ev.target.closest('[data-tbdmg]')) return applyAmt(false, false);
        if (ev.target.closest('[data-tbheal]')) return applyAmt(true, false);
      });
      D().wire(el, () => paintHud(el));
    },
    update: paintHud,
  });
  // ── a reaction armed ahead (kits design 8.4): the doc names this hunter's row as ready or spent, this phone knows which one ──
  /** This hunter's armed reaction as the hotbar shows it: the one the GM's fight holds for its row (the doc's `reacts`), ready or spent. */
  function armedOf(e) {
    const me = e && !e.ended ? meRow(e) : null, a = me && e.reacts ? e.reacts[me.id] : undefined;
    if (!me || !a) return null;
    return (e.armed || []).includes(me.id) ? { ability: a, spent: false } : (e.spent || []).includes(me.id) ? { ability: a, spent: true } : null;
  }
  /**
   * Arms `ability` for this hunter's row, or disarms with null: the room's `arm` at any time (`ownSheet`). A reaction
   * before a turn waits for a row the player picks from the rows the GM's card offers (fight-view.ts `waitChoices`).
   */
  async function armTo(e, h, ability) {
    const me = e && e.ended === false ? meRow(e) : null; if (!me) return;
    const S = sync(), a = ability && hunterAbilities(h, app.rules()).find(x => x.id === ability), turn = !!a && !!a.react && a.react.when === 'turn';
    const on = turn ? await waitOn(e, me, a) : null;
    if (turn && !on) return;
    const ok = S.post(S.event('arm', { by: S.myKey(h.id), ability, on })).ok;
    ui.news(!ok ? 'Not in a room. The reaction was not armed.' : a ? `${a.name} is armed.` : 'Reaction disarmed.', ok ? 'good' : 'warn');
  }
  /**
   * The row a reaction `a` of row `me` waits for before its turn, picked in a window of `waitChoices` (fight-view.ts);
   * null on Cancel, with no other row, or once the fight is over.
   * @param {import('../core/protocol.ts').FightDoc} e
   */
  async function waitOn(e, me, a) {
    if (e.ended !== false) return null;
    const rows = waitChoices(docSpots(e.rows), me.id); if (!rows.length) return null;
    const on = await ui.system({ tag: '! Fight', title: WAIT_WORDS.label, kind: 'info', body: WAIT_WORDS.body(a.name), layout: 'list',
      actions: [...rows.map((x, i) => ({ label: x.name, value: x.id, primary: i === 0 })), { label: 'Cancel', value: null, cancel: true }] });
    const now = encounter();
    return on && now && now.ended === false ? on : null;
  }
  const ownerName = (e, r) => { const o = rowsOf(e).find(x => x.id === r.owner); return o ? o.name : 'someone'; };
  /** Ends this hunter's turn: a `pass` at the doc's `now`, which the GM's phone takes only on that turn (`onTurn`). */
  function pass() {
    const e = encounter(), h = meHunter(e); if (!e || e.ended !== false || !h || !canAct(e)) return;
    const S = sync();
    void app.api.uses.command(() => S.post(S.event('pass', { by: S.myKey(h.id), at: e.now })))
      .then(r => { if (r && !r.ok) ui.news('Not in a room. Your turn was not ended.', 'warn'); });
  }
  // ── the map (src/views/map.js) over the room's fight doc ──
  /** The token whose card is open over the map, and the map drawn in the HUD (null while the HUD shows no map). */
  let cardId = /** @type {import('../core/combat/ability-types.ts').CombatantId | null} */ (null), mapView = /** @type {import('../core/api.ts').MapView | null} */ (null);
  /** Under 900 px the token's card is a sheet over the map (the CSS's breakpoint for `.tb-sheet`); wider it stands under it. */
  const NARROW = matchMedia('(max-width:899px)');
  /** The card as a sheet over the page is src/core/windows.ts `tokenCard`: Escape on top or a tab takes it down. */
  const shutCard = () => { cardId = null; refresh(); };
  /** The HUD's map leaves the page with the HUD's layout: it stops listening (map.js `destroy`). */
  const unmountMap = () => { if (mapView) { mapView.destroy(); mapView = null; } };
  /** @type {import('../core/api.ts').MapSource} */
  const mapSource = {
    over: () => {
      const e = encounter(); if (!e) return '';
      const d = hudDesc(e, meHunter(e), false);
      return `${d.mine ? 1 : 0}|${d.death ? 1 : 0}|${d.chips.split('class="chip').length - 1}|${d.mythic.length}`;
    },
    input: () => {
      const e = encounter(); if (!e || e.ended !== false) return null;
      const me = meRow(e), ground = docGround(e);
      return { fight: e.id, bodies: docBodies(e.rows, isMine, ground.grid, e.spent ?? []), grid: ground.grid, zones: ground.zones, sight: ground.sight, currentId: e.currentId, actor: me && canAct(e) && isUp(me) ? me.id : null };
    },
    order: () => {
      const e = encounter(); if (!e || e.ended !== false) return [];
      const ids = [...new Set([e.currentId, ...e.ahead].filter(Boolean))];
      return ids.flatMap(id => { const r = e.rows.find(x => x.id === id); return r ? [{ id: r.id, name: r.name }] : []; });
    },
    kit: () => {
      const e = encounter(), h = meHunter(e), me = e && !e.ended ? meRow(e) : null; if (!e || e.ended !== false || !h || !me) return null;
      const ch = me.channel;
      return {
        list: hunterAbilities(h, app.rules()), readyAt: myTurn(e) ? e.ready : {}, now: e.now, costCut: app.api.hunter.sheet(h).sheet.costCut, pinKey: myPinKey(h.id), channel: ch && ch.state === 'holding' ? ch : null,
        armed: armedOf(e), left: myTurn(e) ? e.left ?? {} : {}, answers: answersOf(e, hunterAbilities(h, app.rules())),
        itemOf: id => h.items.find(i => i.id === id) ?? null,
      };
    },
    arm: ability => { const e = encounter(), h = meHunter(e); if (h) armTo(e, h, ability); },
    // the Release of this hunter's channel: a tap on the ability it holds, which the GM's phone takes as its Release
    release: () => {
      const e = encounter(), h = meHunter(e), me = e && meRow(e); if (!h || !me || !me.channel) return;
      void app.api.uses.cast(h.id, me.channel.ability, me.id);
    },
    pass: () => pass(),
    eyes: null,
    paint: null,
    move: (to, dash) => {
      const e = encounter(), h = meHunter(e); if (!e || e.ended !== false || !h || !canAct(e)) return;
      const S = sync();
      void app.api.uses.command(() => S.post(S.event('step', { by: S.myKey(h.id), place: { x: to.x, y: to.y }, at: e.now, dash })))
        .then(r => { if (r && !r.ok) ui.news('Not in a room. Your move was not sent.', 'warn'); });
    },
    place: null,
    use: (a, aim) => {
      const e = encounter(), h = meHunter(e); if (!h || !canAct(e)) return;
      // an item stays in the bag until the GM's fight takes it: the room's `spent` takes it then (fight-save.ts `itemSpent`).
      // The map sends a consumable as a use, held as any use is (the List's goes through the bag: SMX-views-5.1)
      void app.api.uses.cast(h.id, a.id, aim);
    },
    offTurn: () => ui.news(myTurn(encounter()) ? 'Waiting for the GM to process your last action.' : 'It is not your turn.', 'warning'),
    card: id => { cardId = id; refresh(); },
    waiting: () => waitsFor(encounter()),
  };
  /** A token's card over the map: its name, its HP or band, its statuses. */
  function drawSheet(box, e) {
    const r = cardId && !e.ended ? e.rows.find(x => x.id === cardId) : null;
    ui.sheet('tokenCard', !!r && NARROW.matches, shutCard);
    if (!r) { if (!box.hidden) { box.hidden = true; box.innerHTML = ''; box.dataset.sig = ''; } return; }
    const word = lifeWord(r), hp = r.kind === 'monster' ? (word ? '' : BAND_LABEL[r.band]) : `HP ${r.hp} / ${r.hpMax}`;
    const line = [hp && esc(hp), word && `<span class="lw" data-life-at="${r.life.at}">${esc(word)}</span>`, r.id === e.currentId && 'Their turn'].filter(Boolean).join(' · ');
    const html = `<h3>${r.icon ? icon(r.icon) : ''}${esc(r.name)}${isMine(r) ? '<span class="tb-you">YOU</span>' : ''}<button type="button" class="quiet" data-tbsheetx>Close</button></h3>
      <div>${line}</div>${extrasHtml(e, r)}
      ${r.statuses.length ? chipRow('tok-chips', r.id, r.statuses, `${r.name}'s statuses`) : '<div class="tb-conds">No statuses.</div>'}`;
    if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; countStacks(box); }
    box.hidden = false;
  }
  /**
   * What a row shows of design 4 on a player's phone: its shield and rounds left, a monster's stagger bar (and
   * "Staggered" while a break holds it back), its channel's charge, a taunt, a monster's intent (its numbers once the GM
   * reveals them) or, with none, the target its threat suggests.
   */
  function extrasHtml(e, r) {
    const name = id => { const x = rowsOf(e).find(y => y.id === id); return x ? x.name : 'someone'; };
    const at = t => (typeof t === 'string' ? name(t) : `(${t.x}, ${t.y})`);
    const out = [];
    if (!e.ended && (e.armed || []).includes(r.id)) out.push('<div class="tb-x react">Ready to react</div>');
    else if (!e.ended && (e.spent || []).includes(r.id)) out.push('<div class="tb-x react spent">Reacted</div>');
    if (r.kind === 'summon') out.push(`<div class="tb-x summon">Summoned by ${esc(ownerName(e, r))}${r.left !== null ? ` · ${r.left} round${r.left === 1 ? '' : 's'} left` : ''}</div>`);
    if (r.shield !== null) out.push(`<div class="tb-x shield">Shield ${r.shield}${r.shieldLeft !== null ? ` · ${r.shieldLeft} round${r.shieldLeft === 1 ? '' : 's'}` : ''}</div>`);
    if (r.kind === 'monster' && r.stagger) {
      out.push(`<div class="tb-x stagger"><span>Stagger</span><span class="bar bar-stagger" role="img" aria-label="Stagger ${r.stagger.fill} of ${r.stagger.max}">${motion.fillMarkup(r.stagger.max ? r.stagger.fill / r.stagger.max : 0)}</span>${r.stagger.staggered !== null ? `<b>Staggered · loses ${r.stagger.staggered} round${r.stagger.staggered === 1 ? '' : 's'}</b>` : ''}</div>`);
    }
    if (r.channel) out.push(`<div class="tb-x chan">${r.channel.state === 'broken' ? 'Channel broken' : 'Channeling'} ${esc(r.channel.name)} · charge ${r.channel.charge} of ${r.channel.max} · Power ×${r.channel.factor}</div>`);
    if (r.taunt) out.push(`<div class="tb-x taunt">Taunted by ${esc(name(r.taunt.by))}${r.taunt.left !== null ? ` · ${r.taunt.left} round${r.taunt.left === 1 ? '' : 's'}` : ''}</div>`);
    if (r.kind === 'monster' && r.intent && !r.channel) {
      const v = r.intent.reveal;
      out.push(`<div class="tb-x intent" data-intent>Intent: <b>${esc(r.intent.name)}</b> at ${esc(at(r.intent.target))}${v ? `<ul data-reveal>${v.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ' <small>(details hidden by GM)</small>'}</div>`);
    } else if (r.kind === 'monster' && r.suggest && !r.channel) out.push(`<div class="tb-x suggest" data-suggest>Likely target: ${esc(name(r.suggest))}</div>`);
    return out.join('');
  }
  /** A step toward (`dir` 1) or away from (-1) the nearest foe, sent as `step` at the doc's `now`. */
  function walk(e, h, dir) {
    const t = table(e, h); if (!t.me || !t.foe || !canAct(e)) return;
    const s = (dir > 0 ? stepToward : stepAway)(t.spots, t.me.id, t.foe.id, t.me.stride, t.grid); if (!s) return;
    const S = sync();
    void app.api.uses.command(() => S.post(S.event('step', { by: S.myKey(h.id), place: { x: s.place.x, y: s.place.y }, at: e.now, dash: false })))
      .then(r => { if (r && !r.ok) ui.news('Not in a room. Your move was not sent.', 'warn'); });
  }
  /** The bursts of the doc just drawn: a burst at the bearer's token (or its row), and the count on its chips pops. */
  function playBursts(el) {
    if (!pendingBursts.length) return;
    const ids = pendingBursts; pendingBursts = [];
    requestAnimationFrame(() => {
      for (const id of ids) {
        const at = el.querySelector(`[data-mapbox] [data-tok="${CSS.escape(id)}"]`) || el.querySelector(`.tb-row[data-key="${CSS.escape(id)}"]`);
        if (at) void motion.burst('channel', at);
        if (meRow(encounter() || { ended: true })?.id === id) for (const c of el.querySelectorAll('[data-part="chips"] .chip.stk')) void motion.pop(c);
      }
    });
  }
  /**
   * Draws the HUD in place (src/views/patch.ts): its template once per layout, then only what changed. When time moves the
   * rows of the order slide to their new places; "Your turn" arrives once with a pop, then is still.
   * @param {HTMLElement} el
   */
  function paintHud(el) {
    turnTitle();
    const e = encounter();
    const h = e && meHunter(e), onMap = !!e && store.prefs().fightView === 'map', kit = !onMap && !!h && kitOn(), mode = onMap ? 'map' : kit ? 'kit' : 'plain';
    if (!onMap) ui.sheet('tokenCard', false, shutCard); // no map, no card over it
    if (!e) { if (el.dataset.mode) { el.dataset.mode = ''; unmountMap(); el.innerHTML = ''; } hud.on = false; return; }
    if (el.dataset.mode !== mode) {
      el.dataset.mode = mode; unmountMap(); el.innerHTML = onMap ? mapTemplate() : hudTemplate(kit); hud.order = '';
      const msgEl = !onMap ? el.querySelector('[data-tbmsg]') : null;
      if (hud.msg && msgEl) msgEl.textContent = hud.msg;
      const mapBox = onMap ? el.querySelector('[data-mapbox]') : null;
      mapView = mapBox ? app.api.map.mount(mapBox, mapSource) : null;
    }
    hud.on = true;
    if (onMap) {
      const mineWasOn = !!el.querySelector('.tb-mine'), d = hudDesc(e, h, false), first = el.firstElementChild;
      if (first) {
        bind(first, { mine: d.mine, seg: d.seg, mythic: d.mythic, death: d.death, chips: d.chips });
        countStacks(first);
      }
      if (mapView) mapView.draw();
      const sheetBox = el.querySelector('[data-tbsheet]');
      if (sheetBox) drawSheet(sheetBox, e);
      const mineOn = el.querySelector('.tb-mine');
      if (mineOn && !mineWasOn) motion.pop(mineOn);
      playBursts(el);
      return;
    }
    const top = el.firstElementChild, list = el.querySelector('.tb-rows'), rows = rowsOf(e);
    if (!top || !list) return;
    const mineWas = !!el.querySelector('.tb-mine');
    const draw = () => {
      // a status chip that arrives pops on (the chips are a part, drawn whole); the ones already shown stay still
      const chipsWas = new Set([...top.querySelectorAll('[data-chip]')].map(c => c.dataset.chip));
      bind(top, hudDesc(e, h, kit));
      countStacks(top);
      if (chipsWas.size || top.dataset.chipsSeen) for (const c of top.querySelectorAll('[data-chip]')) if (!chipsWas.has(c.dataset.chip)) void motion.pop(c);
      top.dataset.chipsSeen = '1';
      const els = keyed(list, rows.map(r => r.id), id => ui.h(rowTemplate(id)));
      rows.forEach((r, i) => { const rowEl = els[i]; if (rowEl) bind(rowEl, rowDesc(e, r)); });
    };
    const order = rows.map(r => r.id).join();
    motion.slideTo(list, () => list.children, r => r.dataset.key, draw, !!(order && hud.order && order !== hud.order));
    hud.order = order;
    const mine = el.querySelector('.tb-mine');
    if (mine && !mineWas) motion.pop(mine);
    playBursts(el);
  }

  app.on('layout', refresh);
  app.keys.add({ key: 'u', label: 'Jump to your abilities (the first one you can use)', group: 'Combat', view: 'combat',
    when: () => inRoomPlayer() && !!document.querySelector('#view-combat [data-kit]'),
    run: () => { const b = document.querySelector('#view-combat [data-kit] button:not([disabled])'); if (b) b.focus(); } });

  // one-line banner on Status
  app.registerPanel({
    id: 'table-banner', view: 'status', order: 0,
    when: hudOn,
    update(el) {
      const e = encounter(); if (!e || e.ended === true) return;
      const c = curRow(e), mine = c && isMine(c);
      // A4: when the turn is the player's, "Your turn" is what the screen says, large, with no window over it.
      const t = mine ? `▶ Your turn · Round ${roundIn(e)}` : `In a fight · Round ${roundIn(e)}${c ? ` · ${c.name}'s turn` : ''}`;
      if (el.dataset.t !== t) {
        const was = el.dataset.mine === '1'; el.dataset.t = t; el.dataset.mine = mine ? '1' : '';
        el.innerHTML = `<p class="tb-banner${mine ? ' mine' : ''}" role="status">${esc(t)}</p>`;
        if (mine && !was && el.firstElementChild) motion.pop(el.firstElementChild);
      }
    },
  });

  // ───────────────────────── turn cue + end ─────────────────────────
  function onDocs() {
    const e = encounter();
    if (inRoomPlayer() && e) {
      const cur = e.ended === false ? rowsOf(e).find(r => r.id === e.currentId) : null, mine = cur ? myKeys().find(k => k.key === cur.key) : null;
      const no = e.ended === false ? e.refused : null, was = parseTold(cues.read());
      const r = toldAfter(e, was, { turn: mine ? mine.hid : null, refused: !!no && rowsOf(e).some(x => x.id === no.id && isMine(x)) });
      if (r.told !== was) cues.write(r.told); // a failed write is the store's banner
      for (const n of r.news) {
        // a threshold that went off in the GM's last command: each phone shows it once, by its count
        if (n.kind === 'burst') pendingBursts = [...n.ids];
        else if (n.kind === 'refused') ui.news(TABLE_REFUSAL_WORDS[n.reason], 'warning');
        // A4: a toast, not a window: the HUD and the Status banner already say "Your turn" large, and a window would cover them.
        else if (n.kind === 'turn') { ui.news(`Your turn. Round ${roundIn(e)}.`, 'good'); app.emit('combat:turn', { hunterId: n.hid }); }
        else ui.news('The GM cleared the fight.', 'good');
      }
    }
    const sig = e ? JSON.stringify(e.ended === true ? [e.id, e.active, e.ended] : [e.id, e.active, e.ended, e.now, e.currentId, e.rows, e.ready, e.grid, e.zones, e.armed, e.spent, e.reacts, e.left, e.burst]) + inRoomPlayer() : '';
    if (sig !== lastDoc) { lastDoc = sig; if (inRoomPlayer() || hud.on) refresh(); }
  }
  let lastDoc = '';
  /** The bearers whose stacks went off in the doc just taken: drawn as a burst once the HUD shows the doc. */
  let pendingBursts = [];
  app.on('sync:docs', onDocs);

  // ───────────────────────── roll feed out (player) ─────────────────────────
  // Every roll is posted: the outbox keeps it until the room takes it, and says so when a full outbox lets one go.
  // A roll goes as the hunter who rolled it, as its entry in the roll log holds it (dice.js).
  app.on('roll', ({ roll }) => {
    if (!roll || !inRoomPlayer()) return;
    const entry = store.get().rolls.find(r => r.id === roll.id), h = entry && entry.hid ? store.hunter(entry.hid) : null;
    if (!entry || !h) return;
    sync().post(sync().event('roll', { by: sync().myKey(h.id), name: str(h.name, 60), label: str(entry.label, 60), expr: str(roll.expr, 60), total: int(roll.total),
      rolls: (roll.rolls || []).slice(0, 50).map(int), crit: !!roll.crit, fumble: !!roll.fumble }));
  });

  // ───────────────────────── GM Table feed ─────────────────────────
  const feedMemory = store.device('table-feed', 'tab');
  let feed = (r => (Array.isArray(r) ? r.slice(0, FEED_MAX) : []))(feedMemory.read());
  /**
   * The feed's rows are seen once they are in front of the GM (`feedShown`): called on what puts them there (the feed
   * opened, the Combat view or the page shown, a row arriving while it shows), never by a draw. A failed write is the store's banner.
   */
  const markSeen = () => { if (feedShown() && feed.some(f => !f.seen)) { feed = feed.map(f => ({ ...f, seen: true })); feedMemory.write(feed); } };

  // a typed event (parseEvent in src/core/protocol.ts): its fields are as the parser bounded them
  app.on('sync:event', ({ event }) => {
    const { type, payload: p } = event;
    if (!inRoomGM() || (type !== 'roll' && type !== 'questUpdate' && type !== 'used')) return;
    const id = p.eid;
    if (feed.some(f => f.id === id)) return;
    if (type === 'used') {
      feed.unshift({ id, type, name: p.who || 'Player', what: p.what, thing: p.name, text: p.text, by: p.by, target: p.target });
    } else if (type === 'roll') feed.unshift({ id, type, name: p.name || 'Player', label: p.label, expr: p.expr, total: p.total, crit: p.crit, fumble: p.fumble });
    else feed.unshift({ id, type, name: p.name || 'Player', title: p.title.slice(0, 80), secret: p.secret, status: p.status, obj: p.objectives.slice(0, 5).map(o => `${o.label.slice(0, 60)} ${o.progress}/${o.target}`) });
    feed = feed.slice(0, FEED_MAX); feedMemory.write(feed); markSeen(); paintFeed();
  });

  // a feat a player's hunter earned, told once when its pushed sheet first shows it (src/core/hunter/chronicle-view.ts
  // `featsSeen`): what this phone has seen of each sheet is device memory, and a sheet seen for the first time tells nothing
  const seenMemory = store.device('feats-seen');
  app.on('sync:sheets', () => {
    if (!inRoomGM()) return;
    const sheets = app.api.sync.remoteSheets().map(r => ({ key: r.key, name: r.data.name, feats: r.data.chronicle.feats }));
    const was = seenMemory.read(), r = featsSeen(was, sheets);
    if (JSON.stringify(r.seen) !== JSON.stringify(was)) seenMemory.write(r.seen);
    if (!r.told.length) return;
    for (const n of r.told) {
      ui.toast('! Feat', n.line);
      const id = `feat:${n.key}:${n.feat}`;
      if (!feed.some(f => f.id === id)) feed.unshift({ id, type: 'feat', text: n.line });
    }
    feed = feed.slice(0, FEED_MAX); feedMemory.write(feed); markSeen(); paintFeed();
  });

  const WHAT = { item: 'Item', skill: 'Skill', boon: 'Boon' };
  /** A use at a glance: who and what on the first line, then a boon's text. */
  const usedHtml = f => {
    const out = f.what === 'boon' ? f.text || '' : '';
    return `<b>${esc(f.name)}</b> used ${esc(WHAT[f.what] || 'Item')}: <b>${esc(f.thing)}</b>${f.target === 'other' ? ' <span class="tb-on">on a target</span>' : ''}${out ? `<span class="tb-out">${esc(out)}</span>` : ''}`;
  };
  const feedLine = f => f.type === 'feat' ? f.text : f.type === 'roll'
    ? `${f.name} · ${f.label ? `${f.label} ` : ''}${f.expr} = ${f.total}${f.crit ? ' (CRIT)' : f.fumble ? ' (FUMBLE)' : ''}`
    : `${f.name} · Quest "${f.title}"${f.secret ? ` ${SECRET_WORDS.mark}` : ''} ${f.status}${f.obj.length ? ` (${f.obj.join(', ')})` : ''}`;
  // A2: under 1100 px the feed is one line with a count of rows the GM has not seen; a tap opens it. It sticks to the
  // bottom of the screen only while it is shut and has something new. At 1100 px and up it is a column, always open.
  let feedEl = /** @type {HTMLElement | null} */ (null), feedSig = '', feedOpen = false;
  const wide = () => matchMedia('(min-width:1100px)').matches;
  /** The feed's rows are in front of the GM: the combat view is the one shown, the page is, and the feed is open or a column. */
  const feedShown = () => !!feedEl && feedEl.isConnected && !feedEl.closest('[hidden]') && document.visibilityState === 'visible' && (feedOpen || wide());
  function paintFeed() {
    if (!feedEl) return;
    const live = app.api.combat.isActive();
    feedEl.toggleAttribute('data-live', live);
    const fresh = feed.filter(f => !f.seen).length;
    const tog = feedEl.querySelector('[data-tb-open]'), n = feedEl.querySelector('[data-tb-n]'), wrap = feedEl.querySelector('.tb-fwrap'), list = feedEl.querySelector('[data-tb-list]');
    if (!tog || !n || !wrap || !list) return;
    wrap.classList.toggle('open', feedOpen);
    feedEl.toggleAttribute('data-fresh', !feedOpen && fresh > 0);
    tog.setAttribute('aria-expanded', String(feedOpen));
    n.textContent = fresh ? `${fresh} new` : feed.length ? `${feed.length}` : 'Empty';
    n.classList.toggle('new', fresh > 0);
    const sig = JSON.stringify(feed.map(f => f.id));
    if (sig === feedSig) return; feedSig = sig;
    if (!feed.length) { list.innerHTML = '<p class="empty">Player rolls, ability uses, quest updates, and feats appear here.</p>'; return; }
    list.innerHTML = `<ul class="tb-feed" aria-label="Table feed">${feed.map(f =>
      `<li class="${f.type === 'questUpdate' || f.type === 'used' ? 'q' : f.crit ? 'crit' : ''}" data-feed="${esc(f.id)}"><span class="tb-txt">${f.type === 'used' ? usedHtml(f) : esc(feedLine(f))}</span></li>`).join('')}</ul>`;
  }

  app.registerPanel({
    id: 'table-feed', view: 'combat', order: 90, title: 'Table feed', gmOnly: true,
    when: inRoomGM,
    mount(el) {
      feedEl = el;
      el.innerHTML = '<div class="tb-fwrap"><button type="button" class="tb-ftog" data-tb-open aria-expanded="false" aria-controls="tb-flist">Table feed <span class="tb-fn" data-tb-n></span></button><div class="tb-flist" id="tb-flist" data-tb-list></div></div>';
      el.addEventListener('click', ev => {
        if (!ev.target.closest('[data-tb-open]')) return;
        feedOpen = !feedOpen; markSeen(); paintFeed();
        if (feedOpen) el.closest('.panel')?.scrollIntoView({ block: 'nearest' });
      });
      paintFeed();
    },
    update() { paintFeed(); },
  });
  app.on('change', () => { if (feedEl && feedEl.isConnected) paintFeed(); });
  // A view is drawn before its section is shown (app.js `route`), so the paint of that draw sees the feed hidden: the
  // feed's rows are marked seen when it comes on screen, the Combat view shown or the page shown again.
  app.on('view', ({ id }) => { if (id === 'combat') { markSeen(); paintFeed(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { markSeen(); paintFeed(); } });
}

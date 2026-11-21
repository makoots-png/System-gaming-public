// uses.js: a use reaching the GM. A player's phone in a room reports a told use, or one on another, with the room's
// `used` message (src/core/protocol.ts); any other phone writes a told use to its own session log. In the GM's fight a
// player's phone sends a use as `cast` on its own turn (`cast`): the table, the Skills panel and the bag all go through
// it. The aim comes from `aims` (src/core/combat/fight-view.ts) over the room's fight doc, or from the map, the dice from
// src/edge/roll.ts; the GM's phone does the rest (combat.js). Publishes app.api.uses.
import { logLine, logged } from '../core/session-log.ts';
import { toldStep } from '../core/use-told.ts';
import { atHunter, both, isRefused, refuse } from '../core/save-step.ts';
import { notifyHidden } from '../edge/notify.ts';
import { rollDice } from '../edge/roll.ts';
import { aims, docSpots } from '../core/combat/fight-view.ts';
import { diceFor } from '../core/combat/resolve.ts';
import { openGrid } from '../core/combat/space.ts';
import { hunterAbilities } from '../core/combat/rows.ts';
import { rankIdx } from '../edge/rules.ts';
import { useRoute } from '../core/protocol.ts';

/** @type {import('../core/use-told.ts').UseTold} */
const NOBODY = { kind: 'none' };
const WHAT = { item: 'Item', skill: 'Skill', boon: 'Boon' };
/** The session log's words for a use: who used what, then its text (the words `usedLine` of the old use.ts wrote). */
const usedWords = u => ({ title: `${u.who || 'A hunter'} used ${WHAT[u.what] || 'Item'}: ${u.name}`.slice(0, 120), text: String(u.text || '').slice(0, 500) });

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;

  /** A step that writes the session log line of a use (src/core/session-log.ts). */
  const logUse = (hunterId, u) => { const { title, text } = usedWords(u); return logged(logLine(store.id('l'), new Date().toISOString(), 'use', hunterId, title, text), app.rules()); };

  /** The room's running fight and hunter `hid`'s row in it, on a player's phone; null when it has none. */
  const tableOf = hid => {
    if (app.seat() !== 'player') return null;
    const S = app.api.sync, doc = S.doc('fight'); if (!doc || doc.ended || !doc.active) return null;
    const key = S.myKey(hid), me = doc.rows.find(r => r.key === key);
    return me ? { doc, me } : null;
  };
  /** `tableOf(hid)` while it is that row's turn; else null, after the player reads why when the row is in the fight. */
  const turnOf = hid => {
    const t = tableOf(hid); if (!t) return null;
    if (t.doc.currentId !== t.me.id) { ui.news('Not your turn.', 'warning'); return null; }
    return t;
  };

  /**
   * Where use `u` of hunter `h` is told on this phone (src/core/use-told.ts): a player's phone in a room posts `used`, any
   * other phone logs a told use, and a use nobody asked to hear of is told to nobody (`useRoute`).
   * @returns {import('../core/use-told.ts').UseTold}
   */
  const toldOf = (h, u) => {
    const route = useRoute(app.seat(), u), sy = app.api.sync;
    if (route === 'log') { const { title, text } = usedWords({ ...u, who: h.name }); return { kind: 'log', line: logLine(store.id('l'), new Date().toISOString(), 'use', h.id, title, text) }; }
    if (route !== 'post') return NOBODY;
    const room = sy.room(), event = sy.event('used', { by: sy.myKey(h.id), who: h.name, what: u.what, name: u.name, text: u.text, target: u.target, tell: u.tell }); // the room's reader cuts each to its bound
    return room && event ? { kind: 'post', room, event } : NOBODY;
  };

  /** @type {import('../core/api.ts').UsesApi} */
  app.api.uses = {
    told(hid, why, change, u) {
      const h = store.hunter(hid); if (!h) return refuse('no-hunter');
      const t = u ? toldOf(h, u) : NOBODY;
      if (!change && t.kind === 'none') return { ok: true, sent: false };
      const w = store.apply(why, both(change ? atHunter(hid, change) : s => s, toldStep(t, app.rules())));
      if (isRefused(w)) return w;
      if (t.kind !== 'post') return { ok: true, sent: false };
      const sy = app.api.sync;
      sy.flush();
      if (sy.status() !== 'connected') ui.toast('Sync', `The GM is told about ${u.name} when the room answers.`, { kind: 'info' });
      return { ok: true, sent: true };
    },
    async report(hid, u) { return app.api.uses.told(hid, 'use-report', null, u); },
    onTable: hid => !!tableOf(hid),
    async cast(hid, abilityId, given) {
      const h = store.hunter(hid), t = turnOf(hid); if (!h || !t) return null;
      const a = hunterAbilities(h, app.rules()).find(x => x.id === abilityId); if (!a) return null;
      /** @type {import('../core/protocol.ts').CastPayload['aim']} */
      let aim = t.me.id;
      if (given !== undefined) aim = typeof given === 'string' ? given : { x: given.x, y: given.y }; // the map picked it (map-view.ts)
      else if (a.aim !== 'self') {
        const list = aims(docSpots(t.doc.rows), t.me.id, a, openGrid(t.doc.grid.w, t.doc.grid.h)).filter(x => x.inRange && x.inShape);
        if (!list.length) { ui.news(`Nobody in reach of ${a.name}. Step toward a foe first.`, 'warning'); return null; }
        const id = await ui.system({ tag: '! Combat', title: `Use ${a.name} on…`, layout: 'list',
          actions: [...list.map((x, i) => ({ label: `${x.target.name} · ${x.dist} tile${x.dist === 1 ? '' : 's'}`, value: x.target.id, primary: i === 0 })), { label: 'Cancel', value: null, cancel: true }] });
        const pick = id ? list.find(x => x.target.id === id) : null; if (!pick) return null;
        aim = a.aim === 'place' ? { x: pick.target.place.x, y: pick.target.place.y } : pick.target.id;
      }
      // the window answers later, over a doc that may have moved on: the cast goes at the doc of this moment, on the turn then
      const at = turnOf(hid); if (!at) return null;
      const S = app.api.sync, dice = diceFor(a, rankIdx(h.rank), app.rules()).map(d => rollDice(d));
      return S.post(S.event('cast', { by: S.myKey(h.id), ability: a.id, aim, at: at.doc.now, dice }));
    },
  };

  // ── the GM's phone: a told use goes in the session log once per event id, with a toast, and a notification when the
//    page is hidden and the GM allowed them (src/edge/notify.ts) ──
  // (the Table feed's row is table.js's)
  app.on('sync:event', ({ event: ev }) => {
    if (!app.isGM() || ev.type !== 'used' || !ev.payload.tell) return;
    const p = ev.payload, words = usedWords(p);
    if (!app.api.sync.once(p.eid, logUse(null, p))) return;
    ui.toast('! Used', words.title, { kind: 'info' });
    void notifyHidden(words.title, words.text, p.eid);
  });
}

// feats.js: the window of a feat a hunter on this phone earned (src/core/hunter/feats.ts; feature 1's notes 5.7). The
// notice step earns it in the write of the fact that earned it; this module only tells it: each earned feat not yet
// told (told.ts `hunterNews`) opens a System window in the feat's words with its reward's lines, and is marked told in the
// campaign's told memory when answered (src/core/told.ts, `store.tell`), so a reload while it waits shows it again.
// Writes nothing to the save. It publishes the GM's feats as the room's feats doc (`featsDoc`); a player's phone reads them from it.
import { featWindow, featsDoc } from '../core/hunter/feats.ts';
import { hunterNews } from '../core/told.ts';
import { DOC_MAX } from '../core/protocol.ts';

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  /** The feats asked of the player and not answered yet, by hunter and key, so a second change does not queue a second window. */
  const asking = new Set();
  /**
   * Each feat earned and not told gets its window, oldest first (told.ts `hunterNews`); a feat its book no longer holds
   * is told by its name.
   */
  function tell() {
    const s = store.get(), book = app.api.chronicle.book(), many = s.hunters.length > 1;
    for (const h of s.hunters) {
      const told = store.told(), topic = { of: /** @type {const} */ ('feat'), hunter: h.id };
      for (const key of hunterNews(told, h, 'feat')) {
        const id = `${h.id}|${key}`;
        if (asking.has(id)) continue;
        asking.add(id);
        const def = book.find(([k]) => k === key)?.[1], st = h.chronicle.feats[key];
        const w = def ? featWindow(def, app.rules()) : { title: st && st.at === 'earned' ? st.name.toUpperCase() : 'FEAT EARNED', body: '', lines: [] };
        void ui.system({ tag: '! Feat', kind: 'levelup', title: w.title, body: `${many ? `${h.name}: ` : ''}${w.body}`, rewards: w.lines, actions: [{ label: 'Understood', value: null, primary: true }] })
          .then(() => { asking.delete(id); store.tell({ type: 'answered', campaign: told.campaign, topic, id: key }); });
      }
    }
  }
  // after the task that wrote: the window of the thing that earned the feat (a quest's, a run's) is queued first
  store.subscribe(() => queueMicrotask(tell));
  // the GM's feats reach the players' phones in the room's feats doc (feature 1's notes 3.2), as the rules do
  app.api.sync.publish('feats', () => featsDoc(store.get().library.feats, DOC_MAX).doc);
  app.on('ready', tell);
}

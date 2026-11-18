// feats.js: the window of a feat a hunter on this phone earned (src/core/hunter/feats.ts; feature 1's notes 5.7). The
// notice step earns it in the write of the fact that earned it; this module only tells it: each earned feat not yet
// told (`featNews`) opens a System window in the feat's words with its reward's lines, and is marked told in device
// memory when answered (`feat-told:<hid>`), so a reload while it waits shows it again. Writes nothing to the save.
import { featNews, featWindow, featsFor } from '../core/hunter/feats.ts';
import { BUILT_IN_FEATS } from '../core/registry/feats.ts';

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  /** The feats asked of the player and not answered yet, by hunter and key, so a second change does not queue a second window. */
  const asking = new Set();
  /** The feats told on this phone, per hunter: device memory, never in the save. */
  const toldMemory = hid => store.device('feat-told:' + hid);
  const toldOf = memory => { const raw = memory.read(); return Array.isArray(raw) ? raw.filter(x => typeof x === 'string') : []; };
  /** Each feat earned and not told gets its window, oldest first; a feat its book no longer holds is told by its name. */
  function tell() {
    const s = store.get(), book = featsFor(app.rules(), BUILT_IN_FEATS, app.seat() === 'player' ? {} : s.library.feats), many = s.hunters.length > 1;
    for (const h of s.hunters) {
      const memory = toldMemory(h.id);
      for (const key of featNews(h.chronicle.feats, toldOf(memory))) {
        const id = `${h.id}|${key}`;
        if (asking.has(id)) continue;
        asking.add(id);
        const def = book.find(([k]) => k === key)?.[1], st = h.chronicle.feats[key];
        const w = def ? featWindow(def, app.rules()) : { title: st && st.at === 'earned' ? st.name.toUpperCase() : 'FEAT EARNED', body: '', lines: [] };
        void ui.system({ tag: '! Feat', kind: 'levelup', title: w.title, body: `${many ? `${h.name}: ` : ''}${w.body}`, rewards: w.lines, actions: [{ label: 'Understood', value: null, primary: true }] })
          .then(() => { asking.delete(id); toldMemory(h.id).write([...toldOf(toldMemory(h.id)), key].slice(-400)); });
      }
    }
  }
  // after the task that wrote: the window of the thing that earned the feat (a quest's, a run's) is queued first
  store.subscribe(() => queueMicrotask(tell));
  app.on('ready', tell);
}

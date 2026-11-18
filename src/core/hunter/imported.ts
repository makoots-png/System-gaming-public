// imported.ts: hunters from another campaign's file added to this party (the Data view's "Add hunters to party",
// io.js). The hunters come read: the file went through `parseSave` (save.ts), so each is a `Hunter` of that file, and
// this step gives it this save's ids. The store's repair after the step checks what depends on this campaign (a build
// path its rules do not have). A campaign file from before schema 4 is refused before this (io.js, IMPORT_ERRORS.old).
// A new hunter of this phone is `addHunter` (party.ts).
import { saveId } from '../ids.ts';
import type { IdOf, ItemId, QuestId, TitleId } from '../ids.ts';
import type { Hunter, Save } from '../save.ts';
import type { Slot } from '../registry/items.ts';
import { penaltyMoved } from './penalty.ts';
import { chainMoved } from './job-chain.ts';
import { newSolo } from '../gates/personal.ts';

/**
 * The save with copies of `incoming` added to its hunters, the first made the active one. Every hunter and every entry
 * of its lists gets a fresh id from the save's `seq` (another phone's ids collide with ours), in the order titles,
 * quests, skills, items, shadows, loadouts, then the hunter. What names an entry follows it to its new id: the title
 * worn, the items worn and in each loadout, and the quest of the penalty and of the Job Change chain; one that names no
 * entry of the file is none (a penalty without its quest is none, as the repair reads it). Its personal gates were
 * another campaign's System's: it starts with none and its clock off. No hunters: the save as it was.
 */
export function withImportedHunters<S extends Pick<Save, 'hunters' | 'seq' | 'settings'>>(save: S, incoming: readonly Hunter[]): S {
  if (!incoming.length) return save;
  let seq = save.seq;
  const next = <P extends string>(prefix: P): IdOf<P> => saveId(prefix, ++seq);
  const added = incoming.map((from): Hunter => {
    const h = structuredClone(from);
    const titles = new Map<string, TitleId>(), quests = new Map<string, QuestId>(), items = new Map<string, ItemId>();
    const moved = <T extends string>(ids: Map<string, T>, id: string | null | undefined): T | null => (id ? ids.get(id) ?? null : null);
    h.titles = h.titles.map(t => { const id = next('t'); if (!titles.has(t.id)) titles.set(t.id, id); return { ...t, id }; });
    h.quests = h.quests.map(q => { const id = next('q'); if (!quests.has(q.id)) quests.set(q.id, id); return { ...q, id }; });
    h.skills = h.skills.map(s => ({ ...s, id: next('s') }));
    h.items = h.items.map(i => { const id = next('i'); if (!items.has(i.id)) items.set(i.id, id); return { ...i, id }; });
    h.shadows = h.shadows.map(x => ({ ...x, id: next('sh') }));
    h.loadouts = h.loadouts.map(l => {
      const slots: Partial<Record<Slot, ItemId>> = {};
      for (const [slot, id] of Object.entries(l.slots) as [Slot, ItemId][]) { const to = moved(items, id); if (to) slots[slot] = to; }
      return { ...l, id: next('lo'), slots };
    });
    h.titleId = moved(titles, h.titleId);
    for (const slot of Object.keys(h.equipped) as Slot[]) h.equipped[slot] = moved(items, h.equipped[slot]);
    const quest = (id: QuestId): QuestId | null => moved(quests, id);
    return { ...h, penalty: penaltyMoved(h.penalty, quest), jobChain: chainMoved(h.jobChain, quest, () => next('q')), solo: newSolo(), id: next('h') };
  });
  return { ...save, seq, hunters: [...save.hunters, ...added], settings: { ...save.settings, activeHunterId: added[0]!.id } };
}

// quest-form.ts: the Quests view's quest form, from the tap that opens it to its Save or Cancel (SMX-views-4,
// SMX-gates-9.3). Pure. The form is captured when it opens: a new quest's form for the role it was drawn for and the
// hunter on screen, an edit for the role, the hunter and the quest it edits. The screen moving under it (another
// hunter chosen, the GM/Player switch) closes it, so a Save writes only to the hunter and with the role the form was
// drawn for (quests.js `submitForm` reads both from here). The view keeps the state (`form`) and moves it only here.
import type { Role } from '../role.ts';
import type { HunterId, QuestId } from '../ids.ts';

/** The form shut; a new quest's form; an edit of quest `qid` of hunter `hid`. `role`: the role its fields were drawn for. */
export type QuestFormState =
  | { readonly at: 'closed' }
  | { readonly at: 'new'; readonly role: Role; readonly hid: HunterId }
  | { readonly at: 'editing'; readonly role: Role; readonly hid: HunterId; readonly qid: QuestId };
/**
 * What moves the form: + New quest or Edit (or a Reopen that needs a new due time) tapped with the screen's role and
 * hunter; Save quest saved; Cancel; and `seen`, the screen as it is now (its role and hunter), told on every draw and
 * before a Save.
 */
export type QuestFormEvent =
  | { readonly type: 'new'; readonly role: Role; readonly hid: HunterId }
  | { readonly type: 'edit'; readonly role: Role; readonly hid: HunterId; readonly qid: QuestId }
  | { readonly type: 'saved' }
  | { readonly type: 'cancelled' }
  | { readonly type: 'seen'; readonly role: Role; readonly hid: HunterId };

/** Every state of the form, by its `at`. */
export const QUEST_FORM_STATES = ['closed', 'new', 'editing'] as const satisfies readonly QuestFormState['at'][];
export const QUEST_FORM_CLOSED: QuestFormState = { at: 'closed' };

/**
 * The form after `e`. Opening one form over another replaces it; a Save or Cancel closes it; the screen seen with a
 * role or hunter other than the form's closes it, and as it was leaves it. A closed form stays closed but for an opening.
 */
export function questFormStep(s: QuestFormState, e: QuestFormEvent): QuestFormState {
  switch (e.type) {
    case 'new': return { at: 'new', role: e.role, hid: e.hid };
    case 'edit': return { at: 'editing', role: e.role, hid: e.hid, qid: e.qid };
    case 'saved': case 'cancelled': return QUEST_FORM_CLOSED;
    case 'seen': return s.at === 'closed' || (s.role === e.role && s.hid === e.hid) ? s : QUEST_FORM_CLOSED;
  }
}

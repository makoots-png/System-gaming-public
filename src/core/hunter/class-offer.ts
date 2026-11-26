// class-offer.ts: sole writer of `Save.classOffer` (besides save.ts defaults/repair/export).
// Owns opening/closing the first-mission & GM unique-class offer, deriving `DOCS.classOffer` live from
// `Save.classHolders` (zero duplicate claim state), handling local and remote `classPick` claims atomically through
// `claimUniqueClass`, stat-fit matching, and voice.md-compliant copy. Pure.
import { parseSaveId, parseSheetKey } from '../ids.ts';
import type { EventId, GateId, HunterId, RoomCode, SheetKey } from '../ids.ts';
import { newEvent } from '../protocol.ts';
import type { ClassOfferDoc, ClassOfferTaken, ClassPickRefusal, EventStamp } from '../protocol.ts';
import { setCapDisplay } from './progress.ts';
import { atOutbox, post } from '../sync/outbox.ts';
import type { Rules } from '../rules.ts';
import type { Hunter, Save } from '../save.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { told } from '../session-log.ts';
import type { StatKey } from '../stats.ts';
import { BUILT_IN_CLASSES, classDefOf, isUniqueClass } from '../registry/jobs.ts';
import type { UniqueClassName } from '../registry/jobs.ts';
import { CLASS_SIGNATURES } from '../registry/class-powers.ts';
import type { ClassSignatureMap } from '../registry/class-powers.ts';
import { CLASS_LOCKER_CAP, CLASS_TREES } from '../registry/class-trees.ts';
import type { ClassTreeMap } from '../registry/class-trees.ts';
import {
  CLASS_OFFER_MAX_HUNTERS,
  CLASS_OFFER_MAX_POOL,
  WAVE1_EPIC_OFFER,
  WAVE1_MYTHIC_OFFER,
  WAVE1_OFFER_POOL,
} from './class-locker.ts';
import type { ClassHolder, ClassOffer } from './class-locker.ts';
import { HOLDER_REFUSAL_WORDS, claimUniqueClass, classesHeldBy } from './class-holders.ts';
import type { HolderStepCtx, HolderTarget } from './class-holders.ts';
import { CLASS_RARITY_LABEL, pairShortLabel } from './class-view.ts';

export { WAVE1_EPIC_OFFER, WAVE1_MYTHIC_OFFER, WAVE1_OFFER_POOL };
export type { ClassOffer };

const stamp36 = (at: string): string => {
  const t = Date.parse(at);
  return Number.isFinite(t) && t >= 0 ? Math.trunc(t).toString(36) : '0';
};
const makeOfferId = (seq: number, at: string): string => `co${seq}-${stamp36(at)}`;

/**
 * Opens (or replaces) the GM's unique-class offer in one atomic save step.
 * Clears `classOffer` on `gateId` (when opened from a gate) so the starter prompt does not repeat.
 * When `liftCap` is true (defaulting to `Boolean(opts.gateId)`), also sets `capDisplay: 'none'` on every local hunter
 * and queues a single `capSet` room event for `remoteKeys` in the same write.
 */
export function openClassOffer(
  save: Save,
  opts: {
    readonly at: string;
    readonly room: RoomCode | null;
    readonly R: Rules;
    readonly pool?: readonly UniqueClassName[];
    readonly hunters?: readonly string[];
    readonly gateId?: GateId | null;
    readonly liftCap?: boolean;
    readonly remoteKeys?: readonly SheetKey[];
    readonly stamp?: EventStamp | null;
  },
): { readonly save: Save; readonly offer: ClassOffer; readonly capPosted: boolean } {
  const nextSeq = save.seq + 1;
  const rawPool = opts.pool && opts.pool.length ? opts.pool : WAVE1_OFFER_POOL;
  const pool: UniqueClassName[] = [];
  for (const cls of rawPool) {
    if (pool.length >= CLASS_OFFER_MAX_POOL) break;
    if (isUniqueClass(cls) && !pool.includes(cls)) pool.push(cls);
  }
  const finalPool: readonly UniqueClassName[] = pool.length ? pool : WAVE1_OFFER_POOL;
  const hunters: string[] = [];
  for (const raw of opts.hunters ?? []) {
    if (hunters.length >= CLASS_OFFER_MAX_HUNTERS) break;
    const ok = parseSaveId<'h'>(raw) ?? parseSheetKey(raw);
    if (ok && !hunters.includes(ok)) hunters.push(ok);
  }
  const offer: ClassOffer = {
    id: makeOfferId(nextSeq, opts.at),
    at: opts.at,
    room: opts.room,
    pool: finalPool,
    hunters,
  };
  const shouldLift = opts.liftCap ?? Boolean(opts.gateId);
  const nextHunters = shouldLift ? save.hunters.map(h => setCapDisplay(h, 'none')) : save.hunters;
  const gates = opts.gateId
    ? save.gates.map(g => (g.id === opts.gateId && g.classOffer ? { ...g, classOffer: false } : g))
    : save.gates.map(g => (g.classOffer && g.bossFell ? { ...g, classOffer: false } : g));
  let s = told(
    { ...save, seq: nextSeq, hunters: nextHunters, gates, classOffer: offer },
    { at: opts.at, cap: opts.R.logCap },
    {
      kind: 'system',
      hunterId: null,
      title: shouldLift ? 'Cap lifted and class offer opened' : 'Class offer opened',
      text: shouldLift ? `Set Cap: none for the table and offered ${finalPool.join(', ')}.` : `Offered ${finalPool.join(', ')}.`,
    },
  );
  let capPosted = false;
  if (shouldLift && opts.room && opts.stamp && opts.remoteKeys && opts.remoteKeys.length > 0) {
    const to = [...new Set(opts.remoteKeys)];
    const ev = newEvent('capSet', { to, cap: 'none' }, opts.stamp);
    if (ev) {
      const room = opts.room;
      s = atOutbox(box => post(box, room, { kind: 'event', event: ev }, null).box)(s);
      capPosted = true;
    }
  }
  return { save: s, offer, capPosted };
}

/** Closes the GM's active unique-class offer in one atomic save step. */
export function closeClassOffer(
  save: Save,
  opts: { readonly at: string; readonly R: Rules },
): Save | Refused<'no-offer'> {
  if (!save.classOffer) return refuse('no-offer');
  return told(
    { ...save, classOffer: null },
    { at: opts.at, cap: opts.R.logCap },
    { kind: 'system', hunterId: null, title: 'Class offer closed', text: 'Closed the class offer.' },
  );
}

/**
 * Builds the GM's `DOCS.classOffer` room document from `save.classOffer` and `save.classHolders`.
 * - Returns `{ active: false, at }` when no offer is open or when the offer belongs to a different room.
 * - Derives `taken` strictly for classes in `offer.pool` in `pool` order (canonical key order).
 * - Redacts NPC holder names to `''` so unrevealed campaign boss NPCs never leak over the wire.
 */
export function classOfferDocOf(
  save: Pick<Save, 'classOffer' | 'classHolders' | 'hunters' | 'settings'>,
  at: string,
  remoteNames?: ReadonlyMap<SheetKey, string>,
): ClassOfferDoc {
  const offer = save.classOffer;
  if (!offer || offer.room !== save.settings.sync.room) return { active: false, at };
  const localNames = new Map(save.hunters.map(h => [h.id, h.name]));
  const taken: Partial<Record<UniqueClassName, ClassOfferTaken>> = {};
  for (const cls of offer.pool) {
    const holder = save.classHolders.held[cls];
    if (!holder) continue;
    if (holder.kind === 'remote') {
      taken[cls] = { who: holder.sheetKey, name: remoteNames?.get(holder.sheetKey) ?? holder.name };
    } else if (holder.kind === 'local') {
      taken[cls] = { who: 'gm', name: localNames.get(holder.hunterId) ?? holder.name };
    } else {
      // Redact secret NPC names on the wire so players never learn unrevealed villain identities.
      taken[cls] = { who: 'gm', name: '' };
    }
  }
  const hunters = offer.hunters.flatMap(x => {
    const key = parseSheetKey(x);
    return key ? [key] : [];
  });
  return {
    active: true,
    id: offer.id,
    at,
    pool: [...offer.pool],
    hunters,
    taken,
  };
}

export type OfferPickTarget = Extract<HolderTarget, { kind: 'local' | 'remote' }>;
/** Why a pick is refused: the wire's list (protocol.ts `CLASS_PICK_REFUSALS`), so every refusal can be told to the player. */
export type OfferPickRefusal = ClassPickRefusal;

/**
 * Processes one hunter's pick from the open class offer (local or remote) atomically through `claimUniqueClass`.
 * Enforces offer id, pool membership, hunter eligibility, one-pick-per-hunter from the pool, and uniqueness.
 */
export function pickClassFromOffer(
  save: Save,
  target: OfferPickTarget,
  cls: string,
  offerId: string,
  ctx: HolderStepCtx,
): { readonly save: Save; readonly holder: ClassHolder } | Refused<OfferPickRefusal> {
  const offer = save.classOffer;
  if (!offer) return refuse('no-offer');
  if (offer.id !== offerId) return refuse('wrong-offer');
  if (!isUniqueClass(cls) || !offer.pool.includes(cls)) return refuse('not-in-pool');
  if (offer.hunters.length > 0) {
    const key = target.kind === 'local' ? target.hunterId : target.sheetKey;
    if (!offer.hunters.includes(key)) return refuse('not-eligible');
  }
  const heldByTarget = classesHeldBy(save, target);
  if (heldByTarget.some(c => offer.pool.includes(c))) return refuse('already-picked');
  return claimUniqueClass(save, cls, target, ctx);
}

/**
 * A player's pick `pick` (its event id) from the offer, answered in the same write: `pickClassFromOffer`, and on a
 * refusal a `classPickRefused` to that phone in the outbox with why, so it leaves "Claiming" (statechart rule 5). Nothing
 * is queued without a room. Answers the save, the holder on success and the refusal.
 */
export function pickAnswered(
  save: Save,
  by: { readonly sheetKey: SheetKey; readonly name: string },
  cls: string,
  offerId: string,
  pick: EventId,
  ctx: HolderStepCtx,
): { readonly save: Save; readonly holder: ClassHolder | null; readonly why: OfferPickRefusal | null } {
  const r = pickClassFromOffer(save, { kind: 'remote', ...by }, cls, offerId, ctx);
  if (!isRefused(r)) return { save: r.save, holder: r.holder, why: null };
  const ev = ctx.room && ctx.stamp && isUniqueClass(cls)
    ? newEvent('classPickRefused', { to: [by.sheetKey], pick, className: cls, why: r.why }, ctx.stamp)
    : null;
  const room = ctx.room;
  return { save: ev && room ? atOutbox(box => post(box, room, { kind: 'event', event: ev }, null).box)(save) : save, holder: null, why: r.why };
}

/**
 * Returns the open class(es) in `pool` whose stat pair best matches `h`'s spent stats.
 * Returns an empty set when all stats are flat/unspent so no arbitrary class is tagged.
 */
export function bestFitClasses(
  h: Pick<Hunter, 'stats'>,
  pool: readonly UniqueClassName[],
  taken: Readonly<Partial<Record<UniqueClassName, unknown>>>,
): ReadonlySet<UniqueClassName> {
  const open = pool.filter(cls => !taken[cls]);
  if (!open.length) return new Set();
  const scores = open.map(cls => {
    const def = classDefOf(cls);
    if (!def) return { cls, score: 0 };
    const [a, b] = def.pair.split('+') as [StatKey, StatKey];
    return { cls, score: (h.stats[a] ?? 0) + (h.stats[b] ?? 0) };
  });
  let max = -Infinity;
  let min = Infinity;
  for (const s of scores) {
    if (s.score > max) max = s.score;
    if (s.score < min) min = s.score;
  }
  if (max <= min) return new Set();
  return new Set(scores.filter(s => s.score === max).map(s => s.cls));
}

/** Pure view-model row for one class card in the class offer window. */
export type OfferCardView = {
  readonly className: UniqueClassName;
  readonly rarity: 'mythic' | 'epic';
  readonly rarityLabel: string;
  readonly pairLabel: string;
  readonly hasKit: boolean;
  readonly fitsStats: boolean;
  readonly takenBy: string | null;
  readonly takenAnonymous: boolean;
  readonly heldByMe: boolean;
  readonly open: boolean;
};

/** Pure view-model for a hunter viewing an active class offer (local GM pick or remote player phone). */
export type ClassOfferViewModel = {
  readonly offerId: string;
  readonly mythics: readonly OfferCardView[];
  readonly epics: readonly OfferCardView[];
  readonly myPicked: UniqueClassName | null;
  readonly allTaken: boolean;
  readonly openCount: number;
  readonly totalCount: number;
};

/**
 * Builds the pure view-model for one hunter against an active `ClassOfferDoc` (or local GM offer doc). Which class is
 * the hunter's comes from the doc alone (`taken[cls].who === myWho`), never from its locker, which follows the holders
 * doc and may be a poll behind, or hold a parked copy from another campaign (statechart rule 7).
 */
export function classOfferView(
  doc: Extract<ClassOfferDoc, { active: true }>,
  opts: {
    readonly hunter: Pick<Hunter, 'stats' | 'classes'> | null;
    readonly myWho: SheetKey | 'gm' | null;
    readonly signatures?: ClassSignatureMap;
    readonly trees?: ClassTreeMap;
  },
): ClassOfferViewModel {
  const signatures = opts.signatures ?? CLASS_SIGNATURES;
  const trees = opts.trees ?? CLASS_TREES;
  const fits = opts.hunter ? bestFitClasses(opts.hunter, doc.pool, doc.taken) : new Set<UniqueClassName>();
  let openCount = 0;

  const cards: OfferCardView[] = doc.pool.map(cls => {
    const def = BUILT_IN_CLASSES[cls];
    const t = doc.taken[cls];
    const heldByMe = !!t && opts.myWho !== null && opts.myWho !== 'gm' && t.who === opts.myWho;
    const open = !t;
    if (open) openCount++;
    return {
      className: cls,
      rarity: def.rarity === 'mythic' ? 'mythic' : 'epic',
      rarityLabel: CLASS_RARITY_LABEL[def.rarity],
      pairLabel: pairShortLabel(def.pair),
      hasKit: Boolean(signatures[cls] || trees[cls]),
      fitsStats: open && fits.has(cls),
      takenBy: t && t.name ? t.name : null,
      takenAnonymous: !!t && !t.name,
      heldByMe,
      open,
    };
  });

  const mythics = cards.filter(c => c.rarity === 'mythic');
  const epics = cards.filter(c => c.rarity === 'epic');
  const myPicked = cards.find(c => c.heldByMe)?.className ?? null;
  return {
    offerId: doc.id,
    mythics,
    epics,
    myPicked,
    allTaken: openCount === 0,
    openCount,
    totalCount: cards.length,
  };
}

/** Exact the owner t148u lost-race / taken notice (voice.md compliant). */
export function classTakenLine(cls: string, holderName: string | null | undefined): string {
  const clean = typeof holderName === 'string' ? holderName.trim() : '';
  return clean ? `${cls} is taken. ${clean} holds it. Pick another.` : `${cls} is taken. Pick another.`;
}

/** Plain-English copy for the first-mission & GM unique-class offer (voice.md compliant). */
export const OFFER_WORDS = {
  tag: '! Class offer',
  title: 'Pick a class',
  openBody: 'Six classes are open. Pick one class. Only one hunter can hold each class.',
  fitsBadge: 'Fits your stats',
  epicHeading: 'Epic classes',
  mythicHeading: 'Mythic classes',
  epicKeepNote: 'You keep it even if you earn a Mythic class later.',
  allTakenNotice: 'All offered classes are taken. Ask the GM to grant or reassign a class.',
  pickAction: 'Pick class',
  pickingAction: (cls: string): string => `Claiming ${cls}...`,
  takenBadge: (name: string | null): string => (name ? `Held by ${name}` : 'Taken'),
  pickedBadge: 'Your class',
  alreadyPickedLine: (cls: string): string => `You hold ${cls}.`,
  gmOpenButton: 'Offer classes',
  gmLiftAndOfferButton: 'Lift cap and offer classes',
  gmManageButton: 'Manage class offer',
  gmCloseButton: 'Close offer',
  gmOfferOpenBadge: 'Offer open',
  gmPickForLabel: 'Pick for local hunter',
  gmNoLocalHunters: 'No local hunters without an offered class.',
  gmOfferTitle: 'Class offer',
  gmOfferRoomHint: 'Players in the room can pick one open class on their phones. You can claim a class for a local hunter below. When everyone has picked, tap Close offer, then tap Clear gate in the Gates tab.',
  gmOfferLocalHint: 'Select a local hunter and pick one unique class for them. Only one hunter can hold each class.',
  gmOpenedToast: 'Class offer is open.',
  gmLiftAndOpenedToast: 'Cap lifted and class offer is open.',
  gmClosedToast: 'Class offer closed.',
  gmPlayerClaimedToast: (who: string, cls: string): string => `${who} claimed ${cls}.`,
  playerBannerTitle: 'Class offer is open',
  playerBannerAction: 'Pick a class',
  gatePromptNote: 'This gate grants a unique-class offer. Tap Lift cap and offer classes so each hunter can pick one class, or tap Mark gate cleared.',
  releasedNotice: (cls: string): string => `The GM released ${cls}. Pick a class.`,
  sendFailed: 'Could not send your class pick to the room. Try again.',
} as const;

/**
 * What a player's phone says when the GM's phone refused its pick (`classPickRefused`), in the player's own terms:
 * the offer's refusals, with the hunter's own state told as theirs.
 */
export const pickRefusedLine: (why: OfferPickRefusal, cls: string) => string = (why, cls) => ({
  ...OFFER_REFUSAL_WORDS,
  'class-taken': classTakenLine(cls, null),
  held: 'Your hunter is in the GM\'s fight. Pick a class after the fight ends.',
  dead: 'Your hunter is down. Pick a class after the GM revives your hunter.',
  'locker-full': `Your class locker is full (${CLASS_LOCKER_CAP} classes).`,
  'foreign-class': `You already have parked progress for ${cls} from another campaign.`,
  'no-hunter': 'Your hunter is not in the GM\'s list for this room. Ask the GM to check the room.',
} satisfies Record<OfferPickRefusal, string>)[why];

/** Plain-English refusal messages for `pickClassFromOffer` (voice.md compliant). */
export const OFFER_REFUSAL_WORDS: Readonly<Record<OfferPickRefusal, string>> = {
  ...HOLDER_REFUSAL_WORDS,
  'no-offer': 'No class offer is open right now.',
  'wrong-offer': 'That class offer has closed. Check the current offer.',
  'not-in-pool': 'That class is not part of the current offer.',
  'not-eligible': 'Your hunter is not part of this class offer.',
  'already-picked': 'You already picked a class from this offer.',
};

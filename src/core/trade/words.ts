// words.ts: the words of trading on screen (src/views/trade.js) that offer.ts and goods.ts do not say: the Give window,
// the Bag's Offers tab, the stranded record's window and the GM's section. Pure. From notes-5-trade.md section 7; the
// lines the notes did not give are listed in docs/agent-handoff/copy-tasks.md for the lead's second reading.
import { goodsWords, pickWords } from './goods.ts';
import type { BagPick, Goods } from './goods.ts';
import type { Offer } from './offer.ts';

/** " for 20 gold", or nothing for a gift. */
const forWords = (asks: BagPick): string => (asks.items.length || asks.gold ? ` for ${pickWords(asks)}` : '');

export const TRADE_WORDS = {
  tag: 'Trade', undo: 'Undo', cancel: 'Cancel', give: 'Give', takeBack: 'Take back',
  // the Give window
  title: (item: string): string => `Give ${item}`, titleGold: 'Give gold',
  howMany: 'How many', have: (n: number): string => `You have ${n}.`, gold: 'Gold', haveGold: (n: number): string => `You have ${n} gold.`,
  to: 'To', inRoom: 'In the room', onPhone: 'On this phone', nobody: 'No other hunter to give to.',
  ask: 'Ask in return', fromBag: (name: string): string => `From ${name}'s bag`,
  hint: (name: string): string => `${name} can accept or refuse. Your items and gold stay set aside until then.`,
  offerTo: (name: string): string => `Offer to ${name}`, giveTo: (name: string): string => `Give to ${name}`,
  offered: (name: string, what: BagPick): string => `You offered ${name} ${pickWords(what)}. See your Bag, under Offers.`,
  handed: (from: string, to: string, what: BagPick): string => `${from} gave ${to} ${pickWords(what)}.`,
  // the Bag's Offers tab
  toYou: 'Offers to you', yours: 'Your offers', none: 'No offers.', accept: 'Accept', refuse: 'Refuse',
  yourLine: (o: Offer): string => `You offer ${o.names.to} ${goodsWords(o.gives)}${forWords(o.asks)}.`,
  exchange: (o: Offer): string => `You give ${pickWords(o.asks)} for ${goodsWords(o.gives)}.`,
  // a stranded record's window
  strandedTitle: 'Take back?',
  strandedGiver: (o: Offer): string => `The room closed before this offer ended, so the app cannot tell whether ${o.names.to} accepted. If ${o.names.to} did, ${o.names.to} has ${goodsWords(o.gives)} too. The GM can check every finished trade in the session log.`,
  strandedTaker: (o: Offer, aside: Goods): string => `The room closed before your answer was settled, so the app cannot tell whether ${o.names.by} got your ${goodsWords(aside)}. The GM can check every finished trade in the session log.`,
  // the GM view's "Trades and stash" section
  trading: 'Trading', on: 'On', off: 'Off', open: 'Open offers', noOpen: 'No open offers.', stop: 'Stop',
  gmLine: (o: Offer): string => `${o.names.by} offers ${o.names.to} ${goodsWords(o.gives)}${forWords(o.asks)}.`,
  stopping: 'Stopped. Waiting for the room server.',
  stopped: (o: Offer): string => `Stopped ${o.names.by}'s offer to ${o.names.to}.`,
  summary: (open: number): string => (open ? `${open} open offer${open === 1 ? '' : 's'}` : ''),
  removeLine: (name: string): string => `${name}'s open offers stay set aside until ${name} returns to the room. Stop them first to return ${name}'s items and gold on their next visit.`,
} as const;

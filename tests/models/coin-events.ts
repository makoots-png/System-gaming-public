// A coin of a natural 20 and the events of its short life, and the GM's window for two calls. Shared by tests/coin.test.ts and the state chart
// (scripts/charts/coin.ts), so both walk the same events.
import { rollId } from '../../src/core/coin.ts';
import type { Coin, CoinEvent, CoinFields, CoinPromptEvent, CoinState, CoinSide } from '../../src/core/coin.ts';
import { hid } from '../fixtures/ids.ts';

/** Asha's Strength check that showed a natural 20. */
export const fields = (): CoinFields => ({ id: rollId('d-asha:r12')!, hunter: { kind: 'local', hunterId: hid('h1') }, who: 'Asha', what: 'STR check', face: 20 });
/** That coin in `at`: called heads, landed tails. */
export function coinIn(at: CoinState, call: CoinSide = 'heads', side: CoinSide = 'tails'): Coin {
  if (at === 'uncalled') return { ...fields(), at };
  if (at === 'called') return { ...fields(), at, call };
  return { ...fields(), at, call, side };
}

/** Four events: each call and each landing. */
export const WALK_EVENTS: CoinEvent[] = [
  { type: 'call', side: 'heads' }, { type: 'call', side: 'tails' }, { type: 'land', side: 'heads' }, { type: 'land', side: 'tails' },
];

// ── the GM's window for the calls (the coin prompt, SMX-views-7) ──
/** Two calls the GM's phone holds, oldest first. */
export const CALL_A = rollId('d-kai:r1')!, CALL_B = rollId('d-ren:r4')!;
/** The prompt's events over both calls: the calls in the air as each change leaves them, each answer of the window, and a tap on each put-off call. */
export const PROMPT_WALK: readonly CoinPromptEvent[] = [
  { type: 'seen', open: [] }, { type: 'seen', open: [CALL_A] }, { type: 'seen', open: [CALL_B] }, { type: 'seen', open: [CALL_A, CALL_B] },
  { type: 'ruled' }, { type: 'putOff' },
  { type: 'reopen', id: CALL_A }, { type: 'reopen', id: CALL_B },
];

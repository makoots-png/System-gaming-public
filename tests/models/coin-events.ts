// A coin of a natural 20 and the events of its short life. Shared by tests/coin.test.ts and the state chart
// (scripts/charts/coin.ts), so both walk the same events.
import { rollId } from '../../src/core/coin.ts';
import type { Coin, CoinEvent, CoinFields, CoinState, CoinSide } from '../../src/core/coin.ts';
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

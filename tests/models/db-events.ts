// The room server's database at its start and the events of its life, walked by the state chart (scripts/charts/db.ts);
// tests/statecharts.test.ts checks the walk reaches every state. tests/room-server.test.ts checks each cell.
import type { Db, DbEvent } from '../../src/core/room-server.ts';

/** A store, as the machine sees it: something it holds while ready. */
export type AnyStore = { readonly name: 'store' };
export const STORE: AnyStore = { name: 'store' };
/** The database as the server starts it. */
export const START: Db<AnyStore> = { at: 'opening' };
/** Postgres answers; Postgres refuses the connection (twice, at two times, so a second failure is walked). */
export const WALK_EVENTS: readonly DbEvent<AnyStore>[] = [
  { type: 'opened', store: STORE },
  { type: 'failed', at: 1000, error: 'ERR_POSTGRES_CONNECTION_REFUSED' },
  { type: 'failed', at: 2000, error: 'ERR_POSTGRES_CONNECTION_REFUSED' },
];

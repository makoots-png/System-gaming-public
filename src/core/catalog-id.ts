// catalog-id.ts: a GM's item catalog id derived from its key, `cat-` and the first 20 hex characters of the key's
// SHA-256. The phone derives it offline when it mints its first custom item, and server.ts derives the same id, so no
// one can claim a catalog id without its key.
import { sha256Hex } from './sha256.ts';
import type { CatalogId, CatalogKey } from './ids.ts';

/** The catalog id that `key` owns. */
export const catalogIdOf = (key: CatalogKey): CatalogId => `cat-${sha256Hex(key).slice(0, 20)}` as CatalogId;

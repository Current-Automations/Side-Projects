/**
 * lib/catalog — the Pokemon card catalog.
 *
 * Deep module: callers import from here only, never from TCGdex or Supabase
 * directly (mirrors lib/pricing, lib/ai, lib/db).
 *
 * Two halves:
 *  - source + transform (this commit): fetch TCGdex records and map them onto
 *    the migration 002 row shapes. Used by scripts/ingest-catalog.ts.
 *  - store-backed queries (getCard / findCardsByNumber / searchCards / listSets):
 *    land with the ingest wiring, once a live Supabase project exists. They read
 *    catalog_cards, not TCGdex.
 */

export {
  fetchSet,
  fetchCard,
  fetchSetList,
  type CatalogSourceResult,
} from './source';

export {
  toCatalogSetRow,
  toCatalogCardRow,
  cardImageUrl,
  possibleFinishes,
  type CatalogSetRow,
  type CatalogCardRow,
  type ImageQuality,
  type ImageFormat,
} from './transform';

export { dhash, hammingDistance } from './phash';

export type {
  TcgdexCard,
  TcgdexSet,
  TcgdexSetListEntry,
  TcgdexSetCardBrief,
} from './schemas';

/** Scarlet & Violet era — the v1 ingest scope. Widen by prefix later. */
export const V1_SET_PREFIX = 'sv';

/**
 * lib/catalog — the Pokemon card catalog.
 *
 * Deep module: callers import from here only, never from TCGdex or Supabase
 * directly (mirrors lib/pricing, lib/ai, lib/db).
 *
 * Three parts:
 *  - source + transform: fetch TCGdex records and map them onto the migration
 *    002 row shapes. Used by scripts/ingest-catalog.ts.
 *  - store (lib/ai/match.ts's catalog lookup): reads catalog_cards, not TCGdex.
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

export {
  findCatalogCard,
  getCatalogCardById,
  getSetName,
  findStampedReprint,
  type CatalogDbResult,
} from './store';

export { dhash, hammingDistance } from './phash';

export type {
  TcgdexCard,
  TcgdexSet,
  TcgdexSetListEntry,
  TcgdexSetCardBrief,
} from './schemas';

/** Scarlet & Violet era — the v1 ingest scope. Widen by prefix later. */
export const V1_SET_PREFIX = 'sv';

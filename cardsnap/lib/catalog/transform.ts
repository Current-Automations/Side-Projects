/**
 * lib/catalog/transform.ts
 *
 * Pure functions mapping a validated TCGdex record onto the row shapes in
 * migration 002_pokemon_catalog.sql. No IO. The ingest job composes
 * source.ts (fetch) -> here (transform) -> lib/db (write).
 */

import type { TcgdexCard, TcgdexSet } from './schemas';

export interface CatalogSetRow {
  id: string;
  name: string;
  series_id: string | null;
  series_name: string | null;
  card_count_official: number | null;
  card_count_total: number | null;
  release_date: string | null;
  symbol_url: string | null;
  logo_url: string | null;
  raw: unknown;
}

export interface CatalogCardRow {
  id: string;
  set_id: string;
  local_id: string;
  name: string;
  supertype: string | null;
  subtypes: string[] | null;
  rarity: string | null;
  illustrator: string | null;
  dex_ids: number[] | null;
  variants: unknown | null;
  variants_detailed: unknown | null;
  image_base_url: string | null;
  tcgplayer_prices: unknown | null;
  cardmarket_prices: unknown | null;
  tcgdex_updated_at: string | null;
  raw: unknown;
}

export type ImageQuality = 'high' | 'low';
export type ImageFormat = 'png' | 'webp' | 'jpg';

/**
 * TCGdex serves images from a base URL with no extension; the quality and
 * format are appended. `high` is 600x825 (~95KB jpg), `low` ~250px.
 * Returns null when the record carries no image base (some promos).
 */
export function cardImageUrl(
  imageBaseUrl: string | null | undefined,
  quality: ImageQuality = 'high',
  format: ImageFormat = 'jpg'
): string | null {
  if (!imageBaseUrl) return null;
  const base = imageBaseUrl.replace(/\/+$/, '');
  return `${base}/${quality}.${format}`;
}

function str(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  return String(value);
}

/** Best-effort subtype list — TCGdex splits these across several fields. */
function subtypesOf(card: TcgdexCard): string[] | null {
  const parts = [card.stage, card.suffix, card.trainerType, card.energyType].filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  );
  return parts.length ? parts : null;
}

export function toCatalogSetRow(set: TcgdexSet): CatalogSetRow {
  return {
    id: set.id,
    name: set.name,
    series_id: set.serie?.id ?? null,
    series_name: set.serie?.name ?? null,
    card_count_official: set.cardCount?.official ?? null,
    card_count_total: set.cardCount?.total ?? null,
    release_date: set.releaseDate ?? null,
    symbol_url: set.symbol ?? null,
    logo_url: set.logo ?? null,
    raw: set,
  };
}

export function toCatalogCardRow(card: TcgdexCard, setId: string): CatalogCardRow {
  const pricing = (card.pricing ?? {}) as { tcgplayer?: unknown; cardmarket?: unknown };
  return {
    id: card.id,
    set_id: card.set?.id ?? setId,
    local_id: str(card.localId) ?? '',
    name: card.name,
    supertype: card.category ?? null,
    subtypes: subtypesOf(card),
    rarity: card.rarity ?? null,
    illustrator: card.illustrator ?? null,
    dex_ids: card.dexId ?? null,
    variants: card.variants ?? null,
    variants_detailed: card.variants_detailed ?? null,
    image_base_url: card.image ?? null,
    tcgplayer_prices: pricing.tcgplayer ?? null,
    cardmarket_prices: pricing.cardmarket ?? null,
    tcgdex_updated_at: card.updated ?? null,
    raw: card,
  };
}

/**
 * Which finishes a card exists in, from the TCGdex `variants` flags.
 * The closed candidate set for stage-2 finish resolution and the game's Mode B.
 */
export function possibleFinishes(card: TcgdexCard): string[] {
  const v = card.variants ?? {};
  const out: string[] = [];
  if (v.normal) out.push('normal');
  if (v.holo) out.push('holo');
  if (v.reverse) out.push('reverse');
  if (v.firstEdition) out.push('first_edition');
  if (v.wPromo) out.push('promo');
  return out;
}

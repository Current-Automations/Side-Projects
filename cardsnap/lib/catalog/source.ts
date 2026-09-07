/**
 * lib/catalog/source.ts
 *
 * Thin client for the TCGdex v2 API. Fetches + validates; no transform, no
 * persistence. Points at the public API by default; set CATALOG_TCGDEX_BASE to
 * a self-hosted instance (docker-compose in github.com/tcgdex/cards-database)
 * for offline, rate-limit-free ingest.
 *
 * Language segment is required by TCGdex. English only for v1.
 */

import {
  TcgdexCardSchema,
  TcgdexSetSchema,
  TcgdexSetListSchema,
  type TcgdexCard,
  type TcgdexSet,
  type TcgdexSetListEntry,
} from './schemas';

const DEFAULT_BASE = 'https://api.tcgdex.net/v2';
const LANG = 'en';

export type CatalogSourceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function baseUrl(): string {
  return (process.env.CATALOG_TCGDEX_BASE ?? DEFAULT_BASE).replace(/\/+$/, '');
}

async function getJson(path: string): Promise<CatalogSourceResult<unknown>> {
  const url = `${baseUrl()}/${LANG}/${path}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `tcgdex fetch failed (${path}): ${message}` };
  }
  if (!res.ok) {
    return { success: false, error: `tcgdex ${res.status} for ${path}` };
  }
  try {
    return { success: true, data: await res.json() };
  } catch {
    return { success: false, error: `tcgdex returned non-JSON for ${path}` };
  }
}

function formatZodError(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

/** Full record for one set, including the brief card list. */
export async function fetchSet(setId: string): Promise<CatalogSourceResult<TcgdexSet>> {
  const raw = await getJson(`sets/${encodeURIComponent(setId)}`);
  if (!raw.success) return raw;
  const parsed = TcgdexSetSchema.safeParse(raw.data);
  if (!parsed.success) {
    return { success: false, error: `set ${setId} shape: ${formatZodError(parsed.error.issues)}` };
  }
  return { success: true, data: parsed.data };
}

/** Full record for one card. */
export async function fetchCard(cardId: string): Promise<CatalogSourceResult<TcgdexCard>> {
  const raw = await getJson(`cards/${encodeURIComponent(cardId)}`);
  if (!raw.success) return raw;
  const parsed = TcgdexCardSchema.safeParse(raw.data);
  if (!parsed.success) {
    return { success: false, error: `card ${cardId} shape: ${formatZodError(parsed.error.issues)}` };
  }
  return { success: true, data: parsed.data };
}

/** Every set TCGdex knows about, brief form. Filter to an era before ingesting. */
export async function fetchSetList(): Promise<CatalogSourceResult<TcgdexSetListEntry[]>> {
  const raw = await getJson('sets');
  if (!raw.success) return raw;
  const parsed = TcgdexSetListSchema.safeParse(raw.data);
  if (!parsed.success) {
    return { success: false, error: `set list shape: ${formatZodError(parsed.error.issues)}` };
  }
  return { success: true, data: parsed.data };
}

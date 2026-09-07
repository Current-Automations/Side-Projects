/**
 * scripts/ingest-catalog.ts
 *
 * Phase 1.3 — pull the Pokemon catalog from TCGdex into catalog_sets and
 * catalog_cards. Idempotent and incremental: a card is only re-written when its
 * TCGdex `updated` timestamp is newer than what we stored, and new sets are
 * added without touching existing rows.
 *
 * Image ingest (catalog_card_images + the catalog-images bucket + phash) is a
 * separate pass, added once the Storage bucket exists.
 *
 *   npm run catalog:ingest -- [--all | --prefix sv,swsh | --set sv03] [--limit 5] [--dry-run] [--force]
 *
 * Default scope is the Scarlet & Violet era (--prefix sv). --all ingests every
 * set TCGdex knows about; --prefix takes a comma list of set-id prefixes.
 *
 * Source: the public TCGdex API by default; set CATALOG_TCGDEX_BASE to a
 * self-hosted instance for offline, rate-limit-free ingest.
 */

import { getServerClient } from '../lib/db/server-client';
import {
  fetchSet,
  fetchCard,
  fetchSetList,
  toCatalogSetRow,
  toCatalogCardRow,
  V1_SET_PREFIX,
} from '../lib/catalog';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const ONLY_SET = opt('set');
const ALL = flag('all');
const PREFIXES = (opt('prefix') ?? V1_SET_PREFIX).split(',').map((p) => p.trim()).filter(Boolean);
const LIMIT = Number(opt('limit') ?? '0') || 0;
const DRY_RUN = flag('dry-run');
const FORCE = flag('force');
const CARD_CONCURRENCY = 8;

const db = getServerClient();

/** TCGdex sends e.g. +01:00; Postgres stores timestamptz as UTC. Compare as instants. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

async function existingCardTimestamps(setId: string): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const { data, error } = await db
    .from('catalog_cards')
    .select('id, tcgdex_updated_at')
    .eq('set_id', setId);
  if (error) throw new Error(`read existing cards (${setId}): ${error.message}`);
  for (const row of data ?? []) map.set(row.id as string, (row.tcgdex_updated_at as string) ?? null);
  return map;
}

type SetStats = { set: string; total: number; written: number; skipped: number; failed: number };

async function ingestSet(setId: string): Promise<SetStats> {
  const stats: SetStats = { set: setId, total: 0, written: 0, skipped: 0, failed: 0 };

  const setRes = await fetchSet(setId);
  if (!setRes.success) throw new Error(setRes.error);
  const set = setRes.data;
  const briefs = set.cards ?? [];
  stats.total = briefs.length;

  if (!DRY_RUN) {
    const { error } = await db.from('catalog_sets').upsert({
      ...toCatalogSetRow(set),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`upsert set ${setId}: ${error.message}`);
  }

  const known = FORCE ? new Map<string, string | null>() : await existingCardTimestamps(setId);
  const slice = LIMIT ? briefs.slice(0, LIMIT) : briefs;

  await mapPool(slice, CARD_CONCURRENCY, async (brief) => {
    const cardRes = await fetchCard(brief.id);
    if (!cardRes.success) {
      stats.failed++;
      console.warn(`  ! ${brief.id}: ${cardRes.error}`);
      return;
    }
    const card = cardRes.data;
    const upstream = card.updated ?? null;
    if (!FORCE && known.has(card.id) && sameInstant(known.get(card.id) ?? null, upstream)) {
      stats.skipped++;
      return;
    }
    if (DRY_RUN) {
      stats.written++;
      return;
    }
    const { error } = await db.from('catalog_cards').upsert({
      ...toCatalogCardRow(card, setId),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      stats.failed++;
      console.warn(`  ! ${card.id}: ${error.message}`);
      return;
    }
    stats.written++;
  });

  return stats;
}

/** Pokemon TCG Pocket (digital-only, no physical cards): set ids like A1 / A2a / B1 / P-A. */
const isDigitalOnly = (id: string) => /^[AB]\d/.test(id) || id === 'P-A';

async function resolveSetIds(): Promise<string[]> {
  if (ONLY_SET) return [ONLY_SET];
  const list = await fetchSetList();
  if (!list.success) throw new Error(list.error);
  const ids = list.data.map((s) => s.id).filter((id) => !isDigitalOnly(id));
  if (ALL) return ids.sort();
  return ids.filter((id) => PREFIXES.some((p) => id === p || id.startsWith(p))).sort();
}

async function main() {
  const setIds = await resolveSetIds();
  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}ingesting ${setIds.length} set(s): ${setIds.join(', ')}`
  );

  const all: SetStats[] = [];
  for (const setId of setIds) {
    process.stdout.write(`  ${setId} ... `);
    try {
      const s = await ingestSet(setId);
      all.push(s);
      console.log(`${s.written} written, ${s.skipped} skipped, ${s.failed} failed (of ${s.total})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`FAILED: ${message}`);
      all.push({ set: setId, total: 0, written: 0, skipped: 0, failed: 1 });
    }
  }

  const sum = (k: keyof SetStats) => all.reduce((n, s) => n + (s[k] as number), 0);
  console.log(
    `\ndone: ${sum('written')} written, ${sum('skipped')} skipped, ${sum('failed')} failed across ${all.length} set(s)`
  );
  if (sum('failed') > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

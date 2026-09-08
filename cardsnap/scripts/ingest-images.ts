/**
 * scripts/ingest-images.ts
 *
 * Phase 1.3b — download the upstream TCGdex card image for every catalog_cards
 * row into the `catalog-images` Storage bucket and write a catalog_card_images
 * row (source 'upstream', finish null, review_status 'approved') with a dHash.
 *
 * Reads catalog_cards, not TCGdex. Run ingest-catalog first. Idempotent: a card
 * that already has an upstream image row is skipped unless --force.
 *
 *   npm run catalog:images -- [--prefix sv,swsh | --set sv03] [--dex-range 1-151]
 *                             [--max-width 600] [--limit 20] [--dry-run] [--force]
 *
 * --prefix    comma list of set-id prefixes (default: all cards in the DB).
 * --dex-range lo-hi national dex filter, keeps a card only if any of its
 *             dex_ids falls in the range. '1-151' is the Kanto (original 151)
 *             vertical, the v1 identifier scope.
 * --max-width downscale to this width (never upscale) before hashing and
 *             upload. The modern-era images are 600x825, so --max-width 600
 *             keeps the whole corpus dimensionally uniform and under the free
 *             Storage tier.
 */

import { getServerClient } from '../lib/db/server-client';
import { cardImageUrl, dhash } from '../lib/catalog';
import sharp from 'sharp';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const ONLY_SET = opt('set');
const PREFIXES = (opt('prefix') ?? '').split(',').map((p) => p.trim()).filter(Boolean);
const [DEX_LO, DEX_HI] = (opt('dex-range') ?? '').split('-').map((n) => Number(n) || 0);
const MAX_WIDTH = Number(opt('max-width') ?? '0') || 0;
const LIMIT = Number(opt('limit') ?? '0') || 0;
const DRY_RUN = flag('dry-run');
const FORCE = flag('force');
const CONCURRENCY = 4;
const BUCKET = 'catalog-images';
const PAGE = 1000;
const RETRY_DELAYS_MS = [500, 1500, 4000];

const db = getServerClient();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with retry on network error and 5xx / 429. Returns the body or throws. */
async function fetchImage(url: string): Promise<Buffer> {
  let lastStatus = 0;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastStatus = res.status;
      if (res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt === RETRY_DELAYS_MS.length) throw err;
    }
  }
  throw new Error(`HTTP ${lastStatus} after ${RETRY_DELAYS_MS.length} retries`);
}

async function mapPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) await fn(items[cursor++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

async function pagedSelect<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type CardRow = { id: string; set_id: string; image_base_url: string | null; dex_ids: number[] | null };

async function main() {
  const allCards = await pagedSelect<CardRow>((from, to) => {
    const cols = 'id, set_id, image_base_url, dex_ids';
    const base = db.from('catalog_cards').select(cols).order('id').range(from, to);
    return ONLY_SET ? db.from('catalog_cards').select(cols).eq('set_id', ONLY_SET).order('id').range(from, to) : base;
  });
  const byPrefix = PREFIXES.length
    ? allCards.filter((c) => PREFIXES.some((p) => c.set_id === p || c.set_id.startsWith(p)))
    : allCards;
  const cards = DEX_HI
    ? byPrefix.filter((c) => Array.isArray(c.dex_ids) && c.dex_ids.some((n) => n >= DEX_LO && n <= DEX_HI))
    : byPrefix;

  const done = FORCE
    ? new Set<string>()
    : new Set(
        (
          await pagedSelect<{ catalog_card_id: string }>((from, to) =>
            db
              .from('catalog_card_images')
              .select('catalog_card_id')
              .eq('source', 'upstream')
              .order('catalog_card_id')
              .range(from, to)
          )
        ).map((r) => r.catalog_card_id)
      );

  const pending = cards.filter((c) => !done.has(c.id));
  const todo = LIMIT ? pending.slice(0, LIMIT) : pending;

  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}${cards.length} cards, ${cards.length - pending.length} already imaged, ${todo.length} to fetch${LIMIT ? ` (--limit ${LIMIT})` : ''}`
  );

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  await mapPool(todo, CONCURRENCY, async (card) => {
    const url = cardImageUrl(card.image_base_url, 'high', 'jpg');
    if (!url) {
      skipped++;
      return;
    }
    try {
      let buf = await fetchImage(url);
      if (MAX_WIDTH) {
        buf = await sharp(buf)
          .resize({ width: MAX_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
      }
      const meta = await sharp(buf).metadata();
      const phash = await dhash(buf);

      if (DRY_RUN) {
        ok++;
        return;
      }

      const path = `upstream/${card.id}.jpg`;
      const up = await db.storage
        .from(BUCKET)
        .upload(path, buf, { contentType: 'image/jpeg', upsert: true });
      if (up.error) {
        failed++;
        console.warn(`  ! ${card.id}: storage ${up.error.message}`);
        return;
      }

      if (FORCE) {
        await db
          .from('catalog_card_images')
          .delete()
          .eq('catalog_card_id', card.id)
          .eq('source', 'upstream');
      }

      const ins = await db.from('catalog_card_images').insert({
        catalog_card_id: card.id,
        finish: null,
        source: 'upstream',
        storage_path: path,
        width: meta.width ?? null,
        height: meta.height ?? null,
        phash,
        review_status: 'approved',
      });
      if (ins.error) {
        // 23505 = the one-upstream-per-card unique index (migration 003). Another
        // run already wrote this card; the upload was an idempotent overwrite.
        if (ins.error.code === '23505') {
          skipped++;
          return;
        }
        failed++;
        console.warn(`  ! ${card.id}: insert ${ins.error.message}`);
        return;
      }
      ok++;
      if (ok % 200 === 0) console.log(`  ... ${ok} done`);
    } catch (err) {
      failed++;
      console.warn(`  ! ${card.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  console.log(`\ndone: ${ok} imaged, ${skipped} no-image, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

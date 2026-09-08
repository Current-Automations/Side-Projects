-- CardSnap, guard against duplicate upstream image rows
--
-- The image ingest is meant to hold exactly one 'upstream' row per catalog card
-- (source TCGdex serves one image per collector number). A concurrency slip in
-- the 2026-09-07 Kanto backfill ran two ingests at once and inserted ~3,160
-- cards twice. The rows were deduped by hand; this index stops it recurring: a
-- second upstream insert for a card now fails cleanly instead of adding a row.
--
-- Partial, so 'break-frame' and 'shop-photo' can still hold many rows per card.
--
-- Run in: Supabase Dashboard -> SQL Editor (after 002_pokemon_catalog.sql)

create unique index if not exists idx_catalog_card_images_one_upstream
  on public.catalog_card_images (catalog_card_id)
  where source = 'upstream';

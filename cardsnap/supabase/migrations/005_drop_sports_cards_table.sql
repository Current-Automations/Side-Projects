-- CardSnap — Drop the sports-shaped `cards` table
--
-- Migration 002 added catalog_sets/catalog_cards/catalog_card_images and left
-- the original sports-shaped `cards` table in place, noting it was unused
-- (no rows) and would be dropped "once nothing references it." As of the
-- 2026-09-14 identify/match/pricing rewrite (Pokemon-first, matching the
-- 2026-09-07 decision), nothing in the app queries `cards` anymore —
-- lib/ai/match.ts and app/api/card/[id]/prices/route.ts now read
-- catalog_cards via lib/catalog/store.ts instead.
--
-- scan_logs.card_id / scan_logs.final_card_id referenced cards(id) as uuid.
-- catalog_cards.id is TEXT (TCGdex ids like 'sv03-125', not a uuid), so those
-- columns are retyped to text and re-pointed at catalog_cards before the old
-- FKs and table are dropped. Both columns already went unused in the
-- sports-card era (no rows were ever inserted into `cards`), so no data
-- migration is needed for the type change either.
--
-- Run in: Supabase Dashboard -> SQL Editor (after 001-004)

alter table public.scan_logs drop constraint if exists scan_logs_card_id_fkey;
alter table public.scan_logs drop constraint if exists scan_logs_final_card_id_fkey;

alter table public.scan_logs alter column card_id type text using card_id::text;
alter table public.scan_logs alter column final_card_id type text using final_card_id::text;

alter table public.scan_logs
  add constraint scan_logs_card_id_fkey
  foreign key (card_id) references public.catalog_cards(id);
alter table public.scan_logs
  add constraint scan_logs_final_card_id_fkey
  foreign key (final_card_id) references public.catalog_cards(id);

drop table if exists public.cards;

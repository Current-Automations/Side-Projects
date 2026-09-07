-- CardSnap, Pokemon catalog
-- Phase 1.2 of the Pokemon-first rebuild. Adds a clean catalog namespace
-- (catalog_sets, catalog_cards, catalog_card_images) alongside the sports-shaped
-- `cards` table, which is unused (no rows) and gets dropped in a later migration
-- once nothing references it.
--
-- Column shapes follow TCGdex's actual response (see lib/catalog/schemas.ts).
-- One catalog_cards row per printed collector number. Finishes are the
-- variants_detailed jsonb list, not rows, because TCGdex serves one image per
-- collector number for every finish, so a row-per-finish would carry no
-- distinguishing data. catalog_card_images is where images sit next to a known
-- label, the thing the scan path never provided.
--
-- Run in: Supabase Dashboard -> SQL Editor (after 001_initial_schema.sql)

create extension if not exists vector;

-- ─────────────────────────────────────────────
-- catalog_sets: one row per TCGdex set (e.g. sv03 Obsidian Flames)
-- ─────────────────────────────────────────────

create table public.catalog_sets (
  id                   text        primary key,          -- TCGdex set id, e.g. 'sv03'
  name                 text        not null,
  series_id            text,                             -- TCGdex serie.id, e.g. 'sv'
  series_name          text,                             -- e.g. 'Scarlet & Violet'
  card_count_official  integer,                          -- printed set size
  card_count_total     integer,                          -- includes secret / alt-art rares above official
  release_date         date,
  symbol_url           text,
  logo_url             text,
  raw                  jsonb       not null,             -- untouched TCGdex record
  updated_at           timestamptz not null default now()
);

alter table public.catalog_sets enable row level security;

create policy "Catalog sets are publicly readable"
  on public.catalog_sets for select using (true);

-- ─────────────────────────────────────────────
-- catalog_cards: one row per printed collector number
-- ─────────────────────────────────────────────

create table public.catalog_cards (
  id                 text        primary key,            -- TCGdex card id, e.g. 'sv03-125'
  set_id             text        not null references public.catalog_sets(id) on delete cascade,
  local_id           text        not null,               -- printed number, text ('125', non-numeric for some promos)
  name               text        not null,
  supertype          text,                               -- TCGdex 'category': Pokemon | Trainer | Energy
  subtypes           jsonb,                              -- best-effort: stage / trainerType / energyType / suffix
  rarity             text,
  illustrator        text,
  dex_ids            jsonb,                              -- national dex numbers of the Pokemon on the card
  variants           jsonb,                              -- the boolean flags: {firstEdition, holo, normal, reverse, wPromo}
  variants_detailed  jsonb,                              -- verbatim TCGdex variants_detailed (finish list + per-variant pricing)
  image_base_url     text,                               -- TCGdex base, no quality/extension; see lib/catalog image helpers
  tcgplayer_prices   jsonb,                              -- pricing.tcgplayer
  cardmarket_prices  jsonb,                              -- pricing.cardmarket
  tcgdex_updated_at  timestamptz,                        -- TCGdex 'updated', drives incremental re-pull
  raw                jsonb       not null,
  updated_at         timestamptz not null default now()
);

alter table public.catalog_cards enable row level security;

create policy "Catalog cards are publicly readable"
  on public.catalog_cards for select using (true);

create index idx_catalog_cards_set_id     on public.catalog_cards (set_id);
create index idx_catalog_cards_local_id   on public.catalog_cards (set_id, local_id);
create index idx_catalog_cards_name       on public.catalog_cards (name);

-- ─────────────────────────────────────────────
-- catalog_card_images: images next to a known label, the point of the exercise.
-- ─────────────────────────────────────────────

create table public.catalog_card_images (
  id               uuid        primary key default gen_random_uuid(),
  catalog_card_id  text        not null references public.catalog_cards(id) on delete cascade,
  finish           text,                                 -- which finish this image depicts; null for the upstream image (depicts all)
  source           text        not null check (source in ('upstream', 'break-frame', 'shop-photo')),
  storage_path     text,                                 -- Supabase Storage, bucket 'catalog-images'
  width            integer,
  height           integer,
  phash            text,                                 -- perceptual hash, cheap pre-filter + sanity cross-check
  embedding        vector(768),                          -- CLIP/DINOv2 image embedding, filled in Phase 2
  review_status    text        not null default 'pending'
                               check (review_status in ('approved', 'pending', 'rejected')),
  created_at       timestamptz not null default now()
);

alter table public.catalog_card_images enable row level security;

-- Only approved images are publicly readable; pending / rejected are service_role only
create policy "Approved catalog images are publicly readable"
  on public.catalog_card_images for select using (review_status = 'approved');

create index idx_catalog_card_images_card_id  on public.catalog_card_images (catalog_card_id);
create index idx_catalog_card_images_source   on public.catalog_card_images (source);
create index idx_catalog_card_images_review   on public.catalog_card_images (review_status);

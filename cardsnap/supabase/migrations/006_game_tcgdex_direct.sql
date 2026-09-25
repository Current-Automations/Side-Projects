-- CardSnap, shop game: serve card images straight from TCGdex instead of
-- re-hosting in Supabase Storage.
--
-- game_draw_set_round previously required a row in catalog_card_images
-- (i.e. the image already downloaded and re-uploaded to the catalog-images
-- bucket), which only exists for cards someone has run `catalog:images`
-- against. That's why the game's playable pool was stuck at whatever subset
-- had been re-hosted, and why growing it read as "needs Supabase Pro for
-- storage." Every catalog_cards row already carries image_base_url straight
-- from TCGdex (assets.tcgdex.net), which is publicly served and free. This
-- drops the catalog_card_images join/requirement entirely, so any card that
-- has been catalog-ingested (a cheap text-only `catalog:ingest` run, no
-- image storage involved) is immediately playable.
--
-- catalog_card_images / the catalog-images bucket / ingest-images.ts are
-- left in place, unused by the game for now — still the fallback path if
-- TCGdex-direct proves too slow/unreliable under real play.
--
-- Run in: Supabase Dashboard -> SQL Editor (after 005_drop_sports_cards_table.sql)

create or replace function public.game_draw_set_round(p_dex_lo int default 1, p_dex_hi int default 151)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_card        record;
  v_distractors text[];
begin
  select c.id, c.name, c.set_id, s.name as set_name, s.series_id, c.image_base_url
    into v_card
  from public.catalog_cards c
  join public.catalog_sets  s on s.id = c.set_id
  where c.image_base_url is not null
    and c.dex_ids is not null
    and exists (
      select 1
      from jsonb_array_elements_text(c.dex_ids) e
      where e.value ~ '^[0-9]+$' and e.value::int between p_dex_lo and p_dex_hi
    )
  order by random()
  limit 1;

  if v_card.id is null then
    return null;
  end if;

  select array_agg(name) into v_distractors
  from (
    select s.name
    from public.catalog_sets s
    where s.id <> v_card.set_id
      and s.name <> v_card.set_name
    order by (s.series_id is distinct from v_card.series_id), random()
    limit 3
  ) d;

  return jsonb_build_object(
    'card_id',         v_card.id,
    'card_name',       v_card.name,
    'set_id',          v_card.set_id,
    'set_name',        v_card.set_name,
    'image_base_url',  v_card.image_base_url,
    'distractor_sets', to_jsonb(v_distractors)
  );
end;
$$;

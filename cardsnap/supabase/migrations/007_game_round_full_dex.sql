-- CardSnap, shop game: stop defaulting the round-picker to Kanto only.
--
-- game_draw_set_round's default dex range was 1-151 (Kanto), a leftover
-- from before the catalog had more than Gen 1 ingested. The catalog now
-- spans 205 sets across many generations, but every round still drew from
-- Kanto only unless a caller passed explicit bounds. lib/game/store.ts's
-- JS-side default was widened to match; this brings the SQL function's own
-- default in line for any direct/RPC caller.
--
-- Run in: Supabase Dashboard -> SQL Editor (after 006_game_tcgdex_direct.sql)

create or replace function public.game_draw_set_round(p_dex_lo int default 1, p_dex_hi int default 2000)
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

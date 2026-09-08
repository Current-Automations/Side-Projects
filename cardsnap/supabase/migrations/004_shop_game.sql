-- CardSnap, shop game
-- Phase 3 of the Pokemon-first rebuild. The white-label in-store card-ID game
-- that is simultaneously the label engine, the marketing surface, and the
-- user-acquisition funnel.
--
-- Multi-tenant from day one: one deploy, per-shop config selected by URL slug
-- (/play/immaculate). Adding a shop is a row in `shops`, not a deploy.
--
-- Players are anonymous. First launch mints a UUID into localStorage as the
-- device id; that id carries the accuracy history that drives trust scoring.
-- No auth, no signup. Every mutating write goes through /api/game/* on the
-- service_role client, because a browser that could write its own is_correct
-- or control_correct_count would be trivially cheatable. RLS therefore allows
-- public SELECT only where a player genuinely needs to read (shop config,
-- contests); game_rounds and proposed_labels are service_role only so the
-- unknown-pool cards cannot be reverse engineered from answer history.
--
-- Run in: Supabase Dashboard -> SQL Editor (after 002_pokemon_catalog.sql)

-- ─────────────────────────────────────────────
-- shops: one row per participating shop
-- ─────────────────────────────────────────────

create table public.shops (
  slug         text        primary key,          -- URL segment, e.g. 'immaculate'
  display_name text        not null,
  logo_url     text,
  theme_color  text,                             -- hex, e.g. '#0e7359'
  contact      text,                             -- freeform: email or phone
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now()
);

alter table public.shops enable row level security;

create policy "Active shops are publicly readable"
  on public.shops for select using (is_active = true);

-- ─────────────────────────────────────────────
-- game_players: anonymous, keyed by client-minted device id
-- ─────────────────────────────────────────────

create table public.game_players (
  device_id             text        primary key,          -- UUID minted client-side into localStorage
  display_name          text,                             -- null until the player lands on the leaderboard
  shop_slug             text        references public.shops(slug) on delete set null,
  control_answers_count integer     not null default 0,    -- answered rounds in the control + hard pools
  control_correct_count integer     not null default 0,
  trust_score           numeric     generated always as (
                          case
                            when control_answers_count >= 20
                            then control_correct_count::numeric / nullif(control_answers_count, 0)
                            else 0
                          end
                        ) stored,
  created_at            timestamptz not null default now(),
  last_seen_at          timestamptz not null default now()
);

alter table public.game_players enable row level security;

-- Public read so the leaderboard renders; writes are service_role only.
create policy "Players are publicly readable"
  on public.game_players for select using (true);

create index idx_game_players_shop        on public.game_players (shop_slug);
create index idx_game_players_leaderboard on public.game_players (shop_slug, control_correct_count desc);

-- ─────────────────────────────────────────────
-- game_contests: a timed in-store event, leaderboard scoped to its window
-- ─────────────────────────────────────────────

create table public.game_contests (
  id                uuid        primary key default gen_random_uuid(),
  shop_slug         text        not null references public.shops(slug) on delete cascade,
  name              text        not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  prize_description text,
  created_at        timestamptz not null default now()
);

alter table public.game_contests enable row level security;

create policy "Contests are publicly readable"
  on public.game_contests for select using (true);

create index idx_game_contests_window on public.game_contests (shop_slug, starts_at, ends_at);

-- ─────────────────────────────────────────────
-- game_rounds: one row per question served and answered.
-- options is stored as shown, because reconstructing which distractors a player
-- saw is essential to interpret a wrong answer, and it is cheap.
-- ─────────────────────────────────────────────

create table public.game_rounds (
  id           uuid        primary key default gen_random_uuid(),
  device_id    text        not null references public.game_players(device_id) on delete cascade,
  card_id      text        references public.catalog_cards(id) on delete set null,  -- null for unknown-pool rounds
  pool         text        not null check (pool in ('control', 'hard', 'unknown')),
  mode         text        not null check (mode in ('set', 'variant')),
  options      jsonb       not null,                       -- the four choices shown, verbatim
  answer_given text,                                       -- the option the player picked; null if timed out
  is_correct   boolean,                                    -- null for unknown-pool or unanswered rounds
  time_ms      integer,
  contest_id   uuid        references public.game_contests(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.game_rounds enable row level security;
-- No policy: service_role only. Public aggregate stats are served via /api/game/*.

create index idx_game_rounds_device     on public.game_rounds (device_id);
create index idx_game_rounds_card       on public.game_rounds (card_id);
create index idx_game_rounds_contest    on public.game_rounds (contest_id);
create index idx_game_rounds_unknown    on public.game_rounds (card_id) where pool = 'unknown';
create index idx_game_rounds_created_at on public.game_rounds (created_at desc);

-- ─────────────────────────────────────────────
-- proposed_labels: an unknown-card answer that has cleared the trust gate and
-- is waiting for a human to approve it into the labeled set. Nothing here
-- auto-commits to training data (Phase 4 promotion job + review queue).
-- ─────────────────────────────────────────────

create table public.proposed_labels (
  id                     uuid        primary key default gen_random_uuid(),
  image_ref              text        not null,             -- storage path or image id of the frame being labeled
  catalog_card_image_id  uuid        references public.catalog_card_images(id) on delete set null,
  mode                   text        not null check (mode in ('set', 'variant')),
  proposed_answer        text        not null,
  vote_count             integer     not null default 0,
  contributing_trust_avg numeric,
  status                 text        not null default 'pending'
                                     check (status in ('pending', 'approved', 'rejected')),
  reviewed_by            text,
  reviewed_at            timestamptz,
  created_at             timestamptz not null default now()
);

alter table public.proposed_labels enable row level security;
-- No policy: service_role only. The review queue is an authenticated admin route.

create index idx_proposed_labels_status on public.proposed_labels (status);

-- ─────────────────────────────────────────────
-- FUNCTIONS
-- ─────────────────────────────────────────────

-- Atomic control/hard-pool answer recording. Mirrors increment_scan_count in
-- 001: avoids the read-modify-write race when two rounds from the same device
-- land close together. Only control + hard rounds call this; unknown rounds
-- never touch the score.
create or replace function public.record_control_answer(p_device_id text, p_correct boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.game_players
  set control_answers_count = control_answers_count + 1,
      control_correct_count = control_correct_count + (case when p_correct then 1 else 0 end),
      last_seen_at          = now()
  where device_id = p_device_id;
end;
$$;

-- Draw one Mode A (which set) round in a single round trip: a random catalog
-- card that has an approved upstream image and a national dex id in the range
-- (1 to 151 is the Kanto vertical, matching the v1 identifier scope), plus
-- three distractor set names, same series preferred. Returns null when the
-- pool is empty. The caller assembles the options and persists the round.
create or replace function public.game_draw_set_round(p_dex_lo int default 1, p_dex_hi int default 151)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_card        record;
  v_distractors text[];
begin
  select c.id, c.name, c.set_id, s.name as set_name, s.series_id, i.storage_path
    into v_card
  from public.catalog_card_images i
  join public.catalog_cards c on c.id = i.catalog_card_id
  join public.catalog_sets  s on s.id = c.set_id
  where i.source = 'upstream'
    and i.review_status = 'approved'
    and i.storage_path is not null
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
    'card_id',        v_card.id,
    'card_name',      v_card.name,
    'set_id',         v_card.set_id,
    'set_name',       v_card.set_name,
    'image_path',     v_card.storage_path,
    'distractor_sets', to_jsonb(v_distractors)
  );
end;
$$;

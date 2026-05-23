-- CardSnap — Initial Schema
-- Session 1: all 6 tables, indexes, RLS, trigger, atomic increment RPC
-- Run in: Supabase Dashboard → SQL Editor

-- ─────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────

-- Master card catalog
create table public.cards (
  id              uuid        primary key default gen_random_uuid(),
  player_name     text        not null,
  year            integer     not null,
  manufacturer    text        not null,
  set_name        text        not null,
  parallel        text        not null default 'Base',
  card_number     text,
  sport           text        not null check (sport in ('NFL', 'NBA', 'MLB', 'NHL')),
  created_at      timestamptz not null default now()
);

-- eBay pricing cache (4-hour TTL)
create table public.price_cache (
  id               uuid         primary key default gen_random_uuid(),
  card_fingerprint text         not null unique,
  avg_sold_price   numeric(10,2),
  last_10_sales    jsonb,
  grade            text,
  grade_company    text         check (grade_company in ('PSA', 'BGS', 'SGC', 'CGC')),
  fetched_at       timestamptz  not null default now(),
  expires_at       timestamptz  not null
);

-- Extends auth.users — billing + rate limiting
create table public.users (
  id                 uuid        primary key references auth.users(id) on delete cascade,
  stripe_customer_id text        unique,
  plan_tier          text        not null default 'free'
                                 check (plan_tier in ('free', 'basic', 'pro', 'streamer')),
  timezone           text        not null default 'UTC',
  scans_used_today   integer     not null default 0,
  scans_reset_at     timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

-- Every scan ever performed
create table public.scan_logs (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references public.users(id) on delete cascade,
  card_id           uuid        references public.cards(id),
  image_hash        text        not null,
  ai_response       jsonb,
  model_used        text,       -- 'base' or 'ft:gpt-4o-xxxxx'
  final_card_id     uuid        references public.cards(id),
  was_corrected     boolean     not null default false,
  correction_source text,
  price_at_scan     numeric(10,2),
  cache_hit         boolean,
  created_at        timestamptz not null default now()
);

-- Audit log of user corrections — each row maps to a training_example row
create table public.corrections (
  id               uuid        primary key default gen_random_uuid(),
  scan_id          uuid        references public.scan_logs(id) on delete set null,
  user_id          uuid        references public.users(id) on delete cascade,
  corrected_labels jsonb       not null,
  created_at       timestamptz not null default now()
);

create index idx_corrections_scan_id  on public.corrections (scan_id);
create index idx_corrections_user_id  on public.corrections (user_id);

-- RLS: users can only see their own corrections
alter table public.corrections enable row level security;
create policy "Users can read own corrections" on public.corrections
  for select using (auth.uid() = user_id);
create policy "Users can insert own corrections" on public.corrections
  for insert with check (auth.uid() = user_id);

-- Ground-truth examples for fine-tuning
create table public.training_examples (
  id              uuid        primary key default gen_random_uuid(),
  image_hash      text        not null,
  correct_labels  jsonb       not null,
  source          text        not null check (source in ('user_correction', 'confirmed', 'bootstrap')),
  training_set_id uuid,
  generation      integer     not null default 0,
  trained_at      timestamptz,            -- null = not yet used in a training run
  created_at      timestamptz not null default now()
);

-- Tracks each OpenAI fine-tuning job + the resulting model
create table public.training_runs (
  id            uuid        primary key default gen_random_uuid(),
  openai_job_id text        not null unique,
  status        text        not null default 'pending'
                            check (status in ('pending', 'running', 'completed', 'failed')),
  model_id      text,       -- populated when job completes: 'ft:gpt-4o-xxxxx'
  generation    integer     not null,
  example_count integer     not null default 0,
  is_active     boolean     not null default false,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────

create index idx_cards_player_year_manufacturer
  on public.cards (player_name, year, manufacturer);

create index idx_price_cache_fingerprint
  on public.price_cache (card_fingerprint);

create index idx_price_cache_expires_at
  on public.price_cache (expires_at);

create index idx_scan_logs_user_id
  on public.scan_logs (user_id);

create index idx_scan_logs_created_at
  on public.scan_logs (created_at desc);

create index idx_training_examples_generation
  on public.training_examples (generation);

-- Partial index — fast lookup of untrained examples
create index idx_training_examples_untrained
  on public.training_examples (generation)
  where trained_at is null;

-- Partial index — fast lookup of the active model
create index idx_training_runs_active
  on public.training_runs (is_active)
  where is_active = true;

-- ─────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- ─────────────────────────────────────────────

alter table public.cards             enable row level security;
alter table public.price_cache       enable row level security;
alter table public.users             enable row level security;
alter table public.scan_logs         enable row level security;
alter table public.training_examples enable row level security;
alter table public.training_runs     enable row level security;

-- CARDS: public read (browsing catalog), service_role for writes
create policy "Cards are publicly readable"
  on public.cards for select using (true);

-- PRICE_CACHE: public read, service_role for writes
create policy "Price cache is publicly readable"
  on public.price_cache for select using (true);

-- USERS: users can only see and update their own row
create policy "Users can read own record"
  on public.users for select using (auth.uid() = id);

create policy "Users can update own record"
  on public.users for update using (auth.uid() = id);

-- SCAN_LOGS: users can only access their own scans
create policy "Users can read own scan logs"
  on public.scan_logs for select using (auth.uid() = user_id);

create policy "Users can insert own scan logs"
  on public.scan_logs for insert with check (auth.uid() = user_id);

create policy "Users can update own scan logs"
  on public.scan_logs for update using (auth.uid() = user_id);

-- TRAINING_EXAMPLES: service_role only — no policy = no user access (RLS blocks all)

-- TRAINING_RUNS: public read so inference layer can check the active model
create policy "Training runs are publicly readable"
  on public.training_runs for select using (true);

-- ─────────────────────────────────────────────
-- FUNCTIONS & TRIGGERS
-- ─────────────────────────────────────────────

-- Auto-create a public.users row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Atomic scan count increment — avoids read-modify-write race conditions.
-- Parameter is named `user_id` (no prefix) to match the JS caller in rate-limit.ts.
create or replace function public.increment_scan_count(user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set scans_used_today = scans_used_today + 1
  where id = user_id;
end;
$$;

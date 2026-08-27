-- Section 11.3 proposal only. Apply only in a personal Supabase staging project
-- after the SQLite export and migration manifest have been reviewed.
-- No media bytes, credentials, access tokens, or complete temporary URLs belong here.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'VIEWER' check (role in ('ADMIN', 'REVIEWER', 'VIEWER')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  asset_id text primary key,
  checksum_sha256 text unique,
  extension text not null,
  file_size bigint not null,
  duration_ms bigint,
  width integer,
  height integer,
  availability_status text not null,
  rights_status text not null,
  source_relative_path text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.derived_reels (
  reel_id text primary key,
  candidate_id text not null unique,
  source_asset_id text not null references public.media_assets(asset_id) on delete restrict,
  output_relative_path text not null,
  thumbnail_relative_path text,
  file_size bigint,
  duration_ms bigint,
  width integer,
  height integer,
  validation_status text not null,
  source_checksum_before text,
  source_checksum_after text,
  song_title text,
  collection text,
  tier text,
  ai_score numeric,
  editorial_quality numeric,
  bible_status text not null default 'MISSING',
  rights_status text not null,
  editorial_status text,
  review_queue text,
  content_pillar text,
  seasonality text,
  content_ready boolean not null default false,
  publication_status text not null default 'NOT_PUBLISHED',
  last_reviewed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.editorial_packages (
  reel_id text primary key references public.derived_reels(reel_id) on delete cascade,
  latest_editorial_version integer not null,
  updated_at timestamptz not null
);

create table if not exists public.editorial_versions (
  reel_id text not null references public.derived_reels(reel_id) on delete cascade,
  editorial_version integer not null,
  title text not null,
  hook text not null,
  caption text not null,
  cta text not null,
  hashtags jsonb not null,
  primary_pillar text not null,
  secondary_pillar text,
  cover_text text not null,
  bible_reference text not null,
  review_status text not null,
  operator_review_note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null,
  primary key (reel_id, editorial_version)
);

create table if not exists public.human_reviews (
  review_id text primary key,
  reel_id text not null references public.derived_reels(reel_id) on delete cascade,
  editorial_version integer not null,
  actor_id uuid not null references public.profiles(id),
  status text not null,
  note text not null,
  created_at timestamptz not null
);

create table if not exists public.bible_evidence (
  evidence_id text primary key,
  reel_id text not null references public.derived_reels(reel_id) on delete cascade,
  editorial_version integer not null,
  reference text not null,
  source_type text not null,
  source_location text not null,
  evidence_status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.bible_verifications (
  verification_id text primary key,
  evidence_id text not null references public.bible_evidence(evidence_id) on delete restrict,
  reel_id text not null references public.derived_reels(reel_id) on delete cascade,
  editorial_version integer not null,
  verified_by uuid not null references public.profiles(id),
  verified_at timestamptz not null,
  note text not null
);

create table if not exists public.rights_sources (
  source_id text primary key,
  asset_id text not null references public.media_assets(asset_id) on delete cascade,
  source_type text not null,
  source_location text not null,
  source_checksum text,
  created_at timestamptz not null
);

create table if not exists public.rights_confirmations (
  confirmation_id text primary key,
  source_id text not null references public.rights_sources(source_id) on delete restrict,
  actor_id uuid not null references public.profiles(id),
  rights_status text not null,
  confirmation_scope text not null,
  statement_version text not null,
  note text not null,
  confirmed_at timestamptz not null
);

create table if not exists public.content_ready_evaluations (
  evaluation_id text primary key,
  reel_id text not null references public.derived_reels(reel_id) on delete cascade,
  editorial_version integer,
  status text not null,
  gates jsonb not null,
  reasons jsonb not null,
  evaluated_at timestamptz not null
);

create table if not exists public.publication_records (
  publication_key text primary key,
  reel_id text not null references public.derived_reels(reel_id) on delete restrict,
  editorial_version integer not null,
  snapshot_id text,
  status text not null,
  container_id text,
  remote_media_id text,
  permalink text,
  published_at timestamptz,
  attempt_count integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.publication_audit (
  event_id text primary key,
  entity_type text not null,
  entity_id text not null,
  event_type text not null,
  actor_id uuid references public.profiles(id),
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.analytics_snapshots (
  analytics_snapshot_id text primary key,
  reel_id text not null references public.derived_reels(reel_id) on delete cascade,
  publication_key text not null,
  instagram_media_id text not null,
  observation_window text not null,
  captured_at timestamptz not null,
  source_timestamp timestamptz,
  api_version text not null,
  status text not null,
  metrics jsonb not null,
  created_at timestamptz not null
);

create table if not exists public.review_sessions (
  session_id text primary key,
  reviewer_id uuid not null references public.profiles(id),
  queue text not null,
  current_reel_id text,
  started_at timestamptz not null,
  ended_at timestamptz,
  reviewed_count integer not null default 0,
  last_action_at timestamptz not null,
  filters jsonb not null default '{}'::jsonb
);

create table if not exists public.temporary_media_records (
  publication_key text primary key,
  reel_id text not null references public.derived_reels(reel_id) on delete cascade,
  provider text not null,
  drive_id text,
  item_id text,
  item_path text,
  checksum_sha256 text not null,
  size_bytes bigint not null,
  validation_status text not null,
  cleanup_status text not null,
  prepared_at timestamptz,
  expires_at_estimated timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_derived_reels_queue on public.derived_reels(review_queue, editorial_status, publication_status);
create index if not exists idx_editorial_versions_latest on public.editorial_versions(reel_id, editorial_version desc);
create index if not exists idx_bible_evidence_reel_version on public.bible_evidence(reel_id, editorial_version, updated_at desc);
create index if not exists idx_publication_audit_entity on public.publication_audit(entity_type, entity_id, occurred_at desc);
create index if not exists idx_analytics_reel_window on public.analytics_snapshots(reel_id, observation_window, captured_at desc);

-- Fail closed by default. Browser clients receive read access only; controlled
-- server operations use a server-only role and domain services.
do $$ declare table_name text; begin
  foreach table_name in array array['profiles','media_assets','derived_reels','editorial_packages','editorial_versions','human_reviews','bible_evidence','bible_verifications','rights_sources','rights_confirmations','content_ready_evaluations','publication_records','publication_audit','analytics_snapshots','review_sessions','temporary_media_records'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
  end loop;
end $$;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated using ((select auth.uid()) = id and is_active);

do $$ declare table_name text; begin
  foreach table_name in array array['media_assets','derived_reels','editorial_packages','editorial_versions','human_reviews','bible_evidence','bible_verifications','rights_sources','rights_confirmations','content_ready_evaluations','publication_records','publication_audit','analytics_snapshots','review_sessions','temporary_media_records'] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_active_read', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active and p.role in (''ADMIN'',''REVIEWER'',''VIEWER'')))', table_name || '_active_read', table_name);
  end loop;
end $$;

-- publication_audit and publication_records are append-only to normal roles.
-- Service-role/server domain code is the only planned writer during migration.

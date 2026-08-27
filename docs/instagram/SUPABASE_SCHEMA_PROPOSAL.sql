-- Section 11.2 proposal only. Do not apply to production until the SQLite
-- export has passed the remote validation and cutover gates.
-- Media bytes remain local/OneDrive; only governance and safe metadata move.

create schema if not exists private;

create table if not exists public.admin_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('ADMIN', 'REVIEWER', 'VIEWER')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.review_reels (
  reel_id text primary key,
  candidate_id text not null,
  source_asset_id text not null,
  output_relative_path text not null,
  source_checksum_before text,
  source_checksum_after text,
  file_size bigint,
  validation_status text not null,
  rights_status text not null,
  publication_status text not null default 'NOT_PUBLISHED',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.editorial_versions (
  reel_id text not null references public.review_reels(reel_id) on delete cascade,
  editorial_version integer not null,
  editorial_title text not null,
  selected_hook text not null,
  caption text not null,
  bible_reference text not null,
  bible_reference_review_required boolean not null default true,
  cta text not null,
  hashtags jsonb not null,
  content_pillar text not null,
  secondary_pillar text,
  editorial_intent text not null,
  cover_path text not null,
  cover_text text not null,
  review_status text not null,
  publication_status text not null,
  publication_priority text not null,
  suggested_context text not null,
  suggested_spacing text not null,
  rights_status text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  generated_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (reel_id, editorial_version)
);

create table if not exists public.bible_reference_sources (
  bible_reference_id text primary key,
  reel_id text not null references public.review_reels(reel_id) on delete cascade,
  editorial_version integer,
  reference text not null,
  source_type text not null,
  source_location text not null,
  verification_status text not null,
  verified_by text,
  verified_at timestamptz,
  note text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.rights_evidence (
  confirmation_id text primary key,
  source_asset_id text not null,
  rights_status text not null,
  confirmed_by text not null,
  confirmed_at timestamptz not null,
  confirmation_scope text not null,
  confirmation_statement_version text not null,
  note text not null
);

create table if not exists public.review_sessions (
  session_id text primary key,
  reviewer_user_id uuid not null references auth.users(id),
  reviewer_label text,
  queue text not null,
  current_reel_id text,
  started_at timestamptz not null,
  ended_at timestamptz,
  reviewed_count integer not null default 0,
  approved_count integer not null default 0,
  rejected_count integer not null default 0,
  needs_changes_count integer not null default 0,
  content_ready_count integer not null default 0,
  last_action_at timestamptz not null,
  filters jsonb not null default '{}'::jsonb
);

create table if not exists public.content_readiness_snapshots (
  reel_id text not null references public.review_reels(reel_id) on delete cascade,
  evaluated_at timestamptz not null,
  status text not null,
  editorial_version integer,
  gates jsonb not null,
  reasons jsonb not null,
  primary key (reel_id, evaluated_at)
);

create table if not exists public.publication_records (
  publication_key text primary key,
  reel_id text not null references public.review_reels(reel_id) on delete restrict,
  editorial_version integer not null,
  snapshot_id text,
  status text not null,
  attempt_count integer not null default 0,
  container_id text,
  remote_media_id text,
  permalink text,
  published_at timestamptz,
  error_code text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists public.publication_audit_events (
  event_id text primary key,
  entity_type text not null,
  entity_id text not null,
  event_type text not null,
  actor_user_id uuid references auth.users(id),
  actor_label text,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.analytics_snapshots (
  analytics_snapshot_id text primary key,
  reel_id text not null references public.review_reels(reel_id) on delete cascade,
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

create table if not exists public.temporary_media_metadata (
  publication_key text primary key,
  reel_id text not null references public.review_reels(reel_id) on delete cascade,
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

create index if not exists idx_editorial_versions_latest on public.editorial_versions(reel_id, editorial_version desc);
create index if not exists idx_bible_sources_reel on public.bible_reference_sources(reel_id, updated_at desc);
create index if not exists idx_audit_entity on public.publication_audit_events(entity_type, entity_id, occurred_at desc);
create index if not exists idx_analytics_reel_window on public.analytics_snapshots(reel_id, observation_window, captured_at desc);

-- Every exposed table is protected. Role claims must be maintained in a
-- trusted server-side membership process/app_metadata, never user_metadata.
do $$ declare table_name text; begin
  foreach table_name in array array['admin_memberships','review_reels','editorial_versions','bible_reference_sources','rights_evidence','review_sessions','content_readiness_snapshots','publication_records','publication_audit_events','analytics_snapshots','temporary_media_metadata'] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create policy admin_membership_self on public.admin_memberships for select to authenticated using (user_id = (select auth.uid()));

create policy review_read on public.review_reels for select to authenticated using (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER','VIEWER')));
create policy review_write on public.review_reels for update to authenticated using (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER'))) with check (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER')));

create policy editorial_read on public.editorial_versions for select to authenticated using (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER','VIEWER')));
create policy editorial_write on public.editorial_versions for insert to authenticated with check (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER')));
create policy bible_read on public.bible_reference_sources for select to authenticated using (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER','VIEWER')));
create policy bible_write on public.bible_reference_sources for insert to authenticated with check (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER')));
create policy rights_read on public.rights_evidence for select to authenticated using (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER','VIEWER')));
create policy session_owner on public.review_sessions for all to authenticated using (reviewer_user_id = (select auth.uid())) with check (reviewer_user_id = (select auth.uid()));
create policy readiness_read on public.content_readiness_snapshots for select to authenticated using (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER','VIEWER')));
create policy publications_read on public.publication_records for select to authenticated using (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER','VIEWER')));
create policy audit_read on public.publication_audit_events for select to authenticated using (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER','VIEWER')));
create policy analytics_read on public.analytics_snapshots for select to authenticated using (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER','VIEWER')));
create policy temporary_media_read on public.temporary_media_metadata for select to authenticated using (exists (select 1 from public.admin_memberships m where m.user_id = (select auth.uid()) and m.role in ('ADMIN','REVIEWER','VIEWER')));

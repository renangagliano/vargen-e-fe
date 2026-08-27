-- Section 11.8.1: controlled manual publication state and server-only RPCs.
-- Additive only. No media bytes, tokens, URLs, or credentials are stored.

alter table public.publication_records add column if not exists asset_id text;
alter table public.publication_records add column if not exists source_checksum text;
alter table public.publication_records add column if not exists derived_checksum text;
alter table public.publication_records add column if not exists target_account text;
alter table public.publication_records add column if not exists operator_id uuid;
alter table public.publication_records add column if not exists operator_role text;
alter table public.publication_records add column if not exists authorized_at timestamptz;
alter table public.publication_records add column if not exists request_id text;
alter table public.publication_records add column if not exists snapshot jsonb;
alter table public.publication_records add column if not exists error_code text;
alter table public.publication_records add column if not exists error_message_safe text;
alter table public.publication_records add column if not exists cleanup_status text not null default 'NOT_REQUESTED';
alter table public.publication_records add column if not exists analytics_status text not null default 'NOT_REQUESTED';
alter table public.publication_records add column if not exists locked_at timestamptz;
alter table public.publication_records add column if not exists last_status_at timestamptz;

create index if not exists idx_publication_records_reel_status on public.publication_records(reel_id, status, updated_at desc);
create index if not exists idx_publication_records_request on public.publication_records(request_id);

create or replace function public.admin_publication_acquire(
  p_reel_id text,
  p_editorial_version integer,
  p_publication_key text,
  p_actor_id uuid,
  p_actor_role text,
  p_request_id text,
  p_target_account text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reel derived_reels%rowtype;
  v_asset media_assets%rowtype;
  v_editorial editorial_versions%rowtype;
  v_eval content_ready_evaluations%rowtype;
  v_existing publication_records%rowtype;
  v_media record;
  v_snapshot jsonb;
  v_key text := trim(coalesce(p_publication_key, ''));
  v_now timestamptz := now();
  v_attempt integer;
  v_blockers jsonb := '[]'::jsonb;
begin
  if p_actor_role <> 'ADMIN' or p_actor_id is null or p_request_id is null or trim(p_request_id) = '' or p_target_account is null or trim(p_target_account) = '' then raise exception 'PUBLICATION_AUTHORIZATION_REQUIRED'; end if;
  if not exists (select 1 from profiles where id = p_actor_id and is_active and role = 'ADMIN') then raise exception 'ADMIN_PROFILE_INVALID'; end if;
  if p_reel_id is null or trim(p_reel_id) = '' or p_editorial_version < 1 or v_key = '' then raise exception 'PUBLICATION_PAYLOAD_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_reel_id || ':' || p_editorial_version::text, 0));
  select * into v_reel from derived_reels where reel_id = p_reel_id for update;
  if not found then raise exception 'REEL_NOT_FOUND'; end if;
  select * into v_asset from media_assets where asset_id = v_reel.source_asset_id;
  select * into v_editorial from editorial_versions where reel_id = p_reel_id and editorial_version = p_editorial_version;
  if not found then raise exception 'EDITORIAL_VERSION_CONFLICT'; end if;
  if not exists (select 1 from editorial_packages where reel_id = p_reel_id and latest_editorial_version = p_editorial_version) then raise exception 'EDITORIAL_VERSION_CONFLICT'; end if;
  select * into v_eval from content_ready_evaluations where reel_id = p_reel_id and editorial_version = p_editorial_version order by evaluated_at desc limit 1;
  select item_id, item_path, cleanup_status into v_media from temporary_media_records where reel_id = p_reel_id and checksum_sha256 = coalesce(v_reel.source_checksum_after, v_reel.source_checksum_before) order by updated_at desc limit 1;

  if v_reel.publication_status = 'PUBLISHED' or exists (select 1 from publication_records where reel_id = p_reel_id and status = 'PUBLISHED') then
    select * into v_existing from publication_records where reel_id = p_reel_id and status = 'PUBLISHED' order by updated_at desc limit 1;
    return jsonb_build_object('status','ALREADY_PUBLISHED','publication_key',coalesce(v_existing.publication_key,v_key),'attempt',case when v_existing.publication_key is null then null else to_jsonb(v_existing) end);
  end if;

  if v_eval.evaluation_id is null or v_eval.status <> 'CONTENT_READY' then v_blockers := v_blockers || jsonb_build_array('CONTENT_READY_REQUIRED'); end if;
  if coalesce(v_eval.gates->>'technical_validation','') <> 'PASS' then v_blockers := v_blockers || jsonb_build_array('TECHNICAL_VALIDATION'); end if;
  if coalesce(v_eval.gates->>'source_integrity','') <> 'PASS' then v_blockers := v_blockers || jsonb_build_array('SOURCE_INTEGRITY'); end if;
  if coalesce(v_eval.gates->>'editorial_review','') <> 'PASS' then v_blockers := v_blockers || jsonb_build_array('EDITORIAL_REVIEW'); end if;
  if coalesce(v_eval.gates->>'rights_status','') <> 'PASS' then v_blockers := v_blockers || jsonb_build_array('RIGHTS_STATUS'); end if;
  if coalesce(v_eval.gates->>'bible_reference','') <> 'PASS' then v_blockers := v_blockers || jsonb_build_array('BIBLE_REFERENCE'); end if;
  if coalesce(v_eval.gates->>'output_file_exists','') <> 'PASS' then v_blockers := v_blockers || jsonb_build_array('OUTPUT_FILE_EXISTS'); end if;
  if coalesce(v_eval.gates->>'cover_exists','') <> 'PASS' then v_blockers := v_blockers || jsonb_build_array('COVER_EXISTS'); end if;
  if coalesce(v_eval.gates->>'required_editorial_fields','') <> 'PASS' then v_blockers := v_blockers || jsonb_build_array('REQUIRED_EDITORIAL_FIELDS'); end if;
  if coalesce(v_eval.gates->>'duplicate_publication_check','') <> 'PASS' then v_blockers := v_blockers || jsonb_build_array('DUPLICATE_PUBLICATION_CHECK'); end if;
  if jsonb_array_length(v_blockers) > 0 then return jsonb_build_object('status','BLOCKED','publication_key',v_key,'blockers',v_blockers); end if;

  select * into v_existing from publication_records where publication_key = v_key for update;
  if found then
    if v_existing.status = 'PUBLISHED' then return jsonb_build_object('status','ALREADY_PUBLISHED','publication_key',v_key,'attempt',to_jsonb(v_existing)); end if;
    if v_existing.status in ('PUBLISHING','UNCERTAIN') then return jsonb_build_object('status','ACTIVE_ATTEMPT','publication_key',v_key,'attempt',to_jsonb(v_existing)); end if;
    if v_existing.status in ('CONTAINER_CREATED','PROCESSING') then return jsonb_build_object('status','ACTIVE_ATTEMPT','publication_key',v_key,'attempt',to_jsonb(v_existing)); end if;
    if v_existing.status <> 'FAILED_PRE_META' then return jsonb_build_object('status','ACTIVE_ATTEMPT','publication_key',v_key,'attempt',to_jsonb(v_existing)); end if;
    v_attempt := coalesce(v_existing.attempt_count, 0) + 1;
    update publication_records set status='PREPARING', attempt_count=v_attempt, error_code=null, error_message_safe=null, operator_id=p_actor_id, operator_role=p_actor_role, authorized_at=v_now, request_id=p_request_id, locked_at=v_now, last_status_at=v_now, updated_at=v_now where publication_key=v_key;
  else
    v_attempt := 1;
    v_snapshot := jsonb_build_object('snapshot_id','publication-snapshot:' || v_key,'snapshot_version','section11.8.1-v1','publication_key',v_key,'reel_id',p_reel_id,'asset_id',v_reel.source_asset_id,'editorial_version',p_editorial_version,'title',v_editorial.title,'caption',v_editorial.caption,'hashtags',v_editorial.hashtags,'cta',v_editorial.cta,'bible_reference',nullif(v_editorial.bible_reference,''),'rights_status','RIGHTS_CONFIRMED','content_ready_evaluation_id',v_eval.evaluation_id,'readiness_gates',v_eval.gates,'source_checksum',coalesce(v_reel.source_checksum_after,v_reel.source_checksum_before,''),'derived_checksum',null,'media_relative_path',v_reel.output_relative_path,'media_size',v_reel.file_size,'temporary_media_item_id',v_media.item_id,'temporary_media_path',v_media.item_path,'target_account',p_target_account,'operator_user_id',p_actor_id,'operator_role',p_actor_role,'authorized_at',v_now,'request_id',p_request_id);
    insert into publication_records (publication_key,reel_id,editorial_version,snapshot_id,status,attempt_count,created_at,updated_at,asset_id,source_checksum,target_account,operator_id,operator_role,authorized_at,request_id,snapshot,locked_at,last_status_at)
    values (v_key,p_reel_id,p_editorial_version,v_snapshot->>'snapshot_id','PREPARING',v_attempt,v_now,v_now,v_reel.source_asset_id,v_reel.source_checksum_after,p_target_account,p_actor_id,p_actor_role,v_now,p_request_id,v_snapshot,v_now,v_now);
  end if;

  insert into publication_audit(event_id,entity_type,entity_id,event_type,actor_id,occurred_at,metadata)
  values ('publication:'||v_key||':PUBLICATION_AUTHORIZED:'||v_attempt,'REEL',p_reel_id,'PUBLICATION_AUTHORIZED',p_actor_id,v_now,jsonb_build_object('publication_key',v_key,'editorial_version',p_editorial_version,'request_id',p_request_id,'operator_role',p_actor_role));
  insert into publication_audit(event_id,entity_type,entity_id,event_type,actor_id,occurred_at,metadata)
  values ('publication:'||v_key||':PUBLICATION_LOCK_ACQUIRED:'||v_attempt,'REEL',p_reel_id,'PUBLICATION_LOCK_ACQUIRED',p_actor_id,v_now,jsonb_build_object('publication_key',v_key,'attempt_count',v_attempt,'request_id',p_request_id));
  select snapshot into v_snapshot from publication_records where publication_key = v_key;
  insert into publication_audit(event_id,entity_type,entity_id,event_type,actor_id,occurred_at,metadata)
  values ('publication:'||v_key||':PUBLICATION_SNAPSHOT_CREATED:'||v_attempt,'REEL',p_reel_id,'PUBLICATION_SNAPSHOT_CREATED',p_actor_id,v_now,jsonb_build_object('publication_key',v_key,'snapshot_id',v_snapshot->>'snapshot_id','request_id',p_request_id));
  select * into v_existing from publication_records where publication_key = v_key;
  return jsonb_build_object('status','LOCK_ACQUIRED','publication_key',v_key,'attempt',to_jsonb(v_existing),'snapshot',v_snapshot);
end;
$$;

revoke execute on function public.admin_publication_acquire(text,integer,text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_publication_acquire(text,integer,text,uuid,text,text,text) to service_role;

create or replace function public.admin_publication_transition(
  p_publication_key text,
  p_actor_id uuid,
  p_request_id text,
  p_event_type text,
  p_status text default null,
  p_snapshot jsonb default null,
  p_container_id text default null,
  p_remote_media_id text default null,
  p_permalink text default null,
  p_published_at timestamptz default null,
  p_error_code text default null,
  p_error_message_safe text default null,
  p_cleanup_status text default null,
  p_analytics_status text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_record publication_records%rowtype;
  v_now timestamptz := now();
  v_event text := upper(trim(coalesce(p_event_type,'')));
begin
  if p_actor_id is null or not exists (select 1 from profiles where id=p_actor_id and is_active and role='ADMIN') then raise exception 'ADMIN_PROFILE_INVALID'; end if;
  if p_publication_key is null or trim(p_publication_key)='' or p_request_id is null or trim(p_request_id)='' then raise exception 'PUBLICATION_PAYLOAD_INVALID'; end if;
  if v_event not in ('PUBLICATION_SNAPSHOT_CREATED','TEMP_MEDIA_RESOLVED','TEMP_MEDIA_VALIDATED','META_CONTAINER_CREATED','META_PROCESSING_STARTED','META_PROCESSING_FINISHED','MEDIA_PUBLISH_STARTED','MEDIA_PUBLISH_RETURNED','PUBLICATION_READBACK_CONFIRMED','PUBLICATION_MARKED_PUBLISHED','TEMP_MEDIA_CLEANUP_SUCCEEDED','TEMP_MEDIA_CLEANUP_FAILED','ANALYTICS_BASELINE_COLLECTED','PUBLICATION_FAILED','PUBLICATION_UNCERTAIN') then raise exception 'PUBLICATION_EVENT_INVALID'; end if;
  select * into v_record from publication_records where publication_key=p_publication_key for update;
  if not found then raise exception 'PUBLICATION_ATTEMPT_NOT_FOUND'; end if;
  update publication_records set status=coalesce(nullif(trim(p_status),''),status), snapshot=case when p_snapshot is null then snapshot else p_snapshot end, container_id=coalesce(p_container_id,container_id), remote_media_id=coalesce(p_remote_media_id,remote_media_id), permalink=coalesce(p_permalink,permalink), published_at=coalesce(p_published_at,published_at), error_code=case when p_error_code is null then error_code else p_error_code end, error_message_safe=case when p_error_message_safe is null then error_message_safe else p_error_message_safe end, cleanup_status=coalesce(p_cleanup_status,cleanup_status), analytics_status=coalesce(p_analytics_status,analytics_status), derived_checksum=coalesce(p_snapshot->>'derived_checksum',derived_checksum), snapshot_id=coalesce(p_snapshot->>'snapshot_id',snapshot_id), last_status_at=case when p_status is null then last_status_at else v_now end, updated_at=v_now where publication_key=p_publication_key returning * into v_record;
  if p_status = 'PUBLISHED' then update derived_reels set publication_status='PUBLISHED', review_queue='PUBLISHED', content_ready=false, updated_at=v_now where reel_id=v_record.reel_id; end if;
  insert into publication_audit(event_id,entity_type,entity_id,event_type,actor_id,occurred_at,metadata)
  values ('publication:'||p_publication_key||':'||v_event||':'||v_record.attempt_count,'REEL',v_record.reel_id,v_event,p_actor_id,v_now,(coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('publication_key',p_publication_key,'request_id',p_request_id,'attempt_count',v_record.attempt_count)));
  return to_jsonb(v_record);
end;
$$;

revoke execute on function public.admin_publication_transition(text,uuid,text,text,text,jsonb,text,text,text,timestamptz,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.admin_publication_transition(text,uuid,text,text,text,jsonb,text,text,text,timestamptz,text,text,text,text,jsonb) to service_role;

-- Section 11.7.9: finalize approval, readiness and queue state transitions.
-- Additive only. Historical versions, evaluations and audit events remain.

alter function public.admin_governance_mutation(text, text, integer, uuid, text, jsonb)
  rename to admin_governance_mutation_pre_state_machine;

revoke execute on function public.admin_governance_mutation_pre_state_machine(text, text, integer, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.editorial_payload_differs(
  p_reel_id text,
  p_editorial_version integer,
  p_payload jsonb
) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_editorial editorial_versions%rowtype;
  v_title text;
  v_hook text;
  v_caption text;
  v_cta text;
  v_hashtags jsonb;
  v_primary_pillar text;
  v_secondary_pillar text;
  v_cover_text text;
  v_bible_reference text;
  v_operator_note text;
begin
  select * into v_editorial
    from public.editorial_versions
   where reel_id = p_reel_id and editorial_version = p_editorial_version;
  if not found then return true; end if;

  if p_payload ? 'hashtags' and jsonb_typeof(p_payload->'hashtags') <> 'array' then
    raise exception 'EDITORIAL_HASHTAGS_INVALID';
  end if;

  v_title := coalesce(nullif(trim(p_payload->>'title'), ''), v_editorial.title);
  v_hook := coalesce(nullif(trim(p_payload->>'hook'), ''), v_editorial.hook);
  v_caption := coalesce(nullif(trim(p_payload->>'caption'), ''), v_editorial.caption);
  v_cta := coalesce(nullif(trim(p_payload->>'cta'), ''), v_editorial.cta);
  v_hashtags := coalesce(p_payload->'hashtags', v_editorial.hashtags);
  v_primary_pillar := coalesce(nullif(trim(p_payload->>'primary_pillar'), ''), v_editorial.primary_pillar);
  v_secondary_pillar := case when p_payload ? 'secondary_pillar'
    then nullif(trim(p_payload->>'secondary_pillar'), '')
    else v_editorial.secondary_pillar end;
  v_cover_text := coalesce(nullif(trim(p_payload->>'cover_text'), ''), v_editorial.cover_text);
  v_bible_reference := nullif(trim(coalesce(p_payload->>'bible_reference', '')), '');
  if v_bible_reference is null then v_bible_reference := nullif(trim(v_editorial.bible_reference), ''); end if;
  v_operator_note := case when p_payload ? 'operator_note'
    then nullif(trim(coalesce(p_payload->>'operator_note', '')), '')
    else v_editorial.operator_review_note end;

  return jsonb_build_object(
    'title', v_title, 'hook', v_hook, 'caption', v_caption, 'cta', v_cta,
    'hashtags', v_hashtags, 'primary_pillar', v_primary_pillar,
    'secondary_pillar', v_secondary_pillar, 'cover_text', v_cover_text,
    'bible_reference', coalesce(v_bible_reference, ''),
    'operator_note', v_operator_note
  ) is distinct from jsonb_build_object(
    'title', v_editorial.title, 'hook', v_editorial.hook,
    'caption', v_editorial.caption, 'cta', v_editorial.cta,
    'hashtags', v_editorial.hashtags, 'primary_pillar', v_editorial.primary_pillar,
    'secondary_pillar', v_editorial.secondary_pillar, 'cover_text', v_editorial.cover_text,
    'bible_reference', v_editorial.bible_reference,
    'operator_note', v_editorial.operator_review_note
  );
end;
$$;

revoke execute on function public.editorial_payload_differs(text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.editorial_payload_differs(text, integer, jsonb) to service_role;

create or replace function public.evaluate_governance_readiness(
  p_reel_id text,
  p_editorial_version integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_reel derived_reels%rowtype;
  v_editorial editorial_versions%rowtype;
  v_asset_id text;
  v_gates jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_ready boolean;
begin
  select * into v_reel from public.derived_reels where reel_id = p_reel_id;
  if not found then raise exception 'DERIVED_REEL_NOT_FOUND'; end if;
  select * into v_editorial from public.editorial_versions
   where reel_id = p_reel_id and editorial_version = p_editorial_version;
  if not found then raise exception 'EDITORIAL_VERSION_NOT_FOUND'; end if;
  v_asset_id := v_reel.source_asset_id;

  v_gates := jsonb_build_object(
    'technical_validation', case when v_reel.validation_status = 'PASS' then 'PASS' else 'BLOCKED' end,
    'source_integrity', case when v_reel.source_checksum_before is not null
      and v_reel.source_checksum_after is not null
      and v_reel.source_checksum_before = v_reel.source_checksum_after then 'PASS' else 'BLOCKED' end,
    'editorial_review', case when v_editorial.review_status = 'APPROVED' then 'PASS' else 'BLOCKED' end,
    'rights_status', case when exists (
      select 1 from public.rights_sources rs
      join public.rights_confirmations rc on rc.source_id = rs.source_id
      where rs.asset_id = v_asset_id and rc.rights_status = 'RIGHTS_CONFIRMED'
    ) then 'PASS' else 'BLOCKED' end,
    'bible_reference', case when nullif(trim(v_editorial.bible_reference), '') is not null
      and exists (
        select 1 from public.bible_evidence be
        join public.bible_verifications bv on bv.evidence_id = be.evidence_id
        where be.reel_id = p_reel_id
          and be.editorial_version = p_editorial_version
          and be.reference = v_editorial.bible_reference
          and be.evidence_status = 'VERIFIED'
          and bv.reel_id = p_reel_id
          and bv.editorial_version = p_editorial_version
      ) then 'PASS' else 'BLOCKED' end,
    'output_file_exists', case when nullif(trim(v_reel.output_relative_path), '') is not null
      and coalesce(v_reel.file_size, 0) > 0 then 'PASS' else 'BLOCKED' end,
    'cover_exists', case when nullif(trim(v_reel.thumbnail_relative_path), '') is not null
      then 'PASS' else 'BLOCKED' end,
    'required_editorial_fields', case when nullif(trim(v_editorial.title), '') is not null
      and nullif(trim(v_editorial.hook), '') is not null
      and nullif(trim(v_editorial.caption), '') is not null
      and nullif(trim(v_editorial.cta), '') is not null
      and v_editorial.hashtags is not null
      and jsonb_typeof(v_editorial.hashtags) = 'array'
      and jsonb_array_length(v_editorial.hashtags) > 0
      and nullif(trim(v_editorial.primary_pillar), '') is not null
      and nullif(trim(v_editorial.cover_text), '') is not null then 'PASS' else 'BLOCKED' end,
    'duplicate_publication_check', case when not exists (
      select 1 from public.publication_records pr
      where pr.reel_id = p_reel_id
        and pr.status in ('PUBLISHED', 'PROCESSING', 'PUBLISHING')
    ) then 'PASS' else 'BLOCKED' end
  );

  if v_gates->>'technical_validation' <> 'PASS' then v_reasons := v_reasons || '["TECHNICAL_VALIDATION_BLOCKED"]'::jsonb; end if;
  if v_gates->>'source_integrity' <> 'PASS' then v_reasons := v_reasons || '["SOURCE_INTEGRITY_BLOCKED"]'::jsonb; end if;
  if v_gates->>'editorial_review' <> 'PASS' then v_reasons := v_reasons || '["EDITORIAL_NOT_APPROVED"]'::jsonb; end if;
  if v_gates->>'rights_status' <> 'PASS' then v_reasons := v_reasons || '["RIGHTS_NOT_CONFIRMED"]'::jsonb; end if;
  if v_gates->>'bible_reference' <> 'PASS' then v_reasons := v_reasons || '["BIBLE_REFERENCE_MISSING"]'::jsonb; end if;
  if v_gates->>'output_file_exists' <> 'PASS' then v_reasons := v_reasons || '["OUTPUT_FILE_MISSING"]'::jsonb; end if;
  if v_gates->>'cover_exists' <> 'PASS' then v_reasons := v_reasons || '["COVER_MISSING"]'::jsonb; end if;
  if v_gates->>'required_editorial_fields' <> 'PASS' then v_reasons := v_reasons || '["REQUIRED_EDITORIAL_FIELDS_MISSING"]'::jsonb; end if;
  if v_gates->>'duplicate_publication_check' <> 'PASS' then v_reasons := v_reasons || '["DUPLICATE_PUBLICATION"]'::jsonb; end if;

  v_ready := (select bool_and(value = 'PASS') from jsonb_each_text(v_gates));
  return jsonb_build_object(
    'status', case when v_ready then 'CONTENT_READY' else 'BLOCKED' end,
    'gates', v_gates,
    'reasons', v_reasons
  );
end;
$$;

revoke execute on function public.evaluate_governance_readiness(text, integer)
  from public, anon, authenticated;
grant execute on function public.evaluate_governance_readiness(text, integer) to service_role;

create or replace function public.recompute_governance_readiness(
  p_reel_id text,
  p_editorial_version integer,
  p_evaluation_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_eval jsonb;
  v_status text;
  v_editorial_status text;
  v_publication_status text;
begin
  if p_evaluation_id is null or trim(p_evaluation_id) = '' then
    raise exception 'READINESS_EVALUATION_ID_REQUIRED';
  end if;
  v_eval := public.evaluate_governance_readiness(p_reel_id, p_editorial_version);
  v_status := v_eval->>'status';
  select review_status into v_editorial_status from public.editorial_versions
   where reel_id = p_reel_id and editorial_version = p_editorial_version;
  select publication_status into v_publication_status from public.derived_reels where reel_id = p_reel_id;

  insert into public.content_ready_evaluations (
    evaluation_id, reel_id, editorial_version, status, gates, reasons, evaluated_at
  ) values (
    p_evaluation_id, p_reel_id, p_editorial_version, v_status,
    v_eval->'gates', v_eval->'reasons', now()
  );

  update public.derived_reels
     set content_ready = v_status = 'CONTENT_READY',
         editorial_status = v_editorial_status,
         review_queue = case
           when v_publication_status = 'PUBLISHED' then 'PUBLISHED'
           when v_status = 'CONTENT_READY' then 'CONTENT_READY'
           when v_editorial_status = 'APPROVED' then 'APPROVED'
           when v_editorial_status in ('NEEDS_CHANGES', 'REJECTED') then v_editorial_status
           else 'PENDING'
         end,
         updated_at = now()
   where reel_id = p_reel_id;

  return v_eval;
end;
$$;

revoke execute on function public.recompute_governance_readiness(text, integer, text)
  from public, anon, authenticated;
grant execute on function public.recompute_governance_readiness(text, integer, text) to service_role;

create function public.admin_governance_mutation(
  p_action text,
  p_reel_id text,
  p_expected_current_version integer,
  p_actor_id uuid,
  p_request_id text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_active boolean;
  v_current integer;
  v_next integer;
  v_changed boolean := false;
  v_editorial editorial_versions%rowtype;
  v_reference text;
  v_asset_id text;
  v_eval jsonb;
  v_now timestamptz := now();
begin
  if p_action not in ('save_editorial', 'confirm_rights', 'approve_editorial', 'needs_changes', 'reject') then
    raise exception 'MUTATION_ACTION_INVALID';
  end if;

  if p_action not in ('save_editorial', 'approve_editorial') then
    return public.admin_governance_mutation_pre_state_machine(
      p_action, p_reel_id, p_expected_current_version, p_actor_id,
      p_request_id, p_payload
    );
  end if;

  if p_reel_id is null or trim(p_reel_id) = '' or p_expected_current_version < 1
     or p_actor_id is null or p_request_id is null or trim(p_request_id) = '' then
    raise exception 'MUTATION_PAYLOAD_INVALID';
  end if;

  select role, is_active into v_role, v_active from public.profiles where id = p_actor_id;
  if not found or not v_active or v_role not in ('ADMIN', 'REVIEWER') then
    raise exception 'ADMIN_PROFILE_INVALID';
  end if;
  if p_action = 'approve_editorial' and v_role <> 'ADMIN' then
    raise exception 'ADMIN_FORBIDDEN';
  end if;

  if exists (select 1 from public.publication_audit where metadata @> jsonb_build_object('request_id', p_request_id)) then
    select latest_editorial_version into v_current from public.editorial_packages where reel_id = p_reel_id;
    return jsonb_build_object('action', p_action, 'reel_id', p_reel_id, 'editorial_version', v_current, 'idempotent', true);
  end if;

  select latest_editorial_version into v_current from public.editorial_packages
   where reel_id = p_reel_id for update;
  if not found then raise exception 'EDITORIAL_PACKAGE_NOT_FOUND'; end if;
  if v_current <> p_expected_current_version then raise exception 'EDITORIAL_VERSION_CONFLICT'; end if;
  select * into v_editorial from public.editorial_versions
   where reel_id = p_reel_id and editorial_version = v_current for update;
  if not found then raise exception 'EDITORIAL_VERSION_NOT_FOUND'; end if;

  v_changed := public.editorial_payload_differs(p_reel_id, v_current, p_payload);
  v_reference := nullif(trim(coalesce(p_payload->>'bible_reference', '')), '');
  if v_reference is null then v_reference := nullif(trim(v_editorial.bible_reference), ''); end if;
  if v_reference is not null and not public.is_valid_bible_reference(v_reference) then
    raise exception 'BIBLE_REFERENCE_INVALID';
  end if;

  if p_action = 'save_editorial' and not v_changed then
    v_eval := public.evaluate_governance_readiness(p_reel_id, v_current);
    return jsonb_build_object(
      'action', p_action, 'reel_id', p_reel_id, 'editorial_version', v_current,
      'idempotent', false, 'no_changes', true, 'state', to_jsonb(v_editorial),
      'readiness', v_eval
    );
  end if;

  if v_changed then
    v_next := v_current + 1;
    insert into public.editorial_versions (
      reel_id, editorial_version, title, hook, caption, cta, hashtags,
      primary_pillar, secondary_pillar, cover_text, bible_reference,
      review_status, operator_review_note, created_by, created_at
    ) values (
      p_reel_id, v_next,
      coalesce(nullif(trim(p_payload->>'title'), ''), v_editorial.title),
      coalesce(nullif(trim(p_payload->>'hook'), ''), v_editorial.hook),
      coalesce(nullif(trim(p_payload->>'caption'), ''), v_editorial.caption),
      coalesce(nullif(trim(p_payload->>'cta'), ''), v_editorial.cta),
      coalesce(p_payload->'hashtags', v_editorial.hashtags),
      coalesce(nullif(trim(p_payload->>'primary_pillar'), ''), v_editorial.primary_pillar),
      case when p_payload ? 'secondary_pillar' then nullif(trim(p_payload->>'secondary_pillar'), '') else v_editorial.secondary_pillar end,
      coalesce(nullif(trim(p_payload->>'cover_text'), ''), v_editorial.cover_text),
      coalesce(v_reference, ''),
      'READY_FOR_HUMAN_REVIEW',
      case when p_payload ? 'operator_note' then nullif(trim(coalesce(p_payload->>'operator_note', '')), '') else v_editorial.operator_review_note end,
      p_actor_id, v_now
    ) returning * into v_editorial;
    update public.editorial_packages set latest_editorial_version = v_next, updated_at = v_now where reel_id = p_reel_id;
    update public.derived_reels set editorial_status = 'READY_FOR_HUMAN_REVIEW', review_queue = 'PENDING', content_ready = false, bible_status = case when v_reference is null then 'MISSING' else 'VERIFIED' end, updated_at = v_now where reel_id = p_reel_id;

    insert into public.publication_audit (event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata)
    values ('governance:' || p_request_id || ':editorial', 'REEL', p_reel_id, 'EDITORIAL_SAVED', p_actor_id, v_now,
      jsonb_build_object('request_id', p_request_id, 'editorial_version', v_next, 'actor_role', v_role));

    if v_reference is not null then
      insert into public.bible_evidence (evidence_id, reel_id, editorial_version, reference, source_type, source_location, evidence_status, created_at, updated_at)
      values ('bible-evidence:' || p_reel_id || ':' || v_next, p_reel_id, v_next, v_reference, 'HUMAN_ENTERED', 'remote-admin', 'VERIFIED', v_now, v_now)
      on conflict (evidence_id) do update set reference = excluded.reference, evidence_status = excluded.evidence_status, updated_at = excluded.updated_at;
      insert into public.bible_verifications (verification_id, evidence_id, reel_id, editorial_version, verified_by, verified_at, note)
      values ('bible-verification:' || p_reel_id || ':' || v_next, 'bible-evidence:' || p_reel_id || ':' || v_next, p_reel_id, v_next, p_actor_id, v_now, null)
      on conflict (verification_id) do update set verified_by = excluded.verified_by, verified_at = excluded.verified_at, note = excluded.note;
      insert into public.publication_audit (event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata)
      values ('governance:' || p_request_id || ':bible', 'REEL', p_reel_id, 'BIBLE_VERIFIED', p_actor_id, v_now,
        jsonb_build_object('request_id', p_request_id, 'editorial_version', v_next, 'actor_role', v_role, 'reference', v_reference));
    end if;
    v_current := v_next;
  end if;

  select source_asset_id into v_asset_id from public.derived_reels where reel_id = p_reel_id;

  if p_action = 'save_editorial' then
    v_eval := public.recompute_governance_readiness(p_reel_id, v_current, 'content-ready:remote:' || p_request_id);
    return jsonb_build_object(
      'action', p_action, 'reel_id', p_reel_id, 'editorial_version', v_current,
      'idempotent', false, 'no_changes', false, 'state', to_jsonb(v_editorial),
      'bible_status', case when v_reference is null then 'MISSING' else 'VERIFIED' end,
      'readiness', v_eval
    );
  end if;

  -- Approval is a review-state mutation against the current version. If the
  -- operator submitted dirty fields above, that save and this approval share
  -- the same transaction and the same resulting version.
  if nullif(trim(v_editorial.title), '') is null
     or nullif(trim(v_editorial.hook), '') is null
     or nullif(trim(v_editorial.caption), '') is null
     or nullif(trim(v_editorial.cta), '') is null
     or v_editorial.hashtags is null
     or jsonb_typeof(v_editorial.hashtags) <> 'array'
     or jsonb_array_length(v_editorial.hashtags) = 0
     or nullif(trim(v_editorial.primary_pillar), '') is null
     or nullif(trim(v_editorial.cover_text), '') is null then
    raise exception 'REQUIRED_EDITORIAL_FIELDS_MISSING';
  end if;

  update public.editorial_versions set review_status = 'APPROVED'
   where reel_id = p_reel_id and editorial_version = v_current
   returning * into v_editorial;
  select source_asset_id into v_asset_id from public.derived_reels where reel_id = p_reel_id;
  update public.derived_reels set editorial_status = 'APPROVED', last_reviewed_at = v_now, updated_at = v_now where reel_id = p_reel_id;

  insert into public.human_reviews (review_id, reel_id, editorial_version, actor_id, status, note, created_at)
  values ('human-review:' || p_reel_id || ':' || v_current || ':' || p_request_id, p_reel_id, v_current, p_actor_id, 'APPROVED', null, v_now);

  v_eval := public.recompute_governance_readiness(p_reel_id, v_current, 'content-ready:remote:' || p_request_id);

  insert into public.publication_audit (event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata)
  values ('governance:' || p_request_id || ':review', 'REEL', p_reel_id, 'EDITORIAL_APPROVED', p_actor_id, v_now,
    jsonb_build_object('request_id', p_request_id, 'editorial_version', v_current, 'actor_role', v_role, 'content_ready', v_eval->>'status' = 'CONTENT_READY'));
  insert into public.publication_audit (event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata)
  values ('governance:' || p_request_id || ':readiness', 'REEL', p_reel_id, 'CONTENT_READY_RECOMPUTED', p_actor_id, v_now,
    jsonb_build_object('request_id', p_request_id, 'editorial_version', v_current, 'status', v_eval->>'status', 'gates', v_eval->'gates'));

  return jsonb_build_object(
    'action', p_action, 'reel_id', p_reel_id, 'editorial_version', v_current,
    'idempotent', false, 'state', to_jsonb(v_editorial), 'readiness', v_eval
  );
end;
$$;

revoke execute on function public.admin_governance_mutation(text, text, integer, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_governance_mutation(text, text, integer, uuid, text, jsonb)
  to service_role;


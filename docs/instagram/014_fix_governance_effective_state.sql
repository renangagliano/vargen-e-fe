-- Section 11.7.6: canonical Bible and rights effective-state reconciliation.
-- Additive only: historical rows are preserved and no publication is started.

alter table public.bible_verifications alter column note drop not null;
alter table public.rights_confirmations alter column note drop not null;
alter table public.human_reviews alter column note drop not null;

create or replace function public.admin_governance_mutation(
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
  v_editorial editorial_versions%rowtype;
  v_gates jsonb := '{}'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_ready boolean := false;
  v_reference text;
  v_source_id text;
  v_asset_id text;
  v_previous_gates jsonb := '{}'::jsonb;
  v_previous_reasons jsonb := '[]'::jsonb;
  v_now timestamptz := now();
begin
  if p_action not in ('save_editorial', 'confirm_rights', 'approve_editorial', 'needs_changes', 'reject') then
    raise exception 'MUTATION_ACTION_INVALID';
  end if;
  if p_reel_id is null or trim(p_reel_id) = '' or p_expected_current_version < 1 or p_actor_id is null or p_request_id is null or trim(p_request_id) = '' then
    raise exception 'MUTATION_PAYLOAD_INVALID';
  end if;

  select role, is_active into v_role, v_active from profiles where id = p_actor_id;
  if not found or not v_active or v_role not in ('ADMIN', 'REVIEWER') then raise exception 'ADMIN_PROFILE_INVALID'; end if;
  if p_action in ('confirm_rights', 'approve_editorial') and v_role <> 'ADMIN' then raise exception 'ADMIN_FORBIDDEN'; end if;
  if p_action = 'confirm_rights' and p_payload->>'confirmation_statement' <> 'I confirm that I have the necessary rights or authorization to use and publish this media for the Vargen & Fé project.' then raise exception 'RIGHTS_CONFIRMATION_REQUIRED'; end if;
  if p_action = 'reject' and p_payload->>'confirm_rejection' <> 'true' then raise exception 'REJECTION_CONFIRMATION_REQUIRED'; end if;

  -- A request id makes a retry of the same browser submission harmless.
  if exists (select 1 from publication_audit where metadata @> jsonb_build_object('request_id', p_request_id)) then
    return jsonb_build_object('action', p_action, 'reel_id', p_reel_id, 'idempotent', true);
  end if;

  select latest_editorial_version into v_current from editorial_packages where reel_id = p_reel_id for update;
  if not found then raise exception 'EDITORIAL_PACKAGE_NOT_FOUND'; end if;
  if v_current <> p_expected_current_version then raise exception 'EDITORIAL_VERSION_CONFLICT'; end if;
  select * into v_editorial from editorial_versions where reel_id = p_reel_id and editorial_version = v_current for update;
  if not found then raise exception 'EDITORIAL_VERSION_NOT_FOUND'; end if;

  if p_action = 'save_editorial' then
    select gates, reasons into v_previous_gates, v_previous_reasons
    from content_ready_evaluations
    where reel_id = p_reel_id and (editorial_version = v_current or editorial_version is null)
    order by (editorial_version is null), evaluated_at desc limit 1;
    v_reference := case when p_payload ? 'bible_reference' then nullif(trim(coalesce(p_payload->>'bible_reference', '')), '') else nullif(trim(v_editorial.bible_reference), '') end;
    if v_reference is not null and (length(v_reference) > 120 or v_reference !~ '^([1-3][[:space:]]+)?[[:alpha:]]+([[:space:]]+[[:alpha:]]+)*[[:space:]]+[0-9]+(:[0-9]+(-[0-9]+)?|,[0-9]+(-[0-9]+)?(\.[0-9]+(-[0-9]+)?)*)?)$') then
      raise exception 'BIBLE_REFERENCE_INVALID';
    end if;

    v_next := v_current + 1;
    insert into editorial_versions (
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
    update editorial_packages set latest_editorial_version = v_next, updated_at = v_now where reel_id = p_reel_id;
    update derived_reels set editorial_status = 'READY_FOR_HUMAN_REVIEW', content_ready = false, bible_status = case when v_reference is null then 'MISSING' else 'VERIFIED' end, updated_at = v_now where reel_id = p_reel_id;

    insert into publication_audit (event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata)
    values ('governance:' || p_request_id || ':editorial', 'REEL', p_reel_id, 'EDITORIAL_SAVED', p_actor_id, v_now, jsonb_build_object('request_id', p_request_id, 'editorial_version', v_next, 'actor_role', v_role));
    if v_reference is not null then
      insert into bible_evidence (evidence_id, reel_id, editorial_version, reference, source_type, source_location, evidence_status, created_at, updated_at)
      values ('bible-evidence:' || p_reel_id || ':' || v_next, p_reel_id, v_next, v_reference, 'HUMAN_ENTERED', 'remote-admin', 'VERIFIED', v_now, v_now)
      on conflict (evidence_id) do update set reference = excluded.reference, evidence_status = excluded.evidence_status, updated_at = excluded.updated_at;
      insert into bible_verifications (verification_id, evidence_id, reel_id, editorial_version, verified_by, verified_at, note)
      values ('bible-verification:' || p_reel_id || ':' || v_next, 'bible-evidence:' || p_reel_id || ':' || v_next, p_reel_id, v_next, p_actor_id, v_now, null)
      on conflict (verification_id) do update set verified_by = excluded.verified_by, verified_at = excluded.verified_at, note = excluded.note;
      insert into publication_audit (event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata)
      values ('governance:' || p_request_id || ':bible', 'REEL', p_reel_id, 'BIBLE_VERIFIED', p_actor_id, v_now, jsonb_build_object('request_id', p_request_id, 'editorial_version', v_next, 'actor_role', v_role, 'reference', v_reference));
    end if;
    select source_asset_id into v_asset_id from derived_reels where reel_id = p_reel_id;
    v_gates := coalesce(v_previous_gates, '{}'::jsonb);
    v_gates := jsonb_set(v_gates, '{editorial_review}', '"BLOCKED"'::jsonb, true);
    v_gates := jsonb_set(v_gates, '{bible_reference}', to_jsonb(case when v_reference is null then 'BLOCKED' else 'PASS' end), true);
    v_gates := jsonb_set(v_gates, '{rights_status}', to_jsonb(case when exists (
      select 1 from rights_sources rs join rights_confirmations rc on rc.source_id = rs.source_id
      where rs.asset_id = v_asset_id and rc.rights_status = 'RIGHTS_CONFIRMED'
    ) then 'PASS' else coalesce(v_gates->>'rights_status', 'BLOCKED') end), true);
    insert into content_ready_evaluations (evaluation_id, reel_id, editorial_version, status, gates, reasons, evaluated_at)
    values (
      'content-ready:remote:' || p_request_id, p_reel_id, v_next, 'BLOCKED', v_gates,
      jsonb_build_array('EDITORIAL_NOT_APPROVED') || case when v_reference is null then jsonb_build_array('BIBLE_REFERENCE_MISSING') else '[]'::jsonb end,
      v_now
    );
    update derived_reels set content_ready = false, updated_at = v_now where reel_id = p_reel_id;
    return jsonb_build_object('action', p_action, 'reel_id', p_reel_id, 'editorial_version', v_next, 'idempotent', false, 'state', to_jsonb(v_editorial), 'bible_status', case when v_reference is null then 'MISSING' else 'VERIFIED' end, 'readiness', jsonb_build_object('status', 'BLOCKED', 'gates', v_gates));
  end if;

  if p_action = 'confirm_rights' then
    select source_asset_id into v_asset_id from derived_reels where reel_id = p_reel_id for update;
    if not found or nullif(trim(v_asset_id), '') is null then raise exception 'SOURCE_ASSET_NOT_FOUND'; end if;
    select source_id into v_source_id from rights_sources where asset_id = v_asset_id order by created_at asc limit 1 for update;
    if not found then
      v_source_id := 'rights-source:' || v_asset_id;
      insert into rights_sources (source_id, asset_id, source_type, source_location, source_checksum, created_at)
      values (v_source_id, v_asset_id, 'SOURCE_ASSET', 'remote-admin', null, v_now)
      on conflict (source_id) do nothing;
      select source_id into v_source_id from rights_sources where asset_id = v_asset_id order by created_at asc limit 1;
    end if;
    insert into rights_confirmations (confirmation_id, source_id, actor_id, rights_status, confirmation_scope, statement_version, note, confirmed_at)
    values ('rights-confirmation:' || p_reel_id || ':' || p_request_id, v_source_id, p_actor_id, 'RIGHTS_CONFIRMED', 'SOURCE_AND_DERIVED_REELS', 'rights-confirmation-v1', null, v_now);
    update media_assets set rights_status = 'RIGHTS_CONFIRMED', updated_at = v_now where asset_id = v_asset_id;
    update derived_reels set rights_status = 'RIGHTS_CONFIRMED', updated_at = v_now where source_asset_id = v_asset_id;
    insert into publication_audit (event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata)
    values ('governance:' || p_request_id || ':rights', 'REEL', p_reel_id, 'RIGHTS_CONFIRMED', p_actor_id, v_now, jsonb_build_object('request_id', p_request_id, 'source_id', v_source_id, 'source_asset_id', v_asset_id, 'actor_role', v_role, 'confirmation_statement', p_payload->>'confirmation_statement'));
    select gates, reasons into v_gates, v_reasons from content_ready_evaluations where reel_id = p_reel_id and (editorial_version = v_current or editorial_version is null) order by (editorial_version is null), evaluated_at desc limit 1;
    v_gates := jsonb_set(coalesce(v_gates, '{}'::jsonb), '{rights_status}', '"PASS"'::jsonb, true);
    v_gates := jsonb_set(v_gates, '{editorial_review}', to_jsonb(case when v_editorial.review_status = 'APPROVED' then 'PASS' else 'BLOCKED' end), true);
    v_gates := jsonb_set(v_gates, '{bible_reference}', to_jsonb(case when exists (
      select 1 from bible_evidence be join bible_verifications bv on bv.evidence_id = be.evidence_id
      where be.reel_id = p_reel_id and be.editorial_version = v_current and be.evidence_status = 'VERIFIED' and bv.editorial_version = v_current
    ) then 'PASS' else 'BLOCKED' end), true);
    v_ready := v_editorial.review_status = 'APPROVED'
      and coalesce(v_gates->>'technical_validation', 'FAIL') = 'PASS'
      and coalesce(v_gates->>'source_integrity', 'FAIL') = 'PASS'
      and coalesce(v_gates->>'rights_status', 'FAIL') = 'PASS'
      and coalesce(v_gates->>'bible_reference', 'FAIL') = 'PASS'
      and coalesce(v_gates->>'output_file_exists', 'FAIL') = 'PASS'
      and coalesce(v_gates->>'cover_exists', 'FAIL') = 'PASS'
      and coalesce(v_gates->>'required_editorial_fields', 'FAIL') = 'PASS'
      and coalesce(v_gates->>'duplicate_publication_check', 'FAIL') = 'PASS';
    insert into content_ready_evaluations (evaluation_id, reel_id, editorial_version, status, gates, reasons, evaluated_at)
    values ('content-ready:rights:' || p_request_id, p_reel_id, v_current, case when v_ready then 'CONTENT_READY' else 'BLOCKED' end, v_gates, coalesce(v_reasons, '[]'::jsonb), v_now);
    update derived_reels set content_ready = v_ready, updated_at = v_now where reel_id = p_reel_id;
    return jsonb_build_object('action', p_action, 'reel_id', p_reel_id, 'editorial_version', v_current, 'idempotent', false, 'state', jsonb_build_object('rights_status', 'RIGHTS_CONFIRMED'), 'readiness', jsonb_build_object('status', case when v_ready then 'CONTENT_READY' else 'BLOCKED' end, 'gates', v_gates));
  end if;

  if p_action = 'approve_editorial' and (
    nullif(trim(v_editorial.title), '') is null
    or nullif(trim(v_editorial.hook), '') is null
    or nullif(trim(v_editorial.caption), '') is null
    or nullif(trim(v_editorial.cta), '') is null
    or v_editorial.hashtags is null
    or jsonb_typeof(v_editorial.hashtags) <> 'array'
    or jsonb_array_length(v_editorial.hashtags) = 0
    or nullif(trim(v_editorial.primary_pillar), '') is null
    or nullif(trim(v_editorial.cover_text), '') is null
  ) then raise exception 'REQUIRED_EDITORIAL_FIELDS_MISSING'; end if;

  select source_asset_id into v_asset_id from derived_reels where reel_id = p_reel_id;
  update editorial_versions set review_status = case p_action when 'approve_editorial' then 'APPROVED' when 'needs_changes' then 'NEEDS_CHANGES' else 'REJECTED' end where reel_id = p_reel_id and editorial_version = v_current returning * into v_editorial;
  insert into human_reviews (review_id, reel_id, editorial_version, actor_id, status, note, created_at)
  values ('human-review:' || p_reel_id || ':' || v_current || ':' || p_request_id, p_reel_id, v_current, p_actor_id, v_editorial.review_status, null, v_now);
  update derived_reels set editorial_status = v_editorial.review_status, review_queue = case when v_editorial.review_status = 'APPROVED' then 'APPROVED' else v_editorial.review_status end, last_reviewed_at = v_now, updated_at = v_now where reel_id = p_reel_id;
  select gates, reasons into v_gates, v_reasons from content_ready_evaluations where reel_id = p_reel_id and (editorial_version = v_current or editorial_version is null) order by (editorial_version is null), evaluated_at desc limit 1;
  v_gates := jsonb_set(coalesce(v_gates, '{}'::jsonb), '{editorial_review}', to_jsonb(case when v_editorial.review_status = 'APPROVED' then 'PASS' else 'BLOCKED' end), true);
  v_gates := jsonb_set(v_gates, '{rights_status}', to_jsonb(case when exists (
    select 1 from rights_sources rs join rights_confirmations rc on rc.source_id = rs.source_id
    where rs.asset_id = v_asset_id and rc.rights_status = 'RIGHTS_CONFIRMED'
  ) then 'PASS' else 'BLOCKED' end), true);
  v_gates := jsonb_set(v_gates, '{bible_reference}', to_jsonb(case when exists (
    select 1 from bible_evidence be join bible_verifications bv on bv.evidence_id = be.evidence_id
    where be.reel_id = p_reel_id and be.editorial_version = v_current and be.evidence_status = 'VERIFIED' and bv.editorial_version = v_current
  ) then 'PASS' else 'BLOCKED' end), true);
  v_ready := v_editorial.review_status = 'APPROVED'
    and coalesce(v_gates->>'technical_validation', 'FAIL') = 'PASS'
    and coalesce(v_gates->>'source_integrity', 'FAIL') = 'PASS'
    and coalesce(v_gates->>'rights_status', 'FAIL') = 'PASS'
    and coalesce(v_gates->>'bible_reference', v_gates->>'bible_reference_valid', 'FAIL') = 'PASS'
    and coalesce(v_gates->>'output_file_exists', 'FAIL') = 'PASS'
    and coalesce(v_gates->>'cover_exists', 'FAIL') = 'PASS'
    and coalesce(v_gates->>'required_editorial_fields', 'FAIL') = 'PASS'
    and coalesce(v_gates->>'duplicate_publication_check', 'FAIL') = 'PASS';
  insert into content_ready_evaluations (evaluation_id, reel_id, editorial_version, status, gates, reasons, evaluated_at)
  values ('content-ready:remote:' || p_request_id, p_reel_id, v_current, case when v_ready then 'CONTENT_READY' else 'BLOCKED' end, v_gates, coalesce(v_reasons, '[]'::jsonb), v_now);
  update derived_reels set content_ready = v_ready, updated_at = v_now where reel_id = p_reel_id;
  insert into publication_audit (event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata)
  values ('governance:' || p_request_id || ':review', 'REEL', p_reel_id, case p_action when 'approve_editorial' then 'EDITORIAL_APPROVED' when 'needs_changes' then 'EDITORIAL_NEEDS_CHANGES' else 'EDITORIAL_REJECTED' end, p_actor_id, v_now, jsonb_build_object('request_id', p_request_id, 'editorial_version', v_current, 'actor_role', v_role, 'content_ready', v_ready));
  return jsonb_build_object('action', p_action, 'reel_id', p_reel_id, 'editorial_version', v_current, 'idempotent', false, 'state', to_jsonb(v_editorial), 'readiness', jsonb_build_object('status', case when v_ready then 'CONTENT_READY' else 'BLOCKED' end, 'gates', v_gates, 'reasons', v_reasons));
end;
$$;

revoke execute on function public.admin_governance_mutation(text, text, integer, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_governance_mutation(text, text, integer, uuid, text, jsonb) to service_role;



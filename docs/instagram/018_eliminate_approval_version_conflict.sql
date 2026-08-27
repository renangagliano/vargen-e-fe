-- Section 11.7.10: eliminate false approval conflicts without weakening
-- optimistic concurrency. The client still supplies the expected version and
-- the package row remains the serialization point for concurrent mutations.

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

  if p_reel_id is null or trim(p_reel_id) = ''
     or p_expected_current_version < 1
     or p_actor_id is null
     or p_request_id is null or trim(p_request_id) = '' then
    raise exception 'MUTATION_PAYLOAD_INVALID';
  end if;

  select role, is_active
    into v_role, v_active
    from public.profiles
   where id = p_actor_id;
  if not found or not v_active or v_role not in ('ADMIN', 'REVIEWER') then
    raise exception 'ADMIN_PROFILE_INVALID';
  end if;
  if p_action = 'approve_editorial' and v_role <> 'ADMIN' then
    raise exception 'ADMIN_FORBIDDEN';
  end if;

  -- Request idempotency is checked before the version guard. A retry of the
  -- exact completed request therefore cannot become a false conflict.
  if exists (
    select 1 from public.publication_audit
     where metadata @> jsonb_build_object('request_id', p_request_id)
  ) then
    select latest_editorial_version
      into v_current
      from public.editorial_packages
     where reel_id = p_reel_id;
    select * into v_editorial
      from public.editorial_versions
     where reel_id = p_reel_id and editorial_version = v_current;
    select jsonb_build_object('status', status, 'gates', gates, 'reasons', reasons)
      into v_eval
      from public.content_ready_evaluations
     where reel_id = p_reel_id and editorial_version = v_current
     order by evaluated_at desc
     limit 1;
    return jsonb_build_object(
      'action', p_action, 'reel_id', p_reel_id,
      'editorial_version', v_current, 'idempotent', true,
      'state', to_jsonb(v_editorial), 'readiness', v_eval
    );
  end if;

  -- This row lock serializes all versioned editorial decisions for a Reel.
  select latest_editorial_version
    into v_current
    from public.editorial_packages
   where reel_id = p_reel_id
   for update;
  if not found then
    raise exception 'EDITORIAL_PACKAGE_NOT_FOUND';
  end if;
  if v_current <> p_expected_current_version then
    raise exception 'EDITORIAL_VERSION_CONFLICT';
  end if;

  select * into v_editorial
    from public.editorial_versions
   where reel_id = p_reel_id and editorial_version = v_current
   for update;
  if not found then
    raise exception 'EDITORIAL_VERSION_NOT_FOUND';
  end if;

  v_changed := public.editorial_payload_differs(p_reel_id, v_current, p_payload);
  v_reference := nullif(trim(coalesce(p_payload->>'bible_reference', '')), '');
  if v_reference is null then
    v_reference := nullif(trim(v_editorial.bible_reference), '');
  end if;
  if v_reference is not null and not public.is_valid_bible_reference(v_reference) then
    raise exception 'BIBLE_REFERENCE_INVALID';
  end if;

  if p_action = 'save_editorial' and not v_changed then
    select jsonb_build_object('status', status, 'gates', gates, 'reasons', reasons)
      into v_eval
      from public.content_ready_evaluations
     where reel_id = p_reel_id and editorial_version = v_current
     order by evaluated_at desc
     limit 1;
    return jsonb_build_object(
      'action', p_action, 'reel_id', p_reel_id,
      'editorial_version', v_current, 'idempotent', false,
      'no_changes', true, 'state', to_jsonb(v_editorial),
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
      case when p_payload ? 'secondary_pillar'
        then nullif(trim(p_payload->>'secondary_pillar'), '')
        else v_editorial.secondary_pillar end,
      coalesce(nullif(trim(p_payload->>'cover_text'), ''), v_editorial.cover_text),
      coalesce(v_reference, ''), 'READY_FOR_HUMAN_REVIEW',
      case when p_payload ? 'operator_note'
        then nullif(trim(coalesce(p_payload->>'operator_note', '')), '')
        else v_editorial.operator_review_note end,
      p_actor_id, v_now
    ) returning * into v_editorial;

    update public.editorial_packages
       set latest_editorial_version = v_next, updated_at = v_now
     where reel_id = p_reel_id;
    update public.derived_reels
       set editorial_status = 'READY_FOR_HUMAN_REVIEW',
           review_queue = 'PENDING', content_ready = false,
           bible_status = case when v_reference is null then 'MISSING' else 'VERIFIED' end,
           updated_at = v_now
     where reel_id = p_reel_id;

    insert into public.publication_audit (
      event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata
    ) values (
      'governance:' || p_request_id || ':editorial', 'REEL', p_reel_id,
      'EDITORIAL_SAVED', p_actor_id, v_now,
      jsonb_build_object('request_id', p_request_id,
                         'editorial_version', v_next, 'actor_role', v_role)
    );

    if v_reference is not null then
      insert into public.bible_evidence (
        evidence_id, reel_id, editorial_version, reference, source_type,
        source_location, evidence_status, created_at, updated_at
      ) values (
        'bible-evidence:' || p_reel_id || ':' || v_next,
        p_reel_id, v_next, v_reference, 'HUMAN_ENTERED', 'remote-admin',
        'VERIFIED', v_now, v_now
      ) on conflict (evidence_id) do update set
        reference = excluded.reference,
        evidence_status = excluded.evidence_status,
        updated_at = excluded.updated_at;

      insert into public.bible_verifications (
        verification_id, evidence_id, reel_id, editorial_version,
        verified_by, verified_at, note
      ) values (
        'bible-verification:' || p_reel_id || ':' || v_next,
        'bible-evidence:' || p_reel_id || ':' || v_next,
        p_reel_id, v_next, p_actor_id, v_now, null
      ) on conflict (verification_id) do update set
        verified_by = excluded.verified_by,
        verified_at = excluded.verified_at,
        note = excluded.note;

      insert into public.publication_audit (
        event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata
      ) values (
        'governance:' || p_request_id || ':bible', 'REEL', p_reel_id,
        'BIBLE_VERIFIED', p_actor_id, v_now,
        jsonb_build_object('request_id', p_request_id,
                           'editorial_version', v_next,
                           'actor_role', v_role, 'reference', v_reference)
      );
    end if;
    v_current := v_next;
  end if;

  if p_action = 'save_editorial' then
    v_eval := public.recompute_governance_readiness(
      p_reel_id, v_current, 'content-ready:remote:' || p_request_id
    );
    return jsonb_build_object(
      'action', p_action, 'reel_id', p_reel_id,
      'editorial_version', v_current, 'idempotent', false,
      'no_changes', false, 'state', to_jsonb(v_editorial),
      'readiness', v_eval
    );
  end if;

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

  -- A second approval for the same clean version is a canonical no-op. This
  -- protects retries with a fresh request id as well as request-id retries.
  if p_action = 'approve_editorial'
     and v_editorial.review_status = 'APPROVED'
     and not v_changed then
    select jsonb_build_object('status', status, 'gates', gates, 'reasons', reasons)
      into v_eval
      from public.content_ready_evaluations
     where reel_id = p_reel_id and editorial_version = v_current
     order by evaluated_at desc
     limit 1;
    return jsonb_build_object(
      'action', p_action, 'reel_id', p_reel_id,
      'editorial_version', v_current, 'idempotent', true,
      'state', to_jsonb(v_editorial), 'readiness', v_eval
    );
  end if;

  update public.editorial_versions
     set review_status = 'APPROVED'
   where reel_id = p_reel_id and editorial_version = v_current
   returning * into v_editorial;
  update public.derived_reels
     set editorial_status = 'APPROVED', last_reviewed_at = v_now, updated_at = v_now
   where reel_id = p_reel_id;

  insert into public.human_reviews (
    review_id, reel_id, editorial_version, actor_id, status, note, created_at
  ) values (
    'human-review:' || p_reel_id || ':' || v_current || ':' || p_request_id,
    p_reel_id, v_current, p_actor_id, 'APPROVED', null, v_now
  );

  v_eval := public.recompute_governance_readiness(
    p_reel_id, v_current, 'content-ready:remote:' || p_request_id
  );

  insert into public.publication_audit (
    event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata
  ) values (
    'governance:' || p_request_id || ':review', 'REEL', p_reel_id,
    'EDITORIAL_APPROVED', p_actor_id, v_now,
    jsonb_build_object('request_id', p_request_id,
                       'editorial_version', v_current,
                       'actor_role', v_role,
                       'content_ready', v_eval->>'status' = 'CONTENT_READY')
  );
  insert into public.publication_audit (
    event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata
  ) values (
    'governance:' || p_request_id || ':readiness', 'REEL', p_reel_id,
    'CONTENT_READY_RECOMPUTED', p_actor_id, v_now,
    jsonb_build_object('request_id', p_request_id,
                       'editorial_version', v_current,
                       'status', v_eval->>'status', 'gates', v_eval->'gates')
  );

  return jsonb_build_object(
    'action', p_action, 'reel_id', p_reel_id,
    'editorial_version', v_current, 'idempotent', false,
    'state', to_jsonb(v_editorial), 'readiness', v_eval
  );
end;
$$;

revoke execute on function public.admin_governance_mutation(text, text, integer, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_governance_mutation(text, text, integer, uuid, text, jsonb)
  to service_role;

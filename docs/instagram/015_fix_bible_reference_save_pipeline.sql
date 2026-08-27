-- Section 11.7.8: finalize the authenticated Bible-reference save pipeline.
-- Additive only. Historical editorial versions and audit rows are preserved.
-- The existing function is retained under a private legacy name for the
-- non-editorial actions while save_editorial uses the corrected path below.

create or replace function public.is_valid_bible_reference(p_reference text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_reference text := regexp_replace(trim(coalesce(p_reference, '')), '[[:space:]]+', ' ', 'g');
  v_book text := '^([1-3][[:space:]]+)?[[:alpha:]]+([[:space:]]+[[:alpha:]]+)*[[:space:]]+';
begin
  if v_reference = '' or length(v_reference) > 120 then
    return false;
  end if;

  -- Keep the grammar aligned with the application validator: numeric book
  -- prefixes, accented Unicode letters, chapter-only, chapter:verse, ranges,
  -- and the existing comma/dot verse-list form. [.] avoids fragile escaping.
  return v_reference ~ (v_book || '[0-9]+$')
    or v_reference ~ (v_book || '[0-9]+:[0-9]+(-[0-9]+)?$')
    or v_reference ~ (v_book || '[0-9]+,[0-9]+(-[0-9]+)?([.][0-9]+(-[0-9]+)?)*$');
end;
$$;

revoke execute on function public.is_valid_bible_reference(text) from public, anon, authenticated;
grant execute on function public.is_valid_bible_reference(text) to service_role;

alter function public.admin_governance_mutation(text, text, integer, uuid, text, jsonb)
  rename to admin_governance_mutation_legacy;

revoke execute on function public.admin_governance_mutation_legacy(text, text, integer, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

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
  v_editorial editorial_versions%rowtype;
  v_gates jsonb := '{}'::jsonb;
  v_previous_gates jsonb := '{}'::jsonb;
  v_reference text;
  v_asset_id text;
  v_now timestamptz := now();
begin
  -- Preserve the already validated rights/review behavior while replacing
  -- only the broken Bible save path.
  if p_action <> 'save_editorial' then
    return public.admin_governance_mutation_legacy(
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

  -- A request id makes a retry of the same browser submission harmless.
  if exists (
    select 1
      from public.publication_audit
     where metadata @> jsonb_build_object('request_id', p_request_id)
  ) then
    select latest_editorial_version
      into v_current
      from public.editorial_packages
     where reel_id = p_reel_id;
    return jsonb_build_object(
      'action', p_action,
      'reel_id', p_reel_id,
      'editorial_version', v_current,
      'idempotent', true
    );
  end if;

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

  select *
    into v_editorial
    from public.editorial_versions
   where reel_id = p_reel_id
     and editorial_version = v_current
   for update;
  if not found then
    raise exception 'EDITORIAL_VERSION_NOT_FOUND';
  end if;

  -- Omitted, null, or blank input preserves an existing reference. A valid
  -- non-empty reference is attached to the new version created below.
  v_reference := nullif(trim(coalesce(p_payload->>'bible_reference', '')), '');
  if v_reference is null then
    v_reference := nullif(trim(v_editorial.bible_reference), '');
  end if;
  if v_reference is not null and not public.is_valid_bible_reference(v_reference) then
    raise exception 'BIBLE_REFERENCE_INVALID';
  end if;

  select gates
    into v_previous_gates
    from public.content_ready_evaluations
   where reel_id = p_reel_id
     and (editorial_version = v_current or editorial_version is null)
   order by (editorial_version is null), evaluated_at desc
   limit 1;

  v_next := v_current + 1;
  insert into public.editorial_versions (
    reel_id, editorial_version, title, hook, caption, cta, hashtags,
    primary_pillar, secondary_pillar, cover_text, bible_reference,
    review_status, operator_review_note, created_by, created_at
  ) values (
    p_reel_id,
    v_next,
    coalesce(nullif(trim(p_payload->>'title'), ''), v_editorial.title),
    coalesce(nullif(trim(p_payload->>'hook'), ''), v_editorial.hook),
    coalesce(nullif(trim(p_payload->>'caption'), ''), v_editorial.caption),
    coalesce(nullif(trim(p_payload->>'cta'), ''), v_editorial.cta),
    coalesce(p_payload->'hashtags', v_editorial.hashtags),
    coalesce(nullif(trim(p_payload->>'primary_pillar'), ''), v_editorial.primary_pillar),
    case when p_payload ? 'secondary_pillar'
      then nullif(trim(p_payload->>'secondary_pillar'), '')
      else v_editorial.secondary_pillar
    end,
    coalesce(nullif(trim(p_payload->>'cover_text'), ''), v_editorial.cover_text),
    coalesce(v_reference, ''),
    'READY_FOR_HUMAN_REVIEW',
    case when p_payload ? 'operator_note'
      then nullif(trim(coalesce(p_payload->>'operator_note', '')), '')
      else v_editorial.operator_review_note
    end,
    p_actor_id,
    v_now
  ) returning * into v_editorial;

  update public.editorial_packages
     set latest_editorial_version = v_next,
         updated_at = v_now
   where reel_id = p_reel_id;

  update public.derived_reels
     set editorial_status = 'READY_FOR_HUMAN_REVIEW',
         content_ready = false,
         bible_status = case when v_reference is null then 'MISSING' else 'VERIFIED' end,
         updated_at = v_now
   where reel_id = p_reel_id;

  insert into public.publication_audit (
    event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata
  ) values (
    'governance:' || p_request_id || ':editorial',
    'REEL', p_reel_id, 'EDITORIAL_SAVED', p_actor_id, v_now,
    jsonb_build_object(
      'request_id', p_request_id,
      'editorial_version', v_next,
      'actor_role', v_role
    )
  );

  if v_reference is not null then
    insert into public.bible_evidence (
      evidence_id, reel_id, editorial_version, reference, source_type,
      source_location, evidence_status, created_at, updated_at
    ) values (
      'bible-evidence:' || p_reel_id || ':' || v_next,
      p_reel_id, v_next, v_reference, 'HUMAN_ENTERED', 'remote-admin',
      'VERIFIED', v_now, v_now
    )
    on conflict (evidence_id) do update set
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
    )
    on conflict (verification_id) do update set
      verified_by = excluded.verified_by,
      verified_at = excluded.verified_at,
      note = excluded.note;

    insert into public.publication_audit (
      event_id, entity_type, entity_id, event_type, actor_id, occurred_at, metadata
    ) values (
      'governance:' || p_request_id || ':bible',
      'REEL', p_reel_id, 'BIBLE_VERIFIED', p_actor_id, v_now,
      jsonb_build_object(
        'request_id', p_request_id,
        'editorial_version', v_next,
        'actor_role', v_role,
        'reference', v_reference
      )
    );
  end if;

  select source_asset_id
    into v_asset_id
    from public.derived_reels
   where reel_id = p_reel_id;

  v_gates := coalesce(v_previous_gates, '{}'::jsonb);
  v_gates := jsonb_set(v_gates, '{editorial_review}', '"BLOCKED"'::jsonb, true);
  v_gates := jsonb_set(
    v_gates,
    '{bible_reference}',
    to_jsonb(case when v_reference is null then 'BLOCKED' else 'PASS' end),
    true
  );
  v_gates := jsonb_set(
    v_gates,
    '{rights_status}',
    to_jsonb(case when exists (
      select 1
        from public.rights_sources rs
        join public.rights_confirmations rc on rc.source_id = rs.source_id
       where rs.asset_id = v_asset_id
         and rc.rights_status = 'RIGHTS_CONFIRMED'
    ) then 'PASS' else coalesce(v_gates->>'rights_status', 'BLOCKED') end),
    true
  );

  insert into public.content_ready_evaluations (
    evaluation_id, reel_id, editorial_version, status, gates, reasons, evaluated_at
  ) values (
    'content-ready:remote:' || p_request_id,
    p_reel_id,
    v_next,
    'BLOCKED',
    v_gates,
    jsonb_build_array('EDITORIAL_NOT_APPROVED')
      || case when v_reference is null
        then jsonb_build_array('BIBLE_REFERENCE_MISSING')
        else '[]'::jsonb
      end,
    v_now
  );

  return jsonb_build_object(
    'action', p_action,
    'reel_id', p_reel_id,
    'editorial_version', v_next,
    'idempotent', false,
    'state', to_jsonb(v_editorial),
    'bible_status', case when v_reference is null then 'MISSING' else 'VERIFIED' end,
    'readiness', jsonb_build_object('status', 'BLOCKED', 'gates', v_gates)
  );
end;
$$;

revoke execute on function public.admin_governance_mutation(text, text, integer, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_governance_mutation(text, text, integer, uuid, text, jsonb)
  to service_role;


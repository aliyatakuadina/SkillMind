-- Short, service-only queue transactions. External model/media calls must happen
-- AFTER claim commits. The service credential is a trusted boundary: workers use
-- these fenced RPCs, never direct table writes for checkpoints/results.
create index ai_jobs_running_idx on public.ai_jobs(updated_at, id) where status = 'running';

create function private.ai_task_enabled(p_task public.ai_task_type)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select case
    when p_task = 'chat' then s.chat_enabled
    when p_task = 'video_bundle' then s.video_enabled
    when p_task = 'embedding' then s.chat_enabled
    else s.author_tools_enabled end
  from public.ai_runtime_settings s where s.singleton), false);
$$;

-- This helper checks the ORIGINAL requester, not the service-role JWT.
create function private.ai_job_context_error(
  p_job public.ai_jobs, p_check_revisions boolean default true
)
returns text language plpgsql stable security invoker set search_path = '' as $$
declare
  actor_role public.user_role;
  course public.courses;
begin
  select role into actor_role from public.profiles where id = p_job.requested_by;
  if actor_role is null then return 'AI_REQUESTER_UNAVAILABLE'; end if;
  if p_job.task_type = 'course_structure' then
    if p_job.lesson_id is not null or p_job.source_id is not null then return 'AI_INVALID_SCOPE'; end if;
  elsif p_job.course_id is null then return 'AI_INVALID_SCOPE';
  end if;
  if p_job.task_type in ('lesson_summary', 'quiz', 'translation', 'video_bundle') and p_job.lesson_id is null then
    return 'AI_INVALID_SCOPE';
  end if;
  if p_job.task_type = 'video_bundle' and p_job.source_id is null then return 'AI_INVALID_SCOPE'; end if;
  if p_job.task_type in ('chat', 'embedding') and p_job.source_id is not null then return 'AI_INVALID_SCOPE'; end if;
  if p_job.course_id is not null then
    select * into course from public.courses where id = p_job.course_id;
    if not found then return 'AI_COURSE_UNAVAILABLE'; end if;
  end if;
  if p_job.task_type = 'chat' then
    if course.status <> 'published' or not (actor_role = 'admin' or course.author_id = p_job.requested_by
      or exists (select 1 from public.enrollments where course_id = course.id and user_id = p_job.requested_by)) then
      return 'AI_ACCESS_DENIED';
    end if;
    if exists (select 1 from public.quiz_attempts a join public.quizzes q on q.id = a.quiz_id
      join public.lessons l on l.id = q.lesson_id join public.modules m on m.id = l.module_id
      where a.user_id = p_job.requested_by and a.status = 'in_progress' and m.course_id = course.id) then
      return 'AI_ASSESSMENT_ACTIVE';
    end if;
  elsif actor_role not in ('teacher', 'admin') or
    (p_job.course_id is not null and actor_role <> 'admin' and course.author_id <> p_job.requested_by) then
    return 'AI_ACCESS_DENIED';
  end if;
  if p_job.lesson_id is not null and not exists (
    select 1 from public.lessons l join public.modules m on m.id = l.module_id
    where l.id = p_job.lesson_id and m.course_id = p_job.course_id
  ) then return 'AI_INVALID_SCOPE'; end if;
  if p_job.source_id is not null and not exists (
    select 1 from public.media_sources where id = p_job.source_id and lesson_id = p_job.lesson_id and course_id = p_job.course_id
  ) then return 'AI_INVALID_SCOPE'; end if;
  if p_check_revisions then
    if p_job.course_id is not null and course.content_revision is distinct from p_job.course_revision then
      return 'AI_STALE_COURSE';
    end if;
    if p_job.lesson_id is not null and not exists (
      select 1 from public.lessons where id = p_job.lesson_id and content_revision = p_job.lesson_revision
    ) then return 'AI_STALE_LESSON'; end if;
    if p_job.source_id is not null and not exists (
      select 1 from public.media_sources where id = p_job.source_id and content_revision = p_job.source_revision and status = 'ready'
    ) then return 'AI_STALE_SOURCE'; end if;
  end if;
  return null;
end;
$$;

-- The API authenticates the caller before passing requested_by. Browser roles
-- cannot execute this RPC. Snapshots and input are immutable after insertion.
create function public.ai_enqueue_job(
  p_requested_by uuid, p_idempotency_key uuid, p_task_type public.ai_task_type, p_input jsonb,
  p_course_id uuid default null, p_course_revision integer default null,
  p_lesson_id uuid default null, p_lesson_revision integer default null,
  p_source_id uuid default null, p_source_revision integer default null
)
returns public.ai_jobs language plpgsql security invoker set search_path = '' as $$
declare job public.ai_jobs; context_error text;
begin
  if p_requested_by is null or p_idempotency_key is null or p_task_type is null or
    p_input is null or jsonb_typeof(p_input) <> 'object' then raise exception 'AI_INVALID_INPUT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_requested_by::text || ':' || p_idempotency_key::text, 0));
  select * into job from public.ai_jobs where requested_by = p_requested_by and idempotency_key = p_idempotency_key;
  if found then
    context_error := private.ai_job_context_error(job, false);
    if context_error is not null then raise exception '%', context_error; end if;
    if (job.task_type, job.course_id, job.course_revision, job.lesson_id, job.lesson_revision, job.source_id, job.source_revision)
      is distinct from (p_task_type, p_course_id, p_course_revision, p_lesson_id, p_lesson_revision, p_source_id, p_source_revision)
      or not exists (select 1 from public.ai_job_payloads where job_id = job.id and input = p_input) then
      raise exception 'AI_IDEMPOTENCY_CONFLICT';
    end if;
    return job;
  end if;
  if not private.ai_task_enabled(p_task_type) then raise exception 'AI_FEATURE_DISABLED'; end if;
  job.requested_by := p_requested_by; job.task_type := p_task_type;
  job.course_id := p_course_id; job.course_revision := p_course_revision;
  job.lesson_id := p_lesson_id; job.lesson_revision := p_lesson_revision;
  job.source_id := p_source_id; job.source_revision := p_source_revision;
  context_error := private.ai_job_context_error(job);
  if context_error is not null then raise exception '%', context_error; end if;
  select active_config_id into job.config_version_id from public.ai_runtime_settings where singleton;
  if job.config_version_id is null then raise exception 'AI_CONFIG_REQUIRED'; end if;
  insert into public.ai_jobs(requested_by, idempotency_key, task_type, config_version_id,
    course_id, course_revision, lesson_id, lesson_revision, source_id, source_revision)
  values (p_requested_by, p_idempotency_key, p_task_type, job.config_version_id,
    p_course_id, p_course_revision, p_lesson_id, p_lesson_revision, p_source_id, p_source_revision)
  returning * into job;
  insert into public.ai_job_payloads(job_id, input) values (job.id, p_input);
  return job;
end;
$$;

create function public.ai_claim_job(
  p_worker_id text, p_task_types public.ai_task_type[], p_lease_seconds integer default 90
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare job public.ai_jobs; lease public.ai_job_leases; context_error text; checked integer := 0;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or p_task_types is null or coalesce(cardinality(p_task_types), 0) = 0 or array_position(p_task_types, null) is not null
    or p_lease_seconds is null or p_lease_seconds not between 30 and 600 then raise exception 'AI_INVALID_CLAIM'; end if;
  loop
    -- Lock ONE candidate per iteration; a prefetched batch could starve other workers.
    select * into job from public.ai_jobs j
    where j.task_type = any(p_task_types) and private.ai_task_enabled(j.task_type) and (
      (j.status in ('queued', 'waiting_provider') and j.available_at <= clock_timestamp()) or
      (j.status = 'running' and not exists (select 1 from public.ai_job_leases l
        where l.job_id = j.id and l.expires_at > clock_timestamp())))
    order by j.available_at, j.created_at, j.id limit 1 for update of j skip locked;
    if not found then return null; end if;
    context_error := private.ai_job_context_error(job);
    if not exists (select 1 from public.ai_job_payloads where job_id = job.id) then context_error := 'AI_INPUT_MISSING'; end if;
    if context_error is not null then
      update public.ai_jobs set status = 'failed', error_code = context_error, completed_at = clock_timestamp() where id = job.id;
      update public.ai_job_leases set expires_at = clock_timestamp() where job_id = job.id;
      checked := checked + 1;
      if checked >= 32 then return null; end if;
      continue;
    end if;
    insert into public.ai_job_leases(job_id, worker_id, expires_at, heartbeat_at)
    values(job.id, p_worker_id, clock_timestamp() + make_interval(secs => p_lease_seconds), clock_timestamp())
    on conflict(job_id) do update set worker_id = excluded.worker_id, lease_token = gen_random_uuid(),
      generation = public.ai_job_leases.generation + 1, expires_at = excluded.expires_at, heartbeat_at = excluded.heartbeat_at
    returning * into lease;
    update public.ai_jobs set status = 'running', error_code = null, completed_at = null where id = job.id returning * into job;
    return jsonb_build_object('job', to_jsonb(job), 'lease', to_jsonb(lease),
      'input', (select input from public.ai_job_payloads where job_id = job.id),
      'config', (select config from public.ai_config_versions where id = job.config_version_id),
      'steps', coalesce((select jsonb_agg(to_jsonb(s) order by s.step_key) from public.ai_job_steps s where s.job_id = job.id), '[]'::jsonb));
  end loop;
end;
$$;

-- Global queue lock order: job -> lease -> steps/payload. Lease expiry uses wall
-- clock, not transaction start, including after waiting for another transaction.
create function private.ai_lock_running_job(p_job_id uuid, p_lease_token uuid, p_generation integer)
returns public.ai_jobs language plpgsql security invoker set search_path = '' as $$
declare job public.ai_jobs; context_error text;
begin
  select * into job from public.ai_jobs where id = p_job_id for update;
  if not found or job.status <> 'running' or not exists (
    select 1 from public.ai_job_leases where job_id = p_job_id and lease_token = p_lease_token
      and generation = p_generation and expires_at > clock_timestamp()
  ) then raise exception 'AI_LEASE_LOST'; end if;
  if not private.ai_task_enabled(job.task_type) then raise exception 'AI_FEATURE_DISABLED'; end if;
  context_error := private.ai_job_context_error(job);
  if context_error is not null then raise exception '%', context_error; end if;
  return job;
end;
$$;

create function public.ai_heartbeat_job(
  p_job_id uuid, p_lease_token uuid, p_generation integer, p_lease_seconds integer default 90
)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare expiry timestamptz;
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 600 then raise exception 'AI_INVALID_LEASE_DURATION'; end if;
  perform private.ai_lock_running_job(p_job_id, p_lease_token, p_generation);
  update public.ai_job_leases set heartbeat_at = clock_timestamp(),
    expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  where job_id = p_job_id returning expires_at into expiry;
  return expiry;
end;
$$;

create function public.ai_checkpoint_step(
  p_job_id uuid, p_lease_token uuid, p_generation integer, p_step_key text, p_status text, p_checkpoint jsonb,
  p_progress integer default null, p_language public.content_language default null,
  p_chunk_index integer default null, p_error_code text default null
)
returns public.ai_job_steps language plpgsql security invoker set search_path = '' as $$
declare step public.ai_job_steps;
begin
  if p_step_key is null or char_length(p_step_key) not between 1 and 160 or p_status is null
    or p_status not in ('pending', 'running', 'completed', 'failed')
    or p_checkpoint is null or jsonb_typeof(p_checkpoint) <> 'object'
    or (p_progress is not null and p_progress not between 0 and 99)
    or (p_chunk_index is not null and p_chunk_index < 0)
    or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{0,79}$')
    or ((p_status = 'failed') <> (p_error_code is not null)) then raise exception 'AI_INVALID_CHECKPOINT'; end if;
  perform private.ai_lock_running_job(p_job_id, p_lease_token, p_generation);
  select * into step from public.ai_job_steps where job_id = p_job_id and step_key = p_step_key for update;
  if found then
    if (step.language, step.chunk_index) is distinct from (p_language, p_chunk_index) then raise exception 'AI_STEP_IDENTITY_IMMUTABLE'; end if;
    if step.status = 'completed' then
      if p_status <> 'completed' or step.checkpoint <> p_checkpoint then raise exception 'AI_COMPLETED_STEP_IMMUTABLE'; end if;
      return step;
    end if;
    if p_status = 'pending' and step.status <> 'pending' then raise exception 'AI_INVALID_STEP_TRANSITION'; end if;
    update public.ai_job_steps set status = p_status, checkpoint = p_checkpoint, error_code = p_error_code,
      attempt_count = attempt_count + case when p_status in ('running','completed') and step.status in ('pending','failed','cancelled') then 1 else 0 end,
      started_at = case when p_status = 'pending' then started_at else coalesce(started_at, clock_timestamp()) end,
      completed_at = case when p_status in ('completed','failed') then clock_timestamp() else null end,
      updated_at = clock_timestamp()
    where id = step.id returning * into step;
  else
    insert into public.ai_job_steps(job_id, step_key, status, checkpoint, language, chunk_index, error_code, attempt_count, started_at, completed_at)
    values (p_job_id, p_step_key, p_status, p_checkpoint, p_language, p_chunk_index, p_error_code,
      case when p_status = 'pending' then 0 else 1 end,
      case when p_status <> 'pending' then clock_timestamp() end,
      case when p_status in ('completed','failed') then clock_timestamp() end)
    returning * into step;
  end if;
  if p_progress is not null then update public.ai_jobs set progress = greatest(progress, p_progress)::smallint where id = p_job_id; end if;
  return step;
end;
$$;

create function public.ai_defer_job(
  p_job_id uuid, p_lease_token uuid, p_generation integer, p_delay_seconds integer, p_error_code text
)
returns public.ai_jobs language plpgsql security invoker set search_path = '' as $$
declare job public.ai_jobs;
begin
  if p_delay_seconds is null or p_delay_seconds not between 1 and 86400 or p_error_code is null
    or p_error_code !~ '^[A-Z][A-Z0-9_]{0,79}$' then raise exception 'AI_INVALID_DEFER'; end if;
  select * into job from public.ai_jobs where id = p_job_id for update;
  if job.status = 'waiting_provider' and job.error_code = p_error_code and exists (
    select 1 from public.ai_job_leases where job_id = p_job_id and lease_token = p_lease_token and generation = p_generation
  ) then return job; end if;
  job := private.ai_lock_running_job(p_job_id, p_lease_token, p_generation);
  update public.ai_jobs set status = 'waiting_provider', error_code = p_error_code,
    available_at = clock_timestamp() + make_interval(secs => p_delay_seconds) where id = p_job_id returning * into job;
  update public.ai_job_leases set expires_at = clock_timestamp() where job_id = p_job_id;
  return job;
end;
$$;

create function public.ai_finish_job(
  p_job_id uuid, p_lease_token uuid, p_generation integer, p_status public.ai_job_status,
  p_output jsonb default null, p_error_code text default null
)
returns public.ai_jobs language plpgsql security invoker set search_path = '' as $$
declare job public.ai_jobs;
begin
  if p_status is null or p_status not in ('completed', 'needs_review', 'failed')
    or (p_status in ('completed','needs_review') and (p_output is null or jsonb_typeof(p_output) <> 'object'))
    or (p_output is not null and jsonb_typeof(p_output) <> 'object')
    or ((p_status = 'failed') <> (p_error_code is not null))
    or (p_error_code is not null and p_error_code !~ '^[A-Z][A-Z0-9_]{0,79}$') then raise exception 'AI_INVALID_RESULT'; end if;
  select * into job from public.ai_jobs where id = p_job_id for update;
  -- Delivery retries may return the SAME receipt after completion, never replace it.
  if job.status = p_status and job.error_code is not distinct from p_error_code and exists (
    select 1 from public.ai_job_leases where job_id = p_job_id and lease_token = p_lease_token and generation = p_generation
  ) and exists (select 1 from public.ai_job_payloads where job_id = p_job_id and output is not distinct from p_output) then
    return job;
  end if;
  job := private.ai_lock_running_job(p_job_id, p_lease_token, p_generation);
  if p_status <> 'failed' and (not exists (select 1 from public.ai_job_steps where job_id = p_job_id and status = 'completed')
    or exists (select 1 from public.ai_job_steps where job_id = p_job_id and status <> 'completed')) then
    raise exception 'AI_STEPS_INCOMPLETE';
  end if;
  if not exists (select 1 from public.ai_job_payloads where job_id = p_job_id) then raise exception 'AI_INPUT_MISSING'; end if;
  update public.ai_job_payloads set output = p_output where job_id = p_job_id;
  update public.ai_jobs set status = p_status, error_code = p_error_code,
    progress = case when p_status = 'failed' then progress else 100 end,
    completed_at = case when p_status = 'needs_review' then null else clock_timestamp() end
  where id = p_job_id returning * into job;
  update public.ai_job_leases set expires_at = clock_timestamp() where job_id = p_job_id;
  return job;
end;
$$;

-- Cancellation remains possible after loss of course access: it reveals only
-- the requester's job metadata and stops further external processing.
create function private.cancel_ai_job(p_job_id uuid)
returns public.ai_jobs language plpgsql security definer set search_path = '' as $$
declare job public.ai_jobs; actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not exists (select 1 from public.profiles where id = actor_id) then raise exception 'AI_ACCESS_DENIED'; end if;
  select * into job from public.ai_jobs where id = p_job_id for update;
  if not found or (job.requested_by <> actor_id and not public.is_admin()) then raise exception 'AI_ACCESS_DENIED'; end if;
  if job.status in ('completed','failed','cancelled') then return job; end if;
  update public.ai_jobs set status = 'cancelled', error_code = null, completed_at = clock_timestamp()
  where id = p_job_id returning * into job;
  update public.ai_job_leases set expires_at = clock_timestamp(), lease_token = gen_random_uuid(), generation = generation + 1 where job_id = p_job_id;
  update public.ai_job_steps set status = 'cancelled', completed_at = clock_timestamp(), updated_at = clock_timestamp()
  where job_id = p_job_id and status in ('pending','running');
  return job;
end;
$$;
create function public.cancel_ai_job(p_job_id uuid)
returns public.ai_jobs language sql security invoker set search_path = '' as $$
  select private.cancel_ai_job(p_job_id);
$$;

-- Explicit allow-list: no accidental PUBLIC execute on any new function.
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in ('ai_enqueue_job','ai_claim_job','ai_heartbeat_job','ai_checkpoint_step','ai_defer_job','ai_finish_job'))
      or (n.nspname = 'private' and p.proname in ('ai_task_enabled','ai_job_context_error','ai_lock_running_job'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
revoke all on function private.cancel_ai_job(uuid), public.cancel_ai_job(uuid) from public, anon;
grant execute on function private.cancel_ai_job(uuid), public.cancel_ai_job(uuid) to authenticated;
comment on function public.ai_claim_job(text, public.ai_task_type[], integer) is 'Service-only pull queue; NULL means no eligible job. Lease is 30..600 seconds. Never hold this transaction during external calls.';

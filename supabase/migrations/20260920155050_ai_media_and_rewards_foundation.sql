-- Data foundation only. User-facing mutations will be exposed through checked
-- RPCs in the corresponding feature migrations, not direct client table writes.
create extension if not exists vector with schema extensions;

create type public.content_language as enum ('ru', 'kk', 'en');
create type public.ai_job_status as enum ('queued', 'running', 'waiting_provider', 'needs_review', 'completed', 'failed', 'cancelled');
create type public.ai_task_type as enum ('course_structure', 'lesson_summary', 'quiz', 'video_bundle', 'translation', 'chat', 'embedding');

-- Resolved configuration is a versioned, server-validated, secret-free snapshot.
-- Values of credentials never belong here: only *_API_KEY_N / HF_TOKEN_N aliases.
create table public.ai_config_versions (
  id uuid primary key default gen_random_uuid(),
  version_number bigint generated always as identity unique,
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  description text not null default '' check (char_length(description) <= 1000)
);
create table public.ai_runtime_settings (
  singleton boolean primary key default true check (singleton),
  active_config_id uuid references public.ai_config_versions(id) on delete restrict,
  author_tools_enabled boolean not null default false,
  video_enabled boolean not null default false,
  chat_enabled boolean not null default false,
  gamification_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.ai_runtime_settings default values;

create table public.ai_model_catalog (
  id uuid primary key default gen_random_uuid(),
  connection_slug text not null check (connection_slug ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  provider text not null check (provider in ('gemini', 'openai', 'xai', 'huggingface', 'litellm')),
  model_id text not null check (char_length(model_id) between 1 and 200),
  capabilities text[] not null default '{}',
  context_tokens integer check (context_tokens > 0),
  availability text not null default 'unverified' check (availability in ('unverified', 'available', 'unavailable')),
  checked_at timestamptz,
  discovered_at timestamptz not null default now(),
  unique (connection_slug, model_id),
  check (capabilities <@ array['text', 'structured_output', 'video', 'youtube', 'transcription', 'translation', 'chat', 'embedding'])
);

create table public.media_sources (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  lesson_id uuid not null references public.lessons(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  source_kind text not null check (source_kind in ('upload', 'youtube')),
  youtube_id text check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  original_name text check (char_length(original_name) <= 255),
  mime_type text check (mime_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  byte_size bigint check (byte_size > 0 and byte_size <= 2147483648),
  duration_seconds numeric check (duration_seconds > 0 and duration_seconds <= 7200),
  content_sha256 text check (content_sha256 ~ '^[a-f0-9]{64}$'),
  content_revision integer not null default 1 check (content_revision > 0),
  status text not null default 'pending' check (status in ('pending', 'uploading', 'validating', 'ready', 'failed', 'deleted')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, lesson_id),
  check ((source_kind = 'youtube' and youtube_id is not null) or (source_kind = 'upload' and youtube_id is null)),
  check (status <> 'ready' or (duration_seconds is not null and
    (source_kind = 'youtube' or (byte_size is not null and content_sha256 is not null and mime_type is not null))))
);
-- The S3 multipart ID and object location are service-only, never student data.
create table public.media_uploads (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.media_sources(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket_name text not null,
  object_key text not null unique,
  multipart_upload_id text,
  expected_bytes bigint not null check (expected_bytes between 1 and 2147483648),
  part_size_bytes integer not null default 16777216 check (part_size_bytes >= 5242880),
  status text not null default 'pending' check (status in ('pending', 'uploading', 'completing', 'completed', 'aborted', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  completed_at timestamptz,
  check (expires_at > created_at),
  check ((status = 'completed') = (completed_at is not null))
);
create unique index media_uploads_one_live_per_source on public.media_uploads(source_id)
  where status in ('pending', 'uploading', 'completing', 'completed');

create table public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete restrict,
  lesson_id uuid references public.lessons(id) on delete restrict,
  source_id uuid,
  task_type public.ai_task_type not null,
  status public.ai_job_status not null default 'queued',
  idempotency_key uuid not null,
  config_version_id uuid not null references public.ai_config_versions(id) on delete restrict,
  course_revision integer check (course_revision > 0),
  lesson_revision integer check (lesson_revision > 0),
  source_revision integer check (source_revision > 0),
  progress smallint not null default 0 check (progress between 0 and 100),
  error_code text,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (requested_by, idempotency_key),
  foreign key (source_id, lesson_id) references public.media_sources(id, lesson_id) on delete restrict,
  check ((lesson_id is null and lesson_revision is null) or (lesson_id is not null and course_id is not null and lesson_revision is not null)),
  check ((source_id is null and source_revision is null) or (source_id is not null and lesson_id is not null and source_revision is not null)),
  check ((course_id is null and course_revision is null) or (course_id is not null and course_revision is not null)),
  check ((status in ('completed', 'failed', 'cancelled')) = (completed_at is not null))
);
-- Prompts/results may contain author answer keys; keep them separate from job
-- status. Raw provider responses and credentials must never be persisted here.
create table public.ai_job_payloads (
  job_id uuid primary key references public.ai_jobs(id) on delete cascade,
  input jsonb not null default '{}' check (jsonb_typeof(input) = 'object'),
  output jsonb check (jsonb_typeof(output) = 'object')
);
create table public.ai_job_leases (
  job_id uuid primary key references public.ai_jobs(id) on delete cascade,
  lease_token uuid not null default gen_random_uuid(),
  worker_id text not null,
  generation integer not null default 1 check (generation > 0),
  expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now()
);
create table public.ai_job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  step_key text not null check (char_length(step_key) between 1 and 160),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  language public.content_language,
  chunk_index integer check (chunk_index >= 0),
  checkpoint jsonb not null default '{}' check (jsonb_typeof(checkpoint) = 'object'),
  error_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (job_id, step_key),
  unique (id, job_id)
);
create table public.ai_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  step_id uuid,
  attempt_number integer not null check (attempt_number > 0),
  connection_slug text not null,
  provider text not null check (provider in ('gemini', 'openai', 'xai', 'huggingface', 'litellm')),
  key_alias text not null check (key_alias ~ '^(GEMINI_API_KEY|OPENAI_API_KEY|XAI_API_KEY|HF_TOKEN|LITELLM_API_KEY)_[1-9][0-9]*$'),
  quota_group text,
  model_id text not null,
  outcome text not null check (outcome in ('started', 'succeeded', 'rate_limited', 'invalid_key', 'unavailable_model', 'transient_error', 'invalid_input', 'refused', 'cancelled')),
  http_status smallint check (http_status between 100 and 599),
  retry_after timestamptz,
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  audio_seconds numeric check (audio_seconds >= 0),
  cost_usd numeric(14,8) check (cost_usd >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (job_id, attempt_number),
  foreign key (step_id, job_id) references public.ai_job_steps(id, job_id) on delete cascade
);
comment on column public.ai_attempts.cost_usd is 'NULL means unknown cost, not zero. Informational only; no application budget quotas.';

create table public.lesson_ai_bundles (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  lesson_id uuid not null references public.lessons(id) on delete restrict,
  source_id uuid,
  job_id uuid references public.ai_jobs(id) on delete set null,
  version_number integer not null check (version_number > 0),
  content_revision integer not null default 1 check (content_revision > 0),
  lesson_revision integer not null check (lesson_revision > 0),
  source_revision integer check (source_revision > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  stale_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, version_number),
  unique (id, lesson_id),
  foreign key (source_id, lesson_id) references public.media_sources(id, lesson_id) on delete restrict,
  check ((source_id is null and source_revision is null) or (source_id is not null and source_revision is not null)),
  check (status <> 'published' or (reviewed_at is not null and published_at is not null))
);
create unique index lesson_ai_bundles_one_published on public.lesson_ai_bundles(lesson_id) where status = 'published';
create table public.lesson_localizations (
  bundle_id uuid not null references public.lesson_ai_bundles(id) on delete cascade,
  language public.content_language not null,
  title text not null check (char_length(title) between 1 and 300),
  lecture jsonb not null check (jsonb_typeof(lecture) = 'object'),
  summary text not null default '',
  glossary jsonb not null default '[]' check (jsonb_typeof(glossary) = 'array'),
  manually_edited boolean not null default false,
  content_revision integer not null default 1 check (content_revision > 0),
  updated_at timestamptz not null default now(),
  primary key (bundle_id, language)
);
create table public.subtitle_tracks (
  bundle_id uuid not null references public.lesson_ai_bundles(id) on delete cascade,
  language public.content_language not null,
  cues jsonb not null default '[]' check (jsonb_typeof(cues) = 'array'),
  vtt_text text not null default '',
  srt_text text not null default '',
  manually_edited boolean not null default false,
  content_revision integer not null default 1 check (content_revision > 0),
  updated_at timestamptz not null default now(),
  primary key (bundle_id, language)
);

create table public.course_index_versions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  provider text not null,
  model_id text not null,
  dimensions integer not null default 768 check (dimensions between 1 and 16000),
  status text not null default 'building' check (status in ('building', 'active', 'retired', 'failed')),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (id, course_id)
);
create unique index course_index_one_active on public.course_index_versions(course_id) where status = 'active';
create table public.course_chunks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  index_version_id uuid not null,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  bundle_id uuid,
  lesson_revision integer not null check (lesson_revision > 0),
  language public.content_language not null,
  source_kind text not null check (source_kind in ('lesson_text', 'lecture', 'subtitle')),
  chunk_key text not null,
  content text not null check (char_length(content) > 0),
  section_title text,
  start_seconds numeric check (start_seconds >= 0),
  end_seconds numeric,
  embedding extensions.vector not null,
  created_at timestamptz not null default now(),
  foreign key (index_version_id, course_id) references public.course_index_versions(id, course_id) on delete cascade,
  foreign key (bundle_id, lesson_id) references public.lesson_ai_bundles(id, lesson_id) on delete cascade,
  unique (index_version_id, lesson_id, language, chunk_key),
  check ((source_kind = 'lesson_text' and bundle_id is null) or (source_kind in ('lecture', 'subtitle') and bundle_id is not null)),
  check ((start_seconds is null and end_seconds is null) or (start_seconds is not null and end_seconds > start_seconds))
);
-- Vectors of different profiles are never searched together. HNSW indexes will
-- be introduced with the retrieval function and its exact profile predicates.

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  language public.content_language not null default 'ru',
  title text not null default '' check (char_length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]' check (jsonb_typeof(citations) = 'array'),
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed', 'cancelled')),
  job_id uuid references public.ai_jobs(id) on delete set null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (thread_id, idempotency_key, role)
);

-- Reward tables have no authenticated write grants. Later reward triggers will
-- run in the same transaction as verified learning updates, never analytics.
create table public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete restrict,
  event_type text not null check (event_type in ('lesson_completed', 'quiz_passed', 'assignment_accepted', 'certificate_issued', 'adjustment')),
  entity_id uuid not null,
  xp integer not null,
  historical boolean not null default false,
  earned_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  adjustment_of uuid references public.xp_ledger(id) on delete set null,
  adjusted_by uuid references public.profiles(id) on delete set null,
  reason text,
  check ((event_type = 'lesson_completed' and xp = 10) or (event_type = 'quiz_passed' and xp = 25)
    or (event_type = 'assignment_accepted' and xp = 40) or (event_type = 'certificate_issued' and xp = 100)
    or (event_type = 'adjustment' and xp <> 0 and reason is not null and char_length(trim(reason)) > 0)),
  check (event_type = 'adjustment' or (course_id is not null and adjustment_of is null and adjusted_by is null))
);
create unique index xp_ledger_one_reward on public.xp_ledger(user_id, event_type, entity_id) where event_type <> 'adjustment';
create table public.gamification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  public_alias text check (char_length(public_alias) between 2 and 40 and public_alias !~ '[@[:cntrl:]]'),
  weekly_goal_days smallint not null default 3 check (weekly_goal_days between 1 and 7),
  next_weekly_goal_days smallint check (next_weekly_goal_days between 1 and 7),
  next_goal_effective_week date,
  updated_at timestamptz not null default now(),
  check ((next_weekly_goal_days is null) = (next_goal_effective_week is null)),
  check (next_goal_effective_week is null or extract(isodow from next_goal_effective_week) = 1)
);
create table public.course_ranking_memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (user_id, course_id),
  check (left_at is null or left_at >= joined_at)
);
create table public.weekly_learning_goals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  target_days smallint not null check (target_days between 1 and 7),
  active_days date[] not null default '{}',
  completed_at timestamptz,
  primary key (user_id, week_start)
);
create table public.user_achievements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_code text not null check (achievement_code in ('first_lesson', 'first_quiz', 'ten_lessons', 'first_certificate', 'three_weekly_goals')),
  earned_at timestamptz not null default now(),
  source_ledger_id uuid references public.xp_ledger(id) on delete set null,
  primary key (user_id, achievement_code)
);
create table public.course_weekly_scores (
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  score integer not null default 0 check (score >= 0),
  final_rank integer check (final_rank > 0),
  finalized_at timestamptz,
  primary key (course_id, week_start, user_id),
  check ((final_rank is null) = (finalized_at is null))
);

-- Every foreign key has a leading-column index, including composite FKs.
create index ai_config_versions_created_by_idx on public.ai_config_versions(created_by);
create index ai_runtime_settings_config_idx on public.ai_runtime_settings(active_config_id);
create index media_sources_course_idx on public.media_sources(course_id);
create index media_sources_lesson_idx on public.media_sources(lesson_id);
create index media_sources_created_by_idx on public.media_sources(created_by);
create index media_uploads_source_idx on public.media_uploads(source_id);
create index media_uploads_user_idx on public.media_uploads(user_id);
create index media_uploads_expiry_idx on public.media_uploads(expires_at) where status in ('pending', 'uploading', 'completing');
create index ai_jobs_course_idx on public.ai_jobs(course_id);
create index ai_jobs_lesson_idx on public.ai_jobs(lesson_id);
create index ai_jobs_source_idx on public.ai_jobs(source_id, lesson_id);
create index ai_jobs_config_idx on public.ai_jobs(config_version_id);
create index ai_jobs_queue_idx on public.ai_jobs(available_at, created_at) where status in ('queued', 'waiting_provider');
create index ai_job_leases_expiry_idx on public.ai_job_leases(expires_at);
create index ai_attempts_step_idx on public.ai_attempts(step_id, job_id);
create index lesson_ai_bundles_course_idx on public.lesson_ai_bundles(course_id);
create index lesson_ai_bundles_source_idx on public.lesson_ai_bundles(source_id, lesson_id);
create index lesson_ai_bundles_job_idx on public.lesson_ai_bundles(job_id);
create index lesson_ai_bundles_reviewer_idx on public.lesson_ai_bundles(reviewed_by);
create index course_index_versions_course_idx on public.course_index_versions(course_id);
create index course_chunks_course_idx on public.course_chunks(course_id);
create index course_chunks_index_idx on public.course_chunks(index_version_id, course_id);
create index course_chunks_lesson_idx on public.course_chunks(lesson_id);
create index course_chunks_bundle_idx on public.course_chunks(bundle_id, lesson_id);
create index chat_threads_user_idx on public.chat_threads(user_id, updated_at desc);
create index chat_threads_course_idx on public.chat_threads(course_id);
create index chat_threads_lesson_idx on public.chat_threads(lesson_id);
create index chat_messages_job_idx on public.chat_messages(job_id);
create index chat_messages_thread_created_idx on public.chat_messages(thread_id, created_at);
create index xp_ledger_course_idx on public.xp_ledger(course_id);
create index xp_ledger_adjustment_idx on public.xp_ledger(adjustment_of);
create index xp_ledger_adjusted_by_idx on public.xp_ledger(adjusted_by);
create index xp_ledger_user_time_idx on public.xp_ledger(user_id, earned_at);
create index course_ranking_memberships_course_idx on public.course_ranking_memberships(course_id);
create index user_achievements_source_idx on public.user_achievements(source_ledger_id);
create index course_weekly_scores_user_idx on public.course_weekly_scores(user_id);

-- Reject cross-course references even in trusted service writes. Deleting a
-- lesson with AI history is RESTRICTed; normal course edits retain all records.
create function private.check_ai_lesson_course()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.lesson_id is not null and not exists (select 1 from public.lessons l join public.modules m on m.id = l.module_id
    where l.id = new.lesson_id and m.course_id = new.course_id) then
    raise exception 'AI_LESSON_COURSE_MISMATCH';
  end if;
  return new;
end;
$$;
create function private.invalidate_lesson_ai()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'lessons' then
    if new.content_revision is distinct from old.content_revision then
      update public.lesson_ai_bundles set stale_at = coalesce(stale_at, now()) where lesson_id = new.id;
    end if;
  else
    if new.content_revision is distinct from old.content_revision or (old.status = 'ready' and new.status <> 'ready') then
      update public.lesson_ai_bundles set stale_at = coalesce(stale_at, now()) where source_id = new.id;
    end if;
  end if;
  return new;
end;
$$;
create trigger lessons_invalidate_ai after update of content_revision on public.lessons for each row execute function private.invalidate_lesson_ai();
create trigger media_sources_invalidate_ai after update on public.media_sources for each row execute function private.invalidate_lesson_ai();

create function private.bump_media_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.course_id, new.lesson_id) is distinct from (old.course_id, old.lesson_id) then
    raise exception 'MEDIA_SOURCE_SCOPE_IMMUTABLE';
  end if;
  new.content_revision := old.content_revision + case when
    (new.source_kind, new.youtube_id, new.content_sha256, new.byte_size, new.duration_seconds, new.mime_type)
    is distinct from (old.source_kind, old.youtube_id, old.content_sha256, old.byte_size, old.duration_seconds, old.mime_type)
    then 1 else 0 end;
  new.updated_at := now();
  return new;
end;
$$;
create trigger media_sources_revision before update on public.media_sources for each row execute function private.bump_media_revision();

-- Defense in depth for the resolved config snapshot. The API must additionally
-- validate its typed configuration schema; unknown strings cannot be proven to
-- be non-secrets by a database heuristic alone.
create function private.ai_config_is_secret_free(p_value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; alias_value jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    for k, v in select * from jsonb_each(p_value) loop
      if k = 'key_aliases' then
        if jsonb_typeof(v) <> 'array' then return false; end if;
        for alias_value in select value from jsonb_array_elements(v) loop
          if jsonb_typeof(alias_value) <> 'string' or (alias_value #>> '{}') !~ '^(GEMINI_API_KEY|OPENAI_API_KEY|XAI_API_KEY|HF_TOKEN|LITELLM_API_KEY)_[1-9][0-9]*$' then return false; end if;
        end loop;
      elsif lower(k) ~ '(secret|password|credential|authorization|api.?key|access.?token|refresh.?token|^token$|^headers$)' then
        return false;
      elsif not private.ai_config_is_secret_free(v) then return false;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v in select value from jsonb_array_elements(p_value) loop
      if not private.ai_config_is_secret_free(v) then return false; end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~* '(^Bearer[[:space:]]|^sk-[A-Za-z0-9_-]{10,}|^hf_[A-Za-z0-9]{10,}|https?://[^/]*@)' then
    return false;
  end if;
  return true;
end;
$$;
alter table public.ai_config_versions add constraint ai_config_no_credentials check (private.ai_config_is_secret_free(config));

create function private.guard_ai_bundle()
returns trigger language plpgsql set search_path = '' as $$
declare lesson_version integer; source_version integer;
begin
  if tg_op = 'UPDATE' then
    if (new.lesson_id, new.course_id, new.source_id, new.lesson_revision, new.source_revision, new.version_number)
      is distinct from (old.lesson_id, old.course_id, old.source_id, old.lesson_revision, old.source_revision, old.version_number) then
      raise exception 'AI_BUNDLE_SOURCE_IMMUTABLE';
    end if;
    -- Nullable attribution may be removed by account/job deletion, but cannot
    -- be reassigned to fabricate a different reviewer or generation.
    if old.status <> 'draft' and (
      (new.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by) or
      (new.job_id is not null and new.job_id is distinct from old.job_id) or
      (to_jsonb(new) - array['status', 'stale_at', 'updated_at', 'content_revision', 'reviewed_by', 'job_id'])
      is distinct from (to_jsonb(old) - array['status', 'stale_at', 'updated_at', 'content_revision', 'reviewed_by', 'job_id'])) then
      raise exception 'AI_PUBLISHED_BUNDLE_IMMUTABLE';
    end if;
    if old.status <> 'draft' and new.status = 'draft' then raise exception 'AI_PUBLISHED_BUNDLE_IMMUTABLE'; end if;
    new.content_revision := old.content_revision + 1;
    new.updated_at := now();
  end if;
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    -- The bundle row is already locked. Do not acquire source/lesson locks in
    -- reverse order to the course editor: its invalidation update serializes on
    -- this bundle and makes the source change + staleness visible atomically.
    select content_revision into lesson_version from public.lessons where id = new.lesson_id;
    if new.stale_at is not null or new.lesson_revision is distinct from lesson_version then
      raise exception using errcode = 'PT409', message = 'AI_SOURCE_REVISION_CONFLICT';
    end if;
    if new.source_id is not null then
      select content_revision into source_version from public.media_sources where id = new.source_id and status = 'ready';
      if new.source_revision is distinct from source_version then
        raise exception using errcode = 'PT409', message = 'AI_SOURCE_REVISION_CONFLICT';
      end if;
    end if;
    if new.reviewed_at is null or new.published_at is null or not exists (
      select 1 from public.profiles p join public.courses c on c.id = new.course_id
      where p.id = new.reviewed_by and (p.role = 'admin' or (p.role = 'teacher' and c.author_id = p.id))
    ) then raise exception 'AI_AUTHOR_REVIEW_REQUIRED'; end if;
    if (select count(*) from public.lesson_localizations x where x.bundle_id = new.id
      and x.lecture <> '{}'::jsonb and char_length(trim(x.summary)) > 0) <> 3 then
      raise exception 'AI_THREE_LANGUAGES_REQUIRED';
    end if;
    if new.source_id is not null and (select count(*) from public.subtitle_tracks t where t.bundle_id = new.id
      and jsonb_array_length(t.cues) > 0 and t.vtt_text like 'WEBVTT%' and char_length(trim(t.srt_text)) > 0) <> 3 then
      raise exception 'AI_THREE_SUBTITLE_TRACKS_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;
create trigger lesson_ai_bundles_guard before insert or update on public.lesson_ai_bundles for each row execute function private.guard_ai_bundle();

create function private.guard_ai_bundle_child()
returns trigger language plpgsql set search_path = '' as $$
declare target_bundle uuid; bundle_status text;
begin
  target_bundle := case when tg_op = 'DELETE' then old.bundle_id else new.bundle_id end;
  if tg_op = 'UPDATE' and (new.bundle_id, new.language) is distinct from (old.bundle_id, old.language) then
    raise exception 'AI_TRANSLATION_IDENTITY_IMMUTABLE';
  end if;
  select status into bundle_status from public.lesson_ai_bundles where id = target_bundle for update;
  if bundle_status is not null and bundle_status <> 'draft' then raise exception 'AI_PUBLISHED_BUNDLE_IMMUTABLE'; end if;
  if tg_op = 'UPDATE' then new.content_revision := old.content_revision + 1; new.updated_at := now(); end if;
  -- Changing a child is part of the aggregate editor revision. A stale editor
  -- cannot publish over someone else's language or subtitle changes.
  if tg_op <> 'DELETE' or bundle_status is not null then
    update public.lesson_ai_bundles set updated_at = now() where id = target_bundle;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger localizations_guard before insert or update or delete on public.lesson_localizations for each row execute function private.guard_ai_bundle_child();
create trigger subtitles_guard before insert or update or delete on public.subtitle_tracks for each row execute function private.guard_ai_bundle_child();

create function private.check_course_chunk()
returns trigger language plpgsql set search_path = '' as $$
declare expected_dimensions integer;
begin
  select dimensions into expected_dimensions from public.course_index_versions where id = new.index_version_id;
  if extensions.vector_dims(new.embedding) is distinct from expected_dimensions then raise exception 'AI_EMBEDDING_DIMENSION_MISMATCH'; end if;
  if not exists (select 1 from public.lessons where id = new.lesson_id and content_revision = new.lesson_revision) then
    raise exception 'AI_CHUNK_SOURCE_STALE';
  end if;
  if exists (select 1 from public.quizzes where lesson_id = new.lesson_id)
    or exists (select 1 from public.assignments where lesson_id = new.lesson_id) then
    raise exception 'AI_ASSESSMENT_NOT_INDEXABLE';
  end if;
  if new.bundle_id is not null and not exists (select 1 from public.lesson_ai_bundles b
    where b.id = new.bundle_id and b.status = 'published' and b.stale_at is null and b.lesson_revision = new.lesson_revision) then
    raise exception 'AI_CHUNK_SOURCE_UNPUBLISHED';
  end if;
  if new.source_kind = 'lesson_text' and not exists (select 1 from public.lesson_items i where i.lesson_id = new.lesson_id and i.type = 'rich_text') then
    raise exception 'AI_TEXT_SOURCE_REQUIRED';
  end if;
  return new;
end;
$$;
create trigger course_chunks_guard before insert or update on public.course_chunks for each row execute function private.check_course_chunk();

create function private.check_weekly_goal_days()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.active_days) d where d is null or d < new.week_start or d > new.week_start + 6)
    or cardinality(new.active_days) <> (select count(distinct d) from unnest(new.active_days) d) then
    raise exception 'INVALID_WEEKLY_ACTIVITY_DAYS';
  end if;
  if new.completed_at is not null and cardinality(new.active_days) < new.target_days then raise exception 'WEEKLY_GOAL_NOT_REACHED'; end if;
  return new;
end;
$$;
create trigger weekly_goals_days_guard before insert or update on public.weekly_learning_goals for each row execute function private.check_weekly_goal_days();

create function private.check_ranking_membership()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.left_at is null and not exists (select 1 from public.enrollments e join public.courses c on c.id = e.course_id
    join public.profiles p on p.id = e.user_id where e.user_id = new.user_id and e.course_id = new.course_id
    and c.status = 'published' and c.author_id <> new.user_id and p.role <> 'admin') then
    raise exception 'RANKING_PARTICIPANT_NOT_ELIGIBLE';
  end if;
  return new;
end;
$$;
create trigger ranking_memberships_guard before insert or update on public.course_ranking_memberships for each row execute function private.check_ranking_membership();

create function private.check_xp_adjustment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.event_type = 'adjustment' then
    if not exists (select 1 from public.profiles where id = new.adjusted_by and role = 'admin') then raise exception 'XP_ADJUSTMENT_REQUIRES_ADMIN'; end if;
    if new.adjustment_of is not null and not exists (select 1 from public.xp_ledger x where x.id = new.adjustment_of
      and x.user_id = new.user_id and x.course_id is not distinct from new.course_id) then raise exception 'XP_ADJUSTMENT_SCOPE_MISMATCH'; end if;
  end if;
  return new;
end;
$$;
create trigger xp_ledger_adjustment_guard before insert on public.xp_ledger for each row execute function private.check_xp_adjustment();

create function private.guard_ai_job_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.id, new.requested_by, new.course_id, new.lesson_id, new.source_id, new.task_type, new.idempotency_key,
      new.config_version_id, new.course_revision, new.lesson_revision, new.source_revision)
    is distinct from (old.id, old.requested_by, old.course_id, old.lesson_id, old.source_id, old.task_type, old.idempotency_key,
      old.config_version_id, old.course_revision, old.lesson_revision, old.source_revision) then
    raise exception 'AI_JOB_INPUT_IDENTITY_IMMUTABLE';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger ai_jobs_identity_guard before update on public.ai_jobs for each row execute function private.guard_ai_job_identity();
create function private.guard_ai_job_payload()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.job_id, new.input) is distinct from (old.job_id, old.input) then raise exception 'AI_JOB_INPUT_IMMUTABLE'; end if;
  return new;
end;
$$;
create trigger ai_job_payloads_input_guard before update on public.ai_job_payloads for each row execute function private.guard_ai_job_payload();
create function private.guard_index_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.id, new.course_id, new.provider, new.model_id, new.dimensions)
    is distinct from (old.id, old.course_id, old.provider, old.model_id, old.dimensions) then
    raise exception 'AI_INDEX_PROFILE_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger course_index_profile_guard before update on public.course_index_versions for each row execute function private.guard_index_profile();

revoke all on function private.bump_media_revision(), private.ai_config_is_secret_free(jsonb), private.guard_ai_bundle(),
  private.guard_ai_bundle_child(), private.check_course_chunk(), private.check_weekly_goal_days(),
  private.check_ranking_membership(), private.check_xp_adjustment(), private.guard_ai_job_identity(),
  private.guard_ai_job_payload(), private.guard_index_profile() from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.ai_config_is_secret_free(jsonb) to service_role;

create function private.can_read_published_lesson(p_lesson_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.lessons l join public.modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    where l.id = p_lesson_id and c.status = 'published' and public.can_access_course(c.id)
  );
$$;
create function private.can_read_ai_bundle(p_bundle_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.lesson_ai_bundles b join public.lessons l on l.id = b.lesson_id
    where b.id = p_bundle_id and (public.can_manage_lesson(l.id) or (
      b.status = 'published' and b.stale_at is null and b.lesson_revision = l.content_revision
      and private.can_read_published_lesson(l.id)
      and (b.source_id is null or exists (select 1 from public.media_sources s
        where s.id = b.source_id and s.status = 'ready' and s.content_revision = b.source_revision))
    ))
  );
$$;
create function private.can_use_course_chat(p_course_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists (select 1 from public.courses c where c.id = p_course_id and c.status = 'published' and public.can_access_course(c.id))
    and not exists (select 1 from public.quiz_attempts a join public.quizzes q on q.id = a.quiz_id
      join public.lessons l on l.id = q.lesson_id join public.modules m on m.id = l.module_id
      where a.user_id = (select auth.uid()) and m.course_id = p_course_id and a.status = 'in_progress');
$$;

-- Private lookups contain identity/access checks; trigger functions are not
-- exposed or callable by API roles. No SECURITY DEFINER endpoint is added.
revoke all on function private.check_ai_lesson_course(), private.invalidate_lesson_ai(),
  private.can_read_published_lesson(uuid), private.can_read_ai_bundle(uuid), private.can_use_course_chat(uuid) from public, anon, authenticated;
grant execute on function private.can_read_published_lesson(uuid), private.can_read_ai_bundle(uuid), private.can_use_course_chat(uuid) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['media_sources', 'ai_jobs', 'lesson_ai_bundles', 'course_chunks', 'chat_threads'] loop
    execute format('create trigger %I before insert or update of course_id, lesson_id on public.%I for each row execute function private.check_ai_lesson_course()', table_name || '_check_course', table_name);
  end loop;
  foreach table_name in array array['ai_config_versions', 'ai_runtime_settings', 'ai_model_catalog', 'media_sources', 'media_uploads',
    'ai_jobs', 'ai_job_payloads', 'ai_job_leases', 'ai_job_steps', 'ai_attempts', 'lesson_ai_bundles', 'lesson_localizations', 'subtitle_tracks',
    'course_index_versions', 'course_chunks', 'chat_threads', 'chat_messages', 'xp_ledger', 'gamification_preferences',
    'course_ranking_memberships', 'weekly_learning_goals', 'user_achievements', 'course_weekly_scores'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
    -- Explicit service policies document the trust boundary even though the
    -- hosted service_role also has BYPASSRLS.
    execute format('create policy service_access on public.%I for all to service_role using (true) with check (true)', table_name);
  end loop;
end;
$$;
revoke update, delete on public.ai_config_versions, public.xp_ledger from service_role;
grant usage, select on sequence public.ai_config_versions_version_number_seq to service_role;
revoke all on sequence public.ai_config_versions_version_number_seq from public, anon, authenticated;

grant select on public.ai_config_versions, public.ai_runtime_settings, public.ai_model_catalog,
  public.media_sources, public.ai_jobs, public.ai_job_payloads, public.ai_job_steps, public.ai_attempts,
  public.lesson_ai_bundles, public.lesson_localizations, public.subtitle_tracks, public.course_index_versions,
  public.course_chunks, public.chat_threads, public.chat_messages, public.xp_ledger, public.gamification_preferences,
  public.course_ranking_memberships, public.weekly_learning_goals, public.user_achievements, public.course_weekly_scores to authenticated;

create policy admin_config_read on public.ai_config_versions for select to authenticated using ((select public.is_admin()));
create policy admin_runtime_read on public.ai_runtime_settings for select to authenticated using ((select public.is_admin()));
create policy admin_model_read on public.ai_model_catalog for select to authenticated using ((select public.is_admin()));
create policy author_media_read on public.media_sources for select to authenticated using (public.can_manage_lesson(lesson_id));
create policy owner_job_read on public.ai_jobs for select to authenticated using (
  (select public.is_admin()) or (requested_by = (select auth.uid()) and (course_id is null or public.can_access_course(course_id)))
);
create policy owner_job_payload_read on public.ai_job_payloads for select to authenticated using (
  exists (select 1 from public.ai_jobs j where j.id = job_id and j.task_type <> 'chat'
    and ((select public.is_admin()) or (j.requested_by = (select auth.uid()) and (j.course_id is null or public.is_course_author(j.course_id)))))
);
create policy owner_job_step_read on public.ai_job_steps for select to authenticated using (
  exists (select 1 from public.ai_jobs j where j.id = job_id and j.task_type <> 'chat'
    and ((select public.is_admin()) or (j.requested_by = (select auth.uid()) and (j.course_id is null or public.is_course_author(j.course_id)))))
);
create policy admin_attempt_read on public.ai_attempts for select to authenticated using ((select public.is_admin()));
create policy permitted_bundle_read on public.lesson_ai_bundles for select to authenticated using (private.can_read_ai_bundle(id));
create policy permitted_localization_read on public.lesson_localizations for select to authenticated using (private.can_read_ai_bundle(bundle_id));
create policy permitted_subtitle_read on public.subtitle_tracks for select to authenticated using (private.can_read_ai_bundle(bundle_id));
create policy author_index_read on public.course_index_versions for select to authenticated using (public.is_course_author(course_id));
-- Search internals are only visible to staff. A later authenticated retrieval
-- RPC will return filtered published chunks, never raw vector/index tables.
create policy author_chunk_read on public.course_chunks for select to authenticated using (public.is_course_author(course_id));
create policy private_thread_read on public.chat_threads for select to authenticated using (
  user_id = (select auth.uid()) and private.can_use_course_chat(course_id)
);
create policy private_message_read on public.chat_messages for select to authenticated using (
  exists (select 1 from public.chat_threads t where t.id = thread_id and t.user_id = (select auth.uid()))
);
create policy personal_xp_read on public.xp_ledger for select to authenticated using (user_id = (select auth.uid()));
create policy personal_preferences_read on public.gamification_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy personal_membership_read on public.course_ranking_memberships for select to authenticated using (user_id = (select auth.uid()));
create policy personal_goal_read on public.weekly_learning_goals for select to authenticated using (user_id = (select auth.uid()));
create policy personal_achievement_read on public.user_achievements for select to authenticated using (user_id = (select auth.uid()));
create policy personal_score_read on public.course_weekly_scores for select to authenticated using (user_id = (select auth.uid()));

comment on table public.course_weekly_scores is 'Raw scores are private. Opt-in aliases, eligibility and tied ranks will be exposed through a filtered leaderboard RPC.';
comment on table public.ai_job_leases is 'Service-only queue lease state. Workers must fence checkpoint/result writes with lease_token and generation.';

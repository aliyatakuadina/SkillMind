begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
select no_plan();

create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('13000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.as_user(n integer) returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.fixture_id(n), 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.fixture_id(1), 'queue-author@example.test', '{"role":"teacher"}'),
  (pg_temp.fixture_id(2), 'queue-student@example.test', '{"role":"student"}'),
  (pg_temp.fixture_id(3), 'queue-other-author@example.test', '{"role":"teacher"}'),
  (pg_temp.fixture_id(4), 'queue-admin@example.test', '{"role":"student"}');
update public.profiles set role = 'admin' where id = pg_temp.fixture_id(4);

insert into public.courses (id, slug, title, author_id, status, content_revision) values
  (pg_temp.fixture_id(10), 'queue-published', 'Queue course', pg_temp.fixture_id(1), 'published', 3),
  (pg_temp.fixture_id(11), 'queue-foreign', 'Foreign queue course', pg_temp.fixture_id(3), 'draft', 1);
insert into public.modules (id, course_id, title, order_index) values
  (pg_temp.fixture_id(20), pg_temp.fixture_id(10), 'Module', 0),
  (pg_temp.fixture_id(21), pg_temp.fixture_id(11), 'Foreign module', 0);
insert into public.lessons (id, module_id, title, order_index, content_revision) values
  (pg_temp.fixture_id(30), pg_temp.fixture_id(20), 'Lesson', 0, 2),
  (pg_temp.fixture_id(31), pg_temp.fixture_id(21), 'Foreign lesson', 0, 1);
insert into public.enrollments (user_id, course_id) values
  (pg_temp.fixture_id(1), pg_temp.fixture_id(10)),
  (pg_temp.fixture_id(2), pg_temp.fixture_id(10));
insert into public.media_sources (id, course_id, lesson_id, created_by, source_kind, youtube_id, status, duration_seconds, content_revision) values
  (pg_temp.fixture_id(50), pg_temp.fixture_id(10), pg_temp.fixture_id(30), pg_temp.fixture_id(1), 'youtube', 'dQw4w9WgXcQ', 'ready', 60, 4);

insert into public.ai_config_versions (id, config, file_sha256, created_by) values
  (pg_temp.fixture_id(40), '{"providers":[{"provider":"gemini","key_aliases":["GEMINI_API_KEY_1"]}]}', repeat('d', 64), pg_temp.fixture_id(4));
update public.ai_runtime_settings
set active_config_id = pg_temp.fixture_id(40), author_tools_enabled = false, video_enabled = false, chat_enabled = false
where singleton;

select ok(not has_function_privilege(
  'authenticated',
  'public.ai_enqueue_job(uuid,uuid,public.ai_task_type,jsonb,uuid,integer,uuid,integer,uuid,integer)'::regprocedure,
  'execute'), 'browser roles cannot enqueue jobs');
select ok(not has_function_privilege(
  'authenticated',
  'public.ai_claim_job(text,public.ai_task_type[],integer)'::regprocedure,
  'execute'), 'browser roles cannot claim the pull queue');
select ok(has_function_privilege(
  'authenticated',
  'public.cancel_ai_job(uuid)'::regprocedure,
  'execute'), 'the requester can cancel their own job');
select ok(has_function_privilege(
  'service_role',
  'public.ai_enqueue_job(uuid,uuid,public.ai_task_type,jsonb,uuid,integer,uuid,integer,uuid,integer)'::regprocedure,
  'execute'), 'the API role can enqueue after authenticating the caller');

set local role authenticated;
select pg_temp.as_user(2);
select is((select video_enabled from public.ai_runtime_settings where singleton), false, 'students can read that unfinished video tools are off');
select is((select count(*) from public.ai_config_versions), 0::bigint, 'students still cannot read configuration snapshots');
reset role;

set local role service_role;
select throws_ok(
  $$select public.ai_enqueue_job(pg_temp.fixture_id(1), pg_temp.fixture_id(80), 'video_bundle', '{"source":"file"}'::jsonb, pg_temp.fixture_id(10), 3, pg_temp.fixture_id(30), 2, pg_temp.fixture_id(50), 4)$$,
  'P0001', 'AI_FEATURE_DISABLED', 'enqueue respects the runtime video flag');

update public.ai_runtime_settings set video_enabled = true, chat_enabled = true where singleton;

select throws_ok(
  $$select public.ai_enqueue_job(pg_temp.fixture_id(2), pg_temp.fixture_id(81), 'video_bundle', '{"source":"file"}'::jsonb, pg_temp.fixture_id(10), 3, pg_temp.fixture_id(30), 2, pg_temp.fixture_id(50), 4)$$,
  'P0001', 'AI_ACCESS_DENIED', 'a student cannot request an author video job');
select throws_ok(
  $$select public.ai_enqueue_job(pg_temp.fixture_id(3), pg_temp.fixture_id(82), 'video_bundle', '{"source":"file"}'::jsonb, pg_temp.fixture_id(10), 3, pg_temp.fixture_id(30), 2, pg_temp.fixture_id(50), 4)$$,
  'P0001', 'AI_ACCESS_DENIED', 'a foreign author cannot enqueue into another course');
select throws_ok(
  $$select public.ai_enqueue_job(pg_temp.fixture_id(1), pg_temp.fixture_id(83), 'video_bundle', '{"source":"file"}'::jsonb, pg_temp.fixture_id(10), 1, pg_temp.fixture_id(30), 2, pg_temp.fixture_id(50), 4)$$,
  'P0001', 'AI_STALE_COURSE', 'enqueue pins the current course revision');

select is(
  (select id from public.ai_enqueue_job(
    pg_temp.fixture_id(1), pg_temp.fixture_id(80), 'video_bundle', '{"source":"file"}'::jsonb,
    pg_temp.fixture_id(10), 3, pg_temp.fixture_id(30), 2, pg_temp.fixture_id(50), 4)),
  (select id from public.ai_enqueue_job(
    pg_temp.fixture_id(1), pg_temp.fixture_id(80), 'video_bundle', '{"source":"file"}'::jsonb,
    pg_temp.fixture_id(10), 3, pg_temp.fixture_id(30), 2, pg_temp.fixture_id(50), 4)),
  'the same idempotency key returns the original job');
select throws_ok(
  $$select public.ai_enqueue_job(pg_temp.fixture_id(1), pg_temp.fixture_id(80), 'video_bundle', '{"source":"other"}'::jsonb, pg_temp.fixture_id(10), 3, pg_temp.fixture_id(30), 2, pg_temp.fixture_id(50), 4)$$,
  'P0001', 'AI_IDEMPOTENCY_CONFLICT', 'a reused key cannot change the frozen input');
select is((select config_version_id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80)),
  pg_temp.fixture_id(40), 'the job pins the active configuration snapshot');

select lives_ok(
  $$select public.ai_enqueue_job(pg_temp.fixture_id(2), pg_temp.fixture_id(84), 'chat', '{"prompt":"help"}'::jsonb, pg_temp.fixture_id(10), 3, pg_temp.fixture_id(30), 2)$$,
  'an enrolled student can enqueue chat when that flag is on');

select is(
  (select public.ai_claim_job('worker-a', array['quiz']::public.ai_task_type[])),
  null, 'claim returns null when no matching task is queued');

select is((select public.ai_claim_job('worker-a', array['video_bundle']::public.ai_task_type[]) -> 'job' ->> 'status'),
  'running', 'claim leases a queued video job');
select is((select worker_id from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80))),
  'worker-a', 'the lease records the claiming worker');

select throws_ok(
  $$select public.ai_heartbeat_job(
    (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80)),
    '00000000-0000-4000-8000-000000000099',
    1)$$,
  'P0001', 'AI_LEASE_LOST', 'a stale lease token cannot heartbeat');

select lives_ok(
  $$select public.ai_checkpoint_step(
    (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80)),
    (select lease_token from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80))),
    (select generation from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80))),
    'stub:video_bundle', 'completed', '{"mode":"stub"}'::jsonb, 50)$$,
  'the current lease can persist a completed checkpoint');
select throws_ok(
  $$select public.ai_checkpoint_step(
    (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80)),
    (select lease_token from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80))),
    (select generation from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80))),
    'stub:video_bundle', 'completed', '{"mode":"changed"}'::jsonb)$$,
  'P0001', 'AI_COMPLETED_STEP_IMMUTABLE', 'a finished step cannot be replaced');

select lives_ok(
  $$select public.ai_finish_job(
    (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80)),
    (select lease_token from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80))),
    (select generation from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80))),
    'completed', '{"mode":"stub"}'::jsonb)$$,
  'finish accepts a completed stub receipt');
select lives_ok(
  $$select public.ai_finish_job(
    (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80)),
    (select lease_token from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80))),
    (select generation from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80))),
    'completed', '{"mode":"stub"}'::jsonb)$$,
  'redelivering the same finish receipt is idempotent');
select throws_ok(
  $$select public.ai_finish_job(
    (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80)),
    (select lease_token from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80))),
    (select generation from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(80))),
    'completed', '{"mode":"other"}'::jsonb)$$,
  'P0001', 'AI_LEASE_LOST', 'a different result cannot overwrite a finished job');

select public.ai_enqueue_job(
  pg_temp.fixture_id(1), pg_temp.fixture_id(85), 'video_bundle', '{"source":"retry"}'::jsonb,
  pg_temp.fixture_id(10), 3, pg_temp.fixture_id(30), 2, pg_temp.fixture_id(50), 4);
select public.ai_claim_job('worker-b', array['video_bundle']::public.ai_task_type[]);
create temporary table pg_temp.reclaimed_lease as
  select job_id, lease_token, generation
  from public.ai_job_leases
  where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(85));
update public.ai_job_leases
set expires_at = clock_timestamp() - interval '1 second'
where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(85));
select is((select public.ai_claim_job('worker-c', array['video_bundle']::public.ai_task_type[]) -> 'lease' ->> 'generation'),
  '2', 'an expired lease is fenced by incrementing generation');
select throws_ok(
  $$select public.ai_heartbeat_job(
    (select job_id from pg_temp.reclaimed_lease),
    (select lease_token from pg_temp.reclaimed_lease),
    (select generation from pg_temp.reclaimed_lease))$$,
  'P0001', 'AI_LEASE_LOST', 'the previous worker cannot write after a reclaim');

select public.ai_checkpoint_step(
  (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(85)),
  (select lease_token from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(85))),
  (select generation from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(85))),
  'wait', 'running', '{}'::jsonb);
select lives_ok(
  $$select public.ai_defer_job(
    (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(85)),
    (select lease_token from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(85))),
    (select generation from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(85))),
    30, 'PROVIDER_UNAVAILABLE')$$,
  'the current worker can park the job until a provider recovers');
select is((select status from public.ai_jobs where idempotency_key = pg_temp.fixture_id(85)),
  'waiting_provider', 'defer records waiting_provider without dropping checkpoints');

select public.ai_enqueue_job(
  pg_temp.fixture_id(1), pg_temp.fixture_id(86), 'video_bundle', '{"source":"cancel"}'::jsonb,
  pg_temp.fixture_id(10), 3, pg_temp.fixture_id(30), 2, pg_temp.fixture_id(50), 4);
select public.ai_claim_job('worker-d', array['video_bundle']::public.ai_task_type[]);
reset role;

set local role authenticated;
select pg_temp.as_user(2);
select throws_ok(
  $$select public.cancel_ai_job((select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(86)))$$,
  'P0001', 'AI_ACCESS_DENIED', 'another user cannot cancel the author job');
select pg_temp.as_user(1);
select is((select status from public.cancel_ai_job((select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(86)))),
  'cancelled', 'the requester can cancel a running job');
reset role;

set local role service_role;
select throws_ok(
  $$select public.ai_heartbeat_job(
    (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(86)),
    (select lease_token from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(86))),
    (select generation from public.ai_job_leases where job_id = (select id from public.ai_jobs where idempotency_key = pg_temp.fixture_id(86))))$$,
  'P0001', 'AI_LEASE_LOST', 'cancel fences the worker before it can write a result');
reset role;

select * from finish();
rollback;

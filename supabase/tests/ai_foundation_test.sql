begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
select no_plan();

create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
  select ('12000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
create function pg_temp.as_user(n integer) returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.fixture_id(n), 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  (pg_temp.fixture_id(1), 'ai-author@example.test', '{"role":"teacher"}'),
  (pg_temp.fixture_id(2), 'ai-student@example.test', '{"role":"student"}'),
  (pg_temp.fixture_id(3), 'ai-other-student@example.test', '{"role":"student"}'),
  (pg_temp.fixture_id(4), 'ai-admin@example.test', '{"role":"student"}'),
  (pg_temp.fixture_id(5), 'ai-other-author@example.test', '{"role":"teacher"}');
update public.profiles set role = 'admin' where id = pg_temp.fixture_id(4);
insert into public.courses (id, slug, title, author_id, status) values
  (pg_temp.fixture_id(10), 'ai-foundation-published', 'Published AI course', pg_temp.fixture_id(1), 'published'),
  (pg_temp.fixture_id(11), 'ai-foundation-draft', 'Foreign draft AI course', pg_temp.fixture_id(5), 'draft');
insert into public.modules (id, course_id, title, order_index) values
  (pg_temp.fixture_id(20), pg_temp.fixture_id(10), 'Published module', 0),
  (pg_temp.fixture_id(21), pg_temp.fixture_id(11), 'Foreign module', 0);
insert into public.lessons (id, module_id, title, order_index) values
  (pg_temp.fixture_id(30), pg_temp.fixture_id(20), 'Text lesson', 0),
  (pg_temp.fixture_id(31), pg_temp.fixture_id(20), 'Quiz lesson', 1),
  (pg_temp.fixture_id(32), pg_temp.fixture_id(21), 'Foreign lesson', 0);
insert into public.lesson_items (lesson_id, type, order_index, payload) values
  (pg_temp.fixture_id(30), 'rich_text', 0, '{"content":"A verified lecture"}'),
  (pg_temp.fixture_id(31), 'quiz', 0, '{}');
insert into public.quizzes (id, lesson_id, title) values (pg_temp.fixture_id(35), pg_temp.fixture_id(31), 'Assessment');
insert into public.enrollments (user_id, course_id) values
  (pg_temp.fixture_id(1), pg_temp.fixture_id(10)), (pg_temp.fixture_id(2), pg_temp.fixture_id(10)),
  (pg_temp.fixture_id(3), pg_temp.fixture_id(10)), (pg_temp.fixture_id(4), pg_temp.fixture_id(10));

insert into public.ai_config_versions (id, config, file_sha256, created_by) values
  (pg_temp.fixture_id(40), '{"providers":[{"provider":"gemini","key_aliases":["GEMINI_API_KEY_1","GEMINI_API_KEY_2"]}]}', repeat('a',64), pg_temp.fixture_id(4));
insert into public.ai_model_catalog (connection_slug, provider, model_id, capabilities) values ('gemini-main', 'gemini', 'fixture-model', '{text,translation}');
insert into public.media_sources (id, course_id, lesson_id, created_by, source_kind, youtube_id, status, duration_seconds) values
  (pg_temp.fixture_id(50), pg_temp.fixture_id(10), pg_temp.fixture_id(30), pg_temp.fixture_id(1), 'youtube', 'dQw4w9WgXcQ', 'ready', 60),
  (pg_temp.fixture_id(51), pg_temp.fixture_id(10), pg_temp.fixture_id(30), pg_temp.fixture_id(1), 'upload', null, 'uploading', null),
  (pg_temp.fixture_id(52), pg_temp.fixture_id(11), pg_temp.fixture_id(32), pg_temp.fixture_id(5), 'youtube', 'dQw4w9WgXcQ', 'ready', 60);
insert into public.media_uploads (id, source_id, user_id, bucket_name, object_key, multipart_upload_id, expected_bytes) values
  (pg_temp.fixture_id(60), pg_temp.fixture_id(51), pg_temp.fixture_id(1), 'private-media', 'private-object-key', 'private-multipart-id', 2147483648);
insert into public.ai_jobs (id, requested_by, course_id, lesson_id, source_id, task_type, idempotency_key, config_version_id, course_revision, lesson_revision, source_revision) values
  (pg_temp.fixture_id(80), pg_temp.fixture_id(1), pg_temp.fixture_id(10), pg_temp.fixture_id(30), pg_temp.fixture_id(50), 'video_bundle', pg_temp.fixture_id(80), pg_temp.fixture_id(40), 1, 1, 1),
  (pg_temp.fixture_id(81), pg_temp.fixture_id(5), pg_temp.fixture_id(11), pg_temp.fixture_id(32), pg_temp.fixture_id(52), 'video_bundle', pg_temp.fixture_id(81), pg_temp.fixture_id(40), 1, 1, 1),
  (pg_temp.fixture_id(82), pg_temp.fixture_id(2), pg_temp.fixture_id(10), pg_temp.fixture_id(30), null, 'chat', pg_temp.fixture_id(82), pg_temp.fixture_id(40), 1, 1, null);
insert into public.ai_job_payloads (job_id, input, output) values
  (pg_temp.fixture_id(80), '{"prompt":"Author input"}', '{"answer_key":"Author only"}'),
  (pg_temp.fixture_id(82), '{"prompt":"Private student question"}', '{"answer":"Private response"}');
insert into public.ai_job_steps (id, job_id, step_key, checkpoint) values
  (pg_temp.fixture_id(90), pg_temp.fixture_id(80), 'lecture:ru', '{"author_draft":"Private"}'),
  (pg_temp.fixture_id(91), pg_temp.fixture_id(82), 'chat', '{"private_chat":"Private"}');
insert into public.ai_job_leases (job_id, worker_id, expires_at) values (pg_temp.fixture_id(80), 'test-worker', now()+interval '5 minutes');
insert into public.ai_attempts (id, job_id, step_id, attempt_number, connection_slug, provider, key_alias, model_id, outcome) values
  (pg_temp.fixture_id(100), pg_temp.fixture_id(80), pg_temp.fixture_id(90), 1, 'gemini-main', 'gemini', 'GEMINI_API_KEY_1', 'fixture-model', 'started');

insert into public.lesson_ai_bundles (id, course_id, lesson_id, source_id, lesson_revision, source_revision, version_number) values
  (pg_temp.fixture_id(110), pg_temp.fixture_id(10), pg_temp.fixture_id(30), pg_temp.fixture_id(50), 1, 1, 1),
  (pg_temp.fixture_id(111), pg_temp.fixture_id(10), pg_temp.fixture_id(30), pg_temp.fixture_id(50), 1, 1, 2),
  (pg_temp.fixture_id(112), pg_temp.fixture_id(11), pg_temp.fixture_id(32), pg_temp.fixture_id(52), 1, 1, 1);
insert into public.lesson_localizations (bundle_id, language, title, lecture, summary)
  select b.id, language, 'Verified lecture', '{"sections":[{"text":"Lecture"}]}', 'Summary'
  from public.lesson_ai_bundles b cross join unnest(enum_range(null::public.content_language)) language
  where b.id in (pg_temp.fixture_id(110), pg_temp.fixture_id(111), pg_temp.fixture_id(112));

select throws_ok($$update public.lesson_ai_bundles set status='published', published_at=now() where id=pg_temp.fixture_id(110)$$,
  'P0001', 'AI_AUTHOR_REVIEW_REQUIRED', 'publication requires an authorized reviewer');
select throws_ok($$update public.lesson_ai_bundles set status='published', published_at=now(), reviewed_at=now(), reviewed_by=pg_temp.fixture_id(2) where id=pg_temp.fixture_id(110)$$,
  'P0001', 'AI_AUTHOR_REVIEW_REQUIRED', 'a student cannot be recorded as the author reviewer');
select throws_ok($$update public.lesson_ai_bundles set status='published', published_at=now(), reviewed_at=now(), reviewed_by=pg_temp.fixture_id(1) where id=pg_temp.fixture_id(110)$$,
  'P0001', 'AI_THREE_SUBTITLE_TRACKS_REQUIRED', 'video package cannot be published without three subtitle tracks');
insert into public.subtitle_tracks (bundle_id, language, cues, vtt_text, srt_text)
  select pg_temp.fixture_id(110), language, '[{"id":"1","start":0,"end":1,"text":"Hello"}]', E'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello', E'1\n00:00:00,000 --> 00:00:01,000\nHello'
  from unnest(enum_range(null::public.content_language)) language;
select lives_ok($$update public.lesson_ai_bundles set status='published', published_at=now(), reviewed_at=now(), reviewed_by=pg_temp.fixture_id(1) where id=pg_temp.fixture_id(110)$$,
  'reviewed and complete three-language package can be published');
select throws_ok($$update public.lesson_localizations set summary='Silent replacement' where bundle_id=pg_temp.fixture_id(110) and language='ru'$$,
  'P0001', 'AI_PUBLISHED_BUNDLE_IMMUTABLE', 'published translations cannot change in place');
select throws_ok($$delete from public.subtitle_tracks where bundle_id=pg_temp.fixture_id(110) and language='en'$$,
  'P0001', 'AI_PUBLISHED_BUNDLE_IMMUTABLE', 'published subtitle tracks cannot disappear in place');
select throws_ok($$update public.lesson_ai_bundles set status='draft' where id=pg_temp.fixture_id(110)$$,
  'P0001', 'AI_PUBLISHED_BUNDLE_IMMUTABLE', 'published package cannot be reopened to bypass immutability');
select throws_ok($$delete from public.lessons where id=pg_temp.fixture_id(30)$$, '23503', null, 'lesson with AI history cannot be cascaded away');

insert into public.course_index_versions (id, course_id, provider, model_id, status) values (pg_temp.fixture_id(120), pg_temp.fixture_id(10), 'gemini', 'gemini-embedding-001', 'active');
insert into public.course_chunks (id, course_id, index_version_id, lesson_id, lesson_revision, language, source_kind, chunk_key, content, embedding) values
  (pg_temp.fixture_id(121), pg_temp.fixture_id(10), pg_temp.fixture_id(120), pg_temp.fixture_id(30), 1, 'ru', 'lesson_text', 'section-1', 'A verified lecture', array_fill(0.1::real, array[768])::extensions.vector);
select throws_ok($$insert into public.course_chunks (course_id,index_version_id,lesson_id,lesson_revision,language,source_kind,chunk_key,content,embedding)
  values (pg_temp.fixture_id(10),pg_temp.fixture_id(120),pg_temp.fixture_id(30),1,'ru','lesson_text','bad-dim','Text','[1,2,3]'::extensions.vector)$$,
  'P0001', 'AI_EMBEDDING_DIMENSION_MISMATCH', 'vectors of another dimension cannot enter an index');
select throws_ok($$insert into public.course_chunks (course_id,index_version_id,lesson_id,lesson_revision,language,source_kind,chunk_key,content,embedding)
  values (pg_temp.fixture_id(10),pg_temp.fixture_id(120),pg_temp.fixture_id(31),1,'ru','lesson_text','quiz','Secret answer',array_fill(0.1::real,array[768])::extensions.vector)$$,
  'P0001', 'AI_ASSESSMENT_NOT_INDEXABLE', 'assessment lessons cannot enter the search index');

insert into public.chat_threads (id,user_id,course_id,lesson_id) values
  (pg_temp.fixture_id(130),pg_temp.fixture_id(2),pg_temp.fixture_id(10),pg_temp.fixture_id(30)),
  (pg_temp.fixture_id(131),pg_temp.fixture_id(3),pg_temp.fixture_id(10),pg_temp.fixture_id(30));
insert into public.chat_messages (thread_id,role,content,idempotency_key) values
  (pg_temp.fixture_id(130),'user','Private question',pg_temp.fixture_id(130)),
  (pg_temp.fixture_id(131),'user','Another private question',pg_temp.fixture_id(131));
insert into public.xp_ledger (id,user_id,course_id,event_type,entity_id,xp) values
  (pg_temp.fixture_id(140),pg_temp.fixture_id(2),pg_temp.fixture_id(10),'lesson_completed',pg_temp.fixture_id(30),10),
  (pg_temp.fixture_id(141),pg_temp.fixture_id(3),pg_temp.fixture_id(10),'quiz_passed',pg_temp.fixture_id(35),25);
insert into public.gamification_preferences (user_id,public_alias) values (pg_temp.fixture_id(2),'Student Two'), (pg_temp.fixture_id(3),'Student Three');
insert into public.course_ranking_memberships (user_id,course_id) values (pg_temp.fixture_id(2),pg_temp.fixture_id(10));
insert into public.weekly_learning_goals (user_id,week_start,target_days) values (pg_temp.fixture_id(2),'2026-09-14',3);
insert into public.user_achievements (user_id,achievement_code,source_ledger_id) values (pg_temp.fixture_id(2),'first_lesson',pg_temp.fixture_id(140));
insert into public.course_weekly_scores (course_id,user_id,week_start,score) values
  (pg_temp.fixture_id(10),pg_temp.fixture_id(2),'2026-09-14',25), (pg_temp.fixture_id(10),pg_temp.fixture_id(3),'2026-09-14',40);

select throws_ok($$insert into public.xp_ledger (user_id,course_id,event_type,entity_id,xp) values (pg_temp.fixture_id(2),pg_temp.fixture_id(10),'lesson_completed',pg_temp.fixture_id(30),10)$$,
  '23505', null, 'the same learning entity cannot be awarded twice');
select throws_ok($$insert into public.course_ranking_memberships (user_id,course_id) values (pg_temp.fixture_id(1),pg_temp.fixture_id(10))$$,
  'P0001', 'RANKING_PARTICIPANT_NOT_ELIGIBLE', 'course author cannot enter their ranking');
select throws_ok($$insert into public.course_ranking_memberships (user_id,course_id) values (pg_temp.fixture_id(4),pg_temp.fixture_id(10))$$,
  'P0001', 'RANKING_PARTICIPANT_NOT_ELIGIBLE', 'administrator cannot enter a course ranking');
select throws_ok($$update public.weekly_learning_goals set active_days=array['2026-09-14'::date,'2026-09-14'::date] where user_id=pg_temp.fixture_id(2)$$,
  'P0001', 'INVALID_WEEKLY_ACTIVITY_DAYS', 'a repeated day cannot advance a weekly goal');
select throws_ok($$update public.weekly_learning_goals set active_days=array['2026-09-21'::date] where user_id=pg_temp.fixture_id(2)$$,
  'P0001', 'INVALID_WEEKLY_ACTIVITY_DAYS', 'activity outside the week is rejected');
select throws_ok($$update public.weekly_learning_goals set completed_at=now() where user_id=pg_temp.fixture_id(2)$$,
  'P0001', 'WEEKLY_GOAL_NOT_REACHED', 'empty goal cannot be marked complete');
select throws_ok($$insert into public.xp_ledger(user_id,event_type,entity_id,xp,reason,adjusted_by) values(pg_temp.fixture_id(2),'adjustment',gen_random_uuid(),20,'Correction',pg_temp.fixture_id(2))$$,
  'P0001', 'XP_ADJUSTMENT_REQUIRES_ADMIN', 'reward correction must identify an administrator');
select lives_ok($$insert into public.xp_ledger(user_id,course_id,event_type,entity_id,xp,reason,adjusted_by,adjustment_of) values(pg_temp.fixture_id(2),pg_temp.fixture_id(10),'adjustment',gen_random_uuid(),-10,'Verified correction',pg_temp.fixture_id(4),pg_temp.fixture_id(140))$$,
  'administrator correction is a separate negative ledger entry');
select throws_ok($$insert into public.ai_config_versions(config,file_sha256) values('{"providers":[{"api_key":"secret-value"}]}',repeat('b',64))$$,
  '23514', null, 'raw credential fields cannot enter a configuration snapshot');
select throws_ok($$insert into public.ai_config_versions(config,file_sha256) values('{"key_aliases":["actual-key-value"]}',repeat('b',64))$$,
  '23514', null, 'credential alias must be an approved env variable name');
select throws_ok($$insert into public.ai_config_versions(config,file_sha256) values('{"base_url":"https://user:password@example.test"}',repeat('b',64))$$,
  '23514', null, 'credentials embedded in URLs are rejected');
select is((select cost_usd from public.ai_attempts where id=pg_temp.fixture_id(100)), null::numeric, 'unknown provider cost stays null');
select throws_ok($$update public.ai_jobs set config_version_id=gen_random_uuid() where id=pg_temp.fixture_id(80)$$,
  'P0001','AI_JOB_INPUT_IDENTITY_IMMUTABLE','task configuration remains pinned across retries');
select throws_ok($$update public.ai_job_payloads set input='{"prompt":"Replacement"}' where job_id=pg_temp.fixture_id(80)$$,
  'P0001','AI_JOB_INPUT_IMMUTABLE','task input cannot be silently replaced');
select throws_ok($$update public.course_index_versions set model_id='different-model' where id=pg_temp.fixture_id(120)$$,
  'P0001','AI_INDEX_PROFILE_IMMUTABLE','model changes require a separate index');
select throws_ok($$insert into public.media_sources(course_id,lesson_id,source_kind) values(pg_temp.fixture_id(10),pg_temp.fixture_id(32),'upload')$$,
  'P0001', 'AI_LESSON_COURSE_MISMATCH', 'cross-course media association is rejected');
select throws_ok($$update public.media_sources set byte_size=2147483649 where id=pg_temp.fixture_id(51)$$,
  '23514', null, 'video size above 2 GiB is rejected');
select throws_ok($$update public.media_sources set duration_seconds=7201 where id=pg_temp.fixture_id(50)$$,
  '23514', null, 'video duration above two hours is rejected');
select throws_ok($$insert into public.ai_jobs(requested_by,task_type,idempotency_key,config_version_id) values(pg_temp.fixture_id(1),'course_structure',pg_temp.fixture_id(80),pg_temp.fixture_id(40))$$,
  '23505', null, 'idempotency key is unique per requester across task types');

-- The access matrix is tested under real database roles, not client filters.
set local role authenticated;
select pg_temp.as_user(2);
select is((select count(*) from public.media_sources),0::bigint,'student cannot read source metadata');
select is((select count(*) from public.ai_config_versions),0::bigint,'student cannot read provider configuration');
select is((select count(*) from public.ai_model_catalog),0::bigint,'student cannot read administrative model catalog');
select is((select count(*) from public.ai_jobs),1::bigint,'student sees only their own accessible job status');
select is((select count(*) from public.ai_job_payloads),0::bigint,'student cannot read raw AI input/output or answer keys');
select is((select count(*) from public.ai_job_steps),0::bigint,'student cannot read worker checkpoints');
select is((select count(*) from public.ai_attempts),0::bigint,'student cannot inspect provider attempts');
select is((select count(*) from public.lesson_ai_bundles),1::bigint,'student sees only the published package');
select is((select count(*) from public.lesson_localizations),3::bigint,'student sees three published languages, no drafts');
select is((select count(*) from public.subtitle_tracks),3::bigint,'student sees published subtitle tracks');
select is((select count(*) from public.course_chunks),0::bigint,'student cannot bypass filtered retrieval with raw index reads');
select is((select count(*) from public.chat_threads),1::bigint,'student sees only their own chat');
select is((select count(*) from public.chat_messages),1::bigint,'student sees only their own messages');
select is((select count(*) from public.xp_ledger),2::bigint,'student sees only their personal reward and correction');
select is((select count(*) from public.gamification_preferences),1::bigint,'public aliases do not expose the entire user directory');
select is((select count(*) from public.course_weekly_scores),1::bigint,'raw ranking scores remain personal');
select throws_ok($$insert into public.xp_ledger(user_id,event_type,entity_id,xp) values(pg_temp.fixture_id(2),'certificate_issued',gen_random_uuid(),100)$$,
  '42501', 'permission denied for table xp_ledger', 'student cannot forge XP');
select throws_ok($$update public.lesson_ai_bundles set status='published' where id=pg_temp.fixture_id(111)$$,
  '42501', 'permission denied for table lesson_ai_bundles', 'client cannot publish a draft through table updates');
select throws_ok($$select * from public.media_uploads$$,'42501','permission denied for table media_uploads','S3 multipart IDs are service-only');
select throws_ok($$select * from public.ai_job_leases$$,'42501','permission denied for table ai_job_leases','worker fencing tokens are service-only');

select pg_temp.as_user(1);
select is((select count(*) from public.media_sources),2::bigint,'teacher reads only sources in their course');
select is((select count(*) from public.lesson_ai_bundles),2::bigint,'teacher sees own published and draft versions');
select is((select count(*) from public.ai_job_payloads),1::bigint,'teacher can review their own AI draft');
select is((select count(*) from public.chat_messages),0::bigint,'course teacher cannot inspect student conversations');
select is((select count(*) from public.xp_ledger),0::bigint,'course teacher cannot inspect personal reward histories');
select pg_temp.as_user(4);
select is((select count(*) from public.ai_config_versions),1::bigint,'administrator reads secret-free configuration');
select is((select count(*) from public.ai_attempts),1::bigint,'administrator can review model usage');
select is((select count(*) from public.ai_job_payloads),1::bigint,'administrator still cannot read chat job payloads');
select is((select count(*) from public.ai_job_steps),1::bigint,'administrator still cannot read chat checkpoints');
select is((select count(*) from public.chat_messages),0::bigint,'administrator does not get private chat access');

reset role;
insert into public.quiz_attempts (id,quiz_id,user_id,attempt_number) values(pg_temp.fixture_id(150),pg_temp.fixture_id(35),pg_temp.fixture_id(2),1);
set local role authenticated;
select pg_temp.as_user(2);
select is((select count(*) from public.chat_threads),0::bigint,'active graded attempt blocks chat history for that course');
select is((select count(*) from public.chat_messages),0::bigint,'active attempt also blocks direct message reads');
reset role;
update public.quiz_attempts set status='graded',score=100,submitted_at=now() where id=pg_temp.fixture_id(150);
set local role authenticated;
select is((select count(*) from public.chat_messages),1::bigint,'chat becomes readable after the attempt ends');
reset role;
delete from public.enrollments where user_id=pg_temp.fixture_id(2) and course_id=pg_temp.fixture_id(10);
set local role authenticated;
select is((select count(*) from public.chat_messages),0::bigint,'leaving a course revokes chat reads immediately');
select is((select count(*) from public.lesson_localizations),0::bigint,'leaving also revokes published translations');
select is((select count(*) from public.ai_jobs),0::bigint,'leaving revokes course job reads');
reset role;
insert into public.enrollments(user_id,course_id) values(pg_temp.fixture_id(2),pg_temp.fixture_id(10));
update public.lessons set content_revision=content_revision+1 where id=pg_temp.fixture_id(30);
select ok((select bool_and(stale_at is not null) from public.lesson_ai_bundles where lesson_id=pg_temp.fixture_id(30)), 'source edit marks every derived version stale');
select throws_ok($$update public.lesson_ai_bundles set status='published',reviewed_by=pg_temp.fixture_id(1),reviewed_at=now(),published_at=now() where id=pg_temp.fixture_id(111)$$,
  'PT409','AI_SOURCE_REVISION_CONFLICT','stale generation cannot be published over changed content');
set local role authenticated;
select is((select count(*) from public.lesson_localizations),0::bigint,'stale published text is not served to students');
reset role;
select is((select count(*) from public.lesson_localizations where bundle_id=pg_temp.fixture_id(110)),3::bigint,'staleness preserves historical translations');

-- Audit grants/RLS over the exact foundation table set, including future-facing
-- service tables which must remain closed until their checked RPCs exist.
select ok(bool_and(c.relrowsecurity), 'every foundation table enables RLS') from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('ai_config_versions','ai_runtime_settings','ai_model_catalog','media_sources','media_uploads','ai_jobs','ai_job_payloads','ai_job_leases','ai_job_steps','ai_attempts','lesson_ai_bundles','lesson_localizations','subtitle_tracks','course_index_versions','course_chunks','chat_threads','chat_messages','xp_ledger','gamification_preferences','course_ranking_memberships','weekly_learning_goals','user_achievements','course_weekly_scores');
select ok(not bool_or(has_table_privilege('authenticated',c.oid,'insert,update,delete')), 'no direct authenticated writes to foundation tables') from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('ai_config_versions','ai_runtime_settings','ai_model_catalog','media_sources','media_uploads','ai_jobs','ai_job_payloads','ai_job_leases','ai_job_steps','ai_attempts','lesson_ai_bundles','lesson_localizations','subtitle_tracks','course_index_versions','course_chunks','chat_threads','chat_messages','xp_ledger','gamification_preferences','course_ranking_memberships','weekly_learning_goals','user_achievements','course_weekly_scores');
select ok(not bool_or(has_table_privilege('anon',c.oid,'select,insert,update,delete')), 'anonymous clients cannot access foundation tables') from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname in ('ai_config_versions','ai_runtime_settings','ai_model_catalog','media_sources','media_uploads','ai_jobs','ai_job_payloads','ai_job_leases','ai_job_steps','ai_attempts','lesson_ai_bundles','lesson_localizations','subtitle_tracks','course_index_versions','course_chunks','chat_threads','chat_messages','xp_ledger','gamification_preferences','course_ranking_memberships','weekly_learning_goals','user_achievements','course_weekly_scores');
select ok(not has_table_privilege('service_role','public.xp_ledger','update,delete'),'worker cannot rewrite reward history');
select ok(not has_table_privilege('service_role','public.ai_config_versions','update,delete'),'worker cannot mutate pinned configurations');
select ok(not (select author_tools_enabled or video_enabled or chat_enabled or gamification_enabled from public.ai_runtime_settings),'unfinished features are disabled by default');

-- The worker API role can use constraints/triggers, but still cannot rewrite
-- immutable history. These tests catch missing schema/function grants.
set local role service_role;
select lives_ok($$insert into public.ai_config_versions(config,file_sha256) values('{"key_aliases":["OPENAI_API_KEY_1"]}',repeat('c',64))$$,
  'service role can persist a validated alias-only configuration');
select throws_ok($$update public.ai_config_versions set description='Overwrite' where id=pg_temp.fixture_id(40)$$,
  '42501','permission denied for table ai_config_versions','configuration immutability is enforced for the worker');
select lives_ok($$update public.lesson_localizations set summary='Manual author draft' where bundle_id=pg_temp.fixture_id(111) and language='ru'$$,
  'service role can edit a draft using the protected aggregate revision');
select lives_ok($$update public.media_sources set youtube_id='abcdefghijk' where id=pg_temp.fixture_id(52)$$,
  'service role can update a source with automatic version invalidation');
select is((select content_revision from public.media_sources where id=pg_temp.fixture_id(52)),2,'source revision increments automatically');
select ok((select stale_at is not null from public.lesson_ai_bundles where id=pg_temp.fixture_id(112)),'source replacement invalidates its draft');
reset role;
select lives_ok($$delete from auth.users where id=pg_temp.fixture_id(2)$$,'account deletion removes private conversations and rewards despite correction links');
select is((select count(*) from public.chat_threads where user_id=pg_temp.fixture_id(2)),0::bigint,'deleted account has no retained private threads');
select is((select count(*) from public.xp_ledger where user_id=pg_temp.fixture_id(2)),0::bigint,'deleted account has no retained personal XP rows');
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-4000-8000-000000000001', 'revision-teacher@example.test', '{"role":"teacher"}'),
  ('11000000-0000-4000-8000-000000000002', 'revision-student@example.test', '{"role":"student"}'),
  ('11000000-0000-4000-8000-000000000003', 'revision-other@example.test', '{"role":"teacher"}');

create temporary table draft_state (course_id uuid, revision integer, modules jsonb, item_ids uuid[], quiz_id uuid, assignment_id uuid);
grant all on draft_state to authenticated;
insert into draft_state (modules) values ('[
  {"id":"31000000-0000-4000-8000-000000000001","title":"First module","lessons":[
    {"id":"41000000-0000-4000-8000-000000000001","title":"Text lesson","type":"text","payload":{"content":"Original content"}},
    {"id":"41000000-0000-4000-8000-000000000002","title":"Quiz lesson","type":"quiz","payload":{"passing_score":70,"questions":[
      {"id":"81000000-0000-4000-8000-000000000001","prompt":"First question","options":["A","B"],"answer_key":0},
      {"id":"81000000-0000-4000-8000-000000000002","prompt":"Second question","options":["C","D"],"answer_key":1}
    ]}}
  ]},
  {"id":"31000000-0000-4000-8000-000000000002","title":"Second module","lessons":[
    {"id":"41000000-0000-4000-8000-000000000003","title":"Homework lesson","type":"homework","description":"Explain your answer","payload":{}}
  ]}
]');

create function pg_temp.save_tree(p_modules jsonb default null, p_revision integer default null)
returns jsonb language plpgsql as $$
declare s draft_state%rowtype; result jsonb;
begin
  select * into s from draft_state;
  result := public.save_course_draft_v2(s.course_id, coalesce(p_revision, s.revision, 0),
    'Revision test course', 'revision-test-course', '', '', '', coalesce(p_modules, s.modules), false);
  update draft_state set course_id = (result->>'course_id')::uuid, revision = (result->>'content_revision')::integer;
  return result;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok($$select pg_temp.save_tree()$$, 'versioned API creates the tree with client IDs');
select is((select count(*) from public.lessons where id::text like '41000000%'), 3::bigint, 'all client lesson IDs are used');
select is((select count(*) from public.quiz_questions where id::text like '81000000%'), 2::bigint, 'all client question IDs are used');
select is((select min(content_revision) from public.lessons where id::text like '41000000%'), 1, 'new lessons start at revision one');
select ok((select revision > 0 from draft_state), 'save returns a positive server revision');
update draft_state set item_ids = (select array_agg(id order by id) from public.lesson_items where lesson_id::text like '41000000%'),
  quiz_id = (select id from public.quizzes where lesson_id = '41000000-0000-4000-8000-000000000002'),
  assignment_id = (select id from public.assignments where lesson_id = '41000000-0000-4000-8000-000000000003');

select is((pg_temp.save_tree()->>'content_revision')::integer, (select revision + 1 from draft_state), 'each save advances course revision');
select is((select max(content_revision) from public.lessons where id::text like '41000000%'), 1, 'no-op save does not invalidate lesson revisions');
select is((select array_agg(id order by id) from public.lesson_items where lesson_id::text like '41000000%'), (select item_ids from draft_state), 'content item IDs survive a save');
select is((select id from public.quizzes where lesson_id = '41000000-0000-4000-8000-000000000002'), (select quiz_id from draft_state), 'quiz ID survives a save');
select is((select id from public.assignments where lesson_id = '41000000-0000-4000-8000-000000000003'), (select assignment_id from draft_state), 'assignment ID survives a save');

select throws_ok($$select pg_temp.save_tree(null, 0)$$, 'PT409', 'COURSE_REVISION_CONFLICT', 'stale saves fail with a conflict');
select throws_ok($$select public.save_course_draft((select course_id from draft_state), 'Old client', 'old-client', '', '', '', (select modules from draft_state), false)$$,
  'PT409', 'COURSE_EDITOR_UPDATE_REQUIRED', 'legacy clients cannot replace a versioned tree');
select throws_ok($$update public.lessons set title = 'Bypass' where id = '41000000-0000-4000-8000-000000000001'$$,
  '42501', 'permission denied for table lessons', 'direct lesson writes cannot bypass version checks');
select throws_ok($$update public.quiz_questions set answer_key = '1' where id = '81000000-0000-4000-8000-000000000001'$$,
  '42501', 'permission denied for table quiz_questions', 'direct question writes cannot bypass history protection');

-- Swap module, lesson and question positions, retaining identities.
select lives_ok($$select pg_temp.save_tree((select jsonb_build_array(modules->1,
  jsonb_set(modules->0, '{lessons}', jsonb_build_array(
    jsonb_set(modules#>'{0,lessons,1}', '{payload,questions}', jsonb_build_array(modules#>'{0,lessons,1,payload,questions,1}', modules#>'{0,lessons,1,payload,questions,0}')),
    modules#>'{0,lessons,0}'))) from draft_state))$$, 'module, lesson and question reorder is atomic');
select is((select order_index from public.modules where id = '31000000-0000-4000-8000-000000000002'), 0, 'module position changes');
select is((select order_index from public.lessons where id = '41000000-0000-4000-8000-000000000002'), 0, 'lesson position changes');
select is((select order_index from public.quiz_questions where id = '81000000-0000-4000-8000-000000000002'), 0, 'question position changes');
select is((select content_revision from public.lessons where id = '41000000-0000-4000-8000-000000000001'), 1, 'lesson reordering alone preserves content revision');
select is((select content_revision from public.lessons where id = '41000000-0000-4000-8000-000000000002'), 2, 'question order change increments source revision');
select lives_ok($$select pg_temp.save_tree()$$, 'original order can be restored without recreating rows');

update draft_state set modules = jsonb_set(modules, '{0,lessons,0,payload,content}', '"Edited content"');
select lives_ok($$select pg_temp.save_tree()$$, 'content can be edited');
select is((select content_revision from public.lessons where id = '41000000-0000-4000-8000-000000000001'), 2, 'actual content change increments lesson revision once');
select lives_ok($$select pg_temp.save_tree()$$, 'same content can be saved again');
select is((select content_revision from public.lessons where id = '41000000-0000-4000-8000-000000000001'), 2, 'repeating the same content does not increment lesson revision');
select is((select payload->>'content' from public.lesson_items where lesson_id = '41000000-0000-4000-8000-000000000001'), 'Edited content', 'snapshot comparison sees writes within the transaction');

select throws_ok($$select pg_temp.save_tree((select jsonb_build_array(modules->0, modules->0) from draft_state))$$,
  'P0001', 'Duplicate module identifier', 'duplicate module IDs are rejected');
select throws_ok($$select pg_temp.save_tree((select jsonb_set(modules, '{0,lessons,1,id}', modules#>'{0,lessons,0,id}') from draft_state))$$,
  'P0001', 'Duplicate lesson identifier', 'duplicate lesson IDs are rejected');
select throws_ok($$select pg_temp.save_tree((select jsonb_set(modules, '{0,lessons,1,payload,questions,1,id}', modules#>'{0,lessons,1,payload,questions,0,id}') from draft_state))$$,
  'P0001', 'Duplicate question identifier', 'duplicate question IDs are rejected');
select throws_ok($$select pg_temp.save_tree((select jsonb_set(modules, '{0,lessons,0,item_id}', '"51000000-0000-4000-8000-000000000099"') from draft_state))$$,
  'P0001', 'Content item does not belong to this lesson', 'foreign content item IDs are rejected');

reset role;
insert into public.courses (id, slug, title, author_id) values ('21000000-0000-4000-8000-000000000099', 'revision-foreign', 'Foreign course', '11000000-0000-4000-8000-000000000003');
insert into public.modules (id, course_id, title, order_index) values ('31000000-0000-4000-8000-000000000099', '21000000-0000-4000-8000-000000000099', 'Foreign module', 0);
insert into public.lessons (id, module_id, title, order_index) values ('41000000-0000-4000-8000-000000000099', '31000000-0000-4000-8000-000000000099', 'Foreign lesson', 0);
insert into public.quizzes (id, lesson_id, title) values ('71000000-0000-4000-8000-000000000099', '41000000-0000-4000-8000-000000000099', 'Foreign quiz');
insert into public.quiz_questions (id, quiz_id, type, prompt, options, answer_key, order_index) values ('81000000-0000-4000-8000-000000000099', '71000000-0000-4000-8000-000000000099', 'single_choice', 'Foreign question', '["A","B"]', '0', 0);
set local role authenticated;
select throws_ok($$select pg_temp.save_tree((select jsonb_set(modules, '{0,id}', '"31000000-0000-4000-8000-000000000099"') from draft_state))$$,
  'P0001', 'Module does not belong to this course', 'foreign module cannot be adopted');
select throws_ok($$select pg_temp.save_tree((select jsonb_set(modules, '{0,lessons,0,id}', '"41000000-0000-4000-8000-000000000099"') from draft_state))$$,
  'P0001', 'Lesson does not belong to this course', 'foreign lesson cannot be adopted');
select throws_ok($$select pg_temp.save_tree((select jsonb_set(modules, '{0,lessons,1,payload,questions,0,id}', '"81000000-0000-4000-8000-000000000099"') from draft_state))$$,
  'P0001', 'Question does not belong to this quiz', 'foreign question cannot be adopted');

-- Seed existing learning history; no public course or real user is touched.
reset role;
insert into public.user_progress (user_id, lesson_id, is_completed, completed_at) values ('11000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000001', true, now());
insert into public.quiz_attempts (quiz_id, user_id, attempt_number, status, score, submitted_at) select quiz_id, '11000000-0000-4000-8000-000000000002', 1, 'graded', 100, now() from draft_state;
insert into public.assignment_submissions (assignment_id, user_id, text_answer) select assignment_id, '11000000-0000-4000-8000-000000000002', 'My answer' from draft_state;
set local role authenticated;
select lives_ok($$select pg_temp.save_tree()$$, 'no-op edit preserves a course with learning history');
select throws_ok($$select pg_temp.save_tree((select modules #- '{0,lessons,0}' from draft_state))$$,
  'PT409', 'COURSE_LESSON_HAS_ACTIVITY', 'completed lesson cannot be silently removed');
select throws_ok($$select pg_temp.save_tree((select modules #- '{0,lessons,1}' from draft_state))$$,
  'PT409', 'COURSE_LESSON_HAS_ACTIVITY', 'quiz lesson with attempts cannot be removed');
select throws_ok($$select pg_temp.save_tree((select modules - 1 from draft_state))$$,
  'PT409', 'COURSE_LESSON_HAS_ACTIVITY', 'module with submitted homework cannot be removed');
select throws_ok($$select pg_temp.save_tree((select jsonb_set(modules, '{0,lessons,1,payload,questions,0,answer_key}', '1') from draft_state))$$,
  'PT409', 'COURSE_ASSESSMENT_HAS_ATTEMPTS', 'attempts protect assessment content from retroactive changes');
select throws_ok($$select pg_temp.save_tree((select jsonb_set(modules, '{0,lessons,1,type}', '"text"') from draft_state))$$,
  'PT409', 'COURSE_ASSESSMENT_HAS_ATTEMPTS', 'quiz type cannot change after an attempt');
select throws_ok($$select pg_temp.save_tree((select jsonb_set(modules, '{1,lessons,0,type}', '"text"') from draft_state))$$,
  'PT409', 'COURSE_ASSIGNMENT_HAS_SUBMISSIONS', 'homework type cannot change after a submission');
select is((select count(*) from public.user_progress where lesson_id = '41000000-0000-4000-8000-000000000001'), 1::bigint, 'progress survives failed deletions');
select is((select count(*) from public.quiz_attempts where quiz_id = (select quiz_id from draft_state)), 1::bigint, 'attempt survives rejected edits');
select is((select count(*) from public.assignment_submissions where assignment_id = (select assignment_id from draft_state)), 1::bigint, 'submission survives rejected edits');
select is((select answer_key from public.quiz_questions where id = '81000000-0000-4000-8000-000000000001'), '0'::jsonb, 'failed save rolls back the answer key');
select is((select content_revision from public.courses where id = (select course_id from draft_state)), (select revision from draft_state), 'failed saves do not advance the course revision');

select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok($$select pg_temp.save_tree()$$, 'P0001', 'Course not found or cannot be edited', 'another teacher cannot save this course');
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select pg_temp.save_tree()$$, 'P0001', 'Only teachers and administrators can save courses', 'student cannot use the writer');
reset role;
set local role anon;
select ok(not has_function_privilege('anon', 'public.save_course_draft_v2(uuid,integer,text,text,text,text,text,jsonb,boolean)', 'execute'), 'anonymous users cannot execute the writer');
reset role;
select * from finish();
rollback;

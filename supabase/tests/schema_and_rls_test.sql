begin;
create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
select plan(48);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'courses', 'courses table exists');
select has_table('public', 'enrollments', 'enrollments table exists');
select has_table('public', 'certificates', 'certificates table exists');
select has_table('storage', 'objects', 'storage objects table exists');
select is((select relrowsecurity from pg_class where oid = 'public.courses'::regclass), true, 'courses has RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'storage.objects'::regclass), true, 'storage objects has RLS enabled');
select results_eq(
  $$ select count(*) from storage.buckets
     where id in ('course-assets', 'submission-files', 'certificates')
       and public = false $$,
  array[3::bigint],
  'all application storage buckets are private'
);

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001', 'teacher@example.test', '{"full_name":"Teacher","role":"teacher"}'),
  ('10000000-0000-0000-0000-000000000002', 'student@example.test', '{"full_name":"Student","role":"student"}'),
  ('10000000-0000-0000-0000-000000000003', 'other@example.test', '{"full_name":"Other","role":"student"}'),
  ('10000000-0000-0000-0000-000000000004', 'unsafe@example.test', '{"full_name":"Unsafe","role":"admin"}');

select is((select role::text from public.profiles where id = '10000000-0000-0000-0000-000000000001'), 'teacher', 'teacher role is accepted at registration');
select is((select role::text from public.profiles where id = '10000000-0000-0000-0000-000000000004'), 'student', 'admin role cannot be self-assigned');

update public.profiles
set role = 'admin'
where id = '10000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.courses (slug, title, author_id, status) values ('returning-test', 'Returning test course', '10000000-0000-0000-0000-000000000001', 'draft') returning id $$,
  'teacher can create a draft when the API requests the inserted row'
);
select lives_ok(
  $$ select public.save_course_draft(
    null, 'Quiz types test', 'quiz-types-test', '', 'Разработка', '1 час',
    '[{"title":"Module","order_index":0,"lessons":[{"title":"Quiz lesson","description":"","order_index":0,"is_required":true,"type":"quiz","payload":{"passing_score":70,"attempt_limit":3,"is_required":true,"questions":[{"type":"single_choice","prompt":"Single","public_options":["A","B"],"answer_key":1,"points":1,"order_index":0},{"type":"multiple_choice","prompt":"Multiple","public_options":["A","B","C"],"answer_key":[0,2],"points":1,"order_index":1},{"type":"matching","prompt":"Matching","public_options":{"left":["L1","L2"],"right":["R2","R1"]},"answer_key":[1,0],"points":1,"order_index":2}]}}]}]'::jsonb,
    false
  ) $$,
  'teacher can atomically save all supported quiz question types'
);
select is(
  (
    select bool_or(li.payload ? 'questions')
    from public.lesson_items li
    join public.lessons l on l.id = li.lesson_id
    join public.modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    where c.slug = 'quiz-types-test'
  ),
  false,
  'student-readable lesson payload does not contain quiz answer keys'
);
select results_eq(
  $$ select q.type::text
     from public.quiz_questions q
     join public.quizzes quiz on quiz.id = q.quiz_id
     join public.lessons l on l.id = quiz.lesson_id
     join public.modules m on m.id = l.module_id
     join public.courses c on c.id = m.course_id
     where c.slug = 'quiz-types-test'
     order by q.order_index $$,
  array['single_choice'::text, 'multiple_choice'::text, 'matching'::text],
  'single, multiple and matching questions are stored in protected tables'
);

select lives_ok(
  $$ select public.save_course_draft(
    null, 'Workflow test', 'workflow-test', '', 'Разработка', '1 час',
    '[{"title":"Module","order_index":0,"lessons":[{"title":"Lesson","description":"","order_index":0,"is_required":true,"type":"text","payload":{"content":"Test"}}]}]'::jsonb,
    true
  ) $$,
  'teacher can submit a complete course for moderation'
);
select is(
  (select status::text from public.courses where slug = 'workflow-test'),
  'pending_review',
  'submitted course enters pending review'
);
select throws_ok(
  $$ update public.courses set status = 'published' where slug = 'workflow-test' $$,
  'P0001',
  'A course in this status cannot be edited by its author',
  'teacher cannot publish a course directly'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.moderate_course((select id from public.courses where slug = 'workflow-test'), true, '') $$,
  'P0001',
  'Administrator access is required',
  'non-admin cannot moderate a course'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.moderate_course((select id from public.courses where slug = 'workflow-test'), true, '') $$,
  'admin can publish a course pending review'
);
select is(
  (select status::text from public.courses where slug = 'workflow-test'),
  'published',
  'moderated course becomes published'
);
select results_eq(
  $$ select status::text from public.moderation_history
     where course_id = (select id from public.courses where slug = 'workflow-test') $$,
  array['published'::text],
  'moderation decision is recorded'
);

reset role;
delete from public.courses where slug in ('returning-test', 'quiz-types-test', 'workflow-test');

insert into public.courses (id, slug, title, author_id, status) values
  ('20000000-0000-0000-0000-000000000001', 'published-test', 'Published test course', '10000000-0000-0000-0000-000000000001', 'published'),
  ('20000000-0000-0000-0000-000000000002', 'draft-test', 'Draft test course', '10000000-0000-0000-0000-000000000001', 'draft');

insert into public.modules (id, course_id, title, order_index) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Published module', 0),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Draft module', 0);
insert into public.lessons (id, module_id, title, order_index) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Published lesson', 0),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'Draft lesson', 0);
insert into public.lesson_items (id, lesson_id, type, order_index) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'rich_text', 0),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'rich_text', 0);
insert into public.assignments (id, lesson_id, instructions) values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Published assignment'),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Draft assignment');
insert into public.quizzes (id, lesson_id, title, passing_score, attempt_limit) values
  ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Published quiz', 70, 1),
  ('70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Draft quiz', 70, null);
insert into public.quiz_questions (id, quiz_id, type, prompt, options, answer_key, order_index) values
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'single_choice', 'Published answer key', '["Wrong","Correct"]', '1', 0),
  ('80000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'single_choice', 'Draft answer key', '["Wrong","Correct"]', '1', 0);
insert into storage.objects (id, bucket_id, name, owner_id) values
  ('a1000000-0000-4000-8000-000000000001', 'course-assets', '20000000-0000-0000-0000-000000000001/material.pdf', '10000000-0000-0000-0000-000000000001');

set local role anon;
select results_eq(
  $$ select count(*) from public.modules where id::text like '30000000%' $$,
  array[1::bigint],
  'anonymous visitors see module titles for published courses only'
);
select results_eq(
  $$ select count(*) from public.lessons where id::text like '40000000%' $$,
  array[1::bigint],
  'anonymous visitors see lesson titles for published courses only'
);
select is_empty(
  $$ select id from storage.objects where id = 'a1000000-0000-4000-8000-000000000001' $$,
  'anonymous visitors cannot read private course assets'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$ select count(*) from public.courses $$,
  array[1::bigint],
  'student sees published course but not teacher draft'
);

select lives_ok(
  $$ insert into public.enrollments (user_id, course_id) values ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001') $$,
  'student can enroll themselves in a published course'
);
select results_eq(
  $$ select count(*) from storage.objects where id = 'a1000000-0000-4000-8000-000000000001' $$,
  array[1::bigint],
  'enrolled student can read an authorized private course asset'
);

select throws_ok(
  $$ insert into public.enrollments (user_id, course_id) values ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001') $$
);

select results_eq(
  $$ select count(*) from public.lesson_items where id::text like '50000000%' $$,
  array[1::bigint],
  'enrolled student sees lesson content for the published course'
);
select results_eq(
  $$ select count(*) from public.assignments where id::text like '60000000%' $$,
  array[1::bigint],
  'enrolled student sees assignments for the published course'
);
select results_eq(
  $$ select count(*) from public.quizzes where id::text like '70000000%' $$,
  array[1::bigint],
  'enrolled student sees quizzes for the published course'
);
select is_empty(
  $$ select id from public.quiz_questions where id::text like '80000000%' $$,
  'student cannot read quiz answer keys'
);
select is(
  public.issue_certificate_if_eligible('20000000-0000-0000-0000-000000000001'),
  null::uuid,
  'certificate is not issued before required work is complete'
);
select is(
  public.submit_quiz_attempt(
    public.start_quiz_attempt('70000000-0000-0000-0000-000000000001'),
    jsonb_build_object('80000000-0000-0000-0000-000000000001', 1)
  ),
  100::numeric,
  'quiz answers are graded on the server'
);
select throws_ok(
  $$ select public.start_quiz_attempt('70000000-0000-0000-0000-000000000001') $$,
  'P0001',
  'The attempt limit has been reached',
  'quiz attempt limit is enforced on the server'
);
select is(
  public.issue_certificate_if_eligible('20000000-0000-0000-0000-000000000001'),
  null::uuid,
  'passing a quiz alone does not bypass required lesson progress'
);
select lives_ok(
  $$ insert into public.user_progress (user_id, lesson_id, is_completed, completed_at)
     values (
       '10000000-0000-0000-0000-000000000002',
       '40000000-0000-0000-0000-000000000001',
       true,
       now()
     ) $$,
  'student can complete an accessible lesson'
);
select ok(
  public.issue_certificate_if_eligible('20000000-0000-0000-0000-000000000001') is not null,
  'certificate is issued after all required work is complete'
);
select lives_ok(
  $$ insert into public.assignment_submissions (
       id, assignment_id, user_id, text_answer
     ) values (
       '90000000-0000-0000-0000-000000000001',
       '60000000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000002',
       'Student answer'
     ) $$,
  'student can create a draft assignment submission'
);
select throws_ok(
  $$ update public.assignment_submissions
     set status = 'graded', grade = 100, feedback = 'Self graded',
         reviewed_by = '10000000-0000-0000-0000-000000000002', submitted_at = now()
     where id = '90000000-0000-0000-0000-000000000001' $$,
  'P0001',
  'This submission can no longer be changed by the student',
  'student cannot grade their own submission'
);
select lives_ok(
  $$ update public.assignment_submissions
     set status = 'submitted'
     where id = '90000000-0000-0000-0000-000000000001' $$,
  'student can submit a draft assignment'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select is_empty(
  $$ select id from storage.objects where id = 'a1000000-0000-4000-8000-000000000001' $$,
  'unenrolled student cannot read another course private asset'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $$ select count(*) from public.courses $$,
  array[2::bigint],
  'teacher sees published course and their own draft'
);
select results_eq(
  $$ select count(*) from public.quiz_questions where id::text like '80000000%' $$,
  array[2::bigint],
  'teacher sees answer keys for both owned courses'
);
select lives_ok(
  $$ update public.assignment_submissions
     set status = 'graded', grade = 95, feedback = 'Good work',
         reviewed_by = '10000000-0000-0000-0000-000000000001'
     where id = '90000000-0000-0000-0000-000000000001' $$,
  'teacher can grade a submitted assignment'
);
select is(
  (select status::text from public.assignment_submissions where id = '90000000-0000-0000-0000-000000000001'),
  'graded',
  'graded assignment keeps its final status'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is_empty(
  $$ update public.courses set title = 'Unauthorized edit' where id = '20000000-0000-0000-0000-000000000002' returning id $$,
  'student cannot update a teacher draft'
);

reset role;
update public.certificates
set verification_token = 'a0000000-0000-4000-8000-000000000001'
where user_id = '10000000-0000-0000-0000-000000000002'
  and course_id = '20000000-0000-0000-0000-000000000001';
set local role anon;
select results_eq(
  $$ select count(*)
     from public.verify_certificate('a0000000-0000-4000-8000-000000000001') $$,
  array[1::bigint],
  'issued certificate can be verified anonymously'
);

select * from finish();
rollback;

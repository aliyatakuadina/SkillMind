-- SkillMind LMS: row-level security, защищённые RPC и Storage-политики.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('teacher', 'admin')
  );
$$;

create or replace function public.is_course_author(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.courses c
    join public.profiles p on p.id = c.author_id
    where c.id = p_course_id and c.author_id = auth.uid() and p.role = 'teacher'
  );
$$;

create or replace function public.can_access_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_course_author(p_course_id) or exists (
    select 1
    from public.enrollments e
    join public.courses c on c.id = e.course_id
    where e.course_id = p_course_id
      and e.user_id = auth.uid()
      and c.status = 'published'
  );
$$;

create or replace function public.can_access_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_access_course(m.course_id)
  from public.lessons l
  join public.modules m on m.id = l.module_id
  where l.id = p_lesson_id;
$$;

create or replace function public.can_manage_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_course_author(m.course_id)
  from public.lessons l
  join public.modules m on m.id = l.module_id
  where l.id = p_lesson_id;
$$;

create or replace function public.is_submission_reviewer(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.assignment_submissions s
    join public.assignments a on a.id = s.assignment_id
    where s.id = p_submission_id and public.can_manage_lesson(a.lesson_id)
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_teacher() from public;
revoke all on function public.is_course_author(uuid) from public;
revoke all on function public.can_access_course(uuid) from public;
revoke all on function public.can_access_lesson(uuid) from public;
revoke all on function public.can_manage_lesson(uuid) from public;
revoke all on function public.is_submission_reviewer(uuid) from public;

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and current_user not in ('postgres', 'service_role')
     and not public.is_admin() then
    raise exception 'Changing a user role is restricted to administrators';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_escalation
  before update on public.profiles
  for each row execute procedure public.prevent_role_escalation();

create or replace function public.enforce_course_workflow()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role') or public.is_admin() then
    if new.status = 'published' and old.status is distinct from 'published' then
      new.published_at = coalesce(new.published_at, now());
    end if;
    return new;
  end if;

  if old.author_id is distinct from auth.uid() or new.author_id is distinct from old.author_id then
    raise exception 'Only the course author can edit this course';
  end if;

  if old.status not in ('draft', 'changes_requested') then
    raise exception 'A course in this status cannot be edited by its author';
  end if;

  if new.status not in ('draft', 'pending_review') then
    raise exception 'Authors may only save a draft or send it for review';
  end if;

  return new;
end;
$$;

create trigger courses_enforce_workflow
  before update on public.courses
  for each row execute procedure public.enforce_course_workflow();

create or replace function public.set_progress_completion_time()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_completed and not old.is_completed then
    new.completed_at = coalesce(new.completed_at, now());
  elsif not new.is_completed then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger user_progress_set_completion_time
  before update on public.user_progress
  for each row execute procedure public.set_progress_completion_time();

create or replace function public.enforce_submission_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_submission_reviewer(old.id) then
    if new.status = 'graded' and (new.grade is null or new.reviewed_by is null) then
      raise exception 'A graded submission needs a grade and reviewer';
    end if;
    if new.status in ('returned', 'graded') then
      new.reviewed_at = coalesce(new.reviewed_at, now());
      new.reviewed_by = coalesce(new.reviewed_by, auth.uid());
    end if;
    return new;
  end if;

  if old.user_id is distinct from auth.uid() then
    raise exception 'Only the submitting student can update this work';
  end if;
  if old.status not in ('draft', 'returned') or new.status not in ('draft', 'submitted') then
    raise exception 'This submission can no longer be changed by the student';
  end if;
  if new.grade is not null or new.feedback is not null or new.reviewed_by is not null then
    raise exception 'Students cannot set a grade or feedback';
  end if;
  if new.status = 'submitted' then
    new.submitted_at = coalesce(new.submitted_at, now());
  else
    new.submitted_at = null;
  end if;
  return new;
end;
$$;

create trigger submissions_enforce_state
  before update on public.assignment_submissions
  for each row execute procedure public.enforce_submission_state();

create or replace function public.enforce_quiz_attempt_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_limit smallint;
  v_attempts integer;
begin
  select attempt_limit into v_limit from public.quizzes where id = new.quiz_id;
  select count(*) into v_attempts
  from public.quiz_attempts
  where quiz_id = new.quiz_id and user_id = new.user_id;
  if v_limit is not null and v_attempts >= v_limit then
    raise exception 'The attempt limit has been reached';
  end if;
  return new;
end;
$$;

create trigger quiz_attempts_enforce_limit
  before insert on public.quiz_attempts
  for each row execute procedure public.enforce_quiz_attempt_limit();

create or replace function public.get_quiz_questions(p_quiz_id uuid)
returns table (
  id uuid,
  type public.quiz_question_type,
  prompt text,
  options jsonb,
  points numeric,
  order_index integer
)
language sql
stable
security definer
set search_path = public
as $$
  select q.id, q.type, q.prompt, q.options, q.points, q.order_index
  from public.quiz_questions q
  join public.quizzes quiz on quiz.id = q.quiz_id
  where q.quiz_id = p_quiz_id
    and public.can_access_lesson(quiz.lesson_id)
  order by q.order_index;
$$;

create or replace function public.start_quiz_attempt(p_quiz_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson_id uuid;
  v_attempt_id uuid;
  v_next_number smallint;
begin
  select lesson_id into v_lesson_id from public.quizzes where id = p_quiz_id;
  if v_lesson_id is null or not public.can_access_lesson(v_lesson_id) then
    raise exception 'Quiz is not available to the current user';
  end if;

  select coalesce(max(attempt_number), 0) + 1 into v_next_number
  from public.quiz_attempts
  where quiz_id = p_quiz_id and user_id = auth.uid();

  insert into public.quiz_attempts (quiz_id, user_id, attempt_number)
  values (p_quiz_id, auth.uid(), v_next_number)
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

create or replace function public.submit_quiz_attempt(p_attempt_id uuid, p_answers jsonb)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quiz_id uuid;
  v_status public.quiz_attempt_status;
  v_score numeric(5,2);
begin
  select quiz_id, status into v_quiz_id, v_status
  from public.quiz_attempts
  where id = p_attempt_id and user_id = auth.uid();

  if v_quiz_id is null or v_status is distinct from 'in_progress' then
    raise exception 'Quiz attempt cannot be submitted';
  end if;

  insert into public.quiz_answers (attempt_id, question_id, answer, is_correct, awarded_points)
  select
    p_attempt_id,
    q.id,
    coalesce(p_answers -> q.id::text, 'null'::jsonb),
    coalesce(p_answers -> q.id::text, 'null'::jsonb) = q.answer_key,
    case when coalesce(p_answers -> q.id::text, 'null'::jsonb) = q.answer_key then q.points else 0 end
  from public.quiz_questions q
  where q.quiz_id = v_quiz_id;

  select coalesce(round(100 * sum(awarded_points) / nullif(sum(q.points), 0), 2), 0)
  into v_score
  from public.quiz_answers a
  join public.quiz_questions q on q.id = a.question_id
  where a.attempt_id = p_attempt_id;

  update public.quiz_attempts
  set status = 'graded', score = v_score, submitted_at = now()
  where id = p_attempt_id;

  return v_score;
end;
$$;

revoke all on function public.get_quiz_questions(uuid) from public;
revoke all on function public.start_quiz_attempt(uuid) from public;
revoke all on function public.submit_quiz_attempt(uuid, jsonb) from public;
grant execute on function public.get_quiz_questions(uuid) to authenticated;
grant execute on function public.start_quiz_attempt(uuid) to authenticated;
grant execute on function public.submit_quiz_attempt(uuid, jsonb) to authenticated;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.modules enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_items enable row level security;
alter table public.enrollments enable row level security;
alter table public.user_progress enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.submission_files enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
alter table public.certificates enable row level security;
alter table public.learning_events enable row level security;
alter table public.moderation_history enable row level security;

create policy "Profiles are visible to their owner or admins" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "Profiles are editable by their owner or admins" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

create policy "Published courses are visible to everyone" on public.courses for select using (status = 'published' or public.is_course_author(id));
create policy "Teachers can create draft courses" on public.courses for insert to authenticated with check (author_id = auth.uid() and status = 'draft' and public.is_teacher());
create policy "Authors and admins can update their courses" on public.courses for update to authenticated using (public.is_course_author(id)) with check (public.is_course_author(id));
create policy "Authors and admins can delete their courses" on public.courses for delete to authenticated using (public.is_course_author(id));

create policy "Course structure is available to enrolled users" on public.modules for select to authenticated using (public.can_access_course(course_id));
create policy "Authors manage modules" on public.modules for all to authenticated using (public.is_course_author(course_id)) with check (public.is_course_author(course_id));
create policy "Lessons are available to enrolled users" on public.lessons for select to authenticated using (public.can_access_lesson(id));
create policy "Authors manage lessons" on public.lessons for all to authenticated using (exists (select 1 from public.modules m where m.id = module_id and public.is_course_author(m.course_id))) with check (exists (select 1 from public.modules m where m.id = module_id and public.is_course_author(m.course_id)));
create policy "Lesson items are available to enrolled users" on public.lesson_items for select to authenticated using (public.can_access_lesson(lesson_id));
create policy "Authors manage lesson items" on public.lesson_items for all to authenticated using (public.can_manage_lesson(lesson_id)) with check (public.can_manage_lesson(lesson_id));

create policy "Students and course staff can see enrollments" on public.enrollments for select to authenticated using (user_id = auth.uid() or public.is_course_author(course_id));
create policy "Students enroll themselves in published courses" on public.enrollments for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.courses c where c.id = course_id and c.status = 'published'));
create policy "Students update their own enrollment" on public.enrollments for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Students leave their own course" on public.enrollments for delete to authenticated using (user_id = auth.uid() or public.is_admin());

create policy "Students and course staff can see progress" on public.user_progress for select to authenticated using (user_id = auth.uid() or exists (select 1 from public.lessons l join public.modules m on m.id = l.module_id where l.id = lesson_id and public.is_course_author(m.course_id)));
create policy "Students create their own progress" on public.user_progress for insert to authenticated with check (user_id = auth.uid() and public.can_access_lesson(lesson_id));
create policy "Students update their own progress" on public.user_progress for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_access_lesson(lesson_id));

create policy "Assignments are available to enrolled users" on public.assignments for select to authenticated using (public.can_access_lesson(lesson_id));
create policy "Authors manage assignments" on public.assignments for all to authenticated using (public.can_manage_lesson(lesson_id)) with check (public.can_manage_lesson(lesson_id));
create policy "Students and reviewers can see submissions" on public.assignment_submissions for select to authenticated using (user_id = auth.uid() or public.is_submission_reviewer(id));
create policy "Students create their own submissions" on public.assignment_submissions for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.assignments a where a.id = assignment_id and public.can_access_lesson(a.lesson_id)));
create policy "Students and reviewers update submissions" on public.assignment_submissions for update to authenticated using (user_id = auth.uid() or public.is_submission_reviewer(id)) with check (user_id = auth.uid() or public.is_submission_reviewer(id));
create policy "Students can remove draft submissions" on public.assignment_submissions for delete to authenticated using (user_id = auth.uid() and status = 'draft');
create policy "Students and reviewers can see submission files" on public.submission_files for select to authenticated using (exists (select 1 from public.assignment_submissions s where s.id = submission_id and (s.user_id = auth.uid() or public.is_submission_reviewer(s.id))));
create policy "Students attach files to their draft work" on public.submission_files for insert to authenticated with check (exists (select 1 from public.assignment_submissions s where s.id = submission_id and s.user_id = auth.uid() and s.status in ('draft', 'returned')));
create policy "Students remove files from their draft work" on public.submission_files for delete to authenticated using (exists (select 1 from public.assignment_submissions s where s.id = submission_id and s.user_id = auth.uid() and s.status in ('draft', 'returned')));

create policy "Quizzes are available to enrolled users" on public.quizzes for select to authenticated using (public.can_access_lesson(lesson_id));
create policy "Authors manage quizzes" on public.quizzes for all to authenticated using (public.can_manage_lesson(lesson_id)) with check (public.can_manage_lesson(lesson_id));
create policy "Only staff see quiz answer keys" on public.quiz_questions for select to authenticated using (exists (select 1 from public.quizzes q where q.id = quiz_id and public.can_manage_lesson(q.lesson_id)));
create policy "Authors manage quiz questions" on public.quiz_questions for all to authenticated using (exists (select 1 from public.quizzes q where q.id = quiz_id and public.can_manage_lesson(q.lesson_id))) with check (exists (select 1 from public.quizzes q where q.id = quiz_id and public.can_manage_lesson(q.lesson_id)));
create policy "Students and staff see quiz attempts" on public.quiz_attempts for select to authenticated using (user_id = auth.uid() or exists (select 1 from public.quizzes q where q.id = quiz_id and public.can_manage_lesson(q.lesson_id)));
create policy "Students and staff see quiz answers" on public.quiz_answers for select to authenticated using (exists (select 1 from public.quiz_attempts a where a.id = attempt_id and (a.user_id = auth.uid() or exists (select 1 from public.quizzes q where q.id = a.quiz_id and public.can_manage_lesson(q.lesson_id)))));

create policy "Students and course staff see certificates" on public.certificates for select to authenticated using (user_id = auth.uid() or public.is_course_author(course_id));
create policy "Students log their own learning events" on public.learning_events for insert to authenticated with check (user_id = auth.uid() and public.can_access_course(course_id));
create policy "Students and staff see learning events" on public.learning_events for select to authenticated using (user_id = auth.uid() or public.is_course_author(course_id));
create policy "Authors see their course moderation history" on public.moderation_history for select to authenticated using (public.is_course_author(course_id));
create policy "Admins record moderation decisions" on public.moderation_history for insert to authenticated with check (public.is_admin() and moderator_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('course-assets', 'course-assets', false, 52428800, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'video/mp4', 'image/jpeg', 'image/png']),
  ('submission-files', 'submission-files', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'text/plain']),
  ('certificates', 'certificates', false, 5242880, array['application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Enrolled users download course assets" on storage.objects for select to authenticated using (bucket_id = 'course-assets' and public.can_access_course((storage.foldername(name))[1]::uuid));
create policy "Authors upload course assets" on storage.objects for insert to authenticated with check (bucket_id = 'course-assets' and public.is_course_author((storage.foldername(name))[1]::uuid));
create policy "Authors update course assets" on storage.objects for update to authenticated using (bucket_id = 'course-assets' and public.is_course_author((storage.foldername(name))[1]::uuid)) with check (bucket_id = 'course-assets' and public.is_course_author((storage.foldername(name))[1]::uuid));
create policy "Authors remove course assets" on storage.objects for delete to authenticated using (bucket_id = 'course-assets' and public.is_course_author((storage.foldername(name))[1]::uuid));
create policy "Students download their submission files" on storage.objects for select to authenticated using (bucket_id = 'submission-files' and exists (select 1 from public.assignment_submissions s where s.id::text = (storage.foldername(name))[1] and (s.user_id = auth.uid() or public.is_submission_reviewer(s.id))));
create policy "Students upload submission files" on storage.objects for insert to authenticated with check (bucket_id = 'submission-files' and exists (select 1 from public.assignment_submissions s where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid() and s.status in ('draft', 'returned')));
create policy "Students remove their submission files" on storage.objects for delete to authenticated using (bucket_id = 'submission-files' and exists (select 1 from public.assignment_submissions s where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid() and s.status in ('draft', 'returned')));
create policy "Users and course staff download certificates" on storage.objects for select to authenticated using (bucket_id = 'certificates' and exists (select 1 from public.certificates c where c.pdf_path = name and (c.user_id = auth.uid() or public.is_course_author(c.course_id))));

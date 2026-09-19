-- Preserve the self-service teacher registration flow without allowing clients
-- to assign themselves the administrator role through editable user metadata.
create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1), 'Новый пользователь'),
    case
      when new.raw_user_meta_data ->> 'role' = 'teacher' then 'teacher'::public.user_role
      else 'student'::public.user_role
    end
  );
  return new;
end;
$$;

-- New Supabase projects no longer expose public tables through the Data API
-- automatically. Grant only operations used by the browser client; RLS still
-- determines which rows each request may access.
grant usage on schema public to anon, authenticated;
grant select on public.courses to anon;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.courses to authenticated;
grant select, insert, update, delete on public.modules to authenticated;
grant select, insert, update, delete on public.lessons to authenticated;
grant select, insert, update, delete on public.lesson_items to authenticated;
grant select, insert, update, delete on public.enrollments to authenticated;
grant select, insert, update on public.user_progress to authenticated;
grant select, insert, update, delete on public.assignments to authenticated;
grant select, insert, update, delete on public.assignment_submissions to authenticated;
grant select, insert, delete on public.submission_files to authenticated;
grant select, insert, update, delete on public.quizzes to authenticated;
grant select, insert, update, delete on public.quiz_questions to authenticated;
grant select on public.quiz_attempts, public.quiz_answers, public.certificates to authenticated;
grant select, insert on public.learning_events, public.moderation_history to authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_teacher() to authenticated;
grant execute on function public.is_course_author(uuid) to authenticated;
grant execute on function public.can_access_course(uuid) to authenticated;
grant execute on function public.can_access_lesson(uuid) to authenticated;
grant execute on function public.can_manage_lesson(uuid) to authenticated;
grant execute on function public.is_submission_reviewer(uuid) to authenticated;

-- Anonymous users may browse published course cards without invoking any
-- privileged helper function. Authenticated users can additionally see drafts
-- they own (and administrators can see all courses via is_course_author).
drop policy if exists "Published courses are visible to everyone" on public.courses;
create policy "Published courses are visible anonymously"
  on public.courses for select to anon
  using (status = 'published');
create policy "Published and owned courses are visible to users"
  on public.courses for select to authenticated
  using (status = 'published' or (select public.is_course_author(id)));

grant select on public.profiles to anon;
create policy "Published course authors have public profiles"
  on public.profiles for select to anon, authenticated
  using (exists (
    select 1 from public.courses
    where courses.author_id = profiles.id and courses.status = 'published'
  ));

create policy "Published course module titles are visible"
  on public.modules for select to anon, authenticated
  using (exists (
    select 1 from public.courses
    where courses.id = modules.course_id and courses.status = 'published'
  ));

create policy "Published course lesson titles are visible"
  on public.lessons for select to anon, authenticated
  using (exists (
    select 1 from public.modules
    join public.courses on courses.id = modules.course_id
    where modules.id = lessons.module_id and courses.status = 'published'
  ));

drop policy if exists "Authors and admins can delete their courses" on public.courses;
create policy "Authors delete editable courses and admins delete any course"
  on public.courses for delete to authenticated
  using (
    (author_id = (select auth.uid()) and status in ('draft', 'changes_requested'))
    or (select public.is_admin())
  );

-- PostgreSQL does not add indexes for foreign keys. These cover the remaining
-- ownership checks, joins, and cascading deletes used by the LMS workflows.
create index if not exists assignment_submissions_user_id_idx on public.assignment_submissions(user_id);
create index if not exists submission_files_submission_id_idx on public.submission_files(submission_id);
create index if not exists quiz_attempts_quiz_id_idx on public.quiz_attempts(quiz_id);
create index if not exists quiz_answers_question_id_idx on public.quiz_answers(question_id);
create index if not exists certificates_user_id_idx on public.certificates(user_id);
create index if not exists learning_events_user_id_idx on public.learning_events(user_id);
create index if not exists moderation_history_course_id_idx on public.moderation_history(course_id);
create index if not exists moderation_history_moderator_id_idx on public.moderation_history(moderator_id);

-- Ensure completion timestamps are valid for both inserts and updates.
create or replace function public.set_progress_completion_time()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_completed then
    new.completed_at = coalesce(new.completed_at, now());
  else
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists user_progress_set_completion_time on public.user_progress;
create trigger user_progress_set_completion_time
  before insert or update on public.user_progress
  for each row execute procedure public.set_progress_completion_time();

alter table public.courses
  add column if not exists estimated_duration text not null default '';

-- Save course metadata and its ordered module/lesson tree in one transaction.
-- SECURITY INVOKER keeps every statement subject to the caller's RLS policies.
create or replace function public.save_course_draft(
  p_course_id uuid,
  p_title text,
  p_slug text,
  p_description text,
  p_category text,
  p_estimated_duration text,
  p_modules jsonb,
  p_submit boolean
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_module jsonb;
  v_lesson jsonb;
  v_module_id uuid;
  v_lesson_id uuid;
  v_quiz_id uuid;
  v_question jsonb;
  v_item_type public.lesson_item_type;
begin
  if (select auth.uid()) is null or not (select public.is_teacher()) then
    raise exception 'Only teachers and administrators can save courses';
  end if;

  if char_length(trim(p_title)) not between 3 and 160 then
    raise exception 'Course title must contain between 3 and 160 characters';
  end if;

  if jsonb_typeof(p_modules) is distinct from 'array' or jsonb_array_length(p_modules) = 0 then
    raise exception 'A course must contain at least one module';
  end if;

  if p_course_id is null then
    insert into public.courses (
      slug, title, description, category, estimated_duration, author_id, status
    ) values (
      p_slug,
      trim(p_title),
      coalesce(p_description, ''),
      nullif(trim(p_category), ''),
      coalesce(p_estimated_duration, ''),
      (select auth.uid()),
      case when p_submit then 'pending_review'::public.course_status else 'draft'::public.course_status end
    ) returning id into v_course_id;
  else
    update public.courses
    set slug = p_slug,
        title = trim(p_title),
        description = coalesce(p_description, ''),
        category = nullif(trim(p_category), ''),
        estimated_duration = coalesce(p_estimated_duration, ''),
        status = case when p_submit then 'pending_review'::public.course_status else 'draft'::public.course_status end
    where id = p_course_id
    returning id into v_course_id;

    if v_course_id is null then
      raise exception 'Course not found or cannot be edited';
    end if;

    delete from public.modules where course_id = v_course_id;
  end if;

  for v_module in select value from jsonb_array_elements(p_modules)
  loop
    insert into public.modules (course_id, title, order_index)
    values (
      v_course_id,
      trim(v_module ->> 'title'),
      (v_module ->> 'order_index')::integer
    ) returning id into v_module_id;

    for v_lesson in select value from jsonb_array_elements(coalesce(v_module -> 'lessons', '[]'::jsonb))
    loop
      insert into public.lessons (module_id, title, description, order_index, is_required)
      values (
        v_module_id,
        trim(v_lesson ->> 'title'),
        coalesce(v_lesson ->> 'description', ''),
        (v_lesson ->> 'order_index')::integer,
        coalesce((v_lesson ->> 'is_required')::boolean, true)
      ) returning id into v_lesson_id;

      v_item_type := case v_lesson ->> 'type'
        when 'text' then 'rich_text'::public.lesson_item_type
        when 'video' then 'video'::public.lesson_item_type
        when 'pdf' then 'pdf'::public.lesson_item_type
        when 'document' then 'document'::public.lesson_item_type
        when 'quiz' then 'quiz'::public.lesson_item_type
        when 'homework' then 'assignment'::public.lesson_item_type
        else 'rich_text'::public.lesson_item_type
      end;

      insert into public.lesson_items (lesson_id, type, payload, order_index)
      values (
        v_lesson_id,
        v_item_type,
        coalesce(v_lesson -> 'payload', '{}'::jsonb),
        0
      );

      if v_item_type = 'quiz' then
        insert into public.quizzes (lesson_id, title, passing_score, attempt_limit, is_required)
        values (
          v_lesson_id,
          trim(v_lesson ->> 'title'),
          coalesce((v_lesson #>> '{payload,passing_score}')::numeric, 70),
          nullif(v_lesson #>> '{payload,attempt_limit}', '')::smallint,
          coalesce((v_lesson #>> '{payload,is_required}')::boolean, true)
        ) returning id into v_quiz_id;

        for v_question in select value from jsonb_array_elements(coalesce(v_lesson #> '{payload,questions}', '[]'::jsonb))
        loop
          insert into public.quiz_questions (quiz_id, type, prompt, options, answer_key, points, order_index)
          values (
            v_quiz_id,
            'single_choice',
            trim(v_question ->> 'prompt'),
            coalesce(v_question -> 'options', '[]'::jsonb),
            to_jsonb(coalesce((v_question ->> 'correct_option')::integer, 0)),
            coalesce((v_question ->> 'points')::numeric, 1),
            coalesce((v_question ->> 'order_index')::integer, 0)
          );
        end loop;
      elsif v_item_type = 'assignment' then
        insert into public.assignments (lesson_id, instructions, max_files, max_file_size_bytes, allowed_mime_types)
        values (
          v_lesson_id,
          coalesce(v_lesson ->> 'description', ''),
          coalesce((v_lesson #>> '{payload,max_files}')::smallint, 3),
          coalesce((v_lesson #>> '{payload,max_file_size_bytes}')::integer, 10485760),
          case
            when jsonb_typeof(v_lesson #> '{payload,allowed_mime_types}') = 'array'
              then array(select jsonb_array_elements_text(v_lesson #> '{payload,allowed_mime_types}'))
            else array['application/pdf', 'image/jpeg', 'image/png', 'text/plain']
          end
        );
      end if;
    end loop;
  end loop;

  return v_course_id;
end;
$$;

revoke all on function public.save_course_draft(uuid, text, text, text, text, text, jsonb, boolean) from public;
grant execute on function public.save_course_draft(uuid, text, text, text, text, text, jsonb, boolean) to authenticated;

create policy "Course staff see enrolled student profiles"
  on public.profiles for select to authenticated
  using (exists (
    select 1
    from public.enrollments
    where enrollments.user_id = profiles.id
      and (select public.is_course_author(enrollments.course_id))
  ));

create or replace function public.issue_certificate_if_eligible(p_course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_certificate_id uuid;
begin
  if v_user_id is null or not exists (
    select 1 from public.enrollments e
    join public.courses c on c.id = e.course_id
    where e.course_id = p_course_id and e.user_id = v_user_id and c.status = 'published'
  ) then
    raise exception 'The course is not available to the current user';
  end if;

  if exists (
    select 1
    from public.lessons l
    join public.modules m on m.id = l.module_id
    where m.course_id = p_course_id
      and l.is_required
      and not exists (
        select 1 from public.user_progress p
        where p.lesson_id = l.id and p.user_id = v_user_id and p.is_completed
      )
  ) or exists (
    select 1
    from public.quizzes q
    join public.lessons l on l.id = q.lesson_id
    join public.modules m on m.id = l.module_id
    where m.course_id = p_course_id
      and q.is_required
      and not exists (
        select 1 from public.quiz_attempts a
        where a.quiz_id = q.id and a.user_id = v_user_id
          and a.status = 'graded' and a.score >= q.passing_score
      )
  ) then
    return null;
  end if;

  insert into public.certificates (user_id, course_id, certificate_number)
  values (
    v_user_id,
    p_course_id,
    'SM-' || to_char(current_date, 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  )
  on conflict (user_id, course_id) do update set user_id = excluded.user_id
  returning id into v_certificate_id;

  return v_certificate_id;
end;
$$;

revoke all on function public.issue_certificate_if_eligible(uuid) from public;
grant execute on function public.issue_certificate_if_eligible(uuid) to authenticated;

create or replace function public.verify_certificate(p_verification_token uuid)
returns table (
  certificate_number text,
  student_name text,
  course_title text,
  issued_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.certificate_number, p.full_name, course.title, c.issued_at
  from public.certificates c
  join public.profiles p on p.id = c.user_id
  join public.courses course on course.id = c.course_id
  where c.verification_token = p_verification_token;
$$;

revoke all on function public.verify_certificate(uuid) from public;
grant execute on function public.verify_certificate(uuid) to anon, authenticated;

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  role public.user_role,
  created_at timestamptz,
  enrollments_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, u.email::text, p.full_name, p.role, p.created_at, count(e.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.enrollments e on e.user_id = p.id
  where (select public.is_admin())
  group by p.id, u.email, p.full_name, p.role, p.created_at
  order by p.created_at desc;
$$;

create or replace function public.admin_set_user_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Administrator access is required';
  end if;
  if p_user_id = (select auth.uid()) and p_role <> 'admin' then
    raise exception 'Administrators cannot remove their own administrator role';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
end;
$$;

create or replace function public.moderate_course(p_course_id uuid, p_approve boolean, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.course_status;
begin
  if not (select public.is_admin()) then
    raise exception 'Administrator access is required';
  end if;
  select status into v_status from public.courses where id = p_course_id for update;
  if v_status is distinct from 'pending_review' then
    raise exception 'Only courses pending review can be moderated';
  end if;
  if not p_approve and nullif(trim(p_comment), '') is null then
    raise exception 'A comment is required when requesting changes';
  end if;
  update public.courses
  set status = case when p_approve then 'published'::public.course_status else 'changes_requested'::public.course_status end,
      moderation_comment = nullif(trim(p_comment), '')
  where id = p_course_id;
  insert into public.moderation_history (course_id, moderator_id, status, comment)
  values (
    p_course_id,
    (select auth.uid()),
    case when p_approve then 'published'::public.course_status else 'changes_requested'::public.course_status end,
    nullif(trim(p_comment), '')
  );
end;
$$;

revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_set_user_role(uuid, public.user_role) from public;
revoke all on function public.moderate_course(uuid, boolean, text) from public;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_user_role(uuid, public.user_role) to authenticated;
grant execute on function public.moderate_course(uuid, boolean, text) to authenticated;

create or replace function public.get_course_analytics(p_course_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lesson_count integer;
  v_result jsonb;
begin
  if not (select public.is_course_author(p_course_id)) then
    raise exception 'Course analytics are not available to the current user';
  end if;

  select count(*) into v_lesson_count
  from public.lessons l join public.modules m on m.id = l.module_id
  where m.course_id = p_course_id and l.is_required;

  select jsonb_build_object(
    'course_title', (select title from public.courses where id = p_course_id),
    'lesson_count', v_lesson_count,
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.user_id,
        'name', p.full_name,
        'email', u.email,
        'enrolled_at', e.enrolled_at,
        'last_activity', coalesce(activity.last_activity, e.last_opened_at, e.enrolled_at),
        'completed_lessons', coalesce(progress.completed_lessons, 0),
        'progress_percent', case when v_lesson_count = 0 then 0 else round(100.0 * coalesce(progress.completed_lessons, 0) / v_lesson_count, 2) end,
        'average_quiz_score', quiz.average_score,
        'learning_seconds', coalesce(activity.learning_seconds, 0),
        'submitted_assignments', coalesce(assignments.submitted_count, 0),
        'graded_assignments', coalesce(assignments.graded_count, 0)
      ) order by e.enrolled_at desc)
      from public.enrollments e
      join public.profiles p on p.id = e.user_id
      join auth.users u on u.id = e.user_id
      left join lateral (
        select count(*)::integer as completed_lessons
        from public.user_progress up
        join public.lessons l on l.id = up.lesson_id
        join public.modules m on m.id = l.module_id
        where up.user_id = e.user_id and up.is_completed and l.is_required and m.course_id = p_course_id
      ) progress on true
      left join lateral (
        select round(avg(qa.score), 2) as average_score
        from public.quiz_attempts qa
        join public.quizzes q on q.id = qa.quiz_id
        join public.lessons l on l.id = q.lesson_id
        join public.modules m on m.id = l.module_id
        where qa.user_id = e.user_id and qa.status = 'graded' and m.course_id = p_course_id
      ) quiz on true
      left join lateral (
        select max(le.created_at) as last_activity, coalesce(sum(le.duration_seconds), 0)::bigint as learning_seconds
        from public.learning_events le
        where le.user_id = e.user_id and le.course_id = p_course_id
      ) activity on true
      left join lateral (
        select
          count(*) filter (where s.status in ('submitted', 'returned', 'graded'))::integer as submitted_count,
          count(*) filter (where s.status = 'graded')::integer as graded_count
        from public.assignment_submissions s
        join public.assignments a on a.id = s.assignment_id
        join public.lessons l on l.id = a.lesson_id
        join public.modules m on m.id = l.module_id
        where s.user_id = e.user_id and m.course_id = p_course_id
      ) assignments on true
      where e.course_id = p_course_id
    ), '[]'::jsonb),
    'quiz_results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', q.title,
        'attempts', stats.attempts,
        'average_score', stats.average_score,
        'pass_rate', stats.pass_rate
      ) order by q.created_at)
      from public.quizzes q
      join public.lessons l on l.id = q.lesson_id
      join public.modules m on m.id = l.module_id
      left join lateral (
        select count(*)::integer as attempts,
          round(avg(qa.score), 2) as average_score,
          round(100.0 * count(*) filter (where qa.score >= q.passing_score) / nullif(count(*), 0), 2) as pass_rate
        from public.quiz_attempts qa where qa.quiz_id = q.id and qa.status = 'graded'
      ) stats on true
      where m.course_id = p_course_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_course_analytics(uuid) from public;
grant execute on function public.get_course_analytics(uuid) to authenticated;

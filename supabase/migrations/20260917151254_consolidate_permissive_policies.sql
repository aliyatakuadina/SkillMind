-- Consolidate overlapping permissive SELECT policies. This preserves the
-- existing access matrix while ensuring PostgreSQL evaluates one SELECT policy
-- per role/action/table.

-- Profiles: keep the public author lookup for anon only and merge all signed-in
-- visibility paths into one policy.
drop policy if exists "Published course authors have public profiles" on public.profiles;
drop policy if exists "Profiles are visible to their owner or admins" on public.profiles;
drop policy if exists "Course staff see enrolled student profiles" on public.profiles;

create policy "Published course authors have public profiles"
on public.profiles for select to anon
using (
  exists (
    select 1 from public.courses
    where courses.author_id = profiles.id
      and courses.status = 'published'
  )
);

create policy "Authenticated users see permitted profiles"
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or public.is_admin()
  or exists (
    select 1 from public.courses
    where courses.author_id = profiles.id
      and courses.status = 'published'
  )
  or exists (
    select 1 from public.enrollments
    where enrollments.user_id = profiles.id
      and (select public.is_course_author(enrollments.course_id))
  )
);

-- Modules: public titles remain available to anon. Authenticated access covers
-- published courses, enrollments, authors and admins through can_access_course.
drop policy if exists "Published course module titles are visible" on public.modules;
drop policy if exists "Course structure is available to enrolled users" on public.modules;
drop policy if exists "Authors manage modules" on public.modules;

create policy "Published course module titles are visible"
on public.modules for select to anon
using (
  exists (
    select 1 from public.courses
    where courses.id = modules.course_id
      and courses.status = 'published'
  )
);

create policy "Authenticated users see permitted modules"
on public.modules for select to authenticated
using (
  public.can_access_course(course_id)
  or exists (
    select 1 from public.courses
    where courses.id = modules.course_id
      and courses.status = 'published'
  )
);

create policy "Authors insert modules"
on public.modules for insert to authenticated
with check (public.is_course_author(course_id));
create policy "Authors update modules"
on public.modules for update to authenticated
using (public.is_course_author(course_id))
with check (public.is_course_author(course_id));
create policy "Authors delete modules"
on public.modules for delete to authenticated
using (public.is_course_author(course_id));

-- Lessons.
drop policy if exists "Published course lesson titles are visible" on public.lessons;
drop policy if exists "Lessons are available to enrolled users" on public.lessons;
drop policy if exists "Authors manage lessons" on public.lessons;

create policy "Published course lesson titles are visible"
on public.lessons for select to anon
using (
  exists (
    select 1
    from public.modules
    join public.courses on courses.id = modules.course_id
    where modules.id = lessons.module_id
      and courses.status = 'published'
  )
);

create policy "Authenticated users see permitted lessons"
on public.lessons for select to authenticated
using (
  public.can_access_lesson(id)
  or exists (
    select 1
    from public.modules
    join public.courses on courses.id = modules.course_id
    where modules.id = lessons.module_id
      and courses.status = 'published'
  )
);

create policy "Authors insert lessons"
on public.lessons for insert to authenticated
with check (
  exists (
    select 1 from public.modules m
    where m.id = module_id and public.is_course_author(m.course_id)
  )
);
create policy "Authors update lessons"
on public.lessons for update to authenticated
using (
  exists (
    select 1 from public.modules m
    where m.id = module_id and public.is_course_author(m.course_id)
  )
)
with check (
  exists (
    select 1 from public.modules m
    where m.id = module_id and public.is_course_author(m.course_id)
  )
);
create policy "Authors delete lessons"
on public.lessons for delete to authenticated
using (
  exists (
    select 1 from public.modules m
    where m.id = module_id and public.is_course_author(m.course_id)
  )
);

-- Lesson items.
drop policy if exists "Lesson items are available to enrolled users" on public.lesson_items;
drop policy if exists "Authors manage lesson items" on public.lesson_items;

create policy "Authenticated users see permitted lesson items"
on public.lesson_items for select to authenticated
using (public.can_access_lesson(lesson_id));
create policy "Authors insert lesson items"
on public.lesson_items for insert to authenticated
with check (public.can_manage_lesson(lesson_id));
create policy "Authors update lesson items"
on public.lesson_items for update to authenticated
using (public.can_manage_lesson(lesson_id))
with check (public.can_manage_lesson(lesson_id));
create policy "Authors delete lesson items"
on public.lesson_items for delete to authenticated
using (public.can_manage_lesson(lesson_id));

-- Assignments.
drop policy if exists "Assignments are available to enrolled users" on public.assignments;
drop policy if exists "Authors manage assignments" on public.assignments;

create policy "Authenticated users see permitted assignments"
on public.assignments for select to authenticated
using (public.can_access_lesson(lesson_id));
create policy "Authors insert assignments"
on public.assignments for insert to authenticated
with check (public.can_manage_lesson(lesson_id));
create policy "Authors update assignments"
on public.assignments for update to authenticated
using (public.can_manage_lesson(lesson_id))
with check (public.can_manage_lesson(lesson_id));
create policy "Authors delete assignments"
on public.assignments for delete to authenticated
using (public.can_manage_lesson(lesson_id));

-- Quizzes.
drop policy if exists "Quizzes are available to enrolled users" on public.quizzes;
drop policy if exists "Authors manage quizzes" on public.quizzes;

create policy "Authenticated users see permitted quizzes"
on public.quizzes for select to authenticated
using (public.can_access_lesson(lesson_id));
create policy "Authors insert quizzes"
on public.quizzes for insert to authenticated
with check (public.can_manage_lesson(lesson_id));
create policy "Authors update quizzes"
on public.quizzes for update to authenticated
using (public.can_manage_lesson(lesson_id))
with check (public.can_manage_lesson(lesson_id));
create policy "Authors delete quizzes"
on public.quizzes for delete to authenticated
using (public.can_manage_lesson(lesson_id));

-- Quiz questions: both previous SELECT policies had the same predicate.
drop policy if exists "Only staff see quiz answer keys" on public.quiz_questions;
drop policy if exists "Authors manage quiz questions" on public.quiz_questions;

create policy "Course staff see quiz answer keys"
on public.quiz_questions for select to authenticated
using (
  exists (
    select 1 from public.quizzes q
    where q.id = quiz_id and public.can_manage_lesson(q.lesson_id)
  )
);
create policy "Authors insert quiz questions"
on public.quiz_questions for insert to authenticated
with check (
  exists (
    select 1 from public.quizzes q
    where q.id = quiz_id and public.can_manage_lesson(q.lesson_id)
  )
);
create policy "Authors update quiz questions"
on public.quiz_questions for update to authenticated
using (
  exists (
    select 1 from public.quizzes q
    where q.id = quiz_id and public.can_manage_lesson(q.lesson_id)
  )
)
with check (
  exists (
    select 1 from public.quizzes q
    where q.id = quiz_id and public.can_manage_lesson(q.lesson_id)
  )
);
create policy "Authors delete quiz questions"
on public.quiz_questions for delete to authenticated
using (
  exists (
    select 1 from public.quizzes q
    where q.id = quiz_id and public.can_manage_lesson(q.lesson_id)
  )
);

-- save_course_draft creates a hierarchy inside one SQL statement. STABLE
-- helpers retain the statement snapshot and cannot see parents inserted by an
-- earlier command in that same function. These narrow VOLATILE helpers use a
-- fresh command snapshot for write-policy checks.
create or replace function public.can_manage_module(p_module_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select public.is_course_author(m.course_id)
  from public.modules m
  where m.id = p_module_id;
$$;

create or replace function public.can_manage_lesson_write(p_lesson_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select public.is_course_author(m.course_id)
  from public.lessons l
  join public.modules m on m.id = l.module_id
  where l.id = p_lesson_id;
$$;

create or replace function public.can_manage_quiz_write(p_quiz_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select public.is_course_author(m.course_id)
  from public.quizzes q
  join public.lessons l on l.id = q.lesson_id
  join public.modules m on m.id = l.module_id
  where q.id = p_quiz_id;
$$;

revoke all on function public.can_manage_module(uuid) from public, anon;
revoke all on function public.can_manage_lesson_write(uuid) from public, anon;
revoke all on function public.can_manage_quiz_write(uuid) from public, anon;
grant execute on function public.can_manage_module(uuid) to authenticated;
grant execute on function public.can_manage_lesson_write(uuid) to authenticated;
grant execute on function public.can_manage_quiz_write(uuid) to authenticated;

drop policy if exists "Authors insert lesson items" on public.lesson_items;
drop policy if exists "Authors update lesson items" on public.lesson_items;
drop policy if exists "Authors delete lesson items" on public.lesson_items;
create policy "Authors insert lesson items" on public.lesson_items for insert to authenticated
with check (public.can_manage_lesson_write(lesson_id));
create policy "Authors update lesson items" on public.lesson_items for update to authenticated
using (public.can_manage_lesson_write(lesson_id)) with check (public.can_manage_lesson_write(lesson_id));
create policy "Authors delete lesson items" on public.lesson_items for delete to authenticated
using (public.can_manage_lesson_write(lesson_id));

drop policy if exists "Authors insert assignments" on public.assignments;
drop policy if exists "Authors update assignments" on public.assignments;
drop policy if exists "Authors delete assignments" on public.assignments;
create policy "Authors insert assignments" on public.assignments for insert to authenticated
with check (public.can_manage_lesson_write(lesson_id));
create policy "Authors update assignments" on public.assignments for update to authenticated
using (public.can_manage_lesson_write(lesson_id)) with check (public.can_manage_lesson_write(lesson_id));
create policy "Authors delete assignments" on public.assignments for delete to authenticated
using (public.can_manage_lesson_write(lesson_id));

drop policy if exists "Authors insert quizzes" on public.quizzes;
drop policy if exists "Authors update quizzes" on public.quizzes;
drop policy if exists "Authors delete quizzes" on public.quizzes;
create policy "Authors insert quizzes" on public.quizzes for insert to authenticated
with check (public.can_manage_lesson_write(lesson_id));
create policy "Authors update quizzes" on public.quizzes for update to authenticated
using (public.can_manage_lesson_write(lesson_id)) with check (public.can_manage_lesson_write(lesson_id));
create policy "Authors delete quizzes" on public.quizzes for delete to authenticated
using (public.can_manage_lesson_write(lesson_id));

drop policy if exists "Authors insert quiz questions" on public.quiz_questions;
drop policy if exists "Authors update quiz questions" on public.quiz_questions;
drop policy if exists "Authors delete quiz questions" on public.quiz_questions;
create policy "Authors insert quiz questions" on public.quiz_questions for insert to authenticated
with check (public.can_manage_quiz_write(quiz_id));
create policy "Authors update quiz questions" on public.quiz_questions for update to authenticated
using (public.can_manage_quiz_write(quiz_id)) with check (public.can_manage_quiz_write(quiz_id));
create policy "Authors delete quiz questions" on public.quiz_questions for delete to authenticated
using (public.can_manage_quiz_write(quiz_id));

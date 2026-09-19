-- Avoid chaining through STABLE ownership helpers while an atomic course draft
-- is still being created. Direct VOLATILE checks can see rows written by prior
-- commands in save_course_draft.
create or replace function public.can_manage_module(p_module_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.modules m
    join public.courses c on c.id = m.course_id
    join public.profiles p on p.id = c.author_id
    where m.id = p_module_id
      and c.author_id = (select auth.uid())
      and p.role = 'teacher'
  );
$$;

create or replace function public.can_manage_lesson_write(p_lesson_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.lessons l
    join public.modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    join public.profiles p on p.id = c.author_id
    where l.id = p_lesson_id
      and c.author_id = (select auth.uid())
      and p.role = 'teacher'
  );
$$;

create or replace function public.can_manage_quiz_write(p_quiz_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1
    from public.quizzes q
    join public.lessons l on l.id = q.lesson_id
    join public.modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    join public.profiles p on p.id = c.author_id
    where q.id = p_quiz_id
      and c.author_id = (select auth.uid())
      and p.role = 'teacher'
  );
$$;

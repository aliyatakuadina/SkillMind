-- Lesson write policies must verify the parent module without being filtered by
-- the module's own SELECT RLS policy. The helper exposes only a boolean and
-- delegates course ownership/admin checks to is_course_author.
create or replace function public.can_manage_module(p_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_course_author(m.course_id)
  from public.modules m
  where m.id = p_module_id;
$$;

revoke all on function public.can_manage_module(uuid) from public, anon;
grant execute on function public.can_manage_module(uuid) to authenticated;

drop policy if exists "Authors insert lessons" on public.lessons;
drop policy if exists "Authors update lessons" on public.lessons;
drop policy if exists "Authors delete lessons" on public.lessons;

create policy "Authors insert lessons"
on public.lessons for insert to authenticated
with check (public.can_manage_module(module_id));

create policy "Authors update lessons"
on public.lessons for update to authenticated
using (public.can_manage_module(module_id))
with check (public.can_manage_module(module_id));

create policy "Authors delete lessons"
on public.lessons for delete to authenticated
using (public.can_manage_module(module_id));

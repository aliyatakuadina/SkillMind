-- INSERT ... RETURNING also evaluates the SELECT policy. A STABLE helper that
-- queries courses cannot see the row inserted by the current command snapshot,
-- so compare the row's author directly for owned-course visibility.
alter policy "Published and owned courses are visible to users" on public.courses
  using (
    status = 'published'
    or author_id = (select auth.uid())
    or public.is_admin()
  );

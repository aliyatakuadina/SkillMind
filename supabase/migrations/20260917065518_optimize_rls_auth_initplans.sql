-- Cache the authenticated user id once per statement instead of once per row.
-- This keeps the existing access rules while avoiding RLS init-plan warnings.

alter policy "Profiles are visible to their owner or admins" on public.profiles
  using (id = (select auth.uid()) or public.is_admin());

alter policy "Profiles are editable by their owner or admins" on public.profiles
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

alter policy "Teachers can create draft courses" on public.courses
  with check (author_id = (select auth.uid()) and status = 'draft' and public.is_teacher());

alter policy "Students and course staff can see enrollments" on public.enrollments
  using (user_id = (select auth.uid()) or public.is_course_author(course_id));

alter policy "Students enroll themselves in published courses" on public.enrollments
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.courses c
      where c.id = enrollments.course_id and c.status = 'published'
    )
  );

alter policy "Students update their own enrollment" on public.enrollments
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "Students leave their own course" on public.enrollments
  using (user_id = (select auth.uid()) or public.is_admin());

alter policy "Students and course staff can see progress" on public.user_progress
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.lessons l
      join public.modules m on m.id = l.module_id
      where l.id = user_progress.lesson_id and public.is_course_author(m.course_id)
    )
  );

alter policy "Students create their own progress" on public.user_progress
  with check (user_id = (select auth.uid()) and public.can_access_lesson(lesson_id));

alter policy "Students update their own progress" on public.user_progress
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.can_access_lesson(lesson_id));

alter policy "Students and reviewers can see submissions" on public.assignment_submissions
  using (user_id = (select auth.uid()) or public.is_submission_reviewer(id));

alter policy "Students create their own submissions" on public.assignment_submissions
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.assignments a
      where a.id = assignment_submissions.assignment_id
        and public.can_access_lesson(a.lesson_id)
    )
  );

alter policy "Students and reviewers update submissions" on public.assignment_submissions
  using (user_id = (select auth.uid()) or public.is_submission_reviewer(id))
  with check (user_id = (select auth.uid()) or public.is_submission_reviewer(id));

alter policy "Students can remove draft submissions" on public.assignment_submissions
  using (user_id = (select auth.uid()) and status = 'draft');

alter policy "Students and reviewers can see submission files" on public.submission_files
  using (
    exists (
      select 1 from public.assignment_submissions s
      where s.id = submission_files.submission_id
        and (s.user_id = (select auth.uid()) or public.is_submission_reviewer(s.id))
    )
  );

alter policy "Students attach files to their draft work" on public.submission_files
  with check (
    exists (
      select 1 from public.assignment_submissions s
      where s.id = submission_files.submission_id
        and s.user_id = (select auth.uid())
        and s.status in ('draft', 'returned')
    )
  );

alter policy "Students remove files from their draft work" on public.submission_files
  using (
    exists (
      select 1 from public.assignment_submissions s
      where s.id = submission_files.submission_id
        and s.user_id = (select auth.uid())
        and s.status in ('draft', 'returned')
    )
  );

alter policy "Students and staff see quiz attempts" on public.quiz_attempts
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.quizzes q
      where q.id = quiz_attempts.quiz_id and public.can_manage_lesson(q.lesson_id)
    )
  );

alter policy "Students and staff see quiz answers" on public.quiz_answers
  using (
    exists (
      select 1 from public.quiz_attempts a
      where a.id = quiz_answers.attempt_id
        and (
          a.user_id = (select auth.uid())
          or exists (
            select 1 from public.quizzes q
            where q.id = a.quiz_id and public.can_manage_lesson(q.lesson_id)
          )
        )
    )
  );

alter policy "Students and course staff see certificates" on public.certificates
  using (user_id = (select auth.uid()) or public.is_course_author(course_id));

alter policy "Students log their own learning events" on public.learning_events
  with check (user_id = (select auth.uid()) and public.can_access_course(course_id));

alter policy "Students and staff see learning events" on public.learning_events
  using (user_id = (select auth.uid()) or public.is_course_author(course_id));

alter policy "Admins record moderation decisions" on public.moderation_history
  with check (public.is_admin() and moderator_id = (select auth.uid()));

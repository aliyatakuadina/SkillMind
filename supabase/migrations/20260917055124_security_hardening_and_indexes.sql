-- Supabase may grant Data API roles function execution independently of the
-- PostgreSQL PUBLIC pseudo-role. Revoke anon explicitly for every privileged
-- function except the intentionally public certificate verifier.
revoke execute on function public.create_profile_for_new_user() from anon, authenticated;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.is_teacher() from anon;
revoke execute on function public.is_course_author(uuid) from anon;
revoke execute on function public.can_access_course(uuid) from anon;
revoke execute on function public.can_access_lesson(uuid) from anon;
revoke execute on function public.can_manage_lesson(uuid) from anon;
revoke execute on function public.is_submission_reviewer(uuid) from anon;
revoke execute on function public.get_quiz_questions(uuid) from anon;
revoke execute on function public.start_quiz_attempt(uuid) from anon;
revoke execute on function public.submit_quiz_attempt(uuid, jsonb) from anon;
revoke execute on function public.issue_certificate_if_eligible(uuid) from anon;
revoke execute on function public.admin_list_users() from anon;
revoke execute on function public.admin_set_user_role(uuid, public.user_role) from anon;
revoke execute on function public.moderate_course(uuid, boolean, text) from anon;
revoke execute on function public.get_course_analytics(uuid) from anon;

create index if not exists assignment_submissions_reviewed_by_idx
  on public.assignment_submissions(reviewed_by);
create index if not exists certificates_course_id_idx
  on public.certificates(course_id);
create index if not exists learning_events_lesson_id_idx
  on public.learning_events(lesson_id);
create index if not exists user_progress_lesson_id_idx
  on public.user_progress(lesson_id);

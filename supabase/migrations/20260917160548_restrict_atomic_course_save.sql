revoke execute on function public.save_course_draft(uuid, text, text, text, text, text, jsonb, boolean)
from public, anon;

grant execute on function public.save_course_draft(uuid, text, text, text, text, text, jsonb, boolean)
to authenticated;

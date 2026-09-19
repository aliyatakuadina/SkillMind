-- Keep answer keys out of student-readable lesson_items payloads and persist
-- every supported quiz question type in the dedicated protected tables.
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
  v_question_type public.quiz_question_type;
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
        case
          when v_item_type = 'quiz'
            then coalesce(v_lesson -> 'payload', '{}'::jsonb) - 'questions'
          else coalesce(v_lesson -> 'payload', '{}'::jsonb)
        end,
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
          v_question_type := case v_question ->> 'type'
            when 'multiple_choice' then 'multiple_choice'::public.quiz_question_type
            when 'matching' then 'matching'::public.quiz_question_type
            else 'single_choice'::public.quiz_question_type
          end;

          insert into public.quiz_questions (quiz_id, type, prompt, options, answer_key, points, order_index)
          values (
            v_quiz_id,
            v_question_type,
            trim(v_question ->> 'prompt'),
            coalesce(v_question -> 'public_options', v_question -> 'options', '[]'::jsonb),
            case
              when v_question ? 'answer_key' then v_question -> 'answer_key'
              when v_question_type = 'multiple_choice' then coalesce(v_question -> 'correct_options', '[]'::jsonb)
              else to_jsonb(coalesce((v_question ->> 'correct_option')::integer, 0))
            end,
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

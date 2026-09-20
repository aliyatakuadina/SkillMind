-- Keep identity and learning history while editing a course. All tree writes
-- go through an authorized, version-checked transaction.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter table public.courses add column content_revision integer not null default 1 check (content_revision > 0);
alter table public.lessons add column content_revision integer not null default 1 check (content_revision > 0);

-- Reordering must not delete rows or temporarily violate nonnegative indexes.
alter table public.modules drop constraint modules_course_id_order_index_key;
alter table public.modules add constraint modules_course_id_order_index_key unique (course_id, order_index) deferrable initially immediate;
alter table public.lessons drop constraint lessons_module_id_order_index_key;
alter table public.lessons add constraint lessons_module_id_order_index_key unique (module_id, order_index) deferrable initially immediate;
alter table public.quiz_questions drop constraint quiz_questions_quiz_id_order_index_key;
alter table public.quiz_questions add constraint quiz_questions_quiz_id_order_index_key unique (quiz_id, order_index) deferrable initially immediate;

create function private.bump_course_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.content_revision := old.content_revision + 1;
  return new;
end;
$$;
revoke all on function private.bump_course_revision() from public, anon, authenticated;
create trigger courses_bump_revision before update on public.courses
for each row execute function private.bump_course_revision();

-- A canonical snapshot excludes timestamps and lesson position. Changing the
-- order of lessons does not invalidate an otherwise identical AI source.
create function private.lesson_content_snapshot(p_lesson_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'lesson', to_jsonb(l) - array['created_at', 'updated_at', 'content_revision', 'module_id', 'order_index'],
    'items', coalesce((select jsonb_agg(to_jsonb(i) - array['created_at', 'updated_at'] order by i.order_index)
      from public.lesson_items i where i.lesson_id = l.id), '[]'::jsonb),
    'quiz', (select to_jsonb(q) - array['created_at', 'updated_at'] from public.quizzes q where q.lesson_id = l.id),
    'questions', coalesce((select jsonb_agg(to_jsonb(q) - array['created_at', 'updated_at'] order by q.order_index)
      from public.quiz_questions q join public.quizzes z on z.id = q.quiz_id where z.lesson_id = l.id), '[]'::jsonb),
    'assignment', (select to_jsonb(a) - array['created_at', 'updated_at'] from public.assignments a where a.lesson_id = l.id)
  ) from public.lessons l where l.id = p_lesson_id;
$$;
revoke all on function private.lesson_content_snapshot(uuid) from public, anon, authenticated;

create function private.save_course_draft_versioned(
  p_course_id uuid, p_expected_revision integer, p_title text, p_slug text,
  p_description text, p_category text, p_estimated_duration text,
  p_modules jsonb, p_submit boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_course_id uuid := p_course_id;
  v_user_id uuid := (select auth.uid());
  v_course public.courses%rowtype;
  v_module jsonb; v_lesson jsonb; v_question jsonb;
  v_module_id uuid; v_lesson_id uuid; v_item_id uuid; v_quiz_id uuid; v_question_id uuid;
  v_owner_id uuid;
  v_module_index integer := 0; v_lesson_index integer; v_question_index integer;
  v_module_ids uuid[] := '{}'; v_lesson_ids uuid[] := '{}'; v_question_ids uuid[];
  v_item_type public.lesson_item_type; v_question_type public.quiz_question_type;
  v_payload jsonb; v_options jsonb; v_answer jsonb;
  v_before jsonb; v_after jsonb;
  v_revision integer;
begin
  if v_user_id is null or not (select public.is_teacher()) then
    raise exception 'Only teachers and administrators can save courses';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 3 and 160 then
    raise exception 'Course title must contain between 3 and 160 characters';
  end if;
  if p_modules is null or jsonb_typeof(p_modules) is distinct from 'array' or jsonb_array_length(p_modules) = 0 then
    raise exception 'A course must contain at least one module';
  end if;

  if v_course_id is null then
    if p_expected_revision is distinct from 0 then
      raise exception using errcode = 'PT409', message = 'COURSE_REVISION_CONFLICT';
    end if;
    insert into public.courses (slug, title, description, category, estimated_duration, author_id, status)
    values (p_slug, trim(p_title), coalesce(p_description, ''), nullif(trim(p_category), ''),
      coalesce(p_estimated_duration, ''), v_user_id, 'draft') returning id into v_course_id;
  else
    select c.* into v_course from public.courses c where c.id = v_course_id for update;
    if not found or (not (select public.is_admin()) and
      (v_course.author_id is distinct from v_user_id or v_course.status not in ('draft', 'changes_requested'))) then
      raise exception 'Course not found or cannot be edited';
    end if;
    if p_expected_revision is distinct from v_course.content_revision then
      raise exception using errcode = 'PT409', message = 'COURSE_REVISION_CONFLICT';
    end if;
  end if;

  -- Lock FK parents before checking history, including rows omitted by the
  -- submitted tree. A concurrent progress/attempt/submission insert must finish
  -- before our checks or wait until this edit commits; it cannot be cascaded
  -- away between the check and delete. Use a consistent parent-first order.
  perform l.id from public.lessons l join public.modules m on m.id = l.module_id
    where m.course_id = v_course_id order by l.id for update of l;
  perform q.id from public.quizzes q join public.lessons l on l.id = q.lesson_id
    join public.modules m on m.id = l.module_id
    where m.course_id = v_course_id order by q.id for update of q;
  perform a.id from public.assignments a join public.lessons l on l.id = a.lesson_id
    join public.modules m on m.id = l.module_id
    where m.course_id = v_course_id order by a.id for update of a;

  set constraints public.modules_course_id_order_index_key,
    public.lessons_module_id_order_index_key, public.quiz_questions_quiz_id_order_index_key deferred;

  for v_module in select value from jsonb_array_elements(p_modules) loop
    v_module_id := coalesce(nullif(v_module ->> 'id', '')::uuid, gen_random_uuid());
    if v_module_id = any(v_module_ids) then raise exception 'Duplicate module identifier'; end if;
    v_module_ids := array_append(v_module_ids, v_module_id);
    select m.course_id into v_owner_id from public.modules m where m.id = v_module_id for update;
    if found then
      if v_owner_id is distinct from v_course_id then raise exception 'Module does not belong to this course'; end if;
      update public.modules m set title = trim(v_module ->> 'title'), order_index = v_module_index
      where m.id = v_module_id and (m.title, m.order_index) is distinct from (trim(v_module ->> 'title'), v_module_index);
    else
      insert into public.modules (id, course_id, title, order_index)
      values (v_module_id, v_course_id, trim(v_module ->> 'title'), v_module_index);
    end if;
    v_module_index := v_module_index + 1;
    v_lesson_index := 0;

    for v_lesson in select value from jsonb_array_elements(coalesce(v_module -> 'lessons', '[]'::jsonb)) loop
      v_lesson_id := coalesce(nullif(v_lesson ->> 'id', '')::uuid, gen_random_uuid());
      if v_lesson_id = any(v_lesson_ids) then raise exception 'Duplicate lesson identifier'; end if;
      v_lesson_ids := array_append(v_lesson_ids, v_lesson_id);
      select m.course_id into v_owner_id from public.lessons l join public.modules m on m.id = l.module_id
      where l.id = v_lesson_id for update of l;
      if found then
        if v_owner_id is distinct from v_course_id then raise exception 'Lesson does not belong to this course'; end if;
        v_before := private.lesson_content_snapshot(v_lesson_id);
        update public.lessons l set module_id = v_module_id, title = trim(v_lesson ->> 'title'),
          description = coalesce(v_lesson ->> 'description', ''), order_index = v_lesson_index,
          is_required = coalesce((v_lesson ->> 'is_required')::boolean, true)
        where l.id = v_lesson_id and (l.module_id, l.title, l.description, l.order_index, l.is_required)
          is distinct from (v_module_id, trim(v_lesson ->> 'title'), coalesce(v_lesson ->> 'description', ''),
            v_lesson_index, coalesce((v_lesson ->> 'is_required')::boolean, true));
      else
        v_before := null;
        insert into public.lessons (id, module_id, title, description, order_index, is_required)
        values (v_lesson_id, v_module_id, trim(v_lesson ->> 'title'), coalesce(v_lesson ->> 'description', ''),
          v_lesson_index, coalesce((v_lesson ->> 'is_required')::boolean, true));
      end if;
      v_lesson_index := v_lesson_index + 1;
      if coalesce(v_lesson ->> 'type', '') not in ('text', 'video', 'pdf', 'document', 'quiz', 'homework') then
        raise exception 'Unsupported lesson type';
      end if;
      v_item_type := case v_lesson ->> 'type'
        when 'text' then 'rich_text' when 'homework' then 'assignment'
        else v_lesson ->> 'type' end::public.lesson_item_type;
      v_payload := coalesce(v_lesson -> 'payload', '{}'::jsonb);
      if jsonb_typeof(v_payload) is distinct from 'object' then raise exception 'Invalid lesson payload'; end if;
      -- Never copy author-only answer keys into student-readable content.
      v_payload := v_payload - array['questions', 'answer_key', 'correct_options', 'correct_option'];
      select i.id into v_item_id from public.lesson_items i where i.lesson_id = v_lesson_id and i.order_index = 0;
      if nullif(v_lesson ->> 'item_id', '') is not null and v_item_id is distinct from (v_lesson ->> 'item_id')::uuid then
        raise exception 'Content item does not belong to this lesson';
      end if;
      if v_item_id is null then
        insert into public.lesson_items (lesson_id, type, payload, order_index)
        values (v_lesson_id, v_item_type, v_payload, 0);
      else
        update public.lesson_items i set type = v_item_type, payload = v_payload
        where i.id = v_item_id and (i.type, i.payload) is distinct from (v_item_type, v_payload);
      end if;

      if v_item_type <> 'quiz' then
        if exists (select 1 from public.quiz_attempts a join public.quizzes q on q.id = a.quiz_id where q.lesson_id = v_lesson_id) then
          raise exception using errcode = 'PT409', message = 'COURSE_ASSESSMENT_HAS_ATTEMPTS';
        end if;
        delete from public.quizzes q where q.lesson_id = v_lesson_id;
      end if;
      if v_item_type <> 'assignment' then
        if exists (select 1 from public.assignment_submissions s join public.assignments a on a.id = s.assignment_id where a.lesson_id = v_lesson_id) then
          raise exception using errcode = 'PT409', message = 'COURSE_ASSIGNMENT_HAS_SUBMISSIONS';
        end if;
        delete from public.assignments a where a.lesson_id = v_lesson_id;
      end if;

      if v_item_type = 'quiz' then
        select q.id into v_quiz_id from public.quizzes q where q.lesson_id = v_lesson_id;
        if v_quiz_id is null then
          insert into public.quizzes (lesson_id, title, passing_score, attempt_limit, is_required)
          values (v_lesson_id, trim(v_lesson ->> 'title'), coalesce((v_payload ->> 'passing_score')::numeric, 70),
            nullif(v_payload ->> 'attempt_limit', '')::smallint, coalesce((v_payload ->> 'is_required')::boolean, true))
          returning id into v_quiz_id;
        else
          update public.quizzes q set title = trim(v_lesson ->> 'title'),
            passing_score = coalesce((v_payload ->> 'passing_score')::numeric, 70),
            attempt_limit = nullif(v_payload ->> 'attempt_limit', '')::smallint,
            is_required = coalesce((v_payload ->> 'is_required')::boolean, true)
          where q.id = v_quiz_id and (q.title, q.passing_score, q.attempt_limit, q.is_required) is distinct from
            (trim(v_lesson ->> 'title'), coalesce((v_payload ->> 'passing_score')::numeric, 70),
            nullif(v_payload ->> 'attempt_limit', '')::smallint, coalesce((v_payload ->> 'is_required')::boolean, true));
        end if;
        v_question_ids := '{}'; v_question_index := 0;
        for v_question in select value from jsonb_array_elements(coalesce(v_lesson #> '{payload,questions}', '[]'::jsonb)) loop
          v_question_id := coalesce(nullif(v_question ->> 'id', '')::uuid, gen_random_uuid());
          if v_question_id = any(v_question_ids) then raise exception 'Duplicate question identifier'; end if;
          v_question_ids := array_append(v_question_ids, v_question_id);
          v_question_type := coalesce(v_question ->> 'type', 'single_choice')::public.quiz_question_type;
          v_options := coalesce(v_question -> 'public_options', v_question -> 'options', '[]'::jsonb);
          v_answer := case when v_question ? 'answer_key' then v_question -> 'answer_key'
            when v_question_type = 'multiple_choice' then coalesce(v_question -> 'correct_options', '[]'::jsonb)
            else to_jsonb(coalesce((v_question ->> 'correct_option')::integer, 0)) end;
          select q.quiz_id into v_owner_id from public.quiz_questions q where q.id = v_question_id for update;
          if found then
            if v_owner_id is distinct from v_quiz_id then raise exception 'Question does not belong to this quiz'; end if;
            update public.quiz_questions q set type = v_question_type, prompt = trim(v_question ->> 'prompt'),
              options = v_options, answer_key = v_answer, points = coalesce((v_question ->> 'points')::numeric, 1), order_index = v_question_index
            where q.id = v_question_id and (q.type, q.prompt, q.options, q.answer_key, q.points, q.order_index) is distinct from
              (v_question_type, trim(v_question ->> 'prompt'), v_options, v_answer, coalesce((v_question ->> 'points')::numeric, 1), v_question_index);
          else
            insert into public.quiz_questions (id, quiz_id, type, prompt, options, answer_key, points, order_index)
            values (v_question_id, v_quiz_id, v_question_type, trim(v_question ->> 'prompt'), v_options, v_answer,
              coalesce((v_question ->> 'points')::numeric, 1), v_question_index);
          end if;
          v_question_index := v_question_index + 1;
        end loop;
        delete from public.quiz_questions q where q.quiz_id = v_quiz_id and not (q.id = any(v_question_ids));
      elsif v_item_type = 'assignment' then
        insert into public.assignments as a (lesson_id, instructions, max_files, max_file_size_bytes, allowed_mime_types)
        values (v_lesson_id, coalesce(v_lesson ->> 'description', ''), coalesce((v_payload ->> 'max_files')::smallint, 3),
          coalesce((v_payload ->> 'max_file_size_bytes')::integer, 10485760),
          case when jsonb_typeof(v_payload -> 'allowed_mime_types') = 'array'
            then array(select jsonb_array_elements_text(v_payload -> 'allowed_mime_types'))
            else array['application/pdf', 'image/jpeg', 'image/png', 'text/plain'] end)
        on conflict (lesson_id) do update set instructions = excluded.instructions, max_files = excluded.max_files,
          max_file_size_bytes = excluded.max_file_size_bytes, allowed_mime_types = excluded.allowed_mime_types
        where (a.instructions, a.max_files, a.max_file_size_bytes, a.allowed_mime_types) is distinct from
          (excluded.instructions, excluded.max_files, excluded.max_file_size_bytes, excluded.allowed_mime_types);
      end if;

      if v_before is not null then
        v_after := private.lesson_content_snapshot(v_lesson_id);
        if ((v_before -> 'quiz') is distinct from (v_after -> 'quiz') or
            (v_before -> 'questions') is distinct from (v_after -> 'questions')) and
          exists (select 1 from public.quiz_attempts a join public.quizzes q on q.id = a.quiz_id where q.lesson_id = v_lesson_id) then
          raise exception using errcode = 'PT409', message = 'COURSE_ASSESSMENT_HAS_ATTEMPTS';
        end if;
        if v_before is distinct from v_after then
          update public.lessons l set content_revision = l.content_revision + 1 where l.id = v_lesson_id;
        end if;
      end if;
    end loop;
  end loop;

  if exists (select 1 from public.lessons l join public.modules m on m.id = l.module_id
    where m.course_id = v_course_id and not (l.id = any(v_lesson_ids)) and (
      exists (select 1 from public.user_progress p where p.lesson_id = l.id) or
      exists (select 1 from public.quiz_attempts a join public.quizzes q on q.id = a.quiz_id where q.lesson_id = l.id) or
      exists (select 1 from public.assignment_submissions s join public.assignments a on a.id = s.assignment_id where a.lesson_id = l.id)
    )) then
    raise exception using errcode = 'PT409', message = 'COURSE_LESSON_HAS_ACTIVITY';
  end if;
  delete from public.lessons l using public.modules m
    where l.module_id = m.id and m.course_id = v_course_id and not (l.id = any(v_lesson_ids));
  delete from public.modules m where m.course_id = v_course_id and not (m.id = any(v_module_ids));

  update public.courses c set slug = p_slug, title = trim(p_title), description = coalesce(p_description, ''),
    category = nullif(trim(p_category), ''), estimated_duration = coalesce(p_estimated_duration, ''),
    status = case when coalesce(p_submit, false) then 'pending_review'::public.course_status else 'draft'::public.course_status end
  where c.id = v_course_id returning c.content_revision into v_revision;
  set constraints public.modules_course_id_order_index_key,
    public.lessons_module_id_order_index_key, public.quiz_questions_quiz_id_order_index_key immediate;
  return jsonb_build_object('course_id', v_course_id, 'content_revision', v_revision);
end;
$$;
revoke all on function private.save_course_draft_versioned(uuid, integer, text, text, text, text, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function private.save_course_draft_versioned(uuid, integer, text, text, text, text, text, jsonb, boolean) to authenticated;

create function public.save_course_draft_v2(
  p_course_id uuid, p_expected_revision integer, p_title text, p_slug text,
  p_description text, p_category text, p_estimated_duration text, p_modules jsonb, p_submit boolean
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_course_draft_versioned(p_course_id, p_expected_revision, p_title, p_slug,
    p_description, p_category, p_estimated_duration, p_modules, p_submit);
$$;
revoke all on function public.save_course_draft_v2(uuid, integer, text, text, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.save_course_draft_v2(uuid, integer, text, text, text, text, text, jsonb, boolean) to authenticated;

-- Old clients may create a course, but cannot overwrite a versioned tree using
-- a payload that omits identities and the expected revision.
create or replace function public.save_course_draft(
  p_course_id uuid, p_title text, p_slug text, p_description text,
  p_category text, p_estimated_duration text, p_modules jsonb, p_submit boolean
)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  if p_course_id is not null then
    raise exception using errcode = 'PT409', message = 'COURSE_EDITOR_UPDATE_REQUIRED';
  end if;
  return (private.save_course_draft_versioned(null, 0, p_title, p_slug, p_description,
    p_category, p_estimated_duration, p_modules, p_submit) ->> 'course_id')::uuid;
end;
$$;
revoke all on function public.save_course_draft(uuid, text, text, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.save_course_draft(uuid, text, text, text, text, text, jsonb, boolean) to authenticated;

-- Tree changes must use the revision-checked API. Read policies remain intact.
revoke insert, update, delete on public.modules, public.lessons, public.lesson_items,
  public.quizzes, public.quiz_questions, public.assignments from authenticated;

-- SkillMind LMS: базовая модель данных, права доступа и приватное хранилище.

create extension if not exists pgcrypto;

create type public.user_role as enum ('student', 'teacher', 'admin');
create type public.course_status as enum ('draft', 'pending_review', 'published', 'changes_requested', 'archived');
create type public.lesson_item_type as enum ('rich_text', 'video', 'pdf', 'document', 'quiz', 'assignment');
create type public.assignment_status as enum ('draft', 'submitted', 'returned', 'graded');
create type public.quiz_question_type as enum ('single_choice', 'multiple_choice', 'matching');
create type public.quiz_attempt_status as enum ('in_progress', 'submitted', 'graded');
create type public.learning_event_type as enum ('lesson_opened', 'lesson_completed', 'video_progress', 'quiz_started', 'quiz_submitted', 'assignment_submitted');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'student',
  full_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  cover_url text,
  category text,
  author_id uuid not null references public.profiles(id) on delete restrict,
  status public.course_status not null default 'draft',
  moderation_comment text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  order_index integer not null check (order_index >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, order_index)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  order_index integer not null check (order_index >= 0),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_id, order_index)
);

create table public.lesson_items (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  type public.lesson_item_type not null,
  payload jsonb not null default '{}'::jsonb,
  order_index integer not null check (order_index >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, order_index)
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  last_opened_at timestamptz,
  unique (user_id, course_id)
);

create table public.user_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  is_completed boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id),
  check ((is_completed and completed_at is not null) or (not is_completed))
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.lessons(id) on delete cascade,
  instructions text not null default '',
  max_files smallint not null default 3 check (max_files between 0 and 10),
  max_file_size_bytes integer not null default 10485760 check (max_file_size_bytes > 0),
  allowed_mime_types text[] not null default array['application/pdf', 'image/jpeg', 'image/png', 'text/plain'],
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  text_answer text not null default '',
  status public.assignment_status not null default 'draft',
  grade numeric(5,2) check (grade between 0 and 100),
  feedback text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (assignment_id, user_id),
  check ((status in ('submitted', 'returned', 'graded') and submitted_at is not null) or status = 'draft')
);

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.assignment_submissions(id) on delete cascade,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  created_at timestamptz not null default now()
);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.lessons(id) on delete cascade,
  title text not null,
  passing_score numeric(5,2) not null default 70 check (passing_score between 0 and 100),
  attempt_limit smallint check (attempt_limit between 1 and 20),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  type public.quiz_question_type not null,
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  answer_key jsonb not null default '{}'::jsonb,
  points numeric(6,2) not null default 1 check (points > 0),
  order_index integer not null check (order_index >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id, order_index)
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  attempt_number smallint not null check (attempt_number > 0),
  score numeric(5,2) check (score between 0 and 100),
  status public.quiz_attempt_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (quiz_id, user_id, attempt_number),
  check ((status in ('submitted', 'graded') and submitted_at is not null) or status = 'in_progress')
);

create table public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  answer jsonb not null default '{}'::jsonb,
  is_correct boolean not null default false,
  awarded_points numeric(6,2) not null default 0 check (awarded_points >= 0),
  unique (attempt_id, question_id)
);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,
  certificate_number text not null unique,
  verification_token uuid not null default gen_random_uuid() unique,
  issued_at timestamptz not null default now(),
  pdf_path text,
  unique (user_id, course_id)
);

create table public.learning_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  event_type public.learning_event_type not null,
  duration_seconds integer check (duration_seconds >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.moderation_history (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  moderator_id uuid not null references public.profiles(id) on delete restrict,
  status public.course_status not null,
  comment text,
  created_at timestamptz not null default now()
);

create index courses_author_id_idx on public.courses(author_id);
create index courses_status_idx on public.courses(status);
create index modules_course_id_idx on public.modules(course_id);
create index lessons_module_id_idx on public.lessons(module_id);
create index lesson_items_lesson_id_idx on public.lesson_items(lesson_id);
create index enrollments_course_id_idx on public.enrollments(course_id);
create index user_progress_user_id_idx on public.user_progress(user_id);
create index submissions_assignment_id_idx on public.assignment_submissions(assignment_id);
create index quiz_attempts_user_id_idx on public.quiz_attempts(user_id);
create index learning_events_course_created_idx on public.learning_events(course_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1), 'Новый пользователь')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger courses_set_updated_at before update on public.courses for each row execute procedure public.set_updated_at();
create trigger modules_set_updated_at before update on public.modules for each row execute procedure public.set_updated_at();
create trigger lessons_set_updated_at before update on public.lessons for each row execute procedure public.set_updated_at();
create trigger lesson_items_set_updated_at before update on public.lesson_items for each row execute procedure public.set_updated_at();
create trigger user_progress_set_updated_at before update on public.user_progress for each row execute procedure public.set_updated_at();
create trigger assignments_set_updated_at before update on public.assignments for each row execute procedure public.set_updated_at();
create trigger submissions_set_updated_at before update on public.assignment_submissions for each row execute procedure public.set_updated_at();
create trigger quizzes_set_updated_at before update on public.quizzes for each row execute procedure public.set_updated_at();
create trigger quiz_questions_set_updated_at before update on public.quiz_questions for each row execute procedure public.set_updated_at();

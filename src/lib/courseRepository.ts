import { supabase } from './supabase'
import type { LessonType } from '../types'
import type { Json } from '../types/database'
import { t } from '../i18n'

export interface CourseDraftLesson {
  id: string
  title: string
  description: string
  type: LessonType
  duration: string
  content: string
  resourceUrl: string
  sourceUrl: string
  isRequired: boolean
  passingScore: number
  attemptLimit: number | null
  questions: QuizQuestionDraft[]
  maxFiles: number
  maxFileSizeBytes: number
}

export interface QuizQuestionDraft {
  id: string
  type: QuizQuestionType
  prompt: string
  options: string[]
  correctOptions: number[]
  pairs: QuizMatchingPair[]
  points: number
}

export type QuizQuestionType = 'single_choice' | 'multiple_choice' | 'matching'

export interface QuizMatchingPair {
  left: string
  right: string
}

export interface CourseDraftModule {
  id: string
  title: string
  lessons: CourseDraftLesson[]
}

export interface CourseDraft {
  id?: string
  slug?: string
  title: string
  description: string
  category: string
  duration: string
  modules: CourseDraftModule[]
}

export interface TeacherCourseSummary {
  id: string
  title: string
  category: string | null
  status: 'draft' | 'pending_review' | 'published' | 'changes_requested' | 'archived'
  estimatedDuration: string
  lessonCount: number
  studentCount: number
}

function requireClient() {
  if (!supabase) throw new Error(t('common.supabaseMissing'))
  return supabase
}

export async function listTeacherCourses(): Promise<TeacherCourseSummary[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('courses')
    .select('id,title,category,status,estimated_duration,modules(lessons(id)),enrollments(count)')
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((course) => ({
    id: course.id,
    title: course.title,
    category: course.category,
    status: course.status,
    estimatedDuration: course.estimated_duration,
    lessonCount: course.modules.reduce((total, module) => total + module.lessons.length, 0),
    studentCount: course.enrollments[0]?.count ?? 0,
  }))
}

export async function getCourseDraft(courseId: string): Promise<CourseDraft> {
  const client = requireClient()
  const { data, error } = await client
    .from('courses')
    .select('id,slug,title,description,category,estimated_duration,modules(id,title,order_index,lessons(id,title,description,order_index,is_required,lesson_items(type,payload,order_index),quizzes(passing_score,attempt_limit,quiz_questions(id,type,prompt,options,answer_key,points,order_index))))')
    .eq('id', courseId)
    .single()

  if (error) throw error
  const orderedModules = [...data.modules].sort((a, b) => a.order_index - b.order_index)
  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    description: data.description,
    category: data.category ?? t('catalog.design'),
    duration: data.estimated_duration,
    modules: orderedModules.map((module) => ({
      id: module.id,
      title: module.title,
      lessons: [...module.lessons]
        .sort((a, b) => a.order_index - b.order_index)
        .map((lesson) => {
          const item = [...lesson.lesson_items].sort((a, b) => a.order_index - b.order_index)[0]
          const payload = (item?.payload ?? {}) as Record<string, unknown>
          const quiz = lesson.quizzes
          return {
            id: lesson.id,
            title: lesson.title,
            description: lesson.description,
            type: databaseTypeToLessonType(item?.type),
            duration: String(payload.duration ?? ''),
            content: String(payload.content ?? ''),
            resourceUrl: String(payload.url ?? ''),
            sourceUrl: String(payload.source_url ?? ''),
            isRequired: lesson.is_required,
            passingScore: Number(quiz?.passing_score ?? payload.passing_score ?? 70),
            attemptLimit: quiz?.attempt_limit ?? (payload.attempt_limit == null ? null : Number(payload.attempt_limit)),
            questions: [...(quiz?.quiz_questions ?? [])]
              .sort((a, b) => a.order_index - b.order_index)
              .map(questionFromDatabase),
            maxFiles: Number(payload.max_files ?? 3),
            maxFileSizeBytes: Number(payload.max_file_size_bytes ?? 10485760),
          }
        }),
    })),
  }
}

export async function saveCourseDraft(draft: CourseDraft, submit: boolean): Promise<string> {
  const client = requireClient()
  const slug = draft.slug || `${slugify(draft.title)}-${crypto.randomUUID().slice(0, 8)}`
  const modules = draft.modules.map((module, moduleIndex) => ({
    title: module.title,
    order_index: moduleIndex,
    lessons: module.lessons.map((lesson, lessonIndex) => ({
      title: lesson.title,
      description: lesson.description,
      order_index: lessonIndex,
      is_required: lesson.isRequired,
      type: lesson.type,
      payload: {
        duration: lesson.duration,
        content: lesson.content,
        url: lesson.resourceUrl,
        source_url: lesson.sourceUrl,
        passing_score: lesson.passingScore,
        attempt_limit: lesson.attemptLimit,
        is_required: lesson.isRequired,
        questions: lesson.questions.map((question, questionIndex) => serializeQuestion(question, questionIndex)),
        max_files: lesson.maxFiles,
        max_file_size_bytes: lesson.maxFileSizeBytes,
        allowed_mime_types: ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'],
      },
    })),
  }))

  const { data, error } = await client.rpc('save_course_draft', {
    // PostgreSQL parameters accept NULL even though generated RPC argument types
    // cannot express nullable function parameters.
    p_course_id: draft.id ?? (null as unknown as string),
    p_title: draft.title,
    p_slug: slug,
    p_description: draft.description,
    p_category: draft.category,
    p_estimated_duration: draft.duration,
    p_modules: modules as unknown as Json,
    p_submit: submit,
  })
  if (error) throw error
  return data as string
}

export async function uploadCourseAsset(courseId: string, file: File): Promise<string> {
  const client = requireClient()
  const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-')
  const storagePath = `${courseId}/${crypto.randomUUID()}-${safeName}`
  const { error } = await client.storage.from('course-assets').upload(storagePath, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw error
  return storagePath
}

export async function deleteCourse(courseId: string): Promise<void> {
  const client = requireClient()
  const { data: assets, error: listError } = await client.storage.from('course-assets').list(courseId)
  if (listError) throw listError
  if (assets.length > 0) {
    const paths = assets.map((asset) => `${courseId}/${asset.name}`)
    const { error: storageError } = await client.storage.from('course-assets').remove(paths)
    if (storageError) throw storageError
  }
  const { error } = await client.from('courses').delete().eq('id', courseId)
  if (error) throw error
}

function databaseTypeToLessonType(type?: string): LessonType {
  if (type === 'rich_text') return 'text'
  if (type === 'assignment') return 'homework'
  if (type === 'video' || type === 'pdf' || type === 'document' || type === 'quiz') return type
  return 'text'
}

function questionFromDatabase(question: {
  id: string
  type: QuizQuestionType
  prompt: string
  options: unknown
  answer_key: unknown
  points: number
}): QuizQuestionDraft {
  if (question.type === 'matching') {
    const optionGroups = isRecord(question.options) ? question.options : {}
    const left = Array.isArray(optionGroups.left) ? optionGroups.left.map(String) : []
    const right = Array.isArray(optionGroups.right) ? optionGroups.right.map(String) : []
    const mapping = Array.isArray(question.answer_key) ? question.answer_key.map(Number) : []
    return {
      id: question.id,
      type: 'matching',
      prompt: question.prompt,
      options: [],
      correctOptions: [],
      pairs: left.map((value, index) => ({ left: value, right: right[mapping[index]] ?? '' })),
      points: Number(question.points),
    }
  }

  const correctOptions = question.type === 'multiple_choice'
    ? Array.isArray(question.answer_key) ? question.answer_key.map(Number) : []
    : [Number(question.answer_key ?? 0)]
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    options: Array.isArray(question.options) ? question.options.map(String) : [],
    correctOptions,
    pairs: [],
    points: Number(question.points),
  }
}

function serializeQuestion(question: QuizQuestionDraft, orderIndex: number) {
  if (question.type === 'matching') {
    const right = question.pairs.map((pair) => pair.right).reverse()
    return {
      type: question.type,
      prompt: question.prompt,
      options: [],
      correct_options: [],
      pairs: question.pairs,
      public_options: { left: question.pairs.map((pair) => pair.left), right },
      answer_key: question.pairs.map((_, index) => question.pairs.length - 1 - index),
      points: question.points,
      order_index: orderIndex,
    }
  }

  const correctOptions = [...question.correctOptions].sort((a, b) => a - b)
  return {
    type: question.type,
    prompt: question.prompt,
    options: question.options,
    correct_options: correctOptions,
    pairs: [],
    public_options: question.options,
    answer_key: question.type === 'single_choice' ? (correctOptions[0] ?? 0) : correctOptions,
    points: question.points,
    order_index: orderIndex,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function slugify(value: string) {
  const result = value
    .toLocaleLowerCase('ru')
    .trim()
    .replace(/[^a-zа-яё0-9]+/giu, '-')
    .replace(/^-+|-+$/g, '')
  return result || 'course'
}

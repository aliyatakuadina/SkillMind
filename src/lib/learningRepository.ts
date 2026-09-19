import { supabase } from './supabase'
import type { Course, LessonType, Module } from '../types'
import { t } from '../i18n'

function requireClient() {
  if (!supabase) throw new Error(t('common.supabaseMissing'))
  return supabase
}

export async function listPublishedCourses(): Promise<Course[]> {
  const client = requireClient()
  const { data, error } = await client
    .from('courses')
    .select('id,title,description,category,estimated_duration,status,author:profiles!courses_author_id_fkey(full_name),modules(lessons(id)),enrollments(count)')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((course, index) => ({
    id: course.id,
    title: course.title,
    description: course.description,
    category: normalizeCategory(course.category),
    author: firstRelated(course.author)?.full_name ?? t('common.teacherSkillMind'),
    duration: course.estimated_duration || t('common.freePace'),
    lessonsCount: course.modules.reduce((sum, module) => sum + module.lessons.length, 0),
    accent: (['coral', 'blue', 'yellow'] as const)[index % 3],
    status: 'published',
    studentsCount: course.enrollments[0]?.count ?? 0,
    modules: [],
  }))
}

export async function getPublishedCourse(courseId: string): Promise<Course> {
  const client = requireClient()
  const { data, error } = await client
    .from('courses')
    .select('id,title,description,category,estimated_duration,status,author:profiles!courses_author_id_fkey(full_name),modules(id,title,order_index,lessons(id,title,description,order_index,is_required))')
    .eq('id', courseId)
    .eq('status', 'published')
    .single()
  if (error) throw error
  const modules: Module[] = [...data.modules]
    .sort((a, b) => a.order_index - b.order_index)
    .map((module) => ({
      id: module.id,
      title: module.title,
      lessons: [...module.lessons]
        .sort((a, b) => a.order_index - b.order_index)
        .map((lesson) => ({
          id: lesson.id,
          title: lesson.title,
          description: lesson.description,
          duration: '',
          type: 'text',
        })),
    }))
  return {
    id: data.id,
    title: data.title,
    description: data.description,
    category: normalizeCategory(data.category),
    author: firstRelated(data.author)?.full_name ?? t('common.teacherSkillMind'),
    duration: data.estimated_duration || t('common.freePace'),
    lessonsCount: modules.reduce((sum, module) => sum + module.lessons.length, 0),
    accent: 'blue', status: 'published', studentsCount: 0, modules,
  }
}

export async function enrollInCourse(courseId: string): Promise<void> {
  const client = requireClient()
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData.user) throw userError ?? new Error(t('common.authRequired'))
  const { error } = await client.from('enrollments').upsert(
    { course_id: courseId, user_id: userData.user.id, last_opened_at: new Date().toISOString() },
    { onConflict: 'user_id,course_id' },
  )
  if (error) throw error
}

export async function isEnrolled(courseId: string): Promise<boolean> {
  const client = requireClient()
  const { data, error } = await client.from('enrollments').select('id').eq('course_id', courseId).maybeSingle()
  if (error) throw error
  return Boolean(data)
}

export interface LearningCourse extends Course {
  completedLessonIds: string[]
}

export async function getLearningCourse(courseId: string): Promise<LearningCourse> {
  const client = requireClient()
  const { data, error } = await client
    .from('courses')
    .select('id,title,description,category,estimated_duration,status,author:profiles!courses_author_id_fkey(full_name),modules(id,title,order_index,lessons(id,title,description,order_index,is_required,lesson_items(type,payload,order_index)))')
    .eq('id', courseId)
    .single()
  if (error) throw error
  const modules: Module[] = [...data.modules].sort((a, b) => a.order_index - b.order_index).map((module) => ({
    id: module.id,
    title: module.title,
    lessons: [...module.lessons].sort((a, b) => a.order_index - b.order_index).map((lesson) => {
      const item = [...lesson.lesson_items].sort((a, b) => a.order_index - b.order_index)[0]
      const payload = (item?.payload ?? {}) as Record<string, unknown>
      return {
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        duration: String(payload.duration ?? ''),
        type: databaseTypeToLessonType(item?.type),
        content: String(payload.content ?? ''),
        videoUrl: String(payload.url ?? ''),
        sourceUrl: String(payload.source_url ?? ''),
      }
    }),
  }))
  const lessonIds = modules.flatMap((module) => module.lessons.map((lesson) => lesson.id))
  const { data: progress, error: progressError } = lessonIds.length
    ? await client.from('user_progress').select('lesson_id').in('lesson_id', lessonIds).eq('is_completed', true)
    : { data: [], error: null }
  if (progressError) throw progressError
  return {
    id: data.id, title: data.title, description: data.description,
    category: normalizeCategory(data.category), author: firstRelated(data.author)?.full_name ?? t('common.teacherSkillMind'),
    duration: data.estimated_duration || t('common.freePace'), lessonsCount: lessonIds.length,
    accent: 'blue', status: data.status === 'published' ? 'published' : 'draft', studentsCount: 0,
    modules, completedLessonIds: (progress ?? []).map((row) => row.lesson_id),
  }
}

export async function setLessonCompleted(lessonId: string, completed: boolean): Promise<void> {
  const client = requireClient()
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData.user) throw userError ?? new Error(t('common.authRequired'))
  const { error } = await client.from('user_progress').upsert(
    { user_id: userData.user.id, lesson_id: lessonId, is_completed: completed },
    { onConflict: 'user_id,lesson_id' },
  )
  if (error) throw error
}

export async function getCourseAssetUrl(pathOrUrl: string): Promise<string> {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const client = requireClient()
  const { data, error } = await client.storage.from('course-assets').createSignedUrl(pathOrUrl, 3600)
  if (error) throw error
  return data.signedUrl
}

export async function logLearningEvent(
  courseId: string,
  lessonId: string,
  eventType: 'lesson_opened' | 'lesson_completed',
): Promise<void> {
  const client = requireClient()
  const { data: userData } = await client.auth.getUser()
  if (!userData.user) return
  const { error } = await client.from('learning_events').insert({
    user_id: userData.user.id,
    course_id: courseId,
    lesson_id: lessonId,
    event_type: eventType,
  })
  if (error) throw error
}

export interface DashboardCourse {
  id: string
  title: string
  description: string
  category: string
  progressPercent: number
  completedCount: number
  lessonCount: number
  nextLessonId: string | null
  nextLessonTitle: string | null
}

export interface DashboardCertificate {
  id: string
  courseTitle: string
  certificateNumber: string
  issuedAt: string
}

export async function getDashboardData(): Promise<{
  fullName: string
  courses: DashboardCourse[]
  certificates: DashboardCertificate[]
}> {
  const client = requireClient()
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData.user) throw userError ?? new Error(t('common.authRequired'))
  const userId = userData.user.id
  const [profileResult, enrollmentResult, certificateResult, progressResult] = await Promise.all([
    client.from('profiles').select('full_name').eq('id', userId).single(),
    client.from('enrollments').select('course:courses(id,title,description,category,modules(order_index,lessons(id,title,order_index)))').eq('user_id', userId),
    client.from('certificates').select('id,certificate_number,issued_at,course:courses(title)').eq('user_id', userId).order('issued_at', { ascending: false }),
    client.from('user_progress').select('lesson_id').eq('user_id', userId).eq('is_completed', true),
  ])
  if (profileResult.error) throw profileResult.error
  if (enrollmentResult.error) throw enrollmentResult.error
  if (certificateResult.error) throw certificateResult.error
  if (progressResult.error) throw progressResult.error
  const completed = new Set((progressResult.data ?? []).map((row) => row.lesson_id))
  const courses = (enrollmentResult.data ?? []).flatMap((enrollment) => {
    const course = firstRelated(enrollment.course)
    if (!course) return []
    const lessons = [...course.modules]
      .sort((a, b) => a.order_index - b.order_index)
      .flatMap((module) => [...module.lessons].sort((a, b) => a.order_index - b.order_index))
    const completedCount = lessons.filter((lesson) => completed.has(lesson.id)).length
    const nextLesson = lessons.find((lesson) => !completed.has(lesson.id)) ?? lessons.at(-1) ?? null
    return [{
      id: course.id, title: course.title, description: course.description,
      category: course.category ?? t('common.uncategorized'),
      progressPercent: Math.round((completedCount / Math.max(lessons.length, 1)) * 100),
      completedCount, lessonCount: lessons.length,
      nextLessonId: nextLesson?.id ?? null, nextLessonTitle: nextLesson?.title ?? null,
    }]
  })
  return {
    fullName: profileResult.data.full_name,
    courses,
    certificates: (certificateResult.data ?? []).map((certificate) => ({
      id: certificate.id,
      courseTitle: firstRelated(certificate.course)?.title ?? t('common.courseSkillMind'),
      certificateNumber: certificate.certificate_number,
      issuedAt: certificate.issued_at,
    })),
  }
}

export interface QuizQuestion {
  id: string
  type: 'single_choice' | 'multiple_choice' | 'matching'
  prompt: string
  options: string[]
  leftItems: string[]
  rightItems: string[]
  points: number
}

export interface QuizData {
  id: string
  title: string
  passingScore: number
  attemptLimit: number | null
  attemptsUsed: number
  bestScore: number | null
  questions: QuizQuestion[]
}

export async function getQuizForLesson(lessonId: string): Promise<QuizData> {
  const client = requireClient()
  const { data: quiz, error } = await client.from('quizzes').select('id,title,passing_score,attempt_limit').eq('lesson_id', lessonId).single()
  if (error) throw error
  const [questionsResult, attemptsResult] = await Promise.all([
    client.rpc('get_quiz_questions', { p_quiz_id: quiz.id }),
    client.from('quiz_attempts').select('score,status').eq('quiz_id', quiz.id),
  ])
  if (questionsResult.error) throw questionsResult.error
  if (attemptsResult.error) throw attemptsResult.error
  const scores = (attemptsResult.data ?? []).flatMap((attempt) => attempt.score == null ? [] : [Number(attempt.score)])
  return {
    id: quiz.id,
    title: quiz.title,
    passingScore: Number(quiz.passing_score),
    attemptLimit: quiz.attempt_limit,
    attemptsUsed: attemptsResult.data?.length ?? 0,
    bestScore: scores.length ? Math.max(...scores) : null,
    questions: ((questionsResult.data ?? []) as Array<{ id: string; type: string; prompt: string; options: unknown; points: number }>).map((question) => {
      const type = question.type === 'multiple_choice' || question.type === 'matching' ? question.type : 'single_choice'
      const optionGroups = question.options && typeof question.options === 'object' && !Array.isArray(question.options)
        ? question.options as Record<string, unknown>
        : {}
      return {
        id: question.id,
        type,
        prompt: question.prompt,
        options: Array.isArray(question.options) ? question.options.map(String) : [],
        leftItems: Array.isArray(optionGroups.left) ? optionGroups.left.map(String) : [],
        rightItems: Array.isArray(optionGroups.right) ? optionGroups.right.map(String) : [],
        points: Number(question.points),
      }
    }),
  }
}

export async function submitQuiz(quizId: string, answers: Record<string, number | number[]>): Promise<number> {
  const client = requireClient()
  const { data: attemptId, error: startError } = await client.rpc('start_quiz_attempt', { p_quiz_id: quizId })
  if (startError) throw startError
  const { data: score, error } = await client.rpc('submit_quiz_attempt', {
    p_attempt_id: attemptId,
    p_answers: answers,
  })
  if (error) throw error
  return Number(score)
}

export interface AssignmentData {
  id: string
  instructions: string
  maxFiles: number
  maxFileSizeBytes: number
  allowedMimeTypes: string[]
  status: 'draft' | 'submitted' | 'returned' | 'graded' | null
  feedback: string | null
  grade: number | null
}

export async function getAssignmentForLesson(lessonId: string): Promise<AssignmentData> {
  const client = requireClient()
  const { data: assignment, error } = await client.from('assignments').select('id,instructions,max_files,max_file_size_bytes,allowed_mime_types').eq('lesson_id', lessonId).single()
  if (error) throw error
  const { data: submission, error: submissionError } = await client.from('assignment_submissions').select('status,feedback,grade').eq('assignment_id', assignment.id).maybeSingle()
  if (submissionError) throw submissionError
  return {
    id: assignment.id,
    instructions: assignment.instructions,
    maxFiles: assignment.max_files,
    maxFileSizeBytes: assignment.max_file_size_bytes,
    allowedMimeTypes: assignment.allowed_mime_types,
    status: submission?.status ?? null,
    feedback: submission?.feedback ?? null,
    grade: submission?.grade == null ? null : Number(submission.grade),
  }
}

export async function submitAssignment(assignment: AssignmentData, textAnswer: string, files: File[]): Promise<void> {
  if (files.length > assignment.maxFiles) throw new Error(t('files.tooMany', { count: assignment.maxFiles }))
  for (const file of files) {
    if (file.size > assignment.maxFileSizeBytes) throw new Error(t('files.tooLarge', { name: file.name }))
    if (!assignment.allowedMimeTypes.includes(file.type)) throw new Error(t('files.unsupported', { name: file.name }))
  }
  const client = requireClient()
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError || !userData.user) throw userError ?? new Error(t('common.authRequired'))
  const { data: submission, error: draftError } = await client.from('assignment_submissions').upsert({
    assignment_id: assignment.id,
    user_id: userData.user.id,
    text_answer: textAnswer.trim(),
    status: 'draft',
  }, { onConflict: 'assignment_id,user_id' }).select('id').single()
  if (draftError) throw draftError

  const { data: previousFiles, error: previousError } = await client.from('submission_files').select('id,storage_path').eq('submission_id', submission.id)
  if (previousError) throw previousError
  if (previousFiles.length) {
    const { error: removeStorageError } = await client.storage.from('submission-files').remove(previousFiles.map((file) => file.storage_path))
    if (removeStorageError) throw removeStorageError
    const { error: removeRowsError } = await client.from('submission_files').delete().eq('submission_id', submission.id)
    if (removeRowsError) throw removeRowsError
  }

  if (files.length) {
    const uploaded = await Promise.all(files.map(async (file) => {
      const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-')
      const path = `${submission.id}/${crypto.randomUUID()}-${safeName}`
      const { error: uploadError } = await client.storage.from('submission-files').upload(path, file, { contentType: file.type })
      if (uploadError) throw uploadError
      return { submission_id: submission.id, storage_path: path, original_name: file.name, mime_type: file.type, byte_size: file.size }
    }))
    const { error: fileRowsError } = await client.from('submission_files').insert(uploaded)
    if (fileRowsError) throw fileRowsError
  }

  const { error: submitError } = await client.from('assignment_submissions').update({
    status: 'submitted', submitted_at: new Date().toISOString(),
  }).eq('id', submission.id)
  if (submitError) throw submitError
}

export async function issueCertificateIfEligible(courseId: string): Promise<string | null> {
  const client = requireClient()
  const { data, error } = await client.rpc('issue_certificate_if_eligible', { p_course_id: courseId })
  if (error) throw error
  return data as string | null
}

export interface CertificateDetails {
  certificateNumber: string
  studentName: string
  courseTitle: string
  issuedAt: string
  verificationToken?: string
}

export async function getCertificate(certificateId: string): Promise<CertificateDetails> {
  const client = requireClient()
  const { data, error } = await client.from('certificates')
    .select('certificate_number,issued_at,verification_token,student:profiles!certificates_user_id_fkey(full_name),course:courses(title)')
    .eq('id', certificateId)
    .single()
  if (error) throw error
  return {
    certificateNumber: data.certificate_number,
    studentName: firstRelated(data.student)?.full_name ?? '',
    courseTitle: firstRelated(data.course)?.title ?? '',
    issuedAt: data.issued_at,
    verificationToken: data.verification_token,
  }
}

export async function verifyCertificate(token: string): Promise<CertificateDetails | null> {
  const client = requireClient()
  const { data, error } = await client.rpc('verify_certificate', { p_verification_token: token }).maybeSingle()
  if (error) throw error
  const record = data as { certificate_number: string; student_name: string; course_title: string; issued_at: string } | null
  return record ? {
    certificateNumber: record.certificate_number,
    studentName: record.student_name,
    courseTitle: record.course_title,
    issuedAt: record.issued_at,
  } : null
}

function normalizeCategory(value: string | null): Course['category'] {
  return value === 'Разработка' || value === 'Навыки' ? value : 'Дизайн'
}

function firstRelated<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value
}

function databaseTypeToLessonType(type?: string): LessonType {
  if (type === 'rich_text') return 'text'
  if (type === 'assignment') return 'homework'
  if (type === 'video' || type === 'pdf' || type === 'document' || type === 'quiz') return type
  return 'text'
}

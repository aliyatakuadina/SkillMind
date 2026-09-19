import { supabase } from './supabase'
import { t } from '../i18n'

export interface SubmissionReview {
  id: string
  studentName: string
  courseTitle: string
  taskTitle: string
  submittedAt: string
  textAnswer: string
  status: 'submitted' | 'returned' | 'graded'
  feedback: string | null
  grade: number | null
  files: Array<{ id: string; name: string; path: string }>
}

function requireClient() {
  if (!supabase) throw new Error(t('common.supabaseMissing'))
  return supabase
}

function firstRelated<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value
}

export async function listSubmissionsForReview(): Promise<SubmissionReview[]> {
  const client = requireClient()
  const { data, error } = await client.from('assignment_submissions')
    .select('id,text_answer,status,grade,feedback,submitted_at,user:profiles!assignment_submissions_user_id_fkey(full_name),assignment:assignments(instructions,lesson:lessons(title,module:modules(course:courses(title)))),submission_files(id,original_name,storage_path)')
    .in('status', ['submitted', 'returned', 'graded'])
    .order('submitted_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((submission) => {
    const assignment = firstRelated(submission.assignment)
    const lesson = assignment ? firstRelated(assignment.lesson) : null
    const courseModule = lesson ? firstRelated(lesson.module) : null
    const course = courseModule ? firstRelated(courseModule.course) : null
    return {
      id: submission.id,
      studentName: firstRelated(submission.user)?.full_name ?? t('common.student'),
      courseTitle: course?.title ?? t('common.course'),
      taskTitle: lesson?.title ?? t('common.practicalAssignment'),
      submittedAt: submission.submitted_at ?? '',
      textAnswer: submission.text_answer,
      status: submission.status as SubmissionReview['status'],
      feedback: submission.feedback,
      grade: submission.grade == null ? null : Number(submission.grade),
      files: submission.submission_files.map((file) => ({ id: file.id, name: file.original_name, path: file.storage_path })),
    }
  })
}

export async function getSubmissionFileUrl(path: string): Promise<string> {
  const client = requireClient()
  const { data, error } = await client.storage.from('submission-files').createSignedUrl(path, 900)
  if (error) throw error
  return data.signedUrl
}

export async function reviewSubmission(
  submissionId: string,
  decision: 'returned' | 'graded',
  feedback: string,
  grade: number | null,
): Promise<void> {
  const client = requireClient()
  if (decision === 'graded' && (grade == null || grade < 0 || grade > 100)) {
    throw new Error(t('submissions.gradeValidation'))
  }
  const { error } = await client.from('assignment_submissions').update({
    status: decision,
    feedback: feedback.trim() || null,
    grade: decision === 'graded' ? grade : null,
  }).eq('id', submissionId)
  if (error) throw error
}

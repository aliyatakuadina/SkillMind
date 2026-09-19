import { supabase } from './supabase'
import { t } from '../i18n'

export interface AnalyticsStudent {
  id: string
  name: string
  email: string
  enrolledAt: string
  lastActivity: string
  completedLessons: number
  progressPercent: number
  averageQuizScore: number | null
  learningSeconds: number
  submittedAssignments: number
  gradedAssignments: number
}

export interface QuizAnalytics {
  title: string
  attempts: number
  averageScore: number | null
  passRate: number | null
}

export interface CourseAnalytics {
  courseTitle: string
  lessonCount: number
  students: AnalyticsStudent[]
  quizResults: QuizAnalytics[]
}

export async function getCourseAnalytics(courseId: string): Promise<CourseAnalytics> {
  if (!supabase) throw new Error(t('common.supabaseMissing'))
  const { data, error } = await supabase.rpc('get_course_analytics', { p_course_id: courseId })
  if (error) throw error
  const value = data as {
    course_title: string
    lesson_count: number
    students: Array<Record<string, unknown>>
    quiz_results: Array<Record<string, unknown>>
  }
  return {
    courseTitle: value.course_title,
    lessonCount: Number(value.lesson_count),
    students: value.students.map((student) => ({
      id: String(student.id), name: String(student.name), email: String(student.email),
      enrolledAt: String(student.enrolled_at), lastActivity: String(student.last_activity),
      completedLessons: Number(student.completed_lessons), progressPercent: Number(student.progress_percent),
      averageQuizScore: student.average_quiz_score == null ? null : Number(student.average_quiz_score),
      learningSeconds: Number(student.learning_seconds), submittedAssignments: Number(student.submitted_assignments),
      gradedAssignments: Number(student.graded_assignments),
    })),
    quizResults: value.quiz_results.map((quiz) => ({
      title: String(quiz.title), attempts: Number(quiz.attempts),
      averageScore: quiz.average_score == null ? null : Number(quiz.average_score),
      passRate: quiz.pass_rate == null ? null : Number(quiz.pass_rate),
    })),
  }
}

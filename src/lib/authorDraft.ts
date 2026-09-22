import type { LessonType } from '../types'
import type { CourseDraft, CourseDraftLesson, CourseDraftModule, QuizQuestionDraft, QuizQuestionType } from './courseRepository'

export interface StructureProposal {
  kind: 'course_structure'
  modules: Array<{ title: string; lessons: Array<{ title: string; type: string; description?: string }> }>
}

export interface SummaryProposal {
  kind: 'lesson_summary'
  title?: string
  summary: string
  sections?: Array<{ heading?: string; body?: string }>
}

export interface QuizProposal {
  kind: 'quiz'
  questions: Array<{
    type: QuizQuestionType
    prompt: string
    options?: string[]
    correct_options?: number[]
    pairs?: Array<{ left: string; right: string }>
    explanation?: string
    points?: number
    passing_score?: number
    attempt_limit?: number
  }>
}

export interface VideoLanguageDraft {
  title: string
  summary: string
  lecture?: {
    goals?: string[]
    sections?: Array<{ heading?: string; body?: string; start_seconds?: number }>
    definitions?: Array<{ term?: string; meaning?: string }>
    examples?: Array<{ text?: string; from_source?: boolean }>
    self_check?: Array<{ prompt?: string }>
  }
  glossary?: Array<{ term?: string; meaning?: string }>
  cues?: Array<{ start: number; end: number; text: string; uncertain?: boolean }>
  vtt_text?: string
  srt_text?: string
}

export interface VideoBundleProposal {
  kind: 'video_bundle'
  youtube_id?: string | null
  duration_seconds?: number | null
  published?: boolean
  languages: Partial<Record<'ru' | 'kk' | 'en', VideoLanguageDraft>>
}

export interface VideoBundleRecord {
  id: string
  lesson_id: string
  course_id?: string
  source_id?: string | null
  job_id?: string | null
  version_number?: number
  content_revision: number
  status: string
  published: boolean
  stale_at?: string | null
  youtube_id?: string | null
  duration_seconds?: number | null
  languages: Record<'ru' | 'kk' | 'en', VideoLanguageDraft>
}

export type AuthorProposal = StructureProposal | SummaryProposal | QuizProposal

const LESSON_TYPES: LessonType[] = ['video', 'text', 'pdf', 'document', 'quiz', 'homework']

export function blankLesson(title: string, type: LessonType, description = ''): CourseDraftLesson {
  return {
    id: crypto.randomUUID(),
    title,
    description,
    type,
    duration: '',
    content: '',
    resourceUrl: '',
    sourceUrl: '',
    isRequired: true,
    passingScore: 70,
    attemptLimit: 3,
    questions: [],
    maxFiles: 3,
    maxFileSizeBytes: 10485760,
  }
}

export function applyStructureProposal(draft: CourseDraft, proposal: StructureProposal, selectedModules: number[]): CourseDraft {
  const extras: CourseDraftModule[] = []
  for (const index of selectedModules) {
    const module = proposal.modules[index]
    if (!module?.title) continue
    extras.push({
      id: crypto.randomUUID(),
      title: module.title,
      lessons: (module.lessons ?? []).map((lesson) => blankLesson(
        lesson.title,
        LESSON_TYPES.includes(lesson.type as LessonType) ? lesson.type as LessonType : 'text',
        lesson.description ?? '',
      )),
    })
  }
  return { ...draft, modules: [...draft.modules, ...extras] }
}

export function applySummaryProposal(lesson: CourseDraftLesson, proposal: SummaryProposal): CourseDraftLesson {
  const sections = (proposal.sections ?? [])
    .map((section) => [section.heading, section.body].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')
  const content = [proposal.summary, sections].filter(Boolean).join('\n\n')
  return {
    ...lesson,
    title: proposal.title?.trim() || lesson.title,
    content,
    type: lesson.type === 'video' ? lesson.type : 'text',
    passingScore: lesson.passingScore,
    attemptLimit: lesson.attemptLimit,
    questions: lesson.questions,
  }
}

export function applyQuizProposal(lesson: CourseDraftLesson, proposal: QuizProposal, selectedQuestions: number[]): CourseDraftLesson {
  const added: QuizQuestionDraft[] = []
  for (const index of selectedQuestions) {
    const question = proposal.questions[index]
    if (!question?.prompt) continue
    added.push({
      id: crypto.randomUUID(),
      type: question.type,
      prompt: question.prompt,
      options: question.type === 'matching' ? [] : [...(question.options ?? ['', ''])],
      correctOptions: question.type === 'matching' ? [] : [...(question.correct_options ?? [0])],
      pairs: question.type === 'matching'
        ? (question.pairs ?? []).map((pair) => ({ left: pair.left, right: pair.right }))
        : [{ left: '', right: '' }, { left: '', right: '' }],
      points: question.points && question.points >= 1 && question.points <= 10 ? question.points : 1,
    })
  }
  return {
    ...lesson,
    type: 'quiz',
    questions: [...lesson.questions, ...added],
    passingScore: lesson.passingScore,
    attemptLimit: lesson.attemptLimit,
  }
}

export function applyYoutubeBundle(lesson: CourseDraftLesson, proposal: VideoBundleProposal): CourseDraftLesson {
  const ru = proposal.languages.ru
  const sections = (ru?.lecture?.sections ?? [])
    .map((section) => [section.heading, section.body].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')
  const content = [ru?.summary, sections].filter(Boolean).join('\n\n')
  return {
    ...lesson,
    title: ru?.title?.trim() || lesson.title,
    description: ru?.summary?.trim() || lesson.description,
    content: content || lesson.content,
    resourceUrl: proposal.youtube_id
      ? `https://www.youtube.com/watch?v=${proposal.youtube_id}`
      : lesson.resourceUrl,
    passingScore: lesson.passingScore,
    attemptLimit: lesson.attemptLimit,
    questions: lesson.questions,
  }
}

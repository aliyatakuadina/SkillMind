export type UserRole = 'student' | 'teacher' | 'admin'

export type LessonType = 'text' | 'video' | 'pdf' | 'document' | 'quiz' | 'homework'

export type Lesson = {
  id: string
  title: string
  duration: string
  type: LessonType
  isCompleted?: boolean
  description?: string
  content?: string
  videoUrl?: string
  sourceUrl?: string
}

export type Module = {
  id: string
  title: string
  lessons: Lesson[]
}

export type Course = {
  id: string
  title: string
  description: string
  longDescription?: string
  category: string
  author: string
  authorRole?: string
  duration: string
  lessonsCount: number
  accent: 'coral' | 'blue' | 'yellow'
  status: 'published' | 'review' | 'draft'
  studentsCount: number
  rating?: number
  modules: Module[]
}

export type Certificate = {
  id: string
  courseId: string
  courseTitle: string
  studentName: string
  issueDate: string
  grade: string
  credentialUrl: string
}

export type HomeworkSubmission = {
  id: string
  studentName: string
  initials: string
  courseId: string
  courseTitle: string
  taskTitle: string
  submittedAt: string
  comment: string
  files: string[]
  status: 'pending' | 'approved' | 'changes_requested'
}

export type PlatformUser = {
  id: string
  name: string
  email: string
  role: UserRole
  joinedAt: string
  coursesEnrolled: number
}

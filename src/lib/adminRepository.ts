import { supabase } from './supabase'
import type { UserRole } from '../types'
import { t } from '../i18n'

export interface AdminUser {
  id: string
  email: string
  fullName: string
  role: UserRole
  createdAt: string
  enrollmentsCount: number
}

export interface ModerationCourse {
  id: string
  title: string
  category: string
  authorName: string
  lessonCount: number
  modules: Array<{ id: string; title: string; lessonCount: number }>
}

function client() {
  if (!supabase) throw new Error(t('common.supabaseMissing'))
  return supabase
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const { data, error } = await client().rpc('admin_list_users')
  if (error) throw error
  return ((data ?? []) as Array<{ id: string; email: string; full_name: string; role: UserRole; created_at: string; enrollments_count: number }>).map((user) => ({
    id: user.id, email: user.email, fullName: user.full_name, role: user.role,
    createdAt: user.created_at, enrollmentsCount: Number(user.enrollments_count),
  }))
}

export async function setAdminUserRole(userId: string, role: UserRole): Promise<void> {
  const { error } = await client().rpc('admin_set_user_role', { p_user_id: userId, p_role: role })
  if (error) throw error
}

export async function listModerationCourses(): Promise<ModerationCourse[]> {
  const { data, error } = await client().from('courses')
    .select('id,title,category,author:profiles!courses_author_id_fkey(full_name),modules(id,title,order_index,lessons(id))')
    .eq('status', 'pending_review')
    .order('updated_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((course) => {
    const modules = [...course.modules].sort((a, b) => a.order_index - b.order_index)
    return {
      id: course.id, title: course.title, category: course.category ?? t('common.uncategorized'),
      authorName: one(course.author)?.full_name ?? t('common.teacher'),
      lessonCount: modules.reduce((sum, module) => sum + module.lessons.length, 0),
      modules: modules.map((module) => ({ id: module.id, title: module.title, lessonCount: module.lessons.length })),
    }
  })
}

export async function moderateCourse(courseId: string, approve: boolean, comment: string): Promise<void> {
  const { error } = await client().rpc('moderate_course', {
    p_course_id: courseId, p_approve: approve, p_comment: comment,
  })
  if (error) throw error
}

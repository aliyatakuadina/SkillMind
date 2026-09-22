import type { VideoBundleRecord } from './authorDraft'
import { supabase } from './supabase'
import { t } from '../i18n'

export const skillmindApiUrl = (import.meta.env.VITE_SKILLMIND_API_URL ?? '').replace(/\/$/, '')

export function isSkillmindApiConfigured() {
  return skillmindApiUrl.length > 0
}

async function accessToken() {
  if (!supabase) throw new Error(t('common.supabaseMissing'))
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error(t('auth.genericError'))
  return token
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!isSkillmindApiConfigured()) throw new Error(t('builder.aiApiMissing'))
  const response = await fetch(`${skillmindApiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const body = await response.json().catch(() => ({})) as { error?: string; detail?: string }
  if (!response.ok) {
    throw new Error(body.detail || body.error || t('builder.aiUploadError'))
  }
  return body as T
}

export interface MediaUploadState {
  upload_id: string
  source_id: string
  status: string
  source_status: string
  expected_bytes: number
  part_size_bytes: number
  object_key: string
  parts: { PartNumber: number; ETag: string }[]
}

export async function getAiRuntimeFlags() {
  if (!supabase) {
    return {
      videoEnabled: false,
      authorToolsEnabled: false,
      chatEnabled: false,
      gamificationEnabled: false,
    }
  }
  const { data } = await supabase
    .from('ai_runtime_settings')
    .select('video_enabled,author_tools_enabled,chat_enabled,gamification_enabled')
    .eq('singleton', true)
    .maybeSingle()
  return {
    videoEnabled: Boolean(data?.video_enabled),
    authorToolsEnabled: Boolean(data?.author_tools_enabled),
    chatEnabled: Boolean(data?.chat_enabled),
    gamificationEnabled: Boolean(data?.gamification_enabled),
  }
}

export async function initMediaUpload(input: {
  courseId: string
  lessonId: string
  file: File
}) {
  return api<MediaUploadState>('/v1/media/uploads', {
    method: 'POST',
    body: JSON.stringify({
      course_id: input.courseId,
      lesson_id: input.lessonId,
      filename: input.file.name,
      mime_type: input.file.type || 'video/mp4',
      expected_bytes: input.file.size,
    }),
  })
}

export async function getMediaUpload(uploadId: string) {
  return api<MediaUploadState>(`/v1/media/uploads/${uploadId}`)
}

export async function completeMediaUpload(uploadId: string) {
  return api<{ source: { id: string; status: string; duration_seconds?: number | null } }>(`/v1/media/uploads/${uploadId}/complete`, { method: 'POST' })
}

export async function abortMediaUpload(uploadId: string) {
  return api(`/v1/media/uploads/${uploadId}/abort`, { method: 'POST' })
}

export async function enqueueAiJob(input: {
  taskType: 'video_bundle' | 'course_structure' | 'lesson_summary' | 'quiz'
  idempotencyKey: string
  courseId: string
  lessonId?: string
  sourceId?: string
  payload?: Record<string, unknown>
}) {
  return api<{ id: string; status: string; output?: Record<string, unknown> | null }>('/v1/jobs', {
    method: 'POST',
    body: JSON.stringify({
      task_type: input.taskType,
      idempotency_key: input.idempotencyKey,
      input: input.payload ?? { source: 'file' },
      course_id: input.courseId,
      lesson_id: input.lessonId,
      source_id: input.sourceId,
    }),
  })
}

export async function getAiJob(jobId: string) {
  return api<{ id: string; status: string; error_code?: string | null; output?: AuthorJobOutput | null }>(`/v1/jobs/${jobId}`)
}

export async function waitForAiJob(jobId: string, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const job = await getAiJob(jobId)
    if (['completed', 'needs_review', 'failed', 'cancelled'].includes(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(t('builder.aiAuthorError'))
}

export type AuthorJobOutput = Record<string, unknown>

export async function getAdminAiOverview() {
  return api<AdminAiOverview>('/v1/admin/ai')
}

export async function activateAiConfigFile() {
  return api<{ id: string; file_sha256: string }>('/v1/admin/ai/config/activate-file', { method: 'POST' })
}

export async function refreshAiCatalog() {
  return api<{ updated: number; errors: Record<string, string>; catalog: AdminAiCatalogRow[] }>('/v1/admin/ai/catalog/refresh', { method: 'POST' })
}

export async function probeAiRoute(profile = 'lecture') {
  return api<AdminAiProbeResult>('/v1/admin/ai/probe', {
    method: 'POST',
    body: JSON.stringify({ profile }),
  })
}

export async function cancelAdminAiJob(jobId: string) {
  return api<{ id: string; status: string }>(`/v1/admin/ai/jobs/${jobId}/cancel`, { method: 'POST' })
}

export interface AdminAiKeyAlias {
  alias: string
  present: boolean
}

export interface AdminAiConnection {
  slug: string
  provider: string
  base_url: string
  key_aliases: AdminAiKeyAlias[]
  quota_group?: string | null
  models: string[]
}

export interface AdminAiCandidate {
  connection_slug: string
  provider: string
  key_alias: string
  quota_group?: string | null
  model_id: string
}

export interface AdminAiCatalogRow {
  connection_slug: string
  provider: string
  model_id: string
  capabilities?: string[]
  availability?: string
}

export interface AdminAiJobRow {
  id: string
  task_type: string
  status: string
  progress?: number
  error_code?: string | null
}

export interface AdminAiAttemptRow {
  connection_slug: string
  provider: string
  key_alias: string
  model_id: string
  outcome: string
}

export interface AdminAiOverview {
  file: { sha256: string; path: string }
  runtime: {
    active_config_id?: string | null
    active_file_sha256?: string | null
    file_matches_active?: boolean
    author_tools_enabled: boolean
    video_enabled: boolean
    chat_enabled: boolean
    gamification_enabled: boolean
  }
  providers: {
    gemini?: { configured: boolean }
    openai?: { configured: boolean }
    litellm?: { configured: boolean; reachable?: boolean; error?: string | null }
  }
  connections: AdminAiConnection[]
  profiles: Record<string, AdminAiCandidate[]>
  catalog: AdminAiCatalogRow[]
  jobs: AdminAiJobRow[]
  attempts: AdminAiAttemptRow[]
}

export interface AdminAiProbeResult {
  outcome: string
  text?: string | null
  winner?: AdminAiCandidate | null
  attempts: AdminAiAttemptRow[]
}

export async function uploadMediaFile(input: {
  courseId: string
  lessonId: string
  file: File
  onProgress?: (ratio: number) => void
}) {
  const started = await initMediaUpload(input)
  const partSize = started.part_size_bytes
  const uploaded = new Set(started.parts.map((part) => part.PartNumber))
  const totalParts = Math.max(1, Math.ceil(input.file.size / partSize))
  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    if (uploaded.has(partNumber)) {
      input.onProgress?.(partNumber / totalParts)
      continue
    }
    const signed = await api<{ url: string }>(`/v1/media/uploads/${started.upload_id}/parts/${partNumber}/url`, { method: 'POST' })
    const start = (partNumber - 1) * partSize
    const chunk = input.file.slice(start, start + partSize)
    const put = await fetch(signed.url, { method: 'PUT', body: chunk })
    if (!put.ok) throw new Error(t('builder.aiUploadError'))
    input.onProgress?.(partNumber / totalParts)
  }
  const completed = await completeMediaUpload(started.upload_id)
  let jobId: string | undefined
  if (completed.source.status === 'ready') {
    const job = await enqueueAiJob({
      taskType: 'video_bundle',
      idempotencyKey: crypto.randomUUID(),
      courseId: input.courseId,
      lessonId: input.lessonId,
      sourceId: completed.source.id,
      payload: {
        source: 'file',
        duration_seconds: completed.source.duration_seconds ?? undefined,
      },
    })
    jobId = job.id
  }
  return { sourceId: completed.source.id, sourceStatus: completed.source.status, jobId }
}

export async function registerYoutubeSource(input: {
  courseId: string
  lessonId: string
  url: string
}) {
  return api<{
    source: { id: string; status: string; youtube_id?: string | null; duration_seconds?: number | null }
    job: { id: string; status: string }
  }>('/v1/media/youtube', {
    method: 'POST',
    body: JSON.stringify({
      course_id: input.courseId,
      lesson_id: input.lessonId,
      url: input.url,
      idempotency_key: crypto.randomUUID(),
    }),
  })
}

export async function persistJobBundle(jobId: string) {
  return api<VideoBundleRecord>(`/v1/jobs/${jobId}/bundle`, { method: 'POST' })
}

export async function getLessonAiBundle(lessonId: string) {
  return api<VideoBundleRecord>(`/v1/lessons/${lessonId}/ai-bundle`)
}

export async function saveAiBundle(bundleId: string, expectedRevision: number, languages: VideoBundleRecord['languages']) {
  return api<VideoBundleRecord>(`/v1/ai-bundles/${bundleId}`, {
    method: 'PATCH',
    body: JSON.stringify({ expected_revision: expectedRevision, languages }),
  })
}

export async function publishAiBundle(bundleId: string, expectedRevision: number) {
  return api<VideoBundleRecord>(`/v1/ai-bundles/${bundleId}/publish`, {
    method: 'POST',
    body: JSON.stringify({ expected_revision: expectedRevision, confirmed: true }),
  })
}

export interface ChatCitation {
  lesson_id?: string | null
  lesson_title?: string | null
  start_seconds?: number | null
  end_seconds?: number | null
  content?: string
  source_kind?: string
  score?: number
}

export interface ChatMessage {
  id: string
  role: string
  content: string
  citations?: ChatCitation[]
}

export async function askLessonChat(input: {
  courseId: string
  lessonId?: string
  message: string
  language?: string
  threadId?: string
  idempotencyKey: string
}) {
  return api<{ thread_id: string; message: ChatMessage }>('/v1/chat/ask', {
    method: 'POST',
    body: JSON.stringify({
      course_id: input.courseId,
      lesson_id: input.lessonId,
      message: input.message,
      language: input.language ?? 'ru',
      thread_id: input.threadId,
      idempotency_key: input.idempotencyKey,
    }),
  })
}

export async function getChatThread(threadId: string) {
  return api<{ thread: { id: string }; messages: ChatMessage[] }>(`/v1/chat/threads/${threadId}`)
}

export async function awardXp(input: {
  eventType: 'lesson_completed' | 'quiz_passed' | 'assignment_accepted' | 'certificate_issued'
  entityId: string
  courseId: string
  historical?: boolean
}) {
  return api<{ created: boolean; total_xp: number; level: number }>('/v1/rewards/award', {
    method: 'POST',
    body: JSON.stringify({
      event_type: input.eventType,
      entity_id: input.entityId,
      course_id: input.courseId,
      historical: input.historical ?? false,
    }),
  })
}

export async function getMyRewards() {
  return api<{
    total_xp: number
    level: number
    achievements: { achievement_code: string }[]
    preferences: { public_alias?: string | null; weekly_goal_days?: number } | null
    week_start: string
  }>('/v1/rewards/me')
}

export async function updateRewardPreferences(input: {
  publicAlias?: string | null
  weeklyGoalDays?: number
  nextWeeklyGoalDays?: number
}) {
  return api('/v1/rewards/preferences', {
    method: 'PATCH',
    body: JSON.stringify({
      public_alias: input.publicAlias,
      weekly_goal_days: input.weeklyGoalDays,
      next_weekly_goal_days: input.nextWeeklyGoalDays,
    }),
  })
}

export async function joinCourseRanking(courseId: string) {
  return api(`/v1/rewards/courses/${courseId}/ranking/join`, { method: 'POST' })
}

export async function leaveCourseRanking(courseId: string) {
  return api(`/v1/rewards/courses/${courseId}/ranking/leave`, { method: 'POST' })
}

export async function getCourseLeaderboard(courseId: string) {
  return api<{
    week_start: string
    leaders: { rank: number; alias: string; xp: number; is_me: boolean }[]
    me: { rank: number; alias: string; xp: number; is_me: boolean } | null
  }>(`/v1/rewards/courses/${courseId}/leaderboard`)
}

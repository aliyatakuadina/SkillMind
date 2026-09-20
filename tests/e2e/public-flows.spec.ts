import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

function failOnBrowserErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return () => expect(errors, 'Unexpected browser errors').toEqual([])
}

async function authenticateAsRole(page: Page, role: 'student' | 'teacher' | 'admin') {
  const now = Math.floor(Date.now() / 1000)
  const userId = role === 'student'
    ? '10000000-0000-4000-8000-000000000002'
    : role === 'admin'
      ? '10000000-0000-4000-8000-000000000003'
      : '10000000-0000-4000-8000-000000000001'
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: now + 3600 })}.e2e-signature`
  const session = {
    access_token: accessToken,
    refresh_token: 'e2e-refresh-token',
    expires_at: now + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: `${role}@example.test`,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
    },
  }
  await page.addInitScript((value) => {
    window.localStorage.setItem('sb-example-auth-token', JSON.stringify(value))
  }, session)
  await page.route('**/rest/v1/profiles*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role }) })
  })
}

async function authenticateAsTeacher(page: Page) {
  await authenticateAsRole(page, 'teacher')
}

async function assertNoHorizontalOverflow(page: Page) {
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width)
}

async function mockPublicCourse(page: Page, courseId: string) {
  await page.route('**/rest/v1/courses*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: courseId,
        title: 'Публичный курс',
        description: 'Описание курса',
        category: 'Разработка',
        estimated_duration: '2 часа',
        status: 'published',
        author: { full_name: 'Автор курса' },
        modules: [{
          id: '30000000-0000-4000-8000-000000000001',
          title: 'Модуль 1',
          order_index: 0,
          lessons: [{
            id: '40000000-0000-4000-8000-000000000001',
            title: 'Урок 1',
            description: '',
            order_index: 0,
            is_required: true,
          }],
        }],
      }),
    })
  })
  await page.route('**/rest/v1/enrollments*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })
}

test('certificate token form validates input and remains usable on mobile', async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/verify')

  await expect(page.getByRole('heading', { name: 'Проверить сертификат' })).toBeVisible()
  await page.getByLabel('Токен сертификата').fill('invalid-token')
  await page.getByRole('button', { name: 'Проверить' }).click()

  await expect(page.getByRole('alert')).toHaveText('Введите корректный UUID-токен.')
  await assertNoHorizontalOverflow(page)
  assertNoBrowserErrors()
})

test('public certificate can be verified without a session', async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page)
  const token = '123e4567-e89b-42d3-a456-426614174000'

  await page.route('**/rest/v1/rpc/verify_certificate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        certificate_number: 'SM-2026-0001',
        student_name: 'Тестовый Студент',
        course_title: 'Основы SkillMind',
        issued_at: '2026-09-17T00:00:00.000Z',
      }),
    })
  })

  await page.goto('/verify')
  await page.getByLabel('Токен сертификата').fill(token)
  await page.getByRole('button', { name: 'Проверить' }).click()

  await expect(page).toHaveURL(`/verify/${token}`)
  await expect(page.getByText('Сертификат подлинный')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Тестовый Студент' })).toBeVisible()
  await expect(page.getByText('SM-2026-0001')).toBeVisible()
  assertNoBrowserErrors()
})

test('protected route redirects an anonymous visitor to sign in', async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page)
  await page.goto('/admin')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Войдите в SkillMind' })).toBeVisible()
  assertNoBrowserErrors()
})

test('unknown route renders the localized not-found page', async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page)
  await page.goto('/does-not-exist')

  await expect(page.getByRole('heading', { level: 1 })).toContainText('не найдена')
  assertNoBrowserErrors()
})

test('public certificate form has no WCAG A or AA violations', async ({ page }) => {
  await page.goto('/verify')

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()

  expect(results.violations).toEqual([])
})

test('published course catalog is public for an anonymous visitor', async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page)
  await page.route('**/rest/v1/courses*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto('/courses')

  await expect(page).toHaveURL(/\/courses$/)
  await expect(page.getByRole('heading', { name: 'Каталог курсов' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Войти' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Зарегистрироваться' })).toBeVisible()
  assertNoBrowserErrors()
})

test('home and catalog are WCAG clean and responsive on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/rest/v1/courses*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  for (const path of ['/', '/courses']) {
    await page.goto(path)
    await assertNoHorizontalOverflow(page)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(results.violations, `Accessibility violations on ${path}`).toEqual([])
  }
})

test('public course detail is WCAG clean and responsive on mobile', async ({ page }) => {
  const courseId = '20000000-0000-4000-8000-000000000001'
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPublicCourse(page, courseId)
  await page.goto(`/courses/${courseId}`)

  await expect(page.getByRole('heading', { name: 'Публичный курс' })).toBeVisible()
  await assertNoHorizontalOverflow(page)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations).toEqual([])
})

test('certificate form is operable with the keyboard', async ({ page }) => {
  await page.goto('/verify')

  const brandLink = page.getByRole('link', { name: /SkillMind/ })
  await brandLink.focus()
  await expect(brandLink).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Токен сертификата')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Проверить' })).toBeFocused()
})

test('anonymous visitor is sent to sign in before enrolling', async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page)
  const courseId = '20000000-0000-4000-8000-000000000001'
  await mockPublicCourse(page, courseId)

  await page.goto(`/courses/${courseId}`)
  await expect(page.getByRole('heading', { name: 'Публичный курс' })).toBeVisible()
  await page.getByRole('button', { name: 'Записаться бесплатно' }).click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Войдите в SkillMind' })).toBeVisible()
  await page.getByRole('link', { name: 'Зарегистрироваться' }).click()
  await expect(page).toHaveURL(/\/register$/)
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.from)).toBe(`/courses/${courseId}`)
  await page.getByRole('link', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect.poll(() => page.evaluate(() => window.history.state?.usr?.from)).toBe(`/courses/${courseId}`)
  assertNoBrowserErrors()
})

test('student role cannot open teacher or admin routes', async ({ page }) => {
  await authenticateAsRole(page, 'student')

  await page.goto('/teacher/courses/create')
  await expect(page).toHaveURL(/\/no-access$/)
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()

  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/no-access$/)
  await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
})

test('teacher can configure single, multiple and matching questions', async ({ page }) => {
  await authenticateAsTeacher(page)
  await page.goto('/teacher/courses/create')

  await expect(page.getByRole('heading', { name: 'Новый курс' })).toBeVisible()
  const lessonType = page.locator('.builder-type-select')
  await lessonType.selectOption('quiz')
  await page.getByRole('button', { name: '+ Добавить вопрос' }).click()

  const questionType = page.getByLabel('Тип вопроса')
  await expect(questionType).toHaveValue('single_choice')
  await questionType.selectOption('multiple_choice')
  await expect(page.locator('.builder-answer-option input[type="checkbox"]')).toHaveCount(2)
  await questionType.selectOption('matching')
  await expect(page.getByPlaceholder('Элемент 1')).toBeVisible()
  await expect(page.getByPlaceholder('Соответствие 1')).toBeVisible()
  await page.getByRole('button', { name: '+ Пара для сопоставления' }).click()
  await expect(page.getByPlaceholder('Элемент 3')).toBeVisible()
})

const revisionCourseId = '20000000-0000-4000-8000-000000000011'
function revisionCourse(contentRevision = 4, title = 'Версии курса') {
  return {
    id: revisionCourseId, content_revision: contentRevision, slug: 'revision-course', title,
    description: '', category: 'Разработка', estimated_duration: '1 час',
    modules: [{
      id: '30000000-0000-4000-8000-000000000011', title: 'Модуль', order_index: 0,
      lessons: [{
        id: '40000000-0000-4000-8000-000000000011', content_revision: 1,
        title: 'Тест', description: '', order_index: 0, is_required: true,
        lesson_items: [{ id: '50000000-0000-4000-8000-000000000011', type: 'quiz', payload: {}, order_index: 0 }],
        quizzes: { passing_score: 70, attempt_limit: 3, quiz_questions: [{
          id: '80000000-0000-4000-8000-000000000011', type: 'single_choice',
          prompt: 'Выберите ответ', options: ['A', 'B'], answer_key: 0, points: 1, order_index: 0,
        }] },
      }],
    }],
  }
}

type CourseSaveRequest = {
  p_course_id: string | null
  p_expected_revision: number
  p_submit: boolean
  p_modules: { id: string; lessons: { id: string; item_id?: string; payload: { url: string; questions: { id: string }[] } }[] }[]
}

test('course saves preserve IDs and use every returned revision, including submission', async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page)
  await authenticateAsTeacher(page)
  const requests: CourseSaveRequest[] = []
  await page.route('**/rest/v1/courses*', (route) => route.fulfill({ json: revisionCourse() }))
  await page.route('**/rest/v1/rpc/save_course_draft_v2', async (route) => {
    const request = route.request().postDataJSON() as CourseSaveRequest
    requests.push(request)
    await route.fulfill({ json: { course_id: revisionCourseId, content_revision: request.p_expected_revision + 1 } })
  })
  await page.goto(`/teacher/courses/${revisionCourseId}/edit`)
  await expect(page.getByLabel('Название курса')).toHaveValue('Версии курса')
  await page.getByLabel('Название курса').fill('Новая версия курса')
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(page.getByRole('status')).toHaveText('Черновик сохранён.')
  await page.getByRole('button', { name: 'Отправить на модерацию' }).click()
  await expect(page.getByRole('status')).toHaveText('Курс отправлен на модерацию.')
  expect(requests.map((request) => request.p_expected_revision)).toEqual([4, 5, 6])
  expect(requests.map((request) => request.p_submit)).toEqual([false, false, true])
  for (const request of requests) {
    expect(request.p_course_id).toBe(revisionCourseId)
    expect(request.p_modules[0].id).toBe(revisionCourse().modules[0].id)
    expect(request.p_modules[0].lessons[0].id).toBe(revisionCourse().modules[0].lessons[0].id)
    expect(request.p_modules[0].lessons[0].item_id).toBe(revisionCourse().modules[0].lessons[0].lesson_items[0].id)
    expect(request.p_modules[0].lessons[0].payload.questions[0].id).toBe(revisionCourse().modules[0].lessons[0].quizzes.quiz_questions[0].id)
  }
  assertNoBrowserErrors()
})

test('revision conflict preserves local work and requires explicit reload before saving', async ({ page }) => {
  await authenticateAsTeacher(page)
  await page.setViewportSize({ width: 390, height: 844 })
  let serverRevision = 4
  let saves = 0
  await page.route('**/rest/v1/courses*', (route) => route.fulfill({ json: serverRevision === 4 ? revisionCourse() : revisionCourse(8, 'Правки другого автора') }))
  await page.route('**/rest/v1/rpc/save_course_draft_v2', async (route) => {
    if (++saves === 1) {
      expect(route.request().postDataJSON().p_expected_revision).toBe(4)
      serverRevision = 8
      await route.fulfill({ status: 409, json: { code: 'PT409', message: 'COURSE_REVISION_CONFLICT' } })
    } else {
      expect(route.request().postDataJSON().p_expected_revision).toBe(8)
      await route.fulfill({ json: { course_id: revisionCourseId, content_revision: 9 } })
    }
  })
  await page.goto(`/teacher/courses/${revisionCourseId}/edit`)
  await page.getByLabel('Название курса').fill('Мои несохранённые правки')
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(page.getByRole('alert')).toContainText('Курс изменён в другой вкладке')
  await expect(page.getByLabel('Название курса')).toHaveValue('Мои несохранённые правки')
  await expect(page.getByRole('button', { name: 'Сохранить черновик' })).toBeDisabled()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Скачать мои правки' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe(`skillmind-draft-${revisionCourseId}.json`)
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  const localCopy = JSON.parse(await readFile(downloadPath!, 'utf8'))
  expect(localCopy.title).toBe('Мои несохранённые правки')
  expect(localCopy.contentRevision).toBe(4)
  await assertNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Заменить мои правки версией сервера' }).click()
  await expect(page.getByLabel('Название курса')).toHaveValue('Правки другого автора')
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(page.getByRole('status')).toHaveText('Черновик сохранён.')
  expect(saves).toBe(2)
})

test('failed upload keeps the created course ID and revision for a safe retry', async ({ page }) => {
  await authenticateAsTeacher(page)
  const requests: CourseSaveRequest[] = []
  let uploads = 0
  await page.route('**/rest/v1/courses*', (route) => route.fulfill({ json: revisionCourse(4) }))
  await page.route('**/rest/v1/rpc/save_course_draft_v2', async (route) => {
    const request = route.request().postDataJSON() as CourseSaveRequest
    requests.push(request)
    await route.fulfill({ json: { course_id: revisionCourseId, content_revision: requests.length + 1 } })
  })
  await page.route('**/storage/v1/object/course-assets/**', async (route) => {
    if (++uploads === 1) {
      await route.fulfill({ status: 400, json: { statusCode: '400', error: 'Upload failed', message: 'Тестовый сбой загрузки' } })
    } else {
      await route.fulfill({ json: { Key: 'course-assets/test.pdf' } })
    }
  })
  await page.goto('/teacher/courses/create')
  await page.getByLabel('Название курса').fill('Курс с файлом')
  await page.locator('.builder-type-select').selectOption('pdf')
  await page.getByLabel('Файл материала').setInputFiles({ name: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') })
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(page.getByRole('alert')).toContainText('Тестовый сбой загрузки')
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(page).toHaveURL(`/teacher/courses/${revisionCourseId}/edit`)
  expect(requests.map((request) => request.p_course_id)).toEqual([null, revisionCourseId, revisionCourseId])
  expect(requests.map((request) => request.p_expected_revision)).toEqual([0, 2, 3])
  expect(requests.map((request) => request.p_modules[0].lessons[0].id)).toEqual(Array(3).fill(requests[0].p_modules[0].lessons[0].id))
  expect(requests[2].p_modules[0].lessons[0].payload.url).toMatch(new RegExp(`^${revisionCourseId}/.+-test.pdf$`))
  // Client-side navigation must not carry the previous draft into a new course.
  await page.getByRole('link', { name: 'Создать курс', exact: true }).click()
  await expect(page.getByLabel('Название курса')).toHaveValue('')
  await page.getByLabel('Название курса').fill('Второй независимый курс')
  await page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(page).toHaveURL(`/teacher/courses/${revisionCourseId}/edit`)
  expect(requests[3].p_course_id).toBeNull()
  expect(requests[3].p_expected_revision).toBe(0)
  expect(requests[3].p_modules[0].id).not.toBe(requests[0].p_modules[0].id)
  expect(requests[3].p_modules[0].lessons[0].id).not.toBe(requests[0].p_modules[0].lessons[0].id)
})

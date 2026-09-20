# SkillMind LMS

Frontend онлайн-платформы обучения SkillMind.

Полная спецификация MVP, роли, маршруты, модель данных, RLS и критерии готовности описаны в [`outputs/SkillMind-LMS-project-plan.md`](outputs/SkillMind-LMS-project-plan.md).

Согласованный план расширения: [AI, трёхъязычные материалы и геймификация](docs/AI-GAMIFICATION-PLAN.md). Документ включает архитектуру Docker/MinIO, несколько AI-провайдеров, правила переключения моделей и журнал выполнения этапов.

## Технологии

- React 19 + TypeScript + Vite
- React Router
- Supabase Auth, PostgreSQL, RLS и Storage

## Локальный запуск

```bash
# Установка зависимостей (при первом запуске)
npm install

# Запуск сервера разработки
npm run dev
```

> **Для Windows PowerShell:** если система блокирует выполнение `.ps1` скриптов, используйте команду `npm.cmd run dev`.

Приложение будет доступно в браузере по адресу: **http://localhost:5173/**.

## Проверка сборки и качества кода

```bash
# Проверка типов TypeScript и production-сборка
npm run build

# Проверка качества кода (oxlint)
npm run lint

# Browser E2E: публичные маршруты, guards, сертификаты и mobile viewport
npm run test:e2e:install
npm run test:e2e

# Локальный предпросмотр production-бандла
npm run preview
```

## Supabase

Миграции базы данных находятся в папке `supabase/migrations/`. Они включают схему LMS, приватные Storage-бакеты, RLS, RPC для атомарного сохранения курса, тестов, сертификатов, модерации и аналитики, а также security/performance hardening. Все миграции применены к production-проекту Supabase `horydbjjgwablvdnsxaj`.

Для подключения к облачной базе заполните переменные в `.env` (скопировав из `.env.example`):
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Для нового окружения авторизуйте Supabase CLI, привяжите проект и примените миграции:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Без применения миграций регистрация и профиль не смогут создать или прочитать запись в `public.profiles`.

Первого администратора назначает владелец проекта через SQL Editor или service-role окружение — публичная регистрация намеренно допускает только роли `student` и `teacher`:

```sql
update public.profiles
set role = 'admin'
where id = '<auth.users.id>';
```

RLS-регрессии находятся в `supabase/tests/schema_and_rls_test.sql`. Локальный запуск требует Docker:

```bash
supabase start
supabase test db
```

## Развёртывание на Vercel

Production: **https://skill-mind-sigma.vercel.app**.

Проект Vercel `kmu4/skill-mind` использует `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY` для Production и Preview. `vercel.json` содержит SPA rewrite для маршрутов React Router. Локальная папка `.vercel/` и файлы окружения исключены из git.

GitHub Actions запускает lint/build, Playwright browser E2E и отдельную локальную Supabase-проверку с `db lint` и pgTAP на каждый pull request и push в `main`.

## Текущий статус

- Интерфейс полностью модульный: каталог с поиском и фильтрами, детальная страница курса с интерактивной программой, интерактивная комната обучения с переключением уроков, личный кабинет студента, кабинет преподавателя с проверкой заданий и аналитикой (экспорт в CSV), панель администратора с модерацией курсов и страница официального сертификата с функцией печати/PDF.
- Все пользовательские строки вынесены в русский i18n-словарь. Публичная форма `/verify` проверяет сертификат по UUID-токену без авторизации.
- Для DOCX хранится исходный файл и обязательный PDF-предпросмотр; учебные материалы и работы выдаются из приватных Storage-бакетов через контролируемый доступ.
- Добавлена мобильная адаптивность: бургер-меню и мобильное оглавление уроков.
- Подключена реальная Supabase-аутентификация с восстановлением сессии, выходом, профилем и ролевыми ограничениями маршрутов.
- Production Supabase и Vercel развёрнуты. Реальный E2E-smoke прошёл цепочку: вход → создание и отправка курса → модерация → зачисление → завершение урока → сертификат → публичная проверка. Playwright автоматически проверяет публичные маршруты, guards, mobile viewport и WCAG A/AA.
- RLS pgTAP-набор проходит 48/48 проверок, включая жизненный цикл курса, модерацию, серверную проверку тестов, лимит попыток, условия сертификата, задания, приватность Storage, защиту ключей ответов и три типа вопросов; Supabase Performance Advisor не сообщает проблем.

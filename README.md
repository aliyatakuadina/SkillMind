# SkillMind LMS

Frontend онлайн-платформы обучения SkillMind.

## Технологии

- React 19 + TypeScript + Vite
- React Router
- Supabase — будет подключён на следующем этапе

## Локальный запуск

```bash
pnpm install
pnpm dev
```

Для подключения к облачной базе скопируйте `.env.example` в `.env.local` и заполните URL и anon key из настроек проекта Supabase. Файл `.env.local` не попадает в Git.

## Supabase

Миграции находятся в `supabase/migrations/`:

- начальная схема LMS: роли, курсы, уроки, тесты, задания, сертификаты и аналитические события;
- RLS, защищённая проверка тестов и приватные Storage-бакеты.

Чтобы проверить миграции локально, нужен Docker Desktop:

```bash
pnpm dlx supabase start
pnpm dlx supabase db reset
```

Либо проект можно связать с созданной облачной базой Supabase и применить миграции командой `pnpm dlx supabase db push`.

Проверка production-сборки:

```bash
pnpm build
pnpm lint
```

## Текущий статус

Собран первый статический интерфейс: каталог, страницы курса и урока, личный кабинет, авторский кабинет, аналитика, модерация и аутентификация. Данные пока демонстрационные; подключение Supabase, авторизации и реального CRUD будет следующим этапом.

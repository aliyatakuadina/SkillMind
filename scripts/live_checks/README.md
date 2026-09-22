# Живые проверки этапов 2–5

Запускать только с доступом к hosted Supabase и серверу itwin.kz. Флаги для пользователей не включать.

## Переменные

В серверном `.env` (не в Vercel):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` или `VITE_SUPABASE_PUBLISHABLE_KEY`
- `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` для `skillmind-media`
- `GEMINI_API_KEY_1` / `OPENAI_API_KEY_1`
- `VITE_SKILLMIND_API_URL=https://itwin.kz/skillmind-api`

## 1. supabase db push

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Ожидаются миграции `20260921140000_ai_stage2_bootstrap.sql` и `20260921163000_ai_stage3_config.sql`. Новых миграций из этого среза нет.

## 2. Активировать config/ai.yaml

Админ → вкладка AI → activate file, затем:

```bash
curl -X POST "$VITE_SKILLMIND_API_URL/v1/admin/ai/probe" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"profile":"lecture"}'
```

Проверить, что каталог содержит `gemini-3.5-transcribe` и `whisper-1`.

## 3. Обрыв загрузки ~2 ГиБ

```bash
python scripts/live_checks/upload_resume_smoke.py --api "$VITE_SKILLMIND_API_URL" --token "$TEACHER_JWT" \
  --course-id ... --lesson-id ... --bytes 2147483648 --abort-after-parts 3 --resume
```

Критерий: после обрыва список частей сохраняется, догрузка продолжается, `complete` даёт `ready` или осмысленный статус проверки.

## 4. Контрольные фрагменты

Заполнить `scripts/live_checks/quality-fragments.md` на 10 роликах × RU/KK/EN. Существенная ошибка блокирует публикацию до правки автора. `video_enabled` не включать, пока таблица не заполнена.

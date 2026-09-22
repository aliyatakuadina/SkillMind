# Этап 8 — выпуск

Выполнять после живых проверок этапов 2–5 и pytest/pgTAP/Playwright. Флаги включать по ролям, без пользовательских квот.

## Сквозные сценарии

- [ ] Очередь: enqueue → claim → lease renew → needs_review / failed / cancel
- [ ] Worker: ASR, slides, cues:split, lecture:ru, translate:kk/en, waiting_provider
- [ ] Диск/MinIO: multipart до 2 ГиБ, resume, abort
- [ ] Ошибки моделей: 429, invalid key, unavailable model → fallback / defer
- [ ] Откат флага (`video_enabled` / `author_tools_enabled` / `chat_enabled` / `gamification_enabled`) сохраняет материалы, прогресс и `xp_ledger`

## Резервная копия MinIO

```bash
export BACKUP_ROOT=/mnt/external/skillmind-backups
export MC_ALIAS=skillmind
bash scripts/ops/minio_backup.sh
```

Проверка восстановления: восстановить снимок в тестовый бакет и открыть один объект урока.

## Регрессия CI

Локально / в GitHub Actions:

```bash
pnpm lint && pnpm build && pnpm test:e2e
supabase test db
cd server && pytest
```

## Наблюдение после открытия флагов

- Глубина очереди и возраст lease
- Ошибки провайдеров без утечки ключей в логах
- Размер бакета `skillmind-media`
- Число `needs_review` без публикации

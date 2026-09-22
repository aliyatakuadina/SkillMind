# API localNexus

Клиенты ходят **только** в LiteLLM. Бэкенды (llama.cpp, STT, Postgres) с LAN не торчат и в клиентском коде не используются.

Снято с живого прокси на этом ПК (профиль **gpu-1660ti**, LiteLLM 1.102.0).

| | |
|---|---|
| Base URL | `http://127.0.0.1:4000/v1` |
| LAN | `http://<IP-этого-ПК>:4000/v1` |
| Админка | http://127.0.0.1:4000/ui |
| Спека | http://127.0.0.1:4000/openapi.json (сотни маршрутов LiteLLM; **поддерживаются только пути ниже**) |
| Swagger UI | нет (`/docs` → 404) |

Маршруты без `/v1` (`/chat/completions`, `/embeddings`, `/audio/transcriptions`, `/models`) тоже отвечают — используйте префикс `/v1`, как в OpenAI SDK.

## Авторизация

Все клиентские пути требуют заголовок:

```
Authorization: Bearer <ключ>
```

| Ключ | Кто | Для чего |
|---|---|---|
| `LITELLM_MASTER_KEY` из `.env` (по умолчанию `sk-localnexus-admin`) | админ | UI, `/key/generate`, отладка. **Не раздавать приложениям.** |
| виртуальный `sk-…` | клиент | chat / embeddings / (по желанию) `whisper-1` |

Логин в UI: пользователь `admin`, пароль = master key.

Без заголовка или с неверным ключом → **401**.

Выдать ключ:

```bash
./scripts/create-key.sh dev-ivan
```

Или UI → **Virtual Keys → + Create New Key**. Скрипт по умолчанию даёт `qwen-chat` и `qwen-embed` (без STT), RPM 4, budget 10, срок 30 дней.

```http
POST /key/generate
Authorization: Bearer <master>
Content-Type: application/json

{"key_alias":"dev-ivan","models":["qwen-chat","qwen-embed"],"max_budget":10,"rpm_limit":4,"duration":"30d"}
```

Ответ содержит поле `key` — оно показывается один раз.

## Модели

`GET /v1/models`

| `id` | Режим | Что стоит за алиасом на этом ПК | Timeout | RPM |
|---|---|---|---|---|
| `qwen-chat` | chat | Qwen3.5-35B-A3B Q3_K_M (MoE, 3B active), контекст до 8192 | 180 с | 4 |
| `qwen-embed` | embedding | Qwen3-Embedding-0.6B Q8, **1024** измерения | 60 с | 30 |
| `whisper-1` | audio_transcription | STT, OpenAI-совместимое имя | 300 с | 2 |

Имена бэкендов и железа меняются только в `litellm/config.yaml` / compose. Клиент всегда шлёт эти три `model`.

## Chat

`POST /v1/chat/completions`  
`Content-Type: application/json`

```json
{
  "model": "qwen-chat",
  "messages": [{"role": "user", "content": "ping"}],
  "temperature": 0,
  "max_tokens": 128,
  "stream": false
}
```

Ответ (сокращённо): `object=chat.completion`, `choices[0].message.role=assistant`, `choices[0].message.content`, `usage.{prompt_tokens,completion_tokens,total_tokens}`. Может прийти `timings` от llama.cpp.

Стрим: `"stream": true` → SSE, кадры `data: {…}`, `object=chat.completion.chunk`, текст в `choices[0].delta.content`.

```bash
curl -sS http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-КЛЮЧ" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-chat","max_tokens":64,"messages":[{"role":"user","content":"ping"}]}'
```

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:4000/v1", api_key="sk-КЛЮЧ")
r = client.chat.completions.create(
    model="qwen-chat",
    messages=[{"role": "user", "content": "ping"}],
    timeout=180,
)
print(r.choices[0].message.content)
```

Таймаут клиента ставьте **не меньше 180 с**. На этой машине короткий ping обычно секунды; длинный ответ — десятки секунд.

## Embeddings

`POST /v1/embeddings`

```json
{"model": "qwen-embed", "input": "hello"}
```

`input` — строка или массив строк. Вектор: `data[0].embedding`, длина **1024**, dtype float.

```python
v = client.embeddings.create(model="qwen-embed", input="hello")
assert len(v.data[0].embedding) == 1024
```

## Speech-to-text (`whisper-1`)

`POST /v1/audio/transcriptions`  
`Content-Type: multipart/form-data`

Поля формы:

| Поле | Обязательно | |
|---|---|---|
| `file` | да | аудиофайл (wav / mp3 / …) |
| `model` | да | всегда `whisper-1` |
| `language` | нет | BCP-47, например `en`, `ru` |

```bash
curl -sS http://127.0.0.1:4000/v1/audio/transcriptions \
  -H "Authorization: Bearer sk-КЛЮЧ" \
  -F "file=@clip.wav" \
  -F "model=whisper-1" \
  -F "language=ru"
```

```python
with open("clip.wav", "rb") as f:
    t = client.audio.transcriptions.create(model="whisper-1", file=f, language="ru")
print(t.text)
```

Ответ: JSON с полем `text` (и служебными полями вроде `language`, `duration`, `segments`). Таймаут до **300 с**.

Реализация за прокси — Docker-образ `fedirz/faster-whisper-server`. Клиент этого не видит, **не** вызывает `:8000` и в `model` всегда передаёт `whisper-1`.

Чтобы ключ умел STT, в Virtual Keys добавьте модель `whisper-1` (скрипт `create-key.sh` её не включает).

## Здоровье прокси

| Путь | Auth | |
|---|---|---|
| `GET /health/liveliness` | нет | `"I'm alive!"` |
| `GET /health/readiness` | нет | `{"status":"healthy","db":"connected"}` |
| `GET /health` | Bearer | список живых бэкендов |

Клиентскому приложению достаточно liveliness/readiness. `/health` светит внутренние `api_base` (`http://llm:8001/v1` и т.д.) — это Docker DNS, не хостовые URL.

## RAG (не HTTP API)

Отдельного поддерживаемого `POST /v1/rag/…` в этой песочнице **нет** (маршрут в OpenAPI LiteLLM есть, к нашему pgvector он не подключён).

Схема:

1. `POST /v1/embeddings` с `qwen-embed`
2. запись в Postgres `chunks` (pgvector, 1024)
3. поиск по косинусу и `POST /v1/chat/completions` с найденным контекстом

Таблица (см. `sql/01-init.sql`):

```sql
chunks (
  id BIGSERIAL,
  content TEXT,
  embedding vector(1024),
  metadata JSONB,
  created_at TIMESTAMPTZ
)
```

Пример: `scripts/rag_smoke.py`. DSN с хоста: `postgresql://nexus:nexus@127.0.0.1:5432/nexus` — только для своих скриптов, не для чужих клиентов.

## Что не является клиентским API

- llama.cpp `:8001` / `:8003` и STT `:8000` — отладка на localhost, не контракт.
- Postgres `:5432` только на `127.0.0.1`.
- Остальные сотни путей OpenAPI (assistants, images, videos, `/v1/rag/*`, MCP, …) **не поддерживаются**: за ними нет моделей этой песочницы.
- Клиентский `model` для STT — **`whisper-1`**, не имена движка или образа.

## Сеть

Compose публикует LiteLLM на **все интерфейсы**, порт `4000`. С другой машины в LAN: тот же `/v1` и тот же Bearer. Master key в LAN не светить; приложениям — виртуальный ключ.

После смены железа алиасы `qwen-chat` / `qwen-embed` / `whisper-1` остаются; меняется только то, что стоит за ними.

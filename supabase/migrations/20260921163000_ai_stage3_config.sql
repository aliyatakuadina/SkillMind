-- Immutable snapshot of config/ai.yaml with per-connection model lists.
-- Feature flags stay off. Do not UPDATE the previous bootstrap row.
insert into public.ai_config_versions (id, config, file_sha256, description)
values (
  'a1000000-0000-4000-8000-000000000002',
  $cfg$
{
  "connections": [
    {
      "slug": "gemini-main",
      "provider": "gemini",
      "base_url": "https://generativelanguage.googleapis.com",
      "key_aliases": ["GEMINI_API_KEY_1"],
      "quota_group": "gemini-project",
      "models": ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]
    },
    {
      "slug": "litellm-local",
      "provider": "litellm",
      "base_url": "http://127.0.0.1:4000",
      "key_aliases": ["LITELLM_API_KEY_1"],
      "models": ["gpt-4o-mini"]
    },
    {
      "slug": "openai-main",
      "provider": "openai",
      "base_url": "https://api.openai.com/v1",
      "key_aliases": ["OPENAI_API_KEY_1"],
      "models": ["gpt-4.1-mini", "gpt-4o-mini"]
    }
  ],
  "profiles": {
    "video": {"order": ["gemini-main"]},
    "transcription": {"order": ["gemini-main", "openai-main", "litellm-local"]},
    "lecture": {"order": ["gemini-main", "litellm-local", "openai-main"]},
    "translation": {"order": ["gemini-main", "litellm-local", "openai-main"]},
    "quiz": {"order": ["gemini-main", "litellm-local", "openai-main"]},
    "chat": {"order": ["gemini-main", "litellm-local", "openai-main"]},
    "embedding": {"order": ["gemini-main"]}
  }
}
$cfg$::jsonb,
  '8274cf6df09da0b67b11ca5c930ac34f0689de1b4a1d92d2a31244b8dda6a455',
  'Stage 3 model lists from config/ai.yaml'
);

update public.ai_runtime_settings
set active_config_id = 'a1000000-0000-4000-8000-000000000002', updated_at = now()
where singleton;

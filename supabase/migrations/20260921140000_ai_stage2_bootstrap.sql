-- Stage 2 bootstrap: secret-free config snapshot, flag reads for the UI,
-- and an active configuration so enqueue does not fail with AI_CONFIG_REQUIRED.
-- Feature flags stay off until a later, verified release.
create policy authenticated_runtime_flags_read
  on public.ai_runtime_settings
  for select
  to authenticated
  using (true);

insert into public.ai_config_versions (id, config, file_sha256, description)
values (
  'a1000000-0000-4000-8000-000000000001',
  '{
    "connections": [
      {
        "slug": "gemini-main",
        "provider": "gemini",
        "base_url": "https://generativelanguage.googleapis.com",
        "key_aliases": ["GEMINI_API_KEY_1"],
        "quota_group": "gemini-project"
      },
      {
        "slug": "openai-main",
        "provider": "openai",
        "base_url": "https://api.openai.com/v1",
        "key_aliases": ["OPENAI_API_KEY_1"]
      },
      {
        "slug": "litellm-local",
        "provider": "litellm",
        "base_url": "http://127.0.0.1:4000",
        "key_aliases": ["LITELLM_API_KEY_1"]
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
  }'::jsonb,
  'c8495c7124d2f7ad566dabcb117d122b26d080701dd5c63bd9defcdd2944b01f',
  'Bootstrap from config/ai.yaml'
);

update public.ai_runtime_settings
set active_config_id = 'a1000000-0000-4000-8000-000000000001', updated_at = now()
where singleton and active_config_id is null;

comment on policy authenticated_runtime_flags_read on public.ai_runtime_settings is
  'Authors need the four feature flags to hide unfinished UI. active_config_id is not a secret.';

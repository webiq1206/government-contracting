-- 005: UI-managed integration credentials. Values are AES-256-GCM encrypted
-- with a key derived from AUTH_SECRET before they reach this table; the
-- Integrations page is the only writer. Env vars remain a fallback source.
create table if not exists integration_settings (
  env_key           text primary key,
  value_enc         text not null,
  updated_at        timestamptz not null default now(),
  last_validated_at timestamptz,
  last_error        text
);

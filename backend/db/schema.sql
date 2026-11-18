-- Sima storage schema (Supabase / any Postgres).
-- Run once in the Supabase SQL Editor. Safe to re-run.

create table if not exists public.documents (
    path        text primary key,          -- e.g. companies/provident/projects/<id>.json
    data        json not null,             -- the document body (json, not jsonb: keeps key order)
    updated_at  timestamptz not null default now()
);

-- Fast "everything under this folder" lookups (text_pattern_ops makes LIKE 'prefix%' use the index).
create index if not exists documents_path_prefix_idx
    on public.documents (path text_pattern_ops);

-- Lock the table down. The backend connects with the database password (which bypasses
-- RLS); with RLS enabled and NO policies, the public anon/authenticated API keys that
-- Supabase exposes can read or write nothing here.
alter table public.documents enable row level security;

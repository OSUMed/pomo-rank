create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  name text not null,
  color text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

alter table projects add column if not exists archived boolean not null default false;
alter table projects add column if not exists color text;

create table if not exists focus_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  log_date date not null,
  seconds integer not null check (seconds >= 0),
  source text not null check (source in ('timer', 'manual')),
  created_at timestamptz not null default now()
);

create index if not exists idx_focus_logs_user_date on focus_logs(user_id, log_date);
create index if not exists idx_focus_logs_user_project_date on focus_logs(user_id, project_id, log_date);

create table if not exists oura_connections (
  user_id uuid primary key references app_users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  token_type text,
  scope text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists oura_focus_profiles (
  user_id uuid primary key references app_users(id) on delete cascade,
  baseline_median_bpm numeric not null default 0,
  typical_drift_bpm numeric not null default 8,
  sample_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists oura_focus_telemetry (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  session_started_at timestamptz not null,
  session_ended_at timestamptz not null,
  baseline_bpm numeric not null,
  peak_rolling_bpm numeric not null,
  avg_rolling_bpm numeric not null,
  alert_windows integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_oura_focus_telemetry_user_created
  on oura_focus_telemetry(user_id, created_at desc);

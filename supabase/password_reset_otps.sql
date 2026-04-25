create extension if not exists citext;
create extension if not exists pgcrypto;

create table if not exists password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  email citext not null,
  purpose text not null check (purpose in ('account', 'privacy_lock', 'privacy_hidden')),
  otp_hash text not null,
  salt text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_otps_lookup_idx
on password_reset_otps (email, purpose, created_at desc);

create index if not exists password_reset_otps_expires_at_idx
on password_reset_otps (expires_at);

create table if not exists password_reset_otp_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  email citext not null,
  purpose text not null check (purpose in ('account', 'privacy_lock', 'privacy_hidden')),
  created_at timestamptz not null default now()
);

create index if not exists password_reset_otp_events_rate_limit_idx
on password_reset_otp_events (email, purpose, created_at desc);

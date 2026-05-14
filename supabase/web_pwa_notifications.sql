create table if not exists notification_devices (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references user_profiles(id) on delete cascade,
  platform text not null check (platform in ('web_pwa')),
  provider text not null check (provider in ('fcm')),
  token text not null,
  enabled boolean not null default true,
  user_agent text,
  device_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists notification_devices_provider_token_unique
on notification_devices(provider, token);
create index if not exists notification_devices_user_idx
on notification_devices(user_id);

create table if not exists notification_preferences (
  user_id text primary key references user_profiles(id) on delete cascade,
  messages_enabled boolean not null default true,
  calls_enabled boolean not null default true,
  missed_calls_enabled boolean not null default true,
  show_message_preview boolean not null default true,
  sound_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists conversation_notification_settings (
  user_id text not null references user_profiles(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  muted boolean not null default false,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references user_profiles(id) on delete cascade,
  notification_type text not null,
  target_id text,
  status text not null check (status in ('queued', 'sent', 'failed', 'skipped')),
  reason text,
  created_at timestamptz not null default now()
);

alter table call_sessions add column if not exists receiver_id text references user_profiles(id) on delete cascade;
update call_sessions set receiver_id = callee_id where receiver_id is null and callee_id is not null;
alter table call_sessions add column if not exists call_type text not null default 'direct';
alter table call_sessions add column if not exists accepted_at timestamptz;
alter table call_sessions add column if not exists expires_at timestamptz not null default (now() + interval '45 seconds');
alter table call_sessions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table call_sessions alter column id set default gen_random_uuid();
alter table call_sessions alter column callee_id drop not null;
alter table call_sessions drop constraint if exists call_sessions_call_type_check;
alter table call_sessions add constraint call_sessions_call_type_check check (call_type in ('direct', 'group'));
alter table call_sessions drop constraint if exists call_sessions_status_check;
alter table call_sessions add constraint call_sessions_status_check
check (status in ('ringing', 'accepted', 'rejected', 'ended', 'missed', 'expired', 'failed', 'connecting', 'connected', 'reconnecting', 'busy'));

alter table notification_devices enable row level security;
alter table notification_preferences enable row level security;
alter table conversation_notification_settings enable row level security;
alter table notification_events enable row level security;

drop policy if exists "notification devices owner access" on notification_devices;
create policy "notification devices owner access" on notification_devices
for all using (user_id = app_user_id()) with check (user_id = app_user_id());

drop policy if exists "notification preferences owner access" on notification_preferences;
create policy "notification preferences owner access" on notification_preferences
for all using (user_id = app_user_id()) with check (user_id = app_user_id());

drop policy if exists "conversation notification settings owner access" on conversation_notification_settings;
create policy "conversation notification settings owner access" on conversation_notification_settings
for all using (user_id = app_user_id()) with check (user_id = app_user_id());

drop policy if exists "notification events owner visible" on notification_events;
create policy "notification events owner visible" on notification_events
for select using (user_id = app_user_id());

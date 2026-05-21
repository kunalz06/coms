-- COMMS stability migration: board realtime, FCM devices, notification preferences.
-- Safe to run more than once in Supabase SQL editor.

alter table public.meeting_whiteboard_strokes
  alter column color type bigint using color::bigint;

alter table public.notification_settings add column if not exists messages_enabled boolean not null default false;
alter table public.notification_settings add column if not exists calls_enabled boolean not null default false;
alter table public.notification_settings add column if not exists missed_calls_enabled boolean not null default false;
alter table public.notification_settings add column if not exists show_message_preview boolean not null default true;
alter table public.notification_settings add column if not exists sound_enabled boolean not null default true;

create table if not exists public.notification_devices (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.user_profiles(id) on delete cascade,
  platform text not null default 'web_pwa' check (platform in ('web_pwa')),
  provider text not null default 'fcm' check (provider in ('fcm')),
  token text not null,
  enabled boolean not null default true,
  user_agent text,
  device_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (provider, token)
);

create table if not exists public.conversation_notification_settings (
  user_id text not null references public.user_profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  muted boolean not null default false,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.user_profiles(id) on delete cascade,
  notification_type text not null,
  target_id text,
  status text not null check (status in ('queued', 'sent', 'failed', 'skipped')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists notification_devices_user_idx on public.notification_devices(user_id);
create index if not exists notification_events_user_created_idx on public.notification_events(user_id, created_at desc);
create index if not exists conversation_notification_settings_conversation_idx on public.conversation_notification_settings(conversation_id);

alter table public.notification_devices enable row level security;
alter table public.notification_events enable row level security;
alter table public.conversation_notification_settings enable row level security;

drop policy if exists "notification devices visible to owner" on public.notification_devices;
create policy "notification devices visible to owner" on public.notification_devices
for select using (user_id = app_user_id());

drop policy if exists "notification devices created by owner" on public.notification_devices;
create policy "notification devices created by owner" on public.notification_devices
for insert with check (user_id = app_user_id());

drop policy if exists "notification devices updated by owner" on public.notification_devices;
create policy "notification devices updated by owner" on public.notification_devices
for update using (user_id = app_user_id())
with check (user_id = app_user_id());

drop policy if exists "notification devices removed by owner" on public.notification_devices;
create policy "notification devices removed by owner" on public.notification_devices
for delete using (user_id = app_user_id());

drop policy if exists "notification events visible to owner" on public.notification_events;
create policy "notification events visible to owner" on public.notification_events
for select using (user_id = app_user_id());

drop policy if exists "conversation notification settings visible to owner" on public.conversation_notification_settings;
create policy "conversation notification settings visible to owner" on public.conversation_notification_settings
for select using (user_id = app_user_id());

drop policy if exists "conversation notification settings created by owner" on public.conversation_notification_settings;
create policy "conversation notification settings created by owner" on public.conversation_notification_settings
for insert with check (user_id = app_user_id() and user_is_conversation_participant(conversation_id, app_user_id()));

drop policy if exists "conversation notification settings updated by owner" on public.conversation_notification_settings;
create policy "conversation notification settings updated by owner" on public.conversation_notification_settings
for update using (user_id = app_user_id())
with check (user_id = app_user_id() and user_is_conversation_participant(conversation_id, app_user_id()));

drop policy if exists "conversation notification settings removed by owner" on public.conversation_notification_settings;
create policy "conversation notification settings removed by owner" on public.conversation_notification_settings
for delete using (user_id = app_user_id());

create or replace function public.close_expired_empty_meetings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  closed_count integer := 0;
begin
  with ended as (
    update meetings
    set status = 'ended',
        ended_at = now(),
        updated_at = now()
    where status = 'live'
      and empty_since is not null
      and empty_since < now() - interval '2 minutes'
    returning id
  ),
  deleted_chat as (
    delete from meeting_chat_messages
    where meeting_id in (select id from ended)
  ),
  deleted_board as (
    delete from meeting_whiteboard_strokes
    where meeting_id in (select id from ended)
  )
  select count(*) into closed_count from ended;

  return closed_count;
end;
$$;

grant execute on function public.close_expired_empty_meetings() to anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'notification_devices',
    'notification_events',
    'conversation_notification_settings',
    'meetings',
    'meeting_participants',
    'meeting_chat_messages',
    'meeting_whiteboard_strokes'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

create extension if not exists citext;
create extension if not exists pgcrypto;

create or replace function app_user_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'sub', ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  )
$$;

create table if not exists user_profiles (
  id text primary key,
  email citext not null unique,
  full_name text not null,
  avatar_url text,
  status text not null default 'offline' check (status in ('online', 'offline')),
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id text not null references user_profiles(id) on delete cascade,
  addressee_id text not null references user_profiles(id) on delete cascade,
  status text not null default 'accepted' check (status in ('accepted', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_unique
on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id text not null references user_profiles(id) on delete cascade,
  blocked_id text not null references user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists notification_settings (
  user_id text primary key references user_profiles(id) on delete cascade,
  browser_notifications_enabled boolean not null default false,
  ringtone_enabled boolean not null default true,
  notifications_prompted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references user_profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct' check (type in ('direct', 'group')),
  title text,
  avatar_url text,
  created_by text references user_profiles(id) on delete set null,
  user_one_id text references user_profiles(id) on delete cascade,
  user_two_id text references user_profiles(id) on delete cascade,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (type = 'direct' and user_one_id is not null and user_two_id is not null and user_one_id <> user_two_id)
    or
    (type = 'group' and title is not null)
  )
);

create unique index if not exists conversations_pair_unique
on conversations (least(user_one_id, user_two_id), greatest(user_one_id, user_two_id));

create table if not exists conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id text not null references user_profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  unique (conversation_id, user_id)
);

create table if not exists conversation_mutes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id text not null references user_profiles(id) on delete cascade,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create table if not exists conversation_pins (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id text not null references user_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create table if not exists backup_preferences (
  user_id text primary key references user_profiles(id) on delete cascade,
  provider text check (provider in ('google_drive')),
  enabled boolean not null default false,
  status text not null default 'disabled' check (status in ('disabled', 'connecting', 'enabled', 'syncing', 'success', 'failed', 'reconnect_required')),
  google_drive_email text,
  drive_scope text,
  drive_access_token_enc text,
  drive_refresh_token_enc text,
  drive_token_expires_at timestamptz,
  last_successful_backup_at timestamptz,
  last_backup_error text,
  reconnect_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists archive_batches (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references user_profiles(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  provider text not null check (provider in ('google_drive')),
  batch_key text not null,
  archive_version integer not null default 1,
  provider_file_id text,
  provider_file_name text,
  status text not null default 'pending' check (status in ('pending', 'uploading', 'success', 'failed', 'missing')),
  message_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, conversation_id, provider, batch_key)
);

alter table conversations add column if not exists type text not null default 'direct';
alter table conversations add column if not exists title text;
alter table conversations add column if not exists avatar_url text;
alter table conversations add column if not exists created_by text references user_profiles(id) on delete set null;
alter table conversations alter column user_one_id drop not null;
alter table conversations alter column user_two_id drop not null;
alter table conversations drop constraint if exists conversations_type_check;
alter table conversations add constraint conversations_type_check check (type in ('direct', 'group'));
alter table conversations drop constraint if exists conversations_direct_or_group_check;
alter table conversations add constraint conversations_direct_or_group_check check (
  (type = 'direct' and user_one_id is not null and user_two_id is not null and user_one_id <> user_two_id)
  or
  (type = 'group' and title is not null)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id text not null references user_profiles(id) on delete cascade,
  kind text not null check (kind in ('text', 'image', 'document', 'voice')),
  content text,
  status text not null default 'sent' check (status in ('sent', 'failed', 'delivered', 'read')),
  deleted_for_everyone_at timestamptz,
  deleted_by text references user_profiles(id) on delete set null,
  edited_at timestamptz,
  retention_expires_at timestamptz not null default (now() + interval '3 days'),
  content_redacted_at timestamptz,
  archive_status text not null default 'pending' check (archive_status in ('pending', 'partial', 'archived', 'redacted', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table messages add column if not exists deleted_for_everyone_at timestamptz;
alter table messages add column if not exists deleted_by text references user_profiles(id) on delete set null;
alter table messages add column if not exists edited_at timestamptz;
alter table messages add column if not exists retention_expires_at timestamptz not null default (now() + interval '3 days');
alter table messages add column if not exists content_redacted_at timestamptz;
alter table messages add column if not exists archive_status text not null default 'pending';
alter table messages drop constraint if exists messages_archive_status_check;
alter table messages add constraint messages_archive_status_check check (archive_status in ('pending', 'partial', 'archived', 'redacted', 'skipped'));
alter table messages drop constraint if exists messages_content_length_check;
alter table messages add constraint messages_content_length_check check (content is null or char_length(content) <= 4000);

create table if not exists message_deletions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id text not null references user_profiles(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create table if not exists message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  url text not null,
  public_id text,
  resource_type text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes <= 104857600),
  upload_mode text not null default 'direct' check (upload_mode in ('direct', 'chunked')),
  original_size_bytes integer,
  chunk_size_bytes integer,
  chunk_count integer,
  file_sha256 text,
  assembly_status text not null default 'ready' check (assembly_status in ('ready', 'incomplete', 'corrupt')),
  created_at timestamptz not null default now()
);

alter table message_attachments drop constraint if exists message_attachments_size_bytes_check;
alter table message_attachments add constraint message_attachments_size_bytes_check check (size_bytes <= 104857600);
alter table message_attachments add column if not exists upload_mode text not null default 'direct';
alter table message_attachments add column if not exists original_size_bytes integer;
alter table message_attachments add column if not exists chunk_size_bytes integer;
alter table message_attachments add column if not exists chunk_count integer;
alter table message_attachments add column if not exists file_sha256 text;
alter table message_attachments add column if not exists assembly_status text not null default 'ready';
alter table message_attachments drop constraint if exists message_attachments_upload_mode_check;
alter table message_attachments add constraint message_attachments_upload_mode_check check (upload_mode in ('direct', 'chunked'));
alter table message_attachments drop constraint if exists message_attachments_assembly_status_check;
alter table message_attachments add constraint message_attachments_assembly_status_check check (assembly_status in ('ready', 'incomplete', 'corrupt'));
alter table message_attachments drop constraint if exists message_attachments_chunk_metadata_check;
alter table message_attachments add constraint message_attachments_chunk_metadata_check check (
  (
    upload_mode = 'direct'
    and (chunk_count is null or chunk_count <= 1)
  )
  or
  (
    upload_mode = 'chunked'
    and original_size_bytes is not null
    and original_size_bytes > 10485760
    and original_size_bytes <= 104857600
    and chunk_size_bytes = 5242880
    and chunk_count is not null
    and chunk_count > 1
    and file_sha256 ~ '^[a-f0-9]{64}$'
  )
);

create table if not exists message_attachment_chunks (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references message_attachments(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  chunk_url text not null,
  chunk_public_id text,
  chunk_size_bytes integer not null check (chunk_size_bytes > 0 and chunk_size_bytes <= 5242880),
  chunk_sha256 text not null check (chunk_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (attachment_id, chunk_index)
);

create index if not exists message_attachment_chunks_attachment_idx
on message_attachment_chunks (attachment_id, chunk_index);

create table if not exists message_archives (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id text not null references user_profiles(id) on delete cascade,
  archive_batch_id uuid not null references archive_batches(id) on delete cascade,
  archived_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id text not null references user_profiles(id) on delete cascade,
  kind text not null check (kind in ('emoji', 'text')),
  content text not null check (char_length(content) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, kind, content)
);

create table if not exists call_sessions (
  id uuid primary key,
  conversation_id uuid references conversations(id) on delete set null,
  caller_id text not null references user_profiles(id) on delete cascade,
  callee_id text not null references user_profiles(id) on delete cascade,
  mode text not null check (mode in ('audio', 'video')),
  status text not null check (status in ('ringing', 'connecting', 'connected', 'reconnecting', 'rejected', 'missed', 'busy', 'ended', 'failed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  failure_reason text
);

create table if not exists group_call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  started_by text references user_profiles(id) on delete set null,
  mode text not null check (mode in ('audio', 'video')),
  status text not null default 'active' check (status in ('active', 'ended', 'failed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  failure_reason text
);

create table if not exists group_call_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references group_call_sessions(id) on delete cascade,
  user_id text not null references user_profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (session_id, user_id)
);

alter table call_sessions drop constraint if exists call_sessions_status_check;
alter table call_sessions add constraint call_sessions_status_check
check (status in ('ringing', 'connecting', 'connected', 'reconnecting', 'rejected', 'missed', 'busy', 'ended', 'failed'));

create table if not exists presence_events (
  id bigint generated always as identity primary key,
  user_id text not null references user_profiles(id) on delete cascade,
  status text not null check (status in ('online', 'offline')),
  created_at timestamptz not null default now()
);

create index if not exists user_profiles_email_idx on user_profiles(email);
create index if not exists friendships_requester_idx on friendships(requester_id);
create index if not exists friendships_addressee_idx on friendships(addressee_id);
create index if not exists blocks_blocker_idx on blocks(blocker_id);
create index if not exists blocks_blocked_idx on blocks(blocked_id);
create index if not exists conversation_mutes_user_idx on conversation_mutes(user_id);
create index if not exists conversation_mutes_conversation_idx on conversation_mutes(conversation_id);
create index if not exists conversation_pins_user_idx on conversation_pins(user_id, created_at desc);
create index if not exists conversation_pins_conversation_idx on conversation_pins(conversation_id);
create index if not exists backup_preferences_status_idx on backup_preferences(status, enabled);
create index if not exists archive_batches_user_status_idx on archive_batches(user_id, status, completed_at desc);
create index if not exists archive_batches_conversation_idx on archive_batches(conversation_id, batch_key);
create index if not exists message_archives_user_message_idx on message_archives(user_id, message_id);
create index if not exists message_archives_batch_idx on message_archives(archive_batch_id);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);
create index if not exists conversations_user_one_idx on conversations(user_one_id);
create index if not exists conversations_user_two_idx on conversations(user_two_id);
create index if not exists conversations_type_idx on conversations(type);
create index if not exists conversation_members_user_idx on conversation_members(user_id);
create index if not exists conversation_members_conversation_idx on conversation_members(conversation_id);
create index if not exists messages_conversation_created_idx on messages(conversation_id, created_at desc);
create index if not exists messages_retention_idx on messages(retention_expires_at, archive_status, content_redacted_at);
create index if not exists message_deletions_user_message_idx on message_deletions(user_id, message_id);
create index if not exists message_reactions_message_idx on message_reactions(message_id, created_at asc);
create index if not exists message_reactions_user_idx on message_reactions(user_id);
create index if not exists call_sessions_participants_idx on call_sessions(caller_id, callee_id, started_at desc);
create index if not exists group_call_sessions_conversation_idx on group_call_sessions(conversation_id, started_at desc);

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'COMMS meeting',
  creator_id text not null references user_profiles(id) on delete cascade,
  status text not null default 'created' check (status in ('created', 'live', 'ended')),
  started_at timestamptz,
  ended_at timestamptz,
  empty_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meeting_participants (
  meeting_id uuid not null references meetings(id) on delete cascade,
  user_id text not null references user_profiles(id) on delete cascade,
  role text not null default 'participant' check (role in ('creator', 'co_creator', 'participant')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  hand_raised boolean not null default false,
  can_draw boolean not null default true,
  primary key (meeting_id, user_id)
);

create table if not exists meeting_chat_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  sender_id text not null references user_profiles(id) on delete cascade,
  content text not null check (char_length(content) <= 2000),
  created_at timestamptz not null default now()
);

create table if not exists meeting_whiteboard_strokes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  user_id text not null references user_profiles(id) on delete cascade,
  points jsonb not null default '[]'::jsonb,
  color integer not null default 4282020808,
  width numeric not null default 3,
  created_at timestamptz not null default now()
);

create index if not exists meetings_creator_idx on meetings(creator_id, updated_at desc);
create index if not exists meeting_participants_user_idx on meeting_participants(user_id, joined_at desc);
create index if not exists meeting_chat_messages_meeting_idx on meeting_chat_messages(meeting_id, created_at);
create index if not exists meeting_whiteboard_strokes_meeting_idx on meeting_whiteboard_strokes(meeting_id, created_at);

create or replace function user_is_meeting_creator(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from meeting_participants
    where meeting_participants.meeting_id = p_meeting_id
      and meeting_participants.user_id = app_user_id()
      and meeting_participants.role in ('creator', 'co_creator')
  )
$$;
create index if not exists group_call_participants_session_idx on group_call_participants(session_id);
create index if not exists group_call_participants_user_idx on group_call_participants(user_id);

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_touch_updated_at on user_profiles;
create trigger user_profiles_touch_updated_at before update on user_profiles
for each row execute function touch_updated_at();

drop trigger if exists notification_settings_touch_updated_at on notification_settings;
create trigger notification_settings_touch_updated_at before update on notification_settings
for each row execute function touch_updated_at();

drop trigger if exists push_subscriptions_touch_updated_at on push_subscriptions;
create trigger push_subscriptions_touch_updated_at before update on push_subscriptions
for each row execute function touch_updated_at();

drop trigger if exists backup_preferences_touch_updated_at on backup_preferences;
create trigger backup_preferences_touch_updated_at before update on backup_preferences
for each row execute function touch_updated_at();

drop trigger if exists archive_batches_touch_updated_at on archive_batches;
create trigger archive_batches_touch_updated_at before update on archive_batches
for each row execute function touch_updated_at();

drop trigger if exists friendships_touch_updated_at on friendships;
create trigger friendships_touch_updated_at before update on friendships
for each row execute function touch_updated_at();

drop trigger if exists conversations_touch_updated_at on conversations;
create trigger conversations_touch_updated_at before update on conversations
for each row execute function touch_updated_at();

drop trigger if exists messages_touch_updated_at on messages;
create trigger messages_touch_updated_at before update on messages
for each row execute function touch_updated_at();

create or replace function enforce_message_update_rules()
returns trigger
language plpgsql
as $$
declare
  bypass_group_clear boolean := coalesce(current_setting('comms.group_clear', true), '') = '1';
begin
  if new.conversation_id is distinct from old.conversation_id
    or new.sender_id is distinct from old.sender_id
    or new.kind is distinct from old.kind
    or new.created_at is distinct from old.created_at then
    raise exception 'Message identity fields cannot be changed';
  end if;

  if old.deleted_for_everyone_at is not null then
    new.deleted_for_everyone_at := old.deleted_for_everyone_at;
    new.deleted_by := old.deleted_by;
    new.edited_at := old.edited_at;
    new.content := old.content;
    return new;
  end if;

  if new.deleted_for_everyone_at is distinct from old.deleted_for_everyone_at then
    if new.deleted_for_everyone_at is null then
      raise exception 'Deleted messages cannot be restored';
    end if;
    if bypass_group_clear then
      if not exists (
        select 1
        from conversations
        where id = old.conversation_id
          and type = 'group'
      ) then
        raise exception 'Group clear mode can only be used for group conversations';
      end if;
      if not user_can_manage_conversation(old.conversation_id, app_user_id()) then
        raise exception 'Only group owners/admins can clear messages for everyone';
      end if;
    else
      if old.sender_id <> app_user_id() then
        raise exception 'Only the sender can delete this message for everyone';
      end if;
      if old.created_at < now() - interval '1 minute' then
        raise exception 'Messages can only be deleted for everyone within one minute';
      end if;
    end if;
    new.deleted_by := app_user_id();
    new.content := null;
    new.edited_at := old.edited_at;
  elsif new.content_redacted_at is distinct from old.content_redacted_at then
    if app_user_id() is not null then
      raise exception 'Only the retention job can redact archived message content';
    end if;
    if new.content_redacted_at is null then
      raise exception 'Redacted message content cannot be restored';
    end if;
    new.content := null;
    new.archive_status := 'redacted';
    new.edited_at := old.edited_at;
  elsif new.content is distinct from old.content then
    if old.sender_id <> app_user_id() then
      raise exception 'Only the sender can edit this message';
    end if;
    if old.kind <> 'text' then
      raise exception 'Only text messages can be edited';
    end if;
    if old.created_at < now() - interval '2 minutes' then
      raise exception 'Messages can only be edited within two minutes';
    end if;
    if new.content is null or char_length(btrim(new.content)) = 0 then
      raise exception 'Edited message content cannot be empty';
    end if;
    new.content := btrim(new.content);
    new.edited_at := now();
  elsif new.deleted_by is distinct from old.deleted_by then
    raise exception 'Message deletion metadata cannot be changed directly';
  elsif new.edited_at is distinct from old.edited_at then
    raise exception 'Message edit metadata cannot be changed directly';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_enforce_update_rules on messages;
create trigger messages_enforce_update_rules before update on messages
for each row execute function enforce_message_update_rules();

create or replace function set_conversation_last_message()
returns trigger
language plpgsql
as $$
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_set_conversation_last_message on messages;
create trigger messages_set_conversation_last_message after insert on messages
for each row execute function set_conversation_last_message();

create or replace function user_is_conversation_participant(conversation uuid, user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from conversations
    where id = conversation
      and (user_one_id = user_id or user_two_id = user_id)
  )
  or exists (
    select 1 from conversation_members
    where conversation_id = conversation
      and conversation_members.user_id = user_id
  )
$$;

create or replace function user_can_manage_conversation(conversation uuid, user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from conversation_members
    where conversation_id = conversation
      and conversation_members.user_id = user_id
      and role in ('owner', 'admin')
  )
$$;

create or replace function enforce_group_member_limit()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*)
    from conversation_members
    where conversation_id = new.conversation_id
  ) >= 10 then
    raise exception 'Groups are limited to 10 members for now.';
  end if;

  return new;
end;
$$;

drop trigger if exists conversation_members_limit on conversation_members;
create trigger conversation_members_limit before insert on conversation_members
for each row execute function enforce_group_member_limit();

create or replace function users_are_blocked(a text, b text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  )
$$;

create or replace function user_can_view_profile(target_user_id text, viewer_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_user_id = viewer_user_id
    or exists (
      select 1
      from friendships
      where status = 'accepted'
        and (
          (requester_id = viewer_user_id and addressee_id = target_user_id)
          or
          (requester_id = target_user_id and addressee_id = viewer_user_id)
        )
    )
    or exists (
      select 1
      from conversations c
      where c.type = 'direct'
        and (
          (c.user_one_id = viewer_user_id and c.user_two_id = target_user_id)
          or
          (c.user_one_id = target_user_id and c.user_two_id = viewer_user_id)
        )
    )
    or exists (
      select 1
      from conversation_members me
      join conversation_members them
        on them.conversation_id = me.conversation_id
      where me.user_id = viewer_user_id
        and them.user_id = target_user_id
    )
$$;

create or replace function get_or_create_direct_conversation(other_user_id text)
returns conversations
language sql
security definer
set search_path = public
as $$
  with ctx as (
    select app_user_id() as current_user_id
  ),
  existing as (
    select c.*
    from conversations c, ctx
    where c.type = 'direct'
      and (
        (c.user_one_id = ctx.current_user_id and c.user_two_id = other_user_id)
        or
        (c.user_one_id = other_user_id and c.user_two_id = ctx.current_user_id)
      )
    limit 1
  ),
  inserted as (
    insert into conversations (type, user_one_id, user_two_id)
    select 'direct', least(ctx.current_user_id, other_user_id), greatest(ctx.current_user_id, other_user_id)
    from ctx
    where ctx.current_user_id is not null
      and other_user_id is not null
      and other_user_id <> ctx.current_user_id
      and exists (select 1 from user_profiles where id = other_user_id)
      and not users_are_blocked(ctx.current_user_id, other_user_id)
      and not exists (select 1 from existing)
    on conflict (least(user_one_id, user_two_id), greatest(user_one_id, user_two_id)) do nothing
    returning *
  )
  select *
  from inserted
  union all
  select *
  from existing
  limit 1;
$$;

grant execute on function get_or_create_direct_conversation(text) to anon, authenticated;

create or replace function mark_conversation_read(
  p_conversation_id uuid,
  p_read_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id text := app_user_id();
  read_at timestamptz := coalesce(p_read_at, now());
  touched integer := 0;
begin
  if current_user_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  if p_conversation_id is null then
    raise exception 'Conversation is required.' using errcode = '22023';
  end if;

  if not user_is_conversation_participant(p_conversation_id, current_user_id) then
    raise exception 'Only participants can mark read.' using errcode = '42501';
  end if;

  update conversation_members
  set last_read_at = read_at
  where conversation_id = p_conversation_id
    and user_id = current_user_id;
  get diagnostics touched = row_count;

  if touched = 0 then
    insert into conversation_members (conversation_id, user_id, role, last_read_at)
    values (p_conversation_id, current_user_id, 'member', read_at)
    on conflict (conversation_id, user_id)
    do update set last_read_at = excluded.last_read_at;
  end if;
end;
$$;

grant execute on function mark_conversation_read(uuid, timestamptz) to anon, authenticated;

create or replace function clear_group_messages_for_everyone(
  p_conversation_id uuid,
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id text := app_user_id();
  deleted_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  if p_conversation_id is null then
    raise exception 'Conversation is required.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from conversations
    where id = p_conversation_id
      and type = 'group'
  ) then
    raise exception 'Group conversation not found.' using errcode = '22023';
  end if;

  if not user_can_manage_conversation(p_conversation_id, current_user_id) then
    raise exception 'Only owner/admin can clear group messages.' using errcode = '42501';
  end if;

  perform set_config('comms.group_clear', '1', true);

  with affected as (
    select id
    from messages
    where conversation_id = p_conversation_id
      and deleted_for_everyone_at is null
      and (p_start is null or created_at >= p_start)
      and (p_end is null or created_at <= p_end)
  )
  update messages m
  set deleted_for_everyone_at = now(),
      deleted_by = current_user_id
  from affected
  where m.id = affected.id;

  get diagnostics deleted_count = row_count;
  return coalesce(deleted_count, 0);
end;
$$;

grant execute on function clear_group_messages_for_everyone(uuid, timestamptz, timestamptz) to anon, authenticated;

alter table user_profiles enable row level security;
alter table notification_settings enable row level security;
alter table push_subscriptions enable row level security;
alter table backup_preferences enable row level security;
alter table archive_batches enable row level security;
alter table message_archives enable row level security;
alter table friendships enable row level security;
alter table blocks enable row level security;
alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table conversation_mutes enable row level security;
alter table conversation_pins enable row level security;
alter table messages enable row level security;
alter table message_deletions enable row level security;
alter table message_attachments enable row level security;
alter table message_attachment_chunks enable row level security;
alter table message_reactions enable row level security;
alter table call_sessions enable row level security;
alter table group_call_sessions enable row level security;
alter table group_call_participants enable row level security;
alter table meetings enable row level security;
alter table meeting_participants enable row level security;
alter table meeting_chat_messages enable row level security;
alter table meeting_whiteboard_strokes enable row level security;
alter table presence_events enable row level security;

drop policy if exists "profiles are searchable" on user_profiles;
create policy "profiles are searchable" on user_profiles
for select using (
  app_user_id() is not null
  and user_can_view_profile(id, app_user_id())
);

drop policy if exists "users insert own profile" on user_profiles;
create policy "users insert own profile" on user_profiles
for insert with check (id = app_user_id());

drop policy if exists "users update own profile" on user_profiles;
create policy "users update own profile" on user_profiles
for update using (id = app_user_id()) with check (id = app_user_id());

drop policy if exists "notification settings visible to owner" on notification_settings;
create policy "notification settings visible to owner" on notification_settings
for select using (user_id = app_user_id());

drop policy if exists "notification settings created by owner" on notification_settings;
create policy "notification settings created by owner" on notification_settings
for insert with check (user_id = app_user_id());

drop policy if exists "notification settings updated by owner" on notification_settings;
create policy "notification settings updated by owner" on notification_settings
for update using (user_id = app_user_id())
with check (user_id = app_user_id());

drop policy if exists "push subscriptions visible to owner" on push_subscriptions;
create policy "push subscriptions visible to owner" on push_subscriptions
for select using (user_id = app_user_id());

drop policy if exists "push subscriptions created by owner" on push_subscriptions;
create policy "push subscriptions created by owner" on push_subscriptions
for insert with check (user_id = app_user_id());

drop policy if exists "push subscriptions updated by owner" on push_subscriptions;
create policy "push subscriptions updated by owner" on push_subscriptions
for update using (user_id = app_user_id())
with check (user_id = app_user_id());

drop policy if exists "push subscriptions removed by owner" on push_subscriptions;
create policy "push subscriptions removed by owner" on push_subscriptions
for delete using (user_id = app_user_id());

drop policy if exists "backup preferences visible to owner" on backup_preferences;
create policy "backup preferences visible to owner" on backup_preferences
for select using (user_id = app_user_id());

drop policy if exists "backup preferences created by owner" on backup_preferences;
create policy "backup preferences created by owner" on backup_preferences
for insert with check (user_id = app_user_id());

drop policy if exists "backup preferences updated by owner" on backup_preferences;
create policy "backup preferences updated by owner" on backup_preferences
for update using (user_id = app_user_id())
with check (user_id = app_user_id());

drop policy if exists "archive batches visible to owner" on archive_batches;
create policy "archive batches visible to owner" on archive_batches
for select using (user_id = app_user_id());

drop policy if exists "message archives visible to owner" on message_archives;
create policy "message archives visible to owner" on message_archives
for select using (user_id = app_user_id());

drop policy if exists "friendships visible to participants" on friendships;
create policy "friendships visible to participants" on friendships
for select using (app_user_id() in (requester_id, addressee_id));

drop policy if exists "friendships created by requester" on friendships;
create policy "friendships created by requester" on friendships
for insert with check (requester_id = app_user_id() and not users_are_blocked(requester_id, addressee_id));

drop policy if exists "friendships mutable by participants" on friendships;
create policy "friendships mutable by participants" on friendships
for update using (app_user_id() in (requester_id, addressee_id))
with check (app_user_id() in (requester_id, addressee_id));

drop policy if exists "friendships deletable by participants" on friendships;
create policy "friendships deletable by participants" on friendships
for delete using (app_user_id() in (requester_id, addressee_id));

drop policy if exists "blocks visible to blocker" on blocks;
create policy "blocks visible to blocker" on blocks
for select using (blocker_id = app_user_id());

drop policy if exists "blocks created by blocker" on blocks;
create policy "blocks created by blocker" on blocks
for insert with check (blocker_id = app_user_id());

drop policy if exists "blocks removed by blocker" on blocks;
create policy "blocks removed by blocker" on blocks
for delete using (blocker_id = app_user_id());

drop policy if exists "conversations visible to participants" on conversations;
create policy "conversations visible to participants" on conversations
for select using (user_is_conversation_participant(id, app_user_id()) or created_by = app_user_id());

drop policy if exists "conversations created by participant" on conversations;
create policy "conversations created by participant" on conversations
for insert with check (
  (
    type = 'direct'
    and app_user_id() in (user_one_id, user_two_id)
    and exists (select 1 from user_profiles where id = user_one_id)
    and exists (select 1 from user_profiles where id = user_two_id)
    and not users_are_blocked(user_one_id, user_two_id)
  )
  or
  (type = 'group' and created_by = app_user_id())
);

drop policy if exists "conversations updated by participants" on conversations;
create policy "conversations updated by participants" on conversations
for update using (
  (type = 'direct' and app_user_id() in (user_one_id, user_two_id))
  or
  (type = 'group' and user_can_manage_conversation(id, app_user_id()))
)
with check (
  (type = 'direct' and app_user_id() in (user_one_id, user_two_id))
  or
  (type = 'group' and user_can_manage_conversation(id, app_user_id()))
);

drop policy if exists "conversation members visible to members" on conversation_members;
create policy "conversation members visible to members" on conversation_members
for select using (user_is_conversation_participant(conversation_id, app_user_id()));

drop policy if exists "conversation members can join created group" on conversation_members;
create policy "conversation members can join created group" on conversation_members
for insert with check (
  user_id = app_user_id()
  or user_can_manage_conversation(conversation_id, app_user_id())
  or exists (
    select 1 from conversations
    where conversations.id = conversation_id
      and conversations.type = 'group'
      and conversations.created_by = app_user_id()
  )
);

drop policy if exists "conversation members manageable by admins" on conversation_members;
create policy "conversation members manageable by admins" on conversation_members
for update using (user_can_manage_conversation(conversation_id, app_user_id()))
with check (user_can_manage_conversation(conversation_id, app_user_id()));

drop policy if exists "conversation members can update own read state" on conversation_members;
create policy "conversation members can update own read state" on conversation_members
for update using (user_id = app_user_id())
with check (user_id = app_user_id());

drop policy if exists "conversation members removable" on conversation_members;
create policy "conversation members removable" on conversation_members
for delete using (user_id = app_user_id() or user_can_manage_conversation(conversation_id, app_user_id()));

drop policy if exists "conversation mutes visible to owner" on conversation_mutes;
create policy "conversation mutes visible to owner" on conversation_mutes
for select using (user_id = app_user_id());

drop policy if exists "conversation mutes created by owner" on conversation_mutes;
create policy "conversation mutes created by owner" on conversation_mutes
for insert with check (user_id = app_user_id() and user_is_conversation_participant(conversation_id, app_user_id()));

drop policy if exists "conversation mutes updated by owner" on conversation_mutes;
create policy "conversation mutes updated by owner" on conversation_mutes
for update using (user_id = app_user_id())
with check (user_id = app_user_id() and user_is_conversation_participant(conversation_id, app_user_id()));

drop policy if exists "conversation mutes removed by owner" on conversation_mutes;
create policy "conversation mutes removed by owner" on conversation_mutes
for delete using (user_id = app_user_id());

drop policy if exists "conversation pins visible to owner" on conversation_pins;
create policy "conversation pins visible to owner" on conversation_pins
for select using (user_id = app_user_id());

drop policy if exists "conversation pins created by owner" on conversation_pins;
create policy "conversation pins created by owner" on conversation_pins
for insert with check (user_id = app_user_id() and user_is_conversation_participant(conversation_id, app_user_id()));

drop policy if exists "conversation pins removed by owner" on conversation_pins;
create policy "conversation pins removed by owner" on conversation_pins
for delete using (user_id = app_user_id());

drop policy if exists "messages visible to participants" on messages;
create policy "messages visible to participants" on messages
for select using (
  user_is_conversation_participant(conversation_id, app_user_id())
  and not exists (
    select 1 from message_deletions
    where message_deletions.message_id = messages.id
      and message_deletions.user_id = app_user_id()
  )
);

drop policy if exists "messages inserted by sender" on messages;
create policy "messages inserted by sender" on messages
for insert with check (
  sender_id = app_user_id()
  and user_is_conversation_participant(conversation_id, app_user_id())
  and not exists (
    select 1 from conversations
    where conversations.id = conversation_id
      and conversations.type = 'direct'
      and users_are_blocked(conversations.user_one_id, conversations.user_two_id)
  )
);

drop policy if exists "message status update by participants" on messages;
create policy "message status update by participants" on messages
for update using (user_is_conversation_participant(conversation_id, app_user_id()))
with check (user_is_conversation_participant(conversation_id, app_user_id()));

drop policy if exists "message deletions visible to owner" on message_deletions;
create policy "message deletions visible to owner" on message_deletions
for select using (user_id = app_user_id());

drop policy if exists "message deletions created by owner" on message_deletions;
create policy "message deletions created by owner" on message_deletions
for insert with check (
  user_id = app_user_id()
  and exists (
    select 1 from messages
    where messages.id = message_id
      and user_is_conversation_participant(messages.conversation_id, app_user_id())
  )
);

drop policy if exists "attachments visible to participants" on message_attachments;
create policy "attachments visible to participants" on message_attachments
for select using (
  exists (
    select 1 from messages
    where messages.id = message_id
      and messages.deleted_for_everyone_at is null
      and user_is_conversation_participant(messages.conversation_id, app_user_id())
  )
);

drop policy if exists "attachments created by sender" on message_attachments;
create policy "attachments created by sender" on message_attachments
for insert with check (
  exists (
    select 1 from messages
    where messages.id = message_id
      and messages.sender_id = app_user_id()
      and user_is_conversation_participant(messages.conversation_id, app_user_id())
  )
);

drop policy if exists "attachment chunks visible to participants" on message_attachment_chunks;
create policy "attachment chunks visible to participants" on message_attachment_chunks
for select using (
  exists (
    select 1
    from message_attachments
    join messages on messages.id = message_attachments.message_id
    where message_attachments.id = message_attachment_chunks.attachment_id
      and messages.deleted_for_everyone_at is null
      and user_is_conversation_participant(messages.conversation_id, app_user_id())
  )
);

drop policy if exists "attachment chunks created by sender" on message_attachment_chunks;
create policy "attachment chunks created by sender" on message_attachment_chunks
for insert with check (
  exists (
    select 1
    from message_attachments
    join messages on messages.id = message_attachments.message_id
    where message_attachments.id = message_attachment_chunks.attachment_id
      and messages.sender_id = app_user_id()
      and user_is_conversation_participant(messages.conversation_id, app_user_id())
  )
);

drop policy if exists "reactions visible to participants" on message_reactions;
create policy "reactions visible to participants" on message_reactions
for select using (
  exists (
    select 1 from messages
    where messages.id = message_id
      and messages.deleted_for_everyone_at is null
      and user_is_conversation_participant(messages.conversation_id, app_user_id())
  )
);

drop policy if exists "reactions created by participants" on message_reactions;
create policy "reactions created by participants" on message_reactions
for insert with check (
  user_id = app_user_id()
  and exists (
    select 1 from messages
    where messages.id = message_id
      and messages.deleted_for_everyone_at is null
      and user_is_conversation_participant(messages.conversation_id, app_user_id())
  )
);

drop policy if exists "reactions removable by author" on message_reactions;
create policy "reactions removable by author" on message_reactions
for delete using (user_id = app_user_id());

drop policy if exists "call sessions visible to participants" on call_sessions;
create policy "call sessions visible to participants" on call_sessions
for select using (app_user_id() in (caller_id, callee_id));

drop policy if exists "call sessions created by caller" on call_sessions;
create policy "call sessions created by caller" on call_sessions
for insert with check (caller_id = app_user_id() and not users_are_blocked(caller_id, callee_id));

drop policy if exists "call sessions updated by participants" on call_sessions;
create policy "call sessions updated by participants" on call_sessions
for update using (app_user_id() in (caller_id, callee_id))
with check (app_user_id() in (caller_id, callee_id));

drop policy if exists "group call sessions visible to members" on group_call_sessions;
create policy "group call sessions visible to members" on group_call_sessions
for select using (user_is_conversation_participant(conversation_id, app_user_id()));

drop policy if exists "group call sessions created by members" on group_call_sessions;
create policy "group call sessions created by members" on group_call_sessions
for insert with check (started_by = app_user_id() and user_is_conversation_participant(conversation_id, app_user_id()));

drop policy if exists "group call sessions updated by members" on group_call_sessions;
create policy "group call sessions updated by members" on group_call_sessions
for update using (user_is_conversation_participant(conversation_id, app_user_id()))
with check (user_is_conversation_participant(conversation_id, app_user_id()));

drop policy if exists "group call participants visible to members" on group_call_participants;
create policy "group call participants visible to members" on group_call_participants
for select using (
  exists (
    select 1 from group_call_sessions
    where group_call_sessions.id = session_id
      and user_is_conversation_participant(group_call_sessions.conversation_id, app_user_id())
  )
);

drop policy if exists "group call participants created by self" on group_call_participants;
create policy "group call participants created by self" on group_call_participants
for insert with check (
  user_id = app_user_id()
  and exists (
    select 1 from group_call_sessions
    where group_call_sessions.id = session_id
      and user_is_conversation_participant(group_call_sessions.conversation_id, app_user_id())
  )
);

drop policy if exists "group call participants updated by self" on group_call_participants;
create policy "group call participants updated by self" on group_call_participants
for update using (user_id = app_user_id())
with check (user_id = app_user_id());

drop policy if exists "authenticated users can open meeting links" on meetings;
create policy "authenticated users can open meeting links" on meetings
for select using (app_user_id() is not null);

drop policy if exists "users create own meetings" on meetings;
create policy "users create own meetings" on meetings
for insert with check (creator_id = app_user_id());

drop policy if exists "meeting creators update meetings" on meetings;
create policy "meeting creators update meetings" on meetings
for update using (
  creator_id = app_user_id()
  or user_is_meeting_creator(id)
)
with check (
  creator_id = app_user_id()
  or user_is_meeting_creator(id)
);

drop policy if exists "meeting participants visible to authenticated" on meeting_participants;
create policy "meeting participants visible to authenticated" on meeting_participants
for select using (app_user_id() is not null);

drop policy if exists "users can join meetings" on meeting_participants;
create policy "users can join meetings" on meeting_participants
for insert with check (user_id = app_user_id());

drop policy if exists "participants can update meeting state" on meeting_participants;
create policy "participants can update meeting state" on meeting_participants
for update using (user_id = app_user_id() or user_is_meeting_creator(meeting_id))
with check (user_id = app_user_id() or user_is_meeting_creator(meeting_id));

drop policy if exists "meeting chat visible to participants" on meeting_chat_messages;
create policy "meeting chat visible to participants" on meeting_chat_messages
for select using (
  exists (
    select 1 from meeting_participants
    where meeting_participants.meeting_id = meeting_chat_messages.meeting_id
      and meeting_participants.user_id = app_user_id()
  )
);

drop policy if exists "meeting chat written by participants" on meeting_chat_messages;
create policy "meeting chat written by participants" on meeting_chat_messages
for insert with check (
  sender_id = app_user_id()
  and exists (
    select 1 from meeting_participants
    where meeting_participants.meeting_id = meeting_chat_messages.meeting_id
      and meeting_participants.user_id = app_user_id()
      and meeting_participants.left_at is null
  )
);

drop policy if exists "meeting chat deleted by creators" on meeting_chat_messages;
create policy "meeting chat deleted by creators" on meeting_chat_messages
for delete using (user_is_meeting_creator(meeting_id));

drop policy if exists "whiteboard visible to participants" on meeting_whiteboard_strokes;
create policy "whiteboard visible to participants" on meeting_whiteboard_strokes
for select using (
  exists (
    select 1 from meeting_participants
    where meeting_participants.meeting_id = meeting_whiteboard_strokes.meeting_id
      and meeting_participants.user_id = app_user_id()
  )
);

drop policy if exists "whiteboard written by allowed participants" on meeting_whiteboard_strokes;
create policy "whiteboard written by allowed participants" on meeting_whiteboard_strokes
for insert with check (
  user_id = app_user_id()
  and exists (
    select 1 from meeting_participants
    where meeting_participants.meeting_id = meeting_whiteboard_strokes.meeting_id
      and meeting_participants.user_id = app_user_id()
      and meeting_participants.left_at is null
      and (meeting_participants.can_draw or meeting_participants.role in ('creator', 'co_creator'))
  )
);

drop policy if exists "whiteboard cleared by creators" on meeting_whiteboard_strokes;
create policy "whiteboard cleared by creators" on meeting_whiteboard_strokes
for delete using (user_is_meeting_creator(meeting_id));

drop policy if exists "presence visible to authenticated" on presence_events;
create policy "presence visible to authenticated" on presence_events
for select using (app_user_id() is not null);

drop policy if exists "presence written by self" on presence_events;
create policy "presence written by self" on presence_events
for insert with check (user_id = app_user_id());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'user_profiles',
    'notification_settings',
    'push_subscriptions',
    'backup_preferences',
    'archive_batches',
    'message_archives',
    'friendships',
    'blocks',
    'conversations',
    'conversation_members',
    'conversation_mutes',
    'conversation_pins',
    'messages',
    'message_deletions',
    'message_attachments',
    'message_attachment_chunks',
    'message_reactions',
    'call_sessions',
    'group_call_sessions',
    'group_call_participants'
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

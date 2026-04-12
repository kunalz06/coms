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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  url text not null,
  public_id text,
  resource_type text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes <= 10485760),
  created_at timestamptz not null default now()
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
create index if not exists conversations_user_one_idx on conversations(user_one_id);
create index if not exists conversations_user_two_idx on conversations(user_two_id);
create index if not exists conversations_type_idx on conversations(type);
create index if not exists conversation_members_user_idx on conversation_members(user_id);
create index if not exists conversation_members_conversation_idx on conversation_members(conversation_id);
create index if not exists messages_conversation_created_idx on messages(conversation_id, created_at desc);
create index if not exists call_sessions_participants_idx on call_sessions(caller_id, callee_id, started_at desc);
create index if not exists group_call_sessions_conversation_idx on group_call_sessions(conversation_id, started_at desc);
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

drop trigger if exists friendships_touch_updated_at on friendships;
create trigger friendships_touch_updated_at before update on friendships
for each row execute function touch_updated_at();

drop trigger if exists conversations_touch_updated_at on conversations;
create trigger conversations_touch_updated_at before update on conversations
for each row execute function touch_updated_at();

drop trigger if exists messages_touch_updated_at on messages;
create trigger messages_touch_updated_at before update on messages
for each row execute function touch_updated_at();

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
  ) >= 5 then
    raise exception 'Groups are limited to 5 members for now.';
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

alter table user_profiles enable row level security;
alter table friendships enable row level security;
alter table blocks enable row level security;
alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
alter table message_attachments enable row level security;
alter table call_sessions enable row level security;
alter table group_call_sessions enable row level security;
alter table group_call_participants enable row level security;
alter table presence_events enable row level security;

drop policy if exists "profiles are searchable" on user_profiles;
create policy "profiles are searchable" on user_profiles
for select using (app_user_id() is not null);

drop policy if exists "users insert own profile" on user_profiles;
create policy "users insert own profile" on user_profiles
for insert with check (id = app_user_id());

drop policy if exists "users update own profile" on user_profiles;
create policy "users update own profile" on user_profiles
for update using (id = app_user_id()) with check (id = app_user_id());

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
  (type = 'direct' and app_user_id() in (user_one_id, user_two_id) and not users_are_blocked(user_one_id, user_two_id))
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

drop policy if exists "messages visible to participants" on messages;
create policy "messages visible to participants" on messages
for select using (user_is_conversation_participant(conversation_id, app_user_id()));

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

drop policy if exists "attachments visible to participants" on message_attachments;
create policy "attachments visible to participants" on message_attachments
for select using (
  exists (
    select 1 from messages
    where messages.id = message_id
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
    'friendships',
    'blocks',
    'conversations',
    'conversation_members',
    'messages',
    'message_attachments',
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

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

alter table meetings enable row level security;
alter table meeting_participants enable row level security;
alter table meeting_chat_messages enable row level security;
alter table meeting_whiteboard_strokes enable row level security;

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

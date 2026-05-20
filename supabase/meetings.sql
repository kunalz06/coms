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

create or replace function guard_meeting_participant_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id text := app_user_id();
  actor_can_manage boolean;
  co_creator_count integer;
begin
  if current_user_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  if new.meeting_id <> old.meeting_id or new.user_id <> old.user_id then
    raise exception 'Meeting participant identity cannot be changed.' using errcode = '42501';
  end if;

  select exists (
    select 1 from meeting_participants
    where meeting_id = old.meeting_id
      and user_id = current_user_id
      and role in ('creator', 'co_creator')
  ) into actor_can_manage;

  if old.role = 'creator' and new.role <> 'creator' then
    raise exception 'The meeting creator cannot be demoted.' using errcode = '42501';
  end if;

  if new.role = 'creator' and old.role <> 'creator' then
    raise exception 'Only one meeting creator is allowed.' using errcode = '42501';
  end if;

  if (new.role is distinct from old.role or new.can_draw is distinct from old.can_draw)
     and not actor_can_manage then
    raise exception 'Only the meeting creator or co-creators can change roles or whiteboard permissions.' using errcode = '42501';
  end if;

  if new.role = 'co_creator' and old.role <> 'co_creator' then
    select count(*) from meeting_participants
    where meeting_id = old.meeting_id
      and user_id <> old.user_id
      and role = 'co_creator'
    into co_creator_count;

    if co_creator_count >= 2 then
      raise exception 'A meeting can have only two co-creators.' using errcode = '23514';
    end if;
  end if;

  if current_user_id <> old.user_id and not actor_can_manage then
    raise exception 'Only the participant or a meeting creator can update this row.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists meeting_participants_guard_update on meeting_participants;
create trigger meeting_participants_guard_update before update on meeting_participants
for each row execute function guard_meeting_participant_update();

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
for insert with check (
  user_id = app_user_id()
  and exists (
    select 1 from meetings
    where meetings.id = meeting_participants.meeting_id
      and meetings.status <> 'ended'
  )
  and (
    role = 'participant'
    or (
      role = 'creator'
      and exists (
        select 1 from meetings
        where meetings.id = meeting_participants.meeting_id
          and meetings.creator_id = app_user_id()
      )
    )
  )
);

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
    select 1 from meetings
    where meetings.id = meeting_chat_messages.meeting_id
      and meetings.status = 'live'
  )
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
    select 1 from meetings
    where meetings.id = meeting_whiteboard_strokes.meeting_id
      and meetings.status = 'live'
  )
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

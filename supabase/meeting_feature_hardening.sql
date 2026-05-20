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

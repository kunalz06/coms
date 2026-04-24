-- COMMS safe apply blocks
-- Run this file top-to-bottom in Supabase SQL Editor.
-- This avoids replaying full schema.sql and focuses on the patched function/RPC layer.

-- =========================================================
-- Block 1: Message update rules trigger function
-- =========================================================
drop trigger if exists messages_enforce_update_rules on messages;
drop function if exists enforce_message_update_rules();

create or replace function enforce_message_update_rules()
returns trigger
language plpgsql
as $enf$
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
$enf$;

create trigger messages_enforce_update_rules
before update on messages
for each row execute function enforce_message_update_rules();

-- =========================================================
-- Block 2: Direct conversation helper
-- =========================================================
drop function if exists get_or_create_direct_conversation(text);

create or replace function get_or_create_direct_conversation(other_user_id text)
returns conversations
language sql
security definer
set search_path = public
as $dir$
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
$dir$;

grant execute on function get_or_create_direct_conversation(text) to anon, authenticated;

-- =========================================================
-- Block 3: Read marker RPC
-- =========================================================
drop function if exists mark_conversation_read(uuid, timestamptz);

create or replace function mark_conversation_read(
  p_conversation_id uuid,
  p_read_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $read$
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
$read$;

grant execute on function mark_conversation_read(uuid, timestamptz) to anon, authenticated;

-- =========================================================
-- Block 4: Group clear RPC with deleted count
-- =========================================================
drop function if exists clear_group_messages_for_everyone(uuid, timestamptz, timestamptz);

create or replace function clear_group_messages_for_everyone(
  p_conversation_id uuid,
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $clr$
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
$clr$;

grant execute on function clear_group_messages_for_everyone(uuid, timestamptz, timestamptz) to anon, authenticated;

-- =========================================================
-- Block 5: One Google account -> one COMMS account backup link
-- =========================================================
drop index if exists backup_preferences_google_drive_email_unique;

create unique index backup_preferences_google_drive_email_unique
on backup_preferences (lower(google_drive_email))
where google_drive_email is not null
  and provider = 'google_drive';

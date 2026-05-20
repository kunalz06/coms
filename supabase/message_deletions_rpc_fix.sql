create or replace function delete_message_for_me(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id text := app_user_id();
  target_conversation_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  select conversation_id into target_conversation_id
  from messages
  where id = p_message_id;

  if target_conversation_id is null then
    raise exception 'Message not found.' using errcode = '22023';
  end if;

  if not user_is_conversation_participant(target_conversation_id, current_user_id) then
    raise exception 'Only participants can delete this message for themselves.' using errcode = '42501';
  end if;

  insert into message_deletions (message_id, user_id)
  values (p_message_id, current_user_id)
  on conflict (message_id, user_id) do nothing;
end;
$$;

grant execute on function delete_message_for_me(uuid) to anon, authenticated;

create or replace function clear_conversation_for_me(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id text := app_user_id();
begin
  if current_user_id is null then
    raise exception 'Not authenticated.' using errcode = '42501';
  end if;

  if not user_is_conversation_participant(p_conversation_id, current_user_id) then
    raise exception 'Only participants can clear this conversation for themselves.' using errcode = '42501';
  end if;

  insert into message_deletions (message_id, user_id)
  select id, current_user_id
  from messages
  where conversation_id = p_conversation_id
  on conflict (message_id, user_id) do nothing;
end;
$$;

grant execute on function clear_conversation_for_me(uuid) to anon, authenticated;

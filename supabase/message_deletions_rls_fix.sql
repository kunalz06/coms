drop policy if exists "message deletions updated by owner" on message_deletions;
create policy "message deletions updated by owner" on message_deletions
for update using (user_id = app_user_id())
with check (
  user_id = app_user_id()
  and exists (
    select 1 from messages
    where messages.id = message_id
      and user_is_conversation_participant(messages.conversation_id, app_user_id())
  )
);

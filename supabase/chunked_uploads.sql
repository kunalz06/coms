-- Large chunked document upload support for the Flutter web client.
-- Run this once in Supabase SQL editor before testing files above 10 MB.

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

alter table message_attachment_chunks enable row level security;

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

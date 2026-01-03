
alter table public.users add column if not exists pinned_chat_ids text[] default '{}';

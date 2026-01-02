
-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- Create chats table
create table public.chats (
  id uuid default uuid_generate_v4() primary key,
  user_ids text[] not null default '{}',
  type text default 'direct',
  group_name text default '',
  admin_ids text[] default '{}',
  users jsonb default '{}'::jsonb,
  last_message text default '',
  last_updated timestamptz default now(),
  pending_user_ids text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create messages table
create table public.messages (
  id uuid default uuid_generate_v4() primary key,
  chat_id uuid references public.chats(id) on delete cascade,
  sender_id text not null,
  sender_name text,
  sender_photo text,
  text text default '',
  file_url text,
  file_type text,
  file_name text,
  read_by text[] default '{}',
  created_at timestamptz default now()
);

-- Note: RLS policies are optional if using service_role key in API routes,
-- but recommended if you ever access these tables from the client.
alter table public.chats enable row level security;
alter table public.messages enable row level security;

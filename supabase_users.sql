
-- Create users table to mirror Firebase Auth + Session Management
create table if not exists public.users (
  id text primary key, -- Firebase UID
  email text,
  username text,
  photo_url text, -- mapped from photoURL
  session_id text, -- For single instance enforcement
  status text default 'offline',
  last_seen timestamptz default now(),
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.users enable row level security;

-- Policy: Everyone can read users (for search/profile)
create policy "Allow public read users" on public.users for select using (true);

-- Policy: Users can update themselves (or Service Role bypass)
create policy "Allow individual update" on public.users for update using (auth.uid()::text = id);
create policy "Allow individual insert" on public.users for insert with check (auth.uid()::text = id);

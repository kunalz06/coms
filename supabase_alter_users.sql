
-- Run this SQL in your Supabase SQL Editor to migrate the schema
-- for the new compression requirements.

-- 1. Alter 'chats' table 'users' column.
-- Currently it is JSONB. We want to store a compressed Base64 string, so we need to change it to TEXT.
-- WARNING: This will stringify existing JSONB data. If you had existing data, it won't be compressed yet,
-- but standard text. Our code handles decompression failure by returning the text as-is, so this is safe.

ALTER TABLE public.chats
ALTER COLUMN users TYPE text USING users::text;

-- 2. 'group_name' is already text, so it can hold compressed strings.
-- 3. 'last_message' (chats) is already text.
-- 4. 'sender_name' (messages) is already text.
-- 5. 'text' (messages) is already text.

-- No other schema changes are strictly necessary for storing base64 strings in text columns.

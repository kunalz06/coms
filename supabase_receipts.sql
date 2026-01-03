-- Create Receipts table to track status of messages even after they are deleted from buffer
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL, 
    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
    -- user_id is TEXT because it might reference Firebase UID or public.users where id is text
    -- We removed the FK constraint to users(id) to allow flexibility/avoid type mismatch
    user_id TEXT NOT NULL, 
    status TEXT DEFAULT 'delivered', -- 'delivered', 'read'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS receipts_chat_id_idx ON receipts(chat_id);
CREATE INDEX IF NOT EXISTS receipts_message_id_idx ON receipts(message_id);

-- RLS Policies
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;

-- Users can insert their own receipts
CREATE POLICY "Users can insert their own receipts" ON receipts FOR INSERT
    WITH CHECK (auth.uid()::text = user_id);

-- Users can view receipts for chats they belong to
CREATE POLICY "Users can view receipts in their chats" ON receipts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chats
            WHERE id = receipts.chat_id
            AND auth.uid()::text = ANY(user_ids)
        )
    );

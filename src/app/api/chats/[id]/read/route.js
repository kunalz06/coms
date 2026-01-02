import { supabaseAdmin as supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function POST(request, context) {
    const { params } = context;
    const { id: chatId } = await params;
    const { userId } = await request.json();

    if (!chatId || !userId) {
        return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    try {
        // We want to append userId to read_by array for all messages in this chat
        // where userId is NOT already in read_by.
        // Supabase doesn't support sophisticated "array_append if not exists" in a simple JS call easily without RPC.
        // However, we can use a raw RPC query or just fetch IDs and update.
        // Fetching IDs is safer for now.

        // 1. Fetch unread messages for this user
        const { data: unreadMessages, error: fetchError } = await supabase
            .from('messages')
            .select('id, read_by')
            .eq('chat_id', chatId)
            .not('read_by', 'cs', `{${userId}}`); // cs = contains (so NOT contains)

        if (fetchError) throw fetchError;

        if (!unreadMessages || unreadMessages.length === 0) {
            return NextResponse.json({ success: true, count: 0 });
        }

        // 2. Update them. 
        // We can't do bulk update with different values easily, but here the value modification is same: append userId.
        // Actually, we can't easily do "append" via .update() on multiple rows unless we use a Postgres Function.
        // For MVP, loop and update (slow) OR create an RPC.
        // Or simpler: Just define a "mark_messages_read" RPC in SQL.

        // Let's try the looping approach for now (messages in a session aren't usually thousands).
        // Or better: Use map to generate promises.

        const updates = unreadMessages.map(msg => {
            const newReadBy = [...(msg.read_by || []), userId];
            return supabase
                .from('messages')
                .update({ read_by: newReadBy })
                .eq('id', msg.id);
        });

        await Promise.all(updates);

        return NextResponse.json({ success: true, count: updates.length });

    } catch (error) {
        console.error("Read receipt error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

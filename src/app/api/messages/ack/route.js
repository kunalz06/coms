import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request) {
    try {
        const { messageIds, userId } = await request.json();

        if (!messageIds || !messageIds.length || !userId) {
            return NextResponse.json({ success: false, error: "Missing ids or userId" }, { status: 400 });
        }

        // Logic:
        // 1. For each message, check who needs to receive it (pending_user_ids or check chat members).
        // 2. Remove current `userId` from that list.
        // 3. If list is empty, DELETE message.

        // However, `messages` table schema currently lacks `pending_recipients`. 
        // We will assume `read_by` tracks who received it?
        // Or we implement a simplified logic as requested: "as soon as user B gets online it dumps the message to that file and deletes it"

        // IMPORTANT: We need to know the Chat ID to find other members.
        // But we have a list of messageIds.

        // Let's iterate efficiently.
        for (const msgId of messageIds) {
            // Get current message data
            const { data: msg } = await supabaseAdmin
                .from('messages')
                .select('chat_id, read_by')
                .eq('id', msgId)
                .single();

            if (!msg) continue;

            // Get Chat Members
            const { data: chat } = await supabaseAdmin
                .from('chats')
                .select('user_ids')
                .eq('id', msg.chat_id)
                .single();

            if (!chat) continue;

            const allMembers = chat.user_ids || [];
            const currentReadBy = msg.read_by || [];

            // 1. Insert RECEIPT (Persistent Status)
            try {
                await supabaseAdmin.from('receipts').insert({
                    message_id: msgId,
                    chat_id: msg.chat_id,
                    user_id: userId,
                    status: 'read'
                });
            } catch (ignore) {
                // Ignore if duplicate (though UUID PK prevents it usually)
                console.warn("Receipt insert failed or ignored", ignore.message);
            }

            // 2. Add current user to read_by (Buffer Status)
            const newReadBy = [...new Set([...currentReadBy, userId])];

            // 3. Check if ALL members have ACK'd
            const allReceived = allMembers.every(uid => newReadBy.includes(uid));

            if (allReceived) {
                // DELETE MESSAGE
                await supabaseAdmin
                    .from('messages')
                    .delete()
                    .eq('id', msgId);
                console.log(`[ACK] Message ${msgId} fully delivered. Deleted.`);
            } else {
                // UPDATE read_by
                await supabaseAdmin
                    .from('messages')
                    .update({ read_by: newReadBy })
                    .eq('id', msgId);
                console.log(`[ACK] Message ${msgId} ACK'd by ${userId}. Remaining: ${allMembers.length - newReadBy.length}`);
            }
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("ACK Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

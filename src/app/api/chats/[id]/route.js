import { supabaseAdmin as supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import { compressText, decompressText, compressJSON, decompressJSON } from '@/lib/compression';

function mapChatToApp(chat) {
    if (!chat) return null;
    return {
        _id: chat.id,
        id: chat.id,
        userIds: chat.user_ids || [],
        type: chat.type,
        groupName: decompressText(chat.group_name),
        adminIds: chat.admin_ids || [],
        users: decompressJSON(chat.users),
        lastMessage: decompressText(chat.last_message),
        lastUpdated: chat.last_updated,
        pendingUserIds: chat.pending_user_ids || [],
        createdAt: chat.created_at,
        updatedAt: chat.updated_at
    };
}

export async function PATCH(request, context) {
    const { params } = context;
    const { id } = await params;

    try {
        const body = await request.json();

        const fieldMap = {
            userIds: 'user_ids',
            type: 'type',
            groupName: 'group_name',
            adminIds: 'admin_ids',
            users: 'users',
            lastMessage: 'last_message',
            lastUpdated: 'last_updated',
            pendingUserIds: 'pending_user_ids'
        };

        const updates = {};
        Object.keys(body).forEach(key => {
            if (fieldMap[key]) {
                if (key === 'lastMessage' || key === 'groupName') {
                    updates[fieldMap[key]] = compressText(body[key] || '');
                } else if (key === 'users') {
                    updates[fieldMap[key]] = compressJSON(body[key]);
                } else {
                    updates[fieldMap[key]] = body[key];
                }
            }
        });

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ success: true, data: null }); // No updates
        }

        const { data, error } = await supabase
            .from('chats')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

        return NextResponse.json({ success: true, data: mapChatToApp(data) });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function DELETE(request, { params }) {
    try {
        const { id } = await params;

        // Cascade delete messages first
        const { error: msgError } = await supabase
            .from('messages')
            .delete()
            .eq('chat_id', id);

        if (msgError) throw msgError;

        // Delete chat
        const { data, error } = await supabase
            .from('chats')
            .delete()
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        if (!data) {
            return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, data: {} });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

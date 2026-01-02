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
        users: decompressJSON(chat.users), // Now a string in DB
        lastMessage: decompressText(chat.last_message),
        lastUpdated: chat.last_updated,
        pendingUserIds: chat.pending_user_ids || [],
        createdAt: chat.created_at,
        updatedAt: chat.updated_at
    };
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return NextResponse.json({ error: 'UserId required' }, { status: 400 });
    }

    try {
        // Find chats where userIds array contains the userId OR pendingUserIds contains userId
        const { data: chats, error } = await supabase
            .from('chats')
            .select('*')
            .or(`user_ids.cs.{${userId}},pending_user_ids.cs.{${userId}}`)
            .order('last_updated', { ascending: false });

        if (error) throw error;

        const mappedChats = chats.map(mapChatToApp);

        return NextResponse.json({ success: true, data: mappedChats });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();

        const dbBody = {
            user_ids: body.userIds,
            type: body.type,
            group_name: compressText(body.groupName || ''),
            admin_ids: body.adminIds,
            users: compressJSON(body.users || {}),
            last_message: compressText(body.lastMessage || ''),
            last_updated: body.lastUpdated || new Date(),
            pending_user_ids: body.pendingUserIds
        };

        const { data, error } = await supabase
            .from('chats')
            .insert(dbBody)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data: mapChatToApp(data) });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

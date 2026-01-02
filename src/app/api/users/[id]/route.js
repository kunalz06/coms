import { supabaseAdmin as supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function PATCH(request, context) {
    const { params } = context;
    const { id } = await params;

    try {
        const body = await request.json();

        // Map camelCase to snake_case
        const updates = {};
        if (body.pinnedChatIds) updates.pinned_chat_ids = body.pinnedChatIds;
        if (body.notificationsEnabled !== undefined) updates.notifications_enabled = body.notificationsEnabled;
        // Add other fields as needed

        const { data, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, data });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function GET(request, context) {
    const { params } = context;
    const { id } = await params;

    // Get user logic if needed
    return NextResponse.json({ success: true, data: {} });
}

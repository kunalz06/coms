import { supabaseAdmin as supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const userId = searchParams.get('userId');

    if (!query) {
        return NextResponse.json({ success: true, data: [] });
    }

    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .ilike('username', `%${query}%`)
            .limit(20);

        if (error) throw error;

        // Filter out current user
        const results = data
            .filter(u => u.id !== userId)
            .map(u => ({
                uid: u.id,
                username: u.username || u.email,
                photoURL: u.photo_url,
                status: u.status
            }));

        return NextResponse.json({ success: true, data: results });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

import { supabaseAdmin as supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const userId = searchParams.get('userId');

    console.log(`[Search API] Query: "${query}", UserId: "${userId}"`);

    if (!query) {
        console.log("[Search API] No query provided, returning empty list.");
        return NextResponse.json({ success: true, data: [] });
    }

    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .or(`username.ilike.%${query}%,email.ilike.%${query}%`)
            .limit(20);

        if (error) {
            console.error("[Search API] Supabase Error:", error);
            throw error;
        }

        console.log(`[Search API] Supabase returned ${data?.length || 0} results.`);

        // Filter out current user
        const results = data
            .filter(u => u.id !== userId)
            .map(u => ({
                uid: u.id,
                username: u.username || u.email,
                photoURL: u.photo_url,
                status: u.status
            }));

        console.log(`[Search API] Returned ${results.length} results after filtering.`);

        return NextResponse.json({ success: true, data: results });
    } catch (error) {
        console.error("[Search API] Exception:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

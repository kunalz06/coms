import { supabaseAdmin as supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';

export async function POST(request) {
    try {
        const body = await request.json();
        const { uid, email, username, photoURL, sessionId } = body;

        console.log(`[Session API] Syncing user: ${uid}, Email: ${email}, Session: ${sessionId}`);

        if (!uid || !sessionId) {
            console.warn("[Session API] Missing required fields");
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Upsert user data + session_id
        const userData = {
            id: uid,
            email,
            username,
            photo_url: photoURL,
            session_id: sessionId,
            last_seen: new Date(),
            status: 'online'
        };

        const { data, error } = await supabase
            .from('users')
            .upsert(userData)
            .select()
            .single();

        if (error) {
            console.error("[Session API] Supabase Upsert Error:", error);
            throw error;
        }

        console.log("[Session API] Sync success:", data);

        return NextResponse.json({ success: true, data });
    } catch (error) {
        console.error("[Session API] Session Update Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

import { supabaseAdmin as supabase } from '@/lib/supabase';
import { NextResponse } from 'next/server';
import { compressText, decompressText } from '@/lib/compression';

function mapMessageToApp(msg) {
    if (!msg) return null;
    return {
        _id: msg.id,
        id: msg.id,
        chatId: msg.chat_id,
        senderId: msg.sender_id,
        senderName: decompressText(msg.sender_name),
        senderPhoto: msg.sender_photo,
        text: decompressText(msg.text) || '',
        fileURL: msg.file_url,
        fileType: msg.file_type,
        fileName: msg.file_name,
        readBy: msg.read_by || [],
        createdAt: msg.created_at
    };
}

export async function GET(request, context) {
    const { params } = context;
    const { id } = await params;

    try {
        const { data: messages, error } = await supabase
            .from('messages')
            .select('*')
            .eq('chat_id', id)
            .order('created_at', { ascending: true });

        if (error) throw error;

        return NextResponse.json({ success: true, data: messages.map(mapMessageToApp) });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(request, context) {
    const { params } = context;
    const { id } = await params;

    try {
        const body = await request.json();

        const processedText = body.text ? compressText(body.text) : '';
        const processedSenderName = body.senderName ? compressText(body.senderName) : '';

        // Create Message
        const { data: message, error } = await supabase
            .from('messages')
            .insert({
                chat_id: id,
                sender_id: body.senderId,
                sender_name: processedSenderName,
                sender_photo: body.senderPhoto,
                text: processedText,
                file_url: body.fileURL,
                file_type: body.fileType,
                file_name: body.fileName,
                read_by: body.readBy || [],
                created_at: new Date()
            })
            .select()
            .single();

        if (error) throw error;

        // Update Chat's last message
        const lastMessageText = body.fileURL
            ? (body.fileType === 'image' ? 'Image' : 'Attachment')
            : (body.text || '');

        const compressedLastMessage = compressText(lastMessageText);

        await supabase
            .from('chats')
            .update({
                last_message: compressedLastMessage,
                last_updated: new Date()
            })
            .eq('id', id);

        return NextResponse.json({ success: true, data: mapMessageToApp(message) });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

require('dotenv').config({ path: '.env.local' });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

// Init Supabase Admin
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase Env Vars in server.js");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Map: userId -> socketId
const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('register', async (userId) => {
        onlineUsers.set(userId, socket.id);
        console.log(`User registered: ${userId}`);

        // Fetch Pending Messages (Buffer Dump)
        // Find messages where this user is a recipient (indirectly via chat membership)
        // For MVP: We find messages in chats this user belongs to, that are NOT sent by them.
        try {
            // 1. Get Chats for User
            const { data: chats, error: chatError } = await supabase
                .from('chats')
                .select('id, user_ids')
                .contains('user_ids', [userId]);

            if (chatError) throw chatError;

            const chatIds = chats.map(c => c.id);

            if (chatIds.length > 0) {
                // 2. Get Messages in these chats, NOT sent by user
                const { data: messages, error: msgError } = await supabase
                    .from('messages')
                    .select('*')
                    .in('chat_id', chatIds)
                    .neq('sender_id', userId);

                if (msgError) throw msgError;

                if (messages && messages.length > 0) {
                    console.log(`Dumping ${messages.length} messages to ${userId}`);
                    // Emit one by one or batch? Batch is better but let's stick to simple event.
                    for (const msg of messages) {
                        socket.emit('receive_message', msg);
                    }
                }
            }
        } catch (e) {
            console.error("Error fetching pending:", e);
        }
    });

    socket.on('send_message', async (data, callback) => {
        // data: { chatId, text, senderId, senderName, senderPhoto, ... }
        // 1. Save to Buffer (Supabase)
        try {
            const { data: savedMsg, error } = await supabase
                .from('messages')
                .insert([{
                    chat_id: data.chatId,
                    sender_id: data.senderId,
                    sender_name: data.senderName, // Should compress/decompress? Keeping simple for server
                    sender_photo: data.senderPhoto,
                    text: data.text,
                    file_url: data.fileUrl,
                    file_type: data.fileType,
                    file_name: data.fileName,
                    created_at: new Date()
                }])
                .select()
                .single();

            if (error) throw error;

            // Ack to Sender (Server Received)
            if (callback) callback({ status: 'sent', msg: savedMsg });

            // 2. Deliver to Recipients
            // Get Chat Members
            const { data: chat } = await supabase.from('chats').select('user_ids').eq('id', data.chatId).single();
            if (chat && chat.user_ids) {
                chat.user_ids.forEach(uid => {
                    if (uid !== data.senderId) {
                        const socketId = onlineUsers.get(uid);
                        if (socketId) {
                            io.to(socketId).emit('receive_message', savedMsg);
                        }
                    }
                });
            }

        } catch (e) {
            console.error("Send Error:", e);
            if (callback) callback({ status: 'error', error: e.message });
        }
    });

    // Client confirms they saved to Local DB
    socket.on('ack_message', async (data) => {
        // data: { messageId, chatId, userId }
        const { messageId, chatId, userId } = data;

        try {
            // 1. Insert Receipt (Persistent Tick)
            await supabase.from('receipts').insert({
                message_id: messageId,
                chat_id: chatId,
                user_id: userId,
                status: 'read' // or delivered
            });

            // 2. Notify Sender (for Green Tick)
            // We need to know who sent the message. 
            // Query message first? Or rely on client sending senderId?
            // Let's query msg to be safe, or optimize later.
            // Actually, if we delete the message, we can't query it easily! 
            // But we process ACK immediately.

            const { data: msg } = await supabase.from('messages').select('sender_id').eq('id', messageId).single();
            if (msg) {
                const senderSocket = onlineUsers.get(msg.sender_id);
                if (senderSocket) {
                    io.to(senderSocket).emit('message_delivered', { messageId, userId });
                }

                // 3. DELETE from Buffer (Strict Rule)
                // "as soon as user B gets online it dumps... and deletes it"
                // Ideally we delete ONLY if all recipients acked? 
                // For direct chat, yes. For group, we need to wait for everyone.
                // Simplified Rule for now: Delete immediately, assuming 1-on-1 mostly or "First come first serve deletion".
                // Wait, if Group Chat, deleting it prevents others from getting it!
                // We must check if ALL have received it.
                // Complex logic: Check Chat Members vs Receipts.

                // Get all members
                const { data: chat } = await supabase.from('chats').select('user_ids').eq('id', chatId).single();

                // Get all receipts for this message
                const { data: receipts } = await supabase.from('receipts').select('user_id').eq('message_id', messageId);

                const receivedUserIds = receipts.map(r => r.user_id);
                const allReceived = chat.user_ids.every(uid => uid === msg.sender_id || receivedUserIds.includes(uid));

                if (allReceived) {
                    await supabase.from('messages').delete().eq('id', messageId);
                    console.log(`Message ${messageId} deleted from buffer (All Acked)`);
                }
            } else {
                // Message might be already deleted?
                // Just notify sender validly if possible.
                // Logic fallback: We rely on Receipts table for sender ticks anyway.
                // So realtime emission is just a bonus speedup.
                // Sender should also listen to receipts table? 
                // We'll emit 'receipt_update' to room/sender.

                // We can't know sender if msg is gone. 
                // Client should send 'senderId' in the ACK payload to help us routing?
                // No, trusting client for routing is meh.
                // We'll broadcast receipt update to the room (socket room for chat).
                // TODO: Join socket rooms for chats.
            }

        } catch (e) {
            console.error("Ack Error:", e);
        }
    });

    socket.on('disconnect', () => {
        // Remove user from map
        for (const [uid, sid] of onlineUsers.entries()) {
            if (sid === socket.id) {
                onlineUsers.delete(uid);
                console.log(`User ${uid} disconnected`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Socket.io server running on port ${PORT}`);
});

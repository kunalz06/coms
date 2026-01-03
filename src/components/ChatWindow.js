"use client";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
// import { db } from "@/lib/firebase"; // Removed
// import { collection, onSnapshot... } from "firebase/firestore"; // Removed
import { supabase } from "@/lib/supabase";
import { useStorage } from "@/context/StorageContext";
import { decompressText, decompressJSON } from "@/lib/compression";
import { Send, Paperclip, Video, Phone, MoreVertical, Image as ImageIcon, File as FileIcon, UserPlus, X, ChevronLeft, Trash2, LogOut, Info, Shield, ShieldAlert, BadgeCheck, Eraser, Edit2, Check } from "lucide-react";
import clsx from "clsx";
import styles from "./ChatWindow.module.css";
import { compressImage } from "@/lib/utils";
import { useUI } from "@/context/UIContext";

export default function ChatWindow({ chat, onStartCall, onBack, socket }) {
    const { user } = useAuth();
    const { getMessages, addMessage, getReceipts, addReceipt, clearChatMessages } = useStorage();
    const [messages, setMessages] = useState([]);
    const [neuMessage, setNewMessage] = useState("");
    const [uploading, setUploading] = useState(false);
    const { showToast, confirmAction } = useUI();
    const [showChatInfo, setShowChatInfo] = useState(false);
    const [showAvatarModal, setShowAvatarModal] = useState(false);
    const [otherUserStatus, setOtherUserStatus] = useState("offline");
    const [otherUserLastSeen, setOtherUserLastSeen] = useState(null);
    const [memberSearch, setMemberSearch] = useState("");
    const [memberResults, setMemberResults] = useState([]);

    // Group Name Edit State
    const [isEditingName, setIsEditingName] = useState(false);
    const [groupNameInput, setGroupNameInput] = useState("");

    // Sync group name input
    useEffect(() => {
        if (chat?.groupName) setGroupNameInput(chat.groupName);
    }, [chat?.groupName]);

    const bottomRef = useRef(null);
    const fileInputRef = useRef(null);

    const isGroup = chat.type === 'group';
    const otherUserId = !isGroup ? chat?.userIds?.find(id => id !== user.uid) : null;
    const otherUser = !isGroup ? (chat.users?.[otherUserId] || { displayName: "User" }) : { displayName: chat.groupName, photoURL: null };

    const isAdmin = isGroup && chat.adminIds?.includes(user.uid);
    const myClearedAt = chat.clearedAt?.[user.uid]?.toMillis() || 0;

    // Listen to Other User Status (Direct Chat Only)
    useEffect(() => {
        if (isGroup || !otherUserId) return;

        // Initial fetch
        const fetchStatus = async () => {
            const { data } = await supabase.from('users').select('status, last_seen').eq('id', otherUserId).single();
            if (data) {
                setOtherUserStatus(data.status || 'offline');
                setOtherUserLastSeen(new Date(data.last_seen)); // Convert to Date or keep string?
                // Firestore timestamp has toMillis(), Supabase string/date doesn't. 
                // We will handle data.last_seen as ISO string.
            }
        };
        fetchStatus();

        const channel = supabase
            .channel(`user_chat:${otherUserId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'users',
                filter: `id=eq.${otherUserId}`
            }, (payload) => {
                const data = payload.new;
                setOtherUserStatus(data.status || 'offline');
                setOtherUserLastSeen(data.last_seen ? new Date(data.last_seen) : null);
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [isGroup, otherUserId]);

    const getStatusText = () => {
        if (isGroup) {
            return `${chat.userIds?.length || 0} members`;
        }

        let status = otherUserStatus;
        if (status === 'online' && otherUserLastSeen) {
            // Supabase ISO string / Date obj
            const lastSeenTime = otherUserLastSeen instanceof Date ? otherUserLastSeen.getTime() : new Date(otherUserLastSeen).getTime();
            const diff = Date.now() - lastSeenTime;
            if (diff > 5 * 60 * 1000) status = 'offline';
            else if (diff > 60 * 1000) status = 'idle';
        }

        if (status === 'in-call') return 'In a call';
        if (status === 'idle') return 'Idle';
        if (status === 'online') return 'Online';
        return 'Offline';
    };

    const statusText = getStatusText();
    const isOnline = statusText === 'Online';
    const isInCall = statusText === 'In a call';

    // Local First Logic
    const [localReceipts, setLocalReceipts] = useState({});

    // Mark Read Logic (Still useful for "Seen" status, but focus is on delivery ACK)
    const markRead = async () => {
        // ... (omitted)
    };

    // ACK & Delete from Server (Buffer Logic)
    const ackMessage = async (msgId) => {
        try {
            await fetch('/api/messages/ack', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messageIds: [msgId], userId: user.uid })
            });
        } catch (e) {
            console.error("ACK failed", e);
        }
    };

    // Helper to normalize message keys (snake_case from DB -> camelCase for App)
    const normalizeMessage = (msg) => {
        if (!msg) return null;
        return {
            id: msg.id,
            chatId: msg.chat_id || msg.chatId,
            senderId: msg.sender_id || msg.senderId,
            senderName: msg.sender_name ? decompressText(msg.sender_name) : (msg.senderName || "Unknown"),
            senderPhoto: msg.sender_photo || msg.senderPhoto,
            text: msg.text ? decompressText(msg.text) : (msg.text || ""),
            fileUrl: msg.file_url || msg.fileUrl,
            fileType: msg.file_type || msg.fileType || (msg.file_url || msg.fileUrl ? 'file' : 'text'),
            fileName: msg.file_name || msg.fileName,
            readBy: msg.read_by || msg.readBy || [],
            createdAt: msg.created_at || msg.createdAt || new Date().toISOString(),
            type: (msg.file_url || msg.fileUrl) ? (msg.file_type || msg.fileType || 'file') : 'text'
        };
    };

    useEffect(() => {
        if (!chat?.id) return;
        setMessages([]);
        setLocalReceipts({});

        // 1. Load from Local IndexedDB
        const loadLocalData = async () => {
            let localMsgs = await getMessages(chat.id);

            // Normalize & Filter
            localMsgs = localMsgs.map(m => ({
                ...m,
                fileUrl: m.fileUrl || m.fileURL || m.file_url, // Handle all casing
                fileName: m.fileName || m.file_name,
                type: m.type || m.fileType || (m.fileURL || m.fileUrl || m.file_url ? 'file' : 'text')
            }));

            // Filter cleared messages
            const clearedAt = chat.users?.[user.uid]?.clearedAt;
            if (clearedAt) {
                const clearTime = new Date(clearedAt).getTime();
                localMsgs = localMsgs.filter(m => new Date(m.createdAt).getTime() > clearTime);
            }

            setMessages(localMsgs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

            // Load Receipts
            if (getReceipts) {
                const receiptsList = await getReceipts(chat.id);
                const receiptMap = {};
                receiptsList.forEach(r => {
                    if (!receiptMap[r.messageId]) receiptMap[r.messageId] = new Set();
                    receiptMap[r.messageId].add(r.userId);
                });
                setLocalReceipts(receiptMap);
            }
        };
        loadLocalData();

        // 2. Poll/Fetch Undelivered Messages (Buffer) from Server
        const fetchBuffer = async () => {
            try {
                const res = await fetch(`/api/chats/${chat.id}/messages`);
                const json = await res.json();
                if (json.success && json.data.length > 0) {
                    const clearedAt = chat.users?.[user.uid]?.clearedAt;
                    const clearTime = clearedAt ? new Date(clearedAt).getTime() : 0;

                    for (const msg of json.data) {
                        const normalized = normalizeMessage(msg);
                        // Only add if newer than clearedAt
                        if (new Date(normalized.createdAt).getTime() > clearTime) {
                            await addMessage(normalized);
                        }
                        await ackMessage(normalized.id); // Ack anyway to flush server buffer? Yes.
                    }
                    loadLocalData();
                }
            } catch (err) {
                console.error("Buffer sync failed", err);
            }
        }
        fetchBuffer();


        // 3. Socket.io Realtime Listener
        if (socket) {
            const handleReceiveMessage = async (msg) => {
                // If message is for this chat
                if ((msg.chat_id === chat.id || msg.chatId === chat.id) && (msg.sender_id !== user.uid && msg.senderId !== user.uid)) {
                    // Check One-Way Clear
                    const clearedAt = chat.users?.[user.uid]?.clearedAt;
                    if (clearedAt && new Date(msg.createdAt).getTime() <= new Date(clearedAt).getTime()) {
                        return; // Ignore old message coming in late
                    }

                    const normalized = normalizeMessage(msg);
                    await addMessage(normalized);
                    setMessages(prev => {
                        if (prev.find(m => m.id === normalized.id)) return prev;
                        return [...prev, normalized].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                    });
                    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                    await ackMessage(normalized.id);
                }
            };

            socket.on('receive_message', handleReceiveMessage);

            return () => {
                socket.off('receive_message', handleReceiveMessage);
            };
        }

        // 4. Fallback: Subscribe to Realtime Updates (Messages & Receipts) via Supabase
        // (Only used if socket is down or as backup? Actually duplicate listeners might be bad.
        // Let's keep it but rely on deduplication in addMessage/setMessages)
        const channel = supabase
            .channel(`chat:${chat.id}`)
            // Messages
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `chat_id=eq.${chat.id}`
            }, async (payload) => {
                const newMsg = payload.new;
                if (!newMsg || !newMsg.id) return;

                // Skip if we are the sender (local update handles it) 
                // BUT wait, we need it if we are on another device? 
                // For now, simple check:
                if (newMsg.sender_id === user.uid) return;

                const normalized = normalizeMessage(newMsg);

                await addMessage(normalized);

                setMessages(prev => {
                    if (prev.find(m => m.id === normalized.id)) return prev;
                    return [...prev, normalized].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                });
                setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

                await ackMessage(normalized.id);
            })
            // Receipts
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'receipts',
                filter: `chat_id=eq.${chat.id}`
            }, async (payload) => {
                const r = payload.new;
                const receiptObj = {
                    id: r.id,
                    messageId: r.message_id,
                    chatId: r.chat_id,
                    userId: r.user_id,
                    status: r.status,
                    createdAt: r.created_at
                };
                if (addReceipt) await addReceipt(receiptObj);

                setLocalReceipts(prev => {
                    const newMap = { ...prev };
                    if (!newMap[r.message_id]) newMap[r.message_id] = new Set();
                    newMap[r.message_id].add(r.user_id);
                    return newMap;
                });
            })
            .subscribe();

        return () => {
            if (socket) socket.off('receive_message'); // Redundant cleanup but safe
            supabase.removeChannel(channel);
        };
    }, [chat?.id, socket]);

    const typingTimeoutRef = useRef(null);

    // Debounced Typing Emit
    const handleTypingInput = (e) => {
        setNewMessage(e.target.value);

        if (socket && chat?.id) {
            if (typingTimeoutRef.current) return; // Already emitting/cooldown

            // Volatile emit for typing
            socket.emit("typing_signal", { c: chat.id, s: user.uid, isTyping: true });

            typingTimeoutRef.current = setTimeout(() => {
                typingTimeoutRef.current = null;
            }, 2000); // 2s Debounce
        }
    };

    const sendMessage = async (e, fileData = null) => {
        if (e) e.preventDefault();

        const text = fileData ? fileData.fileName : neuMessage;
        if (!text.trim() && !fileData) return;

        if (!fileData) setNewMessage("");

        const tempId = crypto.randomUUID();
        const msgPayload = {
            id: tempId,
            chatId: chat.id,
            text,
            senderId: user.uid,
            senderName: user.displayName,
            senderPhoto: user.photoURL,
            type: fileData ? (fileData.type || 'file') : 'text',
            fileUrl: fileData ? fileData.url : null,
            fileName: fileData ? fileData.name : null,
            createdAt: new Date().toISOString(),
            readBy: []
        };

        // Optimistic Save
        await addMessage(msgPayload);
        setMessages(prev => [...prev, msgPayload].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

        // Emit to Socket
        if (socket) {
            // Minified keys: c=chatId, t=text, s=senderId, n=name, p=photo
            socket.emit("send_message", {
                c: chat.id,
                t: text,
                s: user.uid,
                n: user.displayName,
                p: user.photoURL,
                fileUrl: fileData ? fileData.url : null,
                fileType: fileData ? (fileData.type || 'file') : null,
                fileName: fileData ? fileData.name : null
            }, (ack) => {
                if (ack && ack.status === 'sent') {
                    // console.log("Message Sent & Buffered", ack.id);
                }
            });
        } else {
            // Fallback or Toast
            showToast("Socket Disconnected. Message saved locally.", "error");
        }
    };

    const isImageFile = (file) => {
        return file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
    };

    const handleDownload = async (url, filename) => {
        try {
            const res = await fetch(url);
            const blob = await res.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename || "download";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        } catch (e) {
            console.error("Download failed", e);
            window.open(url, '_blank');
        }
    };

    const handleFileUpload = async (e) => {
        let file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            if (isImageFile(file)) {
                try {
                    file = await compressImage(file);
                    if (file.size > 5 * 1024 * 1024) {
                        showToast("File still too large after compression.", "error");
                        return;
                    }
                } catch (err) {
                    console.error("Compression error", err);
                    showToast("Failed to compress image", "error");
                    return;
                }
            } else {
                showToast("File is too large (>5MB). Please choose a smaller file.", "error");
                return;
            }
        }

        setUploading(true);
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch("/api/upload", { method: "POST", body: formData });
            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`Upload failed: ${res.status} ${res.statusText} - ${errorText}`);
            }
            const data = await res.json();

            if (data.success) {
                const fileType = isImageFile(file) ? 'image' : 'file';

                // Use socket-based sendMessage to ensure realtime delivery & optimistic UI
                await sendMessage(null, {
                    url: data.link || data.downloadLink,
                    name: file.name,
                    type: fileType
                });
            }

        } catch (err) {
            console.error(err);
            showToast("Upload failed", "error");
        } finally {
            setUploading(false);
        }
    };

    const handleSearchMember = async (e) => {
        e.preventDefault();
        if (!memberSearch.trim()) return;
        const q = query(collection(db, "users"), where("username", "==", memberSearch));
        const snap = await getDocs(q);
        setMemberResults(snap.docs.map(d => d.data()));
    };

    const inviteMember = async (targetUser) => {
        const newPending = [...(chat.pendingUserIds || []), targetUser.uid];
        await fetch(`/api/chats/${chat.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendingUserIds: newPending })
        });
        setMemberSearch("");
        setMemberResults([]);
        showToast(`Invited ${targetUser.username}`, "success");
    };

    const handleRemoveMember = async (targetUid) => {
        if (!await confirmAction("Remove this user?")) return;
        const newUserIds = chat.userIds.filter(id => id !== targetUid);
        const newAdminIds = chat.adminIds.filter(id => id !== targetUid);
        await fetch(`/api/chats/${chat.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: newUserIds, adminIds: newAdminIds })
        });
    };

    const handleMakeAdmin = async (targetUid) => {
        if (!await confirmAction("Make this user an Admin?")) return;
        const newAdminIds = [...(chat.adminIds || []), targetUid];
        await fetch(`/api/chats/${chat.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminIds: newAdminIds })
        });
        showToast("Admin appointed", "success");
    }

    const handleDismissAdmin = async (targetUid) => {
        if (!await confirmAction("Dismiss as Admin?")) return;
        const newAdminIds = chat.adminIds.filter(id => id !== targetUid);
        await fetch(`/api/chats/${chat.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminIds: newAdminIds })
        });
        showToast("Admin dismissed", "info");
    }

    const handleUpdateGroupName = async () => {
        if (!groupNameInput.trim()) return;
        try {
            await fetch(`/api/chats/${chat.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupName: groupNameInput.trim() })
            });
            setIsEditingName(false);
            showToast("Group name updated", "success");
        } catch (error) {
            console.error(error);
            showToast("Failed to update name", "error");
        }
    };

    const handleLeaveGroup = async () => {
        if (!await confirmAction("Leave this group? You won't see new messages.")) return;
        // Check if last admin
        if (isAdmin && chat.adminIds.length === 1 && chat.userIds.length > 1) {
            showToast("Please appoint another admin before leaving.", "error");
            return;
        }

        const newUserIds = chat.userIds.filter(id => id !== user.uid);
        const newAdminIds = chat.adminIds.filter(id => id !== user.uid);
        await fetch(`/api/chats/${chat.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: newUserIds, adminIds: newAdminIds })
        });
        onBack();
    };

    const handleDeleteChat = async () => {
        if (isGroup) {
            // Regular users leave. Admins *can* leave via handleLeaveGroup, 
            // but this function is strictly for the "Delete" action if we separate them.
            // If this button is shared, we split logic.
            handleLeaveGroup();
        } else {
            if (!await confirmAction("Delete conversation?")) return;
            await fetch(`/api/chats/${chat.id}`, { method: 'DELETE' });
            onBack();
        }
    };

    const handleDeleteGroupForEveryone = async () => {
        if (!await confirmAction("DELETE GROUP?")) return;
        await fetch(`/api/chats/${chat.id}`, { method: 'DELETE' });
        onBack();
    };

    const handleClearChat = async () => {
        if (!await confirmAction("Clear chat history? This will remove messages for YOU only.")) return;

        try {
            const clearedAt = new Date().toISOString();

            // 1. Update Server (One-Way Clear)
            const updatedUsers = {
                ...chat.users,
                [user.uid]: { ...chat.users[user.uid], clearedAt }
            };

            await fetch(`/api/chats/${chat.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ users: updatedUsers })
            });

            // 2. Clear Local DB
            if (clearChatMessages) await clearChatMessages(chat.id);

            // 3. Clear UI State
            setMessages([]);
            showToast("Chat history cleared", "success");

            // Force re-fetch or rely on realtime update to 'chat' prop to set clearedAt? 
            // Ideally 'chat' prop updates from parent. We can assume parent updates.
        } catch (err) {
            console.error(err);
            showToast("Failed to clear chat", "error");
        }
    };

    // --- Read Receipts & Helpers ---
    const markAsRead = async (unreadMsgs) => {
        // TODO: Implement Read Receipts via Supabase API
        // unreadMsgs.forEach(msg => { ... });
    };

    useEffect(() => {
        if (!messages.length) return;
        const unread = messages.filter(m =>
            m.senderId !== user.uid &&
            (!m.readBy || !m.readBy.includes(user.uid))
        );
        if (unread.length > 0) {
            markAsRead(unread);
        }
    }, [messages, user.uid, chat.id]);

    const getTickColor = (msg) => {
        const receiptsForMsg = localReceipts[msg.id] || new Set();
        if (msg.readBy && Array.isArray(msg.readBy)) {
            msg.readBy.forEach(uid => receiptsForMsg.add(uid));
        }

        if (isGroup) {
            const allRead = chat.userIds.every(uid => uid === msg.senderId || receiptsForMsg.has(uid));
            return allRead ? "text-green-500" : "text-slate-500";
        } else {
            const otherUserId = chat.userIds.find(uid => uid !== user.uid);
            const otherRead = receiptsForMsg.has(otherUserId);
            return otherRead ? "text-green-500" : "text-slate-500";
        }
    };

    return (
        <div className={styles.chatWindow}>
            {/* Avatar View Modal */}
            {showAvatarModal && (
                <div className={styles.modalOverlay} onClick={() => setShowAvatarModal(false)} style={{ zIndex: 70, background: 'rgba(0,0,0,0.9)' }}>
                    <div className="relative max-w-2xl max-h-[90vh] p-2">
                        <img
                            src={isGroup ? (chat.photoURL || otherUser.photoURL) : otherUser.photoURL}
                            className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain"
                            onError={(e) => e.target.style.display = 'none'}
                        />
                        <button onClick={() => setShowAvatarModal(false)} className="absolute -top-10 right-0 text-white hover:text-gray-300">
                            <X size={32} />
                        </button>
                    </div>
                </div>
            )}

            {/* Chat Info / Details Modal */}
            {showChatInfo && (
                <div className={styles.modalOverlay}>
                    <div className={styles.infoModalContent}>
                        <div className={styles.infoModalHeader}>
                            <h3 className={styles.infoModalTitle}>{isGroup ? "Group Info" : "Chat Details"}</h3>
                            <button onClick={() => setShowChatInfo(false)} className={styles.iconButton}><X size={20} /></button>
                        </div>

                        <div className={styles.infoModalBody}>
                            {isGroup ? (
                                <>
                                    <div className="flex flex-col gap-4">
                                        {/* Group Name Section */}
                                        <div className="flex flex-col gap-2">
                                            <h4 className={styles.infoSectionTitle}>Group Name</h4>
                                            {isEditingName ? (
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        className={styles.searchInput}
                                                        value={groupNameInput}
                                                        onChange={(e) => setGroupNameInput(e.target.value)}
                                                        autoFocus
                                                    />
                                                    <button onClick={handleUpdateGroupName} className={clsx(styles.iconButtonSmall, styles.iconButtonSuccess)}>
                                                        <Check size={20} />
                                                    </button>
                                                    <button onClick={() => { setIsEditingName(false); setGroupNameInput(chat.groupName); }} className={clsx(styles.iconButtonSmall, styles.iconButtonDanger)}>
                                                        <X size={20} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className={styles.groupNameContainer}>
                                                    <span className={styles.groupNameText}>{chat.groupName}</span>
                                                    {isAdmin && (
                                                        <button onClick={() => setIsEditingName(true)} className={styles.iconButtonSmall}>
                                                            <Edit2 size={18} />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        <h4 className={styles.infoSectionTitle}>Members ({chat.userIds.length})</h4>
                                        <div className={styles.memberList}>
                                            {chat.userIds?.map(uid => {
                                                const u = chat.users?.[uid];
                                                if (!u) return null;
                                                const isUserAdmin = chat.adminIds?.includes(uid);
                                                return (
                                                    <div key={uid} className={styles.memberItem}>
                                                        <div className={styles.memberAvatar}>
                                                            {u.photoURL ? <img src={u.photoURL} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs font-bold text-slate-500">{u.displayName?.[0]}</div>}
                                                        </div>
                                                        <div className="flex-1 flex flex-col">
                                                            <span className={styles.memberName}>
                                                                {u.displayName} {uid === user.uid && "(You)"}
                                                                {isUserAdmin && <BadgeCheck size={14} className={styles.adminBadge} />}
                                                            </span>
                                                        </div>

                                                        {/* Admin Actions */}
                                                        {isAdmin && uid !== user.uid && (
                                                            <div className="flex gap-2">
                                                                {isUserAdmin ? (
                                                                    <button onClick={() => handleDismissAdmin(uid)} className={styles.iconButtonSmall} title="Dismiss Admin">
                                                                        <ShieldAlert size={16} className="text-yellow-500" />
                                                                    </button>
                                                                ) : (
                                                                    <button onClick={() => handleMakeAdmin(uid)} className={styles.iconButtonSmall} title="Make Admin">
                                                                        <Shield size={16} className="text-green-500" />
                                                                    </button>
                                                                )}
                                                                <button onClick={() => handleRemoveMember(uid)} className={styles.iconButtonSmall} title="Remove User">
                                                                    <Trash2 size={16} className="text-red-500" />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {isAdmin && (
                                        <>
                                            <div className="border-t border-white/5" />
                                            <div>
                                                <h4 className={styles.infoSectionTitle}>Add Members</h4>
                                                <form onSubmit={handleSearchMember} className={styles.searchForm}>
                                                    <input
                                                        className={styles.searchInput}
                                                        placeholder="Search by username..."
                                                        value={memberSearch}
                                                        onChange={e => setMemberSearch(e.target.value)}
                                                    />
                                                    <button type="submit" className={styles.primaryBtn}>
                                                        Search
                                                    </button>
                                                </form>
                                                <div className="flex flex-col gap-2 mt-4">
                                                    {memberResults.map(u => (
                                                        <div key={u.uid} className={styles.memberItem}>
                                                            <span className={styles.memberName}>{u.username}</span>
                                                            <button onClick={() => inviteMember(u)} className={styles.primaryBtnSmall}>Invite</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </>
                            ) : (
                                <div className="flex flex-col items-center gap-4 py-4">
                                    <div className="w-24 h-24 rounded-2xl bg-slate-800 overflow-hidden shadow-2xl border border-white/10">
                                        {otherUser.photoURL ? <img src={otherUser.photoURL} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-slate-600">{otherUser.displayName?.[0]}</div>}
                                    </div>
                                    <div className="text-center">
                                        <h3 className="text-xl font-bold text-white mb-1">{otherUser.displayName}</h3>
                                        <p className={styles.directMessageLabel}>Direct Message</p>
                                    </div>
                                </div>
                            )}

                            <div className="border-t border-white/5 pt-6 flex flex-col gap-3 mt-auto">
                                <button onClick={handleClearChat} className={styles.actionBtn}>
                                    <Eraser size={18} /> Clear Chat History
                                </button>

                                <button onClick={handleDeleteChat} className={`${styles.actionBtn} ${styles.dangerBtn}`}>
                                    {isGroup ? <LogOut size={18} /> : <Trash2 size={18} />}
                                    <span>{isGroup ? "Leave Group" : "Delete Conversation"}</span>
                                </button>

                                {isGroup && isAdmin && (
                                    <button onClick={handleDeleteGroupForEveryone} className={clsx(styles.actionBtn, styles.dangerBtn)}>
                                        <Trash2 size={18} />
                                        <span>Delete Group (Admin)</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )
            }

            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerInfo}>
                    <button onClick={onBack} className={styles.backButton}>
                        <ChevronLeft size={24} />
                    </button>
                    <div
                        className={clsx(styles.headerAvatar, (otherUser.photoURL || (isGroup && chat.photoURL)) && "cursor-pointer hover:opacity-80 transition-opacity")}
                        onClick={() => { if (otherUser.photoURL || (isGroup && chat.photoURL)) setShowAvatarModal(true); }}
                    >
                        {otherUser.photoURL ? <img src={otherUser.photoURL} className={styles.avatarImg} /> : otherUser.displayName[0]}
                    </div>
                    <div className={styles.headerText}>
                        <h3 className={styles.headerTitle}>{otherUser.displayName}</h3>
                        <span className={clsx(
                            styles.headerStatus,
                            statusText === 'In a call' && "text-red-400",
                            statusText === 'Online' && "text-green-400",
                            statusText === 'Idle' && "text-yellow-400",
                            statusText === 'Offline' && "text-slate-400"
                        )}>
                            {isOnline && !isInCall && <span className={styles.pulsingDot}></span>}
                            {statusText === 'Idle' && <span className="w-2 h-2 rounded-full bg-yellow-400 mr-1"></span>}
                            {statusText === 'Offline' && <span className="w-2 h-2 rounded-full bg-slate-500 mr-1 opacity-50"></span>}
                            {statusText}
                        </span>
                    </div>
                </div>
                <div className={styles.headerActions}>
                    <button onClick={() => onStartCall(false)} className={styles.iconButton} title="Voice Call">
                        <Phone size={20} />
                    </button>
                    <button onClick={() => onStartCall(true)} className={styles.iconButton} title="Video Call">
                        <Video size={20} />
                    </button>
                    <button onClick={() => setShowChatInfo(true)} className={styles.iconButton} title="Chat Info">
                        <Info size={20} />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div className={styles.messageList}>
                {messages.map((msg) => {
                    const isMe = msg.senderId === user.uid;
                    return (
                        <div key={msg.id} className={clsx(styles.messageRow, isMe ? styles.messageRowEnd : styles.messageRowStart)}>
                            <div
                                className={clsx(
                                    styles.messageBubble,
                                    isMe ? styles.messageOwn : styles.messageOther
                                )}
                            >
                                {msg.type === 'text' && <p className={styles.messageText}>{msg.text}</p>}

                                {/* Image Rendering (Robust check for extension) */}
                                {/* Unified Document Rendering (Images & Files) */}
                                {(msg.type === 'image' || msg.type === 'file' || msg.fileUrl) && (() => {
                                    const diff = (new Date() - new Date(msg.createdAt)) / (1000 * 60 * 60 * 24);
                                    const isExpired = diff > 3;
                                    const daysLeft = Math.ceil(3 - diff);
                                    const isImage = msg.type === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(msg.fileName || msg.text);

                                    if (isExpired) {
                                        return (
                                            <div className="flex items-center gap-3 p-3 bg-slate-800/30 rounded-xl border border-dashed border-slate-700/50 cursor-not-allowed opacity-70">
                                                <div className="p-2.5 bg-slate-800 rounded-lg text-slate-500">
                                                    {isImage ? <ImageIcon size={20} /> : <FileIcon size={20} />}
                                                </div>
                                                <div className="bg-transparent">
                                                    <p className="text-sm font-medium text-slate-400 italic">File expired</p>
                                                    <p className="text-xs text-slate-600">Stored on device only</p>
                                                </div>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div className="group flex items-center gap-3 p-3 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl border border-slate-700/50 hover:border-slate-600 transition-all duration-200 max-w-[280px]">
                                            <div className={clsx("p-2.5 rounded-lg shrink-0", isImage ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400")}>
                                                {isImage ? <ImageIcon size={24} /> : <FileIcon size={24} />}
                                            </div>

                                            <div className="flex-1 min-w-0 overflow-hidden">
                                                <p className="text-sm font-medium text-slate-200 truncate pr-2" title={msg.fileName}>
                                                    {msg.fileName || "Attachment"}
                                                </p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                                                        {isImage ? 'IMAGE' : 'FILE'}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500">
                                                        Expires in {daysLeft}d
                                                    </span>
                                                </div>
                                            </div>

                                            <button
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    handleDownload(msg.fileUrl, msg.fileName);
                                                }}
                                                className="p-2.5 bg-slate-700/50 hover:bg-green-600 text-slate-300 hover:text-white rounded-lg transition-colors shadow-sm shrink-0"
                                                title="Download"
                                            >
                                                <Download size={18} />
                                            </button>
                                        </div>
                                    );
                                })()}

                                <div className="flex items-center justify-end gap-1 mt-1 opacity-70">
                                    <span className={styles.messageTime}>
                                        {formatTime(msg.createdAt)}
                                    </span>
                                    {isMe && (
                                        <BadgeCheck size={14} className={getTickColor(msg)} />
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className={styles.inputArea}>
                <form onSubmit={sendMessage} className={styles.inputForm}>
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className={styles.iconButton}
                        disabled={uploading}
                    >
                        {uploading ? <span className="animate-spin">⌛</span> : <Paperclip size={20} />}
                    </button>
                    <input
                        type="file"
                        hidden
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                    />
                    <input
                        className={styles.inputField}
                        placeholder="Type a message..."
                        value={neuMessage}
                        onChange={handleTypingInput}
                    />
                    <button
                        type="submit"
                        disabled={!neuMessage.trim()}
                        className={styles.sendButton}
                    >
                        <Send size={20} />
                    </button>
                </form>
            </div>
        </div >
    );
}

// Helper to format time
function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}


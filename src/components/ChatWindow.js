"use client";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
// import { db } from "@/lib/firebase"; // Removed
// import { collection, onSnapshot... } from "firebase/firestore"; // Removed
import { supabase } from "@/lib/supabase";
import { decompressText, decompressJSON } from "@/lib/compression";
import { Send, Paperclip, Video, Phone, MoreVertical, Image as ImageIcon, File as FileIcon, UserPlus, X, ChevronLeft, Trash2, LogOut, Info, Shield, ShieldAlert, BadgeCheck, Eraser, Edit2, Check } from "lucide-react";
import clsx from "clsx";
import styles from "./ChatWindow.module.css";
import { compressImage } from "@/lib/utils";
import { useUI } from "@/context/UIContext";

export default function ChatWindow({ chat, onStartCall, onBack }) {
    const { user } = useAuth();
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

    // Mark Read Logic
    const markRead = async () => {
        if (!chat?.id || !user) return;
        try {
            await fetch(`/api/chats/${chat.id}/read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.uid })
            });
        } catch (e) {
            console.error("Mark read failed", e);
        }
    };

    useEffect(() => {
        if (!chat?.id) return;
        setMessages([]);

        // 1. Fetch initial messages
        const fetchMessages = async () => {
            try {
                const res = await fetch(`/api/chats/${chat.id}/messages`);
                const json = await res.json();
                if (json.success) {
                    setMessages(json.data);
                    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                    markRead(); // Mark read on load
                }
            } catch (err) {
                console.error("Failed to load messages", err);
            }
        };

        fetchMessages();

        // 2. Subscribe to Realtime Updates
        const channel = supabase
            .channel(`chat:${chat.id}`)
            .on('postgres_changes', {
                event: '*', // Listen to INSERT and UPDATE
                schema: 'public',
                table: 'messages',
                filter: `chat_id=eq.${chat.id}`
            }, (payload) => {
                const newMsg = payload.new;

                // If it's incomplete (sometimes Supabase sends partials on updates? No, usually full row unless disabled)
                if (!newMsg || !newMsg.id) return;

                // Decompress incoming message
                const decompressedMsg = {
                    id: newMsg.id,
                    chatId: newMsg.chat_id,
                    senderId: newMsg.sender_id,
                    senderName: decompressText(newMsg.sender_name),
                    senderPhoto: newMsg.sender_photo,
                    text: decompressText(newMsg.text),
                    fileUrl: newMsg.file_url,
                    fileType: newMsg.file_type,
                    fileName: newMsg.file_name,
                    readBy: newMsg.read_by || [],
                    createdAt: newMsg.created_at, // ISO String
                    type: newMsg.file_url ? (newMsg.file_type || 'file') : 'text'
                };

                if (payload.eventType === 'INSERT') {
                    setMessages(prev => {
                        if (prev.find(m => m.id === decompressedMsg.id)) return prev;
                        return [...prev, decompressedMsg];
                    });
                    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                    // If I am active, mark this new message as read?
                    // We can just call markRead() which handles all unread, or call per message.
                    // Throttle optimization: call markRead()
                    markRead();
                } else if (payload.eventType === 'UPDATE') {
                    setMessages(prev => prev.map(m => m.id === decompressedMsg.id ? decompressedMsg : m));
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [chat?.id]);

    const sendMessage = async (e) => {
        e.preventDefault();
        if (!neuMessage.trim()) return;

        const text = neuMessage;
        setNewMessage("");

        try {
            await fetch(`/api/chats/${chat.id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    senderId: user.uid,
                    senderName: user.displayName,
                    senderPhoto: user.photoURL
                })
            });
        } catch (err) {
            console.error("Failed to send", err);
            showToast("Failed to send message", "error");
        }
    };

    const handleFileUpload = async (e) => {
        let file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            if (file.type.startsWith('image/')) {
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
                await fetch(`/api/chats/${chat.id}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: file.name,
                        fileUrl: data.link || data.downloadLink,
                        fileName: file.name,
                        fileType: file.type.startsWith('image/') ? 'image' : 'file',
                        senderId: user.uid,
                        senderName: user.displayName,
                        senderPhoto: user.photoURL
                    })
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
        // Clear history not fully implemented in API yet (need DELETE /messages or update).
        // For MVP, skip or implement later.
        showToast("Clear chat not supported in this version", "info");
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
        if (!msg.readBy) return "text-slate-500";
        if (isGroup) {
            const allRead = chat.userIds.every(uid => msg.readBy.includes(uid));
            return allRead ? "text-green-500" : "text-slate-500";
        } else {
            const otherRead = chat.userIds.some(uid => uid !== user.uid && msg.readBy.includes(uid));
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
                    <div>
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

                                {msg.type === 'image' && (
                                    <div className={styles.messageImageWrapper}>
                                        <img src={msg.fileUrl} alt="Shared" className={styles.messageImage} />
                                    </div>
                                )}

                                {msg.type === 'file' && (
                                    <a href={msg.fileUrl} target="_blank" className={styles.messageFile}>
                                        <FileIcon size={16} /> {msg.fileName || "Attachment"}
                                    </a>
                                )}
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
                        onChange={(e) => setNewMessage(e.target.value)}
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


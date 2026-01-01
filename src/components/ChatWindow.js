"use client";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, arrayUnion, getDocs, where, arrayRemove, deleteDoc } from "firebase/firestore";
import { Send, Paperclip, Video, Phone, MoreVertical, Image as ImageIcon, File as FileIcon, UserPlus, X, ChevronLeft, Trash2, LogOut, Info, Shield, ShieldAlert, BadgeCheck, Eraser } from "lucide-react";
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

        const unsub = onSnapshot(doc(db, "users", otherUserId), (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                setOtherUserStatus(data.status || 'offline');
                setOtherUserLastSeen(data.lastSeen);
            }
        });

        return () => unsub();
    }, [isGroup, otherUserId]);

    const getStatusText = () => {
        if (isGroup) {
            return `${chat.userIds.length} members`;
        }

        // Calculate dynamic status based on time if needed, similar to Sidebar
        let status = otherUserStatus;
        if (status === 'online' && otherUserLastSeen) {
            const diff = Date.now() - otherUserLastSeen.toMillis();
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

    useEffect(() => {
        if (!chat?.id) return;

        // Subscribe to messages
        const q = query(
            collection(db, "chats", chat.id, "messages"),
            orderBy("createdAt", "asc")
        );

        const unsubscribe = onSnapshot(q, (snap) => {
            const rawMessages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Filter cleared messages
            const visibleMessages = rawMessages.filter(msg => {
                const msgTime = msg.createdAt?.toMillis ? msg.createdAt.toMillis() : Date.now();
                return msgTime > myClearedAt;
            });
            setMessages(visibleMessages);
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        });

        return () => unsubscribe();
    }, [chat?.id, myClearedAt]);

    const sendMessage = async (e) => {
        e.preventDefault();
        if (!neuMessage.trim()) return;

        const text = neuMessage;
        setNewMessage("");

        await addDoc(collection(db, "chats", chat.id, "messages"), {
            text,
            senderId: user.uid,
            createdAt: serverTimestamp(),
            type: "text"
        });

        await updateDoc(doc(db, "chats", chat.id), {
            lastMessage: text,
            lastUpdated: serverTimestamp()
        });
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
        formData.append("userId", user.uid);

        try {
            const res = await fetch("/api/upload", { method: "POST", body: formData });
            const data = await res.json();

            if (data.success) {
                await addDoc(collection(db, "chats", chat.id, "messages"), {
                    text: file.name,
                    fileUrl: data.link,
                    downloadUrl: data.downloadLink,
                    senderId: user.uid,
                    createdAt: serverTimestamp(),
                    type: file.type.startsWith('image/') ? 'image' : 'file'
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
        await updateDoc(doc(db, "chats", chat.id), {
            pendingUserIds: arrayUnion(targetUser.uid)
        });
        setMemberSearch("");
        setMemberResults([]);
        showToast(`Invited ${targetUser.username}`, "success");
    };

    const handleRemoveMember = async (targetUid) => {
        if (!await confirmAction("Remove this user?")) return;
        await updateDoc(doc(db, "chats", chat.id), {
            userIds: arrayRemove(targetUid),
            adminIds: arrayRemove(targetUid) // Also remove admin status if exists
        });
    };

    const handleMakeAdmin = async (targetUid) => {
        if (!await confirmAction("Make this user an Admin?")) return;
        await updateDoc(doc(db, "chats", chat.id), {
            adminIds: arrayUnion(targetUid)
        });
        showToast("Admin appointed", "success");
    }

    const handleDismissAdmin = async (targetUid) => {
        if (!await confirmAction("Dismiss as Admin?")) return;
        await updateDoc(doc(db, "chats", chat.id), {
            adminIds: arrayRemove(targetUid)
        });
        showToast("Admin dismissed", "info");
    }

    const handleLeaveGroup = async () => {
        if (!await confirmAction("Leave this group? You won't see new messages.")) return;
        // Check if last admin
        if (isAdmin && chat.adminIds.length === 1 && chat.userIds.length > 1) {
            showToast("Please appoint another admin before leaving.", "error");
            return;
        }

        await updateDoc(doc(db, "chats", chat.id), {
            userIds: arrayRemove(user.uid),
            adminIds: arrayRemove(user.uid)
        });
        onBack();
    };

    const handleDeleteChat = async () => {
        if (isGroup) {
            // In group, "Delete" for unprivileged user is leaving. 
            // BUT user asked: "if it is for a group chat the user who deletes it, it gets deleted for them only"
            // This sounds exactly like "Leave Group".
            handleLeaveGroup();
        } else {
            // Direct chat: "Deleted for both users"
            if (!await confirmAction("Start FRESH? This will permanently delete the chat history for BOTH users.")) return;
            await deleteDoc(doc(db, "chats", chat.id));
            onBack();
        }
    };

    const handleClearChat = async () => {
        if (!await confirmAction("Clear chat history? This only affects YOU.")) return;
        await updateDoc(doc(db, "chats", chat.id), {
            [`clearedAt.${user.uid}`]: serverTimestamp()
        });
        showToast("Chat cleared.", "success");
        setShowChatInfo(false);
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
                    <div className={styles.modalContent}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>{isGroup ? "Group Info" : "Chat Details"}</h3>
                            <button onClick={() => setShowChatInfo(false)} className={styles.iconButton}><X size={20} /></button>
                        </div>

                        {isGroup ? (
                            <>
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Members ({chat.userIds.length})</h4>
                                <div className="flex flex-col gap-3 mb-6 max-h-60 overflow-y-auto">
                                    {chat.userIds?.map(uid => {
                                        const u = chat.users?.[uid];
                                        if (!u) return null;
                                        const isUserAdmin = chat.adminIds?.includes(uid);
                                        return (
                                            <div key={uid} className={styles.modalResultItem}>
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center overflow-hidden">
                                                        {u.photoURL ? <img src={u.photoURL} className="w-full h-full object-cover" /> : <span className="text-sm">{u.displayName?.[0]}</span>}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-medium text-white flex items-center gap-1">
                                                            {u.displayName} {uid === user.uid && "(You)"}
                                                            {isUserAdmin && <BadgeCheck size={14} className="text-blue-400" />}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Admin Actions */}
                                                {isAdmin && uid !== user.uid && (
                                                    <div className="flex gap-1">
                                                        {isUserAdmin ? (
                                                            <button onClick={() => handleDismissAdmin(uid)} className="p-1.5 text-slate-400 hover:text-yellow-400 hover:bg-slate-800 rounded" title="Dismiss Admin">
                                                                <ShieldAlert size={16} />
                                                            </button>
                                                        ) : (
                                                            <button onClick={() => handleMakeAdmin(uid)} className="p-1.5 text-slate-400 hover:text-green-400 hover:bg-slate-800 rounded" title="Make Admin">
                                                                <Shield size={16} />
                                                            </button>
                                                        )}
                                                        <button onClick={() => handleRemoveMember(uid)} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded" title="Remove User">
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {isAdmin && (
                                    <>
                                        <div className="border-t border-slate-700 my-4" />
                                        <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">add members</h4>
                                        <form onSubmit={handleSearchMember} className={styles.modalForm}>
                                            <input
                                                className={styles.modalInput}
                                                placeholder="Search Username"
                                                value={memberSearch}
                                                onChange={e => setMemberSearch(e.target.value)}
                                            />
                                            <button type="submit" className={styles.searchBtn}>Search</button>
                                        </form>
                                        <div className={styles.modalResults}>
                                            {memberResults.map(u => (
                                                <div key={u.uid} className={styles.modalResultItem}>
                                                    <span className={styles.modalResultName}>{u.username}</span>
                                                    <button onClick={() => inviteMember(u)} className={styles.inviteBtn}>Invite</button>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </>
                        ) : (
                            <div className="mb-6 flex flex-col items-center gap-2">
                                <div className="w-20 h-20 rounded-full bg-slate-800 overflow-hidden mb-2">
                                    {otherUser.photoURL ? <img src={otherUser.photoURL} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-2xl">{otherUser.displayName?.[0]}</div>}
                                </div>
                                <h3 className="text-xl font-bold text-white">{otherUser.displayName}</h3>
                                <p className="text-sm text-slate-400">Direct Message</p>
                            </div>
                        )}

                        <div className="border-t border-slate-700 mt-6 pt-4 flex flex-col gap-3">
                            <button onClick={handleClearChat} className="btn btn-ghost">
                                <Eraser size={18} />
                                <span>Clear Chat (For Me)</span>
                            </button>

                            <button onClick={handleDeleteChat} className="btn btn-danger">
                                {isGroup ? <LogOut size={18} /> : <Trash2 size={18} />}
                                <span>{isGroup ? "Delete Chat (Leave Group)" : "Delete Chat (Both Users)"}</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerInfo}>
                    <button onClick={onBack} className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white">
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
                        <span className={clsx(styles.headerStatus, isInCall && "text-red-400", isOnline && "text-green-400")}>
                            {isOnline && !isInCall && <span className={styles.pulsingDot}></span>}
                            {statusText}
                        </span>
                    </div>
                </div>
                <div className={styles.headerActions}>
                    <button onClick={() => onStartCall(false)} className={styles.iconButton}>
                        <Phone size={20} />
                    </button>
                    <button onClick={() => onStartCall(true)} className={styles.iconButton}>
                        <Video size={20} />
                    </button>
                    <button onClick={() => setShowChatInfo(true)} className={styles.iconButton}>
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
                                        <FileIcon size={16} /> {msg.text}
                                    </a>
                                )}
                                <span className={styles.messageTime}>
                                    {msg.createdAt?.toMillis ? new Date(msg.createdAt.toMillis()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
                                </span>
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
        </div>
    );
}

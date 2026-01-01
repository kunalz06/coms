"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, getDocs, updateDoc, doc, arrayUnion, arrayRemove } from "firebase/firestore";
import { Search, Plus, MessageSquare, LogOut, User as UserIcon, Users, Check, X, Camera, Lock, Save, Trash2, Bell, BellOff, Pin, PinOff } from "lucide-react";
import clsx from "clsx";
import styles from "./Sidebar.module.css";
import { compressImage } from "@/lib/utils";
import { NotificationService } from "@/lib/notifications";

import { useUI } from "@/context/UIContext";

export default function Sidebar({ onSelectChat, activeChat }) {
    const { user, logout, updateUserProfile, updateUserPassword } = useAuth();
    const { showToast, confirmAction } = useUI();
    const [chats, setChats] = useState([]);

    // Pinned Chats State
    const [pinnedChatIds, setPinnedChatIds] = useState([]);

    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");

    const [invites, setInvites] = useState([]);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [newGroupName, setNewGroupName] = useState("");

    // Profile Modal State
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [editMode, setEditMode] = useState("general");
    const [profileData, setProfileData] = useState({ username: user?.displayName || "", photoURL: user?.photoURL || "", notificationsEnabled: false });
    const [passwordData, setPasswordData] = useState({ newPassword: "", confirmPassword: "" });
    const [tempAvatar, setTempAvatar] = useState(null);
    const [tempAvatarPreview, setTempAvatarPreview] = useState(null);

    // Listen to Current User Data (Real-time for Pinned Chats & Notifications)
    useEffect(() => {
        if (!user) return;
        const unsub = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
            if (docSnap.exists()) {
                const d = docSnap.data();
                setProfileData(prev => ({ ...prev, notificationsEnabled: d.notificationsEnabled ?? false }));
                setPinnedChatIds(d.pinnedChatIds || []);
            }
        });
        return () => unsub();
    }, [user]);

    // Presence State
    const [usersStatus, setUsersStatus] = useState({});

    const togglePin = async (e, chatId) => {
        e.stopPropagation();
        if (!user) return;

        const isPinned = pinnedChatIds.includes(chatId);
        try {
            await updateDoc(doc(db, "users", user.uid), {
                pinnedChatIds: isPinned ? arrayRemove(chatId) : arrayUnion(chatId)
            });
            showToast(isPinned ? "Chat unpinned" : "Chat pinned", "success");
        } catch (err) {
            console.error(err);
            showToast("Failed to update pin", "error");
        }
    };

    // ... (keep handleAvatarChange, handleDeleteAvatar, handleUpdateProfile, handleUpdatePassword)

    const handleAvatarChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressed = await compressImage(file, 500 * 1024);
                setTempAvatar(compressed);
                setTempAvatarPreview(URL.createObjectURL(compressed));
            } catch (err) {
                console.error("Compression failed", err);
                showToast("Failed to process image", "error");
            }
        }
    };

    const handleDeleteAvatar = async () => {
        if (!await confirmAction("Remove profile picture?")) return;
        try {
            await updateUserProfile({ photoURL: "" });
            setProfileData(prev => ({ ...prev, photoURL: "" }));
            setTempAvatar(null);
            setTempAvatarPreview(null);
            showToast("Picture removed", "info");
        } catch (err) {
            console.error(err);
            showToast("Failed to remove picture", "error");
        }
    };

    const handleUpdateProfile = async (e) => {
        e.preventDefault();
        try {
            let url = profileData.photoURL;
            if (tempAvatar) {
                const data = new FormData();
                data.append("file", tempAvatar);
                data.append("userId", user.uid);
                const res = await fetch("/api/upload", { method: "POST", body: data });
                const json = await res.json();
                if (json.success) url = json.downloadLink || json.link;
            }
            await updateUserProfile({ displayName: profileData.username, photoURL: url });
            showToast("Profile updated!", "success");
            setShowProfileModal(false);
        } catch (err) {
            console.error(err);
            showToast("Failed to update profile", "error");
        }
    };

    const handleUpdatePassword = async (e) => {
        e.preventDefault();
        if (passwordData.newPassword !== passwordData.confirmPassword) return showToast("Passwords do not match", "error");
        try {
            await updateUserPassword(passwordData.newPassword);
            showToast("Password updated!", "success");
            setPasswordData({ newPassword: "", confirmPassword: "" });
        } catch (err) {
            console.error(err);
            showToast("Update failed. Re-login required.", "error");
        }
    };

    // Listen to User's Chats & Invites
    useEffect(() => {
        if (!user) return;

        const qChats = query(collection(db, "chats"), where("userIds", "array-contains", user.uid));
        const qInvites = query(collection(db, "chats"), where("pendingUserIds", "array-contains", user.uid));

        const unsubChats = onSnapshot(qChats, (snapshot) => {
            const chatList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Initial sort by lastUpdated, but render logic will handle pinning sort
            // Actually let's just set raw list here and sort in render or memo
            setChats(chatList);
        });

        const unsubInvites = onSnapshot(qInvites, (snapshot) => {
            setInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        return () => { unsubChats(); unsubInvites(); };
    }, [user]);

    // ... (keep real-time status listener)
    useEffect(() => {
        const allUserIds = new Set();
        chats.forEach(c => c.userIds.forEach(uid => allUserIds.add(uid)));
        if (allUserIds.size === 0) return;

        const q = query(collection(db, "users"));

        const unsub = onSnapshot(q, (snap) => {
            const statusMap = {};
            snap.docs.forEach(d => {
                const data = d.data();
                let finalStatus = data.status || 'offline';
                if (data.status === 'online' && data.lastSeen) {
                    const diff = Date.now() - data.lastSeen.toMillis();
                    if (diff > 5 * 60 * 1000) finalStatus = 'offline';
                    else if (diff > 60 * 1000) finalStatus = 'idle';
                }
                statusMap[d.id] = finalStatus;
            });
            setUsersStatus(statusMap);
        });

        return () => unsub();
    }, [chats]);

    const getStatusColor = (uid) => {
        const s = usersStatus[uid] || 'offline';
        if (s === 'in-call') return 'bg-red-500';
        if (s === 'online') return 'bg-green-500';
        if (s === 'idle') return 'bg-yellow-500';
        return 'bg-slate-500';
    };

    // ... (keep handleSearch, startChat, createGroup - but verify if I should include them or if replace_file_content needs them to match contexts)
    // I need to be safe. I will include them to match standard replacement if start/end lines are insufficient.
    // The previously viewed file helps.

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;
        const q = query(collection(db, "users"), where("username", "==", searchQuery));
        const snap = await getDocs(q);
        setSearchResults(snap.docs.map(d => d.data()));
    };

    const startChat = async (targetUser) => {
        const existing = chats.find(c => c.userIds.includes(targetUser.uid) && c.type === 'direct');
        if (existing) {
            onSelectChat(existing);
            setIsSearching(false);
            return;
        }

        const newChat = await addDoc(collection(db, "chats"), {
            userIds: [user.uid, targetUser.uid],
            users: {
                [user.uid]: { displayName: user.displayName, photoURL: user.photoURL },
                [targetUser.uid]: { displayName: targetUser.username, photoURL: targetUser.photoURL }
            },
            type: "direct",
            lastUpdated: serverTimestamp(),
            lastMessage: "Started a chat"
        });

        onSelectChat({
            id: newChat.id,
            userIds: [user.uid, targetUser.uid],
            users: {
                [user.uid]: { displayName: user.displayName, photoURL: user.photoURL },
                [targetUser.uid]: { displayName: targetUser.username, photoURL: targetUser.photoURL }
            },
            type: "direct",
            ...targetUser
        });
        setIsSearching(false);
    };

    const createGroup = async (e) => {
        e.preventDefault();
        if (!newGroupName.trim()) return;

        const newChat = await addDoc(collection(db, "chats"), {
            userIds: [user.uid],
            pendingUserIds: [],
            users: { [user.uid]: { displayName: user.displayName, photoURL: user.photoURL } },
            type: "group",
            groupName: newGroupName,
            adminIds: [user.uid],
            lastUpdated: serverTimestamp(),
            lastMessage: "Group created"
        });

        setNewGroupName("");
        setShowGroupModal(false);
        onSelectChat({
            id: newChat.id,
            type: "group",
            groupName: newGroupName,
            userIds: [user.uid],
            adminIds: [user.uid],
            users: { [user.uid]: { displayName: user.displayName, photoURL: user.photoURL } }
        });
    };

    // Sort Chats: Pinned > Last Updated
    const sortedChats = [...chats].sort((a, b) => {
        const isPinnedA = pinnedChatIds.includes(a.id);
        const isPinnedB = pinnedChatIds.includes(b.id);
        if (isPinnedA && !isPinnedB) return -1;
        if (!isPinnedA && isPinnedB) return 1;
        // Sort by time desc
        return (b.lastUpdated?.toMillis() || 0) - (a.lastUpdated?.toMillis() || 0);
    });

    return (
        <aside className={styles.sidebar}>
            {/* Profile Modal */}
            {/* ... Modal Code ... */}
            {showProfileModal && (
                <div className={styles.modalOverlay} style={{ zIndex: 60 }}>
                    {/* ... (Keep Modal Content same as polished version) ... */}
                    {/* To avoid huge replacement, I'll assume lines 258-382 are untouched if I start replacement lower? */}
                    {/* Actually I am replacing the whole file's logic blocks basically. */}
                    {/* Let's try to trust the previous logic or carefully replace just the logic part and then the render map part. */}
                    <div className={styles.modalContent}>
                        <div className={styles.modalHeader}>
                            <h3 className={styles.modalTitle}>Profile Settings</h3>
                            <button onClick={() => setShowProfileModal(false)} className={styles.iconButton}><X size={20} /></button>
                        </div>

                        <div className={styles.tabContainer}>
                            <button onClick={() => setEditMode("general")} className={clsx(styles.tabBtn, editMode === 'general' && styles.tabBtnActive)}>General</button>
                            <button onClick={() => setEditMode("security")} className={clsx(styles.tabBtn, editMode === 'security' && styles.tabBtnActive)}>Security</button>
                        </div>

                        {editMode === "general" ? (
                            <form onSubmit={handleUpdateProfile} className="flex flex-col gap-6">
                                <div className="flex flex-col items-center gap-4">
                                    <div className="relative group">
                                        <div className="w-32 h-32 rounded-full bg-slate-800 border-4 border-slate-700/50 shadow-2xl flex items-center justify-center overflow-hidden mb-2">
                                            <img src={tempAvatarPreview || profileData.photoURL || user?.photoURL} className="w-full h-full object-cover" />
                                        </div>
                                        <label className="absolute bottom-1 right-1 bg-blue-500 hover:bg-blue-600 text-white p-2.5 rounded-full cursor-pointer shadow-lg transition-transform hover:scale-110 active:scale-95 border-4 border-[#0f172a]">
                                            <Camera size={18} />
                                            <input type="file" hidden accept="image/*" onChange={handleAvatarChange} />
                                        </label>
                                    </div>

                                    {(tempAvatar || profileData.photoURL) && (
                                        <button
                                            type="button"
                                            onClick={handleDeleteAvatar}
                                            className="btn btn-danger btn-sm px-4 py-2 rounded-full opacity-80 hover:opacity-100"
                                        >
                                            <Trash2 size={14} /> Remove Picture
                                        </button>
                                    )}
                                </div>

                                <div className="flex flex-col gap-2 w-full text-center">
                                    <label className="text-xs text-slate-400 uppercase font-bold tracking-wider">Display Name</label>
                                    <input
                                        className={styles.modalInput}
                                        value={profileData.username}
                                        onChange={e => setProfileData({ ...profileData, username: e.target.value })}
                                        placeholder="Enter your name"
                                        style={{ textAlign: 'center' }}
                                    />
                                </div>

                                <button type="submit" className="btn btn-primary w-full shadow-lg shadow-blue-500/20 py-3 text-lg">
                                    <Save size={18} /> Save Changes
                                </button>

                                <div className="w-full border-t border-slate-700/50 pt-4 mt-2">
                                    <h4 className="text-xs text-slate-400 uppercase font-bold tracking-wider mb-3 text-center">Preferences</h4>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            const newState = !profileData.notificationsEnabled;
                                            if (newState) {
                                                const granted = await NotificationService.requestPermission();
                                                if (!granted) {
                                                    showToast("Permission denied", "error");
                                                    return;
                                                }
                                            }
                                            setProfileData({ ...profileData, notificationsEnabled: newState });
                                            updateUserProfile({ notificationsEnabled: newState });
                                        }}
                                        className={clsx(
                                            "w-full flex items-center justify-between p-4 rounded-xl border transition-all duration-300",
                                            profileData.notificationsEnabled
                                                ? "bg-gradient-to-r from-blue-500/20 to-purple-500/20 border-blue-500/50 shadow-md shadow-blue-500/10"
                                                : "bg-slate-800/50 border-slate-700 hover:border-slate-600 hover:bg-slate-800"
                                        )}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={clsx(
                                                "p-2.5 rounded-xl transition-colors",
                                                profileData.notificationsEnabled ? "bg-blue-500 text-white shadow-lg shadow-blue-500/30" : "bg-slate-700 text-slate-400"
                                            )}>
                                                {profileData.notificationsEnabled ? <Bell size={20} /> : <BellOff size={20} />}
                                            </div>
                                            <div className="text-left">
                                                <div className={clsx("text-sm font-bold", profileData.notificationsEnabled ? "text-blue-100" : "text-slate-300")}>
                                                    Notifications
                                                </div>
                                                <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                                                    {profileData.notificationsEnabled ? "On" : "Off"}
                                                </div>
                                            </div>
                                        </div>
                                        <div className={clsx(
                                            "w-12 h-7 rounded-full relative transition-all duration-300 border",
                                            profileData.notificationsEnabled ? "bg-blue-500 border-blue-400" : "bg-slate-700 border-slate-600"
                                        )}>
                                            <div className={clsx(
                                                "absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300",
                                                profileData.notificationsEnabled ? "translate-x-6" : "translate-x-1"
                                            )} />
                                        </div>
                                    </button>
                                </div>
                            </form>
                        ) : (
                            <form onSubmit={handleUpdatePassword} className="flex flex-col gap-4">
                                {/* ... Keep Password Form ... */}
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs text-slate-400 uppercase font-bold">New Password</label>
                                    <input
                                        type="password"
                                        className={styles.modalInput}
                                        value={passwordData.newPassword}
                                        onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                                    />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs text-slate-400 uppercase font-bold">Confirm Password</label>
                                    <input
                                        type="password"
                                        className={styles.modalInput}
                                        value={passwordData.confirmPassword}
                                        onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                                    />
                                </div>
                                <button type="submit" className="btn btn-primary"><Lock size={16} /> Update Password</button>
                            </form>
                        )}
                        <div className="border-t border-slate-700 mt-6 pt-4">
                            <button onClick={logout} className="btn btn-danger">
                                <LogOut size={18} /> Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className={styles.header}>
                <div onClick={() => { setProfileData({ username: user?.displayName, photoURL: user?.photoURL }); setShowProfileModal(true); }} className={`${styles.userInfo} ${styles.clickableHeader}`}>
                    <div className={styles.userAvatar}>
                        {user?.photoURL ? (
                            <img src={user.photoURL} alt="Profile" className={styles.avatarImg} />
                        ) : (
                            user?.displayName?.[0]?.toUpperCase() || "U"
                        )}
                        <span className={clsx(styles.statusDot, "bg-green-500")} title="Online (You)"></span>
                    </div>
                    <span className={styles.userName}>{user?.displayName}</span>
                </div>
                <button
                    onClick={() => setIsSearching(!isSearching)}
                    className={styles.actionBtn}
                >
                    {isSearching ? <LogOut size={20} /> : <Plus size={20} />}
                </button>
            </div>

            {/* Search Mode or Chat List */}
            {isSearching ? (
                <div className={styles.searchContainer}>
                    {/* ... (Keep Search UI) ... */}
                    <form onSubmit={handleSearch} className={styles.searchForm}>
                        <Search className={styles.searchIcon} />
                        <input
                            className={styles.searchInput}
                            placeholder="Search username..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </form>
                    <div className={styles.resultList}>
                        {searchResults.map(u => (
                            <div key={u.uid} className={styles.resultItem}>
                                <div className={styles.resultUser}>
                                    <div className={styles.resultAvatar}>
                                        {u.photoURL ? <img src={u.photoURL} className={styles.avatarImg} /> : u.username[0]}
                                    </div>
                                    <span className={styles.resultName}>{u.username}</span>
                                </div>
                                <button
                                    onClick={() => startChat(u)}
                                    className="btn btn-primary btn-sm"
                                >
                                    Message
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className={styles.chatList}>
                    {/* Invites Section - Keep as is */}
                    {invites.length > 0 && (
                        <div className={styles.inviteSection}>
                            <h3 className={styles.inviteTitle}>Invites</h3>
                            {invites.map(chat => (
                                <div key={chat.id} className={styles.inviteCard}>
                                    <p className={styles.inviteName}>{chat.groupName || "Group Chat"}</p>
                                    <div className={styles.inviteActions}>
                                        <button
                                            onClick={() => updateDoc(doc(db, "chats", chat.id), {
                                                userIds: arrayUnion(user.uid),
                                                pendingUserIds: arrayRemove(user.uid),
                                                [`users.${user.uid}`]: { displayName: user.displayName, photoURL: user.photoURL }
                                            })}
                                            className="btn btn-success btn-sm"
                                        >
                                            <Check size={12} /> Join
                                        </button>
                                        <button
                                            onClick={() => updateDoc(doc(db, "chats", chat.id), {
                                                pendingUserIds: arrayRemove(user.uid)
                                            })}
                                            className="btn btn-danger btn-sm"
                                        >
                                            <X size={12} /> Decline
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className={styles.createGroupContainer}>
                        {showGroupModal ? (
                            <form onSubmit={createGroup} className={styles.createGroupForm}>
                                <input
                                    autoFocus
                                    placeholder="Group Name"
                                    className={styles.groupInput}
                                    value={newGroupName}
                                    onChange={e => setNewGroupName(e.target.value)}
                                />
                                <button type="submit" className="btn btn-primary btn-sm">Create</button>
                                <button type="button" onClick={() => setShowGroupModal(false)} className="btn btn-ghost btn-sm"><X size={12} /></button>
                            </form>
                        ) : (
                            <button
                                onClick={() => setShowGroupModal(true)}
                                className={styles.createGroupTrigger}
                            >
                                <Users size={12} /> Create Group
                            </button>
                        )}
                    </div>


                    {/* Groups or Invites Logic Remained Above (not replacing) */}

                    {/* Pinned Section */}
                    {pinnedChatIds.length > 0 && (
                        <>
                            <h4 className={styles.sectionTitle}>Pinned Message</h4>
                            {sortedChats.filter(c => pinnedChatIds.includes(c.id)).map(chat => (
                                <ChatListItem
                                    key={chat.id}
                                    chat={chat}
                                    activeChat={activeChat}
                                    onSelectChat={onSelectChat}
                                    togglePin={togglePin}
                                    user={user}
                                    pinnedChatIds={pinnedChatIds}
                                    usersStatus={usersStatus}
                                />
                            ))}
                        </>
                    )}

                    {sortedChats.filter(c => !pinnedChatIds.includes(c.id)).length > 0 && (
                        <h4 className={styles.sectionTitle}>Messages</h4>
                    )}
                    {sortedChats.filter(c => !pinnedChatIds.includes(c.id)).map(chat => (
                        <ChatListItem
                            key={chat.id}
                            chat={chat}
                            activeChat={activeChat}
                            onSelectChat={onSelectChat}
                            togglePin={togglePin}
                            user={user}
                            pinnedChatIds={pinnedChatIds}
                            usersStatus={usersStatus}
                        />
                    ))}

                    {chats.length === 0 && (
                        <div className={styles.emptyState}>
                            <MessageSquare className={styles.emptyIcon} />
                            No chats yet
                        </div>
                    )}
                </div>
            )}
        </aside>
    );
}

// Subcomponent for cleaner code
function ChatListItem({ chat, activeChat, onSelectChat, togglePin, user, pinnedChatIds, usersStatus }) {
    const isPinned = pinnedChatIds.includes(chat.id);
    const isGroup = chat.type === 'group';
    let displayName = "User";
    let photo = null;

    if (isGroup) {
        displayName = chat.groupName;
    } else {
        const otherUserId = chat.userIds.find(id => id !== user.uid);
        const otherUser = chat.users?.[otherUserId] || { displayName: "User" };
        displayName = otherUser.displayName;
        photo = otherUser.photoURL;
    }

    const renderStatus = () => {
        if (isGroup) return null;
        const otherUserId = chat.userIds.find(id => id !== user.uid);
        const s = usersStatus[otherUserId] || 'offline';
        // Only show green dot for online, maybe red for call. 
        // Offline/Idle we hide or subtle. 
        if (s === 'online') return <span className={clsx(styles.statusDot, "bg-green-500")}></span>;
        if (s === 'in-call') return <span className={clsx(styles.statusDot, "bg-red-500")}></span>;
        return null;
    };

    return (
        <button
            onClick={() => onSelectChat(chat)}
            className={clsx(styles.chatItem, activeChat?.id === chat.id && styles.chatItemActive, "group relative")}
        >
            <div className={styles.chatAvatar}>
                {photo ? (
                    <img src={photo} className={styles.avatarImg} />
                ) : (
                    isGroup ? <Users size={20} /> : <UserIcon size={20} />
                )}
                {renderStatus()}
            </div>
            <div className={styles.chatInfo}>
                <div className={styles.chatHeader}>
                    <h3 className={styles.chatName}>
                        {displayName}
                        {isPinned && <Pin size={12} className="inline ml-1 text-blue-400 rotate-45" />}
                    </h3>
                    <span className={styles.chatTime}>
                        {chat.lastUpdated?.toMillis ? new Date(chat.lastUpdated.toMillis()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                </div>
                <p className={styles.chatPreview}>
                    {chat.lastMessage}
                </p>
            </div>
            <div
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-slate-700/50 text-slate-400 hover:text-white"
                onClick={(e) => togglePin(e, chat.id)}
                title={isPinned ? "Unpin chat" : "Pin chat"}
            >
                {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
            </div>
        </button>
    );
}

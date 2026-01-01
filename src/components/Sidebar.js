"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, getDocs, updateDoc, doc, arrayUnion, arrayRemove } from "firebase/firestore";
import { Search, Plus, MessageSquare, LogOut, User as UserIcon, Users, Check, X, Camera, Lock, Save, Trash2 } from "lucide-react";
import clsx from "clsx";
import styles from "./Sidebar.module.css";
import { compressImage } from "@/lib/utils";

import { useUI } from "@/context/UIContext";

export default function Sidebar({ onSelectChat, activeChat }) {
    const { user, logout, updateUserProfile, updateUserPassword } = useAuth();
    const { showToast, confirmAction } = useUI();
    const [chats, setChats] = useState([]);

    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");

    const [invites, setInvites] = useState([]);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [newGroupName, setNewGroupName] = useState("");

    // Profile Modal State
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [editMode, setEditMode] = useState("general");
    const [profileData, setProfileData] = useState({ username: user?.displayName || "", photoURL: user?.photoURL || "" });
    const [passwordData, setPasswordData] = useState({ newPassword: "", confirmPassword: "" });
    const [tempAvatar, setTempAvatar] = useState(null);
    const [tempAvatarPreview, setTempAvatarPreview] = useState(null);

    // Presence State
    const [usersStatus, setUsersStatus] = useState({});

    // Profile Handlers
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
            chatList.sort((a, b) => b.lastUpdated?.toMillis() - a.lastUpdated?.toMillis());
            setChats(chatList);
        });

        const unsubInvites = onSnapshot(qInvites, (snapshot) => {
            setInvites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        return () => { unsubChats(); unsubInvites(); };
    }, [user]);

    // Real-time Status Listener
    useEffect(() => {
        // Collect all unique user IDs from chats to listen to their status
        // Simplification: Listen to all friends? Or just listen to 'users' collection generally if small app.
        // For scalability, we should use 'in' query batches, but for now let's just listen to the collection 
        // to handle the requirement without over-engineering for 1000s of users yet.
        // Better: Listen to users we have chats with.

        const allUserIds = new Set();
        chats.forEach(c => c.userIds.forEach(uid => allUserIds.add(uid)));
        if (allUserIds.size === 0) return;

        // Note: 'in' query limits to 30. If > 30, we'd need batches.
        // Let's just listen to the users collection changes.
        const q = query(collection(db, "users"));

        const unsub = onSnapshot(q, (snap) => {
            const statusMap = {};
            snap.docs.forEach(d => {
                const data = d.data();
                // Calc status if 'lastSeen' is used instead of explicit status
                // But AuthContext calculates it. We just read 'status'.
                // Fallback calc for safety
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
        return 'bg-slate-500'; // offline/cross
    };

    // ... handleSearch ... startChat ... createGroup ... acceptInvite ...

    // (Only showing changed parts for brevity in tool call, but replacing whole file content for safety/completeness)
    // Actually, I must replicate the omitted functions to ensure replace works.

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

        onSelectChat({ id: newChat.id, ...targetUser });
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
        onSelectChat({ id: newChat.id, type: "group", groupName: newGroupName });
    };

    return (
        <aside className={styles.sidebar}>
            {/* Profile Modal */}
            {showProfileModal && (
                <div className={styles.modalOverlay} style={{ zIndex: 60 }}>
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
                            <form onSubmit={handleUpdateProfile} className="flex flex-col gap-4">
                                <div className="flex justify-center flex-col items-center gap-2">
                                    <label className="relative cursor-pointer group">
                                        <div className="w-24 h-24 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center overflow-hidden">
                                            <img src={tempAvatarPreview || profileData.photoURL || user?.photoURL} className="w-full h-full object-cover" />
                                        </div>
                                        <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Camera size={24} className="text-white" />
                                        </div>
                                        <input type="file" hidden accept="image/*" onChange={handleAvatarChange} />
                                    </label>
                                    {(tempAvatar || profileData.photoURL) && (
                                        <button type="button" onClick={handleDeleteAvatar} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
                                            <Trash2 size={12} /> Remove Picture
                                        </button>
                                    )}
                                </div>
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs text-slate-400 uppercase font-bold">Username</label>
                                    <input
                                        className={styles.modalInput}
                                        value={profileData.username}
                                        onChange={e => setProfileData({ ...profileData, username: e.target.value })}
                                    />
                                </div>
                                <button type="submit" className="btn btn-primary"><Save size={16} /> Save Changes</button>
                            </form>
                        ) : (
                            <form onSubmit={handleUpdatePassword} className="flex flex-col gap-4">
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
                                    className={styles.messageBtn}
                                >
                                    Message
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className={styles.chatList}>
                    {/* Invites Section & Create Group ... (kept same logic, just ensuring layout) */}
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
                                            className={styles.joinBtn}
                                        >
                                            <Check size={12} /> Join
                                        </button>
                                        <button
                                            onClick={() => updateDoc(doc(db, "chats", chat.id), {
                                                pendingUserIds: arrayRemove(user.uid)
                                            })}
                                            className={styles.declineBtn}
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
                                <button type="submit" className={styles.createBtn}>Create</button>
                                <button type="button" onClick={() => setShowGroupModal(false)} className={styles.cancelBtn}><X size={12} /></button>
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

                    {chats.map(chat => {
                        const isGroup = chat.type === 'group';
                        let displayName = "User";
                        let photo = null;
                        let statusColor = "bg-slate-500";
                        let isOnline = false;

                        if (isGroup) {
                            displayName = chat.groupName;
                        } else {
                            const otherUserId = chat.userIds.find(id => id !== user.uid);
                            const otherUser = chat.users?.[otherUserId] || { displayName: "User" };
                            displayName = otherUser.displayName;
                            photo = otherUser.photoURL;
                            statusColor = getStatusColor(otherUserId);
                            if (statusColor === 'bg-slate-500') {
                                // Offline/Cross
                                statusColor = 'bg-slate-500'; // actually we might want an X icon?
                                // User asked for: "more than 5 minutes it will show a cross"
                                // The dot CSS usually handles color. 
                                // Handling 'cross' might require rendering an SVG instead of a span.
                            }
                        }

                        // Status Dot Logic
                        const renderStatus = () => {
                            if (isGroup) return null;
                            const otherUserId = chat.userIds.find(id => id !== user.uid);
                            const s = usersStatus[otherUserId] || 'offline';

                            if (s === 'offline') {
                                return (
                                    <div className="absolute bottom-0 right-0 bg-slate-800 rounded-full p-[1px]">
                                        <X size={12} className="text-slate-500" />
                                    </div>
                                );
                            }

                            let color = 'bg-slate-500';
                            if (s === 'online') color = 'bg-green-500';
                            if (s === 'idle') color = 'bg-yellow-500';
                            if (s === 'in-call') color = 'bg-red-500';

                            return <span className={clsx(styles.statusDot, color)}></span>;
                        };

                        return (
                            <button
                                key={chat.id}
                                onClick={() => onSelectChat(chat)}
                                className={clsx(styles.chatItem, activeChat?.id === chat.id && styles.chatItemActive)}
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
                                        <h3 className={styles.chatName}>{displayName}</h3>
                                        <span className={styles.chatTime}>
                                            {chat.lastUpdated?.toMillis ? new Date(chat.lastUpdated.toMillis()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                        </span>
                                    </div>
                                    <p className={styles.chatPreview}>
                                        {chat.lastMessage}
                                    </p>
                                </div>
                            </button>
                        );
                    })}
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

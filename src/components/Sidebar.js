"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, getDocs, updateDoc, doc, arrayUnion, arrayRemove } from "firebase/firestore";
import { Search, Plus, MessageSquare, LogOut, User as UserIcon, Users, Check, X, Camera, Lock, Save, Trash2, Bell, BellOff, Pin, PinOff, ChevronLeft, AlertCircle } from "lucide-react";
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
    const [passwordData, setPasswordData] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
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

    // Poll User's Chats & Invites from MongoDB API
    useEffect(() => {
        if (!user) return;

        const fetchChats = async () => {
            try {
                const res = await fetch(`/api/chats?userId=${user.uid}`);
                if (!res.ok) throw new Error(`Status: ${res.status}`);

                const data = await res.json();
                if (data.success) {
                    const allChats = data.data;
                    // Separate invites (where user is in pendingUserIds)
                    const myChats = allChats.filter(c => c.userIds.includes(user.uid));
                    const myInvites = allChats.filter(c => c.pendingUserIds?.includes(user.uid));

                    // Client-side mapping to match old structure if needed, 
                    // or just use directly. Mongoose returns _id, we need id.
                    setChats(myChats.map(c => ({ ...c, id: c._id })));
                    setInvites(myInvites.map(c => ({ ...c, id: c._id })));
                }
            } catch (err) {
                console.error("Failed to fetch chats", err);
            }
        };

        fetchChats();
        const interval = setInterval(fetchChats, 3000); // Poll every 3s
        return () => clearInterval(interval);
    }, [user]);

    // Presence Listener (Optimized: Only listen to online users)
    useEffect(() => {
        // Listening to ALL users is too heavy and hits quota (as seen in logs).
        // Instead, we only listen for users who are nominally 'online'.
        // This relies on users updating their status correctly.

        const q = query(collection(db, "users"), where("status", "in", ["online", "in-call"]));

        const unsub = onSnapshot(q, (snap) => {
            const statusMap = {};
            snap.docs.forEach(d => {
                const data = d.data();
                // Check timeout locally too
                let finalStatus = data.status || 'offline';
                if (data.status === 'online' && data.lastSeen) {
                    const diff = Date.now() - data.lastSeen.toMillis();
                    if (diff > 5 * 60 * 1000) finalStatus = 'offline';
                    else if (diff > 60 * 1000) finalStatus = 'idle';
                }
                statusMap[d.id] = finalStatus;
            });
            setUsersStatus(statusMap);
        }, (error) => {
            console.error("Presence listener error", error);
        });

        return () => unsub();
    }, []);

    // ... Search Logic needs to check MongoDB or Firestore?
    // User Discovery: "users" collection in Firestore is the source of truth for Auth profiles.
    // So handleSearch stays Firestore.

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;

        try {
            // Simple prefix search on displayName
            const q = query(
                collection(db, "users"),
                where("displayName", ">=", searchQuery),
                where("displayName", "<=", searchQuery + '\uf8ff')
            );

            const querySnapshot = await getDocs(q);
            const results = [];
            querySnapshot.forEach((doc) => {
                if (doc.id !== user.uid) {
                    results.push({ uid: doc.id, ...doc.data(), username: doc.data().displayName });
                }
            });
            setSearchResults(results);
        } catch (error) {
            console.error("Error searching users:", error);
            showToast("Search failed", "error");
        }
    };

    const startChat = async (targetUser) => {
        // Check existing in local state
        const existing = chats.find(c => c.userIds.includes(targetUser.uid) && c.type === 'direct');
        if (existing) {
            onSelectChat(existing);
            setIsSearching(false);
            return;
        }

        // Create new via API
        try {
            const res = await fetch('/api/chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userIds: [user.uid, targetUser.uid],
                    users: {
                        [user.uid]: { displayName: user.displayName, photoURL: user.photoURL },
                        [targetUser.uid]: { displayName: targetUser.username, photoURL: targetUser.photoURL }
                    },
                    type: "direct",
                    lastMessage: "Started a chat"
                })
            });
            const data = await res.json();
            if (data.success) {
                const newChat = { ...data.data, id: data.data._id };
                onSelectChat({
                    ...newChat,
                    ...targetUser // Helper for Display?
                });
                // Manually update local state to avoid waiting for poll
                setChats(prev => [newChat, ...prev]);
                setIsSearching(false);
            }
        } catch (err) {
            console.error(err);
            showToast("Failed to start chat", "error");
        }
    };

    const createGroup = async (e) => {
        e.preventDefault();
        if (!newGroupName.trim()) return;

        try {
            const res = await fetch('/api/chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userIds: [user.uid],
                    users: { [user.uid]: { displayName: user.displayName, photoURL: user.photoURL } },
                    type: "group",
                    groupName: newGroupName,
                    adminIds: [user.uid],
                    lastMessage: "Group created"
                })
            });
            const data = await res.json();
            if (data.success) {
                const newChat = { ...data.data, id: data.data._id };
                setNewGroupName("");
                setShowGroupModal(false);
                onSelectChat(newChat);
                setChats(prev => [newChat, ...prev]);
            }
        } catch (err) {
            console.error(err);
            showToast("Failed to create group", "error");
        }
    };

    // Invites handling (Join/Decline) -> Use PATCH/DELETE API
    const handleJoinGroup = async (chat) => {
        try {
            const updatedUsers = { ...chat.users, [user.uid]: { displayName: user.displayName, photoURL: user.photoURL } };
            const res = await fetch(`/api/chats/${chat.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userIds: [...chat.userIds, user.uid],
                    pendingUserIds: chat.pendingUserIds.filter(id => id !== user.uid),
                    users: updatedUsers
                })
            });
            if (res.ok) {
                showToast("Joined group!", "success");
                // State will update on next poll
            }
        } catch (err) { console.error(err); }
    };

    const handleDeclineGroup = async (chat) => {
        try {
            const res = await fetch(`/api/chats/${chat.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pendingUserIds: chat.pendingUserIds.filter(id => id !== user.uid)
                })
            });
            if (res.ok) showToast("Declined invite", "info");
        } catch (err) { console.error(err); }
    };

    // Replace the invite render logic with new handlers
    // ...

    // Sort Chats
    const sortedChats = [...chats].sort((a, b) => {
        const isPinnedA = pinnedChatIds.includes(a.id);
        const isPinnedB = pinnedChatIds.includes(b.id);
        if (isPinnedA && !isPinnedB) return -1;
        if (!isPinnedA && isPinnedB) return 1;
        return new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0);
    });

    return (
        <aside className={styles.sidebar}>
            {showProfileModal && (
                <div className={styles.modalOverlay} style={{ zIndex: 60 }}>
                    <div className={clsx(styles.modalContent, "relative")}>
                        {/* Header */}
                        <div className={styles.profileModalHeader}>
                            {editMode === "general" ? (
                                <h3 className={styles.profileTitle}>Settings</h3>
                            ) : (
                                <button type="button" onClick={() => setEditMode("general")} className={styles.backBtn}>
                                    <ChevronLeft size={20} /> Back
                                </button>
                            )}
                            <button onClick={() => setShowProfileModal(false)} className={styles.closeBtn}>
                                <X size={24} />
                            </button>
                        </div>

                        <div className={styles.profileBody}>
                            {editMode === "general" ? (
                                <form onSubmit={handleUpdateProfile} className="flex flex-col gap-6 h-full">

                                    {/* Avatar */}
                                    <div className={styles.profileAvatarContainer}>
                                        <div className={styles.avatarWrapper}>
                                            <div className={styles.avatarSurface}>
                                                <img src={tempAvatarPreview || profileData.photoURL || user?.photoURL} className="w-full h-full object-cover" />
                                            </div>
                                            <label className={styles.avatarEditBadge}>
                                                <Camera size={20} />
                                                <input type="file" hidden accept="image/*" onChange={handleAvatarChange} />
                                            </label>
                                        </div>
                                        {/* Remove Photo Option */}
                                        {(tempAvatar || profileData.photoURL) && (
                                            <button type="button" onClick={handleDeleteAvatar} className={styles.removePhotoBtn}>
                                                Remove picture
                                            </button>
                                        )}
                                    </div>

                                    {/* Inputs */}
                                    <div className={styles.inputGroup}>
                                        {/* Name */}
                                        <div className={styles.textField}>
                                            <input
                                                className={styles.textInput}
                                                value={profileData.username || ""}
                                                onChange={e => setProfileData({ ...profileData, username: e.target.value })}
                                                placeholder="Display Name"
                                            />
                                            <UserIcon size={20} className={styles.fieldIcon} />
                                        </div>

                                        {/* Change Password Trigger */}
                                        <button type="button" onClick={() => setEditMode("security")} className={styles.passwordChangeBtn}>
                                            <span>Password & Security</span>
                                            <Lock size={20} className={styles.fieldIcon} />
                                        </button>
                                    </div>

                                    {/* Toggle */}
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            const newState = !profileData.notificationsEnabled;
                                            if (newState) {
                                                const granted = await NotificationService.requestPermission();
                                                if (!granted) return showToast("Permission denied", "error");
                                            }
                                            setProfileData({ ...profileData, notificationsEnabled: newState });
                                            updateUserProfile({ notificationsEnabled: newState });
                                        }}
                                        className={clsx(styles.notificationToggle, profileData.notificationsEnabled && styles.active)}
                                    >
                                        <div className="flex items-center gap-3">
                                            {profileData.notificationsEnabled ? <Bell size={24} /> : <BellOff size={24} />}
                                            <span className="font-medium">Notifications</span>
                                        </div>
                                        <div className={styles.toggleLabel}>
                                            {profileData.notificationsEnabled ? "On" : "Off"}
                                        </div>
                                    </button>

                                    <div className="flex-1" />

                                    {/* Footer */}
                                    <div className={styles.settingsFooter}>
                                        <button type="submit" className={styles.saveBtn}>
                                            Save Changes
                                        </button>
                                        <button type="button" onClick={() => { setShowProfileModal(false); logout(); }} className={styles.logoutBtn}>
                                            <LogOut size={18} /> Logout
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <form onSubmit={handleUpdatePassword} className="flex flex-col gap-6 h-full">
                                    <div className={styles.securityAlert}>
                                        <AlertCircle size={24} />
                                        <p>Make sure your new password is at least 6 characters long and secure.</p>
                                    </div>

                                    <div className={styles.inputGroup}>
                                        <div className={styles.textField}>
                                            <input
                                                type="password"
                                                className={styles.textInput}
                                                value={passwordData.currentPassword || ""}
                                                onChange={e => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                                                placeholder="Current Password"
                                            />
                                        </div>
                                        <div className={styles.textField}>
                                            <input
                                                type="password"
                                                className={styles.textInput}
                                                value={passwordData.newPassword || ""}
                                                onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                                                placeholder="New Password"
                                            />
                                        </div>
                                        <div className={styles.textField}>
                                            <input
                                                type="password"
                                                className={styles.textInput}
                                                value={passwordData.confirmPassword || ""}
                                                onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                                                placeholder="Confirm Password"
                                            />
                                        </div>
                                    </div>

                                    <div className="mt-auto pt-4">
                                        <button type="submit" className={clsx(styles.saveBtn, styles.fullWidthBtn)}>
                                            Update Password
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className={styles.header}>
                <div onClick={() => { setProfileData(prev => ({ ...prev, username: user?.displayName || "", photoURL: user?.photoURL || "" })); setShowProfileModal(true); }} className={`${styles.userInfo} ${styles.clickableHeader}`}>
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
                    {/* Invites Section */}
                    {invites.length > 0 && (
                        <div className={styles.inviteSection}>
                            <h3 className={styles.inviteTitle}>Invites</h3>
                            {invites.map(chat => (
                                <div key={chat.id} className={styles.inviteCard}>
                                    <p className={styles.inviteName}>{chat.groupName || "Group Chat"}</p>
                                    <div className={styles.inviteActions}>
                                        <button
                                            onClick={() => handleJoinGroup(chat)}
                                            className="btn btn-success btn-sm"
                                        >
                                            <Check size={12} /> Join
                                        </button>
                                        <button
                                            onClick={() => handleDeclineGroup(chat)}
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

function ChatListItem({ chat, activeChat, onSelectChat, togglePin, user, pinnedChatIds, usersStatus }) {
    // Fix Hydration Mismatch for Dates
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        setIsMounted(true);
    }, []);

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
                        {isMounted && chat.lastUpdated ? new Date(chat.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
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

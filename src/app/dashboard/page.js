"use client";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import ChatWindow from "@/components/ChatWindow";
import CallOverlay from "@/components/CallOverlay";
import { collection, query, where, onSnapshot, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import styles from "./dashboard.module.css";

export default function Dashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [activeChat, setActiveChat] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [outgoingCallTarget, setOutgoingCallTarget] = useState(null);

  // Listen for Incoming Calls
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "calls"),
      where("targetId", "==", user.uid),
      where("status", "==", "offering"),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const doc = snap.docs[0];
        setIncomingCall({ id: doc.id, ...doc.data() });
      }
    });
    return () => unsub();
  }, [user]);

  const startCall = () => {
    if (!activeChat || !activeChat.userIds) {
      console.error("Cannot start call: Invalid chat data", activeChat);
      return;
    }
    // Find the other user in activeChat
    const targetId = activeChat.userIds.find(id => id !== user.uid);
    if (!targetId) return; // Self-chat or empty group?

    const targetUser = activeChat.users?.[targetId] || { displayName: "User", photoURL: "" };
    setOutgoingCallTarget({ uid: targetId, ...targetUser });
  };

  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className={styles.spinnerContainer}>
        <div className={styles.spinner} />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className={styles.container}>
      <div className={`${styles.sidebarWrapper} ${activeChat ? styles.hiddenOnMobile : styles.flexOnMobile}`}>
        <Sidebar
          activeChat={activeChat}
          onSelectChat={setActiveChat}
        />
      </div>

      <main className={`${styles.mainContent} ${!activeChat ? styles.hiddenOnMobile : styles.flexOnMobile}`}>
        {activeChat ? (
          <ChatWindow
            chat={activeChat}
            onStartCall={startCall}
            onBack={() => setActiveChat(null)}
          />
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIconWrapper}>
              <span className={styles.emptyEmoji}>👋</span>
            </div>
            <div className={styles.emptyTextContainer}>
              <h2 className={styles.emptyTitle}>Welcome to Coms</h2>
              <p className={styles.emptySubtitle}>Select a chat to start messaging</p>
            </div>
          </div>
        )}
      </main>

      {/* Call Overlays */}
      {incomingCall && (
        <CallOverlay
          activeCall={incomingCall}
          isIncoming={true}
          onClose={() => setIncomingCall(null)}
        />
      )}
      {outgoingCallTarget && (
        <CallOverlay
          activeCall={outgoingCallTarget}
          isIncoming={false}
          onClose={() => setOutgoingCallTarget(null)}
        />
      )}
    </div>
  );
}

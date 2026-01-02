"use client";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import ChatWindow from "@/components/ChatWindow";
import CallOverlay from "@/components/CallOverlay";
import GroupCallOverlay from "@/components/GroupCallOverlay";
import { collection, query, where, onSnapshot, limit, addDoc, serverTimestamp, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import styles from "./dashboard.module.css";

export default function Dashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [activeChat, setActiveChat] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [outgoingCallTarget, setOutgoingCallTarget] = useState(null);

  // Listen for Incoming Calls & Missed Calls
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "calls"),
      where("targetId", "==", user.uid),
      where("status", "in", ["offering", "missed"]),
      limit(10) // Allow multiple checks
    );
    const unsub = onSnapshot(q, async (snap) => {
      snap.docChanges().forEach(async (change) => {
        if (change.type === "added" || change.type === "modified") {
          const data = change.doc.data();
          if (data.status === 'offering') {
            setIncomingCall({ id: change.doc.id, ...data });
            if (document.hidden) {
              const { NotificationService } = await import("@/lib/notifications");
              NotificationService.send("Incoming Call", { body: `${data.callerName} is calling...`, tag: 'call' });
            }
          }
          if (data.status === 'missed') {
            // Notification
            const { NotificationService } = await import("@/lib/notifications");
            NotificationService.send("Missed Call", { body: `You missed a call from ${data.callerName}`, tag: 'missed-call' });
            // Cleanup
            deleteDoc(change.doc.ref);
            setIncomingCall(prev => (prev?.id === change.doc.id ? null : prev));
          }
        }
        if (change.type === "removed") {
          setIncomingCall(prev => (prev?.id === change.doc.id ? null : prev));
        }
      });
    });
    return () => unsub();
  }, [user]);

  const startCall = async () => {
    if (!activeChat || !activeChat.userIds) {
      console.error("Cannot start call: Invalid chat data", activeChat);
      return;
    }

    if (activeChat.type === 'group') {
      // Group Call Logic
      // For distinct UI, we might trigger a different state or overlay
      // Create a call room in Firestore
      try {
        const callDoc = await addDoc(collection(db, "calls"), {
          chatId: activeChat.id,
          hostId: user.uid,
          hostName: user.displayName,
          participants: [user.uid],
          status: "active", // Group calls are "active" immediately, people join
          type: "group",
          createdAt: serverTimestamp()
        });
        // We'll use a specific state for group calls to render the Grid UI
        setIncomingCall({
          id: callDoc.id,
          isGroup: true,
          ...activeChat,
          isHost: true // Current user started it
        });
      } catch (e) {
        console.error("Failed to start group call", e);
      }
      return;
    }

    // Direct Call Logic (Existing 1:1)
    const targetId = activeChat.userIds.find(id => id !== user.uid);
    if (!targetId) return;

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
      {incomingCall && incomingCall.isGroup ? (
        <GroupCallOverlay
          activeCall={incomingCall}
          onClose={() => setIncomingCall(null)}
        />
      ) : incomingCall && !incomingCall.isGroup ? (
        <CallOverlay
          activeCall={incomingCall}
          isIncoming={true}
          onClose={() => setIncomingCall(null)}
        />
      ) : null}

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

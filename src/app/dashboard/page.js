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

import { io } from "socket.io-client";

export default function Dashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [activeChat, setActiveChat] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [outgoingCallTarget, setOutgoingCallTarget] = useState(null);
  const [socket, setSocket] = useState(null);

  // Initialize Socket.io
  useEffect(() => {
    if (!user) return;

    // Use environment variable for backend URL or default to current origin
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin;

    const newSocket = io(socketUrl, {
      path: "/socket.io", // Standard path for socket.io
      reconnectionAttempts: 5,
      ackTimeout: 10000,
      transports: ['websocket', 'polling']
    });

    newSocket.on("connect", () => {
      // console.log("Socket connected:", newSocket.id);
      newSocket.emit("register", user.uid);
    });

    newSocket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [user]);

  // Listen for Incoming Calls & Missed Calls
  // Listen for Incoming Calls & Missed Calls
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "calls"),
      where("targetId", "==", user.uid),
      where("status", "in", ["offering", "accepted", "missed"]), // Include accepted
      limit(10)
    );
    const unsub = onSnapshot(q, async (snap) => {
      snap.docChanges().forEach(async (change) => {
        if (change.type === "added" || change.type === "modified") {
          const data = change.doc.data();
          if (data.status === 'offering' || data.status === 'accepted') {
            setIncomingCall({ id: change.doc.id, ...data });

            // Only notify on new offering
            if (data.status === 'offering' && change.type === "added" && document.hidden) {
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
          // If the doc is removed (e.g. call ended and deleted), clear state
          setIncomingCall(prev => (prev?.id === change.doc.id ? null : prev));
        }
      });
    });
    return () => unsub();
  }, [user]);

  // Backup Prompt on Exit (Window Close)
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      // Modern browsers don't show custom messages, but setting returnValue triggers the dialog.
      // We rely on the user knowing they should backup if they see this.
      const msg = "Have you backed up your chats? Changes may not be saved externally.";
      e.preventDefault();
      e.returnValue = msg;
      return msg;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

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
            socket={socket}
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

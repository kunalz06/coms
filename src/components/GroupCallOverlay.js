import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import styles from './GroupCallOverlay.module.css';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Users, Monitor } from 'lucide-react';
import clsx from 'clsx';
import SimplePeer from 'simple-peer';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, collection, addDoc, updateDoc, arrayUnion, arrayRemove, setDoc, deleteDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';

export default function GroupCallOverlay({ activeCall, onClose }) {
    const { user } = useAuth();
    const [stream, setStream] = useState(null);
    const [peers, setPeers] = useState([]); // Array of { uid, peer, stream }
    const userVideoRef = useRef();
    const peersRef = useRef([]); // Keep track of peers to avoid closure staleness
    const callDocRef = doc(db, "calls", activeCall.id);

    // Controls
    const [isAudioOff, setIsAudioOff] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);

    useEffect(() => {
        // 1. Initialize User Media
        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then(currentStream => {
                setStream(currentStream);
                if (userVideoRef.current) {
                    userVideoRef.current.srcObject = currentStream;
                }

                // 2. Join the Call (Add self to participants)
                updateDoc(callDocRef, {
                    participants: arrayUnion(user.uid)
                });

                // 3. Listen for Participants
                const unsub = onSnapshot(callDocRef, (snapshot) => {
                    const data = snapshot.data();
                    if (!data) {
                        // Call ended/deleted
                        cleanup();
                        onClose();
                        return;
                    }

                    const participants = data.participants || [];

                    // For each participant, check if we need a connection
                    participants.forEach(targetUid => {
                        if (targetUid === user.uid) return; // Skip self

                        // Check if peer already exists
                        if (!peersRef.current.find(p => p.uid === targetUid)) {
                            // Determine Initiator (Convention: Smaller UID initiates)
                            // This ensures only one side starts the handshake
                            const isInitiator = user.uid < targetUid;
                            createPeer(targetUid, user.uid, isInitiator, currentStream);
                        }
                    });

                    // Cleanup peers who left
                    const leftUsers = peersRef.current.filter(p => !participants.includes(p.uid));
                    leftUsers.forEach(p => {
                        p.peer.destroy();
                    });
                    const remainingPeers = peersRef.current.filter(p => participants.includes(p.uid));
                    peersRef.current = remainingPeers;
                    setPeers([...remainingPeers]);
                });

                return () => unsub();
            })
            .catch(err => console.error("Error accessing media:", err));

        return () => cleanup();
    }, []);

    // Global Signal Listener
    useEffect(() => {
        const q = query(
            collection(db, "calls", activeCall.id, "signals"),
            where("to", "==", user.uid)
        );

        const unsub = onSnapshot(q, (snap) => {
            snap.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    // Find the peer sending this
                    const targetPeer = peersRef.current.find(p => p.uid === data.from);
                    if (targetPeer && targetPeer.peer) {
                        targetPeer.peer.signal(data.signal);
                    }
                }
            });
        });

        return () => unsub();
    }, [activeCall.id, user.uid]);

    const createPeer = (targetUid, myUid, isInitiator, myStream) => {
        const peer = new SimplePeer({
            initiator: isInitiator,
            trickle: false,
            stream: myStream
        });

        // Unique Signal ID: "Target_Sender" (so each person listens for signals INTENDED for them)
        // If I am Initiator sending to Target: I write to "Target_Me"
        // If I am Receiver replying to Initiator: I write to "Initiator_Me"
        // A simpler way:
        // Signaling Document ID: sorted(uid1, uid2).join("_")
        // Fields: { [initiatorUid]: signalData, [receiverUid]: signalData }
        // BUT simple-peer enables full negotiation.
        // Send Signals via append-only queue (robust for candidates)
        peer.on('signal', signal => {
            addDoc(collection(db, "calls", activeCall.id, "signals"), {
                signal,
                from: myUid,
                to: targetUid,
                createdAt: serverTimestamp()
            });
        });

        peer.on('stream', remoteStream => {
            // Update Peers State with Stream
            const updatedPeers = peersRef.current.map(p => {
                if (p.uid === targetUid) return { ...p, stream: remoteStream };
                return p;
            });
            peersRef.current = updatedPeers;
            setPeers([...updatedPeers]);
        });

        peer.on('close', () => {
            peersRef.current = peersRef.current.filter(p => p.uid !== targetUid);
            setPeers([...peersRef.current]);
        });



        // Add to Refs
        const name = activeCall.users?.[targetUid]?.displayName || "User";

        peersRef.current.push({
            uid: targetUid,
            peer,
            stream: null, // Stream comes later
            displayName: name
        });
        setPeers([...peersRef.current]);
    };

    const cleanup = () => {
        if (stream) {
            stream.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
            });
        }
        peersRef.current.forEach(p => {
            if (p.peer) p.peer.destroy();
        });
        peersRef.current = [];
        setPeers([]);

        // Remove self from participants
        // (If strictly needed. Often "hanging up" just closes the view. 
        // Ideally we remove ourselves so others know we left)
        // But we can't do async await in unmount easily.
        // Best effort:
        updateDoc(callDocRef, {
            participants: arrayRemove(user.uid)
        }).catch(err => console.warn("Failed to remove self from call", err));
    };

    const toggleAudio = () => {
        if (stream) {
            stream.getAudioTracks()[0].enabled = !stream.getAudioTracks()[0].enabled;
            setIsAudioOff(!stream.getAudioTracks()[0].enabled);
        }
    };

    const toggleVideo = () => {
        if (stream) {
            stream.getVideoTracks()[0].enabled = !stream.getVideoTracks()[0].enabled;
            setIsVideoOff(!stream.getVideoTracks()[0].enabled);
        }
    };

    const handleHangup = async () => {
        cleanup();
        onClose();
        // If host or last person, maybe delete doc? 
        // For now, let's keep it simple: just leave.
    };

    return (
        <div className={styles.overlayContainer}>
            <header className={styles.header}>
                <div className={styles.roomTitle}>
                    <Users size={24} className="text-blue-400" />
                    <span>{activeCall.groupName || "Group Call"}</span>
                </div>
                <div className={styles.participantCount}>
                    {1 + peers.length} Participants
                </div>
            </header>

            <div className={styles.gridContainer}>
                {/* Self View */}
                <div className={clsx(styles.videoTile, "border-green-500/30")}>
                    <video ref={userVideoRef} muted autoPlay playsInline className={styles.videoElement} />
                    <div className={styles.tileOverlay}>
                        <span className={styles.peerName}>You</span>
                        {isAudioOff && <MicOff size={16} className={styles.micStatus} />}
                    </div>
                </div>

                {/* Peer Views */}
                {peers.map(peer => (
                    <div key={peer.uid} className={styles.videoTile}>
                        {peer.stream ? (
                            <VideoPlayer stream={peer.stream} />
                        ) : (
                            <div className="w-full h-full bg-slate-800 flex items-center justify-center text-slate-500 flex-col gap-2">
                                <div className="w-8 h-8 rounded-full border-2 border-slate-600 border-t-white animate-spin"></div>
                                <span className="text-sm">Connecting...</span>
                            </div>
                        )}
                        <div className={styles.tileOverlay}>
                            <span className={styles.peerName}>{peer.displayName}</span>
                        </div>
                    </div>
                ))}
            </div>

            <div className={styles.controlsBar}>
                <button onClick={toggleAudio} className={clsx(styles.controlBtn, isAudioOff && "bg-red-500/20 text-red-500")}>
                    {isAudioOff ? <MicOff /> : <Mic />}
                </button>
                <button onClick={toggleVideo} className={clsx(styles.controlBtn, isVideoOff && "bg-red-500/20 text-red-500")}>
                    {isVideoOff ? <VideoOff /> : <Video />}
                </button>
                <button className={styles.controlBtn} title="Share Screen (Coming Soon)">
                    <Monitor />
                </button>
                <button onClick={handleHangup} className={clsx(styles.controlBtn, styles.hangup)}>
                    <PhoneOff />
                </button>
            </div>
        </div>
    );
}

// Helper Component to handle ref attachment
const VideoPlayer = ({ stream }) => {
    const videoRef = useRef();
    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);
    return <video ref={videoRef} autoPlay playsInline className={styles.videoElement} />;
};

"use client";
import { useEffect, useRef, useState } from "react";
import Peer from "simple-peer";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { Mic, MicOff, Video, VideoOff, PhoneOff, Monitor, MonitorOff, RefreshCcw } from "lucide-react";
import styles from "./CallOverlay.module.css";
import clsx from "clsx";
import { useUI } from "@/context/UIContext";

export default function CallOverlay({ activeCall, onClose, isIncoming }) {
    const { user } = useAuth();
    const { showToast } = useUI();
    const [stream, setStream] = useState(null);
    const [peer, setPeer] = useState(null);
    const [callAccepted, setCallAccepted] = useState(false);
    const userVideo = useRef();
    const partnerVideo = useRef();
    const [isAudioMuted, setIsAudioMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const screenTrackRef = useRef(null);
    const [connectionStatus, setConnectionStatus] = useState("Initializing...");
    const [showControls, setShowControls] = useState(true);
    const [facingMode, setFacingMode] = useState('user');

    useEffect(() => {
        // Auto-hide controls after 3 seconds of inactivity
        let timeout;
        if (showControls) {
            timeout = setTimeout(() => {
                // Only auto-hide on mobile-like widths if needed, or globally
                // For now, let's just use manual toggle for better UX or simple auto-hide
            }, 5000);
        }
        return () => clearTimeout(timeout);
    }, [showControls]);

    useEffect(() => {
        // Set presence to in-call
        updateDoc(doc(db, "users", user.uid), { status: 'in-call' });

        const initialVideoState = activeCall.withVideo !== false;
        setIsVideoOff(!initialVideoState);

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.error("Media Devices API not available. Secure context (HTTPS) required.");
            showToast("Video requires HTTPS or localhost.", "error");
            onClose();
            return;
        }

        navigator.mediaDevices.getUserMedia({ video: initialVideoState, audio: true })
            .then(currentStream => {
                setStream(currentStream);
                if (userVideo.current) {
                    userVideo.current.srcObject = currentStream;
                }

                if (isIncoming) {
                    setConnectionStatus("Incoming call...");
                } else {
                    setConnectionStatus("Calling...");
                    startCall(currentStream);
                }
            })
            .catch(err => {
                console.error("Failed to get media", err);
                showToast("Camera/Mic permission denied", "error");
                onClose();
            });

        return () => {
            if (stream) stream.getTracks().forEach(track => track.stop());
            if (peer) peer.destroy();
            // Revert status to online
            updateDoc(doc(db, "users", user.uid), { status: 'online' });
        };
    }, []);

    const toggleCamera = async () => {
        const newMode = facingMode === 'user' ? 'environment' : 'user';
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: newMode },
                audio: true
            });

            const newVideoTrack = newStream.getVideoTracks()[0];
            const oldVideoTrack = stream.getVideoTracks()[0];

            if (peer) {
                peer.replaceTrack(oldVideoTrack, newVideoTrack, stream);
            }

            if (userVideo.current) {
                userVideo.current.srcObject = newStream;
            }

            // Construct new stream with new video + existing audio (to maintain mute state if complicated, 
            // but getting new audio track is safer for simple switch, just ensure mute state is reapplied if needed)
            // Actually, simpler to just use the new stream's tracks.
            setStream(newStream);
            setFacingMode(newMode);
            setIsVideoOff(false);

            // Stop old tracks to release camera
            oldVideoTrack.stop();

        } catch (err) {
            console.error("Failed to switch camera", err);
            showToast("Camera switch failed", "error");
        }
    };

    const toggleScreenShare = () => {
        if (isScreenSharing) {
            if (screenTrackRef.current) {
                screenTrackRef.current.stop();
                screenTrackRef.current = null;
            }
            navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(camStream => {
                const camTrack = camStream.getVideoTracks()[0];
                if (peer) {
                    const sender = peer.replaceTrack(
                        peer.streams[0].getVideoTracks()[0],
                        camTrack,
                        peer.streams[0]
                    );
                }
                if (userVideo.current) userVideo.current.srcObject = camStream;
                const newStream = new MediaStream([camTrack, stream.getAudioTracks()[0]]);
                setStream(newStream);
                setIsScreenSharing(false);
                setIsVideoOff(false);
            });
        } else {
            navigator.mediaDevices.getDisplayMedia({ cursor: true })
                .then(screenStream => {
                    const screenTrack = screenStream.getVideoTracks()[0];
                    screenTrackRef.current = screenTrack;

                    if (peer) {
                        const videoTrack = stream.getVideoTracks()[0];
                        peer.replaceTrack(videoTrack, screenTrack, stream);
                    }

                    if (userVideo.current) userVideo.current.srcObject = screenStream;

                    screenTrack.onended = () => {
                        if (isScreenSharing) toggleScreenShare();
                    };

                    setIsScreenSharing(true);
                    setIsVideoOff(false);
                })
                .catch(err => console.error("Screen share failed", err));
        }
    };

    const answerCall = () => {
        setCallAccepted(true);
        setConnectionStatus("Connecting...");
        const p = new Peer({
            initiator: false,
            trickle: false,
            stream: stream,
        });

        p.on("signal", (data) => {
            updateDoc(doc(db, "calls", activeCall.id), {
                answer: JSON.stringify(data),
                status: "accepted"
            });
        });

        p.on("connect", () => setConnectionStatus("Connected"));

        p.on("stream", (currentStream) => {
            if (partnerVideo.current) partnerVideo.current.srcObject = currentStream;
        });

        p.signal(JSON.parse(activeCall.offer));
        setPeer(p);
    };

    const startCall = (currentStream) => {
        const p = new Peer({
            initiator: true,
            trickle: false,
            stream: currentStream,
        });

        p.on("signal", async (data) => {
            if (!isIncoming && !activeCall.id) {
                const callDoc = await addDoc(collection(db, "calls"), {
                    callerId: user.uid,
                    callerName: user.displayName,
                    targetId: activeCall.uid,
                    offer: JSON.stringify(data),
                    status: "offering",
                    createdAt: serverTimestamp()
                });

                onSnapshot(doc(db, "calls", callDoc.id), (snapshot) => {
                    const data = snapshot.data();
                    if (data?.answer && !p.connected) {
                        p.signal(JSON.parse(data.answer));
                        setCallAccepted(true);
                        setConnectionStatus("Connected");
                    }
                    if (data?.status === "ended") {
                        endCall();
                    }
                });
            }
        });

        p.on("stream", (currentStream) => {
            if (partnerVideo.current) partnerVideo.current.srcObject = currentStream;
        });

        if (p._pc) {
            p._pc.oniceconnectionstatechange = () => {
                const state = p._pc.iceConnectionState;
                if (state === 'disconnected' || state === 'failed') {
                    setConnectionStatus("Connection Unstable...");
                    showToast("Network connection unstable", "error");
                }
                if (state === 'connected' || state === 'completed') {
                    setConnectionStatus("Connected");
                }
            };
        }

        setPeer(p);
    };

    const endCall = async () => {
        if (activeCall.id) {
            try {
                // If I am the caller and status is still 'offering', it means it was a missed call for the target
                if (!isIncoming && activeCall.status === 'offering') {
                    await updateDoc(doc(db, "calls", activeCall.id), { status: 'missed' });
                } else {
                    // For active calls, deleting the document Signals termination to the other peer via onSnapshot('removed')
                    // Logic: Both peers listen to the doc. If deleted, they close.
                    await deleteDoc(doc(db, "calls", activeCall.id));
                }
            } catch (e) { console.error("Error ending call:", e); }
        }
        onClose();
    };

    const toggleMute = () => {
        if (stream) {
            stream.getAudioTracks()[0].enabled = !stream.getAudioTracks()[0].enabled;
            setIsAudioMuted(!stream.getAudioTracks()[0].enabled);
        }
    };

    const toggleVideo = () => {
        if (stream) {
            stream.getVideoTracks()[0].enabled = !stream.getVideoTracks()[0].enabled;
            setIsVideoOff(!stream.getVideoTracks()[0].enabled);
        }
    }



    const handleOverlayClick = () => {
        setShowControls(prev => !prev);
    };

    return (
        <div className={styles.overlayContainer}>
            <div className={styles.callCard} onClick={handleOverlayClick}>

                {/* Partner Video Area */}
                <div className="relative w-full h-full bg-slate-900">
                    {callAccepted ? (
                        <video playsInline ref={partnerVideo} autoPlay className={styles.partnerVideo} />
                    ) : (
                        <div className={styles.placeholder}>
                            <div className={styles.avatarRing}>
                                {activeCall.photoURL ? (
                                    <img src={activeCall.photoURL} className={styles.avatarImg} />
                                ) : (
                                    <div className="w-full h-full rounded-full bg-slate-700 flex items-center justify-center text-4xl font-bold">
                                        {activeCall.displayName?.[0]?.toUpperCase() || "U"}
                                    </div>
                                )}
                            </div>
                            <h2 className={styles.statusText}>{connectionStatus}</h2>
                            <p className={styles.partnerName}>{activeCall.displayName || "Unknown User"}</p>
                        </div>
                    )}
                </div>

                {/* Self View (Draggable-looking PiP) */}
                <div
                    className={styles.selfVideoWrapper}
                    onClick={(e) => e.stopPropagation()} // Prevent toggling controls when clicking self view
                >
                    <video playsInline ref={userVideo} autoPlay muted className={styles.selfVideo} />
                    {!callAccepted && isIncoming && (
                        <div className={styles.answerOverlay}>
                            <button onClick={answerCall} className={styles.answerBtn}>
                                <Video size={16} /> Answer Call
                            </button>
                        </div>
                    )}
                </div>

                {/* Controls Bar */}
                <div
                    className={clsx(styles.controlsBar, !showControls && styles.controlsHidden)}
                    onClick={(e) => e.stopPropagation()} // Prevent toggling controls when clicking buttons
                >
                    <button
                        onClick={toggleMute}
                        className={clsx(styles.controlBtn, isAudioMuted && styles.dangerActive)}
                        title={isAudioMuted ? "Unmute" : "Mute"}
                    >
                        {isAudioMuted ? <MicOff size={24} /> : <Mic size={24} />}
                    </button>

                    <button
                        onClick={toggleVideo}
                        className={clsx(styles.controlBtn, isVideoOff && styles.dangerActive)}
                        title={isVideoOff ? "Turn Video On" : "Turn Video Off"}
                    >
                        {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
                    </button>

                    <button
                        onClick={toggleScreenShare}
                        className={clsx(styles.controlBtn, isScreenSharing && styles.active)}
                        title="Share Screen"
                    >
                        {isScreenSharing ? <MonitorOff size={24} /> : <Monitor size={24} />}
                    </button>

                    <button
                        onClick={toggleCamera}
                        className={styles.controlBtn}
                        title="Flip Camera"
                    >
                        <RefreshCcw size={24} />
                    </button>

                    <button
                        onClick={endCall}
                        className={clsx(styles.controlBtn, styles.hangupBtn)}
                        title="End Call"
                    >
                        <PhoneOff size={28} />
                    </button>
                </div>
            </div>
        </div>
    );
}

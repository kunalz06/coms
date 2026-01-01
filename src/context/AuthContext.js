"use client";
import { createContext, useContext, useEffect, useState } from "react";
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile,
    updatePassword
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setUser(user);
            } else {
                setUser(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    const signup = async (email, password, username, photoURL = "") => {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Update Profile
        await updateProfile(user, {
            displayName: username,
            photoURL: photoURL
        });

        // Create User Document in Firestore
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            username,
            email,
            photoURL,
            createdAt: new Date().toISOString(),
            friends: [],
            blocked: []
        });

        return user;
    };

    const login = (email, password) => {
        return signInWithEmailAndPassword(auth, email, password);
    };

    const updateUserPassword = (newPassword) => {
        return updatePassword(user, newPassword);
    };

    const updateUserProfile = async (data) => {
        // Separate Auth fields from Firestore fields
        const authUpdates = {};
        if (data.displayName !== undefined) authUpdates.displayName = data.displayName;
        if (data.photoURL !== undefined) authUpdates.photoURL = data.photoURL;

        if (Object.keys(authUpdates).length > 0) {
            await updateProfile(user, authUpdates);
        }

        // Update all data to Firestore
        await updateDoc(doc(db, "users", user.uid), data);
    };

    // Presence Logic
    useEffect(() => {
        if (!user) return;

        let lastActivity = Date.now();
        let status = 'online';

        const updateActivity = () => {
            lastActivity = Date.now();
            if (status !== 'online') {
                status = 'online';
                // Trigger immediate update if coming back from idle
                updateHeartbeat();
            }
        };

        const updateHeartbeat = async () => {
            const now = Date.now();
            const timeSinceActivity = now - lastActivity;
            let currentStatus = 'online';

            if (timeSinceActivity > 5 * 60 * 1000) {
                currentStatus = 'offline'; // Though usually we just stop updating if really offline/closed
            } else if (timeSinceActivity > 60 * 1000) {
                currentStatus = 'idle';
            }

            status = currentStatus;

            try {
                // We don't overwrite 'inCall' here, that should be managed by the call components/logic separately
                // or we prioritize it in the UI display.
                await updateDoc(doc(db, "users", user.uid), {
                    lastSeen: serverTimestamp(),
                    status: currentStatus
                });
            } catch (e) {
                console.error("Presence update failed", e);
            }
        };

        // Listeners
        window.addEventListener('mousemove', updateActivity);
        window.addEventListener('keydown', updateActivity);
        window.addEventListener('click', updateActivity);

        // Heartbeat interval
        const interval = setInterval(updateHeartbeat, 30000); // Every 30s
        updateHeartbeat(); // Initial

        return () => {
            window.removeEventListener('mousemove', updateActivity);
            window.removeEventListener('keydown', updateActivity);
            window.removeEventListener('click', updateActivity);
            clearInterval(interval);
        };
    }, [user]);

    const logout = () => {
        return signOut(auth);
    };

    return (
        <AuthContext.Provider value={{ user, signup, login, logout, loading, updateUserPassword, updateUserProfile }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

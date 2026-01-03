"use client";
import { createContext, useContext, useEffect, useState, useRef } from "react";
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updateProfile,
    updatePassword
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { supabase } from "@/lib/supabase";

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const sessionIdRef = useRef(null);

    // Reusable Session Sync Function
    const syncSession = async (userObj) => {
        try {
            const res = await fetch('/api/auth/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uid: userObj.uid,
                    email: userObj.email,
                    username: userObj.displayName,
                    photoURL: userObj.photoURL,
                    sessionId: sessionIdRef.current
                })
            });

            if (res.ok) {
                const { data } = await res.json();
                return data;
            } else {
                console.error("Session sync failed");
                return null;
            }
        } catch (e) {
            console.error("Auth flow error", e);
            return null;
        }
    };

    useEffect(() => {
        let supabaseChannel = null;

        const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
            if (authUser) {
                try {
                    // Generate new Session ID if not present
                    if (!sessionIdRef.current) {
                        const newSessionId = crypto.randomUUID();
                        sessionIdRef.current = newSessionId;
                    }

                    // Sync to Supabase & Register Session
                    const syncedData = await syncSession(authUser);

                    // Set initial user state with merged data if available, or just auth
                    if (syncedData) {
                        setUser({ ...authUser, ...syncedData });
                    } else {
                        setUser(authUser);
                    }

                    // Subscribe to Session Changes (Enforce Single Instance)
                    supabaseChannel = supabase
                        .channel(`user:${authUser.uid}`)
                        .on('postgres_changes', {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'users',
                            filter: `id=eq.${authUser.uid}`
                        }, (payload) => {
                            const newData = payload.new;
                            if (newData.session_id && newData.session_id !== sessionIdRef.current) {
                                // Another instance logged in!
                                console.warn("Session invalidated by new login.");
                                logout();
                                // Ideally show a toast before redirecting, but simple logout works
                                alert("You have been logged out because you logged in on another device.");
                            }
                        })
                        .subscribe();

                } catch (err) {
                    console.error("Error in auth state change", err);
                }
            } else {
                setUser(null);
                setLoading(false);
                if (supabaseChannel) supabase.removeChannel(supabaseChannel);
            }
            setLoading(false);
        });

        return () => {
            unsubscribe();
            if (supabaseChannel) supabase.removeChannel(supabaseChannel);
        };
    }, []);

    const signup = async (email, password, username, photoURL = "") => {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Update Firebase Profile
        await updateProfile(user, { displayName: username, photoURL });

        // FORCE SYNC to DB immediately with new profile data
        // This ensures the username/photo is saved before the auto-sync from onAuthStateChanged (which might run with old data)
        await syncSession({ ...user, displayName: username, photoURL });

        return user;
    };

    const login = (email, password) => {
        return signInWithEmailAndPassword(auth, email, password);
    };

    const updateUserPassword = (newPassword) => {
        return updatePassword(user, newPassword);
    };

    const updateUserProfile = async (data) => {
        const authUpdates = {};
        if (data.displayName !== undefined) authUpdates.displayName = data.displayName;
        if (data.photoURL !== undefined) authUpdates.photoURL = data.photoURL;

        if (Object.keys(authUpdates).length > 0) {
            await updateProfile(user, authUpdates);
            // Re-sync session data to update DB
            await syncSession({ ...user, ...authUpdates });
        }
    };

    const logout = () => {
        sessionIdRef.current = null;
        return signOut(auth);
    };

    return (
        <AuthContext.Provider value={{ user, signup, login, logout, loading, updateUserPassword, updateUserProfile }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { openDB } from "idb";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { useAuth } from "./AuthContext";

const StorageContext = createContext({});

export const useStorage = () => useContext(StorageContext);

const DB_NAME = "coms-db";
const STORE_NAME = "messages";

export const StorageProvider = ({ children }) => {
    const { user } = useAuth();
    const [db, setDb] = useState(null);
    const [isStorageInitialized, setIsStorageInitialized] = useState(false);
    const [needsBackup, setNeedsBackup] = useState(false); // Triggers blocking modal
    const [showImportPrompt, setShowImportPrompt] = useState(false); // Triggers import modal on login

    // Initialize DB
    useEffect(() => {
        const initDB = async () => {
            const database = await openDB(DB_NAME, 1, {
                upgrade(db) {
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
                        store.createIndex("chatId", "chatId");
                        store.createIndex("createdAt", "createdAt");
                    }
                },
            });
            setDb(database);
        };
        initDB();
    }, []);

    // Check Backup Policy & Init State on User Login
    const pathname = usePathname();

    useEffect(() => {
        if (!user || !db) return;

        // Only prompt for import if we are on the dashboard
        if (!pathname?.startsWith('/dashboard')) return;

        const checkStorage = async () => {
            // Check if DB is empty
            const count = await db.count(STORE_NAME);

            if (count === 0) {
                // New session or fresh browser: Ask to Import
                setShowImportPrompt(true);
            } else {
                // ... existing logic ...
                const lastBackup = localStorage.getItem("coms_last_backup");
                if (lastBackup) {
                    const daysDiff = (Date.now() - parseInt(lastBackup)) / (1000 * 60 * 60 * 24);
                    if (daysDiff > 3) {
                        setNeedsBackup(true);
                    }
                } else {
                    localStorage.setItem("coms_last_backup", Date.now().toString());
                }
            }
            setIsStorageInitialized(true);
        };

        checkStorage();
    }, [user, db, pathname]);

    const addMessage = async (message) => {
        if (!db) return;
        await db.put(STORE_NAME, message);
    };

    const getMessages = async (chatId) => {
        if (!db) return [];
        return await db.getAllFromIndex(STORE_NAME, "chatId", chatId);
    };

    const exportBackup = async () => {
        if (!db) return;
        const allMessages = await db.getAll(STORE_NAME);
        const backendData = JSON.stringify(allMessages);

        // Create Blob and Download
        const blob = new Blob([backendData], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `coms_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        // Update Policy Logic
        localStorage.setItem("coms_last_backup", Date.now().toString());
        setNeedsBackup(false);

        // Clear DB after backup (as per requirement "browser db will be cleared")
        await db.clear(STORE_NAME);
        // Maybe reload page or reset state?
        window.location.reload();
    };

    const importBackup = async (file) => {
        if (!db || !file) return;

        try {
            const text = await file.text();
            const messages = JSON.parse(text);

            if (!Array.isArray(messages)) throw new Error("Invalid backup format");

            const tx = db.transaction(STORE_NAME, "readwrite");
            for (const msg of messages) {
                await tx.store.put(msg);
            }
            await tx.done;

            setShowImportPrompt(false);
            localStorage.setItem("coms_last_backup", Date.now().toString());
        } catch (error) {
            console.error("Import failed:", error);
            alert("Failed to import backup. Invalid file.");
        }
    };

    const skipImport = () => {
        setShowImportPrompt(false);
        localStorage.setItem("coms_last_backup", Date.now().toString());
    };

    return (
        <StorageContext.Provider value={{
            db,
            addMessage,
            getMessages,
            needsBackup,
            showImportPrompt,
            exportBackup,
            importBackup,
            skipImport
        }}>
            {children}

            {/* Blocking Backups Modal */}
            {needsBackup && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <div style={{ background: '#222', padding: '2rem', borderRadius: '12px', textAlign: 'center', maxWidth: '400px' }}>
                        <h2 style={{ marginBottom: '1rem', color: '#fff' }}>Storage Full (3 Days)</h2>
                        <p style={{ marginBottom: '2rem', color: '#aaa' }}>
                            To keep the app fast and secure, please download your chat backup. The browser storage will be cleared after download.
                        </p>
                        <button
                            onClick={exportBackup}
                            style={{ padding: '0.8rem 1.5rem', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '1rem' }}
                        >
                            Download Backup & Clear
                        </button>
                    </div>
                </div>
            )}

            {/* Import Prompt Modal */}
            {showImportPrompt && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <div style={{ background: '#222', padding: '2rem', borderRadius: '12px', textAlign: 'center', maxWidth: '400px' }}>
                        <h2 style={{ marginBottom: '1rem', color: '#fff' }}>Restore Chats?</h2>
                        <p style={{ marginBottom: '2rem', color: '#aaa' }}>
                            We found no chats on this device. Do you have a backup file to restore?
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <input
                                type="file"
                                accept=".json"
                                onChange={(e) => importBackup(e.target.files[0])}
                                style={{ display: 'none' }}
                                id="backup-upload"
                            />
                            <label
                                htmlFor="backup-upload"
                                style={{ padding: '0.8rem', background: '#2196F3', color: 'white', borderRadius: '6px', cursor: 'pointer' }}
                            >
                                Upload Backup.json
                            </label>
                            <button
                                onClick={skipImport}
                                style={{ padding: '0.8rem', background: 'transparent', border: '1px solid #555', color: '#aaa', borderRadius: '6px', cursor: 'pointer' }}
                            >
                                No, Start Fresh
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </StorageContext.Provider>
    );
};

"use client";
import { createContext, useContext, useState, useCallback } from "react";
import Toast from "@/components/UI/Toast";
import ConfirmModal from "@/components/UI/ConfirmModal";

const UIContext = createContext();

export const useUI = () => useContext(UIContext);

export const UIProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, message: "", onConfirm: () => { } });

    const showToast = useCallback((message, type = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const confirmAction = useCallback((message) => {
        return new Promise((resolve) => {
            setConfirmModal({
                isOpen: true,
                message,
                onConfirm: () => {
                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                    resolve(true);
                },
                onCancel: () => {
                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                    resolve(false);
                }
            });
        });
    }, []);

    return (
        <UIContext.Provider value={{ showToast, confirmAction }}>
            {children}
            <Toast toats={toasts} removeToast={removeToast} />
            <ConfirmModal
                isOpen={confirmModal.isOpen}
                message={confirmModal.message}
                onConfirm={confirmModal.onConfirm}
                onCancel={confirmModal.onCancel || (() => setConfirmModal(prev => ({ ...prev, isOpen: false })))}
            />
        </UIContext.Provider>
    );
};

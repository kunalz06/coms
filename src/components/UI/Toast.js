"use client";
import { useEffect } from "react";
import styles from "./Toast.module.css";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";

export default function Toast({ toasts, removeToast }) {
    return (
        <div className={styles.toastContainer}>
            {toasts.map(toast => (
                <div key={toast.id} className={`${styles.toast} ${styles[toast.type]}`}>
                    {toast.type === 'success' && <CheckCircle size={20} className="text-green-400" />}
                    {toast.type === 'error' && <AlertCircle size={20} className="text-red-400" />}
                    {toast.type === 'info' && <Info size={20} className="text-blue-400" />}
                    <div className="flex-1">{toast.message}</div>
                    <button onClick={() => removeToast(toast.id)} className="text-slate-400 hover:text-white">
                        <X size={16} />
                    </button>
                    <TimeoutHandler id={toast.id} removeToast={removeToast} />
                </div>
            ))}
        </div>
    );
}

// Separate component to handle timeout per toast
function TimeoutHandler({ id, removeToast }) {
    useEffect(() => {
        const timer = setTimeout(() => {
            removeToast(id);
        }, 3000);
        return () => clearTimeout(timer);
    }, [id, removeToast]);
    return null;
}

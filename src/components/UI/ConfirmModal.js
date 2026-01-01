"use client";
import styles from "./ConfirmModal.module.css";
import { AlertTriangle } from "lucide-react";

export default function ConfirmModal({ isOpen, message, onConfirm, onCancel }) {
    if (!isOpen) return null;

    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <div className={styles.iconWrapper}>
                    <AlertTriangle size={32} className="text-yellow-400" />
                </div>
                <h3 className={styles.title}>Are you sure?</h3>
                <p className={styles.message}>{message}</p>
                <div className={styles.actions}>
                    <button onClick={onCancel} className={styles.cancelBtn}>Cancel</button>
                    <button onClick={onConfirm} className={styles.confirmBtn}>Confirm</button>
                </div>
            </div>
        </div>
    );
}

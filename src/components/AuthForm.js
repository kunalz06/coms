"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { User, Lock, Mail, ArrowRight, Loader2 } from "lucide-react";
import clsx from "clsx";
import styles from "./AuthForm.module.css";
import { motion } from "framer-motion";

import { Camera } from "lucide-react"; // Import Camera icon

// ... imports

export default function AuthForm() {
    const [isLogin, setIsLogin] = useState(true);
    const [loading, setLoading] = useState(false);
    const { login, signup } = useAuth();
    const router = useRouter();

    const [formData, setFormData] = useState({
        username: "",
        email: "",
        password: "",
    });
    const [profileImage, setProfileImage] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [error, setError] = useState("");

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setProfileImage(file);
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            if (isLogin) {
                await login(formData.email, formData.password);
            } else {
                let photoURL = "";
                if (profileImage) {
                    // Upload Image
                    const data = new FormData();
                    data.append("file", profileImage);
                    data.append("userId", "signup_temp"); // Temp ID

                    const res = await fetch("/api/upload", { method: "POST", body: data });
                    const json = await res.json();
                    if (json.success) {
                        photoURL = json.downloadLink || json.link;
                    } else {
                        throw new Error("Failed to upload profile picture");
                    }
                }

                await signup(formData.email, formData.password, formData.username, photoURL);
            }
            router.push("/dashboard");
        } catch (err) {
            setError(err.message.replace("Firebase:", "").trim());
        } finally {
            setLoading(false);
        }
    };

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.2, 0, 0, 1] }} // Emphasized easing
        >
            <div className={styles.header}>
                <h1 className={styles.title}>Coms</h1>
                <p className={styles.subtitle}>
                    {isLogin ? "Welcome back" : "Create your account"}
                </p>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <form onSubmit={handleSubmit} className={styles.form}>
                {!isLogin && (
                    <div className={styles.avatarContainer}>
                        <label className={styles.avatarLabel}>
                            {previewUrl ? (
                                <img src={previewUrl} className={styles.avatarImg} />
                            ) : (
                                <User className="w-10 h-10 text-slate-500" />
                            )}
                            <div className={styles.avatarOverlay}>
                                <Camera className={styles.cameraIcon} />
                            </div>
                            <input type="file" hidden accept="image/*" onChange={handleImageChange} />
                        </label>
                    </div>
                )}

                {!isLogin && (
                    <div className={styles.inputGroup}>
                        <User className={styles.icon} />
                        <input
                            type="text"
                            placeholder="Username"
                            required
                            className={styles.input}
                            value={formData.username}
                            onChange={(e) =>
                                setFormData({ ...formData, username: e.target.value })
                            }
                        />
                    </div>
                )}

                {/* Email Input */}
                <div className={styles.inputGroup}>
                    <Mail className={styles.icon} />
                    <input
                        type="email"
                        placeholder="Email address"
                        required
                        className={styles.input}
                        value={formData.email}
                        onChange={(e) =>
                            setFormData({ ...formData, email: e.target.value })
                        }
                    />
                </div>

                {/* Password Input */}
                <div className={styles.inputGroup}>
                    <Lock className={styles.icon} />
                    <input
                        type="password"
                        placeholder="Password"
                        required
                        className={styles.input}
                        value={formData.password}
                        onChange={(e) =>
                            setFormData({ ...formData, password: e.target.value })
                        }
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="btn btn-primary"
                    style={{ marginTop: '1.5rem' }}
                >
                    {loading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <>
                            {isLogin ? "Sign In" : "Get Started"}
                            <ArrowRight className="w-5 h-5" />
                        </>
                    )}
                </button>
            </form>

            <div className={styles.footer}>
                <p>
                    {isLogin ? "Don't have an account? " : "Already have an account? "}
                    <button
                        onClick={() => setIsLogin(!isLogin)}
                        className={styles.link}
                    >
                        {isLogin ? "Sign up" : "Log in"}
                    </button>
                </p>
            </div>
        </motion.div>
    );
}

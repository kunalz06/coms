"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { updateEmail, updatePassword, updateProfile as updateFirebaseProfile } from "firebase/auth";
import { Bell, BellOff, Camera, Moon, Sun, Volume2, VolumeX, X } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { accountSchema } from "@/lib/validators";
import { updateProfile as updateSupabaseProfile } from "@/services/profile-service";
import { uploadToCloudinary } from "@/services/upload-service";
import { useAppStore } from "@/store/app-store";
import type { Block, UserProfile } from "@/types";
import { useAuth } from "@/features/auth/auth-provider";
import { useNotifications } from "@/features/notifications/notification-provider";

type Values = z.infer<typeof accountSchema>;

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  blocked: Array<Block & { blocked_profile?: UserProfile }>;
  unblock: (blockedId: string) => Promise<void>;
};

export function SettingsPanel({ open, onClose, blocked, unblock }: SettingsPanelProps) {
  const { user, profile, supabase, getIdToken, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const { settings, browserPermission, enableBrowserNotifications, disableBrowserNotifications, setRingtoneEnabled } = useNotifications();
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(accountSchema), defaultValues: { email: "", password: "" } });

  async function saveAccount(values: Values) {
    if (!user || !supabase) return;
    try {
      if (values.email) {
        await updateEmail(user, values.email);
        await updateSupabaseProfile(supabase, user.uid, { email: values.email.toLowerCase() });
      }
      if (values.password) await updatePassword(user, values.password);
      form.reset({ email: "", password: "" });
      await refreshProfile();
      showToast({ variant: "success", title: "Account updated" });
    } catch {
      showToast({ variant: "error", title: "Account update failed", description: "Firebase may require a fresh sign in before changing sensitive details." });
    }
  }

  async function changePicture(file: File | undefined) {
    if (!file || !user || !supabase) return;
    setUploading(true);
    try {
      const result = await uploadToCloudinary({ file, kind: "avatar", getIdToken });
      await updateFirebaseProfile(user, { photoURL: result.url });
      await updateSupabaseProfile(supabase, user.uid, { avatar_url: result.url });
      await refreshProfile();
      showToast({ variant: "success", title: "Profile picture updated" });
    } catch (error) {
      showToast({ variant: "error", title: "Upload failed", description: error instanceof Error ? error.message : "Try another image." });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="space-y-6">
        <section>
          <h3 className="text-sm font-semibold text-ink dark:text-white">Account</h3>
          <div className="mt-3 flex items-center gap-3">
            <Avatar name={profile?.full_name ?? "COMMS"} src={profile?.avatar_url} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink dark:text-white">{profile?.full_name}</p>
              <p className="truncate text-sm text-ink/60 dark:text-white/60">{profile?.email}</p>
            </div>
            <Button variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Camera className="h-4 w-4" />
              Picture
            </Button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => void changePicture(event.target.files?.[0])} />
          </div>
          <form onSubmit={form.handleSubmit(saveAccount)} className="mt-4 grid gap-3">
            <Input placeholder="New email" type="email" autoComplete="email" {...form.register("email")} />
            <Input placeholder="New password" type="password" autoComplete="new-password" {...form.register("password")} />
            <Button className="w-fit" type="submit">Save account changes</Button>
          </form>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink dark:text-white">General</h3>
          <div className="mt-3 grid gap-3 rounded-lg border border-line bg-white/60 p-3 text-sm dark:border-white/10 dark:bg-white/10">
            <div>
              <p className="font-medium text-ink dark:text-white">COMMS</p>
              <p className="text-ink/60 dark:text-white/60">Minimal one-to-one messaging with audio and video calls.</p>
            </div>
            <div className="flex gap-2">
              <Button variant={theme === "light" ? "primary" : "secondary"} onClick={() => setTheme("light")}>
                <Sun className="h-4 w-4" />
                Light
              </Button>
              <Button variant={theme === "dark" ? "primary" : "secondary"} onClick={() => setTheme("dark")}>
                <Moon className="h-4 w-4" />
                Dark
              </Button>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink dark:text-white">Notifications</h3>
          <div className="mt-3 grid gap-3 rounded-lg border border-line bg-white/60 p-3 text-sm dark:border-white/10 dark:bg-white/10">
            <div>
              <p className="font-medium text-ink dark:text-white">Browser notifications</p>
              <p className="text-ink/60 dark:text-white/60">Permission: {browserPermission}. New messages and calls respect muted chats.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant={settings?.browser_notifications_enabled ? "primary" : "secondary"} onClick={() => void enableBrowserNotifications()}>
                <Bell className="h-4 w-4" />
                Turn on
              </Button>
              <Button variant={!settings?.browser_notifications_enabled ? "primary" : "secondary"} onClick={() => void disableBrowserNotifications()}>
                <BellOff className="h-4 w-4" />
                Turn off
              </Button>
            </div>
            <div className="border-t border-line pt-3 dark:border-white/10">
              <p className="font-medium text-ink dark:text-white">Call ringtone</p>
              <p className="text-ink/60 dark:text-white/60">Plays for incoming calls while COMMS is open.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant={settings?.ringtone_enabled ? "primary" : "secondary"} onClick={() => void setRingtoneEnabled(true)}>
                  <Volume2 className="h-4 w-4" />
                  Unmute
                </Button>
                <Button variant={!settings?.ringtone_enabled ? "primary" : "secondary"} onClick={() => void setRingtoneEnabled(false)}>
                  <VolumeX className="h-4 w-4" />
                  Mute
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink dark:text-white">Blocked contacts</h3>
          <div className="mt-3 space-y-2">
            {blocked.length ? (
              blocked.map((block) => (
                <div key={block.id} className="flex items-center gap-3 rounded-lg border border-line bg-white/60 p-3 dark:border-white/10 dark:bg-white/10">
                  <Avatar name={block.blocked_profile?.full_name ?? "Blocked"} src={block.blocked_profile?.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink dark:text-white">{block.blocked_profile?.full_name ?? "Blocked user"}</p>
                    <p className="truncate text-xs text-ink/60 dark:text-white/60">{block.blocked_profile?.email}</p>
                  </div>
                  <Button variant="ghost" onClick={() => void unblock(block.blocked_id)}>
                    <X className="h-4 w-4" />
                    Unblock
                  </Button>
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-line p-3 text-sm text-ink/60 dark:border-white/10 dark:text-white/60">No blocked contacts.</p>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}

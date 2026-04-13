"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-provider";
import {
  getConversationForNotification,
  getConversationMutes,
  getOrCreateNotificationSettings,
  getUserProfileForNotification,
  setConversationMute,
  updateNotificationSettings
} from "@/services/notification-service";
import type { ConversationMute, Message, NotificationSettings } from "@/types";

type NotificationContextValue = {
  settings: NotificationSettings | null;
  browserPermission: NotificationPermission | "unsupported";
  mutedConversationIds: Set<string>;
  enableBrowserNotifications: () => Promise<void>;
  disableBrowserNotifications: () => Promise<void>;
  setRingtoneEnabled: (enabled: boolean) => Promise<void>;
  isConversationMuted: (conversationId: string | null | undefined) => boolean;
  toggleConversationMute: (conversationId: string, muted?: boolean) => Promise<void>;
  notifyIncomingCall: (values: { conversationId?: string | null; title: string; body: string; muted?: boolean }) => void;
  startRingtone: (conversationId?: string | null) => void;
  stopRingtone: () => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

function currentPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function isMuteActive(mute: ConversationMute) {
  return !mute.muted_until || new Date(mute.muted_until).getTime() > Date.now();
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, supabase } = useAuth();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [mutes, setMutes] = useState<ConversationMute[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [promptOpen, setPromptOpen] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringtoneTimerRef = useRef<number | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const notifiedMessagesRef = useRef(new Set<string>());

  const mutedConversationIds = useMemo(() => new Set(mutes.filter(isMuteActive).map((mute) => mute.conversation_id)), [mutes]);

  const isConversationMuted = useCallback(
    (conversationId: string | null | undefined) => Boolean(conversationId && mutedConversationIds.has(conversationId)),
    [mutedConversationIds]
  );

  const load = useCallback(async () => {
    setPermission(currentPermission());
    if (!user || !supabase) {
      setSettings(null);
      setMutes([]);
      return;
    }
    const [nextSettings, nextMutes] = await Promise.all([getOrCreateNotificationSettings(supabase, user.uid), getConversationMutes(supabase, user.uid)]);
    setSettings(nextSettings);
    setMutes(nextMutes);
    setPromptOpen(!nextSettings.notifications_prompted_at);
  }, [supabase, user]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const saveSettings = useCallback(
    async (values: Partial<Pick<NotificationSettings, "browser_notifications_enabled" | "ringtone_enabled" | "notifications_prompted_at">>) => {
      if (!user || !supabase) return;
      const nextSettings = await updateNotificationSettings(supabase, user.uid, values);
      setSettings(nextSettings);
    },
    [supabase, user]
  );

  const unlockAudio = useCallback(() => {
    if (typeof window === "undefined") return null;
    const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    audioContextRef.current ??= new AudioCtor();
    void audioContextRef.current.resume().catch(() => undefined);
    return audioContextRef.current;
  }, []);

  const enableBrowserNotifications = useCallback(async () => {
    unlockAudio();
    if (!user || !supabase) return;
    if (!("Notification" in window)) {
      await saveSettings({ browser_notifications_enabled: false, notifications_prompted_at: new Date().toISOString() });
      setPermission("unsupported");
      showToast({ variant: "error", title: "Notifications unavailable", description: "This browser does not support notifications." });
      return;
    }
    const nextPermission = await Notification.requestPermission();
    setPermission(nextPermission);
    await saveSettings({ browser_notifications_enabled: nextPermission === "granted", notifications_prompted_at: new Date().toISOString() });
    showToast({
      variant: nextPermission === "granted" ? "success" : "info",
      title: nextPermission === "granted" ? "Notifications enabled" : "Notifications kept off"
    });
  }, [saveSettings, showToast, supabase, unlockAudio, user]);

  const disableBrowserNotifications = useCallback(async () => {
    await saveSettings({ browser_notifications_enabled: false, notifications_prompted_at: new Date().toISOString() });
    setPromptOpen(false);
    showToast({ variant: "info", title: "Notifications off" });
  }, [saveSettings, showToast]);

  const setRingtoneEnabled = useCallback(
    async (enabled: boolean) => {
      if (enabled) unlockAudio();
      await saveSettings({ ringtone_enabled: enabled });
    },
    [saveSettings, unlockAudio]
  );

  const toggleConversationMute = useCallback(
    async (conversationId: string, muted?: boolean) => {
      if (!user || !supabase) return;
      const nextMuted = muted ?? !isConversationMuted(conversationId);
      await setConversationMute(supabase, user.uid, conversationId, nextMuted);
      setMutes(await getConversationMutes(supabase, user.uid));
      showToast({ variant: "success", title: nextMuted ? "Conversation muted" : "Conversation unmuted" });
    },
    [isConversationMuted, showToast, supabase, user]
  );

  const showBrowserNotification = useCallback(
    (title: string, options: NotificationOptions & { conversationId?: string | null } = {}) => {
      if (!settings?.browser_notifications_enabled || permission !== "granted") return;
      if (isConversationMuted(options.conversationId)) return;
      const notification = new Notification(title, {
        badge: "/favicon.ico",
        icon: "/favicon.ico",
        ...options
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    },
    [isConversationMuted, permission, settings?.browser_notifications_enabled]
  );

  const notifyIncomingCall = useCallback(
    (values: { conversationId?: string | null; title: string; body: string; muted?: boolean }) => {
      if (values.muted || isConversationMuted(values.conversationId)) return;
      showBrowserNotification(values.title, { body: values.body, tag: `call:${values.conversationId ?? values.title}`, conversationId: values.conversationId });
    },
    [isConversationMuted, showBrowserNotification]
  );

  const stopRingtone = useCallback(() => {
    if (ringtoneTimerRef.current) window.clearInterval(ringtoneTimerRef.current);
    ringtoneTimerRef.current = null;
    oscillatorRef.current?.stop();
    oscillatorRef.current?.disconnect();
    gainRef.current?.disconnect();
    oscillatorRef.current = null;
    gainRef.current = null;
  }, []);

  const startRingtone = useCallback(
    (conversationId?: string | null) => {
      if (!settings?.ringtone_enabled || isConversationMuted(conversationId)) return;
      stopRingtone();
      const context = unlockAudio();
      if (!context) return;
      const gain = context.createGain();
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = 740;
      gain.gain.value = 0.0001;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillatorRef.current = oscillator;
      gainRef.current = gain;
      let loud = false;
      ringtoneTimerRef.current = window.setInterval(() => {
        loud = !loud;
        oscillator.frequency.setValueAtTime(loud ? 880 : 660, context.currentTime);
        gain.gain.setTargetAtTime(loud ? 0.035 : 0.0001, context.currentTime, 0.025);
      }, 420);
    },
    [isConversationMuted, settings?.ringtone_enabled, stopRingtone, unlockAudio]
  );

  useEffect(() => {
    if (!supabase || !user || !settings) return;
    const channel = supabase
      .channel(`notifications:${user.uid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const message = payload.new as Message;
        if (!message?.id || message.sender_id === user.uid || notifiedMessagesRef.current.has(message.id)) return;
        notifiedMessagesRef.current.add(message.id);
        if (isConversationMuted(message.conversation_id)) return;
        if (!document.hidden) return;
        void (async () => {
          const [conversation, sender] = await Promise.all([
            getConversationForNotification(supabase, message.conversation_id),
            getUserProfileForNotification(supabase, message.sender_id)
          ]);
          const title = conversation.type === "group" ? conversation.title ?? "Group message" : sender?.full_name ?? "New message";
          const body = message.kind === "text" && message.content ? message.content : `${sender?.full_name ?? "Someone"} sent ${message.kind === "voice" ? "a voice note" : message.kind === "document" ? "a document" : "an image"}`;
          showBrowserNotification(title, { body, tag: `message:${message.conversation_id}`, conversationId: message.conversation_id });
        })().catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_settings", filter: `user_id=eq.${user.uid}` }, () => void load().catch(() => undefined))
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_mutes", filter: `user_id=eq.${user.uid}` }, () => void load().catch(() => undefined))
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isConversationMuted, load, settings, showBrowserNotification, supabase, user]);

  useEffect(() => () => stopRingtone(), [stopRingtone]);

  const value = useMemo(
    () => ({
      settings,
      browserPermission: permission,
      mutedConversationIds,
      enableBrowserNotifications,
      disableBrowserNotifications,
      setRingtoneEnabled,
      isConversationMuted,
      toggleConversationMute,
      notifyIncomingCall,
      startRingtone,
      stopRingtone
    }),
    [
      disableBrowserNotifications,
      enableBrowserNotifications,
      isConversationMuted,
      mutedConversationIds,
      notifyIncomingCall,
      permission,
      setRingtoneEnabled,
      settings,
      startRingtone,
      stopRingtone,
      toggleConversationMute
    ]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <Modal open={promptOpen} title="Notifications" onClose={() => void disableBrowserNotifications()}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-ink/70 dark:text-white/70">Turn on browser notifications for new messages and incoming calls. You can change this later in Settings.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void enableBrowserNotifications().finally(() => setPromptOpen(false))}>Turn on</Button>
            <Button variant="secondary" onClick={() => void disableBrowserNotifications()}>Keep off</Button>
          </div>
        </div>
      </Modal>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications must be used inside NotificationProvider.");
  return context;
}

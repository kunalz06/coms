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
  isNotificationStorageMissingError,
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

const localSettingsKey = (userId: string) => `comms:notification-settings:${userId}`;
const localMutesKey = (userId: string) => `comms:conversation-mutes:${userId}`;

function currentPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function isMuteActive(mute: ConversationMute) {
  return !mute.muted_until || new Date(mute.muted_until).getTime() > Date.now();
}

function defaultSettings(userId: string): NotificationSettings {
  const now = new Date().toISOString();

  return {
    user_id: userId,
    browser_notifications_enabled: false,
    ringtone_enabled: true,
    notifications_prompted_at: null,
    created_at: now,
    updated_at: now
  };
}

function readLocalSettings(userId: string) {
  const fallback = defaultSettings(userId);
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(localSettingsKey(userId));
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw), user_id: userId } as NotificationSettings;
  } catch {
    return fallback;
  }
}

function writeLocalSettings(settings: NotificationSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(localSettingsKey(settings.user_id), JSON.stringify(settings));
}

function readLocalMutes(userId: string) {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(localMutesKey(userId));
    return raw ? (JSON.parse(raw) as ConversationMute[]) : [];
  } catch {
    return [];
  }
}

function writeLocalMutes(userId: string, mutes: ConversationMute[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(localMutesKey(userId), JSON.stringify(mutes));
}

function applyLocalMute(userId: string, currentMutes: ConversationMute[], conversationId: string, muted: boolean) {
  if (!muted) return currentMutes.filter((mute) => mute.conversation_id !== conversationId);
  if (currentMutes.some((mute) => mute.conversation_id === conversationId)) return currentMutes;

  return [
    ...currentMutes,
    {
      id: `local:${conversationId}`,
      conversation_id: conversationId,
      user_id: userId,
      muted_until: null,
      created_at: new Date().toISOString()
    }
  ];
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, supabase } = useAuth();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [mutes, setMutes] = useState<ConversationMute[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [promptOpen, setPromptOpen] = useState(false);
  const [notificationStorageReady, setNotificationStorageReady] = useState(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringtoneTimerRef = useRef<number | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const notifiedMessagesRef = useRef(new Set<string>());
  const missingStorageToastShownRef = useRef(false);

  const mutedConversationIds = useMemo(() => new Set(mutes.filter(isMuteActive).map((mute) => mute.conversation_id)), [mutes]);

  const isConversationMuted = useCallback(
    (conversationId: string | null | undefined) => Boolean(conversationId && mutedConversationIds.has(conversationId)),
    [mutedConversationIds]
  );

  const showMissingStorageNotice = useCallback(() => {
    if (missingStorageToastShownRef.current) return;
    missingStorageToastShownRef.current = true;
    showToast({
      variant: "info",
      title: "Notification schema not applied",
      description: "Notification controls are saved locally until the new Supabase tables are created."
    });
  }, [showToast]);

  const load = useCallback(async () => {
    setPermission(currentPermission());
    if (!user || !supabase) {
      setSettings(null);
      setMutes([]);
      return;
    }
    try {
      const [nextSettings, nextMutes] = await Promise.all([getOrCreateNotificationSettings(supabase, user.uid), getConversationMutes(supabase, user.uid)]);
      setNotificationStorageReady(true);
      setSettings(nextSettings);
      setMutes(nextMutes);
      writeLocalSettings(nextSettings);
      writeLocalMutes(user.uid, nextMutes);
      setPromptOpen(!nextSettings.notifications_prompted_at);
    } catch (error) {
      if (!isNotificationStorageMissingError(error)) throw error;
      const localSettings = readLocalSettings(user.uid);
      const localMutes = readLocalMutes(user.uid);
      setNotificationStorageReady(false);
      setSettings(localSettings);
      setMutes(localMutes);
      setPromptOpen(!localSettings.notifications_prompted_at);
      showMissingStorageNotice();
    }
  }, [showMissingStorageNotice, supabase, user]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const saveSettings = useCallback(
    async (values: Partial<Pick<NotificationSettings, "browser_notifications_enabled" | "ringtone_enabled" | "notifications_prompted_at">>) => {
      if (!user) return;
      const optimisticSettings = {
        ...(settings ?? readLocalSettings(user.uid)),
        ...values,
        user_id: user.uid,
        updated_at: new Date().toISOString()
      };
      setSettings(optimisticSettings);
      writeLocalSettings(optimisticSettings);

      if (!supabase || !notificationStorageReady) return;

      try {
        const nextSettings = await updateNotificationSettings(supabase, user.uid, values);
        setNotificationStorageReady(true);
        setSettings(nextSettings);
        writeLocalSettings(nextSettings);
      } catch (error) {
        if (!isNotificationStorageMissingError(error)) throw error;
        setNotificationStorageReady(false);
        showMissingStorageNotice();
      }
    },
    [notificationStorageReady, settings, showMissingStorageNotice, supabase, user]
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
      if (!user) return;
      const nextMuted = muted ?? !isConversationMuted(conversationId);
      const optimisticMutes = applyLocalMute(user.uid, mutes, conversationId, nextMuted);
      setMutes(optimisticMutes);
      writeLocalMutes(user.uid, optimisticMutes);

      if (supabase && notificationStorageReady) {
        try {
          await setConversationMute(supabase, user.uid, conversationId, nextMuted);
          const nextMutes = await getConversationMutes(supabase, user.uid);
          setNotificationStorageReady(true);
          setMutes(nextMutes);
          writeLocalMutes(user.uid, nextMutes);
        } catch (error) {
          if (!isNotificationStorageMissingError(error)) throw error;
          setNotificationStorageReady(false);
          showMissingStorageNotice();
        }
      }
      showToast({ variant: "success", title: nextMuted ? "Conversation muted" : "Conversation unmuted" });
    },
    [isConversationMuted, mutes, notificationStorageReady, showMissingStorageNotice, showToast, supabase, user]
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
      });

    if (notificationStorageReady) {
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "notification_settings", filter: `user_id=eq.${user.uid}` }, () => void load().catch(() => undefined))
        .on("postgres_changes", { event: "*", schema: "public", table: "conversation_mutes", filter: `user_id=eq.${user.uid}` }, () => void load().catch(() => undefined));
    }

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isConversationMuted, load, notificationStorageReady, settings, showBrowserNotification, supabase, user]);

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

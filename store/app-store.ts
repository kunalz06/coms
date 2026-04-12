import { create } from "zustand";
import type { ChatTarget, UserProfile } from "@/types";

type AppState = {
  selectedFriend: UserProfile | null;
  selectedChat: ChatTarget | null;
  theme: "light" | "dark";
  setSelectedFriend: (friend: UserProfile | null) => void;
  setSelectedChat: (chat: ChatTarget | null) => void;
  setTheme: (theme: "light" | "dark") => void;
};

export const useAppStore = create<AppState>((set) => ({
  selectedFriend: null,
  selectedChat: null,
  theme: "light",
  setSelectedFriend: (selectedFriend) => set({ selectedFriend, selectedChat: selectedFriend ? { kind: "direct", friend: selectedFriend } : null }),
  setSelectedChat: (selectedChat) => set({ selectedChat, selectedFriend: selectedChat?.kind === "direct" ? selectedChat.friend : null }),
  setTheme: (theme) => set({ theme })
}));

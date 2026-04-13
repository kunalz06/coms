"use client";

import { Camera, Users } from "lucide-react";
import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-provider";
import { MAX_GROUP_MEMBERS } from "@/services/group-service";
import { uploadToCloudinary } from "@/services/upload-service";
import type { Friendship, GroupConversation } from "@/types";

type CreateGroupModalProps = {
  open: boolean;
  friends: Friendship[];
  onClose: () => void;
  onCreate: (title: string, memberIds: string[], avatarUrl?: string | null) => Promise<GroupConversation>;
  onCreated: (group: GroupConversation) => void;
};

export function CreateGroupModal({ open, friends, onClose, onCreate, onCreated }: CreateGroupModalProps) {
  const { getIdToken } = useAuth();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleMember(userId: string) {
    setSelectedIds((ids) => {
      if (ids.includes(userId)) return ids.filter((id) => id !== userId);
      if (ids.length >= MAX_GROUP_MEMBERS - 1) {
        showToast({ variant: "info", title: `Groups are limited to ${MAX_GROUP_MEMBERS} people` });
        return ids;
      }
      return [...ids, userId];
    });
  }

  async function submit() {
    if (!title.trim()) {
      showToast({ variant: "error", title: "Name the group first" });
      return;
    }
    setSubmitting(true);
    try {
      const avatarUrl = avatar ? (await uploadToCloudinary({ file: avatar, kind: "avatar", getIdToken })).url : null;
      const group = await onCreate(title.trim(), selectedIds, avatarUrl);
      onCreated(group);
      setTitle("");
      setSelectedIds([]);
      setAvatar(null);
      onClose();
      showToast({ variant: "success", title: "Group created" });
    } catch (error) {
      showToast({ variant: "error", title: "Could not create group", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create group">
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-lg border border-dashed border-line bg-white/60 p-3 text-left text-sm dark:border-white/10 dark:bg-white/10"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-moss/10 text-moss dark:bg-white/10 dark:text-white">
            {avatar ? <Users className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
          </span>
          <span>
            <span className="block font-medium text-ink dark:text-white">{avatar ? avatar.name : "Group picture"}</span>
            <span className="text-ink/60 dark:text-white/60">Optional JPG, PNG, or WebP</span>
          </span>
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => setAvatar(event.target.files?.[0] ?? null)} />

        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Group name" maxLength={80} />
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ink dark:text-white">Members</p>
            <p className="text-xs text-ink/55 dark:text-white/55">{selectedIds.length + 1}/{MAX_GROUP_MEMBERS}</p>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {friends.map((friendship) => {
              const friend = friendship.friend;
              if (!friend) return null;
              const selected = selectedIds.includes(friend.id);
              return (
                <button key={friend.id} type="button" onClick={() => toggleMember(friend.id)} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left ${selected ? "border-moss bg-moss/10" : "border-line bg-white/60 dark:border-white/10 dark:bg-white/10"}`}>
                  <Avatar name={friend.full_name} src={friend.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink dark:text-white">{friend.full_name}</p>
                    <p className="truncate text-xs text-ink/60 dark:text-white/60">{friend.email}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={() => void submit()} disabled={submitting}>{submitting ? "Creating" : "Create group"}</Button>
        </div>
      </div>
    </Modal>
  );
}

"use client";

import { Shield, Trash2, UserMinus } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/auth-provider";
import { useGroups } from "@/hooks/use-groups";
import type { GroupConversation } from "@/types";

type GroupInfoPanelProps = {
  group: GroupConversation;
  open: boolean;
  onClose: () => void;
};

export function GroupInfoPanel({ group, open, onClose }: GroupInfoPanelProps) {
  const { user } = useAuth();
  const { leave, addMemberByEmail, removeMember, setRole, deleteConversation } = useGroups();
  const { showToast } = useToast();
  const [memberEmail, setMemberEmail] = useState("");
  const myMembership = group.members?.find((member) => member.user_id === user?.uid);
  const canManage = myMembership?.role === "owner" || myMembership?.role === "admin";
  const isOwner = myMembership?.role === "owner";

  async function run(action: () => Promise<void>, title: string) {
    try {
      await action();
      showToast({ variant: "success", title });
    } catch (error) {
      showToast({ variant: "error", title: "Group update failed", description: error instanceof Error ? error.message : "Try again." });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Group info">
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Avatar name={group.title ?? "Group"} src={group.avatar_url} size="lg" />
          <div>
            <p className="font-semibold text-ink dark:text-white">{group.title}</p>
            <p className="text-sm text-ink/60 dark:text-white/60">{group.members?.length ?? 0} members</p>
          </div>
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink dark:text-white">Members</h3>
          {canManage ? (
            <div className="mb-3 flex gap-2">
              <Input value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="Add member by email" />
              <Button
                variant="secondary"
                onClick={() =>
                  void run(async () => {
                    await addMemberByEmail(group.id, memberEmail);
                    setMemberEmail("");
                  }, "Member added")
                }
              >
                Add
              </Button>
            </div>
          ) : null}
          <div className="space-y-2">
            {group.members?.map((member) => (
              <div key={member.id} className="flex items-center gap-3 rounded-lg border border-line bg-white/60 p-3 dark:border-white/10 dark:bg-white/10">
                <Avatar name={member.profile?.full_name ?? "Member"} src={member.profile?.avatar_url} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink dark:text-white">{member.profile?.full_name ?? "Member"}</p>
                  <p className="truncate text-xs capitalize text-ink/60 dark:text-white/60">{member.role}</p>
                </div>
                {canManage && member.role !== "owner" ? (
                  <div className="flex gap-1">
                    <Button variant="ghost" className="h-8 px-2" onClick={() => void run(() => setRole(group.id, member.user_id, member.role === "admin" ? "member" : "admin"), "Role updated")}>
                      <Shield className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" className="h-8 px-2" onClick={() => void run(() => removeMember(group.id, member.user_id), "Member removed")}>
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4 dark:border-white/10">
          <Button variant="ghost" onClick={() => void run(() => leave(group.id), "You left the group")}>Leave group</Button>
          {isOwner ? (
            <Button variant="danger" onClick={() => void run(() => deleteConversation(group.id), "Group deleted")}>
              <Trash2 className="h-4 w-4" />
              Delete group
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

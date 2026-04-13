"use client";

import { FileText, SmilePlus } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatTime } from "@/lib/utils";
import type { Message, MessageReaction, MessageReactionKind, UserProfile } from "@/types";

type MessageListProps = {
  messages: Message[];
  currentUserId: string;
  friend: UserProfile;
  showSenderNames?: boolean;
  senderProfiles?: Map<string, UserProfile>;
  getDownloadUrl: (url: string) => Promise<string>;
  onReact: (messageId: string, kind: MessageReactionKind, content: string) => Promise<void>;
};

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "🙏"];

function reactionGroups(reactions: MessageReaction[] = []) {
  const groups = new Map<string, { key: string; content: string; count: number }>();
  reactions.forEach((reaction) => {
    const key = `${reaction.kind}:${reaction.content}`;
    const current = groups.get(key);
    if (current) current.count += 1;
    else groups.set(key, { key, content: reaction.content, count: 1 });
  });
  return [...groups.values()];
}

function ReactionsModal({ message, open, onClose }: { message: Message | null; open: boolean; onClose: () => void }) {
  const reactions = message?.reactions ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Message reactions">
      {reactions.length ? (
        <div className="space-y-2">
          {reactions.map((reaction) => (
            <div key={reaction.id} className="flex items-center gap-3 rounded-lg border border-line bg-white/70 p-3 dark:border-white/10 dark:bg-white/10">
              <Avatar name={reaction.profile?.full_name ?? "COMMS user"} src={reaction.profile?.avatar_url} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink dark:text-white">{reaction.profile?.full_name ?? "COMMS user"}</p>
                <p className="truncate text-xs text-ink/55 dark:text-white/55">{reaction.profile?.email ?? "Reaction"}</p>
              </div>
              <span className="max-w-[12rem] truncate rounded-lg bg-ink/5 px-3 py-1 text-sm text-ink dark:bg-white/10 dark:text-white">{reaction.content}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink/60 dark:text-white/60">No reactions yet.</p>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

export function MessageList({ messages, currentUserId, friend, showSenderNames, senderProfiles, getDownloadUrl, onReact }: MessageListProps) {
  const { showToast } = useToast();
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customReaction, setCustomReaction] = useState("");
  const [reactionDetails, setReactionDetails] = useState<Message | null>(null);

  async function react(messageId: string, kind: MessageReactionKind, content: string) {
    try {
      await onReact(messageId, kind, content);
      setCustomReaction("");
      setCustomFor(null);
    } catch (error) {
      showToast({ variant: "error", title: "Could not react", description: error instanceof Error ? error.message : "Try again." });
    }
  }

  if (!messages.length) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <Avatar name={friend.full_name} src={friend.avatar_url} size="lg" />
          <h2 className="mt-4 text-lg font-semibold text-ink dark:text-white">Start the conversation</h2>
          <p className="mt-1 text-sm text-ink/60 dark:text-white/60">Send a message, image, document, or voice note.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {messages.map((message) => {
        const mine = message.sender_id === currentUserId;
        const attachment = message.attachments?.[0];
        const sender = senderProfiles?.get(message.sender_id);
        const groupedReactions = reactionGroups(message.reactions);
        return (
          <div key={message.id} className={`group/message flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`relative max-w-[78%] rounded-lg border px-3 py-2 text-sm shadow-sm ${mine ? "border-moss/30 bg-moss text-white" : "border-line bg-white/80 text-ink dark:border-white/10 dark:bg-white/10 dark:text-white"}`}>
              <div className={`absolute -top-9 z-10 hidden items-center gap-1 rounded-lg border border-line bg-white/95 p-1 shadow-soft group-hover/message:flex group-focus-within/message:flex dark:border-white/10 dark:bg-neutral-950/95 ${mine ? "right-0" : "left-0"}`}>
                {QUICK_REACTIONS.map((reaction) => (
                  <button
                    key={reaction}
                    type="button"
                    onClick={() => void react(message.id, "emoji", reaction)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-base transition hover:bg-ink/5 dark:hover:bg-white/10"
                    aria-label={`React with ${reaction}`}
                  >
                    {reaction}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomFor((current) => (current === message.id ? null : message.id))}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink/65 transition hover:bg-ink/5 dark:text-white/65 dark:hover:bg-white/10"
                  aria-label="Add custom reaction"
                >
                  <SmilePlus className="h-4 w-4" />
                </button>
              </div>
              {customFor === message.id ? (
                <form
                  className={`absolute -top-20 z-20 flex w-60 gap-1 rounded-lg border border-line bg-white/95 p-2 shadow-soft dark:border-white/10 dark:bg-neutral-950/95 ${mine ? "right-0" : "left-0"}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const kind: MessageReactionKind = customReaction.length <= 16 && /\p{Extended_Pictographic}/u.test(customReaction) ? "emoji" : "text";
                    void react(message.id, kind, customReaction);
                  }}
                >
                  <input
                    value={customReaction}
                    onChange={(event) => setCustomReaction(event.target.value)}
                    placeholder="Emoji or text"
                    maxLength={80}
                    className="min-w-0 flex-1 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink outline-none focus:border-moss dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                    autoFocus
                  />
                  <button type="submit" className="rounded-md bg-moss px-2 py-1 text-xs font-medium text-white">Add</button>
                </form>
              ) : null}
              {showSenderNames && !mine ? <p className="mb-1 text-xs font-semibold text-moss dark:text-emerald-300">{sender?.full_name ?? "Group member"}</p> : null}
              {message.kind === "image" && attachment ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachment.url} alt={attachment.file_name} className="mb-2 max-h-80 rounded-lg object-cover" />
              ) : null}
              {message.kind === "voice" && attachment ? <audio controls src={attachment.url} className="mb-2 max-w-full" /> : null}
              {message.kind === "document" && attachment ? (
                <button
                  type="button"
                  onClick={async () => {
                    const popup = window.open("about:blank", "_blank");
                    try {
                      const url = await getDownloadUrl(attachment.url);
                      if (popup) {
                        popup.opener = null;
                        popup.location.href = url;
                      } else {
                        window.open(url, "_blank", "noopener,noreferrer");
                      }
                    } catch (error) {
                      popup?.close();
                      showToast({
                        variant: "error",
                        title: "Could not open file",
                        description: error instanceof Error ? error.message : "Try downloading it again."
                      });
                    }
                  }}
                  className="mb-2 flex max-w-full items-center gap-2 rounded-lg bg-white/20 px-2 py-2 text-left underline-offset-4 hover:underline"
                >
                  <FileText className="h-4 w-4" />
                  <span className="truncate">{attachment.file_name}</span>
                </button>
              ) : null}
              {message.content ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : null}
              <div className={`mt-1 flex items-center justify-end gap-2 text-[11px] ${mine ? "text-white/75" : "text-ink/45 dark:text-white/45"}`}>
                <span>{formatTime(message.created_at)}</span>
                {mine ? <span>{message.status}</span> : null}
              </div>
              {groupedReactions.length ? (
                <button
                  type="button"
                  onClick={() => setReactionDetails(message)}
                  className={`mt-2 flex max-w-full flex-wrap gap-1 rounded-md text-left ${mine ? "text-white" : "text-ink dark:text-white"}`}
                >
                  {groupedReactions.map((reaction) => (
                    <span key={reaction.key} className={`rounded-full px-2 py-0.5 text-xs ${mine ? "bg-white/20" : "bg-ink/5 dark:bg-white/10"}`}>
                      {reaction.content} {reaction.count}
                    </span>
                  ))}
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      <ReactionsModal message={reactionDetails} open={Boolean(reactionDetails)} onClose={() => setReactionDetails(null)} />
    </div>
  );
}

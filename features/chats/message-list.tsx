"use client";

import { FileText, Share2, SmilePlus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatTime } from "@/lib/utils";
import type { ChatTarget, Message, MessageReaction, MessageReactionKind, UserProfile } from "@/types";

type MessageListProps = {
  messages: Message[];
  currentUserId: string;
  friend: UserProfile;
  showSenderNames?: boolean;
  senderProfiles?: Map<string, UserProfile>;
  getDownloadUrl: (url: string) => Promise<string>;
  onReact: (messageId: string, kind: MessageReactionKind, content: string) => Promise<void>;
  onDeleteForMe: (messageId: string) => Promise<void>;
  onDeleteForEveryone: (messageId: string) => Promise<void>;
  shareTargets: ChatTarget[];
  onShareToTarget: (message: Message, target: ChatTarget) => Promise<void>;
};

const QUICK_REACTIONS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F64F}"];

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
    </Modal>
  );
}

function canDeleteForEveryone(message: Message, currentUserId: string) {
  return message.sender_id === currentUserId && !message.deleted_for_everyone_at && Date.now() - new Date(message.created_at).getTime() <= 60_000;
}

function shareTextForMessage(message: Message) {
  const attachment = message.attachments?.[0];
  if (message.content) return message.content;
  if (attachment) return `${attachment.file_name} shared from COMMS`;
  return `${message.kind} message shared from COMMS`;
}

function shareDataForMessage(message: Message): ShareData {
  const attachment = message.attachments?.[0];
  return {
    title: "COMMS message",
    text: shareTextForMessage(message),
    url: attachment?.url
  };
}

function shareFallbackText(data: ShareData) {
  return [data.text, data.url].filter(Boolean).join("\n");
}

function targetTitle(target: ChatTarget) {
  return target.kind === "direct" ? target.friend.full_name : target.conversation.title ?? "Group chat";
}

function targetSubtitle(target: ChatTarget) {
  return target.kind === "direct" ? target.friend.email : `${target.conversation.members?.length ?? 0} members`;
}

function targetAvatar(target: ChatTarget) {
  return target.kind === "direct" ? target.friend.avatar_url : target.conversation.avatar_url;
}

function targetKey(target: ChatTarget) {
  return target.kind === "direct" ? `direct:${target.friend.id}` : `group:${target.conversation.id}`;
}

function DeleteMessageModal({
  message,
  currentUserId,
  open,
  onClose,
  onDeleteForMe,
  onDeleteForEveryone
}: {
  message: Message | null;
  currentUserId: string;
  open: boolean;
  onClose: () => void;
  onDeleteForMe: (messageId: string) => Promise<void>;
  onDeleteForEveryone: (messageId: string) => Promise<void>;
}) {
  const { showToast } = useToast();
  const deleteForEveryoneAllowed = message ? canDeleteForEveryone(message, currentUserId) : false;

  async function run(action: () => Promise<void>, title: string) {
    try {
      await action();
      showToast({ variant: "success", title });
      onClose();
    } catch (error) {
      showToast({ variant: "error", title: "Could not delete message", description: error instanceof Error ? error.message : "Try again." });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Delete message">
      {message ? (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-ink/65 dark:text-white/65">Delete this message from your chat history, or remove it for everyone if it was sent in the last minute.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void run(() => onDeleteForMe(message.id), "Message deleted from your chat")}>Delete for me</Button>
            {message.sender_id === currentUserId ? (
              <Button variant="danger" disabled={!deleteForEveryoneAllowed} onClick={() => void run(() => onDeleteForEveryone(message.id), "Message deleted for everyone")}>
                Delete for everyone
              </Button>
            ) : null}
          </div>
          {message.sender_id === currentUserId && !deleteForEveryoneAllowed ? <p className="text-xs text-ink/55 dark:text-white/55">Delete for everyone is available for one minute after sending.</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}

function ShareMessageModal({
  message,
  targets,
  open,
  onClose,
  onShareToTarget
}: {
  message: Message | null;
  targets: ChatTarget[];
  open: boolean;
  onClose: () => void;
  onShareToTarget: (message: Message, target: ChatTarget) => Promise<void>;
}) {
  const { showToast } = useToast();
  const [query, setQuery] = useState("");
  const [sharingKey, setSharingKey] = useState<string | null>(null);
  const visibleTargets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return targets;
    return targets.filter((target) => `${targetTitle(target)} ${targetSubtitle(target)}`.toLowerCase().includes(normalized));
  }, [query, targets]);

  async function shareToTarget(target: ChatTarget) {
    if (!message) return;
    try {
      setSharingKey(targetKey(target));
      await onShareToTarget(message, target);
      showToast({ variant: "success", title: `Shared to ${targetTitle(target)}` });
      setQuery("");
      onClose();
    } catch (error) {
      showToast({ variant: "error", title: "Could not share message", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSharingKey(null);
    }
  }

  async function shareToOtherApps() {
    if (!message) return;
    try {
      const data = shareDataForMessage(message);
      if (navigator.share) {
        await navigator.share(data);
        showToast({ variant: "success", title: "Shared" });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareFallbackText(data));
        showToast({ variant: "success", title: "Copied share text" });
      } else {
        throw new Error("Sharing is not available in this browser.");
      }
      setQuery("");
      onClose();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      showToast({ variant: "error", title: "Could not share outside COMMS", description: error instanceof Error ? error.message : "Try copying the message instead." });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Share to">
      {message && !message.deleted_for_everyone_at ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-white/70 p-3 text-sm text-ink dark:border-white/10 dark:bg-white/10 dark:text-white">
            <p className="line-clamp-2 break-words">{shareTextForMessage(message)}</p>
            {message.attachments?.[0] ? <p className="mt-1 truncate text-xs text-ink/55 dark:text-white/55">{message.attachments[0].file_name}</p> : null}
          </div>
          <Button variant="secondary" className="w-full justify-center" onClick={() => void shareToOtherApps()}>
            <Share2 className="h-4 w-4" />
            Share to other apps
          </Button>
          <div className="space-y-3 border-t border-line pt-4 dark:border-white/10">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats or groups" aria-label="Search share destinations" />
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {visibleTargets.length ? (
                visibleTargets.map((target) => {
                  const key = targetKey(target);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => void shareToTarget(target)}
                      disabled={sharingKey !== null}
                      className="flex w-full items-center gap-3 rounded-lg border border-line bg-white/70 p-3 text-left transition hover:border-moss/50 hover:bg-white disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/10 dark:hover:border-emerald-300/50 dark:hover:bg-white/15"
                    >
                      <Avatar name={targetTitle(target)} src={targetAvatar(target)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink dark:text-white">{targetTitle(target)}</p>
                        <p className="truncate text-xs text-ink/55 dark:text-white/55">{targetSubtitle(target)}</p>
                      </div>
                      <span className="text-xs font-medium text-moss dark:text-emerald-300">{sharingKey === key ? "Sharing" : "Share"}</span>
                    </button>
                  );
                })
              ) : (
                <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink/55 dark:border-white/10 dark:text-white/55">No chats found.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink/60 dark:text-white/60">Deleted messages cannot be shared.</p>
      )}
    </Modal>
  );
}

export function MessageList({
  messages,
  currentUserId,
  friend,
  showSenderNames,
  senderProfiles,
  getDownloadUrl,
  onReact,
  onDeleteForMe,
  onDeleteForEveryone,
  shareTargets,
  onShareToTarget
}: MessageListProps) {
  const { showToast } = useToast();
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customReaction, setCustomReaction] = useState("");
  const [reactionDetails, setReactionDetails] = useState<Message | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);
  const [shareTarget, setShareTarget] = useState<Message | null>(null);
  const [activeToolsFor, setActiveToolsFor] = useState<string | null>(null);

  async function react(messageId: string, kind: MessageReactionKind, content: string) {
    try {
      await onReact(messageId, kind, content);
      setCustomReaction("");
      setCustomFor(null);
      setActiveToolsFor(null);
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
        const deletedForEveryone = Boolean(message.deleted_for_everyone_at);
        const groupedReactions = deletedForEveryone ? [] : reactionGroups(message.reactions);
        const toolsOpen = activeToolsFor === message.id || customFor === message.id;
        return (
          <div key={message.id} className={`group/message flex ${mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`relative max-w-[86%] cursor-pointer rounded-lg border px-3 py-2 text-sm shadow-sm md:max-w-[78%] ${mine ? "border-moss/30 bg-moss text-white" : "border-line bg-white/80 text-ink dark:border-white/10 dark:bg-white/10 dark:text-white"}`}
              onClick={() => setActiveToolsFor((current) => (current === message.id ? null : message.id))}
            >
              <div
                className={`absolute -top-9 z-10 items-center gap-1 rounded-lg border border-line bg-white/95 p-1 shadow-soft dark:border-white/10 dark:bg-neutral-950/95 ${mine ? "right-0" : "left-0"} ${toolsOpen ? "flex" : "hidden group-hover/message:flex group-focus-within/message:flex"}`}
                onClick={(event) => event.stopPropagation()}
              >
                {!deletedForEveryone ? (
                  <>
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
                      onClick={() => {
                        setActiveToolsFor(message.id);
                        setCustomFor((current) => (current === message.id ? null : message.id));
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink/65 transition hover:bg-ink/5 dark:text-white/65 dark:hover:bg-white/10"
                      aria-label="Add custom reaction"
                    >
                      <SmilePlus className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveToolsFor(null);
                        setShareTarget(message);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink/65 transition hover:bg-ink/5 dark:text-white/65 dark:hover:bg-white/10"
                      aria-label="Share message"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setActiveToolsFor(null);
                    setDeleteTarget(message);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-coral transition hover:bg-coral/10"
                  aria-label="Delete message"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {customFor === message.id && !deletedForEveryone ? (
                <form
                  className={`absolute -top-20 z-20 flex w-60 gap-1 rounded-lg border border-line bg-white/95 p-2 shadow-soft dark:border-white/10 dark:bg-neutral-950/95 ${mine ? "right-0" : "left-0"}`}
                  onClick={(event) => event.stopPropagation()}
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
              {deletedForEveryone ? <p className={`italic ${mine ? "text-white/75" : "text-ink/55 dark:text-white/55"}`}>This message was deleted.</p> : null}
              {!deletedForEveryone && message.kind === "image" && attachment ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachment.url} alt={attachment.file_name} className="mb-2 max-h-80 rounded-lg object-cover" onClick={(event) => event.stopPropagation()} />
              ) : null}
              {!deletedForEveryone && message.kind === "voice" && attachment ? <audio controls src={attachment.url} className="mb-2 max-w-full" onClick={(event) => event.stopPropagation()} /> : null}
              {!deletedForEveryone && message.kind === "document" && attachment ? (
                <button
                  type="button"
                  onClick={async (event) => {
                    event.stopPropagation();
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
              {!deletedForEveryone && message.content ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : null}
              <div className={`mt-1 flex items-center justify-end gap-2 text-[11px] ${mine ? "text-white/75" : "text-ink/45 dark:text-white/45"}`}>
                <span>{formatTime(message.created_at)}</span>
                {mine ? <span>{message.status}</span> : null}
              </div>
              {groupedReactions.length ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setReactionDetails(message);
                  }}
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
      <DeleteMessageModal message={deleteTarget} currentUserId={currentUserId} open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onDeleteForMe={onDeleteForMe} onDeleteForEveryone={onDeleteForEveryone} />
      <ShareMessageModal message={shareTarget} targets={shareTargets} open={Boolean(shareTarget)} onClose={() => setShareTarget(null)} onShareToTarget={onShareToTarget} />
    </div>
  );
}

"use client";

import { FileText } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { formatTime } from "@/lib/utils";
import type { Message, UserProfile } from "@/types";

type MessageListProps = {
  messages: Message[];
  currentUserId: string;
  friend: UserProfile;
  showSenderNames?: boolean;
  senderProfiles?: Map<string, UserProfile>;
  getDownloadUrl: (url: string) => Promise<string>;
};

export function MessageList({ messages, currentUserId, friend, showSenderNames, senderProfiles, getDownloadUrl }: MessageListProps) {
  const { showToast } = useToast();

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
        return (
          <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[78%] rounded-lg border px-3 py-2 text-sm shadow-sm ${mine ? "border-moss/30 bg-moss text-white" : "border-line bg-white/80 text-ink dark:border-white/10 dark:bg-white/10 dark:text-white"}`}>
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
            </div>
          </div>
        );
      })}
    </div>
  );
}

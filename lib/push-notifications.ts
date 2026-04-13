import type { SupabaseClient } from "@supabase/supabase-js";
import webPush from "web-push";

type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type CommsPushPayload = {
  type: "message" | "call";
  title: string;
  body: string;
  tag: string;
  url?: string;
  conversationId?: string | null;
};

let configured = false;

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) throw new Error("VAPID keys are not configured.");
  if (!configured) {
    webPush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@comms.local", publicKey, privateKey);
    configured = true;
  }
}

export async function sendWebPushToUsers(supabase: SupabaseClient, userIds: string[], payload: CommsPushPayload) {
  const uniqueUserIds = [...new Set(userIds)].filter(Boolean);
  if (!uniqueUserIds.length) return { sent: 0 };
  configureWebPush();

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .in("user_id", uniqueUserIds)
    .returns<PushSubscriptionRow[]>();
  if (error) throw error;
  if (!data?.length) return { sent: 0 };

  let sent = 0;
  await Promise.all(
    data.map(async (subscription) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth
            }
          },
          JSON.stringify(payload),
          {
            TTL: payload.type === "call" ? 60 : 3600,
            urgency: payload.type === "call" ? "high" : "normal"
          }
        );
        sent += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number } | null)?.statusCode ?? null;
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        }
      }
    })
  );

  return { sent };
}

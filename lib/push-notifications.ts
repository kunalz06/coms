import webpush from "web-push";

type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushPayload = {
  type: string;
  title: string;
  body: string;
  tag?: string;
  url?: string;
  conversationId?: string;
};

let vapidConfigured = false;

function configureVapid() {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@comms.local";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID push keys are not configured.");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export async function sendWebPushToUsers(supabase: any, userIds: string[], payload: PushPayload) {
  if (!userIds.length) return { sent: 0, failed: 0 };
  configureVapid();

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .in("user_id", userIds);

  if (error) {
    throw new Error(error.message ?? "Failed to load push subscriptions.");
  }

  const subscriptions = ((data as SubscriptionRow[] | null) ?? []);
  if (!subscriptions.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth
            }
          },
          body
        );
        sent += 1;
      } catch (error: any) {
        failed += 1;
        const statusCode = error?.statusCode as number | undefined;
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        }
      }
    })
  );

  return { sent, failed };
}

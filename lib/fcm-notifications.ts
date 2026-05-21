import { firebaseAdminMessaging } from "@/lib/firebase-admin";

type SupabaseLike = {
  from: (table: string) => any;
};

export type FcmPayload = Record<string, string | number | boolean | null | undefined>;

type DeviceRow = {
  id: string;
  user_id: string;
  token: string;
};

function stringData(payload: FcmPayload) {
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );
}

async function logNotificationEvent(
  supabase: SupabaseLike,
  row: {
    user_id: string;
    notification_type: string;
    target_id?: string | null;
    status: "queued" | "sent" | "failed" | "skipped";
    reason?: string | null;
  }
) {
  await supabase.from("notification_events").insert(row);
}

function isInvalidTokenError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  return code.includes("registration-token-not-registered") || code.includes("invalid-registration-token") || code.includes("invalid-argument");
}

export async function sendFcmDataToUsers(
  supabase: SupabaseLike,
  userIds: string[],
  payload: FcmPayload
) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueUserIds.length) return { sent: 0, failed: 0, skipped: 0 };

  const { data: devices, error } = await supabase
    .from("notification_devices")
    .select("id,user_id,token")
    .in("user_id", uniqueUserIds)
    .eq("provider", "fcm")
    .eq("platform", "web_pwa")
    .eq("enabled", true);
  if (error) throw new Error(error.message);
  const deviceRows = (devices ?? []) as DeviceRow[];

  if (!deviceRows.length) {
    await Promise.all(
      uniqueUserIds.map((userId) =>
        logNotificationEvent(supabase, {
          user_id: userId,
          notification_type: String(payload.type ?? "notification"),
          target_id: String(payload.messageId ?? payload.callId ?? payload.conversationId ?? "") || null,
          status: "skipped",
          reason: "no-enabled-fcm-device"
        }).catch(() => undefined)
      )
    );
    return { sent: 0, failed: 0, skipped: uniqueUserIds.length };
  }

  const messaging = firebaseAdminMessaging();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const data = stringData(payload);

  await Promise.all(
    deviceRows.map(async (device: DeviceRow) => {
      try {
        await messaging.send({
          token: device.token,
          data,
          webpush: {
            fcmOptions: {
              link: String(payload.targetUrl ?? payload.url ?? "/app")
            }
          }
        });
        sent += 1;
        await logNotificationEvent(supabase, {
          user_id: device.user_id,
          notification_type: String(payload.type ?? "notification"),
          target_id: String(payload.messageId ?? payload.callId ?? payload.conversationId ?? "") || null,
          status: "sent"
        }).catch(() => undefined);
      } catch (error) {
        failed += 1;
        const reason = error instanceof Error ? error.message : String(error);
        if (isInvalidTokenError(error)) {
          skipped += 1;
          await supabase
            .from("notification_devices")
            .update({ enabled: false, updated_at: new Date().toISOString() })
            .eq("id", device.id);
        }
        await logNotificationEvent(supabase, {
          user_id: device.user_id,
          notification_type: String(payload.type ?? "notification"),
          target_id: String(payload.messageId ?? payload.callId ?? payload.conversationId ?? "") || null,
          status: "failed",
          reason: reason.slice(0, 500)
        }).catch(() => undefined);
      }
    })
  );

  return { sent, failed, skipped };
}

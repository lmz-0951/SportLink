import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const env = (key: string) => Deno.env.get(key) || "";
const cronSecret = env("SPORTLINK_NOTIFICATION_CRON_SECRET").trim();
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));

const notificationCopy = (type: string, date: string, time: string) => {
  const formattedDate = date.replaceAll("-", "/");
  const formattedTime = time.slice(0, 5);
  const copy: Record<string, string> = {
    accepted: "預約已接受",
    cancelled: "課程已取消",
    rejected: "預約未獲接受",
    rescheduled: "上課時間已更新",
    reminder_24h: "課程將於 24 小時後開始",
  };
  return {
    title: "SportLink 課程通知",
    body: `${copy[type] || "預約有更新"} · ${formattedDate} ${formattedTime}`,
    url: "/?sl_tab=bookings",
  };
};

async function sendToRecipient(recipientId: string, payload: Record<string, string>) {
  const { data: subscriptions, error } = await admin
    .from("sportlink_push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", recipientId)
    .eq("enabled", true)
    .limit(50);
  if (error) throw error;

  const results = await Promise.allSettled((subscriptions || []).map(async (subscription) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
        { TTL: 86400, urgency: "normal" },
      );
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        const { error: deleteError } = await admin
          .from("sportlink_push_subscriptions")
          .delete()
          .eq("id", subscription.id);
        if (deleteError) throw deleteError;
        return;
      }
      throw error;
    }
  }));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new Error(`${failures.length} push delivery(ies) failed`);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!cronSecret || request.headers.get("x-sportlink-cron-secret") !== cronSecret)
    return new Response("Unauthorized", { status: 401 });

  try {
    const { error: reminderError } = await admin.rpc("sportlink_enqueue_24h_booking_reminders");
    if (reminderError) throw reminderError;

    const { data: notifications, error: claimError } = await admin.rpc(
      "sportlink_claim_booking_notifications",
      { p_limit: 50 },
    );
    if (claimError) throw claimError;

    let delivered = 0;
    let failed = 0;
    for (const notification of notifications || []) {
      let success = false;
      let errorMessage: string | null = null;
      try {
        await sendToRecipient(notification.recipient_id, {
          ...notificationCopy(
            notification.notification_type,
            notification.lesson_date,
            notification.lesson_time,
          ),
          tag: `sportlink-booking-${notification.id}`,
        });
        success = true;
        delivered++;
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "Push delivery failed";
        failed++;
        console.error("Booking push delivery failed", notification.id, errorMessage);
      }

      const { data: finished, error: finishError } = await admin.rpc("sportlink_finish_booking_notification", {
        p_notification_id: notification.id,
        p_success: success,
        p_error: errorMessage,
      });
      if (finishError) throw finishError;
      if (!finished) throw new Error(`Notification ${notification.id} was no longer claimed`);
    }

    return Response.json({ claimed: notifications?.length || 0, delivered, failed }, { status: failed ? 207 : 200 });
  } catch (error) {
    console.error("SportLink booking notification worker failed", error);
    return new Response("Notification worker failed", { status: 500 });
  }
});

// Deploy this file as the EXISTING sportlink-send-push Edge Function.
// Keep Verify JWT OFF. Do not change existing environment secrets.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const env = (key: string) => Deno.env.get(key) || "";
webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const webhookSecret = env("SPORTLINK_WEBHOOK_SECRET").trimEnd();
  if (!webhookSecret || req.headers.get("x-sportlink-webhook-secret") !== webhookSecret)
    return new Response("Unauthorized", { status: 401 });

  try {
    const payload = await req.json();
    if (payload.type !== "INSERT" || payload.table !== "sportlink_chat_messages" || !payload.record)
      return new Response("Ignored", { status: 200 });

    const id = String(payload.record.id || "");
    const { data: message, error: msgError } = await admin
      .from("sportlink_chat_messages")
      .select("id,sender_id,recipient_id,body")
      .eq("id", id)
      .maybeSingle();
    if (msgError || !message) return new Response("Message not found", { status: 404 });

    const { data: subs, error: subError } = await admin
      .from("sportlink_push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", message.recipient_id)
      .eq("enabled", true)
      .limit(50);
    if (subError) throw subError;

    // The sender name comes from Supabase Auth metadata, not from untrusted webhook data.
    const { data: senderResult, error: senderError } = await admin.auth.admin.getUserById(message.sender_id);
    if (senderError) console.warn("Push sender display name unavailable", senderError.message);
    const sender = senderResult?.user;
    const displayName = String(sender?.user_metadata?.display_name || sender?.email?.split("@")[0] || "SportLink 好友")
      .trim().slice(0, 30) || "SportLink 好友";
    const preview = String(message.body || "").replace(/\s+/g, " ").trim().slice(0, 120) || "傳送了一則訊息";
    const url = "/?sl_tab=messages&sl_peer=" + encodeURIComponent(message.sender_id);
    const notification = JSON.stringify({
      title: displayName + " 傳送了新訊息",
      body: preview,
      url,
      tag: "sportlink-message-" + message.id,
    });

    const results = await Promise.allSettled((subs || []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notification,
          { TTL: 3600, urgency: "normal" },
        );
        return true;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410)
          await admin.from("sportlink_push_subscriptions").delete().eq("id", sub.id);
        console.error("SportLink push delivery error", status || "unknown");
        throw error;
      }
    }));
    const failures = results.filter((r) => r.status === "rejected").length;
    return Response.json({ attempted: results.length, failures }, { status: failures ? 207 : 200 });
  } catch (error) {
    console.error("push webhook error", error);
    return new Response("Server error", { status: 500 });
  }
});

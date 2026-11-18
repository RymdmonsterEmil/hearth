// Supabase Edge Function "notify": sends push notifications to people's phones.
//
//   { "ping_id": "<uuid>" }       → called by the app right after someone sends a ping.
//                                   Notifies everyone else in that household.
//   { "type": "reminders" }       → called every few minutes by the reminder job.
//                                   Notifies people about items that just became due.
//
// Needs these secrets (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Deploy with "Verify JWT" turned OFF; the function checks who's calling itself.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Read a secret, forgiving stray spaces or quotes from copy-pasting.
function secret(name: string) {
  return (Deno.env.get(name) ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

// Set up the push keys on first use, so a missing or mistyped secret gives a clear error
// instead of stopping the whole function.
let vapidReady = false;
function setUpVapid() {
  if (vapidReady) return;
  const missing = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"].filter((n) => !secret(n));
  if (missing.length) throw new Error(`Missing secret(s): ${missing.join(", ")}. Add them under Edge Functions → Secrets.`);
  let subject = secret("VAPID_SUBJECT").replace(/^mailto:\s*/i, "mailto:");
  if (!/^(mailto:|https:)/i.test(subject)) subject = `mailto:${subject}`;
  try {
    webpush.setVapidDetails(subject, secret("VAPID_PUBLIC_KEY"), secret("VAPID_PRIVATE_KEY"));
  } catch (e) {
    throw new Error(`The VAPID secrets look wrong (${e instanceof Error ? e.message : e}). Copy them again from vapid.env.`);
  }
  vapidReady = true;
}

// Admin key that Supabase gives every function automatically. Newer projects may only have
// the new-style secret keys, so fall back to those.
function adminKey() {
  const legacy = secret("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const first = Object.values(keys)[0];
    if (typeof first === "string" && first) return first;
  } catch { /* fall through */ }
  throw new Error("Supabase didn't give this function an admin key (SUPABASE_SERVICE_ROLE_KEY).");
}

// Admin client: bypasses row-level security, so every query below filters by household itself.
let client: ReturnType<typeof createClient> | null = null;
function db() {
  client ??= createClient(secret("SUPABASE_URL"), adminKey(), { auth: { persistSession: false } });
  return client;
}

type Payload = { title: string; body: string; tag?: string; url?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function pushTo(userIds: string[], householdId: string, payload: Payload) {
  if (userIds.length === 0) return { sent: 0, phones: 0 };
  setUpVapid();
  const { data: subs, error } = await db()
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("household_id", householdId)
    .in("user_id", userIds);
  if (error) throw error;

  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The phone unsubscribed or the app was removed; forget it.
        await db().from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      } else {
        console.error("push failed", status, (e as { body?: string }).body ?? e);
      }
    }
  }));
  return { sent, phones: subs?.length ?? 0 };
}

async function handlePing(req: Request, pingId: string) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await db().auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: "Not signed in" }, 401);

  const { data: ping } = await db().from("pings").select("*").eq("id", pingId).maybeSingle();
  if (!ping || ping.sender !== user.id) return json({ error: "Ping not found" }, 404);

  const { data: members, error } = await db()
    .from("members").select("user_id, name").eq("household_id", ping.household_id);
  if (error) throw error;

  const sender = members?.find((m) => m.user_id === user.id);
  const others = (members ?? []).filter((m) => m.user_id !== user.id).map((m) => m.user_id);
  const result = await pushTo(others, ping.household_id, {
    title: sender?.name ?? "Hearth",
    body: ping.message,
    tag: `ping-${ping.id}`,
    url: "./",
  });
  return json(result);
}

async function handleReminders() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const { data: due, error } = await db()
    .from("items")
    .select("id, household_id, kind, title, assignee, due_at, reminded_at")
    .eq("done", false)
    .lte("due_at", now.toISOString())
    .gte("due_at", dayAgo.toISOString());
  if (error) throw error;

  let sent = 0;
  let reminded = 0;
  for (const item of due ?? []) {
    if (item.reminded_at && new Date(item.reminded_at) >= new Date(item.due_at)) continue;

    let recipients: string[] = item.assignee ? [item.assignee] : [];
    if (!item.assignee) {
      const { data: members } = await db().from("members").select("user_id").eq("household_id", item.household_id);
      recipients = (members ?? []).map((m) => m.user_id);
    }
    const result = await pushTo(recipients, item.household_id, {
      title: item.kind === "routine" ? "Time for a chore" : "Reminder",
      body: item.title,
      tag: `item-${item.id}`,
      url: "./",
    });
    sent += result.sent;
    reminded++;
    await db().from("items").update({ reminded_at: now.toISOString() }).eq("id", item.id);
  }
  return json({ reminded, sent });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.type === "check") {
      // Setup check: confirms the secrets and database access work, without sending anything.
      setUpVapid();
      const { error } = await db().from("members").select("user_id").limit(1);
      if (error) throw error;
      return json({ ok: true });
    }
    if (body.type === "reminders") return await handleReminders();
    if (typeof body.ping_id === "string") return await handlePing(req, body.ping_id);
    return json({ error: "Unknown request" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

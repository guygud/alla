import * as webpush from "jsr:@negrel/webpush@0.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function gone(err) {
  const status = err?.response?.status;
  if (status === 404 || status === 410) return true;
  return typeof err?.isGone === "function" && err.isGone();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: expected, error: secretError } = await supabase.rpc("mt_runtime_secret", {
    p_name: "mt_reminder_secret",
  });
  const given = req.headers.get("x-reminder-secret") ?? "";
  if (secretError || typeof expected !== "string" || expected.length === 0 || given !== expected) {
    return json({ ok: false }, 401);
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body?.remind !== true) {
    const { error } = await supabase.rpc("mt_touch");
    if (error) return json({ ok: false }, 500);
    return json({ ok: true, reminded: 0 });
  }

  const { data: vapidJson, error: vapidError } = await supabase.rpc("mt_runtime_secret", {
    p_name: "mt_vapid_keys",
  });
  if (vapidError || typeof vapidJson !== "string") return json({ ok: false }, 500);

  const { data: due, error: dueError } = await supabase.rpc("mt_due_pushes");
  if (dueError || !Array.isArray(due)) return json({ ok: false }, 500);

  const vapidKeys = await webpush.importVapidKeys(JSON.parse(vapidJson));
  const appServer = await webpush.ApplicationServer.new({
    contactInformation: "https://guygud.github.io/alla/",
    vapidKeys,
  });

  let reminded = 0;
  for (const row of due) {
    const { data: claimed, error: claimError } = await supabase.rpc("mt_push_claim", { p_id: row.id });
    if (claimError || !claimed?.ok) continue;
    try {
      await appServer.subscribe({
        endpoint: claimed.endpoint,
        keys: { p256dh: claimed.p256dh, auth: claimed.auth },
      }).pushTextMessage(JSON.stringify({
        title: "Пушин",
        body: "Пушин ждёт. Семь минут.",
      }), {
        ttl: 4 * 60 * 60,
        urgency: webpush.Urgency.High,
        topic: "practice",
      });
      reminded += 1;
    } catch (err) {
      if (gone(err)) await supabase.rpc("mt_push_forget", { p_id: row.id });
      else await supabase.rpc("mt_push_release", { p_id: row.id });
    }
  }

  return json({ ok: true, reminded });
});

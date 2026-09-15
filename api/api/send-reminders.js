// My Day — daily morning summary notification (Phase 3, part 2).
//
// This is a Vercel serverless function, but unlike pocket-webhook.js it
// isn't called by an outside service — Vercel's own Cron scheduler calls
// it once a day, on the schedule set in vercel.json (currently 08:00 UTC,
// which is 9:00am UK time for most of the year — see note below). Vercel
// signs its own cron requests with a special header this function checks
// for, so nobody else can trigger it and spam your devices.
//
// What it does each time it runs, for EVERY user who has turned on
// reminders (there can be more than one, e.g. if you and a family member
// both use the app):
//   1. Skip anyone it already sent to today (using the nudge_log table) —
//      this protects against Vercel Cron firing twice, or you manually
//      re-running it while testing.
//   2. Look up that user's tasks due today (or overdue) that aren't done.
//   3. If there's nothing to say, skip silently (no "0 tasks today" spam).
//   4. Otherwise send one push notification per subscribed device with a
//      short summary, using the VAPID key pair (web-push library).
//   5. Record today's date in nudge_log so step 1 skips them later today.
//
// A note on timing: Vercel's free (Hobby) plan only allows cron jobs to
// run once a day, and doesn't guarantee the exact minute (it can be up to
// about an hour early or late) - Vercel's paid Pro plan removes both
// limits. There's also a once-a-year quirk: 08:00 UTC is 9:00am UK time
// in British Summer Time (late March-late October) but 8:00am UK time in
// winter, because the cron schedule itself is fixed in UTC and doesn't
// know about UK clock changes. If that matters to you, this schedule can
// be nudged by an hour in vercel.json around each clock change.
//
// Required environment variables (Vercel -> Project Settings ->
// Environment Variables, then redeploy):
//   SUPABASE_URL              - same project URL as in config.js
//   SUPABASE_SERVICE_ROLE_KEY - the SECRET key (same one pocket-webhook.js
//                               uses, if you've set that up already).
//                               Server-side only - never in config.js.
//   VAPID_PUBLIC_KEY          - must match window.VAPID_PUBLIC_KEY in
//                               config.js exactly (same key pair).
//   VAPID_PRIVATE_KEY         - the matching private half. Server-side
//                               only - never in config.js or the browser.
//   VAPID_CONTACT_EMAIL       - any contact email (e.g. yours) - the Web
//                               Push standard requires one, for push
//                               services to reach you if something's
//                               misbehaving. Not shown to users.
//   CRON_SECRET               - a long random string you make up. Put the
//                               exact same value in Vercel -> Project
//                               Settings -> Cron Jobs (or the environment
//                               variable of the same name) - Vercel then
//                               sends it automatically with every cron
//                               request, and this function checks it.

var webpush = require("web-push");

module.exports = async (req, res) => {
  var url = process.env.SUPABASE_URL;
  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var vapidPublic = process.env.VAPID_PUBLIC_KEY;
  var vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  var vapidEmail = process.env.VAPID_CONTACT_EMAIL;
  var cronSecret = process.env.CRON_SECRET;

  if (!url || !serviceKey || !vapidPublic || !vapidPrivate || !vapidEmail || !cronSecret) {
    console.error("send-reminders: missing required environment variables");
    res.status(500).json({ error: "server not configured" });
    return;
  }

  // Vercel Cron automatically sends "Authorization: Bearer <CRON_SECRET>"
  // when CRON_SECRET is set as an environment variable - this rejects any
  // other caller, including someone who guesses this URL.
  var authHeader = req.headers && req.headers.authorization;
  if (authHeader !== "Bearer " + cronSecret) {
    console.error("send-reminders: rejected - missing or wrong Authorization header");
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  webpush.setVapidDetails("mailto:" + vapidEmail, vapidPublic, vapidPrivate);

  var todayIso = new Date().toISOString().slice(0, 10);

  try {
    var subsRes = await supabaseRest(url, serviceKey, "GET", "/rest/v1/push_subscriptions?select=*", null, {});
    if (!subsRes.ok) {
      console.error("send-reminders: failed to load subscriptions", subsRes.status, subsRes.body);
      res.status(502).json({ error: "failed to load subscriptions" });
      return;
    }
    var subs = subsRes.body || [];

    // Group subscriptions by user - one person can have more than one
    // device (phone + laptop), and should get one summary sent to each.
    var byUser = {};
    subs.forEach(function (s) {
      if (!byUser[s.user_id]) byUser[s.user_id] = [];
      byUser[s.user_id].push(s);
    });

    var userIds = Object.keys(byUser);
    var sentCount = 0, skippedCount = 0;

    for (var i = 0; i < userIds.length; i++) {
      var userId = userIds[i];

      var logRes = await supabaseRest(url, serviceKey, "GET",
        "/rest/v1/nudge_log?user_id=eq." + userId + "&select=last_sent_date", null, {});
      var alreadySentToday = logRes.ok && Array.isArray(logRes.body) && logRes.body.length &&
        logRes.body[0].last_sent_date === todayIso;
      if (alreadySentToday) { skippedCount++; continue; }

      var tasksRes = await supabaseRest(url, serviceKey, "GET",
        "/rest/v1/tasks?user_id=eq." + userId + "&status=eq.open&due_at=lte." + todayIso + "T23:59&select=title,due_at",
        null, {});
      var dueTasks = (tasksRes.ok && Array.isArray(tasksRes.body)) ? tasksRes.body : [];

      // Nothing due - mark the day as handled but don't send an empty
      // "you have 0 tasks" notification.
      if (!dueTasks.length) {
        await supabaseRest(url, serviceKey, "POST", "/rest/v1/nudge_log?on_conflict=user_id",
          { user_id: userId, last_sent_date: todayIso },
          { Prefer: "resolution=merge-duplicates" });
        continue;
      }

      var body = dueTasks.length === 1
        ? "Today: " + dueTasks[0].title
        : dueTasks.length + " tasks today, starting with " + dueTasks[0].title;

      var payload = JSON.stringify({ title: "Your day ahead", body: body, url: "./" });

      var userSubs = byUser[userId];
      for (var j = 0; j < userSubs.length; j++) {
        var s = userSubs[j];
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
            payload
          );
          sentCount++;
        } catch (pushErr) {
          console.error("send-reminders: push failed for a subscription", pushErr && pushErr.statusCode, pushErr && pushErr.body);
          // 404/410 means the browser/device unsubscribed or the
          // subscription expired on the push service's side - clean it up
          // so future runs don't keep failing on it.
          if (pushErr && (pushErr.statusCode === 404 || pushErr.statusCode === 410)) {
            await supabaseRest(url, serviceKey, "DELETE", "/rest/v1/push_subscriptions?endpoint=eq." + encodeURIComponent(s.endpoint), null, {});
          }
        }
      }

      await supabaseRest(url, serviceKey, "POST", "/rest/v1/nudge_log?on_conflict=user_id",
        { user_id: userId, last_sent_date: todayIso },
        { Prefer: "resolution=merge-duplicates" });
    }

    res.status(200).json({ ok: true, users: userIds.length, sent: sentCount, skipped: skippedCount });
  } catch (err) {
    console.error("send-reminders: unexpected error", err);
    res.status(500).json({ error: "unexpected error" });
  }
};

async function supabaseRest(baseUrl, serviceKey, method, path, body, extraHeaders) {
  var headers = Object.assign({
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    "Content-Type": "application/json"
  }, extraHeaders || {});
  var res = await fetch(baseUrl + path, {
    method: method,
    headers: headers,
    body: body ? JSON.stringify(body) : undefined
  });
  var text = await res.text();
  var parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
  return { ok: res.ok, status: res.status, body: parsed };
}

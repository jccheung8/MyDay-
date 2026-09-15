// Receives webhooks from Pocket AI and turns a finished recording into a
// note in My Day (using the same notes -> task flow already in the app),
// plus a permanent record in the `meetings` table.
//
// This is a Vercel serverless function: any .js file under /api is
// auto-detected and run as one, no configuration needed. Vercel parses
// a JSON request body into `req.body` for you automatically.
//
// SECURITY MODEL: Pocket's exact webhook-signing format (header name and
// signing scheme) isn't confirmed from their published docs, so rather
// than half-implement a signature check that might silently never
// validate correctly, this endpoint is protected with a secret TOKEN in
// the URL itself instead - e.g. Pocket calls
// https://your-app.vercel.app/api/pocket-webhook?token=<a-long-random-string>
// and this function rejects any request whose ?token= doesn't match.
// Anyone without that URL (which only you and Pocket's servers know, and
// which only ever travels over HTTPS) cannot post fake data. Keep that
// full URL as private as a password.
//
// Required environment variables (Vercel -> Project Settings ->
// Environment Variables, then redeploy):
//   SUPABASE_URL              - same project URL as in config.js
//   SUPABASE_SERVICE_ROLE_KEY - the SECRET key (Supabase -> Settings ->
//                               API Keys). Server-side only - this must
//                               NEVER go in config.js or any browser code.
//                               It bypasses Row Level Security, which is
//                               exactly why only this server function uses
//                               it, never the client app.
//   TARGET_USER_ID            - your Supabase auth user UUID (Supabase ->
//                               Authentication -> Users -> copy the id
//                               next to your email). A webhook call has no
//                               logged-in session, so this is the only way
//                               the database knows whose data this is.
//   POCKET_WEBHOOK_TOKEN      - a long random string you make up yourself
//                               (e.g. from a password generator). You put
//                               the same value in the webhook URL you give
//                               Pocket, as ?token=<that value>.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  var url = process.env.SUPABASE_URL;
  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var userId = process.env.TARGET_USER_ID;
  var expectedToken = process.env.POCKET_WEBHOOK_TOKEN;

  if (!url || !serviceKey || !userId || !expectedToken) {
    console.error("pocket-webhook: missing required environment variables");
    res.status(500).json({ error: "server not configured" });
    return;
  }

  var providedToken = (req.query && req.query.token) || "";
  if (providedToken !== expectedToken) {
    console.error("pocket-webhook: rejected - missing or wrong ?token=");
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  var payload = req.body;
  if (!payload || typeof payload !== "object") {
    res.status(400).json({ error: "expected a JSON body" });
    return;
  }

  var event = payload.event;

  // Only "summary.completed" is handled for now - it's the one event
  // whose payload shape is confirmed from Pocket's docs (recording info
  // + full transcript). Other event types (e.g. action_items.regenerated)
  // are acknowledged so Pocket doesn't retry them, but not processed yet:
  // their exact payload shape needs to be confirmed from a real delivery
  // first - check this function's logs (Vercel -> your project ->
  // Deployments -> the deployment -> Functions/Logs) after a real Pocket
  // recording finishes, and that shape can be added here.
  if (event !== "summary.completed") {
    res.status(200).json({ ignored: true, event: event || null });
    return;
  }

  var recording = payload.recording || {};
  var transcriptSegments = Array.isArray(payload.transcript) ? payload.transcript : [];
  var transcriptText = transcriptSegments.map(function (seg) {
    var speaker = seg.speaker ? seg.speaker + ": " : "";
    return speaker + (seg.text || "");
  }).join("\n");

  var title = recording.title || "Untitled meeting";
  var recordingId = recording.id || null;

  try {
    // 1. Upsert into meetings (dedup on pocket_recording_id, since Pocket
    //    retries failed deliveries up to 3 times).
    var meetingRow = {
      user_id: userId,
      pocket_recording_id: recordingId,
      title: title,
      duration_seconds: recording.duration || null,
      transcript: transcriptText,
      raw_payload: payload
    };
    var meetingRes = await supabaseRest(url, serviceKey, "POST",
      "/rest/v1/meetings?on_conflict=pocket_recording_id",
      meetingRow,
      { Prefer: "resolution=merge-duplicates,return=representation" });

    if (!meetingRes.ok) {
      console.error("pocket-webhook: failed to upsert meeting", meetingRes.status, meetingRes.body);
      res.status(502).json({ error: "failed to store meeting" });
      return;
    }
    var meeting = Array.isArray(meetingRes.body) ? meetingRes.body[0] : meetingRes.body;

    // 2. If this meeting doesn't already have a linked note (first time
    //    we've seen it), create one - this is what makes the transcript
    //    show up under "From your notes" in the app, ready to turn into
    //    a task with the existing note -> task flow.
    if (meeting && !meeting.note_id) {
      var noteBody = "Meeting: " + title + (transcriptText ? "\n\n" + transcriptText : "");
      var noteRes = await supabaseRest(url, serviceKey, "POST", "/rest/v1/notes",
        { user_id: userId, body: noteBody, linked_task_ids: [] },
        { Prefer: "return=representation" });

      if (noteRes.ok) {
        var note = Array.isArray(noteRes.body) ? noteRes.body[0] : noteRes.body;
        await supabaseRest(url, serviceKey, "PATCH",
          "/rest/v1/meetings?id=eq." + meeting.id,
          { note_id: note.id },
          {});
      } else {
        console.error("pocket-webhook: failed to create note for meeting", noteRes.status, noteRes.body);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("pocket-webhook: unexpected error", err);
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

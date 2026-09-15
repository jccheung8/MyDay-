// Fill these in from your Supabase project — see "Finding your API
// credentials" in SETUP.md for exact click-by-click steps — then redeploy.
//
// SUPABASE_ANON_KEY: use the "Publishable key" (sb_publishable_...) or,
// on an older project, the "anon" "public" key (eyJ...). Either is safe
// to expose in client code — it's designed to be public, and Row Level
// Security (see schema.sql) is what actually restricts who can read or
// write your data. Never put the "Secret key" / "service_role" key here.
window.SUPABASE_URL = "https://gpdyvjyvhbmawcbsvinn.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_Ow5SnluQZ7HN14DZk4OA7w_1ECMjDy5";

// VAPID_PUBLIC_KEY: used for the "Enable reminders" button (Phase 3). This
// is the PUBLIC half of a key pair and is safe to expose here — it's what
// proves push notifications sent to your device really came from your own
// app. Its matching PRIVATE half only ever goes into a Vercel server-side
// environment variable — see SETUP.md's reminders section.
window.VAPID_PUBLIC_KEY = "BN2rKCIfTltzN40t0LZWvT3lt7nWN98Jzz2l8mHVfnCMD-Rv-eP3pP4E_Ed4HRQzPSB5Ym94u1mOn6wHffmuI1A";

# My Day — Supabase + Vercel setup

This is the full app: a static site (`index.html` + `config.js`) that talks
directly to your own Supabase project for storage and authentication. No
build step, no framework — just three files to deploy.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free account and a new project (pick any name/region).
2. During setup you may be asked about a few security toggles — here's what to pick:
   - **Enable Data API** → **on**. This is the API the app actually talks to; without it, nothing works.
   - **Automatically expose new tables** → **off**. This is Supabase's own current recommended default: a newly created table isn't reachable by the API until you deliberately grant access to it, so nothing is ever exposed by accident before you've secured it. `schema.sql` (below) already includes the explicit grants the app's two tables need, so leaving this off doesn't break anything here.
   - **Enable RLS by default on new tables** (sometimes phrased "automatic RLS") → **on**. This makes any table you create default to locked-down (no access at all until you add a policy), rather than open. Good safety net for later, and `schema.sql` also turns RLS on explicitly for the two tables this app uses either way.
3. Once the project is provisioned, open **Project Settings → API**. You'll need two values from this page in step 4: the **Project URL** and the **anon public** key.

## 2. Create the database tables and security rules

1. In your Supabase project, open **SQL Editor → New query**.
2. Paste in the entire contents of `schema.sql` (included alongside this file) and run it. This creates both tables, turns on Row Level Security with per-user policies, and explicitly grants API access to signed-in ("authenticated") users only — matching the safer, non-automatic exposure setting above.

This creates two tables (`tasks`, `notes`) and turns on **Row Level Security (RLS)** with policies that restrict every row to the signed-in user who owns it — so even though the app's public API key is embedded in the client code (this is normal and safe for Supabase's anon key), nobody can read or write your data without being authenticated as you. It also enables realtime sync so changes show up instantly.

## 3. Create your own account

Open the app and use the **Sign up** link on the login screen to create your own account with your email and a password.

By default, Supabase requires a confirmation email before a new account can sign in. After signing up you'll see a message to check your inbox — click the confirmation link, then come back and sign in. If you'd rather skip that step for yourself, you can also add yourself directly in **Authentication → Users → Add user → Create new user** with **Auto Confirm User** checked, instead of using the app's sign-up form.

### Letting family and friends sign up too

The app's sign-up form is open to anyone with the link — that's what makes it possible to invite people. Each person who signs up gets their own private account: thanks to the Row Level Security policies in `schema.sql`, everyone's tasks and notes are isolated to their own account by default — nobody, including you, can see another person's data unless you deliberately build sharing later (the schema is designed to support that as an addition, not a rework).

Two things worth knowing before you send the link around:
- **Email sending limits.** Supabase's built-in email service (used for confirmation links) has a low rate limit on the free tier — fine for a handful of signups, but if you're inviting more than a few people at once some confirmation emails may be delayed. For anything beyond family-and-friends scale, Supabase's docs cover connecting your own SMTP provider (Settings → Auth → SMTP Settings) for reliable delivery.
- **If you'd rather not have an open sign-up form** (e.g. you only want to add people yourself), go to **Authentication → Providers → Email** in Supabase and turn off "Allow new users to sign up" — you can still add people manually from **Authentication → Users**, and the app's sign-up button will simply show an error if someone tries it.

## 4. Configure the app

Open `config.js` and replace the two placeholder values with the Project URL and anon public key from step 1:

```js
window.SUPABASE_URL = "https://your-project-ref.supabase.co";
window.SUPABASE_ANON_KEY = "eyJ...";
```

## 5. Deploy to Vercel

**Option A — Vercel CLI (fastest):**

```bash
npm i -g vercel
cd my-day-app
vercel
```

Follow the prompts (link or create a project, accept the defaults — no build command, no framework). Vercel gives you a live HTTPS URL immediately, and running `vercel --prod` promotes it to your permanent production URL.

**Option B — GitHub + Vercel dashboard:**

1. Push this folder to a new GitHub repository.
2. Go to [vercel.com/new](https://vercel.com/new), import that repository.
3. Leave the framework preset as "Other" with no build command — it's a static site.
4. Deploy. Every future push to the repo redeploys automatically.

Either way, Vercel serves the app over HTTPS by default, so your login and data traffic are encrypted in transit.

## Security & privacy summary

- **Authentication**: the app is unusable without signing in — there's no way to view or change data as a guest.
- **Multi-user, private by default**: anyone can sign up, but Row Level Security means every account only ever sees its own tasks and notes — including you. Nobody's data is visible to anyone else unless you deliberately add a sharing feature later.
- **Row Level Security**: enforced at the database level, not just in the app's code — even a direct API request with a stolen anon key can only touch rows owned by the authenticated caller making the request.
- **Your anon key is meant to be public**: unlike a service-role/secret key (never put one of those in client code, and this app doesn't use one), Supabase's anon key is designed to sit in client-side JavaScript; RLS is what actually protects your data, not keeping this key secret.
- **HTTPS everywhere**: both Supabase's API and Vercel's hosting are HTTPS-only.
- **Want a closed guest list instead of open sign-up?** See "If you'd rather not have an open sign-up form" above.

## If something isn't working

- App stuck on "Setup isn't finished yet": `config.js` still has the placeholder values — finish step 4 and reload.
- Login fails with "Invalid login credentials": the account either doesn't exist yet (use Sign up) or hasn't confirmed its email yet — check the inbox (and spam folder) for the confirmation link.
- Signed up but no confirmation email arrives: check spam first; if it's genuinely not arriving, it's likely the free-tier email rate limit mentioned above — wait a bit and try again, or set up custom SMTP for reliable delivery.
- Data doesn't appear after signing in: confirm `schema.sql` ran without errors in the SQL Editor, and that you're logged in as the same user whose rows you're expecting — remember each account's data is private to that account.

# Side-by-Side Trial Entry

A two-page web app for recording field trial data:

- **`index.html`** — public mobile-friendly entry form. Reps submit trials from their phones.
- **`dashboard.html`** — password-protected dashboard with filters, charts, sortable table, and CSV export.

Backend is [Supabase](https://supabase.com) (free tier is plenty). Hosting is any static host — Vercel/Netlify/Cloudflare Pages are all one-click.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**. Pick a name + a region close to you. Save the **database password** somewhere safe.
2. Once the project is ready, go to **Settings → API**. Copy:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - **anon public** key (a long JWT)
3. Paste both into `config.js`:
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://abcdxyz.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi..."
     ...
   };
   ```

## 2. Create the database table

In the Supabase dashboard, open **SQL Editor → New query**, paste the contents of [`schema.sql`](schema.sql), and click **Run**.

This creates the `trials` table and sets row-level security so that:
- Anonymous users (entry form) can INSERT only.
- Logged-in users (dashboard) can read/edit/delete.

## 3. Create the dashboard login

In Supabase, go to **Authentication → Users → Add user → Create new user**.
- Email + password — these are the dashboard credentials.
- Check **Auto Confirm User** so you don't need to verify email.

Repeat for each person who should see the dashboard. (You can also turn off public signups in **Authentication → Providers → Email**.)

## 4. (One time) Import existing data

[`existing_trials.csv`](existing_trials.csv) was generated from your Excel — 350 rows, columns already mapped to the database.

In Supabase: **Table Editor → trials → Import data from CSV** → upload `existing_trials.csv` → confirm column mapping (should auto-match) → Import.

## 5. Test locally

Open a terminal in this folder and serve the files (any static server works):

```powershell
# Python 3 (already installed on this machine):
py -m http.server 8000
```

Then open <http://localhost:8000/> for the entry form, <http://localhost:8000/dashboard.html> for the dashboard.

## 6. Deploy

Easiest: **Vercel**.

1. Push this folder to a GitHub repo (or use the Vercel CLI: `npx vercel`).
2. In Vercel, **Import Project** → point to the repo → accept defaults (it's a static site, no build needed).
3. You'll get a URL like `https://your-trials.vercel.app`. Hand that out to reps.

Alternative: drop the folder into [Netlify Drop](https://app.netlify.com/drop) — instant URL, no account needed for a quick test.

---

## Files

| File | Purpose |
|---|---|
| `index.html` + `app.js` | Entry form (public) |
| `dashboard.html` + `dashboard.js` | Dashboard (auth required) |
| `config.js` | Supabase URL + anon key + crop prices |
| `styles.css` | Shared input styling |
| `schema.sql` | Database schema + RLS policies |
| `existing_trials.csv` | One-time import of historical 350 rows |

## Notes

- **Calculated fields** (TRT Increase, % Increase, *TRT Cost, $/A Increase, Net $/Acre, ROI) are computed in the form before insert AND can be edited/recomputed in the future. They're stored as real columns so the dashboard can chart them directly.
- **$/bu lookup** lives in `config.js` (Corn=$4, SB=$10, Wheat=$5). Edit there if prices change.
- **Photos** are deferred — the schema doesn't include a photos column yet. When you're ready, we'll add a Supabase Storage bucket and a file picker on the form.
- **Security model:** the anon key is public (embedded in the HTML), but RLS limits it to INSERT-only. Reading data requires a Supabase Auth login. So anyone with the URL can submit a trial; only authenticated users can view the dashboard.

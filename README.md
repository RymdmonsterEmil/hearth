# Hearth (web app)

Shared household lists for two iPhones. It's free, and you install it from Safari onto your Home Screen.

- **To Fix**: dump anything that needs fixing. Mark it urgent, assign it, give it a due date.
- **Routines**: repeating chores. Ticking one off schedules the next one.
- **Categories**: give tasks a category (Bathroom, Garden…) and filter each list by it.
- **Buy at**: set a store on anything that needs buying. The **Shopping** tab groups everything by store, including tasks from To Fix, so at Clas Ohlson you tap its chip and see just what to get there. Ticking a task off there marks it done everywhere.
- **Shopping**: tick things off into "In the basket", then clear them.
- **Pings**: push notifications to your partner (quick messages, or about a specific item). Assigning something to your partner pings them automatically. Adding items can too, batched into one ping.
- **Reminders**: a push notification when something with a due date becomes due.
- Changes appear instantly on both phones. The app also opens offline, showing your last saved lists.

**What it runs on (all free):** [Supabase](https://supabase.com) free tier for the database, logins, live updates and notification sending; [GitHub Pages](https://pages.github.com) for hosting the website.

To try it first without any setup, leave `config.js` empty and open the site. It runs in **demo mode**, with data saved on that device only.

---

## Setup (about 15 minutes)

### 1. Create the Supabase project

1. Sign up at <https://supabase.com> (free, no card needed) and click **New project**.
2. Name it `hearth`, choose a database password (save it somewhere; you won't need it for the app), and pick the region closest to you. Then wait about a minute for it to finish.
3. Open **SQL Editor**, click **New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. You should see "Success. No rows returned".
4. Open **Authentication → Sign In / Providers → Email** and turn **off** "Confirm email". This saves you clicking confirmation links. Leave email sign-in itself enabled.

### 2. Connect the website to it

Open **Project Settings → API Keys** (the gear icon), then:

- copy the **Project URL** (it looks like `https://abcdefghijkl.supabase.co`);
- copy the **publishable** key (`sb_publishable_…`). If you only see "anon" keys, copy the `anon` `public` one.

Paste both into [`config.js`](config.js). They're meant to be public: the database rules from step 1 make sure each household only sees its own data. (Or just send them to Claude and it will fill them in.)

### 3. Set up push notifications

1. In Supabase, open **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `notify`. Replace the sample code with the whole of [`supabase/functions/notify/index.ts`](supabase/functions/notify/index.ts) and click **Deploy**.
3. Open the function's **Details / Settings** and turn **off** "Enforce JWT verification" (also called "Verify JWT"), then save. The function checks who's calling it itself.
4. Open **Edge Functions → Secrets** and add three secrets. The values are in the file `.secrets/vapid.env` in this folder, which never gets uploaded anywhere:

   | Name | Value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | from `vapid.env` |
   | `VAPID_PRIVATE_KEY` | from `vapid.env` (keep this one private) |
   | `VAPID_SUBJECT` | `mailto:` followed by your email address |

5. Open **SQL Editor** again and paste [`supabase/reminders.sql`](supabase/reminders.sql). Replace `YOUR-PROJECT-REF` with the part of your Project URL before `.supabase.co`, then **Run**. This checks for due reminders every 5 minutes.

### 4. Put the website online (GitHub Pages)

1. Sign up at <https://github.com> (free).
2. Create a **New repository** named `hearth` and make it **Public** (free Pages needs that). Nothing secret is in these files.
3. Click **uploading an existing file** and drag in everything in this folder, *except* the `.secrets` folder (Finder hides it by default anyway). Click **Commit changes**.
4. Open **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, then **main** and **/ (root)**, and click **Save**.
5. After about a minute your app is live at `https://YOUR-GITHUB-NAME.github.io/hearth/`.

(If you'd rather not click through this, sign in to GitHub on this Mac with `gh auth login` and Claude can create and publish the repository for you.)

### 5. Install it on both iPhones

On **each** phone (iOS 16.4 or newer):

1. Open the site in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open **Hearth from the Home Screen**, not from Safari. The Home Screen app has its own login and is the only place iPhone notifications work.
4. Create an account with email and password.
5. **First person:** enter your name and tap **Create our household**. Then go to the **Home** tab, tap **Turn on** under notifications and allow them, and tap **Send invite** to text your partner the invite code.
6. **Second person:** enter your name, type the invite code, and tap **Join household**. Then go to **Home**, tap **Turn on**, and allow notifications.
7. Test it: send a ping from one phone and it should pop up on the other.

### 6. Lock the door

Once you've both created accounts, open Supabase → **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up". Nobody else can create an account after that.

---

## Things to know

- **Free-tier pause:** Supabase pauses free projects after a week with no activity. Normal daily use keeps it awake. If it ever pauses, open your Supabase dashboard and click **Restore**. Your data is kept.
- **Updating the app:** change files, upload them to the GitHub repository again, and the phones pick up the new version the next time they open the app (sometimes it takes two opens).
- **Pings show your partner's name as the title** and the message as the body. Reminders say "Reminder" or "Time for a chore".

## Troubleshooting

| Problem | Fix |
|---|---|
| "Turn on" isn't shown, or it says to add Hearth to your Home Screen | You opened it in Safari. Open the Home Screen icon instead. |
| Ping says "Saved, but the notification couldn't be sent" | Step 3: check the function is named `notify`, JWT verification is off, and the three secrets are set. In Supabase, **Edge Functions → notify → Logs** shows the actual error. |
| Ping says partner "hasn't turned on notifications yet" | Your partner needs to tap **Turn on** in the Home tab on their phone. |
| No reminders | Check that step 3.5 ran. In **SQL Editor**, `select * from cron.job_run_details order by start_time desc limit 5;` shows recent runs. |
| "No household has that code" | Codes are 6 characters. Check the code on the Home tab of the first phone. |
| Notifications stopped after reinstalling | Tap **Turn on** again in the Home tab. |

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app. |
| `data.js` | Talks to Supabase (or to this device's storage in demo mode). |
| `config.js` | Your Supabase address and keys. |
| `sw.js`, `manifest.webmanifest`, `icons/` | What makes it installable, work offline and receive notifications. |
| `supabase/schema.sql` | Database tables and security rules. |
| `supabase/functions/notify/index.ts` | Sends push notifications for pings and reminders. |
| `supabase/reminders.sql` | Runs the reminder check every 5 minutes. |
| `supabase/update-categories-stores.sql` | One-time update that adds categories and stores to an existing database. New setups don't need it (it's in `schema.sql`). |
| `.secrets/vapid.env` | Private notification key. **Never upload this.** |

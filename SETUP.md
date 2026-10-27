# Priorities – setup

Priorities is one app that runs on your Windows 11 PC, iPhone and iPod. It's a
web app you install to your home screen and taskbar, so there's no App Store
and no Mac. Your list syncs through a free Supabase database.

The whole setup takes about 20 minutes. You only do it once.

---

## 1. Create the database (Supabase)

1. Go to **https://supabase.com** and sign up (free).
2. Click **New project**. Name it `priorities`, pick the region closest to you,
   and set a database password. The app never uses that password, so just
   save it in your password manager. Then click **Create**.
3. Wait about a minute for the project to be ready. Then open **SQL Editor**
   in the left sidebar and click **New query**.
4. Open `supabase-setup.sql` from this folder, copy everything in it, paste it
   in, and click **Run**. You should see "Success. No rows returned."
5. Click **Connect** at the top of the project page, or go to
   **Project Settings → API Keys**. Copy these two things:
   - **Project URL**, which looks like `https://abcdefghijkl.supabase.co`
   - **Publishable key**, which starts with `sb_publishable_`. If you only
     see a legacy **anon** key, that works too.

   Never use the **secret** or **service_role** key. It skips all security.
6. Open `config.js` in Notepad and paste the two values between the quotes:

   ```js
   window.PRIORITIES_CONFIG = {
     supabaseUrl: "https://abcdefghijkl.supabase.co",
     supabaseKey: "sb_publishable_..."
   };
   ```

## 2. Put the app online (GitHub Pages, free)

Your iPhone needs to reach the app over the internet, so it has to be hosted
somewhere. GitHub Pages is free and simple.

1. Sign up at **https://github.com**.
2. Click **+ → New repository**. Name it `priorities`, set it to **Public**,
   and click **Create repository**. Free GitHub Pages needs a public repo.
   Nothing in these files is secret: the publishable key is made to be public,
   and the database rules from step 1 keep your tasks private.
3. On the new repo page, click **uploading an existing file**. Drag in
   everything in this folder, including the `icons` folder. Click
   **Commit changes**.
4. Go to **Settings → Pages**. Under "Branch", pick `main` and `/ (root)`, then
   click **Save**.
5. Wait a minute or two. Your app is now at
   **https://YOUR-USERNAME.github.io/priorities/**

## 3. Tell Supabase where the app lives

In Supabase, go to **Authentication → URL Configuration**. Set **Site URL** to
the address from step 2.5 and click **Save**. Without this, the link in your
confirmation email will open a broken page.

## 4. Install it

**Windows 11 (Edge):** open your app address, click **⋯ → Apps → Install this
site as an app**, then pin it to the taskbar or Start. In Chrome, click the
install icon at the right end of the address bar.

**iPhone / iPod:** open your app address in **Safari** (it has to be Safari),
tap **Share → Add to Home Screen → Add**. From then on, open it from the home
screen icon.

## 5. Make your account

1. On the PC, open the app and click the **Sign in to sync** pill at the top
   right.
2. Enter your email and a password, then click **Create account**.
3. Click the link in the confirmation email. Then go back to the app and click
   **Sign in**. The pill should turn green and say **Synced**.
4. **Lock it down:** in Supabase, go to **Authentication → Sign In / Providers**
   and turn off **Allow new users to sign up**. Now nobody else can make an
   account on your database.
5. On the iPhone and iPod, open the app, tap the pill, and sign in with the
   same email and password.

Anything you add or reorder on one device shows up on the others within a
second or two.

---

## Using it

- **Add:** type in the box and press Enter (or tap **+**). The **↓ Bottom /
  ↑ Top** button picks where new tasks land.
- **Reorder:** drag the **≡** handle. #1 is red, #2 orange, #3 yellow.
- **Done:** tap the circle. Finished tasks move to **Completed**, and **Clear**
  removes them.
- **Edit:** tap the task's text.
- **Delete:** tap **×**. A toast gives you 5 seconds to **Undo**.
- **Offline:** the app works without internet and syncs once you're back
  online.

## Good to know

- **Supabase pauses free projects after about a week with no use.** If you go
  that long without opening the app, sign in to supabase.com and click
  **Restore project**. The app keeps working offline meanwhile, and nothing is
  lost.
- **Changing the app later:** edit the files, then change
  `var CACHE = "priorities-v1"` in `sw.js` to `-v2`, `-v3` and so on, and
  re-upload to GitHub. Devices pick up the new version the next time they open
  the app online. You may need to close and reopen it once more.
- **If the pill says "Sync problem":** tap it to see the error.
  - "relation public.todos does not exist" means step 1.4 (the SQL) didn't run.
  - "Invalid API key" means `config.js` has a wrong value.
- **iPod:** the iPod touch 7th gen tops out at iOS 15, which this app supports.
  Older iPods on iOS 12 or below may not run it.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `config.js` | Your Supabase address and key |
| `sw.js` | Offline support |
| `manifest.webmanifest`, `icons/` | App name and icons for install |
| `supabase-setup.sql` | Database table and security rules (run once) |

To test it on the PC before it's online, run this in the folder and open
http://localhost:5173:

```
python -m http.server 5173
```

# ATLANTIS — Deployment Guide (Localhost → Production)

## Your Project Structure
```
atlantis/
├── server.js          ← Node.js + Express + Socket.io
├── package.json
├── .env               ← Environment variables (NEVER commit this)
├── .env.example       ← Reference for env vars
├── .gitignore
├── middleware/
│   ├── auth.js        ← JWT verification
│   └── supabase.js    ← Supabase client
├── routes/
│   ├── auth.js        ← Login/Register
│   ├── game.js        ← Save/Load/PvP/Leaderboard
│   └── alliance.js    ← Alliance system
└── public/            ← All client files go here
    ├── index.html
    ├── style.css
    ├── game.js
    ├── heroSystem.js
    ├── marchSystem.js
    ├── marchUI.js
    ├── questSystem.js
    ├── dailyEvents.js
    ├── dungeonSystem.js
    ├── cloudEffect.js
    ├── item-images.js
    └── assets/        ← Images, sounds, sprites
```

---

## STEP 1 — Push to GitHub

```bash
# In your project folder
cd atlantis

# Initialize git
git init
git add .
git commit -m "Initial deployment"

# Create repo on github.com, then:
git remote add origin https://github.com/YOUR-USER/atlantis-game.git
git branch -M main
git push -u origin main
```

> ⚠️ Make sure `.env` is in `.gitignore` so your keys don't leak!

---

## STEP 2 — Choose a Hosting Platform

### Option A: Railway (RECOMMENDED — easiest, supports WebSockets)

1. Go to [railway.app](https://railway.app) → Sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `atlantis-game` repo
4. Railway auto-detects Node.js → it will run `npm install` + `npm start`
5. Go to **Variables** tab and add:
   ```
   SUPABASE_URL = https://zwjwgkpfhuhffiijzild.supabase.co
   SUPABASE_KEY = (your anon key)
   JWT_SECRET = (your secret)
   ```
   (Railway sets PORT automatically — don't add it)
6. Go to **Settings** → **Networking** → **Generate Domain**
7. You'll get a URL like: `atlantis-game-production.up.railway.app`

**Cost:** Free tier gives ~$5/month of usage. For a small game this is plenty.  
**WebSockets:** ✅ Supported natively.

---

### Option B: Render (free tier, good alternative)

1. Go to [render.com](https://render.com) → Sign in with GitHub
2. Click **"New" → "Web Service"**
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Add Environment Variables (same as above)
6. Deploy → get URL like `atlantis-game.onrender.com`

**Cost:** Free tier (spins down after 15min of inactivity — first load is slow ~30s).  
**WebSockets:** ✅ Supported.

---

### Option C: Fly.io (slightly more setup, very reliable)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch from your project folder
fly launch
# Pick a name, region (closest to your players), select Free tier

# Set secrets
fly secrets set SUPABASE_URL="https://zwjwgkpfhuhffiijzild.supabase.co"
fly secrets set SUPABASE_KEY="your-key"
fly secrets set JWT_SECRET="your-secret"

# Deploy
fly deploy
```

**Cost:** Free tier includes 3 shared VMs.  
**WebSockets:** ✅ Supported.

---

## STEP 3 — Add Your Client Files to /public

Your ZIP was missing some files that `index.html` references. Make sure ALL these exist in `/public`:

- `heroSystem.js`
- `marchSystem.js`
- `marchUI.js`
- `questSystem.js`
- `dailyEvents.js`
- `dungeonSystem.js`
- `cloudEffect.js`
- `item-images.js`
- `assets/` folder (all images, sounds, BorderTemplate.png, map.png, field.png, etc.)

---

## STEP 4 — Supabase Configuration

Your Supabase is already set up. Just make sure:

1. **Tables exist:** `jugadores`, `estado_jugador`, `private_messages`, `alliances`, `alliance_members`
2. **Row Level Security:** For production, enable RLS on sensitive tables
3. **API Settings:** In Supabase dashboard → Settings → API, your project URL and anon key should match your `.env`

---

## STEP 5 — Test the Deployment

Once deployed:
1. Visit your URL (e.g., `atlantis-game-production.up.railway.app`)
2. Register a new account
3. Check Socket.io connection (open browser console — should see no WebSocket errors)
4. Open a second browser/incognito → register another account
5. Test: chat, PvP attack, alliance features

---

## Quick Checklist

- [ ] All client files in `/public` folder
- [ ] `assets/` folder with all images/sounds
- [ ] `.env` NOT committed to GitHub
- [ ] Environment variables set on hosting platform
- [ ] Supabase tables created
- [ ] Test with 2 players simultaneously

---

## If You Want a Custom Domain Later

All three platforms support custom domains:
1. Buy a domain (Namecheap, Google Domains, etc.)
2. Add it in your hosting platform's settings
3. Point your DNS (CNAME record) to the platform's URL
4. SSL is automatic on all three platforms

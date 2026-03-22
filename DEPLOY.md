# 🚀 ClothBuddy — Deploy as PWA

Complete guide: local dev → production PWA in under 30 minutes.

---

## Project Structure

```
clothbuddy/
├── src/
│   ├── App.jsx          ← Your full ClothBuddy app
│   ├── main.jsx         ← React entry + SW registration + storage polyfill
│   └── api.js           ← API client (calls your backend proxy)
├── server/
│   ├── index.js         ← Express backend (hides your API key)
│   └── package.json
├── public/
│   ├── favicon.svg
│   └── icons/           ← PWA icons (generate with: node generate-icons.js)
├── vite.config.js       ← Vite + PWA plugin config
├── vercel.json          ← Vercel frontend deployment
├── railway.json         ← Railway backend deployment
└── .env.example         ← Copy to .env and fill in your key
```

---

## Step 1 — Local Development

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd server && npm install && cd ..

# Copy env file and add your Anthropic key
cp .env.example .env
# Edit .env → add: ANTHROPIC_API_KEY=sk-ant-...

# Run both frontend + backend together
npm run dev:full

# Open: http://localhost:5173
```

### What you'll see
- App loads at localhost:5173
- All Claude AI calls route through localhost:3001/api/claude
- PWA features active (installable, offline support)

---

## Step 2 — Update App.jsx to use the secure API client

In `src/App.jsx`, the top of the file has direct `fetch` calls to Anthropic.
Replace the `askClaude`, `streamClaude`, and `safeJSON` function definitions
with a single import:

```js
// At the top of src/App.jsx, REPLACE the inline function definitions with:
import { askClaude, streamClaude, safeJSON, askClaudeVision } from "./api.js";
```

Then delete the `askClaude`, `streamClaude`, and `safeJSON` function bodies
from App.jsx (they're now in api.js).

Also update the image scan in `OutfitScanner` to use `askClaudeVision`:
```js
// Replace the direct fetch for image scanning with:
const raw = await askClaudeVision(imageData, imageMime, IDENTIFY_PROMPT("Look at this outfit photo."));
```

---

## Step 3 — Generate PWA Icons

```bash
npm install canvas   # one-time
node generate-icons.js
# Creates public/icons/icon-{72,96,128,144,152,192,384,512}.png
```

For polished icons, use Figma or Adobe Illustrator with the ClothBuddy
hanger logo and export at each size. Replace the generated files.

---

## Step 4 — Deploy Backend to Railway

1. Go to **railway.app** → New Project → Deploy from GitHub repo
2. Point to your repo root
3. Railway auto-detects `railway.json`
4. Add environment variable: `ANTHROPIC_API_KEY=sk-ant-...`
5. Add environment variable: `CLIENT_URL=https://your-app.vercel.app`
6. Deploy → copy the generated URL (e.g. `https://clothbuddy-api.up.railway.app`)

**Cost:** Free tier covers ~500 API calls/day. $5/month for more.

---

## Step 5 — Deploy Frontend to Vercel

```bash
npm install -g vercel
vercel login
vercel --prod
```

Or via GitHub:
1. Push repo to GitHub
2. Go to **vercel.com** → New Project → Import repo
3. Framework: Vite
4. Add environment variable: `VITE_API_URL=https://clothbuddy-api.up.railway.app`
5. Deploy

**Update vercel.json** with your Railway URL:
```json
"destination": "https://YOUR-RAILWAY-URL/api/:path*"
```

---

## Step 6 — Install as PWA on Phone

### iPhone (iOS Safari)
1. Open your Vercel URL in Safari
2. Tap the **Share** button (box with arrow)
3. Scroll down → **"Add to Home Screen"**
4. Tap **Add**
5. ClothBuddy icon appears on your home screen ✓

### Android (Chrome)
1. Open your Vercel URL in Chrome
2. Chrome shows an **"Add to Home screen"** banner automatically
   (or tap ⋮ menu → "Install app")
3. Tap **Install**
4. ClothBuddy icon appears on your home screen ✓

---

## Step 7 — Custom Domain (optional)

In Vercel:
- Go to Project Settings → Domains
- Add `clothbuddy.app` or any domain you own
- Update DNS as instructed
- Vercel handles HTTPS automatically

---

## Production Checklist

- [ ] `ANTHROPIC_API_KEY` set in Railway (never in frontend)
- [ ] `CLIENT_URL` set in Railway to your Vercel URL
- [ ] `VITE_API_URL` set in Vercel to your Railway URL
- [ ] Icons generated at all 8 sizes
- [ ] `vercel.json` updated with Railway URL
- [ ] App tested on real iOS + Android device
- [ ] PWA install prompt tested
- [ ] Offline mode tested (disconnect wifi, reload app)
- [ ] Privacy policy page added (required for AI apps)

---

## Troubleshooting

**"API key not configured" error**
→ Check Railway environment variables. Make sure `ANTHROPIC_API_KEY` is set.

**CORS errors in production**
→ Check `CLIENT_URL` in Railway matches your exact Vercel URL (including https://)

**PWA not installing on iPhone**
→ Must be served over HTTPS. Vercel does this automatically.

**App not updating after deploy**
→ The service worker caches assets. Users see an "Update available" banner.
   Force update: open app → Settings → Clear cache, or wait 24h.

**Images not loading**
→ Check `vercel.json` rewrite rules aren't accidentally blocking /icons/ paths.

---

## Architecture Overview

```
User's Phone (PWA)
      │
      │  HTTPS
      ▼
  Vercel CDN
  (React + SW)
      │
      │  /api/claude POST
      ▼
  Railway Server
  (Express proxy)
      │
      │  x-api-key: sk-ant-...
      ▼
  Anthropic API
  (Claude Sonnet)
```

Your API key only ever lives on Railway. It never reaches the user's device.

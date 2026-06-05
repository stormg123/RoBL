# RoBl — AI Code Generator for Roblox Studio

Generate Lua scripts using NVIDIA NIM and push them directly to Roblox Studio via a plugin. Log in with Roblox OAuth, type a prompt, and get production-ready code.

## Project Structure

```
Desktop/robl/
├── website/              # Frontend (deploy to Netlify)
│   ├── index.html        # Landing page
│   ├── login.html        # Auth + dashboard SPA
│   ├── styles.css        # App styling
│   ├── app.js            # Frontend logic
│   ├── privacy.html      # Privacy policy
│   └── terms.html        # Terms of service
├── api/                  # Backend (deployed to Render)
│   ├── server.js         # Express server (OAuth, AI gen, code delivery)
│   └── package.json      # Dependencies
└── plugin/               # Roblox Studio plugin
    └── RoBlPlugin.lua    # Polls API, inserts code into place
```

## Architecture

- **Landing page** (`index.html`) — public-facing site with hero, features, reviews, CTA
- **Login/Dashboard** (`login.html`) — OAuth login with Roblox, code generation UI, Monaco editor, history, settings
- **Backend** (`api/`) — Express server that handles OAuth flow, proxies requests to NVIDIA NIM, and serves code to the Studio plugin via polling
- **Plugin** (`plugin/`) — Roblox Studio `.lua` plugin that polls the API for pending code and inserts it as a Script or LocalScript

The backend also serves the frontend files (`express.static` pointing to `../website`), so a single Render URL works for both.

## Live URLs

| Service | URL |
|---------|-----|
| Render API | `https://robl-t4dq.onrender.com` |
| Netlify (frontend) | `https://robl-gg.netlify.app` |

## Setup

### 1. Roblox OAuth App

1. Go to https://create.roblox.com/dashboard/credentials/oauth
2. Click **Create App**
3. Fill in:

| Field | Development | Production |
|-------|-------------|------------|
| **Entry Link** | `http://localhost:3000` | `https://robl-gg.netlify.app` |
| **Privacy Policy URL** | `http://localhost:3000/privacy.html` | `https://robl-gg.netlify.app/privacy.html` |
| **Terms of Service URL** | `http://localhost:3000/terms.html` | `https://robl-gg.netlify.app/terms.html` |
| **Callback URI** | `http://localhost:3000/auth/roblox/callback` | `https://robl-t4dq.onrender.com/auth/roblox/callback` |

4. Set **Scopes** to `profile` (or `openid profile`)
5. Category: **Creation & Productivity Tools**
6. Save the **Client ID** and **Client Secret**

### 2. Environment Variables (Render)

| Variable | Value |
|----------|-------|
| `CLIENT_ID` | Your Roblox OAuth client ID |
| `CLIENT_SECRET` | Your Roblox OAuth client secret |
| `BASE_URL` | `https://robl-t4dq.onrender.com` |

The server reads these from `process.env` — never hardcoded.

### 3. Run Locally

```bash
cd api
npm install
# Set env vars or edit fallbacks in server.js
CLIENT_ID=your_id CLIENT_SECRET=your_secret npm start
```

Open `http://localhost:3000` — the backend serves both the API and the website.

### 4. Deploy to Render (Backend)

1. Push to GitHub
2. Go to https://dashboard.render.com → New Web Service
3. Connect your repo
4. Set **Root Directory** to `api`
5. Build Command: `npm install`
6. Start Command: `npm start`
7. Add environment variables: `CLIENT_ID`, `CLIENT_SECRET`, `BASE_URL`
8. Deploy → `https://your-app.onrender.com`

### 5. Deploy to Netlify (Frontend)

1. Push to GitHub
2. Go to https://app.netlify.com → Add new site → Import from GitHub
3. Select your repo
4. Settings:
   - Base directory: `website`
   - Publish directory: `website`
   - No build command
5. Deploy → `https://your-site.netlify.app`

If the Netlify URL changes, update the CORS origins in `api/server.js`.

### 6. Install Studio Plugin

1. Open **Roblox Studio**
2. Plugins → Plugin Manager → **Add from Folder**
3. Select the `plugin/` folder containing `RoBlPlugin.lua`
4. A **RoBl AI** button appears in the Plugins toolbar

### 7. Get an NVIDIA NIM API Key

1. Go to https://build.nvidia.com/explore/discover
2. Sign up/log in
3. Pick any model (e.g., Llama 3.1 Nemotron 70B)
4. Click **Get API Key** → generate one
5. Copy the key (`nvapi-...`)

### 8. Usage

1. Open the website (Netlify URL or `http://localhost:3000`)
2. Click **Log in with Roblox** → authorize
3. Enter your **NVIDIA NIM API Key** and click **Save**
4. Type a prompt (e.g., "Create a door that slides open when clicked")
5. Click **Generate** → AI writes the Lua code
6. In Studio, click the **RoBl AI** toolbar button
7. Enter your **Roblox User ID** (from your profile URL) and click **Connect**
8. Back on the website, click **Send to Studio**
9. The plugin fetches the code and asks how to insert it (Script / LocalScript / Cancel)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/roblox` | Redirect to Roblox OAuth |
| GET | `/auth/roblox/callback` | OAuth callback → redirects to `login.html?session=...` |
| GET | `/api/me?session=...` | Get current user info |
| POST | `/api/generate` | Generate code via NVIDIA NIM |
| GET | `/api/code/latest?robloxId=...` | Poll for pending code (used by plugin) |
| GET | `/api/health` | Health check |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| OAuth callback fails | Callback URI must match EXACTLY in Roblox dashboard and server.js |
| Plugin can't connect | Ensure backend is running and accessible; check the API URL in the plugin |
| "Failed to generate code" | Check your NVIDIA NIM API key is valid |
| CORS errors | Update `api/server.js` with your Netlify URL in the `origin` array |
| Login redirects to wrong page | OAuth callback in `server.js` redirects to `login.html?session=...` — make sure `login.html` exists |

---

Made by **StormPieWormPie**
